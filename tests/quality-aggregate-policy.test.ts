import { describe, expect, it } from 'vitest';

import {
  QUALITY_READINESS_CHECK_TYPES,
  evaluateQualityReadiness,
  type EvaluateQualityReadinessInput,
  type QualityReadinessCheckType,
  type QualityReadinessSourceInput,
} from '../packages/quality/src/index.js';

function source(
  checkType: QualityReadinessCheckType,
  status: QualityReadinessSourceInput['status'] = 'PASS',
  capability: QualityReadinessSourceInput['capability'] = 'AVAILABLE',
): QualityReadinessSourceInput {
  return {
    capability,
    checkType,
    reason:
      capability === 'DEFERRED_029B'
        ? 'DEFERRED_029B'
        : status === 'STALE'
          ? 'SAVED_RESULT_STALE'
          : status === 'NOT_RUN'
            ? 'SAVED_RESULT_MISSING'
            : 'SAVED_EXACT_CURRENT',
    status,
  };
}

function input(
  overrides: Partial<Record<QualityReadinessCheckType, QualityReadinessSourceInput>> = {},
  fullSpoilerReviewRequired = false,
): EvaluateQualityReadinessInput {
  return {
    draft: {
      draftId: 'draft-current',
      revision: 4,
      status: 'READY_FOR_QUALITY_PIPELINE',
      versionId: 'draft-version-current',
    },
    fullSpoilerReviewRequired,
    sources: QUALITY_READINESS_CHECK_TYPES.map(
      (checkType) => overrides[checkType] ?? source(checkType),
    ),
  };
}

describe('M3 Issue 030 minimal quality readiness policy', () => {
  it.each([
    {
      expected: 'STALE_OR_INCOMPLETE',
      overrides: {
        DUPLICATION: source('DUPLICATION', 'STALE'),
        READING_AUTHENTICITY: source('READING_AUTHENTICITY', 'BLOCKED'),
      },
    },
    {
      expected: 'BLOCKED_BY_QUALITY',
      overrides: { FACT_MAPPING: source('FACT_MAPPING', 'BLOCKED') },
    },
    {
      expected: 'REQUIRES_DETAILED_REVIEW',
      overrides: { SPOILER: source('SPOILER', 'REVIEW_REQUIRED') },
    },
  ] as const)('uses stable precedence for $expected while preserving secondary counts', (row) => {
    const result = evaluateQualityReadiness(input(row.overrides));
    expect(result.status).toBe(row.expected);
    if (row.expected === 'STALE_OR_INCOMPLETE') {
      expect(result.counts).toMatchObject({ blocker: 1, stale: 1 });
      expect(
        result.sources.find(({ checkType }) => checkType === 'READING_AUTHENTICITY'),
      ).toMatchObject({ status: 'BLOCKED' });
    }
  });

  it('routes deferred 029B to focused review without marking it PASS or incomplete', () => {
    const result = evaluateQualityReadiness(
      input({
        INTERNAL_CONSISTENCY: source('INTERNAL_CONSISTENCY', 'NOT_RUN', 'DEFERRED_029B'),
      }),
    );
    expect(result).toMatchObject({
      advisoryCandidate: 'FOCUSED_CANDIDATE',
      counts: { missing: 0, review: 1 },
      status: 'REQUIRES_DETAILED_REVIEW',
    });
    expect(result.sources.at(-1)).toMatchObject({
      capability: 'DEFERRED_029B',
      status: 'NOT_RUN',
    });
  });

  it('keeps the synthetic all-current PASS branch separate from the real deferred capability', () => {
    const result = evaluateQualityReadiness(input());
    expect(result).toMatchObject({
      advisoryCandidate: 'FAST_CANDIDATE',
      canCreateApproval: false,
      canExport: false,
      canPublish: false,
      status: 'READY_FOR_FAST_APPROVAL',
    });
    expect(result.sources).toHaveLength(7);
  });

  it('routes full trick content to focused review even when every saved source passes', () => {
    expect(evaluateQualityReadiness(input({}, true))).toMatchObject({
      advisoryCandidate: 'FOCUSED_CANDIDATE',
      counts: { review: 1 },
      status: 'REQUIRES_DETAILED_REVIEW',
    });
  });

  it('fails closed for missing, duplicate or unknown sources', () => {
    const valid = input();
    expect(() =>
      evaluateQualityReadiness({ ...valid, sources: valid.sources.slice(0, -1) }),
    ).toThrow(/QUALITY_READINESS_INVALID_SOURCE_SET/u);
    expect(() =>
      evaluateQualityReadiness({
        ...valid,
        sources: valid.sources.map((item, index) =>
          index === 1 ? { ...item, status: 'UNKNOWN' as never } : item,
        ),
      }),
    ).toThrow(/QUALITY_READINESS_INVALID_STATUS/u);
  });

  it('ignores AI disclosure and copyright metadata because neither is an allowed input', () => {
    const baseline = input();
    const withForbiddenMetadata = {
      ...baseline,
      aiDisclosure: true,
      copyrightRisk: 'HIGH',
    } as EvaluateQualityReadinessInput;
    expect(evaluateQualityReadiness(withForbiddenMetadata)).toEqual(
      evaluateQualityReadiness(baseline),
    );
  });
});
