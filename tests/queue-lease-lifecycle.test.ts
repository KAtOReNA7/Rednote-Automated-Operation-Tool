import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { JobQueueRepository, connectDatabase } from '../packages/db/src/index.js';
import {
  JobHandlerExecutionError,
  JobHandlerRegistry,
  JobPayloadValidationError,
  JobQueueService,
} from '../packages/workflows/src/index.js';
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

describe('queue claiming and lease protection', () => {
  it('claims the highest-priority due job in deterministic order', async () => {
    const test = await context();
    enqueueTestJob(test, { idempotencyKey: 'low', priority: 1 });
    const high = enqueueTestJob(test, { idempotencyKey: 'high', priority: 10 });

    expect(test.service.claimNextJob('worker-1')?.id).toBe(high.id);
  });

  it('does not claim a job before next_run_at', async () => {
    const test = await context();
    enqueueTestJob(test, {
      availableAt: new Date(test.clock.now().getTime() + 1),
    });

    expect(test.service.claimNextJob('worker-1')).toBeNull();
  });

  it.each(['PAUSED', 'CANCELLED', 'SUCCEEDED'] as const)(
    'does not claim jobs in %s',
    async (targetStatus) => {
      const test = await context();
      const job = enqueueTestJob(test);
      if (targetStatus === 'PAUSED') {
        test.service.requestPause(job.id);
      } else if (targetStatus === 'CANCELLED') {
        test.service.requestCancel(job.id);
      } else {
        const claimed = test.service.claimNextJob('worker-1');
        test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '');
      }
      expect(test.service.claimNextJob('worker-2')).toBeNull();
    },
  );

  it('does not let two workers claim the same job', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const first = test.service.claimNextJob('worker-1');
    const second = test.service.claimNextJob('worker-2');

    expect(first?.id).toBe(job.id);
    expect(second).toBeNull();
  });

  it('serializes claims across independent DatabaseSync connections', async () => {
    const test = await context();
    enqueueTestJob(test);
    const secondDatabase = connectDatabase(test.databasePath);
    openDatabases.push(secondDatabase);
    const registry = new JobHandlerRegistry();
    registry.register('TEST_SUCCESS', async (payload) => payload);
    const secondService = new JobQueueService(new JobQueueRepository(secondDatabase), registry, {
      clock: test.clock,
      idFactory: () => 'second-lease-token',
      leaseDurationMilliseconds: 10_000,
    });

    const claims = await Promise.all([
      Promise.resolve().then(() => test.service.claimNextJob('worker-1')),
      Promise.resolve().then(() => secondService.claimNextJob('worker-2')),
    ]);

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it('increments attempt_count on every successful claim', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');

    expect(claimed).toMatchObject({
      attemptCount: 1,
      id: job.id,
      startedAt: test.clock.now().toISOString(),
    });
  });

  it('generates a fresh lease token for a recovered retry', async () => {
    const test = await context();
    enqueueTestJob(test);
    const first = test.service.claimNextJob('worker-1');
    test.clock.advance(10_001);
    test.service.recoverExpiredLeases();
    const second = test.service.claimNextJob('worker-2');

    expect(first?.leaseToken).not.toBeNull();
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
  });

  it('rejects heartbeat from a non-owner', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');

    expect(() => test.service.heartbeat(job.id, 'worker-2', claimed?.leaseToken ?? '')).toThrow(
      expect.objectContaining({ code: 'LEASE_CONFLICT' }),
    );
  });

  it('rejects an old lease token after a new worker reclaims the job', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const first = test.service.claimNextJob('worker-1');
    test.clock.advance(10_001);
    test.service.recoverExpiredLeases();
    test.service.claimNextJob('worker-1');

    expect(() => test.service.heartbeat(job.id, 'worker-1', first?.leaseToken ?? '')).toThrow(
      expect.objectContaining({ code: 'LEASE_CONFLICT' }),
    );
  });

  it('heartbeat extends the durable lease deadline', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    const oldExpiry = claimed?.leaseExpiresAt ?? '';
    test.clock.advance(5_000);

    expect(test.service.heartbeat(job.id, 'worker-1', claimed?.leaseToken ?? '')).toBe('CONTINUE');
    expect(test.service.getJob(job.id)?.leaseExpiresAt).toBe(
      new Date(test.clock.now().getTime() + 10_000).toISOString(),
    );
    expect(test.service.getJob(job.id)?.leaseExpiresAt).not.toBe(oldExpiry);
  });

  it('rejects completion by the old worker after its lease expires', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    test.clock.advance(10_001);

    expect(() => test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '')).toThrow(
      expect.objectContaining({ code: 'LEASE_EXPIRED' }),
    );
  });

  it('rejects heartbeat after a job reaches a terminal state', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '');

    expect(() => test.service.heartbeat(job.id, 'worker-1', claimed?.leaseToken ?? '')).toThrow(
      expect.objectContaining({ code: 'INVALID_JOB_STATE' }),
    );
  });
});

describe('queue completion and failure lifecycle', () => {
  it('completes a running job and persists JSON result', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    const completed = test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '', {
      ok: true,
    });

    expect(completed).toMatchObject({
      result: { ok: true },
      status: 'SUCCEEDED',
    });
    expect(completed.finishedAt).toBe(test.clock.now().toISOString());
  });

  it('reports repeated completion as an explicit conflict', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '');

    expect(() => test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '')).toThrow(
      expect.objectContaining({ code: 'JOB_ALREADY_COMPLETED' }),
    );
  });

  it('moves a failed attempt into RETRY_WAIT with durable next_run_at', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    const failed = test.service.failJob(
      job.id,
      'worker-1',
      claimed?.leaseToken ?? '',
      new Error('temporary'),
    );

    expect(failed).toMatchObject({
      lastError: 'temporary',
      nextRunAt: new Date(test.clock.now().getTime() + 1_000).toISOString(),
      status: 'RETRY_WAIT',
    });
    expect(test.service.getJob(job.id)?.nextRunAt).toBe(failed.nextRunAt);
  });

  it('moves the exhausted attempt to FAILED and sets finished_at', async () => {
    const test = await context();
    const job = enqueueTestJob(test, { maxAttempts: 1 });
    const claimed = test.service.claimNextJob('worker-1');
    const failed = test.service.failJob(
      job.id,
      'worker-1',
      claimed?.leaseToken ?? '',
      new Error('final'),
    );

    expect(failed.status).toBe('FAILED');
    expect(failed.finishedAt).toBe(test.clock.now().toISOString());
  });

  it.each(['success', 'retry', 'failed'] as const)(
    'clears all lease fields after %s',
    async (outcome) => {
      const test = await context();
      const job = enqueueTestJob(test, { maxAttempts: outcome === 'failed' ? 1 : 3 });
      const claimed = test.service.claimNextJob('worker-1');
      const settled =
        outcome === 'success'
          ? test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '')
          : test.service.failJob(
              job.id,
              'worker-1',
              claimed?.leaseToken ?? '',
              new Error('failed'),
            );

      expect(settled).toMatchObject({
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        lockOwner: null,
      });
    },
  );

  it('applies JSON and size validation to result_json', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');

    expect(() =>
      test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '', {
        text: 'x'.repeat(70_000),
      }),
    ).toThrow(JobPayloadValidationError);
    expect(test.service.getJob(job.id)?.status).toBe('RUNNING');
  });

  it('sanitizes credentials and truncates persisted error summaries', async () => {
    const test = await context();
    const job = enqueueTestJob(test, { maxAttempts: 1 });
    const claimed = test.service.claimNextJob('worker-1');
    const failed = test.service.failJob(
      job.id,
      'worker-1',
      claimed?.leaseToken ?? '',
      new JobHandlerExecutionError(
        'REMOTE_FAILURE',
        `authorization=secret-value Bearer top-secret ${'x'.repeat(2_000)}`,
      ),
    );

    expect(failed.lastErrorCode).toBe('REMOTE_FAILURE');
    expect(failed.lastError).toHaveLength(1_000);
    expect(failed.lastError).not.toContain('secret-value');
    expect(failed.lastError).not.toContain('top-secret');
  });

  it('replaces unsafe handler error codes with a stable local fallback', async () => {
    const test = await context();
    const job = enqueueTestJob(test, { maxAttempts: 1 });
    const claimed = test.service.claimNextJob('worker-1');
    const failed = test.service.failJob(
      job.id,
      'worker-1',
      claimed?.leaseToken ?? '',
      new JobHandlerExecutionError('api-key=secret', 'safe message'),
    );

    expect(failed.lastErrorCode).toBe('HANDLER_FAILED');
  });
});
