import { describe, expect, it } from 'vitest';

import {
  BRIEF_PROFILE_IDS,
  assertContentBriefDraft,
  evaluateBriefReadiness,
  validateBriefProfile,
} from '../packages/briefs/src/index.js';
import {
  briefScaffoldInput,
  readyBriefContext,
  readyBriefDraft,
} from './support/brief-fixtures.js';

describe('M3 Issue 024 profile and readiness policy', () => {
  it.each(BRIEF_PROFILE_IDS)(
    '%s reaches ready only with complete compatible structure',
    (profile) => {
      const draft = readyBriefDraft(profile);
      expect(validateBriefProfile(draft)).toEqual({ reasonCodes: [], valid: true });
      expect(
        evaluateBriefReadiness(draft, readyBriefContext(), '2026-07-30T12:10:00.000Z'),
      ).toMatchObject({
        reasonCodes: [],
        status: 'READY_FOR_DRAFT_GENERATION',
      });
    },
  );

  it('maps dependency, dossier, fact, authenticity, spoiler, experiment and evidence failures', () => {
    const base = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const primarySubject = base.subjects.at(0);
    expect(primarySubject).toBeDefined();
    if (primarySubject === undefined) throw new Error('expected primary subject');
    expect(
      evaluateBriefReadiness(base, readyBriefContext({ dependenciesCurrent: false })).status,
    ).toBe('STALE');
    expect(
      evaluateBriefReadiness(base, readyBriefContext({ dossierCurrentReady: false })).status,
    ).toBe('DOSSIER_NOT_READY');
    expect(evaluateBriefReadiness(base, readyBriefContext({ factBlocked: true })).status).toBe(
      'FACT_BLOCKED',
    );
    expect(
      evaluateBriefReadiness(
        assertContentBriefDraft({
          ...base,
          expressionPolicy: { ...base.expressionPolicy, permissionCurrent: false },
        }),
        readyBriefContext(),
      ).status,
    ).toBe('AUTHENTICITY_BLOCKED');
    const full = readyBriefDraft('FULL_TRICK_LOGIC_ANALYSIS');
    expect(
      evaluateBriefReadiness(
        assertContentBriefDraft({
          ...full,
          spoilerPlan: { ...full.spoilerPlan, userConfirmed: false },
        }),
        readyBriefContext(),
      ).status,
    ).toBe('SPOILER_POLICY_INCOMPLETE');
    expect(
      evaluateBriefReadiness(
        assertContentBriefDraft({
          ...base,
          experimentBinding: {
            armId: 'control',
            armValueIdentity: 'structure-a',
            assignmentCurrent: true,
            assignmentPlanId: 'assignment-1',
            controlledConditions: [],
            designCurrent: true,
            designVersionId: 'design-1',
            experimentId: 'experiment-1',
            experimentLocked: true,
            experimentStale: false,
            popularityStratum: 'WARM',
            structureFingerprint: 'a'.repeat(64),
            topicId: base.topicId,
            topicVersionId: base.topicVersionId,
            workId: primarySubject.workId,
          },
        }),
        readyBriefContext({ experimentMatches: false }),
      ).status,
    ).toBe('EXPERIMENT_MISMATCH');
  });

  it('requires both verified web and published forms for the form-comparison profile', () => {
    const valid = readyBriefDraft('WEB_VS_PUBLISHED_MYSTERY');
    const invalid = assertContentBriefDraft({
      ...valid,
      subjects: valid.subjects.map((subject) => ({
        ...subject,
        expressionForm: 'WEB_SERIALIZED',
      })),
    });
    expect(validateBriefProfile(invalid).reasonCodes).toContain(
      'PROFILE_EXPRESSION_FORM_UNVERIFIED',
    );
  });

  it('leaves local scaffold judgments and arguments open rather than inventing facts', async () => {
    const { buildLocalBriefScaffold } = await import('../packages/briefs/src/index.js');
    const draft = buildLocalBriefScaffold({
      ...briefScaffoldInput('NON_SPOILER_SINGLE_BOOK_VERDICT'),
      candidateJudgment: null,
    });
    expect(draft.coreJudgment.statement).toBeNull();
    expect(draft.supportingArguments).toEqual([]);
    expect(draft.strongestCounterargument).toBeNull();
    expect(draft.openQuestionsAndLimitations).toContain('中心判断尚待用户确认');
  });

  it('keeps vague judgments, unqualified claims and unverifiable promises incomplete', () => {
    const base = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const result = evaluateBriefReadiness(
      assertContentBriefDraft({
        ...base,
        contentObjective: {
          ...base.contentObjective,
          readerOutcome: '保证制造爆款',
        },
        coreJudgment: {
          ...base.coreJudgment,
          qualification: null,
          statement: '神作',
        },
      }),
      readyBriefContext(),
    );
    expect(result.status).toBe('DRAFT_INCOMPLETE');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'CORE_JUDGMENT_INCOMPLETE',
        'CORE_JUDGMENT_VAGUE',
        'OBJECTIVE_UNVERIFIABLE_PROMISE',
      ]),
    );
  });
});
