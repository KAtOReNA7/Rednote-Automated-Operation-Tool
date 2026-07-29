import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

import { JOB_STATUSES, JobStatus, transitionJobStatus } from '@mystery-operations/core';

import { runInTransaction } from './transaction.js';

const JOB_COLUMNS = `
  id,
  job_type,
  idempotency_key,
  payload_json,
  payload_hash,
  priority,
  status,
  attempt_count,
  max_attempts,
  next_run_at,
  lock_owner,
  lease_token,
  lease_expires_at,
  last_heartbeat_at,
  pause_requested_at,
  cancel_requested_at,
  started_at,
  finished_at,
  last_error_code,
  last_error,
  result_json,
  created_at,
  updated_at,
  revision
`;

export interface StoredJob {
  readonly attempt_count: number;
  readonly cancel_requested_at: string | null;
  readonly created_at: string;
  readonly finished_at: string | null;
  readonly id: string;
  readonly idempotency_key: string;
  readonly job_type: string;
  readonly last_error: string | null;
  readonly last_error_code: string | null;
  readonly last_heartbeat_at: string | null;
  readonly lease_expires_at: string | null;
  readonly lease_token: string | null;
  readonly lock_owner: string | null;
  readonly max_attempts: number;
  readonly next_run_at: string;
  readonly pause_requested_at: string | null;
  readonly payload_hash: string;
  readonly payload_json: string;
  readonly priority: number;
  readonly result_json: string | null;
  readonly revision: number;
  readonly started_at: string | null;
  readonly status: JobStatus;
  readonly updated_at: string;
}

export interface EnqueueStoredJobInput {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly jobType: string;
  readonly maxAttempts: number;
  readonly nextRunAt: string;
  readonly now: string;
  readonly payloadHash: string;
  readonly payloadJson: string;
  readonly priority: number;
}

export interface ClaimStoredJobInput {
  readonly allowedJobTypes?: readonly string[];
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly workerId: string;
}

export interface LeaseOperationInput {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly workerId: string;
}

export interface ListStoredJobsInput {
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly jobType?: string;
  readonly limit: number;
  readonly nextRunFrom?: string;
  readonly nextRunTo?: string;
  readonly offset: number;
  readonly status?: JobStatus;
}

export interface QueueStats {
  readonly byStatus: Readonly<Record<JobStatus, number>>;
  readonly total: number;
}

export type JobRepositoryErrorCode =
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_JOB_STATE'
  | 'JOB_ALREADY_COMPLETED'
  | 'JOB_NOT_FOUND'
  | 'LEASE_CONFLICT'
  | 'LEASE_EXPIRED';

export class JobQueueRepositoryError extends Error {
  public readonly code: JobRepositoryErrorCode;

  public constructor(code: JobRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'JobQueueRepositoryError';
    this.code = code;
  }
}

function rowAsJob(row: unknown): StoredJob {
  return row as StoredJob;
}

function controlSignal(status: JobStatus): 'CANCEL' | 'CONTINUE' | 'PAUSE' {
  if (status === JobStatus.PAUSE_REQUESTED) {
    return 'PAUSE';
  }
  if (status === JobStatus.CANCEL_REQUESTED) {
    return 'CANCEL';
  }
  return 'CONTINUE';
}

export class JobQueueRepository {
  readonly #database: DatabaseSync;
  readonly #findByIdempotencyKeyStatement: StatementSync;
  readonly #getByIdStatement: StatementSync;
  readonly #insertAuditStatement: StatementSync;
  readonly #insertJobStatement: StatementSync;

  public constructor(database: DatabaseSync) {
    this.#database = database;
    this.#findByIdempotencyKeyStatement = database.prepare(
      `SELECT ${JOB_COLUMNS} FROM jobs WHERE idempotency_key = ?`,
    );
    this.#getByIdStatement = database.prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`);
    this.#insertAuditStatement = database.prepare(
      `INSERT INTO audit_events(
         id, event_type, entity_type, entity_id, actor, before_json, after_json,
         created_at
       ) VALUES (?, ?, 'JOB', ?, ?, ?, ?, ?)`,
    );
    this.#insertJobStatement = database.prepare(
      `INSERT INTO jobs(
         id, job_type, idempotency_key, payload_json, payload_hash, priority,
         status, attempt_count, max_attempts, next_run_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?, ?, ?)`,
    );
  }

  public enqueue(input: EnqueueStoredJobInput): {
    readonly created: boolean;
    readonly job: StoredJob;
  } {
    return runInTransaction(this.#database, () => {
      const existing = this.#findByIdempotencyKey(input.idempotencyKey);

      if (existing !== null) {
        if (existing.job_type !== input.jobType || existing.payload_hash !== input.payloadHash) {
          throw new JobQueueRepositoryError(
            'IDEMPOTENCY_CONFLICT',
            `Idempotency key ${input.idempotencyKey} is already bound to different work.`,
          );
        }

        return { created: false, job: existing };
      }

      this.#insertJobStatement.run(
        input.id,
        input.jobType,
        input.idempotencyKey,
        input.payloadJson,
        input.payloadHash,
        input.priority,
        input.maxAttempts,
        input.nextRunAt,
        input.now,
        input.now,
      );
      this.#writeAudit(input.id, 'ENQUEUED', 'CALLER', null, JobStatus.QUEUED, input.now);

      return { created: true, job: this.#getRequired(input.id) };
    });
  }

  public claimNext(input: ClaimStoredJobInput): StoredJob | null {
    return runInTransaction(this.#database, () => {
      if (input.allowedJobTypes !== undefined && input.allowedJobTypes.length === 0) {
        return null;
      }
      const typeFilter =
        input.allowedJobTypes === undefined
          ? ''
          : `AND job_type IN (${input.allowedJobTypes.map(() => '?').join(',')})`;
      const candidate = this.#database
        .prepare(
          `SELECT ${JOB_COLUMNS}
           FROM jobs
           WHERE status IN ('QUEUED', 'RETRY_WAIT')
             AND next_run_at <= ?
             AND attempt_count < max_attempts
             ${typeFilter}
           ORDER BY priority DESC, next_run_at ASC, created_at ASC, id ASC
           LIMIT 1`,
        )
        .get(input.now, ...(input.allowedJobTypes ?? []));

      if (candidate === undefined) {
        return null;
      }

      const current = rowAsJob(candidate);
      transitionJobStatus(current.status, JobStatus.RUNNING);
      const update = this.#database
        .prepare(
          `UPDATE jobs
           SET status = 'RUNNING',
               attempt_count = attempt_count + 1,
               lock_owner = ?,
               lease_token = ?,
               lease_expires_at = ?,
               last_heartbeat_at = ?,
               started_at = coalesce(started_at, ?),
               updated_at = ?,
               revision = revision + 1
           WHERE id = ?
             AND revision = ?
             AND status = ?
             AND next_run_at <= ?
             AND attempt_count < max_attempts`,
        )
        .run(
          input.workerId,
          input.leaseToken,
          input.leaseExpiresAt,
          input.now,
          input.now,
          input.now,
          current.id,
          current.revision,
          current.status,
          input.now,
        );

      if (update.changes !== 1) {
        return null;
      }

      this.#writeAudit(
        current.id,
        'CLAIMED',
        input.workerId,
        current.status,
        JobStatus.RUNNING,
        input.now,
      );
      return this.#getRequired(current.id);
    });
  }

  public heartbeat(input: LeaseOperationInput & { readonly leaseExpiresAt: string }): {
    readonly control: 'CANCEL' | 'CONTINUE' | 'PAUSE';
    readonly job: StoredJob;
  } {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(input.jobId);
      this.#assertActiveLease(current, input, [
        JobStatus.RUNNING,
        JobStatus.PAUSE_REQUESTED,
        JobStatus.CANCEL_REQUESTED,
      ]);

      this.#database
        .prepare(
          `UPDATE jobs
           SET lease_expires_at = ?,
               last_heartbeat_at = ?,
               updated_at = ?,
               revision = revision + 1
           WHERE id = ? AND revision = ?`,
        )
        .run(input.leaseExpiresAt, input.now, input.now, current.id, current.revision);

      const updated = this.#getRequired(current.id);
      return { control: controlSignal(updated.status), job: updated };
    });
  }

  public complete(input: LeaseOperationInput & { readonly resultJson: string | null }): StoredJob {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(input.jobId);
      if (current.status === JobStatus.SUCCEEDED) {
        throw new JobQueueRepositoryError(
          'JOB_ALREADY_COMPLETED',
          `Job ${current.id} is already complete.`,
        );
      }
      this.#assertActiveLease(current, input, [JobStatus.RUNNING]);
      transitionJobStatus(current.status, JobStatus.SUCCEEDED);

      this.#database
        .prepare(
          `UPDATE jobs
           SET status = 'SUCCEEDED',
               result_json = ?,
               finished_at = ?,
               lock_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               last_heartbeat_at = NULL,
               updated_at = ?,
               revision = revision + 1
           WHERE id = ? AND revision = ?`,
        )
        .run(input.resultJson, input.now, input.now, current.id, current.revision);
      this.#writeAudit(
        current.id,
        'COMPLETED',
        input.workerId,
        current.status,
        JobStatus.SUCCEEDED,
        input.now,
      );
      return this.#getRequired(current.id);
    });
  }

  public fail(
    input: LeaseOperationInput & {
      readonly errorCode: string;
      readonly errorSummary: string;
      readonly retryAt: string;
    },
  ): StoredJob {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(input.jobId);
      this.#assertActiveLease(current, input, [JobStatus.RUNNING]);
      const nextStatus =
        current.attempt_count < current.max_attempts ? JobStatus.RETRY_WAIT : JobStatus.FAILED;
      transitionJobStatus(current.status, nextStatus);

      this.#database
        .prepare(
          `UPDATE jobs
           SET status = ?,
               next_run_at = ?,
               finished_at = ?,
               last_error_code = ?,
               last_error = ?,
               lock_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               last_heartbeat_at = NULL,
               updated_at = ?,
               revision = revision + 1
           WHERE id = ? AND revision = ?`,
        )
        .run(
          nextStatus,
          nextStatus === JobStatus.RETRY_WAIT ? input.retryAt : current.next_run_at,
          nextStatus === JobStatus.FAILED ? input.now : null,
          input.errorCode,
          input.errorSummary,
          input.now,
          current.id,
          current.revision,
        );
      this.#writeAudit(
        current.id,
        nextStatus === JobStatus.RETRY_WAIT ? 'RETRY_SCHEDULED' : 'FAILED',
        input.workerId,
        current.status,
        nextStatus,
        input.now,
      );
      return this.#getRequired(current.id);
    });
  }

  public requestPause(jobId: string, now: string): StoredJob {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(jobId);
      if (current.status === JobStatus.PAUSED || current.status === JobStatus.PAUSE_REQUESTED) {
        return current;
      }

      const nextStatus =
        current.status === JobStatus.RUNNING ? JobStatus.PAUSE_REQUESTED : JobStatus.PAUSED;
      transitionJobStatus(current.status, nextStatus);
      this.#database
        .prepare(
          `UPDATE jobs
           SET status = ?,
               pause_requested_at = ?,
               updated_at = ?,
               revision = revision + 1
           WHERE id = ? AND revision = ?`,
        )
        .run(nextStatus, now, now, current.id, current.revision);
      this.#writeAudit(
        current.id,
        nextStatus === JobStatus.PAUSED ? 'PAUSED' : 'PAUSE_REQUESTED',
        'USER',
        current.status,
        nextStatus,
        now,
      );
      return this.#getRequired(current.id);
    });
  }

  public acknowledgePause(input: LeaseOperationInput): StoredJob {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(input.jobId);
      this.#assertActiveLease(current, input, [JobStatus.PAUSE_REQUESTED]);
      transitionJobStatus(current.status, JobStatus.PAUSED);
      this.#setNonRunningStatus(current, JobStatus.PAUSED, input.now);
      this.#writeAudit(
        current.id,
        'PAUSED',
        input.workerId,
        current.status,
        JobStatus.PAUSED,
        input.now,
      );
      return this.#getRequired(current.id);
    });
  }

  public resume(jobId: string, now: string): StoredJob {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(jobId);
      transitionJobStatus(current.status, JobStatus.QUEUED);
      this.#database
        .prepare(
          `UPDATE jobs
           SET status = 'QUEUED',
               next_run_at = ?,
               pause_requested_at = NULL,
               updated_at = ?,
               revision = revision + 1
           WHERE id = ? AND revision = ?`,
        )
        .run(now, now, current.id, current.revision);
      this.#writeAudit(current.id, 'RESUMED', 'USER', current.status, JobStatus.QUEUED, now);
      return this.#getRequired(current.id);
    });
  }

  public requestCancel(jobId: string, now: string): StoredJob {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(jobId);
      if (current.status === JobStatus.CANCELLED || current.status === JobStatus.CANCEL_REQUESTED) {
        return current;
      }

      const nextStatus =
        current.status === JobStatus.RUNNING ? JobStatus.CANCEL_REQUESTED : JobStatus.CANCELLED;
      transitionJobStatus(current.status, nextStatus);

      if (nextStatus === JobStatus.CANCELLED) {
        this.#setNonRunningStatus(current, nextStatus, now, true, true);
      } else {
        this.#database
          .prepare(
            `UPDATE jobs
             SET status = 'CANCEL_REQUESTED',
                 cancel_requested_at = ?,
                 updated_at = ?,
                 revision = revision + 1
             WHERE id = ? AND revision = ?`,
          )
          .run(now, now, current.id, current.revision);
      }

      this.#writeAudit(
        current.id,
        nextStatus === JobStatus.CANCELLED ? 'CANCELLED' : 'CANCEL_REQUESTED',
        'USER',
        current.status,
        nextStatus,
        now,
      );
      return this.#getRequired(current.id);
    });
  }

  public acknowledgeCancel(input: LeaseOperationInput): StoredJob {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(input.jobId);
      this.#assertActiveLease(current, input, [JobStatus.CANCEL_REQUESTED]);
      transitionJobStatus(current.status, JobStatus.CANCELLED);
      this.#setNonRunningStatus(current, JobStatus.CANCELLED, input.now, true);
      this.#writeAudit(
        current.id,
        'CANCELLED',
        input.workerId,
        current.status,
        JobStatus.CANCELLED,
        input.now,
      );
      return this.#getRequired(current.id);
    });
  }

  public retryFailed(
    jobId: string,
    additionalAttempts: number,
    nextRunAt: string,
    now: string,
  ): StoredJob {
    return runInTransaction(this.#database, () => {
      const current = this.#getRequired(jobId);
      transitionJobStatus(current.status, JobStatus.QUEUED);
      const maxAttempts = current.attempt_count + additionalAttempts;

      this.#database
        .prepare(
          `UPDATE jobs
           SET status = 'QUEUED',
               max_attempts = ?,
               next_run_at = ?,
               finished_at = NULL,
               last_error_code = NULL,
               last_error = NULL,
               result_json = NULL,
               updated_at = ?,
               revision = revision + 1
           WHERE id = ? AND revision = ?`,
        )
        .run(maxAttempts, nextRunAt, now, current.id, current.revision);
      this.#writeAudit(current.id, 'MANUAL_RETRY', 'USER', current.status, JobStatus.QUEUED, now);
      return this.#getRequired(current.id);
    });
  }

  public recoverExpired(now: string, limit = 100): readonly StoredJob[] {
    return runInTransaction(this.#database, () => {
      const expired = this.#database
        .prepare(
          `SELECT ${JOB_COLUMNS}
           FROM jobs
           WHERE status IN ('RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED')
             AND lease_expires_at <= ?
           ORDER BY lease_expires_at ASC, id ASC
           LIMIT ?`,
        )
        .all(now, limit)
        .map(rowAsJob);
      const recovered: StoredJob[] = [];

      for (const current of expired) {
        let nextStatus: JobStatus;
        if (current.status === JobStatus.PAUSE_REQUESTED) {
          nextStatus = JobStatus.PAUSED;
        } else if (current.status === JobStatus.CANCEL_REQUESTED) {
          nextStatus = JobStatus.CANCELLED;
        } else {
          nextStatus =
            current.attempt_count < current.max_attempts ? JobStatus.RETRY_WAIT : JobStatus.FAILED;
        }
        transitionJobStatus(current.status, nextStatus);

        this.#database
          .prepare(
            `UPDATE jobs
             SET status = ?,
                 next_run_at = ?,
                 finished_at = ?,
                 last_error_code = ?,
                 last_error = ?,
                 lock_owner = NULL,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 last_heartbeat_at = NULL,
                 updated_at = ?,
                 revision = revision + 1
             WHERE id = ? AND revision = ? AND lease_expires_at <= ?`,
          )
          .run(
            nextStatus,
            nextStatus === JobStatus.RETRY_WAIT ? now : current.next_run_at,
            nextStatus === JobStatus.FAILED || nextStatus === JobStatus.CANCELLED ? now : null,
            nextStatus === JobStatus.FAILED ? 'LEASE_EXPIRED' : current.last_error_code,
            nextStatus === JobStatus.FAILED
              ? 'The final execution lease expired.'
              : current.last_error,
            now,
            current.id,
            current.revision,
            now,
          );
        this.#writeAudit(
          current.id,
          'LEASE_RECOVERED',
          'RECOVERY',
          current.status,
          nextStatus,
          now,
        );
        recovered.push(this.#getRequired(current.id));
      }

      return recovered;
    });
  }

  public get(jobId: string): StoredJob | null {
    const row = this.#getByIdStatement.get(jobId);
    return row === undefined ? null : rowAsJob(row);
  }

  public list(input: ListStoredJobsInput): readonly StoredJob[] {
    const conditions: string[] = [];
    const parameters: SQLInputValue[] = [];

    if (input.status !== undefined) {
      conditions.push('status = ?');
      parameters.push(input.status);
    }
    if (input.jobType !== undefined) {
      conditions.push('job_type = ?');
      parameters.push(input.jobType);
    }
    if (input.createdFrom !== undefined) {
      conditions.push('created_at >= ?');
      parameters.push(input.createdFrom);
    }
    if (input.createdTo !== undefined) {
      conditions.push('created_at <= ?');
      parameters.push(input.createdTo);
    }
    if (input.nextRunFrom !== undefined) {
      conditions.push('next_run_at >= ?');
      parameters.push(input.nextRunFrom);
    }
    if (input.nextRunTo !== undefined) {
      conditions.push('next_run_at <= ?');
      parameters.push(input.nextRunTo);
    }

    parameters.push(input.limit, input.offset);
    return this.#database
      .prepare(
        `SELECT ${JOB_COLUMNS}
         FROM jobs
         ${conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters)
      .map(rowAsJob);
  }

  public stats(): QueueStats {
    const byStatus = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<
      JobStatus,
      number
    >;
    const rows = this.#database
      .prepare('SELECT status, count(*) AS count FROM jobs GROUP BY status')
      .all() as unknown as readonly { readonly count: number; readonly status: JobStatus }[];

    for (const row of rows) {
      byStatus[row.status] = row.count;
    }

    return {
      byStatus,
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    };
  }

  #findByIdempotencyKey(idempotencyKey: string): StoredJob | null {
    const row = this.#findByIdempotencyKeyStatement.get(idempotencyKey);
    return row === undefined ? null : rowAsJob(row);
  }

  #getRequired(jobId: string): StoredJob {
    const job = this.get(jobId);
    if (job === null) {
      throw new JobQueueRepositoryError('JOB_NOT_FOUND', `Job ${jobId} was not found.`);
    }
    return job;
  }

  #assertActiveLease(
    job: StoredJob,
    input: LeaseOperationInput,
    allowedStatuses: readonly JobStatus[],
  ): void {
    if (!allowedStatuses.includes(job.status)) {
      throw new JobQueueRepositoryError(
        'INVALID_JOB_STATE',
        `Job ${job.id} cannot perform a leased operation from ${job.status}.`,
      );
    }
    if (job.lock_owner !== input.workerId || job.lease_token !== input.leaseToken) {
      throw new JobQueueRepositoryError(
        'LEASE_CONFLICT',
        `Worker ${input.workerId} does not own the current lease for job ${job.id}.`,
      );
    }
    if (job.lease_expires_at === null || job.lease_expires_at <= input.now) {
      throw new JobQueueRepositoryError(
        'LEASE_EXPIRED',
        `The lease for job ${job.id} has expired.`,
      );
    }
  }

  #setNonRunningStatus(
    current: StoredJob,
    status: JobStatus,
    now: string,
    terminal = false,
    recordCancellation = false,
  ): void {
    this.#database
      .prepare(
        `UPDATE jobs
         SET status = ?,
             finished_at = ?,
             cancel_requested_at = CASE WHEN ? = 1 THEN ? ELSE cancel_requested_at END,
             lock_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             last_heartbeat_at = NULL,
             updated_at = ?,
             revision = revision + 1
         WHERE id = ? AND revision = ?`,
      )
      .run(
        status,
        terminal ? now : null,
        recordCancellation ? 1 : 0,
        now,
        now,
        current.id,
        current.revision,
      );
  }

  #writeAudit(
    jobId: string,
    eventType: string,
    actor: string,
    beforeStatus: JobStatus | null,
    afterStatus: JobStatus,
    now: string,
  ): void {
    this.#insertAuditStatement.run(
      randomUUID(),
      eventType,
      jobId,
      actor,
      beforeStatus === null ? null : JSON.stringify({ status: beforeStatus }),
      JSON.stringify({ status: afterStatus }),
      now,
    );
  }
}
