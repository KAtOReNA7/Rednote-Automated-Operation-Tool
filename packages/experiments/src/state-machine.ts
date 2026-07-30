import {
  EXPERIMENT_STATE_POLICY_VERSION,
  type ExperimentAction,
  type ExperimentDesignState,
} from './constants.js';
import { type ExperimentStateTransitionResult } from './contracts.js';
import { ExperimentError } from './errors.js';

export interface ExperimentTransition {
  readonly policyVersion: typeof EXPERIMENT_STATE_POLICY_VERSION;
  readonly result: ExperimentStateTransitionResult;
}

export function transitionExperimentState(
  current: ExperimentDesignState,
  action: ExperimentAction,
  assignmentReady: boolean,
  resumeTarget: ExperimentDesignState | null = null,
): ExperimentTransition {
  let next: ExperimentDesignState | null = null;
  switch (action) {
    case 'VALIDATE':
      if (current === 'DRAFT' || current === 'VALIDATED' || current === 'STALE') {
        next = assignmentReady ? 'ASSIGNMENT_READY' : 'VALIDATED';
      }
      break;
    case 'LOCK':
      if (current === 'ASSIGNMENT_READY' && assignmentReady) next = 'LOCKED';
      break;
    case 'HOLD':
      if (
        current === 'DRAFT' ||
        current === 'VALIDATED' ||
        current === 'ASSIGNMENT_READY' ||
        current === 'LOCKED'
      ) {
        next = 'HELD';
      }
      break;
    case 'RESUME':
      if (current === 'HELD') next = resumeTarget ?? 'DRAFT';
      break;
    case 'ARCHIVE':
      if (current !== 'ARCHIVED' && current !== 'SUPERSEDED') next = 'ARCHIVED';
      break;
    case 'RESTORE':
      if (current === 'ARCHIVED') next = 'DRAFT';
      break;
    case 'CLONE_VERSION':
      if (current !== 'SUPERSEDED') next = 'DRAFT';
      break;
  }
  if (next === null) throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  return Object.freeze({
    policyVersion: EXPERIMENT_STATE_POLICY_VERSION,
    result: Object.freeze({ from: current, to: next }),
  });
}
