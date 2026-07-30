import {
  AUTHENTICITY_POLICY_VERSION,
  EXPRESSION_PERMISSION_VERSION,
  SPOILER_POLICY_VERSION,
} from '@mystery-operations/authenticity';
import { DOSSIER_COVERAGE_POLICY_VERSION } from '@mystery-operations/dossier';
import { FACT_POLICY_VERSION } from '@mystery-operations/evidence';

import {
  FIRST_30_QUOTAS,
  TOPIC_ELIGIBILITY_POLICY_VERSION,
  TOPIC_FINGERPRINT_POLICY_VERSION,
  TOPIC_RANKING_COMPONENTS,
  TOPIC_RANKING_POLICY_VERSION,
  TOPIC_RANKING_WEIGHTS,
  type TopicEligibilityState,
  type TopicRankingComponent,
  type TopicReasonCode,
} from './constants.js';
import {
  assertTopicEligibilityInput,
  assertTopicRankingInput,
  type TopicCandidateDraft,
  type TopicEligibilityInput,
} from './contracts.js';
import {
  createTopicSemanticFingerprint,
  topicSemanticHash,
  type TopicSemanticFingerprint,
} from './identity.js';

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort());
}

function workIds(candidate: TopicCandidateDraft): readonly string[] {
  return Object.freeze([...new Set(candidate.subjects.map((subject) => subject.workId))].sort());
}

function requiredMapValue<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = map.get(key);
  if (value === undefined) throw new TypeError('Validated Topic dependency is missing.');
  return value;
}

function fingerprintFor(candidate: TopicCandidateDraft): TopicSemanticFingerprint {
  return createTopicSemanticFingerprint({
    analysisMode: candidate.analysisMode,
    comparisonDimension: candidate.comparisonDimension,
    contentType: candidate.contentType,
    normalizedAngleIntent: candidate.topicAngle,
    spoilerLevel: candidate.spoilerLevel,
    subjectIds: workIds(candidate),
  });
}

export interface TopicEligibilityResult {
  readonly canonicalDuplicateTopicId: string | null;
  readonly dependencyHash: string;
  readonly eligible: boolean;
  readonly fingerprint: string;
  readonly fingerprintPolicyVersion: typeof TOPIC_FINGERPRINT_POLICY_VERSION;
  readonly policyVersion: typeof TOPIC_ELIGIBILITY_POLICY_VERSION;
  readonly reasonCodes: readonly TopicReasonCode[];
  readonly state: TopicEligibilityState;
}

function result(
  input: TopicEligibilityInput,
  fingerprint: TopicSemanticFingerprint,
  state: TopicEligibilityState,
  reasons: readonly TopicReasonCode[],
): TopicEligibilityResult {
  const dependencies = {
    allSubjectsCurrent: input.allSubjectsCurrent,
    candidate: fingerprint.descriptor,
    contextClaims: input.contextClaims
      .map((claim) => ({
        claimId: claim.claimId,
        contextOnly: claim.contextOnly,
        factStatus: claim.factStatus,
      }))
      .sort((left, right) => left.claimId.localeCompare(right.claimId)),
    dossiers: input.dossiers
      .map((dossier) => ({
        coreFactBlocked: dossier.coreFactBlocked,
        dossierId: dossier.dossierId,
        readiness: dossier.readiness,
        stale: dossier.stale,
        versionId: dossier.versionId,
        workId: dossier.workId,
      }))
      .sort((left, right) => left.workId.localeCompare(right.workId)),
    eligibilityPolicyVersion: TOPIC_ELIGIBILITY_POLICY_VERSION,
    existingFingerprint: input.existingFingerprint,
    permissions: input.permissions
      .map((permission) => ({
        authenticityPolicyVersion: permission.authenticityPolicyVersion,
        personalContentMode: permission.personalContentMode,
        publicResearchContentMode: permission.publicResearchContentMode,
        snapshotId: permission.snapshotId,
        snapshotVersion: permission.snapshotVersion,
        spoiler: permission.spoiler,
        spoilerPolicyVersion: permission.spoilerPolicyVersion,
        stale: permission.stale,
        workId: permission.workId,
      }))
      .sort((left, right) => left.workId.localeCompare(right.workId)),
    requestedState: input.requestedState,
  };
  return Object.freeze({
    canonicalDuplicateTopicId: input.existingFingerprint?.canonicalTopicId ?? null,
    dependencyHash: topicSemanticHash(dependencies),
    eligible: state === 'ELIGIBLE',
    fingerprint: fingerprint.fingerprint,
    fingerprintPolicyVersion: TOPIC_FINGERPRINT_POLICY_VERSION,
    policyVersion: TOPIC_ELIGIBILITY_POLICY_VERSION,
    reasonCodes: uniqueSorted(reasons),
    state,
  });
}

export function evaluateTopicEligibility(rawInput: unknown): TopicEligibilityResult {
  const input = assertTopicEligibilityInput(rawInput);
  const fingerprint = fingerprintFor(input.candidate);
  const candidateWorkIds = workIds(input.candidate);

  if (input.requestedState === 'ARCHIVED') {
    return result(input, fingerprint, 'ARCHIVED', ['ARCHIVED_CANDIDATE']);
  }
  if (input.existingFingerprint !== null) {
    return result(input, fingerprint, 'DUPLICATE', ['DUPLICATE_SEMANTIC_TOPIC']);
  }
  if (!input.allSubjectsCurrent) {
    return result(input, fingerprint, 'STALE', ['SUBJECT_NOT_CURRENT']);
  }

  const dossierByWork = new Map(input.dossiers.map((dossier) => [dossier.workId, dossier]));
  if (candidateWorkIds.some((workId) => !dossierByWork.has(workId))) {
    return result(input, fingerprint, 'DOSSIER_NOT_READY', ['DOSSIER_MISSING']);
  }
  const candidateDossiers = candidateWorkIds.map((workId) =>
    requiredMapValue(dossierByWork, workId),
  );
  if (
    candidateDossiers.some(
      (dossier) =>
        dossier.coveragePolicyVersion !== DOSSIER_COVERAGE_POLICY_VERSION ||
        dossier.factPolicyVersion !== FACT_POLICY_VERSION,
    )
  ) {
    return result(input, fingerprint, 'STALE', ['DOSSIER_STALE']);
  }
  if (candidateDossiers.some((dossier) => dossier.stale || dossier.readiness === 'STALE')) {
    return result(input, fingerprint, 'STALE', ['DOSSIER_STALE']);
  }
  if (
    candidateDossiers.some(
      (dossier) => dossier.coreFactBlocked || dossier.readiness === 'FACT_BLOCKED',
    )
  ) {
    return result(input, fingerprint, 'FACT_BLOCKED', ['DOSSIER_FACT_BLOCKED']);
  }
  if (candidateDossiers.some((dossier) => dossier.readiness !== 'READY_FOR_CONTENT_BRIEF')) {
    return result(input, fingerprint, 'DOSSIER_NOT_READY', ['DOSSIER_NOT_READY']);
  }

  const permissionByWork = new Map(
    input.permissions.map((permission) => [permission.workId, permission]),
  );
  if (candidateWorkIds.some((workId) => !permissionByWork.has(workId))) {
    return result(input, fingerprint, 'AUTHENTICITY_BLOCKED', ['AUTHENTICITY_SNAPSHOT_MISSING']);
  }
  const candidatePermissions = candidateWorkIds.map((workId) =>
    requiredMapValue(permissionByWork, workId),
  );
  if (
    candidatePermissions.some(
      (permission) =>
        permission.snapshotVersion !== EXPRESSION_PERMISSION_VERSION ||
        permission.authenticityPolicyVersion !== AUTHENTICITY_POLICY_VERSION ||
        permission.spoilerPolicyVersion !== SPOILER_POLICY_VERSION,
    )
  ) {
    return result(input, fingerprint, 'STALE', ['AUTHENTICITY_SNAPSHOT_STALE']);
  }
  if (candidatePermissions.some((permission) => permission.stale)) {
    return result(input, fingerprint, 'STALE', ['AUTHENTICITY_SNAPSHOT_STALE']);
  }
  const modeBlocked = candidatePermissions.some((permission) => {
    const mode =
      input.candidate.analysisMode === 'PERSONAL'
        ? permission.personalContentMode
        : permission.publicResearchContentMode;
    return input.candidate.analysisMode === 'PERSONAL'
      ? mode !== 'ALLOWED' && mode !== 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY'
      : mode !== 'RESEARCH_ONLY' && mode !== 'ALLOWED';
  });
  if (modeBlocked) {
    return result(input, fingerprint, 'AUTHENTICITY_BLOCKED', ['AUTHENTICITY_MODE_BLOCKED']);
  }
  if (
    input.candidate.analysisMode === 'PUBLIC_RESEARCH' &&
    !input.candidate.requiredPublicLabels.includes('公开资料整理')
  ) {
    return result(input, fingerprint, 'AUTHENTICITY_BLOCKED', ['PUBLIC_RESEARCH_LABEL_REQUIRED']);
  }

  const primaryCount = input.candidate.subjects.filter(
    (subject) => subject.role === 'PRIMARY',
  ).length;
  switch (input.candidate.contentType) {
    case 'NON_SPOILER_SINGLE_BOOK_VERDICT':
      if (
        candidateWorkIds.length !== 1 ||
        primaryCount !== 1 ||
        input.candidate.spoilerLevel !== 'NO_SPOILER'
      ) {
        return result(input, fingerprint, 'SPOILER_POLICY_INCOMPLETE', ['SPOILER_LEVEL_MISMATCH']);
      }
      break;
    case 'FULL_TRICK_LOGIC_ANALYSIS':
      if (
        candidateWorkIds.length !== 1 ||
        primaryCount !== 1 ||
        input.candidate.spoilerLevel !== 'FULL_TRICK_ANALYSIS'
      ) {
        return result(input, fingerprint, 'SPOILER_POLICY_INCOMPLETE', ['SPOILER_LEVEL_MISMATCH']);
      }
      break;
    case 'CROSS_WORK_COMPARISON':
      if (
        candidateWorkIds.length < 2 ||
        input.candidate.comparisonDimension === null ||
        primaryCount < 2
      ) {
        return result(input, fingerprint, 'INSUFFICIENT_COMPARISON_SET', [
          input.candidate.comparisonDimension === null
            ? 'COMPARISON_DIMENSION_UNSUPPORTED'
            : 'COMPARISON_SET_TOO_SMALL',
        ]);
      }
      break;
    case 'WEB_VS_PUBLISHED_MYSTERY': {
      const forms = new Set(
        input.candidate.subjects
          .map((subject) => subject.expressionForm)
          .filter((form) => form !== null),
      );
      if (
        candidateWorkIds.length < 2 ||
        !forms.has('WEB_SERIALIZED') ||
        !forms.has('PUBLISHED_EDITION')
      ) {
        return result(input, fingerprint, 'INSUFFICIENT_COMPARISON_SET', [
          'FORM_CLASSIFICATION_REQUIRED',
        ]);
      }
      break;
    }
    case 'MYSTERY_AND_CULTURAL_PHENOMENON': {
      const referenced = new Set(input.candidate.contextClaimIds);
      const usableContext = input.contextClaims.some(
        (claim) =>
          referenced.has(claim.claimId) &&
          !claim.contextOnly &&
          (claim.factStatus === 'VERIFIED' || claim.factStatus === 'SUPPORTED_NOT_VERIFIED') &&
          candidateWorkIds.includes(claim.workId),
      );
      if (!usableContext) {
        return result(input, fingerprint, 'FACT_BLOCKED', ['CONTEXT_FACT_REQUIRED']);
      }
      break;
    }
  }

  if (
    candidatePermissions.some(
      (permission) =>
        permission.spoiler.level !== input.candidate.spoilerLevel ||
        !permission.spoiler.satisfied ||
        permission.spoiler.userConfirmationRequired !==
          input.candidate.spoilerPolicy.userConfirmationRequired ||
        permission.spoiler.warningPlacement !== input.candidate.spoilerPolicy.warningPlacement ||
        permission.spoiler.warningRequired !== input.candidate.spoilerPolicy.warningRequired,
    )
  ) {
    const reasons: TopicReasonCode[] = ['SPOILER_POLICY_INCOMPLETE'];
    if (input.candidate.contentType === 'FULL_TRICK_LOGIC_ANALYSIS') {
      reasons.push('FULL_TRICK_WARNING_REQUIRED');
    }
    return result(input, fingerprint, 'SPOILER_POLICY_INCOMPLETE', reasons);
  }

  const eligibleReasons: TopicReasonCode[] = ['ELIGIBLE_CURRENT_INPUTS'];
  if (input.candidate.contentType === 'FULL_TRICK_LOGIC_ANALYSIS') {
    if (
      !input.candidate.spoilerPolicy.warningRequired ||
      !input.candidate.spoilerPolicy.userConfirmationRequired ||
      input.candidate.spoilerPolicy.warningPlacement !== 'COVER_TITLE_AND_BODY_OPENING'
    ) {
      return result(input, fingerprint, 'SPOILER_POLICY_INCOMPLETE', [
        'FULL_TRICK_WARNING_REQUIRED',
      ]);
    }
    eligibleReasons.push('FULL_TRICK_WARNING_REQUIRED');
  }
  return result(input, fingerprint, 'ELIGIBLE', eligibleReasons);
}

export interface TopicRankingComponentResult {
  readonly dependencyKeys: readonly string[];
  readonly knowledgeState: 'KNOWN' | 'UNKNOWN';
  readonly policyVersion: typeof TOPIC_RANKING_POLICY_VERSION;
  readonly reasonCodes: readonly TopicReasonCode[];
  readonly type: TopicRankingComponent;
  readonly valueBasisPoints: number | null;
}

export interface TopicRankingResult {
  readonly complete: boolean;
  readonly components: Readonly<Record<TopicRankingComponent, TopicRankingComponentResult>>;
  readonly fingerprint: string;
  readonly knownComponentCount: number;
  readonly policyVersion: typeof TOPIC_RANKING_POLICY_VERSION;
  readonly tieBreakKey: string;
  readonly totalBasisPoints: number;
}

function knownComponent(
  type: TopicRankingComponent,
  value: number,
  reasons: readonly TopicReasonCode[],
  dependencyKeys: readonly string[],
): TopicRankingComponentResult {
  return Object.freeze({
    dependencyKeys: uniqueSorted(dependencyKeys),
    knowledgeState: 'KNOWN',
    policyVersion: TOPIC_RANKING_POLICY_VERSION,
    reasonCodes: uniqueSorted(reasons),
    type,
    valueBasisPoints: Math.max(0, Math.min(10_000, Math.trunc(value))),
  });
}

function unknownComponent(
  type: TopicRankingComponent,
  reason: TopicReasonCode,
  dependencyKeys: readonly string[],
): TopicRankingComponentResult {
  return Object.freeze({
    dependencyKeys: uniqueSorted(dependencyKeys),
    knowledgeState: 'UNKNOWN',
    policyVersion: TOPIC_RANKING_POLICY_VERSION,
    reasonCodes: Object.freeze([reason, 'RANKING_COMPONENT_UNKNOWN'] as const),
    type,
    valueBasisPoints: null,
  });
}

function contentFit(candidate: TopicCandidateDraft): number {
  const distinctWorks = workIds(candidate).length;
  const base: Readonly<Record<TopicCandidateDraft['contentType'], number>> = {
    CROSS_WORK_COMPARISON: 8_600,
    FULL_TRICK_LOGIC_ANALYSIS: 9_200,
    MYSTERY_AND_CULTURAL_PHENOMENON: 8_300,
    NON_SPOILER_SINGLE_BOOK_VERDICT: 9_500,
    WEB_VS_PUBLISHED_MYSTERY: 8_800,
  };
  const subjectAdjustment =
    candidate.contentType === 'CROSS_WORK_COMPARISON' ||
    candidate.contentType === 'WEB_VS_PUBLISHED_MYSTERY'
      ? Math.min(500, Math.max(0, distinctWorks - 2) * 100)
      : 0;
  return Math.min(10_000, base[candidate.contentType] + subjectAdjustment);
}

export function evaluateTopicRanking(rawInput: unknown): TopicRankingResult {
  const input = assertTopicRankingInput(rawInput);
  const fingerprint = fingerprintFor(input.candidate).fingerprint;
  const dependencies = uniqueSorted(input.dependencyKeys);
  let components: Readonly<Record<TopicRankingComponent, TopicRankingComponentResult>>;

  if (input.eligibility !== 'ELIGIBLE') {
    components = Object.freeze(
      Object.fromEntries(
        TOPIC_RANKING_COMPONENTS.map((type) => [
          type,
          unknownComponent(type, 'RANKING_COMPONENT_UNKNOWN', dependencies),
        ]),
      ) as unknown as Record<TopicRankingComponent, TopicRankingComponentResult>,
    );
  } else {
    const coverage =
      input.dossiers.length === 0
        ? 0
        : Math.trunc(
            input.dossiers.reduce((sum, dossier) => sum + dossier.coverageBasisPoints, 0) /
              input.dossiers.length,
          );
    const gaps = input.dossiers.reduce((sum, dossier) => sum + dossier.gapCount, 0);
    const blocked = input.dossiers.reduce((sum, dossier) => sum + dossier.blockedCount, 0);
    const evidenceValue = Math.max(0, coverage - Math.min(3_000, gaps * 150 + blocked * 750));
    const evidenceReasons: TopicReasonCode[] = ['EVIDENCE_COVERAGE'];
    if (gaps > 0) evidenceReasons.push('EVIDENCE_GAPS');
    if (blocked > 0) evidenceReasons.push('EVIDENCE_BLOCKED');

    components = Object.freeze({
      APPROVAL_WORKLOAD:
        input.approvalWorkloadUnits === null
          ? unknownComponent('APPROVAL_WORKLOAD', 'WORKLOAD_UNKNOWN', dependencies)
          : knownComponent(
              'APPROVAL_WORKLOAD',
              10_000 - input.approvalWorkloadUnits * 350,
              ['WORKLOAD_ESTIMATED_UNITS'],
              dependencies,
            ),
      CONTENT_FIT: knownComponent(
        'CONTENT_FIT',
        contentFit(input.candidate),
        ['CONTENT_TYPE_FIT'],
        dependencies,
      ),
      DIFFERENTIATION: knownComponent(
        'DIFFERENTIATION',
        10_000 - input.sameSubjectTopicCount * 1_250,
        ['SEMANTIC_DIFFERENTIATION'],
        dependencies,
      ),
      ESTIMATED_COST:
        input.estimatedExternalCostMicrousd === null
          ? unknownComponent('ESTIMATED_COST', 'COST_UNKNOWN', dependencies)
          : knownComponent(
              'ESTIMATED_COST',
              10_000 - Math.trunc(input.estimatedExternalCostMicrousd / 100),
              ['COST_KNOWN_LOCAL_ONLY'],
              dependencies,
            ),
      EVIDENCE_SUFFICIENCY: knownComponent(
        'EVIDENCE_SUFFICIENCY',
        evidenceValue,
        evidenceReasons,
        dependencies,
      ),
    });
  }

  const knownComponentCount = TOPIC_RANKING_COMPONENTS.filter(
    (type) => components[type].knowledgeState === 'KNOWN',
  ).length;
  const weightedTotal = TOPIC_RANKING_COMPONENTS.reduce((sum, type) => {
    const value = components[type].valueBasisPoints;
    return sum + (value === null ? 0 : Math.trunc((value * TOPIC_RANKING_WEIGHTS[type]) / 10_000));
  }, 0);
  const tieBreakKey = `${fingerprint}:${topicSemanticHash({
    components: TOPIC_RANKING_COMPONENTS.map((type) => ({
      state: components[type].knowledgeState,
      type,
      value: components[type].valueBasisPoints,
    })),
    policyVersion: TOPIC_RANKING_POLICY_VERSION,
  })}`;
  return Object.freeze({
    complete: knownComponentCount === TOPIC_RANKING_COMPONENTS.length,
    components,
    fingerprint,
    knownComponentCount,
    policyVersion: TOPIC_RANKING_POLICY_VERSION,
    tieBreakKey,
    totalBasisPoints: weightedTotal,
  });
}

export interface RankedTopicForComparison {
  readonly ranking: TopicRankingResult;
  readonly topicId: string;
}

export function compareRankedTopics(
  left: RankedTopicForComparison,
  right: RankedTopicForComparison,
): number {
  if (left.ranking.totalBasisPoints !== right.ranking.totalBasisPoints) {
    return right.ranking.totalBasisPoints - left.ranking.totalBasisPoints;
  }
  if (left.ranking.knownComponentCount !== right.ranking.knownComponentCount) {
    return right.ranking.knownComponentCount - left.ranking.knownComponentCount;
  }
  for (const type of TOPIC_RANKING_COMPONENTS) {
    const leftValue = left.ranking.components[type].valueBasisPoints ?? -1;
    const rightValue = right.ranking.components[type].valueBasisPoints ?? -1;
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  const tieBreak = left.ranking.tieBreakKey.localeCompare(right.ranking.tieBreakKey);
  return tieBreak === 0 ? left.topicId.localeCompare(right.topicId) : tieBreak;
}

export function assertFrozenFirst30Profile(): void {
  const total = Object.values(FIRST_30_QUOTAS).reduce((sum, count) => sum + count, 0);
  if (total !== 30 || Object.keys(FIRST_30_QUOTAS).length !== 5) {
    throw new TypeError('FIRST_30_V1 has been mutated.');
  }
}
