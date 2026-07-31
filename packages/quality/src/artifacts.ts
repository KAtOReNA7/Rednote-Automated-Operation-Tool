import type { ContentDraftPayloadV1 } from '@mystery-operations/copy';

import {
  DRAFT_STATEMENT_CONTRACT_VERSION,
  DRAFT_TEXT_LOCATOR_VERSION,
  FACT_MAPPING_LIMITS,
  FACT_MAPPING_SEGMENTATION_VERSION,
  type DraftArtifactKind,
} from './constants.js';
import {
  assertDraftTextLocator,
  type DraftPublicArtifactV1,
  type DraftStatementClassificationV1,
  type DraftStatementV1,
  type DraftTextLocatorV1,
} from './contracts.js';
import { FactMappingError } from './errors.js';
import { factMappingHash, normalizeDraftText } from './identity.js';
import { classifyStatement, detectProtectedSignals } from './statements.js';

export interface MaterializedDraftArtifactV1 {
  readonly artifact: DraftPublicArtifactV1;
  readonly text: string;
}

export interface WarningBoundaryEscapeV1 {
  readonly field:
    | 'bodyOpeningWarningText'
    | 'coverWarningText'
    | 'pinnedCommentWarningText'
    | 'titleWarningMarker';
  readonly signalCount: number;
  readonly textHash: string;
}

const PURE_WARNING =
  /^(?:⚠️?\s*)?(?:无剧透|轻微剧透|含剧透|完整诡计分析|剧透预警|以下内容涉及剧透|注意剧透)(?:[：:！!。\s]*)$/u;

export function detectWarningBoundaryEscapes(
  payload: ContentDraftPayloadV1,
): readonly WarningBoundaryEscapeV1[] {
  const fields = [
    'coverWarningText',
    'titleWarningMarker',
    'bodyOpeningWarningText',
    'pinnedCommentWarningText',
  ] as const;
  return Object.freeze(
    fields.flatMap((field) => {
      const value = payload.spoilerWarnings[field];
      if (value === null) return [];
      const text = normalizeDraftText(value).trim();
      if (PURE_WARNING.test(text)) return [];
      const signals = detectProtectedSignals(text);
      const classification = classifyStatement(text);
      if (signals.length === 0 && !['FACT', 'MIXED'].includes(classification.kind)) {
        return [];
      }
      return [
        Object.freeze({
          field,
          signalCount: signals.length,
          textHash: factMappingHash(text),
        }),
      ];
    }),
  );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function artifact(
  draftId: string,
  draftVersionId: string,
  profileId: ContentDraftPayloadV1['profileId'],
  current: boolean,
  artifactKind: DraftArtifactKind,
  artifactId: string,
  order: number | null,
  textValue: string,
  workIds: readonly string[],
  evidenceRefIds: readonly string[],
): MaterializedDraftArtifactV1 {
  const text = normalizeDraftText(textValue);
  const codePointLength = Array.from(text).length;
  if (
    codePointLength < 1 ||
    codePointLength > FACT_MAPPING_LIMITS.artifactCodePoints ||
    Buffer.byteLength(artifactId, 'utf8') > FACT_MAPPING_LIMITS.identifierBytes
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return Object.freeze({
    artifact: Object.freeze({
      artifactId,
      artifactKind,
      codePointLength,
      current,
      draftId,
      draftVersionId,
      evidenceRefIds: uniqueSorted(evidenceRefIds),
      order,
      profileId,
      textHash: factMappingHash(text),
      workIds: uniqueSorted(workIds),
    }),
    text,
  });
}

export function materializeDraftPublicArtifacts(input: {
  readonly current: boolean;
  readonly draftId: string;
  readonly draftStatus: string;
  readonly draftVersionId: string;
  readonly payload: ContentDraftPayloadV1;
  readonly structuralValid: boolean;
}): readonly MaterializedDraftArtifactV1[] {
  if (
    input.draftStatus !== 'READY_FOR_QUALITY_PIPELINE' ||
    !input.structuralValid ||
    input.payload.selectedTitleId === null
  ) {
    throw new FactMappingError('FACT_MAPPING_NOT_READY');
  }
  const selected = input.payload.titles.find(
    ({ titleId }) => titleId === input.payload.selectedTitleId,
  );
  if (selected === undefined) throw new FactMappingError('FACT_MAPPING_NOT_READY');
  const common = [
    input.draftId,
    input.draftVersionId,
    input.payload.profileId,
    input.current,
  ] as const;
  const values: MaterializedDraftArtifactV1[] = [
    artifact(
      ...common,
      'SELECTED_TITLE',
      selected.titleId,
      null,
      selected.text,
      selected.lineage.flatMap(({ workId }) => (workId === null ? [] : [workId])),
      selected.lineage.flatMap(({ evidenceRefIds }) => evidenceRefIds),
    ),
    ...[...input.payload.blocks]
      .sort((left, right) => left.order - right.order || left.blockId.localeCompare(right.blockId))
      .map((block) =>
        artifact(
          ...common,
          'BODY_BLOCK',
          block.blockId,
          block.order,
          block.text,
          block.lineage.flatMap(({ workId }) => (workId === null ? [] : [workId])),
          block.lineage.flatMap(({ evidenceRefIds }) => evidenceRefIds),
        ),
      ),
    ...input.payload.tags.map((tag, order) =>
      artifact(
        ...common,
        'TAG',
        tag.tagId,
        order,
        tag.text,
        tag.lineage.flatMap(({ workId }) => (workId === null ? [] : [workId])),
        tag.lineage.flatMap(({ evidenceRefIds }) => evidenceRefIds),
      ),
    ),
    ...(input.payload.pinnedComment === null
      ? []
      : [
          artifact(
            ...common,
            'PINNED_COMMENT',
            'pinned-comment',
            null,
            input.payload.pinnedComment.text,
            input.payload.pinnedComment.lineage.flatMap(({ workId }) =>
              workId === null ? [] : [workId],
            ),
            input.payload.pinnedComment.lineage.flatMap(({ evidenceRefIds }) => evidenceRefIds),
          ),
        ]),
  ];
  if (
    values.length > FACT_MAPPING_LIMITS.artifacts ||
    values.reduce((sum, item) => sum + item.artifact.codePointLength, 0) >
      FACT_MAPPING_LIMITS.maxInputCodePoints
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return Object.freeze(values);
}

export function createDraftTextLocator(
  materialized: MaterializedDraftArtifactV1,
  startCodePoint: number,
  endCodePoint: number,
): DraftTextLocatorV1 {
  const points = Array.from(materialized.text);
  if (
    !Number.isSafeInteger(startCodePoint) ||
    !Number.isSafeInteger(endCodePoint) ||
    startCodePoint < 0 ||
    endCodePoint <= startCodePoint ||
    endCodePoint > points.length
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
  }
  return assertDraftTextLocator({
    artifactId: materialized.artifact.artifactId,
    artifactKind: materialized.artifact.artifactKind,
    draftVersionId: materialized.artifact.draftVersionId,
    endCodePoint,
    locatorVersion: DRAFT_TEXT_LOCATOR_VERSION,
    selectedTextHash: factMappingHash(points.slice(startCodePoint, endCodePoint).join('')),
    startCodePoint,
    textHash: materialized.artifact.textHash,
  });
}

export function resolveDraftTextLocator(
  materialized: MaterializedDraftArtifactV1,
  locatorValue: unknown,
): string {
  const locator = assertDraftTextLocator(locatorValue);
  if (
    locator.draftVersionId !== materialized.artifact.draftVersionId ||
    locator.artifactKind !== materialized.artifact.artifactKind ||
    locator.artifactId !== materialized.artifact.artifactId ||
    locator.textHash !== materialized.artifact.textHash
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
  }
  const selected = Array.from(materialized.text)
    .slice(locator.startCodePoint, locator.endCodePoint)
    .join('');
  if (
    selected.length === 0 ||
    locator.endCodePoint > materialized.artifact.codePointLength ||
    factMappingHash(selected) !== locator.selectedTextHash
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_LOCATOR');
  }
  return selected;
}

export function createDraftStatement(input: {
  readonly classification: DraftStatementClassificationV1;
  readonly createdAt: string;
  readonly locator: DraftTextLocatorV1;
  readonly provenance: DraftStatementV1['provenance'];
  readonly revision?: number;
  readonly statementId: string;
}): DraftStatementV1 {
  if (
    input.statementId.trim().length === 0 ||
    Buffer.byteLength(input.statementId, 'utf8') > FACT_MAPPING_LIMITS.identifierBytes ||
    !Number.isSafeInteger(input.revision ?? 1) ||
    (input.revision ?? 1) < 1
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return Object.freeze({
    classification: input.classification,
    contractVersion: DRAFT_STATEMENT_CONTRACT_VERSION,
    createdAt: input.createdAt,
    locator: input.locator,
    provenance: input.provenance,
    revision: input.revision ?? 1,
    segmentationVersion: FACT_MAPPING_SEGMENTATION_VERSION,
    statementId: input.statementId,
    textHash: input.locator.selectedTextHash,
  });
}
