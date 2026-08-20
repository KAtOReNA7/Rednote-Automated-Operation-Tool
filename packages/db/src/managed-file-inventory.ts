import { DatabaseSync } from 'node:sqlite';

import {
  type FileCategory,
  type ManagedRelativePath,
  parseManagedRelativePath,
} from '@mystery-operations/shared/storage';

import { inspectSqliteSnapshot } from './sqlite-snapshot.js';

export const MANAGED_FILE_INVENTORY_MAX_FILES = 99_999;
export const MANAGED_FILE_INVENTORY_MAX_REFERENCES = 200_000;
export const MANAGED_FILE_INVENTORY_MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;

type IncludedCategory = Exclude<FileCategory, 'BACKUP' | 'LOG' | 'MODEL_RESULT_CACHE'>;

export interface ManagedFileInventoryEntry {
  readonly category: IncludedCategory;
  readonly expectedSha256: string | null;
  readonly expectedSizeBytes: number | null;
  readonly managedPath: ManagedRelativePath;
}

export type ManagedFileInventoryErrorCode =
  'ABORTED' | 'INVALID_REFERENCE' | 'LIMIT_EXCEEDED' | 'SNAPSHOT_INVALID';

export class ManagedFileInventoryError extends Error {
  public constructor(public readonly code: ManagedFileInventoryErrorCode) {
    super(code);
    this.name = 'ManagedFileInventoryError';
    delete this.stack;
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const DIRECT_FIELDS = [
  ['sources', 'local_snapshot_path', null, null, 'SOURCE_SNAPSHOT'],
  [
    'fetched_documents',
    'sanitized_html_path',
    'sanitized_html_hash',
    'sanitized_html_bytes',
    'SOURCE_SNAPSHOT',
  ],
  [
    'fetched_documents',
    'extracted_text_path',
    'extracted_text_hash',
    'extracted_text_bytes',
    'SOURCE_SNAPSHOT',
  ],
  ['source_revisions', 'extracted_text_path', 'extracted_text_hash', null, 'SOURCE_SNAPSHOT'],
  ['clips', 'screenshot_path', 'screenshot_hash', 'screenshot_bytes', 'CLIP_SCREENSHOT'],
  ['assets', 'original_path', null, null, 'PHOTO_ORIGINAL'],
  ['assets', 'processed_path', null, null, 'PHOTO_PROCESSED'],
  ['metric_snapshots', 'import_file_path', null, null, 'IMPORT'],
  [
    'v2_content_package_versions',
    'generated_cover_path',
    'generated_cover_sha256',
    null,
    'GENERATED_IMAGE',
  ],
  ['v2_interaction_items', 'user_text_path', 'user_text_sha256', 'user_text_size_bytes', 'IMPORT'],
  ['v2_reply_suggestion_versions', 'reply_path', 'reply_sha256', 'reply_size_bytes', 'IMPORT'],
] as const satisfies readonly (readonly [
  string,
  string,
  string | null,
  string | null,
  IncludedCategory,
])[];

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new ManagedFileInventoryError('ABORTED');
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
  );
}

function contentAddressedExport(path: string, sha256: string): boolean {
  const match = /^exports\/([a-f0-9]{2})\/([a-f0-9]{64})$/u.exec(path);
  return match !== null && match[1] === match[2]?.slice(0, 2) && match[2] === sha256;
}

function windowsKey(path: ManagedRelativePath): string {
  return path
    .normalize('NFKC')
    .toLocaleUpperCase('en-US')
    .toLocaleLowerCase('en-US')
    .normalize('NFC');
}

function assertHash(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new ManagedFileInventoryError('INVALID_REFERENCE');
  return value;
}

function assertSize(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MANAGED_FILE_INVENTORY_MAX_FILE_BYTES
  )
    throw new ManagedFileInventoryError('INVALID_REFERENCE');
  return value as number;
}

export function enumerateManagedFileInventory(
  snapshotPath: string,
  signal?: AbortSignal,
): readonly ManagedFileInventoryEntry[] {
  checkAborted(signal);
  let before;
  try {
    before = inspectSqliteSnapshot(snapshotPath);
  } catch {
    throw new ManagedFileInventoryError('SNAPSHOT_INVALID');
  }
  const entries = new Map<string, ManagedFileInventoryEntry>();
  let references = 0;
  const add = (
    rawPath: unknown,
    category: IncludedCategory,
    rawHash: unknown = null,
    rawSize: unknown = null,
  ): void => {
    checkAborted(signal);
    references += 1;
    if (!Number.isSafeInteger(references) || references > MANAGED_FILE_INVENTORY_MAX_REFERENCES)
      throw new ManagedFileInventoryError('LIMIT_EXCEEDED');
    if (typeof rawPath !== 'string') throw new ManagedFileInventoryError('INVALID_REFERENCE');
    const expectedSha256 = rawHash === null ? null : assertHash(rawHash);
    const expectedSizeBytes = rawSize === null ? null : assertSize(rawSize);
    let managedPath: ManagedRelativePath;
    try {
      managedPath = parseManagedRelativePath(rawPath, category);
    } catch {
      throw new ManagedFileInventoryError('INVALID_REFERENCE');
    }
    const key = windowsKey(managedPath);
    const previous = entries.get(key);
    if (previous !== undefined) {
      if (
        previous.managedPath !== managedPath ||
        previous.category !== category ||
        (previous.expectedSha256 !== null &&
          expectedSha256 !== null &&
          previous.expectedSha256 !== expectedSha256) ||
        (previous.expectedSizeBytes !== null &&
          expectedSizeBytes !== null &&
          previous.expectedSizeBytes !== expectedSizeBytes)
      )
        throw new ManagedFileInventoryError('INVALID_REFERENCE');
      entries.set(
        key,
        Object.freeze({
          category,
          expectedSha256: previous.expectedSha256 ?? expectedSha256,
          expectedSizeBytes: previous.expectedSizeBytes ?? expectedSizeBytes,
          managedPath,
        }),
      );
      return;
    }
    entries.set(key, Object.freeze({ category, expectedSha256, expectedSizeBytes, managedPath }));
    if (entries.size > MANAGED_FILE_INVENTORY_MAX_FILES)
      throw new ManagedFileInventoryError('LIMIT_EXCEEDED');
  };

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(snapshotPath, {
      allowExtension: false,
      readOnly: true,
      timeout: 5_000,
    });
    for (const [table, pathColumn, hashColumn, sizeColumn, category] of DIRECT_FIELDS) {
      const hash = hashColumn ?? 'NULL';
      const size = sizeColumn ?? 'NULL';
      for (const row of database
        .prepare(
          `SELECT ${pathColumn} AS path, ${hash} AS sha256, ${size} AS sizeBytes
           FROM ${table} WHERE ${pathColumn} IS NOT NULL`,
        )
        .iterate() as Iterable<{
        readonly path: unknown;
        readonly sha256: unknown;
        readonly sizeBytes: unknown;
      }>) {
        if (
          (hashColumn !== null && row.sha256 === null) ||
          (sizeColumn !== null && row.sizeBytes === null)
        )
          throw new ManagedFileInventoryError('INVALID_REFERENCE');
        add(row.path, category, row.sha256, row.sizeBytes);
      }
    }
    for (const row of database
      .prepare('SELECT files_json FROM v2_content_package_versions')
      .iterate() as Iterable<{ readonly files_json: unknown }>) {
      checkAborted(signal);
      if (typeof row.files_json !== 'string' || Buffer.byteLength(row.files_json, 'utf8') > 4_096)
        throw new ManagedFileInventoryError('INVALID_REFERENCE');
      let referencesValue: unknown;
      try {
        referencesValue = JSON.parse(row.files_json) as unknown;
      } catch {
        throw new ManagedFileInventoryError('INVALID_REFERENCE');
      }
      if (!Array.isArray(referencesValue) || referencesValue.length !== 6)
        throw new ManagedFileInventoryError('INVALID_REFERENCE');
      for (const reference of referencesValue) {
        if (!exact(reference, ['managedPath', 'sha256', 'sizeBytes']))
          throw new ManagedFileInventoryError('INVALID_REFERENCE');
        const managedPath = reference.managedPath;
        const sha256 = assertHash(reference.sha256);
        const sizeBytes = assertSize(reference.sizeBytes);
        if (typeof managedPath !== 'string' || !contentAddressedExport(managedPath, sha256))
          throw new ManagedFileInventoryError('INVALID_REFERENCE');
        add(managedPath, 'EXPORT', sha256, sizeBytes);
      }
    }
    checkAborted(signal);
    const after = inspectSqliteSnapshot(snapshotPath);
    if (
      before.schemaVersion !== after.schemaVersion ||
      before.migrationFingerprint !== after.migrationFingerprint
    )
      throw new ManagedFileInventoryError('SNAPSHOT_INVALID');
    return Object.freeze(
      [...entries.values()].sort((left, right) =>
        left.managedPath < right.managedPath ? -1 : left.managedPath > right.managedPath ? 1 : 0,
      ),
    );
  } catch (error) {
    if (error instanceof ManagedFileInventoryError) throw error;
    throw new ManagedFileInventoryError('SNAPSHOT_INVALID');
  } finally {
    try {
      database?.close();
    } catch {
      // Never turn a path-bearing SQLite close error into a public detail.
    }
  }
}
