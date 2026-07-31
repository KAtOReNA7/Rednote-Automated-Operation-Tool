import type { ContentDraftPayloadV1, DraftLineageRefV1 } from '@mystery-operations/copy';

import { createDraftTextLocator, materializeDraftPublicArtifacts } from './artifacts.js';
import type { DraftTextLocatorV1 } from './contracts.js';
import { ReadingAuthenticityError } from './errors.js';
import { factMappingHash, normalizeDraftText } from './identity.js';
import { segmentStatementText } from './statements.js';

export const READING_AUTHENTICITY_CHECKER_VERSION = 'reading-authenticity-checker-v1' as const;
export const READING_AUTHENTICITY_POLICY_VERSION = 'reading-authenticity-policy-v1' as const;
export const READING_AUTHENTICITY_CONFIRMATION_LITERAL = 'SAVE_READING_AUTHENTICITY_CHECK' as const;

export const READING_AUTHENTICITY_STATUSES = [
  'PASS',
  'BLOCKED',
  'REVIEW_REQUIRED',
  'STALE',
  'NOT_RUN',
] as const;
export type ReadingAuthenticityStatus = (typeof READING_AUTHENTICITY_STATUSES)[number];
export type ReadingAuthenticityEvaluationStatus = Exclude<
  ReadingAuthenticityStatus,
  'STALE' | 'NOT_RUN'
>;

export const READING_AUTHENTICITY_REASON_CODES = [
  'UNSUPPORTED_FIRSTHAND_EXPERIENCE',
  'FIRST_PERSON_PERMISSION_STALE',
  'R2_ASSERTION_NOT_EXACT',
  'FIRST_PERSON_REVIEW_REQUIRED',
  'SCORE_SOURCE_AMBIGUOUS',
  'MULTIPLE_SCORE_EXPRESSIONS',
  'SCORE_PLAN_CONFLICT',
  'PERSONAL_SCORE_NOT_CURRENT',
  'PERSONAL_SCORE_VALUE_MISMATCH',
  'RESEARCH_SCORE_NOT_CURRENT',
  'RESEARCH_SCORE_VALUE_MISMATCH',
  'RESEARCH_SCORE_LABEL_MISSING',
  'INTERNAL_PREDICTION_PUBLIC',
  'FINDINGS_TRUNCATED',
] as const;
export type ReadingAuthenticityReasonCode = (typeof READING_AUTHENTICITY_REASON_CODES)[number];

export interface ReadingAuthenticityAssertionTruth {
  readonly assertionId: string;
  readonly assertionRevisionId: string;
  readonly confirmationScope: 'EXACT_STATEMENT' | 'EXACT_STRUCTURED_OPINION';
  readonly current: boolean;
  readonly statementHash: string;
}

export interface ReadingAuthenticityScoreTruth {
  readonly id: string;
  readonly readingStateRevisionId: string;
  readonly revision: number;
  readonly scoreBasisPoints: number;
  readonly provenance: 'USER_UI' | 'LEGACY_MIGRATION';
}

export interface ReadingAuthenticityResearchScoreTruth extends ReadingAuthenticityScoreTruth {
  readonly dossierId: string;
  readonly dossierVersionId: string;
  readonly publicLabel: '资料分析评分';
}

export interface ReadingAuthenticityWorkTruth {
  readonly assertions: readonly ReadingAuthenticityAssertionTruth[];
  readonly dossier: {
    readonly currentVersionId: string;
    readonly dossierId: string;
    readonly readinessStatus: string;
    readonly state: string;
  } | null;
  readonly personalScore: ReadingAuthenticityScoreTruth | null;
  readonly permission: {
    readonly current: boolean;
    readonly dependencyHash: string | null;
    readonly firstPersonPermission: string | null;
    readonly personalScorePermission: string | null;
    readonly researchScorePermission: string | null;
    readonly snapshotId: string | null;
  };
  readonly readingState: 'R1' | 'R2' | 'R3' | 'S1' | 'S2' | 'UNCLASSIFIED';
  readonly readingStateRevisionId: string | null;
  readonly readingStateRevision: number | null;
  readonly researchScore: ReadingAuthenticityResearchScoreTruth | null;
  readonly workId: string;
}

export interface ReadingAuthenticityFinding {
  readonly disposition: 'BLOCKED' | 'REVIEW_REQUIRED';
  readonly locator: DraftTextLocatorV1;
  readonly reasonCode: ReadingAuthenticityReasonCode;
}

export interface ReadingAuthenticityEvaluation {
  readonly checkerVersion: typeof READING_AUTHENTICITY_CHECKER_VERSION;
  readonly counts: { readonly blocked: number; readonly reviewRequired: number };
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftVersionId: string;
  readonly evaluatedAt: string;
  readonly findings: readonly ReadingAuthenticityFinding[];
  readonly inputHash: string;
  readonly policyVersion: typeof READING_AUTHENTICITY_POLICY_VERSION;
  readonly reasonCodes: readonly ReadingAuthenticityReasonCode[];
  readonly status: ReadingAuthenticityEvaluationStatus;
  readonly truncated: boolean;
}

export interface EvaluateReadingAuthenticityInput {
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftStatus: string;
  readonly draftVersionId: string;
  readonly evaluatedAt: string;
  readonly payload: ContentDraftPayloadV1;
  readonly structuralValid: boolean;
  readonly truths: readonly ReadingAuthenticityWorkTruth[];
}

interface LocatedScore {
  readonly basisPoints: number | null;
  readonly denominator: number | null;
  readonly endCodePoint: number;
  readonly origin: 'PERSONAL' | 'RESEARCH' | 'UNKNOWN';
  readonly startCodePoint: number;
}

const FIRSTHAND =
  /(?:我(?:读完|看完|读过|看过|重读|重看|亲自读|亲自看)|我的阅读(?:经历|体验|感受)|读完后我|看完后我)/u;
const FIRST_PERSON = /(?:我认为|我觉得|在我看来|我的看法|我更(?:喜欢|推荐))/u;
const INTERNAL_SCORE = /(?:内部预测分|系统预测分|INTERNAL[_ -]?PREDICTION)/iu;
const RESEARCH_LABEL = /资料分析评分/u;
const PERSONAL_LABEL = /(?:个人评分|我给(?:它|这本书)?)/u;
const MAX_FINDINGS = 16;
const MAX_DETAILS_BYTES = 3_500;

function codePointOffset(text: string, utf16Offset: number): number {
  return Array.from(text.slice(0, utf16Offset)).length;
}

function artifactLineage(
  payload: ContentDraftPayloadV1,
  artifactKind: DraftTextLocatorV1['artifactKind'],
  artifactId: string,
): readonly DraftLineageRefV1[] {
  if (artifactKind === 'SELECTED_TITLE') {
    return payload.titles.find(({ titleId }) => titleId === artifactId)?.lineage ?? [];
  }
  if (artifactKind === 'BODY_BLOCK') {
    return payload.blocks.find(({ blockId }) => blockId === artifactId)?.lineage ?? [];
  }
  if (artifactKind === 'TAG') {
    return payload.tags.find(({ tagId }) => tagId === artifactId)?.lineage ?? [];
  }
  return payload.pinnedComment?.lineage ?? [];
}

function scaleDenominator(scale: string | null): number | null {
  if (scale === null) return null;
  const value = scale.trim().toUpperCase().replace(/\s+/gu, '_');
  if (['5', '5星', '5_STAR', 'FIVE_STAR'].includes(value)) return 5;
  if (['10', '10分', '10_POINT', 'TEN_POINT'].includes(value)) return 10;
  if (['100', '100分', '100_POINT'].includes(value)) return 100;
  return null;
}

function scoreOrigin(text: string): LocatedScore['origin'] {
  if (RESEARCH_LABEL.test(text)) return 'RESEARCH';
  if (PERSONAL_LABEL.test(text)) return 'PERSONAL';
  return 'UNKNOWN';
}

function scoreMatches(text: string, planScale: string | null): readonly LocatedScore[] {
  const matches: LocatedScore[] = [];
  const explicit = /([0-9]{1,3}(?:\.[0-9]{1,2})?)\s*\/\s*(5|10|100)(?:\s*(?:分|星))?/gu;
  for (const match of text.matchAll(explicit)) {
    const value = Number(match[1]);
    const denominator = Number(match[2]);
    matches.push({
      basisPoints:
        Number.isFinite(value) && value >= 0 && value <= denominator
          ? Math.round((value / denominator) * 10_000)
          : null,
      denominator,
      endCodePoint: codePointOffset(text, (match.index ?? 0) + match[0].length),
      origin: scoreOrigin(text),
      startCodePoint: codePointOffset(text, match.index ?? 0),
    });
  }
  const labelled =
    /(?:个人评分|资料分析评分|评分|打分|我给(?:它|这本书)?)[：:\s]*([0-9]{1,3}(?:\.[0-9]{1,2})?)\s*(分|星)/gu;
  for (const match of text.matchAll(labelled)) {
    const start = codePointOffset(text, match.index ?? 0);
    const end = codePointOffset(text, (match.index ?? 0) + match[0].length);
    if (matches.some((item) => item.startCodePoint <= start && item.endCodePoint >= end)) continue;
    const denominator = match[2] === '星' ? 5 : scaleDenominator(planScale);
    const value = Number(match[1]);
    matches.push({
      basisPoints:
        denominator !== null && Number.isFinite(value) && value >= 0 && value <= denominator
          ? Math.round((value / denominator) * 10_000)
          : null,
      denominator,
      endCodePoint: end,
      origin: scoreOrigin(match[0]),
      startCodePoint: start,
    });
  }
  return Object.freeze(matches.sort((left, right) => left.startCodePoint - right.startCodePoint));
}

function relevantTruths(
  artifactWorkIds: readonly string[],
  payloadWorkIds: readonly string[],
  truths: readonly ReadingAuthenticityWorkTruth[],
): readonly ReadingAuthenticityWorkTruth[] {
  const ids = artifactWorkIds.length > 0 ? artifactWorkIds : payloadWorkIds;
  return truths.filter(({ workId }) => ids.includes(workId));
}

function exactR2Assertion(
  textHash: string,
  lineages: readonly DraftLineageRefV1[],
  truths: readonly ReadingAuthenticityWorkTruth[],
): boolean {
  const allowedIds = new Set(
    lineages.flatMap(({ experienceAssertionId }) =>
      experienceAssertionId === null ? [] : [experienceAssertionId],
    ),
  );
  return truths.some(
    (truth) =>
      truth.readingState === 'R2' &&
      truth.permission.current &&
      truth.assertions.some(
        (assertion) =>
          allowedIds.has(assertion.assertionId) &&
          assertion.current &&
          assertion.confirmationScope === 'EXACT_STRUCTURED_OPINION' &&
          assertion.statementHash === textHash,
      ),
  );
}

function scoreFinding(
  match: LocatedScore,
  input: EvaluateReadingAuthenticityInput,
  relevant: readonly ReadingAuthenticityWorkTruth[],
  allPublicText: string,
): readonly [ReadingAuthenticityReasonCode, 'BLOCKED' | 'REVIEW_REQUIRED'] | null {
  const plan = input.payload.brief.scorePlan;
  if (match.basisPoints === null || match.denominator === null || match.origin === 'UNKNOWN') {
    return ['SCORE_SOURCE_AMBIGUOUS', 'REVIEW_REQUIRED'];
  }
  const expectedKind = match.origin === 'PERSONAL' ? 'PERSONAL_SCORE' : 'RESEARCH_ANALYSIS_SCORE';
  if (plan.kind !== expectedKind || plan.valueSourceId === null) {
    return ['SCORE_PLAN_CONFLICT', 'BLOCKED'];
  }
  if (expectedKind === 'PERSONAL_SCORE') {
    const sources = relevant.filter(
      ({ personalScore }) => personalScore?.id === plan.valueSourceId,
    );
    const source = sources.length === 1 ? sources[0] : undefined;
    if (
      source === undefined ||
      source.readingState !== 'R1' ||
      !source.permission.current ||
      source.permission.personalScorePermission !== 'ALLOWED' ||
      source.personalScore?.provenance !== 'USER_UI' ||
      source.personalScore.readingStateRevisionId !== source.readingStateRevisionId
    ) {
      return ['PERSONAL_SCORE_NOT_CURRENT', 'BLOCKED'];
    }
    return source.personalScore.scoreBasisPoints === match.basisPoints
      ? null
      : ['PERSONAL_SCORE_VALUE_MISMATCH', 'BLOCKED'];
  }
  const sources = relevant.filter(({ researchScore }) => researchScore?.id === plan.valueSourceId);
  const source = sources.length === 1 ? sources[0] : undefined;
  if (
    source === undefined ||
    !source.permission.current ||
    source.permission.researchScorePermission !== 'RESEARCH_ONLY' ||
    source.researchScore?.provenance !== 'USER_UI' ||
    source.researchScore.readingStateRevisionId !== source.readingStateRevisionId ||
    source.dossier === null ||
    source.dossier.state !== 'CURRENT' ||
    source.dossier.readinessStatus !== 'READY_FOR_CONTENT_BRIEF' ||
    source.dossier.dossierId !== source.researchScore.dossierId ||
    source.dossier.currentVersionId !== source.researchScore.dossierVersionId
  ) {
    return ['RESEARCH_SCORE_NOT_CURRENT', 'BLOCKED'];
  }
  if (!RESEARCH_LABEL.test(allPublicText)) {
    return ['RESEARCH_SCORE_LABEL_MISSING', 'BLOCKED'];
  }
  return source.researchScore.scoreBasisPoints === match.basisPoints
    ? null
    : ['RESEARCH_SCORE_VALUE_MISMATCH', 'BLOCKED'];
}

export function evaluateReadingAuthenticity(
  input: EvaluateReadingAuthenticityInput,
): ReadingAuthenticityEvaluation {
  if (!Number.isSafeInteger(input.draftRevision) || input.draftRevision < 0) {
    throw new ReadingAuthenticityError('READING_AUTHENTICITY_INVALID_CONTRACT');
  }
  let artifacts;
  try {
    artifacts = materializeDraftPublicArtifacts({
      current: true,
      draftId: input.draftId,
      draftStatus: input.draftStatus,
      draftVersionId: input.draftVersionId,
      payload: input.payload,
      structuralValid: input.structuralValid,
    });
  } catch {
    throw new ReadingAuthenticityError('READING_AUTHENTICITY_NOT_READY');
  }
  const allPublicText = artifacts.map(({ text }) => text).join('\n');
  const findings: ReadingAuthenticityFinding[] = [];
  const push = (
    materialized: (typeof artifacts)[number],
    startCodePoint: number,
    endCodePoint: number,
    reasonCode: ReadingAuthenticityReasonCode,
    disposition: ReadingAuthenticityFinding['disposition'],
  ) => {
    findings.push({
      disposition,
      locator: createDraftTextLocator(materialized, startCodePoint, endCodePoint),
      reasonCode,
    });
  };

  for (const materialized of artifacts) {
    const lineages = artifactLineage(
      input.payload,
      materialized.artifact.artifactKind,
      materialized.artifact.artifactId,
    );
    const relevant = relevantTruths(
      materialized.artifact.workIds,
      input.payload.brief.workIds,
      input.truths,
    );
    for (const segment of segmentStatementText(materialized.text)) {
      if (INTERNAL_SCORE.test(segment.text)) {
        push(
          materialized,
          segment.startCodePoint,
          segment.endCodePoint,
          'INTERNAL_PREDICTION_PUBLIC',
          'BLOCKED',
        );
      }
      const scoreExpressions = scoreMatches(segment.text, input.payload.brief.scorePlan.scale);
      if (scoreExpressions.length > 1) {
        push(
          materialized,
          segment.startCodePoint,
          segment.endCodePoint,
          'MULTIPLE_SCORE_EXPRESSIONS',
          'REVIEW_REQUIRED',
        );
      } else if (scoreExpressions[0] !== undefined) {
        const match = scoreExpressions[0];
        const result = scoreFinding(match, input, relevant, allPublicText);
        if (result !== null) {
          push(
            materialized,
            segment.startCodePoint + match.startCodePoint,
            segment.startCodePoint + match.endCodePoint,
            result[0],
            result[1],
          );
        }
      }
      if (FIRSTHAND.test(segment.text)) {
        const allowed =
          relevant.length > 0 &&
          relevant.every(
            (truth) =>
              truth.readingState === 'R1' &&
              truth.permission.current &&
              truth.permission.firstPersonPermission === 'ALLOWED',
          );
        if (!allowed) {
          push(
            materialized,
            segment.startCodePoint,
            segment.endCodePoint,
            relevant.some(({ permission }) => !permission.current)
              ? 'FIRST_PERSON_PERMISSION_STALE'
              : 'UNSUPPORTED_FIRSTHAND_EXPERIENCE',
            'BLOCKED',
          );
        }
      } else if (FIRST_PERSON.test(segment.text)) {
        const textHash = factMappingHash(normalizeDraftText(segment.text));
        const r1Allowed =
          relevant.length > 0 &&
          relevant.every(
            (truth) =>
              truth.readingState === 'R1' &&
              truth.permission.current &&
              truth.permission.firstPersonPermission === 'ALLOWED',
          );
        if (!r1Allowed && !exactR2Assertion(textHash, lineages, relevant)) {
          push(
            materialized,
            segment.startCodePoint,
            segment.endCodePoint,
            relevant.some(({ readingState }) => readingState === 'R2')
              ? 'R2_ASSERTION_NOT_EXACT'
              : 'FIRST_PERSON_REVIEW_REQUIRED',
            'REVIEW_REQUIRED',
          );
        }
      }
    }
  }

  const reasonCodes = new Set<ReadingAuthenticityReasonCode>(
    findings.map(({ reasonCode }) => reasonCode),
  );
  let selected = findings.slice(0, MAX_FINDINGS);
  let truncated = selected.length < findings.length;
  while (
    selected.length > 0 &&
    Buffer.byteLength(
      JSON.stringify({ findings: selected, reasonCodes: [...reasonCodes] }),
      'utf8',
    ) > MAX_DETAILS_BYTES
  ) {
    selected = selected.slice(0, -1);
    truncated = true;
  }
  if (truncated) reasonCodes.add('FINDINGS_TRUNCATED');
  const blocked = findings.filter(({ disposition }) => disposition === 'BLOCKED').length;
  const reviewRequired = findings.length - blocked;
  const status: ReadingAuthenticityEvaluationStatus =
    blocked > 0 ? 'BLOCKED' : reviewRequired > 0 || truncated ? 'REVIEW_REQUIRED' : 'PASS';
  const usedAssertionIds = new Set(
    input.payload.titles
      .flatMap(({ lineage }) => lineage)
      .concat(input.payload.blocks.flatMap(({ lineage }) => lineage))
      .concat(input.payload.tags.flatMap(({ lineage }) => lineage))
      .concat(input.payload.pinnedComment?.lineage ?? [])
      .flatMap(({ experienceAssertionId }) =>
        experienceAssertionId === null ? [] : [experienceAssertionId],
      ),
  );
  const sourceId = input.payload.brief.scorePlan.valueSourceId;
  const inputHash = factMappingHash({
    artifacts: artifacts.map(({ artifact }) => artifact),
    brief: {
      briefInputHash: input.payload.brief.briefInputHash,
      briefVersionId: input.payload.brief.briefVersionId,
      permissionSnapshotId: input.payload.brief.expressionPolicy.permissionSnapshotId,
      scorePlan: input.payload.brief.scorePlan,
    },
    checkerVersion: READING_AUTHENTICITY_CHECKER_VERSION,
    draftId: input.draftId,
    draftRevision: input.draftRevision,
    draftVersionId: input.draftVersionId,
    policyVersion: READING_AUTHENTICITY_POLICY_VERSION,
    truths: input.truths.map((truth) => ({
      assertions: truth.assertions.filter(({ assertionId }) => usedAssertionIds.has(assertionId)),
      dossier: truth.researchScore?.id === sourceId ? truth.dossier : null,
      permission: truth.permission,
      personalScore: truth.personalScore?.id === sourceId ? truth.personalScore : null,
      readingState: truth.readingState,
      readingStateRevision: truth.readingStateRevision,
      readingStateRevisionId: truth.readingStateRevisionId,
      researchScore: truth.researchScore?.id === sourceId ? truth.researchScore : null,
      workId: truth.workId,
    })),
  });
  return Object.freeze({
    checkerVersion: READING_AUTHENTICITY_CHECKER_VERSION,
    counts: Object.freeze({ blocked, reviewRequired }),
    draftId: input.draftId,
    draftRevision: input.draftRevision,
    draftVersionId: input.draftVersionId,
    evaluatedAt: input.evaluatedAt,
    findings: Object.freeze(selected),
    inputHash,
    policyVersion: READING_AUTHENTICITY_POLICY_VERSION,
    reasonCodes: Object.freeze([...reasonCodes].sort()),
    status,
    truncated,
  });
}
