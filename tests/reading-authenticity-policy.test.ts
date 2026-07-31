import { describe, expect, it } from 'vitest';

import type { ContentDraftPayloadV1 } from '../packages/copy/src/index.js';
import {
  evaluateReadingAuthenticity,
  factMappingHash,
  materializeDraftPublicArtifacts,
  resolveDraftTextLocator,
  type ReadingAuthenticityWorkTruth,
} from '../packages/quality/src/index.js';
import { completeCopyPayload, requiredFixtureValue } from './support/copy-fixtures.js';

const NOW = '2026-07-31T01:00:00.000Z';

function truth(
  payload: ContentDraftPayloadV1,
  state: ReadingAuthenticityWorkTruth['readingState'],
  overrides: Partial<ReadingAuthenticityWorkTruth> = {},
): ReadingAuthenticityWorkTruth {
  return {
    assertions: [],
    dossier: null,
    personalScore: null,
    permission: {
      current: true,
      dependencyHash: 'a'.repeat(64),
      firstPersonPermission: state === 'R1' ? 'ALLOWED' : 'BLOCKED',
      personalScorePermission: state === 'R1' ? 'ALLOWED' : 'BLOCKED',
      researchScorePermission: state === 'S1' ? 'RESEARCH_ONLY' : 'BLOCKED',
      snapshotId: payload.brief.expressionPolicy.permissionSnapshotId,
    },
    readingState: state,
    readingStateRevision: 1,
    readingStateRevisionId: 'reading-revision-1',
    researchScore: null,
    workId: requiredFixtureValue(payload.brief.workIds[0]),
    ...overrides,
  };
}

function evaluate(payload: ContentDraftPayloadV1, workTruth: ReadingAuthenticityWorkTruth) {
  return evaluateReadingAuthenticity({
    draftId: 'draft-reading-check',
    draftRevision: 4,
    draftStatus: 'READY_FOR_QUALITY_PIPELINE',
    draftVersionId: 'draft-version-reading-check',
    evaluatedAt: NOW,
    payload,
    structuralValid: true,
    truths: [workTruth],
  });
}

function withTextInEveryArtifact(
  payload: ContentDraftPayloadV1,
  text: string,
): ContentDraftPayloadV1 {
  const selectedId = requiredFixtureValue(payload.selectedTitleId);
  return {
    ...payload,
    blocks: payload.blocks.map((block, index) => (index === 0 ? { ...block, text } : block)),
    pinnedComment: payload.pinnedComment === null ? null : { ...payload.pinnedComment, text },
    tags: payload.tags.map((tag, index) => (index === 0 ? { ...tag, text } : tag)),
    titles: payload.titles.map((title) =>
      title.titleId === selectedId ? { ...title, text } : title,
    ),
  };
}

describe('Issue 027 reading authenticity policy and gold cases', () => {
  it('allows concrete R1 text and blocks all four public artifact kinds outside R1', () => {
    const payload = withTextInEveryArtifact(
      completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT'),
      '我读完后认为节奏很稳。',
    );
    expect(evaluate(payload, truth(payload, 'R1')).status).toBe('PASS');

    const blocked = evaluate(payload, truth(payload, 'R3'));
    expect(blocked.status).toBe('BLOCKED');
    expect(new Set(blocked.findings.map(({ locator }) => locator.artifactKind))).toEqual(
      new Set(['SELECTED_TITLE', 'BODY_BLOCK', 'TAG', 'PINNED_COMMENT']),
    );
    const artifacts = materializeDraftPublicArtifacts({
      current: true,
      draftId: blocked.draftId,
      draftStatus: 'READY_FOR_QUALITY_PIPELINE',
      draftVersionId: blocked.draftVersionId,
      payload,
      structuralValid: true,
    });
    for (const finding of blocked.findings) {
      const artifact = requiredFixtureValue(
        artifacts.find(
          ({ artifact }) =>
            artifact.artifactId === finding.locator.artifactId &&
            artifact.artifactKind === finding.locator.artifactKind,
        ),
      );
      expect(resolveDraftTextLocator(artifact, finding.locator)).toContain('我读完');
    }
  });

  it('allows only an exact current R2 assertion and blocks generalized firsthand claims', () => {
    const original = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const selectedId = requiredFixtureValue(original.selectedTitleId);
    const statement = '我认为这个结构很克制。';
    const payload = {
      ...original,
      titles: original.titles.map((title) =>
        title.titleId === selectedId
          ? {
              ...title,
              lineage: title.lineage.map((ref) => ({
                ...ref,
                experienceAssertionId: 'assertion-r2',
              })),
              text: statement,
            }
          : title,
      ),
    };
    const r2 = truth(payload, 'R2', {
      assertions: [
        {
          assertionId: 'assertion-r2',
          assertionRevisionId: 'assertion-r2-revision-1',
          confirmationScope: 'EXACT_STRUCTURED_OPINION',
          current: true,
          statementHash: factMappingHash(statement),
        },
      ],
      permission: {
        ...truth(payload, 'R2').permission,
        firstPersonPermission: 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY',
      },
    });
    expect(evaluate(payload, r2).status).toBe('PASS');
    expect(
      evaluate(
        {
          ...payload,
          titles: payload.titles.map((title) =>
            title.titleId === selectedId ? { ...title, text: '我认为它完全不同。' } : title,
          ),
        },
        r2,
      ).status,
    ).toBe('REVIEW_REQUIRED');
    expect(
      evaluate(
        {
          ...payload,
          titles: payload.titles.map((title) =>
            title.titleId === selectedId ? { ...title, text: '我重读后更确定。' } : title,
          ),
        },
        r2,
      ).status,
    ).toBe('BLOCKED');
  });

  it('requires current public personal and research score sources with exact values and label', () => {
    const original = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const personal: ContentDraftPayloadV1 = {
      ...original,
      blocks: original.blocks.map((block, index) =>
        index === 0 ? { ...block, text: '个人评分：8.5分。' } : block,
      ),
      brief: {
        ...original.brief,
        scorePlan: {
          kind: 'PERSONAL_SCORE',
          publicLabel: null,
          publicLabelRequired: false,
          scale: '10_POINT',
          valueSourceId: 'personal-score-1',
        },
      },
    };
    const personalTruth = truth(personal, 'R1', {
      personalScore: {
        id: 'personal-score-1',
        provenance: 'USER_UI',
        readingStateRevisionId: 'reading-revision-1',
        revision: 1,
        scoreBasisPoints: 8_500,
      },
    });
    expect(evaluate(personal, personalTruth).status).toBe('PASS');
    expect(evaluate(personal, { ...personalTruth, readingState: 'R2' }).status).toBe('BLOCKED');

    const research: ContentDraftPayloadV1 = {
      ...personal,
      blocks: personal.blocks.map((block, index) =>
        index === 0 ? { ...block, text: '资料分析评分：8.2分。' } : block,
      ),
      brief: {
        ...personal.brief,
        scorePlan: {
          kind: 'RESEARCH_ANALYSIS_SCORE',
          publicLabel: '资料分析评分',
          publicLabelRequired: true,
          scale: '10_POINT',
          valueSourceId: 'research-score-1',
        },
      },
    };
    const researchTruth = truth(research, 'S1', {
      dossier: {
        currentVersionId: 'dossier-version-1',
        dossierId: 'dossier-1',
        readinessStatus: 'READY_FOR_CONTENT_BRIEF',
        state: 'CURRENT',
      },
      researchScore: {
        dossierId: 'dossier-1',
        dossierVersionId: 'dossier-version-1',
        id: 'research-score-1',
        provenance: 'USER_UI',
        publicLabel: '资料分析评分',
        readingStateRevisionId: 'reading-revision-1',
        revision: 1,
        scoreBasisPoints: 8_200,
      },
    });
    expect(evaluate(research, researchTruth).status).toBe('PASS');
    expect(
      evaluate(research, {
        ...researchTruth,
        researchScore: {
          ...requiredFixtureValue(researchTruth.researchScore),
          scoreBasisPoints: 8_100,
        },
      }).reasonCodes,
    ).toContain('RESEARCH_SCORE_VALUE_MISMATCH');
  });

  it('does not invent a score error, but rejects plan conflicts and internal prediction text', () => {
    const plain = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(evaluate(plain, truth(plain, 'S1')).reasonCodes).not.toContain('SCORE_PLAN_CONFLICT');
    const selectedId = requiredFixtureValue(plain.selectedTitleId);
    const unsafe = {
      ...plain,
      titles: plain.titles.map((title) =>
        title.titleId === selectedId
          ? { ...title, text: '系统预测分 9/10，个人评分 8/10。' }
          : title,
      ),
      brief: {
        ...plain.brief,
        scorePlan: {
          kind: 'NONE' as const,
          publicLabel: null,
          publicLabelRequired: false,
          scale: null,
          valueSourceId: null,
        },
      },
    };
    const result = evaluate(unsafe, truth(unsafe, 'S1'));
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCodes).toContain('INTERNAL_PREDICTION_PUBLIC');
    expect(JSON.stringify(result)).not.toContain('system_prediction_scores');
    const scoreOnly = {
      ...unsafe,
      titles: unsafe.titles.map((title) =>
        title.titleId === selectedId ? { ...title, text: '个人评分 8/10。' } : title,
      ),
    };
    expect(evaluate(scoreOnly, truth(scoreOnly, 'R1')).reasonCodes).toContain(
      'SCORE_PLAN_CONFLICT',
    );
  });

  it('routes ambiguous and truncated findings to review instead of pass', () => {
    const original = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const ambiguous = {
      ...original,
      blocks: original.blocks.map((block, index) =>
        index === 0 ? { ...block, text: '评分 8/10，另一个评分 7/10。' } : block,
      ),
    };
    expect(evaluate(ambiguous, truth(ambiguous, 'R1')).status).toBe('REVIEW_REQUIRED');
    const many = {
      ...original,
      blocks: original.blocks.map((block, index) =>
        index === 0
          ? {
              ...block,
              text: Array.from({ length: 24 }, (_, item) => `我认为观点${item}。`).join('\n'),
            }
          : block,
      ),
    };
    const result = evaluate(many, truth(many, 'S1'));
    expect(result).toMatchObject({ status: 'REVIEW_REQUIRED', truncated: true });
    expect(result.reasonCodes).toContain('FINDINGS_TRUNCATED');
  });
});
