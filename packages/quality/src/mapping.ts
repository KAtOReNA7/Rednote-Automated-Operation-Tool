import { checkTypedFactCompatibility } from './compatibility.js';
import type {
  ClaimCandidateV1,
  DraftStatementV1,
  StatementClaimMappingV1,
  TypedFactCompatibilityResultV1,
} from './contracts.js';
import { evaluateCandidateFactPolicy } from './fact-policy.js';
import { factMappingHash } from './identity.js';
import type { MappingRelation, StatementProvenance } from './constants.js';

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

export function createStatementClaimMapping(input: {
  readonly candidate: ClaimCandidateV1;
  readonly compatibility?: TypedFactCompatibilityResultV1;
  readonly createdAt: string;
  readonly expectedSubjectId?: string;
  readonly mapperProvenance: StatementProvenance;
  readonly reason: string | null;
  readonly relation: MappingRelation;
  readonly statement: DraftStatementV1;
  readonly statementText: string;
}): StatementClaimMappingV1 {
  const compatibility =
    input.compatibility ??
    checkTypedFactCompatibility({
      claim: input.candidate.claim,
      ...(input.expectedSubjectId === undefined
        ? {}
        : { expectedSubjectId: input.expectedSubjectId }),
      relation: input.relation,
      statementText: input.statementText,
    });
  const policy = evaluateCandidateFactPolicy(input.candidate);
  const evidenceIds = uniqueSorted(
    input.candidate.evidence.map(({ evidence }) => evidence.evidenceId),
  );
  const sourceRevisionIds = uniqueSorted(
    input.candidate.evidence.map(({ sourceRevisionId }) => sourceRevisionId),
  );
  const identity = {
    candidateHash: input.candidate.candidateHash,
    claimId: input.candidate.claim.claimId,
    claimRevision: input.candidate.claim.revision,
    evaluationId: input.candidate.evaluation?.evaluationId ?? null,
    mapperProvenance: input.mapperProvenance,
    reason: input.reason,
    relation: input.relation,
    statementId: input.statement.statementId,
    statementRevision: input.statement.revision,
  };
  return Object.freeze({
    candidateProvenance: input.candidate.provenance,
    claimCurrent: input.candidate.current,
    claimId: input.candidate.claim.claimId,
    claimRevision: input.candidate.claim.revision,
    compatibility,
    createdAt: input.createdAt,
    evaluationId: input.candidate.evaluation?.evaluationId ?? null,
    evaluationPolicyVersion: input.candidate.evaluation?.policyVersion ?? null,
    evaluationRevision: input.candidate.evaluation?.revision ?? null,
    evaluationStatus: input.candidate.evaluation?.status ?? null,
    evidenceIds,
    factPolicyReasonCode: policy.reasonCode,
    factPolicySatisfied: policy.satisfied,
    inputHash: factMappingHash(identity),
    mapperProvenance: input.mapperProvenance,
    mappingId: `mapping-${factMappingHash(identity).slice(0, 32)}`,
    reason: input.reason,
    relation: input.relation,
    semanticHash: factMappingHash({
      compatibility,
      identity,
      policy,
    }),
    sourceRevisionIds,
    statementId: input.statement.statementId,
    statementRevision: input.statement.revision,
  });
}
