import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rmdir,
  statfs,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import type { ProjectDataRoot } from './project-data-root.js';
import {
  BACKUP_MAX_FILE_BYTES,
  BACKUP_MAX_DIRECTORIES,
  BACKUP_MAX_FILES,
  BACKUP_MAX_MANIFEST_BYTES,
  BACKUP_MAX_TOTAL_BYTES,
  type BackupFileCategory,
  type BackupManifestFileV1,
  type BackupManifestV1,
  backupCategoryForPayloadPath,
  backupWindowsPathKey,
  ControlledBackupError,
  manifestSha256,
  parseBackupCompleteMarkerV1,
  parseBackupManifestV1,
  parseBackupPayloadPath,
  serializeBackupCompleteMarkerV1,
  serializeBackupManifestV1,
} from './backup-contracts.js';
const OWNER_FILE = '.rednote-backup-owner.json';
const OWNER_FORMAT = 'rednote-controlled-backup-staging-owner';
const COPY_BUFFER_BYTES = 1024 * 1024;
interface OwnedEntry {
  readonly dev: number;
  readonly ino: number;
  readonly kind: 'directory' | 'file';
}
type OwnedEntries = Map<string, OwnedEntry>;
export interface BackupDatabaseIdentity {
  readonly migrationFingerprint: string;
  readonly schemaVersion: number;
}
export interface BackupManagedFileReference {
  readonly category: BackupFileCategory;
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
  ) => Promise<readonly BackupManagedFileReference[]> | readonly BackupManagedFileReference[];
  readonly estimateSnapshotBytes: () => Promise<number> | number;
  readonly inspectSnapshot: (
    snapshotPath: string,
  ) => Promise<BackupDatabaseIdentity> | BackupDatabaseIdentity;
}
export interface CreateControlledBackupOptions {
  readonly appVersion: string;
  readonly buildCommit: string;
  readonly database: ControlledBackupDatabaseAdapter;
  readonly now?: () => Date;
  readonly randomId?: () => string;
  readonly root: ProjectDataRoot;
  readonly selectedBackupRoot: string;
  readonly signal?: AbortSignal;
  readonly v2DataVersion: number;
}
export interface ControlledBackupResult {
  readonly backupName: string;
  readonly durability: 'SYNC_REQUESTS_COMPLETED' | 'DIRECTORY_SYNC_UNAVAILABLE';
  readonly manifestSha256: string;
  readonly operationId: string;
  readonly totals: { readonly fileCount: number; readonly sizeBytes: number };
}
export interface VerifyControlledBackupOptions {
  readonly backupDirectory: string;
  readonly database: ControlledBackupDatabaseAdapter;
  readonly signal?: AbortSignal;
}
function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
function failIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new ControlledBackupError('ABORTED');
}
function pathKey(path: string): string {
  return backupWindowsPathKey(resolve(path).normalize('NFC').split(sep).join('/'));
}
function isWithin(parent: string, child: string): boolean {
  const parentKey = pathKey(parent);
  const childKey = pathKey(child);
  return childKey === parentKey || childKey.startsWith(`${parentKey}/`);
}
async function canonicalDirectory(path: string): Promise<string> {
  if (
    !isAbsolute(path) ||
    path.startsWith('\\') ||
    path.startsWith('//') ||
    (process.platform === 'win32' && !/^[a-z]:[\\/]/iu.test(path)) ||
    resolve(path) === parse(resolve(path)).root
  )
    throw new ControlledBackupError('INVALID_PATH');
  try {
    const resolved = resolve(path);
    const status = await lstat(resolved);
    const canonical = await realpath(resolved);
    if (
      status.isSymbolicLink() ||
      !status.isDirectory() ||
      pathKey(resolved) !== pathKey(canonical)
    )
      throw new ControlledBackupError('PATH_LINK_NOT_ALLOWED');
    return canonical;
  } catch (error) {
    if (error instanceof ControlledBackupError) throw error;
    throw new ControlledBackupError('INVALID_PATH');
  }
}
async function regularFileUnder(
  root: string,
  relativePath: string,
): Promise<{ path: string; stat: Stats }> {
  let current = root;
  const segments = relativePath.split('/');
  try {
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      const status = await lstat(current);
      const canonical = await realpath(current);
      if (
        status.isSymbolicLink() ||
        (index === segments.length - 1 && status.nlink !== 1) ||
        !isWithin(root, canonical) ||
        pathKey(current) !== pathKey(canonical) ||
        (index < segments.length - 1 ? !status.isDirectory() : !status.isFile())
      )
        throw new ControlledBackupError('PATH_LINK_NOT_ALLOWED');
      if (index === segments.length - 1) return { path: current, stat: status };
    }
  } catch (error) {
    if (error instanceof ControlledBackupError) throw error;
    throw new ControlledBackupError('COPY_FAILED');
  }
  throw new ControlledBackupError('INVALID_PATH');
}
function sameFile(left: Stats, right: Stats): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}
function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
async function assertDirectoryBinding(path: string, expected: Stats): Promise<void> {
  const canonical = await canonicalDirectory(path);
  if (pathKey(canonical) !== pathKey(path) || !sameIdentity(expected, await lstat(path)))
    throw new ControlledBackupError('PATH_LINK_NOT_ALLOWED');
}
async function hashOrCopy(
  root: string,
  relativePath: string,
  signal?: AbortSignal,
  destinationPath?: string,
  destinationCreated?: (stat: Stats) => void,
): Promise<{ readonly proof: Stats; readonly sha256: string; readonly sizeBytes: number }> {
  const before = await regularFileUnder(root, relativePath);
  if (before.stat.size > BACKUP_MAX_FILE_BYTES) throw new ControlledBackupError('LIMIT_EXCEEDED');
  let source: FileHandle | undefined;
  let destination: FileHandle | undefined;
  let destinationParent: string | undefined;
  try {
    source = await open(before.path, 'r');
    const opened = await source.stat();
    if (!sameFile(before.stat, opened)) throw new ControlledBackupError('FILE_CHANGED');
    if (destinationPath !== undefined) {
      destinationParent = await canonicalDirectory(dirname(destinationPath));
      destination = await open(destinationPath, 'wx', 0o600);
      const pathFile = await lstat(destinationPath);
      if (
        pathFile.isSymbolicLink() ||
        pathFile.nlink !== 1 ||
        !sameFile(await destination.stat(), pathFile) ||
        pathKey(await realpath(dirname(destinationPath))) !== pathKey(destinationParent)
      )
        throw new ControlledBackupError('PATH_LINK_NOT_ALLOWED');
      destinationCreated?.(pathFile);
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let sizeBytes = 0;
    while (true) {
      failIfAborted(signal);
      const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      sizeBytes += bytesRead;
      if (sizeBytes > BACKUP_MAX_FILE_BYTES) throw new ControlledBackupError('LIMIT_EXCEEDED');
      hash.update(buffer.subarray(0, bytesRead));
      if (destination !== undefined) {
        let offset = 0;
        while (offset < bytesRead) {
          const written = (await destination.write(buffer, offset, bytesRead - offset))
            .bytesWritten;
          if (written === 0) throw new ControlledBackupError('COPY_FAILED');
          offset += written;
        }
      }
    }
    if (destination !== undefined) await destination.sync();
    const afterHandle = await source.stat();
    const afterPath = await regularFileUnder(root, relativePath);
    if (!sameFile(before.stat, afterHandle) || !sameFile(before.stat, afterPath.stat))
      throw new ControlledBackupError('FILE_CHANGED');
    if (destination !== undefined && destinationPath !== undefined) {
      const destinationHandle = await destination.stat();
      const destinationFile = await lstat(destinationPath);
      if (
        destinationHandle.nlink !== 1 ||
        destinationFile.isSymbolicLink() ||
        !sameFile(destinationHandle, destinationFile) ||
        pathKey(await realpath(destinationPath)) !== pathKey(destinationPath) ||
        pathKey(await realpath(dirname(destinationPath))) !== pathKey(destinationParent as string)
      )
        throw new ControlledBackupError('PATH_LINK_NOT_ALLOWED');
    }
    return Object.freeze({ proof: afterPath.stat, sha256: hash.digest('hex'), sizeBytes });
  } catch (error) {
    if (error instanceof ControlledBackupError) throw error;
    throw new ControlledBackupError('COPY_FAILED');
  } finally {
    await destination?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
  }
}
async function ensureDirectories(
  root: string,
  relativeDirectory: string,
  ownedEntries: OwnedEntries,
): Promise<void> {
  let current = root;
  let relative = '';
  for (const segment of relativeDirectory.split('/').filter(Boolean)) {
    current = join(current, segment);
    relative = relative.length === 0 ? segment : `${relative}/${segment}`;
    try {
      await mkdir(current);
    } catch (error) {
      if (!isErrno(error, 'EEXIST') || !ownedEntries.has(relative))
        throw new ControlledBackupError('COPY_FAILED');
    }
    const status = await lstat(current);
    if (
      status.isSymbolicLink() ||
      !status.isDirectory() ||
      pathKey(await realpath(current)) !== pathKey(current)
    )
      throw new ControlledBackupError('PATH_LINK_NOT_ALLOWED');
    const previous = ownedEntries.get(relative);
    if (previous !== undefined && (previous.dev !== status.dev || previous.ino !== status.ino))
      throw new ControlledBackupError('PATH_LINK_NOT_ALLOWED');
    ownedEntries.set(relative, {
      dev: status.dev,
      ino: status.ino,
      kind: 'directory',
    });
  }
}
async function writeExclusive(
  path: string,
  value: string,
  created?: (stat: Stats) => void,
): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    created?.(await handle.stat());
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(path: string): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    await handle.sync();
    return true;
  } catch (error) {
    if (
      process.platform !== 'win32' ||
      !['EPERM', 'EINVAL', 'ENOTSUP', 'EISDIR'].some((code) => isErrno(error, code))
    )
      throw new ControlledBackupError('PUBLISH_FAILED');
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
function ownerValue(operationId: string): string {
  return JSON.stringify({ format: OWNER_FORMAT, version: 1, operationId });
}
function assertOwnerValue(value: string): void {
  let owner: unknown;
  try {
    owner = JSON.parse(value) as unknown;
  } catch {
    throw new ControlledBackupError('INTEGRITY_FAILED');
  }
  if (
    typeof owner !== 'object' ||
    owner === null ||
    Array.isArray(owner) ||
    Object.keys(owner).sort().join() !== 'format,operationId,version' ||
    !('operationId' in owner) ||
    typeof owner.operationId !== 'string' ||
    ownerValue(owner.operationId) !== value
  )
    throw new ControlledBackupError('INTEGRITY_FAILED');
}
async function readBounded(root: string, relativePath: string, maximum: number): Promise<Buffer> {
  const file = await regularFileUnder(root, relativePath);
  if (file.stat.size > maximum) throw new ControlledBackupError('LIMIT_EXCEEDED');
  const handle = await open(file.path, 'r');
  try {
    const opened = await handle.stat();
    if (!sameFile(file.stat, opened) || opened.size > maximum)
      throw new ControlledBackupError('FILE_CHANGED');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, null);
      if (read.bytesRead === 0) throw new ControlledBackupError('FILE_CHANGED');
      offset += read.bytesRead;
    }
    if ((await handle.read(Buffer.allocUnsafe(1), 0, 1, null)).bytesRead !== 0)
      throw new ControlledBackupError('LIMIT_EXCEEDED');
    const after = await handle.stat();
    const afterPath = await regularFileUnder(root, relativePath);
    if (!sameFile(file.stat, after) || !sameFile(file.stat, afterPath.stat))
      throw new ControlledBackupError('FILE_CHANGED');
    return bytes;
  } finally {
    await handle.close();
  }
}
async function boundedDirectoryNames(path: string, maximum: number): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of await opendir(path)) {
    if (names.push(entry.name) > maximum) throw new ControlledBackupError('LIMIT_EXCEEDED');
  }
  return names.sort();
}
async function removeOwnedTree(
  root: string,
  ownedEntries: ReadonlyMap<string, OwnedEntry>,
  rootIdentity: Stats,
): Promise<void> {
  const files: { path: string; relative: string }[] = [];
  const directories: { path: string; relative: string }[] = [];
  const pending = [{ path: root, prefix: '', depth: 0 }];
  let scanned = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for await (const entry of await opendir(current.path)) {
      if (++scanned > BACKUP_MAX_FILES + BACKUP_MAX_DIRECTORIES + 3)
        throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
      const child = join(current.path, entry.name);
      const relative = current.prefix.length === 0 ? entry.name : `${current.prefix}/${entry.name}`;
      const expected = ownedEntries.get(relative);
      const status = await lstat(child);
      const canonical = await realpath(child);
      if (
        expected === undefined ||
        status.isSymbolicLink() ||
        pathKey(child) !== pathKey(canonical) ||
        !isWithin(root, canonical) ||
        expected.dev !== status.dev ||
        expected.ino !== status.ino ||
        expected.kind !== (status.isDirectory() ? 'directory' : 'file')
      )
        throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
      if (status.isDirectory()) {
        if (current.depth >= 64) throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
        directories.push({ path: child, relative });
        pending.push({ path: child, prefix: relative, depth: current.depth + 1 });
      } else if (status.isFile()) files.push({ path: child, relative });
      else throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
    }
  }
  if (scanned !== ownedEntries.size) throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
  for (const file of files) {
    const expected = ownedEntries.get(file.relative) as OwnedEntry;
    const current = await lstat(file.path);
    if (current.dev !== expected.dev || current.ino !== expected.ino || current.nlink !== 1)
      throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
  }
  for (const file of files) {
    const expected = ownedEntries.get(file.relative) as OwnedEntry;
    const current = await lstat(file.path);
    if (current.dev !== expected.dev || current.ino !== expected.ino || current.nlink !== 1)
      throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
    await unlink(file.path);
  }
  directories.sort((left, right) => right.relative.length - left.relative.length);
  for (const directory of directories) {
    const expected = ownedEntries.get(directory.relative) as OwnedEntry;
    const current = await lstat(directory.path);
    if (current.dev !== expected.dev || current.ino !== expected.ino)
      throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
    await rmdir(directory.path);
  }
  if (!sameIdentity(rootIdentity, await lstat(root)))
    throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
  await rmdir(root);
}
async function cleanupStaging(
  parent: string,
  staging: string,
  operationId: string,
  ownedEntries: ReadonlyMap<string, OwnedEntry>,
  expectedIdentity: Stats,
): Promise<void> {
  if (dirname(resolve(staging)) !== resolve(parent) || !staging.endsWith(operationId))
    throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
  const canonical = await canonicalDirectory(staging);
  const stagingIdentity = await lstat(canonical);
  if (
    !isWithin(parent, canonical) ||
    !sameIdentity(expectedIdentity, stagingIdentity) ||
    (await readBounded(canonical, OWNER_FILE, 512)).toString('utf8') !== ownerValue(operationId)
  )
    throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
  await removeOwnedTree(canonical, ownedEntries, stagingIdentity);
}
function adapterError(error: unknown): ControlledBackupError {
  if (error instanceof ControlledBackupError) return error;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'MAINTENANCE_REQUIRED')
      return new ControlledBackupError('MAINTENANCE_REQUIRED');
    if (error.code === 'ABORTED') return new ControlledBackupError('ABORTED');
    if (error.code === 'LIMIT_EXCEEDED') return new ControlledBackupError('LIMIT_EXCEEDED');
  }
  return new ControlledBackupError('DATABASE_FAILED');
}
export function assertBackupCapacity(availableBytes: bigint, requiredBytes: number): void {
  if (
    !Number.isSafeInteger(requiredBytes) ||
    requiredBytes < 0 ||
    availableBytes < BigInt(requiredBytes + BACKUP_MAX_MANIFEST_BYTES)
  )
    throw new ControlledBackupError('INSUFFICIENT_SPACE');
}
async function managedPayloadPaths(
  database: ControlledBackupDatabaseAdapter,
  snapshotPath: string,
  signal?: AbortSignal,
): Promise<readonly (BackupManagedFileReference & { readonly payloadPath: string })[]> {
  let inventory: readonly BackupManagedFileReference[];
  try {
    inventory = await database.enumerateManagedFiles(snapshotPath, signal);
  } catch (error) {
    throw adapterError(error);
  }
  const seen = new Set<string>();
  const result = inventory.map((reference) => {
    failIfAborted(signal);
    const payloadPath = parseBackupPayloadPath(`payload/${reference.managedPath}`);
    const category = backupCategoryForPayloadPath(payloadPath);
    const key = backupWindowsPathKey(payloadPath);
    if (seen.has(key)) throw new ControlledBackupError('INTEGRITY_FAILED');
    seen.add(key);
    if (
      reference.category !== category ||
      (reference.expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(reference.expectedSha256)) ||
      (reference.expectedSizeBytes !== null &&
        (!Number.isSafeInteger(reference.expectedSizeBytes) || reference.expectedSizeBytes < 0))
    )
      throw new ControlledBackupError('INTEGRITY_FAILED');
    return { ...reference, payloadPath };
  });
  if (result.length + 1 > BACKUP_MAX_FILES) throw new ControlledBackupError('LIMIT_EXCEEDED');
  return result.sort((left, right) => (left.payloadPath < right.payloadPath ? -1 : 1));
}
async function payloadFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const result: string[] = [];
  const pending = [{ current: join(root, 'payload'), prefix: 'payload', depth: 1 }];
  let directoryCount = 1;
  while (pending.length > 0) {
    failIfAborted(signal);
    const directory = pending.pop();
    if (directory === undefined) break;
    for await (const entry of await opendir(directory.current)) {
      failIfAborted(signal);
      const relativePath = `${directory.prefix}/${entry.name}`;
      const child = join(directory.current, entry.name);
      const status = await lstat(child);
      if (
        status.isSymbolicLink() ||
        pathKey(await realpath(child)) !== pathKey(child) ||
        !isWithin(root, child)
      )
        throw new ControlledBackupError('PATH_LINK_NOT_ALLOWED');
      if (status.isDirectory()) {
        directoryCount += 1;
        if (directoryCount > BACKUP_MAX_DIRECTORIES || directory.depth >= 64)
          throw new ControlledBackupError('LIMIT_EXCEEDED');
        pending.push({ current: child, prefix: relativePath, depth: directory.depth + 1 });
      } else if (status.isFile() && status.nlink === 1)
        result.push(parseBackupPayloadPath(relativePath));
      else throw new ControlledBackupError('INTEGRITY_FAILED');
      if (result.length > BACKUP_MAX_FILES) throw new ControlledBackupError('LIMIT_EXCEEDED');
    }
  }
  return result.sort();
}
async function verifySnapshot(
  options: VerifyControlledBackupOptions,
  stagingOwner: boolean,
): Promise<{ readonly manifest: BackupManifestV1; readonly manifestSha256: string }> {
  try {
    failIfAborted(options.signal);
    const root = await canonicalDirectory(options.backupDirectory);
    const rootIdentity = await lstat(root);
    const rootEntries = await boundedDirectoryNames(root, stagingOwner ? 4 : 3);
    if (
      rootEntries.join() !==
      [...(stagingOwner ? [OWNER_FILE] : []), 'COMPLETE.json', 'manifest.json', 'payload']
        .sort()
        .join()
    )
      throw new ControlledBackupError('INTEGRITY_FAILED');
    if (stagingOwner) assertOwnerValue((await readBounded(root, OWNER_FILE, 512)).toString('utf8'));
    const manifest = parseBackupManifestV1(
      await readBounded(root, 'manifest.json', BACKUP_MAX_MANIFEST_BYTES),
    );
    const manifestText = serializeBackupManifestV1(manifest);
    const manifestHash = manifestSha256(manifestText);
    if (
      parseBackupCompleteMarkerV1(await readBounded(root, 'COMPLETE.json', 1024)).manifestSha256 !==
      manifestHash
    )
      throw new ControlledBackupError('INTEGRITY_FAILED');
    const actualPaths = await payloadFiles(root, options.signal);
    if (
      actualPaths.join('\0') !== manifest.files.map(({ relativePath }) => relativePath).join('\0')
    )
      throw new ControlledBackupError('INTEGRITY_FAILED');
    const databasePath = join(root, 'payload', 'database', 'rednote.sqlite');
    let identity: BackupDatabaseIdentity;
    try {
      identity = await options.database.inspectSnapshot(databasePath);
    } catch (error) {
      throw adapterError(error);
    }
    if (
      identity.schemaVersion !== manifest.source.schemaVersion ||
      identity.migrationFingerprint !== manifest.source.migrationFingerprint
    )
      throw new ControlledBackupError('INTEGRITY_FAILED');
    const inventory = await managedPayloadPaths(options.database, databasePath, options.signal);
    const managedManifest = manifest.files.filter(({ category }) => category !== 'DATABASE');
    if (
      inventory.map(({ payloadPath }) => payloadPath).join('\0') !==
      managedManifest.map(({ relativePath }) => relativePath).join('\0')
    )
      throw new ControlledBackupError('INTEGRITY_FAILED');
    for (const [index, reference] of inventory.entries()) {
      const file = managedManifest[index];
      if (
        file === undefined ||
        (reference.expectedSha256 !== null && reference.expectedSha256 !== file.sha256) ||
        (reference.expectedSizeBytes !== null && reference.expectedSizeBytes !== file.sizeBytes)
      )
        throw new ControlledBackupError('INTEGRITY_FAILED');
    }
    const databaseManifest = manifest.files.find(({ category }) => category === 'DATABASE');
    if (databaseManifest === undefined) throw new ControlledBackupError('INTEGRITY_FAILED');
    const proofs = new Map<string, Stats>();
    for (const file of [...managedManifest, databaseManifest]) {
      failIfAborted(options.signal);
      const actual = await hashOrCopy(root, file.relativePath, options.signal);
      if (actual.sizeBytes !== file.sizeBytes || actual.sha256 !== file.sha256)
        throw new ControlledBackupError('INTEGRITY_FAILED');
      proofs.set(file.relativePath, actual.proof);
    }
    failIfAborted(options.signal);
    const finalManifest = await readBounded(root, 'manifest.json', BACKUP_MAX_MANIFEST_BYTES);
    const finalComplete = await readBounded(root, 'COMPLETE.json', 1024);
    if (
      manifestSha256(serializeBackupManifestV1(parseBackupManifestV1(finalManifest))) !==
        manifestHash ||
      parseBackupCompleteMarkerV1(finalComplete).manifestSha256 !== manifestHash ||
      (await payloadFiles(root, options.signal)).join('\0') !== actualPaths.join('\0') ||
      (await boundedDirectoryNames(root, stagingOwner ? 4 : 3)).join() !== rootEntries.join() ||
      !sameIdentity(rootIdentity, await lstat(root))
    )
      throw new ControlledBackupError('INTEGRITY_FAILED');
    for (const [relativePath, proof] of proofs) {
      if (!sameFile(proof, (await regularFileUnder(root, relativePath)).stat))
        throw new ControlledBackupError('FILE_CHANGED');
    }
    if (
      !(await readBounded(root, 'manifest.json', BACKUP_MAX_MANIFEST_BYTES)).equals(
        finalManifest,
      ) ||
      !(await readBounded(root, 'COMPLETE.json', 1024)).equals(finalComplete)
    )
      throw new ControlledBackupError('FILE_CHANGED');
    return Object.freeze({ manifest, manifestSha256: manifestHash });
  } catch (error) {
    if (error instanceof ControlledBackupError) throw error;
    throw new ControlledBackupError('INTEGRITY_FAILED');
  }
}
export function verifyControlledBackupSnapshot(
  options: VerifyControlledBackupOptions,
): Promise<{ readonly manifest: BackupManifestV1; readonly manifestSha256: string }> {
  return verifySnapshot(options, false);
}
export async function createControlledBackupSnapshot(
  options: CreateControlledBackupOptions,
): Promise<ControlledBackupResult> {
  const operationId = (options.randomId ?? randomUUID)();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(operationId)
  )
    throw new ControlledBackupError('INVALID_PATH');
  const sourceRoot = await canonicalDirectory(options.root.rootPath);
  const backupRoot = await canonicalDirectory(options.selectedBackupRoot);
  if (isWithin(sourceRoot, backupRoot) || isWithin(backupRoot, sourceRoot))
    throw new ControlledBackupError('PATH_CONFLICT');
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const stagingName = `.rednote-backup-staging-v1-${operationId}`;
  const staging = join(backupRoot, stagingName);
  const backupName = `rednote-backup-v1-${createdAt.replaceAll('-', '').replaceAll(':', '')}-${operationId.replaceAll('-', '').slice(0, 12)}`;
  const final = join(backupRoot, backupName);
  const sourceIdentity = await lstat(sourceRoot).catch(() => {
    throw new ControlledBackupError('INVALID_PATH');
  });
  const backupIdentity = await lstat(backupRoot).catch(() => {
    throw new ControlledBackupError('INVALID_PATH');
  });
  const ownedEntries: OwnedEntries = new Map();
  let stagingCreated = false;
  let stagingIdentity: Stats | undefined;
  let ownerWritten = false;
  let ownerRemoved = false;
  let published = false;
  try {
    failIfAborted(options.signal);
    let estimatedSnapshotBytes: number;
    try {
      estimatedSnapshotBytes = await options.database.estimateSnapshotBytes();
    } catch (error) {
      throw adapterError(error);
    }
    if (
      !Number.isSafeInteger(estimatedSnapshotBytes) ||
      estimatedSnapshotBytes < 1 ||
      estimatedSnapshotBytes > BACKUP_MAX_FILE_BYTES
    )
      throw new ControlledBackupError('LIMIT_EXCEEDED');
    const preflightBytes = estimatedSnapshotBytes * 3;
    if (!Number.isSafeInteger(preflightBytes) || preflightBytes > BACKUP_MAX_TOTAL_BYTES)
      throw new ControlledBackupError('LIMIT_EXCEEDED');
    const initialAvailable = await statfs(backupRoot, { bigint: true });
    assertBackupCapacity(initialAvailable.bavail * initialAvailable.bsize, preflightBytes);
    await assertDirectoryBinding(sourceRoot, sourceIdentity);
    await assertDirectoryBinding(backupRoot, backupIdentity);
    try {
      await lstat(final);
      throw new ControlledBackupError('ALREADY_EXISTS');
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error;
    }
    await mkdir(staging);
    stagingCreated = true;
    stagingIdentity = await lstat(staging);
    await writeExclusive(join(staging, OWNER_FILE), ownerValue(operationId), (stat) =>
      ownedEntries.set(OWNER_FILE, { dev: stat.dev, ino: stat.ino, kind: 'file' }),
    );
    ownerWritten = true;
    await ensureDirectories(staging, 'payload/database', ownedEntries);
    const snapshotPath = join(staging, 'payload', 'database', 'rednote.sqlite');
    let databaseIdentity: BackupDatabaseIdentity;
    try {
      databaseIdentity = await options.database.createSnapshot(snapshotPath, options.signal);
    } catch (error) {
      throw adapterError(error);
    }
    const databaseFile = await regularFileUnder(staging, 'payload/database/rednote.sqlite');
    ownedEntries.set('payload/database/rednote.sqlite', {
      dev: databaseFile.stat.dev,
      ino: databaseFile.stat.ino,
      kind: 'file',
    });
    await assertDirectoryBinding(backupRoot, backupIdentity);
    await assertDirectoryBinding(staging, stagingIdentity);
    const managed = await managedPayloadPaths(options.database, snapshotPath, options.signal);
    const databaseStat = databaseFile.stat;
    let expectedBytes = databaseStat.size;
    for (const item of managed) {
      await assertDirectoryBinding(sourceRoot, sourceIdentity);
      const source = await regularFileUnder(sourceRoot, item.managedPath);
      expectedBytes += source.stat.size;
      if (source.stat.size > BACKUP_MAX_FILE_BYTES || expectedBytes > BACKUP_MAX_TOTAL_BYTES)
        throw new ControlledBackupError('LIMIT_EXCEEDED');
    }
    const available = await statfs(backupRoot, { bigint: true });
    assertBackupCapacity(available.bavail * available.bsize, expectedBytes);
    const databaseHash = await hashOrCopy(
      staging,
      'payload/database/rednote.sqlite',
      options.signal,
    );
    const files: BackupManifestFileV1[] = [
      {
        category: 'DATABASE',
        relativePath: parseBackupPayloadPath('payload/database/rednote.sqlite', 'DATABASE'),
        sha256: databaseHash.sha256,
        sizeBytes: databaseHash.sizeBytes,
      },
    ];
    for (const item of managed) {
      failIfAborted(options.signal);
      await assertDirectoryBinding(sourceRoot, sourceIdentity);
      await ensureDirectories(
        staging,
        dirname(item.payloadPath).split(sep).join('/'),
        ownedEntries,
      );
      const destination = join(staging, ...item.payloadPath.split('/'));
      const copied = await hashOrCopy(
        sourceRoot,
        item.managedPath,
        options.signal,
        destination,
        (stat) =>
          ownedEntries.set(item.payloadPath, {
            dev: stat.dev,
            ino: stat.ino,
            kind: 'file',
          }),
      );
      if (
        (item.expectedSha256 !== null && copied.sha256 !== item.expectedSha256) ||
        (item.expectedSizeBytes !== null && copied.sizeBytes !== item.expectedSizeBytes)
      )
        throw new ControlledBackupError('INTEGRITY_FAILED');
      await assertDirectoryBinding(sourceRoot, sourceIdentity);
      files.push({
        category: item.category,
        relativePath: parseBackupPayloadPath(item.payloadPath, item.category),
        sha256: copied.sha256,
        sizeBytes: copied.sizeBytes,
      });
    }
    files.sort((left, right) => (left.relativePath < right.relativePath ? -1 : 1));
    const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const manifest: BackupManifestV1 = {
      format: 'rednote-controlled-directory-backup',
      backupFormatVersion: 1,
      status: 'COMPLETE',
      createdAt,
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
      totals: { fileCount: files.length, sizeBytes: totalBytes },
    };
    const manifestText = serializeBackupManifestV1(manifest);
    const manifestHash = manifestSha256(manifestText);
    await writeExclusive(join(staging, 'manifest.json'), manifestText, (stat) =>
      ownedEntries.set('manifest.json', { dev: stat.dev, ino: stat.ino, kind: 'file' }),
    );
    await writeExclusive(
      join(staging, 'COMPLETE.json'),
      serializeBackupCompleteMarkerV1(manifestHash),
      (stat) => ownedEntries.set('COMPLETE.json', { dev: stat.dev, ino: stat.ino, kind: 'file' }),
    );
    await verifySnapshot(
      {
        backupDirectory: staging,
        database: options.database,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      true,
    );
    failIfAborted(options.signal);
    await assertDirectoryBinding(backupRoot, backupIdentity);
    await assertDirectoryBinding(staging, stagingIdentity);
    const stagingSynced = await syncDirectory(staging);
    try {
      await lstat(final);
      throw new ControlledBackupError('ALREADY_EXISTS');
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error;
    }
    const finalOwner = await regularFileUnder(staging, OWNER_FILE);
    const expectedOwner = ownedEntries.get(OWNER_FILE);
    if (
      expectedOwner === undefined ||
      expectedOwner.dev !== finalOwner.stat.dev ||
      expectedOwner.ino !== finalOwner.stat.ino
    )
      throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
    await unlink(finalOwner.path);
    ownedEntries.delete(OWNER_FILE);
    ownerRemoved = true;
    failIfAborted(options.signal);
    try {
      await rename(staging, final);
    } catch (error) {
      let finalExists = true;
      try {
        await lstat(final);
      } catch {
        finalExists = false;
      }
      if (finalExists || isErrno(error, 'EEXIST') || isErrno(error, 'ENOTEMPTY'))
        throw new ControlledBackupError('ALREADY_EXISTS');
      throw new ControlledBackupError('PUBLISH_FAILED');
    }
    published = true;
    const finalSynced = await syncDirectory(final);
    const parentSynced = await syncDirectory(backupRoot);
    return Object.freeze({
      backupName,
      durability:
        stagingSynced && finalSynced && parentSynced
          ? 'SYNC_REQUESTS_COMPLETED'
          : 'DIRECTORY_SYNC_UNAVAILABLE',
      manifestSha256: manifestHash,
      operationId,
      totals: Object.freeze({ fileCount: files.length, sizeBytes: totalBytes }),
    });
  } catch (error) {
    if (stagingCreated && !published) {
      try {
        if (ownerRemoved) {
          await writeExclusive(join(staging, OWNER_FILE), ownerValue(operationId), (stat) =>
            ownedEntries.set(OWNER_FILE, { dev: stat.dev, ino: stat.ino, kind: 'file' }),
          );
          ownerWritten = true;
          ownerRemoved = false;
        }
        if (ownerWritten && stagingIdentity !== undefined)
          await cleanupStaging(backupRoot, staging, operationId, ownedEntries, stagingIdentity);
        else if (!ownerWritten) {
          if (stagingIdentity === undefined || !sameIdentity(stagingIdentity, await lstat(staging)))
            throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
          await rmdir(staging);
        } else throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
      } catch {
        throw new ControlledBackupError('STAGING_OWNERSHIP_INVALID');
      }
    }
    if (published) throw new ControlledBackupError('PUBLISHED_DURABILITY_UNKNOWN');
    if (error instanceof ControlledBackupError) throw error;
    throw new ControlledBackupError('COPY_FAILED');
  }
}
