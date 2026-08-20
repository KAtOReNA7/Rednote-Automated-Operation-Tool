import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  connectDatabase,
  createSqliteSnapshot,
  enumerateManagedFileInventory,
  estimateSqliteSnapshotBytes,
  initializeDatabase,
  inspectSqliteSnapshot,
} from '../packages/db/src/index.js';
import {
  ControlledBackupError,
  createControlledBackupSnapshot,
  manifestSha256,
  parseBackupManifestV1,
  serializeBackupCompleteMarkerV1,
  serializeBackupManifestV1,
  verifyControlledBackupSnapshot,
  type ControlledBackupDatabaseAdapter,
  type CreateControlledBackupOptions,
  type LocalFileRepository,
  type ProjectDataRoot,
} from '../packages/storage/src/index.js';
import type { ControlledBackupDurabilityPort } from '../packages/storage/src/backup-snapshot.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';

const openDatabases = new Set<DatabaseSync>();
const BUILD_COMMIT = '4'.repeat(40);
const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await cleanTemporaryStorageDirectories();
});

interface BackupContext {
  readonly backupRoot: string;
  readonly database: DatabaseSync;
  readonly databasePath: string;
  readonly root: ProjectDataRoot;
  readonly rootPath: string;
  readonly repository: LocalFileRepository;
}

async function createContext(): Promise<BackupContext> {
  const storage = await createStorageTestContext();
  const databasePath = join(storage.root.databaseDirectory, 'rednote.sqlite');
  await initializeDatabase({ databasePath });
  const database = connectDatabase(databasePath);
  openDatabases.add(database);
  const backupRoot = join(storage.rootPath, '..', 'selected-backups');
  mkdirSync(backupRoot);
  return {
    backupRoot,
    database,
    databasePath,
    root: storage.root,
    rootPath: storage.rootPath,
    repository: storage.repository,
  };
}

function adapter(context: BackupContext): ControlledBackupDatabaseAdapter {
  return {
    createSnapshot: (destination, signal) =>
      createSqliteSnapshot(context.database, destination, signal),
    enumerateManagedFiles: (snapshot, signal) => enumerateManagedFileInventory(snapshot, signal),
    estimateSnapshotBytes: () => estimateSqliteSnapshotBytes(context.database),
    inspectSnapshot: (snapshot) => inspectSqliteSnapshot(snapshot),
  };
}

function options(context: BackupContext, id = FIRST_ID): CreateControlledBackupOptions {
  return {
    appVersion: '0.0.0',
    buildCommit: BUILD_COMMIT,
    database: adapter(context),
    databasePath: context.databasePath,
    now: () => new Date('2026-08-20T03:04:05.678Z'),
    randomId: () => id,
    root: context.root,
    selectedBackupRoot: context.backupRoot,
    internalDurabilityPort: {
      syncDirectory: async () => undefined,
      syncFile: async () => undefined,
    },
    v2DataVersion: 2,
  };
}

function sourceReference(context: BackupContext, path: string): void {
  context.database
    .prepare(
      `INSERT INTO sources(id,url,title,source_tier,source_type,retrieved_at,content_hash,local_snapshot_path,language)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'r10b1c-source',
      'https://example.invalid/r10b1c',
      'Synthetic source',
      'SYNTHETIC',
      'WEB',
      '2026-08-20T03:04:05.678Z',
      'a'.repeat(64),
      path,
      'zh-CN',
    );
}
function expectStable(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(ControlledBackupError);
  expect(error).toMatchObject({ code, message: code });
  expect((error as Error).stack).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain('secret-canary');
}

describe('R10B1C controlled backup orchestration', () => {
  it('creates a generated-name backup from the SQLite inventory and verifies it read-only', async () => {
    const context = await createContext();
    const managed = await context.repository.putBuffer(Buffer.from('managed synthetic data'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'source.txt',
    });
    writeFileSync(join(context.rootPath, 'cache', 'secret-canary.txt'), 'not inventory');
    sourceReference(context, managed.managedPath);
    const result = await createControlledBackupSnapshot(options(context));
    const destination = join(context.backupRoot, result.backupName);
    expect(result).toMatchObject({
      operationId: FIRST_ID,
      durability: expect.any(String),
      totals: { fileCount: 2 },
    });
    expect(readdirSync(destination).sort()).toEqual(['COMPLETE.json', 'manifest.json', 'payload']);
    const verified = await verifyControlledBackupSnapshot({
      backupPath: destination,
      database: adapter(context),
    });
    expect(verified.manifest.files.map((file) => file.relativePath)).toEqual([
      'payload/database/rednote.sqlite',
      `payload/${managed.managedPath}`,
    ]);
    expect(JSON.stringify(result)).not.toContain(context.rootPath);
    expect(existsSync(join(destination, 'payload', 'cache', 'secret-canary.txt'))).toBe(false);
  });

  it.each([
    ['same as data root', (context: BackupContext) => context.rootPath, 'PATH_CONFLICT'],
    [
      'nested below data root',
      (context: BackupContext) => join(context.rootPath, 'backups'),
      'PATH_CONFLICT',
    ],
    ['path-like id', (context: BackupContext) => context.backupRoot, 'INVALID_PATH', '../bad'],
  ])('rejects %s before publishing', async (_label, root, code, id = FIRST_ID) => {
    const context = await createContext();
    await expect(
      createControlledBackupSnapshot({
        ...options(context, id),
        selectedBackupRoot: root(context),
      }),
    ).rejects.toMatchObject({ code });
    expect(readdirSync(context.backupRoot)).toEqual([]);
  });

  it('generates distinct names for fixed-time UUID collisions and refuses an existing final', async () => {
    const context = await createContext();
    const first = await createControlledBackupSnapshot(options(context, FIRST_ID));
    const second = await createControlledBackupSnapshot(options(context, SECOND_ID));
    expect(first.backupName).not.toBe(second.backupName);
    await expect(createControlledBackupSnapshot(options(context, FIRST_ID))).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    expect(existsSync(join(context.backupRoot, first.backupName))).toBe(true);
  });

  it('maps database errors to stable codes without error payload leakage', async () => {
    const context = await createContext();
    let failure: unknown;
    try {
      await createControlledBackupSnapshot({
        ...options(context),
        database: {
          ...adapter(context),
          estimateSnapshotBytes: () => {
            throw new Error('secret-canary');
          },
        },
      });
    } catch (error) {
      failure = error;
    }
    expectStable(failure, 'DATABASE_FAILED');
    expect(readdirSync(context.backupRoot)).toEqual([]);
  });

  it('checks capacity before staging and after inventory sizing', async () => {
    const context = await createContext();
    await expect(
      createControlledBackupSnapshot({ ...options(context), availableBytes: () => 0 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' });
    const managed = await context.repository.putBuffer(Buffer.alloc(2 * 1024 * 1024, 7), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'large.bin',
    });
    sourceReference(context, managed.managedPath);
    await expect(
      createControlledBackupSnapshot({
        ...options(context),
        availableBytes: () => estimateSqliteSnapshotBytes(context.database) + 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' });
    expect(readdirSync(context.backupRoot)).toEqual([]);
  });

  it('observes a timer cancellation after inventory and during a real async large-file copy', async () => {
    const context = await createContext();
    const managed = await context.repository.putBuffer(Buffer.alloc(12 * 1024 * 1024, 1), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'large-copy.bin',
    });
    sourceReference(context, managed.managedPath);
    const controller = new AbortController();
    let timerFired = false;
    const cancelling = {
      ...adapter(context),
      enumerateManagedFiles: (snapshot: string, signal?: AbortSignal) => {
        const inventory = enumerateManagedFileInventory(snapshot, signal);
        setTimeout(() => {
          timerFired = true;
          controller.abort();
        }, 0);
        return inventory;
      },
    };
    await expect(
      createControlledBackupSnapshot({
        ...options(context),
        database: cancelling,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(timerFired).toBe(true);
    expect(readdirSync(context.backupRoot).some((name) => name.includes('staging'))).toBe(false);
    expect(readdirSync(context.backupRoot).some((name) => name.startsWith('rednote-backup-'))).toBe(
      false,
    );
  });

  it('preserves a replaced owned staging entry rather than deleting a canary', async () => {
    const context = await createContext();
    const intrusive = {
      ...adapter(context),
      enumerateManagedFiles: (snapshot: string, signal?: AbortSignal) => {
        void signal;
        const stagingFile = snapshot;
        renameSync(stagingFile, `${stagingFile}.old`);
        writeFileSync(stagingFile, 'canary');
        throw new Error('secret-canary');
      },
    };
    await expect(
      createControlledBackupSnapshot({ ...options(context), database: intrusive }),
    ).rejects.toMatchObject({ code: 'STAGING_OWNERSHIP_INVALID' });
    const staging = readdirSync(context.backupRoot).find((name) => name.includes('staging'));
    expect(staging).toBeDefined();
    expect(
      existsSync(
        join(context.backupRoot, staging as string, 'payload', 'database', 'rednote.sqlite'),
      ),
    ).toBe(true);
  });

  it('rejects hardlinks and verifies inventory identity, schema identity, and expected size', async () => {
    const context = await createContext();
    const managed = await context.repository.putBuffer(Buffer.from('integrity'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'integrity.txt',
    });
    sourceReference(context, managed.managedPath);
    const source = context.root.resolve(managed.managedPath);
    linkSync(source, join(source, '..', 'other-link'));
    await expect(createControlledBackupSnapshot(options(context))).rejects.toMatchObject({
      code: 'PATH_LINK_NOT_ALLOWED',
    });
    // Fresh source after the link test keeps the verification fixtures independent.
    const fresh = await createContext();
    const file = await fresh.repository.putBuffer(Buffer.from('fresh'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'fresh.txt',
    });
    sourceReference(fresh, file.managedPath);
    const created = await createControlledBackupSnapshot(options(fresh));
    const destination = join(fresh.backupRoot, created.backupName);
    await expect(
      verifyControlledBackupSnapshot({
        backupPath: destination,
        database: {
          ...adapter(fresh),
          inspectSnapshot: () => ({ migrationFingerprint: 'e'.repeat(64), schemaVersion: 1 }),
        },
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    await expect(
      verifyControlledBackupSnapshot({
        backupPath: destination,
        database: {
          ...adapter(fresh),
          enumerateManagedFiles: () => [
            {
              category: 'SOURCE_SNAPSHOT',
              expectedSha256: null,
              expectedSizeBytes: 999,
              managedPath: file.managedPath,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
  }, 15_000);

  it('binds the manifest to SQLite inventory and rejects omissions, extras, and bounded marker abuse', async () => {
    const context = await createContext();
    const managed = await context.repository.putBuffer(Buffer.from('bound'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'bound.txt',
    });
    sourceReference(context, managed.managedPath);
    const created = await createControlledBackupSnapshot(options(context));
    const destination = join(context.backupRoot, created.backupName);
    const manifestPath = join(destination, 'manifest.json');
    const manifest = parseBackupManifestV1(readFileSync(manifestPath));
    const omitted = serializeBackupManifestV1({
      ...manifest,
      files: [manifest.files[0] as (typeof manifest.files)[number]],
      totals: { fileCount: 1, sizeBytes: manifest.files[0]?.sizeBytes ?? 0 },
    });
    writeFileSync(manifestPath, omitted);
    writeFileSync(
      join(destination, 'COMPLETE.json'),
      serializeBackupCompleteMarkerV1(manifestSha256(omitted)),
    );
    await expect(
      verifyControlledBackupSnapshot({ backupPath: destination, database: adapter(context) }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    writeFileSync(manifestPath, serializeBackupManifestV1(manifest));
    writeFileSync(
      join(destination, 'COMPLETE.json'),
      serializeBackupCompleteMarkerV1(manifestSha256(serializeBackupManifestV1(manifest))),
    );
    writeFileSync(join(destination, 'payload', 'sources', 'snapshots', 'extra'), 'extra');
    await expect(
      verifyControlledBackupSnapshot({ backupPath: destination, database: adapter(context) }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    writeFileSync(join(destination, 'COMPLETE.json'), Buffer.alloc(1025));
    await expect(
      verifyControlledBackupSnapshot({ backupPath: destination, database: adapter(context) }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  }, 15_000);

  it.each([
    [
      'all sync requests complete',
      {
        syncDirectory: async () => undefined,
        syncFile: async () => undefined,
      } satisfies ControlledBackupDurabilityPort,
      'SYNC_REQUESTS_COMPLETED',
    ],
    [
      'directory sync is unavailable',
      {
        syncDirectory: async () => {
          throw new Error('unsupported');
        },
        syncFile: async () => undefined,
      } satisfies ControlledBackupDurabilityPort,
      'DIRECTORY_SYNC_UNAVAILABLE',
    ],
  ])('reports %s without guessing a stronger durability state', async (_label, port, expected) => {
    const context = await createContext();
    const result = await createControlledBackupSnapshot({
      ...options(context),
      internalDurabilityPort: port,
    });
    expect(result.durability).toBe(expected);
  });

  it('preserves an already published final when post-publish verification or sync is unknown', async () => {
    const context = await createContext();
    let fileCalls = 0;
    const port: ControlledBackupDurabilityPort = {
      syncFile: async () => {
        fileCalls += 1;
        if (fileCalls > 4) throw new Error('post-publish');
      },
      syncDirectory: async () => undefined,
    };
    const result = await createControlledBackupSnapshot({
      ...options(context),
      internalDurabilityPort: port,
    });
    expect(result.durability).toBe('PUBLISHED_DURABILITY_UNKNOWN');
    expect(existsSync(join(context.backupRoot, result.backupName))).toBe(true);
  }, 15_000);
});
