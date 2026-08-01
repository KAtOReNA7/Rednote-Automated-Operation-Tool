import {
  BRIEF_ACTIONS,
  BRIEF_AUDIENCE_KNOWLEDGE_LEVELS,
  BRIEF_DEPENDENCY_TYPES,
  BRIEF_EXPRESSION_MODES,
  BRIEF_FIELD_LOCKS,
  BRIEF_FIELD_PROVENANCE,
  BRIEF_FORBIDDEN_CATEGORIES,
  BRIEF_LIMITS,
  BRIEF_PROFILE_IDS,
  BRIEF_READINESS_STATUSES,
  BRIEF_SCORE_KINDS,
  BRIEF_VERSION_STATES,
  CONTENT_BRIEF_CONTRACT_VERSION,
  CONTENT_BRIEF_FORBIDDEN_REGISTRY_VERSION,
  CONTENT_BRIEF_GENERATION_CONTRACT_VERSION,
  CONTENT_BRIEF_GENERATE_JOB_TYPE,
  CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
  CONTENT_BRIEF_SCHEMA_VERSION,
  SYSTEM_FORBIDDEN_EXPRESSIONS,
  type BriefAction,
  type BriefAudienceKnowledgeLevel,
  type BriefDependencyType,
  type BriefExpressionMode,
  type BriefFieldLockState,
  type BriefFieldProvenance,
  type BriefForbiddenCategory,
  type BriefProfileId,
  type BriefReadinessStatus,
  type BriefScoreKind,
  type BriefVersionState,
  type CONTENT_BRIEF_READINESS_POLICY_VERSION,
} from './constants.js';
import { BriefError } from './errors.js';

export type BriefSpoilerLevel = 'NO_SPOILER' | 'LIGHT_SPOILER' | 'FULL_TRICK_ANALYSIS';
export type BriefWarningPlacement = 'NONE' | 'BODY_OPENING' | 'COVER_TITLE_AND_BODY_OPENING';
export type BriefReadingState = 'R1' | 'R2' | 'R3' | 'S1' | 'S2' | 'UNCLASSIFIED';
export type BriefJudgmentKind = 'OPINION' | 'FACTUAL_SYNTHESIS' | 'MIXED';
export type BriefArgumentKind = 'OPINION' | 'FACT' | 'MIXED';
export type BriefEvidenceRole = 'FACT' | 'CONTEXT' | 'SUPPORTING_ONLY';
export type BriefFactStatus =
  | 'VERIFIED'
  | 'SUPPORTED_NOT_VERIFIED'
  | 'INSUFFICIENT'
  | 'CONFLICTED'
  | 'FACT_BLOCKED'
  | 'STALE_REVIEW_REQUIRED';

export interface BriefSubject {
  readonly editionId: string | null;
  readonly expressionForm: 'WEB_SERIALIZED' | 'PUBLISHED_EDITION' | 'OTHER_VERIFIED' | null;
  readonly expressionId: string | null;
  readonly role: 'PRIMARY' | 'COMPARISON' | 'CONTEXT';
  readonly subjectId: string;
  readonly subjectType: 'WORK' | 'EXPRESSION' | 'EDITION';
  readonly workId: string;
}

export interface BriefAudience {
  readonly knowledgeLevel: BriefAudienceKnowledgeLevel | null;
  readonly readerDescription: string | null;
  readonly selectionNeed: string | null;
}

export interface BriefObjective {
  readonly readerOutcome: string | null;
  readonly scopeBoundary: string | null;
}

export interface BriefJudgment {
  readonly judgmentId: 'core';
  readonly kind: BriefJudgmentKind;
  readonly qualification: string | null;
  readonly statement: string | null;
}

export interface BriefArgument {
  readonly argumentId: string;
  readonly evidenceRefIds: readonly string[];
  readonly kind: BriefArgumentKind;
  readonly limitation: string | null;
  readonly statement: string | null;
  readonly subjectIds: readonly string[];
}

export interface BriefCounterargument extends BriefArgument {
  readonly responseOrQualification: string | null;
}

export interface BriefEvidenceRef {
  readonly claimId: string;
  readonly current: boolean;
  readonly dependencyHash: string;
  readonly displaySummary: string;
  readonly dossierEntryId: string;
  readonly dossierId: string;
  readonly dossierVersionId: string;
  readonly evidenceLocatorId: string;
  readonly factEvaluationId: string;
  readonly factStatus: BriefFactStatus;
  readonly fieldPath: string;
  readonly locatorValid: boolean;
  readonly refId: string;
  readonly role: BriefEvidenceRole;
  readonly sourceLanguage: string;
  readonly sourceRevisionId: string;
}

export interface BriefStructureSlot {
  readonly function: string;
  readonly required: boolean;
  readonly slotId: string;
  readonly subjectIds: readonly string[];
}

export interface BriefStructurePlan {
  readonly comparisonDimension: string | null;
  readonly profileId: BriefProfileId;
  readonly profileVersion: typeof CONTENT_BRIEF_PROFILE_REGISTRY_VERSION;
  readonly slots: readonly BriefStructureSlot[];
}

export interface BriefSpoilerPlan {
  readonly level: BriefSpoilerLevel;
  readonly revealCoreTrick: boolean;
  readonly revealEnding: boolean;
  readonly userConfirmationRequired: boolean;
  readonly userConfirmed: boolean;
  readonly warningPlacement: BriefWarningPlacement;
  readonly warningRequired: boolean;
}

export interface BriefScorePlan {
  readonly kind: BriefScoreKind;
  readonly publicLabel: '资料分析评分' | null;
  readonly publicLabelRequired: boolean;
  readonly scale: string | null;
  readonly valueSourceId: string | null;
}

export interface BriefExpressionPolicy {
  readonly allowedAssertionIds: readonly string[];
  readonly firstPersonAllowed: boolean;
  readonly mode: BriefExpressionMode;
  readonly permissionCurrent: boolean;
  readonly permissionRevision: number;
  readonly permissionSnapshotId: string;
  readonly r2AssertionIds: readonly string[];
  readonly readingState: BriefReadingState;
  readonly requiredPublicLabels: readonly string[];
}

export interface BriefForbiddenExpression {
  readonly category: BriefForbiddenCategory;
  readonly expressionId: string;
  readonly phrase: string;
  readonly policyVersion: string;
  readonly reason: string;
  readonly system: boolean;
}

export interface BriefFieldState {
  readonly lock: BriefFieldLockState;
  readonly path: string;
  readonly provenance: BriefFieldProvenance;
}

export interface BriefExperimentBinding {
  readonly armId: string;
  readonly armValueIdentity: string;
  readonly assignmentCurrent: boolean;
  readonly assignmentPlanId: string;
  readonly controlledConditions: readonly {
    readonly kind: string;
    readonly valueIdentity: string;
  }[];
  readonly designCurrent: boolean;
  readonly designVersionId: string;
  readonly experimentId: string;
  readonly experimentLocked: boolean;
  readonly experimentStale: boolean;
  readonly popularityStratum: 'HOT' | 'WARM' | 'COLD' | 'UNKNOWN';
  readonly structureFingerprint: string;
  readonly topicId: string;
  readonly topicVersionId: string;
  readonly workId: string;
}

export interface ContentBriefDraft {
  readonly contentObjective: BriefObjective;
  readonly contractVersion: typeof CONTENT_BRIEF_CONTRACT_VERSION;
  readonly coreJudgment: BriefJudgment;
  readonly evidenceMap: readonly BriefEvidenceRef[];
  readonly experimentBinding: BriefExperimentBinding | null;
  readonly expressionPolicy: BriefExpressionPolicy;
  readonly fieldStates: readonly BriefFieldState[];
  readonly forbiddenExpressions: readonly BriefForbiddenExpression[];
  readonly openQuestionsAndLimitations: readonly string[];
  readonly profileId: BriefProfileId;
  readonly schemaVersion: typeof CONTENT_BRIEF_SCHEMA_VERSION;
  readonly scorePlan: BriefScorePlan;
  readonly spoilerPlan: BriefSpoilerPlan;
  readonly strongestCounterargument: BriefCounterargument | null;
  readonly structurePlan: BriefStructurePlan;
  readonly subjects: readonly BriefSubject[];
  readonly supportingArguments: readonly BriefArgument[];
  readonly targetAudience: BriefAudience;
  readonly topicId: string;
  readonly topicVersionId: string;
}

export interface ContentBriefVersion {
  readonly briefId: string;
  readonly confirmedAt: string | null;
  readonly createdAt: string;
  readonly dependencyHash: string;
  readonly inputHash: string;
  readonly lockedAt: string | null;
  readonly payload: ContentBriefDraft;
  readonly previousVersionId: string | null;
  readonly promptVersion: string;
  readonly readiness: BriefReadinessStatus;
  readonly readinessReasonCodes: readonly string[];
  readonly revision: number;
  readonly schemaVersion: typeof CONTENT_BRIEF_SCHEMA_VERSION;
  readonly status: BriefVersionState;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly warnings: readonly string[];
}

export interface ContentBrief {
  readonly briefId: string;
  readonly currentVersionId: string;
  readonly experimentId: string | null;
  readonly profileId: BriefProfileId | 'LEGACY_UNCLASSIFIED';
  readonly revision: number;
  readonly state: 'ACTIVE' | 'ARCHIVED';
  readonly topicId: string;
  readonly topicVersionId: string | null;
}

export interface BriefDependency {
  readonly dependencyHash: string;
  readonly dependencyId: string;
  readonly dependencyType: BriefDependencyType;
  readonly observedRevision: string;
}

export interface BriefReadinessContext {
  readonly dependenciesCurrent: boolean;
  readonly dossierCurrentReady: boolean;
  readonly experimentMatches: boolean;
  readonly factBlocked: boolean;
  readonly schemaValid: boolean;
  readonly topicCurrent: boolean;
  readonly topicEligibility: string;
  readonly topicState: string;
}

export interface BriefReadinessSnapshot {
  readonly evaluatedAt: string;
  readonly policyVersion: typeof CONTENT_BRIEF_READINESS_POLICY_VERSION;
  readonly reasonCodes: readonly string[];
  readonly status: BriefReadinessStatus;
}

export interface BriefGenerationPlan {
  readonly briefId: string;
  readonly budgetState: 'AVAILABLE' | 'BLOCKED' | 'UNKNOWN';
  readonly capabilityState: 'SUPPORTED' | 'UNKNOWN' | 'UNSUPPORTED' | 'STALE';
  readonly contractVersion: typeof CONTENT_BRIEF_GENERATION_CONTRACT_VERSION;
  readonly dependencyHash: string;
  readonly editableFieldCount: number;
  readonly evidenceRefCount: number;
  readonly expiresAt: string;
  readonly expectedBriefRevision: number;
  readonly expectedVersionId: string;
  readonly inputCharacterCount: number;
  readonly inputHash: string;
  readonly lockedFieldCount: number;
  readonly maximumInputCharacters: number;
  readonly maximumModelRequests: 1;
  readonly maximumOutputBytes: number;
  readonly planId: string;
  readonly previewHash: string;
  readonly profileId: BriefProfileId;
  readonly subjectIds: readonly string[];
  readonly topicId: string;
  readonly topicVersionId: string;
  readonly writeSet: readonly string[];
}

export interface BriefGenerationRun {
  readonly briefId: string;
  readonly costState: 'NOT_INCURRED' | 'UNKNOWN_POSSIBLY_INCURRED' | 'UNPRICED_USAGE';
  readonly executionId: string;
  readonly externalRequestCount: 0 | 1;
  readonly planId: string;
  readonly resultVersionId: string | null;
  readonly revision: number;
  readonly runId: string;
  readonly stableErrorCode: string | null;
  readonly status:
    | 'CONFIRMED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'NO_OP'
    | 'PAUSED'
    | 'CANCELLED'
    | 'FAILED'
    | 'AMBIGUOUS';
}

export interface BriefGenerationJobPayload {
  readonly briefId: string;
  readonly contractVersion: typeof CONTENT_BRIEF_GENERATION_CONTRACT_VERSION;
  readonly executionId: string;
  readonly expectedBriefRevision: number;
  readonly expectedVersionId: string;
  readonly inputHash: string;
  readonly lockSnapshotHash: string;
  readonly planId: string;
  readonly previewHash: string;
}

export interface BriefModelCandidate {
  readonly citedEvidenceRefIds: readonly string[];
  readonly contentObjective: BriefObjective;
  readonly contractVersion: typeof CONTENT_BRIEF_GENERATION_CONTRACT_VERSION;
  readonly coreJudgment: BriefJudgment;
  readonly openQuestionsAndLimitations: readonly string[];
  readonly strongestCounterargument: BriefCounterargument | null;
  readonly structurePlan: BriefStructurePlan;
  readonly supportingArguments: readonly BriefArgument[];
  readonly targetAudience: BriefAudience;
}

export type BriefActionDraft =
  | {
      readonly kind: 'CREATE_SCAFFOLD';
      readonly profileId: BriefProfileId;
      readonly topicId: string;
    }
  | {
      readonly briefId: string;
      readonly expectedRevision: number;
      readonly kind:
        | 'SAVE_EDIT'
        | 'UNDO'
        | 'CLONE'
        | 'ARCHIVE'
        | 'RESTORE'
        | 'PREVIEW_GENERATION'
        | 'CANCEL_GENERATION';
      readonly payload: unknown;
    }
  | {
      readonly briefId: string;
      readonly expectedRevision: number;
      readonly fieldPath: string;
      readonly kind: 'LOCK_FIELD' | 'UNLOCK_FIELD';
    };

function invalid(
  code: 'BRIEF_INVALID_CONTRACT' | 'BRIEF_INVALID_EVIDENCE' = 'BRIEF_INVALID_CONTRACT',
): never {
  throw new BriefError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid();
  }
}

function enumeration<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid();
  return value as T;
}

function identifier(value: unknown, maximum: number = BRIEF_LIMITS.identifierBytes): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.trim() !== value ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    invalid();
  }
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) invalid();
  return value;
}

function text(
  value: unknown,
  nullable = false,
  maximum: number = BRIEF_LIMITS.textBytes,
): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    Buffer.byteLength(value, 'utf8') > maximum
  ) {
    invalid();
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function integer(value: unknown, minimum = 0, maximum = 2_147_483_647): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function strings(
  value: unknown,
  limit: number,
  options: { readonly ids?: boolean; readonly allowEmpty?: boolean } = {},
): readonly string[] {
  if (!Array.isArray(value) || value.length > limit || (!options.allowEmpty && value.length < 1)) {
    invalid();
  }
  const values = value.map((item) => (options.ids ? identifier(item) : (text(item) as string)));
  if (new Set(values).size !== values.length) invalid();
  return Object.freeze(values);
}

function subject(value: unknown): BriefSubject {
  exact(value, [
    'editionId',
    'expressionForm',
    'expressionId',
    'role',
    'subjectId',
    'subjectType',
    'workId',
  ]);
  const subjectType = enumeration(value.subjectType, ['WORK', 'EXPRESSION', 'EDITION'] as const);
  const subjectId = identifier(value.subjectId);
  const workId = identifier(value.workId);
  const expressionId = value.expressionId === null ? null : identifier(value.expressionId);
  const editionId = value.editionId === null ? null : identifier(value.editionId);
  const expressionForm =
    value.expressionForm === null
      ? null
      : enumeration(value.expressionForm, [
          'WEB_SERIALIZED',
          'PUBLISHED_EDITION',
          'OTHER_VERIFIED',
        ] as const);
  if (
    (subjectType === 'WORK' &&
      (subjectId !== workId || expressionId !== null || editionId !== null)) ||
    (subjectType === 'EXPRESSION' && (subjectId !== expressionId || editionId !== null)) ||
    (subjectType === 'EDITION' && (subjectId !== editionId || expressionId === null))
  ) {
    invalid();
  }
  return Object.freeze({
    editionId,
    expressionForm,
    expressionId,
    role: enumeration(value.role, ['PRIMARY', 'COMPARISON', 'CONTEXT'] as const),
    subjectId,
    subjectType,
    workId,
  });
}

function audience(value: unknown): BriefAudience {
  exact(value, ['knowledgeLevel', 'readerDescription', 'selectionNeed']);
  return Object.freeze({
    knowledgeLevel:
      value.knowledgeLevel === null
        ? null
        : enumeration(value.knowledgeLevel, BRIEF_AUDIENCE_KNOWLEDGE_LEVELS),
    readerDescription: text(value.readerDescription, true),
    selectionNeed: text(value.selectionNeed, true),
  });
}

function objective(value: unknown): BriefObjective {
  exact(value, ['readerOutcome', 'scopeBoundary']);
  return Object.freeze({
    readerOutcome: text(value.readerOutcome, true),
    scopeBoundary: text(value.scopeBoundary, true),
  });
}

function judgment(value: unknown): BriefJudgment {
  exact(value, ['judgmentId', 'kind', 'qualification', 'statement']);
  if (value.judgmentId !== 'core') invalid();
  return Object.freeze({
    judgmentId: 'core',
    kind: enumeration(value.kind, ['OPINION', 'FACTUAL_SYNTHESIS', 'MIXED'] as const),
    qualification: text(value.qualification, true),
    statement: text(value.statement, true),
  });
}

function argument(value: unknown, counter = false): BriefArgument | BriefCounterargument {
  exact(value, [
    'argumentId',
    'evidenceRefIds',
    'kind',
    'limitation',
    ...(counter ? ['responseOrQualification'] : []),
    'statement',
    'subjectIds',
  ]);
  const base = {
    argumentId: identifier(value.argumentId),
    evidenceRefIds: strings(value.evidenceRefIds, BRIEF_LIMITS.evidenceRefs, {
      allowEmpty: true,
      ids: true,
    }),
    kind: enumeration(value.kind, ['OPINION', 'FACT', 'MIXED'] as const),
    limitation: text(value.limitation, true),
    statement: text(value.statement, true),
    subjectIds: strings(value.subjectIds, BRIEF_LIMITS.subjects, {
      allowEmpty: true,
      ids: true,
    }),
  };
  return Object.freeze(
    counter
      ? { ...base, responseOrQualification: text(value.responseOrQualification, true) }
      : base,
  );
}

function evidenceRef(value: unknown): BriefEvidenceRef {
  exact(value, [
    'claimId',
    'current',
    'dependencyHash',
    'displaySummary',
    'dossierEntryId',
    'dossierId',
    'dossierVersionId',
    'evidenceLocatorId',
    'factEvaluationId',
    'factStatus',
    'fieldPath',
    'locatorValid',
    'refId',
    'role',
    'sourceLanguage',
    'sourceRevisionId',
  ]);
  return Object.freeze({
    claimId: identifier(value.claimId),
    current: boolean(value.current),
    dependencyHash: hash(value.dependencyHash),
    displaySummary: text(value.displaySummary, false, 1_024) as string,
    dossierEntryId: identifier(value.dossierEntryId),
    dossierId: identifier(value.dossierId),
    dossierVersionId: identifier(value.dossierVersionId),
    evidenceLocatorId: identifier(value.evidenceLocatorId),
    factEvaluationId: identifier(value.factEvaluationId),
    factStatus: enumeration(value.factStatus, [
      'VERIFIED',
      'SUPPORTED_NOT_VERIFIED',
      'INSUFFICIENT',
      'CONFLICTED',
      'FACT_BLOCKED',
      'STALE_REVIEW_REQUIRED',
    ] as const),
    fieldPath: identifier(value.fieldPath),
    locatorValid: boolean(value.locatorValid),
    refId: identifier(value.refId),
    role: enumeration(value.role, ['FACT', 'CONTEXT', 'SUPPORTING_ONLY'] as const),
    sourceLanguage: identifier(value.sourceLanguage, 64),
    sourceRevisionId: identifier(value.sourceRevisionId),
  });
}

function structurePlan(value: unknown): BriefStructurePlan {
  exact(value, ['comparisonDimension', 'profileId', 'profileVersion', 'slots']);
  if (
    value.profileVersion !== CONTENT_BRIEF_PROFILE_REGISTRY_VERSION ||
    !Array.isArray(value.slots) ||
    value.slots.length > BRIEF_LIMITS.structureSlots
  ) {
    invalid();
  }
  const slots = value.slots.map((slotValue) => {
    exact(slotValue, ['function', 'required', 'slotId', 'subjectIds']);
    return Object.freeze({
      function: text(slotValue.function) as string,
      required: boolean(slotValue.required),
      slotId: identifier(slotValue.slotId),
      subjectIds: strings(slotValue.subjectIds, BRIEF_LIMITS.subjects, {
        allowEmpty: true,
        ids: true,
      }),
    });
  });
  if (new Set(slots.map((slot) => slot.slotId)).size !== slots.length) invalid();
  return Object.freeze({
    comparisonDimension: text(value.comparisonDimension, true, 128),
    profileId: enumeration(value.profileId, BRIEF_PROFILE_IDS),
    profileVersion: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
    slots: Object.freeze(slots),
  });
}

function spoilerPlan(value: unknown): BriefSpoilerPlan {
  exact(value, [
    'level',
    'revealCoreTrick',
    'revealEnding',
    'userConfirmationRequired',
    'userConfirmed',
    'warningPlacement',
    'warningRequired',
  ]);
  const plan = Object.freeze({
    level: enumeration(value.level, [
      'NO_SPOILER',
      'LIGHT_SPOILER',
      'FULL_TRICK_ANALYSIS',
    ] as const),
    revealCoreTrick: boolean(value.revealCoreTrick),
    revealEnding: boolean(value.revealEnding),
    userConfirmationRequired: boolean(value.userConfirmationRequired),
    userConfirmed: boolean(value.userConfirmed),
    warningPlacement: enumeration(value.warningPlacement, [
      'NONE',
      'BODY_OPENING',
      'COVER_TITLE_AND_BODY_OPENING',
    ] as const),
    warningRequired: boolean(value.warningRequired),
  });
  return plan;
}

function scorePlan(value: unknown): BriefScorePlan {
  exact(value, ['kind', 'publicLabel', 'publicLabelRequired', 'scale', 'valueSourceId']);
  const kind = enumeration(value.kind, BRIEF_SCORE_KINDS);
  const publicLabel =
    value.publicLabel === null
      ? null
      : value.publicLabel === '资料分析评分'
        ? value.publicLabel
        : invalid();
  return Object.freeze({
    kind,
    publicLabel,
    publicLabelRequired: boolean(value.publicLabelRequired),
    scale: text(value.scale, true, 128),
    valueSourceId: value.valueSourceId === null ? null : identifier(value.valueSourceId),
  });
}

function expressionPolicy(value: unknown): BriefExpressionPolicy {
  exact(value, [
    'allowedAssertionIds',
    'firstPersonAllowed',
    'mode',
    'permissionCurrent',
    'permissionRevision',
    'permissionSnapshotId',
    'r2AssertionIds',
    'readingState',
    'requiredPublicLabels',
  ]);
  return Object.freeze({
    allowedAssertionIds: strings(value.allowedAssertionIds, BRIEF_LIMITS.assertionIds, {
      allowEmpty: true,
      ids: true,
    }),
    firstPersonAllowed: boolean(value.firstPersonAllowed),
    mode: enumeration(value.mode, BRIEF_EXPRESSION_MODES),
    permissionCurrent: boolean(value.permissionCurrent),
    permissionRevision: integer(value.permissionRevision, 1),
    permissionSnapshotId: identifier(value.permissionSnapshotId),
    r2AssertionIds: strings(value.r2AssertionIds, BRIEF_LIMITS.assertionIds, {
      allowEmpty: true,
      ids: true,
    }),
    readingState: enumeration(value.readingState, [
      'R1',
      'R2',
      'R3',
      'S1',
      'S2',
      'UNCLASSIFIED',
    ] as const),
    requiredPublicLabels: strings(value.requiredPublicLabels, 16, { allowEmpty: true }),
  });
}

function forbiddenExpression(value: unknown): BriefForbiddenExpression {
  exact(value, ['category', 'expressionId', 'phrase', 'policyVersion', 'reason', 'system']);
  const category = enumeration(value.category, BRIEF_FORBIDDEN_CATEGORIES);
  const system = boolean(value.system);
  if ((category === 'USER_CUSTOM') === system) invalid();
  return Object.freeze({
    category,
    expressionId: identifier(value.expressionId),
    phrase: text(value.phrase, false, 1_024) as string,
    policyVersion: identifier(value.policyVersion),
    reason: text(value.reason, false, 1_024) as string,
    system,
  });
}

function fieldState(value: unknown): BriefFieldState {
  exact(value, ['lock', 'path', 'provenance']);
  return Object.freeze({
    lock: enumeration(value.lock, BRIEF_FIELD_LOCKS),
    path: identifier(value.path),
    provenance: enumeration(value.provenance, BRIEF_FIELD_PROVENANCE),
  });
}

function experimentBinding(value: unknown): BriefExperimentBinding {
  exact(value, [
    'armId',
    'armValueIdentity',
    'assignmentCurrent',
    'assignmentPlanId',
    'controlledConditions',
    'designCurrent',
    'designVersionId',
    'experimentId',
    'experimentLocked',
    'experimentStale',
    'popularityStratum',
    'structureFingerprint',
    'topicId',
    'topicVersionId',
    'workId',
  ]);
  if (
    !Array.isArray(value.controlledConditions) ||
    value.controlledConditions.length > BRIEF_LIMITS.controlledConditions
  ) {
    invalid();
  }
  const conditions = value.controlledConditions.map((condition) => {
    exact(condition, ['kind', 'valueIdentity']);
    return Object.freeze({
      kind: identifier(condition.kind),
      valueIdentity: identifier(condition.valueIdentity),
    });
  });
  if (new Set(conditions.map((condition) => condition.kind)).size !== conditions.length) invalid();
  return Object.freeze({
    armId: identifier(value.armId),
    armValueIdentity: identifier(value.armValueIdentity),
    assignmentCurrent: boolean(value.assignmentCurrent),
    assignmentPlanId: identifier(value.assignmentPlanId),
    controlledConditions: Object.freeze(conditions),
    designCurrent: boolean(value.designCurrent),
    designVersionId: identifier(value.designVersionId),
    experimentId: identifier(value.experimentId),
    experimentLocked: boolean(value.experimentLocked),
    experimentStale: boolean(value.experimentStale),
    popularityStratum: enumeration(value.popularityStratum, ['HOT', 'WARM', 'COLD', 'UNKNOWN']),
    structureFingerprint: hash(value.structureFingerprint),
    topicId: identifier(value.topicId),
    topicVersionId: identifier(value.topicVersionId),
    workId: identifier(value.workId),
  });
}

export function assertContentBriefDraft(value: unknown): ContentBriefDraft {
  exact(value, [
    'contentObjective',
    'contractVersion',
    'coreJudgment',
    'evidenceMap',
    'experimentBinding',
    'expressionPolicy',
    'fieldStates',
    'forbiddenExpressions',
    'openQuestionsAndLimitations',
    'profileId',
    'schemaVersion',
    'scorePlan',
    'spoilerPlan',
    'strongestCounterargument',
    'structurePlan',
    'subjects',
    'supportingArguments',
    'targetAudience',
    'topicId',
    'topicVersionId',
  ]);
  if (
    value.contractVersion !== CONTENT_BRIEF_CONTRACT_VERSION ||
    value.schemaVersion !== CONTENT_BRIEF_SCHEMA_VERSION ||
    !Array.isArray(value.subjects) ||
    value.subjects.length < 1 ||
    value.subjects.length > BRIEF_LIMITS.subjects ||
    !Array.isArray(value.evidenceMap) ||
    value.evidenceMap.length > BRIEF_LIMITS.evidenceRefs ||
    !Array.isArray(value.supportingArguments) ||
    value.supportingArguments.length > BRIEF_LIMITS.arguments ||
    !Array.isArray(value.forbiddenExpressions) ||
    value.forbiddenExpressions.length > BRIEF_LIMITS.forbiddenExpressions ||
    !Array.isArray(value.fieldStates) ||
    value.fieldStates.length > BRIEF_LIMITS.fieldStates
  ) {
    invalid();
  }
  const subjects = value.subjects.map(subject);
  const evidenceMap = value.evidenceMap.map(evidenceRef);
  const supportingArguments = value.supportingArguments.map(
    (item) => argument(item) as BriefArgument,
  );
  const forbiddenExpressions = value.forbiddenExpressions.map(forbiddenExpression);
  const fieldStates = value.fieldStates.map(fieldState);
  const profileId = enumeration(value.profileId, BRIEF_PROFILE_IDS);
  const plan = structurePlan(value.structurePlan);
  const topicId = identifier(value.topicId);
  const topicVersionId = identifier(value.topicVersionId);
  if (
    plan.profileId !== profileId ||
    new Set(subjects.map((item) => `${item.subjectType}:${item.subjectId}`)).size !==
      subjects.length ||
    new Set(evidenceMap.map((item) => item.refId)).size !== evidenceMap.length ||
    new Set(supportingArguments.map((item) => item.argumentId)).size !==
      supportingArguments.length ||
    new Set(forbiddenExpressions.map((item) => item.expressionId)).size !==
      forbiddenExpressions.length ||
    new Set(fieldStates.map((item) => item.path)).size !== fieldStates.length
  ) {
    invalid();
  }
  const systemForbiddenExpressions = new Map(
    forbiddenExpressions.filter((item) => item.system).map((item) => [item.expressionId, item]),
  );
  if (
    systemForbiddenExpressions.size !== SYSTEM_FORBIDDEN_EXPRESSIONS.length ||
    SYSTEM_FORBIDDEN_EXPRESSIONS.some((rule) => {
      const item = systemForbiddenExpressions.get(rule.id);
      return (
        item === undefined ||
        item.category !== rule.category ||
        item.phrase !== rule.phrase ||
        item.reason !== rule.reason ||
        item.policyVersion !== CONTENT_BRIEF_FORBIDDEN_REGISTRY_VERSION
      );
    })
  ) {
    invalid();
  }
  const subjectIds = new Set(subjects.map((item) => item.subjectId));
  const evidenceIds = new Set(evidenceMap.map((item) => item.refId));
  for (const item of supportingArguments) {
    if (
      item.subjectIds.some((id) => !subjectIds.has(id)) ||
      item.evidenceRefIds.some((id) => !evidenceIds.has(id))
    ) {
      invalid();
    }
  }
  const strongestCounterargument =
    value.strongestCounterargument === null
      ? null
      : (argument(value.strongestCounterargument, true) as BriefCounterargument);
  if (
    strongestCounterargument !== null &&
    (strongestCounterargument.subjectIds.some((id) => !subjectIds.has(id)) ||
      strongestCounterargument.evidenceRefIds.some((id) => !evidenceIds.has(id)))
  ) {
    invalid();
  }
  const binding =
    value.experimentBinding === null ? null : experimentBinding(value.experimentBinding);
  if (
    binding !== null &&
    (binding.topicId !== topicId ||
      binding.topicVersionId !== topicVersionId ||
      !subjects.some((item) => item.workId === binding.workId))
  ) {
    invalid();
  }
  return Object.freeze({
    contentObjective: objective(value.contentObjective),
    contractVersion: CONTENT_BRIEF_CONTRACT_VERSION,
    coreJudgment: judgment(value.coreJudgment),
    evidenceMap: Object.freeze(evidenceMap),
    experimentBinding: binding,
    expressionPolicy: expressionPolicy(value.expressionPolicy),
    fieldStates: Object.freeze(fieldStates),
    forbiddenExpressions: Object.freeze(forbiddenExpressions),
    openQuestionsAndLimitations: strings(
      value.openQuestionsAndLimitations,
      BRIEF_LIMITS.openQuestions,
      { allowEmpty: true },
    ),
    profileId,
    schemaVersion: CONTENT_BRIEF_SCHEMA_VERSION,
    scorePlan: scorePlan(value.scorePlan),
    spoilerPlan: spoilerPlan(value.spoilerPlan),
    strongestCounterargument,
    structurePlan: plan,
    subjects: Object.freeze(subjects),
    supportingArguments: Object.freeze(supportingArguments),
    targetAudience: audience(value.targetAudience),
    topicId,
    topicVersionId,
  });
}

export function assertBriefReadinessContext(value: unknown): BriefReadinessContext {
  exact(value, [
    'dependenciesCurrent',
    'dossierCurrentReady',
    'experimentMatches',
    'factBlocked',
    'schemaValid',
    'topicCurrent',
    'topicEligibility',
    'topicState',
  ]);
  return Object.freeze({
    dependenciesCurrent: boolean(value.dependenciesCurrent),
    dossierCurrentReady: boolean(value.dossierCurrentReady),
    experimentMatches: boolean(value.experimentMatches),
    factBlocked: boolean(value.factBlocked),
    schemaValid: boolean(value.schemaValid),
    topicCurrent: boolean(value.topicCurrent),
    topicEligibility: identifier(value.topicEligibility, 128),
    topicState: identifier(value.topicState, 128),
  });
}

export function assertBriefDependency(value: unknown): BriefDependency {
  exact(value, ['dependencyHash', 'dependencyId', 'dependencyType', 'observedRevision']);
  return Object.freeze({
    dependencyHash: hash(value.dependencyHash),
    dependencyId: identifier(value.dependencyId, 1_024),
    dependencyType: enumeration(value.dependencyType, BRIEF_DEPENDENCY_TYPES),
    observedRevision: identifier(value.observedRevision),
  });
}

export function assertBriefGenerationJobPayload(value: unknown): BriefGenerationJobPayload {
  exact(value, [
    'briefId',
    'contractVersion',
    'executionId',
    'expectedBriefRevision',
    'expectedVersionId',
    'inputHash',
    'lockSnapshotHash',
    'planId',
    'previewHash',
  ]);
  if (value.contractVersion !== CONTENT_BRIEF_GENERATION_CONTRACT_VERSION) invalid();
  return Object.freeze({
    briefId: identifier(value.briefId),
    contractVersion: CONTENT_BRIEF_GENERATION_CONTRACT_VERSION,
    executionId: identifier(value.executionId),
    expectedBriefRevision: integer(value.expectedBriefRevision, 1),
    expectedVersionId: identifier(value.expectedVersionId),
    inputHash: hash(value.inputHash),
    lockSnapshotHash: hash(value.lockSnapshotHash),
    planId: identifier(value.planId),
    previewHash: hash(value.previewHash),
  });
}

export function assertBriefModelCandidate(
  value: unknown,
  allowedEvidenceRefIds: readonly string[],
): BriefModelCandidate {
  exact(value, [
    'citedEvidenceRefIds',
    'contentObjective',
    'contractVersion',
    'coreJudgment',
    'openQuestionsAndLimitations',
    'strongestCounterargument',
    'structurePlan',
    'supportingArguments',
    'targetAudience',
  ]);
  if (
    value.contractVersion !== CONTENT_BRIEF_GENERATION_CONTRACT_VERSION ||
    !Array.isArray(value.supportingArguments) ||
    value.supportingArguments.length > BRIEF_LIMITS.arguments
  ) {
    invalid();
  }
  const allowed = new Set(allowedEvidenceRefIds);
  const citedEvidenceRefIds = strings(value.citedEvidenceRefIds, BRIEF_LIMITS.evidenceRefs, {
    allowEmpty: true,
    ids: true,
  });
  const supportingArguments = value.supportingArguments.map(
    (item) => argument(item) as BriefArgument,
  );
  const strongestCounterargument =
    value.strongestCounterargument === null
      ? null
      : (argument(value.strongestCounterargument, true) as BriefCounterargument);
  const allReferences = [
    ...citedEvidenceRefIds,
    ...supportingArguments.flatMap((item) => item.evidenceRefIds),
    ...(strongestCounterargument?.evidenceRefIds ?? []),
  ];
  if (allReferences.some((id) => !allowed.has(id))) invalid('BRIEF_INVALID_EVIDENCE');
  return Object.freeze({
    citedEvidenceRefIds,
    contentObjective: objective(value.contentObjective),
    contractVersion: CONTENT_BRIEF_GENERATION_CONTRACT_VERSION,
    coreJudgment: judgment(value.coreJudgment),
    openQuestionsAndLimitations: strings(
      value.openQuestionsAndLimitations,
      BRIEF_LIMITS.openQuestions,
      { allowEmpty: true },
    ),
    strongestCounterargument,
    structurePlan: structurePlan(value.structurePlan),
    supportingArguments: Object.freeze(supportingArguments),
    targetAudience: audience(value.targetAudience),
  });
}

export function assertBriefReadinessStatus(value: unknown): BriefReadinessStatus {
  return enumeration(value, BRIEF_READINESS_STATUSES);
}

export function assertBriefAction(value: unknown): BriefAction {
  return enumeration(value, BRIEF_ACTIONS);
}

export function assertBriefVersionState(value: unknown): BriefVersionState {
  return enumeration(value, BRIEF_VERSION_STATES);
}

export function assertBriefJobType(value: unknown): typeof CONTENT_BRIEF_GENERATE_JOB_TYPE {
  if (value !== CONTENT_BRIEF_GENERATE_JOB_TYPE) invalid();
  return CONTENT_BRIEF_GENERATE_JOB_TYPE;
}
