import type { TopicContentType } from '@mystery-operations/topics';

export const CONTENT_BRIEF_CONTRACT_VERSION = 'content-brief-v1' as const;
export const CONTENT_BRIEF_SCHEMA_VERSION = 'content-brief-schema-v1' as const;
export const CONTENT_BRIEF_PROFILE_REGISTRY_VERSION = 'brief-profile-registry-v1' as const;
export const CONTENT_BRIEF_READINESS_POLICY_VERSION = 'brief-readiness-policy-v1' as const;
export const CONTENT_BRIEF_FORBIDDEN_REGISTRY_VERSION = 'forbidden-expression-registry-v1' as const;
export const CONTENT_BRIEF_GENERATION_CONTRACT_VERSION = 'content-brief-generation-v1' as const;
export const CONTENT_BRIEF_GENERATION_PROMPT_VERSION =
  'content-brief-structured-prompt-v1' as const;
export const CONTENT_BRIEF_GENERATE_JOB_TYPE = 'CONTENT_BRIEF_GENERATE_V1' as const;
export const CONTENT_BRIEF_CONFIRMATION_LITERAL = 'APPLY_CONTENT_BRIEF_ACTION' as const;

export const BRIEF_PROFILE_IDS = [
  'NON_SPOILER_SINGLE_BOOK_VERDICT',
  'FULL_TRICK_LOGIC_ANALYSIS',
  'CROSS_WORK_COMPARISON',
  'WEB_VS_PUBLISHED_MYSTERY',
  'MYSTERY_AND_CULTURAL_PHENOMENON',
] as const satisfies readonly TopicContentType[];
export type BriefProfileId = (typeof BRIEF_PROFILE_IDS)[number];

export const BRIEF_READINESS_STATUSES = [
  'DRAFT_INCOMPLETE',
  'DOSSIER_NOT_READY',
  'FACT_BLOCKED',
  'AUTHENTICITY_BLOCKED',
  'SPOILER_POLICY_INCOMPLETE',
  'EXPERIMENT_MISMATCH',
  'EVIDENCE_MAPPING_INCOMPLETE',
  'STALE',
  'READY_FOR_DRAFT_GENERATION',
] as const;
export type BriefReadinessStatus = (typeof BRIEF_READINESS_STATUSES)[number];

export const BRIEF_SCORE_KINDS = ['NONE', 'PERSONAL_SCORE', 'RESEARCH_ANALYSIS_SCORE'] as const;
export type BriefScoreKind = (typeof BRIEF_SCORE_KINDS)[number];

export const BRIEF_AUDIENCE_KNOWLEDGE_LEVELS = [
  'NEW_TO_WORK',
  'FAMILIAR_WITH_WORK',
  'MIXED',
] as const;
export type BriefAudienceKnowledgeLevel = (typeof BRIEF_AUDIENCE_KNOWLEDGE_LEVELS)[number];

export const BRIEF_EXPRESSION_MODES = ['PERSONAL_EXPERIENCE', 'PUBLIC_RESEARCH_ANALYSIS'] as const;
export type BriefExpressionMode = (typeof BRIEF_EXPRESSION_MODES)[number];

export const BRIEF_FIELD_PROVENANCE = [
  'SYSTEM_DERIVED',
  'MODEL_CANDIDATE',
  'USER_EDITED',
  'USER_CONFIRMED',
] as const;
export type BriefFieldProvenance = (typeof BRIEF_FIELD_PROVENANCE)[number];

export const BRIEF_FIELD_LOCKS = ['EDITABLE', 'USER_LOCKED', 'SYSTEM_LOCKED'] as const;
export type BriefFieldLockState = (typeof BRIEF_FIELD_LOCKS)[number];

export const BRIEF_FORBIDDEN_CATEGORIES = [
  'GLOBAL_ACCOUNT',
  'AUTHENTICITY',
  'FACT_POLICY',
  'SPOILER',
  'CONTENT_TYPE',
  'USER_CUSTOM',
] as const;
export type BriefForbiddenCategory = (typeof BRIEF_FORBIDDEN_CATEGORIES)[number];

export const BRIEF_DEPENDENCY_TYPES = [
  'TOPIC_VERSION',
  'TOPIC_STATE',
  'TOPIC_ELIGIBILITY',
  'TOPIC_QUOTA_PLAN',
  'EXPERIMENT_DESIGN',
  'EXPERIMENT_ASSIGNMENT',
  'WORK_IDENTITY',
  'EXPRESSION_IDENTITY',
  'EDITION_IDENTITY',
  'DOSSIER_VERSION',
  'DOSSIER_ENTRY',
  'CLAIM',
  'FACT_EVALUATION',
  'EVIDENCE_LOCATOR',
  'SOURCE_REVISION',
  'EXPRESSION_PERMISSION',
  'READING_STATE',
  'R2_ASSERTION',
  'SCORE_POLICY',
  'SPOILER_POLICY',
  'AUTHENTICITY_POLICY',
  'PROFILE_POLICY',
  'READINESS_POLICY',
  'FORBIDDEN_POLICY',
  'SCHEMA_POLICY',
  'PROMPT_POLICY',
  'LOCK_SNAPSHOT',
] as const;
export type BriefDependencyType = (typeof BRIEF_DEPENDENCY_TYPES)[number];

export const BRIEF_VERSION_STATES = [
  'DRAFT',
  'MODEL_CANDIDATE',
  'USER_CONFIRMED',
  'ARCHIVED',
] as const;
export type BriefVersionState = (typeof BRIEF_VERSION_STATES)[number];

export const BRIEF_ACTIONS = [
  'CREATE_SCAFFOLD',
  'SAVE_EDIT',
  'LOCK_FIELD',
  'UNLOCK_FIELD',
  'UNDO',
  'CLONE',
  'ARCHIVE',
  'RESTORE',
  'PREVIEW_GENERATION',
  'CONFIRM_GENERATION',
  'CANCEL_GENERATION',
] as const;
export type BriefAction = (typeof BRIEF_ACTIONS)[number];

export const BRIEF_LIMITS = Object.freeze({
  arguments: 12,
  assertionIds: 32,
  confirmationTtlMs: 5 * 60 * 1_000,
  controlledConditions: 16,
  dependencies: 256,
  evidenceRefs: 128,
  fieldStates: 256,
  forbiddenExpressions: 64,
  identifierBytes: 512,
  maxInputCharacters: 120_000,
  maxOutputBytes: 128_000,
  maxPageOffset: 1_000_000,
  maxPageSize: 100,
  maxRequests: 1,
  maxWarnings: 64,
  openQuestions: 32,
  reasonCodes: 64,
  structureSlots: 16,
  subjects: 6,
  textBytes: 4_096,
});

export interface BriefProfileDefinition {
  readonly allowedSpoilerLevels: readonly ('NO_SPOILER' | 'FULL_TRICK_ANALYSIS')[];
  readonly contentType: BriefProfileId;
  readonly minimumPrimaryWorks: number;
  readonly profileId: BriefProfileId;
  readonly requiredSlots: readonly string[];
  readonly requiresComparisonDimension: boolean;
  readonly requiresExpressionForms: boolean;
  readonly version: typeof CONTENT_BRIEF_PROFILE_REGISTRY_VERSION;
}

export const BRIEF_PROFILE_REGISTRY: Readonly<Record<BriefProfileId, BriefProfileDefinition>> =
  Object.freeze({
    CROSS_WORK_COMPARISON: Object.freeze({
      allowedSpoilerLevels: Object.freeze(['NO_SPOILER', 'FULL_TRICK_ANALYSIS'] as const),
      contentType: 'CROSS_WORK_COMPARISON',
      minimumPrimaryWorks: 2,
      profileId: 'CROSS_WORK_COMPARISON',
      requiredSlots: Object.freeze([
        'comparison-frame',
        'work-a-evidence',
        'work-b-evidence',
        'symmetric-comparison',
        'counterargument',
        'qualified-verdict',
      ]),
      requiresComparisonDimension: true,
      requiresExpressionForms: false,
      version: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
    }),
    FULL_TRICK_LOGIC_ANALYSIS: Object.freeze({
      allowedSpoilerLevels: Object.freeze(['FULL_TRICK_ANALYSIS'] as const),
      contentType: 'FULL_TRICK_LOGIC_ANALYSIS',
      minimumPrimaryWorks: 1,
      profileId: 'FULL_TRICK_LOGIC_ANALYSIS',
      requiredSlots: Object.freeze([
        'spoiler-warning',
        'trick-reconstruction',
        'clue-fairness',
        'logic-validity',
        'misdirection-gaps',
        'counterargument',
        'qualified-verdict',
      ]),
      requiresComparisonDimension: false,
      requiresExpressionForms: false,
      version: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
    }),
    MYSTERY_AND_CULTURAL_PHENOMENON: Object.freeze({
      allowedSpoilerLevels: Object.freeze(['NO_SPOILER', 'FULL_TRICK_ANALYSIS'] as const),
      contentType: 'MYSTERY_AND_CULTURAL_PHENOMENON',
      minimumPrimaryWorks: 1,
      profileId: 'MYSTERY_AND_CULTURAL_PHENOMENON',
      requiredSlots: Object.freeze([
        'work-anchor',
        'traceable-context',
        'phenomenon-analysis',
        'fact-context-boundary',
        'counterargument',
        'qualified-verdict',
      ]),
      requiresComparisonDimension: false,
      requiresExpressionForms: false,
      version: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
    }),
    NON_SPOILER_SINGLE_BOOK_VERDICT: Object.freeze({
      allowedSpoilerLevels: Object.freeze(['NO_SPOILER'] as const),
      contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
      minimumPrimaryWorks: 1,
      profileId: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
      requiredSlots: Object.freeze([
        'reader-fit',
        'main-strength',
        'main-weakness',
        'counterargument',
        'reading-verdict',
      ]),
      requiresComparisonDimension: false,
      requiresExpressionForms: false,
      version: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
    }),
    WEB_VS_PUBLISHED_MYSTERY: Object.freeze({
      allowedSpoilerLevels: Object.freeze(['NO_SPOILER', 'FULL_TRICK_ANALYSIS'] as const),
      contentType: 'WEB_VS_PUBLISHED_MYSTERY',
      minimumPrimaryWorks: 1,
      profileId: 'WEB_VS_PUBLISHED_MYSTERY',
      requiredSlots: Object.freeze([
        'verified-form-context',
        'creation-comparison',
        'structure-comparison',
        'reading-experience-comparison',
        'counterargument',
        'qualified-verdict',
      ]),
      requiresComparisonDimension: true,
      requiresExpressionForms: true,
      version: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
    }),
  });

export const SYSTEM_FORBIDDEN_EXPRESSIONS = Object.freeze([
  Object.freeze({
    category: 'AUTHENTICITY' as const,
    id: 'system:no-fabricated-first-person',
    phrase: '不得伪造第一人称阅读亲历',
    reason: '第一人称体验必须来自当前阅读真实性权限',
  }),
  Object.freeze({
    category: 'AUTHENTICITY' as const,
    id: 'system:no-research-as-personal-score',
    phrase: '不得把资料分析评分写成个人评分',
    reason: '个人评分与资料分析评分必须隔离',
  }),
  Object.freeze({
    category: 'FACT_POLICY' as const,
    id: 'system:no-model-memory-as-source',
    phrase: '不得把模型记忆写成事实来源',
    reason: '事实必须映射到当前受控证据链',
  }),
  Object.freeze({
    category: 'FACT_POLICY' as const,
    id: 'system:no-gap-as-fact',
    phrase: '不得把资料缺口或未知写成确定事实',
    reason: '未知保持未知',
  }),
  Object.freeze({
    category: 'SPOILER' as const,
    id: 'system:no-answer-in-non-spoiler',
    phrase: '非剧透类型不得出现答案性表达',
    reason: '遵守选题绑定的剧透政策',
  }),
  Object.freeze({
    category: 'GLOBAL_ACCOUNT' as const,
    id: 'system:no-ai-experiment-claim',
    phrase: '不得宣称账号是 AI 运营实验',
    reason: '账号内容不以 AI 参与度作为产品判断',
  }),
  Object.freeze({
    category: 'GLOBAL_ACCOUNT' as const,
    id: 'system:no-group-attack',
    phrase: '不得引战或攻击作者、读者与群体',
    reason: '批评作品，不攻击个人或群体',
  }),
  Object.freeze({
    category: 'GLOBAL_ACCOUNT' as const,
    id: 'system:no-empty-superlatives',
    phrase: '不得用空泛神作、封神或后劲太大替代核心判断',
    reason: '核心判断必须明确并可限定',
  }),
]);
