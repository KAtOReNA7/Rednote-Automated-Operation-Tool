import { describe, expect, it } from 'vitest';

import {
  FIRST_30_PROFILE_ID,
  FIRST_30_QUOTAS,
  FIRST_30_TOTAL,
  TOPIC_CONTENT_TYPES,
  assertFrozenFirst30Profile,
  solveFirst30Quota,
  topicSemanticHash,
  transitionTopicState,
  type TopicCandidateState,
  type TopicContentType,
  type TopicEligibilityState,
  type TopicQuotaCandidate,
} from '../packages/topics/src/index.js';
import { topicCandidate, topicRanking, topicSubject } from './support/topic-policy-fixtures.js';

function quotaCandidate(
  contentType: TopicContentType,
  index: number,
  overrides: Partial<TopicQuotaCandidate> = {},
): TopicQuotaCandidate {
  const topicId = `topic-${contentType.toLowerCase()}-${index}`;
  const workId = `work-${contentType.toLowerCase()}-${index}`;
  const candidate = topicCandidate({
    contentType,
    subjects: [topicSubject(workId)],
    topicAngle: `合成角度 ${contentType} ${index}`,
  });
  const ranking = topicRanking(candidate, { sameSubjectTopicCount: index % 3 });
  return Object.freeze({
    contentType,
    eligibility: 'ELIGIBLE' as TopicEligibilityState,
    estimatedExternalCostMicrousd: 0,
    fingerprint: ranking.fingerprint,
    ranking,
    revision: 1,
    state: 'PROPOSED' as TopicCandidateState,
    topicId,
    topicVersionId: `version-${topicId}`,
    workIds: [workId],
    workloadUnits: 2,
    ...overrides,
  });
}

function completeCandidates(): readonly TopicQuotaCandidate[] {
  return TOPIC_CONTENT_TYPES.flatMap((contentType) =>
    Array.from({ length: FIRST_30_QUOTAS[contentType] }, (_, index) =>
      quotaCandidate(contentType, index),
    ),
  );
}

describe('FIRST_30_V1 deterministic quota solver', () => {
  it('freezes the five-category 10/8/6/3/3 registry at exactly 30', () => {
    expect(FIRST_30_PROFILE_ID).toBe('FIRST_30_V1');
    expect(TOPIC_CONTENT_TYPES).toHaveLength(5);
    expect(FIRST_30_QUOTAS).toEqual({
      CROSS_WORK_COMPARISON: 6,
      FULL_TRICK_LOGIC_ANALYSIS: 8,
      MYSTERY_AND_CULTURAL_PHENOMENON: 3,
      NON_SPOILER_SINGLE_BOOK_VERDICT: 10,
      WEB_VS_PUBLISHED_MYSTERY: 3,
    });
    expect(Object.values(FIRST_30_QUOTAS).reduce((sum, value) => sum + value, 0)).toBe(
      FIRST_30_TOTAL,
    );
    expect(Object.isFrozen(FIRST_30_QUOTAS)).toBe(true);
    expect(assertFrozenFirst30Profile()).toBeUndefined();
  });

  it('selects exactly 30 as 10/8/6/3/3 and remains stable under shuffled input', () => {
    const candidates = completeCandidates();
    const first = solveFirst30Quota({
      candidates,
      maxWorkExposure: 10,
      profileId: 'primary',
    });
    const second = solveFirst30Quota({
      candidates: [...candidates].reverse(),
      maxWorkExposure: 10,
      profileId: 'primary',
    });
    expect(first.status).toBe('COMPLETE');
    expect(first.totalSelected).toBe(30);
    for (const contentType of TOPIC_CONTENT_TYPES) {
      expect(first.categories[contentType]).toMatchObject({
        required: FIRST_30_QUOTAS[contentType],
        selected: FIRST_30_QUOTAS[contentType],
        shortfall: 0,
      });
    }
    expect(new Set(first.members.map((member) => member.topicId)).size).toBe(30);
    expect(new Set(first.members.map((member) => member.fingerprint)).size).toBe(30);
    expect(second).toEqual(first);
  });

  it('keeps per-category shortfalls and never backfills with another category or duplicate', () => {
    const first = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 1);
    const duplicate = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 2, {
      fingerprint: first.fingerprint,
    });
    const surplus = Array.from({ length: 20 }, (_, index) =>
      quotaCandidate('FULL_TRICK_LOGIC_ANALYSIS', index),
    );
    const result = solveFirst30Quota({
      candidates: [first, duplicate, ...surplus],
      maxWorkExposure: 10,
      profileId: 'primary',
    });
    expect(result.status).toBe('INCOMPLETE');
    expect(result.categories.NON_SPOILER_SINGLE_BOOK_VERDICT).toMatchObject({
      selected: 1,
      shortfall: 9,
    });
    expect(result.categories.FULL_TRICK_LOGIC_ANALYSIS).toMatchObject({
      selected: 8,
      shortfall: 0,
    });
    expect(result.categories.CROSS_WORK_COMPARISON.shortfall).toBe(6);
    expect(result.members).toHaveLength(9);
    expect(new Set(result.members.map((member) => member.fingerprint)).size).toBe(9);
    expect(result.warnings).toContain('QUOTA_SHORTFALL_OR_CONFLICT');
  });

  it('prioritizes eligible locks without changing ranking and reports over-lock conflicts', () => {
    const proposed = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 1);
    const locked = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 2, {
      ranking: { ...proposed.ranking, totalBasisPoints: 1 },
      state: 'LOCKED',
    });
    const ineligibleLocked = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 3, {
      eligibility: 'FACT_BLOCKED',
      state: 'LOCKED',
    });
    const priority = solveFirst30Quota({
      candidates: [proposed, locked, ineligibleLocked],
      maxWorkExposure: 10,
      profileId: 'primary',
    });
    expect(priority.members[0]).toMatchObject({
      locked: true,
      scoreBasisPoints: 1,
      topicId: locked.topicId,
    });
    expect(priority.members.some((member) => member.topicId === ineligibleLocked.topicId)).toBe(
      false,
    );

    const overLocked = solveFirst30Quota({
      candidates: Array.from({ length: 11 }, (_, index) =>
        quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', index, { state: 'LOCKED' }),
      ),
      maxWorkExposure: 10,
      profileId: 'primary',
    });
    expect(overLocked.status).toBe('INCOMPLETE');
    expect(overLocked.categories.NON_SPOILER_SINGLE_BOOK_VERDICT.conflicts[0]).toMatchObject({
      code: 'OVER_LOCKED',
    });
    expect(
      overLocked.categories.NON_SPOILER_SINGLE_BOOK_VERDICT.conflicts[0]?.topicIds,
    ).toHaveLength(11);
  });

  it('filters held/archived state without mutating score and enforces work exposure', () => {
    const base = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 1);
    const held = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 2, { state: 'HELD' });
    const archived = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 3, {
      state: 'ARCHIVED',
    });
    const sameWork = quotaCandidate('FULL_TRICK_LOGIC_ANALYSIS', 1, {
      workIds: base.workIds,
    });
    const result = solveFirst30Quota({
      candidates: [base, held, archived, sameWork],
      maxWorkExposure: 1,
      profileId: 'primary',
    });
    expect(result.members.map((member) => member.topicId)).toEqual([base.topicId]);
    expect(result.categories.NON_SPOILER_SINGLE_BOOK_VERDICT).toMatchObject({
      archivedCount: 1,
      heldCount: 1,
    });
    expect(held.ranking.totalBasisPoints).toBe(
      quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 2).ranking.totalBasisPoints,
    );
    expect(result.warnings).toContain(`EXPOSURE_LIMIT_REACHED:${sameWork.topicId}`);
  });

  it('preserves UNKNOWN cost/workload instead of converting either to zero', () => {
    const result = solveFirst30Quota({
      candidates: [
        quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 1, {
          estimatedExternalCostMicrousd: null,
          workloadUnits: null,
        }),
      ],
      maxWorkExposure: 10,
      profileId: 'primary',
    });
    expect(result.estimatedExternalCost).toEqual({ state: 'UNKNOWN', valueMicrousd: null });
    expect(result.workload).toEqual({ state: 'UNKNOWN', units: null });
  });

  it('supports lock, hold, resume, archive, restore, and explicit undo transitions', () => {
    expect(transitionTopicState('PROPOSED', 'LOCK').to).toBe('LOCKED');
    expect(transitionTopicState('LOCKED', 'HOLD').to).toBe('HELD');
    expect(transitionTopicState('HELD', 'RESUME').to).toBe('PROPOSED');
    expect(transitionTopicState('PROPOSED', 'ARCHIVE').to).toBe('ARCHIVED');
    expect(transitionTopicState('ARCHIVED', 'RESTORE').to).toBe('PROPOSED');
    expect(transitionTopicState('LOCKED', 'UNDO', 'PROPOSED').to).toBe('PROPOSED');
    expect(() => transitionTopicState('PROPOSED', 'RESUME')).toThrowError('TOPIC_POLICY_BLOCKED');
  });

  it('includes every selection input in the pool snapshot identity', () => {
    const candidate = quotaCandidate('NON_SPOILER_SINGLE_BOOK_VERDICT', 1);
    const first = solveFirst30Quota({
      candidates: [candidate],
      maxWorkExposure: 1,
      profileId: 'primary',
    });
    const changed = solveFirst30Quota({
      candidates: [{ ...candidate, revision: 2 }],
      maxWorkExposure: 1,
      profileId: 'primary',
    });
    expect(changed.poolSnapshotHash).not.toBe(first.poolSnapshotHash);
    expect(topicSemanticHash({ id: candidate.topicId })).toMatch(/^[0-9a-f]{64}$/u);
  });
});
