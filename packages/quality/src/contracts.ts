import type { ContentDraftPayloadV1 } from '@mystery-operations/copy';
import type {
  AtomicClaimScopeV1,
  AtomicClaimV1,
  ClaimEvidenceV1,
  FactEvaluationStatus,
  SourceAuthorityTier,
  SourceAvailabilityState,
  SourceIndependenceState,
  SourceOriginKind,
  SourceUseClass,
} from '@mystery-operations/evidence';

import {
  type CLAIM_CANDIDATE_POLICY_VERSION,
  DRAFT_ARTIFACT_KINDS,
  type DRAFT_STATEMENT_CONTRACT_VERSION,
  DRAFT_TEXT_LOCATOR_VERSION,
  FACT_DOMAINS,
  FACT_MAPPING_ASSIST_SCHEMA_VERSION,
  type FACT_MAPPING_CHECKER_VERSION,
  FACT_MAPPING_CLASSIFICATION_VERSION,
  type FACT_MAPPING_CONTRACT_VERSION,
  FACT_MAPPING_DECISION_KINDS,
  FACT_MAPPING_LIMITS,
  FACT_MAPPING_MODES,
  FACT_MAPPING_RUN_STATUSES,
  type FACT_MAPPING_SEGMENTATION_VERSION,
  FACT_MATERIALITIES,
  MAPPING_RELATIONS,
  type PROTECTED_SIGNAL_POLICY_VERSION,
  STATEMENT_DISPOSITIONS,
  STATEMENT_KINDS,
  STATEMENT_PROVENANCE,
  type TYPED_FACT_COMPATIBILITY_VERSION,
  type DraftArtifactKind,
  type FactDomain,
  type FactMappingDecisionKind,
  type FactMappingMode,
  type FactMappingRunStatus,
  type FactMateriality,
  type MappingRelation,
  type ProtectedSignalKind,
  type StatementDisposition,
  type StatementKind,
  type StatementProvenance,
} from './constants.js';
import { FactMappingError } from './errors.js';
import { factMappingHash, normalizeDraftText } from './identity.js';

export interface DraftPublicArtifactV1 {
  readonly artifactId: string;
  readonly artifactKind: DraftArtifactKind;
  readonly codePointLength: number;
  readonly current: boolean;
  readonly draftId: string;
  readonly draftVersionId: string;
  readonly evidenceRefIds: readonly string[];
  readonly order: number | null;
  readonly profileId: ContentDraftPayloadV1['profileId'];
  readonly textHash: string;
  readonly workIds: readonly string[];
}

export interface DraftTextLocatorV1 {
  readonly artifactId: string;
  readonly artifactKind: DraftArtifactKind;
  readonly draftVersionId: string;
  readonly endCodePoint: number;
  readonly locatorVersion: typeof DRAFT_TEXT_LOCATOR_VERSION;
  readonly selectedTextHash: string;
  readonly startCodePoint: number;
  readonly textHash: string;
}

export interface DraftStatementClassificationV1 {
  readonly classificationVersion: typeof FACT_MAPPING_CLASSIFICATION_VERSION;
  readonly domain: FactDomain;
  readonly kind: StatementKind;
  readonly materiality: FactMateriality;
  readonly reasonCode: string;
  readonly requiresReview: boolean;
}

export interface DraftStatementV1 {
  readonly classification: DraftStatementClassificationV1;
  readonly contractVersion: typeof DRAFT_STATEMENT_CONTRACT_VERSION;
  readonly createdAt: string;
  readonly locator: DraftTextLocatorV1;
  readonly provenance: StatementProvenance;
  readonly revision: number;
  readonly segmentationVersion: typeof FACT_MAPPING_SEGMENTATION_VERSION;
  readonly statementId: string;
  readonly textHash: string;
}

export interface ProtectedSignalV1 {
  readonly acknowledged: boolean;
  readonly endCodePoint: number;
  readonly kind: ProtectedSignalKind;
  readonly policyVersion: typeof PROTECTED_SIGNAL_POLICY_VERSION;
  readonly reason: string | null;
  readonly signalId: string;
  readonly startCodePoint: number;
  readonly tokenHash: string;
}

export interface FactEvaluationSnapshotV1 {
  readonly createdAt: string;
  readonly evaluationId: string;
  readonly inputIdentityHash: string;
  readonly policyVersion: string;
  readonly reasonCode: string;
  readonly revision: number;
  readonly status: FactEvaluationStatus;
}

export interface SourceEvidenceTraceV1 {
  readonly authorityTier: SourceAuthorityTier;
  readonly availability: SourceAvailabilityState;
  readonly current: boolean;
  readonly displayHost: string | null;
  readonly evidence: ClaimEvidenceV1;
  readonly independence: SourceIndependenceState;
  readonly language: string;
  readonly lineageGroup: string | null;
  readonly originKind: SourceOriginKind;
  readonly publisherOrSite: string | null;
  readonly sourceContentHash: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly sourceRevisionId: string;
  readonly title: string;
  readonly useClass: SourceUseClass;
}

export interface ClaimCandidateV1 {
  readonly candidateHash: string;
  readonly claim: AtomicClaimV1;
  readonly current: boolean;
  readonly evaluation: FactEvaluationSnapshotV1 | null;
  readonly evidence: readonly SourceEvidenceTraceV1[];
  readonly policyVersion: typeof CLAIM_CANDIDATE_POLICY_VERSION;
  readonly provenance: readonly ('BRIEF_EVIDENCE' | 'CANONICAL_SUBJECT' | 'DRAFT_LINEAGE')[];
  readonly redirectedFromIds: readonly string[];
}

export interface ClaimCandidateSetV1 {
  readonly candidates: readonly ClaimCandidateV1[];
  readonly dependencyHash: string;
  readonly inputHash: string;
  readonly policyVersion: typeof CLAIM_CANDIDATE_POLICY_VERSION;
  readonly truncated: boolean;
}

export interface TypedFactCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly consumedValueCount: number;
  readonly reasonCode:
    | 'AWARD_PREDICATE_MISMATCH'
    | 'CLAIM_VALUE_NOT_VISIBLE'
    | 'COMPATIBLE'
    | 'COMPARISON_MISMATCH'
    | 'CURRENCY_MISMATCH'
    | 'DATE_PRECISION_MISMATCH'
    | 'IDENTIFIER_MISMATCH'
    | 'INVALID_TYPED_VALUE'
    | 'NUMERIC_VALUE_MISMATCH'
    | 'PERCENT_MISMATCH'
    | 'PREDICATE_MISMATCH'
    | 'RANGE_MISMATCH'
    | 'SCOPE_MISMATCH'
    | 'SUBJECT_MISMATCH'
    | 'STATEMENT_ADDS_VALUE'
    | 'UNIT_MISMATCH';
  readonly relation: MappingRelation;
  readonly statementValueCount: number;
  readonly version: typeof TYPED_FACT_COMPATIBILITY_VERSION;
}

export interface StatementClaimMappingV1 {
  readonly candidateProvenance: ClaimCandidateV1['provenance'];
  readonly claimId: string | null;
  readonly claimCurrent: boolean;
  readonly claimRevision: number | null;
  readonly compatibility: TypedFactCompatibilityResultV1 | null;
  readonly createdAt: string;
  readonly evidenceIds: readonly string[];
  readonly evaluationId: string | null;
  readonly evaluationPolicyVersion: string | null;
  readonly evaluationRevision: number | null;
  readonly evaluationStatus: FactEvaluationStatus | null;
  readonly factPolicyReasonCode: string;
  readonly factPolicySatisfied: boolean;
  readonly inputHash: string;
  readonly mapperProvenance: StatementProvenance;
  readonly mappingId: string;
  readonly reason: string | null;
  readonly relation: MappingRelation;
  readonly semanticHash: string;
  readonly sourceRevisionIds: readonly string[];
  readonly statementId: string;
  readonly statementRevision: number;
}

export interface FactMappingStatementResultV1 {
  readonly disposition: StatementDisposition;
  readonly mapping: StatementClaimMappingV1 | null;
  readonly reasonCodes: readonly string[];
  readonly statement: DraftStatementV1;
  readonly unacknowledgedSignalCount: number;
}

export interface FactMappingRollupV1 {
  readonly counts: Readonly<Record<StatementDisposition, number>>;
  readonly reasonCodes: readonly string[];
  readonly status: 'AWAITING_REVIEW' | 'FACT_BLOCKED' | 'PASS';
  readonly warningBoundaryEscapeCount: number;
}

export interface FactMappingPlanV1 {
  readonly artifactCount: number;
  readonly briefVersionId: string;
  readonly budgetState: 'AVAILABLE' | 'BLOCKED' | 'UNKNOWN';
  readonly cacheState: 'AVAILABLE' | 'MISS' | 'UNKNOWN';
  readonly candidateEvidenceCount: number;
  readonly candidateClaimCount: number;
  readonly candidateSourceRevisionCount: number;
  readonly capabilityState: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN' | 'STALE';
  readonly checkerVersion: typeof FACT_MAPPING_CHECKER_VERSION;
  readonly classificationVersion: typeof FACT_MAPPING_CLASSIFICATION_VERSION;
  readonly createdAt: string;
  readonly credentialState: 'AVAILABLE' | 'MISSING' | 'NOT_REQUIRED' | 'UNKNOWN';
  readonly dependencyHash: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftVersionId: string;
  readonly expiresAt: string;
  readonly estimatedLocalWrites: number;
  readonly inputCodePointCount: number;
  readonly inputHash: string;
  readonly maximumModelRequests: 0 | 1;
  readonly mode: FactMappingMode;
  readonly mappingPolicyVersion: typeof FACT_MAPPING_CONTRACT_VERSION;
  readonly planId: string;
  readonly previewHash: string;
  readonly profileId: ContentDraftPayloadV1['profileId'];
  readonly protectedSignalCount: number;
  readonly segmentationVersion: typeof FACT_MAPPING_SEGMENTATION_VERSION;
  readonly statementCount: number;
  readonly typedCompatibilityVersion: typeof TYPED_FACT_COMPATIBILITY_VERSION;
  readonly workIds: readonly string[];
}

export interface FactMappingJobPayloadV1 {
  readonly candidateHash: string;
  readonly dependencyHash: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftVersionId: string;
  readonly executionId: string;
  readonly inputHash: string;
  readonly jobType: 'FACT_MAPPING_CHECK_V1';
  readonly mode: FactMappingMode;
  readonly planId: string;
  readonly previewHash: string;
}

export interface FactMappingRunV1 {
  readonly createdAt: string;
  readonly draftId: string;
  readonly executionId: string;
  readonly externalRequestCount: 0 | 1;
  readonly finishedAt: string | null;
  readonly modelExecutionId: string | null;
  readonly mode: FactMappingMode;
  readonly planId: string;
  readonly reasonCode: string | null;
  readonly revision: number;
  readonly runId: string;
  readonly status: FactMappingRunStatus;
}

export interface FactMappingCheckVersionV1 {
  readonly checkerVersion: typeof FACT_MAPPING_CHECKER_VERSION;
  readonly createdAt: string;
  readonly decisionRevision: number;
  readonly dependencyHash: string;
  readonly draftId: string;
  readonly draftVersionId: string;
  readonly inputHash: string;
  readonly rollup: FactMappingRollupV1;
  readonly runId: string;
  readonly versionId: string;
  readonly versionNumber: number;
}

export interface FactMappingDecisionV1 {
  readonly createdAt: string;
  readonly decisionId: string;
  readonly expectedRevision: number;
  readonly kind: FactMappingDecisionKind;
  readonly previewHash: string;
  readonly reason: string | null;
  readonly resultingRevision: number;
  readonly statementId: string;
}

export interface FactMappingAssistCandidateV1 {
  readonly artifactId: string;
  readonly artifactKind: DraftArtifactKind;
  readonly claimIds: readonly string[];
  readonly domain: FactDomain;
  readonly draftVersionId: string;
  readonly endCodePoint: number;
  readonly kind: StatementKind;
  readonly materiality: FactMateriality;
  readonly protectedSignalAcknowledged: boolean;
  readonly reasonCode: string;
  readonly relation: MappingRelation;
  readonly selectedTextHash: string;
  readonly startCodePoint: number;
  readonly textHash: string;
}

export interface FactMappingAssistOutputV1 {
  readonly candidates: readonly FactMappingAssistCandidateV1[];
  readonly schemaVersion: typeof FACT_MAPPING_ASSIST_SCHEMA_VERSION;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}

function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    Buffer.byteLength(value, 'utf8') >= 1 &&
    Buffer.byteLength(value, 'utf8') <= FACT_MAPPING_LIMITS.identifierBytes &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function assertDraftTextLocator(value: unknown): DraftTextLocatorV1 {
  if (
    !record(value) ||
    !exact(value, [
      'artifactId',
      'artifactKind',
      'draftVersionId',
      'endCodePoint',
      'locatorVersion',
      'selectedTextHash',
      'startCodePoint',
      'textHash',
    ]) ||
    !identifier(value.artifactId) ||
    !DRAFT_ARTIFACT_KINDS.includes(value.artifactKind as DraftArtifactKind) ||
    !identifier(value.draftVersionId) ||
    !Number.isSafeInteger(value.startCodePoint) ||
    Number(value.startCodePoint) < 0 ||
    !Number.isSafeInteger(value.endCodePoint) ||
    Number(value.endCodePoint) <= Number(value.startCodePoint) ||
    value.locatorVersion !== DRAFT_TEXT_LOCATOR_VERSION ||
    !hash(value.selectedTextHash) ||
    !hash(value.textHash)
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
  }
  return Object.freeze(value) as unknown as DraftTextLocatorV1;
}

export function assertClassification(value: unknown): DraftStatementClassificationV1 {
  if (
    !record(value) ||
    !exact(value, [
      'classificationVersion',
      'domain',
      'kind',
      'materiality',
      'reasonCode',
      'requiresReview',
    ]) ||
    value.classificationVersion !== FACT_MAPPING_CLASSIFICATION_VERSION ||
    !FACT_DOMAINS.includes(value.domain as FactDomain) ||
    !STATEMENT_KINDS.includes(value.kind as StatementKind) ||
    !FACT_MATERIALITIES.includes(value.materiality as FactMateriality) ||
    !identifier(value.reasonCode) ||
    typeof value.requiresReview !== 'boolean'
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CLASSIFICATION');
  }
  const factLike = value.kind === 'FACT' || value.kind === 'MIXED';
  if (
    (value.kind === 'FACT' &&
      (value.domain === 'NOT_APPLICABLE' || value.materiality === 'NOT_APPLICABLE')) ||
    (!factLike && (value.domain !== 'NOT_APPLICABLE' || value.materiality !== 'NOT_APPLICABLE'))
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CLASSIFICATION');
  }
  return Object.freeze(value) as unknown as DraftStatementClassificationV1;
}

export function assertFactMappingAssistOutput(
  value: unknown,
  allowedClaimIds: ReadonlySet<string>,
  artifacts: readonly {
    readonly artifactId: string;
    readonly artifactKind: DraftArtifactKind;
    readonly draftVersionId: string;
    readonly text: string;
    readonly textHash: string;
  }[],
): FactMappingAssistOutputV1 {
  if (
    !record(value) ||
    !exact(value, ['candidates', 'schemaVersion']) ||
    value.schemaVersion !== FACT_MAPPING_ASSIST_SCHEMA_VERSION ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > FACT_MAPPING_LIMITS.modelCandidateStatements
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  const artifactMap = new Map(
    artifacts.map((artifact) => [`${artifact.artifactKind}:${artifact.artifactId}`, artifact]),
  );
  const candidates = value.candidates.map((candidate) => {
    if (
      !record(candidate) ||
      !exact(candidate, [
        'artifactId',
        'artifactKind',
        'claimIds',
        'domain',
        'draftVersionId',
        'endCodePoint',
        'kind',
        'materiality',
        'protectedSignalAcknowledged',
        'reasonCode',
        'relation',
        'selectedTextHash',
        'startCodePoint',
        'textHash',
      ]) ||
      !identifier(candidate.artifactId) ||
      !DRAFT_ARTIFACT_KINDS.includes(candidate.artifactKind as DraftArtifactKind) ||
      !Array.isArray(candidate.claimIds) ||
      candidate.claimIds.length > 8 ||
      !candidate.claimIds.every((id) => identifier(id) && allowedClaimIds.has(id)) ||
      !FACT_DOMAINS.includes(candidate.domain as FactDomain) ||
      !identifier(candidate.draftVersionId) ||
      !STATEMENT_KINDS.includes(candidate.kind as StatementKind) ||
      !FACT_MATERIALITIES.includes(candidate.materiality as FactMateriality) ||
      !MAPPING_RELATIONS.includes(candidate.relation as MappingRelation) ||
      !Number.isSafeInteger(candidate.startCodePoint) ||
      Number(candidate.startCodePoint) < 0 ||
      !Number.isSafeInteger(candidate.endCodePoint) ||
      Number(candidate.endCodePoint) <= Number(candidate.startCodePoint) ||
      !hash(candidate.selectedTextHash) ||
      !hash(candidate.textHash) ||
      typeof candidate.protectedSignalAcknowledged !== 'boolean' ||
      !identifier(candidate.reasonCode)
    ) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
    const artifact = artifactMap.get(
      `${String(candidate.artifactKind)}:${String(candidate.artifactId)}`,
    );
    if (
      artifact === undefined ||
      candidate.draftVersionId !== artifact.draftVersionId ||
      candidate.textHash !== artifact.textHash ||
      Number(candidate.endCodePoint) > Array.from(normalizeDraftText(artifact.text)).length
    ) {
      throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
    }
    const selected = Array.from(normalizeDraftText(artifact.text))
      .slice(Number(candidate.startCodePoint), Number(candidate.endCodePoint))
      .join('');
    if (selected.length === 0 || factMappingHash(selected) !== candidate.selectedTextHash) {
      throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
    }
    assertClassification({
      classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
      domain: candidate.domain,
      kind: candidate.kind,
      materiality: candidate.materiality,
      reasonCode: candidate.reasonCode,
      requiresReview: true,
    });
    return Object.freeze(candidate) as unknown as FactMappingAssistCandidateV1;
  });
  return Object.freeze({
    candidates: Object.freeze(candidates),
    schemaVersion: FACT_MAPPING_ASSIST_SCHEMA_VERSION,
  });
}

export function assertFactMappingJobPayload(value: unknown): FactMappingJobPayloadV1 {
  if (
    !record(value) ||
    !exact(value, [
      'candidateHash',
      'dependencyHash',
      'draftId',
      'draftRevision',
      'draftVersionId',
      'executionId',
      'inputHash',
      'jobType',
      'mode',
      'planId',
      'previewHash',
    ]) ||
    !hash(value.candidateHash) ||
    !hash(value.dependencyHash) ||
    !identifier(value.draftId) ||
    !Number.isSafeInteger(value.draftRevision) ||
    Number(value.draftRevision) < 0 ||
    !identifier(value.draftVersionId) ||
    !identifier(value.executionId) ||
    !hash(value.inputHash) ||
    value.jobType !== 'FACT_MAPPING_CHECK_V1' ||
    !FACT_MAPPING_MODES.includes(value.mode as FactMappingMode) ||
    !identifier(value.planId) ||
    !hash(value.previewHash)
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return Object.freeze(value) as unknown as FactMappingJobPayloadV1;
}

export function isSatisfyingRelation(value: MappingRelation): boolean {
  return ['EXACT', 'SUPPORTED_PARAPHRASE', 'NARROWER_THAN_CLAIM'].includes(value);
}

export function validDisposition(value: unknown): value is StatementDisposition {
  return STATEMENT_DISPOSITIONS.includes(value as StatementDisposition);
}

export function validRunStatus(value: unknown): value is FactMappingRunStatus {
  return FACT_MAPPING_RUN_STATUSES.includes(value as FactMappingRunStatus);
}

export function validDecisionKind(value: unknown): value is FactMappingDecisionKind {
  return FACT_MAPPING_DECISION_KINDS.includes(value as FactMappingDecisionKind);
}

export function validStatementProvenance(value: unknown): value is StatementProvenance {
  return STATEMENT_PROVENANCE.includes(value as StatementProvenance);
}

export type { AtomicClaimScopeV1 };
