import {
  COPY_PROFILE_REGISTRY,
  COPY_STRUCTURAL_VALIDATION_VERSION,
  type CopyDraftStatus,
} from './constants.js';
import {
  assertContentDraftPayload,
  type ContentDraftPayloadV1,
  type DraftLineageRefV1,
  type DraftStructuralValidationV1,
} from './contracts.js';

function allLineage(payload: ContentDraftPayloadV1): readonly DraftLineageRefV1[] {
  return [
    ...payload.titles.flatMap(({ lineage }) => lineage),
    ...payload.blocks.flatMap(({ lineage }) => lineage),
    ...payload.tags.flatMap(({ lineage }) => lineage),
    ...(payload.pinnedComment?.lineage ?? []),
  ];
}

function lineageReasons(payload: ContentDraftPayloadV1): string[] {
  const reasons: string[] = [];
  const evidence = new Set(payload.brief.allowedEvidenceRefIds);
  const assertions = new Set(payload.brief.allowedExperienceAssertionIds);
  const workIds = new Set(payload.brief.workIds);
  const slotIds = new Set(
    payload.brief.dependencies
      .filter(({ dependencyType }) => dependencyType === 'LOCK_SNAPSHOT')
      .map(({ dependencyId }) => dependencyId),
  );
  for (const ref of allLineage(payload)) {
    if (ref.inputHash !== payload.brief.briefInputHash) reasons.push('LINEAGE_INPUT_HASH_MISMATCH');
    if (ref.evidenceRefIds.some((id) => !evidence.has(id)))
      reasons.push('LINEAGE_EVIDENCE_NOT_ALLOWED');
    if (ref.experienceAssertionId !== null && !assertions.has(ref.experienceAssertionId)) {
      reasons.push('LINEAGE_ASSERTION_NOT_ALLOWED');
    }
    if (ref.workId !== null && !workIds.has(ref.workId)) reasons.push('LINEAGE_WORK_NOT_ALLOWED');
    if (ref.structureSlotId !== null && slotIds.size > 0 && !slotIds.has(ref.structureSlotId)) {
      reasons.push('LINEAGE_SLOT_NOT_ALLOWED');
    }
  }
  const factual = payload.blocks.filter(({ kind }) => kind === 'FACT_SYNTHESIS');
  if (factual.some(({ lineage }) => lineage.length === 0)) {
    reasons.push('FACT_BLOCK_LINEAGE_REQUIRED');
  }
  return reasons;
}

function permissionReasons(payload: ContentDraftPayloadV1): string[] {
  const reasons: string[] = [];
  const policy = payload.brief.expressionPolicy;
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
  } else if (policy.firstPersonAllowed) {
    reasons.push('RESEARCH_FIRST_PERSON_NOT_PERMITTED');
  }
  if (policy.mode === 'PUBLIC_RESEARCH_ANALYSIS') {
    for (const label of payload.brief.requiredPublicLabels) {
      const visible = [
        ...payload.blocks.map(({ text }) => text),
        payload.pinnedComment?.text ?? '',
      ].some((text) => text.includes(label));
      if (!visible) reasons.push('PUBLIC_LABEL_ARTIFACT_REQUIRED');
    }
  }
  if (
    payload.brief.scorePlan.kind === 'RESEARCH_ANALYSIS_SCORE' &&
    ![...payload.blocks.map(({ text }) => text), payload.pinnedComment?.text ?? ''].some((text) =>
      text.includes('资料分析评分'),
    )
  ) {
    reasons.push('RESEARCH_SCORE_LABEL_REQUIRED');
  }
  if (
    payload.brief.scorePlan.kind === 'PERSONAL_SCORE' &&
    !(
      policy.mode === 'PERSONAL_EXPERIENCE' &&
      policy.readingState === 'R1' &&
      policy.firstPersonAllowed
    )
  ) {
    reasons.push('PERSONAL_SCORE_NOT_PERMITTED');
  }
  return reasons;
}

function spoilerReasons(payload: ContentDraftPayloadV1): string[] {
  const reasons: string[] = [];
  const warnings = payload.spoilerWarnings;
  if (payload.brief.spoilerPlan.level === 'NO_SPOILER') {
    if (
      warnings.coverWarningText !== null ||
      warnings.titleWarningMarker !== null ||
      warnings.bodyOpeningWarningText !== null ||
      warnings.pinnedCommentWarningText !== null
    ) {
      reasons.push('NO_SPOILER_WARNING_UNEXPECTED');
    }
  }
  if (
    payload.brief.spoilerPlan.level === 'LIGHT_SPOILER' &&
    warnings.bodyOpeningWarningText === null
  ) {
    reasons.push('BODY_WARNING_REQUIRED');
  }
  if (payload.brief.spoilerPlan.level === 'FULL_TRICK_ANALYSIS') {
    const titleWarningMarker = warnings.titleWarningMarker;
    if (warnings.coverWarningText === null) reasons.push('COVER_WARNING_REQUIRED');
    if (titleWarningMarker === null) reasons.push('TITLE_WARNING_REQUIRED');
    if (warnings.bodyOpeningWarningText === null) reasons.push('BODY_WARNING_REQUIRED');
    if (warnings.pinnedCommentWarningText === null) reasons.push('COMMENT_WARNING_REQUIRED');
    if (
      titleWarningMarker !== null &&
      payload.titles.some(({ text }) => !text.includes(titleWarningMarker))
    ) {
      reasons.push('TITLE_WARNING_MARKER_MISSING');
    }
  }
  return reasons;
}

function profileReasons(payload: ContentDraftPayloadV1): string[] {
  const profile = COPY_PROFILE_REGISTRY[payload.profileId];
  const kinds = new Set(payload.blocks.map(({ kind }) => kind));
  const reasons: string[] = [];
  for (const kind of profile.requiredBlockKinds) {
    if (!kinds.has(kind)) reasons.push(`PROFILE_BLOCK_REQUIRED:${kind}`);
  }
  if (profile.forbiddenBlockKinds.some((kind) => kinds.has(kind))) {
    reasons.push('PROFILE_BLOCK_FORBIDDEN');
  }
  if (payload.brief.workIds.length < profile.minimumPrimarySubjects) {
    reasons.push('PROFILE_PRIMARY_SUBJECTS_INCOMPLETE');
  }
  if (profile.symmetricComparison) {
    const comparison = payload.blocks.filter(({ kind }) => kind === 'COMPARISON');
    const covered = new Set(
      comparison.flatMap(({ lineage }) => lineage.map(({ workId }) => workId).filter(Boolean)),
    );
    if (payload.brief.workIds.some((workId) => !covered.has(workId))) {
      reasons.push('COMPARISON_NOT_SYMMETRIC');
    }
  }
  return reasons;
}

function contentReasons(payload: ContentDraftPayloadV1): string[] {
  const reasons: string[] = [];
  const selected = payload.titles.find(({ titleId }) => titleId === payload.selectedTitleId);
  if (payload.selectedTitleId === null || selected === undefined)
    reasons.push('SELECTED_TITLE_REQUIRED');
  if (selected !== undefined && selected.kind !== 'SELECTED')
    reasons.push('SELECTED_TITLE_KIND_INVALID');
  if (payload.titles.filter(({ kind }) => kind === 'SELECTED').length !== 1) {
    reasons.push('ONE_SELECTED_TITLE_REQUIRED');
  }
  if (payload.blocks.some(({ text }) => text === '待填写')) reasons.push('BODY_BLOCK_INCOMPLETE');
  if (payload.blocks.length === 0) reasons.push('BODY_REQUIRED');
  if (payload.tags.length === 0) reasons.push('TAG_SET_REQUIRED');
  if (payload.pinnedComment === null) reasons.push('PINNED_COMMENT_REQUIRED');
  const content = [
    ...payload.titles.map(({ text }) => text),
    ...payload.blocks.map(({ text }) => text),
    ...payload.tags.map(({ text }) => text),
    payload.pinnedComment?.text ?? '',
  ].join('\n');
  for (const phrase of payload.brief.systemForbiddenExpressions) {
    if (phrase.length > 0 && content.includes(phrase)) reasons.push('SYSTEM_FORBIDDEN_EXPRESSION');
  }
  if (/(?:AI\s*运营实验|攻击作者|攻击读者|模仿.{0,16}(?:作者|博主|账号))/iu.test(content)) {
    reasons.push('VOICE_FORBIDDEN_PATTERN');
  }
  return reasons;
}

export function validateDraftStructure(
  value: unknown,
  evaluatedAt = new Date().toISOString(),
): DraftStructuralValidationV1 {
  const payload = assertContentDraftPayload(value);
  const reasonCodes = Object.freeze(
    [
      ...contentReasons(payload),
      ...profileReasons(payload),
      ...spoilerReasons(payload),
      ...permissionReasons(payload),
      ...lineageReasons(payload),
    ]
      .filter((reason, index, values) => values.indexOf(reason) === index)
      .sort(),
  );
  return Object.freeze({
    evaluatedAt,
    policyVersion: COPY_STRUCTURAL_VALIDATION_VERSION,
    reasonCodes,
    valid: reasonCodes.length === 0,
  });
}

export function structuralStatus(
  source: 'MANUAL' | 'MODEL',
  validation: DraftStructuralValidationV1,
): CopyDraftStatus {
  if (!validation.valid) return 'STRUCTURE_INVALID';
  return 'READY_FOR_QUALITY_PIPELINE';
}
