import { randomUUID } from 'node:crypto';
import {
  constants,
  type Dirent,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import { type ManagedRelativePath, StorageError } from '@mystery-operations/shared/storage';

import { resolveManagedPath } from './managed-path.js';

export const DATA_ROOT_FORMAT = 'rednote-project-data';
export const DATA_ROOT_FORMAT_VERSION = 1;
export const DATA_ROOT_MARKER_FILE = '.rednote-data-root.json';

export const REQUIRED_DATA_DIRECTORIES = Object.freeze([
  'database',
  'sources',
  'sources/snapshots',
  'sources/screenshots',
  'photos',
  'photos/originals',
  'photos/processed',
  'generated-images',
  'exports',
  'imports',
  'backups',
  'backups/database',
  'logs',
] as const);

export interface DataRootMarker {
  readonly createdAt: string;
  readonly format: typeof DATA_ROOT_FORMAT;
  readonly instanceId: string;
  readonly version: typeof DATA_ROOT_FORMAT_VERSION;
}

export interface ProjectDataRootOptions {
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function rootLockKey(rootPath: string): string {
  const resolved = resolve(rootPath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

const rootLocks = new Map<string, Promise<void>>();

async function withRootLock<T>(rootPath: string, operation: () => Promise<T>): Promise<T> {
  const key = rootLockKey(rootPath);
  const previous = rootLocks.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  rootLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (rootLocks.get(key) === current) {
      rootLocks.delete(key);
    }
  }
}

function assertValidRootPath(rootPath: string): string {
  if (
    rootPath.trim().length === 0 ||
    !isAbsolute(rootPath) ||
    rootPath.includes('\u0000') ||
    hasControlCharacters(rootPath) ||
    /^(?:\\\\[?.]\\|\\\\)/u.test(rootPath)
  ) {
    throw new StorageError('ROOT_PATH_INVALID');
  }

  const resolved = resolve(rootPath);
  if (resolved === parse(resolved).root) {
    throw new StorageError('ROOT_IS_FILESYSTEM_ROOT');
  }
  return resolved;
}

function assertDirectoryWithoutLink(path: string): void {
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    throw new StorageError('ROOT_PATH_INVALID', { cause: error });
  }
  if (status.isSymbolicLink()) {
    throw new StorageError('PATH_LINK_NOT_ALLOWED');
  }
  if (!status.isDirectory()) {
    throw new StorageError('ROOT_LAYOUT_CONFLICT');
  }
}

function isRootMarker(value: unknown): value is DataRootMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const marker = value as Record<string, unknown>;
  let canonicalCreatedAt = false;
  if (typeof marker.createdAt === 'string') {
    try {
      canonicalCreatedAt = new Date(marker.createdAt).toISOString() === marker.createdAt;
    } catch {
      canonicalCreatedAt = false;
    }
  }
  return (
    Object.keys(marker).sort().join(',') === 'createdAt,format,instanceId,version' &&
    marker.format === DATA_ROOT_FORMAT &&
    marker.version === DATA_ROOT_FORMAT_VERSION &&
    typeof marker.instanceId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      marker.instanceId,
    ) &&
    canonicalCreatedAt
  );
}

function readMarker(rootPath: string): DataRootMarker {
  const markerPath = join(rootPath, DATA_ROOT_MARKER_FILE);
  let status;
  try {
    status = lstatSync(markerPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      throw new StorageError('ROOT_NOT_OWNED');
    }
    throw new StorageError('ROOT_FORMAT_UNSUPPORTED', { cause: error });
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new StorageError('ROOT_LAYOUT_CONFLICT');
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(markerPath, 'utf8')) as unknown;
  } catch (error) {
    throw new StorageError('ROOT_FORMAT_UNSUPPORTED', { cause: error });
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'format' in value &&
    (value as { readonly format?: unknown }).format !== DATA_ROOT_FORMAT
  ) {
    throw new StorageError('ROOT_FORMAT_UNSUPPORTED');
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    (value as { readonly version?: unknown }).version !== DATA_ROOT_FORMAT_VERSION
  ) {
    throw new StorageError('ROOT_FORMAT_UNSUPPORTED');
  }
  if (!isRootMarker(value)) {
    throw new StorageError('ROOT_FORMAT_UNSUPPORTED');
  }
  return value;
}

function writeNewMarker(rootPath: string, marker: DataRootMarker): DataRootMarker {
  const markerPath = join(rootPath, DATA_ROOT_MARKER_FILE);
  const temporaryPath = join(rootPath, `.rednote-marker-${randomUUID()}.tmp`);
  let handle: number | undefined;
  try {
    handle = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    writeFileSync(handle, `${JSON.stringify(marker)}\n`, 'utf8');
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    try {
      linkSync(temporaryPath, markerPath);
    } catch (error) {
      if (isErrno(error, 'EEXIST')) {
        unlinkSync(temporaryPath);
        return readMarker(rootPath);
      }
      throw error;
    }
    unlinkSync(temporaryPath);
    return marker;
  } catch (error) {
    if (handle !== undefined) {
      closeSync(handle);
    }
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Only the exact application-owned temporary marker is eligible for cleanup.
    }
    throw new StorageError('WRITE_FAILED', { cause: error });
  }
}

function directoryEntries(rootPath: string): readonly Dirent[] {
  try {
    return readdirSync(rootPath, { withFileTypes: true });
  } catch (error) {
    throw new StorageError('ROOT_PATH_INVALID', { cause: error });
  }
}

function createAndValidateLayout(rootPath: string): void {
  for (const relativeDirectory of REQUIRED_DATA_DIRECTORIES) {
    const directoryPath = join(rootPath, ...relativeDirectory.split('/'));
    try {
      mkdirSync(directoryPath);
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) {
        throw new StorageError('ROOT_LAYOUT_CONFLICT', { cause: error });
      }
    }
    assertDirectoryWithoutLink(directoryPath);
  }
}

function probeLongPathCapability(rootPath: string): void {
  const probeRoot = join(rootPath, `.rednote-path-probe-${randomUUID()}`);
  const createdDirectories: string[] = [];
  let probeFile: string | undefined;
  try {
    mkdirSync(probeRoot);
    createdDirectories.push(probeRoot);
    let current = probeRoot;
    let index = 0;
    while (current.length < 285) {
      current = join(current, `${String(index).padStart(2, '0')}-${'路'.repeat(40)}`);
      mkdirSync(current);
      createdDirectories.push(current);
      index += 1;
    }
    probeFile = join(current, '能力 probe.txt');
    const handle = openSync(
      probeFile,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      writeFileSync(handle, 'ok', 'utf8');
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    unlinkSync(probeFile);
    probeFile = undefined;
    for (const directory of [...createdDirectories].reverse()) {
      rmdirSync(directory);
    }
  } catch (error) {
    if (probeFile !== undefined) {
      try {
        unlinkSync(probeFile);
      } catch {
        // Exact probe cleanup is best effort after a capability failure.
      }
    }
    for (const directory of [...createdDirectories].reverse()) {
      try {
        rmdirSync(directory);
      } catch {
        // Exact probe cleanup is best effort after a capability failure.
      }
    }
    throw new StorageError('PATH_CAPABILITY_UNSUPPORTED', { cause: error });
  }
}

function assertRootIdentity(rootPath: string): void {
  const canonical = realpathSync.native(rootPath);
  const fromRoot = relative(rootPath, canonical);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new StorageError('PATH_LINK_NOT_ALLOWED');
  }
}

export class ProjectDataRoot {
  public readonly marker: DataRootMarker;
  public readonly rootPath: string;

  public constructor(rootPath: string, marker: DataRootMarker) {
    this.rootPath = rootPath;
    this.marker = marker;
  }

  public get backupDatabaseDirectory(): string {
    return join(this.rootPath, 'backups', 'database');
  }

  public get databaseDirectory(): string {
    return join(this.rootPath, 'database');
  }

  public resolve(path: ManagedRelativePath): string {
    return resolveManagedPath(this.rootPath, path);
  }
}

async function initializeOrOpen(
  rootPath: string,
  options: ProjectDataRootOptions,
  allowInitialize: boolean,
): Promise<ProjectDataRoot> {
  const resolvedRoot = assertValidRootPath(rootPath);
  return withRootLock(resolvedRoot, async () => {
    let createdRoot = false;
    try {
      try {
        const existed = existsSync(resolvedRoot);
        mkdirSync(resolvedRoot, { recursive: true });
        createdRoot = !existed;
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) {
          throw new StorageError('ROOT_PATH_INVALID', { cause: error });
        }
      }
      assertDirectoryWithoutLink(resolvedRoot);
      assertRootIdentity(resolvedRoot);

      const markerPath = join(resolvedRoot, DATA_ROOT_MARKER_FILE);
      let marker: DataRootMarker;
      try {
        marker = readMarker(resolvedRoot);
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== 'ROOT_NOT_OWNED') {
          throw error;
        }
        if (!allowInitialize || directoryEntries(resolvedRoot).length > 0) {
          throw error;
        }
        probeLongPathCapability(resolvedRoot);
        marker = Object.freeze({
          createdAt: (options.now ?? (() => new Date()))().toISOString(),
          format: DATA_ROOT_FORMAT,
          instanceId: (options.randomId ?? randomUUID)(),
          version: DATA_ROOT_FORMAT_VERSION,
        });
        marker = writeNewMarker(resolvedRoot, marker);
      }

      if (!lstatSync(markerPath).isFile()) {
        throw new StorageError('ROOT_LAYOUT_CONFLICT');
      }
      probeLongPathCapability(resolvedRoot);
      createAndValidateLayout(resolvedRoot);
      return new ProjectDataRoot(resolvedRoot, marker);
    } catch (error) {
      if (createdRoot) {
        try {
          rmdirSync(resolvedRoot);
        } catch {
          // A created root containing a valid marker or user data is never recursively removed.
        }
      }
      throw error;
    }
  });
}

export async function initializeProjectDataRoot(
  rootPath: string,
  options: ProjectDataRootOptions = {},
): Promise<ProjectDataRoot> {
  return initializeOrOpen(rootPath, options, true);
}

export async function openProjectDataRoot(
  rootPath: string,
  options: ProjectDataRootOptions = {},
): Promise<ProjectDataRoot> {
  return initializeOrOpen(rootPath, options, false);
}

export function assertManagedAncestorsWithoutLinks(
  root: ProjectDataRoot,
  path: ManagedRelativePath,
  options: { readonly allowMissingLeaf: boolean },
): void {
  const segments = path.split('/');
  let current = root.rootPath;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let status;
    try {
      status = lstatSync(current);
    } catch (error) {
      if (isErrno(error, 'ENOENT') && options.allowMissingLeaf) {
        return;
      }
      if (isErrno(error, 'ENOENT')) {
        throw new StorageError('FILE_MISSING');
      }
      throw new StorageError('PATH_INVALID', { cause: error });
    }
    if (status.isSymbolicLink()) {
      throw new StorageError('PATH_LINK_NOT_ALLOWED');
    }
    if (index < segments.length - 1 && !status.isDirectory()) {
      throw new StorageError('ROOT_LAYOUT_CONFLICT');
    }
  }
}
