import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  ControlledRestoreError,
  createControlledBackupSnapshot,
  executeControlledRestore,
  inspectControlledRestoreRecovery,
  prepareControlledRestore,
  type ControlledBackupDatabaseAdapter,
  type LocalFileRepository,
  type ProjectDataRoot,
} from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';

const BUILD_COMMIT = '9'.repeat(40);
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const openDatabases = new Set<DatabaseSync>();

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await cleanTemporaryStorageDirectories();
});

interface Context {
  readonly backupRoot: string;
  readonly database: DatabaseSync;
  readonly databasePath: string;
  readonly root: ProjectDataRoot;
  readonly rootPath: string;
  readonly repository: LocalFileRepository;
}

async function context(): Promise<Context> {
  const storage = await createStorageTestContext();
  const databasePath = join(storage.root.databaseDirectory, 'rednote.sqlite');
  await initializeDatabase({ databasePath });
  const database = connectDatabase(databasePath);
  openDatabases.add(database);
  const backupRoot = join(storage.rootPath, '..', 'backups');
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

function adapter(value: Context): ControlledBackupDatabaseAdapter {
  return {
    createSnapshot: (destination, signal) =>
      createSqliteSnapshot(value.database, destination, signal),
    enumerateManagedFiles: (snapshot, signal) => enumerateManagedFileInventory(snapshot, signal),
    estimateSnapshotBytes: () => estimateSqliteSnapshotBytes(value.database),
    inspectSnapshot: (snapshot) => inspectSqliteSnapshot(snapshot),
  };
}

function restoreIdentity(value: Context) {
  return {
    appVersion: '0.0.0',
    migrationFingerprint: inspectSqliteSnapshot(value.databasePath).migrationFingerprint,
    schemaVersion: inspectSqliteSnapshot(value.databasePath).schemaVersion,
    v2DataVersion: 2,
  } as const;
}

async function backup(value: Context) {
  return createControlledBackupSnapshot({
    appVersion: '0.0.0',
    buildCommit: BUILD_COMMIT,
    database: adapter(value),
    databasePath: value.databasePath,
    internalDurabilityPort: {
      syncDirectory: async () => undefined,
      syncFile: async () => undefined,
    },
    now: () => new Date('2026-08-21T04:05:06.789Z'),
    randomId: () => OPERATION_ID,
    root: value.root,
    selectedBackupRoot: value.backupRoot,
    v2DataVersion: 2,
  });
}

describe('R10B controlled restore', () => {
  it('rebuilds and verifies an isolated candidate before a same-parent protected switch', async () => {
    const value = await context();
    const managed = await value.repository.putBuffer(Buffer.from('source from backup'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'synthetic.txt',
    });
    value.database
      .prepare(
        `INSERT INTO sources(id,url,title,source_tier,source_type,retrieved_at,content_hash,local_snapshot_path,language)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'r10b-restore-source',
        'https://example.invalid/r10b-restore',
        'Synthetic restore source',
        'SYNTHETIC',
        'WEB',
        '2026-08-21T04:05:06.789Z',
        'b'.repeat(64),
        managed.managedPath,
        'zh-CN',
      );
    const backupResult = await backup(value);
    const backupPath = join(value.backupRoot, backupResult.backupName);
    const identity = restoreIdentity(value);
    writeFileSync(value.root.resolve(managed.managedPath), 'changed after snapshot');
    const preflight = await prepareControlledRestore({
      backupPath,
      database: adapter(value),
      randomId: () => OPERATION_ID,
      root: value.root,
      runtime: identity,
    });
    value.database.close();
    openDatabases.delete(value.database);
    const stages: string[] = [];
    const result = await executeControlledRestore({
      backupPath,
      database: adapter(value),
      onStage: (stage) => stages.push(stage),
      preflight,
      randomId: () => OPERATION_ID,
      root: value.root,
      runtime: identity,
    });
    expect(result).toEqual({
      cleanup: 'PROTECTION_RETAINED',
      operationId: OPERATION_ID,
      outcome: 'SUCCESS',
      stage: 'SUCCESS',
    });
    expect(stages).toEqual(['PREFLIGHT', 'BUILDING_STAGING', 'SWITCHING', 'VERIFYING', 'SUCCESS']);
    expect(existsSync(value.databasePath)).toBe(true);
    expect(inspectSqliteSnapshot(value.databasePath)).toEqual({
      migrationFingerprint: identity.migrationFingerprint,
      schemaVersion: identity.schemaVersion,
    });
    expect(readFileSync(value.root.resolve(managed.managedPath), 'utf8')).toBe(
      'source from backup',
    );
    expect(await inspectControlledRestoreRecovery(value.root.rootPath)).toBe('CLEAR');
  }, 15_000);

  it('blocks a version mismatch before staging or current-root replacement', async () => {
    const value = await context();
    const created = await backup(value);
    const backupPath = join(value.backupRoot, created.backupName);
    await expect(
      prepareControlledRestore({
        backupPath,
        database: adapter(value),
        randomId: () => OPERATION_ID,
        root: value.root,
        runtime: { ...restoreIdentity(value), appVersion: '0.0.1' },
      }),
    ).rejects.toMatchObject({ code: 'COMPATIBILITY_BLOCKED', message: 'COMPATIBILITY_BLOCKED' });
    expect(readFileSync(value.databasePath).byteLength).toBeGreaterThan(0);
    expect(existsSync(join(value.backupRoot, `.rednote-restore-staging-${OPERATION_ID}`))).toBe(
      false,
    );
  });

  it('honors cancellation before staging and leaves the current root untouched', async () => {
    const value = await context();
    const created = await backup(value);
    const backupPath = join(value.backupRoot, created.backupName);
    const preflight = await prepareControlledRestore({
      backupPath,
      database: adapter(value),
      randomId: () => OPERATION_ID,
      root: value.root,
      runtime: restoreIdentity(value),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeControlledRestore({
        backupPath,
        database: adapter(value),
        preflight,
        root: value.root,
        runtime: restoreIdentity(value),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORTED', message: 'ABORTED' });
    expect(existsSync(value.databasePath)).toBe(true);
    expect(existsSync(join(value.backupRoot, `.rednote-restore-staging-${OPERATION_ID}`))).toBe(
      false,
    );
  });

  it('fails closed at startup when an incomplete journal is present', async () => {
    const value = await context();
    const journal = join(
      value.root.rootPath,
      '..',
      `.rednote-restore-journal-${OPERATION_ID}.json`,
    );
    writeFileSync(
      journal,
      JSON.stringify({
        format: 'rednote-controlled-restore-journal',
        operationId: OPERATION_ID,
        phase: 'PROTECTED',
        protectionName: `.rednote-restore-protection-${OPERATION_ID}`,
        rootName: 'project data',
        stagingName: `.rednote-restore-staging-${OPERATION_ID}`,
        version: 1,
      }),
    );
    expect(await inspectControlledRestoreRecovery(value.root.rootPath)).toBe('SAFETY_UNPROVEN');
  });

  it('keeps public failures stable and path-free', async () => {
    const value = await context();
    let failure: unknown;
    try {
      await prepareControlledRestore({
        backupPath: join(value.backupRoot, 'missing'),
        database: adapter(value),
        root: value.root,
        runtime: restoreIdentity(value),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ControlledRestoreError);
    expect(failure).toMatchObject({ message: 'INTEGRITY_FAILED' });
    expect((failure as Error).stack).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(value.root.rootPath);
  });
});
