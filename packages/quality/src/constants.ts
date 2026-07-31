export const FACT_MAPPING_CONTRACT_VERSION = 'fact-mapping-v1' as const;
export const DRAFT_STATEMENT_CONTRACT_VERSION = 'draft-statement-v1' as const;
export const DRAFT_TEXT_LOCATOR_VERSION = 'draft-text-locator-v1' as const;
export const FACT_MAPPING_CHECKER_VERSION = 'fact-mapping-checker-v1' as const;
export const FACT_MAPPING_SEGMENTATION_VERSION = 'fact-segmentation-v1' as const;
export const FACT_MAPPING_CLASSIFICATION_VERSION = 'fact-classification-v1' as const;
export const KEY_FACT_POLICY_VERSION = 'key-fact-policy-v1' as const;
export const PROTECTED_SIGNAL_POLICY_VERSION = 'protected-signal-policy-v1' as const;
export const TYPED_FACT_COMPATIBILITY_VERSION = 'typed-fact-compatibility-v1' as const;
export const CLAIM_CANDIDATE_POLICY_VERSION = 'claim-candidate-policy-v1' as const;
export const FACT_MAPPING_ASSIST_SCHEMA_VERSION = 'fact-mapping-assist-v1' as const;
export const FACT_MAPPING_PROMPT_VERSION = 'fact-mapping-prompt-v1' as const;
export const FACT_MAPPING_JOB_TYPE = 'FACT_MAPPING_CHECK_V1' as const;
export const FACT_MAPPING_CONFIRMATION = 'APPLY_FACT_MAPPING_ACTION' as const;

export const DRAFT_ARTIFACT_KINDS = [
  'SELECTED_TITLE',
  'BODY_BLOCK',
  'TAG',
  'PINNED_COMMENT',
] as const;
export type DraftArtifactKind = (typeof DRAFT_ARTIFACT_KINDS)[number];

export const STATEMENT_KINDS = [
  'FACT',
  'OPINION',
  'ANALYTICAL_JUDGMENT',
  'PERSONAL_EXPERIENCE',
  'RHETORICAL',
  'LABEL_OR_WARNING',
  'MIXED',
  'AMBIGUOUS',
] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export const FACT_MATERIALITIES = ['KEY_FACT', 'SUPPORTING_FACT', 'NOT_APPLICABLE'] as const;
export type FactMateriality = (typeof FACT_MATERIALITIES)[number];

export const FACT_DOMAINS = [
  'BIBLIOGRAPHIC',
  'AWARD',
  'NUMERIC',
  'DATE_TIME',
  'RANKING',
  'QUOTATION_ATTRIBUTION',
  'PLOT_OR_STRUCTURE',
  'INDUSTRY_OR_MARKET',
  'CREATOR_OR_PUBLISHER',
  'OTHER',
  'NOT_APPLICABLE',
] as const;
export type FactDomain = (typeof FACT_DOMAINS)[number];

export const STATEMENT_PROVENANCE = [
  'DETERMINISTIC',
  'MODEL_CANDIDATE',
  'USER_DEFINED',
  'USER_CONFIRMED',
] as const;
export type StatementProvenance = (typeof STATEMENT_PROVENANCE)[number];

export const PROTECTED_SIGNAL_KINDS = [
  'NUMBER',
  'PERCENT',
  'CURRENCY',
  'DATE',
  'RANKING',
  'AWARD',
  'ISBN',
  'BIBLIOGRAPHIC_IDENTITY',
  'QUOTATION_ATTRIBUTION',
] as const;
export type ProtectedSignalKind = (typeof PROTECTED_SIGNAL_KINDS)[number];

export const MAPPING_RELATIONS = [
  'EXACT',
  'SUPPORTED_PARAPHRASE',
  'NARROWER_THAN_CLAIM',
  'BROADER_THAN_CLAIM',
  'VALUE_CONFLICT',
  'SCOPE_MISMATCH',
  'SUBJECT_MISMATCH',
  'PREDICATE_MISMATCH',
  'MULTIPLE_CANDIDATES',
  'NO_CLAIM',
  'STALE',
  'NOT_APPLICABLE',
] as const;
export type MappingRelation = (typeof MAPPING_RELATIONS)[number];

export const FACT_MAPPING_RUN_STATUSES = [
  'PLANNED',
  'QUEUED',
  'RUNNING',
  'AWAITING_REVIEW',
  'PASS',
  'FACT_BLOCKED',
  'FAILED',
  'CANCELLED',
  'AMBIGUOUS',
  'STALE',
  'SUPERSEDED',
] as const;
export type FactMappingRunStatus = (typeof FACT_MAPPING_RUN_STATUSES)[number];

export const STATEMENT_DISPOSITIONS = [
  'SATISFIED',
  'NOT_APPLICABLE',
  'NEEDS_REVIEW',
  'BLOCKING_KEY_FACT',
  'UNMAPPED_SUPPORTING_FACT',
  'CONFLICTED',
  'STALE',
] as const;
export type StatementDisposition = (typeof STATEMENT_DISPOSITIONS)[number];

export const FACT_MAPPING_MODES = ['LOCAL_MANUAL', 'MODEL_ASSISTED'] as const;
export type FactMappingMode = (typeof FACT_MAPPING_MODES)[number];

export const FACT_MAPPING_DECISION_KINDS = [
  'CONFIRM_CLASSIFICATION',
  'RECLASSIFY',
  'SPLIT',
  'MAP_CLAIM',
  'UNMAP_CLAIM',
  'UNDO',
  'REOPEN',
] as const;
export type FactMappingDecisionKind = (typeof FACT_MAPPING_DECISION_KINDS)[number];

export const FACT_MAPPING_LIMITS = Object.freeze({
  artifacts: 64,
  artifactCodePoints: 20_000,
  candidateClaims: 256,
  confirmationTtlMs: 5 * 60 * 1_000,
  evidenceExcerptCodePoints: 600,
  evidencePerClaim: 64,
  identifierBytes: 512,
  maxInputCodePoints: 40_000,
  maxModelOutputBytes: 256_000,
  maxPageOffset: 1_000_000,
  maxPageSize: 100,
  maxRequests: 1,
  modelCandidateStatements: 512,
  reasonCodePoints: 500,
  signals: 1_024,
  sourceRevisions: 512,
  statements: 512,
});
