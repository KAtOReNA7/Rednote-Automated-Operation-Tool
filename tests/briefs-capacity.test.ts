import { describe, expect, it } from 'vitest';

import {
  BRIEF_LIMITS,
  assertContentBriefDraft,
  buildLocalBriefScaffold,
  canonicalBriefJson,
  createBriefGenerationPlan,
} from '../packages/briefs/src/index.js';
import { briefScaffoldInput, readyBriefDraft } from './support/brief-fixtures.js';

describe('M3 Issue 024 Brief capacity boundaries', () => {
  it('rejects evidence, argument and open-question collections beyond the frozen bounds', () => {
    const draft = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(() =>
      assertContentBriefDraft({
        ...draft,
        supportingArguments: Array.from({ length: BRIEF_LIMITS.arguments + 1 }, (_, index) => ({
          ...draft.supportingArguments[0],
          argumentId: `argument-${index}`,
        })),
      }),
    ).toThrow(/BRIEF_INVALID_CONTRACT/iu);
    expect(() =>
      assertContentBriefDraft({
        ...draft,
        openQuestionsAndLimitations: Array.from(
          { length: BRIEF_LIMITS.openQuestions + 1 },
          (_, index) => `问题 ${index}`,
        ),
      }),
    ).toThrow(/BRIEF_INVALID_CONTRACT/iu);
  });

  it('rejects oversized semantic input before any generation plan can exist', () => {
    const draft = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const oversized = {
      ...draft,
      targetAudience: {
        ...draft.targetAudience,
        readerDescription: '合'.repeat(BRIEF_LIMITS.textBytes + 1),
      },
    };
    expect(() => assertContentBriefDraft(oversized)).toThrow(/BRIEF_INVALID_CONTRACT/iu);
  });

  it('reports bounded deterministic generation counts and one request maximum', () => {
    const draft = readyBriefDraft('CROSS_WORK_COMPARISON');
    const plan = createBriefGenerationPlan({
      briefId: 'brief-capacity',
      budgetState: 'AVAILABLE',
      capabilityState: 'SUPPORTED',
      dependencyHash: 'd'.repeat(64),
      draft,
      expectedBriefRevision: 3,
      expectedVersionId: 'version-capacity',
      expiresAt: '2026-07-30T13:35:00.000Z',
      planId: 'plan-capacity',
    });
    expect(plan.maximumModelRequests).toBe(1);
    expect(plan.maximumInputCharacters).toBe(BRIEF_LIMITS.maxInputCharacters);
    expect(plan.inputCharacterCount).toBeLessThanOrEqual(BRIEF_LIMITS.maxInputCharacters);
    expect(plan.subjectIds).toHaveLength(2);
    expect(plan.inputHash).toHaveLength(64);
  });

  it('keeps canonical scaffold serialization bounded and deterministic', () => {
    const first = buildLocalBriefScaffold(briefScaffoldInput('WEB_VS_PUBLISHED_MYSTERY'));
    const second = buildLocalBriefScaffold(briefScaffoldInput('WEB_VS_PUBLISHED_MYSTERY'));
    expect(canonicalBriefJson(first)).toBe(canonicalBriefJson(second));
    expect(canonicalBriefJson(first).length).toBeLessThan(BRIEF_LIMITS.maxInputCharacters);
  });
});
