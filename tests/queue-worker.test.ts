import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  JobHandlerRegistry,
  JobWorker,
  QueueSleepAbortedError,
} from '../packages/workflows/src/index.js';
import type { QueueScheduler } from '../packages/workflows/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import {
  createQueueTestContext,
  enqueueTestJob,
  registerHandler,
  type QueueTestContext,
} from './support/queue-test-utils.js';

const openDatabases: DatabaseSync[] = [];

async function context(): Promise<QueueTestContext> {
  const created = await createQueueTestContext();
  openDatabases.push(created.database);
  return created;
}

async function waitUntil(predicate: () => boolean, timeoutMilliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for worker test condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

class ImmediateShutdownScheduler implements QueueScheduler {
  public sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (milliseconds === 1) {
      return Promise.resolve();
    }
    return new Promise((_resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new QueueSleepAbortedError());
        return;
      }
      signal?.addEventListener('abort', () => reject(new QueueSleepAbortedError()), {
        once: true,
      });
    });
  }
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('local queue worker', () => {
  it('runs a success handler and persists its result', async () => {
    const test = await context();
    const job = enqueueTestJob(test, { payload: { value: 'success' } });
    const worker = new JobWorker('worker-1', test.service, test.registry);

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(test.service.getJob(job.id)).toMatchObject({
      result: { value: 'success' },
      status: 'SUCCEEDED',
    });
  });

  it('automatically retries a fail-once handler and then succeeds', async () => {
    const test = await context();
    let calls = 0;
    registerHandler(test, 'TEST_FAIL_ONCE', async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('first call fails');
      }
      return { calls };
    });
    const job = enqueueTestJob(test, {
      idempotencyKey: 'fail-once',
      jobType: 'TEST_FAIL_ONCE',
    });
    const worker = new JobWorker('worker-1', test.service, test.registry);

    await worker.runOnce();
    expect(test.service.getJob(job.id)?.status).toBe('RETRY_WAIT');
    test.clock.advance(1_000);
    await worker.runOnce();
    expect(test.service.getJob(job.id)).toMatchObject({
      attemptCount: 2,
      result: { calls: 2 },
      status: 'SUCCEEDED',
    });
  });

  it('moves an always-failing handler to FAILED after the final attempt', async () => {
    const test = await context();
    registerHandler(test, 'TEST_ALWAYS_FAIL', async () => {
      throw new Error('always fails');
    });
    const job = enqueueTestJob(test, {
      idempotencyKey: 'always-fail',
      jobType: 'TEST_ALWAYS_FAIL',
      maxAttempts: 2,
    });
    const worker = new JobWorker('worker-1', test.service, test.registry);

    await worker.runOnce();
    test.clock.advance(1_000);
    await worker.runOnce();
    expect(test.service.getJob(job.id)).toMatchObject({
      attemptCount: 2,
      lastError: 'always fails',
      status: 'FAILED',
    });
  });

  it('records an unregistered handler failure without crashing the worker', async () => {
    const test = await context();
    const job = enqueueTestJob(test, { maxAttempts: 1 });
    const emptyRegistry = new JobHandlerRegistry();
    const worker = new JobWorker('worker-1', test.service, emptyRegistry);

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(worker.lastError).toBeNull();
    expect(test.service.getJob(job.id)).toMatchObject({
      lastErrorCode: 'HANDLER_NOT_REGISTERED',
      status: 'FAILED',
    });
  });

  it('honors pause requested by a pause-aware handler', async () => {
    const test = await context();
    registerHandler(test, 'TEST_PAUSE_AWARE', async (_payload, handlerContext) => {
      test.service.requestPause(handlerContext.job.id);
      expect(await handlerContext.heartbeat()).toBe('PAUSE');
      return { shouldNotComplete: true };
    });
    const job = enqueueTestJob(test, {
      idempotencyKey: 'pause-aware',
      jobType: 'TEST_PAUSE_AWARE',
    });
    const worker = new JobWorker('worker-1', test.service, test.registry);

    await worker.runOnce();
    expect(test.service.getJob(job.id)?.status).toBe('PAUSED');
  });

  it('honors cancellation requested by a cancel-aware handler', async () => {
    const test = await context();
    registerHandler(test, 'TEST_CANCEL_AWARE', async (_payload, handlerContext) => {
      test.service.requestCancel(handlerContext.job.id);
      expect(await handlerContext.heartbeat()).toBe('CANCEL');
      return { shouldNotComplete: true };
    });
    const job = enqueueTestJob(test, {
      idempotencyKey: 'cancel-aware',
      jobType: 'TEST_CANCEL_AWARE',
    });
    const worker = new JobWorker('worker-1', test.service, test.registry);

    await worker.runOnce();
    expect(test.service.getJob(job.id)?.status).toBe('CANCELLED');
  });

  it('does not claim new work after shutdown begins', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    const worker = new JobWorker('worker-1', test.service, test.registry);

    await expect(worker.shutdown()).resolves.toBe(true);
    await expect(worker.runOnce()).resolves.toBe(false);
    expect(test.service.getJob(job.id)?.status).toBe('QUEUED');
  });

  it('processes a job after crash simulation and expired-lease recovery', async () => {
    const test = await context();
    const job = enqueueTestJob(test);
    test.service.claimNextJob('crashed-worker');
    test.clock.advance(10_001);
    test.service.recoverExpiredLeases();
    const worker = new JobWorker('replacement-worker', test.service, test.registry);

    await worker.runOnce();
    expect(test.service.getJob(job.id)?.status).toBe('SUCCEEDED');
  });

  it('enforces the configured concurrency ceiling', async () => {
    const test = await context();
    let activeHandlers = 0;
    let maximumActiveHandlers = 0;
    const releases: Array<() => void> = [];
    registerHandler(test, 'TEST_BLOCKING', async () => {
      activeHandlers += 1;
      maximumActiveHandlers = Math.max(maximumActiveHandlers, activeHandlers);
      await new Promise<void>((resolve) => releases.push(resolve));
      activeHandlers -= 1;
      return null;
    });
    for (let index = 0; index < 3; index += 1) {
      enqueueTestJob(test, {
        idempotencyKey: `blocking-${index}`,
        jobType: 'TEST_BLOCKING',
      });
    }
    const worker = new JobWorker('worker-1', test.service, test.registry, {
      concurrency: 2,
      heartbeatIntervalMilliseconds: 100,
      leaseDurationMilliseconds: 1_000,
      pollingIntervalMilliseconds: 10,
    });
    const startPromise = worker.start();

    await waitUntil(() => worker.activeCount === 2);
    expect(maximumActiveHandlers).toBe(2);
    expect(test.service.getQueueStats().byStatus.RUNNING).toBe(2);
    releases.splice(0).forEach((release) => release());
    await waitUntil(() => releases.length === 1);
    releases.splice(0).forEach((release) => release());
    await waitUntil(() => test.service.getQueueStats().byStatus.SUCCEEDED === 3);
    await expect(worker.shutdown()).resolves.toBe(true);
    await startPromise;
    expect(maximumActiveHandlers).toBe(2);
  });

  it('does not fake success when controlled shutdown times out', async () => {
    const test = await context();
    registerHandler(test, 'TEST_SHUTDOWN_TIMEOUT', async (_payload, handlerContext) => {
      await new Promise<void>((resolve) => {
        handlerContext.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
      return { shouldNotPersist: true };
    });
    const job = enqueueTestJob(test, {
      idempotencyKey: 'shutdown-timeout',
      jobType: 'TEST_SHUTDOWN_TIMEOUT',
    });
    const worker = new JobWorker('worker-1', test.service, test.registry, {
      heartbeatIntervalMilliseconds: 100,
      leaseDurationMilliseconds: 1_000,
      scheduler: new ImmediateShutdownScheduler(),
    });
    const running = worker.runOnce();
    await waitUntil(() => worker.activeCount === 1);

    await expect(worker.shutdown(1)).resolves.toBe(false);
    await running;
    expect(test.service.getJob(job.id)?.status).toBe('RUNNING');
    test.clock.advance(1_001);
    expect(test.service.recoverExpiredLeases()[0]?.status).toBe('RETRY_WAIT');
  });
});
