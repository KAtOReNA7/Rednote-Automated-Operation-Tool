import type { ContentDraftPayloadV1, DraftLineageRefV1 } from '@mystery-operations/copy';

import {
  createDraftTextLocator,
  materializeDraftPublicArtifacts,
  type MaterializedDraftArtifactV1,
} from './artifacts.js';
import { factMappingHash, normalizeDraftText } from './identity.js';

export const COPY_INTEGRITY_CHECKER_VERSION = 'copy-integrity-checker-v1' as const;
export const COPY_INTEGRITY_POLICY_VERSION = 'copy-integrity-policy-v1' as const;
export const COPY_INTEGRITY_CORPUS_VERSION = 'eligible-current-draft-corpus-v1' as const;
export const COPY_INTEGRITY_NORMALIZATION_VERSION = 'nfc-lf-whitespace-v1' as const;
export const COPY_INTEGRITY_CONFIRMATION_LITERAL = 'SAVE_COPY_INTEGRITY_CHECKS' as const;

export const COPY_INTEGRITY_LIMITS = Object.freeze({
  corpus: 64,
  findingsPerCheck: 6,
  minimumExactCodePoints: 12,
  shingleCodePoints: 5,
  shinglesPerArtifact: 2_048,
});

export type CopyIntegrityErrorCode =
  | 'COPY_INTEGRITY_INVALID_CONTRACT'
  | 'COPY_INTEGRITY_NOT_FOUND'
  | 'COPY_INTEGRITY_NOT_READY'
  | 'COPY_INTEGRITY_STALE_REVISION'
  | 'COPY_INTEGRITY_CONFIRMATION_INVALID';

export class CopyIntegrityError extends Error {
  public readonly retryable = false;

  public constructor(public readonly code: CopyIntegrityErrorCode) {
    super(code);
    this.name = 'CopyIntegrityError';
  }
}

export type CopyIntegrityCheckType = 'DUPLICATION' | 'TITLE_BODY_CONSISTENCY';
export type CopyIntegrityStatus = 'PASS' | 'BLOCKED' | 'REVIEW_REQUIRED' | 'STALE' | 'NOT_RUN';

export type CopyIntegrityReasonCode =
  | 'CURRENT_EXACT_DUPLICATE'
  | 'CURRENT_CROSS_SURFACE_EXACT_REUSE'
  | 'HISTORICAL_COLLECTION_EXACT_DUPLICATE'
  | 'HISTORICAL_OVERLAP_CANDIDATE'
  | 'CORPUS_TRUNCATED'
  | 'SCAN_TRUNCATED'
  | 'FINDINGS_TRUNCATED'
  | 'PUBLISHED_BASELINE_UNAVAILABLE'
  | 'TITLE_LINEAGE_MISSING'
  | 'BODY_LINEAGE_MISSING'
  | 'TITLE_BODY_LINEAGE_DISJOINT'
  | 'TITLE_BODY_SURFACE_OVERLAP_WEAK'
  | 'LINEAGE_REFERENCE_IMPOSSIBLE';

export interface CopyIntegrityHistoricalTruth {
  readonly contentHash: string;
  readonly draftId: string;
  readonly draftVersionId: string;
  readonly payload: ContentDraftPayloadV1;
}

export interface CopyIntegrityBriefTruth {
  readonly briefId: string;
  readonly currentDependencyHash: string;
  readonly currentInputHash: string;
  readonly currentLockHash: string;
  readonly currentVersionId: string;
  readonly exactDependencyHash: string;
  readonly exactInputHash: string;
  readonly exactLockHash: string;
  readonly exactVersionId: string;
}

export interface EvaluateCopyIntegrityInput {
  readonly brief: CopyIntegrityBriefTruth;
  readonly corpusEligibleCount: number;
  readonly corpusTruncated: boolean;
  readonly current: {
    readonly draftId: string;
    readonly draftRevision: number;
    readonly draftState: string;
    readonly draftStatus: string;
    readonly draftVersionId: string;
    readonly contentHash: string;
    readonly inputHash: string;
    readonly payload: ContentDraftPayloadV1;
    readonly structuralPolicyVersion: string;
    readonly structuralReasonCodes: readonly string[];
    readonly structuralValid: boolean;
  };
  readonly evaluatedAt: string;
  readonly historical: readonly CopyIntegrityHistoricalTruth[];
  readonly publications: {
    readonly exactPublishedDraftVersionIds: readonly string[];
    readonly total: number;
    readonly unavailableLineageCount: number;
  };
}

interface NormalizedArtifact {
  readonly materialized: MaterializedDraftArtifactV1;
  readonly normalizedHash: string;
  readonly normalizedPoints: readonly string[];
}

type Match = { current: NormalizedArtifact; historical: NormalizedArtifact; score: number };

function normalizedCopyText(value: string): string {
  return normalizeDraftText(value)
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{2,}/gu, '\n')
    .trim();
}

function materialize(
  input: Parameters<typeof materializeDraftPublicArtifacts>[0],
  errorCode: CopyIntegrityErrorCode,
): readonly NormalizedArtifact[] {
  try {
    return materializeDraftPublicArtifacts(input).map((materialized) => {
      const points = Array.from(normalizedCopyText(materialized.text));
      return {
        materialized,
        normalizedHash: factMappingHash(points.join('')),
        normalizedPoints: points,
      };
    });
  } catch {
    throw new CopyIntegrityError(errorCode);
  }
}

function materializeHistorical({ draftId, draftVersionId, payload }: CopyIntegrityHistoricalTruth) {
  return materialize(
    {
      current: false,
      draftId,
      draftStatus: 'READY_FOR_QUALITY_PIPELINE',
      draftVersionId,
      payload,
      structuralValid: true,
    },
    'COPY_INTEGRITY_INVALID_CONTRACT',
  );
}

function artifactCollectionHash(artifacts: readonly NormalizedArtifact[]): string {
  return factMappingHash(
    artifacts.map(({ materialized, normalizedHash }) => ({
      artifactKind: materialized.artifact.artifactKind,
      normalizedHash,
      order: materialized.artifact.order,
    })),
  );
}

function shingles(points: readonly string[]) {
  const values = new Set<string>();
  const possible = Math.max(0, points.length - COPY_INTEGRITY_LIMITS.shingleCodePoints + 1);
  const limit = Math.min(possible, COPY_INTEGRITY_LIMITS.shinglesPerArtifact);
  for (let index = 0; index < limit; index += 1) {
    values.add(points.slice(index, index + COPY_INTEGRITY_LIMITS.shingleCodePoints).join(''));
  }
  return { values, truncated: possible > limit };
}

function similarityBasisPoints(left: readonly string[], right: readonly string[]) {
  const leftShingles = shingles(left);
  const rightShingles = shingles(right);
  const denominator = Math.min(leftShingles.values.size, rightShingles.values.size);
  if (denominator === 0) {
    return { score: 0, truncated: leftShingles.truncated || rightShingles.truncated };
  }
  let common = 0;
  for (const value of leftShingles.values) {
    if (rightShingles.values.has(value)) common += 1;
  }
  return {
    score: Math.floor((common * 10_000) / denominator),
    truncated: leftShingles.truncated || rightShingles.truncated,
  };
}

function finding(
  artifact: NormalizedArtifact | undefined,
  reasonCode: CopyIntegrityReasonCode,
  disposition: 'BLOCKED' | 'REVIEW_REQUIRED',
  matched: NormalizedArtifact | null,
  matchedDraftId: string | null,
  similarity: number | null,
) {
  if (artifact === undefined) throw new CopyIntegrityError('COPY_INTEGRITY_NOT_READY');
  const locator = createDraftTextLocator(
    artifact.materialized,
    0,
    artifact.materialized.artifact.codePointLength,
  );
  return {
    disposition,
    locator,
    matchedDraftId,
    matchedDraftVersionId: matched?.materialized.artifact.draftVersionId ?? null,
    matchedIdentityHash:
      matched === null || matchedDraftId === null
        ? null
        : factMappingHash(matched.materialized.artifact),
    reasonCode,
    ruleVersion: COPY_INTEGRITY_POLICY_VERSION,
    similarityBasisPoints: similarity,
    suggestionCode:
      reasonCode === 'TITLE_BODY_SURFACE_OVERLAP_WEAK'
        ? ('REVIEW_SOURCE' as const)
        : reasonCode.includes('LINEAGE')
          ? ('REVIEW_LINEAGE' as const)
          : ('REWRITE_OR_CONFIRM' as const),
  };
}

export type CopyIntegrityFinding = ReturnType<typeof finding>;

function finalizeCheck(
  checkType: CopyIntegrityCheckType,
  allFindings: readonly CopyIntegrityFinding[],
  extraReasons: readonly CopyIntegrityReasonCode[],
  externallyTruncated: boolean,
) {
  const selected = allFindings.slice(0, COPY_INTEGRITY_LIMITS.findingsPerCheck);
  const truncated =
    externallyTruncated || allFindings.length > COPY_INTEGRITY_LIMITS.findingsPerCheck;
  const reasons = new Set<CopyIntegrityReasonCode>([
    ...allFindings.map(({ reasonCode }) => reasonCode),
    ...extraReasons,
  ]);
  if (allFindings.length > COPY_INTEGRITY_LIMITS.findingsPerCheck) {
    reasons.add('FINDINGS_TRUNCATED');
  }
  const blocked = allFindings.filter(({ disposition }) => disposition === 'BLOCKED').length;
  const reviewRequired = allFindings.length - blocked;
  const status: Exclude<CopyIntegrityStatus, 'STALE' | 'NOT_RUN'> =
    blocked > 0
      ? 'BLOCKED'
      : reviewRequired > 0 || truncated || reasons.size > 0
        ? 'REVIEW_REQUIRED'
        : 'PASS';
  return {
    checkType,
    counts: Object.freeze({ blocked, reviewRequired }),
    findings: Object.freeze(selected),
    reasonCodes: Object.freeze([...reasons].sort()),
    status,
    truncated,
  } as const;
}

export type CopyIntegrityCheckEvaluation = ReturnType<typeof finalizeCheck>;

function lineageTruth(values: readonly DraftLineageRefV1[], allowedWorkIds: readonly string[]) {
  const tokens = new Set<string>();
  const allowed = new Set(allowedWorkIds);
  let impossible = false;
  for (const value of values) {
    if (value.workId !== null) tokens.add('work:' + value.workId);
    if (value.argumentId !== null) tokens.add('argument:' + value.argumentId);
    if (value.structureSlotId !== null) tokens.add('slot:' + value.structureSlotId);
    impossible ||=
      (value.workId !== null && !allowed.has(value.workId)) ||
      !/^[0-9a-f]{64}$/u.test(value.inputHash);
  }
  return { impossible, tokens };
}

function duplicationCheck(
  current: readonly NormalizedArtifact[],
  input: EvaluateCopyIntegrityInput,
): CopyIntegrityCheckEvaluation {
  const findings: CopyIntegrityFinding[] = [];
  const extraReasons: CopyIntegrityReasonCode[] = [];
  const add = (...args: Parameters<typeof finding>) => findings.push(finding(...args));
  let scanTruncated = false;

  for (const [leftIndex, left] of current.entries()) {
    if (left.normalizedPoints.length < COPY_INTEGRITY_LIMITS.minimumExactCodePoints) continue;
    for (const right of current.slice(leftIndex + 1)) {
      if (
        left.normalizedHash !== right.normalizedHash ||
        left.normalizedPoints.length !== right.normalizedPoints.length
      )
        continue;
      const sameKind =
        left.materialized.artifact.artifactKind === right.materialized.artifact.artifactKind;
      add(
        left,
        sameKind ? 'CURRENT_EXACT_DUPLICATE' : 'CURRENT_CROSS_SURFACE_EXACT_REUSE',
        sameKind ? 'BLOCKED' : 'REVIEW_REQUIRED',
        right,
        input.current.draftId,
        10_000,
      );
    }
  }

  const currentCollectionHash = artifactCollectionHash(current);
  for (const truth of input.historical) {
    if (truth.draftVersionId === input.current.draftVersionId) continue;
    const historical = materializeHistorical(truth);
    if (truth.draftId === input.current.draftId) continue;
    if (artifactCollectionHash(historical) === currentCollectionHash) {
      add(
        current[0],
        'HISTORICAL_COLLECTION_EXACT_DUPLICATE',
        'BLOCKED',
        historical[0] ?? null,
        truth.draftId,
        10_000,
      );
      continue;
    }
    let best: Match | undefined;
    for (const currentArtifact of current) {
      for (const historicalArtifact of historical) {
        const compared = similarityBasisPoints(
          currentArtifact.normalizedPoints,
          historicalArtifact.normalizedPoints,
        );
        scanTruncated ||= compared.truncated;
        if (
          compared.score >= 8_000 &&
          compared.score < 10_000 &&
          (best === undefined || compared.score > best.score)
        ) {
          best = {
            current: currentArtifact,
            historical: historicalArtifact,
            score: compared.score,
          };
        }
      }
    }
    if (best !== undefined) {
      add(
        best.current,
        'HISTORICAL_OVERLAP_CANDIDATE',
        'REVIEW_REQUIRED',
        best.historical,
        truth.draftId,
        best.score,
      );
    }
  }

  if (input.corpusTruncated) extraReasons.push('CORPUS_TRUNCATED');
  if (scanTruncated) extraReasons.push('SCAN_TRUNCATED');
  if (input.publications.unavailableLineageCount > 0)
    extraReasons.push('PUBLISHED_BASELINE_UNAVAILABLE');
  return finalizeCheck(
    'DUPLICATION',
    findings,
    extraReasons,
    input.corpusTruncated || scanTruncated || input.publications.unavailableLineageCount > 0,
  );
}

function titleBodyCheck(
  current: readonly NormalizedArtifact[],
  payload: ContentDraftPayloadV1,
): CopyIntegrityCheckEvaluation {
  const findings: CopyIntegrityFinding[] = [];
  const title = current.find(
    ({ materialized }) => materialized.artifact.artifactKind === 'SELECTED_TITLE',
  );
  const bodies = current.filter(
    ({ materialized }) => materialized.artifact.artifactKind === 'BODY_BLOCK',
  );
  const [body] = bodies;
  const selected = payload.titles.find(({ titleId }) => titleId === payload.selectedTitleId);
  if (title === undefined || selected === undefined || body === undefined) {
    throw new CopyIntegrityError('COPY_INTEGRITY_NOT_READY');
  }
  const bodyLineages = payload.blocks.flatMap(({ lineage }) => lineage);
  const add = (
    artifact: NormalizedArtifact,
    reason: CopyIntegrityReasonCode,
    disposition: CopyIntegrityFinding['disposition'] = 'REVIEW_REQUIRED',
    matched: NormalizedArtifact | null = null,
    similarity: number | null = null,
  ) =>
    findings.push(
      finding(artifact, reason, disposition, matched, payload.brief.briefId, similarity),
    );
  const titleLineage = lineageTruth(selected.lineage, payload.brief.workIds);
  const bodyLineage = lineageTruth(bodyLineages, payload.brief.workIds);
  if (titleLineage.impossible) add(title, 'LINEAGE_REFERENCE_IMPOSSIBLE', 'BLOCKED');
  if (bodyLineage.impossible) add(body, 'LINEAGE_REFERENCE_IMPOSSIBLE', 'BLOCKED');
  const titleTokens = titleLineage.tokens;
  const bodyTokens = bodyLineage.tokens;
  if (titleTokens.size === 0) add(title, 'TITLE_LINEAGE_MISSING');
  if (bodyTokens.size === 0) add(body, 'BODY_LINEAGE_MISSING');
  if (
    titleTokens.size > 0 &&
    bodyTokens.size > 0 &&
    ![...titleTokens].some((token) => bodyTokens.has(token))
  ) {
    add(title, 'TITLE_BODY_LINEAGE_DISJOINT', 'REVIEW_REQUIRED', body);
  }
  const surface = similarityBasisPoints(
    title.normalizedPoints,
    bodies.flatMap(({ normalizedPoints }) => normalizedPoints),
  );
  if (surface.score < 1_000)
    add(title, 'TITLE_BODY_SURFACE_OVERLAP_WEAK', 'REVIEW_REQUIRED', body, surface.score);
  return finalizeCheck(
    'TITLE_BODY_CONSISTENCY',
    findings,
    surface.truncated ? ['SCAN_TRUNCATED'] : [],
    surface.truncated,
  );
}
export function evaluateCopyIntegrity(input: EvaluateCopyIntegrityInput) {
  if (
    !Number.isSafeInteger(input.current.draftRevision) ||
    input.current.draftRevision < 0 ||
    input.current.draftState !== 'ACTIVE' ||
    input.current.draftStatus !== 'READY_FOR_QUALITY_PIPELINE' ||
    !input.current.structuralValid ||
    input.historical.length > COPY_INTEGRITY_LIMITS.corpus ||
    input.corpusEligibleCount < input.historical.length ||
    input.publications.total < 0 ||
    input.publications.unavailableLineageCount < 0 ||
    input.publications.exactPublishedDraftVersionIds.length +
      input.publications.unavailableLineageCount !==
      input.publications.total
  ) {
    throw new CopyIntegrityError('COPY_INTEGRITY_INVALID_CONTRACT');
  }
  const { payload, ...currentTruth } = input.current;
  const current = materialize(
    {
      current: true,
      draftId: input.current.draftId,
      draftStatus: input.current.draftStatus,
      draftVersionId: input.current.draftVersionId,
      payload,
      structuralValid: input.current.structuralValid,
    },
    'COPY_INTEGRITY_NOT_READY',
  );
  if (
    payload.brief.briefId !== input.brief.briefId ||
    payload.brief.briefVersionId !== input.brief.exactVersionId
  ) {
    throw new CopyIntegrityError('COPY_INTEGRITY_INVALID_CONTRACT');
  }
  const duplication = duplicationCheck(current, input);
  const titleBody = titleBodyCheck(current, payload);
  const inputHash = factMappingHash({
    brief: input.brief,
    checkerVersion: COPY_INTEGRITY_CHECKER_VERSION,
    corpus: {
      eligibleCount: input.corpusEligibleCount,
      items: input.historical.map((truth) => ({
        collectionHash: artifactCollectionHash(materializeHistorical(truth)),
        contentHash: truth.contentHash,
        draftId: truth.draftId,
        draftVersionId: truth.draftVersionId,
      })),
      truncated: input.corpusTruncated,
      version: COPY_INTEGRITY_CORPUS_VERSION,
    },
    current: {
      ...currentTruth,
      artifactIdentityHash: factMappingHash(
        current.map(({ materialized, normalizedHash }) => ({
          ...materialized.artifact,
          normalizedHash,
        })),
      ),
      contractVersions: {
        contract: payload.contractVersion,
        format: payload.formatPolicyVersion,
        profile: payload.profileVersion,
        schema: payload.schemaVersion,
        voice: payload.voicePolicyVersion,
      },
      lineageHash: factMappingHash(
        payload.titles
          .filter(({ titleId }) => titleId === payload.selectedTitleId)
          .flatMap(({ lineage }) => lineage)
          .concat(payload.blocks.flatMap(({ lineage }) => lineage)),
      ),
    },
    normalizationVersion: COPY_INTEGRITY_NORMALIZATION_VERSION,
    policyVersion: COPY_INTEGRITY_POLICY_VERSION,
    publications: input.publications,
  });
  return Object.freeze({
    briefVersionId: input.brief.exactVersionId,
    checkerVersion: COPY_INTEGRITY_CHECKER_VERSION,
    checks: Object.freeze([duplication, titleBody] as const),
    draftId: input.current.draftId,
    draftRevision: input.current.draftRevision,
    draftVersionId: input.current.draftVersionId,
    evaluatedAt: input.evaluatedAt,
    inputHash,
    internalConsistencyStatus: 'NOT_RUN',
    policyVersion: COPY_INTEGRITY_POLICY_VERSION,
    structuralOutputStatus: input.current.structuralValid ? 'PASS' : 'BLOCKED',
  });
}

export type CopyIntegrityEvaluation = ReturnType<typeof evaluateCopyIntegrity>;
