import {
  BRIEF_SCORE_KINDS,
  type BriefDependency,
  type BriefExperimentBinding,
  type BriefExpressionPolicy,
  type BriefFieldLockState,
  type BriefProfileId,
  type BriefScorePlan,
  type BriefSpoilerPlan,
  type ContentBriefDraft,
} from '@mystery-operations/briefs';

import {
  ACCOUNT_VOICE_POLICY,
  COPY_BLOCK_KINDS,
  COPY_CONTRACT_VERSION,
  COPY_DRAFT_STATUSES,
  COPY_FORMAT_POLICY_VERSION,
  COPY_LIMITS,
  COPY_LOCK_STATES,
  COPY_MUTATION_OPERATIONS,
  COPY_OUTPUT_SCHEMA_VERSION,
  COPY_PROFILE_REGISTRY_VERSION,
  COPY_PROVENANCE,
  COPY_REWRITE_SCOPES,
  COPY_RUN_STATUSES,
  COPY_TITLE_KINDS,
  COPY_VOICE_POLICY_VERSION,
  type CopyBlockKind,
  type CopyDraftStatus,
  type CopyFieldLockState,
  type CopyFieldProvenance,
  type CopyMutationOperation,
  type CopyRewriteScopeKind,
  type CopyRunStatus,
  type CopyTitleKind,
} from './constants.js';
import type {
  COPY_GENERATION_POLICY_VERSION,
  COPY_REWRITE_POLICY_VERSION,
  COPY_STRUCTURAL_VALIDATION_VERSION,
} from './constants.js';
import { CopyError } from './errors.js';

export interface DraftLineageRefV1 {
  readonly argumentId: string | null;
  readonly briefFieldPath: string;
  readonly evidenceRefIds: readonly string[];
  readonly experienceAssertionId: string | null;
  readonly inputHash: string;
  readonly provenance: CopyFieldProvenance;
  readonly structureSlotId: string | null;
  readonly workId: string | null;
}

export interface DraftTitleV1 {
  readonly kind: CopyTitleKind;
  readonly lineage: readonly DraftLineageRefV1[];
  readonly provenance: CopyFieldProvenance;
  readonly text: string;
  readonly titleId: string;
}

export interface DraftBlockV1 {
  readonly blockId: string;
  readonly kind: CopyBlockKind;
  readonly lineage: readonly DraftLineageRefV1[];
  readonly order: number;
  readonly provenance: CopyFieldProvenance;
  readonly text: string;
}

export interface DraftTagV1 {
  readonly lineage: readonly DraftLineageRefV1[];
  readonly provenance: CopyFieldProvenance;
  readonly tagId: string;
  readonly text: string;
}

export interface DraftPinnedCommentV1 {
  readonly lineage: readonly DraftLineageRefV1[];
  readonly provenance: CopyFieldProvenance;
  readonly text: string;
}

export interface DraftSpoilerWarningsV1 {
  readonly bodyOpeningWarningText: string | null;
  readonly coverWarningText: string | null;
  readonly pinnedCommentWarningText: string | null;
  readonly provenance: CopyFieldProvenance;
  readonly titleWarningMarker: string | null;
}

export interface DraftFieldStateV1 {
  readonly lock: CopyFieldLockState;
  readonly path: string;
  readonly provenance: CopyFieldProvenance;
}

export interface DraftBriefSnapshotV1 {
  readonly allowedEvidenceRefIds: readonly string[];
  readonly allowedExperienceAssertionIds: readonly string[];
  readonly briefId: string;
  readonly briefInputHash: string;
  readonly briefLockHash: string;
  readonly briefVersionId: string;
  readonly dependencies: readonly BriefDependency[];
  readonly experimentBinding: BriefExperimentBinding | null;
  readonly expressionPolicy: BriefExpressionPolicy;
  readonly profileId: BriefProfileId;
  readonly readinessStatus: 'READY_FOR_DRAFT_GENERATION';
  readonly requiredPublicLabels: readonly string[];
  readonly scorePlan: BriefScorePlan;
  readonly spoilerPlan: BriefSpoilerPlan;
  readonly systemForbiddenExpressions: readonly string[];
  readonly topicId: string;
  readonly topicVersionId: string;
  readonly workIds: readonly string[];
}

export interface ContentDraftPayloadV1 {
  readonly blocks: readonly DraftBlockV1[];
  readonly brief: DraftBriefSnapshotV1;
  readonly contractVersion: typeof COPY_CONTRACT_VERSION;
  readonly fieldStates: readonly DraftFieldStateV1[];
  readonly formatPolicyVersion: typeof COPY_FORMAT_POLICY_VERSION;
  readonly pinnedComment: DraftPinnedCommentV1 | null;
  readonly profileId: BriefProfileId;
  readonly profileVersion: typeof COPY_PROFILE_REGISTRY_VERSION;
  readonly schemaVersion: typeof COPY_OUTPUT_SCHEMA_VERSION;
  readonly selectedTitleId: string | null;
  readonly spoilerWarnings: DraftSpoilerWarningsV1;
  readonly tags: readonly DraftTagV1[];
  readonly titles: readonly DraftTitleV1[];
  readonly voicePolicyVersion: typeof COPY_VOICE_POLICY_VERSION;
}

export interface CopyModelCandidateV1 {
  readonly blocks: readonly DraftBlockV1[];
  readonly pinnedComment: DraftPinnedCommentV1 | null;
  readonly selectedTitleId: string;
  readonly spoilerWarnings: DraftSpoilerWarningsV1;
  readonly tags: readonly DraftTagV1[];
  readonly titles: readonly DraftTitleV1[];
}

export interface DraftStructuralValidationV1 {
  readonly evaluatedAt: string;
  readonly policyVersion: typeof COPY_STRUCTURAL_VALIDATION_VERSION;
  readonly reasonCodes: readonly string[];
  readonly valid: boolean;
}

export interface ContentDraftVersionV1 {
  readonly changeKinds: readonly string[];
  readonly contentHash: string;
  readonly createdAt: string;
  readonly draftId: string;
  readonly previousVersionId: string | null;
  readonly status: CopyDraftStatus;
  readonly validation: DraftStructuralValidationV1;
  readonly versionId: string;
  readonly versionNumber: number;
}

export interface ContentDraftV1 {
  readonly current: ContentDraftVersionV1;
  readonly draftId: string;
  readonly payload: ContentDraftPayloadV1;
  readonly revision: number;
  readonly state: 'ACTIVE' | 'ARCHIVED';
  readonly updatedAt: string;
}

export interface CopyRewriteScopeV1 {
  readonly blockIds: readonly string[];
  readonly kind: CopyRewriteScopeKind;
  readonly warningField:
    | 'bodyOpeningWarningText'
    | 'coverWarningText'
    | 'pinnedCommentWarningText'
    | 'titleWarningMarker'
    | null;
}

export interface CopyMutationPlanV1 {
  readonly briefId: string;
  readonly briefVersionId: string;
  readonly budgetState: 'AVAILABLE' | 'BLOCKED' | 'UNKNOWN';
  readonly capabilityState: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN' | 'STALE';
  readonly dependencyHash: string;
  readonly draftId: string;
  readonly expectedDraftRevision: number;
  readonly expectedVersionId: string;
  readonly expiresAt: string;
  readonly inputCharacterCount: number;
  readonly inputHash: string;
  readonly lineageRefCount: number;
  readonly lockSnapshotHash: string;
  readonly lockedFieldCount: number;
  readonly maximums: {
    readonly blocks: number;
    readonly inputCharacters: number;
    readonly modelRequests: 1;
    readonly outputBytes: number;
    readonly tags: number;
    readonly titles: number;
  };
  readonly operation: CopyMutationOperation;
  readonly planId: string;
  readonly previewHash: string;
  readonly profileId: BriefProfileId;
  readonly rewriteInstruction: string | null;
  readonly rewriteScope: CopyRewriteScopeV1 | null;
  readonly topicId: string;
  readonly writesNewVersionOnly: true;
}

export interface CopyMutationRunV1 {
  readonly cacheState: 'NOT_CHECKED' | 'MISS' | 'HIT';
  readonly costState: 'NOT_INCURRED' | 'UNPRICED_USAGE' | 'UNKNOWN_POSSIBLY_INCURRED';
  readonly createdAt: string;
  readonly draftId: string;
  readonly executionId: string;
  readonly externalRequestCount: 0 | 1;
  readonly finishedAt: string | null;
  readonly modelExecutionId: string | null;
  readonly modelIdentity: {
    readonly modelId: string;
    readonly modelRole: string;
    readonly modelSlot: string;
    readonly parameterVersion: number;
    readonly protocolMode: string;
    readonly providerConfigFingerprint: string;
  } | null;
  readonly outputHash: string | null;
  readonly planId: string;
  readonly policyVersion:
    typeof COPY_GENERATION_POLICY_VERSION | typeof COPY_REWRITE_POLICY_VERSION;
  readonly promptTemplateVersion: string;
  readonly resultVersionId: string | null;
  readonly runId: string;
  readonly schemaVersion: typeof COPY_OUTPUT_SCHEMA_VERSION;
  readonly status: CopyRunStatus;
  readonly styleVersion: typeof COPY_VOICE_POLICY_VERSION;
  readonly usageState: 'NONE' | 'RECORDED' | 'UNKNOWN';
}

export interface CopyMutationJobPayloadV1 {
  readonly dependencyHash: string;
  readonly draftId: string;
  readonly executionId: string;
  readonly expectedDraftRevision: number;
  readonly expectedVersionId: string;
  readonly inputHash: string;
  readonly jobType: 'COPY_GENERATE_V1' | 'COPY_REWRITE_V1';
  readonly lockSnapshotHash: string;
  readonly planId: string;
  readonly previewHash: string;
  readonly rewriteScope: CopyRewriteScopeV1 | null;
  readonly schemaVersion: 1;
}

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, keys: readonly string[]): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return value as RecordValue;
}

function text(
  value: unknown,
  maximum: number,
  options: { nullable?: boolean; empty?: boolean } = {},
) {
  if (value === null && options.nullable === true) return null;
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    (!options.empty && value.trim().length === 0)
  ) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return value.normalize('NFC');
}

function identifier(value: unknown): string {
  const result = text(value, COPY_LIMITS.identifierBytes);
  if (result === null || result.trim() !== result) throw new CopyError('COPY_INVALID_CONTRACT');
  return result;
}

function enumeration<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new CopyError('COPY_INVALID_CONTRACT');
  return value as T;
}

function stringArray(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return Object.freeze(value.map((item) => identifier(item)));
}

function lineage(value: unknown): DraftLineageRefV1 {
  const item = record(value, [
    'argumentId',
    'briefFieldPath',
    'evidenceRefIds',
    'experienceAssertionId',
    'inputHash',
    'provenance',
    'structureSlotId',
    'workId',
  ]);
  return Object.freeze({
    argumentId: item.argumentId === null ? null : identifier(item.argumentId),
    briefFieldPath: identifier(item.briefFieldPath),
    evidenceRefIds: stringArray(item.evidenceRefIds, 64),
    experienceAssertionId:
      item.experienceAssertionId === null ? null : identifier(item.experienceAssertionId),
    inputHash: text(item.inputHash, 64) as string,
    provenance: enumeration(item.provenance, COPY_PROVENANCE),
    structureSlotId: item.structureSlotId === null ? null : identifier(item.structureSlotId),
    workId: item.workId === null ? null : identifier(item.workId),
  });
}

function lineages(value: unknown): readonly DraftLineageRefV1[] {
  if (!Array.isArray(value) || value.length > COPY_LIMITS.lineagePerArtifact) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return Object.freeze(value.map((item) => lineage(item)));
}

function title(value: unknown): DraftTitleV1 {
  const item = record(value, ['kind', 'lineage', 'provenance', 'text', 'titleId']);
  return Object.freeze({
    kind: enumeration(item.kind, COPY_TITLE_KINDS),
    lineage: lineages(item.lineage),
    provenance: enumeration(item.provenance, COPY_PROVENANCE),
    text: text(item.text, COPY_LIMITS.titleCharacters) as string,
    titleId: identifier(item.titleId),
  });
}

function block(value: unknown): DraftBlockV1 {
  const item = record(value, ['blockId', 'kind', 'lineage', 'order', 'provenance', 'text']);
  if (!Number.isSafeInteger(item.order) || Number(item.order) < 0) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return Object.freeze({
    blockId: identifier(item.blockId),
    kind: enumeration(item.kind, COPY_BLOCK_KINDS),
    lineage: lineages(item.lineage),
    order: Number(item.order),
    provenance: enumeration(item.provenance, COPY_PROVENANCE),
    text: text(item.text, COPY_LIMITS.paragraphCharacters) as string,
  });
}

function tag(value: unknown): DraftTagV1 {
  const item = record(value, ['lineage', 'provenance', 'tagId', 'text']);
  const normalized = (text(item.text, COPY_LIMITS.tagCharacters) as string)
    .replace(/^#+/u, '')
    .trim()
    .normalize('NFC');
  if (normalized.length === 0) throw new CopyError('COPY_INVALID_CONTRACT');
  return Object.freeze({
    lineage: lineages(item.lineage),
    provenance: enumeration(item.provenance, COPY_PROVENANCE),
    tagId: identifier(item.tagId),
    text: normalized,
  });
}

function pinnedComment(value: unknown): DraftPinnedCommentV1 | null {
  if (value === null) return null;
  const item = record(value, ['lineage', 'provenance', 'text']);
  return Object.freeze({
    lineage: lineages(item.lineage),
    provenance: enumeration(item.provenance, COPY_PROVENANCE),
    text: text(item.text, COPY_LIMITS.pinnedCommentCharacters) as string,
  });
}

function warnings(value: unknown): DraftSpoilerWarningsV1 {
  const item = record(value, [
    'bodyOpeningWarningText',
    'coverWarningText',
    'pinnedCommentWarningText',
    'provenance',
    'titleWarningMarker',
  ]);
  return Object.freeze({
    bodyOpeningWarningText: text(item.bodyOpeningWarningText, COPY_LIMITS.warningCharacters, {
      nullable: true,
    }),
    coverWarningText: text(item.coverWarningText, COPY_LIMITS.warningCharacters, {
      nullable: true,
    }),
    pinnedCommentWarningText: text(item.pinnedCommentWarningText, COPY_LIMITS.warningCharacters, {
      nullable: true,
    }),
    provenance: enumeration(item.provenance, COPY_PROVENANCE),
    titleWarningMarker: text(item.titleWarningMarker, 32, { nullable: true }),
  });
}

function fieldState(value: unknown): DraftFieldStateV1 {
  const item = record(value, ['lock', 'path', 'provenance']);
  return Object.freeze({
    lock: enumeration(item.lock, COPY_LOCK_STATES),
    path: identifier(item.path),
    provenance: enumeration(item.provenance, COPY_PROVENANCE),
  });
}

function assertBriefSnapshot(value: unknown): DraftBriefSnapshotV1 {
  const item = record(value, [
    'allowedEvidenceRefIds',
    'allowedExperienceAssertionIds',
    'briefId',
    'briefInputHash',
    'briefLockHash',
    'briefVersionId',
    'dependencies',
    'experimentBinding',
    'expressionPolicy',
    'profileId',
    'readinessStatus',
    'requiredPublicLabels',
    'scorePlan',
    'spoilerPlan',
    'systemForbiddenExpressions',
    'topicId',
    'topicVersionId',
    'workIds',
  ]);
  if (item.readinessStatus !== 'READY_FOR_DRAFT_GENERATION') {
    throw new CopyError('COPY_GENERATION_BLOCKED');
  }
  const expressionPolicy = item.expressionPolicy as BriefExpressionPolicy;
  const scorePlan = item.scorePlan as BriefScorePlan;
  if (
    expressionPolicy === null ||
    typeof expressionPolicy !== 'object' ||
    scorePlan === null ||
    typeof scorePlan !== 'object' ||
    !BRIEF_SCORE_KINDS.includes(
      (scorePlan as { readonly kind?: unknown }).kind as (typeof BRIEF_SCORE_KINDS)[number],
    )
  ) {
    throw new CopyError('COPY_PERMISSION_DENIED');
  }
  if (!Array.isArray(item.dependencies) || item.dependencies.length > COPY_LIMITS.dependencies) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return Object.freeze({
    allowedEvidenceRefIds: stringArray(item.allowedEvidenceRefIds, 128),
    allowedExperienceAssertionIds: stringArray(item.allowedExperienceAssertionIds, 32),
    briefId: identifier(item.briefId),
    briefInputHash: text(item.briefInputHash, 64) as string,
    briefLockHash: text(item.briefLockHash, 64) as string,
    briefVersionId: identifier(item.briefVersionId),
    dependencies: Object.freeze([...(item.dependencies as BriefDependency[])]),
    experimentBinding: item.experimentBinding as BriefExperimentBinding | null,
    expressionPolicy,
    profileId: item.profileId as BriefProfileId,
    readinessStatus: 'READY_FOR_DRAFT_GENERATION',
    requiredPublicLabels: stringArray(item.requiredPublicLabels, 16),
    scorePlan,
    spoilerPlan: item.spoilerPlan as BriefSpoilerPlan,
    systemForbiddenExpressions: stringArray(item.systemForbiddenExpressions, 64),
    topicId: identifier(item.topicId),
    topicVersionId: identifier(item.topicVersionId),
    workIds: stringArray(item.workIds, 8),
  });
}

export function assertContentDraftPayload(value: unknown): ContentDraftPayloadV1 {
  const item = record(value, [
    'blocks',
    'brief',
    'contractVersion',
    'fieldStates',
    'formatPolicyVersion',
    'pinnedComment',
    'profileId',
    'profileVersion',
    'schemaVersion',
    'selectedTitleId',
    'spoilerWarnings',
    'tags',
    'titles',
    'voicePolicyVersion',
  ]);
  if (
    item.contractVersion !== COPY_CONTRACT_VERSION ||
    item.schemaVersion !== COPY_OUTPUT_SCHEMA_VERSION ||
    item.formatPolicyVersion !== COPY_FORMAT_POLICY_VERSION ||
    item.profileVersion !== COPY_PROFILE_REGISTRY_VERSION ||
    item.voicePolicyVersion !== COPY_VOICE_POLICY_VERSION ||
    !Array.isArray(item.titles) ||
    item.titles.length > COPY_LIMITS.titles ||
    !Array.isArray(item.blocks) ||
    item.blocks.length > COPY_LIMITS.blocks ||
    !Array.isArray(item.tags) ||
    item.tags.length > COPY_LIMITS.tags ||
    !Array.isArray(item.fieldStates) ||
    item.fieldStates.length > 256
  ) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  const brief = assertBriefSnapshot(item.brief);
  const profileId = item.profileId as BriefProfileId;
  if (profileId !== brief.profileId) throw new CopyError('COPY_INVALID_PROFILE');
  const titles = Object.freeze(item.titles.map((entry) => title(entry)));
  const blocks = Object.freeze(item.blocks.map((entry) => block(entry)));
  const tags = Object.freeze(item.tags.map((entry) => tag(entry)));
  const fieldStates = Object.freeze(item.fieldStates.map((entry) => fieldState(entry)));
  const result = Object.freeze({
    blocks,
    brief,
    contractVersion: COPY_CONTRACT_VERSION,
    fieldStates,
    formatPolicyVersion: COPY_FORMAT_POLICY_VERSION,
    pinnedComment: pinnedComment(item.pinnedComment),
    profileId,
    profileVersion: COPY_PROFILE_REGISTRY_VERSION,
    schemaVersion: COPY_OUTPUT_SCHEMA_VERSION,
    selectedTitleId: item.selectedTitleId === null ? null : identifier(item.selectedTitleId),
    spoilerWarnings: warnings(item.spoilerWarnings),
    tags,
    titles,
    voicePolicyVersion: COPY_VOICE_POLICY_VERSION,
  });
  if (
    new Set(titles.map(({ titleId }) => titleId)).size !== titles.length ||
    new Set(blocks.map(({ blockId }) => blockId)).size !== blocks.length ||
    new Set(tags.map(({ tagId }) => tagId)).size !== tags.length ||
    new Set(fieldStates.map(({ path }) => path)).size !== fieldStates.length ||
    new Set(tags.map(({ text: value }) => value.toLocaleLowerCase('zh-CN'))).size !== tags.length ||
    tags.reduce((sum, itemValue) => sum + itemValue.text.length, 0) >
      COPY_LIMITS.tagTotalCharacters ||
    blocks.some((entry, index) => entry.order !== index)
  ) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return result;
}

export function assertCopyModelCandidate(value: unknown): CopyModelCandidateV1 {
  const item = record(value, [
    'blocks',
    'pinnedComment',
    'selectedTitleId',
    'spoilerWarnings',
    'tags',
    'titles',
  ]);
  if (
    !Array.isArray(item.titles) ||
    item.titles.length < 1 ||
    item.titles.length > COPY_LIMITS.titles ||
    !Array.isArray(item.blocks) ||
    item.blocks.length < 1 ||
    item.blocks.length > COPY_LIMITS.blocks ||
    !Array.isArray(item.tags) ||
    item.tags.length > COPY_LIMITS.tags
  ) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return Object.freeze({
    blocks: Object.freeze(item.blocks.map((entry) => block(entry))),
    pinnedComment: pinnedComment(item.pinnedComment),
    selectedTitleId: identifier(item.selectedTitleId),
    spoilerWarnings: warnings(item.spoilerWarnings),
    tags: Object.freeze(item.tags.map((entry) => tag(entry))),
    titles: Object.freeze(item.titles.map((entry) => title(entry))),
  });
}

export function applyCopyModelCandidate(
  currentValue: unknown,
  candidateValue: unknown,
): ContentDraftPayloadV1 {
  const current = assertContentDraftPayload(currentValue);
  const candidate = assertCopyModelCandidate(candidateValue);
  return assertContentDraftPayload({
    ...current,
    ...candidate,
  });
}

export function assertRewriteScope(value: unknown): CopyRewriteScopeV1 {
  const item = record(value, ['blockIds', 'kind', 'warningField']);
  const kind = enumeration(item.kind, COPY_REWRITE_SCOPES);
  const blockIds = stringArray(item.blockIds, COPY_LIMITS.blocks);
  const warningFields = [
    'bodyOpeningWarningText',
    'coverWarningText',
    'pinnedCommentWarningText',
    'titleWarningMarker',
  ];
  const warningField =
    item.warningField === null
      ? null
      : enumeration(item.warningField, warningFields as readonly string[]);
  if (
    ((kind === 'BODY_BLOCK' || kind === 'BODY_BLOCK_RANGE') && blockIds.length === 0) ||
    (kind === 'BODY_BLOCK' && blockIds.length !== 1) ||
    (!['BODY_BLOCK', 'BODY_BLOCK_RANGE'].includes(kind) && blockIds.length !== 0) ||
    (kind === 'SPOILER_WARNING_ARTIFACT' && warningField === null) ||
    (kind !== 'SPOILER_WARNING_ARTIFACT' && warningField !== null)
  ) {
    throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
  }
  return Object.freeze({
    blockIds,
    kind,
    warningField: warningField as CopyRewriteScopeV1['warningField'],
  });
}

export function assertCopyMutationJobPayload(value: unknown): CopyMutationJobPayloadV1 {
  const item = record(value, [
    'dependencyHash',
    'draftId',
    'executionId',
    'expectedDraftRevision',
    'expectedVersionId',
    'inputHash',
    'jobType',
    'lockSnapshotHash',
    'planId',
    'previewHash',
    'rewriteScope',
    'schemaVersion',
  ]);
  if (
    item.schemaVersion !== 1 ||
    !Number.isSafeInteger(item.expectedDraftRevision) ||
    Number(item.expectedDraftRevision) < 0 ||
    (item.jobType !== 'COPY_GENERATE_V1' && item.jobType !== 'COPY_REWRITE_V1')
  ) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  const rewriteScope = item.rewriteScope === null ? null : assertRewriteScope(item.rewriteScope);
  if (
    (item.jobType === 'COPY_GENERATE_V1' && rewriteScope !== null) ||
    (item.jobType === 'COPY_REWRITE_V1' && rewriteScope === null)
  ) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return Object.freeze({
    dependencyHash: text(item.dependencyHash, 64) as string,
    draftId: identifier(item.draftId),
    executionId: identifier(item.executionId),
    expectedDraftRevision: Number(item.expectedDraftRevision),
    expectedVersionId: identifier(item.expectedVersionId),
    inputHash: text(item.inputHash, 64) as string,
    jobType: item.jobType,
    lockSnapshotHash: text(item.lockSnapshotHash, 64) as string,
    planId: identifier(item.planId),
    previewHash: text(item.previewHash, 64) as string,
    rewriteScope,
    schemaVersion: 1,
  });
}

export function assertCopyDraftStatus(value: unknown): CopyDraftStatus {
  return enumeration(value, COPY_DRAFT_STATUSES);
}

export function assertCopyRunStatus(value: unknown): CopyRunStatus {
  return enumeration(value, COPY_RUN_STATUSES);
}

export function assertCopyMutationOperation(value: unknown): CopyMutationOperation {
  return enumeration(value, COPY_MUTATION_OPERATIONS);
}

export function briefSnapshotFromDraft(input: {
  readonly briefId: string;
  readonly briefInputHash: string;
  readonly briefLockHash: string;
  readonly briefVersionId: string;
  readonly dependencies: readonly BriefDependency[];
  readonly draft: ContentBriefDraft;
}): DraftBriefSnapshotV1 {
  const draft = input.draft;
  return assertBriefSnapshot({
    allowedEvidenceRefIds: draft.evidenceMap.map(({ refId }) => refId),
    allowedExperienceAssertionIds: draft.expressionPolicy.allowedAssertionIds,
    briefId: input.briefId,
    briefInputHash: input.briefInputHash,
    briefLockHash: input.briefLockHash,
    briefVersionId: input.briefVersionId,
    dependencies: input.dependencies,
    experimentBinding: draft.experimentBinding,
    expressionPolicy: draft.expressionPolicy,
    profileId: draft.profileId,
    readinessStatus: 'READY_FOR_DRAFT_GENERATION',
    requiredPublicLabels: draft.expressionPolicy.requiredPublicLabels,
    scorePlan: draft.scorePlan,
    spoilerPlan: draft.spoilerPlan,
    systemForbiddenExpressions: draft.forbiddenExpressions
      .filter(({ system }) => system)
      .map(({ phrase }) => phrase),
    topicId: draft.topicId,
    topicVersionId: draft.topicVersionId,
    workIds: [
      ...new Set(
        draft.subjects
          .map(({ workId }) => workId)
          .filter((value): value is string => value !== null),
      ),
    ],
  });
}

export const COPY_CONTRACT_BOUNDARY = Object.freeze({
  accountVoicePolicy: ACCOUNT_VOICE_POLICY,
  allowedOutputFields: Object.freeze([
    'blocks',
    'pinnedComment',
    'selectedTitleId',
    'spoilerWarnings',
    'tags',
    'titles',
  ]),
  maximumModelRequests: 1,
  outputSchemaVersion: COPY_OUTPUT_SCHEMA_VERSION,
});

export type { BriefFieldLockState };
