import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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

async function waitForMaintenance(
  runtime: {
    read(
      input: unknown,
      caller: { readonly senderId: number; readonly windowId: number },
    ): Promise<unknown>;
  },
  caller: { readonly senderId: number; readonly windowId: number },
): Promise<{ readonly restoreOutcome: string }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = (await runtime.read({ view: 'MAINTENANCE' }, caller)) as {
      readonly restoreOutcome: string;
    };
    if (state.restoreOutcome !== 'IDLE') return state;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('maintenance operation did not settle');
}

async function waitForBackupMaintenance(
  runtime: {
    read(
      input: unknown,
      caller: { readonly senderId: number; readonly windowId: number },
    ): Promise<unknown>;
  },
  caller: { readonly senderId: number; readonly windowId: number },
): Promise<{ readonly backupOutcome: string }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = (await runtime.read({ view: 'MAINTENANCE' }, caller)) as {
      readonly backupOutcome: string;
    };
    if (state.backupOutcome !== 'IDLE') return state;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('backup maintenance operation did not settle');
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
      const confirmation = await runtime.mutate(
        {
          action: 'CONFIRM_CONTROLLED_RESTORE',
          confirmation: 'RESTORE_CONTROLLED_BACKUP',
          confirmationToken: preview.confirmationToken,
        },
        caller,
      );
      expect(confirmation).toMatchObject({ operation: 'RESTORE', restoreOutcome: 'IDLE' });
      await expect(runtime.read({ view: 'ACCOUNT_PERSONA' }, caller)).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      await expect(waitForMaintenance(runtime, caller)).resolves.toMatchObject({
        restoreOutcome: 'SUCCESS',
      });
      await expect(runtime.read({ view: 'ACCOUNT_PERSONA' }, caller)).resolves.toMatchObject({
        revision: 0,
      });
    } finally {
      runtime.close();
    }
  }, 20_000);

  it('reports all backup preconditions, isolates the operation, and only accepts safe cancellation', async () => {
    const value = await context();
    const managed = await value.repository.putBuffer(Buffer.alloc(12 * 1024 * 1024, 1), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'synthetic-large-copy.bin',
    });
    value.database
      .prepare(
        `INSERT INTO sources(id,url,title,source_tier,source_type,retrieved_at,content_hash,local_snapshot_path,language)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'r10b-maintenance-source',
        'https://example.invalid/r10b-maintenance',
        'Synthetic maintenance source',
        'SYNTHETIC',
        'WEB',
        '2026-08-21T04:05:06.789Z',
        'b'.repeat(64),
        managed.managedPath,
        'zh-CN',
      );
    value.database.close();
    openDatabases.delete(value.database);
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const runtime = await V2DesktopRuntime.openProject(value.root, {
      appVersion: '0.0.0',
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      buildCommit: BUILD_COMMIT,
      maintenancePicker: {
        select: async () => ({
          displayLabel: 'synthetic backup destination',
          path: value.backupRoot,
        }),
      },
    });
    const caller = { senderId: 17, windowId: 19 };
    const otherCaller = { senderId: 23, windowId: 29 };
    try {
      const selected = (await runtime.mutate({ action: 'SELECT_BACKUP_DIRECTORY' }, caller)) as {
        readonly backupDirectory: { readonly token: string } | null;
      };
      if (selected.backupDirectory === null) throw new Error('missing synthetic backup selection');
      const preview = (await runtime.mutate(
        { action: 'PREVIEW_CONTROLLED_BACKUP', directoryToken: selected.backupDirectory.token },
        caller,
      )) as {
        readonly backupPreconditions: Readonly<Record<string, string>> | null;
        readonly confirmationToken: string;
        readonly summary: string;
      };
      expect(preview.backupPreconditions).toEqual({
        directory: 'PASSED',
        maintenanceLock: 'PASSED',
        space: 'PASSED',
        write: 'PASSED',
      });
      expect(preview).toMatchObject({
        summary: '预检已创建并清理临时写入探针；仅在确认后创建受控备份。',
      });
      expect(readdirSync(value.backupRoot)).toEqual([]);
      const started = await runtime.mutate(
        {
          action: 'CONFIRM_CONTROLLED_BACKUP',
          confirmation: 'CREATE_CONTROLLED_BACKUP',
          confirmationToken: preview.confirmationToken,
        },
        caller,
      );
      expect(started).toMatchObject({ backupOutcome: 'IDLE', operation: 'BACKUP' });
      await expect(runtime.read({ view: 'MAINTENANCE' }, otherCaller)).resolves.toMatchObject({
        maintenanceLocked: true,
        operation: null,
      });
      await expect(
        runtime.mutate({ action: 'CANCEL_CONTROLLED_MAINTENANCE' }, caller),
      ).resolves.toMatchObject({ cancelRequested: true });
      await expect(waitForBackupMaintenance(runtime, caller)).resolves.toMatchObject({
        backupOutcome: 'CANCELLED',
      });
    } finally {
      runtime.close();
    }
  }, 20_000);

  it('binds backup selection and confirmation leases to one caller without allowing hostile consumption', async () => {
    const value = await context();
    value.database.close();
    openDatabases.delete(value.database);
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const runtime = await V2DesktopRuntime.openProject(value.root, {
      appVersion: '0.0.0',
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      buildCommit: BUILD_COMMIT,
      maintenancePicker: {
        select: async () => ({
          displayLabel: 'synthetic backup destination',
          path: value.backupRoot,
        }),
      },
    });
    const caller = { senderId: 37, windowId: 41 };
    const otherCaller = { senderId: 43, windowId: 47 };
    try {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
      const expiring = (await runtime.mutate({ action: 'SELECT_BACKUP_DIRECTORY' }, caller)) as {
        readonly backupDirectory: { readonly token: string } | null;
      };
      if (expiring.backupDirectory === null) throw new Error('missing expiring backup selection');
      clock.mockReturnValue(121_001);
      await expect(
        runtime.mutate(
          { action: 'PREVIEW_CONTROLLED_BACKUP', directoryToken: expiring.backupDirectory.token },
          caller,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      clock.mockRestore();

      const selected = (await runtime.mutate({ action: 'SELECT_BACKUP_DIRECTORY' }, caller)) as {
        readonly backupDirectory: { readonly token: string } | null;
      };
      if (selected.backupDirectory === null) throw new Error('missing backup selection');
      await expect(
        runtime.mutate(
          { action: 'PREVIEW_CONTROLLED_BACKUP', directoryToken: selected.backupDirectory.token },
          otherCaller,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      const preview = (await runtime.mutate(
        { action: 'PREVIEW_CONTROLLED_BACKUP', directoryToken: selected.backupDirectory.token },
        caller,
      )) as { readonly confirmationToken: string };
      await expect(
        runtime.mutate(
          {
            action: 'CONFIRM_CONTROLLED_BACKUP',
            confirmation: 'CREATE_CONTROLLED_BACKUP',
            confirmationToken: preview.confirmationToken,
          },
          otherCaller,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(
        runtime.mutate(
          {
            action: 'CONFIRM_CONTROLLED_BACKUP',
            confirmation: 'CREATE_CONTROLLED_BACKUP',
            confirmationToken: preview.confirmationToken,
          },
          caller,
        ),
      ).resolves.toMatchObject({ operation: 'BACKUP' });
      await expect(
        runtime.mutate({ action: 'CANCEL_CONTROLLED_MAINTENANCE' }, caller),
      ).resolves.toMatchObject({ cancelRequested: true });
      await expect(waitForBackupMaintenance(runtime, caller)).resolves.toMatchObject({
        backupOutcome: 'CANCELLED',
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

describe('R10C controlled local diagnostics', () => {
  it('requires preview, caller-bound directory selection, and one-time confirmation before a local ZIP exists', async () => {
    const value = await context();
    value.database.close();
    openDatabases.delete(value.database);
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const runtime = await V2DesktopRuntime.openProject(value.root, {
      appVersion: '0.0.0',
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      buildCommit: BUILD_COMMIT,
      maintenancePicker: {
        select: async (_caller, operation) =>
          operation === 'DIAGNOSTICS'
            ? { displayLabel: 'synthetic diagnostics directory', path: value.backupRoot }
            : null,
      },
      openDirectory: async () => '',
    });
    const caller = { senderId: 101, windowId: 103 };
    const otherCaller = { senderId: 107, windowId: 109 };
    try {
      const preview = (await runtime.mutate(
        { action: 'BUILD_LOCAL_DIAGNOSTIC_PREVIEW' },
        caller,
      )) as { readonly confirmationToken: null; readonly categories: readonly unknown[] };
      expect(preview.confirmationToken).toBeNull();
      expect(preview.categories).toHaveLength(5);
      expect(readdirSync(value.backupRoot)).toEqual([]);

      const selected = (await runtime.mutate(
        { action: 'SELECT_LOCAL_DIAGNOSTIC_DIRECTORY' },
        caller,
      )) as { readonly directory: { readonly token: string } | null };
      if (selected.directory === null) throw new Error('missing diagnostic directory lease');
      await expect(
        runtime.mutate(
          { action: 'PREVIEW_LOCAL_DIAGNOSTIC_EXPORT', directoryToken: selected.directory.token },
          otherCaller,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      const confirmation = (await runtime.mutate(
        { action: 'PREVIEW_LOCAL_DIAGNOSTIC_EXPORT', directoryToken: selected.directory.token },
        caller,
      )) as { readonly confirmationToken: string | null };
      if (confirmation.confirmationToken === null) throw new Error('missing confirmation lease');
      await expect(
        runtime.mutate(
          {
            action: 'CONFIRM_LOCAL_DIAGNOSTIC_EXPORT',
            confirmation: 'CONFIRM_EXPORT_TO_SELECTED_DIRECTORY',
            confirmationToken: confirmation.confirmationToken,
          },
          otherCaller,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await runtime.mutate(
        {
          action: 'CONFIRM_LOCAL_DIAGNOSTIC_EXPORT',
          confirmation: 'CONFIRM_EXPORT_TO_SELECTED_DIRECTORY',
          confirmationToken: confirmation.confirmationToken,
        },
        caller,
      );
      let state = (await runtime.read({ view: 'LOCAL_DIAGNOSTICS' }, caller)) as {
        readonly outcome: string;
        readonly result: { readonly fileName: string; readonly resultToken: string } | null;
      };
      const deadline = Date.now() + 5_000;
      while (state.outcome === 'IDLE' && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        state = (await runtime.read({ view: 'LOCAL_DIAGNOSTICS' }, caller)) as typeof state;
      }
      expect(state).toMatchObject({ outcome: 'SUCCESS', result: { fileName: expect.any(String) } });
      if (state.result === null) throw new Error('missing diagnostic result');
      expect(readdirSync(value.backupRoot)).toEqual([state.result.fileName]);
      await expect(
        runtime.mutate(
          { action: 'OPEN_LOCAL_DIAGNOSTIC_RESULT', resultToken: state.result.resultToken },
          otherCaller,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(
        runtime.mutate(
          { action: 'OPEN_LOCAL_DIAGNOSTIC_RESULT', resultToken: state.result.resultToken },
          caller,
        ),
      ).resolves.toEqual({ opened: true });
      await expect(
        runtime.mutate(
          { action: 'OPEN_LOCAL_DIAGNOSTIC_RESULT', resultToken: state.result.resultToken },
          caller,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    } finally {
      runtime.close();
    }
  }, 15_000);
});
