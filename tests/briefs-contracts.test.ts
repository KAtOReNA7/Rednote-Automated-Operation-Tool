import { describe, expect, it } from 'vitest';

import {
  BRIEF_AUDIENCE_KNOWLEDGE_LEVELS,
  BRIEF_PROFILE_IDS,
  BRIEF_READINESS_STATUSES,
  BRIEF_SCORE_KINDS,
  assertBriefModelCandidate,
  assertContentBriefDraft,
} from '../packages/briefs/src/index.js';
import { briefScaffoldInput, modelCandidate, readyBriefDraft } from './support/brief-fixtures.js';

describe('M3 Issue 024 Content Brief contracts', () => {
  it('freezes five profiles, nine readiness states, and three public score origins', () => {
    expect(BRIEF_PROFILE_IDS).toEqual([
      'NON_SPOILER_SINGLE_BOOK_VERDICT',
      'FULL_TRICK_LOGIC_ANALYSIS',
      'CROSS_WORK_COMPARISON',
      'WEB_VS_PUBLISHED_MYSTERY',
      'MYSTERY_AND_CULTURAL_PHENOMENON',
    ]);
    expect(BRIEF_READINESS_STATUSES).toHaveLength(9);
    expect(BRIEF_SCORE_KINDS).toEqual(['NONE', 'PERSONAL_SCORE', 'RESEARCH_ANALYSIS_SCORE']);
    expect(JSON.stringify({ BRIEF_SCORE_KINDS })).not.toContain('INTERNAL_PREDICTION');
  });

  it('keeps one authoritative audience knowledge-level set and rejects unknown values', () => {
    expect(BRIEF_AUDIENCE_KNOWLEDGE_LEVELS).toEqual(['NEW_TO_WORK', 'FAMILIAR_WITH_WORK', 'MIXED']);
    const draft = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(
      assertContentBriefDraft({
        ...draft,
        targetAudience: { ...draft.targetAudience, knowledgeLevel: 'FAMILIAR_WITH_WORK' },
      }).targetAudience.knowledgeLevel,
    ).toBe('FAMILIAR_WITH_WORK');
    expect(() =>
      assertContentBriefDraft({
        ...draft,
        targetAudience: { ...draft.targetAudience, knowledgeLevel: 'EXPERT' },
      }),
    ).toThrow(/BRIEF_INVALID_CONTRACT/iu);
  });

  it('rejects unknown DTO fields and references outside the evidence allowlist', () => {
    const draft = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(() => assertContentBriefDraft({ ...draft, title: '不得进入 Brief' })).toThrow(
      /BRIEF_INVALID_CONTRACT/iu,
    );
    expect(() =>
      assertBriefModelCandidate(
        {
          ...modelCandidate(draft),
          citedEvidenceRefIds: ['outside-allowlist'],
        },
        [],
      ),
    ).toThrow(/BRIEF_INVALID_EVIDENCE/iu);
  });

  it('rejects title, body, tag, image and result fields in strict model output', () => {
    const draft = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    for (const field of ['title', 'body', 'tags', 'imagePrompt', 'winner', 'effect']) {
      expect(() =>
        assertBriefModelCandidate({ ...modelCandidate(draft), [field]: 'forbidden' }, []),
      ).toThrow(/BRIEF_INVALID_CONTRACT/iu);
    }
  });

  it('keeps scaffold inputs free of generated prose fields', () => {
    const input = briefScaffoldInput('FULL_TRICK_LOGIC_ANALYSIS');
    expect(Object.keys(input)).not.toEqual(
      expect.arrayContaining(['title', 'body', 'tags', 'imagePrompt']),
    );
  });

  it('keeps every frozen system expression while allowing bounded user rules', () => {
    const draft = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(() =>
      assertContentBriefDraft({
        ...draft,
        forbiddenExpressions: draft.forbiddenExpressions.slice(1),
      }),
    ).toThrow(/BRIEF_INVALID_CONTRACT/iu);
    expect(
      assertContentBriefDraft({
        ...draft,
        forbiddenExpressions: [
          ...draft.forbiddenExpressions,
          {
            category: 'USER_CUSTOM',
            expressionId: 'user:no-empty-hook',
            phrase: '不要使用空洞钩子',
            policyVersion: 'user-custom-v1',
            reason: '用户明确的账号风格偏好',
            system: false,
          },
        ],
      }).forbiddenExpressions,
    ).toHaveLength(draft.forbiddenExpressions.length + 1);
  });
});
