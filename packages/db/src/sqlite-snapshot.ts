import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstatSync, realpathSync } from 'node:fs';
import { lstat, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

import { migrationChecksum } from './migration-runner.js';
import { MIGRATIONS } from './migrations.js';

export const SQLITE_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024 * 1024;

export type SqliteSnapshotErrorCode =
  | 'ABORTED'
  | 'ALREADY_EXISTS'
  | 'INTEGRITY_FAILED'
  | 'INVALID_PATH'
  | 'LIMIT_EXCEEDED'
  | 'MAINTENANCE_REQUIRED'
  | 'SNAPSHOT_FAILED';

export class SqliteSnapshotError extends Error {
  public constructor(public readonly code: SqliteSnapshotErrorCode) {
    super(code);
    this.name = 'SqliteSnapshotError';
    delete this.stack;
  }
}

export interface SqliteSnapshotIdentity {
  readonly migrationFingerprint: string;
  readonly schemaVersion: number;
}

interface PathBinding {
  readonly canonicalParent: string;
  readonly parent: Stats;
  readonly file: Stats;
}

const SHA256 = /^[a-f0-9]{64}$/u;

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new SqliteSnapshotError('ABORTED');
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function unsafePathSyntax(path: string): boolean {
  return (
    path.startsWith('\\\\') ||
    path.startsWith('//') ||
    path.includes('\0') ||
    (process.platform === 'win32' &&
      (!/^[a-z]:[\\/]/iu.test(path) ||
        path.slice(2).includes(':') ||
        /(?:^|[\\/])(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3]|conin\$|conout\$|clock\$)[ .]*(?:\.|$)/iu.test(
          path,
        ) ||
        path.split(/[\\/]/u).some((part) => part.endsWith('.') || part.endsWith(' '))))
  );
}

function assertLocalRegularSqlitePath(path: string): Stats {
  if (!isAbsolute(path) || unsafePathSyntax(path)) throw new SqliteSnapshotError('INVALID_PATH');
  try {
    const stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.nlink !== 1 ||
      resolve(realpathSync(path)) !== resolve(path)
    )
      throw new SqliteSnapshotError('INVALID_PATH');
    return stat;
  } catch (error) {
    if (error instanceof SqliteSnapshotError) throw error;
    throw new SqliteSnapshotError('INVALID_PATH');
  }
}

function assertSnapshotSize(stat: Stats): void {
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > SQLITE_SNAPSHOT_MAX_BYTES)
    throw new SqliteSnapshotError('LIMIT_EXCEEDED');
}

async function reserveDestination(destinationPath: string): Promise<PathBinding> {
  if (!isAbsolute(destinationPath) || unsafePathSyntax(destinationPath))
    throw new SqliteSnapshotError('INVALID_PATH');
  const parentPath = dirname(resolve(destinationPath));
  let parent: Stats;
  let canonicalParent: string;
  try {
    parent = await lstat(parentPath);
    canonicalParent = await realpath(parentPath);
  } catch {
    throw new SqliteSnapshotError('INVALID_PATH');
  }
  if (!parent.isDirectory() || parent.isSymbolicLink() || resolve(canonicalParent) !== parentPath)
    throw new SqliteSnapshotError('INVALID_PATH');
  let reservation: FileHandle;
  try {
    reservation = await open(destinationPath, 'wx+', 0o600);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      throw new SqliteSnapshotError('ALREADY_EXISTS');
    throw new SqliteSnapshotError('SNAPSHOT_FAILED');
  }
  try {
    const [file, pathFile, canonicalFile] = await Promise.all([
      reservation.stat(),
      lstat(destinationPath),
      realpath(destinationPath),
    ]);
    if (
      !file.isFile() ||
      file.nlink !== 1 ||
      pathFile.isSymbolicLink() ||
      !sameIdentity(file, pathFile) ||
      resolve(canonicalFile) !== resolve(destinationPath)
    )
      throw new SqliteSnapshotError('INVALID_PATH');
    await reservation.close();
    return { canonicalParent, parent, file };
  } catch (error) {
    await reservation.close().catch(() => undefined);
    if (error instanceof SqliteSnapshotError) throw error;
    throw new SqliteSnapshotError('SNAPSHOT_FAILED');
  }
}

async function verifyDestination(destinationPath: string, binding: PathBinding): Promise<Stats> {
  const [pathFile, parent, canonicalFile, canonicalParent] = await Promise.all([
    lstat(destinationPath),
    lstat(dirname(destinationPath)),
    realpath(destinationPath),
    realpath(dirname(destinationPath)),
  ]);
  if (
    pathFile.nlink !== 1 ||
    pathFile.isSymbolicLink() ||
    !sameIdentity(binding.file, pathFile) ||
    !sameIdentity(binding.parent, parent) ||
    resolve(canonicalFile) !== resolve(destinationPath) ||
    resolve(canonicalParent) !== resolve(binding.canonicalParent)
  )
    throw new SqliteSnapshotError('INVALID_PATH');
  assertSnapshotSize(pathFile);
  return pathFile;
}

async function cleanupDestination(destinationPath: string, binding: PathBinding): Promise<void> {
  try {
    const [file, parent, canonicalFile, canonicalParent] = await Promise.all([
      lstat(destinationPath),
      lstat(dirname(destinationPath)),
      realpath(destinationPath),
      realpath(dirname(destinationPath)),
    ]);
    if (
      file.isSymbolicLink() ||
      file.nlink !== 1 ||
      !sameIdentity(binding.file, file) ||
      !sameIdentity(binding.parent, parent) ||
      resolve(canonicalFile) !== resolve(destinationPath) ||
      resolve(canonicalParent) !== resolve(binding.canonicalParent)
    )
      return;
    await unlink(destinationPath);
  } catch {
    // Fail closed: an unproven target remains for caller-owned staging recovery.
  }
}

export function estimateSqliteSnapshotBytes(sourceDatabase: DatabaseSync): number {
  const pageCount = sourceDatabase.prepare('PRAGMA page_count').get() as
    { readonly page_count: unknown } | undefined;
  const pageSize = sourceDatabase.prepare('PRAGMA page_size').get() as
    { readonly page_size: unknown } | undefined;
  if (
    !Number.isSafeInteger(pageCount?.page_count) ||
    !Number.isSafeInteger(pageSize?.page_size) ||
    (pageCount?.page_count as number) < 1 ||
    (pageSize?.page_size as number) < 512
  )
    throw new SqliteSnapshotError('SNAPSHOT_FAILED');
  const estimate = (pageCount?.page_count as number) * (pageSize?.page_size as number);
  if (!Number.isSafeInteger(estimate) || estimate > SQLITE_SNAPSHOT_MAX_BYTES)
    throw new SqliteSnapshotError('LIMIT_EXCEEDED');
  return estimate;
}

function assertMaintenanceSafe(database: DatabaseSync): void {
  const activeJob = database
    .prepare('SELECT 1 FROM jobs WHERE lease_token IS NOT NULL LIMIT 1')
    .get();
  const activeCache = database
    .prepare(
      `SELECT 1 FROM model_cache_entries
       WHERE status = 'IN_FLIGHT' OR owner_token_hash IS NOT NULL OR lease_expires_at IS NOT NULL
       LIMIT 1`,
    )
    .get();
  if (activeJob !== undefined || activeCache !== undefined)
    throw new SqliteSnapshotError('MAINTENANCE_REQUIRED');
}

function sanitizeSnapshot(database: DatabaseSync): void {
  assertMaintenanceSafe(database);
  database.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE;');
  try {
    database.exec(`
      UPDATE local_api_clients
      SET token_digest = randomblob(32),
          revoked_at = COALESCE(revoked_at, updated_at),
          revision = revision + 1;
      DELETE FROM model_cache_entries;
      COMMIT;
      VACUUM;
    `);
  } catch {
    try {
      database.exec('ROLLBACK;');
    } catch {
      // The isolated target is discarded by the caller when its identity remains provable.
    }
    throw new SqliteSnapshotError('SNAPSHOT_FAILED');
  }
}

function readMigrationIdentity(database: DatabaseSync): SqliteSnapshotIdentity {
  const rows = database
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC')
    .all() as unknown as readonly {
    readonly checksum: unknown;
    readonly name: unknown;
    readonly version: unknown;
  }[];
  if (rows.length !== MIGRATIONS.length || rows.length === 0)
    throw new SqliteSnapshotError('INTEGRITY_FAILED');
  const fingerprint = createHash('sha256');
  for (const [index, row] of rows.entries()) {
    const expected = MIGRATIONS[index];
    if (
      expected === undefined ||
      !Number.isSafeInteger(row.version) ||
      row.version !== index + 1 ||
      typeof row.name !== 'string' ||
      typeof row.checksum !== 'string' ||
      !SHA256.test(row.checksum) ||
      row.name !== expected.name ||
      row.checksum !== migrationChecksum(expected)
    )
      throw new SqliteSnapshotError('INTEGRITY_FAILED');
    fingerprint.update(`${row.version}\n${row.name}\n${row.checksum}\n`, 'utf8');
  }
  return Object.freeze({
    migrationFingerprint: fingerprint.digest('hex'),
    schemaVersion: rows.length,
  });
}

function assertSnapshotChecks(database: DatabaseSync): SqliteSnapshotIdentity {
  const integrity = database.prepare('PRAGMA integrity_check').all() as unknown as readonly {
    readonly integrity_check: unknown;
  }[];
  const quick = database.prepare('PRAGMA quick_check').all() as unknown as readonly {
    readonly quick_check: unknown;
  }[];
  if (
    integrity.length !== 1 ||
    integrity[0]?.integrity_check !== 'ok' ||
    quick.length !== 1 ||
    quick[0]?.quick_check !== 'ok' ||
    database.prepare('PRAGMA foreign_key_check').all().length !== 0 ||
    database.prepare('SELECT 1 FROM jobs WHERE lease_token IS NOT NULL LIMIT 1').get() !==
      undefined ||
    database.prepare('SELECT 1 FROM local_api_clients WHERE revoked_at IS NULL LIMIT 1').get() !==
      undefined ||
    database.prepare('SELECT 1 FROM model_cache_entries LIMIT 1').get() !== undefined
  )
    throw new SqliteSnapshotError('INTEGRITY_FAILED');
  return readMigrationIdentity(database);
}

export function inspectSqliteSnapshot(path: string): SqliteSnapshotIdentity {
  const initial = assertLocalRegularSqlitePath(path);
  assertSnapshotSize(initial);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { allowExtension: false, readOnly: true, timeout: 5_000 });
    if (!sameIdentity(initial, assertLocalRegularSqlitePath(path)))
      throw new SqliteSnapshotError('INVALID_PATH');
    const identity = assertSnapshotChecks(database);
    if (!sameIdentity(initial, assertLocalRegularSqlitePath(path)))
      throw new SqliteSnapshotError('INVALID_PATH');
    return identity;
  } catch (error) {
    if (error instanceof SqliteSnapshotError) throw error;
    throw new SqliteSnapshotError('INTEGRITY_FAILED');
  } finally {
    try {
      database?.close();
    } catch {
      // Stable errors must not reveal close failures.
    }
  }
}

export async function createSqliteSnapshot(
  sourceDatabase: DatabaseSync,
  destinationPath: string,
  signal?: AbortSignal,
): Promise<SqliteSnapshotIdentity> {
  checkAborted(signal);
  estimateSqliteSnapshotBytes(sourceDatabase);
  assertMaintenanceSafe(sourceDatabase);
  const binding = await reserveDestination(destinationPath);
  try {
    await backup(sourceDatabase, destinationPath, {
      progress: () => checkAborted(signal),
      rate: 128,
    });
    checkAborted(signal);
    await verifyDestination(destinationPath, binding);
    const snapshot = new DatabaseSync(destinationPath, { allowExtension: false, timeout: 5_000 });
    try {
      checkAborted(signal);
      sanitizeSnapshot(snapshot);
      checkAborted(signal);
    } finally {
      snapshot.close();
    }
    checkAborted(signal);
    await verifyDestination(destinationPath, binding);
    const identity = inspectSqliteSnapshot(destinationPath);
    checkAborted(signal);
    await verifyDestination(destinationPath, binding);
    return identity;
  } catch (error) {
    await cleanupDestination(destinationPath, binding);
    if (error instanceof SqliteSnapshotError) throw error;
    throw new SqliteSnapshotError('SNAPSHOT_FAILED');
  }
}
