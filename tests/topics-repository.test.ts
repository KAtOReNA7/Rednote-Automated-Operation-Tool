import { afterEach, describe, expect, it } from 'vitest';

import { SqliteAuthenticityRepository, SqliteTopicRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { insertTopicReadyWork } from './support/topic-fixtures.js';

const NOW = '2026-07-30T05:00:00.000Z';

function protectedCounts(
  database: Awaited<ReturnType<typeof createInitializedDatabase>>['database'],
) {
  return Object.fromEntries(
    [
      'experiments',
      'content_briefs',
      'drafts',
      'quality_checks',
      'approvals',
      'post_packages',
      'publications',
    ].map((table) => [
      table,
      (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count,
    ]),
  );
}

function requiredValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}

afterEach(() => {
  cleanTemporaryDatabases();
});

describe('SQLite Topic Pool repository', () => {
  it('generates and persists a deterministic local candidate without external work', async () => {
    const { database } = await createInitializedDatabase('topic generation');
    try {
      const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
      insertTopicReadyWork(database, authenticity, {
        workId: 'topic-work-1',
      });
      const repository = new SqliteTopicRepository(database, () => crypto.randomUUID());
      const preview = repository.previewGeneration('primary', NOW);
      expect(preview.counts.NON_SPOILER_SINGLE_BOOK_VERDICT).toBe(1);
      expect(preview.estimatedModelRequests).toBe(0);

      const execution = repository.confirmGeneration(
        preview,
        'topic-execution-1',
        '2026-07-30T05:01:00.000Z',
      );
      expect(execution).toMatchObject({
        createdCount: 1,
        duplicateCount: 0,
        externalRequestCount: 0,
        replayed: false,
        status: 'SUCCEEDED',
      });
      const pool = repository.listPool('primary', {
        contentType: null,
        eligibility: null,
        limit: 25,
        offset: 0,
        query: '',
        state: null,
      });
      expect(pool.total).toBe(1);
      expect(pool.items[0]).toMatchObject({
        candidateState: 'PROPOSED',
        contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
        eligibility: 'ELIGIBLE',
        stale: false,
      });
      expect(database.prepare('SELECT count(*) AS count FROM content_briefs').get()).toEqual({
        count: 0,
      });
      expect(protectedCounts(database)).toEqual({
        approvals: 0,
        content_briefs: 0,
        drafts: 0,
        experiments: 0,
        post_packages: 0,
        publications: 0,
        quality_checks: 0,
      });
    } finally {
      database.close();
    }
  });

  it('prepares a bounded queue payload, survives execution replay, and has one cross-process winner', async () => {
    const { database } = await createInitializedDatabase('topic queue replay');
    try {
      const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
      insertTopicReadyWork(database, authenticity, { workId: 'queue-work' });
      const first = new SqliteTopicRepository(database, () => crypto.randomUUID());
      const second = new SqliteTopicRepository(database, () => crypto.randomUUID());
      const preview = first.previewGeneration('primary', NOW);
      const prepared = first.prepareGeneration(
        preview,
        'topic-queue-execution',
        '2026-07-30T05:01:00.000Z',
      );
      expect(prepared).toMatchObject({
        enqueue: true,
        run: {
          externalRequestCount: 0,
          replayed: false,
          status: 'CONFIRMED',
        },
      });
      expect(prepared.payload).toEqual({
        candidateCount: 1,
        contractVersion: 'topic-generation-job-v1',
        executionId: 'topic-queue-execution',
        expectedPolicyHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        inputWorkCount: 1,
        planHash: preview.planHash,
        planId: preview.planId,
        profileId: 'primary',
      });

      const competing = second.prepareGeneration(
        preview,
        'topic-queue-execution',
        '2026-07-30T05:01:00.000Z',
      );
      expect(competing.run.runId).toBe(prepared.run.runId);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM topic_generation_runs
             WHERE execution_id = 'topic-queue-execution'`,
          )
          .get(),
      ).toEqual({ count: 1 });

      const payload = requiredValue(prepared.payload, 'generation payload');
      const executed = first.executeGenerationJob(payload, '2026-07-30T05:02:00.000Z');
      expect(executed).toMatchObject({
        createdCount: 1,
        externalRequestCount: 0,
        replayed: false,
        status: 'SUCCEEDED',
      });
      expect(second.executeGenerationJob(payload, '2026-07-30T05:03:00.000Z')).toMatchObject({
        createdCount: 1,
        replayed: true,
        runId: executed.runId,
        status: 'SUCCEEDED',
      });
      expect(first.listGenerationRuns('primary')).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('applies previewed state changes, undo, bounded batch behavior, and stale revision failure', async () => {
    const { database } = await createInitializedDatabase('topic state transitions');
    try {
      const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
      insertTopicReadyWork(database, authenticity, { workId: 'state-work-a' });
      insertTopicReadyWork(database, authenticity, { workId: 'state-work-b' });
      const repository = new SqliteTopicRepository(database, () => crypto.randomUUID());
      repository.confirmGeneration(
        repository.previewGeneration('primary', NOW),
        'state-generation',
        '2026-07-30T05:01:00.000Z',
      );
      const pool = repository.listPool('primary', {
        contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
        eligibility: 'ELIGIBLE',
        limit: 25,
        offset: 0,
        query: '',
        state: null,
      });
      expect(pool.items).toHaveLength(2);
      const first = requiredValue(pool.items[0], 'first state candidate');
      const second = requiredValue(pool.items[1], 'second state candidate');

      const lockPreview = repository.previewStateChange({
        action: 'LOCK',
        expectedRevision: first.revision,
        topicId: first.topicId,
      });
      expect(lockPreview).toMatchObject({ after: 'LOCKED', before: 'PROPOSED' });
      const locked = repository.applyStateChange(lockPreview, '2026-07-30T05:02:00.000Z');
      expect(locked).toMatchObject({ candidateState: 'LOCKED', revision: 2 });
      expect(() =>
        repository.applyStateChange(lockPreview, '2026-07-30T05:02:01.000Z'),
      ).toThrowError('TOPIC_STALE_REVISION');

      const undo = repository.previewUndo(first.topicId, 2);
      expect(undo).toMatchObject({ after: 'PROPOSED', before: 'LOCKED' });
      expect(repository.applyStateChange(undo, '2026-07-30T05:03:00.000Z')).toMatchObject({
        candidateState: 'PROPOSED',
        revision: 3,
      });

      const batch = repository.previewBatchState({
        action: 'HOLD',
        items: [
          { expectedRevision: 3, topicId: first.topicId },
          { expectedRevision: second.revision, topicId: second.topicId },
        ],
      });
      const applied = repository.applyBatchState(batch, '2026-07-30T05:04:00.000Z');
      expect(applied).toMatchObject({ failed: 0, succeeded: 2 });
      expect(applied.items.every((item) => item.ok)).toBe(true);
      expect(
        database
          .prepare('SELECT count(*) AS count FROM topic_state_transitions WHERE actor = ?')
          .get('USER'),
      ).toEqual({ count: 4 });
    } finally {
      database.close();
    }
  });

  it('publishes immutable incomplete plans, no-ops identical input, and marks—not rewrites—stale plans', async () => {
    const { database } = await createInitializedDatabase('topic quota history');
    try {
      const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
      insertTopicReadyWork(database, authenticity, { workId: 'quota-work' });
      const repository = new SqliteTopicRepository(database, () => crypto.randomUUID());
      repository.confirmGeneration(
        repository.previewGeneration('primary', NOW),
        'quota-generation',
        '2026-07-30T05:01:00.000Z',
      );
      const preview = repository.previewQuotaPlan('primary', 10);
      expect(preview.result).toMatchObject({ status: 'INCOMPLETE', totalSelected: 1 });
      expect(preview.result.categories.NON_SPOILER_SINGLE_BOOK_VERDICT.shortfall).toBe(9);
      expect(preview.result.categories.FULL_TRICK_LOGIC_ANALYSIS.shortfall).toBe(8);
      const first = repository.confirmQuotaPlan(preview, '2026-07-30T05:02:00.000Z');
      expect(first).toMatchObject({ status: 'INCOMPLETE', versionNumber: 1 });

      const noOp = repository.previewQuotaPlan('primary', 10);
      expect(noOp.noOp).toBe(true);
      expect(repository.confirmQuotaPlan(noOp, '2026-07-30T05:03:00.000Z').planVersionId).toBe(
        first.planVersionId,
      );
      expect(repository.listQuotaPlanHistory('primary')).toHaveLength(1);

      const item = requiredValue(
        repository.listPool('primary', {
          contentType: null,
          eligibility: null,
          limit: 25,
          offset: 0,
          query: '',
          state: null,
        }).items[0],
        'quota candidate',
      );
      repository.applyStateChange(
        repository.previewStateChange({
          action: 'HOLD',
          expectedRevision: item.revision,
          topicId: item.topicId,
        }),
        '2026-07-30T05:04:00.000Z',
      );
      expect(repository.getCurrentQuotaPlan('primary')?.status).toBe('STALE');
      expect(repository.getCurrentQuotaPlan('primary')?.members).toHaveLength(1);

      const rebuilt = repository.confirmQuotaPlan(
        repository.previewQuotaPlan('primary', 10),
        '2026-07-30T05:05:00.000Z',
      );
      expect(rebuilt).toMatchObject({ status: 'INCOMPLETE', totalSelected: 0, versionNumber: 2 });
      const history = repository.listQuotaPlanHistory('primary');
      expect(history).toHaveLength(2);
      expect(history[1]?.status).toBe('SUPERSEDED');
    } finally {
      database.close();
    }
  });

  it('cancels a confirmed generation without replacing the current quota plan', async () => {
    const { database } = await createInitializedDatabase('topic cancel');
    try {
      const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
      insertTopicReadyWork(database, authenticity, { workId: 'cancel-work' });
      const repository = new SqliteTopicRepository(database, () => crypto.randomUUID());
      repository.confirmGeneration(
        repository.previewGeneration('primary', NOW),
        'initial-generation',
        '2026-07-30T05:01:00.000Z',
      );
      const current = repository.confirmQuotaPlan(
        repository.previewQuotaPlan('primary', 10),
        '2026-07-30T05:02:00.000Z',
      );
      const prepared = repository.prepareGeneration(
        repository.previewGeneration('primary', '2026-07-30T05:03:00.000Z'),
        'cancelled-generation',
        '2026-07-30T05:03:00.000Z',
      );
      const cancelled = repository.cancelGeneration(
        prepared.run.runId,
        1,
        '2026-07-30T05:04:00.000Z',
      );
      expect(cancelled).toMatchObject({ status: 'CANCELLED' });
      expect(repository.getCurrentQuotaPlan('primary')?.planVersionId).toBe(current.planVersionId);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM topic_candidate_versions
             WHERE schema_version = 'topic-candidate-v1'`,
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('replays quota execution identity and never replaces the current plan after stale input', async () => {
    const { database } = await createInitializedDatabase('topic quota replay');
    try {
      const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
      insertTopicReadyWork(database, authenticity, { workId: 'quota-replay-work' });
      const first = new SqliteTopicRepository(database, () => crypto.randomUUID());
      const second = new SqliteTopicRepository(database, () => crypto.randomUUID());
      first.confirmGeneration(
        first.previewGeneration('primary', NOW),
        'quota-replay-generation',
        '2026-07-30T05:01:00.000Z',
      );

      const preview = first.previewQuotaPlan('primary', 10);
      const prepared = first.prepareQuotaPlanJob(
        preview,
        'quota-replay-execution',
        '2026-07-30T05:02:00.000Z',
      );
      const competing = second.prepareQuotaPlanJob(
        preview,
        'quota-replay-execution',
        '2026-07-30T05:02:00.000Z',
      );
      expect(competing.runId).toBe(prepared.runId);
      expect(prepared.payload).toMatchObject({
        contractVersion: 'topic-quota-job-v1',
        executionId: 'quota-replay-execution',
        quotaProfileId: 'FIRST_30_V1',
      });
      const payload = requiredValue(prepared.payload, 'quota payload');
      const published = first.executeQuotaPlanJob(payload, '2026-07-30T05:03:00.000Z');
      expect(second.executeQuotaPlanJob(payload, '2026-07-30T05:04:00.000Z')).toEqual(published);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM topic_quota_plan_runs
             WHERE execution_id = 'quota-replay-execution'`,
          )
          .get(),
      ).toEqual({ count: 1 });

      const currentBeforeFailure = requiredValue(
        first.getCurrentQuotaPlan('primary'),
        'current quota plan',
      );
      const stalePreview = first.previewQuotaPlan('primary', 10);
      const stalePrepared = first.prepareQuotaPlanJob(
        stalePreview,
        'quota-stale-execution',
        '2026-07-30T05:05:00.000Z',
      );
      const item = requiredValue(
        first.listPool('primary', {
          contentType: null,
          eligibility: null,
          limit: 25,
          offset: 0,
          query: '',
          state: null,
        }).items[0],
        'stale quota candidate',
      );
      first.applyStateChange(
        first.previewStateChange({
          action: 'HOLD',
          expectedRevision: item.revision,
          topicId: item.topicId,
        }),
        '2026-07-30T05:06:00.000Z',
      );
      const stalePayload = requiredValue(stalePrepared.payload, 'stale quota payload');
      expect(() =>
        first.executeQuotaPlanJob(stalePayload, '2026-07-30T05:07:00.000Z'),
      ).toThrowError('TOPIC_STALE_REVISION');
      first.failQuotaPlanExecution(
        'quota-stale-execution',
        'TOPIC_STALE_REVISION',
        '2026-07-30T05:07:01.000Z',
      );
      expect(
        database
          .prepare(
            `SELECT status, error_code
             FROM topic_quota_plan_runs
             WHERE execution_id = 'quota-stale-execution'`,
          )
          .get(),
      ).toEqual({ error_code: 'TOPIC_STALE_REVISION', status: 'FAILED' });
      expect(first.getCurrentQuotaPlan('primary')?.planVersionId).toBe(
        currentBeforeFailure.planVersionId,
      );
      expect(first.getCurrentQuotaPlan('primary')?.status).toBe('STALE');

      const cancelled = first.prepareQuotaPlanJob(
        first.previewQuotaPlan('primary', 10),
        'quota-cancelled-execution',
        '2026-07-30T05:08:00.000Z',
      );
      expect(cancelled.status).toBe('CONFIRMED');
      first.cancelQuotaPlanExecution('quota-cancelled-execution', '2026-07-30T05:08:01.000Z');
      expect(
        database
          .prepare(
            `SELECT status, plan_version_id
             FROM topic_quota_plan_runs
             WHERE execution_id = 'quota-cancelled-execution'`,
          )
          .get(),
      ).toEqual({ plan_version_id: null, status: 'CANCELLED' });
      expect(first.getCurrentQuotaPlan('primary')?.planVersionId).toBe(
        currentBeforeFailure.planVersionId,
      );
    } finally {
      database.close();
    }
  });
});
