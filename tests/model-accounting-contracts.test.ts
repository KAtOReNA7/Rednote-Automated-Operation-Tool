import { describe, expect, it } from 'vitest';

import {
  CANONICALIZATION_VERSION,
  CACHE_KEY_VERSION,
  CanonicalizationError,
  calculateUserPriceTableCost,
  canonicalJson,
  estimateRateMicroUsd,
  modelCacheKey,
  parseProviderUsdToMicroUsd,
  type ModelExecutionRequestV1,
  type ModelPriceScheduleV1,
} from '../packages/workflows/src/index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function request(overrides: Partial<ModelExecutionRequestV1> = {}): ModelExecutionRequestV1 {
  return {
    budgetClassification: 'NONESSENTIAL',
    cachePolicy: 'READ_WRITE',
    deadlineMs: 20_000,
    executionId: 'execution-1',
    generationOptions: { temperature: 0, topP: 1 },
    input: { text: '中文 空格 😀', values: [1, 2] },
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
      inputTokens: 1_000,
      outputTokens: 500,
      toolCalls: 0,
      webSearchCalls: 0,
    },
    ...overrides,
  };
}

describe('Issue 014 canonical identity and exact money contracts', () => {
  it('sorts object keys, preserves arrays and rejects values JSON would silently drop', () => {
    expect(canonicalJson({ b: 2, a: [2, 1] })).toBe('{"a":[2,1],"b":2}');
    expect(CANONICALIZATION_VERSION).toBe('canonical-json-v1');
    expect(CACHE_KEY_VERSION).toBe('cache-key-v1');
    expect(() => canonicalJson({ absent: undefined })).toThrowError(CanonicalizationError);
    expect(() => canonicalJson({ negativeZero: -0 })).toThrowError(CanonicalizationError);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrowError(CanonicalizationError);
  });

  it('ignores execution/runtime identity but misses on every material semantic identity', () => {
    const baseline = request();
    const baselineKey = modelCacheKey(baseline);
    expect(modelCacheKey(request({ executionId: 'execution-2', deadlineMs: 40_000 }))).toBe(
      baselineKey,
    );
    for (const changed of [
      request({ input: { text: 'different' } }),
      request({ modelId: 'other-model' }),
      request({ modelRole: 'REVIEW' }),
      request({ parameterVersion: 2 }),
      request({ protocolMode: 'RESPONSES' }),
      request({ providerConfigFingerprint: 'c'.repeat(64) }),
      request({ generationOptions: { temperature: 0.1 } }),
      request({ taskKind: 'VISION_GENERATION' }),
      request({
        promptIdentity: { contentHash: HASH_A, id: 'prompt', version: 2 },
      }),
      request({
        sourceIdentities: [{ contentHash: 'd'.repeat(64), kind: 'SOURCE' }],
      }),
    ]) {
      expect(modelCacheKey(changed)).not.toBe(baselineKey);
    }
  });

  it('uses exact decimal arithmetic and rounds protective estimates upward to one micro-USD', () => {
    expect(parseProviderUsdToMicroUsd('0.000001')).toBe(1);
    expect(parseProviderUsdToMicroUsd('79.999000')).toBe(79_999_000);
    expect(estimateRateMicroUsd(1, '0.000001', 1_000_000)).toBe(1);
    expect(() => parseProviderUsdToMicroUsd('1e-6')).toThrow();
    expect(() => parseProviderUsdToMicroUsd('0.0000001')).toThrow();
  });

  it('separates provider cached-input usage from local cache identity and cost', () => {
    const schedule: ModelPriceScheduleV1 = {
      cachedInputPerMillionUsd: '0.5',
      cacheWritePerMillionUsd: null,
      callUsd: null,
      currency: 'USD',
      imageGenerationCallUsd: null,
      imageUsd: null,
      inputPerMillionUsd: '1',
      inputTokensIncludeCachedInput: true,
      operationKind: 'TEXT_GENERATION',
      outputPerMillionUsd: '2',
      protocolMode: null,
      providerConfigFingerprint: HASH_B,
      searchCallUsd: null,
      toolUnitUsd: null,
      usageSemanticsVersion: 'usage-v1',
      version: 1,
    };
    const cost = calculateUserPriceTableCost(
      {
        cacheWriteTokens: null,
        cachedInputTokens: 200,
        imageGenerationCalls: 0,
        images: 0,
        inputTokens: 1_000,
        outputTokens: 500,
        reasoningTokens: null,
        source: 'PROVIDER',
        toolCalls: 0,
        totalTokens: 1_500,
        webSearchCalls: 0,
      },
      schedule,
    );
    expect(cost).toMatchObject({
      amountMicroUsd: 1_900,
      complete: true,
      state: 'USER_PRICE_TABLE_ESTIMATE',
    });
  });
});
