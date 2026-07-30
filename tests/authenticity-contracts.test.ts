import { describe, expect, it } from 'vitest';

import {
  EXPERIENCE_ASSERTION_KINDS,
  MEMORY_CONFIDENCES,
  READING_STATES,
  SCORE_ORIGINS,
  SPOILER_LEVELS,
  AuthenticityConfirmationBroker,
  AuthenticityError,
  assertBatchReadingStateDraft,
  assertExperienceAssertionDraft,
  assertExpressionPermissionInput,
  assertReadingStateChangeDraft,
  assertScoreRecordDraft,
  assertSpoilerPreferenceDraft,
  assertStateConfidenceCombination,
  authenticitySemanticHash,
} from '../packages/authenticity/src/index.js';

const baseStateDraft = {
  confirmationKind: 'USER_EXPLICIT',
  expectedRevision: 0,
  finishedAt: null,
  finishedAtPrecision: 'UNKNOWN',
  lastReadAt: null,
  lastReadAtPrecision: 'UNKNOWN',
  memoryConfidence: 'CLEAR',
  nextState: 'R1_READ_CLEAR',
  profileId: 'primary',
  provenance: 'USER_UI',
  subject: { editionId: null, expressionId: null, workId: 'work-1' },
  userNote: null,
} as const;

describe('Issue 021 authenticity contracts', () => {
  it('freezes six states, five confidence levels, six assertion kinds and three score origins', () => {
    expect(READING_STATES).toEqual([
      'R1_READ_CLEAR',
      'R2_READ_FUZZY',
      'R3_READ_UNCONFIRMED_DETAILS',
      'S1_RESEARCH_ONLY',
      'S2_RESEARCH_INSUFFICIENT',
      'UNCLASSIFIED',
    ]);
    expect(MEMORY_CONFIDENCES).toHaveLength(5);
    expect(EXPERIENCE_ASSERTION_KINDS).toHaveLength(6);
    expect(SCORE_ORIGINS).toEqual([
      'PERSONAL_SCORE',
      'RESEARCH_ANALYSIS_SCORE',
      'SYSTEM_PREDICTION_INTERNAL',
    ]);
    expect(SPOILER_LEVELS).toEqual(['NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS']);
  });

  it.each([
    ['R1_READ_CLEAR', 'CLEAR'],
    ['R2_READ_FUZZY', 'PARTIAL'],
    ['R2_READ_FUZZY', 'FADED'],
    ['R3_READ_UNCONFIRMED_DETAILS', 'FADED'],
    ['R3_READ_UNCONFIRMED_DETAILS', 'UNKNOWN'],
    ['S1_RESEARCH_ONLY', 'NOT_APPLICABLE'],
    ['S2_RESEARCH_INSUFFICIENT', 'NOT_APPLICABLE'],
    ['UNCLASSIFIED', 'UNKNOWN'],
  ] as const)('accepts the legal %s/%s combination', (state, confidence) => {
    expect(() => assertStateConfidenceCombination(state, confidence)).not.toThrow();
  });

  it.each([
    ['R1_READ_CLEAR', 'UNKNOWN'],
    ['R2_READ_FUZZY', 'CLEAR'],
    ['R3_READ_UNCONFIRMED_DETAILS', 'PARTIAL'],
    ['S1_RESEARCH_ONLY', 'UNKNOWN'],
    ['UNCLASSIFIED', 'NOT_APPLICABLE'],
  ] as const)('rejects the illegal %s/%s combination', (state, confidence) => {
    expect(() => assertStateConfidenceCombination(state, confidence)).toThrow(AuthenticityError);
  });

  it('validates exact state, assertion, score, spoiler and bounded batch objects', () => {
    expect(assertReadingStateChangeDraft(baseStateDraft)).toEqual(baseStateDraft);
    expect(
      assertExperienceAssertionDraft({
        assertionId: null,
        assertionKind: 'READING_IMPRESSION',
        confirmationScope: 'EXACT_STATEMENT',
        expectedAssertionRevision: 0,
        expectedReadingRevision: 1,
        profileId: 'primary',
        statement: '我明确记得阅读时的压迫感。',
        workId: 'work-1',
      }),
    ).toMatchObject({ assertionKind: 'READING_IMPRESSION' });
    expect(
      assertScoreRecordDraft({
        expectedReadingRevision: 1,
        expectedRevision: 0,
        origin: 'PERSONAL_SCORE',
        profileId: 'primary',
        scoreBasisPoints: 8750,
        workId: 'work-1',
      }),
    ).toMatchObject({ scoreBasisPoints: 8750 });
    expect(
      assertSpoilerPreferenceDraft({
        expectedRevision: 1,
        level: 'FULL_TRICK_ANALYSIS',
        profileId: 'primary',
        userConfirmed: true,
        warningIncluded: true,
        workId: 'work-1',
      }),
    ).toMatchObject({ level: 'FULL_TRICK_ANALYSIS' });
    expect(
      assertBatchReadingStateDraft({
        confirmationKind: 'USER_BATCH_EXPLICIT',
        items: [
          { expectedRevision: 0, workId: 'work-1' },
          { expectedRevision: 2, workId: 'work-2' },
        ],
        memoryConfidence: 'NOT_APPLICABLE',
        nextState: 'S1_RESEARCH_ONLY',
        profileId: 'primary',
        provenance: 'USER_UI',
      }).items,
    ).toHaveLength(2);
  });

  it('rejects extra AI, copyright, relationship and inference fields', () => {
    for (const field of [
      'aiDisclosure',
      'copyrightRisk',
      'publicationRelationship',
      'purchaseRecord',
      'modelInferredRead',
    ]) {
      expect(() => assertReadingStateChangeDraft({ ...baseStateDraft, [field]: false })).toThrow(
        AuthenticityError,
      );
    }
    expect(() =>
      assertExpressionPermissionInput({
        assertions: [],
        dossier: null,
        memoryConfidence: 'UNKNOWN',
        profileId: 'primary',
        readingState: 'UNCLASSIFIED',
        readingStateRevisionId: 'revision-1',
        spoilerSelection: {
          level: 'NO_SPOILER',
          userConfirmed: false,
          warningIncluded: false,
        },
        systemPrediction: 9000,
        workId: 'work-1',
      }),
    ).toThrow(AuthenticityError);
  });

  it('accepts precise year, month and day dates and rejects impossible calendar values', () => {
    expect(
      assertReadingStateChangeDraft({
        ...baseStateDraft,
        finishedAt: '2024',
        finishedAtPrecision: 'YEAR',
        lastReadAt: '2024-02-29',
        lastReadAtPrecision: 'DAY',
      }),
    ).toMatchObject({
      finishedAt: '2024',
      finishedAtPrecision: 'YEAR',
      lastReadAt: '2024-02-29',
      lastReadAtPrecision: 'DAY',
    });
    expect(() =>
      assertReadingStateChangeDraft({
        ...baseStateDraft,
        finishedAt: '2026-07',
        finishedAtPrecision: 'MONTH',
      }),
    ).not.toThrow();
    for (const invalidDate of ['0000', '2026-13', '2025-02-29', '2026-04-31']) {
      expect(() =>
        assertReadingStateChangeDraft({
          ...baseStateDraft,
          finishedAt: invalidDate,
          finishedAtPrecision:
            invalidDate.length === 4 ? 'YEAR' : invalidDate.length === 7 ? 'MONTH' : 'DAY',
        }),
      ).toThrow(AuthenticityError);
    }
  });

  it('keeps unknown scores null and rejects floating-point or out-of-range values', () => {
    const base = {
      expectedReadingRevision: 1,
      expectedRevision: 0,
      origin: 'RESEARCH_ANALYSIS_SCORE',
      profileId: 'primary',
      workId: 'work-1',
    } as const;
    expect(assertScoreRecordDraft({ ...base, scoreBasisPoints: null }).scoreBasisPoints).toBeNull();
    expect(() => assertScoreRecordDraft({ ...base, scoreBasisPoints: 87.5 })).toThrow();
    expect(() => assertScoreRecordDraft({ ...base, scoreBasisPoints: 10_001 })).toThrow();
    expect(() =>
      assertScoreRecordDraft({
        ...base,
        origin: 'SYSTEM_PREDICTION_INTERNAL',
        scoreBasisPoints: 8000,
      }),
    ).toThrow();
  });

  it('binds single-use confirmation tokens to sender, window and exact preview hash', () => {
    const broker = new AuthenticityConfirmationBroker(
      () => new Date('2026-07-30T01:00:00.000Z'),
      60_000,
    );
    const preview = broker.issue(baseStateDraft, 7, 9);
    expect(preview.previewHash).toBe(authenticitySemanticHash(baseStateDraft));
    expect(() => broker.consume(preview.token, preview.previewHash, 8, 9)).toThrow(
      /AUTHENTICITY_CONFIRMATION_INVALID/u,
    );
    const second = broker.issue(baseStateDraft, 7, 9);
    expect(broker.consume(second.token, second.previewHash, 7, 9)).toEqual(baseStateDraft);
    expect(() => broker.consume(second.token, second.previewHash, 7, 9)).toThrow();
  });
});
