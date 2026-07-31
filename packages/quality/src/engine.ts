import { FACT_MAPPING_CHECKER_VERSION } from './constants.js';
import {
  createDraftStatement,
  createDraftTextLocator,
  detectWarningBoundaryEscapes,
  type MaterializedDraftArtifactV1,
  type WarningBoundaryEscapeV1,
} from './artifacts.js';
import { checkTypedFactCompatibility } from './compatibility.js';
import type {
  ClaimCandidateSetV1,
  ClaimCandidateV1,
  FactMappingRollupV1,
  FactMappingStatementResultV1,
  StatementClaimMappingV1,
} from './contracts.js';
import { factMappingHash } from './identity.js';
import { createStatementClaimMapping } from './mapping.js';
import { evaluateStatementDisposition, rollupFactMapping } from './rollup.js';
import { classifyStatement, detectProtectedSignals, segmentStatementText } from './statements.js';

export interface DeterministicStatementBundleV1 {
  readonly result: FactMappingStatementResultV1;
  readonly signals: ReturnType<typeof detectProtectedSignals>;
}

export interface DeterministicFactMappingV1 {
  readonly artifactHash: string;
  readonly checkerVersion: typeof FACT_MAPPING_CHECKER_VERSION;
  readonly inputHash: string;
  readonly rollup: FactMappingRollupV1;
  readonly statements: readonly DeterministicStatementBundleV1[];
  readonly warningBoundaryEscapes: readonly WarningBoundaryEscapeV1[];
}

function compatibleCandidates(
  statementText: string,
  artifact: MaterializedDraftArtifactV1,
  candidates: ClaimCandidateSetV1,
): readonly {
  readonly candidate: ClaimCandidateV1;
  readonly compatibility: ReturnType<typeof checkTypedFactCompatibility>;
}[] {
  return Object.freeze(
    candidates.candidates.flatMap((candidate) => {
      const expectedSubjectId =
        artifact.artifact.workIds.length === 1 && candidate.claim.subject.type === 'WORK'
          ? artifact.artifact.workIds[0]
          : undefined;
      const compatibility = checkTypedFactCompatibility({
        claim: candidate.claim,
        ...(expectedSubjectId === undefined ? {} : { expectedSubjectId }),
        relation: 'EXACT',
        statementText,
      });
      return compatibility.compatible ? [{ candidate, compatibility }] : [];
    }),
  );
}

export function buildDeterministicFactMapping(input: {
  readonly artifacts: readonly MaterializedDraftArtifactV1[];
  readonly candidates: ClaimCandidateSetV1;
  readonly createdAt: string;
  readonly warningBoundaryEscapes?: readonly WarningBoundaryEscapeV1[];
}): DeterministicFactMappingV1 {
  const bundles: DeterministicStatementBundleV1[] = [];
  let statementOrder = 0;
  for (const artifact of input.artifacts) {
    for (const segment of segmentStatementText(artifact.text)) {
      const locator = createDraftTextLocator(
        artifact,
        segment.startCodePoint,
        segment.endCodePoint,
      );
      const statementId = `statement-${factMappingHash({
        artifactId: artifact.artifact.artifactId,
        artifactKind: artifact.artifact.artifactKind,
        draftVersionId: artifact.artifact.draftVersionId,
        end: segment.endCodePoint,
        start: segment.startCodePoint,
      }).slice(0, 32)}`;
      const statement = createDraftStatement({
        classification: classifyStatement(segment.text),
        createdAt: input.createdAt,
        locator,
        provenance: 'DETERMINISTIC',
        statementId,
      });
      const signals = detectProtectedSignals(segment.text);
      let selectedMapping: StatementClaimMappingV1 | null = null;
      if (statement.classification.kind === 'FACT') {
        const matches = compatibleCandidates(segment.text, artifact, input.candidates);
        if (matches.length === 1) {
          const match = matches[0];
          if (match !== undefined) {
            selectedMapping = createStatementClaimMapping({
              candidate: match.candidate,
              compatibility: match.compatibility,
              createdAt: input.createdAt,
              mapperProvenance: 'DETERMINISTIC',
              reason: null,
              relation: 'EXACT',
              statement,
              statementText: segment.text,
            });
          }
        } else if (matches.length > 1) {
          const match = matches[0];
          if (match !== undefined) {
            selectedMapping = createStatementClaimMapping({
              candidate: match.candidate,
              compatibility: Object.freeze({
                ...match.compatibility,
                compatible: false,
                reasonCode: 'STATEMENT_ADDS_VALUE',
                relation: 'MULTIPLE_CANDIDATES',
              }),
              createdAt: input.createdAt,
              mapperProvenance: 'DETERMINISTIC',
              reason: null,
              relation: 'MULTIPLE_CANDIDATES',
              statement,
              statementText: segment.text,
            });
          }
        }
      }
      bundles.push(
        Object.freeze({
          result: evaluateStatementDisposition({
            mapping: selectedMapping,
            signalsUnacknowledged: statement.classification.kind === 'FACT' ? 0 : signals.length,
            statement,
          }),
          signals,
        }),
      );
      statementOrder += 1;
    }
  }
  const warningBoundaryEscapes = Object.freeze([...(input.warningBoundaryEscapes ?? [])]);
  const results = bundles.map(({ result }) => result);
  const artifactHash = factMappingHash(input.artifacts.map(({ artifact }) => artifact));
  return Object.freeze({
    artifactHash,
    checkerVersion: FACT_MAPPING_CHECKER_VERSION,
    inputHash: factMappingHash({
      artifactHash,
      candidateInputHash: input.candidates.inputHash,
      statementHashes: results.map(({ statement }) => statement.textHash),
      statementOrder,
    }),
    rollup: rollupFactMapping(results, {
      warningBoundaryEscapeCount: warningBoundaryEscapes.length,
    }),
    statements: Object.freeze(bundles),
    warningBoundaryEscapes,
  });
}

export function buildWarningBoundaryEscapes(
  payload: Parameters<typeof detectWarningBoundaryEscapes>[0],
): readonly WarningBoundaryEscapeV1[] {
  return detectWarningBoundaryEscapes(payload);
}
