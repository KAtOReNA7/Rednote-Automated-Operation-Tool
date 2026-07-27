import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { JOB_STATUSES, JobStatus } from '../packages/core/src/index.js';
import {
  JobHandlerRegistry,
  JobQueueService,
  JobQueueServiceError,
  JobWorker,
} from '../packages/workflows/src/index.js';
import { JobQueueRepository } from '../packages/db/src/index.js';
import { cleanTemporaryDatabases, insertMinimalDraft } from './support/database-test-utils.js';
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
  vi.restoreAllMocks();
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('Issue 009 frozen constraints', () => {
  it('keeps ai_disclosure defaulted and constrained to false', async () => {
    const test = await context();
    const draftId = insertMinimalDraft(test.database);
    test.database
      .prepare(
        `INSERT INTO post_packages(id, draft_id, status)
         VALUES ('queue-constraint-package', ?, 'EXPORT_READY')`,
      )
      .run(draftId);

    expect(
      test.database
        .prepare(
          `SELECT ai_disclosure
           FROM post_packages
           WHERE id = 'queue-constraint-package'`,
        )
        .get(),
    ).toEqual({ ai_disclosure: 0 });
    expect(() =>
      test.database
        .prepare(
          `UPDATE post_packages
           SET ai_disclosure = 1
           WHERE id = 'queue-constraint-package'`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/iu);
  });

  it('contains no copyright risk queue state or persisted gate field', async () => {
    const test = await context();
    const columns = test.database
      .prepare('PRAGMA table_info(jobs)')
      .all()
      .map((row) => (row as { readonly name: string }).name);

    expect(JOB_STATUSES).toEqual(Object.values(JobStatus));
    expect(JOB_STATUSES.some((status) => /COPYRIGHT/iu.test(status))).toBe(false);
    expect(columns.some((column) => /copyright|rights?_risk|rights?_gate/iu.test(column))).toBe(
      false,
    );
  });

  it('does not let AI participation metadata change priority, eligibility, or state', async () => {
    const test = await context();
    const withoutAi = enqueueTestJob(test, {
      idempotencyKey: 'without-ai',
      payload: { aiParticipation: { generatedFraction: 0, modelRunCount: 0 } },
      priority: 7,
    });
    const withAi = enqueueTestJob(test, {
      idempotencyKey: 'with-ai',
      payload: { aiParticipation: { generatedFraction: 1, modelRunCount: 999 } },
      priority: 7,
    });

    expect(withAi).toMatchObject({
      nextRunAt: withoutAi.nextRunAt,
      priority: withoutAi.priority,
      status: withoutAi.status,
    });
    expect(test.service.claimNextJob('worker-1')?.id).toBe(withoutAi.id);
  });

  it('does not let source metadata change queue scheduling', async () => {
    const test = await context();
    const userSource = enqueueTestJob(test, {
      idempotencyKey: 'user-source',
      payload: { source: { origin: 'user-photo', sourceId: 'source-1' } },
      priority: 5,
    });
    const officialSource = enqueueTestJob(test, {
      idempotencyKey: 'official-source',
      payload: { source: { origin: 'official-cover', sourceId: null } },
      priority: 5,
    });

    expect(officialSource).toMatchObject({
      nextRunAt: userSource.nextRunAt,
      priority: userSource.priority,
      status: userSource.status,
    });
    expect(test.service.claimNextJob('worker-1')?.id).toBe(userSource.id);
  });

  it('has no production platform-action handler and rejects such enqueue at runtime', async () => {
    const test = await context();
    const emptyProductionRegistry = new JobHandlerRegistry();
    const productionService = new JobQueueService(
      new JobQueueRepository(test.database),
      emptyProductionRegistry,
      { clock: test.clock },
    );

    expect(() =>
      productionService.enqueueJob({
        idempotencyKey: 'forbidden-platform-action',
        jobType: 'XIAOHONGSHU_PUBLISH',
        maxAttempts: 1,
        payload: {},
        priority: 0,
      }),
    ).toThrow(JobQueueServiceError);
    expect(emptyProductionRegistry.get('XIAOHONGSHU_PUBLISH')).toBeNull();
  });

  it('executes the local test handler without real API or cloud access', async () => {
    const test = await context();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network access is forbidden in queue tests.'));
    const job = enqueueTestJob(test, {
      payload: { fixture: 'local-only' },
    });
    const worker = new JobWorker('local-only-worker', test.service, test.registry);

    await worker.runOnce();
    expect(test.service.getJob(job.id)?.status).toBe('SUCCEEDED');
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const forbiddenType of [
      'REAL_API_CALL',
      'CLOUD_QUEUE',
      'OPENBOOK_IMPORT',
      'PIRATED_EBOOK_PROCESS',
    ]) {
      expect(test.registry.get(forbiddenType)).toBeNull();
    }
  });
});
