import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, lstatSync, type ReadStream, type Stats } from 'node:fs';
import { lstat, mkdir, open, stat, unlink, link } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, sep } from 'node:path';
import { Readable } from 'node:stream';

import {
  CATEGORY_DIRECTORY,
  type FileCategory,
  formatManagedRelativePath,
  type ManagedRelativePath,
  managedPathForContent,
  parseManagedRelativePath,
  sanitizeFileName,
  StorageError,
} from '@mystery-operations/shared/storage';

import { assertManagedAncestorsWithoutLinks, type ProjectDataRoot } from './project-data-root.js';

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_OPERATIONS = 4;
const DEFAULT_PUBLISH_RETRIES = 3;
const TEMPORARY_FILE_PREFIX = '.rednote-tmp-';

type StreamSource = AsyncIterable<Uint8Array | string>;

export interface FileDescriptor {
  readonly category: FileCategory;
  readonly createdAt: string;
  readonly managedPath: ManagedRelativePath;
  readonly sanitizedDisplayName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly storageName: string;
}

export interface ManagedFileStat {
  readonly managedPath: ManagedRelativePath;
  readonly modifiedAt: string;
  readonly sizeBytes: number;
}

export interface PutFileOptions {
  readonly category: FileCategory;
  readonly displayName: string;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface VerifyManagedFileOptions {
  readonly expectedSha256: string;
  readonly expectedSizeBytes: number;
  readonly signal?: AbortSignal;
}

interface StagedFile {
  readonly category: FileCategory;
  readonly createdAt: string;
  readonly displayName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly temporaryPath: string;
}

export interface LocalFileRepositoryOptions {
  readonly beforeIngestSourceVerification?: () => Promise<void>;
  readonly maximumConcurrentOperations?: number;
  readonly now?: () => Date;
  readonly publishLink?: (temporaryPath: string, targetPath: string) => Promise<void>;
  readonly publishRetryCount?: number;
  readonly randomId?: () => string;
  readonly retryDelay?: (milliseconds: number) => Promise<void>;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new StorageError('WRITE_ABORTED');
  }
}

function validateMaximumBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StorageError('FILE_TOO_LARGE');
  }
  return value;
}

function asBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

async function assertExternalPathWithoutLinks(path: string): Promise<void> {
  const root = parse(path).root;
  const segments = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let status;
    try {
      status = await lstat(current);
    } catch (error) {
      throw new StorageError(isErrno(error, 'ENOENT') ? 'FILE_MISSING' : 'PATH_INVALID', {
        cause: error,
      });
    }
    if (status.isSymbolicLink()) {
      throw new StorageError('PATH_LINK_NOT_ALLOWED');
    }
  }
}

async function removeExactTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) {
      throw error;
    }
  }
}

class OperationGate {
  readonly #maximum: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  public constructor(maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64) {
      throw new RangeError('maximumConcurrentOperations must be between 1 and 64.');
    }
    this.#maximum = maximum;
  }

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#maximum) {
      await new Promise<void>((resolveWait) => {
        this.#waiting.push(resolveWait);
      });
    }
    this.#active += 1;
    try {
      return await operation();
    } finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
  }
}

export class LocalFileRepository {
  readonly #gate: OperationGate;
  readonly #beforeIngestSourceVerification: () => Promise<void>;
  readonly #now: () => Date;
  readonly #publishLink: (temporaryPath: string, targetPath: string) => Promise<void>;
  readonly #publishRetryCount: number;
  readonly #randomId: () => string;
  readonly #retryDelay: (milliseconds: number) => Promise<void>;
  readonly #root: ProjectDataRoot;

  public constructor(root: ProjectDataRoot, options: LocalFileRepositoryOptions = {}) {
    this.#root = root;
    this.#beforeIngestSourceVerification =
      options.beforeIngestSourceVerification ?? (async () => undefined);
    this.#gate = new OperationGate(
      options.maximumConcurrentOperations ?? DEFAULT_MAX_CONCURRENT_OPERATIONS,
    );
    this.#now = options.now ?? (() => new Date());
    this.#publishLink = options.publishLink ?? link;
    this.#publishRetryCount = options.publishRetryCount ?? DEFAULT_PUBLISH_RETRIES;
    this.#randomId = options.randomId ?? randomUUID;
    this.#retryDelay =
      options.retryDelay ??
      (async (milliseconds) => {
        await new Promise<void>((resolveDelay) => {
          setTimeout(resolveDelay, milliseconds);
        });
      });

    if (
      !Number.isSafeInteger(this.#publishRetryCount) ||
      this.#publishRetryCount < 0 ||
      this.#publishRetryCount > 10
    ) {
      throw new RangeError('publishRetryCount must be between 0 and 10.');
    }
  }

  public async putBuffer(content: Uint8Array, options: PutFileOptions): Promise<FileDescriptor> {
    return this.putStream(Readable.from([content]), {
      ...options,
      maxBytes: options.maxBytes ?? content.byteLength,
    });
  }

  public async putStream(source: StreamSource, options: PutFileOptions): Promise<FileDescriptor> {
    return this.#gate.run(async () => {
      const staged = await this.#stageStream(source, options);
      return this.#publish(staged, options.signal);
    });
  }

  public async ingestExternalFile(
    sourcePath: string,
    options: PutFileOptions,
  ): Promise<FileDescriptor> {
    return this.#gate.run(async () => {
      if (
        !isAbsolute(sourcePath) ||
        /^(?:\\\\[?.]\\|\\\\)/u.test(sourcePath) ||
        /^[a-z]:[^\\/]/iu.test(sourcePath)
      ) {
        throw new StorageError('PATH_INVALID');
      }

      await assertExternalPathWithoutLinks(sourcePath);
      let before;
      try {
        before = await lstat(sourcePath);
      } catch (error) {
        throw new StorageError(isErrno(error, 'ENOENT') ? 'FILE_MISSING' : 'PATH_INVALID', {
          cause: error,
        });
      }
      if (before.isSymbolicLink()) {
        throw new StorageError('PATH_LINK_NOT_ALLOWED');
      }
      if (!before.isFile()) {
        throw new StorageError('FILE_TYPE_NOT_REGULAR');
      }

      const input = createReadStream(sourcePath, { flags: 'r' });
      let staged: StagedFile | undefined;
      try {
        staged = await this.#stageStream(input, options);
        await this.#beforeIngestSourceVerification();
        const after = await stat(sourcePath);
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          (before.ino !== 0 && after.ino !== before.ino) ||
          after.dev !== before.dev
        ) {
          throw new StorageError('FILE_CHANGED_DURING_COPY');
        }
        return await this.#publish(staged, options.signal);
      } catch (error) {
        input.destroy();
        if (staged !== undefined) {
          try {
            await removeExactTemporaryFile(staged.temporaryPath);
          } catch {
            // Preserve the original, already-sanitized failure.
          }
        }
        throw error;
      }
    });
  }

  public openReadStream(path: ManagedRelativePath): ReadStream {
    const parsed = parseManagedRelativePath(formatManagedRelativePath(path));
    assertManagedAncestorsWithoutLinks(this.#root, parsed, { allowMissingLeaf: false });
    const absolutePath = this.#root.resolve(parsed);
    const status = statSyncSafe(absolutePath);
    if (!status.isFile()) {
      throw new StorageError('FILE_TYPE_NOT_REGULAR');
    }
    return createReadStream(absolutePath, { flags: 'r' });
  }

  public async statManagedFile(path: ManagedRelativePath): Promise<ManagedFileStat> {
    const parsed = parseManagedRelativePath(formatManagedRelativePath(path));
    assertManagedAncestorsWithoutLinks(this.#root, parsed, { allowMissingLeaf: false });
    const absolutePath = this.#root.resolve(parsed);
    let fileStatus;
    try {
      fileStatus = await lstat(absolutePath);
    } catch (error) {
      throw new StorageError(isErrno(error, 'ENOENT') ? 'FILE_MISSING' : 'PATH_INVALID', {
        cause: error,
      });
    }
    if (fileStatus.isSymbolicLink()) {
      throw new StorageError('PATH_LINK_NOT_ALLOWED');
    }
    if (!fileStatus.isFile()) {
      throw new StorageError('FILE_TYPE_NOT_REGULAR');
    }
    if (!Number.isSafeInteger(fileStatus.size)) {
      throw new StorageError('FILE_TOO_LARGE');
    }
    return {
      managedPath: parsed,
      modifiedAt: fileStatus.mtime.toISOString(),
      sizeBytes: fileStatus.size,
    };
  }

  public async verifyManagedFile(
    path: ManagedRelativePath,
    options: VerifyManagedFileOptions,
  ): Promise<FileDescriptor> {
    const parsed = parseManagedRelativePath(formatManagedRelativePath(path));
    const fileStatus = await this.statManagedFile(parsed);
    if (
      !Number.isSafeInteger(options.expectedSizeBytes) ||
      options.expectedSizeBytes < 0 ||
      !/^[a-f0-9]{64}$/u.test(options.expectedSha256)
    ) {
      throw new StorageError('PATH_INVALID');
    }
    const digest = createHash('sha256');
    let actualSize = 0;
    const stream = this.openReadStream(parsed);
    try {
      for await (const chunk of stream) {
        throwIfAborted(options.signal);
        const bytes = asBytes(chunk as Uint8Array | string);
        actualSize += bytes.byteLength;
        if (!Number.isSafeInteger(actualSize)) {
          throw new StorageError('FILE_TOO_LARGE');
        }
        digest.update(bytes);
      }
    } catch (error) {
      stream.destroy();
      throw error;
    }
    const actualHash = digest.digest('hex');
    if (
      fileStatus.sizeBytes !== options.expectedSizeBytes ||
      actualSize !== options.expectedSizeBytes ||
      actualHash !== options.expectedSha256
    ) {
      throw new StorageError('FILE_INTEGRITY_MISMATCH');
    }
    const category = categoryFromManagedPath(parsed);
    return {
      category,
      createdAt: fileStatus.modifiedAt,
      managedPath: parsed,
      sanitizedDisplayName: parsed.split('/').at(-1) ?? actualHash,
      sha256: actualHash,
      sizeBytes: actualSize,
      storageName: parsed.split('/').at(-1) ?? actualHash,
    };
  }

  async #stageStream(source: StreamSource, options: PutFileOptions): Promise<StagedFile> {
    const maximumBytes = validateMaximumBytes(options.maxBytes ?? DEFAULT_MAX_BYTES);
    const displayName = sanitizeFileName(options.displayName);
    const categoryDirectory = join(
      this.#root.rootPath,
      ...CATEGORY_DIRECTORY[options.category].split('/'),
    );
    const temporaryPath = join(
      categoryDirectory,
      `${TEMPORARY_FILE_PREFIX}${this.#randomId()}.partial`,
    );
    let handle;
    let sizeBytes = 0;
    const digest = createHash('sha256');
    const abortReadable =
      typeof source === 'object' &&
      source !== null &&
      'destroy' in source &&
      typeof source.destroy === 'function'
        ? (): void => {
            (source as { destroy: (error: Error) => void }).destroy(new Error('aborted'));
          }
        : undefined;
    const abortListener = (): void => {
      abortReadable?.();
    };

    throwIfAborted(options.signal);
    options.signal?.addEventListener('abort', abortListener, { once: true });
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      for await (const value of source) {
        throwIfAborted(options.signal);
        const bytes = asBytes(value);
        sizeBytes += bytes.byteLength;
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes > maximumBytes) {
          throw new StorageError('FILE_TOO_LARGE');
        }
        digest.update(bytes);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const result = await handle.write(bytes, offset, bytes.byteLength - offset, null);
          offset += result.bytesWritten;
        }
      }
      throwIfAborted(options.signal);
      await handle.sync();
      await handle.close();
      handle = undefined;
      return {
        category: options.category,
        createdAt: this.#now().toISOString(),
        displayName,
        sha256: digest.digest('hex'),
        sizeBytes,
        temporaryPath,
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      try {
        await removeExactTemporaryFile(temporaryPath);
      } catch {
        // Preserve the original, already-sanitized failure.
      }
      if (error instanceof StorageError) {
        throw error;
      }
      if (options.signal?.aborted === true) {
        throw new StorageError('WRITE_ABORTED', { cause: error });
      }
      throw new StorageError('WRITE_FAILED', { cause: error });
    } finally {
      options.signal?.removeEventListener('abort', abortListener);
    }
  }

  async #publish(staged: StagedFile, signal: AbortSignal | undefined): Promise<FileDescriptor> {
    const managedPath = managedPathForContent(staged.category, staged.sha256);
    const targetPath = this.#root.resolve(managedPath);
    const targetDirectory = dirname(targetPath);
    await mkdir(targetDirectory, { recursive: false }).catch((error: unknown) => {
      if (!isErrno(error, 'EEXIST')) {
        throw new StorageError('WRITE_FAILED', { cause: error });
      }
    });
    assertManagedAncestorsWithoutLinks(this.#root, managedPath, { allowMissingLeaf: true });

    let publishTemporaryPath: string | undefined;
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = join(
          targetDirectory,
          `${TEMPORARY_FILE_PREFIX}${this.#randomId()}.ready`,
        );
        try {
          await link(staged.temporaryPath, candidate);
          publishTemporaryPath = candidate;
          break;
        } catch (error) {
          if (!isErrno(error, 'EEXIST') || attempt === 3) {
            throw error;
          }
        }
      }
      if (publishTemporaryPath === undefined) {
        throw new Error('An exclusive publish temporary file could not be created.');
      }
      await removeExactTemporaryFile(staged.temporaryPath);
    } catch (error) {
      if (publishTemporaryPath !== undefined) {
        await removeExactTemporaryFile(publishTemporaryPath).catch(() => undefined);
      }
      await removeExactTemporaryFile(staged.temporaryPath).catch(() => undefined);
      throw new StorageError('WRITE_FAILED', { cause: error });
    }

    try {
      throwIfAborted(signal);
      let attempt = 0;
      while (true) {
        try {
          await this.#publishLink(publishTemporaryPath, targetPath);
          break;
        } catch (error) {
          if (isErrno(error, 'EEXIST')) {
            await this.#assertExistingMatches(targetPath, staged);
            break;
          }
          if (
            attempt >= this.#publishRetryCount ||
            !['EACCES', 'EBUSY', 'EPERM'].some((code) => isErrno(error, code))
          ) {
            throw new StorageError('WRITE_FAILED', { cause: error });
          }
          attempt += 1;
          await this.#retryDelay(attempt * 10);
          throwIfAborted(signal);
        }
      }
      await removeExactTemporaryFile(publishTemporaryPath);
      return {
        category: staged.category,
        createdAt: staged.createdAt,
        managedPath,
        sanitizedDisplayName: staged.displayName,
        sha256: staged.sha256,
        sizeBytes: staged.sizeBytes,
        storageName: staged.sha256,
      };
    } catch (error) {
      try {
        await removeExactTemporaryFile(publishTemporaryPath);
      } catch {
        // Preserve the original, already-sanitized failure.
      }
      throw error;
    }
  }

  async #assertExistingMatches(targetPath: string, staged: StagedFile): Promise<void> {
    let fileStatus;
    try {
      fileStatus = await lstat(targetPath);
    } catch (error) {
      throw new StorageError('WRITE_FAILED', { cause: error });
    }
    if (fileStatus.isSymbolicLink()) {
      throw new StorageError('PATH_LINK_NOT_ALLOWED');
    }
    if (!fileStatus.isFile() || fileStatus.size !== staged.sizeBytes) {
      throw new StorageError('FILE_ALREADY_EXISTS_CONFLICT');
    }

    const digest = createHash('sha256');
    const input = createReadStream(targetPath, { flags: 'r' });
    try {
      for await (const chunk of input) {
        digest.update(asBytes(chunk as Uint8Array | string));
      }
    } catch (error) {
      input.destroy();
      throw new StorageError('WRITE_FAILED', { cause: error });
    }
    if (digest.digest('hex') !== staged.sha256) {
      throw new StorageError('FILE_ALREADY_EXISTS_CONFLICT');
    }
  }
}

function categoryFromManagedPath(path: ManagedRelativePath): FileCategory {
  const value = formatManagedRelativePath(path);
  for (const [category, directory] of Object.entries(CATEGORY_DIRECTORY) as Array<
    [FileCategory, string]
  >) {
    if (value.startsWith(`${directory}/`)) {
      return category;
    }
  }
  throw new StorageError('PATH_INVALID');
}

function statSyncSafe(path: string): Stats {
  try {
    return lstatSync(path) as Stats;
  } catch (error) {
    throw new StorageError(isErrno(error, 'ENOENT') ? 'FILE_MISSING' : 'PATH_INVALID', {
      cause: error,
    });
  }
}
