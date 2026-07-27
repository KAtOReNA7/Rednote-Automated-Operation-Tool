import type { LocalApiClock } from './contracts.js';

interface RateBucket {
  count: number;
  windowStartedAt: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  readonly #buckets = new Map<string, RateBucket>();
  readonly #clock: LocalApiClock;
  readonly #windowMilliseconds: number;

  public constructor(
    clock: LocalApiClock = { now: () => new Date() },
    windowMilliseconds = 60_000,
  ) {
    this.#clock = clock;
    this.#windowMilliseconds = windowMilliseconds;
  }

  public take(key: string, limit: number): RateLimitResult {
    const now = this.#clock.now().getTime();
    let bucket = this.#buckets.get(key);
    if (bucket === undefined || now - bucket.windowStartedAt >= this.#windowMilliseconds) {
      bucket = { count: 0, windowStartedAt: now };
      this.#buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.windowStartedAt + this.#windowMilliseconds - now) / 1_000),
        ),
      };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  public clear(): void {
    this.#buckets.clear();
  }
}
