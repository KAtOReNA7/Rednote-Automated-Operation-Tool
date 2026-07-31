import type { ClaimCandidateV1 } from './contracts.js';

export interface MappingFactPolicyResultV1 {
  readonly reasonCode:
    | 'CONTRADICTING_EVIDENCE'
    | 'DEPENDENT_OR_CONTEXT_ONLY'
    | 'EVALUATION_NOT_VERIFIED'
    | 'NO_CURRENT_EVIDENCE'
    | 'OFFICIAL_PRIMARY_VERIFIED'
    | 'SECONDARY_INDEPENDENCE_INSUFFICIENT'
    | 'TWO_INDEPENDENT_SECONDARIES_VERIFIED';
  readonly satisfied: boolean;
}

export function evaluateCandidateFactPolicy(
  candidate: ClaimCandidateV1,
): MappingFactPolicyResultV1 {
  if (candidate.evaluation?.status !== 'VERIFIED') {
    return Object.freeze({
      reasonCode: 'EVALUATION_NOT_VERIFIED',
      satisfied: false,
    });
  }
  const current = candidate.evidence.filter(
    ({ availability, current, evidence }) =>
      current && availability === 'AVAILABLE' && evidence.verificationStatus === 'VALIDATED',
  );
  if (current.length === 0) {
    return Object.freeze({ reasonCode: 'NO_CURRENT_EVIDENCE', satisfied: false });
  }
  if (current.some(({ evidence }) => evidence.relation === 'CONTRADICTS')) {
    return Object.freeze({
      reasonCode: 'CONTRADICTING_EVIDENCE',
      satisfied: false,
    });
  }
  const supporting = current.filter(({ evidence }) => evidence.relation === 'SUPPORTS');
  if (
    supporting.some(
      ({ authorityTier, originKind, useClass }) =>
        authorityTier === 'OFFICIAL_PRIMARY' &&
        originKind !== 'BROWSER_CLIP' &&
        useClass === 'KEY_FACT_ELIGIBLE',
    )
  ) {
    return Object.freeze({
      reasonCode: 'OFFICIAL_PRIMARY_VERIFIED',
      satisfied: true,
    });
  }
  const independentGroups = new Set(
    supporting
      .filter(
        ({ authorityTier, independence, lineageGroup, originKind, useClass }) =>
          authorityTier === 'INDEPENDENT_SECONDARY' &&
          independence === 'CONFIRMED_INDEPENDENT' &&
          lineageGroup !== null &&
          originKind !== 'BROWSER_CLIP' &&
          useClass === 'KEY_FACT_ELIGIBLE',
      )
      .map(({ lineageGroup }) => lineageGroup),
  );
  if (independentGroups.size >= 2) {
    return Object.freeze({
      reasonCode: 'TWO_INDEPENDENT_SECONDARIES_VERIFIED',
      satisfied: true,
    });
  }
  return Object.freeze({
    reasonCode: supporting.some(
      ({ independence, useClass }) =>
        independence === 'DEPENDENT' ||
        useClass === 'CONTEXT_ONLY' ||
        useClass === 'SUPPORTING_ONLY',
    )
      ? 'DEPENDENT_OR_CONTEXT_ONLY'
      : 'SECONDARY_INDEPENDENCE_INSUFFICIENT',
    satisfied: false,
  });
}
