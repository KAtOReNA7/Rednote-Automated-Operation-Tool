import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PROJECT_LOCATOR_FILE,
  PROJECT_LOCATOR_FORMAT,
  PROJECT_LOCATOR_SUBDIRECTORY,
  LocalProjectLocator,
  initializeProjectDataRoot,
  projectLocatorPathForTesting,
} from '../packages/storage/src/index.js';
import {
  DataRootSelectionBroker,
  type DirectoryDialog,
} from '../apps/desktop/src/data-root-selection.js';

const temporaryDirectories: string[] = [];

async function temporaryPath(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `rednote-issue010-${label}-`));
  temporaryDirectories.push(path);
  return path;
}

async function locatorContext() {
  const parent = await temporaryPath('locator');
  const userData = join(parent, 'user data');
  const root = await initializeProjectDataRoot(join(parent, 'project data'), {
    now: () => new Date('2026-07-27T00:00:00.000Z'),
    randomId: () => '00000000-0000-4000-8000-000000000010',
  });
  const locator = new LocalProjectLocator(userData, {
    randomId: () => 'locator-write-0001',
  });
  return { locator, parent, root, userData };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('fixed local project locator', () => {
  it('starts unconfigured and atomically publishes the exact versioned record', async () => {
    const test = await locatorContext();
    await expect(test.locator.read()).resolves.toEqual({ status: 'NOT_CONFIGURED' });

    const record = await test.locator.activate(
      {
        databasePath: join(test.root.databaseDirectory, 'rednote.sqlite'),
        displayPath: test.root.rootPath,
        instanceId: test.root.marker.instanceId,
        rootPath: test.root.rootPath,
      },
      null,
      '2026-07-27T12:00:00.000Z',
    );
    const path = projectLocatorPathForTesting(test.userData);
    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

    expect(path).toBe(join(test.userData, PROJECT_LOCATOR_SUBDIRECTORY, PROJECT_LOCATOR_FILE));
    expect(record.revision).toBe(0);
    expect(persisted).toEqual({
      activeDataRoot: test.root.rootPath,
      format: PROJECT_LOCATOR_FORMAT,
      projectInstanceId: test.root.marker.instanceId,
      revision: 0,
      updatedAt: '2026-07-27T12:00:00.000Z',
      version: 1,
    });
    expect(Object.keys(persisted).sort()).toEqual([
      'activeDataRoot',
      'format',
      'projectInstanceId',
      'revision',
      'updatedAt',
      'version',
    ]);
    await expect(test.locator.read()).resolves.toMatchObject({
      displayPath: test.root.rootPath,
      status: 'READY',
    });
  });

  it('uses revision conflicts to prevent last-write-wins', async () => {
    const test = await locatorContext();
    const prepared = {
      databasePath: join(test.root.databaseDirectory, 'rednote.sqlite'),
      displayPath: test.root.rootPath,
      instanceId: test.root.marker.instanceId,
      rootPath: test.root.rootPath,
    };
    await test.locator.activate(prepared, null, '2026-07-27T12:00:00.000Z');
    await expect(
      test.locator.activate(prepared, null, '2026-07-27T12:01:00.000Z'),
    ).rejects.toMatchObject({
      code: 'DATA_ROOT_SWITCH_CONFLICT',
      retryable: true,
    });
    await expect(test.locator.read()).resolves.toMatchObject({
      record: { revision: 0 },
      status: 'READY',
    });
  });

  it.each([
    ['invalid JSON', '{broken'],
    [
      'higher version',
      JSON.stringify({
        activeDataRoot: 'C:\\not-used',
        format: PROJECT_LOCATOR_FORMAT,
        projectInstanceId: 'instance-000010',
        revision: 0,
        updatedAt: '2026-07-27T12:00:00.000Z',
        version: 2,
      }),
    ],
  ])('enters recovery for %s without overwriting the locator', async (_label, content) => {
    const test = await locatorContext();
    await test.locator.activate(
      {
        databasePath: join(test.root.databaseDirectory, 'rednote.sqlite'),
        displayPath: test.root.rootPath,
        instanceId: test.root.marker.instanceId,
        rootPath: test.root.rootPath,
      },
      null,
      '2026-07-27T12:00:00.000Z',
    );
    const path = projectLocatorPathForTesting(test.userData);
    await writeFile(path, content, 'utf8');

    await expect(test.locator.read()).resolves.toMatchObject({
      code: 'PROJECT_LOCATOR_INVALID',
      status: 'RECOVERY_REQUIRED',
    });
    expect(await readFile(path, 'utf8')).toBe(content);
  });

  it('does not recreate a missing root and detects marker identity mismatch', async () => {
    const test = await locatorContext();
    const record = await test.locator.activate(
      {
        databasePath: join(test.root.databaseDirectory, 'rednote.sqlite'),
        displayPath: test.root.rootPath,
        instanceId: test.root.marker.instanceId,
        rootPath: test.root.rootPath,
      },
      null,
      '2026-07-27T12:00:00.000Z',
    );
    const moved = join(test.parent, 'project data moved');
    await rename(test.root.rootPath, moved);
    await expect(test.locator.read()).resolves.toEqual({
      code: 'PROJECT_ROOT_MISSING',
      status: 'RECOVERY_REQUIRED',
    });
    await expect(readFile(test.root.rootPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await rename(moved, test.root.rootPath);
    await writeFile(
      projectLocatorPathForTesting(test.userData),
      `${JSON.stringify({ ...record, projectInstanceId: 'different-instance' })}\n`,
      'utf8',
    );
    await expect(test.locator.read()).resolves.toEqual({
      code: 'PROJECT_INSTANCE_MISMATCH',
      status: 'RECOVERY_REQUIRED',
    });
  });

  it('keeps the old root and locator active if publishing a switch fails', async () => {
    const test = await locatorContext();
    const oldRecord = await test.locator.activate(
      {
        databasePath: join(test.root.databaseDirectory, 'rednote.sqlite'),
        displayPath: test.root.rootPath,
        instanceId: test.root.marker.instanceId,
        rootPath: test.root.rootPath,
      },
      null,
      '2026-07-27T12:00:00.000Z',
    );
    await writeFile(join(test.root.rootPath, 'keep-user-data.txt'), 'keep', 'utf8');
    const nextRoot = await initializeProjectDataRoot(join(test.parent, 'next project'));
    const failing = new LocalProjectLocator(test.userData, {
      beforePublish: () => {
        throw new Error('synthetic locator publication failure');
      },
      randomId: () => 'locator-write-failing',
    });

    await expect(
      failing.activate(
        {
          databasePath: join(nextRoot.databaseDirectory, 'rednote.sqlite'),
          displayPath: nextRoot.rootPath,
          instanceId: nextRoot.marker.instanceId,
          rootPath: nextRoot.rootPath,
        },
        oldRecord.revision,
        '2026-07-27T12:01:00.000Z',
      ),
    ).rejects.toMatchObject({ code: 'DATA_ROOT_SWITCH_CONFLICT' });
    await expect(test.locator.read()).resolves.toMatchObject({
      displayPath: test.root.rootPath,
      record: { revision: 0 },
      status: 'READY',
    });
    expect(await readFile(join(test.root.rootPath, 'keep-user-data.txt'), 'utf8')).toBe('keep');
  });
});

class FakeDirectoryDialog implements DirectoryDialog {
  public canceled = false;
  public filePaths: readonly string[] = ['C:\\selected project'];
  public properties: readonly string[] | null = null;

  public async showOpenDialog(
    _window: BrowserWindow,
    options: { readonly properties: readonly ['openDirectory', 'dontAddToRecent'] },
  ): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }> {
    this.properties = options.properties;
    return { canceled: this.canceled, filePaths: this.filePaths };
  }
}

describe('native data-root selection broker', () => {
  it('uses only openDirectory and dontAddToRecent and leaves no token on cancel', async () => {
    const dialog = new FakeDirectoryDialog();
    const window = { id: 44 } as BrowserWindow;
    const broker = new DataRootSelectionBroker(dialog, {
      now: () => new Date('2026-07-27T12:00:00.000Z'),
      randomId: () => 'selection-token-000010',
    });
    const selected = await broker.select(window, 55);
    expect(dialog.properties).toEqual(['openDirectory', 'dontAddToRecent']);
    expect(selected).toEqual({
      displayPath: 'C:\\selected project',
      expiresAt: '2026-07-27T12:02:00.000Z',
      token: 'selection-token-000010',
    });

    dialog.canceled = true;
    await expect(broker.select(window, 55)).resolves.toBeNull();
  });

  it('makes tokens short-lived, single-use, and bound to sender and window', async () => {
    let now = new Date('2026-07-27T12:00:00.000Z');
    let token = 0;
    const broker = new DataRootSelectionBroker(new FakeDirectoryDialog(), {
      now: () => now,
      randomId: () => `selection-token-${String(++token).padStart(6, '0')}`,
      tokenTtlMilliseconds: 1_000,
    });
    const first = await broker.select({ id: 44 } as BrowserWindow, 55);
    expect(first).not.toBeNull();
    expect(() => broker.consume(first?.token ?? '', 99, 44)).toThrow(
      expect.objectContaining({ code: 'DATA_ROOT_SELECTION_INVALID' }),
    );
    expect(() => broker.consume(first?.token ?? '', 55, 44)).toThrow(
      expect.objectContaining({ code: 'DATA_ROOT_SELECTION_EXPIRED' }),
    );

    const second = await broker.select({ id: 44 } as BrowserWindow, 55);
    expect(broker.consume(second?.token ?? '', 55, 44)).toBe('C:\\selected project');
    expect(() => broker.consume(second?.token ?? '', 55, 44)).toThrow(
      expect.objectContaining({ code: 'DATA_ROOT_SELECTION_EXPIRED' }),
    );

    const third = await broker.select({ id: 44 } as BrowserWindow, 55);
    now = new Date('2026-07-27T12:00:02.000Z');
    expect(() => broker.consume(third?.token ?? '', 55, 44)).toThrow(
      expect.objectContaining({ code: 'DATA_ROOT_SELECTION_EXPIRED' }),
    );
  });
});
