export const SOURCE_EVIDENCE_CONTRACT_VERSION = 'source-evidence-v1' as const;
export const ATOMIC_CLAIM_CONTRACT_VERSION = 'atomic-claim-v1' as const;
export const FACT_POLICY_VERSION = 'fact-policy-v1' as const;
export const EVIDENCE_LOCATOR_VERSION = 'evidence-locator-v1' as const;
export const EVIDENCE_RECORD_CONTRACT_VERSION = 'claim-evidence-v1' as const;
export const SOURCE_PROCESSING_PLAN_VERSION = 'source-processing-plan-v1' as const;

export const SOURCE_ORIGIN_KINDS = Object.freeze([
  'FETCH_DOCUMENT',
  'BROWSER_CLIP',
  'USER_LOCAL_INPUT',
  'SYNTHETIC_FIXTURE',
] as const);
export type SourceOriginKind = (typeof SOURCE_ORIGIN_KINDS)[number];

export const USER_LOCAL_SOURCE_TYPES = Object.freeze([
  'BIBLIOGRAPHIC_NOTE',
  'PUBLIC_DOMAIN_TEXT_EXCERPT',
  'USER_LOCAL_NOTE',
] as const);
export type UserLocalSourceType = (typeof USER_LOCAL_SOURCE_TYPES)[number];

export const SOURCE_AUTHORITY_TIERS = Object.freeze([
  'OFFICIAL_PRIMARY',
  'INDEPENDENT_SECONDARY',
  'DISCUSSION_CONTEXT',
  'UNKNOWN',
] as const);
export type SourceAuthorityTier = (typeof SOURCE_AUTHORITY_TIERS)[number];

export const SOURCE_USE_CLASSES = Object.freeze([
  'KEY_FACT_ELIGIBLE',
  'SUPPORTING_ONLY',
  'CONTEXT_ONLY',
  'NOT_CLASSIFIED',
] as const);
export type SourceUseClass = (typeof SOURCE_USE_CLASSES)[number];

export const SOURCE_INDEPENDENCE_STATES = Object.freeze([
  'CONFIRMED_INDEPENDENT',
  'DEPENDENT',
  'UNKNOWN',
] as const);
export type SourceIndependenceState = (typeof SOURCE_INDEPENDENCE_STATES)[number];

export const SOURCE_AVAILABILITY_STATES = Object.freeze([
  'AVAILABLE',
  'UNAVAILABLE',
  'RETRACTED',
  'SUPERSEDED',
] as const);
export type SourceAvailabilityState = (typeof SOURCE_AVAILABILITY_STATES)[number];

export const FACT_SUBJECT_TYPES = Object.freeze([
  'WORK',
  'EXPRESSION',
  'EDITION',
  'AGENT',
  'PUBLICATION_RELATIONSHIP',
] as const);
export type FactSubjectType = (typeof FACT_SUBJECT_TYPES)[number];

export const CLAIM_VALUE_TYPES = Object.freeze([
  'TEXT',
  'INTEGER',
  'DECIMAL_TEXT',
  'DATE_WITH_PRECISION',
  'IDENTIFIER',
  'ENUM',
  'DATE',
  'BOOLEAN',
  'ENTITY_REF',
] as const);
export type ClaimValueType = (typeof CLAIM_VALUE_TYPES)[number];

export const DATE_PRECISIONS = Object.freeze(['YEAR', 'MONTH', 'DAY'] as const);
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const ATOMIC_CLAIM_STATUSES = Object.freeze(['CANDIDATE', 'ACTIVE', 'REJECTED'] as const);
export type AtomicClaimStatus = (typeof ATOMIC_CLAIM_STATUSES)[number];

export const EVIDENCE_RELATIONS = Object.freeze(['SUPPORTS', 'CONTRADICTS', 'QUALIFIES'] as const);
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

export const FACT_EVALUATION_STATUSES = Object.freeze([
  'NOT_EVALUATED',
  'INSUFFICIENT',
  'SUPPORTED_NOT_VERIFIED',
  'VERIFIED',
  'CONFLICTED',
  'FACT_BLOCKED',
  'STALE_REVIEW_REQUIRED',
  'REJECTED',
] as const);
export type FactEvaluationStatus = (typeof FACT_EVALUATION_STATUSES)[number];

export const FACT_CONFLICT_STATES = Object.freeze([
  'OPEN',
  'FACT_BLOCKED',
  'RESOLVED_ACCEPT',
  'RESOLVED_MULTIVALUE',
  'RESOLVED_SCOPE_SPLIT',
  'DISMISSED_DEPENDENT_SOURCE',
  'SUPERSEDED',
  'REOPENED',
] as const);
export type FactConflictState = (typeof FACT_CONFLICT_STATES)[number];

export const FACT_CONFLICT_ACTIONS = Object.freeze([
  'ACCEPT_CLAIM',
  'ACCEPT_MULTIVALUE',
  'SPLIT_SCOPE',
  'DISMISS_DEPENDENT_SOURCE',
  'UNDO',
  'REOPEN',
] as const);
export type FactConflictAction = (typeof FACT_CONFLICT_ACTIONS)[number];

export const SOURCE_PROCESSING_STEPS = Object.freeze([
  'CLASSIFY',
  'EXTRACT_CLAIMS',
  'SUMMARIZE',
  'RECONCILE',
] as const);
export type SourceProcessingStep = (typeof SOURCE_PROCESSING_STEPS)[number];

export const SOURCE_PROCESSING_JOB_TYPES = Object.freeze({
  extract: 'CLAIM_EXTRACTION_V1',
  ingest: 'SOURCE_INGEST_V1',
  reconcile: 'FACT_RECONCILE_V1',
} as const);

export const EVIDENCE_LIMITS = Object.freeze({
  claimBytes: 32 * 1024,
  excerptCharacters: 8_000,
  identifierCharacters: 128,
  locatorCharacters: 16_000,
  maximumClaimsPerRun: 256,
  maximumConcurrency: 4,
  maximumDepth: 8,
  maximumEvidencePerClaim: 64,
  maximumFragmentBytes: 256 * 1024,
  maximumRuntimeMs: 60 * 60_000,
  maximumSourceRevisions: 128,
  maximumSourcesPerPlan: 64,
  reasonCharacters: 2_000,
  scopeBytes: 16 * 1024,
  summaryCharacters: 8_000,
} as const);
