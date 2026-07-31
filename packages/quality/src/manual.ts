import {
  createDraftStatement,
  createDraftTextLocator,
  type MaterializedDraftArtifactV1,
  type WarningBoundaryEscapeV1,
} from './artifacts.js';
import {
  FACT_MAPPING_CHECKER_VERSION,
  FACT_MAPPING_CLASSIFICATION_VERSION,
  type FactDomain,
  type FactMateriality,
  type MappingRelation,
  type StatementDisposition,
  type StatementKind,
} from './constants.js';
import {
  assertClassification,
  type ClaimCandidateSetV1,
  type DraftStatementV1,
  type FactMappingRollupV1,
  type FactMappingStatementResultV1,
  type ProtectedSignalV1,
} from './contracts.js';
import { FactMappingError } from './errors.js';
import { evaluateCandidateFactPolicy } from './fact-policy.js';
import { factMappingHash } from './identity.js';
import { createStatementClaimMapping } from './mapping.js';
import { evaluateStatementDisposition, rollupFactMapping } from './rollup.js';
import { classifyStatement, detectProtectedSignals } from './statements.js';

export interface FactMappingEditableBundleV1 {
  readonly fragment: string;
  readonly result: FactMappingStatementResultV1;
  readonly signals: readonly ProtectedSignalV1[];
}

interface DecisionBase {
  readonly draftId: string;
  readonly expectedRevision: number;
  readonly reason: string | null;
  readonly statementId: string;
}

export type FactMappingManualDecisionInputV1 =
  | (DecisionBase & { readonly kind: 'CONFIRM_CLASSIFICATION' })
  | (DecisionBase & {
      readonly domain: FactDomain;
      readonly kind: 'RECLASSIFY';
      readonly materiality: FactMateriality;
      readonly statementKind: StatementKind;
    })
  | (DecisionBase & {
      readonly kind: 'SPLIT';
      readonly splitCodePoint: number;
    })
  | (DecisionBase & {
      readonly claimId: string;
      readonly kind: 'MAP_CLAIM';
      readonly relation: Extract<
        MappingRelation,
        'EXACT' | 'NARROWER_THAN_CLAIM' | 'SUPPORTED_PARAPHRASE'
      >;
    })
  | (DecisionBase & { readonly kind: 'UNMAP_CLAIM' })
  | (DecisionBase & {
      readonly kind: 'UNDO';
      readonly targetVersionId: string;
    })
  | (DecisionBase & { readonly kind: 'REOPEN' });

export interface FactMappingDecisionSummaryV1 {
  readonly claimId: string | null;
  readonly disposition: StatementDisposition;
  readonly domain: FactDomain;
  readonly kind: StatementKind;
  readonly materiality: FactMateriality;
  readonly relation: MappingRelation | null;
}

export interface FactMappingManualProjectionV1 {
  readonly after: FactMappingDecisionSummaryV1;
  readonly artifactHash: string;
  readonly before: FactMappingDecisionSummaryV1;
  readonly checkerVersion: typeof FACT_MAPPING_CHECKER_VERSION;
  readonly inputHash: string;
  readonly rollup: FactMappingRollupV1;
  readonly statements: readonly FactMappingEditableBundleV1[];
  readonly warningBoundaryEscapes: readonly WarningBoundaryEscapeV1[];
}

function summary(result: FactMappingStatementResultV1): FactMappingDecisionSummaryV1 {
  return Object.freeze({
    claimId: result.mapping?.claimId ?? null,
    disposition: result.disposition,
    domain: result.statement.classification.domain,
    kind: result.statement.classification.kind,
    materiality: result.statement.classification.materiality,
    relation: result.mapping?.relation ?? null,
  });
}

function boundedReason(reason: string | null): string | null {
  if (reason === null) return null;
  const value = reason.trim();
  if (value.length === 0 || Array.from(value).length > 500) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return value;
}

function artifactFor(
  artifacts: ReadonlyMap<string, MaterializedDraftArtifactV1>,
  statement: DraftStatementV1,
): MaterializedDraftArtifactV1 {
  const artifact = artifacts.get(
    `${statement.locator.artifactKind}:${statement.locator.artifactId}`,
  );
  if (artifact === undefined) throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
  return artifact;
}

function cloneStatement(
  statement: DraftStatementV1,
  classification: DraftStatementV1['classification'],
  createdAt: string,
  idSeed: string,
  provenance: DraftStatementV1['provenance'],
  revision: number,
): DraftStatementV1 {
  return createDraftStatement({
    classification,
    createdAt,
    locator: statement.locator,
    provenance,
    revision,
    statementId: `statement-${factMappingHash([
      idSeed,
      statement.statementId,
      statement.locator,
      revision,
    ]).slice(0, 32)}`,
  });
}

function cloneBundle(input: {
  readonly artifacts: ReadonlyMap<string, MaterializedDraftArtifactV1>;
  readonly bundle: FactMappingEditableBundleV1;
  readonly candidates: ClaimCandidateSetV1;
  readonly createdAt: string;
  readonly idSeed: string;
}): FactMappingEditableBundleV1 {
  const old = input.bundle.result;
  const statement = cloneStatement(
    old.statement,
    old.statement.classification,
    input.createdAt,
    input.idSeed,
    old.statement.provenance,
    old.statement.revision,
  );
  const artifact = artifactFor(input.artifacts, statement);
  const mapping = remapExisting({
    artifact,
    candidates: input.candidates,
    createdAt: input.createdAt,
    fragment: input.bundle.fragment,
    mapping: old.mapping,
    statement,
  });
  return Object.freeze({
    fragment: input.bundle.fragment,
    result: evaluateStatementDisposition({
      mapping,
      signalsUnacknowledged:
        statement.classification.kind === 'FACT'
          ? 0
          : input.bundle.signals.filter(({ acknowledged }) => !acknowledged).length,
      statement,
    }),
    signals: Object.freeze([...input.bundle.signals]),
  });
}

function remapExisting(input: {
  readonly artifact: MaterializedDraftArtifactV1;
  readonly candidates: ClaimCandidateSetV1;
  readonly createdAt: string;
  readonly fragment: string;
  readonly mapping: FactMappingStatementResultV1['mapping'];
  readonly statement: DraftStatementV1;
}): FactMappingStatementResultV1['mapping'] {
  if (input.mapping === null || input.mapping.claimId === null) return null;
  const candidate = input.candidates.candidates.find(
    ({ claim }) => claim.claimId === input.mapping?.claimId,
  );
  if (candidate === undefined) {
    throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
  }
  return createStatementClaimMapping({
    candidate,
    createdAt: input.createdAt,
    ...(input.artifact.artifact.workIds.length === 1 &&
    input.artifact.artifact.workIds[0] !== undefined
      ? { expectedSubjectId: input.artifact.artifact.workIds[0] }
      : {}),
    mapperProvenance: input.mapping.mapperProvenance,
    reason: input.mapping.reason,
    relation: input.mapping.relation,
    statement: input.statement,
    statementText: input.fragment,
  });
}

function resultWith(
  statement: DraftStatementV1,
  mapping: FactMappingStatementResultV1['mapping'],
  signals: readonly ProtectedSignalV1[],
): FactMappingStatementResultV1 {
  return evaluateStatementDisposition({
    mapping,
    signalsUnacknowledged:
      statement.classification.kind === 'FACT'
        ? 0
        : signals.filter(({ acknowledged }) => !acknowledged).length,
    statement,
  });
}

function acknowledgeSignals(
  signals: readonly ProtectedSignalV1[],
  reason: string | null,
): readonly ProtectedSignalV1[] {
  return Object.freeze(
    signals.map((signal) =>
      Object.freeze({
        ...signal,
        acknowledged: true,
        reason,
      }),
    ),
  );
}

export function projectFactMappingManualDecision(input: {
  readonly artifactHash: string;
  readonly artifacts: readonly MaterializedDraftArtifactV1[];
  readonly bundles: readonly FactMappingEditableBundleV1[];
  readonly candidates: ClaimCandidateSetV1;
  readonly createdAt: string;
  readonly decision: FactMappingManualDecisionInputV1;
  readonly idSeed: string;
  readonly replacementBundles?: readonly FactMappingEditableBundleV1[];
  readonly warningBoundaryEscapes: readonly WarningBoundaryEscapeV1[];
}): FactMappingManualProjectionV1 {
  const reason = boundedReason(input.decision.reason);
  const artifactMap = new Map(
    input.artifacts.map((artifact) => [
      `${artifact.artifact.artifactKind}:${artifact.artifact.artifactId}`,
      artifact,
    ]),
  );
  const currentIndex = input.bundles.findIndex(
    ({ result }) => result.statement.statementId === input.decision.statementId,
  );
  if (currentIndex < 0) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
  const beforeResult = input.bundles[currentIndex]?.result;
  if (beforeResult === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
  const sourceBundles =
    input.decision.kind === 'UNDO'
      ? (input.replacementBundles ??
        (() => {
          throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
        })())
      : input.bundles;
  let projected = sourceBundles.map((bundle) =>
    cloneBundle({
      artifacts: artifactMap,
      bundle,
      candidates: input.candidates,
      createdAt: input.createdAt,
      idSeed: input.idSeed,
    }),
  );
  let affectedIndex =
    input.decision.kind === 'UNDO'
      ? projected.findIndex(
          ({ result }) =>
            result.statement.locator.artifactKind === beforeResult.statement.locator.artifactKind &&
            result.statement.locator.artifactId === beforeResult.statement.locator.artifactId &&
            result.statement.locator.startCodePoint ===
              beforeResult.statement.locator.startCodePoint &&
            result.statement.locator.endCodePoint === beforeResult.statement.locator.endCodePoint,
        )
      : currentIndex;
  if (affectedIndex < 0) affectedIndex = 0;
  const current = projected[affectedIndex];
  if (current === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');

  if (input.decision.kind === 'CONFIRM_CLASSIFICATION') {
    if (
      current.signals.length > 0 &&
      current.result.statement.classification.kind !== 'FACT' &&
      reason === null
    ) {
      throw new FactMappingError('FACT_MAPPING_PROTECTED_SIGNAL');
    }
    const classification = assertClassification({
      ...current.result.statement.classification,
      classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
      reasonCode: 'USER_CONFIRMED_CLASSIFICATION',
      requiresReview: false,
    });
    const statement = cloneStatement(
      current.result.statement,
      classification,
      input.createdAt,
      `${input.idSeed}:confirmed`,
      'USER_CONFIRMED',
      current.result.statement.revision + 1,
    );
    const signals =
      statement.classification.kind === 'FACT'
        ? current.signals
        : acknowledgeSignals(current.signals, reason);
    const mapping =
      statement.classification.kind === 'FACT'
        ? remapExisting({
            artifact: artifactFor(artifactMap, statement),
            candidates: input.candidates,
            createdAt: input.createdAt,
            fragment: current.fragment,
            mapping: current.result.mapping,
            statement,
          })
        : null;
    projected[affectedIndex] = Object.freeze({
      fragment: current.fragment,
      result: resultWith(statement, mapping, signals),
      signals,
    });
  } else if (input.decision.kind === 'RECLASSIFY') {
    if (current.signals.length > 0 && input.decision.statementKind !== 'FACT' && reason === null) {
      throw new FactMappingError('FACT_MAPPING_PROTECTED_SIGNAL');
    }
    const classification = assertClassification({
      classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
      domain: input.decision.domain,
      kind: input.decision.statementKind,
      materiality: input.decision.materiality,
      reasonCode: 'USER_RECLASSIFIED',
      requiresReview: false,
    });
    const statement = cloneStatement(
      current.result.statement,
      classification,
      input.createdAt,
      `${input.idSeed}:reclassified`,
      'USER_CONFIRMED',
      current.result.statement.revision + 1,
    );
    const signals =
      statement.classification.kind === 'FACT'
        ? current.signals
        : acknowledgeSignals(current.signals, reason);
    const mapping =
      statement.classification.kind === 'FACT'
        ? remapExisting({
            artifact: artifactFor(artifactMap, statement),
            candidates: input.candidates,
            createdAt: input.createdAt,
            fragment: current.fragment,
            mapping: current.result.mapping,
            statement,
          })
        : null;
    projected[affectedIndex] = Object.freeze({
      fragment: current.fragment,
      result: resultWith(statement, mapping, signals),
      signals,
    });
  } else if (input.decision.kind === 'SPLIT') {
    const original = current.result.statement;
    if (
      input.decision.splitCodePoint <= original.locator.startCodePoint ||
      input.decision.splitCodePoint >= original.locator.endCodePoint
    ) {
      throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
    }
    const artifact = artifactFor(artifactMap, original);
    const pieces = [
      [original.locator.startCodePoint, input.decision.splitCodePoint],
      [input.decision.splitCodePoint, original.locator.endCodePoint],
    ] as const;
    const replacements = pieces.map(([start, end], index) => {
      const locator = createDraftTextLocator(artifact, start, end);
      const fragment = Array.from(artifact.text).slice(start, end).join('');
      if (fragment.trim().length === 0) {
        throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
      }
      const classification = classifyStatement(fragment);
      const statement = createDraftStatement({
        classification,
        createdAt: input.createdAt,
        locator,
        provenance: 'USER_DEFINED',
        revision: original.revision + 1,
        statementId: `statement-${factMappingHash([
          input.idSeed,
          original.statementId,
          'split',
          index,
          locator,
        ]).slice(0, 32)}`,
      });
      const signals = detectProtectedSignals(fragment);
      return Object.freeze({
        fragment,
        result: resultWith(statement, null, signals),
        signals,
      });
    });
    projected = [
      ...projected.slice(0, affectedIndex),
      ...replacements,
      ...projected.slice(affectedIndex + 1),
    ];
    affectedIndex = currentIndex;
  } else if (input.decision.kind === 'MAP_CLAIM') {
    if (current.result.statement.classification.kind !== 'FACT') {
      throw new FactMappingError('FACT_MAPPING_INVALID_CLASSIFICATION');
    }
    const claimId = input.decision.claimId;
    const candidate = input.candidates.candidates.find(({ claim }) => claim.claimId === claimId);
    if (candidate === undefined) throw new FactMappingError('FACT_MAPPING_INVALID_CANDIDATE');
    const artifact = artifactFor(artifactMap, current.result.statement);
    const mapping = createStatementClaimMapping({
      candidate,
      createdAt: input.createdAt,
      ...(artifact.artifact.workIds.length === 1 && artifact.artifact.workIds[0] !== undefined
        ? { expectedSubjectId: artifact.artifact.workIds[0] }
        : {}),
      mapperProvenance: 'USER_CONFIRMED',
      reason,
      relation: input.decision.relation,
      statement: current.result.statement,
      statementText: current.fragment,
    });
    const policy = evaluateCandidateFactPolicy(candidate);
    if (
      !candidate.current ||
      candidate.evaluation?.status !== 'VERIFIED' ||
      !policy.satisfied ||
      mapping.compatibility?.compatible !== true
    ) {
      throw new FactMappingError('FACT_MAPPING_INCOMPATIBLE');
    }
    projected[affectedIndex] = Object.freeze({
      ...current,
      result: resultWith(current.result.statement, mapping, current.signals),
    });
  } else if (input.decision.kind === 'UNMAP_CLAIM') {
    if (current.result.statement.classification.kind !== 'FACT') {
      throw new FactMappingError('FACT_MAPPING_INVALID_CLASSIFICATION');
    }
    projected[affectedIndex] = Object.freeze({
      ...current,
      result: resultWith(current.result.statement, null, current.signals),
    });
  } else if (input.decision.kind === 'REOPEN') {
    const old = current.result.statement.classification;
    const classification = assertClassification({
      classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
      domain: old.kind === 'FACT' || old.kind === 'MIXED' ? old.domain : 'NOT_APPLICABLE',
      kind: old.kind === 'FACT' || old.kind === 'MIXED' ? 'MIXED' : 'AMBIGUOUS',
      materiality: old.kind === 'FACT' || old.kind === 'MIXED' ? old.materiality : 'NOT_APPLICABLE',
      reasonCode: 'USER_REOPENED',
      requiresReview: true,
    });
    const statement = cloneStatement(
      current.result.statement,
      classification,
      input.createdAt,
      `${input.idSeed}:reopen`,
      'USER_CONFIRMED',
      current.result.statement.revision + 1,
    );
    projected[affectedIndex] = Object.freeze({
      fragment: current.fragment,
      result: resultWith(statement, null, current.signals),
      signals: current.signals,
    });
  }

  const results = projected.map(({ result }) => result);
  const rollup = rollupFactMapping(results, {
    warningBoundaryEscapeCount: input.warningBoundaryEscapes.length,
  });
  const afterResult =
    input.decision.kind === 'UNDO'
      ? projected[affectedIndex]?.result
      : projected[
          input.decision.kind === 'SPLIT'
            ? Math.min(currentIndex, projected.length - 1)
            : affectedIndex
        ]?.result;
  if (afterResult === undefined) throw new FactMappingError('FACT_MAPPING_CONFLICT');
  return Object.freeze({
    after: summary(afterResult),
    artifactHash: input.artifactHash,
    before: summary(beforeResult),
    checkerVersion: FACT_MAPPING_CHECKER_VERSION,
    inputHash: factMappingHash({
      baseArtifactHash: input.artifactHash,
      decision: input.decision,
      results: results.map(({ mapping, statement }) => ({
        classification: statement.classification,
        locator: statement.locator,
        mapping:
          mapping === null
            ? null
            : {
                claimId: mapping.claimId,
                relation: mapping.relation,
                semanticHash: mapping.semanticHash,
              },
        provenance: statement.provenance,
        revision: statement.revision,
      })),
    }),
    rollup,
    statements: Object.freeze(projected),
    warningBoundaryEscapes: Object.freeze([...input.warningBoundaryEscapes]),
  });
}
