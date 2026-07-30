import { CONTENT_BRIEF_READINESS_POLICY_VERSION, type BriefReadinessStatus } from './constants.js';
import type {
  BriefArgument,
  BriefEvidenceRef,
  BriefReadinessContext,
  BriefReadinessSnapshot,
  ContentBriefDraft,
} from './contracts.js';
import { validateBriefProfile } from './profiles.js';

function factual(argument: BriefArgument): boolean {
  return argument.kind === 'FACT' || argument.kind === 'MIXED';
}

function evidenceSupports(
  argument: BriefArgument,
  refs: ReadonlyMap<string, BriefEvidenceRef>,
  fieldPath: string,
): boolean {
  if (!factual(argument)) return true;
  return argument.evidenceRefIds.some((id) => {
    const ref = refs.get(id);
    return (
      ref?.fieldPath === fieldPath &&
      ref.role === 'FACT' &&
      ref.factStatus === 'VERIFIED' &&
      ref.current &&
      ref.locatorValid
    );
  });
}

function expressionReasons(draft: ContentBriefDraft): readonly string[] {
  const policy = draft.expressionPolicy;
  const reasons: string[] = [];
  if (!policy.permissionCurrent) reasons.push('PERMISSION_NOT_CURRENT');
  if (policy.mode === 'PERSONAL_EXPERIENCE') {
    if (policy.readingState === 'R1' && !policy.firstPersonAllowed) {
      reasons.push('R1_PERSONAL_PERMISSION_MISSING');
    }
    if (policy.readingState === 'R2') {
      const allowed = new Set(policy.allowedAssertionIds);
      if (
        policy.firstPersonAllowed ||
        policy.r2AssertionIds.some((assertionId) => !allowed.has(assertionId))
      ) {
        reasons.push('R2_ASSERTION_NOT_CURRENT');
      }
    }
    if (
      ['R3', 'S1', 'S2', 'UNCLASSIFIED'].includes(policy.readingState) &&
      policy.firstPersonAllowed
    ) {
      reasons.push('FIRST_PERSON_NOT_PERMITTED');
    }
  } else {
    if (policy.firstPersonAllowed) reasons.push('RESEARCH_FIRST_PERSON_NOT_PERMITTED');
    if (!policy.requiredPublicLabels.includes('公开资料整理')) {
      reasons.push('PUBLIC_RESEARCH_LABEL_MISSING');
    }
  }
  if (
    draft.scorePlan.kind === 'PERSONAL_SCORE' &&
    !(policy.mode === 'PERSONAL_EXPERIENCE' && policy.readingState === 'R1')
  ) {
    reasons.push('PERSONAL_SCORE_NOT_PERMITTED');
  }
  if (
    draft.scorePlan.kind === 'RESEARCH_ANALYSIS_SCORE' &&
    (policy.mode !== 'PUBLIC_RESEARCH_ANALYSIS' ||
      draft.scorePlan.publicLabel !== '资料分析评分' ||
      !draft.scorePlan.publicLabelRequired)
  ) {
    reasons.push('RESEARCH_SCORE_LABEL_MISSING');
  }
  return Object.freeze(reasons);
}

function spoilerReasons(draft: ContentBriefDraft): readonly string[] {
  const spoiler = draft.spoilerPlan;
  if (
    spoiler.level === 'NO_SPOILER' &&
    (spoiler.warningRequired ||
      spoiler.warningPlacement !== 'NONE' ||
      spoiler.revealCoreTrick ||
      spoiler.revealEnding ||
      spoiler.userConfirmationRequired)
  ) {
    return Object.freeze(['NO_SPOILER_PLAN_INVALID']);
  }
  if (
    spoiler.level === 'LIGHT_SPOILER' &&
    (!spoiler.warningRequired ||
      spoiler.warningPlacement !== 'BODY_OPENING' ||
      spoiler.revealCoreTrick ||
      spoiler.revealEnding ||
      spoiler.userConfirmationRequired)
  ) {
    return Object.freeze(['LIGHT_SPOILER_PLAN_INVALID']);
  }
  if (
    spoiler.level === 'FULL_TRICK_ANALYSIS' &&
    (!spoiler.warningRequired ||
      spoiler.warningPlacement !== 'COVER_TITLE_AND_BODY_OPENING' ||
      !spoiler.revealCoreTrick ||
      !spoiler.revealEnding ||
      !spoiler.userConfirmationRequired ||
      !spoiler.userConfirmed)
  ) {
    return Object.freeze(['FULL_SPOILER_CONFIRMATION_REQUIRED']);
  }
  return Object.freeze([]);
}

function incompleteReasons(draft: ContentBriefDraft): readonly string[] {
  const reasons: string[] = [];
  if (
    draft.targetAudience.readerDescription === null ||
    draft.targetAudience.knowledgeLevel === null ||
    draft.targetAudience.selectionNeed === null
  ) {
    reasons.push('TARGET_AUDIENCE_INCOMPLETE');
  }
  if (
    draft.contentObjective.readerOutcome === null ||
    draft.contentObjective.scopeBoundary === null
  ) {
    reasons.push('OBJECTIVE_INCOMPLETE');
  }
  if (draft.coreJudgment.statement === null || draft.coreJudgment.qualification === null) {
    reasons.push('CORE_JUDGMENT_INCOMPLETE');
  }
  if (draft.supportingArguments.length < 1) reasons.push('SUPPORTING_ARGUMENTS_INCOMPLETE');
  if (
    draft.supportingArguments.some(
      (argument) => argument.statement === null || argument.limitation === null,
    )
  ) {
    reasons.push('ARGUMENT_INCOMPLETE');
  }
  if (
    draft.strongestCounterargument === null ||
    draft.strongestCounterargument.statement === null ||
    draft.strongestCounterargument.limitation === null ||
    draft.strongestCounterargument.responseOrQualification === null
  ) {
    reasons.push('COUNTERARGUMENT_INCOMPLETE');
  }
  const objectiveText = [draft.contentObjective.readerOutcome, draft.contentObjective.scopeBoundary]
    .filter((value): value is string => value !== null)
    .join(' ');
  if (
    /(?:制造|保证|必定|承诺).{0,8}(?:爆款|涨粉|走红|热门)|(?:必火|稳赚流量)/u.test(objectiveText)
  ) {
    reasons.push('OBJECTIVE_UNVERIFIABLE_PROMISE');
  }
  const judgment = draft.coreJudgment.statement?.trim() ?? '';
  if (/^(?:神作|封神|后劲太大|绝绝子)[！!。.]?$/u.test(judgment)) {
    reasons.push('CORE_JUDGMENT_VAGUE');
  }
  const audienceText = [draft.targetAudience.readerDescription, draft.targetAudience.selectionNeed]
    .filter((value): value is string => value !== null)
    .join(' ');
  if (/(?:收入|疾病|宗教信仰|政治立场|性取向|种族)画像/u.test(audienceText)) {
    reasons.push('AUDIENCE_SENSITIVE_PROFILE_UNSUPPORTED');
  }
  return Object.freeze(reasons);
}

function statusFor(reasons: readonly string[]): BriefReadinessStatus {
  const sets: readonly [BriefReadinessStatus, ReadonlySet<string>][] = [
    ['STALE', new Set(['TOPIC_NOT_CURRENT', 'DEPENDENCY_STALE'])],
    [
      'EXPERIMENT_MISMATCH',
      new Set(['EXPERIMENT_BINDING_MISMATCH', 'EXPERIMENT_NOT_CURRENT', 'EXPERIMENT_NOT_LOCKED']),
    ],
    ['DOSSIER_NOT_READY', new Set(['DOSSIER_NOT_READY'])],
    [
      'AUTHENTICITY_BLOCKED',
      new Set([
        'PERMISSION_NOT_CURRENT',
        'R1_PERSONAL_PERMISSION_MISSING',
        'R2_ASSERTION_NOT_CURRENT',
        'FIRST_PERSON_NOT_PERMITTED',
        'RESEARCH_FIRST_PERSON_NOT_PERMITTED',
        'PUBLIC_RESEARCH_LABEL_MISSING',
        'PERSONAL_SCORE_NOT_PERMITTED',
        'RESEARCH_SCORE_LABEL_MISSING',
      ]),
    ],
    [
      'SPOILER_POLICY_INCOMPLETE',
      new Set([
        'NO_SPOILER_PLAN_INVALID',
        'LIGHT_SPOILER_PLAN_INVALID',
        'FULL_SPOILER_CONFIRMATION_REQUIRED',
        'PROFILE_SPOILER_MISMATCH',
      ]),
    ],
    [
      'FACT_BLOCKED',
      new Set(['CORE_FACT_BLOCKED', 'BLOCKED_EVIDENCE_REF', 'INVALID_EVIDENCE_LOCATOR']),
    ],
    [
      'EVIDENCE_MAPPING_INCOMPLETE',
      new Set([
        'FACTUAL_ARGUMENT_UNMAPPED',
        'COUNTERARGUMENT_FACT_UNMAPPED',
        'CORE_JUDGMENT_UNMAPPED',
      ]),
    ],
  ];
  for (const [status, codes] of sets) {
    if (reasons.some((reason) => codes.has(reason))) return status;
  }
  return 'DRAFT_INCOMPLETE';
}

export function evaluateBriefReadiness(
  draft: ContentBriefDraft,
  context: BriefReadinessContext,
  evaluatedAt = new Date().toISOString(),
): BriefReadinessSnapshot {
  const reasons: string[] = [];
  if (!context.topicCurrent) reasons.push('TOPIC_NOT_CURRENT');
  if (context.topicEligibility !== 'ELIGIBLE') reasons.push('TOPIC_NOT_ELIGIBLE');
  if (context.topicState === 'HELD' || context.topicState === 'ARCHIVED') {
    reasons.push('TOPIC_STATE_EXCLUDED');
  }
  if (!context.dependenciesCurrent) reasons.push('DEPENDENCY_STALE');
  if (!context.dossierCurrentReady) reasons.push('DOSSIER_NOT_READY');
  if (context.factBlocked) reasons.push('CORE_FACT_BLOCKED');
  if (!context.schemaValid) reasons.push('SCHEMA_INVALID');
  if (draft.experimentBinding !== null) {
    if (!draft.experimentBinding.designCurrent || !draft.experimentBinding.assignmentCurrent) {
      reasons.push('EXPERIMENT_NOT_CURRENT');
    }
    if (!draft.experimentBinding.experimentLocked) reasons.push('EXPERIMENT_NOT_LOCKED');
    if (draft.experimentBinding.experimentStale || !context.experimentMatches) {
      reasons.push('EXPERIMENT_BINDING_MISMATCH');
    }
  }
  reasons.push(...validateBriefProfile(draft).reasonCodes);
  reasons.push(...expressionReasons(draft));
  reasons.push(...spoilerReasons(draft));

  const refs = new Map(draft.evidenceMap.map((ref) => [ref.refId, ref]));
  if (
    draft.evidenceMap.some(
      (ref) => ref.factStatus === 'FACT_BLOCKED' || ref.factStatus === 'CONFLICTED' || !ref.current,
    )
  ) {
    reasons.push('BLOCKED_EVIDENCE_REF');
  }
  if (draft.evidenceMap.some((ref) => !ref.locatorValid)) reasons.push('INVALID_EVIDENCE_LOCATOR');
  if (
    draft.supportingArguments.some(
      (argument) => !evidenceSupports(argument, refs, `supportingArguments.${argument.argumentId}`),
    )
  ) {
    reasons.push('FACTUAL_ARGUMENT_UNMAPPED');
  }
  if (
    draft.strongestCounterargument !== null &&
    !evidenceSupports(draft.strongestCounterargument, refs, 'strongestCounterargument')
  ) {
    reasons.push('COUNTERARGUMENT_FACT_UNMAPPED');
  }
  if (
    draft.coreJudgment.statement !== null &&
    draft.coreJudgment.kind !== 'OPINION' &&
    !draft.evidenceMap.some(
      (ref) =>
        ref.fieldPath === 'coreJudgment' &&
        ref.role === 'FACT' &&
        ref.factStatus === 'VERIFIED' &&
        ref.current &&
        ref.locatorValid,
    )
  ) {
    reasons.push('CORE_JUDGMENT_UNMAPPED');
  }
  reasons.push(...incompleteReasons(draft));
  const uniqueReasons = Object.freeze([...new Set(reasons)].sort());
  const ready =
    uniqueReasons.length === 0 &&
    context.topicEligibility === 'ELIGIBLE' &&
    context.topicState === 'LOCKED';
  return Object.freeze({
    evaluatedAt,
    policyVersion: CONTENT_BRIEF_READINESS_POLICY_VERSION,
    reasonCodes: uniqueReasons,
    status: ready ? 'READY_FOR_DRAFT_GENERATION' : statusFor(uniqueReasons),
  });
}
