import {
  BRIEF_PROFILE_REGISTRY,
  type BriefProfileId,
  type BriefProfileDefinition,
} from './constants.js';
import type { ContentBriefDraft } from './contracts.js';

export interface BriefProfileValidation {
  readonly reasonCodes: readonly string[];
  readonly valid: boolean;
}

export function getBriefProfile(profileId: BriefProfileId): BriefProfileDefinition {
  return BRIEF_PROFILE_REGISTRY[profileId];
}

export function validateBriefProfile(draft: ContentBriefDraft): BriefProfileValidation {
  const profile = getBriefProfile(draft.profileId);
  const reasons: string[] = [];
  const primaryWorks = new Set(
    draft.subjects.filter((subject) => subject.role === 'PRIMARY').map((subject) => subject.workId),
  );
  const slotIds = new Set(draft.structurePlan.slots.map((slot) => slot.slotId));
  if (primaryWorks.size < profile.minimumPrimaryWorks)
    reasons.push('PROFILE_PRIMARY_WORKS_MISSING');
  if (draft.profileId === 'NON_SPOILER_SINGLE_BOOK_VERDICT' && primaryWorks.size !== 1) {
    reasons.push('PROFILE_REQUIRES_EXACTLY_ONE_PRIMARY_WORK');
  }
  if (!profile.allowedSpoilerLevels.includes(draft.spoilerPlan.level as never)) {
    reasons.push('PROFILE_SPOILER_MISMATCH');
  }
  if (profile.requiredSlots.some((slot) => !slotIds.has(slot))) {
    reasons.push('PROFILE_REQUIRED_SLOT_MISSING');
  }
  if (profile.requiresComparisonDimension && draft.structurePlan.comparisonDimension === null) {
    reasons.push('PROFILE_COMPARISON_DIMENSION_MISSING');
  }
  if (
    draft.profileId === 'CROSS_WORK_COMPARISON' &&
    draft.structurePlan.slots
      .filter((slot) => slot.slotId === 'work-a-evidence' || slot.slotId === 'work-b-evidence')
      .some((slot) => slot.subjectIds.length !== 1)
  ) {
    reasons.push('PROFILE_COMPARISON_NOT_SYMMETRIC');
  }
  if (
    profile.requiresExpressionForms &&
    (!draft.subjects.some((subject) => subject.expressionForm === 'WEB_SERIALIZED') ||
      !draft.subjects.some((subject) => subject.expressionForm === 'PUBLISHED_EDITION'))
  ) {
    reasons.push('PROFILE_EXPRESSION_FORM_UNVERIFIED');
  }
  if (
    draft.profileId === 'MYSTERY_AND_CULTURAL_PHENOMENON' &&
    !draft.subjects.some((subject) => subject.role === 'CONTEXT')
  ) {
    reasons.push('PROFILE_TRACEABLE_CONTEXT_MISSING');
  }
  return Object.freeze({
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    valid: reasons.length === 0,
  });
}
