import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { WebRepositoryError, parseWebWorkspaceState } from '../apps/web-ui/src/v2/web/contracts.js';
import { assertWriteTarget, pathSegments } from '../apps/web-ui/src/v2/web/folder-port.js';
import { BrowserWorkspaceRepository } from '../apps/web-ui/src/v2/web/repository.js';
import { MemoryFolder, MemoryLock } from './support/web-folder-fixture.js';

function repository(folder = new MemoryFolder(), lock = new MemoryLock()) {
  return {
    folder,
    lock,
    repository: new BrowserWorkspaceRepository(folder, {
      createId: () => 'ws_syntheticworkspace00000001',
      lock,
      now: () => new Date('2026-08-20T08:00:00.000Z'),
    }),
  };
}

describe('Web local-folder repository W01-W08', () => {
  it('W01/W03 creates one strict workspace and verifies snapshot readback/hash', async () => {
    const context = repository();
    const loaded = await context.repository.connect();
    expect(loaded.generation).toBe(1);
    expect(loaded.state.workspaceId).toBe('ws_syntheticworkspace00000001');
    expect([...context.folder.files.keys()].sort()).toEqual([
      'rednote-workspace.json',
      'state/index-a.json',
      'state/snapshots/00000001.json',
    ]);
    const bytes = context.folder.files.get('state/snapshots/00000001.json');
    expect(bytes).toBeDefined();
    expect(loaded.index.bytes).toBe(bytes?.byteLength);
    expect(loaded.index.sha256).toBe(
      createHash('sha256')
        .update(bytes ?? new Uint8Array())
        .digest('hex'),
    );
  });

  it('W02 restores committed business state after handle metadata is lost', async () => {
    const context = repository();
    const initial = await context.repository.connect();
    const saved = await context.repository.commit(
      parseWebWorkspaceState({ ...initial.state, activeWeekKey: '2026-W35' }),
      initial.generation,
    );
    const reopened = new BrowserWorkspaceRepository(context.folder, {
      createId: () => 'unused_identifier',
      lock: context.lock,
      now: () => new Date('2026-08-21T08:00:00.000Z'),
    });
    await expect(reopened.connect()).resolves.toMatchObject({
      generation: saved.generation,
      state: { activeWeekKey: '2026-W35' },
    });
  });

  it('W04 keeps the previous generation when the next index write is interrupted', async () => {
    const context = repository();
    const initial = await context.repository.connect();
    context.folder.failPath = 'state/index-b.json';
    await expect(
      context.repository.commit(
        parseWebWorkspaceState({ ...initial.state, activeWeekKey: '2026-W35' }),
        initial.generation,
      ),
    ).rejects.toThrow('SYNTHETIC_INTERRUPTION');
    context.folder.failPath = null;
    await expect(context.repository.load(initial.state.workspaceId)).resolves.toMatchObject({
      generation: 1,
      state: { activeWeekKey: initial.state.activeWeekKey },
    });
  });

  it('W05 falls back when the newest immutable snapshot is truncated', async () => {
    const context = repository();
    const initial = await context.repository.connect();
    await context.repository.commit(
      parseWebWorkspaceState({ ...initial.state, activeWeekKey: '2026-W35' }),
      initial.generation,
    );
    context.folder.corrupt('state/snapshots/00000002.json');
    await expect(context.repository.load(initial.state.workspaceId)).resolves.toMatchObject({
      generation: 1,
      recoveryWarning: '已回退到上一份可验证状态。',
    });
  });

  it('W06 fails closed without writes when both generations are invalid', async () => {
    const context = repository();
    const initial = await context.repository.connect();
    await context.repository.commit(
      parseWebWorkspaceState({ ...initial.state, activeWeekKey: '2026-W35' }),
      initial.generation,
    );
    context.folder.corrupt('state/snapshots/00000001.json');
    context.folder.corrupt('state/snapshots/00000002.json');
    const writes = context.folder.writes;
    await expect(context.repository.load(initial.state.workspaceId)).rejects.toMatchObject({
      code: 'RECOVERY_FAILED',
    });
    expect(context.folder.writes).toBe(writes);
  });

  it('W07 rejects wrong workspace identity and unsafe paths', async () => {
    const context = repository();
    await context.repository.connect();
    await expect(context.repository.connect('ws_differentworkspace00000001')).rejects.toMatchObject(
      { code: 'INVALID_WORKSPACE' },
    );
    for (const path of ['../state.json', 'C:/state.json', 'https://host/state.json', 'a\\b']) {
      expect(() => pathSegments(path)).toThrow(WebRepositoryError);
    }
    expect(() => assertWriteTarget('state/unknown.json', 'replace')).toThrow(WebRepositoryError);
    context.folder.files.set(
      'rednote-workspace.json',
      new TextEncoder().encode(
        JSON.stringify({
          createdAt: '2026-08-20T08:00:00.000Z',
          format: 'rednote-web-workspace',
          schemaVersion: 99,
          workspaceId: 'ws_syntheticworkspace00000001',
        }),
      ),
    );
    await expect(context.repository.connect()).rejects.toMatchObject({
      code: 'INVALID_WORKSPACE',
    });
  });

  it('W08 rejects a second writer instead of last-write-wins', async () => {
    const context = repository();
    const loaded = await context.repository.connect();
    context.lock.available = false;
    await expect(
      context.repository.commit(
        parseWebWorkspaceState({ ...loaded.state, activeWeekKey: '2026-W35' }),
        loaded.generation,
      ),
    ).rejects.toMatchObject({ code: 'WRITE_LOCKED' });
    expect((await context.repository.load(loaded.state.workspaceId)).generation).toBe(1);
  });
});
