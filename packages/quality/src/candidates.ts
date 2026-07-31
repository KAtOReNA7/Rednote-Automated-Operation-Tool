import type { AtomicClaimV1 } from '@mystery-operations/evidence';

import { CLAIM_CANDIDATE_POLICY_VERSION, FACT_MAPPING_LIMITS } from './constants.js';
import type {
  ClaimCandidateSetV1,
  ClaimCandidateV1,
  FactEvaluationSnapshotV1,
  SourceEvidenceTraceV1,
} from './contracts.js';
import { factMappingHash } from './identity.js';

export interface CandidateRecordV1 {
  readonly claim: AtomicClaimV1;
  readonly current: boolean;
  readonly evaluation: FactEvaluationSnapshotV1 | null;
  readonly evidence: readonly SourceEvidenceTraceV1[];
  readonly provenance: readonly ('BRIEF_EVIDENCE' | 'CANONICAL_SUBJECT' | 'DRAFT_LINEAGE')[];
  readonly redirectedFromIds?: readonly string[];
}

export function buildClaimCandidateSet(
  records: readonly CandidateRecordV1[],
  input: {
    readonly allowedClaimIds: ReadonlySet<string>;
    readonly allowedEvidenceIds: ReadonlySet<string>;
    readonly allowedSubjectIds: ReadonlySet<string>;
    readonly workIds: ReadonlySet<string>;
  },
): ClaimCandidateSetV1 {
  const canonical = new Map<string, CandidateRecordV1>();
  for (const record of records) {
    if (
      !input.allowedClaimIds.has(record.claim.claimId) &&
      !input.allowedSubjectIds.has(record.claim.subject.id)
    ) {
      continue;
    }
    if (
      record.claim.subject.type === 'WORK' &&
      input.workIds.size > 0 &&
      !input.workIds.has(record.claim.subject.id)
    ) {
      continue;
    }
    const evidence = record.evidence.filter(
      ({ evidence: item }) =>
        record.provenance.includes('CANONICAL_SUBJECT') ||
        input.allowedEvidenceIds.has(item.evidenceId),
    );
    canonical.set(record.claim.claimId, { ...record, evidence });
  }
  const ordered = [...canonical.values()].sort((left, right) => {
    const leftScope = factMappingHash(left.claim.scope);
    const rightScope = factMappingHash(right.claim.scope);
    return (
      left.claim.subject.type.localeCompare(right.claim.subject.type) ||
      left.claim.subject.id.localeCompare(right.claim.subject.id) ||
      left.claim.predicate.localeCompare(right.claim.predicate) ||
      leftScope.localeCompare(rightScope) ||
      left.claim.claimId.localeCompare(right.claim.claimId)
    );
  });
  const truncated = ordered.length > FACT_MAPPING_LIMITS.candidateClaims;
  let remainingSourceRevisions = FACT_MAPPING_LIMITS.sourceRevisions;
  const candidates: ClaimCandidateV1[] = ordered
    .slice(0, FACT_MAPPING_LIMITS.candidateClaims)
    .map((record) => {
      const orderedEvidence = [...record.evidence].sort(
        (left, right) =>
          left.sourceId.localeCompare(right.sourceId) ||
          left.sourceRevision - right.sourceRevision ||
          left.evidence.evidenceId.localeCompare(right.evidence.evidenceId),
      );
      const evidenceLimit = Math.min(
        FACT_MAPPING_LIMITS.evidencePerClaim,
        remainingSourceRevisions,
      );
      const boundedEvidence = orderedEvidence.slice(0, evidenceLimit);
      remainingSourceRevisions -= boundedEvidence.length;
      const value = {
        candidateHash: '',
        claim: record.claim,
        current: record.current,
        evaluation: record.evaluation,
        evidence: Object.freeze(boundedEvidence),
        policyVersion: CLAIM_CANDIDATE_POLICY_VERSION,
        provenance: Object.freeze(
          [...new Set(record.provenance)].sort(),
        ) as ClaimCandidateV1['provenance'],
        redirectedFromIds: Object.freeze([...(record.redirectedFromIds ?? [])].sort()),
      };
      return Object.freeze({ ...value, candidateHash: factMappingHash(value) });
    });
  const identity = candidates.map(({ candidateHash, claim }) => [
    claim.claimId,
    claim.revision,
    candidateHash,
  ]);
  return Object.freeze({
    candidates: Object.freeze(candidates),
    dependencyHash: factMappingHash(
      candidates.flatMap(({ claim, evaluation, evidence }) => [
        [claim.claimId, claim.revision, claim.semanticFingerprint],
        [
          evaluation?.evaluationId ?? null,
          evaluation?.revision ?? null,
          evaluation?.inputIdentityHash ?? null,
        ],
        ...evidence.map((item) => [
          item.evidence.evidenceId,
          item.evidence.revision,
          item.sourceId,
          item.sourceRevision,
          item.sourceContentHash,
          item.availability,
        ]),
      ]),
    ),
    inputHash: factMappingHash(identity),
    policyVersion: CLAIM_CANDIDATE_POLICY_VERSION,
    truncated:
      truncated ||
      ordered.some(({ evidence }) => evidence.length > FACT_MAPPING_LIMITS.evidencePerClaim) ||
      ordered.reduce((total, { evidence }) => total + evidence.length, 0) >
        FACT_MAPPING_LIMITS.sourceRevisions,
  });
}
