import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_POPULARITY_POLICY_VERSION,
  validateExperimentDesign,
  validatePopularitySnapshot,
} from '@mystery-operations/experiments';

import { experimentDraft, popularitySnapshot } from './support/experiment-fixtures.js';

describe('M3 Issue 023 experiment policy', () => {
  it('validates one falsifiable primary variable without producing an effect conclusion', () => {
    expect(validateExperimentDesign(experimentDraft())).toMatchObject({
      designHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      futureBoundVariable: false,
      reasonCodes: ['DESIGN_VALID', 'NO_EFFECT_CONCLUSION'],
      replicationFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      valid: true,
    });
  });

  it('rejects vague hypotheses even when wrapped in an otherwise complete shape', () => {
    const draft = experimentDraft();
    expect(() =>
      validateExperimentDesign({
        ...draft,
        hypothesis: { ...draft.hypothesis, intervention: '更容易爆' },
      }),
    ).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
  });

  it('rejects multiple changed dimensions, missing control, duplicate values, and primary controls', () => {
    const draft = experimentDraft();
    const invalidDrafts = [
      {
        ...draft,
        primaryVariable: {
          ...draft.primaryVariable,
          arms: draft.primaryVariable.arms.map((arm) => ({
            ...arm,
            changedDimensions: ['CONTENT_STRUCTURE', 'TITLE_PATTERN'],
          })),
        },
      },
      {
        ...draft,
        primaryVariable: {
          ...draft.primaryVariable,
          arms: draft.primaryVariable.arms.map((arm) => ({ ...arm, role: 'TREATMENT' })),
        },
      },
      {
        ...draft,
        primaryVariable: {
          ...draft.primaryVariable,
          arms: draft.primaryVariable.arms.map((arm) => ({
            ...arm,
            valueIdentity: 'QUESTION_ANALYSIS_VERDICT',
          })),
        },
      },
      {
        ...draft,
        controlledConditions: [
          ...draft.controlledConditions,
          {
            availability: 'FIXED',
            kind: 'CONTENT_STRUCTURE',
            valueIdentity: 'QUESTION_ANALYSIS_VERDICT',
          },
        ],
      },
    ];
    for (const invalid of invalidDrafts) {
      expect(() => validateExperimentDesign(invalid)).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
    }
  });

  it('rejects guardrails that duplicate the primary metric', () => {
    const draft = experimentDraft();
    expect(() =>
      validateExperimentDesign({
        ...draft,
        guardrails: [
          {
            direction: 'NOT_DECREASE',
            metric: draft.primaryMetric,
            violationCondition: '未来主指标低于阈值',
          },
        ],
      }),
    ).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
  });

  it('distinguishes a missing rate denominator from zero and rejects mismatched units', () => {
    const draft = experimentDraft();
    expect(() =>
      validateExperimentDesign({
        ...draft,
        primaryMetric: { ...draft.primaryMetric, denominator: null },
      }),
    ).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
    expect(() =>
      validateExperimentDesign({
        ...draft,
        primaryMetric: { ...draft.primaryMetric, unit: 'COUNT' },
      }),
    ).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
    expect(() =>
      validateExperimentDesign({
        ...draft,
        primaryMetric: {
          ...draft.primaryMetric,
          zeroDenominatorPolicy: 'ZERO_IS_RESULT',
        },
      }),
    ).toThrow(/EXPERIMENT_INVALID_CONTRACT/iu);
  });

  it('marks title, cover, and publication-time variables as future-bound intent only', () => {
    const base = experimentDraft();
    for (const [kind, values] of [
      ['TITLE_PATTERN', ['FUTURE_QUESTION_LED', 'FUTURE_JUDGMENT_LED']],
      ['COVER_INFORMATION_DENSITY', ['FUTURE_SPARSE', 'FUTURE_BALANCED']],
      ['PUBLICATION_TIME_WINDOW', ['FUTURE_WEEKDAY_DAY', 'FUTURE_WEEKEND']],
    ] as const) {
      const draft = {
        ...base,
        controlledConditions: base.controlledConditions.filter(
          (condition) => condition.kind !== kind && condition.kind !== 'CONTENT_STRUCTURE',
        ),
        primaryVariable: {
          arms: base.primaryVariable.arms.map((arm, index) => ({
            ...arm,
            changedDimensions: [kind],
            valueIdentity: values[index],
          })),
          kind,
        },
      };
      expect(validateExperimentDesign(draft)).toMatchObject({
        futureBoundVariable: true,
        reasonCodes: expect.arrayContaining(['FUTURE_BOUND_INTENT_ONLY']),
      });
    }
  });

  it('requires provenance for known strata and exact unavailable semantics for UNKNOWN', () => {
    expect(() =>
      validatePopularitySnapshot({
        ...popularitySnapshot('known-work', 'HOT', 1),
        provenance: [],
      }),
    ).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
    expect(() =>
      validatePopularitySnapshot({
        ...popularitySnapshot('unknown-work', 'UNKNOWN', 2),
        metricReference: 'guessed-by-title',
      }),
    ).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
    expect(() =>
      validatePopularitySnapshot({
        ...popularitySnapshot('unknown-work', 'UNKNOWN', 3),
        policyVersion: `${EXPERIMENT_POPULARITY_POLICY_VERSION}-future`,
      }),
    ).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);
  });
});
