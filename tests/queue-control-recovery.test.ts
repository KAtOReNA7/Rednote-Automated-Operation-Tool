import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { JobQueueRepository, connectDatabase } from '../packages/db/src/index.js';
import {
  JobHandlerRegistry,
  JobQueueService,
  JobRecoveryService,
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

function secondService(test: QueueTestContext): JobQueueService {
  const database = connectDatabase(test.databasePath);
  openDatabases.push(database);
  const registry = new JobHandlerRegistry();
  registry.register('TEST_SUCCESS', async (payload) => payload);
  let identifier = 0;
  return new JobQueueService(new JobQueueRepository(database), registry, {
    clock: test.clock,
    idFactory: () => `second-${++identifier}`,
    leaseDurationMilliseconds: 10_000,
  });
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('pause, resume, and cancel control', () => {
  it('pauses a QUEUED job immediately', async () => {
    const test = await context();
    const job = enqueueTestJob(test);

    expect(test.service.requestPause(job.id).status).toBe('PAUSED');
    expect(test.service.requestPause(job.id).status).toBe('PAUSED');
  });

  it('pauses a RETRY_WAIT job immediately', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    test.service.failJob(job.id, 'worker-1', claimed?.leaseToken ?? '', new Error('retry'));

    expect(test.service.requestPause(job.id).status).toBe('PAUSED');
  });

  it('records PAUSE_REQUESTED for a RUNNING job and returns a heartbeat signal', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');

    expect(test.service.requestPause(job.id).status).toBe('PAUSE_REQUESTED');
    expect(test.service.heartbeat(job.id, 'worker-1', claimed?.leaseToken ?? '')).toBe('PAUSE');
  });

  it('lets the lease owner acknowledge a pause request', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    test.service.requestPause(job.id);
    const paused = test.service.acknowledgePause(job.id, 'worker-1', claimed?.leaseToken ?? '');

    expect(paused).toMatchObject({
      leaseToken: null,
      lockOwner: null,
      status: 'PAUSED',
    });
  });

  it('resumes PAUSED to QUEUED without resetting attempt_count', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    test.service.requestPause(job.id);
    test.service.acknowledgePause(job.id, 'worker-1', claimed?.leaseToken ?? '');
    const resumed = test.service.resumeJob(job.id);

    expect(resumed).toMatchObject({
      attemptCount: 1,
      pauseRequestedAt: null,
      status: 'QUEUED',
    });
  });

  it.each(['QUEUED', 'RETRY_WAIT', 'PAUSED'] as const)(
    'cancels a %s job immediately',
    async (sourceStatus) => {
      const test = await context();
      const job = enqueueTestJob(test);
      if (sourceStatus === 'RETRY_WAIT') {
        const claimed = test.service.claimNextJob('worker-1');
        test.service.failJob(job.id, 'worker-1', claimed?.leaseToken ?? '', new Error('retry'));
      } else if (sourceStatus === 'PAUSED') {
        test.service.requestPause(job.id);
      }

      const cancelled = test.service.requestCancel(job.id);
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.finishedAt).toBe(test.clock.now().toISOString());
      expect(cancelled.cancelRequestedAt).toBe(test.clock.now().toISOString());
    },
  );

  it('records CANCEL_REQUESTED for a RUNNING job and returns a heartbeat signal', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');

    expect(test.service.requestCancel(job.id).status).toBe('CANCEL_REQUESTED');
    expect(test.service.heartbeat(job.id, 'worker-1', claimed?.leaseToken ?? '')).toBe('CANCEL');
  });

  it('lets the lease owner acknowledge cancellation and prevents later claims', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const claimed = test.service.claimNextJob('worker-1');
    test.service.requestCancel(job.id);
    const cancelled = test.service.acknowledgeCancel(job.id, 'worker-1', claimed?.leaseToken ?? '');

    expect(cancelled.status).toBe('CANCELLED');
    expect(test.service.requestCancel(job.id)).toEqual(cancelled);
    expect(test.service.claimNextJob('worker-2')).toBeNull();
  });

  it('rejects state-changing operations from terminal jobs', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.service.requestCancel(job.id);

    expect(() => test.service.requestPause(job.id)).toThrow(/Invalid job status transition/iu);
    expect(() => test.service.resumeJob(job.id)).toThrow(/Invalid job status transition/iu);
  });
});

describe('manual retry and expired lease recovery', () => {
  it('explicitly retries FAILED while preserving attempts and extending the budget', async () => {
    const test = await context();
    const job = enqueueTestJob(test, { maxAttempts: 1 });
    const claimed = test.service.claimNextJob('worker-1');
    test.service.failJob(job.id, 'worker-1', claimed?.leaseToken ?? '', new Error('final'));
    const retried = test.service.retryFailedJob(job.id, { additionalAttempts: 2 });

    expect(retried).toMatchObject({
      attemptCount: 1,
      finishedAt: null,
      idempotencyKey: job.idempotencyKey,
      maxAttempts: 3,
      status: 'QUEUED',
    });
  });

  it.each(['SUCCEEDED', 'CANCELLED'] as const)(
    'does not manually retry %s',
    async (targetStatus) => {
      const test = await context();
      const job = enqueueTestJob(test);
      if (targetStatus === 'CANCELLED') {
        test.service.requestCancel(job.id);
      } else {
        const claimed = test.service.claimNextJob('worker-1');
        test.service.completeJob(job.id, 'worker-1', claimed?.leaseToken ?? '');
      }

      expect(() => test.service.retryFailedJob(job.id, { additionalAttempts: 1 })).toThrow(
        /Invalid job status transition/iu,
      );
    },
  );

  it('recovers an expired RUNNING lease into RETRY_WAIT', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.service.claimNextJob('worker-1');
    test.clock.advance(10_001);

    expect(new JobRecoveryService(test.service).recoverExpiredLeases()).toEqual([
      expect.objectContaining({
        id: job.id,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        lockOwner: null,
        status: 'RETRY_WAIT',
      }),
    ]);
  });

  it('recovers an exhausted expired RUNNING lease into FAILED', async () => {
    const test = await context();
    const job = enqueueTestJob(test, { maxAttempts: 1 });
    test.service.claimNextJob('worker-1');
    test.clock.advance(10_001);

    const [recovered] = test.service.recoverExpiredLeases();
    expect(recovered).toMatchObject({
      finishedAt: test.clock.now().toISOString(),
      id: job.id,
      lastErrorCode: 'LEASE_EXPIRED',
      status: 'FAILED',
    });
  });

  it('recovers expired PAUSE_REQUESTED into PAUSED', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.service.claimNextJob('worker-1');
    test.service.requestPause(job.id);
    test.clock.advance(10_001);

    expect(test.service.recoverExpiredLeases()[0]?.status).toBe('PAUSED');
  });

  it('recovers expired CANCEL_REQUESTED into CANCELLED', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.service.claimNextJob('worker-1');
    test.service.requestCancel(job.id);
    test.clock.advance(10_001);

    expect(test.service.recoverExpiredLeases()[0]?.status).toBe('CANCELLED');
  });

  it('does not recover an unexpired lease', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.service.claimNextJob('worker-1');

    expect(test.service.recoverExpiredLeases()).toEqual([]);
    expect(test.service.getJob(job.id)?.status).toBe('RUNNING');
  });

  it('lets competing recovery services transition an expired lease only once', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.service.claimNextJob('worker-1');
    test.clock.advance(10_001);
    const otherService = secondService(test);

    const recovered = await Promise.all([
      Promise.resolve().then(() => test.service.recoverExpiredLeases()),
      Promise.resolve().then(() => otherService.recoverExpiredLeases()),
    ]);

    expect(recovered.flat().filter((entry) => entry.id === job.id)).toHaveLength(1);
    expect(test.service.getJob(job.id)?.status).toBe('RETRY_WAIT');
  });

  it('recovers consistently after every database connection is closed and reopened', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.service.claimNextJob('worker-1');
    test.clock.advance(10_001);
    test.database.close();
    openDatabases.splice(openDatabases.indexOf(test.database), 1);
    const reopened = secondService(test);

    expect(reopened.recoverExpiredLeases()[0]).toMatchObject({
      id: job.id,
      status: 'RETRY_WAIT',
    });
  });
});
