import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_DESIGN_STATES,
  EXPERIMENT_METRIC_AVAILABILITY,
  EXPERIMENT_METRIC_IDS,
  EXPERIMENT_POPULARITY_STRATA,
  EXPERIMENT_SAMPLE_PLAN_STATUSES,
  EXPERIMENT_VARIABLE_KINDS,
  assertExperimentDesignDraft,
  assertExperimentHypothesis,
  assertPopularitySnapshot,
} from '@mystery-operations/experiments';

import { experimentDraft, popularitySnapshot } from './support/experiment-fixtures.js';

describe('M3 Issue 023 experiment contracts', () => {
  it('freezes finite variable, metric, popularity, plan, and design registries', () => {
    expect(EXPERIMENT_VARIABLE_KINDS).toEqual([
      'CONTENT_STRUCTURE',
      'TITLE_PATTERN',
      'COVER_INFORMATION_DENSITY',
      'SPOILER_MODE',
      'COMPARISON_FORMAT',
      'PUBLICATION_TIME_WINDOW',
    ]);
    expect(EXPERIMENT_METRIC_IDS).toHaveLength(7);
    expect(EXPERIMENT_METRIC_AVAILABILITY).toEqual([
      'DEFINED_NOT_AVAILABLE',
      'AVAILABLE_FOR_FUTURE_COLLECTION',
      'UNSUPPORTED',
    ]);
    expect(EXPERIMENT_POPULARITY_STRATA).toEqual(['HOT', 'WARM', 'COLD', 'UNKNOWN']);
    expect(EXPERIMENT_SAMPLE_PLAN_STATUSES).toEqual([
      'DRAFT',
      'INSUFFICIENT_SAMPLE',
      'INSUFFICIENT_REPLICATION',
      'UNBALANCED',
      'READY_TO_LOCK',
      'STALE',
    ]);
    expect(EXPERIMENT_DESIGN_STATES).not.toEqual(
      expect.arrayContaining(['RUNNING', 'COMPLETED', 'WINNER']),
    );
  });

  it('accepts a bounded exact-object single-variable design', () => {
    expect(assertExperimentDesignDraft(experimentDraft())).toEqual(experimentDraft());
  });

  it('rejects effect, winner, content, and second-variable fields', () => {
    for (const field of [
      'effectSize',
      'pValue',
      'power',
      'winner',
      'contentBrief',
      'title',
      'body',
      'image',
      'secondaryVariable',
    ]) {
      expect(() =>
        assertExperimentDesignDraft({ ...experimentDraft(), [field]: 'forbidden' }),
      ).toThrow(/EXPERIMENT_INVALID_CONTRACT/iu);
    }
  });

  it('requires comparator, direction, outcome metric, and falsification in hypotheses', () => {
    const hypothesis = experimentDraft().hypothesis;
    for (const field of [
      'comparator',
      'expectedDirection',
      'primaryOutcomeMetricId',
      'falsificationCondition',
    ]) {
      const invalid = Object.fromEntries(
        Object.entries(hypothesis).filter(([key]) => key !== field),
      );
      expect(() => assertExperimentHypothesis(invalid)).toThrow(/EXPERIMENT_INVALID_CONTRACT/iu);
    }
  });

  it('keeps UNKNOWN structurally different from COLD', () => {
    expect(
      assertPopularitySnapshot(popularitySnapshot('work-unknown', 'UNKNOWN', 1)),
    ).toMatchObject({
      availability: 'UNAVAILABLE',
      metricReference: null,
      sourceKind: 'NOT_AVAILABLE',
      stratum: 'UNKNOWN',
    });
    expect(assertPopularitySnapshot(popularitySnapshot('work-cold', 'COLD', 2))).toMatchObject({
      availability: 'AVAILABLE',
      metricReference: expect.any(String),
      sourceKind: 'USER_CONFIRMED_SYNTHETIC',
      stratum: 'COLD',
    });
  });
});
