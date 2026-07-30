export const READING_STATE_CONTRACT_VERSION = 'reading-state-v1' as const;
export const AUTHENTICITY_POLICY_VERSION = 'reading-authenticity-policy-v1' as const;
export const EXPRESSION_PERMISSION_VERSION = 'expression-permission-v1' as const;
export const SCORE_POLICY_VERSION = 'score-origin-policy-v1' as const;
export const SPOILER_POLICY_VERSION = 'spoiler-policy-v1' as const;

export const READING_STATES = [
  'R1_READ_CLEAR',
  'R2_READ_FUZZY',
  'R3_READ_UNCONFIRMED_DETAILS',
  'S1_RESEARCH_ONLY',
  'S2_RESEARCH_INSUFFICIENT',
  'UNCLASSIFIED',
] as const;
export type ReadingStateCode = (typeof READING_STATES)[number];

export const MEMORY_CONFIDENCES = [
  'CLEAR',
  'PARTIAL',
  'FADED',
  'NOT_APPLICABLE',
  'UNKNOWN',
] as const;
export type MemoryConfidence = (typeof MEMORY_CONFIDENCES)[number];

export const READING_CONFIRMATION_KINDS = [
  'USER_EXPLICIT',
  'USER_BATCH_EXPLICIT',
  'USER_UNDO',
  'LEGACY_MIGRATION',
] as const;
export type ReadingConfirmationKind = (typeof READING_CONFIRMATION_KINDS)[number];

export const READING_DATE_PRECISIONS = ['DAY', 'MONTH', 'YEAR', 'UNKNOWN'] as const;
export type ReadingDatePrecision = (typeof READING_DATE_PRECISIONS)[number];

export const EXPERIENCE_ASSERTION_KINDS = [
  'READING_IMPRESSION',
  'PLOT_OR_STRUCTURE_MEMORY',
  'CHARACTER_MEMORY',
  'TRICK_OR_REASONING_MEMORY',
  'PERSONAL_PREFERENCE',
  'PERSONAL_SCORE',
] as const;
export type ExperienceAssertionKind = (typeof EXPERIENCE_ASSERTION_KINDS)[number];

export const EXPERIENCE_CONFIRMATION_SCOPES = [
  'EXACT_STATEMENT',
  'EXACT_STRUCTURED_OPINION',
] as const;
export type ExperienceConfirmationScope = (typeof EXPERIENCE_CONFIRMATION_SCOPES)[number];

export const EXPERIENCE_ASSERTION_STATUSES = ['CONFIRMED', 'REVOKED'] as const;
export type ExperienceAssertionStatus = (typeof EXPERIENCE_ASSERTION_STATUSES)[number];

export const EXPRESSION_PERMISSION_STATES = [
  'ALLOWED',
  'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY',
  'RESEARCH_ONLY',
  'BLOCKED',
  'STALE_REVIEW_REQUIRED',
] as const;
export type ExpressionPermissionState = (typeof EXPRESSION_PERMISSION_STATES)[number];

export const SCORE_ORIGINS = [
  'PERSONAL_SCORE',
  'RESEARCH_ANALYSIS_SCORE',
  'SYSTEM_PREDICTION_INTERNAL',
] as const;
export type ScoreOrigin = (typeof SCORE_ORIGINS)[number];

export const PUBLIC_SCORE_ORIGINS = ['PERSONAL_SCORE', 'RESEARCH_ANALYSIS_SCORE'] as const;
export type PublicScoreOrigin = (typeof PUBLIC_SCORE_ORIGINS)[number];

export const SPOILER_LEVELS = ['NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS'] as const;
export type AuthenticitySpoilerLevel = (typeof SPOILER_LEVELS)[number];

export const SPOILER_WARNING_PLACEMENTS = [
  'NONE',
  'BODY_OPENING',
  'COVER_TITLE_AND_BODY_OPENING',
] as const;
export type SpoilerWarningPlacement = (typeof SPOILER_WARNING_PLACEMENTS)[number];

export const DOSSIER_READINESS_INPUTS = [
  'NOT_BUILT',
  'BUILD_REQUIRED',
  'INSUFFICIENT_COVERAGE',
  'FACT_BLOCKED',
  'STALE',
  'READY_FOR_CONTENT_BRIEF',
] as const;
export type DossierReadinessInput = (typeof DOSSIER_READINESS_INPUTS)[number];

export const AUTHENTICITY_REASON_CODES = [
  'ASSERTION_REQUIRED',
  'DOSSIER_FACT_BLOCKED',
  'DOSSIER_INSUFFICIENT',
  'DOSSIER_NOT_READY',
  'DOSSIER_STALE',
  'FIRST_PERSON_BLOCKED',
  'PERSONAL_SCORE_ASSERTION_REQUIRED',
  'PERSONAL_SCORE_BLOCKED',
  'PUBLIC_RESEARCH_LABEL_REQUIRED',
  'R3_DETAILS_UNCONFIRMED',
  'READING_STATE_UNCLASSIFIED',
  'RESEARCH_ANALYSIS_BLOCKED',
  'RESEARCH_SCORE_LABEL_REQUIRED',
  'S2_RESEARCH_INSUFFICIENT',
  'SNAPSHOT_STALE',
  'SPOILER_USER_CONFIRMATION_REQUIRED',
  'SPOILER_WARNING_REQUIRED',
] as const;
export type AuthenticityReasonCode = (typeof AUTHENTICITY_REASON_CODES)[number];

export const AUTHENTICITY_DEPENDENCY_TYPES = [
  'READING_STATE',
  'EXPERIENCE_ASSERTION',
  'DOSSIER_VERSION',
  'DOSSIER_READINESS',
  'AUTHENTICITY_POLICY',
  'SCORE_POLICY',
  'SPOILER_POLICY',
  'CATALOG_SUBJECT',
  'PROFILE',
] as const;
export type AuthenticityDependencyType = (typeof AUTHENTICITY_DEPENDENCY_TYPES)[number];

export const AUTHENTICITY_LIMITS = Object.freeze({
  assertionBytes: 2_000,
  batchSize: 50,
  confirmationTtlMs: 5 * 60 * 1_000,
  contextIdentifierBytes: 768,
  identifierBytes: 256,
  maxAssertionsPerWork: 100,
  maxHistoryPageSize: 100,
  maxPageSize: 100,
  noteBytes: 2_000,
  scoreBasisPoints: 10_000,
});
