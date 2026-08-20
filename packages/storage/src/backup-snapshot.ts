import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import { parseManagedRelativePath } from '@mystery-operations/shared/storage';

import {
  BACKUP_MAX_DIRECTORIES,
  BACKUP_MAX_FILE_BYTES,
  BACKUP_MAX_FILES,
  BACKUP_MAX_MANIFEST_BYTES,
  BACKUP_MAX_TOTAL_BYTES,
  ControlledBackupError,
  backupWindowsPathKey,
  manifestSha256,
  parseBackupCompleteMarkerV1,
  parseBackupManifestV1,
  parseBackupPayloadPath,
  serializeBackupCompleteMarkerV1,
  serializeBackupManifestV1,
  type BackupFileCategory,
  type BackupManifestFileV1,
  type BackupManifestV1,
} from './backup-contracts.js';
import type { ProjectDataRoot } from './project-data-root.js';

const DATABASE_PAYLOAD_PATH = parseBackupPayloadPath('payload/database/rednote.sqlite', 'DATABASE');
const OWNER_FILE = '.rednote-backup-owner.json';
const COPY_BUFFER_BYTES = 64 * 1024;
const SPACE_MARGIN_BYTES = 1024 * 1024;

export interface BackupDatabaseIdentity {
  readonly migrationFingerprint: string;
  readonly schemaVersion: number;
}

export interface BackupManagedFileReference {
  readonly category: Exclude<BackupFileCategory, 'DATABASE'>;
  readonly expectedSha256: string | null;
  readonly expectedSizeBytes: number | null;
  readonly managedPath: string;
}

export interface ControlledBackupDatabaseAdapter {
  readonly createSnapshot: (
    destinationPath: string,
    signal?: AbortSignal,
  ) => Promise<BackupDatabaseIdentity>;
  readonly enumerateManagedFiles: (
    snapshotPath: string,
    signal?: AbortSignal,
  ) => readonly BackupManagedFileReference[];
  readonly estimateSnapshotBytes: () => number;
  readonly inspectSnapshot: (snapshotPath: string) => BackupDatabaseIdentity;
}

export interface CreateControlledBackupOptions {
  readonly appVersion: string;
  readonly buildCommit: string;
  readonly database: ControlledBackupDatabaseAdapter;
  readonly databasePath: string;
  readonly destinationPath: string;
  readonly root: ProjectDataRoot;
  /** Optional host-provided free-space observation, used before any write. */
  readonly availableBytes?: () => number;
  readonly signal?: AbortSignal;
  readonly v2DataVersion: number;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

export interface VerifyControlledBackupOptions {
  readonly backupPath: string;
  readonly signal?: AbortSignal;
}

export interface ControlledBackupResult {
  readonly manifest: BackupManifestV1;
  readonly manifestSha256: string;
  readonly durability:
    'SYNC_REQUESTS_COMPLETED' | 'DIRECTORY_SYNC_UNAVAILABLE' | 'PUBLISHED_DURABILITY_UNKNOWN';
}

interface Identity {
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs: number;
  readonly size: number;
}

interface SourceFile {
  readonly category: BackupFileCategory;
  readonly sourcePath: string;
  readonly payloadPath: string;
  readonly expectedSha256: string | null;
  readonly expectedSizeBytes: number | null;
  readonly identity: Identity;
}

interface StagingState {
  directories: number;
  readonly operationId: string;
  readonly path: string;
  readonly owned: Set<string>;
}

function stable(error: unknown, fallback: Parameters<typeof fail>[0]): ControlledBackupError {
  if (error instanceof ControlledBackupError) return error;
  return fail(fallback);
}

function databaseFailure(error: unknown): ControlledBackupError {
  if (error instanceof ControlledBackupError) return error;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { readonly code: unknown }).code
      : undefined;
  if (code === 'ABORTED' || code === 'MAINTENANCE_REQUIRED' || code === 'LIMIT_EXCEEDED')
    return fail(code);
  return fail('DATABASE_FAILED');
}

function fail(code: ConstructorParameters<typeof ControlledBackupError>[0]): ControlledBackupError {
  return new ControlledBackupError(code);
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw fail('ABORTED');
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

function identity(status: Stats): Identity {
  return { dev: status.dev, ino: status.ino, mtimeMs: status.mtimeMs, size: status.size };
}

function isWithin(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return (
    difference === '' ||
    (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference))
  );
}

function assertNoLink(path: string, directory: boolean): Stats {
  let status: Stats;
  try {
    status = lstatSync(path);
  } catch {
    throw fail('INVALID_PATH');
  }
  if (status.isSymbolicLink()) throw fail('PATH_LINK_NOT_ALLOWED');
  if (directory ? !status.isDirectory() : !status.isFile()) throw fail('INVALID_PATH');
  if (!directory && status.nlink !== 1) throw fail('PATH_LINK_NOT_ALLOWED');
  return status;
}

function assertDirectoryTree(path: string): void {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  const segments = relative(root, resolved).split(sep).filter(Boolean);
  let current = root;
  assertNoLink(current, true);
  for (const segment of segments) {
    current = join(current, segment);
    assertNoLink(current, true);
  }
  let canonical: string;
  try {
    canonical = realpathSync.native(resolved);
  } catch {
    throw fail('INVALID_PATH');
  }
  if (!isWithin(resolved, canonical) || !isWithin(canonical, resolved))
    throw fail('PATH_LINK_NOT_ALLOWED');
}

function assertDestination(root: ProjectDataRoot, destinationPath: string): string {
  if (!isAbsolute(destinationPath) || destinationPath.includes('\0')) throw fail('INVALID_PATH');
  const destination = resolve(destinationPath);
  const source = resolve(root.rootPath);
  assertDirectoryTree(source);
  if (destination === source || isWithin(source, destination) || isWithin(destination, source))
    throw fail('PATH_CONFLICT');
  const parent = dirname(destination);
  assertDirectoryTree(parent);
  if (existsSync(destination)) throw fail('ALREADY_EXISTS');
  return destination;
}

function addExact(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total > BACKUP_MAX_TOTAL_BYTES) throw fail('LIMIT_EXCEEDED');
  return total;
}

function assertCapacity(
  directory: string,
  required: number,
  availableBytes: (() => number) | undefined,
): void {
  if (!Number.isSafeInteger(required) || required < 0 || required > BACKUP_MAX_TOTAL_BYTES)
    throw fail('LIMIT_EXCEEDED');
  let available: number;
  try {
    const stats = statfsSync(directory);
    const observed = Number(BigInt(stats.bavail) * BigInt(stats.bsize));
    available = availableBytes === undefined ? observed : Math.min(observed, availableBytes());
  } catch {
    throw fail('INSUFFICIENT_SPACE');
  }
  if (!Number.isSafeInteger(available) || available < required) throw fail('INSUFFICIENT_SPACE');
}

function operationOwner(operationId: string): string {
  return JSON.stringify({ format: 'rednote-controlled-backup-owner', operationId, version: 1 });
}

function createStaging(destination: string, randomId: () => string): StagingState {
  const parent = dirname(destination);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const operationId = randomId();
    const staging = join(parent, `.${operationId}.rednote-backup-staging`);
    try {
      mkdirSync(staging, { recursive: false, mode: 0o700 });
    } catch {
      continue;
    }
    const state = {
      directories: 0,
      operationId,
      path: staging,
      owned: new Set<string>([OWNER_FILE]),
    };
    try {
      writeFileSync(join(staging, OWNER_FILE), operationOwner(operationId), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return state;
    } catch {
      try {
        if (readFileSync(join(staging, OWNER_FILE), 'utf8') === operationOwner(operationId))
          unlinkSync(join(staging, OWNER_FILE));
        if (readdirSync(staging).length === 0) rmdirSync(staging);
      } catch {
        throw fail('STAGING_OWNERSHIP_INVALID');
      }
      throw fail('PUBLISH_FAILED');
    }
  }
  throw fail('ALREADY_EXISTS');
}

function mkdirOwned(state: StagingState, relativePath: string): string {
  state.directories += 1;
  if (state.directories > BACKUP_MAX_DIRECTORIES) throw fail('LIMIT_EXCEEDED');
  const path = join(state.path, ...relativePath.split('/'));
  mkdirSync(path, { recursive: false, mode: 0o700 });
  state.owned.add(relativePath);
  return path;
}

function fileIdentity(path: string): Identity {
  return identity(assertNoLink(path, false));
}

function buildSources(
  root: ProjectDataRoot,
  inventory: readonly BackupManagedFileReference[],
): SourceFile[] {
  const keys = new Set<string>();
  const sources: SourceFile[] = [];
  for (const item of inventory) {
    let managedPath: ReturnType<typeof parseManagedRelativePath>;
    try {
      managedPath = parseManagedRelativePath(item.managedPath, item.category);
    } catch {
      throw fail('INTEGRITY_FAILED');
    }
    const payloadPath = parseBackupPayloadPath(`payload/${managedPath}`, item.category);
    const key = backupWindowsPathKey(payloadPath);
    if (keys.has(key)) throw fail('PATH_CONFLICT');
    keys.add(key);
    const sourcePath = root.resolve(managedPath);
    if (!isWithin(root.rootPath, sourcePath)) throw fail('INVALID_PATH');
    assertDirectoryTree(dirname(sourcePath));
    sources.push({
      category: item.category,
      expectedSha256: item.expectedSha256,
      expectedSizeBytes: item.expectedSizeBytes,
      identity: fileIdentity(sourcePath),
      payloadPath,
      sourcePath,
    });
  }
  if (sources.length > BACKUP_MAX_FILES - 1) throw fail('LIMIT_EXCEEDED');
  return sources.sort((left, right) => left.payloadPath.localeCompare(right.payloadPath, 'en'));
}

function copyBounded(
  source: SourceFile,
  target: string,
  signal: AbortSignal | undefined,
): BackupManifestFileV1 {
  checkAborted(signal);
  const before = fileIdentity(source.sourcePath);
  if (!sameIdentity(before, source.identity)) throw fail('FILE_CHANGED');
  if (before.size > BACKUP_MAX_FILE_BYTES) throw fail('LIMIT_EXCEEDED');
  if (source.expectedSizeBytes !== null && before.size !== source.expectedSizeBytes)
    throw fail('FILE_CHANGED');
  let input: number | undefined;
  let output: number | undefined;
  let size = 0;
  const digest = createHash('sha256');
  try {
    input = openSync(source.sourcePath, constants.O_RDONLY);
    if (!sameIdentity(before, identity(fstatSync(input)))) throw fail('FILE_CHANGED');
    output = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    while (true) {
      checkAborted(signal);
      const read = requireRead(input, buffer);
      if (read === 0) break;
      digest.update(buffer.subarray(0, read));
      let offset = 0;
      while (offset < read) {
        checkAborted(signal);
        const written = requireWrite(output, buffer, offset, read - offset);
        if (written < 1) throw fail('COPY_FAILED');
        offset += written;
      }
      size = addExact(size, read);
      if (size > BACKUP_MAX_FILE_BYTES) throw fail('LIMIT_EXCEEDED');
    }
    fsyncSync(output);
  } catch (error) {
    throw stable(error, 'COPY_FAILED');
  } finally {
    if (output !== undefined) closeSync(output);
    if (input !== undefined) closeSync(input);
  }
  const hash = digest.digest('hex');
  const after = fileIdentity(source.sourcePath);
  const targetIdentity = fileIdentity(target);
  if (!sameIdentity(before, after) || targetIdentity.size !== size) throw fail('FILE_CHANGED');
  if (source.expectedSha256 !== null && source.expectedSha256 !== hash)
    throw fail('INTEGRITY_FAILED');
  return {
    category: source.category,
    relativePath: parseBackupPayloadPath(source.payloadPath),
    sha256: hash,
    sizeBytes: size,
  };
}

function requireRead(handle: number, buffer: Buffer): number {
  const result = readSyncCompat(handle, buffer);
  if (!Number.isSafeInteger(result) || result < 0) throw fail('COPY_FAILED');
  return result;
}

function requireWrite(handle: number, buffer: Buffer, offset: number, length: number): number {
  const result = writeSyncCompat(handle, buffer, offset, length);
  if (!Number.isSafeInteger(result) || result < 0) throw fail('COPY_FAILED');
  return result;
}

function readSyncCompat(handle: number, buffer: Buffer): number {
  return readSync(handle, buffer, 0, buffer.length, null);
}

function writeSyncCompat(handle: number, buffer: Buffer, offset: number, length: number): number {
  return writeSync(handle, buffer, offset, length, null);
}

function scanOwned(path: string, relativePath: string, found: Map<string, Identity>): void {
  const status = lstatSync(path);
  if (status.isSymbolicLink()) throw fail('STAGING_OWNERSHIP_INVALID');
  if (status.isDirectory()) {
    if (relativePath !== '') found.set(relativePath, identity(status));
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`;
      scanOwned(join(path, entry.name), child, found);
    }
  } else if (status.isFile() && status.nlink === 1) {
    found.set(relativePath, identity(status));
  } else {
    throw fail('STAGING_OWNERSHIP_INVALID');
  }
}

function cleanupStaging(state: StagingState): void {
  let owner: string;
  try {
    owner = readFileSync(join(state.path, OWNER_FILE), 'utf8');
  } catch {
    throw fail('STAGING_OWNERSHIP_INVALID');
  }
  if (owner !== operationOwner(state.operationId)) throw fail('STAGING_OWNERSHIP_INVALID');
  const found = new Map<string, Identity>();
  try {
    scanOwned(state.path, '', found);
  } catch (error) {
    throw stable(error, 'STAGING_OWNERSHIP_INVALID');
  }
  if (found.size !== state.owned.size || [...found.keys()].some((entry) => !state.owned.has(entry)))
    throw fail('STAGING_OWNERSHIP_INVALID');
  for (const [entry, before] of found) {
    const path = join(state.path, ...entry.split('/'));
    const after = lstatSync(path);
    if (after.isSymbolicLink() || !sameIdentity(before, identity(after)))
      throw fail('STAGING_OWNERSHIP_INVALID');
  }
  for (const entry of [...found.keys()].sort(
    (left, right) => right.length - left.length || right.localeCompare(left),
  )) {
    const path = join(state.path, ...entry.split('/'));
    const status = lstatSync(path);
    if (status.isDirectory()) rmdirSync(path);
    else unlinkSync(path);
  }
  rmdirSync(state.path);
}

function readBounded(path: string, maximum: number): Uint8Array {
  const status = assertNoLink(path, false);
  if (status.size > maximum) throw fail('LIMIT_EXCEEDED');
  try {
    return readFileSync(path);
  } catch {
    throw fail('INVALID_MANIFEST');
  }
}

function verifyDirectory(
  backupPath: string,
  signal: AbortSignal | undefined,
  ownerOperationId?: string,
): BackupManifestV1 {
  checkAborted(signal);
  assertDirectoryTree(backupPath);
  const allowed = new Set(['manifest.json', 'COMPLETE.json', 'payload']);
  if (ownerOperationId !== undefined) {
    allowed.add(OWNER_FILE);
    try {
      if (readFileSync(join(backupPath, OWNER_FILE), 'utf8') !== operationOwner(ownerOperationId))
        throw fail('STAGING_OWNERSHIP_INVALID');
    } catch (error) {
      throw stable(error, 'STAGING_OWNERSHIP_INVALID');
    }
  }
  const entries = readdirSync(backupPath, { withFileTypes: true });
  if (entries.length !== allowed.size || entries.some((entry) => !allowed.has(entry.name)))
    throw fail('INVALID_MANIFEST');
  const manifestText = readBounded(join(backupPath, 'manifest.json'), BACKUP_MAX_MANIFEST_BYTES);
  let manifest: BackupManifestV1;
  try {
    manifest = parseBackupManifestV1(manifestText);
    const complete = parseBackupCompleteMarkerV1(
      readBounded(join(backupPath, 'COMPLETE.json'), 1024),
    );
    if (complete.manifestSha256 !== manifestSha256(Buffer.from(manifestText).toString('utf8')))
      throw fail('INTEGRITY_FAILED');
  } catch (error) {
    throw stable(error, 'INVALID_MANIFEST');
  }
  const expected = new Set<string>(manifest.files.map((file) => file.relativePath));
  const found = new Set<string>();
  const verifyPayload = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      checkAborted(signal);
      const child = join(directory, entry.name);
      const payload = prefix === '' ? `payload/${entry.name}` : `${prefix}/${entry.name}`;
      const status = lstatSync(child);
      if (status.isSymbolicLink()) throw fail('PATH_LINK_NOT_ALLOWED');
      if (status.isDirectory()) verifyPayload(child, payload);
      else if (status.isFile() && status.nlink === 1) {
        const file = manifest.files.find((item) => item.relativePath === payload);
        if (file === undefined || status.size !== file.sizeBytes) throw fail('INTEGRITY_FAILED');
        const digest = createHash('sha256');
        const input = openSync(child, constants.O_RDONLY);
        try {
          const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
          while (true) {
            const count = requireRead(input, buffer);
            if (count === 0) break;
            digest.update(buffer.subarray(0, count));
          }
        } finally {
          closeSync(input);
        }
        if (digest.digest('hex') !== file.sha256) throw fail('INTEGRITY_FAILED');
        found.add(payload);
      } else throw fail('PATH_LINK_NOT_ALLOWED');
    }
  };
  verifyPayload(join(backupPath, 'payload'), '');
  if (found.size !== expected.size || [...found].some((path) => !expected.has(path)))
    throw fail('INTEGRITY_FAILED');
  return manifest;
}

function syncDirectory(path: string): boolean {
  try {
    const handle = openSync(path, constants.O_RDONLY);
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    return true;
  } catch {
    return false;
  }
}

export async function createControlledBackupSnapshot(
  options: CreateControlledBackupOptions,
): Promise<ControlledBackupResult> {
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? randomUUID;
  checkAborted(options.signal);
  const destination = assertDestination(options.root, options.destinationPath);
  const expectedDatabasePath = resolve(options.root.databaseDirectory, 'rednote.sqlite');
  if (resolve(options.databasePath) !== expectedDatabasePath) throw fail('PATH_CONFLICT');
  const databaseSourceIdentity = fileIdentity(expectedDatabasePath);
  let estimate: number;
  try {
    estimate = options.database.estimateSnapshotBytes();
  } catch (error) {
    throw databaseFailure(error);
  }
  if (!Number.isSafeInteger(estimate) || estimate < 0) throw fail('DATABASE_FAILED');
  assertCapacity(
    dirname(destination),
    addExact(estimate, SPACE_MARGIN_BYTES),
    options.availableBytes,
  );
  let staging: StagingState | undefined;
  let published = false;
  try {
    staging = createStaging(destination, randomId);
    const payload = mkdirOwned(staging, 'payload');
    mkdirOwned(staging, 'payload/database');
    const databaseTarget = join(payload, 'database', 'rednote.sqlite');
    staging.owned.add('payload/database/rednote.sqlite');
    let databaseIdentity: BackupDatabaseIdentity;
    try {
      databaseIdentity = await options.database.createSnapshot(databaseTarget, options.signal);
      const inspected = options.database.inspectSnapshot(databaseTarget);
      if (
        inspected.schemaVersion !== databaseIdentity.schemaVersion ||
        inspected.migrationFingerprint !== databaseIdentity.migrationFingerprint
      )
        throw fail('INTEGRITY_FAILED');
    } catch (error) {
      throw databaseFailure(error);
    }
    if (!sameIdentity(databaseSourceIdentity, fileIdentity(expectedDatabasePath)))
      throw fail('FILE_CHANGED');
    let inventory: readonly BackupManagedFileReference[];
    try {
      inventory = options.database.enumerateManagedFiles(databaseTarget, options.signal);
    } catch (error) {
      throw databaseFailure(error);
    }
    const sources = buildSources(options.root, inventory);
    let actualTotal = fileIdentity(databaseTarget).size;
    for (const source of sources) actualTotal = addExact(actualTotal, source.identity.size);
    assertCapacity(
      dirname(destination),
      addExact(actualTotal, SPACE_MARGIN_BYTES),
      options.availableBytes,
    );
    const files: BackupManifestFileV1[] = [
      {
        category: 'DATABASE',
        relativePath: DATABASE_PAYLOAD_PATH,
        sha256: hashExisting(databaseTarget, options.signal),
        sizeBytes: fileIdentity(databaseTarget).size,
      },
    ];
    for (const source of sources) {
      const directory = dirname(source.payloadPath);
      const segments = directory.split('/');
      let relativeDirectory = '';
      for (const segment of segments) {
        relativeDirectory = relativeDirectory === '' ? segment : `${relativeDirectory}/${segment}`;
        if (!staging.owned.has(relativeDirectory)) mkdirOwned(staging, relativeDirectory);
      }
      const target = join(staging.path, ...source.payloadPath.split('/'));
      staging.owned.add(source.payloadPath);
      files.push(copyBounded(source, target, options.signal));
    }
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
    const manifest = {
      format: 'rednote-controlled-directory-backup',
      backupFormatVersion: 1,
      status: 'COMPLETE',
      createdAt: now().toISOString(),
      timeZone: 'UTC',
      source: {
        workspaceId: options.root.marker.instanceId,
        appVersion: options.appVersion,
        buildCommit: options.buildCommit,
        dataRootFormat: 'rednote-project-data',
        dataRootVersion: options.root.marker.version,
        v2DataVersion: options.v2DataVersion,
        schemaVersion: databaseIdentity.schemaVersion,
        migrationFingerprint: databaseIdentity.migrationFingerprint,
      },
      compatibilityPolicyVersion: 1,
      files,
      totals: {
        fileCount: files.length,
        sizeBytes: files.reduce((total, file) => addExact(total, file.sizeBytes), 0),
      },
    } as const satisfies BackupManifestV1;
    const serialized = serializeBackupManifestV1(manifest);
    writeFileSync(join(staging.path, 'manifest.json'), serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    staging.owned.add('manifest.json');
    writeFileSync(
      join(staging.path, 'COMPLETE.json'),
      serializeBackupCompleteMarkerV1(manifestSha256(serialized)),
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    );
    staging.owned.add('COMPLETE.json');
    verifyDirectory(staging.path, options.signal, staging.operationId);
    checkAborted(options.signal);
    unlinkSync(join(staging.path, OWNER_FILE));
    staging.owned.delete(OWNER_FILE);
    assertDestination(options.root, destination);
    renameSync(staging.path, destination);
    published = true;
    try {
      verifyDirectory(destination, options.signal);
    } catch {
      return {
        durability: 'PUBLISHED_DURABILITY_UNKNOWN',
        manifest,
        manifestSha256: manifestSha256(serialized),
      };
    }
    const durability = syncDirectory(dirname(destination))
      ? 'SYNC_REQUESTS_COMPLETED'
      : 'DIRECTORY_SYNC_UNAVAILABLE';
    return { durability, manifest, manifestSha256: manifestSha256(serialized) };
  } catch (error) {
    if (!published && staging !== undefined) {
      try {
        cleanupStaging(staging);
      } catch {
        throw fail('STAGING_OWNERSHIP_INVALID');
      }
    }
    throw stable(error, 'PUBLISH_FAILED');
  }
}

function hashExisting(path: string, signal: AbortSignal | undefined): string {
  const before = fileIdentity(path);
  const digest = createHash('sha256');
  const input = openSync(path, constants.O_RDONLY);
  try {
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    while (true) {
      checkAborted(signal);
      const count = requireRead(input, buffer);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(input);
  }
  if (!sameIdentity(before, fileIdentity(path))) throw fail('FILE_CHANGED');
  return digest.digest('hex');
}

export function verifyControlledBackupSnapshot(
  options: VerifyControlledBackupOptions,
): BackupManifestV1 {
  try {
    return verifyDirectory(resolve(options.backupPath), options.signal);
  } catch (error) {
    throw stable(error, 'INTEGRITY_FAILED');
  }
}
