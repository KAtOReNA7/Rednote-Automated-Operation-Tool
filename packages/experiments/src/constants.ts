export const EXPERIMENT_CONTRACT_VERSION = 'experiment-design-v1' as const;
export const EXPERIMENT_HYPOTHESIS_VERSION = 'experiment-hypothesis-v1' as const;
export const EXPERIMENT_VARIABLE_REGISTRY_VERSION = 'experiment-variable-registry-v1' as const;
export const EXPERIMENT_METRIC_REGISTRY_VERSION = 'experiment-metric-registry-v1' as const;
export const EXPERIMENT_ASSIGNMENT_POLICY_VERSION = 'experiment-assignment-policy-v1' as const;
export const EXPERIMENT_REPLICATION_POLICY_VERSION = 'experiment-replication-policy-v1' as const;
export const EXPERIMENT_POPULARITY_POLICY_VERSION = 'work-popularity-stratum-v1' as const;
export const EXPERIMENT_STATE_POLICY_VERSION = 'experiment-state-policy-v1' as const;
export const EXPERIMENT_CONFIRMATION_LITERAL = 'APPLY_EXPERIMENT_ACTION' as const;

export const EXPERIMENT_VARIABLE_KINDS = [
  'CONTENT_STRUCTURE',
  'TITLE_PATTERN',
  'COVER_INFORMATION_DENSITY',
  'SPOILER_MODE',
  'COMPARISON_FORMAT',
  'PUBLICATION_TIME_WINDOW',
] as const;
export type ExperimentVariableKind = (typeof EXPERIMENT_VARIABLE_KINDS)[number];

export const EXPERIMENT_VARIABLE_VALUES = Object.freeze({
  COMPARISON_FORMAT: Object.freeze(['PAIRWISE', 'GROUPED_DIMENSION', 'TIMELINE_CONTRAST']),
  CONTENT_STRUCTURE: Object.freeze([
    'CLAIM_EVIDENCE_COUNTERPOINT',
    'QUESTION_ANALYSIS_VERDICT',
    'OBSERVATION_MECHANISM_IMPLICATION',
  ]),
  COVER_INFORMATION_DENSITY: Object.freeze(['FUTURE_SPARSE', 'FUTURE_BALANCED', 'FUTURE_DENSE']),
  PUBLICATION_TIME_WINDOW: Object.freeze([
    'FUTURE_WEEKDAY_DAY',
    'FUTURE_WEEKDAY_EVENING',
    'FUTURE_WEEKEND',
  ]),
  SPOILER_MODE: Object.freeze(['NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS']),
  TITLE_PATTERN: Object.freeze([
    'FUTURE_QUESTION_LED',
    'FUTURE_JUDGMENT_LED',
    'FUTURE_CONTRAST_LED',
  ]),
} satisfies Readonly<Record<ExperimentVariableKind, readonly string[]>>);

export const EXPERIMENT_FUTURE_BOUND_VARIABLES = [
  'TITLE_PATTERN',
  'COVER_INFORMATION_DENSITY',
  'PUBLICATION_TIME_WINDOW',
] as const;

export const EXPERIMENT_ARM_ROLES = ['CONTROL', 'TREATMENT'] as const;
export type ExperimentArmRole = (typeof EXPERIMENT_ARM_ROLES)[number];

export const EXPERIMENT_CONTROLLED_CONDITION_KINDS = [
  ...EXPERIMENT_VARIABLE_KINDS,
  'TOPIC_CONTENT_TYPE',
  'ANALYSIS_MODE',
  'WORK_POPULARITY_STRATUM',
] as const;
export type ExperimentControlledConditionKind =
  (typeof EXPERIMENT_CONTROLLED_CONDITION_KINDS)[number];

export const EXPERIMENT_METRIC_IDS = [
  'SAVE_RATE',
  'COMMENT_RATE',
  'FOLLOW_CONVERSION_RATE',
  'ENGAGEMENT_RATE',
  'PROFILE_VISIT_RATE',
  'APPROVAL_WORK_UNITS',
  'FACT_BLOCK_RATE',
] as const;
export type ExperimentMetricId = (typeof EXPERIMENT_METRIC_IDS)[number];

export const EXPERIMENT_METRIC_AVAILABILITY = [
  'DEFINED_NOT_AVAILABLE',
  'AVAILABLE_FOR_FUTURE_COLLECTION',
  'UNSUPPORTED',
] as const;
export type ExperimentMetricAvailability = (typeof EXPERIMENT_METRIC_AVAILABILITY)[number];

export const EXPERIMENT_METRIC_DIRECTIONS = ['INCREASE', 'DECREASE', 'LIMIT'] as const;
export type ExperimentMetricDirection = (typeof EXPERIMENT_METRIC_DIRECTIONS)[number];

export const EXPERIMENT_EXPECTED_DIRECTIONS = ['INCREASE', 'DECREASE'] as const;
export type ExperimentExpectedDirection = (typeof EXPERIMENT_EXPECTED_DIRECTIONS)[number];

export const EXPERIMENT_MISSING_VALUE_POLICIES = [
  'EXCLUDE_FROM_DENOMINATOR',
  'KEEP_AS_MISSING',
  'FAIL_CLOSED',
] as const;
export type ExperimentMissingValuePolicy = (typeof EXPERIMENT_MISSING_VALUE_POLICIES)[number];

export const EXPERIMENT_ZERO_DENOMINATOR_POLICIES = ['RETURN_UNAVAILABLE', 'FAIL_CLOSED'] as const;
export type ExperimentZeroDenominatorPolicy = (typeof EXPERIMENT_ZERO_DENOMINATOR_POLICIES)[number];

export const EXPERIMENT_POPULARITY_STRATA = ['HOT', 'WARM', 'COLD', 'UNKNOWN'] as const;
export type WorkPopularityStratum = (typeof EXPERIMENT_POPULARITY_STRATA)[number];

export const EXPERIMENT_POPULARITY_SOURCE_KINDS = [
  'USER_CONFIRMED_SYNTHETIC',
  'USER_CONFIRMED_OBSERVATION',
  'NOT_AVAILABLE',
] as const;
export type WorkPopularitySourceKind = (typeof EXPERIMENT_POPULARITY_SOURCE_KINDS)[number];

export const EXPERIMENT_POPULARITY_AVAILABILITY = [
  'AVAILABLE',
  'UNAVAILABLE',
  'STALE_REVIEW_REQUIRED',
] as const;
export type WorkPopularityAvailability = (typeof EXPERIMENT_POPULARITY_AVAILABILITY)[number];

export const EXPERIMENT_SAMPLE_PLAN_STATUSES = [
  'DRAFT',
  'INSUFFICIENT_SAMPLE',
  'INSUFFICIENT_REPLICATION',
  'UNBALANCED',
  'READY_TO_LOCK',
  'STALE',
] as const;
export type ExperimentSamplePlanStatus = (typeof EXPERIMENT_SAMPLE_PLAN_STATUSES)[number];

export const EXPERIMENT_DESIGN_STATES = [
  'DRAFT',
  'VALIDATED',
  'ASSIGNMENT_READY',
  'LOCKED',
  'HELD',
  'ARCHIVED',
  'SUPERSEDED',
  'STALE',
] as const;
export type ExperimentDesignState = (typeof EXPERIMENT_DESIGN_STATES)[number];

export const EXPERIMENT_ACTIONS = [
  'VALIDATE',
  'LOCK',
  'HOLD',
  'RESUME',
  'CLONE_VERSION',
  'ARCHIVE',
  'RESTORE',
] as const;
export type ExperimentAction = (typeof EXPERIMENT_ACTIONS)[number];

export const EXPERIMENT_DEPENDENCY_TYPES = [
  'TOPIC_VERSION',
  'TOPIC_STATE',
  'TOPIC_ELIGIBILITY',
  'TOPIC_QUOTA_PLAN',
  'WORK_IDENTITY',
  'DOSSIER_VERSION',
  'EXPRESSION_PERMISSION',
  'REPLICATION_STRUCTURE',
  'VARIABLE_POLICY',
  'METRIC_POLICY',
  'ASSIGNMENT_POLICY',
  'POPULARITY_POLICY',
  'POPULARITY_SNAPSHOT',
  'EXPERIMENT_DESIGN',
] as const;
export type ExperimentDependencyType = (typeof EXPERIMENT_DEPENDENCY_TYPES)[number];

export const EXPERIMENT_REASON_CODES = [
  'ASSIGNMENT_BALANCED',
  'ASSIGNMENT_SHORTFALL',
  'CONTROL_ARM_REQUIRED',
  'CONTROLLED_DIMENSION_CONFLICT',
  'DESIGN_VALID',
  'DUPLICATE_ARM_VALUE',
  'FUTURE_BOUND_INTENT_ONLY',
  'GUARDRAIL_DUPLICATES_PRIMARY',
  'HYPOTHESIS_NOT_FALSIFIABLE',
  'INSUFFICIENT_REPLICATION',
  'INSUFFICIENT_SAMPLE',
  'METRIC_NOT_AVAILABLE',
  'MULTIPLE_PRIMARY_VARIABLES',
  'NO_EFFECT_CONCLUSION',
  'POPULARITY_UNKNOWN',
  'REPLICATION_READY',
  'SAMPLE_LIMITATION',
  'STALE_DEPENDENCY',
  'TOPIC_INELIGIBLE',
  'TOPIC_NOT_CURRENT',
  'TOPIC_STATE_EXCLUDED',
  'UNKNOWN_STRATUM_PRESERVED',
  'UNSUPPORTED_VARIABLE',
] as const;
export type ExperimentReasonCode = (typeof EXPERIMENT_REASON_CODES)[number];

export const EXPERIMENT_LIMITS = Object.freeze({
  assumptions: 16,
  arms: 6,
  blockingKeys: 8,
  confirmationTtlMs: 5 * 60 * 1_000,
  controlledConditions: 16,
  guardrails: 8,
  identifierBytes: 256,
  maxHistoryPageSize: 100,
  maxPageOffset: 1_000_000,
  maxPageSize: 100,
  maxSampleTopics: 500,
  maxWorkUses: 8,
  reasons: 64,
  rules: 32,
  structureSlots: 16,
  textBytes: 2_000,
});
