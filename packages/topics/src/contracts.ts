import {
  FIRST_30_PROFILE_ID,
  TOPIC_ANALYSIS_MODES,
  TOPIC_CANDIDATE_STATES,
  TOPIC_COMPARISON_DIMENSIONS,
  TOPIC_CONTENT_TYPES,
  TOPIC_ELIGIBILITY_STATES,
  TOPIC_EXPRESSION_FORMS,
  TOPIC_LIMITS,
  TOPIC_GENERATION_JOB_CONTRACT_VERSION,
  TOPIC_QUOTA_JOB_CONTRACT_VERSION,
  TOPIC_PUBLIC_LABELS,
  TOPIC_STATE_ACTIONS,
  TOPIC_SUBJECT_ROLES,
  TOPIC_SUBJECT_TYPES,
  type TopicAnalysisMode,
  type TopicCandidateState,
  type TopicComparisonDimension,
  type TopicContentType,
  type TopicEligibilityState,
  type TopicExpressionForm,
  type TopicPublicLabel,
  type TopicStateAction,
  type TopicSubjectRole,
  type TopicSubjectType,
} from './constants.js';
import { TopicError } from './errors.js';

export type TopicSpoilerLevel = 'NO_SPOILER' | 'LIGHT_SPOILER' | 'FULL_TRICK_ANALYSIS';
export type TopicPermissionState =
  | 'ALLOWED'
  | 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY'
  | 'RESEARCH_ONLY'
  | 'BLOCKED'
  | 'STALE_REVIEW_REQUIRED';

const SPOILER_LEVELS = ['NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS'] as const;
const PERMISSION_STATES = [
  'ALLOWED',
  'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY',
  'RESEARCH_ONLY',
  'BLOCKED',
  'STALE_REVIEW_REQUIRED',
] as const;
const DOSSIER_READINESS = [
  'NOT_BUILT',
  'BUILD_REQUIRED',
  'INSUFFICIENT_COVERAGE',
  'FACT_BLOCKED',
  'STALE',
  'READY_FOR_CONTENT_BRIEF',
] as const;
const CONTEXT_FACT_STATES = [
  'VERIFIED',
  'SUPPORTED_NOT_VERIFIED',
  'INSUFFICIENT',
  'CONFLICTED',
  'FACT_BLOCKED',
  'STALE_REVIEW_REQUIRED',
] as const;

export interface TopicSubjectInput {
  readonly catalogRevision: number;
  readonly editionId: string | null;
  readonly expressionForm: TopicExpressionForm | null;
  readonly expressionId: string | null;
  readonly role: TopicSubjectRole;
  readonly subjectId: string;
  readonly subjectType: TopicSubjectType;
  readonly workId: string;
}

export interface TopicCandidateDraft {
  readonly analysisMode: TopicAnalysisMode;
  readonly candidateJudgment: string | null;
  readonly centralQuestion: string;
  readonly comparisonDimension: TopicComparisonDimension | null;
  readonly contentType: TopicContentType;
  readonly contextClaimIds: readonly string[];
  readonly provenance: 'LOCAL_DETERMINISTIC' | 'SCRIPTED_MOCK';
  readonly requiredPublicLabels: readonly TopicPublicLabel[];
  readonly spoilerPolicy: {
    readonly userConfirmationRequired: boolean;
    readonly warningPlacement: 'NONE' | 'BODY_OPENING' | 'COVER_TITLE_AND_BODY_OPENING';
    readonly warningRequired: boolean;
  };
  readonly spoilerLevel: TopicSpoilerLevel;
  readonly subjects: readonly TopicSubjectInput[];
  readonly topicAngle: string;
}

export interface TopicDossierInput {
  readonly blockedCount: number;
  readonly coreFactBlocked: boolean;
  readonly coverageBasisPoints: number;
  readonly coveragePolicyVersion: string;
  readonly dossierId: string;
  readonly factPolicyVersion: string;
  readonly gapCount: number;
  readonly readiness:
    | 'NOT_BUILT'
    | 'BUILD_REQUIRED'
    | 'INSUFFICIENT_COVERAGE'
    | 'FACT_BLOCKED'
    | 'STALE'
    | 'READY_FOR_CONTENT_BRIEF';
  readonly stale: boolean;
  readonly versionId: string;
  readonly workId: string;
}

export interface TopicPermissionInput {
  readonly authenticityPolicyVersion: string;
  readonly personalContentMode: TopicPermissionState;
  readonly publicResearchContentMode: TopicPermissionState;
  readonly snapshotId: string;
  readonly snapshotVersion: string;
  readonly spoiler: {
    readonly level: TopicSpoilerLevel;
    readonly satisfied: boolean;
    readonly userConfirmationRequired: boolean;
    readonly warningPlacement: 'NONE' | 'BODY_OPENING' | 'COVER_TITLE_AND_BODY_OPENING';
    readonly warningRequired: boolean;
  };
  readonly spoilerPolicyVersion: string;
  readonly stale: boolean;
  readonly workId: string;
}

export interface TopicContextClaimInput {
  readonly claimId: string;
  readonly contextOnly: boolean;
  readonly factStatus:
    | 'VERIFIED'
    | 'SUPPORTED_NOT_VERIFIED'
    | 'INSUFFICIENT'
    | 'CONFLICTED'
    | 'FACT_BLOCKED'
    | 'STALE_REVIEW_REQUIRED';
  readonly workId: string;
}

export interface TopicExistingFingerprintInput {
  readonly canonicalTopicId: string;
  readonly fingerprint: string;
  readonly state: TopicCandidateState;
}

export interface TopicEligibilityInput {
  readonly allSubjectsCurrent: boolean;
  readonly candidate: TopicCandidateDraft;
  readonly contextClaims: readonly TopicContextClaimInput[];
  readonly dossiers: readonly TopicDossierInput[];
  readonly existingFingerprint: TopicExistingFingerprintInput | null;
  readonly permissions: readonly TopicPermissionInput[];
  readonly requestedState: TopicCandidateState;
}

export interface TopicRankingInput {
  readonly approvalWorkloadUnits: number | null;
  readonly candidate: TopicCandidateDraft;
  readonly dependencyKeys: readonly string[];
  readonly dossiers: readonly TopicDossierInput[];
  readonly eligibility: TopicEligibilityState;
  readonly estimatedExternalCostMicrousd: number | null;
  readonly sameSubjectTopicCount: number;
}

export interface TopicStateChangeDraft {
  readonly action: TopicStateAction;
  readonly expectedRevision: number;
  readonly topicId: string;
}

export interface TopicBatchStateChangeDraft {
  readonly action: Exclude<TopicStateAction, 'UNDO'>;
  readonly items: readonly {
    readonly expectedRevision: number;
    readonly topicId: string;
  }[];
}

export interface TopicProposalV1 {
  readonly candidate: TopicCandidateDraft;
  readonly citedInputIds: readonly string[];
  readonly contractVersion: 'topic-proposal-v1';
  readonly providerKind: 'SCRIPTED_MOCK';
}

export interface TopicGenerationJobPayloadV1 {
  readonly candidateCount: number;
  readonly contractVersion: typeof TOPIC_GENERATION_JOB_CONTRACT_VERSION;
  readonly executionId: string;
  readonly expectedPolicyHash: string;
  readonly inputWorkCount: number;
  readonly planHash: string;
  readonly planId: string;
  readonly profileId: string;
}

export interface TopicQuotaPlanJobPayloadV1 {
  readonly contractVersion: typeof TOPIC_QUOTA_JOB_CONTRACT_VERSION;
  readonly executionId: string;
  readonly maxWorkExposure: number;
  readonly poolSnapshotHash: string;
  readonly profileId: string;
  readonly quotaProfileId: typeof FIRST_30_PROFILE_ID;
  readonly totalCandidateCount: number;
}

export type TopicPlanningJobPayloadV1 = TopicGenerationJobPayloadV1 | TopicQuotaPlanJobPayloadV1;

function invalid(): never {
  throw new TopicError('TOPIC_INVALID_CONTRACT');
}

function assertExactObject(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid();
  }
}

function assertIdentifier(value: unknown, maxBytes = TOPIC_LIMITS.identifierBytes): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    invalid();
  }
  return value;
}

function assertHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) invalid();
  return value;
}

function assertNullableIdentifier(value: unknown): string | null {
  return value === null ? null : assertIdentifier(value);
}

function assertBoundedText(value: unknown, maximumBytes: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    invalid();
  }
  return value;
}

function assertEnum<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid();
  return value as T;
}

function assertInteger(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid();
  }
  return value;
}

function assertBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function assertStringArray(
  value: unknown,
  maximum: number,
  options: { readonly identifiers?: boolean } = {},
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  const values = value.map((item) =>
    options.identifiers ? assertIdentifier(item) : assertBoundedText(item, 512),
  ) as string[];
  if (new Set(values).size !== values.length) invalid();
  return Object.freeze(values);
}

function assertSubject(value: unknown): TopicSubjectInput {
  assertExactObject(value, [
    'catalogRevision',
    'editionId',
    'expressionForm',
    'expressionId',
    'role',
    'subjectId',
    'subjectType',
    'workId',
  ]);
  const subjectType = assertEnum(value.subjectType, TOPIC_SUBJECT_TYPES);
  const subjectId = assertIdentifier(value.subjectId);
  const workId = assertIdentifier(value.workId);
  const expressionId = assertNullableIdentifier(value.expressionId);
  const editionId = assertNullableIdentifier(value.editionId);
  const expressionForm =
    value.expressionForm === null ? null : assertEnum(value.expressionForm, TOPIC_EXPRESSION_FORMS);
  if (
    (subjectType === 'WORK' &&
      (subjectId !== workId ||
        expressionId !== null ||
        editionId !== null ||
        expressionForm !== null)) ||
    (subjectType === 'EXPRESSION' &&
      (expressionId !== subjectId || editionId !== null || expressionForm === null)) ||
    (subjectType === 'EDITION' &&
      (editionId !== subjectId || expressionId === null || expressionForm === null))
  ) {
    invalid();
  }
  return Object.freeze({
    catalogRevision: assertInteger(value.catalogRevision, 1, 2_147_483_647),
    editionId,
    expressionForm,
    expressionId,
    role: assertEnum(value.role, TOPIC_SUBJECT_ROLES),
    subjectId,
    subjectType,
    workId,
  });
}

export function assertTopicCandidateDraft(value: unknown): TopicCandidateDraft {
  assertExactObject(value, [
    'analysisMode',
    'candidateJudgment',
    'centralQuestion',
    'comparisonDimension',
    'contentType',
    'contextClaimIds',
    'provenance',
    'requiredPublicLabels',
    'spoilerPolicy',
    'spoilerLevel',
    'subjects',
    'topicAngle',
  ]);
  if (
    !Array.isArray(value.subjects) ||
    value.subjects.length < 1 ||
    value.subjects.length > TOPIC_LIMITS.maxSubjects
  ) {
    invalid();
  }
  const subjects = value.subjects.map(assertSubject);
  const subjectKeys = subjects.map((subject) => `${subject.subjectType}:${subject.subjectId}`);
  if (new Set(subjectKeys).size !== subjects.length) invalid();
  if (
    !Array.isArray(value.requiredPublicLabels) ||
    value.requiredPublicLabels.length > TOPIC_PUBLIC_LABELS.length
  ) {
    invalid();
  }
  const requiredPublicLabels = value.requiredPublicLabels.map((label) =>
    assertEnum(label, TOPIC_PUBLIC_LABELS),
  );
  if (new Set(requiredPublicLabels).size !== requiredPublicLabels.length) invalid();
  if (value.provenance !== 'LOCAL_DETERMINISTIC' && value.provenance !== 'SCRIPTED_MOCK') {
    invalid();
  }
  assertExactObject(value.spoilerPolicy, [
    'userConfirmationRequired',
    'warningPlacement',
    'warningRequired',
  ]);
  return Object.freeze({
    analysisMode: assertEnum(value.analysisMode, TOPIC_ANALYSIS_MODES),
    candidateJudgment: assertBoundedText(value.candidateJudgment, TOPIC_LIMITS.judgmentBytes, true),
    centralQuestion: assertBoundedText(
      value.centralQuestion,
      TOPIC_LIMITS.centralQuestionBytes,
    ) as string,
    comparisonDimension:
      value.comparisonDimension === null
        ? null
        : assertEnum(value.comparisonDimension, TOPIC_COMPARISON_DIMENSIONS),
    contentType: assertEnum(value.contentType, TOPIC_CONTENT_TYPES),
    contextClaimIds: assertStringArray(value.contextClaimIds, TOPIC_LIMITS.contextClaims, {
      identifiers: true,
    }),
    provenance: value.provenance,
    requiredPublicLabels: Object.freeze(requiredPublicLabels),
    spoilerPolicy: Object.freeze({
      userConfirmationRequired: assertBoolean(value.spoilerPolicy.userConfirmationRequired),
      warningPlacement: assertEnum(value.spoilerPolicy.warningPlacement, [
        'NONE',
        'BODY_OPENING',
        'COVER_TITLE_AND_BODY_OPENING',
      ] as const),
      warningRequired: assertBoolean(value.spoilerPolicy.warningRequired),
    }),
    spoilerLevel: assertEnum(value.spoilerLevel, SPOILER_LEVELS),
    subjects: Object.freeze(subjects),
    topicAngle: assertBoundedText(value.topicAngle, TOPIC_LIMITS.angleBytes) as string,
  });
}

function assertDossier(value: unknown): TopicDossierInput {
  assertExactObject(value, [
    'blockedCount',
    'coreFactBlocked',
    'coverageBasisPoints',
    'coveragePolicyVersion',
    'dossierId',
    'factPolicyVersion',
    'gapCount',
    'readiness',
    'stale',
    'versionId',
    'workId',
  ]);
  return Object.freeze({
    blockedCount: assertInteger(value.blockedCount, 0, 1_000_000),
    coreFactBlocked: assertBoolean(value.coreFactBlocked),
    coverageBasisPoints: assertInteger(value.coverageBasisPoints, 0, TOPIC_LIMITS.scoreBasisPoints),
    coveragePolicyVersion: assertIdentifier(value.coveragePolicyVersion),
    dossierId: assertIdentifier(value.dossierId),
    factPolicyVersion: assertIdentifier(value.factPolicyVersion),
    gapCount: assertInteger(value.gapCount, 0, 1_000_000),
    readiness: assertEnum(value.readiness, DOSSIER_READINESS),
    stale: assertBoolean(value.stale),
    versionId: assertIdentifier(value.versionId),
    workId: assertIdentifier(value.workId),
  });
}

function assertPermission(value: unknown): TopicPermissionInput {
  assertExactObject(value, [
    'authenticityPolicyVersion',
    'personalContentMode',
    'publicResearchContentMode',
    'snapshotId',
    'snapshotVersion',
    'spoiler',
    'spoilerPolicyVersion',
    'stale',
    'workId',
  ]);
  assertExactObject(value.spoiler, [
    'level',
    'satisfied',
    'userConfirmationRequired',
    'warningPlacement',
    'warningRequired',
  ]);
  return Object.freeze({
    authenticityPolicyVersion: assertIdentifier(value.authenticityPolicyVersion),
    personalContentMode: assertEnum(value.personalContentMode, PERMISSION_STATES),
    publicResearchContentMode: assertEnum(value.publicResearchContentMode, PERMISSION_STATES),
    snapshotId: assertIdentifier(value.snapshotId),
    snapshotVersion: assertIdentifier(value.snapshotVersion),
    spoiler: Object.freeze({
      level: assertEnum(value.spoiler.level, SPOILER_LEVELS),
      satisfied: assertBoolean(value.spoiler.satisfied),
      userConfirmationRequired: assertBoolean(value.spoiler.userConfirmationRequired),
      warningPlacement: assertEnum(value.spoiler.warningPlacement, [
        'NONE',
        'BODY_OPENING',
        'COVER_TITLE_AND_BODY_OPENING',
      ] as const),
      warningRequired: assertBoolean(value.spoiler.warningRequired),
    }),
    spoilerPolicyVersion: assertIdentifier(value.spoilerPolicyVersion),
    stale: assertBoolean(value.stale),
    workId: assertIdentifier(value.workId),
  });
}

function assertContextClaim(value: unknown): TopicContextClaimInput {
  assertExactObject(value, ['claimId', 'contextOnly', 'factStatus', 'workId']);
  return Object.freeze({
    claimId: assertIdentifier(value.claimId),
    contextOnly: assertBoolean(value.contextOnly),
    factStatus: assertEnum(value.factStatus, CONTEXT_FACT_STATES),
    workId: assertIdentifier(value.workId),
  });
}

export function assertTopicEligibilityInput(value: unknown): TopicEligibilityInput {
  assertExactObject(value, [
    'allSubjectsCurrent',
    'candidate',
    'contextClaims',
    'dossiers',
    'existingFingerprint',
    'permissions',
    'requestedState',
  ]);
  if (
    !Array.isArray(value.dossiers) ||
    value.dossiers.length > TOPIC_LIMITS.maxSubjects ||
    !Array.isArray(value.permissions) ||
    value.permissions.length > TOPIC_LIMITS.maxSubjects ||
    !Array.isArray(value.contextClaims) ||
    value.contextClaims.length > TOPIC_LIMITS.contextClaims
  ) {
    invalid();
  }
  let existingFingerprint: TopicExistingFingerprintInput | null = null;
  if (value.existingFingerprint !== null) {
    assertExactObject(value.existingFingerprint, ['canonicalTopicId', 'fingerprint', 'state']);
    const fingerprint = assertIdentifier(value.existingFingerprint.fingerprint);
    if (fingerprint.length !== 64 || /[^0-9a-f]/u.test(fingerprint)) invalid();
    existingFingerprint = Object.freeze({
      canonicalTopicId: assertIdentifier(value.existingFingerprint.canonicalTopicId),
      fingerprint,
      state: assertEnum(value.existingFingerprint.state, TOPIC_CANDIDATE_STATES),
    });
  }
  const dossiers = value.dossiers.map(assertDossier);
  const permissions = value.permissions.map(assertPermission);
  const contextClaims = value.contextClaims.map(assertContextClaim);
  if (
    new Set(dossiers.map((item) => item.workId)).size !== dossiers.length ||
    new Set(permissions.map((item) => item.workId)).size !== permissions.length ||
    new Set(contextClaims.map((item) => item.claimId)).size !== contextClaims.length
  ) {
    invalid();
  }
  return Object.freeze({
    allSubjectsCurrent: assertBoolean(value.allSubjectsCurrent),
    candidate: assertTopicCandidateDraft(value.candidate),
    contextClaims: Object.freeze(contextClaims),
    dossiers: Object.freeze(dossiers),
    existingFingerprint,
    permissions: Object.freeze(permissions),
    requestedState: assertEnum(value.requestedState, TOPIC_CANDIDATE_STATES),
  });
}

export function assertTopicRankingInput(value: unknown): TopicRankingInput {
  assertExactObject(value, [
    'approvalWorkloadUnits',
    'candidate',
    'dependencyKeys',
    'dossiers',
    'eligibility',
    'estimatedExternalCostMicrousd',
    'sameSubjectTopicCount',
  ]);
  if (!Array.isArray(value.dossiers) || value.dossiers.length > TOPIC_LIMITS.maxSubjects) {
    invalid();
  }
  return Object.freeze({
    approvalWorkloadUnits:
      value.approvalWorkloadUnits === null
        ? null
        : assertInteger(value.approvalWorkloadUnits, 0, 10_000),
    candidate: assertTopicCandidateDraft(value.candidate),
    dependencyKeys: assertStringArray(value.dependencyKeys, 64, { identifiers: true }),
    dossiers: Object.freeze(value.dossiers.map(assertDossier)),
    eligibility: assertEnum(value.eligibility, TOPIC_ELIGIBILITY_STATES),
    estimatedExternalCostMicrousd:
      value.estimatedExternalCostMicrousd === null
        ? null
        : assertInteger(value.estimatedExternalCostMicrousd, 0, 9_000_000_000_000),
    sameSubjectTopicCount: assertInteger(value.sameSubjectTopicCount, 0, 1_000_000),
  });
}

export function assertTopicStateChangeDraft(value: unknown): TopicStateChangeDraft {
  assertExactObject(value, ['action', 'expectedRevision', 'topicId']);
  return Object.freeze({
    action: assertEnum(value.action, TOPIC_STATE_ACTIONS),
    expectedRevision: assertInteger(value.expectedRevision, 1, 2_147_483_647),
    topicId: assertIdentifier(value.topicId),
  });
}

export function assertTopicBatchStateChangeDraft(value: unknown): TopicBatchStateChangeDraft {
  assertExactObject(value, ['action', 'items']);
  if (
    value.action === 'UNDO' ||
    !TOPIC_STATE_ACTIONS.includes(value.action as TopicStateAction) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > TOPIC_LIMITS.batchSize
  ) {
    invalid();
  }
  const items = value.items.map((item) => {
    assertExactObject(item, ['expectedRevision', 'topicId']);
    return Object.freeze({
      expectedRevision: assertInteger(item.expectedRevision, 1, 2_147_483_647),
      topicId: assertIdentifier(item.topicId),
    });
  });
  if (new Set(items.map((item) => item.topicId)).size !== items.length) invalid();
  return Object.freeze({
    action: value.action as Exclude<TopicStateAction, 'UNDO'>,
    items: Object.freeze(items),
  });
}

export function assertTopicGenerationJobPayload(value: unknown): TopicGenerationJobPayloadV1 {
  assertExactObject(value, [
    'candidateCount',
    'contractVersion',
    'executionId',
    'expectedPolicyHash',
    'inputWorkCount',
    'planHash',
    'planId',
    'profileId',
  ]);
  if (value.contractVersion !== TOPIC_GENERATION_JOB_CONTRACT_VERSION) invalid();
  return Object.freeze({
    candidateCount: assertInteger(value.candidateCount, 0, TOPIC_LIMITS.maxCandidatesPerGeneration),
    contractVersion: TOPIC_GENERATION_JOB_CONTRACT_VERSION,
    executionId: assertIdentifier(value.executionId),
    expectedPolicyHash: assertHash(value.expectedPolicyHash),
    inputWorkCount: assertInteger(value.inputWorkCount, 0, TOPIC_LIMITS.maxCandidatesPerGeneration),
    planHash: assertHash(value.planHash),
    planId: assertIdentifier(value.planId),
    profileId: assertIdentifier(value.profileId),
  });
}

export function assertTopicQuotaPlanJobPayload(value: unknown): TopicQuotaPlanJobPayloadV1 {
  assertExactObject(value, [
    'contractVersion',
    'executionId',
    'maxWorkExposure',
    'poolSnapshotHash',
    'profileId',
    'quotaProfileId',
    'totalCandidateCount',
  ]);
  if (
    value.contractVersion !== TOPIC_QUOTA_JOB_CONTRACT_VERSION ||
    value.quotaProfileId !== FIRST_30_PROFILE_ID
  ) {
    invalid();
  }
  return Object.freeze({
    contractVersion: TOPIC_QUOTA_JOB_CONTRACT_VERSION,
    executionId: assertIdentifier(value.executionId),
    maxWorkExposure: assertInteger(value.maxWorkExposure, 1, TOPIC_LIMITS.maxWorkExposure),
    poolSnapshotHash: assertHash(value.poolSnapshotHash),
    profileId: assertIdentifier(value.profileId),
    quotaProfileId: FIRST_30_PROFILE_ID,
    totalCandidateCount: assertInteger(
      value.totalCandidateCount,
      0,
      TOPIC_LIMITS.maxPlanCandidates,
    ),
  });
}

export function assertTopicPlanningJobPayload(value: unknown): TopicPlanningJobPayloadV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  return (value as { readonly contractVersion?: unknown }).contractVersion ===
    TOPIC_GENERATION_JOB_CONTRACT_VERSION
    ? assertTopicGenerationJobPayload(value)
    : assertTopicQuotaPlanJobPayload(value);
}

export function assertTopicProposalV1(
  value: unknown,
  allowedInputIds: readonly string[],
): TopicProposalV1 {
  assertExactObject(value, ['candidate', 'citedInputIds', 'contractVersion', 'providerKind']);
  if (value.contractVersion !== 'topic-proposal-v1' || value.providerKind !== 'SCRIPTED_MOCK') {
    invalid();
  }
  const citedInputIds = assertStringArray(value.citedInputIds, 64, { identifiers: true });
  const allowlist = new Set(allowedInputIds);
  if (citedInputIds.length < 1 || citedInputIds.some((item) => !allowlist.has(item))) invalid();
  const candidate = assertTopicCandidateDraft(value.candidate);
  const subjectIds = new Set(candidate.subjects.map((subject) => subject.subjectId));
  if (citedInputIds.every((item) => !subjectIds.has(item))) invalid();
  return Object.freeze({
    candidate,
    citedInputIds,
    contractVersion: 'topic-proposal-v1',
    providerKind: 'SCRIPTED_MOCK',
  });
}
