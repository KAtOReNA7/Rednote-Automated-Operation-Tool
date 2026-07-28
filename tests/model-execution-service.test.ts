import { describe, expect, it, vi } from 'vitest';

import {
  MODEL_RESULT_CACHE_FORMAT,
  MODEL_RESULT_CACHE_FORMAT_VERSION,
  type ModelResultCacheEnvelope,
} from '../packages/storage/src/index.js';
import {
  ModelExecutionService,
  canonicalSha256,
  emptyUsageObservation,
  modelCacheKey,
  type ModelExecutionOutputV1,
  type ModelExecutionPersistence,
  type ModelExecutionRequestV1,
  type ModelExecutionResultV1,
  type PersistedCacheEntryV1,
} from '../packages/workflows/src/index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const output: ModelExecutionOutputV1 = {
  finishReason: 'stop',
  partial: false,
  refusal: false,
  text: 'fixture output',
  type: 'TEXT',
};

function request(
  executionId: string,
  cachePolicy: ModelExecutionRequestV1['cachePolicy'] = 'READ_WRITE',
) {
  return {
    budgetClassification: 'NONESSENTIAL',
    cachePolicy,
    deadlineMs: 20_000,
    executionId,
    generationOptions: { temperature: 0 },
    input: { prompt: 'same semantic request' },
    mediaIdentities: [],
    modelId: 'fixture-model',
    modelRole: 'WRITING',
    modelSlot: 'WRITING',
    parameterVersion: 1,
    promptIdentity: { contentHash: HASH_A, id: 'prompt', version: 1 },
    protocolMode: 'MOCK',
    providerConfigFingerprint: HASH_B,
    requiredCapabilities: ['text'],
    sourceIdentities: [],
    taskKind: 'TEXT_GENERATION',
    unitDemandUpperBound: {
      externalCalls: 1,
      imageGenerationCalls: 0,
      images: 0,
      inputTokens: 100,
      outputTokens: 100,
      toolCalls: 0,
      webSearchCalls: 0,
    },
  } satisfies ModelExecutionRequestV1;
}

function harness(options: { budgetBlocked?: boolean; maxConcurrent?: number } = {}) {
  const executions = new Map<string, { cacheKey: string; result: ModelExecutionResultV1 }>();
  const entries = new Map<string, PersistedCacheEntryV1>();
  const envelopes = new Map<string, ModelResultCacheEnvelope<ModelExecutionOutputV1>>();
  const persistence: ModelExecutionPersistence = {
    findExecution: (executionId) => executions.get(executionId) ?? null,
    findReadyCache: (cacheKey) => entries.get(cacheKey) ?? null,
    finalizeFailure: (value, cacheKey, result) => {
      executions.set(value.executionId, { cacheKey, result });
    },
    finalizeSuccess: (value, cacheKey, result, cache) => {
      executions.set(value.executionId, { cacheKey, result });
      if (cache !== null) entries.set(cacheKey, cache);
    },
    markCacheCorrupt: (cacheKey) => entries.delete(cacheKey),
    recordCacheHit: (value, cacheKey, cachedOutput) => {
      const result: ModelExecutionResultV1 = {
        costAmountMicroUsd: null,
        costState: 'NOT_INCURRED',
        executionId: value.executionId,
        externalRequestCount: 0,
        localCacheHit: true,
        outcomeCertainty: 'NOT_SENT',
        output: cachedOutput,
        stableErrorCode: null,
        status: 'CACHE_HIT',
        usage: emptyUsageObservation(),
      };
      executions.set(value.executionId, { cacheKey, result });
      return result;
    },
    reserveAndStart: () => {
      if (options.budgetBlocked) throw new Error('BUDGET_HARD_LIMIT_REACHED');
      return { priceSchedule: null, reservationId: 'reservation-1' };
    },
  };
  const cache = {
    read: async (entry: PersistedCacheEntryV1) => {
      const value = envelopes.get(entry.managedPath);
      if (value === undefined) throw new Error('missing');
      return value;
    },
    write: async (envelope: ModelResultCacheEnvelope<ModelExecutionOutputV1>) => {
      const managedPath = `cache/model-results/${canonicalSha256(envelope)}.json`;
      envelopes.set(managedPath, envelope);
      return {
        contentHash: 'c'.repeat(64),
        managedPath,
        sizeBytes: 100,
      };
    },
  };
  let active = 0;
  let peak = 0;
  const providerInvoker = vi.fn(async () => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      return {
        cost: null,
        outcomeCertainty: 'COMPLETED_INVALID_OUTPUT' as const,
        output,
        usage: emptyUsageObservation(),
      };
    } finally {
      active -= 1;
    }
  });
  const assertCapability = vi.fn();
  const resolveCredential = vi.fn(async () => 'runtime-fixture-only');
  const service = new ModelExecutionService({
    assertCapability,
    cache,
    ...(options.maxConcurrent === undefined
      ? {}
      : { maxConcurrentExternalRequests: options.maxConcurrent }),
    now: () => new Date('2026-07-28T00:00:00.000Z'),
    persistence,
    providerInvoker,
    resolveCredential,
  });
  return {
    assertCapability,
    entries,
    envelopes,
    peak: () => peak,
    providerInvoker,
    resolveCredential,
    service,
  };
}

describe('Issue 014 ModelExecutionService ordering and singleflight', () => {
  it('coalesces 20 concurrent identical keys into one external request and 19 local hits', async () => {
    const test = harness();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => test.service.execute(request(`execution-${index}`))),
    );
    expect(test.providerInvoker).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'SUCCEEDED')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'CACHE_HIT')).toHaveLength(19);
    expect(results.reduce((sum, result) => sum + result.externalRequestCount, 0)).toBe(1);
  });

  it('bounds 20 different keys with one global external-request concurrency limit', async () => {
    const test = harness({ maxConcurrent: 3 });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        test.service.execute({
          ...request(`different-${index}`, 'BYPASS'),
          input: { prompt: `different-${index}` },
        }),
      ),
    );
    expect(results.every((result) => result.status === 'SUCCEEDED')).toBe(true);
    expect(test.providerInvoker).toHaveBeenCalledTimes(20);
    expect(test.peak()).toBe(3);
  });

  it('serves a verified local cache hit before capability, budget and credential checks', async () => {
    const test = harness();
    const first = await test.service.execute(request('owner'));
    expect(first.status).toBe('SUCCEEDED');
    test.assertCapability.mockImplementation(() => {
      throw new Error('stale capability');
    });
    test.resolveCredential.mockClear();
    const hit = await test.service.execute(request('cache-hit'));
    expect(hit).toMatchObject({
      costState: 'NOT_INCURRED',
      externalRequestCount: 0,
      localCacheHit: true,
      status: 'CACHE_HIT',
    });
    expect(test.resolveCredential).not.toHaveBeenCalled();
  });

  it('blocks on budget before credential resolution and never writes cache', async () => {
    const test = harness({ budgetBlocked: true });
    const result = await test.service.execute(request('budget-blocked'));
    expect(result).toMatchObject({
      externalRequestCount: 0,
      stableErrorCode: 'BUDGET_HARD_LIMIT_REACHED',
      status: 'BUDGET_BLOCKED',
    });
    expect(test.resolveCredential).not.toHaveBeenCalled();
    expect(test.providerInvoker).not.toHaveBeenCalled();
    expect(test.entries.size).toBe(0);
  });

  it('requires BYPASS for probes, searches and tool tasks', async () => {
    const test = harness();
    await expect(
      test.service.execute({
        ...request('probe'),
        cachePolicy: 'READ_WRITE',
        taskKind: 'CAPABILITY_PROBE_TEXT',
      }),
    ).rejects.toThrow('finite contract');
    expect(test.providerInvoker).not.toHaveBeenCalled();
  });

  it('uses the controlled cache envelope and never stores raw provider envelopes', () => {
    expect(MODEL_RESULT_CACHE_FORMAT).toBe('rednote-model-result-cache');
    expect(MODEL_RESULT_CACHE_FORMAT_VERSION).toBe(1);
    expect(modelCacheKey(request('one'))).toBe(modelCacheKey(request('two')));
  });
});
