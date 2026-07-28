import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  SqliteSearchRepository,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import {
  ManualUrlAdapter,
  SearchPlanner,
  SearchProviderRegistry,
  type SearchPlanV1,
  type SearchProviderDescriptorV1,
  type SearchRatePolicyV1,
} from '../packages/search/src/index.js';
import { searchRequest } from './search-fixtures.js';

const directories: string[] = [];
const databases: DatabaseSync[] = [];

async function databaseAtVersion(count = MIGRATIONS.length): Promise<{
  readonly database: DatabaseSync;
  readonly databasePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rednote-search-db-'));
  directories.push(directory);
  const databasePath = join(directory, 'project.sqlite');
  await initializeDatabase({
    backupDirectory: join(directory, 'backups'),
    databasePath,
    migrations: MIGRATIONS.slice(0, count),
  });
  const database = connectDatabase(databasePath);
  databases.push(database);
  return { database, databasePath };
}

afterEach(async () => {
  while (databases.length > 0) {
    try {
      databases.pop()?.close();
    } catch {
      // Already closed by the completed test.
    }
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) await rm(directory, { force: true, recursive: true });
  }
});

describe('search migration v8 and SQLite persistence', () => {
  it('opens migration v8 under a long Windows-safe Chinese, space and emoji path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rednote-search-path-'));
    directories.push(root);
    const nested = join(root, '搜索 数据 😀', '长路径段'.repeat(10));
    await mkdir(nested, { recursive: true });
    const databasePath = join(nested, '项目 搜索.sqlite');
    await initializeDatabase({
      backupDirectory: join(nested, '备份'),
      databasePath,
    });
    const database = connectDatabase(databasePath);
    databases.push(database);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_schema
           WHERE type = 'table' AND name LIKE 'search_%'`,
        )
        .get(),
    ).toEqual({ count: 4 });
    database.close();
  });

  it('appends only v8 and preserves the complete v7 schema', async () => {
    const { database, databasePath } = await databaseAtVersion(7);
    database
      .prepare(
        `INSERT INTO account_profiles (id, working_name, bio)
         VALUES ('account-before-v8', 'before', 'kept')`,
      )
      .run();
    database.close();
    const result = await initializeDatabase({
      backupDirectory: join(dirname(databasePath), 'backups'),
      databasePath,
      migrations: MIGRATIONS.slice(0, 8),
    });
    expect(result.appliedVersions).toEqual([8]);
    const reopened = connectDatabase(databasePath);
    expect(
      reopened.prepare("SELECT bio FROM account_profiles WHERE id = 'account-before-v8'").get(),
    ).toEqual({ bio: 'kept' });
    expect(MIGRATIONS[7]).toMatchObject({
      name: 'search_provider_runs_and_rate_limits',
      version: 8,
    });
    expect(migrationChecksum(MIGRATIONS[7] as (typeof MIGRATIONS)[number])).toBe(
      '74a0da30be52302edf3c1d2f8574250514c2914fc9f64265f46b689c7075d78c',
    );
    reopened.close();
  });

  it('creates four STRICT tables with required constraints and indexes', async () => {
    const { database } = await databaseAtVersion();
    const tables = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'table' AND name LIKE 'search_%' ORDER BY name`,
      )
      .all() as { readonly name: string; readonly sql: string }[];
    expect(tables.map((row) => row.name)).toEqual([
      'search_provider_configs',
      'search_rate_limit_states',
      'search_result_candidates',
      'search_runs',
    ]);
    expect(tables.every((row) => row.sql.endsWith('STRICT'))).toBe(true);
    const candidateSql = tables.find((row) => row.name === 'search_result_candidates')?.sql ?? '';
    expect(candidateSql).toContain("evidence_eligibility = 'LEAD_ONLY'");
    expect(candidateSql).toContain("fetch_state = 'NOT_FETCHED'");
    expect(candidateSql).toContain("truth_status = 'UNVERIFIED'");
    expect(candidateSql).toContain("fact_status = 'NOT_A_FACT'");
    const indexes = database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'index' AND name LIKE 'idx_search_%' ORDER BY name`,
      )
      .all() as { readonly name: string }[];
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'idx_search_candidates_url_hash',
        'idx_search_candidates_run_rank',
        'idx_search_runs_provider_status_time',
        'idx_search_runs_status_time',
      ]),
    );
    const runPlan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM search_runs
         WHERE provider_instance_id = ? AND status = ?
         ORDER BY started_at DESC`,
      )
      .all('manual-url-v1', 'SUCCEEDED') as { readonly detail: string }[];
    expect(runPlan.map((row) => row.detail).join('\n')).toContain(
      'idx_search_runs_provider_status_time',
    );
    const candidatePlan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM search_result_candidates WHERE url_hash = ?`,
      )
      .all('a'.repeat(64)) as { readonly detail: string }[];
    expect(candidatePlan.map((row) => row.detail).join('\n')).toContain(
      'idx_search_candidates_url_hash',
    );
    database.close();
  });

  it('persists a local SearchRun and bounded candidate without query text', async () => {
    const { database } = await databaseAtVersion();
    const repository = new SqliteSearchRepository(database, () => 'rate-id');
    const adapter = new ManualUrlAdapter();
    repository.upsertProviderConfig(
      {
        curatedEntries: [],
        descriptor: adapter.describe(),
        enabled: true,
        ratePolicy: null,
        settingsRevision: 1,
        timeoutMs: 5_000,
      },
      '2026-07-28T00:00:00.000Z',
    );
    const request = searchRequest({
      executionId: 'manual-db-execution',
      intent: 'USER_PROVIDED_URL',
      localInput: {
        kind: 'MANUAL_URL',
        note: 'private user note',
        title: 'Manual source',
        url: 'https://example.com/manual',
      },
      maxResults: 1,
      providerInstanceId: 'manual-url-v1',
      query: '',
    });
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    const plan = await new SearchPlanner(registry, {
      idFactory: () => 'manual-db-plan',
      now: () => new Date('2026-07-28T00:00:00.000Z'),
    }).createPlan(
      request,
      { budgetIdentity: 'none', capabilityIdentity: 'none', settingsRevision: 1 },
      null,
      5_000,
    );
    expect(
      (
        await repository.beginRun({
          plan,
          request,
          requestSemanticHash: plan.requestSemanticHash,
          searchRunId: 'manual-db-run',
          startedAt: '2026-07-28T00:00:00.000Z',
        })
      ).state,
    ).toBe('CREATED');
    const batch = await adapter.execute(request, {
      now: () => new Date('2026-07-28T00:00:01.000Z'),
      plan,
      searchRunId: 'manual-db-run',
    });
    await repository.settleSuccess(batch, null);
    const stored = await repository.findCompletedByExecutionId(request.executionId);
    expect(stored).toEqual(batch);
    const runColumns = database.prepare('PRAGMA table_info(search_runs)').all() as {
      readonly name: string;
    }[];
    expect(runColumns.map((row) => row.name)).not.toContain('query');
    expect(JSON.stringify(database.prepare('SELECT * FROM search_runs').get())).not.toContain(
      'private user note',
    );
    database.close();
  });

  it('atomically enforces persisted concurrency, interval and window limits', async () => {
    const { database } = await databaseAtVersion();
    const repository = new SqliteSearchRepository(database, () => 'reservation-id');
    const descriptor: SearchProviderDescriptorV1 = {
      budgetState: 'READY',
      capabilityState: 'SUPPORTED',
      codecState: 'READY',
      contractVersion: 'search-provider-v1',
      credentialState: 'READY',
      displayName: 'Remote fixture',
      features: {
        allowedDomains: true,
        blockedDomains: true,
        countryHint: false,
        cursor: false,
        hardDomainFilter: true,
        liveAccess: false,
        localeHints: false,
        manualUrl: false,
        publishedDateRange: false,
        query: true,
        structuredSources: true,
      },
      kind: 'MODEL_WEB_SEARCH',
      maxResponseBytes: 2_048,
      maxResults: 2,
      mode: 'ACTIVE_REMOTE',
      providerInstanceId: 'remote-fixture',
      rateState: 'READY',
      readiness: 'READY',
      supportedIntents: ['BOOK_DISCOVERY'],
    };
    const policy: SearchRatePolicyV1 = {
      contractVersion: 'search-rate-policy-v1',
      maxConcurrent: 1,
      maxRequestsPerWindow: 2,
      maxResponseBytes: 2_048,
      maxResults: 2,
      minIntervalMs: 1_000,
      revision: 1,
      timeoutMs: 5_000,
      windowMs: 60_000,
    };
    repository.upsertProviderConfig(
      {
        curatedEntries: [],
        descriptor,
        enabled: true,
        ratePolicy: policy,
        settingsRevision: 1,
        timeoutMs: 5_000,
      },
      '2026-07-28T00:00:00.000Z',
    );
    const remotePlan = {
      planHash: 'a'.repeat(64),
      provider: descriptor,
      ratePolicy: policy,
    } as SearchPlanV1;
    const beginRemoteRun = async (searchRunId: string, executionId: string, startedAt: string) =>
      repository.beginRun({
        plan: remotePlan,
        request: searchRequest({
          executionId,
          maxResults: 2,
          providerInstanceId: 'remote-fixture',
          ratePolicyRef: 'remote-rate-policy-v1',
        }),
        requestSemanticHash: 'b'.repeat(64),
        searchRunId,
        startedAt,
      });
    await beginRemoteRun('run-one', 'execution-one', '2026-07-28T00:00:00.000Z');
    await beginRemoteRun('run-two', 'execution-two', '2026-07-28T00:00:00.000Z');
    await expect(
      repository.reserveRate({
        now: '2026-07-28T00:00:00.000Z',
        policy,
        providerInstanceId: 'remote-fixture',
        searchRunId: 'run-one',
      }),
    ).resolves.toMatchObject({ providerInstanceId: 'remote-fixture' });
    const restartedRepository = new SqliteSearchRepository(database, () => 'restart-id');
    await expect(
      restartedRepository.reserveRate({
        now: '2026-07-28T00:00:00.000Z',
        policy,
        providerInstanceId: 'remote-fixture',
        searchRunId: 'run-two',
      }),
    ).rejects.toMatchObject({ code: 'SEARCH_RATE_LIMITED' });
    await repository.settleFailure('run-one', {
      certainty: 'NOT_SENT',
      externalRequestCount: 0,
      finishedAt: '2026-07-28T00:00:00.000Z',
      releaseRateReservation: true,
      retryAfterSeconds: null,
      stableError: 'SEARCH_TIMEOUT_BEFORE_SEND',
      status: 'FAILED_BEFORE_SEND',
    });
    await expect(
      restartedRepository.reserveRate({
        now: '2026-07-28T00:00:00.500Z',
        policy,
        providerInstanceId: 'remote-fixture',
        searchRunId: 'run-two',
      }),
    ).rejects.toMatchObject({ code: 'SEARCH_RATE_LIMITED' });
    await expect(
      restartedRepository.reserveRate({
        now: '2026-07-28T00:00:01.000Z',
        policy,
        providerInstanceId: 'remote-fixture',
        searchRunId: 'run-two',
      }),
    ).resolves.toMatchObject({ providerInstanceId: 'remote-fixture' });
    await repository.settleFailure('run-two', {
      certainty: 'NOT_SENT',
      externalRequestCount: 0,
      finishedAt: '2026-07-28T00:00:01.000Z',
      releaseRateReservation: true,
      retryAfterSeconds: 10,
      stableError: 'SEARCH_RATE_LIMITED',
      status: 'FAILED_BEFORE_SEND',
    });
    const rateState = database
      .prepare(
        `SELECT in_flight, next_allowed_at, request_count
         FROM search_rate_limit_states WHERE provider_instance_id = 'remote-fixture'`,
      )
      .get();
    expect(rateState).toEqual({
      in_flight: 0,
      next_allowed_at: '2026-07-28T00:00:11.000Z',
      request_count: 2,
    });
    await beginRemoteRun('run-three', 'execution-three', '2026-07-28T00:01:01.000Z');
    await expect(
      restartedRepository.reserveRate({
        now: '2026-07-28T00:01:01.000Z',
        policy,
        providerInstanceId: 'remote-fixture',
        searchRunId: 'run-three',
      }),
    ).resolves.toMatchObject({ providerInstanceId: 'remote-fixture' });
    await restartedRepository.markDispatchStarted('run-three', '2026-07-28T00:01:01.001Z');
    expect(restartedRepository.recoverInterrupted('2026-07-28T00:01:02.000Z')).toEqual({
      ambiguous: 1,
      recoverablePreSend: 0,
    });
    expect(
      await beginRemoteRun('unused-run-three', 'execution-three', '2026-07-28T00:01:03.000Z'),
    ).toMatchObject({ searchRunId: 'run-three', state: 'EXISTING_AMBIGUOUS' });

    await beginRemoteRun('run-four', 'execution-four', '2026-07-28T00:01:04.000Z');
    expect(restartedRepository.recoverInterrupted('2026-07-28T00:01:05.000Z')).toEqual({
      ambiguous: 0,
      recoverablePreSend: 1,
    });
    expect(
      await beginRemoteRun('unused-run-four', 'execution-four', '2026-07-28T00:01:06.000Z'),
    ).toMatchObject({ searchRunId: 'run-four', state: 'RECOVERED_PRE_SEND' });
    expect(
      database
        .prepare(
          `SELECT in_flight FROM search_rate_limit_states
           WHERE provider_instance_id = 'remote-fixture'`,
        )
        .get(),
    ).toEqual({ in_flight: 0 });
    database.close();
  });
});
