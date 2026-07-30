import { describe, expect, it } from 'vitest';

import {
  assertContentBriefDraft,
  buildLocalBriefScaffold,
  evaluateBriefReadiness,
} from '../packages/briefs/src/index.js';
import {
  briefScaffoldInput,
  readyBriefContext,
  readyBriefDraft,
} from './support/brief-fixtures.js';

describe('M3 Issue 024 authenticity, score, and spoiler gold cases', () => {
  it('allows personal first person only for R1 and isolates personal score origin', () => {
    const scaffold = buildLocalBriefScaffold({
      ...briefScaffoldInput('NON_SPOILER_SINGLE_BOOK_VERDICT'),
      expressionMode: 'PERSONAL_EXPERIENCE',
      readingState: 'R1',
      requiredPublicLabels: [],
      scoreKind: 'PERSONAL_SCORE',
      scoreValueSourceId: 'personal-score-revision-1',
    });
    expect(scaffold.expressionPolicy.firstPersonAllowed).toBe(true);
    expect(scaffold.scorePlan).toMatchObject({
      kind: 'PERSONAL_SCORE',
      publicLabel: null,
      valueSourceId: 'personal-score-revision-1',
    });
  });

  it('requires current exact assertion allowlist for R2 and blocks fabricated first person', () => {
    const base = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const r2 = assertContentBriefDraft({
      ...base,
      expressionPolicy: {
        ...base.expressionPolicy,
        allowedAssertionIds: [],
        firstPersonAllowed: false,
        mode: 'PERSONAL_EXPERIENCE',
        r2AssertionIds: ['assertion-current-1'],
        readingState: 'R2',
        requiredPublicLabels: [],
      },
    });
    expect(evaluateBriefReadiness(r2, readyBriefContext()).status).toBe('AUTHENTICITY_BLOCKED');
  });

  it.each(['R3', 'S1', 'S2', 'UNCLASSIFIED'] as const)(
    '%s cannot grant concrete first-person permission',
    (readingState) => {
      const base = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
      const invalid = assertContentBriefDraft({
        ...base,
        expressionPolicy: {
          ...base.expressionPolicy,
          firstPersonAllowed: true,
          mode: 'PERSONAL_EXPERIENCE',
          readingState,
          requiredPublicLabels: [],
        },
      });
      expect(evaluateBriefReadiness(invalid, readyBriefContext()).status).toBe(
        'AUTHENTICITY_BLOCKED',
      );
    },
  );

  it('marks public research and research-analysis scores with explicit labels', () => {
    const draft = buildLocalBriefScaffold({
      ...briefScaffoldInput('NON_SPOILER_SINGLE_BOOK_VERDICT'),
      scoreKind: 'RESEARCH_ANALYSIS_SCORE',
      scoreValueSourceId: 'research-score-revision-1',
    });
    expect(draft.expressionPolicy).toMatchObject({
      firstPersonAllowed: false,
      mode: 'PUBLIC_RESEARCH_ANALYSIS',
    });
    expect(draft.expressionPolicy.requiredPublicLabels).toContain('公开资料整理');
    expect(draft.scorePlan).toMatchObject({
      kind: 'RESEARCH_ANALYSIS_SCORE',
      publicLabel: '资料分析评分',
      publicLabelRequired: true,
    });
  });
});
