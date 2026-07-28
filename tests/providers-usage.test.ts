import { describe, expect, it } from 'vitest';

import {
  applyUsageCapability,
  emptyProviderUsage,
  parseProviderUsage,
} from '../packages/providers/src/index.js';
import { createProviderContext } from './support/provider-test-utils.js';

const identity = createProviderContext('TEXT_GENERATION', 'RESPONSES');

describe('Issue 012 provider usage', () => {
  it('keeps every missing field null rather than zero', () => {
    expect(emptyProviderUsage()).toEqual({
      cachedInputTokens: null,
      complete: false,
      imageInputCount: null,
      imageOutputCount: null,
      inputTokens: null,
      outputTokens: null,
      providerReported: false,
      reasoningTokens: null,
      totalTokens: null,
      warnings: ['USAGE_NOT_REPORTED'],
    });
    expect(parseProviderUsage(undefined, 'RESPONSES', identity)).toEqual(emptyProviderUsage());
  });

  it.each([
    [
      'RESPONSES',
      {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens: 4,
        output_tokens_details: { reasoning_tokens: 1 },
        total_tokens: 14,
      },
    ],
    [
      'CHAT_COMPLETIONS',
      {
        completion_tokens: 4,
        completion_tokens_details: { reasoning_tokens: 1 },
        prompt_tokens: 10,
        prompt_tokens_details: { cached_tokens: 2 },
        total_tokens: 14,
      },
    ],
  ] as const)('normalizes %s token names', (dialect, usage) => {
    expect(parseProviderUsage(usage, dialect, identity)).toMatchObject({
      cachedInputTokens: 2,
      complete: true,
      inputTokens: 10,
      outputTokens: 4,
      providerReported: true,
      reasoningTokens: 1,
      totalTokens: 14,
      warnings: [],
    });
  });

  it('keeps reported components and warns when total conflicts', () => {
    expect(
      parseProviderUsage(
        { input_tokens: 10, output_tokens: 4, total_tokens: 99 },
        'RESPONSES',
        identity,
      ),
    ).toMatchObject({
      complete: false,
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 99,
      warnings: ['USAGE_TOTAL_CONFLICT', 'USAGE_INCOMPLETE'],
    });
  });

  it('does not infer total or pass through unknown fields', () => {
    const usage = parseProviderUsage(
      { input_tokens: 3, output_tokens: 2, vendor_dollars: 42 },
      'RESPONSES',
      identity,
    );
    expect(usage.totalTokens).toBeNull();
    expect(usage).not.toHaveProperty('vendor_dollars');
    expect(usage).not.toHaveProperty('cost');
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid usage count %s',
    (input_tokens) => {
      expect(() => parseProviderUsage({ input_tokens }, 'RESPONSES', identity)).toThrowError(
        expect.objectContaining({ code: 'PROVIDER_INVALID_USAGE' }),
      );
    },
  );

  it('normalizes optional image counts without inventing token values', () => {
    expect(
      parseProviderUsage(
        { image_input_count: 1, image_output_count: 2 },
        'IMAGES_GENERATIONS',
        createProviderContext('IMAGE_GENERATION', 'IMAGES_GENERATIONS'),
      ),
    ).toMatchObject({
      imageInputCount: 1,
      imageOutputCount: 2,
      inputTokens: null,
      outputTokens: null,
      providerReported: true,
      totalTokens: null,
    });
  });

  it('does not claim complete usage while usage capability is UNKNOWN', () => {
    const reported = parseProviderUsage(
      { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      'RESPONSES',
      identity,
    );
    expect(applyUsageCapability(reported, 'UNKNOWN')).toMatchObject({
      complete: false,
      providerReported: true,
      warnings: ['USAGE_INCOMPLETE'],
    });
  });
});
