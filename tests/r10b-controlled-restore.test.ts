import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
const JOURNAL_SHA256 = 'a'.repeat(64);
const openDatabases = new Set<DatabaseSync>();

vi.mock('electron', () => ({
  app: { getAppPath: () => resolve('.') },
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: async () => '' },
}));

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

async function backup(value: Context, v2DataVersion = 2) {
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
    v2DataVersion,
  });
}

function restoreNames() {
  return {
    journal: `.rednote-restore-journal-${OPERATION_ID}.json`,
    protection: `.rednote-restore-protection-${OPERATION_ID}`,
    staging: `.rednote-restore-staging-${OPERATION_ID}`,
  };
}

function writeRecoveryJournal(
  value: Context,
  phase: 'BUILDING_STAGING' | 'PROTECTED' | 'SWITCHED' | 'ROLLED_BACK' | 'SUCCESS',
  oldIdentity: { readonly dev: number; readonly ino: number } = lstatSync(value.rootPath),
): void {
  const parent = join(value.rootPath, '..');
  const names = restoreNames();
  writeFileSync(
    join(parent, names.journal),
    JSON.stringify({
      format: 'rednote-controlled-restore-journal',
      liveRootIdentity: { dev: oldIdentity.dev, ino: oldIdentity.ino },
      liveRootParentIdentity: {
        dev: lstatSync(parent).dev,
        ino: lstatSync(parent).ino,
      },
      manifestSha256: JOURNAL_SHA256,
      operationId: OPERATION_ID,
      phase,
      protectionName: names.protection,
      rootName: basename(value.rootPath),
      stagingName: names.staging,
      version: 1,
    }),
  );
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
    expect(existsSync(join(value.root.rootPath, '..', restoreNames().journal))).toBe(false);
    expect(existsSync(join(value.root.rootPath, '..', restoreNames().protection))).toBe(false);
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

  it('checks the same bounded staging capacity in preview and before a destructive switch', async () => {
    const value = await context();
    const created = await backup(value);
    const backupPath = join(value.backupRoot, created.backupName);
    await expect(
      prepareControlledRestore({
        availableBytes: () => 0,
        backupPath,
        database: adapter(value),
        randomId: () => OPERATION_ID,
        root: value.root,
        runtime: restoreIdentity(value),
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE', message: 'INSUFFICIENT_SPACE' });
    expect(existsSync(join(value.rootPath, '..', restoreNames().journal))).toBe(false);
  });

  it('fails before the switch when execute-time capacity drifts below the verified staging bound', async () => {
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
    let capacityReads = 0;
    await expect(
      executeControlledRestore({
        availableBytes: () => {
          capacityReads += 1;
          return capacityReads === 1 ? Number.MAX_SAFE_INTEGER : 0;
        },
        backupPath,
        database: adapter(value),
        preflight,
        root: value.root,
        runtime: restoreIdentity(value),
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' });
    expect(capacityReads).toBe(2);
    expect(existsSync(value.databasePath)).toBe(true);
    expect(existsSync(join(value.rootPath, '..', restoreNames().journal))).toBe(false);
  }, 15_000);

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

  it('removes its staging journal when backup re-verification fails before the switch', async () => {
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
    writeFileSync(join(backupPath, 'COMPLETE'), 'tampered');
    await expect(
      executeControlledRestore({
        backupPath,
        database: adapter(value),
        preflight,
        root: value.root,
        runtime: restoreIdentity(value),
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    expect(
      existsSync(join(value.root.rootPath, '..', `.rednote-restore-staging-${OPERATION_ID}`)),
    ).toBe(false);
    expect(
      existsSync(join(value.root.rootPath, '..', `.rednote-restore-journal-${OPERATION_ID}.json`)),
    ).toBe(false);
    expect(await inspectControlledRestoreRecovery(value.root.rootPath)).toBe('CLEAR');
  });

  it('rolls back a switched candidate when final verification fails and preserves the old live root', async () => {
    const value = await context();
    const managed = await value.repository.putBuffer(Buffer.from('old live root'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'rollback.txt',
    });
    value.database
      .prepare(
        `INSERT INTO sources(id,url,title,source_tier,source_type,retrieved_at,content_hash,local_snapshot_path,language)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'r10b-rollback-source',
        'https://example.invalid/r10b-rollback',
        'Synthetic rollback source',
        'SYNTHETIC',
        'WEB',
        '2026-08-21T04:05:06.789Z',
        'c'.repeat(64),
        managed.managedPath,
        'zh-CN',
      );
    const created = await backup(value);
    const backupPath = join(value.backupRoot, created.backupName);
    const preflight = await prepareControlledRestore({
      backupPath,
      database: adapter(value),
      randomId: () => OPERATION_ID,
      root: value.root,
      runtime: restoreIdentity(value),
    });
    writeFileSync(value.root.resolve(managed.managedPath), 'changed candidate source');
    value.database.close();
    openDatabases.delete(value.database);
    let inspections = 0;
    const result = await executeControlledRestore({
      backupPath,
      database: {
        ...adapter(value),
        inspectSnapshot: (snapshot) => {
          inspections += 1;
          if (inspections === 4) throw new Error('synthetic final verification failure');
          return inspectSqliteSnapshot(snapshot);
        },
      },
      preflight,
      root: value.root,
      runtime: restoreIdentity(value),
    });
    expect(inspections).toBe(4);
    expect(result).toMatchObject({ outcome: 'ROLLBACK', stage: 'ROLLBACK' });
    expect(readFileSync(value.root.resolve(managed.managedPath), 'utf8')).toBe(
      'changed candidate source',
    );
    expect(await inspectControlledRestoreRecovery(value.rootPath)).toBe('CLEAR');
  }, 15_000);

  it.each([
    ['journal before candidate completion', 'BUILDING_STAGING'],
    ['rollback completed with a residual candidate', 'ROLLED_BACK'],
  ] as const)('cleans a proven %s state', async (_label, phase) => {
    const value = await context();
    const parent = join(value.rootPath, '..');
    mkdirSync(join(parent, restoreNames().staging));
    writeRecoveryJournal(value, phase);
    expect(await inspectControlledRestoreRecovery(value.root.rootPath)).toBe('CLEAR');
    expect(existsSync(join(parent, restoreNames().staging))).toBe(false);
    expect(existsSync(join(parent, restoreNames().journal))).toBe(false);
  });

  it.each(['PROTECTED', 'SWITCHED'] as const)(
    'restores the protected live root after a %s crash state',
    async (phase) => {
      const value = await context();
      const parent = join(value.rootPath, '..');
      const names = restoreNames();
      const original = lstatSync(value.rootPath);
      value.database.close();
      openDatabases.delete(value.database);
      renameSync(value.rootPath, join(parent, names.protection));
      if (phase === 'PROTECTED') {
        cpSync(join(parent, names.protection), join(parent, names.staging), { recursive: true });
      } else {
        cpSync(join(parent, names.protection), value.rootPath, { recursive: true });
      }
      writeRecoveryJournal(value, phase, original);
      expect(await inspectControlledRestoreRecovery(value.rootPath)).toBe('CLEAR');
      expect(lstatSync(value.rootPath)).toMatchObject({ dev: original.dev, ino: original.ino });
      expect(existsSync(join(parent, names.protection))).toBe(false);
      expect(existsSync(join(parent, names.staging))).toBe(false);
    },
  );

  it('cleans a verified successful switch but fails closed for contradictory journal topology', async () => {
    const value = await context();
    const parent = join(value.rootPath, '..');
    const names = restoreNames();
    const original = lstatSync(value.rootPath);
    value.database.close();
    openDatabases.delete(value.database);
    renameSync(value.rootPath, join(parent, names.protection));
    cpSync(join(parent, names.protection), value.rootPath, { recursive: true });
    writeRecoveryJournal(value, 'SUCCESS', original);
    expect(await inspectControlledRestoreRecovery(value.rootPath)).toBe('CLEAR');
    expect(existsSync(join(parent, names.protection))).toBe(false);

    writeRecoveryJournal(value, 'SUCCESS', lstatSync(value.rootPath));
    expect(await inspectControlledRestoreRecovery(value.rootPath)).toBe('SAFETY_UNPROVEN');
  });

  it('serializes maintenance, blocks ordinary data reads, and reopens for a real database action', async () => {
    const value = await context();
    const created = await backup(value, 1);
    const backupPath = join(value.backupRoot, created.backupName);
    value.database.close();
    openDatabases.delete(value.database);
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const runtime = await V2DesktopRuntime.openProject(value.root, {
      appVersion: '0.0.0',
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      maintenancePicker: {
        select: async () => ({ displayLabel: 'synthetic backup', path: backupPath }),
      },
    });
    const caller = { senderId: 7, windowId: 9 };
    try {
      const selected = (await runtime.mutate({ action: 'SELECT_RESTORE_DIRECTORY' }, caller)) as {
        readonly restoreDirectory: { readonly token: string } | null;
      };
      const selection = selected.restoreDirectory;
      if (selection === null) throw new Error('missing synthetic restore selection');
      const preview = (await runtime.mutate(
        { action: 'PREVIEW_CONTROLLED_RESTORE', directoryToken: selection.token },
        caller,
      )) as { readonly confirmationToken: string };
      const confirmation = runtime.mutate(
        {
          action: 'CONFIRM_CONTROLLED_RESTORE',
          confirmation: 'RESTORE_CONTROLLED_BACKUP',
          confirmationToken: preview.confirmationToken,
        },
        caller,
      );
      await expect(runtime.read({ view: 'ACCOUNT_PERSONA' }, caller)).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      await expect(confirmation).resolves.toMatchObject({ restoreOutcome: 'SUCCESS' });
      await expect(runtime.read({ view: 'ACCOUNT_PERSONA' }, caller)).resolves.toMatchObject({
        revision: 0,
      });
    } finally {
      runtime.close();
    }
  }, 20_000);

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
