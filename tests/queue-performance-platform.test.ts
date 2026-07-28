import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  JobQueueRepository,
  assertSqliteRuntimeCapabilities,
  connectDatabase,
} from '../packages/db/src/index.js';
import { JobHandlerRegistry, JobQueueService, JobWorker } from '../packages/workflows/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import {
  createQueueTestContext,
  enqueueTestJob,
  registerHandler,
  type QueueTestContext,
} from './support/queue-test-utils.js';

const openDatabases: DatabaseSync[] = [];

async function context(childDirectory?: string): Promise<QueueTestContext> {
  const created = await createQueueTestContext(childDirectory);
  openDatabases.push(created.database);
  return created;
}

function openSecondService(test: QueueTestContext): JobQueueService {
  const database = connectDatabase(test.databasePath);
  openDatabases.push(database);
  const registry = new JobHandlerRegistry();
  registry.register('TEST_SUCCESS', async (payload) => payload);
  let identifier = 0;
  return new JobQueueService(new JobQueueRepository(database), registry, {
    clock: test.clock,
    idFactory: () => `platform-second-${++identifier}`,
  });
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('queue performance and Windows-local platform behavior', () => {
  it('uses the claim index for the critical due-work query', async () => {
    const test = await context();
    enqueueTestJob(test);
    const plan = test.database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id
         FROM jobs
         WHERE status IN ('QUEUED', 'RETRY_WAIT')
           AND next_run_at <= ?
           AND attempt_count < max_attempts
         ORDER BY priority DESC, next_run_at ASC, created_at ASC, id ASC
         LIMIT 1`,
      )
      .all(test.clock.now().toISOString())
      .map((row) => (row as { readonly detail: string }).detail)
      .join('\n');

    expect(plan).toContain('idx_jobs_claim');
  });

  it('uses the expired-lease index for recovery scans', async () => {
    const test = await context();
    const plan = test.database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id
         FROM jobs
         WHERE status IN ('RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED')
           AND lease_expires_at <= ?
         ORDER BY lease_expires_at ASC, id ASC
         LIMIT 100`,
      )
      .all(test.clock.now().toISOString())
      .map((row) => (row as { readonly detail: string }).detail)
      .join('\n');

    expect(plan).toContain('idx_jobs_expired_lease');
  });

  it('persists and reopens under a Windows path containing Chinese text and spaces', async () => {
    const test = await context('本地 队列 数据');
    const job = enqueueTestJob(test, { payload: { 标题: '雾中的读者' } });
    const secondService = openSecondService(test);

    expect(test.databasePath).toContain('本地 队列 数据');
    expect(secondService.getJob(job.id)?.payload).toEqual({ 标题: '雾中的读者' });
  });

  it('keeps state coherent across multiple DatabaseSync connections', async () => {
    const test = await context();
    const secondService = openSecondService(test);
    const job = enqueueTestJob(test);

    const claimed = secondService.claimNextJob('second-worker');
    expect(claimed?.id).toBe(job.id);
    expect(test.service.getJob(job.id)).toMatchObject({
      lockOwner: 'second-worker',
      status: 'RUNNING',
    });
  });

  it('uses WAL mode consistently on every queue connection', async () => {
    const test = await context();
    openSecondService(test);
    const modes = openDatabases.map(
      (database) =>
        (
          database.prepare('PRAGMA journal_mode').get() as {
            readonly journal_mode: string;
          }
        ).journal_mode,
    );
    const checkpoints = openDatabases.map(
      (database) =>
        (
          database.prepare('PRAGMA wal_autocheckpoint').get() as {
            readonly wal_autocheckpoint: number;
          }
        ).wal_autocheckpoint,
    );

    expect(new Set(modes)).toEqual(new Set(['wal']));
    expect(new Set(checkpoints)).toEqual(new Set([4096]));
  });

  it('claims the correct highest-priority job among 1,000 due jobs', async () => {
    const test = await context();
    let expectedId = '';
    for (let index = 0; index < 1_000; index += 1) {
      const job = enqueueTestJob(test, {
        idempotencyKey: `bulk-${index.toString().padStart(4, '0')}`,
        payload: { index },
        priority: index === 777 ? 1_000 : index % 10,
      });
      if (index === 777) {
        expectedId = job.id;
      }
    }

    const claimed = test.service.claimNextJob('bulk-worker');
    expect(test.service.getQueueStats().total).toBe(1_000);
    expect(claimed).toMatchObject({
      id: expectedId,
      payload: { index: 777 },
      priority: 1_000,
    });
  });

  it('does not keep a database transaction open while a handler is running', async () => {
    const test = await context();
    let releaseHandler: (() => void) | undefined;
    registerHandler(test, 'TEST_LONG_RUNNING', async () => {
      await new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      return null;
    });
    enqueueTestJob(test, {
      idempotencyKey: 'long-running',
      jobType: 'TEST_LONG_RUNNING',
    });
    const secondService = openSecondService(test);
    const worker = new JobWorker('long-worker', test.service, test.registry, {
      heartbeatIntervalMilliseconds: 100,
      leaseDurationMilliseconds: 1_000,
    });
    const running = worker.runOnce();
    while (releaseHandler === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(() =>
      secondService.enqueueJob({
        idempotencyKey: 'parallel-write',
        jobType: 'TEST_SUCCESS',
        maxAttempts: 1,
        payload: {},
        priority: 0,
      }),
    ).not.toThrow();
    releaseHandler();
    await running;
  });

  it('verifies the required node:sqlite runtime capabilities', () => {
    expect(assertSqliteRuntimeCapabilities()).toMatchObject({
      backup: true,
      databaseSync: true,
      timeoutOption: true,
    });
  });
});
