export interface BackoffPolicy {
  delayMilliseconds(attemptCount: number): number;
}

export interface ExponentialBackoffOptions {
  readonly baseDelayMilliseconds?: number;
  readonly jitterRatio?: number;
  readonly maxDelayMilliseconds?: number;
  readonly multiplier?: number;
  readonly random?: () => number;
}

export class ExponentialBackoffPolicy implements BackoffPolicy {
  readonly #baseDelayMilliseconds: number;
  readonly #jitterRatio: number;
  readonly #maxDelayMilliseconds: number;
  readonly #multiplier: number;
  readonly #random: () => number;

  public constructor(options: ExponentialBackoffOptions = {}) {
    this.#baseDelayMilliseconds = options.baseDelayMilliseconds ?? 1_000;
    this.#jitterRatio = options.jitterRatio ?? 0;
    this.#maxDelayMilliseconds = options.maxDelayMilliseconds ?? 60_000;
    this.#multiplier = options.multiplier ?? 2;
    this.#random = options.random ?? Math.random;

    if (
      !Number.isFinite(this.#baseDelayMilliseconds) ||
      this.#baseDelayMilliseconds < 0 ||
      !Number.isFinite(this.#maxDelayMilliseconds) ||
      this.#maxDelayMilliseconds < 0 ||
      !Number.isFinite(this.#multiplier) ||
      this.#multiplier < 1 ||
      !Number.isFinite(this.#jitterRatio) ||
      this.#jitterRatio < 0 ||
      this.#jitterRatio > 1
    ) {
      throw new TypeError('Invalid exponential backoff configuration.');
    }
  }

  public delayMilliseconds(attemptCount: number): number {
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
      throw new TypeError('attemptCount must be a positive safe integer.');
    }

    const exponent = Math.min(attemptCount - 1, 1024);
    const exponential = this.#baseDelayMilliseconds * this.#multiplier ** exponent;
    const capped = Math.min(
      Number.isFinite(exponential) ? exponential : this.#maxDelayMilliseconds,
      this.#maxDelayMilliseconds,
    );
    const random = this.#random();
    if (!Number.isFinite(random) || random < 0 || random > 1) {
      throw new TypeError('Backoff random source must return a number from 0 through 1.');
    }
    const jitter = capped * this.#jitterRatio * (random * 2 - 1);
    return Math.max(0, Math.min(this.#maxDelayMilliseconds, Math.round(capped + jitter)));
  }
}
