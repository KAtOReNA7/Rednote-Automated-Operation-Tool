import { describe, expect, it } from 'vitest';

import {
  TOPIC_CONTENT_TYPES,
  TOPIC_LIMITS,
  buildLocalTopicGenerationPlan,
  type TopicGenerationWorkInput,
} from '../packages/topics/src/index.js';
import {
  topicContextClaim,
  topicDossier,
  topicPermission,
} from './support/topic-policy-fixtures.js';

function generationWork(
  workId: string,
  input: Readonly<{
    context?: boolean;
    form?: 'OTHER_VERIFIED' | 'PUBLISHED_EDITION' | 'WEB_SERIALIZED';
    mode?: 'PERSONAL' | 'PUBLIC_RESEARCH';
    spoiler?: 'FULL_TRICK_ANALYSIS' | 'LIGHT_SPOILER' | 'NO_SPOILER';
  }> = {},
): TopicGenerationWorkInput {
  const spoiler = input.spoiler ?? 'NO_SPOILER';
  const permissionSpoiler =
    spoiler === 'FULL_TRICK_ANALYSIS'
      ? {
          level: spoiler,
          satisfied: true,
          userConfirmationRequired: true,
          warningPlacement: 'COVER_TITLE_AND_BODY_OPENING' as const,
          warningRequired: true,
        }
      : spoiler === 'LIGHT_SPOILER'
        ? {
            level: spoiler,
            satisfied: true,
            userConfirmationRequired: false,
            warningPlacement: 'BODY_OPENING' as const,
            warningRequired: true,
          }
        : topicPermission(workId).spoiler;
  return Object.freeze({
    catalogRevision: 1,
    contextClaims: input.context ? [topicContextClaim(workId)] : [],
    dossier: topicDossier(workId),
    expressions: [
      {
        catalogRevision: 1,
        expressionForm: input.form ?? 'OTHER_VERIFIED',
        expressionId: `expression-${workId}`,
      },
    ],
    permission: topicPermission(workId, {
      personalContentMode: input.mode === 'PUBLIC_RESEARCH' ? 'BLOCKED' : 'ALLOWED',
      publicResearchContentMode: 'RESEARCH_ONLY',
      spoiler: permissionSpoiler,
    }),
    workId,
  });
}

describe('TopicGenerationPlanV1 pure-local path', () => {
  it('generates all five structured candidate types with zero model or external requests', () => {
    const works = [
      generationWork('work-web', { context: true, form: 'WEB_SERIALIZED' }),
      generationWork('work-published', { form: 'PUBLISHED_EDITION' }),
      generationWork('work-full', { spoiler: 'FULL_TRICK_ANALYSIS' }),
    ];
    const plan = buildLocalTopicGenerationPlan(works);
    expect(plan.inputWorkCount).toBe(3);
    expect(plan.estimatedModelRequests).toBe(0);
    expect(plan.modelExecutionState).toBe('UNCONFIGURED_DISABLED');
    expect(plan.budgetConclusion).toBe('NOT_APPLICABLE');
    expect(plan.deduplicationLimit).toBe(TOPIC_LIMITS.maxCandidatesPerGeneration);
    for (const contentType of TOPIC_CONTENT_TYPES) {
      expect(plan.counts[contentType]).toBeGreaterThan(0);
    }
    expect(
      plan.candidates.some((candidate) => candidate.provenance !== 'LOCAL_DETERMINISTIC'),
    ).toBe(false);
    for (const candidate of plan.candidates) {
      expect(candidate).not.toHaveProperty('title');
      expect(candidate).not.toHaveProperty('body');
      expect(candidate).not.toHaveProperty('contentBrief');
      expect(candidate).not.toHaveProperty('experiment');
    }
  });

  it('retains PERSONAL/PUBLIC_RESEARCH and three spoiler levels without mixing permissions', () => {
    const personal = buildLocalTopicGenerationPlan([
      generationWork('personal-no-spoiler'),
      generationWork('personal-light-a', { context: true, spoiler: 'LIGHT_SPOILER' }),
      generationWork('personal-light-b', { spoiler: 'LIGHT_SPOILER' }),
      generationWork('personal-full', { spoiler: 'FULL_TRICK_ANALYSIS' }),
      generationWork('public-no-spoiler', { mode: 'PUBLIC_RESEARCH' }),
    ]);
    expect(personal.candidates.some((candidate) => candidate.analysisMode === 'PERSONAL')).toBe(
      true,
    );
    const publicCandidate = personal.candidates.find(
      (candidate) =>
        candidate.analysisMode === 'PUBLIC_RESEARCH' &&
        candidate.contentType === 'NON_SPOILER_SINGLE_BOOK_VERDICT',
    );
    expect(publicCandidate?.requiredPublicLabels).toContain('公开资料整理');
    expect(
      personal.candidates.some((candidate) => candidate.spoilerLevel === 'LIGHT_SPOILER'),
    ).toBe(true);
    const full = personal.candidates.find(
      (candidate) => candidate.contentType === 'FULL_TRICK_LOGIC_ANALYSIS',
    );
    expect(full?.spoilerPolicy).toEqual({
      userConfirmationRequired: true,
      warningPlacement: 'COVER_TITLE_AND_BODY_OPENING',
      warningRequired: true,
    });
  });

  it('is deterministic under work ordering and keeps all planning limits explicit', () => {
    const works = [
      generationWork('work-b', { form: 'PUBLISHED_EDITION' }),
      generationWork('work-a', { form: 'WEB_SERIALIZED' }),
    ];
    const first = buildLocalTopicGenerationPlan(works);
    const second = buildLocalTopicGenerationPlan([...works].reverse());
    expect(second).toEqual(first);
    expect(first.localCombinationUpperBound).toBe(1);
    expect(first.estimatedLocalWrites).toBe(first.candidates.length * 10);
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.expectedPolicyVersions).toMatchObject({
      topicEligibility: 'topic-eligibility-policy-v1',
      topicFingerprint: 'topic-semantic-fingerprint-v1',
    });
  });

  it('rejects duplicate work IDs and an unbounded input set before generating', () => {
    const duplicate = generationWork('work-duplicate');
    expect(() => buildLocalTopicGenerationPlan([duplicate, duplicate])).toThrowError(
      'TOPIC_INVALID_CONTRACT',
    );
    const tooMany = Array.from(
      { length: TOPIC_LIMITS.maxCandidatesPerGeneration + 1 },
      (_, index) => generationWork(`work-${index}`),
    );
    expect(() => buildLocalTopicGenerationPlan(tooMany)).toThrowError('TOPIC_INVALID_CONTRACT');
  });
});
