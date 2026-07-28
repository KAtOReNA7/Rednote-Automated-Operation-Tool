import { afterEach, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';

import {
  MIGRATIONS,
  SqliteModelAccountingRepository,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
  type ModelRunIdentityInput,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function identity(executionId: string): ModelRunIdentityInput {
  return {
    cacheKey: HASH_A,
    cachePolicy: 'BYPASS',
    executionId,
    inputHash: HASH_B,
    jobId: null,
    modelId: 'fixture-model',
    modelRole: 'WRITING',
    modelSlot: 'WRITING',
    promptContentHash: HASH_A,
    promptTemplateId: 'prompt',
    promptVersion: 1,
    protocolMode: 'MOCK',
    providerConfigFingerprint: HASH_B,
    taskKind: 'TEXT_GENERATION',
  };
}

describe('Issue 014 SQLite v7 accounting and cache state', () => {
  it('adds only migration v7 and makes its normalized checksum newline-stable', () => {
    expect(MIGRATIONS.find((migration) => migration.version === 7)).toMatchObject({
      name: 'model_execution_cache_and_cost_ledger',
      version: 7,
    });
    const migration = MIGRATIONS.find(
      (candidate) => candidate.version === 7,
    ) as (typeof MIGRATIONS)[number];
    expect(migrationChecksum({ ...migration, sql: migration.sql.replaceAll('\n', '\r\n') })).toBe(
      migrationChecksum(migration),
    );
    expect(
      migrationChecksum({ ...migration, sql: `${migration.sql}\n-- semantic change` }),
    ).not.toBe(migrationChecksum(migration));
  });

  it('migrates v6 rows to v7 with a reopenable pre-migration backup', async () => {
    const databasePath = createTemporaryDatabasePath('v6 to v7');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 6) });
    const legacy = connectDatabase(databasePath);
    legacy
      .prepare(
        `INSERT INTO model_runs(
           id,role,provider,model,prompt_version,input_hash,output_hash,cached,
           input_tokens,output_tokens,image_count,estimated_cost_usd,status,started_at,completed_at
         ) VALUES ('legacy-run','WRITING','fixture','fixture-model','v1',?,?,0,
           100,20,0,1.25,'SUCCEEDED',?,?)`,
      )
      .run(HASH_A, HASH_B, '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:01.000Z');
    legacy
      .prepare(
        `INSERT INTO cost_ledger(
           id,model_run_id,billing_month,cost_source,amount_usd,
           token_or_call_units_json,created_at
         ) VALUES ('legacy-ledger','legacy-run','2026-07','LEGACY',1.25,'{}',?)`,
      )
      .run('2026-07-27T00:00:01.000Z');
    legacy.close();

    const migrated = await initializeDatabase({
      backupDirectory: join(dirname(databasePath), 'backups'),
      databasePath,
    });
    expect(migrated.backupPath).not.toBeNull();
    const current = connectDatabase(databasePath);
    expect(
      current
        .prepare(`SELECT execution_id,cost_amount_microusd FROM model_runs WHERE id='legacy-run'`)
        .get(),
    ).toEqual({ cost_amount_microusd: 1_250_000, execution_id: 'legacy:legacy-run' });
    expect(
      current.prepare(`SELECT amount_microusd FROM cost_ledger WHERE id='legacy-ledger'`).get(),
    ).toEqual({ amount_microusd: 1_250_000 });
    const backup = connectDatabase(migrated.backupPath as string);
    expect(
      (
        backup.prepare(`SELECT max(version) AS version FROM schema_migrations`).get() as {
          readonly version: number;
        }
      ).version,
    ).toBe(6);
    backup.close();
    current.close();
  });

  it('keeps every new money column integer or text and enforces an append-only ledger', async () => {
    const { database } = await createInitializedDatabase('model accounting schema');
    const moneyColumns = database
      .prepare(
        `SELECT m.name AS table_name,p.name,p.type
         FROM sqlite_master m,pragma_table_info(m.name) p
         WHERE m.name IN ('model_runs','cost_ledger','model_budget_reservations',
           'model_price_schedules') AND
           (p.name LIKE '%amount%' OR p.name LIKE '%usd%' OR p.name LIKE '%cents%')`,
      )
      .all() as unknown as readonly { readonly name: string; readonly type: string }[];
    expect(moneyColumns).not.toHaveLength(0);
    expect(moneyColumns.every((column) => ['INTEGER', 'TEXT'].includes(column.type))).toBe(true);
    expect(() =>
      database
        .prepare(
          `INSERT INTO cost_ledger(
             id,settlement_identity,execution_id,model_run_id,billing_month,
             provider_config_fingerprint,model_id,operation_kind,cost_state,cost_source,
             amount_microusd,usage_summary_json,created_at
           ) VALUES ('l','s','e','missing','2026-07',?,'m','TEXT',
             'UNPRICED_USAGE','NO_PRICE',NULL,'{}',?)`,
        )
        .run(HASH_A, '2026-07-28T00:00:00.000Z'),
    ).toThrow();
    const repository = new SqliteModelAccountingRepository(database, () => 'price-fixture');
    const price = repository.createPriceSchedule(
      {
        cachedInputPerMillionUsd: null,
        cacheWritePerMillionUsd: null,
        callUsd: null,
        imageGenerationCallUsd: null,
        imageUsd: null,
        inputPerMillionUsd: '1.25',
        inputTokensIncludeCachedInput: false,
        modelId: 'fixture-model',
        operationKind: 'TEXT_GENERATION',
        outputPerMillionUsd: '2.5',
        protocolMode: null,
        providerConfigFingerprint: HASH_A,
        searchCallUsd: null,
        toolUnitUsd: null,
        usageSemanticsVersion: 'usage-v1',
        version: 1,
      },
      '2026-07-28T00:00:00.000Z',
    );
    expect(() =>
      database
        .prepare(`UPDATE model_price_schedules SET input_per_million_usd='9' WHERE id=?`)
        .run(price.id),
    ).toThrowError('model price schedule versions are immutable');
    expect(() =>
      database
        .prepare(
          `INSERT INTO model_price_schedules(
             id,provider_config_fingerprint,model_id,operation_kind,protocol_mode,version,
             currency,usage_semantics_version,input_tokens_include_cached,input_per_million_usd,
             status,effective_at,created_at,revision
           ) VALUES ('invalid-price',?,'m','TEXT',NULL,1,'USD','v1',0,'01.2',
             'ACTIVE',?,?,0)`,
        )
        .run(HASH_A, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z'),
    ).toThrow();
    database.close();
  });

  it('atomically reserves unpriced units, settles NULL cost, and rejects ledger mutation', async () => {
    const { database } = await createInitializedDatabase('model accounting ledger');
    const repository = new SqliteModelAccountingRepository(database, () => 'fixture-id');
    repository.createUnitPolicy(
      {
        maxExternalCallsMonthly: 10,
        maxExternalCallsWeekly: 5,
        maxImageGenerationCalls: null,
        maxImages: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxToolCalls: null,
        maxWebSearchCalls: null,
        scopeKind: 'GLOBAL',
        scopeValue: null,
        version: 1,
      },
      '2026-07-28T00:00:00.000Z',
    );
    repository.reserveAndCreateRun({
      billingMonth: '2026-07',
      identity: identity('execution-ledger'),
      now: '2026-07-28T00:00:00.000Z',
      reservedAmountMicroUsd: null,
      unitDemandJson: '{"externalCalls":1}',
      weekKey: '2026-W31',
    });
    repository.settle({
      cache: null,
      comparisonEstimateMicroUsd: null,
      costAmountMicroUsd: null,
      costSource: 'NO_PRICE',
      costState: 'UNPRICED_USAGE',
      executionId: 'execution-ledger',
      now: '2026-07-28T00:00:01.000Z',
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      priceSchedule: null,
      status: 'SUCCEEDED',
      usage: {
        cacheWriteTokens: null,
        cachedInputTokens: null,
        imageGenerationCalls: 0,
        images: 0,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        toolCalls: 0,
        totalTokens: null,
        webSearchCalls: 0,
      },
    });
    const ledger = database.prepare(`SELECT amount_microusd,cost_state FROM cost_ledger`).get() as {
      readonly amount_microusd: number | null;
      readonly cost_state: string;
    };
    expect(ledger).toEqual({
      amount_microusd: null,
      cost_state: 'UNPRICED_USAGE',
    });
    expect(() => database.prepare(`UPDATE cost_ledger SET amount_microusd=0`).run()).toThrow();
    expect(() => database.prepare(`DELETE FROM cost_ledger`).run()).toThrow();
    database.close();
  });

  it.each([
    [79_999_000, false, true],
    [80_000_000, true, true],
    [99_999_000, true, true],
    [100_000_000, true, false],
  ] as const)(
    'enforces the $79.999/$80/$99.999/$100 reservation boundary: %i micro-USD',
    async (amount, warning, allowed) => {
      const { database } = await createInitializedDatabase(`budget boundary ${amount}`);
      const repository = new SqliteModelAccountingRepository(database, () => `id-${amount}`);
      const action = () =>
        repository.reserveAndCreateRun({
          billingMonth: '2026-07',
          identity: identity(`execution-${amount}`),
          now: '2026-07-28T00:00:00.000Z',
          reservedAmountMicroUsd: amount,
          unitDemandJson: '{"externalCalls":1}',
          weekKey: '2026-W31',
        });
      if (allowed) {
        expect(action).not.toThrow();
        expect(repository.budgetSummary('2026-07').warning).toBe(warning);
      } else {
        expect(action).toThrowError('BUDGET_HARD_LIMIT_REACHED');
      }
      database.close();
    },
  );

  it('atomically enforces weekly and monthly unpriced call units', async () => {
    const { database } = await createInitializedDatabase('unit policy boundary');
    let sequence = 0;
    const repository = new SqliteModelAccountingRepository(database, () => `unit-${++sequence}`);
    repository.createUnitPolicy(
      {
        maxExternalCallsMonthly: 1,
        maxExternalCallsWeekly: 1,
        maxImageGenerationCalls: null,
        maxImages: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxToolCalls: null,
        maxWebSearchCalls: null,
        scopeKind: 'GLOBAL',
        scopeValue: null,
        version: 1,
      },
      '2026-07-28T00:00:00.000Z',
    );
    repository.reserveAndCreateRun({
      billingMonth: '2026-07',
      identity: identity('unit-first'),
      now: '2026-07-28T00:00:00.000Z',
      reservedAmountMicroUsd: null,
      unitDemandJson: '{"externalCalls":1}',
      weekKey: '2026-W31',
    });
    expect(() =>
      repository.reserveAndCreateRun({
        billingMonth: '2026-07',
        identity: identity('unit-second'),
        now: '2026-07-28T00:00:01.000Z',
        reservedAmountMicroUsd: null,
        unitDemandJson: '{"externalCalls":1}',
        weekKey: '2026-W31',
      }),
    ).toThrowError('BUDGET_UNIT_LIMIT_REACHED');
    database.close();
  });

  it('allows a local cache hit at the hard limit without adding a ledger row', async () => {
    const { database } = await createInitializedDatabase('model accounting cache hit');
    const repository = new SqliteModelAccountingRepository(database, () => 'fixture-id');
    database
      .prepare(
        `INSERT INTO model_cache_entries(
           id,cache_key,status,output_type,managed_relative_path,content_hash,
           output_hash,size_bytes,format_version,created_at,updated_at,revision
         ) VALUES ('cache-fixture',?,'READY','TEXT',?,?,?,10,1,?,?,0)`,
      )
      .run(
        HASH_A,
        `cache/model-results/${HASH_A.slice(0, 2)}/${HASH_A}.json`,
        HASH_A,
        HASH_B,
        '2026-07-28T00:00:00.000Z',
        '2026-07-28T00:00:00.000Z',
      );
    database
      .prepare(
        `UPDATE app_settings SET monthly_warning_cents=0,monthly_hard_limit_cents=1,
           revision=revision+1,updated_at='2026-07-28T00:00:00.000Z'`,
      )
      .run();
    repository.createTerminalRun({
      cacheEntryId: 'cache-fixture',
      identity: identity('execution-cache-hit'),
      localCacheHit: true,
      now: '2026-07-28T00:00:00.000Z',
      outputHash: HASH_B,
      status: 'CACHE_HIT',
    });
    expect(repository.getRunByExecutionId('execution-cache-hit')).toMatchObject({
      externalRequestCount: 0,
      localCacheHit: true,
      status: 'CACHE_HIT',
    });
    expect(
      (
        database.prepare(`SELECT count(*) AS count FROM cost_ledger`).get() as {
          readonly count: number;
        }
      ).count,
    ).toBe(0);
    database.close();
  });
});
