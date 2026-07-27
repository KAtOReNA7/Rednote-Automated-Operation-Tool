export enum JobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  PAUSE_REQUESTED = 'PAUSE_REQUESTED',
  PAUSED = 'PAUSED',
  CANCEL_REQUESTED = 'CANCEL_REQUESTED',
  RETRY_WAIT = 'RETRY_WAIT',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export const JOB_STATUSES = Object.freeze(Object.values(JobStatus));

export const TERMINAL_JOB_STATUSES = Object.freeze([
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
] as const);

const JOB_STATUS_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  [JobStatus.QUEUED]: [JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLED],
  [JobStatus.RUNNING]: [
    JobStatus.SUCCEEDED,
    JobStatus.RETRY_WAIT,
    JobStatus.FAILED,
    JobStatus.PAUSE_REQUESTED,
    JobStatus.CANCEL_REQUESTED,
  ],
  [JobStatus.PAUSE_REQUESTED]: [JobStatus.PAUSED],
  [JobStatus.PAUSED]: [JobStatus.QUEUED, JobStatus.CANCELLED],
  [JobStatus.CANCEL_REQUESTED]: [JobStatus.CANCELLED],
  [JobStatus.RETRY_WAIT]: [JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLED],
  [JobStatus.SUCCEEDED]: [],
  [JobStatus.FAILED]: [JobStatus.QUEUED],
  [JobStatus.CANCELLED]: [],
};

export class InvalidJobStatusTransitionError extends Error {
  public readonly from: JobStatus;
  public readonly to: JobStatus;

  public constructor(from: JobStatus, to: JobStatus) {
    super(`Invalid job status transition: ${from} -> ${to}`);
    this.name = 'InvalidJobStatusTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function allowedJobStatusTransitions(from: JobStatus): readonly JobStatus[] {
  return JOB_STATUS_TRANSITIONS[from];
}

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

export function transitionJobStatus(from: JobStatus, to: JobStatus): JobStatus {
  if (!canTransitionJobStatus(from, to)) {
    throw new InvalidJobStatusTransitionError(from, to);
  }

  return to;
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status as (typeof TERMINAL_JOB_STATUSES)[number]);
}
