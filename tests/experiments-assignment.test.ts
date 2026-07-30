import { describe, expect, it } from 'vitest';

import {
  countAssignmentStrata,
  solveExperimentAssignment,
  type ExperimentTopicInput,
} from '@mystery-operations/experiments';

import { experimentDraft, experimentTopics } from './support/experiment-fixtures.js';

describe('M3 Issue 023 deterministic assignment', () => {
  it('balances two arms across four explicit popularity strata deterministically', () => {
    const draft = experimentDraft();
    const topics = experimentTopics(draft);
    const first = solveExperimentAssignment({ design: draft, topics });
    const second = solveExperimentAssignment({ design: draft, topics: [...topics].reverse() });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      armCounts: { control: 4, treatment: 4 },
      assignmentHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      distinctWorkCount: 8,
      shortfallByArm: { control: 0, treatment: 0 },
      status: 'READY_TO_LOCK',
    });
    expect(first.units).toHaveLength(8);
    expect(new Set(first.units.map((unit) => unit.topicId)).size).toBe(8);
    expect(new Set(first.units.map((unit) => unit.workId)).size).toBe(8);
    expect(countAssignmentStrata(first.units)).toEqual({ COLD: 2, HOT: 2, UNKNOWN: 2, WARM: 2 });
  });

  it('returns insufficient replication for fewer than three canonical works', () => {
    const draft = experimentDraft(2);
    expect(
      solveExperimentAssignment({ design: draft, topics: experimentTopics(draft) }),
    ).toMatchObject({
      distinctWorkCount: 2,
      status: 'INSUFFICIENT_REPLICATION',
    });
  });

  it('returns arm shortfall without duplicating topics', () => {
    const base = experimentDraft(3);
    const draft = {
      ...base,
      samplePlan: {
        ...base.samplePlan,
        armTargetCounts: { control: 2, treatment: 2 },
      },
    };
    const result = solveExperimentAssignment({ design: draft, topics: experimentTopics(draft) });
    expect(result.status).toBe('INSUFFICIENT_SAMPLE');
    expect(Object.values(result.shortfallByArm).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(new Set(result.units.map((unit) => unit.topicId)).size).toBe(result.units.length);
  });

  it('fails closed for stale, ineligible, held, archived, or mismatched topics', () => {
    const draft = experimentDraft();
    const topics = experimentTopics(draft);
    const patches: ReadonlyArray<Partial<ExperimentTopicInput>> = [
      { current: false },
      { eligibility: 'STALE' },
      { state: 'HELD' },
      { state: 'ARCHIVED' },
      { workId: 'edition-disguised-as-work' },
      { structureFingerprint: '0'.repeat(64) },
    ];
    for (const patch of patches) {
      expect(() =>
        solveExperimentAssignment({
          design: draft,
          topics: topics.map((topic, index) => (index === 0 ? { ...topic, ...patch } : topic)),
        }),
      ).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
    }
  });

  it('does not expose result, significance, winner, or power fields', () => {
    const result = solveExperimentAssignment({
      design: experimentDraft(),
      topics: experimentTopics(),
    });
    expect(result).not.toHaveProperty('effect');
    expect(result).not.toHaveProperty('pValue');
    expect(result).not.toHaveProperty('power');
    expect(result).not.toHaveProperty('winner');
  });
});
