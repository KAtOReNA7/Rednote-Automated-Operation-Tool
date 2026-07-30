import { describe, expect, it } from 'vitest';

import {
  evaluateExpressionPermission,
  evaluateSpoilerPolicy,
  type ExpressionPermissionInput,
} from '../packages/authenticity/src/index.js';

function input(overrides: Partial<ExpressionPermissionInput> = {}): ExpressionPermissionInput {
  return {
    assertions: [],
    dossier: {
      coveragePolicyVersion: 'dossier-coverage-policy-v1',
      dossierId: 'dossier-ready',
      readiness: 'READY_FOR_CONTENT_BRIEF',
      stale: false,
      versionId: 'version-ready',
    },
    memoryConfidence: 'CLEAR',
    profileId: 'primary',
    readingState: 'R1_READ_CLEAR',
    readingStateRevisionId: 'reading-revision-1',
    spoilerSelection: {
      level: 'NO_SPOILER',
      userConfirmed: false,
      warningIncluded: false,
    },
    workId: 'work-1',
    ...overrides,
  };
}

describe('Issue 021 deterministic authenticity policy', () => {
  it('allows R1 personal expression and score only when research facts are independently ready', () => {
    const ready = evaluateExpressionPermission(input(), '2026-07-30T01:00:00.000Z');
    expect(ready).toMatchObject({
      contentBriefReadiness: 'ALLOWED',
      firstPersonPermission: 'ALLOWED',
      personalScorePermission: 'ALLOWED',
      publicResearchAnalysisPermission: 'RESEARCH_ONLY',
    });

    const blocked = evaluateExpressionPermission(
      input({
        dossier: {
          coveragePolicyVersion: 'dossier-coverage-policy-v1',
          dossierId: 'dossier-blocked',
          readiness: 'FACT_BLOCKED',
          stale: false,
          versionId: 'version-blocked',
        },
      }),
      '2026-07-30T01:00:00.000Z',
    );
    expect(blocked.firstPersonPermission).toBe('ALLOWED');
    expect(blocked.contentBriefReadiness).toBe('BLOCKED');
    expect(blocked.blockingReasonCodes).toContain('DOSSIER_FACT_BLOCKED');
  });

  it('limits R2 to current assertion identities and requires PERSONAL_SCORE separately', () => {
    const current = evaluateExpressionPermission(
      input({
        assertions: [
          {
            assertionId: 'assertion-current',
            assertionKind: 'READING_IMPRESSION',
            assertionRevision: 1,
            readingStateRevisionId: 'reading-r2',
            status: 'CONFIRMED',
          },
          {
            assertionId: 'assertion-score',
            assertionKind: 'PERSONAL_SCORE',
            assertionRevision: 1,
            readingStateRevisionId: 'reading-r2',
            status: 'CONFIRMED',
          },
          {
            assertionId: 'assertion-stale',
            assertionKind: 'CHARACTER_MEMORY',
            assertionRevision: 2,
            readingStateRevisionId: 'old-reading-r2',
            status: 'CONFIRMED',
          },
        ],
        memoryConfidence: 'PARTIAL',
        readingState: 'R2_READ_FUZZY',
        readingStateRevisionId: 'reading-r2',
      }),
      '2026-07-30T01:00:00.000Z',
    );
    expect(current.firstPersonPermission).toBe('ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY');
    expect(current.personalScorePermission).toBe('ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY');

    const staleOnly = evaluateExpressionPermission(
      input({
        assertions: [
          {
            assertionId: 'assertion-stale',
            assertionKind: 'PERSONAL_SCORE',
            assertionRevision: 2,
            readingStateRevisionId: 'old-reading-r2',
            status: 'CONFIRMED',
          },
        ],
        memoryConfidence: 'FADED',
        readingState: 'R2_READ_FUZZY',
        readingStateRevisionId: 'reading-r2-current',
      }),
      '2026-07-30T01:00:00.000Z',
    );
    expect(staleOnly.firstPersonPermission).toBe('BLOCKED');
    expect(staleOnly.personalScorePermission).toBe('BLOCKED');
  });

  it.each([
    ['R3_READ_UNCONFIRMED_DETAILS', 'UNKNOWN', 'RESEARCH_ONLY'],
    ['S1_RESEARCH_ONLY', 'NOT_APPLICABLE', 'RESEARCH_ONLY'],
    ['S2_RESEARCH_INSUFFICIENT', 'NOT_APPLICABLE', 'BLOCKED'],
    ['UNCLASSIFIED', 'UNKNOWN', 'BLOCKED'],
  ] as const)(
    'evaluates %s independently from Dossier readiness',
    (readingState, memoryConfidence, expectedResearch) => {
      const result = evaluateExpressionPermission(
        input({ memoryConfidence, readingState }),
        '2026-07-30T01:00:00.000Z',
      );
      expect(result.firstPersonPermission).toBe('BLOCKED');
      expect(result.personalScorePermission).toBe('BLOCKED');
      expect(result.publicResearchAnalysisPermission).toBe(expectedResearch);
      expect(result.researchAnalysisScorePermission).toBe(expectedResearch);
    },
  );

  it('blocks S1 research without a current READY dossier and marks stale fail closed', () => {
    const missing = evaluateExpressionPermission(
      input({
        dossier: null,
        memoryConfidence: 'NOT_APPLICABLE',
        readingState: 'S1_RESEARCH_ONLY',
      }),
      '2026-07-30T01:00:00.000Z',
    );
    expect(missing.publicResearchAnalysisPermission).toBe('BLOCKED');
    expect(missing.blockingReasonCodes).toContain('DOSSIER_NOT_READY');

    const stale = evaluateExpressionPermission(
      input({
        dossier: {
          coveragePolicyVersion: 'dossier-coverage-policy-v1',
          dossierId: 'dossier-stale',
          readiness: 'READY_FOR_CONTENT_BRIEF',
          stale: true,
          versionId: 'version-stale',
        },
        memoryConfidence: 'NOT_APPLICABLE',
        readingState: 'S1_RESEARCH_ONLY',
      }),
      '2026-07-30T01:00:00.000Z',
    );
    expect(stale.publicResearchAnalysisPermission).toBe('STALE_REVIEW_REQUIRED');
    expect(stale.contentBriefReadiness).toBe('STALE_REVIEW_REQUIRED');
  });

  it('allows full trick analysis only with prominent warning and explicit confirmation', () => {
    expect(
      evaluateSpoilerPolicy({
        level: 'FULL_TRICK_ANALYSIS',
        userConfirmed: false,
        warningIncluded: false,
      }),
    ).toMatchObject({
      coreTrickDisclosure: true,
      satisfied: false,
      userConfirmationRequired: true,
      warningPlacement: 'COVER_TITLE_AND_BODY_OPENING',
      warningRequired: true,
    });
    const satisfied = evaluateSpoilerPolicy({
      level: 'FULL_TRICK_ANALYSIS',
      userConfirmed: true,
      warningIncluded: true,
    });
    expect(satisfied.satisfied).toBe(true);
    expect(satisfied.coreTrickDisclosure).toBe(true);
  });

  it('blocks an otherwise-ready brief when the full-trick warning is incomplete', () => {
    const result = evaluateExpressionPermission(
      input({
        spoilerSelection: {
          level: 'FULL_TRICK_ANALYSIS',
          userConfirmed: false,
          warningIncluded: false,
        },
      }),
      '2026-07-30T01:00:00.000Z',
    );
    expect(result).toMatchObject({
      contentBriefReadiness: 'BLOCKED',
      firstPersonPermission: 'ALLOWED',
      personalScorePermission: 'ALLOWED',
    });
    expect(result.blockingReasonCodes).toEqual(
      expect.arrayContaining(['SPOILER_USER_CONFIRMATION_REQUIRED', 'SPOILER_WARNING_REQUIRED']),
    );
  });

  it('does not let spoiler warnings elevate blocked authenticity or research facts', () => {
    const blocked = evaluateExpressionPermission(
      input({
        dossier: {
          coveragePolicyVersion: 'dossier-coverage-policy-v1',
          dossierId: 'dossier-insufficient',
          readiness: 'INSUFFICIENT_COVERAGE',
          stale: false,
          versionId: 'version-insufficient',
        },
        memoryConfidence: 'NOT_APPLICABLE',
        readingState: 'S2_RESEARCH_INSUFFICIENT',
        spoilerSelection: {
          level: 'FULL_TRICK_ANALYSIS',
          userConfirmed: true,
          warningIncluded: true,
        },
      }),
      '2026-07-30T01:00:00.000Z',
    );
    expect(blocked.contentBriefReadiness).toBe('BLOCKED');
    expect(blocked.firstPersonPermission).toBe('BLOCKED');
    expect(blocked.publicResearchAnalysisPermission).toBe('BLOCKED');
  });

  it('is deterministic across assertion input order and excludes evaluatedAt from dependency hash', () => {
    const assertions = [
      {
        assertionId: 'a',
        assertionKind: 'READING_IMPRESSION' as const,
        assertionRevision: 1,
        readingStateRevisionId: 'reading-r2',
        status: 'CONFIRMED' as const,
      },
      {
        assertionId: 'b',
        assertionKind: 'PERSONAL_SCORE' as const,
        assertionRevision: 1,
        readingStateRevisionId: 'reading-r2',
        status: 'CONFIRMED' as const,
      },
    ];
    const first = evaluateExpressionPermission(
      input({
        assertions,
        memoryConfidence: 'PARTIAL',
        readingState: 'R2_READ_FUZZY',
        readingStateRevisionId: 'reading-r2',
      }),
      '2026-07-30T01:00:00.000Z',
    );
    const second = evaluateExpressionPermission(
      input({
        assertions: [...assertions].reverse(),
        memoryConfidence: 'PARTIAL',
        readingState: 'R2_READ_FUZZY',
        readingStateRevisionId: 'reading-r2',
      }),
      '2026-07-30T02:00:00.000Z',
    );
    expect(second.dependencyHash).toBe(first.dependencyHash);
  });
});
