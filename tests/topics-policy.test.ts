import { describe, expect, it } from 'vitest';

import {
  createTopicSemanticFingerprint,
  evaluateTopicEligibility,
  evaluateTopicRanking,
} from '../packages/topics/src/index.js';
import {
  topicCandidate,
  topicContextClaim,
  topicDossier,
  topicEligibilityInput,
  topicPermission,
  topicSubject,
} from './support/topic-policy-fixtures.js';

const fullSpoilerPolicy = Object.freeze({
  userConfirmationRequired: true,
  warningPlacement: 'COVER_TITLE_AND_BODY_OPENING' as const,
  warningRequired: true,
});

const fullSpoilerPermission = Object.freeze({
  level: 'FULL_TRICK_ANALYSIS' as const,
  satisfied: true,
  userConfirmationRequired: true,
  warningPlacement: 'COVER_TITLE_AND_BODY_OPENING' as const,
  warningRequired: true,
});

describe('TopicEligibilityPolicyV1', () => {
  it('accepts non-spoiler and full-trick candidates while retaining the full warning requirement', () => {
    expect(evaluateTopicEligibility(topicEligibilityInput()).state).toBe('ELIGIBLE');

    const candidate = topicCandidate({
      contentType: 'FULL_TRICK_LOGIC_ANALYSIS',
      spoilerLevel: 'FULL_TRICK_ANALYSIS',
      spoilerPolicy: fullSpoilerPolicy,
      topicAngle: '完整诡计 逻辑链核验',
    });
    const result = evaluateTopicEligibility(
      topicEligibilityInput(candidate, {
        permissions: [topicPermission('work-a', { spoiler: fullSpoilerPermission })],
      }),
    );
    expect(result).toMatchObject({ eligible: true, state: 'ELIGIBLE' });
    expect(result.reasonCodes).toContain('FULL_TRICK_WARNING_REQUIRED');
  });

  it('enforces Dossier, fact, authenticity, spoiler, and policy-version gates orthogonally', () => {
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), {
          dossiers: [topicDossier('work-a', { readiness: 'INSUFFICIENT_COVERAGE' })],
        }),
      ).state,
    ).toBe('DOSSIER_NOT_READY');
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), {
          dossiers: [topicDossier('work-a', { coreFactBlocked: true })],
        }),
      ).state,
    ).toBe('FACT_BLOCKED');
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), {
          permissions: [topicPermission('work-a', { personalContentMode: 'BLOCKED' })],
        }),
      ).state,
    ).toBe('AUTHENTICITY_BLOCKED');
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), {
          permissions: [
            topicPermission('work-a', {
              spoiler: { ...topicPermission('work-a').spoiler, satisfied: false },
            }),
          ],
        }),
      ).state,
    ).toBe('SPOILER_POLICY_INCOMPLETE');
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), {
          dossiers: [topicDossier('work-a', { coveragePolicyVersion: 'obsolete-policy' })],
        }),
      ).state,
    ).toBe('STALE');
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), {
          permissions: [topicPermission('work-a', { snapshotVersion: 'obsolete-snapshot' })],
        }),
      ).state,
    ).toBe('STALE');
  });

  it('enforces each content-type-specific subject and context rule', () => {
    const cross = topicCandidate({
      comparisonDimension: 'FAIR_PLAY',
      contentType: 'CROSS_WORK_COMPARISON',
      subjects: [topicSubject('work-a'), topicSubject('work-b')],
      topicAngle: '横向比较 公平性',
    });
    expect(evaluateTopicEligibility(topicEligibilityInput(cross)).state).toBe('ELIGIBLE');
    expect(
      evaluateTopicEligibility(topicEligibilityInput({ ...cross, comparisonDimension: null }))
        .state,
    ).toBe('INSUFFICIENT_COMPARISON_SET');

    const webPublished = topicCandidate({
      comparisonDimension: 'PUBLICATION_FORM',
      contentType: 'WEB_VS_PUBLISHED_MYSTERY',
      subjects: [
        {
          catalogRevision: 1,
          editionId: null,
          expressionForm: 'WEB_SERIALIZED',
          expressionId: 'expression-web',
          role: 'PRIMARY',
          subjectId: 'expression-web',
          subjectType: 'EXPRESSION',
          workId: 'work-a',
        },
        {
          catalogRevision: 1,
          editionId: null,
          expressionForm: 'PUBLISHED_EDITION',
          expressionId: 'expression-published',
          role: 'PRIMARY',
          subjectId: 'expression-published',
          subjectType: 'EXPRESSION',
          workId: 'work-b',
        },
      ],
      topicAngle: '网络与出版形态 叙事比较',
    });
    expect(evaluateTopicEligibility(topicEligibilityInput(webPublished)).state).toBe('ELIGIBLE');

    const cultural = topicCandidate({
      comparisonDimension: 'SOCIAL_CONTEXT',
      contentType: 'MYSTERY_AND_CULTURAL_PHENOMENON',
      contextClaimIds: ['context-work-a'],
      topicAngle: '作品与文化现象 可追溯关联',
    });
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(cultural, {
          contextClaims: [topicContextClaim('work-a')],
        }),
      ).state,
    ).toBe('ELIGIBLE');
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(cultural, {
          contextClaims: [topicContextClaim('work-a', { contextOnly: true })],
        }),
      ).state,
    ).toBe('FACT_BLOCKED');
  });

  it('requires the public-research label and never infers personal reading', () => {
    const publicCandidate = topicCandidate({
      analysisMode: 'PUBLIC_RESEARCH',
      requiredPublicLabels: [],
    });
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(publicCandidate, {
          permissions: [
            topicPermission('work-a', {
              personalContentMode: 'BLOCKED',
              publicResearchContentMode: 'RESEARCH_ONLY',
            }),
          ],
        }),
      ).state,
    ).toBe('AUTHENTICITY_BLOCKED');
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput({
          ...publicCandidate,
          requiredPublicLabels: ['公开资料整理'],
        }),
      ).state,
    ).toBe('ELIGIBLE');
  });

  it('returns duplicate, archived, and stale states deterministically', () => {
    const eligible = evaluateTopicEligibility(topicEligibilityInput());
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), {
          existingFingerprint: {
            canonicalTopicId: 'topic-canonical',
            fingerprint: eligible.fingerprint,
            state: 'LOCKED',
          },
        }),
      ),
    ).toMatchObject({
      canonicalDuplicateTopicId: 'topic-canonical',
      state: 'DUPLICATE',
    });
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), { requestedState: 'ARCHIVED' }),
      ).state,
    ).toBe('ARCHIVED');
    expect(
      evaluateTopicEligibility(
        topicEligibilityInput(topicCandidate(), { allSubjectsCurrent: false }),
      ).state,
    ).toBe('STALE');
  });
});

describe('TopicRankingPolicyV1 and semantic identity', () => {
  it('produces five exact integer components and a deterministic weighted score', () => {
    const candidate = topicCandidate();
    const result = evaluateTopicRanking({
      approvalWorkloadUnits: 2,
      candidate,
      dependencyKeys: ['WORK:work-a:1'],
      dossiers: [topicDossier('work-a')],
      eligibility: 'ELIGIBLE',
      estimatedExternalCostMicrousd: 0,
      sameSubjectTopicCount: 0,
    });
    expect(result).toMatchObject({
      complete: true,
      knownComponentCount: 5,
      totalBasisPoints: 9_530,
    });
    expect(result.components.EVIDENCE_SUFFICIENCY.valueBasisPoints).toBe(9_200);
    expect(result.components.CONTENT_FIT.valueBasisPoints).toBe(9_500);
    expect(result.components.DIFFERENTIATION.valueBasisPoints).toBe(10_000);
    expect(result.components.ESTIMATED_COST.valueBasisPoints).toBe(10_000);
    expect(result.components.APPROVAL_WORKLOAD.valueBasisPoints).toBe(9_300);
    for (const component of Object.values(result.components)) {
      expect(Number.isSafeInteger(component.valueBasisPoints)).toBe(true);
      expect(component.reasonCodes.length).toBeGreaterThan(0);
      expect(component.dependencyKeys).toEqual(['WORK:work-a:1']);
    }
  });

  it('keeps unknown cost and workload null, incomplete, and never treats them as best', () => {
    const result = evaluateTopicRanking({
      approvalWorkloadUnits: null,
      candidate: topicCandidate(),
      dependencyKeys: ['WORK:work-a:1'],
      dossiers: [topicDossier('work-a')],
      eligibility: 'ELIGIBLE',
      estimatedExternalCostMicrousd: null,
      sameSubjectTopicCount: 0,
    });
    expect(result.complete).toBe(false);
    expect(result.knownComponentCount).toBe(3);
    expect(result.components.ESTIMATED_COST).toMatchObject({
      knowledgeState: 'UNKNOWN',
      valueBasisPoints: null,
    });
    expect(result.components.APPROVAL_WORKLOAD).toMatchObject({
      knowledgeState: 'UNKNOWN',
      valueBasisPoints: null,
    });
    expect(result.totalBasisPoints).toBe(7_135);
  });

  it('is stable under input ordering and excludes forbidden signals from the contract', () => {
    const candidate = topicCandidate({
      comparisonDimension: 'FAIR_PLAY',
      contentType: 'CROSS_WORK_COMPARISON',
      subjects: [topicSubject('work-a'), topicSubject('work-b')],
      topicAngle: '公平性与线索组织',
    });
    const first = evaluateTopicRanking({
      approvalWorkloadUnits: 4,
      candidate,
      dependencyKeys: ['WORK:work-b:1', 'WORK:work-a:1'],
      dossiers: [topicDossier('work-b'), topicDossier('work-a')],
      eligibility: 'ELIGIBLE',
      estimatedExternalCostMicrousd: 0,
      sameSubjectTopicCount: 1,
    });
    const second = evaluateTopicRanking({
      approvalWorkloadUnits: 4,
      candidate: { ...candidate, subjects: [...candidate.subjects].reverse() },
      dependencyKeys: ['WORK:work-a:1', 'WORK:work-b:1'],
      dossiers: [topicDossier('work-a'), topicDossier('work-b')],
      eligibility: 'ELIGIBLE',
      estimatedExternalCostMicrousd: 0,
      sameSubjectTopicCount: 1,
    });
    expect(second).toEqual(first);
    expect(() =>
      evaluateTopicRanking({
        aiDisclosure: true,
        approvalWorkloadUnits: 4,
        candidate,
        copyrightRisk: 0,
        dependencyKeys: [],
        dossiers: [],
        eligibility: 'ELIGIBLE',
        estimatedExternalCostMicrousd: 0,
        publicationOwnership: 'publisher',
        sameSubjectTopicCount: 0,
      }),
    ).toThrowError('TOPIC_INVALID_CONTRACT');
  });

  it('normalizes light wording variation, ignores comparison order, and preserves real angles', () => {
    const base = {
      analysisMode: 'PERSONAL' as const,
      comparisonDimension: 'FAIR_PLAY' as const,
      contentType: 'CROSS_WORK_COMPARISON' as const,
      spoilerLevel: 'NO_SPOILER' as const,
      subjectIds: ['work-a', 'work-b'],
    };
    const first = createTopicSemanticFingerprint({
      ...base,
      normalizedAngleIntent: '公平性：线索组织！',
    });
    const wordingVariant = createTopicSemanticFingerprint({
      ...base,
      normalizedAngleIntent: '公平性 线索组织',
      subjectIds: ['work-b', 'work-a'],
    });
    const differentAngle = createTopicSemanticFingerprint({
      ...base,
      normalizedAngleIntent: '叙事视角与读者知情边界',
    });
    expect(wordingVariant.fingerprint).toBe(first.fingerprint);
    expect(differentAngle.fingerprint).not.toBe(first.fingerprint);
  });
});
