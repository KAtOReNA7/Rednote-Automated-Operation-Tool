import {
  BRIEF_PROFILE_REGISTRY,
  CONTENT_BRIEF_CONTRACT_VERSION,
  CONTENT_BRIEF_FORBIDDEN_REGISTRY_VERSION,
  CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
  CONTENT_BRIEF_SCHEMA_VERSION,
  SYSTEM_FORBIDDEN_EXPRESSIONS,
  type BriefExpressionMode,
  type BriefProfileId,
  type BriefScoreKind,
} from './constants.js';
import {
  assertContentBriefDraft,
  type BriefEvidenceRef,
  type BriefExperimentBinding,
  type BriefExpressionPolicy,
  type BriefReadingState,
  type BriefSpoilerLevel,
  type BriefSubject,
  type ContentBriefDraft,
} from './contracts.js';

export interface BriefScaffoldInput {
  readonly allowedAssertionIds: readonly string[];
  readonly candidateJudgment: string | null;
  readonly comparisonDimension: string | null;
  readonly evidenceRefs: readonly BriefEvidenceRef[];
  readonly experimentBinding: BriefExperimentBinding | null;
  readonly expressionMode: BriefExpressionMode;
  readonly permissionCurrent: boolean;
  readonly permissionRevision: number;
  readonly permissionSnapshotId: string;
  readonly profileId: BriefProfileId;
  readonly r2AssertionIds: readonly string[];
  readonly readingState: BriefReadingState;
  readonly requiredPublicLabels: readonly string[];
  readonly scoreKind: BriefScoreKind;
  readonly scoreValueSourceId: string | null;
  readonly spoilerLevel: BriefSpoilerLevel;
  readonly spoilerUserConfirmed: boolean;
  readonly subjects: readonly BriefSubject[];
  readonly topicId: string;
  readonly topicVersionId: string;
}

function expressionPolicy(input: BriefScaffoldInput): BriefExpressionPolicy {
  const firstPersonAllowed =
    input.expressionMode === 'PERSONAL_EXPERIENCE' && input.readingState === 'R1';
  const requiredPublicLabels =
    input.expressionMode === 'PUBLIC_RESEARCH_ANALYSIS'
      ? [...new Set([...input.requiredPublicLabels, '公开资料整理'])]
      : [...input.requiredPublicLabels];
  return Object.freeze({
    allowedAssertionIds: Object.freeze([...input.allowedAssertionIds]),
    firstPersonAllowed,
    mode: input.expressionMode,
    permissionCurrent: input.permissionCurrent,
    permissionRevision: input.permissionRevision,
    permissionSnapshotId: input.permissionSnapshotId,
    r2AssertionIds:
      input.readingState === 'R2' ? Object.freeze([...input.r2AssertionIds]) : Object.freeze([]),
    readingState: input.readingState,
    requiredPublicLabels: Object.freeze(requiredPublicLabels),
  });
}

function spoilerPlan(input: BriefScaffoldInput): ContentBriefDraft['spoilerPlan'] {
  switch (input.spoilerLevel) {
    case 'NO_SPOILER':
      return Object.freeze({
        level: input.spoilerLevel,
        revealCoreTrick: false,
        revealEnding: false,
        userConfirmationRequired: false,
        userConfirmed: false,
        warningPlacement: 'NONE',
        warningRequired: false,
      });
    case 'LIGHT_SPOILER':
      return Object.freeze({
        level: input.spoilerLevel,
        revealCoreTrick: false,
        revealEnding: false,
        userConfirmationRequired: false,
        userConfirmed: false,
        warningPlacement: 'BODY_OPENING',
        warningRequired: true,
      });
    case 'FULL_TRICK_ANALYSIS':
      return Object.freeze({
        level: input.spoilerLevel,
        revealCoreTrick: true,
        revealEnding: true,
        userConfirmationRequired: true,
        userConfirmed: input.spoilerUserConfirmed,
        warningPlacement: 'COVER_TITLE_AND_BODY_OPENING',
        warningRequired: true,
      });
  }
}

export function buildLocalBriefScaffold(input: BriefScaffoldInput): ContentBriefDraft {
  const profile = BRIEF_PROFILE_REGISTRY[input.profileId];
  const primarySubjects = input.subjects.filter((subject) => subject.role === 'PRIMARY');
  const slots = profile.requiredSlots.map((slotId, index) => {
    const comparisonSubject =
      input.profileId === 'CROSS_WORK_COMPARISON' && slotId === 'work-a-evidence'
        ? primarySubjects[0]
        : input.profileId === 'CROSS_WORK_COMPARISON' && slotId === 'work-b-evidence'
          ? primarySubjects[1]
          : undefined;
    return Object.freeze({
      function: `结构槽位 ${index + 1}：${slotId}`,
      required: true,
      slotId,
      subjectIds:
        comparisonSubject === undefined
          ? Object.freeze([])
          : Object.freeze([comparisonSubject.subjectId]),
    });
  });
  const fieldStates = [
    ['targetAudience', 'EDITABLE'],
    ['contentObjective', 'EDITABLE'],
    ['coreJudgment', 'EDITABLE'],
    ['supportingArguments', 'EDITABLE'],
    ['strongestCounterargument', 'EDITABLE'],
    ['structurePlan', 'EDITABLE'],
    ['openQuestionsAndLimitations', 'EDITABLE'],
    ['topicId', 'SYSTEM_LOCKED'],
    ['topicVersionId', 'SYSTEM_LOCKED'],
    ['subjects', 'SYSTEM_LOCKED'],
    ['evidenceMap', 'SYSTEM_LOCKED'],
    ['experimentBinding', 'SYSTEM_LOCKED'],
    ['expressionPolicy', 'SYSTEM_LOCKED'],
    ['scorePlan', 'SYSTEM_LOCKED'],
    ['spoilerPlan', 'SYSTEM_LOCKED'],
    ['forbiddenExpressions.system', 'SYSTEM_LOCKED'],
    ['forbiddenExpressions.userCustom', 'EDITABLE'],
    ['contractVersion', 'SYSTEM_LOCKED'],
    ['schemaVersion', 'SYSTEM_LOCKED'],
    ['profileId', 'SYSTEM_LOCKED'],
  ] as const;
  return assertContentBriefDraft({
    contentObjective: {
      readerOutcome: null,
      scopeBoundary: null,
    },
    contractVersion: CONTENT_BRIEF_CONTRACT_VERSION,
    coreJudgment: {
      judgmentId: 'core',
      kind: input.candidateJudgment === null ? 'OPINION' : 'MIXED',
      qualification: null,
      statement: input.candidateJudgment,
    },
    evidenceMap: input.evidenceRefs,
    experimentBinding: input.experimentBinding,
    expressionPolicy: expressionPolicy(input),
    fieldStates: fieldStates.map(([path, lock]) => ({
      lock,
      path,
      provenance: 'SYSTEM_DERIVED',
    })),
    forbiddenExpressions: SYSTEM_FORBIDDEN_EXPRESSIONS.map((rule) => ({
      category: rule.category,
      expressionId: rule.id,
      phrase: rule.phrase,
      policyVersion: CONTENT_BRIEF_FORBIDDEN_REGISTRY_VERSION,
      reason: rule.reason,
      system: true,
    })),
    openQuestionsAndLimitations: Object.freeze([
      ...(input.candidateJudgment === null ? ['中心判断尚待用户确认'] : []),
      '支持论点与最强反方尚待补充',
    ]),
    profileId: input.profileId,
    schemaVersion: CONTENT_BRIEF_SCHEMA_VERSION,
    scorePlan: {
      kind: input.scoreKind,
      publicLabel: input.scoreKind === 'RESEARCH_ANALYSIS_SCORE' ? ('资料分析评分' as const) : null,
      publicLabelRequired: input.scoreKind === 'RESEARCH_ANALYSIS_SCORE',
      scale: input.scoreKind === 'NONE' ? null : 'USER_DEFINED',
      valueSourceId: input.scoreValueSourceId,
    },
    spoilerPlan: spoilerPlan(input),
    strongestCounterargument: null,
    structurePlan: {
      comparisonDimension: input.comparisonDimension,
      profileId: input.profileId,
      profileVersion: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
      slots,
    },
    subjects: input.subjects,
    supportingArguments: [],
    targetAudience: {
      knowledgeLevel: null,
      readerDescription: null,
      selectionNeed: null,
    },
    topicId: input.topicId,
    topicVersionId: input.topicVersionId,
  });
}
