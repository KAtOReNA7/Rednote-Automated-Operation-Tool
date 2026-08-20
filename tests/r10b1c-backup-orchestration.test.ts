import { existsSync, linkSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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
  verifyControlledBackupSnapshot,
  type ControlledBackupDatabaseAdapter,
  type CreateControlledBackupOptions,
  type LocalFileRepository,
  type ProjectDataRoot,
} from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';

const openDatabases = new Set<DatabaseSync>();
const BUILD_COMMIT = '4'.repeat(40);

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await cleanTemporaryStorageDirectories();
});

interface BackupContext {
  readonly database: DatabaseSync;
  readonly databasePath: string;
  readonly parentPath: string;
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
  return {
    database,
    databasePath,
    parentPath: join(storage.rootPath, '..'),
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

function options(
  context: BackupContext,
  destinationPath = join(context.parentPath, 'controlled backup 中文 😀'),
): CreateControlledBackupOptions {
  return {
    appVersion: '0.0.0',
    buildCommit: BUILD_COMMIT,
    database: adapter(context),
    databasePath: context.databasePath,
    destinationPath,
    root: context.root,
    v2DataVersion: 2,
  };
}

function expectStable(error: unknown, code: string, canary = 'secret-canary'): void {
  expect(error).toBeInstanceOf(ControlledBackupError);
  expect(error).toMatchObject({ code, message: code });
  expect((error as Error).stack).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain(canary);
  expect(String(error)).not.toContain(canary);
}

function sourceReference(context: BackupContext, path: string): void {
  context.database
    .prepare(
      `INSERT INTO sources(
        id,url,title,source_tier,source_type,retrieved_at,content_hash,local_snapshot_path,language
      ) VALUES(?,?,?,?,?,?,?,?,?)`,
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

describe('R10B1C controlled backup orchestration', () => {
  it('creates the exact layout from SQLite inventory and independently verifies it', async () => {
    const context = await createContext();
    const managed = await context.repository.putBuffer(Buffer.from('managed synthetic data'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'source.txt',
    });
    // The second root is intentionally not referenced; it is a canary for root-wide scanning.
    writeFileSync(join(context.rootPath, 'cache', 'secret-canary.txt'), 'not inventory');
    sourceReference(context, managed.managedPath);
    const result = await createControlledBackupSnapshot(options(context));
    const destination = options(context).destinationPath;
    expect(readdirSync(destination).sort()).toEqual(['COMPLETE.json', 'manifest.json', 'payload']);
    expect(result.manifest.files.map((file) => file.relativePath)).toEqual([
      'payload/database/rednote.sqlite',
      `payload/${managed.managedPath}`,
    ]);
    expect(verifyControlledBackupSnapshot({ backupPath: destination })).toEqual(result.manifest);
    expect(existsSync(join(destination, 'payload', 'cache', 'secret-canary.txt'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(context.rootPath);
  });

  it.each([
    ['same root', (context: BackupContext) => context.rootPath],
    [
      'destination nested in root',
      (context: BackupContext) => join(context.rootPath, 'backups', 'bad'),
    ],
    ['root nested in destination', (context: BackupContext) => context.parentPath],
  ])('rejects %s without creating a formal backup', async (_label, destination) => {
    const context = await createContext();
    await expect(
      createControlledBackupSnapshot(options(context, destination(context))),
    ).rejects.toMatchObject({
      code: 'PATH_CONFLICT',
    });
  });

  it('maps database failures and preserves established database codes without leaking details', async () => {
    const context = await createContext();
    const failing = {
      ...adapter(context),
      estimateSnapshotBytes: () => {
        throw new Error('secret-canary');
      },
    };
    let failure: unknown;
    try {
      await createControlledBackupSnapshot({ ...options(context), database: failing });
    } catch (error) {
      failure = error;
    }
    expectStable(failure, 'DATABASE_FAILED');
    expect(existsSync(options(context).destinationPath)).toBe(false);
    const maintenance = {
      ...adapter(context),
      estimateSnapshotBytes: () => {
        throw Object.assign(new Error('secret-canary'), { code: 'MAINTENANCE_REQUIRED' });
      },
    };
    await expect(
      createControlledBackupSnapshot({ ...options(context), database: maintenance }),
    ).rejects.toMatchObject({
      code: 'MAINTENANCE_REQUIRED',
    });
  });

  it('rejects an actual preflight capacity shortfall before staging is created', async () => {
    const context = await createContext();
    await expect(
      createControlledBackupSnapshot({
        ...options(context),
        availableBytes: () => 0,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' });
    expect(readdirSync(context.parentPath).some((name) => name.includes('staging'))).toBe(false);
  });

  it('rechecks actual snapshot plus inventory size after staging is known', async () => {
    const context = await createContext();
    const managed = await context.repository.putBuffer(Buffer.alloc(2 * 1024 * 1024, 7), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'large-synthetic.bin',
    });
    sourceReference(context, managed.managedPath);
    await expect(
      createControlledBackupSnapshot({
        ...options(context),
        availableBytes: () => estimateSqliteSnapshotBytes(context.database) + 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' });
    expect(existsSync(options(context).destinationPath)).toBe(false);
  });

  it('cleans owned staging on cancellation after the snapshot and never creates final output', async () => {
    const context = await createContext();
    const controller = new AbortController();
    const cancelling = {
      ...adapter(context),
      enumerateManagedFiles: (snapshot: string, signal?: AbortSignal) => {
        controller.abort();
        return enumerateManagedFileInventory(snapshot, signal);
      },
    };
    const destination = options(context).destinationPath;
    await expect(
      createControlledBackupSnapshot({
        ...options(context),
        database: cancelling,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(context.parentPath).some((name) => name.includes('staging'))).toBe(false);
  });

  it('fails closed and preserves staging if an unknown entry appears during a failed operation', async () => {
    const context = await createContext();
    const intrusive = {
      ...adapter(context),
      createSnapshot: async (destination: string, signal?: AbortSignal) => {
        const value = await createSqliteSnapshot(context.database, destination, signal);
        writeFileSync(join(destination, '..', 'unknown-canary'), 'unknown');
        return value;
      },
      enumerateManagedFiles: () => {
        throw new Error('secret-canary');
      },
    };
    await expect(
      createControlledBackupSnapshot({ ...options(context), database: intrusive }),
    ).rejects.toMatchObject({
      code: 'STAGING_OWNERSHIP_INVALID',
    });
    const staging = readdirSync(context.parentPath).find((name) => name.includes('staging'));
    expect(staging).toBeDefined();
    expect(
      existsSync(
        join(context.parentPath, staging as string, 'payload', 'database', 'unknown-canary'),
      ),
    ).toBe(true);
  });

  it('rejects hardlinked inventory files and final collisions without overwriting either source', async () => {
    const context = await createContext();
    const file = await context.repository.putBuffer(Buffer.from('linked'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'linked.txt',
    });
    sourceReference(context, file.managedPath);
    const source = context.root.resolve(file.managedPath);
    const other = join(source, '..', 'other-link');
    linkSync(source, other);
    await expect(createControlledBackupSnapshot(options(context))).rejects.toMatchObject({
      code: 'PATH_LINK_NOT_ALLOWED',
    });
    mkdirSync(options(context).destinationPath);
    await expect(createControlledBackupSnapshot(options(context))).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
  });

  it('rejects inventory path conflicts and hash mismatches before a formal backup is published', async () => {
    const context = await createContext();
    const file = await context.repository.putBuffer(Buffer.from('integrity'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'integrity.txt',
    });
    const conflict = {
      ...adapter(context),
      enumerateManagedFiles: () => [
        {
          category: 'SOURCE_SNAPSHOT' as const,
          expectedSha256: null,
          expectedSizeBytes: null,
          managedPath: file.managedPath,
        },
        {
          category: 'SOURCE_SNAPSHOT' as const,
          expectedSha256: 'e'.repeat(64),
          expectedSizeBytes: null,
          managedPath: file.managedPath,
        },
      ],
    };
    await expect(
      createControlledBackupSnapshot({ ...options(context), database: conflict }),
    ).rejects.toMatchObject({
      code: 'PATH_CONFLICT',
    });
    const mismatch = {
      ...adapter(context),
      enumerateManagedFiles: () => [
        {
          category: 'SOURCE_SNAPSHOT' as const,
          expectedSha256: 'f'.repeat(64),
          expectedSizeBytes: null,
          managedPath: file.managedPath,
        },
      ],
    };
    await expect(
      createControlledBackupSnapshot({ ...options(context), database: mismatch }),
    ).rejects.toMatchObject({
      code: 'INTEGRITY_FAILED',
    });
  });

  it.each([
    [
      'manifest replacement',
      (destination: string) => writeFileSync(join(destination, 'manifest.json'), '{}'),
    ],
    [
      'completion replacement',
      (destination: string) => writeFileSync(join(destination, 'COMPLETE.json'), '{}'),
    ],
    [
      'payload replacement',
      (destination: string) =>
        writeFileSync(join(destination, 'payload', 'database', 'rednote.sqlite'), 'bad'),
    ],
    [
      'unexpected top-level entry',
      (destination: string) => writeFileSync(join(destination, 'extra'), 'bad'),
    ],
  ])('independent verifier rejects %s', async (_label, tamper) => {
    const context = await createContext();
    await createControlledBackupSnapshot(options(context));
    tamper(options(context).destinationPath);
    await expect(() =>
      verifyControlledBackupSnapshot({ backupPath: options(context).destinationPath }),
    ).toThrow(ControlledBackupError);
  });
});
