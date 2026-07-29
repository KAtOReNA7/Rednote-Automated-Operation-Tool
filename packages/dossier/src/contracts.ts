import {
  DOSSIER_BUILD_MODES,
  DOSSIER_BUILD_PLAN_VERSION,
  DOSSIER_CONTRACT_VERSION,
  DOSSIER_COVERAGE_POLICY_VERSION,
  DOSSIER_DEPENDENCY_TYPES,
  DOSSIER_FACT_STATUSES,
  DOSSIER_LIMITS,
  DOSSIER_READINESS_STATES,
  DOSSIER_SECTIONS,
  DOSSIER_STATES,
  DOSSIER_SUBJECT_TYPES,
  type DossierBuildMode,
  type DossierBuildRunStatus,
  type DossierDependencyType,
  type DossierEntryKind,
  type DossierFactStatus,
  type DossierGapReasonCode,
  type DossierReadinessState,
  type DossierSectionKey,
  type DossierState,
  type DossierSubjectType,
  type DOSSIER_SCHEMA_VERSION,
} from './constants.js';
import { DossierError } from './errors.js';
import { canonicalDossierJson, dossierSemanticHash } from './identity.js';

export interface DossierSubject {
  readonly id: string;
  readonly type: DossierSubjectType;
}

export interface ResearchDossier {
  readonly contractVersion: typeof DOSSIER_CONTRACT_VERSION;
  readonly createdAt: string;
  readonly currentVersionId: string | null;
  readonly currentVersionNumber: number | null;
  readonly dossierId: string;
  readonly invalidationReasons: readonly string[];
  readonly readiness: DossierReadinessState;
  readonly revision: number;
  readonly state: DossierState;
  readonly subject: DossierSubject;
  readonly updatedAt: string;
}

export interface ResearchDossierVersion {
  readonly buildMode: DossierBuildMode;
  readonly buildRunId: string;
  readonly coveragePolicyVersion: typeof DOSSIER_COVERAGE_POLICY_VERSION;
  readonly createdAt: string;
  readonly dossierId: string;
  readonly factPolicyVersion: string;
  readonly inputHash: string;
  readonly isCurrent: boolean;
  readonly previousVersionId: string | null;
  readonly publishedAt: string;
  readonly readiness: DossierReadinessState;
  readonly reasonCodes: readonly string[];
  readonly revision: number;
  readonly schemaVersion: typeof DOSSIER_SCHEMA_VERSION;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly warnings: readonly string[];
}

export interface DossierSection {
  readonly blockedCount: number;
  readonly coverageBasisPoints: number;
  readonly entryCount: number;
  readonly gapCount: number;
  readonly insufficientCount: number;
  readonly position: number;
  readonly readinessRequired: boolean;
  readonly reasonCodes: readonly string[];
  readonly section: DossierSectionKey;
  readonly sectionId: string;
  readonly staleCount: number;
  readonly verifiedCount: number;
  readonly versionId: string;
}

export interface DossierEntry {
  readonly claimIds: readonly string[];
  readonly conflictId: string | null;
  readonly createdAt: string;
  readonly displayValue: string;
  readonly entryId: string;
  readonly entryKind: DossierEntryKind;
  readonly evidenceCount: number;
  readonly evidenceIds: readonly string[];
  readonly factEvaluationIds: readonly string[];
  readonly factStatus: DossierFactStatus;
  readonly gapId: string | null;
  readonly predicate: string;
  readonly provenance: 'LOCAL_DETERMINISTIC';
  readonly revision: number;
  readonly section: DossierSectionKey;
  readonly semanticKey: string;
  readonly sourceCount: number;
  readonly sourceRevisionIds: readonly string[];
  readonly structuredValue: unknown;
  readonly updatedAt: string;
  readonly versionId: string;
}

export interface DossierSectionCoverage {
  readonly basisPoints: number;
  readonly blockedCount: number;
  readonly gapCount: number;
  readonly insufficientCount: number;
  readonly reasonCodes: readonly string[];
  readonly section: DossierSectionKey;
  readonly staleCount: number;
  readonly verifiedCount: number;
}

export interface DossierCoverageSnapshot {
  readonly blockedCount: number;
  readonly coveragePolicyVersion: typeof DOSSIER_COVERAGE_POLICY_VERSION;
  readonly gapCount: number;
  readonly inputHash: string;
  readonly insufficientCount: number;
  readonly optionalBasisPoints: number;
  readonly overallBasisPoints: number;
  readonly reasonCodes: readonly string[];
  readonly requiredBasisPoints: number;
  readonly sections: readonly DossierSectionCoverage[];
  readonly staleCount: number;
  readonly verifiedCount: number;
}

export interface DossierGap {
  readonly auditRef: string | null;
  readonly blocking: boolean;
  readonly claimIds: readonly string[];
  readonly createdAt: string;
  readonly gapId: string;
  readonly reasonCode: DossierGapReasonCode;
  readonly required: boolean;
  readonly section: DossierSectionKey;
  readonly semanticKey: string;
  readonly versionId: string;
}

export interface DossierDependency {
  readonly dependencyId: string;
  readonly dependencyKey: string;
  readonly dependencyRevision: string;
  readonly dependencyType: DossierDependencyType;
  readonly entrySemanticKey: string | null;
  readonly versionId: string;
}

export interface DossierBuildCounts {
  readonly claimCount: number;
  readonly conflictCount: number;
  readonly dependencyCount: number;
  readonly evidenceCount: number;
  readonly gapCount: number;
}

export interface DossierBuildDiff {
  readonly addedSemanticKeys: readonly string[];
  readonly removedSemanticKeys: readonly string[];
  readonly updatedSemanticKeys: readonly string[];
}

export interface DossierBuildPlan {
  readonly buildMode: DossierBuildMode;
  readonly budgetConclusion: 'NOT_APPLICABLE';
  readonly contractVersion: typeof DOSSIER_BUILD_PLAN_VERSION;
  readonly counts: DossierBuildCounts;
  readonly createdAt: string;
  readonly diff: DossierBuildDiff;
  readonly dossierId: string;
  readonly estimatedLocalWrites: number;
  readonly estimatedModelRequests: 0;
  readonly expectedCurrentVersionId: string | null;
  readonly expectedDossierRevision: number;
  readonly expiresAt: string;
  readonly inputHash: string;
  readonly noOp: boolean;
  readonly planHash: string;
  readonly planId: string;
  readonly readinessAfter: DossierReadinessState;
  readonly readinessBefore: DossierReadinessState;
  readonly sectionCoverageAfter: readonly DossierSectionCoverage[];
  readonly sectionCoverageBefore: readonly DossierSectionCoverage[];
  readonly subject: DossierSubject;
}

export interface DossierBuildRun {
  readonly costState: 'NOT_INCURRED';
  readonly createdAt: string;
  readonly dossierId: string;
  readonly errorCode: string | null;
  readonly executionId: string;
  readonly externalRequestCount: 0;
  readonly inputHash: string;
  readonly jobId: string | null;
  readonly planId: string;
  readonly resultVersionId: string | null;
  readonly revision: number;
  readonly runId: string;
  readonly status: DossierBuildRunStatus;
  readonly updatedAt: string;
}

export interface DossierNotApplicable {
  readonly auditRef: string;
  readonly reasonCode: string;
  readonly semanticKey: string;
}

export interface DossierEvidenceInput {
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE' | 'RETRACTED';
  readonly classificationRevision: number;
  readonly evidenceId: string;
  readonly evidenceRevision: number;
  readonly relation: 'SUPPORTS' | 'CONTRADICTS' | 'QUALIFIES';
  readonly sourceCurrentRevision: number;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly verificationStatus: 'PENDING' | 'VALIDATED' | 'REJECTED' | 'STALE';
}

export interface DossierEvaluationInput {
  readonly createdAt: string;
  readonly evaluationId: string;
  readonly inputIdentityHash: string;
  readonly policyVersion: string;
  readonly reasonCode: string;
  readonly status: DossierFactStatus;
}

export interface DossierFactInput {
  readonly claimId: string;
  readonly claimRevision: number;
  readonly evaluation: DossierEvaluationInput | null;
  readonly evidence: readonly DossierEvidenceInput[];
  readonly factPolicyVersion: string;
  readonly keyFact: boolean;
  readonly multipleAllowed: boolean;
  readonly normalizedScopeHash: string;
  readonly normalizedValue: string;
  readonly predicate: string;
  readonly semanticFingerprint: string;
  readonly status: 'ACTIVE' | 'CANDIDATE' | 'REJECTED';
  readonly structuredValue: unknown;
}

export interface DossierConflictInput {
  readonly claimIds: readonly [string, string];
  readonly conflictId: string;
  readonly revision: number;
  readonly state:
    | 'OPEN'
    | 'FACT_BLOCKED'
    | 'RESOLVED_ACCEPT'
    | 'RESOLVED_MULTIVALUE'
    | 'RESOLVED_SCOPE_SPLIT'
    | 'DISMISSED_DEPENDENT_SOURCE'
    | 'SUPERSEDED'
    | 'REOPENED';
}

export interface DossierProjectionInput {
  readonly conflicts: readonly DossierConflictInput[];
  readonly facts: readonly DossierFactInput[];
  readonly factPolicyVersion: string;
  readonly notApplicable: readonly DossierNotApplicable[];
  readonly subject: DossierSubject;
  readonly subjectRevision: string;
}

export interface DossierProjection {
  readonly coverage: DossierCoverageSnapshot;
  readonly dependencies: readonly DossierDependency[];
  readonly entries: readonly DossierEntry[];
  readonly gaps: readonly DossierGap[];
  readonly inputHash: string;
  readonly readiness: DossierReadinessState;
  readonly sections: readonly DossierSection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function identifier(value: unknown, max: number = DOSSIER_LIMITS.identifierBytes): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= max
  );
}

function utc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value);
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function stringList(value: unknown, maximum: number): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => identifier(item)) &&
    new Set(value).size === value.length
  );
}

function validSubject(value: unknown): value is DossierSubject {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'type']) &&
    identifier(value.id, 128) &&
    DOSSIER_SUBJECT_TYPES.includes(value.type as DossierSubjectType)
  );
}

export function validateResearchDossier(value: unknown): ResearchDossier {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'contractVersion',
      'createdAt',
      'currentVersionId',
      'currentVersionNumber',
      'dossierId',
      'invalidationReasons',
      'readiness',
      'revision',
      'state',
      'subject',
      'updatedAt',
    ]) ||
    value.contractVersion !== DOSSIER_CONTRACT_VERSION ||
    !identifier(value.dossierId) ||
    !validSubject(value.subject) ||
    !DOSSIER_STATES.includes(value.state as DossierState) ||
    !DOSSIER_READINESS_STATES.includes(value.readiness as DossierReadinessState) ||
    !integer(value.revision, 1) ||
    !utc(value.createdAt) ||
    !utc(value.updatedAt) ||
    !stringList(value.invalidationReasons, DOSSIER_LIMITS.maxReasonCodes) ||
    !(
      (value.currentVersionId === null && value.currentVersionNumber === null) ||
      (identifier(value.currentVersionId) && integer(value.currentVersionNumber, 1))
    )
  ) {
    throw new DossierError('DOSSIER_INVALID_CONTRACT');
  }
  return Object.freeze(value) as unknown as ResearchDossier;
}

function validSectionCoverage(value: unknown): value is DossierSectionCoverage {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'basisPoints',
      'blockedCount',
      'gapCount',
      'insufficientCount',
      'reasonCodes',
      'section',
      'staleCount',
      'verifiedCount',
    ]) &&
    DOSSIER_SECTIONS.includes(value.section as DossierSectionKey) &&
    integer(value.basisPoints, 0, 10_000) &&
    integer(value.blockedCount) &&
    integer(value.gapCount) &&
    integer(value.insufficientCount) &&
    integer(value.staleCount) &&
    integer(value.verifiedCount) &&
    stringList(value.reasonCodes, DOSSIER_LIMITS.maxReasonCodes)
  );
}

export function validateDossierCoverageSnapshot(value: unknown): DossierCoverageSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'blockedCount',
      'coveragePolicyVersion',
      'gapCount',
      'inputHash',
      'insufficientCount',
      'optionalBasisPoints',
      'overallBasisPoints',
      'reasonCodes',
      'requiredBasisPoints',
      'sections',
      'staleCount',
      'verifiedCount',
    ]) ||
    value.coveragePolicyVersion !== DOSSIER_COVERAGE_POLICY_VERSION ||
    !identifier(value.inputHash, 64) ||
    !/^[a-f0-9]{64}$/u.test(value.inputHash as string) ||
    !integer(value.overallBasisPoints, 0, 10_000) ||
    !integer(value.requiredBasisPoints, 0, 10_000) ||
    !integer(value.optionalBasisPoints, 0, 10_000) ||
    !integer(value.blockedCount) ||
    !integer(value.gapCount) ||
    !integer(value.insufficientCount) ||
    !integer(value.staleCount) ||
    !integer(value.verifiedCount) ||
    !stringList(value.reasonCodes, DOSSIER_LIMITS.maxReasonCodes) ||
    !Array.isArray(value.sections) ||
    value.sections.length !== DOSSIER_SECTIONS.length ||
    !value.sections.every(validSectionCoverage)
  ) {
    throw new DossierError('DOSSIER_INVALID_CONTRACT');
  }
  return Object.freeze(value) as unknown as DossierCoverageSnapshot;
}

function validBuildCounts(value: unknown): value is DossierBuildCounts {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'claimCount',
      'conflictCount',
      'dependencyCount',
      'evidenceCount',
      'gapCount',
    ]) &&
    integer(value.claimCount, 0, DOSSIER_LIMITS.maxClaimsPerBuild) &&
    integer(value.conflictCount, 0, DOSSIER_LIMITS.maxConflictsPerBuild) &&
    integer(value.dependencyCount, 0, DOSSIER_LIMITS.maxDependenciesPerBuild) &&
    integer(value.evidenceCount, 0, DOSSIER_LIMITS.maxEvidencePerBuild) &&
    integer(value.gapCount, 0, DOSSIER_LIMITS.maxGapsPerBuild)
  );
}

function validBuildDiff(value: unknown): value is DossierBuildDiff {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['addedSemanticKeys', 'removedSemanticKeys', 'updatedSemanticKeys']) &&
    stringList(value.addedSemanticKeys, DOSSIER_LIMITS.maxEntriesPerBuild) &&
    stringList(value.removedSemanticKeys, DOSSIER_LIMITS.maxEntriesPerBuild) &&
    stringList(value.updatedSemanticKeys, DOSSIER_LIMITS.maxEntriesPerBuild)
  );
}

export function dossierBuildPlanHash(value: Omit<DossierBuildPlan, 'planHash'>): string {
  return dossierSemanticHash(value);
}

export function validateDossierBuildPlan(value: unknown): DossierBuildPlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'buildMode',
      'budgetConclusion',
      'contractVersion',
      'counts',
      'createdAt',
      'diff',
      'dossierId',
      'estimatedLocalWrites',
      'estimatedModelRequests',
      'expectedCurrentVersionId',
      'expectedDossierRevision',
      'expiresAt',
      'inputHash',
      'noOp',
      'planHash',
      'planId',
      'readinessAfter',
      'readinessBefore',
      'sectionCoverageAfter',
      'sectionCoverageBefore',
      'subject',
    ]) ||
    value.contractVersion !== DOSSIER_BUILD_PLAN_VERSION ||
    !identifier(value.planId) ||
    !identifier(value.dossierId) ||
    !validSubject(value.subject) ||
    !DOSSIER_BUILD_MODES.includes(value.buildMode as DossierBuildMode) ||
    value.budgetConclusion !== 'NOT_APPLICABLE' ||
    value.estimatedModelRequests !== 0 ||
    !integer(value.estimatedLocalWrites, 0, DOSSIER_LIMITS.maxLocalWrites) ||
    !validBuildCounts(value.counts) ||
    !validBuildDiff(value.diff) ||
    !integer(value.expectedDossierRevision, 1) ||
    !(value.expectedCurrentVersionId === null || identifier(value.expectedCurrentVersionId)) ||
    !identifier(value.inputHash, 64) ||
    !/^[a-f0-9]{64}$/u.test(value.inputHash as string) ||
    !utc(value.createdAt) ||
    !utc(value.expiresAt) ||
    Date.parse(value.expiresAt as string) <= Date.parse(value.createdAt as string) ||
    typeof value.noOp !== 'boolean' ||
    !DOSSIER_READINESS_STATES.includes(value.readinessBefore as DossierReadinessState) ||
    !DOSSIER_READINESS_STATES.includes(value.readinessAfter as DossierReadinessState) ||
    !Array.isArray(value.sectionCoverageBefore) ||
    !value.sectionCoverageBefore.every(validSectionCoverage) ||
    !Array.isArray(value.sectionCoverageAfter) ||
    !value.sectionCoverageAfter.every(validSectionCoverage) ||
    !identifier(value.planHash, 64) ||
    !/^[a-f0-9]{64}$/u.test(value.planHash as string)
  ) {
    throw new DossierError('DOSSIER_INVALID_PLAN');
  }
  const plan = value as unknown as DossierBuildPlan;
  const { planHash, ...withoutHash } = plan;
  if (dossierBuildPlanHash(withoutHash) !== planHash) {
    throw new DossierError('DOSSIER_INVALID_PLAN');
  }
  return Object.freeze(plan);
}

export interface DossierBuildJobPayload {
  readonly dossierId: string;
  readonly expectedDossierRevision: number;
  readonly executionId: string;
  readonly inputHash: string;
  readonly planHash: string;
  readonly planId: string;
  readonly subjectId: string;
  readonly subjectType: DossierSubjectType;
}

export function validateDossierBuildJobPayload(value: unknown): DossierBuildJobPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'dossierId',
      'expectedDossierRevision',
      'executionId',
      'inputHash',
      'planHash',
      'planId',
      'subjectId',
      'subjectType',
    ]) ||
    !identifier(value.dossierId) ||
    !identifier(value.planId) ||
    !identifier(value.executionId) ||
    !identifier(value.subjectId, 128) ||
    !DOSSIER_SUBJECT_TYPES.includes(value.subjectType as DossierSubjectType) ||
    !integer(value.expectedDossierRevision, 1) ||
    !identifier(value.inputHash, 64) ||
    !/^[a-f0-9]{64}$/u.test(value.inputHash as string) ||
    !identifier(value.planHash, 64) ||
    !/^[a-f0-9]{64}$/u.test(value.planHash as string) ||
    Buffer.byteLength(canonicalDossierJson(value), 'utf8') > 2_048
  ) {
    throw new DossierError('DOSSIER_INVALID_REQUEST');
  }
  return Object.freeze(value) as unknown as DossierBuildJobPayload;
}

export function assertDossierDependency(value: DossierDependency): DossierDependency {
  if (
    !DOSSIER_DEPENDENCY_TYPES.includes(value.dependencyType) ||
    !identifier(value.dependencyId) ||
    !identifier(value.dependencyRevision) ||
    !identifier(value.dependencyKey, 64) ||
    !/^[a-f0-9]{64}$/u.test(value.dependencyKey) ||
    !(value.entrySemanticKey === null || identifier(value.entrySemanticKey))
  ) {
    throw new DossierError('DOSSIER_INVALID_CONTRACT');
  }
  return Object.freeze(value);
}

export function assertDossierProjectionInput(input: DossierProjectionInput): void {
  if (
    !hasExactKeys(input as unknown as Record<string, unknown>, [
      'conflicts',
      'factPolicyVersion',
      'facts',
      'notApplicable',
      'subject',
      'subjectRevision',
    ]) ||
    !validSubject(input.subject) ||
    !identifier(input.subjectRevision, 128) ||
    !identifier(input.factPolicyVersion, 64)
  ) {
    throw new DossierError('DOSSIER_INVALID_CONTRACT');
  }
  if (
    input.facts.length > DOSSIER_LIMITS.maxClaimsPerBuild ||
    input.conflicts.length > DOSSIER_LIMITS.maxConflictsPerBuild ||
    input.notApplicable.length > DOSSIER_LIMITS.maxGapsPerBuild
  ) {
    throw new DossierError('DOSSIER_CAPACITY_EXCEEDED');
  }
  for (const fact of input.facts) {
    if (
      !identifier(fact.claimId, 128) ||
      !integer(fact.claimRevision, 1) ||
      !identifier(fact.predicate, 128) ||
      !identifier(fact.normalizedScopeHash, 64) ||
      !identifier(fact.semanticFingerprint, 64) ||
      !identifier(fact.factPolicyVersion, 64) ||
      !['ACTIVE', 'CANDIDATE', 'REJECTED'].includes(fact.status) ||
      typeof fact.keyFact !== 'boolean' ||
      typeof fact.multipleAllowed !== 'boolean' ||
      Buffer.byteLength(fact.normalizedValue, 'utf8') > DOSSIER_LIMITS.displayValueBytes ||
      Buffer.byteLength(canonicalDossierJson(fact.structuredValue), 'utf8') >
        DOSSIER_LIMITS.structuredValueBytes ||
      fact.evidence.length > DOSSIER_LIMITS.maxEvidencePerBuild
    ) {
      throw new DossierError('DOSSIER_INVALID_CONTRACT');
    }
    if (
      fact.evidence.some(
        (evidence) =>
          !Number.isSafeInteger(evidence.classificationRevision) ||
          evidence.classificationRevision < 1 ||
          !Number.isSafeInteger(evidence.evidenceRevision) ||
          evidence.evidenceRevision < 1 ||
          !Number.isSafeInteger(evidence.sourceRevision) ||
          evidence.sourceRevision < 1 ||
          !Number.isSafeInteger(evidence.sourceCurrentRevision) ||
          evidence.sourceCurrentRevision < 1,
      )
    ) {
      throw new DossierError('DOSSIER_INVALID_CONTRACT');
    }
    if (
      fact.evaluation !== null &&
      (!identifier(fact.evaluation.evaluationId, 128) ||
        !DOSSIER_FACT_STATUSES.includes(fact.evaluation.status) ||
        !identifier(fact.evaluation.policyVersion, 64) ||
        !identifier(fact.evaluation.inputIdentityHash, 64) ||
        !identifier(fact.evaluation.reasonCode, 128) ||
        !utc(fact.evaluation.createdAt))
    ) {
      throw new DossierError('DOSSIER_INVALID_CONTRACT');
    }
  }
}
