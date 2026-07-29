import { randomUUID } from 'node:crypto';

import { JOB_STATUSES } from '@mystery-operations/core';
import { JobQueueRepositoryError } from '@mystery-operations/db';
import type { JobQueueRepository, QueueStats, StoredJob } from '@mystery-operations/db';

import type { BackoffPolicy } from './backoff.js';
import { ExponentialBackoffPolicy } from './backoff.js';
import type { QueueClock } from './clock.js';
import { SystemQueueClock } from './clock.js';
import { sanitizeJobError } from './error-sanitizer.js';
import type { JobHandlerRegistry } from './handler-registry.js';
import { assertSafeIdempotencyKey, JobPayloadValidator } from './payload-validator.js';
import type {
  ClaimNextJobOptions,
  EnqueueJobInput,
  Job,
  JobPagination,
  JsonValue,
  ListJobsFilter,
  QueueControlSignal,
  RetryFailedJobOptions,
} from './types.js';

export type JobQueueServiceErrorCode = 'INVALID_ARGUMENT' | 'JOB_TYPE_NOT_REGISTERED';

export class JobQueueServiceError extends Error {
  public readonly code: JobQueueServiceErrorCode;

  public constructor(code: JobQueueServiceErrorCode, message: string) {
    super(message);
    this.name = 'JobQueueServiceError';
    this.code = code;
  }
}

export interface JobQueueServiceOptions {
  readonly allowedJobTypes?: readonly string[];
  readonly backoffPolicy?: BackoffPolicy;
  readonly clock?: QueueClock;
  readonly idFactory?: () => string;
  readonly leaseDurationMilliseconds?: number;
  readonly payloadValidator?: JobPayloadValidator;
}

function parseJson(json: string): JsonValue {
  return JSON.parse(json) as JsonValue;
}

function toJob(stored: StoredJob): Job {
  return {
    attemptCount: stored.attempt_count,
    cancelRequestedAt: stored.cancel_requested_at,
    createdAt: stored.created_at,
    finishedAt: stored.finished_at,
    id: stored.id,
    idempotencyKey: stored.idempotency_key,
    jobType: stored.job_type,
    lastError: stored.last_error,
    lastErrorCode: stored.last_error_code,
    lastHeartbeatAt: stored.last_heartbeat_at,
    leaseExpiresAt: stored.lease_expires_at,
    leaseToken: stored.lease_token,
    lockOwner: stored.lock_owner,
    maxAttempts: stored.max_attempts,
    nextRunAt: stored.next_run_at,
    pauseRequestedAt: stored.pause_requested_at,
    payload: parseJson(stored.payload_json),
    payloadHash: stored.payload_hash,
    priority: stored.priority,
    result: stored.result_json === null ? null : parseJson(stored.result_json),
    revision: stored.revision,
    startedAt: stored.started_at,
    status: stored.status,
    updatedAt: stored.updated_at,
  };
}

function isoDate(date: Date, name: string): string {
  if (!Number.isFinite(date.getTime())) {
    throw new JobQueueServiceError('INVALID_ARGUMENT', `${name} must be a valid date.`);
  }
  return date.toISOString();
}

function assertPositiveInteger(value: number, name: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new JobQueueServiceError(
      'INVALID_ARGUMENT',
      `${name} must be an integer from 1 through ${maximum}.`,
    );
  }
}

function assertIdentifier(value: string, name: string, maximum: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maximum) {
    throw new JobQueueServiceError(
      'INVALID_ARGUMENT',
      `${name} must contain 1 to ${maximum} characters.`,
    );
  }
  return trimmed;
}

export class JobQueueService {
  readonly #allowedJobTypes: readonly string[] | undefined;
  readonly #backoffPolicy: BackoffPolicy;
  readonly #clock: QueueClock;
  readonly #idFactory: () => string;
  readonly #leaseDurationMilliseconds: number;
  readonly #payloadValidator: JobPayloadValidator;
  readonly #registry: JobHandlerRegistry;
  readonly #repository: JobQueueRepository;

  public constructor(
    repository: JobQueueRepository,
    registry: JobHandlerRegistry,
    options: JobQueueServiceOptions = {},
  ) {
    this.#repository = repository;
    this.#registry = registry;
    this.#allowedJobTypes =
      options.allowedJobTypes === undefined
        ? undefined
        : Object.freeze(
            options.allowedJobTypes.map((jobType) =>
              assertIdentifier(jobType, 'allowedJobTypes[]', 128),
            ),
          );
    this.#clock = options.clock ?? new SystemQueueClock();
    this.#backoffPolicy = options.backoffPolicy ?? new ExponentialBackoffPolicy();
    this.#payloadValidator = options.payloadValidator ?? new JobPayloadValidator();
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#leaseDurationMilliseconds = options.leaseDurationMilliseconds ?? 30_000;
    assertPositiveInteger(this.#leaseDurationMilliseconds, 'leaseDurationMilliseconds', 86_400_000);
  }

  public enqueueJob(input: EnqueueJobInput): Job {
    const jobType = assertIdentifier(input.jobType, 'jobType', 128);
    if (!this.#registry.has(jobType)) {
      throw new JobQueueServiceError(
        'JOB_TYPE_NOT_REGISTERED',
        `No local handler is registered for job type ${jobType}.`,
      );
    }
    assertSafeIdempotencyKey(input.idempotencyKey);
    assertPositiveInteger(input.maxAttempts, 'maxAttempts', 10_000);
    if (!Number.isSafeInteger(input.priority) || input.priority < -1000 || input.priority > 1000) {
      throw new JobQueueServiceError(
        'INVALID_ARGUMENT',
        'priority must be an integer from -1000 through 1000.',
      );
    }

    const validatedPayload = this.#payloadValidator.validate(input.payload);
    const now = this.#clock.now();
    const result = this.#repository.enqueue({
      id: this.#idFactory(),
      idempotencyKey: input.idempotencyKey.trim(),
      jobType,
      maxAttempts: input.maxAttempts,
      nextRunAt: isoDate(input.availableAt ?? now, 'availableAt'),
      now: isoDate(now, 'clock.now()'),
      payloadHash: validatedPayload.hash,
      payloadJson: validatedPayload.json,
      priority: input.priority,
    });
    return toJob(result.job);
  }

  public claimNextJob(workerId: string, options: ClaimNextJobOptions = {}): Job | null {
    const normalizedWorkerId = assertIdentifier(workerId, 'workerId', 256);
    const duration = options.leaseDurationMilliseconds ?? this.#leaseDurationMilliseconds;
    assertPositiveInteger(duration, 'leaseDurationMilliseconds', 86_400_000);
    const now = this.#clock.now();
    const job = this.#repository.claimNext({
      ...(this.#allowedJobTypes === undefined ? {} : { allowedJobTypes: this.#allowedJobTypes }),
      leaseExpiresAt: new Date(now.getTime() + duration).toISOString(),
      leaseToken: this.#idFactory(),
      now: isoDate(now, 'clock.now()'),
      workerId: normalizedWorkerId,
    });
    return job === null ? null : toJob(job);
  }

  public heartbeat(
    jobId: string,
    workerId: string,
    leaseToken: string,
    options: ClaimNextJobOptions = {},
  ): QueueControlSignal {
    const duration = options.leaseDurationMilliseconds ?? this.#leaseDurationMilliseconds;
    assertPositiveInteger(duration, 'leaseDurationMilliseconds', 86_400_000);
    const now = this.#clock.now();
    return this.#repository.heartbeat({
      jobId: assertIdentifier(jobId, 'jobId', 512),
      leaseExpiresAt: new Date(now.getTime() + duration).toISOString(),
      leaseToken: assertIdentifier(leaseToken, 'leaseToken', 256),
      now: isoDate(now, 'clock.now()'),
      workerId: assertIdentifier(workerId, 'workerId', 256),
    }).control;
  }

  public completeJob(jobId: string, workerId: string, leaseToken: string, result?: unknown): Job {
    const validatedResult =
      result === undefined ? null : this.#payloadValidator.validate(result).json;
    const now = isoDate(this.#clock.now(), 'clock.now()');
    return toJob(
      this.#repository.complete({
        jobId: assertIdentifier(jobId, 'jobId', 512),
        leaseToken: assertIdentifier(leaseToken, 'leaseToken', 256),
        now,
        resultJson: validatedResult,
        workerId: assertIdentifier(workerId, 'workerId', 256),
      }),
    );
  }

  public failJob(jobId: string, workerId: string, leaseToken: string, error: unknown): Job {
    const current = this.getJob(jobId);
    if (current === null) {
      throw new JobQueueRepositoryError('JOB_NOT_FOUND', `Job ${jobId} was not found.`);
    }

    const now = this.#clock.now();
    const safeError = sanitizeJobError(error);
    const delay = this.#backoffPolicy.delayMilliseconds(current.attemptCount);
    return toJob(
      this.#repository.fail({
        errorCode: safeError.code,
        errorSummary: safeError.summary,
        jobId: assertIdentifier(jobId, 'jobId', 512),
        leaseToken: assertIdentifier(leaseToken, 'leaseToken', 256),
        now: isoDate(now, 'clock.now()'),
        retryAt: new Date(now.getTime() + delay).toISOString(),
        workerId: assertIdentifier(workerId, 'workerId', 256),
      }),
    );
  }

  public requestPause(jobId: string): Job {
    return toJob(
      this.#repository.requestPause(
        assertIdentifier(jobId, 'jobId', 512),
        isoDate(this.#clock.now(), 'clock.now()'),
      ),
    );
  }

  public acknowledgePause(jobId: string, workerId: string, leaseToken: string): Job {
    return toJob(
      this.#repository.acknowledgePause({
        jobId: assertIdentifier(jobId, 'jobId', 512),
        leaseToken: assertIdentifier(leaseToken, 'leaseToken', 256),
        now: isoDate(this.#clock.now(), 'clock.now()'),
        workerId: assertIdentifier(workerId, 'workerId', 256),
      }),
    );
  }

  public resumeJob(jobId: string): Job {
    return toJob(
      this.#repository.resume(
        assertIdentifier(jobId, 'jobId', 512),
        isoDate(this.#clock.now(), 'clock.now()'),
      ),
    );
  }

  public requestCancel(jobId: string): Job {
    return toJob(
      this.#repository.requestCancel(
        assertIdentifier(jobId, 'jobId', 512),
        isoDate(this.#clock.now(), 'clock.now()'),
      ),
    );
  }

  public acknowledgeCancel(jobId: string, workerId: string, leaseToken: string): Job {
    return toJob(
      this.#repository.acknowledgeCancel({
        jobId: assertIdentifier(jobId, 'jobId', 512),
        leaseToken: assertIdentifier(leaseToken, 'leaseToken', 256),
        now: isoDate(this.#clock.now(), 'clock.now()'),
        workerId: assertIdentifier(workerId, 'workerId', 256),
      }),
    );
  }

  public retryFailedJob(jobId: string, options: RetryFailedJobOptions): Job {
    assertPositiveInteger(options.additionalAttempts, 'additionalAttempts', 10_000);
    const now = this.#clock.now();
    return toJob(
      this.#repository.retryFailed(
        assertIdentifier(jobId, 'jobId', 512),
        options.additionalAttempts,
        isoDate(options.availableAt ?? now, 'availableAt'),
        isoDate(now, 'clock.now()'),
      ),
    );
  }

  public recoverExpiredLeases(limit = 100): readonly Job[] {
    assertPositiveInteger(limit, 'limit', 1000);
    return this.#repository
      .recoverExpired(isoDate(this.#clock.now(), 'clock.now()'), limit)
      .map(toJob);
  }

  public getJob(jobId: string): Job | null {
    const job = this.#repository.get(assertIdentifier(jobId, 'jobId', 512));
    return job === null ? null : toJob(job);
  }

  public listJobs(filter: ListJobsFilter, pagination: JobPagination): readonly Job[] {
    assertPositiveInteger(pagination.limit, 'pagination.limit', 100);
    const offset = pagination.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new JobQueueServiceError(
        'INVALID_ARGUMENT',
        'pagination.offset must be a non-negative safe integer.',
      );
    }
    if (filter.status !== undefined && !JOB_STATUSES.includes(filter.status)) {
      throw new JobQueueServiceError(
        'INVALID_ARGUMENT',
        `Unknown queue status: ${String(filter.status)}.`,
      );
    }

    return this.#repository
      .list({
        ...(filter.createdFrom === undefined
          ? {}
          : { createdFrom: isoDate(filter.createdFrom, 'createdFrom') }),
        ...(filter.createdTo === undefined
          ? {}
          : { createdTo: isoDate(filter.createdTo, 'createdTo') }),
        ...(filter.jobType === undefined
          ? {}
          : { jobType: assertIdentifier(filter.jobType, 'jobType', 128) }),
        limit: pagination.limit,
        ...(filter.nextRunFrom === undefined
          ? {}
          : { nextRunFrom: isoDate(filter.nextRunFrom, 'nextRunFrom') }),
        ...(filter.nextRunTo === undefined
          ? {}
          : { nextRunTo: isoDate(filter.nextRunTo, 'nextRunTo') }),
        offset,
        ...(filter.status === undefined ? {} : { status: filter.status }),
      })
      .map(toJob);
  }

  public getQueueStats(): QueueStats {
    return this.#repository.stats();
  }
}
