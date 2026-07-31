import {
  FACT_MAPPING_CHECKER_VERSION,
  STATEMENT_DISPOSITIONS,
  type StatementDisposition,
} from './constants.js';
import {
  isSatisfyingRelation,
  type FactMappingRollupV1,
  type FactMappingStatementResultV1,
  type StatementClaimMappingV1,
  type DraftStatementV1,
} from './contracts.js';

export function evaluateStatementDisposition(input: {
  readonly mapping: StatementClaimMappingV1 | null;
  readonly signalsUnacknowledged: number;
  readonly statement: DraftStatementV1;
}): FactMappingStatementResultV1 {
  const classification = input.statement.classification;
  let disposition: StatementDisposition;
  const reasons: string[] = [];
  if (classification.kind === 'MIXED' || classification.kind === 'AMBIGUOUS') {
    disposition = 'NEEDS_REVIEW';
    reasons.push('STATEMENT_REVIEW_REQUIRED');
  } else if (input.signalsUnacknowledged > 0 && classification.kind !== 'FACT') {
    disposition = 'NEEDS_REVIEW';
    reasons.push('PROTECTED_SIGNAL_UNACKNOWLEDGED');
  } else if (classification.kind !== 'FACT') {
    disposition = classification.requiresReview ? 'NEEDS_REVIEW' : 'NOT_APPLICABLE';
    if (classification.requiresReview) reasons.push('CLASSIFICATION_REVIEW_REQUIRED');
  } else if (input.mapping === null || input.mapping.relation === 'NO_CLAIM') {
    disposition =
      classification.materiality === 'KEY_FACT' ? 'BLOCKING_KEY_FACT' : 'UNMAPPED_SUPPORTING_FACT';
    reasons.push('NO_CLAIM');
  } else if (input.mapping.relation === 'STALE') {
    disposition = 'STALE';
    reasons.push('MAPPING_STALE');
  } else if (
    input.mapping.evaluationStatus === 'CONFLICTED' ||
    input.mapping.evaluationStatus === 'FACT_BLOCKED'
  ) {
    disposition = 'CONFLICTED';
    reasons.push('FACT_CONFLICT_UNRESOLVED');
  } else if (
    !isSatisfyingRelation(input.mapping.relation) ||
    input.mapping.compatibility?.compatible !== true
  ) {
    disposition =
      classification.materiality === 'KEY_FACT' ? 'BLOCKING_KEY_FACT' : 'UNMAPPED_SUPPORTING_FACT';
    reasons.push(input.mapping.compatibility?.reasonCode ?? input.mapping.relation);
  } else if (
    !input.mapping.claimCurrent ||
    input.mapping.evaluationId === null ||
    input.mapping.evaluationPolicyVersion === null ||
    input.mapping.evaluationStatus !== 'VERIFIED' ||
    !input.mapping.factPolicySatisfied ||
    input.mapping.evidenceIds.length === 0 ||
    input.mapping.sourceRevisionIds.length === 0
  ) {
    disposition =
      classification.materiality === 'KEY_FACT' ? 'BLOCKING_KEY_FACT' : 'UNMAPPED_SUPPORTING_FACT';
    reasons.push(
      !input.mapping.claimCurrent
        ? 'CLAIM_NOT_CURRENT'
        : input.mapping.evaluationStatus !== 'VERIFIED'
          ? 'FACT_EVALUATION_NOT_VERIFIED'
          : !input.mapping.factPolicySatisfied
            ? input.mapping.factPolicyReasonCode
            : input.mapping.evidenceIds.length === 0 || input.mapping.sourceRevisionIds.length === 0
              ? 'EVIDENCE_TRACE_MISSING'
              : 'FACT_EVALUATION_MISSING',
    );
  } else {
    disposition = 'SATISFIED';
  }
  return Object.freeze({
    disposition,
    mapping: input.mapping,
    reasonCodes: Object.freeze(reasons),
    statement: input.statement,
    unacknowledgedSignalCount: input.signalsUnacknowledged,
  });
}

export function rollupFactMapping(
  results: readonly FactMappingStatementResultV1[],
  options: { readonly warningBoundaryEscapeCount?: number } = {},
): FactMappingRollupV1 {
  const counts = Object.fromEntries(STATEMENT_DISPOSITIONS.map((value) => [value, 0])) as Record<
    StatementDisposition,
    number
  >;
  for (const item of results) counts[item.disposition] += 1;
  const warningBoundaryEscapeCount = options.warningBoundaryEscapeCount ?? 0;
  if (!Number.isSafeInteger(warningBoundaryEscapeCount) || warningBoundaryEscapeCount < 0) {
    throw new TypeError('warningBoundaryEscapeCount must be a non-negative integer.');
  }
  counts.NEEDS_REVIEW += warningBoundaryEscapeCount;
  const reasons = [
    ...new Set([
      ...results.flatMap(({ reasonCodes }) => reasonCodes),
      ...(warningBoundaryEscapeCount > 0 ? ['WARNING_BOUNDARY_ESCAPE'] : []),
    ]),
  ].sort();
  const blocked = counts.BLOCKING_KEY_FACT > 0 || counts.CONFLICTED > 0;
  const review = counts.NEEDS_REVIEW > 0 || counts.UNMAPPED_SUPPORTING_FACT > 0 || counts.STALE > 0;
  return Object.freeze({
    counts: Object.freeze(counts),
    reasonCodes: Object.freeze(reasons),
    status: blocked ? 'FACT_BLOCKED' : review ? 'AWAITING_REVIEW' : 'PASS',
    warningBoundaryEscapeCount,
  });
}

export const FACT_MAPPING_QUALITY_SUMMARY = Object.freeze({
  checkerVersion: FACT_MAPPING_CHECKER_VERSION,
  passDoesNotAdvanceOverallQuality: true,
  qualityCheckType: 'FACT_MAPPING' as const,
});
