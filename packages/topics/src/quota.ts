import {
  FIRST_30_PROFILE_ID,
  FIRST_30_QUOTAS,
  FIRST_30_TOTAL,
  TOPIC_CONTENT_TYPES,
  TOPIC_LIMITS,
  TOPIC_QUOTA_SOLVER_VERSION,
  type TopicCandidateState,
  type TopicContentType,
  type TopicEligibilityState,
  type TopicReasonCode,
} from './constants.js';
import { TopicError } from './errors.js';
import { topicSemanticHash } from './identity.js';
import { compareRankedTopics, type TopicRankingResult } from './policy.js';

export interface TopicQuotaCandidate {
  readonly contentType: TopicContentType;
  readonly eligibility: TopicEligibilityState;
  readonly estimatedExternalCostMicrousd: number | null;
  readonly fingerprint: string;
  readonly ranking: TopicRankingResult;
  readonly revision: number;
  readonly state: TopicCandidateState;
  readonly topicId: string;
  readonly topicVersionId: string;
  readonly workIds: readonly string[];
  readonly workloadUnits: number | null;
}

export interface TopicQuotaSolveInput {
  readonly candidates: readonly TopicQuotaCandidate[];
  readonly maxWorkExposure: number;
  readonly profileId: string;
}

export interface TopicQuotaPlanMember {
  readonly contentType: TopicContentType;
  readonly fingerprint: string;
  readonly locked: boolean;
  readonly position: number;
  readonly reasonCodes: readonly TopicReasonCode[];
  readonly scoreBasisPoints: number;
  readonly topicId: string;
  readonly topicVersionId: string;
}

export interface TopicQuotaCategoryResult {
  readonly archivedCount: number;
  readonly conflicts: readonly {
    readonly code: 'OVER_LOCKED';
    readonly topicIds: readonly string[];
  }[];
  readonly contentType: TopicContentType;
  readonly heldCount: number;
  readonly lockedEligibleCount: number;
  readonly required: number;
  readonly selected: number;
  readonly shortfall: number;
}

export interface TopicQuotaPlanResult {
  readonly categories: Readonly<Record<TopicContentType, TopicQuotaCategoryResult>>;
  readonly estimatedExternalCost: {
    readonly state: 'KNOWN' | 'UNKNOWN';
    readonly valueMicrousd: number | null;
  };
  readonly members: readonly TopicQuotaPlanMember[];
  readonly poolSnapshotHash: string;
  readonly profileId: typeof FIRST_30_PROFILE_ID;
  readonly requestedByProfileId: string;
  readonly solverVersion: typeof TOPIC_QUOTA_SOLVER_VERSION;
  readonly status: 'COMPLETE' | 'INCOMPLETE';
  readonly totalRequired: typeof FIRST_30_TOTAL;
  readonly totalSelected: number;
  readonly warnings: readonly string[];
  readonly workload: {
    readonly state: 'KNOWN' | 'UNKNOWN';
    readonly units: number | null;
  };
}

function invalid(): never {
  throw new TopicError('TOPIC_INVALID_CONTRACT');
}

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

function validateCandidate(candidate: TopicQuotaCandidate): void {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    !TOPIC_CONTENT_TYPES.includes(candidate.contentType) ||
    !Number.isSafeInteger(candidate.revision) ||
    candidate.revision < 1 ||
    typeof candidate.topicId !== 'string' ||
    candidate.topicId.length === 0 ||
    typeof candidate.topicVersionId !== 'string' ||
    candidate.topicVersionId.length === 0 ||
    !/^[0-9a-f]{64}$/u.test(candidate.fingerprint) ||
    !isArray(candidate.workIds) ||
    candidate.workIds.length < 1 ||
    candidate.workIds.length > TOPIC_LIMITS.maxSubjects ||
    new Set(candidate.workIds).size !== candidate.workIds.length ||
    !Number.isSafeInteger(candidate.ranking.totalBasisPoints) ||
    candidate.ranking.totalBasisPoints < 0 ||
    candidate.ranking.totalBasisPoints > 10_000
  ) {
    invalid();
  }
}

function candidateOrder(left: TopicQuotaCandidate, right: TopicQuotaCandidate): number {
  return compareRankedTopics(
    { ranking: left.ranking, topicId: left.topicId },
    { ranking: right.ranking, topicId: right.topicId },
  );
}

export function solveFirst30Quota(rawInput: TopicQuotaSolveInput): TopicQuotaPlanResult {
  if (
    rawInput === null ||
    typeof rawInput !== 'object' ||
    !isArray(rawInput.candidates) ||
    rawInput.candidates.length > TOPIC_LIMITS.maxPlanCandidates ||
    typeof rawInput.profileId !== 'string' ||
    rawInput.profileId.length < 1 ||
    !Number.isSafeInteger(rawInput.maxWorkExposure) ||
    rawInput.maxWorkExposure < 1 ||
    rawInput.maxWorkExposure > TOPIC_LIMITS.maxWorkExposure
  ) {
    invalid();
  }
  rawInput.candidates.forEach(validateCandidate);
  if (
    new Set(rawInput.candidates.map((candidate) => candidate.topicId)).size !==
    rawInput.candidates.length
  ) {
    invalid();
  }

  const stableCandidates = [...rawInput.candidates].sort((left, right) =>
    left.topicId.localeCompare(right.topicId),
  );
  const poolSnapshotHash = topicSemanticHash({
    candidates: stableCandidates.map((candidate) => ({
      contentType: candidate.contentType,
      eligibility: candidate.eligibility,
      fingerprint: candidate.fingerprint,
      revision: candidate.revision,
      score: candidate.ranking.totalBasisPoints,
      state: candidate.state,
      topicId: candidate.topicId,
      topicVersionId: candidate.topicVersionId,
    })),
    maxWorkExposure: rawInput.maxWorkExposure,
    profile: FIRST_30_PROFILE_ID,
    solverVersion: TOPIC_QUOTA_SOLVER_VERSION,
  });

  const selectedTopicIds = new Set<string>();
  const selectedFingerprints = new Set<string>();
  const exposure = new Map<string, number>();
  const members: TopicQuotaPlanMember[] = [];
  const warnings: string[] = [];
  const categories = {} as Record<TopicContentType, TopicQuotaCategoryResult>;

  for (const contentType of TOPIC_CONTENT_TYPES) {
    const required = FIRST_30_QUOTAS[contentType];
    const category = stableCandidates.filter((candidate) => candidate.contentType === contentType);
    const eligible = category.filter(
      (candidate) =>
        candidate.eligibility === 'ELIGIBLE' &&
        candidate.state !== 'HELD' &&
        candidate.state !== 'ARCHIVED',
    );
    const locked = eligible
      .filter((candidate) => candidate.state === 'LOCKED')
      .sort(candidateOrder);
    const conflicts: { readonly code: 'OVER_LOCKED'; readonly topicIds: readonly string[] }[] = [];
    if (locked.length > required) {
      const topicIds = Object.freeze(locked.map((candidate) => candidate.topicId).sort());
      conflicts.push(Object.freeze({ code: 'OVER_LOCKED', topicIds }));
      warnings.push(`OVER_LOCKED:${contentType}`);
    }
    const ordered =
      locked.length > required
        ? locked
        : [
            ...locked,
            ...eligible.filter((candidate) => candidate.state !== 'LOCKED').sort(candidateOrder),
          ];

    let selectedForCategory = 0;
    for (const candidate of ordered) {
      if (locked.length <= required && selectedForCategory >= required) break;
      if (
        selectedTopicIds.has(candidate.topicId) ||
        selectedFingerprints.has(candidate.fingerprint)
      ) {
        continue;
      }
      const wouldExceed = candidate.workIds.some(
        (workId) => (exposure.get(workId) ?? 0) >= rawInput.maxWorkExposure,
      );
      if (wouldExceed) {
        warnings.push(`EXPOSURE_LIMIT_REACHED:${candidate.topicId}`);
        continue;
      }
      selectedTopicIds.add(candidate.topicId);
      selectedFingerprints.add(candidate.fingerprint);
      for (const workId of candidate.workIds) {
        exposure.set(workId, (exposure.get(workId) ?? 0) + 1);
      }
      selectedForCategory += 1;
      members.push(
        Object.freeze({
          contentType,
          fingerprint: candidate.fingerprint,
          locked: candidate.state === 'LOCKED',
          position: selectedForCategory,
          reasonCodes: Object.freeze(
            candidate.state === 'LOCKED'
              ? (['LOCKED_PRIORITY'] as const)
              : (['NO_CROSS_CATEGORY_SUBSTITUTION'] as const),
          ),
          scoreBasisPoints: candidate.ranking.totalBasisPoints,
          topicId: candidate.topicId,
          topicVersionId: candidate.topicVersionId,
        }),
      );
    }

    categories[contentType] = Object.freeze({
      archivedCount: category.filter((candidate) => candidate.state === 'ARCHIVED').length,
      conflicts: Object.freeze(conflicts),
      contentType,
      heldCount: category.filter((candidate) => candidate.state === 'HELD').length,
      lockedEligibleCount: locked.length,
      required,
      selected: selectedForCategory,
      shortfall: Math.max(0, required - selectedForCategory),
    });
  }

  const selectedCandidates = members.map((member) => {
    const candidate = stableCandidates.find(
      (candidateValue) => candidateValue.topicId === member.topicId,
    );
    if (candidate === undefined) throw new TopicError('TOPIC_INVALID_CONTRACT');
    return candidate;
  });
  const costUnknown = selectedCandidates.some(
    (candidate) => candidate.estimatedExternalCostMicrousd === null,
  );
  const workloadUnknown = selectedCandidates.some((candidate) => candidate.workloadUnits === null);
  const status =
    members.length === FIRST_30_TOTAL &&
    TOPIC_CONTENT_TYPES.every(
      (type) =>
        categories[type].selected === categories[type].required &&
        categories[type].conflicts.length === 0,
    )
      ? 'COMPLETE'
      : 'INCOMPLETE';
  if (status === 'INCOMPLETE') warnings.push('QUOTA_SHORTFALL_OR_CONFLICT');

  return Object.freeze({
    categories: Object.freeze(categories),
    estimatedExternalCost: Object.freeze({
      state: costUnknown ? 'UNKNOWN' : 'KNOWN',
      valueMicrousd: costUnknown
        ? null
        : selectedCandidates.reduce(
            (sum, candidate) => sum + (candidate.estimatedExternalCostMicrousd ?? 0),
            0,
          ),
    }),
    members: Object.freeze(members),
    poolSnapshotHash,
    profileId: FIRST_30_PROFILE_ID,
    requestedByProfileId: rawInput.profileId,
    solverVersion: TOPIC_QUOTA_SOLVER_VERSION,
    status,
    totalRequired: FIRST_30_TOTAL,
    totalSelected: members.length,
    warnings: Object.freeze([...new Set(warnings)].sort()),
    workload: Object.freeze({
      state: workloadUnknown ? 'UNKNOWN' : 'KNOWN',
      units: workloadUnknown
        ? null
        : selectedCandidates.reduce((sum, candidate) => sum + (candidate.workloadUnits ?? 0), 0),
    }),
  });
}
