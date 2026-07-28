import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import {
  type ManagedRelativePath,
  parseManagedRelativePath,
  StorageError,
} from '@mystery-operations/shared/storage';

import { LocalFileRepository, type FileDescriptor } from './local-file-repository.js';
import { assertManagedAncestorsWithoutLinks, type ProjectDataRoot } from './project-data-root.js';

export const MODEL_RESULT_CACHE_FORMAT = 'rednote-model-result-cache';
export const MODEL_RESULT_CACHE_FORMAT_VERSION = 1;
export const DEFAULT_MODEL_CACHE_ENTRY_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MODEL_CACHE_TOTAL_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MODEL_CACHE_MAX_ENTRIES = 10_000;

export type ModelCacheOutputType = 'IMAGE' | 'STRUCTURED' | 'TEXT' | 'VISION';

export interface ModelResultCacheEnvelope<T> {
  readonly createdAt: string;
  readonly format: typeof MODEL_RESULT_CACHE_FORMAT;
  readonly output: T;
  readonly outputContentHash: string;
  readonly outputType: ModelCacheOutputType;
  readonly schemaIdentity: {
    readonly contentHash: string;
    readonly id: string;
    readonly version: number;
  } | null;
  readonly version: typeof MODEL_RESULT_CACHE_FORMAT_VERSION;
}

export interface ReadModelResultCacheOptions<T> {
  readonly expectedFileHash: string;
  readonly expectedOutputHash: string;
  readonly expectedOutputType: ModelCacheOutputType;
  readonly expectedSizeBytes: number;
  readonly parseOutput: (value: unknown) => T;
}

export interface ModelResultCacheRecord<T> {
  readonly envelope: ModelResultCacheEnvelope<T>;
  readonly file: FileDescriptor;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new StorageError('FILE_INTEGRITY_MISMATCH');
  }
  return value as Record<string, unknown>;
}

function checkedSha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new StorageError('FILE_INTEGRITY_MISMATCH');
  }
  return value;
}

function parseEnvelope<T>(
  value: unknown,
  options: ReadModelResultCacheOptions<T>,
): ModelResultCacheEnvelope<T> {
  const envelope = objectValue(value);
  if (
    !exactKeys(envelope, [
      'createdAt',
      'format',
      'output',
      'outputContentHash',
      'outputType',
      'schemaIdentity',
      'version',
    ]) ||
    envelope.format !== MODEL_RESULT_CACHE_FORMAT ||
    envelope.version !== MODEL_RESULT_CACHE_FORMAT_VERSION ||
    envelope.outputType !== options.expectedOutputType ||
    checkedSha256(envelope.outputContentHash) !== options.expectedOutputHash ||
    typeof envelope.createdAt !== 'string'
  ) {
    throw new StorageError('FILE_INTEGRITY_MISMATCH');
  }
  try {
    if (new Date(envelope.createdAt).toISOString() !== envelope.createdAt) {
      throw new Error('non-canonical timestamp');
    }
  } catch (error) {
    throw new StorageError('FILE_INTEGRITY_MISMATCH', { cause: error });
  }
  let schemaIdentity: ModelResultCacheEnvelope<T>['schemaIdentity'] = null;
  if (envelope.schemaIdentity !== null) {
    const schema = objectValue(envelope.schemaIdentity);
    if (
      !exactKeys(schema, ['contentHash', 'id', 'version']) ||
      typeof schema.id !== 'string' ||
      schema.id.length < 1 ||
      schema.id.length > 128 ||
      !Number.isSafeInteger(schema.version) ||
      (schema.version as number) < 1
    ) {
      throw new StorageError('FILE_INTEGRITY_MISMATCH');
    }
    schemaIdentity = {
      contentHash: checkedSha256(schema.contentHash),
      id: schema.id,
      version: schema.version as number,
    };
  }
  return Object.freeze({
    createdAt: envelope.createdAt,
    format: MODEL_RESULT_CACHE_FORMAT,
    output: options.parseOutput(envelope.output),
    outputContentHash: options.expectedOutputHash,
    outputType: options.expectedOutputType,
    schemaIdentity,
    version: MODEL_RESULT_CACHE_FORMAT_VERSION,
  });
}

async function readBounded(
  repository: LocalFileRepository,
  path: ManagedRelativePath,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of repository.openReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) {
      throw new StorageError('FILE_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

export class ModelResultCacheStore {
  readonly #files: LocalFileRepository;
  readonly #maximumEntries: number;
  readonly #maximumEntryBytes: number;
  readonly #maximumTotalBytes: number;
  readonly #root: ProjectDataRoot;
  #writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    root: ProjectDataRoot,
    options: {
      readonly fileRepository?: LocalFileRepository;
      readonly maximumEntries?: number;
      readonly maximumEntryBytes?: number;
      readonly maximumTotalBytes?: number;
    } = {},
  ) {
    this.#root = root;
    this.#files = options.fileRepository ?? new LocalFileRepository(root);
    this.#maximumEntries = options.maximumEntries ?? DEFAULT_MODEL_CACHE_MAX_ENTRIES;
    this.#maximumEntryBytes = options.maximumEntryBytes ?? DEFAULT_MODEL_CACHE_ENTRY_BYTES;
    this.#maximumTotalBytes = options.maximumTotalBytes ?? DEFAULT_MODEL_CACHE_TOTAL_BYTES;
    if (
      !Number.isSafeInteger(this.#maximumEntryBytes) ||
      this.#maximumEntryBytes < 1 ||
      this.#maximumEntryBytes > DEFAULT_MODEL_CACHE_ENTRY_BYTES
    ) {
      throw new RangeError('maximumEntryBytes is outside the supported cache bound.');
    }
    if (
      !Number.isSafeInteger(this.#maximumEntries) ||
      this.#maximumEntries < 1 ||
      this.#maximumEntries > DEFAULT_MODEL_CACHE_MAX_ENTRIES ||
      !Number.isSafeInteger(this.#maximumTotalBytes) ||
      this.#maximumTotalBytes < 1 ||
      this.#maximumTotalBytes > DEFAULT_MODEL_CACHE_TOTAL_BYTES
    ) {
      throw new RangeError('model cache quota is outside the supported bound.');
    }
  }

  public async write<T>(envelope: ModelResultCacheEnvelope<T>): Promise<FileDescriptor> {
    const previous = this.#writeQueue;
    let release = (): void => undefined;
    this.#writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.#writeEnvelope(envelope);
    } finally {
      release();
    }
  }

  async #writeEnvelope<T>(envelope: ModelResultCacheEnvelope<T>): Promise<FileDescriptor> {
    if (
      envelope.format !== MODEL_RESULT_CACHE_FORMAT ||
      envelope.version !== MODEL_RESULT_CACHE_FORMAT_VERSION
    ) {
      throw new StorageError('WRITE_FAILED');
    }
    const bytes = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (bytes.byteLength > this.#maximumEntryBytes) {
      throw new StorageError('FILE_TOO_LARGE');
    }
    const usage = this.#currentUsage(join(this.#root.rootPath, 'cache', 'model-results'));
    if (
      usage.entries >= this.#maximumEntries ||
      usage.bytes + bytes.byteLength > this.#maximumTotalBytes
    ) {
      throw new StorageError('WRITE_FAILED');
    }
    return this.#files.putBuffer(bytes, {
      category: 'MODEL_RESULT_CACHE',
      displayName: 'model-result-cache.json',
      maxBytes: this.#maximumEntryBytes,
    });
  }

  public async read<T>(
    pathValue: string,
    options: ReadModelResultCacheOptions<T>,
  ): Promise<ModelResultCacheEnvelope<T>> {
    const path = parseManagedRelativePath(pathValue, 'MODEL_RESULT_CACHE');
    await this.#files.verifyManagedFile(path, {
      expectedSha256: options.expectedFileHash,
      expectedSizeBytes: options.expectedSizeBytes,
    });
    const bytes = await readBounded(this.#files, path, this.#maximumEntryBytes);
    if (
      createHash('sha256').update(bytes).digest('hex') !== options.expectedFileHash ||
      bytes.byteLength !== options.expectedSizeBytes
    ) {
      throw new StorageError('FILE_INTEGRITY_MISMATCH');
    }
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch (error) {
      throw new StorageError('FILE_INTEGRITY_MISMATCH', { cause: error });
    }
    return parseEnvelope(value, options);
  }

  public deleteExact(pathValue: string): void {
    const path = parseManagedRelativePath(pathValue, 'MODEL_RESULT_CACHE');
    assertManagedAncestorsWithoutLinks(this.#root, path, { allowMissingLeaf: false });
    const nativePath = this.#root.resolve(path);
    const status = lstatSync(nativePath);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new StorageError('FILE_TYPE_NOT_REGULAR');
    }
    unlinkSync(nativePath);
  }

  #currentUsage(directory: string): { readonly bytes: number; readonly entries: number } {
    let bytes = 0;
    let entries = 0;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const status = lstatSync(path);
      if (status.isSymbolicLink()) {
        throw new StorageError('PATH_LINK_NOT_ALLOWED');
      }
      if (status.isDirectory()) {
        const child = this.#currentUsage(path);
        bytes += child.bytes;
        entries += child.entries;
      } else if (status.isFile()) {
        bytes += status.size;
        entries += 1;
      } else {
        throw new StorageError('FILE_TYPE_NOT_REGULAR');
      }
      if (bytes > this.#maximumTotalBytes || entries > this.#maximumEntries) {
        throw new StorageError('WRITE_FAILED');
      }
    }
    return { bytes, entries };
  }
}
