import { afterEach, describe, expect, it } from 'vitest';

import { DesktopTopicRuntime } from '../apps/desktop/src/topic-runtime.js';
import { SqliteAuthenticityRepository, SqliteTopicRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { insertTopicReadyWork } from './support/topic-fixtures.js';

afterEach(cleanTemporaryDatabases);

async function waitForGeneration(
  runtime: DesktopTopicRuntime,
  runId: string,
): Promise<'SUCCEEDED' | 'NO_OP'> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const run = runtime
      .list({
        contentType: null,
        eligibility: null,
        limit: 25,
        offset: 0,
        profileId: 'primary',
        query: '',
        state: null,
      })
      .recentGenerationRuns.find((candidate) => candidate.runId === runId);
    if (run?.status === 'SUCCEEDED' || run?.status === 'NO_OP') return run.status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Topic generation ${runId} did not finish.`);
}

async function waitForQuotaPlan(runtime: DesktopTopicRuntime): Promise<'COMPLETE' | 'INCOMPLETE'> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const plan = runtime.list({
      contentType: null,
      eligibility: null,
      limit: 25,
      offset: 0,
      profileId: 'primary',
      query: '',
      state: null,
    }).currentPlan;
    if (plan?.status === 'COMPLETE' || plan?.status === 'INCOMPLETE') return plan.status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Topic quota plan did not finish.');
}

describe('M3 Issue 022 desktop Topic runtime', () => {
  it('binds one-use generation/quota confirmations and runs both through the local queue', async () => {
    const { database } = await createInitializedDatabase('topic runtime queue');
    const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
    insertTopicReadyWork(database, authenticity, { workId: 'topic-runtime-work' });
    const runtime = new DesktopTopicRuntime(database, () => new Date('2026-07-30T09:00:00.000Z'));
    try {
      const wrongSender = runtime.preview({ kind: 'GENERATE', profileId: 'primary' }, 10, 20);
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_TOPIC_ACTION',
            executionId: 'runtime-wrong-sender',
            kind: wrongSender.kind,
            previewHash: wrongSender.previewHash,
            token: wrongSender.token,
          },
          11,
          20,
        ),
      ).toThrow(/TOPIC_CONFIRMATION_INVALID/iu);

      const wrongKind = runtime.preview({ kind: 'GENERATE', profileId: 'primary' }, 10, 20);
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_TOPIC_ACTION',
            executionId: null,
            kind: 'QUOTA_PLAN',
            previewHash: wrongKind.previewHash,
            token: wrongKind.token,
          },
          10,
          20,
        ),
      ).toThrow(/TOPIC_CONFIRMATION_INVALID/iu);

      const preview = runtime.preview({ kind: 'GENERATE', profileId: 'primary' }, 10, 20);
      expect(preview.preview).toMatchObject({
        estimatedModelRequests: 0,
        kind: 'GENERATE',
        modelExecutionState: 'UNCONFIGURED_DISABLED',
      });
      const result = runtime.confirm(
        {
          confirmation: 'APPLY_TOPIC_ACTION',
          executionId: 'runtime-local-execution',
          kind: preview.kind,
          previewHash: preview.previewHash,
          token: preview.token,
        },
        10,
        20,
      );
      expect(result).toMatchObject({
        generation: {
          executionId: 'runtime-local-execution',
          externalRequestCount: 0,
          status: 'CONFIRMED',
        },
        kind: 'GENERATE',
      });
      if (result.kind !== 'GENERATE') throw new Error('expected generation result');
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_TOPIC_ACTION',
            executionId: 'runtime-local-execution',
            kind: preview.kind,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          10,
          20,
        ),
      ).toThrow(/TOPIC_CONFIRMATION_INVALID/iu);

      const storedJob = database
        .prepare(
          `SELECT job_type, payload_json
           FROM jobs
           WHERE idempotency_key = 'topic-generation:runtime-local-execution'`,
        )
        .get() as { readonly job_type: string; readonly payload_json: string };
      expect(storedJob.job_type).toBe('TOPIC_GENERATE_V1');
      expect(JSON.parse(storedJob.payload_json)).toEqual({
        candidateCount: 1,
        contractVersion: 'topic-generation-job-v1',
        executionId: 'runtime-local-execution',
        expectedPolicyHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        inputWorkCount: 1,
        planHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        planId: expect.stringMatching(/^topic-generation-plan:/u),
        profileId: 'primary',
      });
      expect(storedJob.payload_json).not.toMatch(
        /api.?key|secret|absolute|dossierBody|evidenceBody|rawResponse/iu,
      );

      runtime.start();
      await expect(waitForGeneration(runtime, result.generation.runId)).resolves.toBe('SUCCEEDED');
      expect(
        runtime.list({
          contentType: null,
          eligibility: null,
          limit: 25,
          offset: 0,
          profileId: 'primary',
          query: '',
          state: null,
        }),
      ).toMatchObject({ total: 1 });

      const quotaPreview = runtime.preview(
        { kind: 'QUOTA_PLAN', maxWorkExposure: 3, profileId: 'primary' },
        10,
        20,
      );
      const quotaResult = runtime.confirm(
        {
          confirmation: 'APPLY_TOPIC_ACTION',
          executionId: 'runtime-quota-execution',
          kind: quotaPreview.kind,
          previewHash: quotaPreview.previewHash,
          token: quotaPreview.token,
        },
        10,
        20,
      );
      expect(quotaResult).toMatchObject({
        kind: 'QUOTA_PLAN',
        quota: {
          executionId: 'runtime-quota-execution',
          expectedPlanStatus: 'INCOMPLETE',
          externalRequestCount: 0,
          status: 'CONFIRMED',
          totalSelected: 1,
        },
      });
      const storedQuotaJob = database
        .prepare(
          `SELECT job_type, payload_json
           FROM jobs
           WHERE idempotency_key = 'topic-quota:runtime-quota-execution'`,
        )
        .get() as { readonly job_type: string; readonly payload_json: string };
      expect(storedQuotaJob.job_type).toBe('TOPIC_QUOTA_PLAN_V1');
      expect(JSON.parse(storedQuotaJob.payload_json)).toEqual({
        contractVersion: 'topic-quota-job-v1',
        executionId: 'runtime-quota-execution',
        maxWorkExposure: 3,
        poolSnapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        profileId: 'primary',
        quotaProfileId: 'FIRST_30_V1',
        totalCandidateCount: 1,
      });
      expect(storedQuotaJob.payload_json).not.toMatch(
        /api.?key|secret|absolute|dossierBody|evidenceBody|rawResponse/iu,
      );
      await expect(waitForQuotaPlan(runtime)).resolves.toBe('INCOMPLETE');
    } finally {
      await runtime.close();
      database.close();
    }
  }, 15_000);

  it('supports preview/confirm state changes and clears pending confirmations by window', async () => {
    const { database } = await createInitializedDatabase('topic runtime confirmation');
    const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
    insertTopicReadyWork(database, authenticity, { workId: 'topic-runtime-state' });
    const repository = new SqliteTopicRepository(database, () => crypto.randomUUID());
    repository.confirmGeneration(
      repository.previewGeneration('primary', '2026-07-30T09:01:00.000Z'),
      'topic-runtime-state-generation',
      '2026-07-30T09:01:01.000Z',
    );
    const topic = repository.listPool('primary', {
      contentType: null,
      eligibility: null,
      limit: 25,
      offset: 0,
      query: '',
      state: null,
    }).items[0];
    if (topic === undefined) throw new Error('Missing runtime Topic candidate.');
    const runtime = new DesktopTopicRuntime(database, () => new Date('2026-07-30T09:02:00.000Z'));
    try {
      const cleared = runtime.preview(
        {
          draft: { action: 'LOCK', expectedRevision: topic.revision, topicId: topic.topicId },
          kind: 'STATE_CHANGE',
        },
        30,
        40,
      );
      runtime.clearWindow(40);
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_TOPIC_ACTION',
            executionId: null,
            kind: cleared.kind,
            previewHash: cleared.previewHash,
            token: cleared.token,
          },
          30,
          40,
        ),
      ).toThrow(/TOPIC_CONFIRMATION_INVALID/iu);

      const preview = runtime.preview(
        {
          draft: { action: 'LOCK', expectedRevision: topic.revision, topicId: topic.topicId },
          kind: 'STATE_CHANGE',
        },
        30,
        40,
      );
      expect(
        runtime.confirm(
          {
            confirmation: 'APPLY_TOPIC_ACTION',
            executionId: null,
            kind: preview.kind,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          30,
          40,
        ),
      ).toMatchObject({
        detail: { candidateState: 'LOCKED', revision: 2 },
        kind: 'STATE_CHANGE',
      });
    } finally {
      await runtime.close();
      database.close();
    }
  });
});
