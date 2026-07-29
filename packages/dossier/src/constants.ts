export const DOSSIER_CONTRACT_VERSION = 'research-dossier-v1' as const;
export const DOSSIER_SCHEMA_VERSION = 'research-dossier-schema-v1' as const;
export const DOSSIER_COVERAGE_POLICY_VERSION = 'dossier-coverage-policy-v1' as const;
export const DOSSIER_BUILD_PLAN_VERSION = 'dossier-build-plan-v1' as const;
export const DOSSIER_JOB_TYPE = 'DOSSIER_BUILD_V1' as const;

export const DOSSIER_SUBJECT_TYPES = ['WORK', 'EXPRESSION', 'EDITION'] as const;
export type DossierSubjectType = (typeof DOSSIER_SUBJECT_TYPES)[number];

export const DOSSIER_SECTIONS = [
  'IDENTITY',
  'BIBLIOGRAPHY',
  'CREATORS',
  'PUBLICATION_HISTORY',
  'AWARDS',
  'SERIES_AND_RELATIONSHIPS',
  'SYNOPSIS_AND_THEMES',
  'RECEPTION_AND_DISCUSSION',
  'OPEN_CONFLICTS',
  'RESEARCH_GAPS',
] as const;
export type DossierSectionKey = (typeof DOSSIER_SECTIONS)[number];

export const DOSSIER_ENTRY_KINDS = ['CONSENSUS', 'DISPUTED', 'GAP'] as const;
export type DossierEntryKind = (typeof DOSSIER_ENTRY_KINDS)[number];

export const DOSSIER_GAP_REASON_CODES = [
  'NO_CLAIM',
  'INSUFFICIENT_EVIDENCE',
  'SOURCE_INDEPENDENCE_UNKNOWN',
  'FACT_CONFLICTED',
  'EVIDENCE_STALE',
  'SOURCE_UNAVAILABLE',
  'SECTION_NOT_RESEARCHED',
  'POLICY_VERSION_STALE',
] as const;
export type DossierGapReasonCode = (typeof DOSSIER_GAP_REASON_CODES)[number];

export const DOSSIER_DEPENDENCY_TYPES = [
  'CLAIM',
  'FACT_EVALUATION',
  'EVIDENCE',
  'SOURCE_REVISION',
  'CONFLICT',
  'FACT_POLICY',
  'COVERAGE_POLICY',
  'SUBJECT',
] as const;
export type DossierDependencyType = (typeof DOSSIER_DEPENDENCY_TYPES)[number];

export const DOSSIER_STATES = [
  'NOT_BUILT',
  'CURRENT',
  'REBUILD_REQUIRED',
  'BUILDING',
  'FAILED',
  'SUPERSEDED',
] as const;
export type DossierState = (typeof DOSSIER_STATES)[number];

export const DOSSIER_READINESS_STATES = [
  'NOT_BUILT',
  'BUILD_REQUIRED',
  'INSUFFICIENT_COVERAGE',
  'FACT_BLOCKED',
  'STALE',
  'READY_FOR_CONTENT_BRIEF',
] as const;
export type DossierReadinessState = (typeof DOSSIER_READINESS_STATES)[number];

export const DOSSIER_BUILD_MODES = ['INITIAL', 'INCREMENTAL', 'FULL_REBUILD'] as const;
export type DossierBuildMode = (typeof DOSSIER_BUILD_MODES)[number];

export const DOSSIER_BUILD_RUN_STATUSES = [
  'CONFIRMED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'NO_OP',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'FAILED',
  'AMBIGUOUS',
] as const;
export type DossierBuildRunStatus = (typeof DOSSIER_BUILD_RUN_STATUSES)[number];

export const DOSSIER_FACT_STATUSES = [
  'NOT_EVALUATED',
  'INSUFFICIENT',
  'SUPPORTED_NOT_VERIFIED',
  'VERIFIED',
  'CONFLICTED',
  'FACT_BLOCKED',
  'STALE_REVIEW_REQUIRED',
  'REJECTED',
] as const;
export type DossierFactStatus = (typeof DOSSIER_FACT_STATUSES)[number];

export const DOSSIER_LIMITS = Object.freeze({
  confirmationTtlMs: 5 * 60 * 1_000,
  displayValueBytes: 8_000,
  errorCodeBytes: 128,
  identifierBytes: 256,
  maxClaimsPerBuild: 512,
  maxConflictsPerBuild: 256,
  maxDependenciesPerBuild: 8_192,
  maxEntriesPerBuild: 1_024,
  maxEvidencePerBuild: 4_096,
  maxGapsPerBuild: 256,
  maxLocalWrites: 16_384,
  maxPageSize: 100,
  maxReasonCodes: 256,
  maxRuntimeMs: 120_000,
  maxWarnings: 128,
  planTtlMs: 5 * 60 * 1_000,
  structuredValueBytes: 32_768,
});
