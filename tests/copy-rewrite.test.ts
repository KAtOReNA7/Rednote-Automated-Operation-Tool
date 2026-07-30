import { describe, expect, it } from 'vitest';

import {
  applyScopedRewrite,
  copySemanticHash,
  createCopyMutationPlan,
} from '../packages/copy/src/index.js';
import { completeCopyPayload, requiredFixtureValue } from './support/copy-fixtures.js';

describe('M3 Issue 025 bounded local rewrite', () => {
  it.each([
    'SELECTED_TITLE',
    'TITLE_VARIANTS',
    'TAG_SET',
    'PINNED_COMMENT',
    'SPOILER_WARNING_ARTIFACT',
  ] as const)('changes only %s scope while outside values remain identical', (kind) => {
    const current = completeCopyPayload(
      kind === 'SPOILER_WARNING_ARTIFACT'
        ? 'FULL_TRICK_LOGIC_ANALYSIS'
        : 'NON_SPOILER_SINGLE_BOOK_VERDICT',
    );
    const candidate = {
      ...current,
      selectedTitleId: current.selectedTitleId,
      titles: current.titles.map((title, index) =>
        index === 0 ? { ...title, text: `${title.text} · 重写` } : title,
      ),
      tags: current.tags.map((tag, index) =>
        index === 0 ? { ...tag, text: '局部重写标签' } : tag,
      ),
      pinnedComment:
        current.pinnedComment === null
          ? null
          : { ...current.pinnedComment, text: '局部重写后的置顶评论。' },
      spoilerWarnings: {
        ...current.spoilerWarnings,
        bodyOpeningWarningText: '完整剧透：这是局部重写的正文开头警告。',
      },
    };
    const scope =
      kind === 'SPOILER_WARNING_ARTIFACT'
        ? { blockIds: [], kind, warningField: 'bodyOpeningWarningText' as const }
        : { blockIds: [], kind, warningField: null };
    const result = applyScopedRewrite(current, candidate, scope);
    expect(result.brief).toEqual(current.brief);
    expect(result.fieldStates).toEqual(current.fieldStates);
    if (kind !== 'TAG_SET') expect(result.tags).toEqual(current.tags);
    if (kind !== 'PINNED_COMMENT') expect(result.pinnedComment).toEqual(current.pinnedComment);
    if (kind !== 'SPOILER_WARNING_ARTIFACT') {
      expect(result.spoilerWarnings).toEqual(current.spoilerWarnings);
    }
  });

  it('rewrites one body block and keeps every other stable block unchanged', () => {
    const current = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const target = requiredFixtureValue(current.blocks.at(1), 'rewrite target block');
    const candidate = {
      ...current,
      blocks: current.blocks.map((block) =>
        block.blockId === target.blockId ? { ...block, text: '只重写这一段。' } : block,
      ),
    };
    const result = applyScopedRewrite(current, candidate, {
      blockIds: [target.blockId],
      kind: 'BODY_BLOCK',
      warningField: null,
    });
    expect(result.blocks.find(({ blockId }) => blockId === target.blockId)?.text).toBe(
      '只重写这一段。',
    );
    expect(result.blocks.filter(({ blockId }) => blockId !== target.blockId)).toEqual(
      current.blocks.filter(({ blockId }) => blockId !== target.blockId),
    );
  });

  it('rejects locked scope, discontiguous ranges and policy changes', () => {
    const current = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const locked = {
      ...current,
      fieldStates: current.fieldStates.map((field) =>
        field.path === 'tags' ? { ...field, lock: 'USER_LOCKED' as const } : field,
      ),
    };
    expect(() =>
      applyScopedRewrite(
        locked,
        { ...locked, tags: [] },
        {
          blockIds: [],
          kind: 'TAG_SET',
          warningField: null,
        },
      ),
    ).toThrow(/COPY_LOCKED_FIELD/u);
    expect(() =>
      applyScopedRewrite(current, current, {
        blockIds: [
          requiredFixtureValue(current.blocks.at(0), 'first block').blockId,
          requiredFixtureValue(current.blocks.at(2), 'third block').blockId,
        ],
        kind: 'BODY_BLOCK_RANGE',
        warningField: null,
      }),
    ).toThrow(/COPY_INVALID_REWRITE_SCOPE/u);
    expect(() =>
      applyScopedRewrite(
        current,
        { ...current, profileId: 'FULL_TRICK_LOGIC_ANALYSIS' },
        { blockIds: [], kind: 'TAG_SET', warningField: null },
      ),
    ).toThrow();
  });

  it('binds preview to revision, input, dependency, lock and scope hashes', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const plan = createCopyMutationPlan({
      budgetState: 'AVAILABLE',
      capabilityState: 'SUPPORTED',
      draftId: 'draft-1',
      expectedDraftRevision: 4,
      expectedVersionId: 'version-4',
      expiresAt: '2026-07-30T14:05:00.000Z',
      operation: 'REWRITE',
      payload,
      planId: 'plan-1',
      rewriteInstruction: '让标题更直接，但不要改变判断。',
      rewriteScope: { blockIds: [], kind: 'SELECTED_TITLE', warningField: null },
    });
    expect(plan).toMatchObject({
      expectedDraftRevision: 4,
      inputHash: copySemanticHash(payload),
      maximums: { modelRequests: 1 },
      operation: 'REWRITE',
      writesNewVersionOnly: true,
    });
    expect(plan.previewHash).toHaveLength(64);
  });
});
