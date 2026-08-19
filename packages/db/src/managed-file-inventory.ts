import { DatabaseSync } from 'node:sqlite';

import { type FileCategory, parseManagedRelativePath } from '@mystery-operations/shared/storage';
import { assertLocalRegularSqlitePath } from './sqlite-snapshot.js';

export const MANAGED_BACKUP_INVENTORY_MAX_FILES = 99_999;
export const MANAGED_BACKUP_INVENTORY_MAX_REFERENCES = 200_000;

type ManagedBackupFileCategory = Exclude<FileCategory, 'BACKUP' | 'LOG' | 'MODEL_RESULT_CACHE'>;

export interface ManagedFileInventoryEntry {
  readonly category: ManagedBackupFileCategory;
  readonly expectedSha256: string | null;
  readonly expectedSizeBytes: number | null;
  readonly managedPath: string;
}

export class ManagedFileInventoryError extends Error {
  public constructor(
    public readonly code: 'ABORTED' | 'INVALID_REFERENCE' | 'LIMIT_EXCEEDED' | 'SNAPSHOT_INVALID',
  ) {
    super(code);
    this.name = 'ManagedFileInventoryError';
  }
}

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
  ManagedBackupFileCategory,
])[];

const SHA256 = /^[a-f0-9]{64}$/u;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === [...keys].sort().join()
  );
}

function contentAddressedExport(path: string, sha256: string): boolean {
  const match = /^exports\/([a-f0-9]{2})\/([a-f0-9]{64})$/u.exec(path);
  return match !== null && match[1] === match[2]?.slice(0, 2) && match[2] === sha256;
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new ManagedFileInventoryError('ABORTED');
}

export function enumerateManagedFileInventory(
  snapshotPath: string,
  signal?: AbortSignal,
): readonly ManagedFileInventoryEntry[] {
  let initialPath: ReturnType<typeof assertLocalRegularSqlitePath>;
  try {
    initialPath = assertLocalRegularSqlitePath(snapshotPath);
  } catch {
    throw new ManagedFileInventoryError('SNAPSHOT_INVALID');
  }
  let database: DatabaseSync | undefined;
  const entries = new Map<string, ManagedFileInventoryEntry>();
  let referenceCount = 0;
  const add = (
    rawPath: unknown,
    category: ManagedBackupFileCategory,
    rawSha256: unknown = null,
    rawSizeBytes: unknown = null,
  ): void => {
    aborted(signal);
    referenceCount += 1;
    if (referenceCount > MANAGED_BACKUP_INVENTORY_MAX_REFERENCES)
      throw new ManagedFileInventoryError('LIMIT_EXCEEDED');
    if (
      typeof rawPath !== 'string' ||
      (rawSha256 !== null && (typeof rawSha256 !== 'string' || !SHA256.test(rawSha256))) ||
      (rawSizeBytes !== null &&
        (!Number.isSafeInteger(rawSizeBytes) ||
          (rawSizeBytes as number) < 0 ||
          (rawSizeBytes as number) > 8 * 1024 * 1024 * 1024))
    )
      throw new ManagedFileInventoryError('INVALID_REFERENCE');
    let managedPath: string;
    try {
      managedPath = parseManagedRelativePath(rawPath, category);
    } catch {
      throw new ManagedFileInventoryError('INVALID_REFERENCE');
    }
    const key = managedPath
      .normalize('NFKC')
      .toLocaleUpperCase('en-US')
      .toLocaleLowerCase('en-US')
      .normalize('NFC');
    const previous = entries.get(key);
    if (previous !== undefined) {
      if (
        previous.managedPath !== managedPath ||
        previous.category !== category ||
        (previous.expectedSha256 !== null &&
          rawSha256 !== null &&
          previous.expectedSha256 !== rawSha256) ||
        (previous.expectedSizeBytes !== null &&
          rawSizeBytes !== null &&
          previous.expectedSizeBytes !== rawSizeBytes)
      )
        throw new ManagedFileInventoryError('INVALID_REFERENCE');
      entries.set(
        key,
        Object.freeze({
          category,
          managedPath,
          expectedSha256: previous.expectedSha256 ?? (rawSha256 as string | null),
          expectedSizeBytes: previous.expectedSizeBytes ?? (rawSizeBytes as number | null),
        }),
      );
      return;
    }
    entries.set(
      key,
      Object.freeze({
        category,
        managedPath,
        expectedSha256: rawSha256 as string | null,
        expectedSizeBytes: rawSizeBytes as number | null,
      }),
    );
    if (entries.size > MANAGED_BACKUP_INVENTORY_MAX_FILES)
      throw new ManagedFileInventoryError('LIMIT_EXCEEDED');
  };
  try {
    database = new DatabaseSync(snapshotPath, {
      allowExtension: false,
      readOnly: true,
      timeout: 5_000,
    });
    const openedPath = assertLocalRegularSqlitePath(snapshotPath);
    if (openedPath.dev !== initialPath.dev || openedPath.ino !== initialPath.ino)
      throw new ManagedFileInventoryError('SNAPSHOT_INVALID');
    for (const [table, pathColumn, hashColumn, sizeColumn, category] of DIRECT_FIELDS) {
      const hash = hashColumn === null ? 'NULL' : hashColumn;
      const size = sizeColumn === null ? 'NULL' : sizeColumn;
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
      aborted(signal);
      if (typeof row.files_json !== 'string' || Buffer.byteLength(row.files_json, 'utf8') > 4096)
        throw new ManagedFileInventoryError('INVALID_REFERENCE');
      let refs: unknown;
      try {
        refs = JSON.parse(row.files_json) as unknown;
      } catch {
        throw new ManagedFileInventoryError('INVALID_REFERENCE');
      }
      if (!Array.isArray(refs) || refs.length !== 6)
        throw new ManagedFileInventoryError('INVALID_REFERENCE');
      for (const ref of refs) {
        if (
          !exact(ref, ['managedPath', 'sha256', 'sizeBytes']) ||
          typeof ref.managedPath !== 'string' ||
          typeof ref.sha256 !== 'string' ||
          !SHA256.test(ref.sha256) ||
          !Number.isSafeInteger(ref.sizeBytes) ||
          (ref.sizeBytes as number) < 0 ||
          (ref.sizeBytes as number) > 8 * 1024 * 1024 * 1024 ||
          !contentAddressedExport(ref.managedPath, ref.sha256)
        )
          throw new ManagedFileInventoryError('INVALID_REFERENCE');
        add(ref.managedPath, 'EXPORT', ref.sha256, ref.sizeBytes);
      }
    }
    aborted(signal);
    const result = Object.freeze(
      [...entries.values()].sort((left, right) =>
        left.managedPath < right.managedPath ? -1 : left.managedPath > right.managedPath ? 1 : 0,
      ),
    );
    const finalPath = assertLocalRegularSqlitePath(snapshotPath);
    if (finalPath.dev !== initialPath.dev || finalPath.ino !== initialPath.ino)
      throw new ManagedFileInventoryError('SNAPSHOT_INVALID');
    return result;
  } catch (error) {
    if (error instanceof ManagedFileInventoryError) throw error;
    throw new ManagedFileInventoryError('SNAPSHOT_INVALID');
  } finally {
    try {
      database?.close();
    } catch {
      // Preserve the path-free inventory error contract.
    }
  }
}
