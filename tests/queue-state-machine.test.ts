import { describe, expect, it } from 'vitest';

import {
  JOB_STATUSES,
  JobStatus,
  InvalidJobStatusTransitionError,
  allowedJobStatusTransitions,
  canTransitionJobStatus,
  isTerminalJobStatus,
  transitionJobStatus,
} from '../packages/core/src/index.js';

describe('persistent queue state machine', () => {
  it('defines exactly the nine frozen queue statuses', () => {
    expect(JOB_STATUSES).toEqual([
      'QUEUED',
      'RUNNING',
      'PAUSE_REQUESTED',
      'PAUSED',
      'CANCEL_REQUESTED',
      'RETRY_WAIT',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ]);
    expect(Object.isFrozen(JOB_STATUSES)).toBe(true);
  });

  it.each([
    [JobStatus.QUEUED, JobStatus.RUNNING],
    [JobStatus.QUEUED, JobStatus.PAUSED],
    [JobStatus.QUEUED, JobStatus.CANCELLED],
    [JobStatus.RUNNING, JobStatus.SUCCEEDED],
    [JobStatus.RUNNING, JobStatus.RETRY_WAIT],
    [JobStatus.RUNNING, JobStatus.FAILED],
    [JobStatus.RUNNING, JobStatus.PAUSE_REQUESTED],
    [JobStatus.RUNNING, JobStatus.CANCEL_REQUESTED],
    [JobStatus.PAUSE_REQUESTED, JobStatus.PAUSED],
    [JobStatus.PAUSED, JobStatus.QUEUED],
    [JobStatus.PAUSED, JobStatus.CANCELLED],
    [JobStatus.CANCEL_REQUESTED, JobStatus.CANCELLED],
    [JobStatus.RETRY_WAIT, JobStatus.RUNNING],
    [JobStatus.RETRY_WAIT, JobStatus.PAUSED],
    [JobStatus.RETRY_WAIT, JobStatus.CANCELLED],
    [JobStatus.FAILED, JobStatus.QUEUED],
  ])('allows the explicit transition %s -> %s', (from, to) => {
    expect(canTransitionJobStatus(from, to)).toBe(true);
    expect(transitionJobStatus(from, to)).toBe(to);
  });

  it.each([JobStatus.SUCCEEDED, JobStatus.CANCELLED])(
    'rejects manual retry from terminal status %s',
    (status) => {
      expect(allowedJobStatusTransitions(status)).toEqual([]);
      expect(() => transitionJobStatus(status, JobStatus.QUEUED)).toThrow(
        InvalidJobStatusTransitionError,
      );
    },
  );

  it('marks only succeeded, failed, and cancelled as terminal', () => {
    expect(JOB_STATUSES.filter(isTerminalJobStatus)).toEqual([
      JobStatus.SUCCEEDED,
      JobStatus.FAILED,
      JobStatus.CANCELLED,
    ]);
  });

  it('rejects unlisted transitions with source and target context', () => {
    expect(() => transitionJobStatus(JobStatus.PAUSED, JobStatus.SUCCEEDED)).toThrow(
      expect.objectContaining({
        from: JobStatus.PAUSED,
        to: JobStatus.SUCCEEDED,
      }),
    );
  });
});
