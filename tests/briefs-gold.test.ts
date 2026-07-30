import { describe, expect, it } from 'vitest';

import {
  BRIEF_PROFILE_IDS,
  assertContentBriefDraft,
  evaluateBriefReadiness,
  type BriefEvidenceRef,
} from '../packages/briefs/src/index.js';
import { readyBriefContext, readyBriefDraft } from './support/brief-fixtures.js';

function evidenceRef(
  fieldPath: string,
  overrides: Partial<BriefEvidenceRef> = {},
): BriefEvidenceRef {
  return {
    claimId: 'claim-gold',
    current: true,
    dependencyHash: 'd'.repeat(64),
    displaySummary: '合成且有界的事实摘要',
    dossierEntryId: 'dossier-entry-gold',
    dossierId: 'dossier-gold',
    dossierVersionId: 'dossier-version-gold',
    evidenceLocatorId: 'evidence-locator-gold',
    factEvaluationId: 'fact-evaluation-gold',
    factStatus: 'VERIFIED',
    fieldPath,
    locatorValid: true,
    refId: `evidence-ref-${fieldPath.replaceAll('.', '-')}`,
    role: 'FACT',
    sourceLanguage: 'zh-CN',
    sourceRevisionId: 'source-gold:1',
    ...overrides,
  };
}

describe('M3 Issue 024 Content Brief gold fixtures', () => {
  it('keeps one ready fixture for each frozen Brief profile', () => {
    const readinessCounts = new Map<string, number>();
    for (const profileId of BRIEF_PROFILE_IDS) {
      const result = evaluateBriefReadiness(
        readyBriefDraft(profileId),
        readyBriefContext(),
        '2026-07-30T12:40:00.000Z',
      );
      readinessCounts.set(result.status, (readinessCounts.get(result.status) ?? 0) + 1);
    }
    expect(readinessCounts).toEqual(new Map([['READY_FOR_DRAFT_GENERATION', 5]]));
  });

  it('requires a current VERIFIED FACT ref mapped to the exact argument identity', () => {
    const base = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const reference = evidenceRef('supportingArguments.support-1');
    const factual = assertContentBriefDraft({
      ...base,
      evidenceMap: [reference],
      supportingArguments: [
        {
          ...base.supportingArguments[0],
          evidenceRefIds: [reference.refId],
          kind: 'FACT',
        },
      ],
    });
    expect(evaluateBriefReadiness(factual, readyBriefContext()).status).toBe(
      'READY_FOR_DRAFT_GENERATION',
    );

    for (const unusable of [
      { ...reference, fieldPath: 'supportingArguments.someone-else' },
      { ...reference, role: 'CONTEXT' as const },
      { ...reference, factStatus: 'SUPPORTED_NOT_VERIFIED' as const },
      { ...reference, locatorValid: false },
    ]) {
      const result = evaluateBriefReadiness(
        assertContentBriefDraft({
          ...factual,
          evidenceMap: [unusable],
        }),
        readyBriefContext(),
      );
      expect(result.status).not.toBe('READY_FOR_DRAFT_GENERATION');
      expect(result.reasonCodes).toContain('FACTUAL_ARGUMENT_UNMAPPED');
    }
  });

  it('applies the same exact Evidence mapping rule to a factual counterargument', () => {
    const base = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const reference = evidenceRef('strongestCounterargument');
    const factualCounterargument = assertContentBriefDraft({
      ...base,
      evidenceMap: [reference],
      strongestCounterargument: {
        ...base.strongestCounterargument,
        evidenceRefIds: [reference.refId],
        kind: 'MIXED',
      },
    });
    expect(evaluateBriefReadiness(factualCounterargument, readyBriefContext()).status).toBe(
      'READY_FOR_DRAFT_GENERATION',
    );
    expect(
      evaluateBriefReadiness(
        assertContentBriefDraft({
          ...factualCounterargument,
          evidenceMap: [{ ...reference, current: false }],
        }),
        readyBriefContext(),
      ),
    ).toMatchObject({
      reasonCodes: expect.arrayContaining(['COUNTERARGUMENT_FACT_UNMAPPED']),
      status: 'FACT_BLOCKED',
    });
  });

  it('keeps Experiment match and mismatch as Brief-only readiness facts', () => {
    const base = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const primarySubject = base.subjects.at(0);
    expect(primarySubject).toBeDefined();
    if (primarySubject === undefined) throw new Error('expected primary subject');
    const bound = assertContentBriefDraft({
      ...base,
      experimentBinding: {
        armId: 'treatment',
        armValueIdentity: 'structure-treatment',
        assignmentCurrent: true,
        assignmentPlanId: 'assignment-gold',
        controlledConditions: [{ kind: 'SPOILER_LEVEL', valueIdentity: 'NO_SPOILER' }],
        designCurrent: true,
        designVersionId: 'design-gold',
        experimentId: 'experiment-gold',
        experimentLocked: true,
        experimentStale: false,
        popularityStratum: 'WARM',
        structureFingerprint: 'f'.repeat(64),
        topicId: base.topicId,
        topicVersionId: base.topicVersionId,
        workId: primarySubject.workId,
      },
    });
    expect(evaluateBriefReadiness(bound, readyBriefContext()).status).toBe(
      'READY_FOR_DRAFT_GENERATION',
    );
    expect(
      evaluateBriefReadiness(bound, readyBriefContext({ experimentMatches: false })).status,
    ).toBe('EXPERIMENT_MISMATCH');
  });
});
