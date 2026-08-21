import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectDataRoot } from './project-data-root.js';

export const LOCAL_DIAGNOSTIC_FORMAT = 'rednote-local-diagnostics' as const;
export const LOCAL_DIAGNOSTIC_VERSION = 1 as const;
export const LOCAL_DIAGNOSTIC_JSON_MAX_BYTES = 256 * 1024;
export const LOCAL_DIAGNOSTIC_MANIFEST_MAX_BYTES = 64 * 1024;
export const LOCAL_DIAGNOSTIC_ZIP_MAX_BYTES = 1024 * 1024;
export const LOCAL_DIAGNOSTIC_MAX_CATEGORIES = 16;
export const LOCAL_DIAGNOSTIC_MAX_TEXT_BYTES = 256;

const DIAGNOSTIC_ENTRY = 'diagnostic.json';
const MANIFEST_ENTRY = 'manifest.json';
const ZIP_ENTRIES = [MANIFEST_ENTRY, DIAGNOSTIC_ENTRY] as const;
const SENSITIVE_KEY =
  /(?:credential|secret|token|authorization|cookie|header|prompt|response|content|body|path|url|database)/iu;
const PATH_VALUE = /(?:^[a-z]:[\\/]|^\\\\|^\/|^\.\.?[\\/]|^[a-z][a-z0-9+.-]*:\/\/|[\\/])/iu;

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows may not expose a syncable directory handle. File publication remains verified below.
  }
}

export type LocalDiagnosticCategory =
  'generated-images' | 'imports' | 'photos' | 'source-snapshots' | 'source-screenshots';

export interface LocalDiagnosticCategorySummary {
  readonly category: LocalDiagnosticCategory;
  readonly itemCount: number;
  readonly totalBytes: number;
}

export interface LocalDiagnosticPayload {
  readonly application: { readonly build: string | null; readonly version: string | null };
  readonly collectedAt: string;
  readonly fileCategories: readonly LocalDiagnosticCategorySummary[];
  readonly format: typeof LOCAL_DIAGNOSTIC_FORMAT;
  readonly health: {
    readonly database: 'healthy' | 'unavailable';
    readonly storage: 'healthy' | 'unavailable';
  };
  readonly runtime: { readonly node: string | null; readonly platform: string | null };
  readonly version: typeof LOCAL_DIAGNOSTIC_VERSION;
}

export interface LocalDiagnosticPreview {
  readonly categories: readonly LocalDiagnosticCategorySummary[];
  readonly estimatedBytes: number;
  readonly excluded: readonly string[];
  readonly previewHash: string;
}

export interface LocalDiagnosticManifest {
  readonly createdAt: string;
  readonly diagnostic: {
    readonly name: typeof DIAGNOSTIC_ENTRY;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly format: typeof LOCAL_DIAGNOSTIC_FORMAT;
  readonly version: typeof LOCAL_DIAGNOSTIC_VERSION;
}

export type LocalDiagnosticWriteResult =
  | {
      readonly outcome: 'SUCCESS';
      readonly fileName: string;
      readonly sha256: string;
      readonly sizeBytes: number;
    }
  | { readonly outcome: 'FAILED_CLEAN' }
  | { readonly outcome: 'CLEANUP_UNPROVEN' };

export class LocalDiagnosticError extends Error {
  public constructor(
    public readonly code: 'INVALID_DIAGNOSTIC' | 'LIMIT_EXCEEDED' | 'PERSISTENCE_FAILED',
  ) {
    super(code);
    this.name = 'LocalDiagnosticError';
    delete this.stack;
  }
}

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
  );
}

function safeText(value: unknown, allowNull = false): value is string | null {
  return (
    (allowNull && value === null) ||
    (typeof value === 'string' &&
      value.length > 0 &&
      bytes(value) <= LOCAL_DIAGNOSTIC_MAX_TEXT_BYTES &&
      [...value].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code > 0x1f && code !== 0x7f;
      }) &&
      !PATH_VALUE.test(value))
  );
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function normalizeCategory(value: unknown): LocalDiagnosticCategorySummary {
  if (
    !exact(value, ['category', 'itemCount', 'totalBytes']) ||
    typeof value.category !== 'string' ||
    !isSafeInteger(value.itemCount) ||
    !isSafeInteger(value.totalBytes) ||
    !['generated-images', 'imports', 'photos', 'source-snapshots', 'source-screenshots'].includes(
      value.category,
    )
  )
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  return Object.freeze({
    category: value.category as LocalDiagnosticCategory,
    itemCount: value.itemCount,
    totalBytes: value.totalBytes,
  });
}

/** Closed-schema validation before every renderer or disk egress. */
export function validateLocalDiagnosticPayload(value: unknown): LocalDiagnosticPayload {
  if (
    !exact(value, [
      'application',
      'collectedAt',
      'fileCategories',
      'format',
      'health',
      'runtime',
      'version',
    ]) ||
    value.format !== LOCAL_DIAGNOSTIC_FORMAT ||
    value.version !== LOCAL_DIAGNOSTIC_VERSION ||
    !canonicalTime(value.collectedAt) ||
    !exact(value.application, ['build', 'version']) ||
    !exact(value.runtime, ['node', 'platform']) ||
    !exact(value.health, ['database', 'storage']) ||
    !Array.isArray(value.fileCategories) ||
    value.fileCategories.length > LOCAL_DIAGNOSTIC_MAX_CATEGORIES
  )
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  if (
    !safeText(value.application.build, true) ||
    !safeText(value.application.version, true) ||
    !safeText(value.runtime.node, true) ||
    !safeText(value.runtime.platform, true) ||
    !['healthy', 'unavailable'].includes(value.health.database as string) ||
    !['healthy', 'unavailable'].includes(value.health.storage as string)
  )
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  const categories = value.fileCategories
    .map(normalizeCategory)
    .sort((left, right) => left.category.localeCompare(right.category, 'en'));
  if (new Set(categories.map((item) => item.category)).size !== categories.length)
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  const payload: LocalDiagnosticPayload = Object.freeze({
    application: Object.freeze({
      build: value.application.build as string | null,
      version: value.application.version as string | null,
    }),
    collectedAt: value.collectedAt,
    fileCategories: Object.freeze(categories),
    format: LOCAL_DIAGNOSTIC_FORMAT,
    health: Object.freeze({
      database: value.health.database as 'healthy' | 'unavailable',
      storage: value.health.storage as 'healthy' | 'unavailable',
    }),
    runtime: Object.freeze({
      node: value.runtime.node as string | null,
      platform: value.runtime.platform as string | null,
    }),
    version: LOCAL_DIAGNOSTIC_VERSION,
  });
  const encoded = Buffer.from(canonicalJson(payload), 'utf8');
  if (encoded.byteLength > LOCAL_DIAGNOSTIC_JSON_MAX_BYTES || containsSensitive(payload))
    throw new LocalDiagnosticError('LIMIT_EXCEEDED');
  return payload;
}

function containsSensitive(value: unknown, key = '', parent = ''): boolean {
  if (SENSITIVE_KEY.test(key) && !(parent === 'health' && key === 'database')) return true;
  if (typeof value === 'string') return PATH_VALUE.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsSensitive(entry, '', key));
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.entries(value).some(([name, entry]) => containsSensitive(entry, name, key))
  );
}

function crc32(value: Uint8Array): number {
  let current = 0xffffffff;
  for (const byte of value) {
    current ^= byte;
    for (let bit = 0; bit < 8; bit += 1) current = (current >>> 1) ^ (0xedb88320 & -(current & 1));
  }
  return (current ^ 0xffffffff) >>> 0;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}
function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function zipStore(entries: readonly { readonly name: string; readonly bytes: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.bytes);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.bytes.byteLength),
      u32(entry.bytes.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      entry.bytes,
    ]);
    locals.push(local);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.bytes.byteLength),
        u32(entry.bytes.byteLength),
        u16(name.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.byteLength;
  }
  const central = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ]);
}

/** Validates independently parsed local and central ZIP records; no extractor is trusted. */
export function verifyLocalDiagnosticZip(bytesValue: Uint8Array): LocalDiagnosticManifest {
  const bytes = Buffer.from(bytesValue);
  if (bytes.byteLength > LOCAL_DIAGNOSTIC_ZIP_MAX_BYTES || bytes.byteLength < 22)
    throw new LocalDiagnosticError('LIMIT_EXCEEDED');
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (
    eocd < 0 ||
    eocd + 22 !== bytes.byteLength ||
    bytes.readUInt16LE(eocd + 8) !== 2 ||
    bytes.readUInt16LE(eocd + 10) !== 2 ||
    bytes.readUInt16LE(eocd + 20) !== 0
  )
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize !== eocd) throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  const entries = new Map<string, Buffer>();
  let cursor = centralOffset;
  for (let index = 0; index < 2; index += 1) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const size = bytes.readUInt32LE(cursor + 20);
    const compressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (flags !== 0x0800 || method !== 0 || size !== compressed || end > eocd)
      throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (
      !ZIP_ENTRIES.includes(name as typeof DIAGNOSTIC_ENTRY) ||
      entries.has(name) ||
      name.includes('..') ||
      name.includes('\\') ||
      name.includes('/')
    )
      throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
    if (
      localOffset + 30 > centralOffset ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50 ||
      bytes.readUInt16LE(localOffset + 6) !== flags ||
      bytes.readUInt16LE(localOffset + 8) !== method ||
      bytes.readUInt32LE(localOffset + 14) !== crc ||
      bytes.readUInt32LE(localOffset + 18) !== size ||
      bytes.readUInt32LE(localOffset + 22) !== compressed ||
      bytes.readUInt16LE(localOffset + 26) !== nameLength ||
      bytes.readUInt16LE(localOffset + 28) !== 0
    )
      throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
    const localName = bytes
      .subarray(localOffset + 30, localOffset + 30 + nameLength)
      .toString('utf8');
    const payloadStart = localOffset + 30 + nameLength;
    const payloadEnd = payloadStart + size;
    if (localName !== name || payloadEnd > centralOffset)
      throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
    const payload = bytes.subarray(payloadStart, payloadEnd);
    if (crc32(payload) !== crc) throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
    entries.set(name, payload);
    cursor = end;
  }
  if (cursor !== eocd || entries.size !== 2) throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  let manifestUnknown: unknown;
  let diagnosticUnknown: unknown;
  const manifestEntry = entries.get(MANIFEST_ENTRY);
  const diagnosticEntry = entries.get(DIAGNOSTIC_ENTRY);
  if (manifestEntry === undefined || diagnosticEntry === undefined)
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  try {
    manifestUnknown = JSON.parse(manifestEntry.toString('utf8'));
    diagnosticUnknown = JSON.parse(diagnosticEntry.toString('utf8'));
  } catch {
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  }
  const payload = validateLocalDiagnosticPayload(diagnosticUnknown);
  if (
    !exact(manifestUnknown, ['createdAt', 'diagnostic', 'format', 'version']) ||
    manifestUnknown.format !== LOCAL_DIAGNOSTIC_FORMAT ||
    manifestUnknown.version !== LOCAL_DIAGNOSTIC_VERSION ||
    !canonicalTime(manifestUnknown.createdAt) ||
    !exact(manifestUnknown.diagnostic, ['name', 'sha256', 'sizeBytes']) ||
    manifestUnknown.diagnostic.name !== DIAGNOSTIC_ENTRY ||
    typeof manifestUnknown.diagnostic.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(manifestUnknown.diagnostic.sha256) ||
    !isSafeInteger(manifestUnknown.diagnostic.sizeBytes)
  )
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  const diagnostic = diagnosticEntry;
  if (
    manifestUnknown.createdAt !== payload.collectedAt ||
    manifestUnknown.diagnostic.sizeBytes !== diagnostic.byteLength ||
    manifestUnknown.diagnostic.sha256 !== sha256(diagnostic)
  )
    throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
  if (
    manifestEntry.byteLength > LOCAL_DIAGNOSTIC_MANIFEST_MAX_BYTES ||
    diagnostic.byteLength > LOCAL_DIAGNOSTIC_JSON_MAX_BYTES
  )
    throw new LocalDiagnosticError('LIMIT_EXCEEDED');
  return Object.freeze({
    createdAt: manifestUnknown.createdAt,
    diagnostic: Object.freeze({
      name: DIAGNOSTIC_ENTRY,
      sha256: manifestUnknown.diagnostic.sha256,
      sizeBytes: diagnostic.byteLength,
    }),
    format: LOCAL_DIAGNOSTIC_FORMAT,
    version: LOCAL_DIAGNOSTIC_VERSION,
  });
}

export function createLocalDiagnosticPreview(
  payload: LocalDiagnosticPayload,
): LocalDiagnosticPreview {
  const normalized = validateLocalDiagnosticPayload(payload);
  const encoded = Buffer.from(canonicalJson(normalized), 'utf8');
  return Object.freeze({
    categories: normalized.fileCategories,
    estimatedBytes: encoded.byteLength + 1024,
    excluded: Object.freeze([
      '凭据与 token',
      '数据库正文与业务内容',
      '完整提示词或响应',
      '绝对路径与未知字段',
    ]),
    previewHash: sha256(encoded),
  });
}

export async function summarizeLocalDiagnosticCategories(
  root: ProjectDataRoot,
): Promise<readonly LocalDiagnosticCategorySummary[]> {
  const definitions: readonly [LocalDiagnosticCategory, string][] = [
    ['generated-images', 'generated-images'],
    ['imports', 'imports'],
    ['photos', 'photos'],
    ['source-snapshots', 'sources/snapshots'],
    ['source-screenshots', 'sources/screenshots'],
  ];
  const result: LocalDiagnosticCategorySummary[] = [];
  for (const [category, controlled] of definitions) {
    const directory = join(root.rootPath, ...controlled.split('/'));
    let count = 0;
    let total = 0;
    const stack = [directory];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const target = join(current, entry.name);
        const status = await lstat(target).catch(() => null);
        if (status === null || status.isSymbolicLink()) continue;
        if (status.isDirectory()) {
          if (stack.length < 1024) stack.push(target);
          continue;
        }
        if (status.isFile() && status.nlink === 1) {
          count += 1;
          total += status.size;
          if (!Number.isSafeInteger(total)) throw new LocalDiagnosticError('LIMIT_EXCEEDED');
        }
      }
    }
    result.push(Object.freeze({ category, itemCount: count, totalBytes: total }));
  }
  return Object.freeze(result);
}

export async function writeLocalDiagnosticPackage(options: {
  readonly directory: string;
  readonly payload: LocalDiagnosticPayload;
  readonly previewHash: string;
  readonly randomId?: () => string;
}): Promise<LocalDiagnosticWriteResult> {
  let temporary: string | null = null;
  let finalPath: string | null = null;
  let owned: { readonly dev: number; readonly ino: number } | null = null;
  try {
    const payload = validateLocalDiagnosticPayload(options.payload);
    const preview = createLocalDiagnosticPreview(payload);
    if (preview.previewHash !== options.previewHash)
      throw new LocalDiagnosticError('INVALID_DIAGNOSTIC');
    const diagnostic = Buffer.from(canonicalJson(payload), 'utf8');
    const manifest = Buffer.from(
      canonicalJson({
        createdAt: payload.collectedAt,
        diagnostic: {
          name: DIAGNOSTIC_ENTRY,
          sha256: sha256(diagnostic),
          sizeBytes: diagnostic.byteLength,
        },
        format: LOCAL_DIAGNOSTIC_FORMAT,
        version: LOCAL_DIAGNOSTIC_VERSION,
      }),
      'utf8',
    );
    if (manifest.byteLength > LOCAL_DIAGNOSTIC_MANIFEST_MAX_BYTES)
      throw new LocalDiagnosticError('LIMIT_EXCEEDED');
    const archive = zipStore([
      { name: MANIFEST_ENTRY, bytes: manifest },
      { name: DIAGNOSTIC_ENTRY, bytes: diagnostic },
    ]);
    if (archive.byteLength > LOCAL_DIAGNOSTIC_ZIP_MAX_BYTES)
      throw new LocalDiagnosticError('LIMIT_EXCEEDED');
    verifyLocalDiagnosticZip(archive);
    const directoryStatus = await lstat(options.directory);
    if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink())
      throw new LocalDiagnosticError('PERSISTENCE_FAILED');
    const random = (options.randomId ?? randomUUID)().replaceAll('-', '');
    if (!/^[a-z0-9]{16,64}$/iu.test(random)) throw new LocalDiagnosticError('PERSISTENCE_FAILED');
    const instant = new Date(payload.collectedAt);
    const stamp = `${instant.getUTCFullYear()}${String(instant.getUTCMonth() + 1).padStart(2, '0')}${String(instant.getUTCDate()).padStart(2, '0')}-${String(instant.getUTCHours()).padStart(2, '0')}${String(instant.getUTCMinutes()).padStart(2, '0')}${String(instant.getUTCSeconds()).padStart(2, '0')}`;
    const fileName = `diagnostics-${stamp}-${random}.zip`;
    if (!/^diagnostics-\d{8}-\d{6}-[a-z0-9]{16,64}\.zip$/iu.test(fileName))
      throw new LocalDiagnosticError('PERSISTENCE_FAILED');
    finalPath = join(options.directory, fileName);
    temporary = join(options.directory, `.rednote-diagnostics-${random}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(archive);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const tempStatus = await lstat(temporary);
    owned = { dev: tempStatus.dev, ino: tempStatus.ino };
    await lstat(finalPath)
      .then(() => {
        throw new LocalDiagnosticError('PERSISTENCE_FAILED');
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      });
    await rename(temporary, finalPath);
    temporary = null;
    await syncDirectoryBestEffort(options.directory);
    const finalStatus = await lstat(finalPath);
    owned = { dev: finalStatus.dev, ino: finalStatus.ino };
    const reopened = await open(finalPath, 'r');
    let onDisk: Buffer;
    try {
      onDisk = await reopened.readFile();
    } finally {
      await reopened.close();
    }
    verifyLocalDiagnosticZip(onDisk);
    return Object.freeze({
      outcome: 'SUCCESS',
      fileName,
      sha256: sha256(onDisk),
      sizeBytes: onDisk.byteLength,
    });
  } catch {
    const candidate = temporary ?? finalPath;
    if (candidate === null || owned === null) return Object.freeze({ outcome: 'FAILED_CLEAN' });
    try {
      const current = await lstat(candidate);
      if (current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino)
        throw new Error('identity');
      await unlink(candidate);
      await lstat(candidate)
        .then(() => {
          throw new Error('exists');
        })
        .catch((error: unknown) => {
          if ((error as { code?: string }).code !== 'ENOENT') throw error;
        });
      return Object.freeze({ outcome: 'FAILED_CLEAN' });
    } catch {
      return Object.freeze({ outcome: 'CLEANUP_UNPROVEN' });
    }
  }
}
