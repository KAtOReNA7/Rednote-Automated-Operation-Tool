import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  SqliteFetchRepository,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import { createDefaultFetchProfileV1 } from '../packages/fetch/src/index.js';
import { fetchRequestSemanticHash } from '../packages/fetch/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';
import { FETCH_NOW, fetchPlan, fetchRequest, insertFetchCandidate } from './fetch-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('fetch migration v9 and SQLite repository', () => {
  it('appends one frozen STRICT migration with all fetch tables and indexes', async () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(MIGRATIONS[8]).toMatchObject({
      name: 'controlled_public_page_fetch',
      version: 9,
    });
    const migrationV9 = MIGRATIONS[8];
    if (migrationV9 === undefined) throw new Error('Migration v9 is missing.');
    expect(migrationChecksum(migrationV9)).toBe(
      '7bea82d3317a4db13b929f288b0cb0f0f399d2c8fd5da78522827df33209a4de',
    );
    const { database } = await createInitializedDatabase('中文 空格 😀\\深层目录');
    const tables = database
      .prepare(
        `SELECT name, strict FROM pragma_table_list
         WHERE name IN (
           'fetch_profiles', 'fetch_origin_rate_states', 'fetch_robots_cache',
           'fetch_runs', 'fetch_redirect_hops', 'fetched_documents'
         ) ORDER BY name`,
      )
      .all() as { readonly name: string; readonly strict: number }[];
    expect(tables).toHaveLength(6);
    expect(tables.every(({ strict }) => strict === 1)).toBe(true);
    const indexes = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name LIKE 'idx_fetch_%' ORDER BY name`,
      )
      .all();
    expect(indexes.length).toBeGreaterThanOrEqual(8);
    database.close();
  });

  it('upgrades v8 to v9 with backup while retaining the frozen candidate states', async () => {
    const databasePath = createTemporaryDatabasePath('upgrade 中文 空格');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 8) });
    let database = connectDatabase(databasePath);
    const candidate = insertFetchCandidate(database);
    database.close();
    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({ appliedVersions: [9, 10, 11], schemaVersion: 11 });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    expect(
      database
        .prepare(
          `SELECT evidence_eligibility, fetch_state, truth_status, fact_status
           FROM search_result_candidates WHERE id = ?`,
        )
        .get(candidate.candidateId),
    ).toEqual({
      evidence_eligibility: 'LEAD_ONLY',
      fact_status: 'NOT_A_FACT',
      fetch_state: 'NOT_FETCHED',
      truth_status: 'UNVERIFIED',
    });
    database.close();
  });

  it('enforces profile optimistic revisions and persistent rate state', async () => {
    const { database } = await createInitializedDatabase();
    const repository = new SqliteFetchRepository(database);
    const profile = createDefaultFetchProfileV1();
    repository.upsertProfile(profile);
    expect(repository.getProfileSync(profile.id)).toEqual(profile);
    expect(() => repository.upsertProfile({ ...profile, revision: 2 }, 99)).toThrow(
      'FETCH_EXECUTION_CONFLICT',
    );
    const updated = {
      ...profile,
      enabled: true,
      ratePolicy: { ...profile.ratePolicy, revision: 2 },
      revision: 2,
    } as const;
    repository.upsertProfile(updated, 1);
    expect(repository.getProfileSync(profile.id)).toEqual(updated);

    const candidate = insertFetchCandidate(database);
    const rateProfile = {
      ...updated,
      enabled: true,
      ratePolicy: {
        ...updated.ratePolicy,
        maxRequestsPerWindow: 1,
        minIntervalMs: 0,
        revision: 3,
      },
      revision: 3,
    } as const;
    repository.upsertProfile(rateProfile, 2);
    const request = fetchRequest(candidate, rateProfile);
    const plan = fetchPlan(candidate, rateProfile, request);
    await repository.beginRun({
      fetchRunId: 'fetch-rate-run-1',
      plan,
      request,
      requestSemanticHash: fetchRequestSemanticHash(request),
      startedAt: FETCH_NOW,
    });
    const reservation = await repository.reserveOriginRate({
      crawlDelayMs: 0,
      fetchRunId: 'fetch-rate-run-1',
      now: FETCH_NOW,
      origin: plan.candidate.origin,
      profile: rateProfile,
    });
    await repository.settleOriginRate(reservation, {
      finishedAt: FETCH_NOW,
      retryAfterSeconds: 60,
    });
    const persisted = database
      .prepare(
        `SELECT request_count, in_flight, next_allowed_at
         FROM fetch_origin_rate_states WHERE origin = ?`,
      )
      .get(plan.candidate.origin);
    expect(persisted).toEqual({
      in_flight: 0,
      next_allowed_at: '2026-07-28T00:01:00.000Z',
      request_count: 1,
    });
    database.close();
  });

  it('does not add Source, Claim, Book or Clip rows while initializing Fetch', async () => {
    const { database } = await createInitializedDatabase();
    const before = Object.fromEntries(
      ['sources', 'claims', 'books', 'clips'].map((table) => [
        table,
        (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
          .count,
      ]),
    );
    new SqliteFetchRepository(database).upsertProfile(createDefaultFetchProfileV1());
    const after = Object.fromEntries(
      ['sources', 'claims', 'books', 'clips'].map((table) => [
        table,
        (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
          .count,
      ]),
    );
    expect(after).toEqual(before);
    database.close();
  });
});
