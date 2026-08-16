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
  V2ContentError,
  V2InteractionError,
  V2_DEFAULT_WEEK_KEY,
  V2_IPC_CHANNELS,
  parseV2ReadRequest,
  parseV2MutationRequest,
  parseWeeklyPlan,
  summarizeV2Workspace,
  toV2Exception,
  type AccountPersona,
  type AccountPersonaFields,
  type PlanReschedulePreview,
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
    approveContentPackages: async () => ({
      error: toV2Exception(new V2ContentError('CONTENT_NOT_READY')),
      ok: false,
    }),
    confirmPlanCandidates: async (input) =>
      success(facade.mutate({ action: 'CONFIRM_PLAN_CANDIDATES', ...input }) as WeeklyPlan),
    confirmReplySuggestions: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    createInteraction: async () => ({
      error: toV2Exception(new V2InteractionError('INVALID_REQUEST')),
      ok: false,
    }),
    deleteInteraction: async () => ({
      error: toV2Exception(new V2InteractionError('INVALID_REQUEST')),
      ok: false,
    }),
    generateWeeklyPlan: async (input) =>
      success(facade.mutate({ action: 'GENERATE_WEEKLY_PLAN', ...input }) as WeeklyPlan),
    generateContentPackages: async () => ({
      error: toV2Exception(new V2ContentError('CONTENT_NOT_READY')),
      ok: false,
    }),
    generateReplySuggestion: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    lockWeeklyPlan: async (input) =>
      success(facade.mutate({ action: 'LOCK_WEEKLY_PLAN', ...input }) as WeeklyPlan),
    unlockWeeklyPlan: async (input) =>
      success(facade.mutate({ action: 'UNLOCK_WEEKLY_PLAN', ...input }) as WeeklyPlan),
    previewPlanReschedule: async (input) =>
      success(facade.read({ view: 'PLAN_RESCHEDULE_PREVIEW', ...input }) as PlanReschedulePreview),
    exportContentPackages: async () => ({
      error: toV2Exception(new V2ContentError('CONTENT_NOT_APPROVED')),
      ok: false,
    }),
    openContentExport: async () => ({
      error: toV2Exception(new V2ContentError('EXPORT_FAILED')),
      ok: false,
    }),
    markInteractionManualSent: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    previewInteractionDelete: async () => ({
      error: toV2Exception(new V2InteractionError('INVALID_REQUEST')),
      ok: false,
    }),
    readContentPackages: async (input) =>
      success({ packages: [], schemaVersion: 1 as const, weekKey: input.weekKey }),
    readInteractions: async () => success({ items: [], schemaVersion: 1 as const }),
    readPersona: async () => success(facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona),
    readWeeklyPlan: async (input) =>
      success(facade.read({ view: 'WEEKLY_PLAN', ...input }) as WeeklyPlan),
    reschedulePlanCandidates: async (input) =>
      success(facade.mutate({ action: 'RESCHEDULE_PLAN_CANDIDATES', ...input }) as WeeklyPlan),
    reopenInteraction: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    saveReplySuggestion: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    saveContentPackage: async () => ({
      error: toV2Exception(new V2ContentError('CONTENT_NOT_READY')),
      ok: false,
    }),
    skipPlanCandidates: async (input) =>
      success(facade.mutate({ action: 'SKIP_PLAN_CANDIDATES', ...input }) as WeeklyPlan),
    skipInteraction: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    undoInteractionManualSent: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
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
        allowConflicts: false,
        candidateIds: ['thu-1'],
        date: '2026-08-02',
        expectedRevision: -1,
        mode: 'DATE_TIME',
        staggerMinutes: 0,
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
  it('appends the R07 provenance and locked-plan history migrations without a table or trigger', async () => {
    const previous = MIGRATIONS.at(-2);
    const current = MIGRATIONS.at(-1);
    expect(current).toMatchObject({
      name: 'v2_weekly_plan_lock_history',
      version: (previous?.version ?? 0) + 1,
    });
    expect(previous).toMatchObject({ name: 'v2_generated_cover_and_model_provenance' });
    expect(current?.sql).toContain('locked_history_json');
    expect(current?.sql).not.toMatch(/CREATE\s+(?:TABLE|TRIGGER)/iu);
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
        { name: 'v2_content_package_versions', strict: 1 },
        { name: 'v2_content_packages', strict: 1 },
        { name: 'v2_interaction_items', strict: 1 },
        { name: 'v2_metric_snapshots', strict: 1 },
        { name: 'v2_reply_suggestion_versions', strict: 1 },
        { name: 'v2_strategy_decisions', strict: 1 },
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
      const seeded = new V2ApplicationFacade(new SqliteV2Repository(database));
      seeded.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY });
      database
        .prepare(
          `INSERT INTO v2_content_packages(workspace_id,package_id,week_key,candidate_id,plan_revision,current_version)
         VALUES ('v2-local-workspace','pkg-migration-check',?,'mon-1',0,1)`,
        )
        .run(V2_DEFAULT_WEEK_KEY);
      database
        .prepare(
          `INSERT INTO v2_content_package_versions(workspace_id,package_id,version,version_id,status,cover_key,files_json)
         VALUES ('v2-local-workspace','pkg-migration-check',1,'pkg-migration-check-v1','DRAFT','morgue',?)`,
        )
        .run(JSON.stringify(Array.from({ length: 6 }, () => ({}))));
      expect(() =>
        database
          .prepare(
            `UPDATE v2_content_package_versions SET generated_cover_path='exports/not-generated'
         WHERE package_id='pkg-migration-check'`,
          )
          .run(),
      ).toThrow();
      expect(() =>
        database
          .prepare(
            `UPDATE v2_content_package_versions SET generated_cover_path='generated-images/aa/${'a'.repeat(64)}'
         WHERE package_id='pkg-migration-check'`,
          )
          .run(),
      ).toThrow();
      const validCover = {
        height: 1440,
        mime: 'image/png',
        path: `generated-images/aa/${'a'.repeat(64)}`,
        sha256: 'b'.repeat(64),
        width: 1080,
      };
      const setCover = database.prepare(
        `UPDATE v2_content_package_versions
         SET generated_cover_path=?, generated_cover_mime=?, generated_cover_sha256=?,
             generated_cover_width=?, generated_cover_height=?
         WHERE package_id='pkg-migration-check'`,
      );
      for (const invalid of [
        { ...validCover, path: 'C:/generated-images/cover.png' },
        { ...validCover, path: 'https://example.invalid/cover.png' },
        { ...validCover, path: 'generated-images\\aa\\cover.png' },
        { ...validCover, mime: 'image/jpeg' },
        { ...validCover, sha256: 'not-a-hash' },
        { ...validCover, width: 0 },
      ]) {
        expect(() =>
          setCover.run(invalid.path, invalid.mime, invalid.sha256, invalid.width, invalid.height),
        ).toThrow();
      }
      database
        .prepare(
          `INSERT INTO model_runs(
             id, execution_id, task_kind, model_role, model_slot,
             provider_config_fingerprint, model_id, protocol_mode, prompt_template_id,
             prompt_version, prompt_content_hash, input_hash, cache_key, cache_policy,
             status, outcome_certainty, cost_state, started_at, finished_at, created_at, updated_at
           ) VALUES (
             'run-r07', 'execution-r07', 'V2_CONTENT_COPY_VERSION', 'WRITER', 'WRITING',
             '${'0'.repeat(64)}', 'fixture-model', 'MOCK', 'fixture-prompt', 1,
             'prompt-hash', 'input-hash', '${'1'.repeat(64)}', 'BYPASS', 'SUCCEEDED',
             'COMPLETED_INVALID_OUTPUT', 'UNPRICED_USAGE',
             '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:01.000Z',
             '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:01.000Z'
           )`,
        )
        .run();
      setCover.run(
        validCover.path,
        validCover.mime,
        validCover.sha256,
        validCover.width,
        validCover.height,
      );
      database
        .prepare(
          `UPDATE v2_content_package_versions
           SET copy_model_run_id='run-r07', cover_model_run_id='run-r07'
           WHERE package_id='pkg-migration-check'`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO v2_interaction_items(
             workspace_id,item_id,kind,source,user_text_path,user_text_sha256,
             user_text_size_bytes,dedup_key,status
           ) VALUES ('v2-local-workspace','interaction-r07','COMMENT','USER_PASTE',
             'imports/aa/${'a'.repeat(64)}','${'a'.repeat(64)}',10,'${'c'.repeat(64)}','NEW')`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO v2_reply_suggestion_versions(
             workspace_id,item_id,version,version_id,provider_kind,model_run_id,
             reply_path,reply_sha256,reply_size_bytes
           ) VALUES ('v2-local-workspace','interaction-r07',1,'reply-r07-v1','MODEL','run-r07',
             'imports/bb/${'b'.repeat(64)}','${'b'.repeat(64)}',10)`,
        )
        .run();
      database.prepare(`DELETE FROM model_runs WHERE id='run-r07'`).run();
      expect(
        database
          .prepare(
            `SELECT copy_model_run_id,cover_model_run_id FROM v2_content_package_versions
             WHERE package_id='pkg-migration-check'`,
          )
          .get(),
      ).toEqual({ copy_model_run_id: null, cover_model_run_id: null });
      expect(
        database
          .prepare(
            `SELECT provider_kind,model_run_id FROM v2_reply_suggestion_versions
             WHERE item_id='interaction-r07'`,
          )
          .get(),
      ).toEqual({ model_run_id: null, provider_kind: 'MODEL' });
      expect(
        database
          .prepare(
            `SELECT cover_key,generated_cover_path,copy_model_run_id FROM v2_content_package_versions
         WHERE package_id='pkg-migration-check'`,
          )
          .get(),
      ).toEqual({
        copy_model_run_id: null,
        cover_key: 'morgue',
        generated_cover_path: validCover.path,
      });
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
      ).toEqual({ count: 8 });
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
      allowConflicts: true,
      candidateIds: ['thu-1'],
      date: '2026-08-02',
      expectedRevision: 0,
      mode: 'DATE_TIME',
      staggerMinutes: 0,
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
    const skipped = facade.mutate({
      action: 'SKIP_PLAN_CANDIDATES',
      candidateIds: ['sun-2'],
      expectedRevision: confirmed.revision,
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    expect(() =>
      facade.mutate({
        action: 'LOCK_WEEKLY_PLAN',
        expectedRevision: skipped.revision,
        weekKey: V2_DEFAULT_WEEK_KEY,
      }),
    ).toThrowError('PLAN_CONFLICT');
    database.close();

    database = connectDatabase(databasePath);
    facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    expect(facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona).toMatchObject({
      name: '重启后仍在',
      revision: 1,
    });
    const restoredPlan = facade.read({
      view: 'WEEKLY_PLAN',
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    expect(restoredPlan).toMatchObject({ revision: 3, status: 'DRAFT' });
    expect(restoredPlan.candidates.find(({ id }) => id === 'thu-1')).toMatchObject({
      date: '2026-08-02',
      day: '周日',
      status: 'CONFIRMED',
      time: '14:00',
    });
    expect(restoredPlan.candidates.find(({ id }) => id === 'sun-2')?.status).toBe('SKIPPED');
    database.close();
  });

  it('derives one editable draft from a locked snapshot and preserves the locked history', async () => {
    const databasePath = createTemporaryDatabasePath('v2 locked plan history');
    await initializeDatabase({ databasePath });
    let database = connectDatabase(databasePath);
    let facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    const draft = facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY }) as WeeklyPlan;
    const confirmed = facade.mutate({
      action: 'CONFIRM_PLAN_CANDIDATES',
      candidateIds: draft.candidates.map(({ id }) => id),
      expectedRevision: draft.revision,
      weekKey: draft.weekKey,
    }) as WeeklyPlan;
    const locked = facade.mutate({
      action: 'LOCK_WEEKLY_PLAN',
      expectedRevision: confirmed.revision,
      weekKey: confirmed.weekKey,
    }) as WeeklyPlan;
    const unlocked = facade.mutate({
      action: 'UNLOCK_WEEKLY_PLAN',
      expectedRevision: locked.revision,
      weekKey: locked.weekKey,
    }) as WeeklyPlan;
    expect(unlocked).toMatchObject({ revision: locked.revision + 1, status: 'DRAFT' });
    expect(
      facade.mutate({
        action: 'UNLOCK_WEEKLY_PLAN',
        expectedRevision: unlocked.revision,
        weekKey: unlocked.weekKey,
      }),
    ).toEqual(unlocked);
    expect(
      database
        .prepare(
          `SELECT locked_history_json FROM v2_weekly_plan_snapshots
           WHERE workspace_id='v2-local-workspace' AND week_key=?`,
        )
        .get(unlocked.weekKey),
    ).toEqual({
      locked_history_json: JSON.stringify([
        { candidates: locked.candidates, revision: locked.revision, status: 'CONFIRMED' },
      ]),
    });
    database.close();
    database = connectDatabase(databasePath);
    facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    expect(facade.read({ view: 'WEEKLY_PLAN', weekKey: unlocked.weekKey })).toMatchObject({
      revision: unlocked.revision,
      status: 'DRAFT',
    });
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
    await expect(read(trustedEvent, { view: 'ACCOUNT_PERSONA' })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      read(
        { sender, senderFrame: { url: 'https://example.invalid/v2.html' } },
        {
          view: 'ACCOUNT_PERSONA',
        },
      ),
    ).resolves.toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    await expect(
      read(trustedEvent, { extra: true, view: 'ACCOUNT_PERSONA' }),
    ).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      read(trustedEvent, { view: 'ACCOUNT_PERSONA' }, 'extra-argument'),
    ).resolves.toMatchObject({
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
      'approveContentPackages',
      'clearProviderCredential',
      'confirmPlanCandidates',
      'confirmProviderAction',
      'confirmReplySuggestions',
      'createInteraction',
      'decideStrategyRecommendation',
      'deleteInteraction',
      'executeContentCopyGeneration',
      'exportContentPackages',
      'generateContentPackages',
      'generateReplySuggestion',
      'generateWeeklyPlan',
      'lockWeeklyPlan',
      'markInteractionManualSent',
      'openContentExport',
      'previewContentCopyGeneration',
      'previewInteractionDelete',
      'previewPlanReschedule',
      'previewProviderAction',
      'previewProviderCapabilityProbe',
      'readContentPackages',
      'readInteractions',
      'readMetricsReview',
      'readPersona',
      'readProviderCapabilityProbeProgress',
      'readProviderSettings',
      'readWeeklyPlan',
      'reopenInteraction',
      'reschedulePlanCandidates',
      'saveContentPackage',
      'saveMetricSnapshots',
      'saveReplySuggestion',
      'setProviderCredential',
      'skipInteraction',
      'skipPlanCandidates',
      'startProviderCapabilityProbe',
      'undoInteractionManualSent',
      'unlockWeeklyPlan',
      'updatePersona',
      'updateProviderSettings',
    ]);
    expect('invoke' in exposed).toBe(false);
    expect('rednoteDesktop' in exposed).toBe(false);
    await exposed.readPersona();
    await exposed.readInteractions();
    await exposed.previewInteractionDelete({ itemId: 'interaction-1' });
    await exposed.readWeeklyPlan({ weekKey: V2_DEFAULT_WEEK_KEY });
    await exposed.previewPlanReschedule({
      candidateIds: ['thu-1'],
      date: '2026-08-03',
      expectedRevision: 0,
      mode: 'DATE_TIME',
      staggerMinutes: 0,
      time: '18:30',
      weekKey: V2_DEFAULT_WEEK_KEY,
    });
    const previewProviderAction = exposed.previewProviderAction;
    const confirmProviderAction = exposed.confirmProviderAction;
    if (previewProviderAction === undefined || confirmProviderAction === undefined) {
      throw new Error('R07 provider action bridge missing.');
    }
    await previewProviderAction({
      expectedRevision: 0,
      kind: 'WEEKLY_PLAN',
      weekKey: V2_DEFAULT_WEEK_KEY,
    });
    await confirmProviderAction({
      confirmation: 'RUN_PROVIDER_ACTION',
      previewToken: 'r07-preview-token',
    });
    await exposed.previewContentCopyGeneration?.({
      selectedPlanItemIds: ['mon-1'],
      userApprovedUnknownCost: true,
      weekKey: V2_DEFAULT_WEEK_KEY,
    });
    await exposed.executeContentCopyGeneration?.({ previewToken: 'r07-copy-preview-token' });
    await exposed.updatePersona({ expectedRevision: 0, persona: DEFAULT_ACCOUNT_PERSONA });
    await exposed.generateWeeklyPlan({ expectedRevision: 0, weekKey: V2_DEFAULT_WEEK_KEY });
    await exposed.confirmPlanCandidates({
      candidateIds: ['thu-1'],
      expectedRevision: 0,
      weekKey: V2_DEFAULT_WEEK_KEY,
    });
    await exposed.reschedulePlanCandidates({
      allowConflicts: false,
      candidateIds: ['thu-1'],
      date: '2026-08-03',
      expectedRevision: 0,
      mode: 'DATE_TIME',
      staggerMinutes: 0,
      time: '18:30',
      weekKey: V2_DEFAULT_WEEK_KEY,
    });
    await exposed.skipPlanCandidates({
      candidateIds: ['sun-2'],
      expectedRevision: 0,
      weekKey: V2_DEFAULT_WEEK_KEY,
    });
    await exposed.lockWeeklyPlan({ expectedRevision: 0, weekKey: V2_DEFAULT_WEEK_KEY });
    await exposed.createInteraction({
      expectedRevision: 0,
      kind: 'COMMENT',
      relatedContentPackageId: null,
      userText: 'synthetic',
    });
    await exposed.generateReplySuggestion({
      expectedRevision: 0,
      idempotencyKey: 'reply-1',
      itemId: 'interaction-1',
    });
    await exposed.saveReplySuggestion({
      expectedRevision: 1,
      expectedVersionId: 'interaction-1-v1',
      itemId: 'interaction-1',
      replyText: 'synthetic reply',
    });
    await exposed.confirmReplySuggestions({
      items: [
        {
          expectedRevision: 2,
          expectedVersionId: 'interaction-1-v2',
          itemId: 'interaction-1',
        },
      ],
    });
    await exposed.skipInteraction({ expectedRevision: 1, itemId: 'interaction-1' });
    await exposed.reopenInteraction({ expectedRevision: 2, itemId: 'interaction-1' });
    await exposed.markInteractionManualSent({
      confirmed: true,
      expectedRevision: 3,
      expectedVersionId: 'interaction-1-v2',
      itemId: 'interaction-1',
    });
    await exposed.undoInteractionManualSent({ expectedRevision: 4, itemId: 'interaction-1' });
    await exposed.deleteInteraction({
      confirmed: true,
      expectedRevision: 5,
      itemId: 'interaction-1',
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
    await user.click(screen.getByRole('button', { name: '保存人设' }));
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
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并应用' }));
    await waitFor(() => expect(screen.getByText(/本机 revision 1/u)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '确认所选' }));
    await waitFor(() => expect(screen.getByText(/本机 revision 2/u)).toBeInTheDocument());
    planView.unmount();
    database.close();

    database = connectDatabase(databasePath);
    facade = new V2ApplicationFacade(new SqliteV2Repository(database));
    exposeBridge(bridgeFor(facade));
    render(<V2App />);
    await waitFor(() => expect(screen.getByText(/本机 revision 2/u)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '待确认 0' })).toBeVisible();
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'v2\\_%' ESCAPE '\\'
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: 'v2_content_package_versions' },
      { name: 'v2_content_packages' },
      { name: 'v2_interaction_items' },
      { name: 'v2_metric_snapshots' },
      { name: 'v2_reply_suggestion_versions' },
      { name: 'v2_strategy_decisions' },
      { name: 'v2_weekly_plan_snapshots' },
      { name: 'v2_workspaces' },
    ]);
    database.close();
  });
});
