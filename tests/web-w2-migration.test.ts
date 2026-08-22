import { createHash } from 'node:crypto';

import { DEFAULT_ACCOUNT_PERSONA } from '@mystery-operations/v2';
import { describe, expect, it } from 'vitest';

import {
  WEB_WORKSPACE_FORMAT,
  newWorkspaceState,
  type WebWorkspaceStateV1,
} from '../apps/web-ui/src/v2/web/contracts.js';
import { BrowserWorkspaceRepository } from '../apps/web-ui/src/v2/web/repository.js';
import { MemoryFolder, MemoryLock } from './support/web-folder-fixture.js';

const WORKSPACE_ID = 'ws_w2migrationworkspace000001';
const NOW = new Date('2026-08-23T08:00:00.000Z');

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function legacyFolder(): MemoryFolder {
  const folder = new MemoryFolder();
  const current = newWorkspaceState(WORKSPACE_ID, '2026-W34', {
    ...DEFAULT_ACCOUNT_PERSONA,
    name: 'W1 保留人设',
  });
  const state: WebWorkspaceStateV1 = {
    activeWeekKey: current.activeWeekKey,
    contentByWeek: {},
    persona: current.persona,
    plans: {},
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
  };
  const snapshot = encode({
    generation: 1,
    savedAt: NOW.toISOString(),
    schemaVersion: 1,
    state,
    workspaceId: WORKSPACE_ID,
  });
  folder.files.set(
    'rednote-workspace.json',
    encode({
      createdAt: NOW.toISOString(),
      format: WEB_WORKSPACE_FORMAT,
      schemaVersion: 1,
      workspaceId: WORKSPACE_ID,
    }),
  );
  folder.files.set('state/snapshots/00000001.json', snapshot);
  folder.files.set(
    'state/index-a.json',
    encode({
      bytes: snapshot.byteLength,
      generation: 1,
      schemaVersion: 1,
      sha256: sha(snapshot),
      snapshotPath: 'state/snapshots/00000001.json',
      workspaceId: WORKSPACE_ID,
    }),
  );
  return folder;
}

function repository(folder: MemoryFolder): BrowserWorkspaceRepository {
  return new BrowserWorkspaceRepository(folder, {
    createId: () => 'unused-workspace-id',
    lock: new MemoryLock(),
    now: () => NOW,
  });
}

describe('Web W1→W2 append-only migration W2-01/W2-02', () => {
  it('keeps the immutable W1 snapshot and writes a reloadable W2 generation', async () => {
    const folder = legacyFolder();
    const original = folder.files.get('state/snapshots/00000001.json');
    const loaded = await repository(folder).connect(WORKSPACE_ID);
    expect(loaded).toMatchObject({
      generation: 2,
      recoveryWarning: 'W1 工作区已无损升级为 W2；原快照仍保留。',
      sourceSchemaVersion: 2,
      state: { persona: { name: 'W1 保留人设' }, schemaVersion: 2 },
    });
    expect(folder.files.get('state/snapshots/00000001.json')).toEqual(original);
    expect(folder.files.has('state/snapshots/00000002.json')).toBe(true);
    await expect(repository(folder).connect(WORKSPACE_ID)).resolves.toMatchObject({
      generation: 2,
      state: { persona: { name: 'W1 保留人设' }, schemaVersion: 2 },
    });
  });

  it('resumes an interrupted index switch from the exact verified W2 snapshot', async () => {
    const folder = legacyFolder();
    folder.failPath = 'state/index-b.json';
    await expect(repository(folder).connect(WORKSPACE_ID)).rejects.toThrow(
      'SYNTHETIC_INTERRUPTION',
    );
    const migrationSnapshot = folder.files.get('state/snapshots/00000002.json');
    expect(migrationSnapshot).toBeDefined();
    folder.failPath = null;
    await expect(repository(folder).connect(WORKSPACE_ID)).resolves.toMatchObject({
      generation: 2,
      recoveryWarning: '已安全续接中断的 W1→W2 升级。',
    });
    expect(folder.files.get('state/snapshots/00000002.json')).toEqual(migrationSnapshot);
  });

  it('falls back from a damaged latest snapshot without overwriting any generation', async () => {
    const folder = legacyFolder();
    await repository(folder).connect(WORKSPACE_ID);
    folder.corrupt('state/snapshots/00000002.json');
    const loaded = await repository(folder).connect(WORKSPACE_ID);
    expect(loaded).toMatchObject({ generation: 3, state: { schemaVersion: 2 } });
    expect(folder.files.has('state/snapshots/00000001.json')).toBe(true);
    expect(folder.files.has('state/snapshots/00000002.json')).toBe(true);
    expect(folder.files.has('state/snapshots/00000003.json')).toBe(true);
  });

  it('blocks unknown future manifest schema without writing', async () => {
    const folder = legacyFolder();
    folder.files.set(
      'rednote-workspace.json',
      encode({
        createdAt: NOW.toISOString(),
        format: WEB_WORKSPACE_FORMAT,
        schemaVersion: 99,
        workspaceId: WORKSPACE_ID,
      }),
    );
    const writes = folder.writes;
    await expect(repository(folder).connect()).rejects.toMatchObject({
      code: 'INVALID_WORKSPACE',
    });
    expect(folder.writes).toBe(writes);
  });
});
