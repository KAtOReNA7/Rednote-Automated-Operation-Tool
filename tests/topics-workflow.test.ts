import { describe, expect, it, vi } from 'vitest';

import {
  TOPIC_GENERATE_JOB_TYPE,
  TOPIC_QUOTA_PLAN_JOB_TYPE,
  TopicError,
} from '@mystery-operations/topics';
import {
  JobHandlerRegistry,
  TopicPlanningService,
  createTopicGenerationJobHandler,
  registerTopicPlanningJobs,
} from '../packages/workflows/src/index.js';

const generationPayload = {
  candidateCount: 5,
  contractVersion: 'topic-generation-job-v1' as const,
  executionId: 'topic-workflow-generation',
  expectedPolicyHash: 'a'.repeat(64),
  inputWorkCount: 2,
  planHash: 'b'.repeat(64),
  planId: 'topic-plan-workflow',
  profileId: 'primary',
};

const quotaPayload = {
  contractVersion: 'topic-quota-job-v1' as const,
  executionId: 'topic-workflow-quota',
  maxWorkExposure: 3,
  poolSnapshotHash: 'c'.repeat(64),
  profileId: 'primary',
  quotaProfileId: 'FIRST_30_V1' as const,
  totalCandidateCount: 30,
};

describe('M3 Issue 022 Topic planning workflows', () => {
  it('executes generation and quota work locally with bounded zero-egress results', async () => {
    const executeGenerationJob = vi.fn(() => ({
      createdCount: 5,
      duplicateCount: 0,
      externalRequestCount: 0 as const,
      noOp: false,
      runId: 'topic-run-workflow',
      status: 'SUCCEEDED' as const,
    }));
    const executeQuotaPlanJob = vi.fn(() => ({
      planVersionId: 'topic-quota-plan-workflow',
      status: 'COMPLETE' as const,
      totalSelected: 30,
    }));
    const service = new TopicPlanningService({
      now: () => '2026-07-30T08:00:00.000Z',
      persistence: {
        cancelGenerationExecution: vi.fn(),
        cancelQuotaPlanExecution: vi.fn(),
        executeGenerationJob,
        executeQuotaPlanJob,
        failGenerationExecution: vi.fn(),
        failQuotaPlanExecution: vi.fn(),
      },
    });

    await expect(
      service.executeGeneration(generationPayload, async () => 'CONTINUE'),
    ).resolves.toEqual({
      contractVersion: 'topic-generation-job-v1',
      createdCount: 5,
      duplicateCount: 0,
      executionId: 'topic-workflow-generation',
      externalRequestCount: 0,
      noOp: false,
      runId: 'topic-run-workflow',
      status: 'SUCCEEDED',
    });
    await expect(service.executeQuotaPlan(quotaPayload, async () => 'CONTINUE')).resolves.toEqual({
      contractVersion: 'topic-quota-job-v1',
      executionId: 'topic-workflow-quota',
      externalRequestCount: 0,
      planVersionId: 'topic-quota-plan-workflow',
      status: 'COMPLETE',
      totalSelected: 30,
    });
    expect(executeGenerationJob).toHaveBeenCalledWith(
      generationPayload,
      '2026-07-30T08:00:00.000Z',
      undefined,
    );
    expect(executeQuotaPlanJob).toHaveBeenCalledWith(
      quotaPayload,
      '2026-07-30T08:00:00.000Z',
      undefined,
    );
  });

  it('cooperates with pause, cancel, and AbortSignal before publishing local results', async () => {
    const cancelGenerationExecution = vi.fn(() => ({ status: 'CANCELLED' }));
    const cancelQuotaPlanExecution = vi.fn(() => ({ status: 'CANCELLED' }));
    const executeGenerationJob = vi.fn();
    const executeQuotaPlanJob = vi.fn();
    const service = new TopicPlanningService({
      now: () => '2026-07-30T08:01:00.000Z',
      persistence: {
        cancelGenerationExecution,
        cancelQuotaPlanExecution,
        executeGenerationJob: executeGenerationJob as never,
        executeQuotaPlanJob: executeQuotaPlanJob as never,
        failGenerationExecution: vi.fn(),
        failQuotaPlanExecution: vi.fn(),
      },
    });

    await expect(
      service.executeGeneration(generationPayload, async () => 'PAUSE'),
    ).resolves.toMatchObject({ externalRequestCount: 0, status: 'PAUSED' });
    await expect(
      service.executeGeneration(generationPayload, async () => 'CANCEL'),
    ).resolves.toMatchObject({ externalRequestCount: 0, status: 'CANCELLED' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.executeQuotaPlan(quotaPayload, async () => 'CONTINUE', controller.signal),
    ).resolves.toMatchObject({
      externalRequestCount: 0,
      planVersionId: null,
      status: 'CANCELLED',
    });
    expect(cancelGenerationExecution).toHaveBeenCalledTimes(1);
    expect(cancelQuotaPlanExecution).toHaveBeenCalledWith(
      'topic-workflow-quota',
      '2026-07-30T08:01:00.000Z',
    );
    expect(executeGenerationJob).not.toHaveBeenCalled();
    expect(executeQuotaPlanJob).not.toHaveBeenCalled();
  });

  it('registers only finite handlers, rejects extra payload fields, and sanitizes Topic errors', async () => {
    const persistence = {
      cancelGenerationExecution: vi.fn(),
      cancelQuotaPlanExecution: vi.fn(),
      executeGenerationJob: vi.fn(() => {
        throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
      }) as never,
      executeQuotaPlanJob: vi.fn(() => {
        throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
      }) as never,
      failGenerationExecution: vi.fn(),
      failQuotaPlanExecution: vi.fn(),
    };
    const registry = new JobHandlerRegistry();
    registerTopicPlanningJobs(registry, persistence);
    expect(registry.has(TOPIC_GENERATE_JOB_TYPE)).toBe(true);
    expect(registry.has(TOPIC_QUOTA_PLAN_JOB_TYPE)).toBe(true);

    const handler = createTopicGenerationJobHandler(
      new TopicPlanningService({
        now: () => '2026-07-30T08:02:00.000Z',
        persistence,
      }),
    );
    const context = {
      heartbeat: async () => 'CONTINUE' as const,
      job: {} as never,
      signal: new AbortController().signal,
    };
    await expect(handler(generationPayload, context)).rejects.toMatchObject({
      code: 'TOPIC_STALE_REVISION',
    });
    expect(persistence.failGenerationExecution).toHaveBeenCalledWith(
      'topic-workflow-generation',
      'TOPIC_STALE_REVISION',
      '2026-07-30T08:02:00.000Z',
    );
    await expect(
      new TopicPlanningService({
        now: () => '2026-07-30T08:02:00.000Z',
        persistence,
      }).executeQuotaPlan(quotaPayload, async () => 'CONTINUE'),
    ).rejects.toThrowError('TOPIC_STALE_REVISION');
    expect(persistence.failQuotaPlanExecution).toHaveBeenCalledWith(
      'topic-workflow-quota',
      'TOPIC_STALE_REVISION',
      '2026-07-30T08:02:00.000Z',
    );
    await expect(
      handler({ ...generationPayload, dossierBody: 'forbidden' }, context),
    ).rejects.toMatchObject({ code: 'TOPIC_INVALID_CONTRACT' });
  });
});
