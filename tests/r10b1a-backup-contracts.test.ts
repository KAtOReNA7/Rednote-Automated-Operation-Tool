import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BACKUP_MAX_FILE_BYTES,
  BACKUP_MAX_FILES,
  BACKUP_MAX_MANIFEST_BYTES,
  type BackupFileCategory,
  type BackupManifestFileV1,
  type BackupManifestV1,
  ControlledBackupError,
  backupCategoryForPayloadPath,
  backupWindowsPathKey,
  manifestSha256,
  parseBackupCompleteMarkerV1,
  parseBackupManifestV1,
  parseBackupPayloadPath,
  serializeBackupCompleteMarkerV1,
  serializeBackupManifestV1,
} from '../packages/storage/src/index.js';

const BUILD_COMMIT = '7'.repeat(40);
const MIGRATION_FINGERPRINT = 'b'.repeat(64);
const SHA256 = 'a'.repeat(64);
const DATABASE_PATH = parseBackupPayloadPath('payload/database/rednote.sqlite', 'DATABASE');

function file(
  relativePath = DATABASE_PATH,
  category: BackupFileCategory = 'DATABASE',
  sizeBytes = 3,
  sha256 = SHA256,
): BackupManifestFileV1 {
  return { category, relativePath, sha256, sizeBytes };
}

function manifest(files: readonly BackupManifestFileV1[] = [file()]): BackupManifestV1 {
  return {
    format: 'rednote-controlled-directory-backup',
    backupFormatVersion: 1,
    status: 'COMPLETE',
    createdAt: '2026-08-20T03:04:05.678Z',
    timeZone: 'UTC',
    source: {
      workspaceId: '12345678-1234-4123-8123-123456789abc',
      appVersion: '0.0.0',
      buildCommit: BUILD_COMMIT,
      dataRootFormat: 'rednote-project-data',
      dataRootVersion: 1,
      v2DataVersion: 1,
      schemaVersion: 27,
      migrationFingerprint: MIGRATION_FINGERPRINT,
    },
    compatibilityPolicyVersion: 1,
    files,
    totals: {
      fileCount: files.length,
      sizeBytes: files.reduce((total, entry) => total + entry.sizeBytes, 0),
    },
  };
}

function mutableManifest(): Record<string, unknown> {
  return JSON.parse(serializeBackupManifestV1(manifest())) as Record<string, unknown>;
}

function expectContractError(action: () => unknown, code = 'INVALID_MANIFEST'): void {
  expect(action).toThrowError(expect.objectContaining({ code, message: code }));
}

function expectPrivateManifestError(action: () => unknown, canary: string): void {
  let failure: unknown;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ControlledBackupError);
  expect(failure).toMatchObject({ code: 'INVALID_MANIFEST', message: 'INVALID_MANIFEST' });
  expect((failure as Error).stack).toBeUndefined();
  expect(JSON.stringify(failure)).not.toContain(canary);
}

describe('R10B1A canonical manifest and completion contracts', () => {
  it('canonicalizes caller key order, round trips immutably, and hashes stable bytes', () => {
    const value = manifest();
    const reordered = {
      totals: value.totals,
      files: value.files,
      compatibilityPolicyVersion: value.compatibilityPolicyVersion,
      source: {
        migrationFingerprint: value.source.migrationFingerprint,
        schemaVersion: value.source.schemaVersion,
        v2DataVersion: value.source.v2DataVersion,
        dataRootVersion: value.source.dataRootVersion,
        dataRootFormat: value.source.dataRootFormat,
        buildCommit: value.source.buildCommit,
        appVersion: value.source.appVersion,
        workspaceId: value.source.workspaceId,
      },
      timeZone: value.timeZone,
      createdAt: value.createdAt,
      status: value.status,
      backupFormatVersion: value.backupFormatVersion,
      format: value.format,
    } as BackupManifestV1;
    const canonical = serializeBackupManifestV1(value);
    expect(serializeBackupManifestV1(reordered)).toBe(canonical);
    expect(manifestSha256(canonical)).toBe(createHash('sha256').update(canonical).digest('hex'));
    const parsed = parseBackupManifestV1(Buffer.from(canonical));
    expect(parsed).toEqual(value);
    for (const nested of [parsed, parsed.source, parsed.files, parsed.files[0], parsed.totals])
      expect(Object.isFrozen(nested)).toBe(true);
  });

  it.each([
    ['workspaceId', '00000000-0000-4000-8000-000000000008'],
    ['appVersion', '0.0.0'],
    ['appVersion', '1.2.3-rc.1+build.5'],
  ] as const)('accepts controlled source identity %s=%s', (field, value) => {
    const base = manifest();
    const candidate = { ...base, source: { ...base.source, [field]: value } };
    expect(parseBackupManifestV1(serializeBackupManifestV1(candidate)).source[field]).toBe(value);
  });

  it.each([
    [
      'workspaceId',
      [
        'not-a-uuid',
        'C:\\outside',
        '\\\\server\\share',
        '\\\\?\\C:\\device',
        'C:relative',
        'file:///outside',
        '\u0000uuid',
        'e\u0301',
      ],
    ],
    [
      'appVersion',
      [
        'version one',
        '/absolute',
        'C:\\outside',
        '\\\\server\\share',
        '\\\\?\\C:\\device',
        'C:relative',
        'file:///outside',
        '1/2/3',
        '1\\2\\3',
        '1:2:3',
        '1.2.3 beta',
        '1.2.3\n',
      ],
    ],
  ] as const)('rejects unsafe %s values through creator and parser', (field, values) => {
    const canonical = serializeBackupManifestV1(manifest());
    const original = manifest().source[field];
    for (const value of values) {
      const base = manifest();
      const candidate = { ...base, source: { ...base.source, [field]: value } };
      expectPrivateManifestError(() => serializeBackupManifestV1(candidate), value);
      expectPrivateManifestError(
        () =>
          parseBackupManifestV1(canonical.replace(JSON.stringify(original), JSON.stringify(value))),
        value,
      );
    }
  });

  it.each([
    ['root missing', (value: Record<string, unknown>) => delete value.status],
    ['root unknown', (value: Record<string, unknown>) => Object.assign(value, { extra: true })],
    ['root wrong type', (value: Record<string, unknown>) => Object.assign(value, { status: 1 })],
    [
      'source missing',
      (value: Record<string, unknown>) =>
        delete (value.source as Record<string, unknown>).workspaceId,
    ],
    [
      'source unknown',
      (value: Record<string, unknown>) => Object.assign(value.source as object, { extra: true }),
    ],
    [
      'source wrong type',
      (value: Record<string, unknown>) =>
        Object.assign(value.source as object, { schemaVersion: '27' }),
    ],
    [
      'file missing',
      (value: Record<string, unknown>) =>
        delete ((value.files as Record<string, unknown>[])[0] as Record<string, unknown>).sha256,
    ],
    [
      'file unknown',
      (value: Record<string, unknown>) =>
        Object.assign((value.files as Record<string, unknown>[])[0] as object, { extra: true }),
    ],
    [
      'file wrong type',
      (value: Record<string, unknown>) =>
        Object.assign((value.files as Record<string, unknown>[])[0] as object, { sizeBytes: '3' }),
    ],
    [
      'totals missing',
      (value: Record<string, unknown>) =>
        delete (value.totals as Record<string, unknown>).sizeBytes,
    ],
    [
      'totals unknown',
      (value: Record<string, unknown>) => Object.assign(value.totals as object, { extra: true }),
    ],
    [
      'totals wrong type',
      (value: Record<string, unknown>) => Object.assign(value.totals as object, { fileCount: '1' }),
    ],
  ])('rejects exact-object violation: %s', (_name, mutate) => {
    const value = mutableManifest();
    mutate(value);
    expectContractError(() => parseBackupManifestV1(JSON.stringify(value)));
  });

  it.each([
    ['root', '{"format":', '{"format":"duplicate","format":'],
    ['source', '"source":{"workspaceId":', '"source":{"workspaceId":"duplicate","workspaceId":'],
    [
      'file',
      '"files":[{"relativePath":',
      '"files":[{"relativePath":"payload/database/rednote.sqlite","relativePath":',
    ],
    ['totals', '"totals":{"fileCount":', '"totals":{"fileCount":2,"fileCount":'],
  ])('rejects a raw duplicate key in %s', (_name, search, replacement) => {
    const canonical = serializeBackupManifestV1(manifest());
    expectContractError(() => parseBackupManifestV1(canonical.replace(search, replacement)));
  });

  it('rejects duplicate and non-exact completion markers', () => {
    const serialized = serializeBackupCompleteMarkerV1(SHA256);
    expect(parseBackupCompleteMarkerV1(serialized)).toEqual({
      format: 'rednote-controlled-directory-backup-complete',
      version: 1,
      manifestSha256: SHA256,
    });
    for (const value of [
      serialized.replace('{"format":', '{"format":"duplicate","format":'),
      serialized.replace('"version":1,', ''),
      serialized.replace('"version":1', '"version":"1"'),
      serialized.replace('"version":1', '"version":1.0'),
      serialized.replace('}', ',"extra":true}'),
      `${serialized}\n`,
    ])
      expectContractError(() => parseBackupCompleteMarkerV1(value));
  });

  it('rejects noncanonical JSON text and UTF-8 on both input paths', () => {
    const canonical = serializeBackupManifestV1(manifest());
    const object = JSON.parse(canonical) as Record<string, unknown>;
    const reordered = JSON.stringify({ status: object.status, ...object });
    for (const text of [
      canonical.replace('{', '{ '),
      `${canonical}\n`,
      canonical.replace('"UTC"', '"\\u0055TC"'),
      canonical.replace('"backupFormatVersion":1', '"backupFormatVersion":1.0'),
      reordered,
    ])
      expectContractError(() => parseBackupManifestV1(text));
    expectContractError(() =>
      parseBackupManifestV1(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical)]),
      ),
    );
    expectContractError(() => parseBackupManifestV1(Uint8Array.from([0xc3, 0x28])));
  });

  it('enforces manifest, file-count, per-file, total, and numeric bounds', () => {
    expectContractError(
      () => parseBackupManifestV1('x'.repeat(BACKUP_MAX_MANIFEST_BYTES + 1)),
      'LIMIT_EXCEEDED',
    );
    expectContractError(() =>
      serializeBackupManifestV1(manifest(Array(BACKUP_MAX_FILES + 1).fill(file()))),
    );
    expectContractError(() =>
      serializeBackupManifestV1(
        manifest([file(DATABASE_PATH, 'DATABASE', BACKUP_MAX_FILE_BYTES + 1)]),
      ),
    );
    const large = [
      file(DATABASE_PATH, 'DATABASE', BACKUP_MAX_FILE_BYTES),
      ...Array.from({ length: 12 }, (_, index) =>
        file(
          parseBackupPayloadPath(`payload/imports/large-${index}`),
          'IMPORT',
          BACKUP_MAX_FILE_BYTES,
          index.toString(16).padStart(64, '0'),
        ),
      ),
    ].sort((left, right) => (left.relativePath < right.relativePath ? -1 : 1));
    expectContractError(() => serializeBackupManifestV1(manifest(large)), 'LIMIT_EXCEEDED');
    for (const sizeBytes of [-0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expectContractError(() =>
        serializeBackupManifestV1(manifest([file(DATABASE_PATH, 'DATABASE', sizeBytes)])),
      );
  });
});

describe('R10B1A portable Windows payload paths', () => {
  it.each([
    ['payload/database/rednote.sqlite', 'DATABASE'],
    ['payload/sources/snapshots/aa/source', 'SOURCE_SNAPSHOT'],
    ['payload/sources/screenshots/bb/clip', 'CLIP_SCREENSHOT'],
    ['payload/photos/originals/cc/photo', 'PHOTO_ORIGINAL'],
    ['payload/photos/processed/dd/photo', 'PHOTO_PROCESSED'],
    ['payload/generated-images/ee/cover', 'GENERATED_IMAGE'],
    ['payload/imports/ff/item', 'IMPORT'],
    [`payload/exports/${SHA256.slice(0, 2)}/${SHA256}`, 'EXPORT'],
  ] as const)('maps the only allowed category path %s', (path, category) => {
    expect(parseBackupPayloadPath(path, category)).toBe(path);
    expect(backupCategoryForPayloadPath(path)).toBe(category);
  });

  it.each([
    'C:/outside',
    'C:outside',
    '\\\\server\\share',
    '\\\\?\\C:\\device',
    '/absolute',
    'file:///outside',
    'payload/../outside',
    'payload/imports//file',
    'payload/imports/./file',
    'payload/imports/file/',
    'payload/imports/a\\b',
    'payload/imports/file:stream',
    'payload/imports/file.',
    'payload/imports/file ',
    'payload/imports/CON.txt',
    'payload/imports/COM¹.txt',
    'payload/imports/LPT１.log',
    'payload/imports/CONIN$',
    'payload/imports/COMPLETE.json',
    'payload/imports/.rednote-backup-owner.json',
    'payload/manifest.json',
    'payload/unknown/file',
    'payload/exports/v2/package/file',
    `payload/exports/ff/${SHA256}`,
    'payload/imports/e\u0301',
    'payload/imports/\ufefffile',
    'payload/imports/\ud800',
    `payload/imports/${'界'.repeat(86)}`,
    `payload/imports/${Array.from({ length: 63 }, () => 'd').join('/')}`,
    `payload/imports/${'界'.repeat(400)}`,
  ])('rejects unsafe or nonportable path %s', (path) => {
    expectContractError(() => parseBackupPayloadPath(path), 'INVALID_PATH');
  });

  it('keeps a valid replacement character but rejects case and Unicode-fold collisions', () => {
    expect(parseBackupPayloadPath('payload/imports/\ufffd')).toBe('payload/imports/\ufffd');
    const collisionCases = [
      ['payload/imports/AA/file', 'payload/imports/aa/file'],
      ['payload/imports/A/file', 'payload/imports/Ａ/file'],
    ];
    for (const [left, right] of collisionCases) {
      expect(backupWindowsPathKey(left as string)).toBe(backupWindowsPathKey(right as string));
      const entries = [
        file(DATABASE_PATH),
        file(parseBackupPayloadPath(left as string), 'IMPORT', 1, 'c'.repeat(64)),
        file(parseBackupPayloadPath(right as string), 'IMPORT', 1, 'd'.repeat(64)),
      ].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      expectContractError(() => serializeBackupManifestV1(manifest(entries)));
    }
  });

  it.each([
    [
      'unsorted files',
      [file(parseBackupPayloadPath('payload/imports/z'), 'IMPORT'), file()],
      'INVALID_MANIFEST',
    ],
    ['duplicate file', [file(), file()], 'INVALID_MANIFEST'],
    ['category mismatch', [file(DATABASE_PATH, 'IMPORT')], 'INVALID_PATH'],
    [
      'missing database',
      [file(parseBackupPayloadPath('payload/imports/a'), 'IMPORT')],
      'INVALID_MANIFEST',
    ],
  ])('rejects invalid file-set contract: %s', (_name, files, code) => {
    expectContractError(() => serializeBackupManifestV1(manifest(files)), code);
  });

  it('rejects totals mismatch and returns path-free stable errors', () => {
    const value = manifest();
    expectContractError(() =>
      serializeBackupManifestV1({ ...value, totals: { ...value.totals, sizeBytes: 4 } }),
    );
    const canary = 'C:\\Users\\SYNTHETIC_SECRET_PROMPT_RESPONSE_CANARY';
    let failure: unknown;
    try {
      parseBackupPayloadPath(canary);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ControlledBackupError);
    expect(failure).toMatchObject({ code: 'INVALID_PATH', message: 'INVALID_PATH' });
    expect((failure as Error).stack).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(canary);
  });
});
