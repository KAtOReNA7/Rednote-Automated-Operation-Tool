import type { JobStatus } from '@mystery-operations/core';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface Job {
  readonly attemptCount: number;
  readonly cancelRequestedAt: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly jobType: string;
  readonly lastError: string | null;
  readonly lastErrorCode: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly leaseExpiresAt: string | null;
  readonly leaseToken: string | null;
  readonly lockOwner: string | null;
  readonly maxAttempts: number;
  readonly nextRunAt: string;
  readonly pauseRequestedAt: string | null;
  readonly payload: JsonValue;
  readonly payloadHash: string;
  readonly priority: number;
  readonly result: JsonValue | null;
  readonly revision: number;
  readonly startedAt: string | null;
  readonly status: JobStatus;
  readonly updatedAt: string;
}

export interface EnqueueJobInput {
  readonly availableAt?: Date;
  readonly idempotencyKey: string;
  readonly jobType: string;
  readonly maxAttempts: number;
  readonly payload: unknown;
  readonly priority: number;
}

export interface ClaimNextJobOptions {
  readonly leaseDurationMilliseconds?: number;
}

export interface RetryFailedJobOptions {
  readonly additionalAttempts: number;
  readonly availableAt?: Date;
}

export interface ListJobsFilter {
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly jobType?: string;
  readonly nextRunFrom?: Date;
  readonly nextRunTo?: Date;
  readonly status?: JobStatus;
}

export interface JobPagination {
  readonly limit: number;
  readonly offset?: number;
}

export type QueueControlSignal = 'CANCEL' | 'CONTINUE' | 'PAUSE';
