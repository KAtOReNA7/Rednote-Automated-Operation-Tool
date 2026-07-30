import { describe, expect, it } from 'vitest';

import {
  buildManualCopyScaffold,
  copySemanticHash,
  validateDraftStructure,
} from '../packages/copy/src/index.js';
import { readyBriefDraft, briefDependencies } from './support/brief-fixtures.js';
import { completeCopyPayload, requiredFixtureValue } from './support/copy-fixtures.js';

describe('M3 Issue 025 authenticity, scoring and profile policy', () => {
  it('keeps a manual scaffold usable without a model but structurally incomplete', () => {
    const brief = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const scaffold = buildManualCopyScaffold({
      briefId: 'brief-manual',
      briefInputHash: copySemanticHash(brief),
      briefLockHash: copySemanticHash(brief.fieldStates),
      briefVersionId: 'brief-version-manual',
      dependencies: briefDependencies(brief.topicVersionId),
      draft: brief,
    });
    expect(scaffold.titles).toEqual([]);
    expect(scaffold.blocks.length).toBeGreaterThan(0);
    expect(validateDraftStructure(scaffold).valid).toBe(false);
  });

  it('inherits R1, R2 and S1 permissions rather than creating new authority', () => {
    const s1 = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(s1.brief.expressionPolicy).toMatchObject({
      firstPersonAllowed: false,
      mode: 'PUBLIC_RESEARCH_ANALYSIS',
      readingState: 'S1',
    });
    const r1 = {
      ...s1,
      brief: {
        ...s1.brief,
        expressionPolicy: {
          ...s1.brief.expressionPolicy,
          allowedAssertionIds: [],
          firstPersonAllowed: true,
          mode: 'PERSONAL_EXPERIENCE' as const,
          r2AssertionIds: [],
          readingState: 'R1' as const,
          requiredPublicLabels: [],
        },
        requiredPublicLabels: [],
        scorePlan: {
          kind: 'PERSONAL_SCORE' as const,
          publicLabel: null,
          publicLabelRequired: false,
          scale: 'USER_DEFINED',
          valueSourceId: 'personal-score-revision-1',
        },
      },
    };
    expect(validateDraftStructure(r1).reasonCodes).toEqual([]);
    expect(
      validateDraftStructure({
        ...r1,
        brief: {
          ...r1.brief,
          expressionPolicy: {
            ...r1.brief.expressionPolicy,
            firstPersonAllowed: false,
          },
        },
      }).reasonCodes,
    ).toContain('R1_PERSONAL_PERMISSION_MISSING');
    const r2 = {
      ...r1,
      brief: {
        ...r1.brief,
        allowedExperienceAssertionIds: ['assertion-current'],
        expressionPolicy: {
          ...r1.brief.expressionPolicy,
          allowedAssertionIds: ['assertion-current'],
          firstPersonAllowed: false,
          r2AssertionIds: ['assertion-current'],
          readingState: 'R2' as const,
        },
        scorePlan: {
          kind: 'NONE' as const,
          publicLabel: null,
          publicLabelRequired: false,
          scale: null,
          valueSourceId: null,
        },
      },
    };
    expect(r2.brief.allowedExperienceAssertionIds).toEqual(['assertion-current']);
    expect(r2.brief.expressionPolicy.firstPersonAllowed).toBe(false);
    const invented = {
      ...r2,
      blocks: r2.blocks.map((block, index) =>
        index === 0
          ? {
              ...block,
              lineage: [
                {
                  ...requiredFixtureValue(block.lineage.at(0), 'first block lineage'),
                  experienceAssertionId: 'assertion-invented',
                },
              ],
            }
          : block,
      ),
    };
    expect(validateDraftStructure(invented).reasonCodes).toContain('LINEAGE_ASSERTION_NOT_ALLOWED');
  });

  it('requires public research and research score labels as visible artifacts', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const researchScore = {
      ...payload,
      brief: {
        ...payload.brief,
        requiredPublicLabels: ['公开资料整理'],
        scorePlan: {
          kind: 'RESEARCH_ANALYSIS_SCORE' as const,
          publicLabel: '资料分析评分' as const,
          publicLabelRequired: true,
          scale: 'USER_DEFINED',
          valueSourceId: 'score-source',
        },
      },
      blocks: payload.blocks.map((block) => ({
        ...block,
        text: block.text.replaceAll('资料分析评分', '').replaceAll('公开资料整理', ''),
      })),
      pinnedComment:
        payload.pinnedComment === null
          ? null
          : {
              ...payload.pinnedComment,
              text: '合成评论，不含公开标签。',
            },
    };
    const labeled = {
      ...researchScore,
      blocks: researchScore.blocks.map((block, index) =>
        index === 0 ? { ...block, text: `${block.text} 公开资料整理，资料分析评分。` } : block,
      ),
    };
    expect(validateDraftStructure(labeled).reasonCodes).toEqual([]);
    expect(validateDraftStructure(researchScore).reasonCodes).toEqual(
      expect.arrayContaining(['PUBLIC_LABEL_ARTIFACT_REQUIRED', 'RESEARCH_SCORE_LABEL_REQUIRED']),
    );
  });

  it('keeps experiment arm and controlled conditions as input constraints, not results', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const bound = {
      ...payload,
      brief: {
        ...payload.brief,
        experimentBinding: {
          armId: 'arm-a',
          assignmentCurrent: true,
          assignmentPlanId: 'assignment-1',
          controlledConditions: ['same-audience', 'same-window'],
          designCurrent: true,
          designVersionId: 'design-1',
          experimentId: 'experiment-1',
          experimentLocked: true,
          experimentStale: false,
          primaryVariable: 'TITLE_VARIANT',
        },
      },
    };
    expect(JSON.stringify(bound.brief.experimentBinding)).not.toMatch(
      /winner|effect|result|lift/iu,
    );
  });
});
