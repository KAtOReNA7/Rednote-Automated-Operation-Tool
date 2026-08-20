import { createHash } from 'node:crypto';
import { existsSync, linkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MANAGED_FILE_INVENTORY_MAX_REFERENCES,
  MIGRATIONS,
  connectDatabase,
  createSqliteSnapshot,
  enumerateManagedFileInventory,
  estimateSqliteSnapshotBytes,
  initializeDatabase,
  inspectSqliteSnapshot,
  migrationChecksum,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

const NOW = '2026-08-20T03:04:05.678Z';
const openDatabases = new Set<DatabaseSync>();

afterEach(() => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  cleanTemporaryDatabases();
});

function sha(seed: number): string {
  return seed.toString(16).padStart(64, '0');
}

function remember(database: DatabaseSync): DatabaseSync {
  openDatabases.add(database);
  return database;
}

async function currentSource(): Promise<{
  readonly destination: string;
  readonly source: DatabaseSync;
}> {
  const sourcePath = createTemporaryDatabasePath('snapshot source');
  await initializeDatabase({ databasePath: sourcePath });
  return {
    destination: join(sourcePath, '..', 'snapshot.sqlite'),
    source: remember(connectDatabase(sourcePath)),
  };
}

function createInventorySource(path: string): DatabaseSync {
  const database = remember(new DatabaseSync(path));
  database.exec(`
    CREATE TABLE schema_migrations(version INTEGER, name TEXT, checksum TEXT);
    CREATE TABLE jobs(lease_token TEXT);
    CREATE TABLE local_api_clients(token_digest BLOB, revoked_at TEXT, updated_at TEXT, revision INTEGER);
    CREATE TABLE model_cache_entries(status TEXT, owner_token_hash TEXT, lease_expires_at TEXT, payload TEXT);
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
    CREATE TABLE v2_interaction_items(user_text_path TEXT,user_text_sha256 TEXT,user_text_size_bytes INTEGER);
    CREATE TABLE v2_reply_suggestion_versions(reply_path TEXT,reply_sha256 TEXT,reply_size_bytes INTEGER);
  `);
  const insert = database.prepare(
    'INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)',
  );
  for (const migration of MIGRATIONS)
    insert.run(migration.version, migration.name, migrationChecksum(migration));
  return database;
}

async function inventorySnapshot(): Promise<{
  readonly destination: string;
  readonly source: DatabaseSync;
}> {
  const sourcePath = createTemporaryDatabasePath('inventory source');
  const source = createInventorySource(sourcePath);
  const destination = join(sourcePath, '..', 'inventory.sqlite');
  await createSqliteSnapshot(source, destination);
  return { destination, source };
}

function contentReferences(): readonly {
  readonly managedPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}[] {
  return Object.freeze(
    Array.from({ length: 6 }, (_, index) => {
      const hash = sha(index + 30);
      return Object.freeze({
        managedPath: `exports/${hash.slice(0, 2)}/${hash}`,
        sha256: hash,
        sizeBytes: index + 1,
      });
    }),
  );
}

function populateAuthoritativeReferences(database: DatabaseSync): readonly string[] {
  const direct = [
    ['sources', 'local_snapshot_path', 'sources/snapshots/aa/source', null, null],
    ['fetched_documents', 'sanitized_html_path', 'sources/snapshots/ab/html', sha(1), 1],
    ['fetched_documents', 'extracted_text_path', 'sources/snapshots/ac/text', sha(2), 2],
    ['source_revisions', 'extracted_text_path', 'sources/snapshots/ad/revision', sha(3), null],
    ['clips', 'screenshot_path', 'sources/screenshots/ae/clip', sha(4), 4],
    ['assets', 'original_path', 'photos/originals/af/original', null, null],
    ['assets', 'processed_path', 'photos/processed/b0/processed', null, null],
    ['metric_snapshots', 'import_file_path', 'imports/b1/metric', null, null],
    [
      'v2_content_package_versions',
      'generated_cover_path',
      `generated-images/${sha(5).slice(0, 2)}/${sha(5)}`,
      sha(5),
      null,
    ],
    ['v2_interaction_items', 'user_text_path', 'imports/b2/user', sha(6), 6],
    ['v2_reply_suggestion_versions', 'reply_path', 'imports/b3/reply', sha(7), 7],
  ] as const;
  for (const [table, column, path, hash, size] of direct) {
    const hashColumn =
      table === 'fetched_documents'
        ? column.startsWith('sanitized')
          ? 'sanitized_html_hash'
          : 'extracted_text_hash'
        : table === 'source_revisions'
          ? 'extracted_text_hash'
          : table === 'clips'
            ? 'screenshot_hash'
            : table === 'v2_content_package_versions'
              ? 'generated_cover_sha256'
              : table === 'v2_interaction_items'
                ? 'user_text_sha256'
                : table === 'v2_reply_suggestion_versions'
                  ? 'reply_sha256'
                  : null;
    const sizeColumn =
      table === 'fetched_documents'
        ? column.startsWith('sanitized')
          ? 'sanitized_html_bytes'
          : 'extracted_text_bytes'
        : table === 'clips'
          ? 'screenshot_bytes'
          : table === 'v2_interaction_items'
            ? 'user_text_size_bytes'
            : table === 'v2_reply_suggestion_versions'
              ? 'reply_size_bytes'
              : null;
    const columns = [
      column,
      ...(hashColumn === null ? [] : [hashColumn]),
      ...(sizeColumn === null ? [] : [sizeColumn]),
    ];
    database
      .prepare(
        `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
      )
      .run(path, ...(hashColumn === null ? [] : [hash]), ...(sizeColumn === null ? [] : [size]));
  }
  const refs = contentReferences();
  database.prepare('UPDATE v2_content_package_versions SET files_json=?').run(JSON.stringify(refs));
  if (
    database.prepare('SELECT changes() AS count').get() !== undefined &&
    database.prepare('SELECT count(*) AS count FROM v2_content_package_versions').get() ===
      undefined
  )
    throw new Error('unreachable fixture guard');
  return [...direct.map((entry) => entry[2]), ...refs.map((entry) => entry.managedPath)];
}

describe('R10B1B isolated SQLite snapshot', () => {
  it('captures committed WAL data without copying WAL or mutating the source', async () => {
    const { destination, source } = await currentSource();
    source.exec('PRAGMA journal_mode=WAL');
    source
      .prepare("INSERT INTO account_profiles(id,working_name) VALUES('r10b1b-wal','consistent')")
      .run();
    const identity = await createSqliteSnapshot(source, destination);
    expect(identity).toEqual(inspectSqliteSnapshot(destination));
    const snapshot = remember(new DatabaseSync(destination, { readOnly: true }));
    expect(
      snapshot.prepare("SELECT working_name FROM account_profiles WHERE id='r10b1b-wal'").get(),
    ).toEqual({ working_name: 'consistent' });
    expect(
      source.prepare("SELECT working_name FROM account_profiles WHERE id='r10b1b-wal'").get(),
    ).toEqual({ working_name: 'consistent' });
    expect(existsSync(`${destination}-wal`)).toBe(false);
    expect(existsSync(`${destination}-shm`)).toBe(false);
  });

  it('never overwrites a pre-existing target and maps aborts to stable errors', async () => {
    const { destination, source } = await currentSource();
    await createSqliteSnapshot(source, destination);
    await expect(createSqliteSnapshot(source, destination)).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    const aborted = new AbortController();
    aborted.abort();
    const other = join(destination, '..', 'aborted.sqlite');
    await expect(createSqliteSnapshot(source, other, aborted.signal)).rejects.toMatchObject({
      code: 'ABORTED',
    });
    expect(existsSync(other)).toBe(false);
  });

  it('maps a closed source to a path-free stable failure without creating its target', async () => {
    const { destination, source } = await currentSource();
    const target = join(destination, '..', 'source-canary.sqlite');
    source.close();
    openDatabases.delete(source);
    let failure: unknown;
    try {
      await createSqliteSnapshot(source, target);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'SNAPSHOT_FAILED', message: 'SNAPSHOT_FAILED' });
    expect((failure as Error).stack).toBeUndefined();
    expect(String(failure)).not.toContain('source-canary');
    expect(String(failure)).not.toContain('PRAGMA');
    expect(existsSync(target)).toBe(false);
  });

  it('removes only local authorization/cache state from the isolated target', async () => {
    const { destination, source } = await inventorySnapshot();
    const digest = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
    source
      .prepare(
        'INSERT INTO local_api_clients(token_digest,revoked_at,updated_at,revision) VALUES(?,?,?,?)',
      )
      .run(digest, null, NOW, 0);
    source
      .prepare(
        'INSERT INTO model_cache_entries(status,owner_token_hash,lease_expires_at,payload) VALUES(?,?,?,?)',
      )
      .run('READY', null, null, 'SYNTHETIC_CACHE_CANARY');
    const sanitized = join(destination, '..', 'sanitized.sqlite');
    await createSqliteSnapshot(source, sanitized);
    expect(source.prepare('SELECT count(*) AS count FROM model_cache_entries').get()).toEqual({
      count: 1,
    });
    const snapshot = remember(new DatabaseSync(sanitized, { readOnly: true }));
    expect(snapshot.prepare('SELECT count(*) AS count FROM model_cache_entries').get()).toEqual({
      count: 0,
    });
    expect(snapshot.prepare('SELECT revoked_at FROM local_api_clients').get()).toEqual({
      revoked_at: NOW,
    });
    expect(readFileSync(sanitized).includes(digest)).toBe(false);
    expect(readFileSync(sanitized, 'utf8')).not.toContain('SYNTHETIC_CACHE_CANARY');
  }, 15_000);

  it.each([
    ['jobs', "INSERT INTO jobs(lease_token) VALUES('lease')"],
    [
      'model cache',
      "INSERT INTO model_cache_entries(status,owner_token_hash,lease_expires_at,payload) VALUES('IN_FLIGHT','a','2026-08-20T04:04:05.678Z','x')",
    ],
  ])('requires maintenance when %s has an active lease', async (_name, statement) => {
    const sourcePath = createTemporaryDatabasePath('active lease source');
    const source = createInventorySource(sourcePath);
    source.exec(statement);
    const blockedTarget = join(sourcePath, '..', `blocked-${_name}.sqlite`);
    await expect(createSqliteSnapshot(source, blockedTarget)).rejects.toMatchObject({
      code: 'MAINTENANCE_REQUIRED',
    });
    expect(existsSync(blockedTarget)).toBe(false);
  });

  it('rejects invalid snapshot paths and actual over-limit estimates without leaking input', async () => {
    const { destination, source } = await currentSource();
    await expect(createSqliteSnapshot(source, 'file:///synthetic.sqlite')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(() => inspectSqliteSnapshot(destination)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATH', message: 'INVALID_PATH' }),
    );
    const fake = {
      prepare: () => ({ get: () => ({ page_count: Number.MAX_SAFE_INTEGER, page_size: 4096 }) }),
    } as unknown as DatabaseSync;
    expect(() => estimateSqliteSnapshotBytes(fake)).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
  });

  it('rejects tampered migration identity and a hardlinked snapshot', async () => {
    const { destination, source } = await currentSource();
    await createSqliteSnapshot(source, destination);
    const tamper = remember(new DatabaseSync(destination));
    tamper.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run(sha(99));
    tamper.close();
    openDatabases.delete(tamper);
    expect(() => inspectSqliteSnapshot(destination)).toThrowError(
      expect.objectContaining({ code: 'INTEGRITY_FAILED', message: 'INTEGRITY_FAILED' }),
    );
    const { destination: validDestination, source: validSource } = await currentSource();
    await createSqliteSnapshot(validSource, validDestination);
    const hardlink = join(validDestination, '..', 'snapshot-hardlink.sqlite');
    linkSync(validDestination, hardlink);
    expect(() => inspectSqliteSnapshot(hardlink)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATH', message: 'INVALID_PATH' }),
    );
  }, 20_000);
});

describe('R10B1B snapshot-driven managed-file inventory', () => {
  it('enumerates the eleven direct fields plus six content-addressed V2 references deterministically', async () => {
    const { destination } = await inventorySnapshot();
    const writable = remember(new DatabaseSync(destination));
    const expected = [...populateAuthoritativeReferences(writable)].sort();
    writable.close();
    openDatabases.delete(writable);
    const inventory = enumerateManagedFileInventory(destination);
    expect(inventory.map((entry) => entry.managedPath)).toEqual(expected);
    expect(Object.isFrozen(inventory)).toBe(true);
    for (const entry of inventory) expect(Object.isFrozen(entry)).toBe(true);
    expect(JSON.stringify(inventory)).not.toMatch(/backups|logs|cache\/model-results|exports\/v2/u);
  }, 15_000);

  it('rejects missing metadata and cancellation', async () => {
    const { destination } = await inventorySnapshot();
    const writable = remember(new DatabaseSync(destination));
    writable.exec(
      "INSERT INTO clips(screenshot_path,screenshot_hash,screenshot_bytes) VALUES('sources/screenshots/aa/x',NULL,1)",
    );
    writable.close();
    openDatabases.delete(writable);
    expect(() => enumerateManagedFileInventory(destination)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REFERENCE' }),
    );
    const controller = new AbortController();
    controller.abort();
    expect(() => enumerateManagedFileInventory(destination, controller.signal)).toThrowError(
      expect.objectContaining({ code: 'ABORTED' }),
    );
  });

  it('rejects every malformed V2 reference shape and conflicting normalized paths', async () => {
    const { destination } = await inventorySnapshot();
    const writable = remember(new DatabaseSync(destination));
    const reference = contentReferences()[0];
    if (reference === undefined) throw new Error('synthetic reference fixture is incomplete');
    const malformed = [
      'not-json',
      JSON.stringify(contentReferences().slice(0, 5)),
      JSON.stringify([{ managedPath: reference.managedPath, sha256: reference.sha256 }]),
      JSON.stringify([{ ...reference, extra: true }, ...contentReferences().slice(1)]),
      JSON.stringify([{ ...reference, sha256: 'x'.repeat(64) }, ...contentReferences().slice(1)]),
      JSON.stringify([{ ...reference, sizeBytes: -1 }, ...contentReferences().slice(1)]),
      JSON.stringify([
        { ...reference, managedPath: `exports/aa/${reference.sha256}` },
        ...contentReferences().slice(1),
      ]),
    ];
    for (const filesJson of malformed) {
      writable
        .prepare('INSERT INTO v2_content_package_versions(files_json) VALUES(?)')
        .run(filesJson);
      expect(() => enumerateManagedFileInventory(destination)).toThrowError(
        expect.objectContaining({ code: 'INVALID_REFERENCE', message: 'INVALID_REFERENCE' }),
      );
      writable.exec('DELETE FROM v2_content_package_versions');
    }
    writable
      .prepare(
        "INSERT INTO clips(screenshot_path,screenshot_hash,screenshot_bytes) VALUES('sources/screenshots/aa/X',?,1),('sources/screenshots/aa/x',?,1)",
      )
      .run(sha(41), sha(42));
    expect(() => enumerateManagedFileInventory(destination)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REFERENCE', message: 'INVALID_REFERENCE' }),
    );
    expect(MANAGED_FILE_INVENTORY_MAX_REFERENCES).toBe(200_000);
  }, 30_000);

  it('uses only a validated snapshot and keeps source data outside the result surface', async () => {
    const { destination, source } = await inventorySnapshot();
    source.exec(
      "INSERT INTO sources(local_snapshot_path) VALUES('sources/snapshots/aa/source-only')",
    );
    expect(enumerateManagedFileInventory(destination)).toEqual([]);
    let failure: unknown;
    try {
      enumerateManagedFileInventory('C:\\synthetic\\not-a-snapshot.sqlite');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'SNAPSHOT_INVALID', message: 'SNAPSHOT_INVALID' });
    expect((failure as Error).stack).toBeUndefined();
  });

  it('keeps migration identity deterministic for equivalent isolated snapshots', async () => {
    const { source, destination } = await currentSource();
    const first = await createSqliteSnapshot(source, destination);
    const secondPath = join(destination, '..', 'second.sqlite');
    const second = await createSqliteSnapshot(source, secondPath);
    expect(first).toEqual(second);
    expect(first.migrationFingerprint).toBe(
      createHash('sha256')
        .update(
          MIGRATIONS.map(
            (migration) =>
              `${migration.version}\n${migration.name}\n${migrationChecksum(migration)}\n`,
          ).join(''),
          'utf8',
        )
        .digest('hex'),
    );
  });
});
