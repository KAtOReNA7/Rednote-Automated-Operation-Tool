// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectDatabase,
  initializeDatabase,
  MIGRATIONS,
  MigrationError,
  SqliteV2Repository,
} from '../packages/db/src/index.js';
import {
  DEFAULT_ACCOUNT_PERSONA,
  DEFAULT_WEEKLY_PLAN,
  V2ApplicationFacade,
  V2ContractError,
  V2_DEFAULT_WEEK_KEY,
  V2_IPC_CHANNELS,
  parseV2ReadRequest,
  parseV2MutationRequest,
  parseWeeklyPlan,
  summarizeV2Workspace,
  type AccountPersona,
  type AccountPersonaFields,
  type V2Bridge,
  type V2Result,
  type WeeklyPlan,
} from '../packages/v2/src/index.js';
import { V2App } from '../apps/web-ui/src/v2/app.js';
import {
  cleanTemporaryDatabases,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

const electron = vi.hoisted(() => ({
  exposed: vi.fn(),
  fromWebContents: vi.fn(),
  handlers: new Map<string, (...args: readonly unknown[]) => unknown>(),
  invoke: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: electron.fromWebContents },
  contextBridge: { exposeInMainWorld: electron.exposed },
  ipcMain: {
    handle: (channel: string, handler: (...args: readonly unknown[]) => unknown) =>
      electron.handlers.set(channel, handler),
    removeHandler: (channel: string) => electron.handlers.delete(channel),
  },
  ipcRenderer: { invoke: electron.invoke },
}));

afterEach(() => {
  cleanup();
  electron.exposed.mockReset();
  electron.fromWebContents.mockReset();
  electron.handlers.clear();
  electron.invoke.mockReset();
  Reflect.deleteProperty(window, 'rednoteV2');
  window.history.replaceState(null, '', '/');
  cleanTemporaryDatabases();
});

function success<T>(value: T): V2Result<T> {
  return { ok: true, value };
}

function bridgeFor(facade: V2ApplicationFacade): V2Bridge {
  return {
    confirmPlanCandidates: async (input) =>
      success(facade.mutate({ action: 'CONFIRM_PLAN_CANDIDATES', ...input }) as WeeklyPlan),
    readPersona: async () => success(facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona),
    readWeeklyPlan: async (input) =>
      success(facade.read({ view: 'WEEKLY_PLAN', ...input }) as WeeklyPlan),
    reschedulePlanCandidates: async (input) =>
      success(facade.mutate({ action: 'RESCHEDULE_PLAN_CANDIDATES', ...input }) as WeeklyPlan),
    updatePersona: async (input) =>
      success(facade.mutate({ action: 'UPDATE_PERSONA', ...input }) as AccountPersona),
  };
}

function exposeBridge(bridge: V2Bridge): void {
  Object.defineProperty(window, 'rednoteV2', { configurable: true, value: bridge });
}

describe('V2 pure contracts', () => {
  it('accepts only exact, bounded persona and plan mutations', () => {
    expect(
      parseV2MutationRequest({
        action: 'UPDATE_PERSONA',
        expectedRevision: 0,
        persona: {
          audience: '普通读者',
          boundary: '关键诡计前提示',
          name: '雾灯书页',
          tone: '理性短句',
        },
      }),
    ).toMatchObject({ action: 'UPDATE_PERSONA', expectedRevision: 0 });

    for (const invalid of [
      {
        action: 'UPDATE_PERSONA',
        expectedRevision: 0,
        persona: { ...DEFAULT_ACCOUNT_PERSONA, aiDisclosure: false },
      },
      {
        action: 'UPDATE_PERSONA',
        expectedRevision: 0,
        persona: { audience: 'a', boundary: 'b', name: 'n', tone: 't' },
        pinnedComment: 'forbidden',
      },
      {
        action: 'CONFIRM_PLAN_CANDIDATES',
        candidateIds: Array.from({ length: 41 }, (_, index) => `candidate-${index}`),
        expectedRevision: 0,
        weekKey: V2_DEFAULT_WEEK_KEY,
      },
      {
        action: 'RESCHEDULE_PLAN_CANDIDATES',
        candidateIds: ['thu-1'],
        date: '8/2',
        day: '周日',
        expectedRevision: -1,
        time: '14:00',
        weekKey: V2_DEFAULT_WEEK_KEY,
      },
    ]) {
      expect(() => parseV2MutationRequest(invalid)).toThrow(V2ContractError);
    }

    const candidate = DEFAULT_WEEKLY_PLAN.candidates[0];
    expect(() =>
      parseWeeklyPlan({
        ...DEFAULT_WEEKLY_PLAN,
        candidates: [{ ...candidate, copyrightRisk: 'HIGH' }],
      }),
    ).toThrow(V2ContractError);

    for (const syntheticPath of [
      'C:\\synthetic',
      'C:synthetic',
      '\\\\server\\synthetic',
      '\\\\?\\C:\\synthetic',
      'file:///synthetic',
      '/synthetic',
    ]) {
      expect(() =>
        parseV2MutationRequest({
          action: 'UPDATE_PERSONA',
          expectedRevision: 0,
          persona: { ...DEFAULT_ACCOUNT_PERSONA, name: syntheticPath },
        }),
      ).toThrow(V2ContractError);
    }

    expect(summarizeV2Workspace(DEFAULT_ACCOUNT_PERSONA, DEFAULT_WEEKLY_PLAN)).toEqual({
      conflictCount: 1,
      confirmedCount: 0,
      pendingCount: 3,
      personaRevision: 0,
      planRevision: 0,
    });
  });
});

describe('V2 migration and repository', () => {
  it('appends one migration with exactly two STRICT v2_ tables and no triggers', async () => {
    const previous = MIGRATIONS.at(-2);
    const current = MIGRATIONS.at(-1);
    expect(current).toMatchObject({
      name: 'v2_persona_and_weekly_plan_persistence',
      version: (previous?.version ?? 0) + 1,
    });
    const databasePath = createTemporaryDatabasePath('v2 new database');
    const result = await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);
    try {
      const tables = database
        .prepare(
          `SELECT name, "strict" FROM pragma_table_list
           WHERE name LIKE 'v2\\_%' ESCAPE '\\' ORDER BY name`,
        )
        .all();
      expect(result.appliedVersions.at(-1)).toBe(current?.version);
      expect(tables).toEqual([
        { name: 'v2_weekly_plan_snapshots', strict: 1 },
        { name: 'v2_workspaces', strict: 1 },
      ]);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_schema
             WHERE type = 'trigger' AND name LIKE 'v2\\_%' ESCAPE '\\'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('backs up an old database, keeps old data, and rolls back a failed V2 migration', async () => {
    const databasePath = createTemporaryDatabasePath('v2 upgrade');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, -1) });
    let database = connectDatabase(databasePath);
    database
      .prepare(`INSERT INTO account_profiles(id, working_name) VALUES ('keep', '保留旧数据')`)
      .run();
    database.close();

    const migrated = await initializeDatabase({ databasePath });
    expect(existsSync(migrated.backupPath ?? '')).toBe(true);
    const backup = new DatabaseSync(migrated.backupPath ?? '', { readOnly: true });
    try {
      expect(backup.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual(
        {
          version: MIGRATIONS.length - 1,
        },
      );
      expect(
        backup.prepare(`SELECT working_name FROM account_profiles WHERE id = 'keep'`).get(),
      ).toEqual({ working_name: '保留旧数据' });
    } finally {
      backup.close();
    }

    const failingPath = createTemporaryDatabasePath('v2 rollback');
    await initializeDatabase({ databasePath: failingPath, migrations: MIGRATIONS.slice(0, -1) });
    database = connectDatabase(failingPath);
    database
      .prepare(`INSERT INTO account_profiles(id, working_name) VALUES ('keep', '回滚后仍在')`)
      .run();
    database.close();
    const last = MIGRATIONS.at(-1);
    if (last === undefined) throw new Error('missing V2 migration');
    await expect(
      initializeDatabase({
        databasePath: failingPath,
        migrations: [
          ...MIGRATIONS.slice(0, -1),
          { ...last, sql: `${last.sql}\nINSERT INTO missing_v2_table(id) VALUES ('fail');` },
        ],
      }),
    ).rejects.toBeInstanceOf(MigrationError);
    database = connectDatabase(failingPath);
    try {
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_schema
             WHERE type = 'table' AND name LIKE 'v2\\_%' ESCAPE '\\'`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database.prepare(`SELECT working_name FROM account_profiles WHERE id = 'keep'`).get(),
      ).toEqual({ working_name: '回滚后仍在' });
    } finally {
      database.close();
    }
  });

  it('creates, no-ops, rejects stale revisions, and restores persona and plan', async () => {
    const databasePath = createTemporaryDatabasePath('v2 repository');
    await initializeDatabase({ databasePath });
    let database = connectDatabase(databasePath);
    let facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    expect((facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona).revision).toBe(0);
    expect(
      (facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY }) as WeeklyPlan).candidates,
    ).toHaveLength(21);
    const fields: AccountPersonaFields = {
      audience: '希望快速进入古典推理的普通读者',
      boundary: DEFAULT_ACCOUNT_PERSONA.boundary,
      name: '重启后仍在',
      tone: DEFAULT_ACCOUNT_PERSONA.tone,
    };
    const saved = facade.mutate({
      action: 'UPDATE_PERSONA',
      expectedRevision: 0,
      persona: fields,
    }) as AccountPersona;
    expect(saved.revision).toBe(1);
    expect(
      (
        facade.mutate({
          action: 'UPDATE_PERSONA',
          expectedRevision: 1,
          persona: fields,
        }) as AccountPersona
      ).revision,
    ).toBe(1);
    expect(() =>
      facade.mutate({ action: 'UPDATE_PERSONA', expectedRevision: 0, persona: fields }),
    ).toThrowError('REVISION_CONFLICT');

    const moved = facade.mutate({
      action: 'RESCHEDULE_PLAN_CANDIDATES',
      candidateIds: ['thu-1'],
      date: '8/2',
      day: '周日',
      expectedRevision: 0,
      time: '14:00',
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    const confirmed = facade.mutate({
      action: 'CONFIRM_PLAN_CANDIDATES',
      candidateIds: ['thu-1'],
      expectedRevision: moved.revision,
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    expect(confirmed.revision).toBe(2);
    database.close();

    database = connectDatabase(databasePath);
    facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    expect(facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona).toMatchObject({
      name: '重启后仍在',
      revision: 1,
    });
    expect(
      (
        facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY }) as WeeklyPlan
      ).candidates.find(({ id }) => id === 'thu-1'),
    ).toMatchObject({ date: '8/2', day: '周日', status: 'CONFIRMED', time: '14:00' });
    database.close();
  });
});

describe('V2 Electron boundary', () => {
  it('registers exactly two channels and rejects wrong sender, origin and payload', async () => {
    const { registerV2Ipc } = await import('../apps/desktop/src/v2-runtime.js');
    const expectedWindow = { id: 7 };
    const senderFrame = { url: 'rednote://app/v2.html#/v2/overview' };
    const sender = { mainFrame: senderFrame };
    electron.fromWebContents.mockReturnValue(expectedWindow);
    const runtime = {
      mutate: vi.fn((input: unknown) => {
        parseV2MutationRequest(input);
        return DEFAULT_ACCOUNT_PERSONA;
      }),
      read: vi.fn((input: unknown) => {
        parseV2ReadRequest(input);
        return DEFAULT_ACCOUNT_PERSONA;
      }),
    };
    const remove = registerV2Ipc({
      expectedRendererUrl: 'rednote://app/v2.html',
      getWindow: () => expectedWindow as never,
      runtime: runtime as never,
    });
    expect([...electron.handlers.keys()].sort()).toEqual(Object.values(V2_IPC_CHANNELS).sort());
    const read = electron.handlers.get(V2_IPC_CHANNELS.read);
    if (read === undefined) throw new Error('missing V2 read handler');
    const trustedEvent = { sender, senderFrame };
    expect(read(trustedEvent, { view: 'ACCOUNT_PERSONA' })).toMatchObject({ ok: true });
    expect(
      read(
        { sender, senderFrame: { url: 'https://example.invalid/v2.html' } },
        {
          view: 'ACCOUNT_PERSONA',
        },
      ),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    expect(read(trustedEvent, { extra: true, view: 'ACCOUNT_PERSONA' })).toMatchObject({
      ok: false,
    });
    expect(read(trustedEvent, { view: 'ACCOUNT_PERSONA' }, 'extra-argument')).toMatchObject({
      ok: false,
    });
    remove();
    expect(electron.handlers.size).toBe(0);
  });

  it('exposes named V2 methods while using only the two private channels', async () => {
    electron.invoke.mockResolvedValue(success(DEFAULT_ACCOUNT_PERSONA));
    await import('../apps/desktop/src/v2-preload.js');
    expect(electron.exposed).toHaveBeenCalledTimes(1);
    const [key, exposed] = electron.exposed.mock.calls[0] as [string, V2Bridge];
    expect(key).toBe('rednoteV2');
    expect(Object.keys(exposed).sort()).toEqual([
      'confirmPlanCandidates',
      'readPersona',
      'readWeeklyPlan',
      'reschedulePlanCandidates',
      'updatePersona',
    ]);
    expect('invoke' in exposed).toBe(false);
    expect('rednoteDesktop' in exposed).toBe(false);
    await exposed.readPersona();
    await exposed.readWeeklyPlan({ weekKey: V2_DEFAULT_WEEK_KEY });
    await exposed.updatePersona({ expectedRevision: 0, persona: DEFAULT_ACCOUNT_PERSONA });
    await exposed.confirmPlanCandidates({
      candidateIds: ['thu-1'],
      expectedRevision: 0,
      weekKey: V2_DEFAULT_WEEK_KEY,
    });
    expect(new Set(electron.invoke.mock.calls.map(([channel]) => channel))).toEqual(
      new Set(Object.values(V2_IPC_CHANNELS)),
    );
  });
});

describe('V2 renderer persistence wiring', () => {
  it('saves existing persona and weekly-plan controls and restores them after reopening', async () => {
    const databasePath = createTemporaryDatabasePath('v2 renderer');
    await initializeDatabase({ databasePath });
    let database = connectDatabase(databasePath);
    let facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    exposeBridge(bridgeFor(facade));
    window.history.replaceState(null, '', '/v2.html#/v2/settings');
    const user = userEvent.setup();
    const first = render(<V2App />);
    const name = await screen.findByRole('textbox', { name: '账号名称' });
    await user.clear(name);
    await user.type(name, '本机重启恢复账号');
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    expect(await screen.findByText(/revision 1/u)).toBeInTheDocument();
    first.unmount();
    database.close();

    database = connectDatabase(databasePath);
    facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    exposeBridge(bridgeFor(facade));
    const reopened = render(<V2App />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '账号名称' })).toHaveValue('本机重启恢复账号'),
    );
    reopened.unmount();

    window.history.replaceState(null, '', '/v2.html#/v2/weekly-plan');
    const planView = render(<V2App />);
    await waitFor(() => expect(screen.getByText(/本机 revision 0/u)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '选择待确认' }));
    await user.click(screen.getByRole('button', { name: '调整日期' }));
    fireEvent.click(screen.getByRole('button', { name: '确认调整' }));
    await waitFor(() => expect(screen.getByText(/本机 revision 1/u)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '确认所选 (3)' }));
    await waitFor(() => expect(screen.getByText(/本机 revision 2/u)).toBeInTheDocument());
    planView.unmount();
    database.close();

    database = connectDatabase(databasePath);
    facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    exposeBridge(bridgeFor(facade));
    render(<V2App />);
    await waitFor(() => expect(screen.getByText(/本机 revision 2/u)).toBeInTheDocument());
    expect(screen.getAllByText('已确认')).toHaveLength(3);
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'v2\\_%' ESCAPE '\\'
           ORDER BY name`,
        )
        .all(),
    ).toEqual([{ name: 'v2_weekly_plan_snapshots' }, { name: 'v2_workspaces' }]);
    database.close();
  });
});
