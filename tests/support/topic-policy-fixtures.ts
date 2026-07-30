import {
  AUTHENTICITY_POLICY_VERSION,
  EXPRESSION_PERMISSION_VERSION,
  SPOILER_POLICY_VERSION,
} from '../../packages/authenticity/src/index.js';
import { DOSSIER_COVERAGE_POLICY_VERSION } from '../../packages/dossier/src/index.js';
import { FACT_POLICY_VERSION } from '../../packages/evidence/src/index.js';
import {
  evaluateTopicRanking,
  type TopicCandidateDraft,
  type TopicContextClaimInput,
  type TopicDossierInput,
  type TopicEligibilityInput,
  type TopicPermissionInput,
  type TopicRankingResult,
  type TopicSubjectInput,
} from '../../packages/topics/src/index.js';

export function topicSubject(
  workId: string,
  role: 'PRIMARY' | 'COMPARISON' = 'PRIMARY',
): TopicSubjectInput {
  return Object.freeze({
    catalogRevision: 1,
    editionId: null,
    expressionForm: null,
    expressionId: null,
    role,
    subjectId: workId,
    subjectType: 'WORK',
    workId,
  });
}

export function topicCandidate(overrides: Partial<TopicCandidateDraft> = {}): TopicCandidateDraft {
  return Object.freeze({
    analysisMode: 'PERSONAL',
    candidateJudgment: null,
    centralQuestion: '现有合成证据能支持怎样的研究边界？',
    comparisonDimension: null,
    contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
    contextClaimIds: Object.freeze([]),
    provenance: 'LOCAL_DETERMINISTIC',
    requiredPublicLabels: Object.freeze([]),
    spoilerLevel: 'NO_SPOILER',
    spoilerPolicy: Object.freeze({
      userConfirmationRequired: false,
      warningPlacement: 'NONE',
      warningRequired: false,
    }),
    subjects: Object.freeze([topicSubject('work-a')]),
    topicAngle: '单书判断 证据边界',
    ...overrides,
  });
}

export function topicDossier(
  workId: string,
  overrides: Partial<TopicDossierInput> = {},
): TopicDossierInput {
  return Object.freeze({
    blockedCount: 0,
    coreFactBlocked: false,
    coverageBasisPoints: 9_200,
    coveragePolicyVersion: DOSSIER_COVERAGE_POLICY_VERSION,
    dossierId: `dossier-${workId}`,
    factPolicyVersion: FACT_POLICY_VERSION,
    gapCount: 0,
    readiness: 'READY_FOR_CONTENT_BRIEF',
    stale: false,
    versionId: `dossier-version-${workId}`,
    workId,
    ...overrides,
  });
}

export function topicPermission(
  workId: string,
  overrides: Partial<TopicPermissionInput> = {},
): TopicPermissionInput {
  return Object.freeze({
    authenticityPolicyVersion: AUTHENTICITY_POLICY_VERSION,
    personalContentMode: 'ALLOWED',
    publicResearchContentMode: 'RESEARCH_ONLY',
    snapshotId: `permission-${workId}`,
    snapshotVersion: EXPRESSION_PERMISSION_VERSION,
    spoiler: Object.freeze({
      level: 'NO_SPOILER',
      satisfied: true,
      userConfirmationRequired: false,
      warningPlacement: 'NONE',
      warningRequired: false,
    }),
    spoilerPolicyVersion: SPOILER_POLICY_VERSION,
    stale: false,
    workId,
    ...overrides,
  });
}

export function topicContextClaim(
  workId: string,
  overrides: Partial<TopicContextClaimInput> = {},
): TopicContextClaimInput {
  return Object.freeze({
    claimId: `context-${workId}`,
    contextOnly: false,
    factStatus: 'VERIFIED',
    workId,
    ...overrides,
  });
}

export function topicEligibilityInput(
  candidate: TopicCandidateDraft = topicCandidate(),
  overrides: Partial<Omit<TopicEligibilityInput, 'candidate'>> = {},
): TopicEligibilityInput {
  const workIds = [...new Set(candidate.subjects.map((subject) => subject.workId))];
  return Object.freeze({
    allSubjectsCurrent: true,
    candidate,
    contextClaims: Object.freeze([]),
    dossiers: Object.freeze(workIds.map((workId) => topicDossier(workId))),
    existingFingerprint: null,
    permissions: Object.freeze(workIds.map((workId) => topicPermission(workId))),
    requestedState: 'PROPOSED',
    ...overrides,
  });
}

export function topicRanking(
  candidate: TopicCandidateDraft = topicCandidate(),
  overrides: Readonly<{
    approvalWorkloadUnits?: number | null;
    estimatedExternalCostMicrousd?: number | null;
    sameSubjectTopicCount?: number;
  }> = {},
): TopicRankingResult {
  const workIds = [...new Set(candidate.subjects.map((subject) => subject.workId))];
  return evaluateTopicRanking({
    approvalWorkloadUnits: overrides.approvalWorkloadUnits ?? 2,
    candidate,
    dependencyKeys: workIds.map((workId) => `WORK:${workId}:1`),
    dossiers: workIds.map((workId) => topicDossier(workId)),
    eligibility: 'ELIGIBLE',
    estimatedExternalCostMicrousd: overrides.estimatedExternalCostMicrousd ?? 0,
    sameSubjectTopicCount: overrides.sameSubjectTopicCount ?? 0,
  });
}
