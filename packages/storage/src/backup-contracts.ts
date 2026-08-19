import { createHash } from 'node:crypto';
export const BACKUP_FORMAT = 'rednote-controlled-directory-backup' as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
export const BACKUP_COMPLETE_FORMAT = 'rednote-controlled-directory-backup-complete' as const;
export const BACKUP_MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const BACKUP_MAX_FILES = 100_000;
export const BACKUP_MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
export const BACKUP_MAX_TOTAL_BYTES = 100 * 1024 * 1024 * 1024;
export const BACKUP_MAX_PATH_BYTES = 1_024;
export const BACKUP_MAX_PATH_COMPONENT_BYTES = 255;
export const BACKUP_MAX_PATH_SEGMENTS = 64;
export const BACKUP_MAX_DIRECTORIES = 100_000;
export const BACKUP_FILE_CATEGORIES = [
  'DATABASE',
  'SOURCE_SNAPSHOT',
  'CLIP_SCREENSHOT',
  'PHOTO_ORIGINAL',
  'PHOTO_PROCESSED',
  'GENERATED_IMAGE',
  'IMPORT',
  'EXPORT',
] as const;
export type BackupFileCategory = (typeof BACKUP_FILE_CATEGORIES)[number];
declare const backupPayloadPathBrand: unique symbol;
export type BackupPayloadPath = string & { readonly [backupPayloadPathBrand]: true };
export type ControlledBackupErrorCode =
  | 'ABORTED'
  | 'ALREADY_EXISTS'
  | 'COPY_FAILED'
  | 'DATABASE_FAILED'
  | 'FILE_CHANGED'
  | 'INSUFFICIENT_SPACE'
  | 'INTEGRITY_FAILED'
  | 'INVALID_MANIFEST'
  | 'INVALID_PATH'
  | 'LIMIT_EXCEEDED'
  | 'MAINTENANCE_REQUIRED'
  | 'PATH_CONFLICT'
  | 'PATH_LINK_NOT_ALLOWED'
  | 'PUBLISHED_DURABILITY_UNKNOWN'
  | 'PUBLISH_FAILED'
  | 'STAGING_OWNERSHIP_INVALID';
export class ControlledBackupError extends Error {
  public constructor(public readonly code: ControlledBackupErrorCode) {
    super(code);
    this.name = 'ControlledBackupError';
  }
}
export interface BackupManifestFileV1 {
  readonly category: BackupFileCategory;
  readonly relativePath: BackupPayloadPath;
  readonly sha256: string;
  readonly sizeBytes: number;
}
export interface BackupManifestV1 {
  readonly format: typeof BACKUP_FORMAT;
  readonly backupFormatVersion: typeof BACKUP_FORMAT_VERSION;
  readonly status: 'COMPLETE';
  readonly createdAt: string;
  readonly timeZone: 'UTC';
  readonly source: {
    readonly workspaceId: string;
    readonly appVersion: string;
    readonly buildCommit: string;
    readonly dataRootFormat: 'rednote-project-data';
    readonly dataRootVersion: number;
    readonly v2DataVersion: number;
    readonly schemaVersion: number;
    readonly migrationFingerprint: string;
  };
  readonly compatibilityPolicyVersion: 1;
  readonly files: readonly BackupManifestFileV1[];
  readonly totals: { readonly fileCount: number; readonly sizeBytes: number };
}
export interface BackupCompleteMarkerV1 {
  readonly format: typeof BACKUP_COMPLETE_FORMAT;
  readonly version: 1;
  readonly manifestSha256: string;
}
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const WINDOWS_RESERVED =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])[ .]*(?:\..*)?$/iu;
const METADATA_NAMES = new Set(['manifest.json', 'complete.json', '.rednote-backup-owner.json']);
const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
  );
}
function safeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function validUnicode(value: string): boolean {
  return ![...value].some(
    (part) => (part.codePointAt(0) ?? 0) >= 0xd800 && (part.codePointAt(0) ?? 0) <= 0xdfff,
  );
}
function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= maximum &&
    validUnicode(value) &&
    value === value.normalize('NFC') &&
    ![...value].some((part) => (part.codePointAt(0) ?? 0) <= 31 || part.codePointAt(0) === 127)
  );
}
function canonicalUtc(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}
function categoryForPath(path: string): BackupFileCategory | null {
  if (path === 'payload/database/rednote.sqlite') return 'DATABASE';
  const managed = path.slice('payload/'.length);
  const mappings = [
    ['sources/snapshots/', 'SOURCE_SNAPSHOT'],
    ['sources/screenshots/', 'CLIP_SCREENSHOT'],
    ['photos/originals/', 'PHOTO_ORIGINAL'],
    ['photos/processed/', 'PHOTO_PROCESSED'],
    ['generated-images/', 'GENERATED_IMAGE'],
    ['imports/', 'IMPORT'],
    ['exports/', 'EXPORT'],
  ] as const;
  return mappings.find(([prefix]) => managed.startsWith(prefix))?.[1] ?? null;
}
export function backupCategoryForPayloadPath(path: string): BackupFileCategory {
  const parsed = parseBackupPayloadPath(path);
  return categoryForPath(parsed) as BackupFileCategory;
}
export function backupWindowsPathKey(path: string): string {
  return path
    .normalize('NFKC')
    .toLocaleUpperCase('en-US')
    .toLocaleLowerCase('en-US')
    .normalize('NFC');
}
export function parseBackupPayloadPath(
  value: string,
  expectedCategory?: BackupFileCategory,
): BackupPayloadPath {
  if (
    value !== value.normalize('NFC') ||
    !validUnicode(value) ||
    Buffer.byteLength(value, 'utf8') > BACKUP_MAX_PATH_BYTES ||
    !value.startsWith('payload/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    /[<>:"|?*]/u.test(value) ||
    [...value].some((part) => (part.codePointAt(0) ?? 0) <= 31 || part.codePointAt(0) === 127)
  )
    throw new ControlledBackupError('INVALID_PATH');
  const segments = value.split('/');
  if (
    segments.length > BACKUP_MAX_PATH_SEGMENTS ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        Buffer.byteLength(segment, 'utf8') > BACKUP_MAX_PATH_COMPONENT_BYTES ||
        segment === '.' ||
        segment === '..' ||
        segment.endsWith(' ') ||
        segment.endsWith('.') ||
        WINDOWS_RESERVED.test(segment.normalize('NFKC')) ||
        METADATA_NAMES.has(segment.toLocaleLowerCase('en-US')),
    )
  )
    throw new ControlledBackupError('INVALID_PATH');
  const category = categoryForPath(value);
  if (category === null || (expectedCategory !== undefined && category !== expectedCategory))
    throw new ControlledBackupError('INVALID_PATH');
  if (category === 'EXPORT') {
    const match = /^payload\/exports\/([a-f0-9]{2})\/([a-f0-9]{64})$/u.exec(value);
    if (match === null || match[1] !== match[2]?.slice(0, 2))
      throw new ControlledBackupError('INVALID_PATH');
  }
  return value as BackupPayloadPath;
}
function normalizeFile(value: unknown): BackupManifestFileV1 {
  if (!exact(value, ['category', 'relativePath', 'sha256', 'sizeBytes']))
    throw new ControlledBackupError('INVALID_MANIFEST');
  if (
    !BACKUP_FILE_CATEGORIES.includes(value.category as BackupFileCategory) ||
    typeof value.relativePath !== 'string' ||
    typeof value.sha256 !== 'string' ||
    !SHA256.test(value.sha256) ||
    !safeInteger(value.sizeBytes) ||
    value.sizeBytes > BACKUP_MAX_FILE_BYTES
  )
    throw new ControlledBackupError('INVALID_MANIFEST');
  const category = value.category as BackupFileCategory;
  return Object.freeze({
    relativePath: parseBackupPayloadPath(value.relativePath, category),
    category,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
  });
}
function normalizeManifest(value: unknown): BackupManifestV1 {
  if (
    !exact(value, [
      'format',
      'backupFormatVersion',
      'status',
      'createdAt',
      'timeZone',
      'source',
      'compatibilityPolicyVersion',
      'files',
      'totals',
    ]) ||
    value.format !== BACKUP_FORMAT ||
    value.backupFormatVersion !== 1 ||
    value.status !== 'COMPLETE' ||
    value.timeZone !== 'UTC' ||
    value.compatibilityPolicyVersion !== 1 ||
    !canonicalUtc(value.createdAt) ||
    !exact(value.source, [
      'workspaceId',
      'appVersion',
      'buildCommit',
      'dataRootFormat',
      'dataRootVersion',
      'v2DataVersion',
      'schemaVersion',
      'migrationFingerprint',
    ]) ||
    !exact(value.totals, ['fileCount', 'sizeBytes']) ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > BACKUP_MAX_FILES
  )
    throw new ControlledBackupError('INVALID_MANIFEST');
  const source = value.source;
  if (
    !safeText(source.workspaceId, 128) ||
    !safeText(source.appVersion, 64) ||
    typeof source.buildCommit !== 'string' ||
    !COMMIT.test(source.buildCommit) ||
    source.dataRootFormat !== 'rednote-project-data' ||
    !safeInteger(source.dataRootVersion, 1) ||
    !safeInteger(source.v2DataVersion, 1) ||
    !safeInteger(source.schemaVersion) ||
    typeof source.migrationFingerprint !== 'string' ||
    !SHA256.test(source.migrationFingerprint)
  )
    throw new ControlledBackupError('INVALID_MANIFEST');
  const files = value.files.map(normalizeFile);
  const keys = new Set<string>();
  let total = 0;
  for (const [index, file] of files.entries()) {
    const key = backupWindowsPathKey(file.relativePath);
    const previous = files[index - 1];
    if (keys.has(key) || (previous !== undefined && previous.relativePath >= file.relativePath))
      throw new ControlledBackupError('INVALID_MANIFEST');
    keys.add(key);
    total += file.sizeBytes;
    if (!Number.isSafeInteger(total) || total > BACKUP_MAX_TOTAL_BYTES)
      throw new ControlledBackupError('LIMIT_EXCEEDED');
  }
  if (
    !files.some((file) => file.relativePath === 'payload/database/rednote.sqlite') ||
    value.totals.fileCount !== files.length ||
    value.totals.sizeBytes !== total
  )
    throw new ControlledBackupError('INVALID_MANIFEST');
  return Object.freeze({
    format: BACKUP_FORMAT,
    backupFormatVersion: 1,
    status: 'COMPLETE',
    createdAt: value.createdAt,
    timeZone: 'UTC',
    source: Object.freeze({
      workspaceId: source.workspaceId,
      appVersion: source.appVersion,
      buildCommit: source.buildCommit,
      dataRootFormat: 'rednote-project-data',
      dataRootVersion: source.dataRootVersion,
      v2DataVersion: source.v2DataVersion,
      schemaVersion: source.schemaVersion,
      migrationFingerprint: source.migrationFingerprint,
    }) as BackupManifestV1['source'],
    compatibilityPolicyVersion: 1,
    files: Object.freeze(files),
    totals: Object.freeze({ fileCount: files.length, sizeBytes: total }),
  });
}
export function serializeBackupManifestV1(value: BackupManifestV1): string {
  const serialized = JSON.stringify(normalizeManifest(value));
  if (Buffer.byteLength(serialized, 'utf8') > BACKUP_MAX_MANIFEST_BYTES)
    throw new ControlledBackupError('LIMIT_EXCEEDED');
  return serialized;
}
export function parseBackupManifestV1(input: string | Uint8Array): BackupManifestV1 {
  if (typeof input !== 'string' && input.byteLength > BACKUP_MAX_MANIFEST_BYTES)
    throw new ControlledBackupError('LIMIT_EXCEEDED');
  let text: string;
  try {
    text = typeof input === 'string' ? input : FATAL_UTF8.decode(input);
  } catch {
    throw new ControlledBackupError('INVALID_MANIFEST');
  }
  if (Buffer.byteLength(text, 'utf8') > BACKUP_MAX_MANIFEST_BYTES)
    throw new ControlledBackupError('LIMIT_EXCEEDED');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ControlledBackupError('INVALID_MANIFEST');
  }
  const manifest = normalizeManifest(parsed);
  if (JSON.stringify(manifest) !== text) throw new ControlledBackupError('INVALID_MANIFEST');
  return manifest;
}
export function manifestSha256(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
export function serializeBackupCompleteMarkerV1(manifestHash: string): string {
  if (!SHA256.test(manifestHash)) throw new ControlledBackupError('INVALID_MANIFEST');
  return JSON.stringify({
    format: BACKUP_COMPLETE_FORMAT,
    version: 1,
    manifestSha256: manifestHash,
  });
}
export function parseBackupCompleteMarkerV1(input: string | Uint8Array): BackupCompleteMarkerV1 {
  if (typeof input !== 'string' && input.byteLength > 1024)
    throw new ControlledBackupError('LIMIT_EXCEEDED');
  let text: string;
  try {
    text = typeof input === 'string' ? input : FATAL_UTF8.decode(input);
  } catch {
    throw new ControlledBackupError('INVALID_MANIFEST');
  }
  if (Buffer.byteLength(text, 'utf8') > 1024) throw new ControlledBackupError('LIMIT_EXCEEDED');
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ControlledBackupError('INVALID_MANIFEST');
  }
  if (
    !exact(value, ['format', 'version', 'manifestSha256']) ||
    value.format !== BACKUP_COMPLETE_FORMAT ||
    value.version !== 1 ||
    typeof value.manifestSha256 !== 'string' ||
    !SHA256.test(value.manifestSha256) ||
    serializeBackupCompleteMarkerV1(value.manifestSha256) !== text
  )
    throw new ControlledBackupError('INVALID_MANIFEST');
  return Object.freeze(value) as unknown as BackupCompleteMarkerV1;
}
