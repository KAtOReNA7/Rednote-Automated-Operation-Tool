import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstatSync, realpathSync } from 'node:fs';
import { lstat, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

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

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new SqliteSnapshotError('ABORTED');
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function unsafePathSyntax(path: string): boolean {
  return (
    path.startsWith('\\') ||
    path.startsWith('//') ||
    path.includes('\0') ||
    (process.platform === 'win32' &&
      (!/^[a-z]:[\\/]/iu.test(path) ||
        path.slice(2).includes(':') ||
        /(?:^|[\\/])(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3]|conin\$|conout\$|clock\$)[ .]*(?:\.|$)/iu.test(
          path,
        ) ||
        path
          .split(/[\\/]/u)
          .some((component) => component.endsWith('.') || component.endsWith(' '))))
  );
}

export function assertLocalRegularSqlitePath(path: string): Stats {
  if (!isAbsolute(path) || unsafePathSyntax(path)) throw new SqliteSnapshotError('INVALID_PATH');
  try {
    const status = lstatSync(path);
    if (
      status.isSymbolicLink() ||
      !status.isFile() ||
      status.nlink !== 1 ||
      resolve(realpathSync(path)) !== resolve(path)
    )
      throw new SqliteSnapshotError('INVALID_PATH');
    return status;
  } catch (error) {
    if (error instanceof SqliteSnapshotError) throw error;
    throw new SqliteSnapshotError('INVALID_PATH');
  }
}

async function bindReservedDestination(
  destinationPath: string,
): Promise<{ readonly binding: PathBinding; readonly reservation: FileHandle }> {
  if (!isAbsolute(destinationPath) || unsafePathSyntax(destinationPath))
    throw new SqliteSnapshotError('INVALID_PATH');
  const parentPath = dirname(resolve(destinationPath));
  const parent = await lstat(parentPath).catch(() => {
    throw new SqliteSnapshotError('INVALID_PATH');
  });
  const canonicalParent = await realpath(parentPath).catch(() => {
    throw new SqliteSnapshotError('INVALID_PATH');
  });
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
  let binding: PathBinding | undefined;
  try {
    const file = await reservation.stat();
    binding = { canonicalParent, parent, file };
    const pathFile = await lstat(destinationPath);
    const canonicalFile = await realpath(destinationPath);
    if (
      !file.isFile() ||
      file.nlink !== 1 ||
      pathFile.isSymbolicLink() ||
      !sameIdentity(file, pathFile) ||
      resolve(canonicalFile) !== resolve(destinationPath)
    )
      throw new SqliteSnapshotError('INVALID_PATH');
    return { binding, reservation };
  } catch (error) {
    await reservation.close().catch(() => undefined);
    if (binding !== undefined) await removeReservedDestination(destinationPath, binding);
    if (error instanceof SqliteSnapshotError) throw error;
    throw new SqliteSnapshotError('SNAPSHOT_FAILED');
  }
}

async function verifyDestinationBinding(
  destinationPath: string,
  binding: PathBinding,
  reservation: FileHandle,
): Promise<void> {
  const [handleFile, pathFile, parent, canonicalFile, canonicalParent] = await Promise.all([
    reservation.stat(),
    lstat(destinationPath),
    lstat(dirname(destinationPath)),
    realpath(destinationPath),
    realpath(dirname(destinationPath)),
  ]);
  if (
    handleFile.nlink !== 1 ||
    pathFile.isSymbolicLink() ||
    !sameIdentity(binding.file, handleFile) ||
    !sameIdentity(handleFile, pathFile) ||
    !sameIdentity(binding.parent, parent) ||
    resolve(canonicalFile) !== resolve(destinationPath) ||
    resolve(canonicalParent) !== resolve(binding.canonicalParent)
  )
    throw new SqliteSnapshotError('INVALID_PATH');
}

async function removeReservedDestination(
  destinationPath: string,
  binding: PathBinding,
): Promise<void> {
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
    // Fail closed: an unproven path is intentionally preserved for caller-owned staging cleanup.
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
  const bytes = (pageCount?.page_count as number) * (pageSize?.page_size as number);
  if (!Number.isSafeInteger(bytes) || bytes > SQLITE_SNAPSHOT_MAX_BYTES)
    throw new SqliteSnapshotError('LIMIT_EXCEEDED');
  return bytes;
}

function sanitizeMachineLocalCapabilities(database: DatabaseSync): void {
  if (
    database.prepare('SELECT 1 FROM jobs WHERE lease_token IS NOT NULL LIMIT 1').get() !==
      undefined ||
    database
      .prepare(
        `SELECT 1 FROM model_cache_entries
         WHERE status='IN_FLIGHT' OR owner_token_hash IS NOT NULL OR lease_expires_at IS NOT NULL
         LIMIT 1`,
      )
      .get() !== undefined
  )
    throw new SqliteSnapshotError('MAINTENANCE_REQUIRED');
  database.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE;');
  try {
    database.exec(`
      UPDATE local_api_clients
      SET token_digest=randomblob(32),
          revoked_at=COALESCE(revoked_at, updated_at),
          revision=revision+1;
      DELETE FROM model_cache_entries;
      COMMIT;
      VACUUM;
    `);
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch {
      // Closing the isolated snapshot is the safe fallback.
    }
    throw error;
  }
}

export function inspectSqliteSnapshot(path: string): SqliteSnapshotIdentity {
  const initialPath = assertLocalRegularSqlitePath(path);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { allowExtension: false, readOnly: true, timeout: 5_000 });
    if (!sameIdentity(initialPath, assertLocalRegularSqlitePath(path)))
      throw new SqliteSnapshotError('INVALID_PATH');
    const integrity = database.prepare('PRAGMA integrity_check').all() as unknown as readonly {
      readonly integrity_check: string;
    }[];
    const quick = database.prepare('PRAGMA quick_check').all() as unknown as readonly {
      readonly quick_check: string;
    }[];
    if (
      integrity.length !== 1 ||
      integrity[0]?.integrity_check !== 'ok' ||
      quick.length !== 1 ||
      quick[0]?.quick_check !== 'ok' ||
      database.prepare('PRAGMA foreign_key_check').get() !== undefined ||
      database.prepare('SELECT 1 FROM jobs WHERE lease_token IS NOT NULL LIMIT 1').get() !==
        undefined ||
      database.prepare('SELECT 1 FROM local_api_clients WHERE revoked_at IS NULL LIMIT 1').get() !==
        undefined ||
      database.prepare('SELECT 1 FROM model_cache_entries LIMIT 1').get() !== undefined
    )
      throw new SqliteSnapshotError('INTEGRITY_FAILED');
    const hash = createHash('sha256');
    let schemaVersion = 0;
    for (const row of database
      .prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version')
      .iterate() as Iterable<{
      readonly checksum: unknown;
      readonly name: unknown;
      readonly version: unknown;
    }>) {
      if (
        !Number.isSafeInteger(row.version) ||
        (row.version as number) !== schemaVersion + 1 ||
        typeof row.name !== 'string' ||
        typeof row.checksum !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(row.checksum)
      )
        throw new SqliteSnapshotError('INTEGRITY_FAILED');
      schemaVersion = row.version as number;
      hash.update(`${row.version}\n${row.name}\n${row.checksum}\n`, 'utf8');
    }
    const identity = Object.freeze({ migrationFingerprint: hash.digest('hex'), schemaVersion });
    if (!sameIdentity(initialPath, assertLocalRegularSqlitePath(path)))
      throw new SqliteSnapshotError('INVALID_PATH');
    return identity;
  } catch (error) {
    if (error instanceof SqliteSnapshotError) throw error;
    throw new SqliteSnapshotError('INTEGRITY_FAILED');
  } finally {
    try {
      database?.close();
    } catch {
      // The stable integrity result must not be replaced by a path-bearing close error.
    }
  }
}

export async function createSqliteSnapshot(
  sourceDatabase: DatabaseSync,
  destinationPath: string,
  signal?: AbortSignal,
): Promise<SqliteSnapshotIdentity> {
  aborted(signal);
  estimateSqliteSnapshotBytes(sourceDatabase);
  const { binding, reservation } = await bindReservedDestination(destinationPath);
  try {
    await backup(sourceDatabase, destinationPath, {
      progress: () => aborted(signal),
      rate: 128,
    });
    aborted(signal);
    await verifyDestinationBinding(destinationPath, binding, reservation);
    const snapshot = new DatabaseSync(destinationPath, { allowExtension: false, timeout: 5_000 });
    try {
      sanitizeMachineLocalCapabilities(snapshot);
    } finally {
      snapshot.close();
    }
    aborted(signal);
    await reservation.sync();
    await verifyDestinationBinding(destinationPath, binding, reservation);
    const identity = inspectSqliteSnapshot(destinationPath);
    await verifyDestinationBinding(destinationPath, binding, reservation);
    return identity;
  } catch (error) {
    await reservation.close().catch(() => undefined);
    await removeReservedDestination(destinationPath, binding);
    if (error instanceof SqliteSnapshotError) throw error;
    throw new SqliteSnapshotError('SNAPSHOT_FAILED');
  } finally {
    await reservation.close().catch(() => undefined);
  }
}
