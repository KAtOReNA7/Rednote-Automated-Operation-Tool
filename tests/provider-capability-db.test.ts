import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  SqliteProviderCapabilityRepository,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import { buildCapabilityProbePlan } from '../packages/providers/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

const FROZEN_V1_TO_V5 = [
  '8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907',
  'ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce',
  '11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed',
  'c84c82c50f2170c20154c754d0604319082c6683737624a9c14d3a508315471c',
  '88c29c6160122eea91dc8f3b88c0cd0aafc58f91c3cfd6bcfdd2020209f6d808',
] as const;

function plan() {
  return buildCapabilityProbePlan(
    {
      baseUrl: 'http://127.0.0.1:43119/v1',
      credentialBindingVersion: 1,
      models: {
        image: null,
        provider: 'fixture-model',
        research: 'fixture-model',
        review: 'fixture-model',
        writing: 'fixture-model',
      },
      protocol: 'OPENAI_COMPATIBLE',
      settingsRevision: 1,
    },
    { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
  );
}

describe('Issue 013 capability persistence migration', () => {
  it('appends only v6 and freezes every previous migration checksum', () => {
    const migrationV6 = MIGRATIONS.at(5);
    expect(MIGRATIONS.slice(0, 6).map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(MIGRATIONS.slice(0, 5).map(migrationChecksum)).toEqual(FROZEN_V1_TO_V5);
    expect(migrationV6).toMatchObject({
      name: 'provider_capability_probing',
      version: 6,
    });
    if (migrationV6 === undefined) {
      throw new Error('Expected migration v6.');
    }
    expect(migrationChecksum(migrationV6)).toBe(
      'c3e2f5d21dbe9b86ba3cb6dc7967cb158228bd9112c6d322aac27e27392537f5',
    );
    expect(Object.isFrozen(migrationV6)).toBe(true);
  });

  it('creates STRICT constrained tables without changing model_runs or cost_ledger', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const tables = database
        .prepare(
          `SELECT name, strict
           FROM pragma_table_list
           WHERE name IN ('provider_capability_probe_runs', 'provider_capability_entries')
           ORDER BY name`,
        )
        .all();
      expect(tables).toEqual([
        { name: 'provider_capability_entries', strict: 1 },
        { name: 'provider_capability_probe_runs', strict: 1 },
      ]);
      expect(
        database
          .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'model_runs'")
          .get(),
      ).toMatchObject({ sql: expect.not.stringContaining('capability') });
      expect(
        database
          .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'cost_ledger'")
          .get(),
      ).toMatchObject({ sql: expect.not.stringContaining('capability') });
    } finally {
      database.close();
    }
  });

  it('backs up a v5 database before applying v6', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 5) });
    const result = await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 6) });
    expect(result.appliedVersions).toEqual([6]);
    expect(result.backupPath).not.toBeNull();
  });

  it('recovers RUNNING to INTERRUPTED without replay and stores current SUCCEEDED matrix', async () => {
    const { database } = await createInitializedDatabase();
    try {
      database
        .prepare(
          `UPDATE app_settings
           SET credential_binding_version = 1, revision = revision + 1
           WHERE id = 'app'`,
        )
        .run();
      const repository = new SqliteProviderCapabilityRepository(database);
      const currentPlan = plan();
      repository.createRun('probe-recovery-000001', currentPlan, '2026-07-28T00:00:00.000Z');
      expect(repository.recoverInterrupted('2026-07-28T00:00:01.000Z')).toBe(1);
      expect(repository.getState(currentPlan.configFingerprint, 1).derivedState).toBe(
        'INTERRUPTED',
      );

      repository.createRun('probe-success-000001', currentPlan, '2026-07-28T00:00:02.000Z');
      repository.recordObservation(
        'probe-success-000001',
        currentPlan,
        {
          capability: 'text',
          confidence: 'CONFIRMED',
          maxContextTokens: null,
          modelId: 'fixture-model',
          modelSlots: ['RESEARCH'],
          observedAt: '2026-07-28T00:00:03.000Z',
          protocolMode: 'RESPONSES',
          rateLimitRequests: null,
          rateLimitTokens: null,
          reasonCode: 'NOT_PROBED',
          safeDetails: {},
          source: 'PROBED',
          state: 'SUPPORTED',
        },
        '2026-07-28T00:00:03.000Z',
      );
      repository.finishRun('probe-success-000001', {
        completedAt: '2026-07-28T00:00:04.000Z',
        reasonCode: null,
        sentRequestCount: currentPlan.requestCount,
        status: 'SUCCEEDED',
      });
      expect(repository.getState(currentPlan.configFingerprint, 1)).toMatchObject({
        derivedState: 'PROBE_COMPLETE',
        entries: [
          {
            capability: 'text',
            modelId: 'fixture-model',
            stale: false,
            state: 'SUPPORTED',
          },
        ],
        runId: 'probe-success-000001',
      });
      repository.createRun('probe-partial-000001', currentPlan, '2026-07-28T00:00:05.000Z');
      repository.recordObservation(
        'probe-partial-000001',
        currentPlan,
        {
          capability: 'structuredJson',
          confidence: 'INCONCLUSIVE',
          maxContextTokens: null,
          modelId: 'fixture-model',
          modelSlots: ['RESEARCH', 'WRITING'],
          observedAt: '2026-07-28T00:00:06.000Z',
          protocolMode: 'RESPONSES',
          rateLimitRequests: null,
          rateLimitTokens: null,
          reasonCode: 'SCHEMA_MISMATCH',
          safeDetails: { status: 200 },
          source: 'PROBED',
          state: 'UNKNOWN',
        },
        '2026-07-28T00:00:06.000Z',
      );
      repository.finishRun('probe-partial-000001', {
        completedAt: '2026-07-28T00:00:07.000Z',
        reasonCode: 'SCHEMA_MISMATCH',
        sentRequestCount: 1,
        status: 'PARTIAL',
      });
      expect(repository.getState(currentPlan.configFingerprint, 1)).toMatchObject({
        derivedState: 'PARTIAL',
        entries: [
          {
            modelSlot: 'RESEARCH',
            reasonCode: 'SCHEMA_MISMATCH',
            safeDetails: { status: 200 },
            state: 'UNKNOWN',
          },
          {
            modelSlot: 'WRITING',
            reasonCode: 'SCHEMA_MISMATCH',
            safeDetails: { status: 200 },
            state: 'UNKNOWN',
          },
        ],
        runId: 'probe-partial-000001',
      });
      expect(repository.getState(currentPlan.configFingerprint, 2).derivedState).toBe('STALE');
    } finally {
      database.close();
    }
  });

  it('rejects invalid state and capability values at the SQLite boundary', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const currentPlan = plan();
      const repository = new SqliteProviderCapabilityRepository(database);
      repository.createRun('probe-constraints-0001', currentPlan, '2026-07-28T00:00:00.000Z');
      expect(() =>
        database
          .prepare(
            `INSERT INTO provider_capability_entries(
               id, run_id, config_fingerprint, settings_revision,
               credential_binding_version, contract_version, model_slot,
               protocol_mode, capability, state, reason_code, source, confidence,
               stale, safe_details_json, observed_at, created_at
             ) VALUES (?, ?, ?, 1, 1, 'provider-capabilities-v1', 'RESEARCH',
                       'RESPONSES', 'arbitrary', 'MAYBE', 'NOT_PROBED', 'PROBED',
                       'CONFIRMED', 0, '{}', ?, ?)`,
          )
          .run(
            'cap-invalid-0000001',
            'probe-constraints-0001',
            currentPlan.configFingerprint,
            '2026-07-28T00:00:01.000Z',
            '2026-07-28T00:00:01.000Z',
          ),
      ).toThrow(/CHECK constraint failed/iu);
    } finally {
      database.close();
    }
  });
});
