import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import {
  mkdir,
  link,
  readFile,
  readdir,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  JobQueueRepository,
  MANAGED_BACKUP_INVENTORY_MAX_REFERENCES,
  connectDatabase,
  createSqliteSnapshot,
  estimateSqliteSnapshotBytes,
  enumerateManagedFileInventory,
  initializeDatabase,
  inspectSqliteSnapshot,
} from '../packages/db/src/index.js';
import {
  BACKUP_MAX_FILE_BYTES,
  BACKUP_MAX_MANIFEST_BYTES,
  BACKUP_MAX_TOTAL_BYTES,
  type BackupManifestV1,
  ControlledBackupError,
  createControlledBackupSnapshot,
  manifestSha256,
  parseBackupCompleteMarkerV1,
  parseBackupManifestV1,
  parseBackupPayloadPath,
  serializeBackupManifestV1,
  verifyControlledBackupSnapshot,
} from '../packages/storage/src/index.js';
import { assertBackupCapacity } from '../packages/storage/src/backup-snapshot.js';
import {
  ExponentialBackoffPolicy,
  JobHandlerRegistry,
  JobQueueService,
} from '../packages/workflows/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createBackupStorageTestContext,
  createTemporaryStoragePath,
} from './support/storage-test-utils.js';

const BUILD_COMMIT = '7'.repeat(40);
const FIXED_NOW = new Date('2026-08-20T03:04:05.678Z');
const OPERATION_ID = '12345678-1234-4123-8123-123456789abc';
const openDatabases = new Set<DatabaseSync>();

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await cleanTemporaryStorageDirectories();
});

function validManifest(files?: BackupManifestV1['files']): BackupManifestV1 {
  const entries = files ?? [
    {
      category: 'DATABASE' as const,
      relativePath: parseBackupPayloadPath('payload/database/rednote.sqlite', 'DATABASE'),
      sha256: 'a'.repeat(64),
      sizeBytes: 3,
    },
  ];
  return {
    format: 'rednote-controlled-directory-backup',
    backupFormatVersion: 1,
    status: 'COMPLETE',
    createdAt: FIXED_NOW.toISOString(),
    timeZone: 'UTC',
    source: {
      workspaceId: OPERATION_ID,
      appVersion: '0.0.0',
      buildCommit: BUILD_COMMIT,
      dataRootFormat: 'rednote-project-data',
      dataRootVersion: 1,
      v2DataVersion: 1,
      schemaVersion: 27,
      migrationFingerprint: 'b'.repeat(64),
    },
    compatibilityPolicyVersion: 1,
    files: entries,
    totals: {
      fileCount: entries.length,
      sizeBytes: entries.reduce((sum, file) => sum + file.sizeBytes, 0),
    },
  };
}

async function backupContext() {
  const storage = await createBackupStorageTestContext();
  const databasePath = join(storage.root.databaseDirectory, 'rednote.sqlite');
  await initializeDatabase({ databasePath });
  const sourceDatabase = connectDatabase(databasePath);
  openDatabases.add(sourceDatabase);
  const database = {
    createSnapshot: (path: string, signal?: AbortSignal) =>
      createSqliteSnapshot(sourceDatabase, path, signal),
    enumerateManagedFiles: enumerateManagedFileInventory,
    estimateSnapshotBytes: () => estimateSqliteSnapshotBytes(sourceDatabase),
    inspectSnapshot: inspectSqliteSnapshot,
  };
  return { ...storage, database, databasePath, sourceDatabase };
}

function createOptions(context: Awaited<ReturnType<typeof backupContext>>) {
  return {
    appVersion: '0.0.0',
    buildCommit: BUILD_COMMIT,
    database: context.database,
    now: () => FIXED_NOW,
    randomId: () => OPERATION_ID,
    root: context.root,
    selectedBackupRoot: context.backupRoot,
    v2DataVersion: 1,
  } as const;
}

describe('backup manifest v1 and portable payload paths', () => {
  it('round trips canonical bytes and produces a stable manifest hash', () => {
    const first = serializeBackupManifestV1(validManifest());
    const reordered = validManifest();
    const second = serializeBackupManifestV1({
      ...reordered,
      source: {
        migrationFingerprint: reordered.source.migrationFingerprint,
        schemaVersion: reordered.source.schemaVersion,
        v2DataVersion: reordered.source.v2DataVersion,
        dataRootVersion: reordered.source.dataRootVersion,
        dataRootFormat: reordered.source.dataRootFormat,
        buildCommit: reordered.source.buildCommit,
        appVersion: reordered.source.appVersion,
        workspaceId: reordered.source.workspaceId,
      },
    });
    expect(second).toBe(first);
    expect(parseBackupManifestV1(first)).toEqual(validManifest());
    expect(manifestSha256(first)).toBe(createHash('sha256').update(first).digest('hex'));
  });

  it('rejects unknown, missing, wrong-type, duplicate, noncanonical, and oversized manifests', () => {
    const canonical = serializeBackupManifestV1(validManifest());
    const cases: string[] = [];
    for (const mutation of [
      (value: Record<string, unknown>) => Object.assign(value, { unknown: true }),
      (value: Record<string, unknown>) => delete value.status,
      (value: Record<string, unknown>) => Object.assign(value, { backupFormatVersion: '1' }),
    ]) {
      const value = JSON.parse(canonical) as Record<string, unknown>;
      mutation(value);
      cases.push(JSON.stringify(value));
    }
    cases.push(canonical.replace('{', '{ '));
    cases.push(canonical.replace('"format":', '"format":"duplicate","format":'));
    for (const value of cases)
      expect(() => parseBackupManifestV1(value)).toThrow(ControlledBackupError);
    expect(() => parseBackupManifestV1('x'.repeat(BACKUP_MAX_MANIFEST_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    expect(() => parseBackupCompleteMarkerV1('x'.repeat(1025))).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    const invalidUtf8 = Buffer.from(canonical, 'utf8');
    invalidUtf8[canonical.indexOf('0.0.0')] = 0x80;
    expect(() => parseBackupManifestV1(invalidUtf8)).toThrowError(
      expect.objectContaining({ code: 'INVALID_MANIFEST' }),
    );
    expect(() => parseBackupCompleteMarkerV1(Uint8Array.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: 'INVALID_MANIFEST' }),
    );
    expect(() =>
      parseBackupManifestV1(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical)]),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });

  it('enforces file count, per-file, total-size, path-size, ordering, and duplicate bounds', () => {
    const [databaseFile] = validManifest().files;
    if (databaseFile === undefined) throw new Error('Fixture database file missing.');
    expect(() =>
      serializeBackupManifestV1(
        validManifest([{ ...databaseFile, sizeBytes: BACKUP_MAX_FILE_BYTES + 1 }]),
      ),
    ).toThrow();
    const large = Array.from({ length: 13 }, (_, index) => ({
      category: index === 0 ? ('DATABASE' as const) : ('SOURCE_SNAPSHOT' as const),
      relativePath: parseBackupPayloadPath(
        index === 0
          ? 'payload/database/rednote.sqlite'
          : `payload/sources/snapshots/aa/large-${String(index).padStart(2, '0')}`,
      ),
      sha256: index.toString(16).padStart(64, '0'),
      sizeBytes: BACKUP_MAX_FILE_BYTES,
    }));
    expect(() => serializeBackupManifestV1(validManifest(large))).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    expect(BACKUP_MAX_TOTAL_BYTES).toBeLessThan(large.length * BACKUP_MAX_FILE_BYTES);
    expect(() => parseBackupPayloadPath(`payload/imports/${'界'.repeat(400)}`)).toThrow();
    const duplicate = [
      databaseFile,
      {
        category: 'IMPORT' as const,
        relativePath: parseBackupPayloadPath('payload/imports/AA/file'),
        sha256: 'c'.repeat(64),
        sizeBytes: 1,
      },
      {
        category: 'IMPORT' as const,
        relativePath: parseBackupPayloadPath('payload/imports/aa/file'),
        sha256: 'd'.repeat(64),
        sizeBytes: 1,
      },
    ].sort((left, right) => (left.relativePath < right.relativePath ? -1 : 1));
    expect(() => serializeBackupManifestV1(validManifest(duplicate))).toThrow();
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
    'payload/imports/file.',
    'payload/imports/file ',
    'payload/imports/CON.txt',
    'payload/imports/CONIN$',
    'payload/imports/CONOUT$.txt',
    'payload/imports/CLOCK$',
    'payload/imports/CON .txt',
    'payload/imports/NUL .x',
    'payload/imports/\ud800',
    'payload/imports/\udfff',
    `payload/imports/${'a'.repeat(256)}`,
    `payload/imports/${Array.from({ length: 63 }, () => 'd').join('/')}/file`,
    'payload/imports/a\\b',
    'payload/manifest.json',
    'payload/exports/v2/export/file',
    'payload/imports/e\u0301',
  ])('rejects unsafe portable path %s', (path) => {
    expect(() => parseBackupPayloadPath(path)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATH' }),
    );
  });

  it('keeps a valid replacement character distinct from rejected lone surrogates', () => {
    expect(parseBackupPayloadPath('payload/imports/\ufffd')).toBe('payload/imports/\ufffd');
    const manifest = validManifest();
    expect(() =>
      serializeBackupManifestV1({
        ...manifest,
        source: { ...manifest.source, workspaceId: '\ud800' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });
});

describe('SQLite snapshot isolation and secret-bearing capability handling', () => {
  it('backs up an open WAL database consistently and runs full, quick, and FK checks', async () => {
    const context = await backupContext();
    context.sourceDatabase
      .prepare("INSERT INTO account_profiles(id,working_name) VALUES('wal-row','consistent')")
      .run();
    const destination = join(context.backupRoot, 'snapshot.sqlite');
    const identity = await createSqliteSnapshot(context.sourceDatabase, destination);
    expect(identity).toEqual(inspectSqliteSnapshot(destination));
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    expect(
      snapshot.prepare("SELECT working_name FROM account_profiles WHERE id='wal-row'").get(),
    ).toEqual({
      working_name: 'consistent',
    });
    snapshot.close();
    expect(await readdir(context.backupRoot)).toEqual(['snapshot.sqlite']);
  });

  it('never overwrites a pre-existing destination leaf', async () => {
    const context = await backupContext();
    const destination = join(context.backupRoot, 'existing.sqlite');
    await writeFile(destination, 'external-sentinel');
    await expect(createSqliteSnapshot(context.sourceDatabase, destination)).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    expect(await readFile(destination, 'utf8')).toBe('external-sentinel');
  });

  it('rejects a hardlinked leaf and junction parent without touching external data', async () => {
    const context = await backupContext();
    const external = await createTemporaryStoragePath('sqlite destination canary');
    const canary = join(external, 'canary.sqlite');
    await writeFile(canary, 'external-canary');
    const hardlink = join(context.backupRoot, 'hardlink.sqlite');
    await link(canary, hardlink);
    await expect(createSqliteSnapshot(context.sourceDatabase, hardlink)).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    const junction = join(context.backupRoot, 'junction');
    await symlink(external, junction, 'junction');
    await expect(
      createSqliteSnapshot(context.sourceDatabase, join(junction, 'snapshot.sqlite')),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(await readFile(canary, 'utf8')).toBe('external-canary');
    expect((await readdir(external)).sort()).toEqual(['canary.sqlite']);
  });

  it('maps corrupt SQLite open failures to a path-free stable code', async () => {
    const context = await backupContext();
    const path = join(context.backupRoot, 'corrupt.sqlite');
    await writeFile(path, 'not-a-sqlite-database');
    let failure: unknown;
    try {
      inspectSqliteSnapshot(path);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'INTEGRITY_FAILED' });
    expect(JSON.stringify(failure)).not.toContain(context.backupRoot);
  });

  it('revokes and overwrites local API token digests only in the isolated snapshot', async () => {
    const context = await backupContext();
    const digest = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 97));
    context.sourceDatabase
      .prepare(
        `INSERT INTO local_api_clients(
           id,extension_origin,client_label,token_digest,created_at,updated_at,revision
         ) VALUES(?,?,?,?,?,?,0)`,
      )
      .run(
        'client-r10b1',
        `chrome-extension://${'a'.repeat(32)}`,
        'Synthetic client',
        digest,
        FIXED_NOW.toISOString(),
        FIXED_NOW.toISOString(),
      );
    const destination = join(context.backupRoot, 'sanitized.sqlite');
    await createSqliteSnapshot(context.sourceDatabase, destination);
    const source = context.sourceDatabase
      .prepare("SELECT token_digest,revoked_at FROM local_api_clients WHERE id='client-r10b1'")
      .get() as { readonly revoked_at: string | null; readonly token_digest: Uint8Array };
    expect(Buffer.from(source.token_digest)).toEqual(digest);
    expect(source.revoked_at).toBeNull();
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    const isolated = snapshot
      .prepare("SELECT token_digest,revoked_at FROM local_api_clients WHERE id='client-r10b1'")
      .get() as { readonly revoked_at: string | null; readonly token_digest: Uint8Array };
    snapshot.close();
    expect(Buffer.from(isolated.token_digest)).not.toEqual(digest);
    expect(isolated.revoked_at).toBe(FIXED_NOW.toISOString());
    expect((await readFile(destination)).indexOf(digest)).toBe(-1);
  });

  it('removes machine-local model cache rows only from the isolated snapshot', async () => {
    const context = await backupContext();
    const hash = 'a'.repeat(64);
    const canary = `cache/model-results/aa/R10B1_MACHINE_LOCAL_CANARY-${hash}.json`;
    context.sourceDatabase
      .prepare(
        `INSERT INTO model_cache_entries(
          id,cache_key,status,output_type,managed_relative_path,content_hash,output_hash,
          size_bytes,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'cache-r10b1',
        hash,
        'READY',
        'TEXT',
        canary,
        hash,
        hash,
        7,
        FIXED_NOW.toISOString(),
        FIXED_NOW.toISOString(),
      );
    const destination = join(context.backupRoot, 'cache-sanitized.sqlite');
    await createSqliteSnapshot(context.sourceDatabase, destination);
    expect(
      context.sourceDatabase
        .prepare("SELECT id FROM model_cache_entries WHERE id='cache-r10b1'")
        .get(),
    ).toEqual({ id: 'cache-r10b1' });
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    expect(snapshot.prepare('SELECT 1 FROM model_cache_entries').get()).toBeUndefined();
    snapshot.close();
    expect((await readFile(destination)).indexOf(Buffer.from(canary))).toBe(-1);
  });

  it('blocks snapshot creation while a model-cache lease is active', async () => {
    const context = await backupContext();
    context.sourceDatabase
      .prepare(
        `INSERT INTO model_cache_entries(
          id,cache_key,status,owner_token_hash,lease_expires_at,last_heartbeat_at,
          created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        'cache-lease-r10b1',
        'b'.repeat(64),
        'IN_FLIGHT',
        'c'.repeat(64),
        '2026-08-20T04:04:05.678Z',
        FIXED_NOW.toISOString(),
        FIXED_NOW.toISOString(),
        FIXED_NOW.toISOString(),
      );
    const destination = join(context.backupRoot, 'active-cache-must-not-exist.sqlite');
    await expect(createSqliteSnapshot(context.sourceDatabase, destination)).rejects.toMatchObject({
      code: 'MAINTENANCE_REQUIRED',
    });
    expect(await readdir(context.backupRoot)).toEqual([]);
    expect(
      context.sourceDatabase
        .prepare("SELECT status FROM model_cache_entries WHERE id='cache-lease-r10b1'")
        .get(),
    ).toEqual({ status: 'IN_FLIGHT' });
  });

  it('fails closed on an active job lease and removes the unpublished snapshot', async () => {
    const context = await backupContext();
    const registry = new JobHandlerRegistry();
    registry.register('R10B_JOB', async (payload) => payload);
    let id = 0;
    const service = new JobQueueService(new JobQueueRepository(context.sourceDatabase), registry, {
      backoffPolicy: new ExponentialBackoffPolicy({
        baseDelayMilliseconds: 1000,
        jitterRatio: 0,
        maxDelayMilliseconds: 1000,
      }),
      clock: { now: () => FIXED_NOW },
      idFactory: () => `r10b-${++id}`,
    });
    service.enqueueJob({
      idempotencyKey: 'r10b-job',
      jobType: 'R10B_JOB',
      maxAttempts: 1,
      payload: {},
      priority: 0,
    });
    const claimed = service.claimNextJob('r10b-worker');
    const destination = join(context.backupRoot, 'must-not-exist.sqlite');
    await expect(createSqliteSnapshot(context.sourceDatabase, destination)).rejects.toMatchObject({
      code: 'MAINTENANCE_REQUIRED',
      message: 'MAINTENANCE_REQUIRED',
    });
    expect(await readdir(context.backupRoot)).toEqual([]);
    expect(claimed?.leaseToken).toBeTruthy();
    expect(JSON.stringify(claimed)).not.toContain(context.rootPath);
  });
});

function createInventorySchema(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE sources(local_snapshot_path TEXT);
    CREATE TABLE fetched_documents(
      sanitized_html_path TEXT,sanitized_html_hash TEXT,sanitized_html_bytes INTEGER,
      extracted_text_path TEXT,extracted_text_hash TEXT,extracted_text_bytes INTEGER
    );
    CREATE TABLE source_revisions(extracted_text_path TEXT,extracted_text_hash TEXT);
    CREATE TABLE clips(screenshot_path TEXT,screenshot_hash TEXT,screenshot_bytes INTEGER);
    CREATE TABLE assets(original_path TEXT,processed_path TEXT);
    CREATE TABLE metric_snapshots(import_file_path TEXT);
    CREATE TABLE v2_content_package_versions(
      generated_cover_path TEXT,generated_cover_sha256 TEXT,files_json TEXT
    );
    CREATE TABLE v2_interaction_items(
      user_text_path TEXT,user_text_sha256 TEXT,user_text_size_bytes INTEGER,status TEXT
    );
    CREATE TABLE v2_reply_suggestion_versions(
      reply_path TEXT,reply_sha256 TEXT,reply_size_bytes INTEGER,version INTEGER
    );
    CREATE TABLE post_packages(export_path TEXT);
    CREATE TABLE model_cache_entries(managed_relative_path TEXT);
  `);
  return database;
}

function contentRefs(seed: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const sha256 = (seed + index).toString(16).padStart(64, '0');
    return { managedPath: `exports/${sha256.slice(0, 2)}/${sha256}`, sha256, sizeBytes: index + 1 };
  });
}

function mutateFirstContentRef(mutation: Readonly<Record<string, unknown>>) {
  const [first, ...rest] = contentRefs(1);
  if (first === undefined) throw new Error('Fixture content reference missing.');
  return [{ ...first, ...mutation }, ...rest];
}

describe('managed file inventory', () => {
  it('enumerates every authoritative field and all V2 history while excluding derived paths', async () => {
    const root = await createTemporaryStoragePath('inventory');
    const path = join(root, 'inventory.sqlite');
    const database = createInventorySchema(path);
    const direct = [
      ['sources', 'local_snapshot_path', 'sources/snapshots/aa/source'],
      ['fetched_documents', 'sanitized_html_path', 'sources/snapshots/aa/html'],
      ['fetched_documents', 'extracted_text_path', 'sources/snapshots/aa/text'],
      ['source_revisions', 'extracted_text_path', 'sources/snapshots/aa/revision'],
      ['clips', 'screenshot_path', 'sources/screenshots/bb/clip'],
      ['assets', 'original_path', 'photos/originals/cc/original'],
      ['assets', 'processed_path', 'photos/processed/dd/processed'],
      ['metric_snapshots', 'import_file_path', 'imports/ee/metric'],
      [
        'v2_content_package_versions',
        'generated_cover_path',
        `generated-images/ff/${'f'.repeat(64)}`,
      ],
      ['v2_interaction_items', 'user_text_path', 'imports/interaction/deleted'],
      ['v2_reply_suggestion_versions', 'reply_path', 'imports/replies/version-1'],
      ['v2_reply_suggestion_versions', 'reply_path', 'imports/replies/version-2'],
    ] as const;
    for (const [table, column, value] of direct)
      database.prepare(`INSERT INTO ${table}(${column}) VALUES(?)`).run(value);
    const sha = 'f'.repeat(64);
    database.exec(`
      UPDATE fetched_documents SET sanitized_html_hash='${sha}',sanitized_html_bytes=1,
        extracted_text_hash='${sha}',extracted_text_bytes=1;
      UPDATE source_revisions SET extracted_text_hash='${sha}';
      UPDATE clips SET screenshot_hash='${sha}',screenshot_bytes=1;
      UPDATE v2_content_package_versions SET generated_cover_sha256='${sha}';
      UPDATE v2_interaction_items SET user_text_sha256='${sha}',user_text_size_bytes=1;
      UPDATE v2_reply_suggestion_versions SET reply_sha256='${sha}',reply_size_bytes=1;
    `);
    const refs = [...contentRefs(1), ...contentRefs(32)];
    database
      .prepare('UPDATE v2_content_package_versions SET files_json=?')
      .run(JSON.stringify(refs.slice(0, 6)));
    database
      .prepare('INSERT INTO v2_content_package_versions(files_json) VALUES(?)')
      .run(JSON.stringify(refs.slice(6)));
    database.prepare("INSERT INTO post_packages VALUES('exports/v2/derived/package')").run();
    database
      .prepare("INSERT INTO model_cache_entries VALUES('cache/model-results/aa/cache')")
      .run();
    database.close();
    const inventory = enumerateManagedFileInventory(path);
    expect(inventory.map(({ managedPath }) => managedPath)).toEqual(
      [...direct.map((entry) => entry[2]), ...refs.map((ref) => ref.managedPath)].sort(),
    );
    expect(inventory.map(({ managedPath }) => managedPath).join('\n')).not.toMatch(
      /exports\/v2|cache\/model-results/u,
    );
    expect(inventory.find(({ managedPath }) => managedPath === refs[0]?.managedPath)).toMatchObject(
      {
        expectedSha256: refs[0]?.sha256,
        expectedSizeBytes: refs[0]?.sizeBytes,
      },
    );
    expect(
      inventory.find(({ managedPath }) => managedPath === 'sources/screenshots/bb/clip'),
    ).toMatchObject({ expectedSha256: sha, expectedSizeBytes: 1 });
  });

  it('rejects missing declared metadata and non-local SQLite path syntax before opening', async () => {
    for (const value of [
      '\\\\server\\share\\snapshot.sqlite',
      '\\\\?\\C:\\snapshot.sqlite',
      '\\rooted.sqlite',
      'C:\\snapshot.sqlite:ads',
    ])
      expect(() => enumerateManagedFileInventory(value)).toThrowError(
        expect.objectContaining({ code: 'SNAPSHOT_INVALID' }),
      );
    const root = await createTemporaryStoragePath('missing declared metadata');
    const path = join(root, 'missing.sqlite');
    const database = createInventorySchema(path);
    database
      .prepare("INSERT INTO clips(screenshot_path) VALUES('sources/screenshots/aa/clip')")
      .run();
    database.close();
    expect(() => enumerateManagedFileInventory(path)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REFERENCE' }),
    );
  });

  it('rejects a hardlinked SQLite inventory without opening either peer', async () => {
    const root = await createTemporaryStoragePath('inventory hardlink');
    const path = join(root, 'inventory.sqlite');
    createInventorySchema(path).close();
    const peer = join(root, 'peer.sqlite');
    await link(path, peer);
    expect(() => enumerateManagedFileInventory(path)).toThrowError(
      expect.objectContaining({ code: 'SNAPSHOT_INVALID' }),
    );
  });

  it.each([
    { refs: mutateFirstContentRef({ managedPath: 'imports/not-export' }) },
    { refs: mutateFirstContentRef({ sha256: 'b'.repeat(64) }) },
    { refs: mutateFirstContentRef({ extra: true }) },
    { refs: contentRefs(1).slice(0, 5) },
  ])('fails closed for corrupt V2 six-field references', async ({ refs }) => {
    const root = await createTemporaryStoragePath('bad inventory');
    const path = join(root, 'bad.sqlite');
    const database = createInventorySchema(path);
    database
      .prepare('INSERT INTO v2_content_package_versions(files_json) VALUES(?)')
      .run(JSON.stringify(refs));
    database.close();
    expect(() => enumerateManagedFileInventory(path)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REFERENCE' }),
    );
  });

  it('bounds duplicate raw inventory references independently of unique files', async () => {
    const root = await createTemporaryStoragePath('duplicate inventory references');
    const path = join(root, 'duplicates.sqlite');
    const database = createInventorySchema(path);
    database.exec(`
      WITH RECURSIVE refs(value) AS (
        VALUES(1) UNION ALL SELECT value + 1 FROM refs
        WHERE value <= ${MANAGED_BACKUP_INVENTORY_MAX_REFERENCES}
      )
      INSERT INTO sources(local_snapshot_path)
      SELECT 'sources/snapshots/aa/duplicate' FROM refs;
    `);
    database.close();
    expect(() => enumerateManagedFileInventory(path)).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
  });
});

describe('controlled snapshot creation, verification, and cleanup', () => {
  it('rejects an impossible snapshot estimate before invoking the snapshot writer', async () => {
    const context = await backupContext();
    let invoked = false;
    const database = {
      ...context.database,
      estimateSnapshotBytes: () => BACKUP_MAX_FILE_BYTES + 1,
      createSnapshot: async () => {
        invoked = true;
        throw new Error('must not run');
      },
    };
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), database }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(invoked).toBe(false);
    expect(await readdir(context.backupRoot)).toEqual([]);
  });
  it('publishes one verified backup from explicit DB references and excludes canaries', async () => {
    const context = await backupContext();
    const managed = await context.repository.putBuffer(Buffer.from('managed evidence'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'evidence.txt',
    });
    context.sourceDatabase
      .prepare(
        `INSERT INTO sources(id,url,title,source_tier,source_type,retrieved_at,content_hash,
          local_snapshot_path,language) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'r10b-source',
        'https://example.test/r10b',
        'Synthetic',
        'PRIMARY',
        'WEB',
        FIXED_NOW.toISOString(),
        'synthetic-hash',
        managed.managedPath,
        'zh-CN',
      );
    const canary = 'SYNTHETIC_SECRET_PROMPT_RESPONSE_CANARY';
    await writeFile(join(context.rootPath, 'logs', 'excluded.log'), canary);
    await writeFile(join(context.rootPath, 'cache', 'model-results', 'excluded.cache'), canary);
    await mkdir(join(context.rootPath, 'exports', 'diagnostics'));
    await writeFile(join(context.rootPath, 'exports', 'diagnostics', 'excluded.json'), canary);
    const external = join(await createTemporaryStoragePath('external canary'), 'outside.txt');
    await writeFile(external, canary);
    const result = await createControlledBackupSnapshot(createOptions(context));
    const directory = join(context.backupRoot, result.backupName);
    const verified = await verifyControlledBackupSnapshot({
      backupDirectory: directory,
      database: context.database,
    });
    expect(verified.manifest.files.map(({ relativePath }) => relativePath)).toEqual([
      'payload/database/rednote.sqlite',
      `payload/${managed.managedPath}`,
    ]);
    expect(JSON.stringify(verified)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toContain(context.rootPath);
    expect(['SYNC_REQUESTS_COMPLETED', 'DIRECTORY_SYNC_UNAVAILABLE']).toContain(result.durability);
    expect((await readdir(directory)).sort()).toEqual([
      'COMPLETE.json',
      'manifest.json',
      'payload',
    ]);
    expect(await readdir(context.backupRoot)).toEqual([result.backupName]);
  });

  it('binds declared content hash and size before publishing', async () => {
    const context = await backupContext();
    const declaredHash = 'a'.repeat(64);
    const managedPath = `exports/aa/${declaredHash}`;
    await mkdir(join(context.rootPath, 'exports', 'aa'));
    await writeFile(join(context.rootPath, ...managedPath.split('/')), 'tampered');
    const database = {
      ...context.database,
      enumerateManagedFiles: () => [
        {
          category: 'EXPORT' as const,
          expectedSha256: declaredHash,
          expectedSizeBytes: 8,
          managedPath,
        },
      ],
    };
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), database }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    expect(await readdir(context.backupRoot)).toEqual([]);
  });

  it('rejects a managed hardlink without touching its external peer', async () => {
    const context = await backupContext();
    const externalRoot = await createTemporaryStoragePath('hardlink canary');
    const external = join(externalRoot, 'outside.txt');
    await writeFile(external, 'outside-canary');
    const managedPath = 'imports/hardlink.txt';
    await link(external, join(context.rootPath, ...managedPath.split('/')));
    const database = {
      ...context.database,
      enumerateManagedFiles: () => [
        {
          category: 'IMPORT' as const,
          expectedSha256: null,
          expectedSizeBytes: null,
          managedPath,
        },
      ],
    };
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), database }),
    ).rejects.toMatchObject({ code: 'PATH_LINK_NOT_ALLOWED' });
    expect(await readFile(external, 'utf8')).toBe('outside-canary');
  });

  it('rehashes after database inspection and rejects a late payload mutation', async () => {
    const context = await backupContext();
    const managed = await context.repository.putBuffer(Buffer.from('original managed bytes'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'late-mutation.txt',
    });
    context.sourceDatabase
      .prepare(
        `INSERT INTO sources(id,url,title,source_tier,source_type,retrieved_at,content_hash,
          local_snapshot_path,language) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'late-mutation',
        'https://example.test/late-mutation',
        'Late mutation',
        'PRIMARY',
        'WEB',
        FIXED_NOW.toISOString(),
        'synthetic',
        managed.managedPath,
        'zh-CN',
      );
    const result = await createControlledBackupSnapshot(createOptions(context));
    const directory = join(context.backupRoot, result.backupName);
    const payloadFile = join(directory, 'payload', ...managed.managedPath.split('/'));
    const database = {
      ...context.database,
      inspectSnapshot: async (path: string) => {
        const identity = inspectSqliteSnapshot(path);
        await writeFile(payloadFile, 'changed after the old verifier hash pass');
        return identity;
      },
    };
    await expect(
      verifyControlledBackupSnapshot({ backupDirectory: directory, database }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
  });

  it('rejects excessive empty-directory depth during verification', async () => {
    const context = await backupContext();
    const result = await createControlledBackupSnapshot(createOptions(context));
    const directory = join(context.backupRoot, result.backupName);
    await mkdir(join(directory, 'payload', ...Array.from({ length: 65 }, () => 'd')), {
      recursive: true,
    });
    await expect(
      verifyControlledBackupSnapshot({ backupDirectory: directory, database: context.database }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it.each(['same', 'destination-inside-source', 'source-inside-destination'])(
    'rejects source/destination containment: %s',
    async (mode) => {
      const context = await backupContext();
      const selectedBackupRoot =
        mode === 'same'
          ? context.rootPath
          : mode === 'destination-inside-source'
            ? join(context.rootPath, 'backups')
            : dirname(context.rootPath);
      await expect(
        createControlledBackupSnapshot({ ...createOptions(context), selectedBackupRoot }),
      ).rejects.toMatchObject({ code: 'PATH_CONFLICT' });
    },
  );

  it('rejects a junction escape before copying an explicitly referenced file', async () => {
    const context = await backupContext();
    const external = await createTemporaryStoragePath('junction target');
    await writeFile(join(external, 'canary.txt'), 'must stay outside');
    await symlink(external, join(context.rootPath, 'imports', 'link'), 'junction');
    const database = {
      ...context.database,
      enumerateManagedFiles: () => [
        {
          category: 'IMPORT' as const,
          expectedSha256: null,
          expectedSizeBytes: null,
          managedPath: 'imports/link/canary.txt',
        },
      ],
    };
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), database }),
    ).rejects.toMatchObject({ code: 'PATH_LINK_NOT_ALLOWED' });
    expect(await readdir(context.backupRoot)).toEqual([]);
  });

  it('detects extra, missing, manifest, and completion-marker tampering', async () => {
    const context = await backupContext();
    const result = await createControlledBackupSnapshot(createOptions(context));
    const directory = join(context.backupRoot, result.backupName);
    const manifestPath = join(directory, 'manifest.json');
    const completePath = join(directory, 'COMPLETE.json');
    const databasePath = join(directory, 'payload', 'database', 'rednote.sqlite');
    const manifest = await readFile(manifestPath, 'utf8');
    const complete = await readFile(completePath, 'utf8');
    await writeFile(manifestPath, `${manifest} `);
    await expect(
      verifyControlledBackupSnapshot({ backupDirectory: directory, database: context.database }),
    ).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
    await writeFile(manifestPath, manifest);
    await writeFile(completePath, '{}');
    await expect(
      verifyControlledBackupSnapshot({ backupDirectory: directory, database: context.database }),
    ).rejects.toBeInstanceOf(ControlledBackupError);
    await writeFile(completePath, complete);
    await mkdir(join(directory, 'payload', 'imports'));
    await writeFile(join(directory, 'payload', 'imports', 'extra'), 'extra');
    await expect(
      verifyControlledBackupSnapshot({ backupDirectory: directory, database: context.database }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    await unlink(join(directory, 'payload', 'imports', 'extra'));
    await rmdir(join(directory, 'payload', 'imports'));
    await rename(databasePath, `${databasePath}.missing`);
    await expect(
      verifyControlledBackupSnapshot({ backupDirectory: directory, database: context.database }),
    ).rejects.toBeInstanceOf(ControlledBackupError);
  });

  it('checks space, aborts before publish, and cleans only the exact owned staging', async () => {
    expect(() => assertBackupCapacity(1n, 1)).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_SPACE' }),
    );
    const context = await backupContext();
    const sentinel = join(context.backupRoot, 'keep.txt');
    const similar = join(context.backupRoot, `.rednote-backup-staging-v1-${OPERATION_ID}-similar`);
    await writeFile(sentinel, 'keep');
    await mkdir(similar);
    const controller = new AbortController();
    const database = {
      ...context.database,
      enumerateManagedFiles: (path: string) => {
        controller.abort();
        return enumerateManagedFileInventory(path);
      },
    };
    await expect(
      createControlledBackupSnapshot({
        ...createOptions(context),
        database,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect((await readdir(context.backupRoot)).sort()).toEqual([
      `.rednote-backup-staging-v1-${OPERATION_ID}-similar`,
      'keep.txt',
    ]);
  });

  it('restores ownership and cleans staging when cancellation arrives after owner removal', async () => {
    const context = await backupContext();
    const owner = join(
      context.backupRoot,
      `.rednote-backup-staging-v1-${OPERATION_ID}`,
      '.rednote-backup-owner.json',
    );
    let seenOwner = false;
    const signal = {
      get aborted() {
        if (existsSync(owner)) seenOwner = true;
        return seenOwner && !existsSync(owner);
      },
    } as unknown as AbortSignal;
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(await readdir(context.backupRoot)).toEqual([]);
  });

  it('restores ownership and cleans staging when rename loses a destination race', async () => {
    const context = await backupContext();
    const staging = join(context.backupRoot, `.rednote-backup-staging-v1-${OPERATION_ID}`);
    const owner = join(staging, '.rednote-backup-owner.json');
    const finalName = `rednote-backup-v1-${FIXED_NOW.toISOString().replaceAll('-', '').replaceAll(':', '')}-${OPERATION_ID.replaceAll('-', '').slice(0, 12)}`;
    let seenOwner = false;
    const signal = {
      get aborted() {
        if (existsSync(owner)) seenOwner = true;
        if (seenOwner && !existsSync(owner) && !existsSync(join(context.backupRoot, finalName)))
          mkdirSync(join(context.backupRoot, finalName));
        return false;
      },
    } as unknown as AbortSignal;
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), signal }),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(await readdir(context.backupRoot)).toEqual([finalName]);
  });

  it('does not delete a staging directory after its ownership marker is forged', async () => {
    const context = await backupContext();
    const database = {
      ...context.database,
      createSnapshot: async (destination: string) => {
        const staging = dirname(dirname(dirname(destination)));
        await writeFile(join(staging, '.rednote-backup-owner.json'), '{"forged":true}');
        throw new Error(`permission denied at ${context.rootPath}`);
      },
    };
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), database }),
    ).rejects.toMatchObject({ code: 'STAGING_OWNERSHIP_INVALID' });
    expect(await readdir(context.backupRoot)).toEqual([
      `.rednote-backup-staging-v1-${OPERATION_ID}`,
    ]);
  });

  it('preserves the entire staging tree when an unregistered entry appears', async () => {
    const context = await backupContext();
    const database = {
      ...context.database,
      createSnapshot: async (destination: string) => {
        const staging = dirname(dirname(dirname(destination)));
        await writeFile(join(staging, 'unexpected-entry'), 'not owned by the operation ledger');
        throw new Error('synthetic adapter failure');
      },
    };
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), database }),
    ).rejects.toMatchObject({ code: 'STAGING_OWNERSHIP_INVALID' });
    const staging = join(context.backupRoot, `.rednote-backup-staging-v1-${OPERATION_ID}`);
    expect((await readdir(staging)).sort()).toEqual([
      '.rednote-backup-owner.json',
      'payload',
      'unexpected-entry',
    ]);
  });

  it('deletes nothing when an owned staging leaf is replaced before cleanup', async () => {
    const context = await backupContext();
    let replacement = '';
    const database = {
      ...context.database,
      enumerateManagedFiles: async (path: string) => {
        replacement = path;
        await unlink(path);
        await writeFile(path, 'replacement-not-owned-by-ledger');
        throw new Error('synthetic failure after replacement');
      },
    };
    await expect(
      createControlledBackupSnapshot({ ...createOptions(context), database }),
    ).rejects.toMatchObject({ code: 'STAGING_OWNERSHIP_INVALID' });
    expect(await readFile(replacement, 'utf8')).toBe('replacement-not-owned-by-ledger');
    expect(
      await readFile(
        join(dirname(dirname(dirname(replacement))), '.rednote-backup-owner.json'),
        'utf8',
      ),
    ).toContain(OPERATION_ID);
  });

  it('maps adapter failures to path-free errors and preserves existing final backups', async () => {
    const context = await backupContext();
    const finalName = `rednote-backup-v1-${FIXED_NOW.toISOString().replaceAll('-', '').replaceAll(':', '')}-${OPERATION_ID.replaceAll('-', '').slice(0, 12)}`;
    let first = true;
    const database = {
      ...context.database,
      enumerateManagedFiles: (path: string) => {
        if (first) {
          first = false;
          return mkdir(join(context.backupRoot, finalName)).then(() =>
            enumerateManagedFileInventory(path),
          );
        }
        return enumerateManagedFileInventory(path);
      },
    };
    let failure: unknown;
    try {
      await createControlledBackupSnapshot({ ...createOptions(context), database });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'ALREADY_EXISTS', message: 'ALREADY_EXISTS' });
    expect(JSON.stringify(failure)).not.toContain(context.rootPath);
    expect(await readdir(context.backupRoot)).toEqual([finalName]);
  });
});
