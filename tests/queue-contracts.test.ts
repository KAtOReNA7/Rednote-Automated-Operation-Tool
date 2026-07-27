import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { JobStatus } from '../packages/core/src/index.js';
import { ExponentialBackoffPolicy } from '../packages/workflows/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import {
  createQueueTestContext,
  enqueueTestJob,
  type QueueTestContext,
} from './support/queue-test-utils.js';

const openDatabases: DatabaseSync[] = [];

async function context(): Promise<QueueTestContext> {
  const created = await createQueueTestContext();
  openDatabases.push(created.database);
  return created;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('deterministic retry backoff', () => {
  it('applies configurable exponential growth and a maximum delay', () => {
    const policy = new ExponentialBackoffPolicy({
      baseDelayMilliseconds: 100,
      jitterRatio: 0,
      maxDelayMilliseconds: 500,
      multiplier: 2,
    });

    expect([1, 2, 3, 4, 100_000].map((attempt) => policy.delayMilliseconds(attempt))).toEqual([
      100, 200, 400, 500, 500,
    ]);
  });

  it('uses an injected random source for bounded deterministic jitter', () => {
    const low = new ExponentialBackoffPolicy({
      baseDelayMilliseconds: 1_000,
      jitterRatio: 0.25,
      maxDelayMilliseconds: 2_000,
      random: () => 0,
    });
    const high = new ExponentialBackoffPolicy({
      baseDelayMilliseconds: 1_000,
      jitterRatio: 0.25,
      maxDelayMilliseconds: 2_000,
      random: () => 1,
    });

    expect(low.delayMilliseconds(1)).toBe(750);
    expect(high.delayMilliseconds(1)).toBe(1_250);
  });

  it('never returns a negative delay or overflows on a huge attempt', () => {
    const policy = new ExponentialBackoffPolicy({
      baseDelayMilliseconds: 1,
      jitterRatio: 1,
      maxDelayMilliseconds: 60_000,
      multiplier: Number.MAX_VALUE,
      random: () => 0,
    });

    expect(policy.delayMilliseconds(Number.MAX_SAFE_INTEGER)).toBe(0);
  });

  it('rejects invalid attempts and random-source output', () => {
    const policy = new ExponentialBackoffPolicy({ random: () => 2 });

    expect(() => policy.delayMilliseconds(0)).toThrow(/positive safe integer/iu);
    expect(() => policy.delayMilliseconds(1)).toThrow(/random source/iu);
  });
});

describe('bounded queue queries', () => {
  it('filters by status and job type with deterministic pagination', async () => {
    const test = await context();
    test.registry.register('TEST_OTHER', async () => null);
    const first = enqueueTestJob(test, {
      idempotencyKey: 'query-first',
      jobType: 'TEST_OTHER',
    });
    test.clock.advance(1);
    const second = enqueueTestJob(test, {
      idempotencyKey: 'query-second',
      jobType: 'TEST_OTHER',
    });
    enqueueTestJob(test, { idempotencyKey: 'query-third' });

    expect(
      test.service.listJobs({ jobType: 'TEST_OTHER', status: JobStatus.QUEUED }, { limit: 1 }),
    ).toEqual([second]);
    expect(
      test.service.listJobs(
        { jobType: 'TEST_OTHER', status: JobStatus.QUEUED },
        { limit: 1, offset: 1 },
      ),
    ).toEqual([first]);
  });

  it('filters inclusive created and next-run time ranges', async () => {
    const test = await context();
    const firstTime = test.clock.now();
    const first = enqueueTestJob(test, { idempotencyKey: 'range-first' });
    test.clock.advance(1_000);
    const secondTime = test.clock.now();
    const second = enqueueTestJob(test, {
      availableAt: new Date(secondTime.getTime() + 5_000),
      idempotencyKey: 'range-second',
    });

    expect(
      test.service.listJobs({ createdFrom: secondTime, createdTo: secondTime }, { limit: 10 }),
    ).toEqual([second]);
    expect(
      test.service.listJobs(
        {
          nextRunFrom: new Date(secondTime.getTime() + 5_000),
          nextRunTo: new Date(secondTime.getTime() + 5_000),
        },
        { limit: 10 },
      ),
    ).toEqual([second]);
    expect(first.createdAt).toBe(firstTime.toISOString());
  });

  it('returns explicit null and empty results for missing jobs and filters', async () => {
    const test = await context();

    expect(test.service.getJob('missing')).toBeNull();
    expect(test.service.listJobs({ status: JobStatus.FAILED }, { limit: 10 })).toEqual([]);
  });

  it('enforces pagination bounds and never offers an unbounded list', async () => {
    const test = await context();

    expect(() => test.service.listJobs({}, { limit: 0 })).toThrow(/pagination\.limit/iu);
    expect(() => test.service.listJobs({}, { limit: 101 })).toThrow(/pagination\.limit/iu);
    expect(() => test.service.listJobs({}, { limit: 1, offset: -1 })).toThrow(
      /pagination\.offset/iu,
    );
    expect(() => test.service.listJobs({ status: 'UNKNOWN' as JobStatus }, { limit: 1 })).toThrow(
      /Unknown queue status/iu,
    );
  });

  it('reports zero-filled counts for every queue status', async () => {
    const test = await context();
    enqueueTestJob(test);
    const stats = test.service.getQueueStats();

    expect(stats.total).toBe(1);
    expect(stats.byStatus).toEqual({
      CANCELLED: 0,
      CANCEL_REQUESTED: 0,
      FAILED: 0,
      PAUSED: 0,
      PAUSE_REQUESTED: 0,
      QUEUED: 1,
      RETRY_WAIT: 0,
      RUNNING: 0,
      SUCCEEDED: 0,
    });
  });
});

describe('queue audit atomicity and safety', () => {
  it('records important transitions without persisting payload contents in audit JSON', async () => {
    const test = await context();
    const job = enqueueTestJob(test, {
      payload: { privateFixture: 'must-not-enter-audit' },
    });
    const claimed = test.service.claimNextJob('worker-1');
    test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '');
    const rows = test.database
      .prepare(
        `SELECT event_type, before_json, after_json
         FROM audit_events
         WHERE entity_type = 'JOB' AND entity_id = ?
         ORDER BY created_at, rowid`,
      )
      .all(job.id) as unknown as readonly {
      readonly after_json: string;
      readonly before_json: string | null;
      readonly event_type: string;
    }[];

    expect(rows.map(({ event_type }) => event_type)).toEqual(['ENQUEUED', 'CLAIMED', 'COMPLETED']);
    expect(JSON.stringify(rows)).not.toContain('must-not-enter-audit');
  });

  it('rolls back a state transition if its audit write fails', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.database.exec(`
      CREATE TRIGGER fail_claim_audit
      BEFORE INSERT ON audit_events
      WHEN NEW.event_type = 'CLAIMED'
      BEGIN
        SELECT RAISE(ABORT, 'simulated audit failure');
      END;
    `);

    expect(() => test.service.claimNextJob('worker-1')).toThrow(/simulated audit failure/iu);
    expect(test.service.getJob(job.id)).toMatchObject({
      attemptCount: 0,
      status: 'QUEUED',
    });
  });

  it('records manual retry and lease recovery events while preserving history', async () => {
    const test = await context();
    const failedJob = enqueueTestJob(test, {
      idempotencyKey: 'audit-failed',
      maxAttempts: 1,
    });
    const firstClaim = test.service.claimNextJob('worker-1');
    test.service.failJob(
      failedJob.id,
      'worker-1',
      firstClaim?.leaseToken ?? '',
      new Error('failed'),
    );
    test.service.retryFailedJob(failedJob.id, { additionalAttempts: 1 });
    const recoveryJob = enqueueTestJob(test, {
      idempotencyKey: 'audit-recovery',
    });
    test.service.claimNextJob('worker-2');
    test.clock.advance(10_001);
    test.service.recoverExpiredLeases();
    const events = test.database
      .prepare(
        `SELECT event_type
         FROM audit_events
         WHERE entity_id IN (?, ?)
         ORDER BY rowid`,
      )
      .all(failedJob.id, recoveryJob.id)
      .map((row) => (row as { readonly event_type: string }).event_type);

    expect(events).toContain('FAILED');
    expect(events).toContain('MANUAL_RETRY');
    expect(events).toContain('LEASE_RECOVERED');
  });

  it('keeps last_heartbeat_at durable without creating unbounded heartbeat audit rows', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    test.clock.advance(1_000);
    test.service.heartbeat(job.id, 'worker-1', claimed?.leaseToken ?? '');
    const heartbeatEvents = test.database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_events
         WHERE entity_id = ? AND event_type = 'HEARTBEAT'`,
      )
      .get(job.id);

    expect(test.service.getJob(job.id)?.lastHeartbeatAt).toBe(test.clock.now().toISOString());
    expect(heartbeatEvents).toEqual({ count: 0 });
  });
});
