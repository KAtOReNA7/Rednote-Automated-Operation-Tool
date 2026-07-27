export interface QueueClock {
  now(): Date;
}

export interface QueueScheduler {
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export class SystemQueueClock implements QueueClock {
  public now(): Date {
    return new Date();
  }
}

export class QueueSleepAbortedError extends Error {
  public constructor() {
    super('Queue sleep was aborted.');
    this.name = 'QueueSleepAbortedError';
  }
}

export class SystemQueueScheduler implements QueueScheduler {
  public sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      return Promise.reject(new TypeError('Sleep duration must be a non-negative number.'));
    }
    if (signal?.aborted === true) {
      return Promise.reject(new QueueSleepAbortedError());
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, milliseconds);
      const onAbort = (): void => {
        clearTimeout(timeout);
        reject(new QueueSleepAbortedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
