import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_DESIGN_STATES,
  transitionExperimentState,
} from '@mystery-operations/experiments';

describe('M3 Issue 023 design state machine', () => {
  it('supports draft validation, assignment readiness, lock, hold, resume, archive, and restore', () => {
    expect(transitionExperimentState('DRAFT', 'VALIDATE', false).result.to).toBe('VALIDATED');
    expect(transitionExperimentState('DRAFT', 'VALIDATE', true).result.to).toBe('ASSIGNMENT_READY');
    expect(transitionExperimentState('ASSIGNMENT_READY', 'LOCK', true).result.to).toBe('LOCKED');
    expect(transitionExperimentState('LOCKED', 'HOLD', true).result.to).toBe('HELD');
    expect(transitionExperimentState('HELD', 'RESUME', true, 'LOCKED').result.to).toBe('LOCKED');
    expect(transitionExperimentState('LOCKED', 'ARCHIVE', true).result.to).toBe('ARCHIVED');
    expect(transitionExperimentState('ARCHIVED', 'RESTORE', false).result.to).toBe('DRAFT');
  });

  it('blocks lock without a ready assignment and blocks execution-like states', () => {
    expect(() => transitionExperimentState('VALIDATED', 'LOCK', false)).toThrow(
      /EXPERIMENT_POLICY_BLOCKED/iu,
    );
    expect(EXPERIMENT_DESIGN_STATES).not.toEqual(
      expect.arrayContaining(['RUNNING', 'COMPLETED', 'WINNER']),
    );
  });

  it('clones any non-superseded version to a draft without implying execution', () => {
    expect(transitionExperimentState('LOCKED', 'CLONE_VERSION', true).result).toEqual({
      from: 'LOCKED',
      to: 'DRAFT',
    });
    expect(() => transitionExperimentState('SUPERSEDED', 'CLONE_VERSION', true)).toThrow(
      /EXPERIMENT_POLICY_BLOCKED/iu,
    );
  });
});
