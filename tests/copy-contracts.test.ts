import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_VOICE_POLICY,
  COPY_CONTRACT_BOUNDARY,
  COPY_DRAFT_STATUSES,
  COPY_PROFILE_REGISTRY,
  assertContentDraftPayload,
  validateDraftStructure,
} from '../packages/copy/src/index.js';
import { completeCopyPayload, requiredFixtureValue } from './support/copy-fixtures.js';

const PROFILES = [
  'NON_SPOILER_SINGLE_BOOK_VERDICT',
  'FULL_TRICK_LOGIC_ANALYSIS',
  'CROSS_WORK_COMPARISON',
  'WEB_VS_PUBLISHED_MYSTERY',
  'MYSTERY_AND_CULTURAL_PHENOMENON',
] as const;

describe('M3 Issue 025 versioned copy contracts', () => {
  it.each(PROFILES)(
    'validates complete %s copy with titles, blocks, tags and comment',
    (profile) => {
      const payload = completeCopyPayload(profile);
      expect(assertContentDraftPayload(payload)).toEqual(payload);
      expect(validateDraftStructure(payload, '2026-07-30T14:00:00.000Z')).toMatchObject({
        reasonCodes: [],
        valid: true,
      });
      expect(payload.titles.some(({ kind }) => kind === 'SELECTED')).toBe(true);
      expect(payload.blocks.length).toBeGreaterThanOrEqual(
        COPY_PROFILE_REGISTRY[profile].requiredBlockKinds.length,
      );
      expect(payload.tags.length).toBeGreaterThan(0);
      expect(payload.pinnedComment).not.toBeNull();
    },
  );

  it('freezes five synthetic gold Draft and normalized child counts', () => {
    const payloads = PROFILES.map(completeCopyPayload);
    expect(
      payloads.map((payload) => ({
        profileId: payload.profileId,
        status: validateDraftStructure(payload).valid
          ? 'READY_FOR_QUALITY_PIPELINE'
          : 'STRUCTURE_INVALID',
      })),
    ).toEqual(
      PROFILES.map((profileId) => ({
        profileId,
        status: 'READY_FOR_QUALITY_PIPELINE',
      })),
    );
    expect({
      blocks: payloads.reduce((sum, payload) => sum + payload.blocks.length, 0),
      dependencies: payloads.reduce((sum, payload) => sum + payload.brief.dependencies.length, 0),
      fieldLocks: payloads.reduce(
        (sum, payload) =>
          sum + payload.fieldStates.filter(({ lock }) => lock !== 'EDITABLE').length,
        0,
      ),
      fieldStates: payloads.reduce((sum, payload) => sum + payload.fieldStates.length, 0),
      lineageRefs: payloads.reduce(
        (sum, payload) =>
          sum +
          payload.blocks.reduce((count, block) => count + block.lineage.length, 0) +
          payload.titles.reduce((count, title) => count + title.lineage.length, 0) +
          payload.tags.reduce((count, tag) => count + tag.lineage.length, 0) +
          (payload.pinnedComment?.lineage.length ?? 0),
        0,
      ),
      versions: payloads.length,
    }).toEqual({
      blocks: 28,
      dependencies: 10,
      fieldLocks: 85,
      fieldStates: 128,
      lineageRefs: 55,
      versions: 5,
    });
  });

  it('requires all actual spoiler warning text artifacts for full analysis', () => {
    const payload = completeCopyPayload('FULL_TRICK_LOGIC_ANALYSIS');
    expect(payload.spoilerWarnings).toMatchObject({
      bodyOpeningWarningText: expect.stringContaining('完整剧透'),
      coverWarningText: expect.stringContaining('完整剧透'),
      pinnedCommentWarningText: expect.stringContaining('完整剧透'),
      titleWarningMarker: '【完整剧透】',
    });
    expect(
      validateDraftStructure(
        {
          ...payload,
          spoilerWarnings: { ...payload.spoilerWarnings, coverWarningText: null },
        },
        '2026-07-30T14:00:00.000Z',
      ).reasonCodes,
    ).toContain('COVER_WARNING_REQUIRED');
  });

  it('keeps non-spoiler output free of warning artifacts and answer slots', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(Object.values(payload.spoilerWarnings).filter(Boolean)).toEqual(['SYSTEM_DERIVED']);
    expect(payload.blocks.map(({ kind }) => kind)).not.toContain('WARNING');
    expect(JSON.stringify(payload)).not.toMatch(/谜底是|凶手是/u);
  });

  it('freezes account voice and exposes only the exact candidate fields', () => {
    expect(ACCOUNT_VOICE_POLICY.requiredTraits).toEqual([
      'OPINIONATED',
      'SHORT_DIRECT_SENTENCES',
      'LIGHT_DRY_HUMOR',
    ]);
    expect(ACCOUNT_VOICE_POLICY.forbiddenTraits).toEqual(
      expect.arrayContaining([
        'AI_OPERATION_EXPERIMENT',
        'AUTHOR_OR_READER_ATTACK',
        'LIVING_AUTHOR_STYLE_IMITATION',
      ]),
    );
    expect(COPY_CONTRACT_BOUNDARY.allowedOutputFields).toEqual([
      'blocks',
      'pinnedComment',
      'selectedTitleId',
      'spoilerWarnings',
      'tags',
      'titles',
    ]);
    expect(COPY_DRAFT_STATUSES).not.toEqual(
      expect.arrayContaining(['APPROVED', 'PUBLISHABLE', 'QUALITY_PASSED']),
    );
  });

  it('rejects exact-schema expansion, duplicate normalized tags and invented lineage ids', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(() => assertContentDraftPayload({ ...payload, imagePrompt: 'forbidden' })).toThrow(
      /COPY_INVALID_CONTRACT/u,
    );
    const firstTag = requiredFixtureValue(payload.tags.at(0), 'first tag');
    expect(() =>
      assertContentDraftPayload({
        ...payload,
        tags: [firstTag, { ...firstTag, tagId: 'duplicate', text: '#推理小说' }],
      }),
    ).toThrow(/COPY_INVALID_CONTRACT/u);
    const invented = {
      ...payload,
      blocks: payload.blocks.map((block, index) =>
        index === 0
          ? {
              ...block,
              lineage: [
                {
                  ...requiredFixtureValue(block.lineage.at(0), 'first block lineage'),
                  evidenceRefIds: ['invented-evidence-id'],
                },
              ],
            }
          : block,
      ),
    };
    expect(validateDraftStructure(invented).reasonCodes).toContain('LINEAGE_EVIDENCE_NOT_ALLOWED');
  });
});
