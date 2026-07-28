import { describe, expect, it } from 'vitest';

import {
  ProviderError,
  ProviderRetryPolicy,
  parseRetryAfter,
  type RetryClock,
} from '../packages/providers/src/index.js';

class FakeRetryClock implements RetryClock {
  public now = 1_000;
  public readonly sleeps: number[] = [];

  public nowMilliseconds(): number {
    return this.now;
  }

  public async sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }
    this.sleeps.push(milliseconds);
    this.now += milliseconds;
  }
}

const retryContext = {
  modelId: 'model-writing',
  operation: 'TEXT_GENERATION',
  providerId: 'configured-provider',
  requestId: 'request-retry',
  timeoutMs: 10_000,
};

function failure(
  retryDisposition: 'DO_NOT_RETRY' | 'RETRY_AUTOMATIC_SAFE' | 'RETRY_MANUAL',
  outcomeCertainty:
    'COMPLETED_INVALID_OUTPUT' | 'MAY_HAVE_EXECUTED' | 'NOT_SENT' | 'REJECTED_BEFORE_EXECUTION',
): ProviderError {
  return new ProviderError('PROVIDER_NETWORK_UNREACHABLE', {
    causeCategory: 'NETWORK',
    modelId: retryContext.modelId,
    operation: retryContext.operation,
    outcomeCertainty,
    providerId: retryContext.providerId,
    requestId: retryContext.requestId,
    retryDisposition,
  });
}

describe('Issue 012 provider errors and retry policy', () => {
  it('creates finite errors with no stack, cause text, or vendor body', () => {
    const error = new ProviderError('PROVIDER_UPSTREAM_5XX', {
      causeCategory: 'UPSTREAM',
      details: {
        status: 503,
        unsafeDetailNameWithCredential: 'limited-value',
      },
      modelId: 'model-writing',
      operation: 'TEXT_GENERATION',
      outcomeCertainty: 'MAY_HAVE_EXECUTED',
      providerId: 'provider-a',
      requestId: 'request-a',
      retryDisposition: 'RETRY_MANUAL',
    });
    expect(error.stack).toBeUndefined();
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toMatch(/vendor|authorization|bearer/iu);
    expect(Object.keys(error.details).length).toBeLessThanOrEqual(12);
  });

  it.each([
    ['12', 12_000],
    ['120', 60_000],
    ['invalid', null],
  ] as const)('parses and caps Retry-After value %s', (value, expected) => {
    expect(parseRetryAfter(value, Date.UTC(2026, 6, 28))).toBe(expected);
  });

  it('parses HTTP-date Retry-After against an injected current time', () => {
    const now = Date.UTC(2026, 6, 28, 0, 0, 0);
    expect(parseRetryAfter(new Date(now + 15_000).toUTCString(), now)).toBe(15_000);
  });

  it('retries only a NOT_SENT automatic-safe failure and caps attempts at two', async () => {
    const clock = new FakeRetryClock();
    const policy = new ProviderRetryPolicy({
      baseDelayMs: 100,
      clock,
      jitterRatio: 0,
      maxAttempts: 2,
      random: () => 0.5,
    });
    let attempts = 0;
    const result = await policy.execute(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw failure('RETRY_AUTOMATIC_SAFE', 'NOT_SENT');
      }
      return 'ok';
    }, retryContext);
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
    expect(clock.sleeps).toEqual([100]);
  });

  it.each([
    ['RETRY_MANUAL', 'MAY_HAVE_EXECUTED'],
    ['DO_NOT_RETRY', 'REJECTED_BEFORE_EXECUTION'],
    ['RETRY_AUTOMATIC_SAFE', 'MAY_HAVE_EXECUTED'],
    ['RETRY_MANUAL', 'COMPLETED_INVALID_OUTPUT'],
  ] as const)('does not automatically retry %s / %s', async (retryDisposition, certainty) => {
    const clock = new FakeRetryClock();
    const policy = new ProviderRetryPolicy({ clock });
    let attempts = 0;
    await expect(
      policy.execute(async () => {
        attempts += 1;
        throw failure(retryDisposition, certainty);
      }, retryContext),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(attempts).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('uses bounded injectable jitter', async () => {
    const clock = new FakeRetryClock();
    const policy = new ProviderRetryPolicy({
      baseDelayMs: 100,
      clock,
      jitterRatio: 0.5,
      maxDelayMs: 120,
      random: () => 1,
    });
    let attempts = 0;
    await policy.execute(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw failure('RETRY_AUTOMATIC_SAFE', 'NOT_SENT');
      }
      return undefined;
    }, retryContext);
    expect(clock.sleeps).toEqual([120]);
  });

  it('lets AbortSignal interrupt retry backoff without another attempt', async () => {
    const controller = new AbortController();
    const clock: RetryClock = {
      nowMilliseconds: () => 0,
      sleep: async () => {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      },
    };
    const policy = new ProviderRetryPolicy({ clock });
    let attempts = 0;
    await expect(
      policy.execute(
        async () => {
          attempts += 1;
          throw failure('RETRY_AUTOMATIC_SAFE', 'NOT_SENT');
        },
        { ...retryContext, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
    expect(attempts).toBe(1);
  });

  it('applies one deadline across attempts and backoff', async () => {
    const clock = new FakeRetryClock();
    const policy = new ProviderRetryPolicy({
      baseDelayMs: 500,
      clock,
      jitterRatio: 0,
    });
    await expect(
      policy.execute(
        async () => {
          throw failure('RETRY_AUTOMATIC_SAFE', 'NOT_SENT');
        },
        { ...retryContext, timeoutMs: 400 },
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      outcomeCertainty: 'NOT_SENT',
    });
    expect(clock.sleeps).toEqual([]);
  });
});
