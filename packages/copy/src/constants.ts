import type { BriefProfileId } from '@mystery-operations/briefs';

export const COPY_CONTRACT_VERSION = 'versioned-copy-v1' as const;
export const COPY_OUTPUT_SCHEMA_VERSION = 'copy-output-schema-v1' as const;
export const COPY_FORMAT_POLICY_VERSION = 'content-format-policy-v1' as const;
export const COPY_PROFILE_REGISTRY_VERSION = 'copy-profile-registry-v1' as const;
export const COPY_VOICE_POLICY_VERSION = 'account-voice-policy-v1' as const;
export const COPY_GENERATION_POLICY_VERSION = 'copy-generation-policy-v1' as const;
export const COPY_REWRITE_POLICY_VERSION = 'copy-rewrite-policy-v1' as const;
export const COPY_STRUCTURAL_VALIDATION_VERSION = 'draft-structural-validation-v1' as const;
export const COPY_PROMPT_TEMPLATE_VERSION = 'copy-prompt-template-v1' as const;
export const COPY_GENERATE_JOB_TYPE = 'COPY_GENERATE_V1' as const;
export const COPY_REWRITE_JOB_TYPE = 'COPY_REWRITE_V1' as const;
export const COPY_CONFIRMATION_LITERAL = 'APPLY_COPY_ACTION' as const;

export const COPY_DRAFT_STATUSES = [
  'MANUAL_DRAFT',
  'MODEL_CANDIDATE',
  'STRUCTURE_INVALID',
  'READY_FOR_QUALITY_PIPELINE',
  'STALE',
  'SUPERSEDED',
  'ARCHIVED',
] as const;
export type CopyDraftStatus = (typeof COPY_DRAFT_STATUSES)[number];

export const COPY_BLOCK_KINDS = [
  'OPENING_JUDGMENT',
  'SUPPORTING_POINT',
  'FACT_SYNTHESIS',
  'COUNTERARGUMENT',
  'QUALIFICATION',
  'COMPARISON',
  'CONCLUSION',
  'WARNING',
  'PUBLIC_LABEL',
] as const;
export type CopyBlockKind = (typeof COPY_BLOCK_KINDS)[number];

export const COPY_TITLE_KINDS = ['SELECTED', 'VARIANT'] as const;
export type CopyTitleKind = (typeof COPY_TITLE_KINDS)[number];

export const COPY_PROVENANCE = [
  'SYSTEM_DERIVED',
  'MODEL_GENERATED',
  'USER_EDITED',
  'USER_CONFIRMED',
] as const;
export type CopyFieldProvenance = (typeof COPY_PROVENANCE)[number];

export const COPY_LOCK_STATES = ['EDITABLE', 'USER_LOCKED', 'SYSTEM_LOCKED'] as const;
export type CopyFieldLockState = (typeof COPY_LOCK_STATES)[number];

export const COPY_REWRITE_SCOPES = [
  'SELECTED_TITLE',
  'TITLE_VARIANTS',
  'BODY_BLOCK',
  'BODY_BLOCK_RANGE',
  'TAG_SET',
  'PINNED_COMMENT',
  'SPOILER_WARNING_ARTIFACT',
] as const;
export type CopyRewriteScopeKind = (typeof COPY_REWRITE_SCOPES)[number];

export const COPY_MUTATION_OPERATIONS = ['FULL_GENERATION', 'REWRITE'] as const;
export type CopyMutationOperation = (typeof COPY_MUTATION_OPERATIONS)[number];

export const COPY_RUN_STATUSES = [
  'PREVIEWED',
  'CONFIRMED',
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'SUCCEEDED',
  'NO_OP',
  'CANCELLED',
  'FAILED',
  'AMBIGUOUS',
] as const;
export type CopyRunStatus = (typeof COPY_RUN_STATUSES)[number];

export const COPY_LIMITS = Object.freeze({
  blocks: 24,
  bodyCharacters: 20_000,
  confirmationTtlMs: 5 * 60 * 1_000,
  dependencies: 256,
  diffCharacters: 12_000,
  identifierBytes: 512,
  lineagePerArtifact: 16,
  maxInputCharacters: 120_000,
  maxOutputBytes: 128_000,
  maxPageOffset: 1_000_000,
  maxPageSize: 100,
  maxRequests: 1,
  paragraphCharacters: 1_500,
  pinnedCommentCharacters: 1_000,
  rewriteInstructionCharacters: 1_000,
  tagCharacters: 32,
  tagTotalCharacters: 160,
  tags: 10,
  titleCharacters: 80,
  titles: 6,
  warningCharacters: 240,
});

export interface CopyProfileDefinition {
  readonly forbiddenBlockKinds: readonly CopyBlockKind[];
  readonly minimumPrimarySubjects: number;
  readonly profileId: BriefProfileId;
  readonly requiredBlockKinds: readonly CopyBlockKind[];
  readonly requiresFullSpoilerWarnings: boolean;
  readonly symmetricComparison: boolean;
  readonly version: typeof COPY_PROFILE_REGISTRY_VERSION;
}

export const COPY_PROFILE_REGISTRY: Readonly<Record<BriefProfileId, CopyProfileDefinition>> =
  Object.freeze({
    NON_SPOILER_SINGLE_BOOK_VERDICT: Object.freeze({
      forbiddenBlockKinds: Object.freeze(['WARNING'] as const),
      minimumPrimarySubjects: 1,
      profileId: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
      requiredBlockKinds: Object.freeze([
        'OPENING_JUDGMENT',
        'SUPPORTING_POINT',
        'QUALIFICATION',
        'CONCLUSION',
      ] as const),
      requiresFullSpoilerWarnings: false,
      symmetricComparison: false,
      version: COPY_PROFILE_REGISTRY_VERSION,
    }),
    FULL_TRICK_LOGIC_ANALYSIS: Object.freeze({
      forbiddenBlockKinds: Object.freeze([]),
      minimumPrimarySubjects: 1,
      profileId: 'FULL_TRICK_LOGIC_ANALYSIS',
      requiredBlockKinds: Object.freeze([
        'WARNING',
        'OPENING_JUDGMENT',
        'FACT_SYNTHESIS',
        'COUNTERARGUMENT',
        'QUALIFICATION',
        'CONCLUSION',
      ] as const),
      requiresFullSpoilerWarnings: true,
      symmetricComparison: false,
      version: COPY_PROFILE_REGISTRY_VERSION,
    }),
    CROSS_WORK_COMPARISON: Object.freeze({
      forbiddenBlockKinds: Object.freeze([]),
      minimumPrimarySubjects: 2,
      profileId: 'CROSS_WORK_COMPARISON',
      requiredBlockKinds: Object.freeze([
        'OPENING_JUDGMENT',
        'COMPARISON',
        'COUNTERARGUMENT',
        'QUALIFICATION',
        'CONCLUSION',
      ] as const),
      requiresFullSpoilerWarnings: false,
      symmetricComparison: true,
      version: COPY_PROFILE_REGISTRY_VERSION,
    }),
    WEB_VS_PUBLISHED_MYSTERY: Object.freeze({
      forbiddenBlockKinds: Object.freeze([]),
      minimumPrimarySubjects: 1,
      profileId: 'WEB_VS_PUBLISHED_MYSTERY',
      requiredBlockKinds: Object.freeze([
        'OPENING_JUDGMENT',
        'COMPARISON',
        'QUALIFICATION',
        'CONCLUSION',
      ] as const),
      requiresFullSpoilerWarnings: false,
      symmetricComparison: false,
      version: COPY_PROFILE_REGISTRY_VERSION,
    }),
    MYSTERY_AND_CULTURAL_PHENOMENON: Object.freeze({
      forbiddenBlockKinds: Object.freeze([]),
      minimumPrimarySubjects: 1,
      profileId: 'MYSTERY_AND_CULTURAL_PHENOMENON',
      requiredBlockKinds: Object.freeze([
        'OPENING_JUDGMENT',
        'FACT_SYNTHESIS',
        'QUALIFICATION',
        'CONCLUSION',
      ] as const),
      requiresFullSpoilerWarnings: false,
      symmetricComparison: false,
      version: COPY_PROFILE_REGISTRY_VERSION,
    }),
  });

export const ACCOUNT_VOICE_POLICY = Object.freeze({
  forbiddenTraits: Object.freeze([
    'AI_OPERATION_EXPERIMENT',
    'AUTHOR_OR_READER_ATTACK',
    'ENGAGEMENT_BAIT_CONFLICT',
    'HYPE_WITHOUT_REASON',
    'LIVING_AUTHOR_STYLE_IMITATION',
    'UNSUPPORTED_TREND_SLANG',
  ] as const),
  humorUpperBound: 'LIGHT' as const,
  paragraphCharacterTarget: Object.freeze({ maximum: 360, minimum: 20 }),
  policyVersion: COPY_VOICE_POLICY_VERSION,
  reasonCodes: Object.freeze([
    'CLEAR_CORE_JUDGMENT',
    'SHORT_DIRECT_SENTENCES',
    'LIMITED_DRY_HUMOR',
    'CRITIQUE_WORK_NOT_PEOPLE',
  ] as const),
  requiredTraits: Object.freeze([
    'OPINIONATED',
    'SHORT_DIRECT_SENTENCES',
    'LIGHT_DRY_HUMOR',
  ] as const),
  sentenceCharacterTarget: Object.freeze({ maximum: 72, minimum: 4 }),
});

export const COPY_SYSTEM_LOCKED_PATHS = Object.freeze([
  'brief',
  'brief.briefId',
  'brief.briefVersionId',
  'brief.topicId',
  'brief.topicVersionId',
  'brief.experimentBinding',
  'brief.expressionPolicy',
  'brief.scorePlan',
  'brief.spoilerPlan',
  'brief.requiredPublicLabels',
  'brief.systemForbiddenExpressions',
  'contractVersion',
  'formatPolicyVersion',
  'profileId',
  'profileVersion',
  'schemaVersion',
  'voicePolicyVersion',
] as const);
