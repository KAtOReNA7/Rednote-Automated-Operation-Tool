import {
  FACT_POLICY_VERSION,
  type FactEvaluationStatus,
  type SourceAuthorityTier,
  type SourceAvailabilityState,
  type SourceIndependenceState,
  type SourceUseClass,
  type EvidenceRelation,
} from './constants.js';

export interface FactPolicyEvidenceV1 {
  readonly availability: SourceAvailabilityState;
  readonly authorityTier: SourceAuthorityTier;
  readonly independence: SourceIndependenceState;
  readonly lineageGroup: string | null;
  readonly locatorValid: boolean;
  readonly relation: EvidenceRelation;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly useClass: SourceUseClass;
}

export interface FactPolicyInputV1 {
  readonly evidence: readonly FactPolicyEvidenceV1[];
  readonly modelMemoryOnly?: boolean;
  readonly policyVersion: typeof FACT_POLICY_VERSION;
  readonly stale: boolean;
  readonly unresolvedMaterialConflict: boolean;
}

export interface FactPolicyEvaluationV1 {
  readonly confirmedIndependentSecondaryCount: number;
  readonly contextCount: number;
  readonly officialPrimaryCount: number;
  readonly policyVersion: typeof FACT_POLICY_VERSION;
  readonly qualifyingSourceIds: readonly string[];
  readonly reason:
    | 'CONFLICT_BLOCKED'
    | 'CONTEXT_ONLY'
    | 'LOCATOR_INVALID'
    | 'MODEL_MEMORY_REJECTED'
    | 'NO_EVIDENCE'
    | 'OFFICIAL_PRIMARY'
    | 'SOURCE_UNAVAILABLE'
    | 'STALE_REVISION'
    | 'TWO_INDEPENDENT_SECONDARY'
    | 'USER_CONFLICT_DECISION'
    | 'VALID_SUPPORT_INSUFFICIENT';
  readonly status: FactEvaluationStatus;
}

export function evaluateFactPolicy(input: FactPolicyInputV1): FactPolicyEvaluationV1 {
  if (input.policyVersion !== FACT_POLICY_VERSION) {
    throw new TypeError('Unsupported FactPolicy version.');
  }
  const base = {
    confirmedIndependentSecondaryCount: 0,
    contextCount: input.evidence.filter(
      (item) => item.authorityTier === 'DISCUSSION_CONTEXT' || item.useClass === 'CONTEXT_ONLY',
    ).length,
    officialPrimaryCount: 0,
    policyVersion: FACT_POLICY_VERSION,
    qualifyingSourceIds: Object.freeze([]) as readonly string[],
  };
  if (input.modelMemoryOnly === true && input.evidence.length === 0) {
    return Object.freeze({ ...base, reason: 'MODEL_MEMORY_REJECTED', status: 'REJECTED' });
  }
  if (input.unresolvedMaterialConflict) {
    return Object.freeze({ ...base, reason: 'CONFLICT_BLOCKED', status: 'FACT_BLOCKED' });
  }
  if (input.evidence.length === 0) {
    return Object.freeze({ ...base, reason: 'NO_EVIDENCE', status: 'NOT_EVALUATED' });
  }
  if (input.stale) {
    return Object.freeze({ ...base, reason: 'STALE_REVISION', status: 'STALE_REVIEW_REQUIRED' });
  }
  const supported = input.evidence.filter((item) => item.relation === 'SUPPORTS');
  if (supported.some((item) => !item.locatorValid)) {
    return Object.freeze({ ...base, reason: 'LOCATOR_INVALID', status: 'REJECTED' });
  }
  const available = supported.filter((item) => item.availability === 'AVAILABLE');
  if (supported.length > 0 && available.length === 0) {
    return Object.freeze({
      ...base,
      reason: 'SOURCE_UNAVAILABLE',
      status: 'STALE_REVIEW_REQUIRED',
    });
  }
  const official = available.filter(
    (item) => item.authorityTier === 'OFFICIAL_PRIMARY' && item.useClass === 'KEY_FACT_ELIGIBLE',
  );
  const independent = available.filter(
    (item) =>
      item.authorityTier === 'INDEPENDENT_SECONDARY' &&
      item.useClass === 'KEY_FACT_ELIGIBLE' &&
      item.independence === 'CONFIRMED_INDEPENDENT' &&
      item.lineageGroup !== null,
  );
  const distinctIndependentGroups = new Map(
    independent.map((item) => [item.lineageGroup as string, item] as const),
  );
  const qualifying =
    official.length > 0 ? official : [...distinctIndependentGroups.values()].slice(0, 2);
  const counts = {
    ...base,
    confirmedIndependentSecondaryCount: distinctIndependentGroups.size,
    officialPrimaryCount: official.length,
    qualifyingSourceIds: Object.freeze(qualifying.map((item) => item.sourceId)),
  };
  if (official.length > 0) {
    return Object.freeze({ ...counts, reason: 'OFFICIAL_PRIMARY', status: 'VERIFIED' });
  }
  if (distinctIndependentGroups.size >= 2) {
    return Object.freeze({
      ...counts,
      reason: 'TWO_INDEPENDENT_SECONDARY',
      status: 'VERIFIED',
    });
  }
  if (
    available.every(
      (item) => item.authorityTier === 'DISCUSSION_CONTEXT' || item.useClass === 'CONTEXT_ONLY',
    )
  ) {
    return Object.freeze({ ...counts, reason: 'CONTEXT_ONLY', status: 'INSUFFICIENT' });
  }
  return Object.freeze({
    ...counts,
    reason: 'VALID_SUPPORT_INSUFFICIENT',
    status: 'SUPPORTED_NOT_VERIFIED',
  });
}
