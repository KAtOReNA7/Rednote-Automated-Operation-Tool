import { describe, expect, it } from 'vitest';

import type { ContentDraftPayloadV1 } from '../packages/copy/src/index.js';
import {
  SpoilerQualityError,
  evaluateSpoilerQuality,
  type EvaluateSpoilerQualityInput,
} from '../packages/quality/src/index.js';
import { completeCopyPayload, requiredFixtureValue } from './support/copy-fixtures.js';

const NOW = '2026-08-01T08:00:00.000Z';

function input(
  payload: ContentDraftPayloadV1,
  overrides: Partial<EvaluateSpoilerQualityInput> = {},
): EvaluateSpoilerQualityInput {
  return {
    brief: {
      briefId: payload.brief.briefId,
      currentVersionId: payload.brief.briefVersionId,
      dependencyHash: 'a'.repeat(64),
      inputHash: payload.brief.briefInputHash,
      invalidations: [],
      lockHash: payload.brief.briefLockHash,
      payloadHash: payload.brief.briefInputHash,
      readinessStatus: 'READY_FOR_DRAFT_GENERATION',
      revision: 3,
      spoilerPlan: payload.brief.spoilerPlan,
      state: 'ACTIVE',
      status: 'USER_CONFIRMED',
    },
    draftBriefId: payload.brief.briefId,
    draftBriefVersionId: payload.brief.briefVersionId,
    draftDependencyHash: 'b'.repeat(64),
    draftId: 'draft-spoiler-policy',
    draftInputHash: payload.brief.briefInputHash,
    draftInvalidations: [],
    draftLockHash: payload.brief.briefLockHash,
    draftRevision: 4,
    draftState: 'ACTIVE',
    draftStatus: 'READY_FOR_QUALITY_PIPELINE',
    draftVersionId: 'draft-spoiler-version-4',
    evaluatedAt: NOW,
    payload,
    structuralValid: true,
    ...overrides,
  };
}

function lightPayload(): ContentDraftPayloadV1 {
  const original = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
  const spoilerPlan: ContentDraftPayloadV1['brief']['spoilerPlan'] = {
    level: 'LIGHT_SPOILER',
    revealCoreTrick: false,
    revealEnding: false,
    userConfirmationRequired: false,
    userConfirmed: false,
    warningPlacement: 'BODY_OPENING',
    warningRequired: true,
  };
  return {
    ...original,
    brief: { ...original.brief, spoilerPlan },
    spoilerWarnings: {
      ...original.spoilerWarnings,
      bodyOpeningWarningText: '轻度剧透：下文只涉及部分非核心情节。',
    },
  };
}

describe('Issue 028 deterministic spoiler quality policy', () => {
  it('accepts only current, structurally valid DraftVersions ready for the quality pipeline', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    expect(evaluateSpoilerQuality(input(payload)).status).toBe('PASS');
    expect(() =>
      evaluateSpoilerQuality(input(payload, { draftStatus: 'STRUCTURE_INVALID' })),
    ).toThrow(SpoilerQualityError);
    expect(() => evaluateSpoilerQuality(input(payload, { structuralValid: false }))).toThrow(
      /SPOILER_QUALITY_NOT_READY/u,
    );
  });

  it('blocks explicit Draft/Brief lineage, hash, lock, plan, readiness and invalidation conflicts', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const result = evaluateSpoilerQuality(
      input(payload, {
        brief: {
          ...input(payload).brief,
          currentVersionId: 'different-brief-version',
          inputHash: 'c'.repeat(64),
          invalidations: [
            {
              dependencyType: 'SPOILER_POLICY',
              observedRevision: '2',
              reasonCode: 'POLICY_CHANGED',
            },
          ],
          lockHash: 'd'.repeat(64),
          payloadHash: 'c'.repeat(64),
          readinessStatus: 'STALE',
          spoilerPlan: { ...payload.brief.spoilerPlan, warningRequired: true },
        },
        draftInvalidations: [
          { dependencyType: 'BRIEF_VERSION', observedRevision: '5', reasonCode: 'BRIEF_CHANGED' },
        ],
      }),
    );
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'BRIEF_INPUT_HASH_MISMATCH',
        'BRIEF_INVALIDATED',
        'BRIEF_LOCK_HASH_MISMATCH',
        'BRIEF_NOT_READY',
        'BRIEF_VERSION_MISMATCH',
        'DRAFT_INVALIDATED',
        'SPOILER_PLAN_MISMATCH',
      ]),
    );
  });

  it('enforces NO placement, flags and all four empty warning surfaces', () => {
    const original = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const result = evaluateSpoilerQuality(
      input({
        ...original,
        brief: {
          ...original.brief,
          spoilerPlan: { ...original.brief.spoilerPlan, revealEnding: true },
        },
        spoilerWarnings: { ...original.spoilerWarnings, coverWarningText: '剧透预警' },
      }),
    );
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['NO_SPOILER_PLAN_INVALID', 'NO_SPOILER_WARNING_PRESENT']),
    );
  });

  it('requires one explicit LIGHT opening warning and rejects FULL scope or extra surfaces', () => {
    expect(evaluateSpoilerQuality(input(lightPayload())).status).toBe('PASS');
    const fullOpening = lightPayload();
    const result = evaluateSpoilerQuality(
      input({
        ...fullOpening,
        spoilerWarnings: {
          ...fullOpening.spoilerWarnings,
          bodyOpeningWarningText: '完整剧透：下文拆解核心诡计与结局。',
          coverWarningText: '轻度剧透',
        },
      }),
    );
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['LIGHT_OPENING_WARNING_FULL', 'LIGHT_WARNING_SURFACE_MISMATCH']),
    );
  });

  it('allows FULL synthetic culprit, ending and core-trick text when all declarations are exact', () => {
    const original = completeCopyPayload('FULL_TRICK_LOGIC_ANALYSIS');
    const payload = {
      ...original,
      blocks: original.blocks.map((block, index) =>
        index === 0
          ? { ...block, text: '凶手是合成人物甲，结局是谜底公开，核心诡计是合成机关。' }
          : block,
      ),
    };
    const result = evaluateSpoilerQuality(input(payload));
    expect(result).toMatchObject({ findings: [], status: 'PASS', truncated: false });
    expect(result.reasonCodes).toEqual([]);
  });

  it('blocks missing or downgraded FULL warning surfaces and a marker absent from the selected title', () => {
    const original = completeCopyPayload('FULL_TRICK_LOGIC_ANALYSIS');
    const selectedId = requiredFixtureValue(original.selectedTitleId);
    const result = evaluateSpoilerQuality(
      input({
        ...original,
        spoilerWarnings: {
          ...original.spoilerWarnings,
          coverWarningText: null,
          bodyOpeningWarningText: '轻度剧透：部分情节。',
        },
        titles: original.titles.map((title) =>
          title.titleId === selectedId
            ? { ...title, text: title.text.replace('【完整剧透】', '') }
            : title,
        ),
      }),
    );
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'FULL_WARNING_DOWNGRADED',
        'FULL_WARNING_MISSING',
        'TITLE_MARKER_MISSING',
      ]),
    );
  });

  it('returns only locator/hash evidence for NO/LIGHT answer-style candidates', () => {
    const original = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const payload = {
      ...original,
      blocks: original.blocks.map((block, index) =>
        index === 0 ? { ...block, text: '凶手是合成人物乙。' } : block,
      ),
    };
    const result = evaluateSpoilerQuality(input(payload));
    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(result.findings[0]).toMatchObject({
      disposition: 'REVIEW_REQUIRED',
      reasonCode: 'ANSWER_STYLE_CANDIDATE',
      startCodePoint: 0,
      surface: 'BODY_BLOCK',
    });
    expect(result.findings[0]?.endCodePoint).toBeGreaterThan(0);
    expect(JSON.stringify(result.findings)).not.toContain('合成人物乙');
  });

  it('never silently passes ambiguous generic warnings or a truncated scan', () => {
    const generic = lightPayload();
    const ambiguous = evaluateSpoilerQuality(
      input({
        ...generic,
        spoilerWarnings: { ...generic.spoilerWarnings, bodyOpeningWarningText: '剧透预警' },
      }),
    );
    expect(ambiguous.status).toBe('REVIEW_REQUIRED');
    expect(ambiguous.reasonCodes).toContain('WARNING_SCOPE_AMBIGUOUS');

    const original = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const large = {
      ...original,
      blocks: original.blocks.map((block, index) =>
        index < 2 ? { ...block, text: '合'.repeat(15_000) } : block,
      ),
    };
    const truncated = evaluateSpoilerQuality(input(large));
    expect(truncated.status).toBe('REVIEW_REQUIRED');
    expect(truncated).toMatchObject({ truncated: true });
    expect(truncated.reasonCodes).toEqual(
      expect.arrayContaining(['FINDINGS_TRUNCATED', 'SCAN_TRUNCATED']),
    );
  });

  it('excludes time, AI disclosure and copyright metadata from status and input identity', () => {
    const payload = completeCopyPayload('FULL_TRICK_LOGIC_ANALYSIS');
    const first = evaluateSpoilerQuality(
      Object.assign(input(payload), { aiDisclosure: false, copyrightRisk: 'HIGH' }),
    );
    const second = evaluateSpoilerQuality(
      Object.assign(input(payload, { evaluatedAt: '2030-01-01T00:00:00.000Z' }), {
        aiDisclosure: true,
        copyrightRisk: 'LOW',
      }),
    );
    expect(second.status).toBe(first.status);
    expect(second.inputHash).toBe(first.inputHash);
  });
});
