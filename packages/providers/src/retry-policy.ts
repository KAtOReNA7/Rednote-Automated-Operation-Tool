import { ProviderError, isProviderError } from './errors.js';

export interface RetryClock {
  nowMilliseconds(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface ProviderRetryPolicyOptions {
  readonly baseDelayMs?: number;
  readonly clock?: RetryClock;
  readonly jitterRatio?: number;
  readonly maxAttempts?: number;
  readonly maxDelayMs?: number;
  readonly random?: () => number;
}

export interface RetryExecutionContext {
  readonly modelId: string | null;
  readonly operation: string;
  readonly providerId: string;
  readonly requestId: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

const defaultClock: RetryClock = {
  nowMilliseconds: () => Date.now(),
  sleep: (milliseconds, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, milliseconds);
      const abort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
    }),
};

export function parseRetryAfter(
  value: string | null | undefined,
  nowMilliseconds: number,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    return Math.min(60_000, Number.parseInt(trimmed, 10) * 1000);
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) {
    return null;
  }
  return Math.max(0, Math.min(60_000, date - nowMilliseconds));
}

export class ProviderRetryPolicy {
  readonly #baseDelayMs: number;
  readonly #clock: RetryClock;
  readonly #jitterRatio: number;
  readonly #maxAttempts: number;
  readonly #maxDelayMs: number;
  readonly #random: () => number;

  public constructor(options: ProviderRetryPolicyOptions = {}) {
    this.#baseDelayMs = options.baseDelayMs ?? 100;
    this.#clock = options.clock ?? defaultClock;
    this.#jitterRatio = options.jitterRatio ?? 0.2;
    this.#maxAttempts = options.maxAttempts ?? 2;
    this.#maxDelayMs = options.maxDelayMs ?? 5_000;
    this.#random = options.random ?? Math.random;
    if (
      !Number.isFinite(this.#baseDelayMs) ||
      this.#baseDelayMs < 0 ||
      !Number.isSafeInteger(this.#maxAttempts) ||
      this.#maxAttempts < 1 ||
      this.#maxAttempts > 2 ||
      !Number.isFinite(this.#maxDelayMs) ||
      this.#maxDelayMs < 0 ||
      !Number.isFinite(this.#jitterRatio) ||
      this.#jitterRatio < 0 ||
      this.#jitterRatio > 1
    ) {
      throw new TypeError('Invalid provider retry policy.');
    }
  }

  public async execute<T>(
    action: (attempt: number, remainingMs: number) => Promise<T>,
    context: RetryExecutionContext,
  ): Promise<T> {
    const startedAt = this.#clock.nowMilliseconds();
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      if (context.signal?.aborted === true) {
        throw this.#aborted(context, 'NOT_SENT');
      }
      const remainingMs = context.timeoutMs - (this.#clock.nowMilliseconds() - startedAt);
      if (remainingMs <= 0) {
        throw this.#timeout(context);
      }
      try {
        return await action(attempt, remainingMs);
      } catch (error) {
        if (
          !isProviderError(error) ||
          error.retryDisposition !== 'RETRY_AUTOMATIC_SAFE' ||
          error.outcomeCertainty !== 'NOT_SENT' ||
          attempt >= this.#maxAttempts
        ) {
          throw error;
        }
        const delay = this.#delayForAttempt(attempt);
        const remainingBeforeSleep =
          context.timeoutMs - (this.#clock.nowMilliseconds() - startedAt);
        if (delay >= remainingBeforeSleep) {
          throw this.#timeout(context);
        }
        const slept = await this.#clock.sleep(delay, context.signal).then(
          () => true,
          () => false,
        );
        if (!slept) {
          throw this.#aborted(context, 'NOT_SENT');
        }
      }
    }
    throw this.#timeout(context);
  }

  #aborted(
    context: RetryExecutionContext,
    certainty: 'MAY_HAVE_EXECUTED' | 'NOT_SENT',
  ): ProviderError {
    return new ProviderError('PROVIDER_ABORTED', {
      causeCategory: 'ABORT',
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: certainty,
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition: 'DO_NOT_RETRY',
    });
  }

  #delayForAttempt(attempt: number): number {
    const random = this.#random();
    if (!Number.isFinite(random) || random < 0 || random > 1) {
      throw new TypeError('Retry random source must return a number from 0 through 1.');
    }
    const base = Math.min(this.#maxDelayMs, this.#baseDelayMs * 2 ** (attempt - 1));
    const jitter = base * this.#jitterRatio * (random * 2 - 1);
    return Math.max(0, Math.min(this.#maxDelayMs, Math.round(base + jitter)));
  }

  #timeout(context: RetryExecutionContext): ProviderError {
    return new ProviderError('PROVIDER_TIMEOUT', {
      causeCategory: 'TIMEOUT',
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: 'NOT_SENT',
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition: 'DO_NOT_RETRY',
    });
  }
}
