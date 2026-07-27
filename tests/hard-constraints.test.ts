import { describe, expect, it } from 'vitest';

import {
  ApprovalTier,
  ContentStatus,
  QUALITY_CHECK_TYPES,
  QualityCheckOutcome,
  QualityCheckType,
  SpoilerLevel,
  applyQualityChecks,
  createPostPackage,
  evaluateContentDecision,
} from '../packages/core/src/index.js';
import type { ContentDecisionInput, QualityCheckResult } from '../packages/core/src/index.js';

const passingChecks: readonly QualityCheckResult[] = QUALITY_CHECK_TYPES.map((type) => ({
  outcome: QualityCheckOutcome.PASS,
  type,
}));

function createDecisionInput(overrides: Partial<ContentDecisionInput> = {}): ContentDecisionInput {
  return {
    aiParticipation: {
      generatedFraction: 0,
      modelRunCount: 0,
    },
    approvalTier: ApprovalTier.FAST,
    assetSource: {
      origin: 'user-photo',
      sourceId: 'source-1',
    },
    baseScore: 82,
    plannedPublishAt: '2026-08-01T09:00:00+08:00',
    qualityChecks: passingChecks,
    spoilerLevel: SpoilerLevel.NONE,
    spoilerWarnings: {
      bodyOpening: false,
      cover: false,
      title: false,
    },
    status: ContentStatus.EXPORT_READY,
    ...overrides,
  };
}

describe('AI disclosure invariant', () => {
  it('creates every post package with aiDisclosure fixed to false', () => {
    const postPackage = createPostPackage({
      draftId: 'draft-1',
      id: 'package-1',
      plannedPublishAt: null,
    });

    expect(postPackage.aiDisclosure).toBe(false);
  });

  it('keeps aiDisclosure false after any quality check result', () => {
    const postPackage = createPostPackage({
      draftId: 'draft-1',
      id: 'package-1',
      plannedPublishAt: null,
    });
    const mixedChecks = QUALITY_CHECK_TYPES.map((type, index) => ({
      outcome: index % 2 === 0 ? QualityCheckOutcome.PASS : QualityCheckOutcome.FAIL,
      type,
    }));

    expect(applyQualityChecks(postPackage, mixedChecks).aiDisclosure).toBe(false);
  });

  it('does not let AI participation change score, approval, schedule, state, or export', () => {
    const noAi = evaluateContentDecision(createDecisionInput());
    const extensiveAi = evaluateContentDecision(
      createDecisionInput({
        aiParticipation: {
          generatedFraction: 1,
          modelRunCount: 999,
        },
      }),
    );

    expect(extensiveAi).toEqual(noAi);
  });
});

describe('source metadata is not a publishing gate', () => {
  it('does not let source changes alter status, score, priority, schedule, or export', () => {
    const userPhoto = evaluateContentDecision(createDecisionInput());
    const officialCover = evaluateContentDecision(
      createDecisionInput({
        assetSource: {
          origin: 'official-cover',
          sourceId: 'source-2',
        },
      }),
    );
    const authorPhoto = evaluateContentDecision(
      createDecisionInput({
        assetSource: {
          origin: 'author-photo',
          sourceId: null,
        },
      }),
    );

    expect(officialCover).toEqual(userPhoto);
    expect(authorPhoto).toEqual(userPhoto);
  });

  it('exposes only the approved quality check types', () => {
    expect(Object.values(QualityCheckType)).toEqual([
      'FACT_MAPPING',
      'INTERNAL_CONSISTENCY',
      'READING_AUTHENTICITY',
      'SPOILER',
      'DUPLICATION',
      'TITLE_BODY_CONSISTENCY',
      'IMAGE_TECHNICAL',
      'STRUCTURED_OUTPUT',
    ]);

    for (const checkType of Object.values(QualityCheckType)) {
      expect(checkType).not.toMatch(/AI_DISCLOSURE|COPYRIGHT/u);
    }
  });

  it('does not add source-risk output to the decision contract', () => {
    expect(Object.keys(evaluateContentDecision(createDecisionInput())).sort()).toEqual([
      'approvalTier',
      'exportEligible',
      'plannedPublishAt',
      'score',
      'status',
    ]);
  });
});
