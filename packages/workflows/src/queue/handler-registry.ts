import type { Job, JsonValue, QueueControlSignal } from './types.js';

export interface JobHandlerContext {
  readonly job: Job;
  readonly signal: AbortSignal;
  heartbeat(): Promise<QueueControlSignal>;
}

export type JobHandler = (
  payload: JsonValue,
  context: JobHandlerContext,
) => Promise<JsonValue | undefined>;

export class JobHandlerRegistry {
  readonly #handlers = new Map<string, JobHandler>();

  public register(jobType: string, handler: JobHandler): void {
    const normalized = jobType.trim();
    if (normalized.length === 0 || normalized.length > 128) {
      throw new TypeError('jobType must contain 1 to 128 characters.');
    }
    if (this.#handlers.has(normalized)) {
      throw new Error(`A handler is already registered for ${normalized}.`);
    }
    this.#handlers.set(normalized, handler);
  }

  public get(jobType: string): JobHandler | null {
    return this.#handlers.get(jobType) ?? null;
  }

  public has(jobType: string): boolean {
    return this.#handlers.has(jobType);
  }
}
