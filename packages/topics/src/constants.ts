export const TOPIC_CANDIDATE_CONTRACT_VERSION = 'topic-candidate-v1' as const;
export const TOPIC_ELIGIBILITY_POLICY_VERSION = 'topic-eligibility-policy-v1' as const;
export const TOPIC_RANKING_POLICY_VERSION = 'topic-ranking-policy-v1' as const;
export const TOPIC_FINGERPRINT_POLICY_VERSION = 'topic-semantic-fingerprint-v1' as const;
export const TOPIC_STATE_POLICY_VERSION = 'topic-state-policy-v1' as const;
export const TOPIC_QUOTA_SOLVER_VERSION = 'topic-quota-solver-v1' as const;
export const TOPIC_GENERATION_PLAN_VERSION = 'topic-generation-plan-v1' as const;
export const TOPIC_PROPOSAL_VERSION = 'topic-proposal-v1' as const;
export const TOPIC_GENERATION_JOB_CONTRACT_VERSION = 'topic-generation-job-v1' as const;
export const TOPIC_QUOTA_JOB_CONTRACT_VERSION = 'topic-quota-job-v1' as const;
export const TOPIC_GENERATE_JOB_TYPE = 'TOPIC_GENERATE_V1' as const;
export const TOPIC_QUOTA_PLAN_JOB_TYPE = 'TOPIC_QUOTA_PLAN_V1' as const;

export const TOPIC_CONTENT_TYPES = [
  'NON_SPOILER_SINGLE_BOOK_VERDICT',
  'FULL_TRICK_LOGIC_ANALYSIS',
  'CROSS_WORK_COMPARISON',
  'WEB_VS_PUBLISHED_MYSTERY',
  'MYSTERY_AND_CULTURAL_PHENOMENON',
] as const;
export type TopicContentType = (typeof TOPIC_CONTENT_TYPES)[number];

export const FIRST_30_PROFILE_ID = 'FIRST_30_V1' as const;
export const FIRST_30_QUOTAS = Object.freeze({
  NON_SPOILER_SINGLE_BOOK_VERDICT: 10,
  FULL_TRICK_LOGIC_ANALYSIS: 8,
  CROSS_WORK_COMPARISON: 6,
  WEB_VS_PUBLISHED_MYSTERY: 3,
  MYSTERY_AND_CULTURAL_PHENOMENON: 3,
} satisfies Readonly<Record<TopicContentType, number>>);
export const FIRST_30_TOTAL = 30 as const;

export const TOPIC_ANALYSIS_MODES = ['PERSONAL', 'PUBLIC_RESEARCH'] as const;
export type TopicAnalysisMode = (typeof TOPIC_ANALYSIS_MODES)[number];

export const TOPIC_ELIGIBILITY_STATES = [
  'ELIGIBLE',
  'DOSSIER_NOT_READY',
  'AUTHENTICITY_BLOCKED',
  'FACT_BLOCKED',
  'STALE',
  'INSUFFICIENT_COMPARISON_SET',
  'SPOILER_POLICY_INCOMPLETE',
  'DUPLICATE',
  'ARCHIVED',
] as const;
export type TopicEligibilityState = (typeof TOPIC_ELIGIBILITY_STATES)[number];

export const TOPIC_CANDIDATE_STATES = ['PROPOSED', 'LOCKED', 'HELD', 'ARCHIVED'] as const;
export type TopicCandidateState = (typeof TOPIC_CANDIDATE_STATES)[number];

export const TOPIC_RANKING_COMPONENTS = [
  'EVIDENCE_SUFFICIENCY',
  'CONTENT_FIT',
  'DIFFERENTIATION',
  'ESTIMATED_COST',
  'APPROVAL_WORKLOAD',
] as const;
export type TopicRankingComponent = (typeof TOPIC_RANKING_COMPONENTS)[number];

export const TOPIC_SCORE_KNOWLEDGE_STATES = ['KNOWN', 'UNKNOWN'] as const;
export type TopicScoreKnowledgeState = (typeof TOPIC_SCORE_KNOWLEDGE_STATES)[number];

export const TOPIC_COMPARISON_DIMENSIONS = [
  'TRICK_STRUCTURE',
  'NARRATIVE_PERSPECTIVE',
  'FAIR_PLAY',
  'SOCIAL_CONTEXT',
  'PUBLICATION_FORM',
  'RECEPTION',
] as const;
export type TopicComparisonDimension = (typeof TOPIC_COMPARISON_DIMENSIONS)[number];

export const TOPIC_EXPRESSION_FORMS = [
  'WEB_SERIALIZED',
  'PUBLISHED_EDITION',
  'OTHER_VERIFIED',
] as const;
export type TopicExpressionForm = (typeof TOPIC_EXPRESSION_FORMS)[number];

export const TOPIC_SUBJECT_TYPES = ['WORK', 'EXPRESSION', 'EDITION'] as const;
export type TopicSubjectType = (typeof TOPIC_SUBJECT_TYPES)[number];

export const TOPIC_SUBJECT_ROLES = ['PRIMARY', 'COMPARISON', 'CONTEXT'] as const;
export type TopicSubjectRole = (typeof TOPIC_SUBJECT_ROLES)[number];

export const TOPIC_PLAN_STATUSES = [
  'PREVIEW',
  'COMPLETE',
  'INCOMPLETE',
  'STALE',
  'SUPERSEDED',
] as const;
export type TopicPlanStatus = (typeof TOPIC_PLAN_STATUSES)[number];

export const TOPIC_RUN_STATUSES = [
  'PREVIEWED',
  'CONFIRMED',
  'RUNNING',
  'SUCCEEDED',
  'NO_OP',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'FAILED',
  'AMBIGUOUS',
] as const;
export type TopicRunStatus = (typeof TOPIC_RUN_STATUSES)[number];

export const TOPIC_REASON_CODES = [
  'ARCHIVED_CANDIDATE',
  'AUTHENTICITY_MODE_BLOCKED',
  'AUTHENTICITY_SNAPSHOT_MISSING',
  'AUTHENTICITY_SNAPSHOT_STALE',
  'COMPARISON_DIMENSION_UNSUPPORTED',
  'COMPARISON_SET_TOO_SMALL',
  'CONTENT_TYPE_FIT',
  'CONTEXT_FACT_REQUIRED',
  'COST_KNOWN_LOCAL_ONLY',
  'COST_UNKNOWN',
  'DOSSIER_FACT_BLOCKED',
  'DOSSIER_MISSING',
  'DOSSIER_NOT_READY',
  'DOSSIER_STALE',
  'DUPLICATE_SEMANTIC_TOPIC',
  'ELIGIBLE_CURRENT_INPUTS',
  'EVIDENCE_BLOCKED',
  'EVIDENCE_COVERAGE',
  'EVIDENCE_GAPS',
  'EXPOSURE_LIMIT_REACHED',
  'FORM_CLASSIFICATION_REQUIRED',
  'FULL_TRICK_WARNING_REQUIRED',
  'LOCKED_PRIORITY',
  'NO_CROSS_CATEGORY_SUBSTITUTION',
  'PUBLIC_RESEARCH_LABEL_REQUIRED',
  'RANKING_COMPONENT_UNKNOWN',
  'SEMANTIC_DIFFERENTIATION',
  'SPOILER_LEVEL_MISMATCH',
  'SPOILER_POLICY_INCOMPLETE',
  'SUBJECT_NOT_CURRENT',
  'TOPIC_STATE_FILTERED',
  'WORKLOAD_ESTIMATED_UNITS',
  'WORKLOAD_UNKNOWN',
] as const;
export type TopicReasonCode = (typeof TOPIC_REASON_CODES)[number];

export const TOPIC_DEPENDENCY_TYPES = [
  'CATALOG_SUBJECT',
  'DOSSIER_VERSION',
  'DOSSIER_READINESS',
  'EXPRESSION_PERMISSION',
  'AUTHENTICITY_POLICY',
  'SPOILER_POLICY',
  'FACT_POLICY',
  'CONTEXT_CLAIM',
  'TOPIC_POOL',
  'TOPIC_POLICY',
] as const;
export type TopicDependencyType = (typeof TOPIC_DEPENDENCY_TYPES)[number];

export const TOPIC_STATE_ACTIONS = [
  'LOCK',
  'HOLD',
  'RESUME',
  'ARCHIVE',
  'RESTORE',
  'UNDO',
] as const;
export type TopicStateAction = (typeof TOPIC_STATE_ACTIONS)[number];

export const TOPIC_LIMITS = Object.freeze({
  angleBytes: 1_000,
  batchSize: 50,
  centralQuestionBytes: 1_000,
  confirmationTtlMs: 5 * 60 * 1_000,
  contextClaims: 8,
  identifierBytes: 256,
  judgmentBytes: 1_000,
  localCombinationLimit: 5_000,
  maxCandidatesPerGeneration: 5_000,
  maxHistoryPageSize: 100,
  maxPageOffset: 1_000_000,
  maxPageSize: 100,
  maxPlanCandidates: 10_000,
  maxSubjects: 6,
  maxWorkExposure: 10,
  reasonCodes: 64,
  scoreBasisPoints: 10_000,
});

export const TOPIC_RANKING_WEIGHTS = Object.freeze({
  APPROVAL_WORKLOAD: 1_500,
  CONTENT_FIT: 2_500,
  DIFFERENTIATION: 2_000,
  ESTIMATED_COST: 1_000,
  EVIDENCE_SUFFICIENCY: 3_000,
} satisfies Readonly<Record<TopicRankingComponent, number>>);

export const TOPIC_PUBLIC_LABELS = ['公开资料整理', '资料分析评分'] as const;
export type TopicPublicLabel = (typeof TOPIC_PUBLIC_LABELS)[number];
