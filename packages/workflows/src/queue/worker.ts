import type { Job } from './types.js';
import type { JobHandler, JobHandlerRegistry } from './handler-registry.js';
import { JobHandlerExecutionError } from './error-sanitizer.js';
import type { QueueScheduler } from './clock.js';
import { QueueSleepAbortedError, SystemQueueScheduler } from './clock.js';
import type { JobQueueService } from './queue-service.js';
import type { JsonValue, QueueControlSignal } from './types.js';

interface ActiveExecution {
  abandon: boolean;
  readonly handlerAbort: AbortController;
  readonly heartbeatAbort: AbortController;
  promise: Promise<void>;
}

export interface JobWorkerOptions {
  readonly concurrency?: number;
  readonly heartbeatIntervalMilliseconds?: number;
  readonly leaseDurationMilliseconds?: number;
  readonly pollingIntervalMilliseconds?: number;
  readonly scheduler?: QueueScheduler;
}

function assertBoundedInteger(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
}

export class JobWorker {
  readonly #active = new Set<ActiveExecution>();
  readonly #concurrency: number;
  readonly #heartbeatIntervalMilliseconds: number;
  readonly #leaseDurationMilliseconds: number;
  readonly #pollAbort = new AbortController();
  readonly #pollingIntervalMilliseconds: number;
  readonly #queueService: JobQueueService;
  readonly #registry: JobHandlerRegistry;
  readonly #scheduler: QueueScheduler;
  readonly #workerId: string;
  #lastError: unknown = null;
  #started = false;
  #stopRequested = false;

  public constructor(
    workerId: string,
    queueService: JobQueueService,
    registry: JobHandlerRegistry,
    options: JobWorkerOptions = {},
  ) {
    this.#workerId = workerId.trim();
    if (this.#workerId.length === 0 || this.#workerId.length > 256) {
      throw new TypeError('workerId must contain 1 to 256 characters.');
    }
    this.#queueService = queueService;
    this.#registry = registry;
    this.#concurrency = options.concurrency ?? 1;
    this.#heartbeatIntervalMilliseconds = options.heartbeatIntervalMilliseconds ?? 10_000;
    this.#leaseDurationMilliseconds = options.leaseDurationMilliseconds ?? 30_000;
    this.#pollingIntervalMilliseconds = options.pollingIntervalMilliseconds ?? 1_000;
    this.#scheduler = options.scheduler ?? new SystemQueueScheduler();

    assertBoundedInteger(this.#concurrency, 'concurrency', 1, 32);
    assertBoundedInteger(
      this.#heartbeatIntervalMilliseconds,
      'heartbeatIntervalMilliseconds',
      1,
      86_400_000,
    );
    assertBoundedInteger(
      this.#leaseDurationMilliseconds,
      'leaseDurationMilliseconds',
      this.#heartbeatIntervalMilliseconds + 1,
      86_400_000,
    );
    assertBoundedInteger(
      this.#pollingIntervalMilliseconds,
      'pollingIntervalMilliseconds',
      1,
      86_400_000,
    );
  }

  public get activeCount(): number {
    return this.#active.size;
  }

  public get lastError(): unknown {
    return this.#lastError;
  }

  public async runOnce(): Promise<boolean> {
    if (this.#stopRequested) {
      return false;
    }
    const job = this.#queueService.claimNextJob(this.#workerId, {
      leaseDurationMilliseconds: this.#leaseDurationMilliseconds,
    });
    if (job === null) {
      return false;
    }

    const execution = this.#launch(job);
    await execution.promise;
    return true;
  }

  public async start(): Promise<void> {
    if (this.#started) {
      throw new Error('JobWorker.start() can only be called once.');
    }
    this.#started = true;

    while (!this.#stopRequested) {
      let claimed = false;
      while (!this.#stopRequested && this.#active.size < this.#concurrency) {
        const job = this.#queueService.claimNextJob(this.#workerId, {
          leaseDurationMilliseconds: this.#leaseDurationMilliseconds,
        });
        if (job === null) {
          break;
        }
        claimed = true;
        this.#launch(job);
      }

      if (this.#stopRequested) {
        break;
      }

      try {
        if (this.#active.size === 0 || !claimed) {
          await this.#scheduler.sleep(this.#pollingIntervalMilliseconds, this.#pollAbort.signal);
        } else {
          await Promise.race([...this.#active].map((execution) => execution.promise));
        }
      } catch (error) {
        if (!(error instanceof QueueSleepAbortedError)) {
          this.#lastError = error;
        }
      }
    }

    await Promise.allSettled([...this.#active].map((execution) => execution.promise));
  }

  public async shutdown(timeoutMilliseconds = 30_000): Promise<boolean> {
    assertBoundedInteger(timeoutMilliseconds, 'timeoutMilliseconds', 1, 86_400_000);
    this.#stopRequested = true;
    this.#pollAbort.abort();

    if (this.#active.size === 0) {
      return true;
    }

    const timeoutAbort = new AbortController();
    const allFinished = Promise.allSettled(
      [...this.#active].map((execution) => execution.promise),
    ).then(() => {
      timeoutAbort.abort();
      return true;
    });
    const timedOut = this.#scheduler
      .sleep(timeoutMilliseconds, timeoutAbort.signal)
      .then(() => false)
      .catch((error: unknown) => {
        if (error instanceof QueueSleepAbortedError) {
          return true;
        }
        throw error;
      });
    const finished = await Promise.race([allFinished, timedOut]);

    if (!finished) {
      for (const execution of this.#active) {
        execution.abandon = true;
        execution.heartbeatAbort.abort();
        execution.handlerAbort.abort();
      }
    }
    return finished;
  }

  #launch(job: Job): ActiveExecution {
    const execution: ActiveExecution = {
      abandon: false,
      handlerAbort: new AbortController(),
      heartbeatAbort: new AbortController(),
      promise: Promise.resolve(),
    };
    execution.promise = this.#execute(job, execution)
      .catch((error: unknown) => {
        this.#lastError = error;
        throw error;
      })
      .finally(() => {
        this.#active.delete(execution);
      });
    this.#active.add(execution);
    return execution;
  }

  async #execute(job: Job, execution: ActiveExecution): Promise<void> {
    let control: QueueControlSignal = 'CONTINUE';
    let handlerError: unknown;
    let result: JsonValue | undefined;
    let heartbeatError: unknown;

    const applyControl = (nextControl: QueueControlSignal): QueueControlSignal => {
      control = nextControl;
      if (control !== 'CONTINUE') {
        execution.handlerAbort.abort();
      }
      return control;
    };
    const heartbeat = (): Promise<QueueControlSignal> => {
      const nextControl = this.#queueService.heartbeat(
        job.id,
        this.#workerId,
        job.leaseToken ?? '',
        { leaseDurationMilliseconds: this.#leaseDurationMilliseconds },
      );
      return Promise.resolve(applyControl(nextControl));
    };
    const heartbeatLoop = this.#runHeartbeatLoop(heartbeat, execution.heartbeatAbort.signal).catch(
      (error: unknown) => {
        if (!(error instanceof QueueSleepAbortedError)) {
          heartbeatError = error;
          execution.handlerAbort.abort();
        }
      },
    );

    try {
      const handler = this.#registry.get(job.jobType);
      if (handler === null) {
        throw new JobHandlerExecutionError(
          'HANDLER_NOT_REGISTERED',
          `No handler is registered for ${job.jobType}.`,
        );
      }
      result = await this.#invokeHandler(handler, job, execution, heartbeat);
    } catch (error) {
      handlerError = error;
    } finally {
      execution.heartbeatAbort.abort();
      await heartbeatLoop;
    }

    if (execution.abandon) {
      return;
    }
    if (heartbeatError !== undefined) {
      throw heartbeatError;
    }

    const finalControl = this.#queueService.heartbeat(
      job.id,
      this.#workerId,
      job.leaseToken ?? '',
      {
        leaseDurationMilliseconds: this.#leaseDurationMilliseconds,
      },
    );
    applyControl(finalControl);
    if (finalControl === 'PAUSE') {
      this.#queueService.acknowledgePause(job.id, this.#workerId, job.leaseToken ?? '');
      return;
    }
    if (finalControl === 'CANCEL') {
      this.#queueService.acknowledgeCancel(job.id, this.#workerId, job.leaseToken ?? '');
      return;
    }
    if (handlerError !== undefined) {
      this.#queueService.failJob(job.id, this.#workerId, job.leaseToken ?? '', handlerError);
      return;
    }
    this.#queueService.completeJob(job.id, this.#workerId, job.leaseToken ?? '', result);
  }

  async #invokeHandler(
    handler: JobHandler,
    job: Job,
    execution: ActiveExecution,
    heartbeat: () => Promise<QueueControlSignal>,
  ): Promise<JsonValue | undefined> {
    return handler(job.payload, {
      heartbeat,
      job,
      signal: execution.handlerAbort.signal,
    });
  }

  async #runHeartbeatLoop(
    heartbeat: () => Promise<QueueControlSignal>,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      await this.#scheduler.sleep(this.#heartbeatIntervalMilliseconds, signal);
      if (signal.aborted) {
        return;
      }
      const control = await heartbeat();
      if (control !== 'CONTINUE') {
        return;
      }
    }
  }
}
