import {
  COPY_GENERATION_POLICY_VERSION,
  COPY_LIMITS,
  COPY_REWRITE_POLICY_VERSION,
  type CopyMutationOperation,
} from './constants.js';
import {
  assertContentDraftPayload,
  assertRewriteScope,
  type ContentDraftPayloadV1,
  type CopyMutationPlanV1,
  type CopyRewriteScopeV1,
} from './contracts.js';
import { CopyError } from './errors.js';
import { canonicalCopyJson, copySemanticHash } from './identity.js';

export interface CreateCopyMutationPlanInput {
  readonly budgetState: CopyMutationPlanV1['budgetState'];
  readonly capabilityState: CopyMutationPlanV1['capabilityState'];
  readonly draftId: string;
  readonly expectedDraftRevision: number;
  readonly expectedVersionId: string;
  readonly expiresAt: string;
  readonly operation: CopyMutationOperation;
  readonly payload: ContentDraftPayloadV1;
  readonly planId: string;
  readonly rewriteInstruction?: string | null;
  readonly rewriteScope?: CopyRewriteScopeV1 | null;
}

export function createCopyMutationPlan(input: CreateCopyMutationPlanInput): CopyMutationPlanV1 {
  const payload = assertContentDraftPayload(input.payload);
  const operation = input.operation;
  const scope =
    input.rewriteScope === undefined || input.rewriteScope === null
      ? null
      : assertRewriteScope(input.rewriteScope);
  if (
    (operation === 'FULL_GENERATION' && scope !== null) ||
    (operation === 'REWRITE' && scope === null)
  ) {
    throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
  }
  const rewriteInstruction = input.rewriteInstruction?.trim() || null;
  if (
    rewriteInstruction !== null &&
    rewriteInstruction.length > COPY_LIMITS.rewriteInstructionCharacters
  ) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  const inputHash = copySemanticHash(payload);
  const lockSnapshotHash = copySemanticHash(payload.fieldStates);
  const dependencyHash = copySemanticHash(payload.brief.dependencies);
  const previewBody = {
    briefId: payload.brief.briefId,
    briefVersionId: payload.brief.briefVersionId,
    budgetState: input.budgetState,
    capabilityState: input.capabilityState,
    dependencyHash,
    draftId: input.draftId,
    expectedDraftRevision: input.expectedDraftRevision,
    expectedVersionId: input.expectedVersionId,
    inputHash,
    lockSnapshotHash,
    operation,
    planId: input.planId,
    rewriteInstruction,
    rewriteScope: scope,
  };
  return Object.freeze({
    briefId: payload.brief.briefId,
    briefVersionId: payload.brief.briefVersionId,
    budgetState: input.budgetState,
    capabilityState: input.capabilityState,
    dependencyHash,
    draftId: input.draftId,
    expectedDraftRevision: input.expectedDraftRevision,
    expectedVersionId: input.expectedVersionId,
    expiresAt: input.expiresAt,
    inputCharacterCount: canonicalCopyJson(payload).length,
    inputHash,
    lineageRefCount:
      payload.titles.reduce((sum, item) => sum + item.lineage.length, 0) +
      payload.blocks.reduce((sum, item) => sum + item.lineage.length, 0) +
      payload.tags.reduce((sum, item) => sum + item.lineage.length, 0) +
      (payload.pinnedComment?.lineage.length ?? 0),
    lockSnapshotHash,
    lockedFieldCount: payload.fieldStates.filter(({ lock }) => lock !== 'EDITABLE').length,
    maximums: Object.freeze({
      blocks: COPY_LIMITS.blocks,
      inputCharacters: COPY_LIMITS.maxInputCharacters,
      modelRequests: 1 as const,
      outputBytes: COPY_LIMITS.maxOutputBytes,
      tags: COPY_LIMITS.tags,
      titles: COPY_LIMITS.titles,
    }),
    operation,
    planId: input.planId,
    previewHash: copySemanticHash(previewBody),
    profileId: payload.profileId,
    rewriteInstruction,
    rewriteScope: scope,
    topicId: payload.brief.topicId,
    writesNewVersionOnly: true as const,
  });
}

function fieldLocked(payload: ContentDraftPayloadV1, path: string): boolean {
  return payload.fieldStates.some(
    (state) =>
      state.lock !== 'EDITABLE' &&
      (state.path === path ||
        path.startsWith(`${state.path}.`) ||
        state.path.startsWith(`${path}.`)),
  );
}

function scopePaths(scope: CopyRewriteScopeV1): readonly string[] {
  switch (scope.kind) {
    case 'SELECTED_TITLE':
      return ['selectedTitle'];
    case 'TITLE_VARIANTS':
      return ['titleVariants'];
    case 'BODY_BLOCK':
    case 'BODY_BLOCK_RANGE':
      return scope.blockIds.map((id) => `blocks.${id}`);
    case 'TAG_SET':
      return ['tags'];
    case 'PINNED_COMMENT':
      return ['pinnedComment'];
    case 'SPOILER_WARNING_ARTIFACT':
      return [`spoilerWarnings.${scope.warningField}`];
  }
}

function assertBlockRange(payload: ContentDraftPayloadV1, scope: CopyRewriteScopeV1): void {
  if (scope.kind !== 'BODY_BLOCK' && scope.kind !== 'BODY_BLOCK_RANGE') return;
  const positions = scope.blockIds.map((id) =>
    payload.blocks.findIndex(({ blockId }) => blockId === id),
  );
  if (positions.some((position) => position < 0)) throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
  const sorted = [...positions].sort((left, right) => left - right);
  if (
    sorted.some((position, index) => {
      const previous = sorted.at(index - 1);
      return index > 0 && previous !== undefined && position !== previous + 1;
    })
  ) {
    throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
  }
}

function selectedTitle(payload: ContentDraftPayloadV1) {
  return payload.titles.find(({ titleId }) => titleId === payload.selectedTitleId);
}

export function applyScopedRewrite(
  currentValue: unknown,
  candidateValue: unknown,
  scopeValue: unknown,
): ContentDraftPayloadV1 {
  const current = assertContentDraftPayload(currentValue);
  const candidate = assertContentDraftPayload(candidateValue);
  const scope = assertRewriteScope(scopeValue);
  assertBlockRange(current, scope);
  for (const path of scopePaths(scope)) {
    if (fieldLocked(current, path)) throw new CopyError('COPY_LOCKED_FIELD');
  }
  if (
    copySemanticHash(current.brief) !== copySemanticHash(candidate.brief) ||
    current.profileId !== candidate.profileId ||
    current.contractVersion !== candidate.contractVersion ||
    current.schemaVersion !== candidate.schemaVersion ||
    current.formatPolicyVersion !== candidate.formatPolicyVersion ||
    current.profileVersion !== candidate.profileVersion ||
    current.voicePolicyVersion !== candidate.voicePolicyVersion ||
    copySemanticHash(current.fieldStates) !== copySemanticHash(candidate.fieldStates)
  ) {
    throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
  }

  let merged: ContentDraftPayloadV1;
  switch (scope.kind) {
    case 'SELECTED_TITLE': {
      const next = selectedTitle(candidate);
      if (next === undefined) throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
      merged = {
        ...current,
        selectedTitleId: next.titleId,
        titles: current.titles.map((title) =>
          title.titleId === current.selectedTitleId ? { ...next, titleId: title.titleId } : title,
        ),
      };
      break;
    }
    case 'TITLE_VARIANTS':
      merged = {
        ...current,
        titles: [
          ...current.titles.filter(({ titleId }) => titleId === current.selectedTitleId),
          ...candidate.titles.filter(({ titleId }) => titleId !== candidate.selectedTitleId),
        ],
      };
      break;
    case 'BODY_BLOCK':
    case 'BODY_BLOCK_RANGE': {
      const allowed = new Set(scope.blockIds);
      const replacements = new Map(candidate.blocks.map((block) => [block.blockId, block]));
      merged = {
        ...current,
        blocks: current.blocks.map((block) =>
          allowed.has(block.blockId) ? (replacements.get(block.blockId) ?? block) : block,
        ),
      };
      break;
    }
    case 'TAG_SET':
      merged = { ...current, tags: candidate.tags };
      break;
    case 'PINNED_COMMENT':
      merged = { ...current, pinnedComment: candidate.pinnedComment };
      break;
    case 'SPOILER_WARNING_ARTIFACT': {
      const field = scope.warningField;
      if (field === null) throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
      merged = {
        ...current,
        spoilerWarnings: {
          ...current.spoilerWarnings,
          [field]: candidate.spoilerWarnings[field],
          provenance: candidate.spoilerWarnings.provenance,
        },
      };
      break;
    }
  }
  const result = assertContentDraftPayload(merged);
  const outside = (payload: ContentDraftPayloadV1) => {
    switch (scope.kind) {
      case 'SELECTED_TITLE':
        return {
          ...payload,
          selectedTitleId: null,
          titles: payload.titles.map((title) =>
            title.titleId === payload.selectedTitleId ? { ...title, text: '' } : title,
          ),
        };
      case 'TITLE_VARIANTS':
        return {
          ...payload,
          titles: payload.titles.filter(({ titleId }) => titleId === payload.selectedTitleId),
        };
      case 'BODY_BLOCK':
      case 'BODY_BLOCK_RANGE':
        return {
          ...payload,
          blocks: payload.blocks.filter(({ blockId }) => !scope.blockIds.includes(blockId)),
        };
      case 'TAG_SET':
        return { ...payload, tags: [] };
      case 'PINNED_COMMENT':
        return { ...payload, pinnedComment: null };
      case 'SPOILER_WARNING_ARTIFACT':
        if (scope.warningField === null) throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
        return {
          ...payload,
          spoilerWarnings: {
            ...payload.spoilerWarnings,
            [scope.warningField]: null,
            provenance: 'SYSTEM_DERIVED' as const,
          },
        };
    }
  };
  if (copySemanticHash(outside(current)) !== copySemanticHash(outside(result))) {
    throw new CopyError('COPY_INVALID_REWRITE_SCOPE');
  }
  return result;
}

export const COPY_MUTATION_POLICIES = Object.freeze({
  generation: Object.freeze({
    automaticFallback: false,
    automaticRepair: false,
    automaticRetry: false,
    maximumModelRequests: 1,
    policyVersion: COPY_GENERATION_POLICY_VERSION,
  }),
  rewrite: Object.freeze({
    automaticFallback: false,
    automaticRepair: false,
    automaticRetry: false,
    maximumModelRequests: 1,
    outsideScopeMustRemainIdentical: true,
    policyVersion: COPY_REWRITE_POLICY_VERSION,
  }),
});
