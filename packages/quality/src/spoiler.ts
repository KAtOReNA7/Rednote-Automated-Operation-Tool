import {
  COPY_CONTRACT_VERSION,
  COPY_STRUCTURAL_VALIDATION_VERSION,
  type ContentDraftPayloadV1,
  type DraftSpoilerWarningsV1,
} from '@mystery-operations/copy';

import { createDraftTextLocator, materializeDraftPublicArtifacts } from './artifacts.js';
import { DRAFT_TEXT_LOCATOR_VERSION, type DraftArtifactKind } from './constants.js';
import type { DraftTextLocatorV1 } from './contracts.js';
import { factMappingHash, normalizeDraftText } from './identity.js';
import { segmentStatementText } from './statements.js';

export const SPOILER_QUALITY_CHECKER_VERSION = 'spoiler-quality-checker-v1' as const;
export const SPOILER_QUALITY_POLICY_VERSION = 'spoiler-quality-policy-v1' as const;
export const SPOILER_WARNING_CLASSIFIER_VERSION = 'spoiler-warning-classifier-v1' as const;
export const SPOILER_CANDIDATE_DETECTOR_VERSION = 'spoiler-candidate-detector-v1' as const;
export const SPOILER_NORMALIZATION_VERSION = 'nfc-lf-v1' as const;
export const SPOILER_DECLARATION_POLICY_VERSION = 'spoiler-policy-v1' as const;
export const SPOILER_QUALITY_CONFIRMATION_LITERAL = 'SAVE_SPOILER_QUALITY_CHECK' as const;

export const SPOILER_QUALITY_ERROR_CODES = [
  'SPOILER_QUALITY_INVALID_CONTRACT',
  'SPOILER_QUALITY_NOT_FOUND',
  'SPOILER_QUALITY_NOT_READY',
  'SPOILER_QUALITY_STALE_REVISION',
  'SPOILER_QUALITY_CONFIRMATION_INVALID',
] as const;
export type SpoilerQualityErrorCode = (typeof SPOILER_QUALITY_ERROR_CODES)[number];

export class SpoilerQualityError extends Error {
  public readonly code: SpoilerQualityErrorCode;
  public readonly retryable: boolean;

  public constructor(code: SpoilerQualityErrorCode, message: string = code, retryable = false) {
    super(message);
    this.name = 'SpoilerQualityError';
    this.code = code;
    this.retryable = retryable;
  }
}

export const SPOILER_QUALITY_STATUSES = [
  'PASS',
  'BLOCKED',
  'REVIEW_REQUIRED',
  'STALE',
  'NOT_RUN',
] as const;
export type SpoilerQualityStatus = (typeof SPOILER_QUALITY_STATUSES)[number];
export type SpoilerQualityEvaluationStatus = Exclude<SpoilerQualityStatus, 'STALE' | 'NOT_RUN'>;

export const SPOILER_QUALITY_REASON_CODES = [
  'DRAFT_INVALIDATED',
  'BRIEF_INVALIDATED',
  'BRIEF_NOT_READY',
  'DRAFT_BRIEF_ID_MISMATCH',
  'BRIEF_VERSION_MISMATCH',
  'BRIEF_INPUT_HASH_MISMATCH',
  'BRIEF_LOCK_HASH_MISMATCH',
  'SPOILER_PLAN_MISMATCH',
  'NO_SPOILER_PLAN_INVALID',
  'NO_SPOILER_WARNING_PRESENT',
  'LIGHT_SPOILER_PLAN_INVALID',
  'LIGHT_OPENING_WARNING_MISSING',
  'LIGHT_OPENING_WARNING_FULL',
  'LIGHT_WARNING_SURFACE_MISMATCH',
  'FULL_SPOILER_PLAN_INVALID',
  'FULL_WARNING_MISSING',
  'FULL_WARNING_DOWNGRADED',
  'WARNING_SCOPE_AMBIGUOUS',
  'TITLE_MARKER_MISSING',
  'ANSWER_STYLE_CANDIDATE',
  'ANSWER_STYLE_AMBIGUOUS',
  'SCAN_TRUNCATED',
  'FINDINGS_TRUNCATED',
] as const;
export type SpoilerQualityReasonCode = (typeof SPOILER_QUALITY_REASON_CODES)[number];

export type SpoilerQualitySurface =
  | DraftArtifactKind
  | 'COVER_WARNING'
  | 'TITLE_WARNING'
  | 'BODY_OPENING_WARNING'
  | 'PINNED_COMMENT_WARNING';

export interface SpoilerInvalidationTruth {
  readonly dependencyType: string;
  readonly observedRevision: string;
  readonly reasonCode: string;
}

export interface SpoilerCurrentBriefTruth {
  readonly briefId: string;
  readonly currentVersionId: string;
  readonly dependencyHash: string;
  readonly inputHash: string;
  readonly invalidations: readonly SpoilerInvalidationTruth[];
  readonly lockHash: string;
  readonly payloadHash: string;
  readonly readinessStatus: string;
  readonly revision: number;
  readonly spoilerPlan: ContentDraftPayloadV1['brief']['spoilerPlan'];
  readonly state: string;
  readonly status: string;
}

export interface SpoilerQualityFinding {
  readonly artifactId: string;
  readonly disposition: 'BLOCKED' | 'REVIEW_REQUIRED';
  readonly endCodePoint: number;
  readonly reasonCode: SpoilerQualityReasonCode;
  readonly ruleVersion: string;
  readonly selectedTextHash: string;
  readonly startCodePoint: number;
  readonly surface: SpoilerQualitySurface;
  readonly textHash: string;
}

export interface SpoilerQualityEvaluation {
  readonly checkerVersion: typeof SPOILER_QUALITY_CHECKER_VERSION;
  readonly counts: { readonly blocked: number; readonly reviewRequired: number };
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftVersionId: string;
  readonly evaluatedAt: string;
  readonly findings: readonly SpoilerQualityFinding[];
  readonly inputHash: string;
  readonly policyVersion: typeof SPOILER_QUALITY_POLICY_VERSION;
  readonly reasonCodes: readonly SpoilerQualityReasonCode[];
  readonly status: SpoilerQualityEvaluationStatus;
  readonly truncated: boolean;
}

export interface EvaluateSpoilerQualityInput {
  readonly brief: SpoilerCurrentBriefTruth;
  readonly draftBriefId: string;
  readonly draftBriefVersionId: string;
  readonly draftDependencyHash: string;
  readonly draftId: string;
  readonly draftInputHash: string;
  readonly draftInvalidations: readonly SpoilerInvalidationTruth[];
  readonly draftLockHash: string;
  readonly draftRevision: number;
  readonly draftState: string;
  readonly draftStatus: string;
  readonly draftVersionId: string;
  readonly evaluatedAt: string;
  readonly payload: ContentDraftPayloadV1;
  readonly structuralValid: boolean;
}

type WarningField = Exclude<keyof DraftSpoilerWarningsV1, 'provenance'>;
type WarningClass = 'EMPTY' | 'LIGHT' | 'FULL' | 'AMBIGUOUS';

const WARNING_SURFACES: Readonly<Record<WarningField, SpoilerQualitySurface>> = Object.freeze({
  bodyOpeningWarningText: 'BODY_OPENING_WARNING',
  coverWarningText: 'COVER_WARNING',
  pinnedCommentWarningText: 'PINNED_COMMENT_WARNING',
  titleWarningMarker: 'TITLE_WARNING',
});
const WARNING_FIELDS = Object.freeze(Object.keys(WARNING_SURFACES) as readonly WarningField[]);
const FULL_WARNING =
  /(?:完整|全量|核心)(?:剧透|诡计|谜底|真相)|(?:凶手|谜底|结局).{0,12}(?:揭示|拆解|分析|公开)/u;
const LIGHT_WARNING = /(?:轻微|轻度|少量|部分|非核心)(?:剧透|情节|线索)/u;
const GENERIC_WARNING = /(?:剧透(?:预警|提醒|警告)|含剧透|涉及剧透|注意剧透)/u;
const ANSWER_STYLE =
  /(?:凶手|真凶|幕后黑手|最终反派|结局|谜底|核心诡计)(?:\s*(?:其实|原来|最终))?\s*(?:就是|是|为|：|:)\s*[^\n。！？!?]{1,48}/gu;
const AMBIGUOUS_CONTEXT =
  /[?？]|(?:不是|并非|未必|不代表|如果|假设|可能|猜测|反例|例子|写法|表达|词语|讨论|书名|角色名|人名|引用|“|”|《|》)/u;
const MAX_FINDINGS = 16;
const MAX_SCAN_CODE_POINTS = 24_000;
const MAX_EVALUATION_BYTES = 3_200;

function warningClass(value: string | null): WarningClass {
  if (value === null || normalizeDraftText(value).trim().length === 0) return 'EMPTY';
  const text = normalizeDraftText(value).trim();
  const full = FULL_WARNING.test(text);
  const light = LIGHT_WARNING.test(text);
  if (full !== light) return full ? 'FULL' : 'LIGHT';
  return GENERIC_WARNING.test(text) || full || light ? 'AMBIGUOUS' : 'AMBIGUOUS';
}

function codePointOffset(text: string, utf16Offset: number): number {
  return Array.from(text.slice(0, utf16Offset)).length;
}

function warningFinding(
  field: WarningField,
  value: string | null,
  reasonCode: SpoilerQualityReasonCode,
  disposition: SpoilerQualityFinding['disposition'],
): SpoilerQualityFinding {
  const text = normalizeDraftText(value ?? '');
  const length = Array.from(text).length;
  return Object.freeze({
    artifactId: field,
    disposition,
    endCodePoint: length,
    reasonCode,
    ruleVersion: SPOILER_WARNING_CLASSIFIER_VERSION,
    selectedTextHash: factMappingHash(text),
    startCodePoint: 0,
    surface: WARNING_SURFACES[field],
    textHash: factMappingHash(text),
  });
}

function locatedFinding(
  materialized: ReturnType<typeof materializeDraftPublicArtifacts>[number],
  startCodePoint: number,
  endCodePoint: number,
  reasonCode: SpoilerQualityReasonCode,
): SpoilerQualityFinding {
  const locator: DraftTextLocatorV1 = createDraftTextLocator(
    materialized,
    startCodePoint,
    endCodePoint,
  );
  return Object.freeze({
    artifactId: locator.artifactId,
    disposition: 'REVIEW_REQUIRED',
    endCodePoint: locator.endCodePoint,
    reasonCode,
    ruleVersion: SPOILER_CANDIDATE_DETECTOR_VERSION,
    selectedTextHash: locator.selectedTextHash,
    startCodePoint: locator.startCodePoint,
    surface: locator.artifactKind,
    textHash: locator.textHash,
  });
}

function planMatches(
  left: ContentDraftPayloadV1['brief']['spoilerPlan'],
  right: ContentDraftPayloadV1['brief']['spoilerPlan'],
): boolean {
  return factMappingHash(left) === factMappingHash(right);
}

function planValid(plan: ContentDraftPayloadV1['brief']['spoilerPlan']): boolean {
  switch (plan.level) {
    case 'NO_SPOILER':
      return (
        !plan.warningRequired &&
        plan.warningPlacement === 'NONE' &&
        !plan.revealCoreTrick &&
        !plan.revealEnding &&
        !plan.userConfirmationRequired &&
        !plan.userConfirmed
      );
    case 'LIGHT_SPOILER':
      return (
        plan.warningRequired &&
        plan.warningPlacement === 'BODY_OPENING' &&
        !plan.revealCoreTrick &&
        !plan.revealEnding &&
        !plan.userConfirmationRequired &&
        !plan.userConfirmed
      );
    case 'FULL_TRICK_ANALYSIS':
      return (
        plan.warningRequired &&
        plan.warningPlacement === 'COVER_TITLE_AND_BODY_OPENING' &&
        plan.revealCoreTrick &&
        plan.revealEnding &&
        plan.userConfirmationRequired &&
        plan.userConfirmed
      );
  }
}

function warningHashSummary(warnings: DraftSpoilerWarningsV1) {
  return Object.fromEntries(
    WARNING_FIELDS.map((field) => {
      const text = normalizeDraftText(warnings[field] ?? '');
      return [
        field,
        Object.freeze({
          codePointLength: Array.from(text).length,
          present: text.trim().length > 0,
          textHash: factMappingHash(text),
        }),
      ];
    }),
  );
}

function sortedInvalidations(values: readonly SpoilerInvalidationTruth[]) {
  return [...values].sort((left, right) =>
    `${left.dependencyType}\0${left.observedRevision}\0${left.reasonCode}`.localeCompare(
      `${right.dependencyType}\0${right.observedRevision}\0${right.reasonCode}`,
    ),
  );
}

export function evaluateSpoilerQuality(
  input: EvaluateSpoilerQualityInput,
): SpoilerQualityEvaluation {
  if (!Number.isSafeInteger(input.draftRevision) || input.draftRevision < 0) {
    throw new SpoilerQualityError('SPOILER_QUALITY_INVALID_CONTRACT');
  }
  let artifacts: ReturnType<typeof materializeDraftPublicArtifacts>;
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
    throw new SpoilerQualityError('SPOILER_QUALITY_NOT_READY');
  }

  const findings: SpoilerQualityFinding[] = [];
  const blockMetadata = (reasonCode: SpoilerQualityReasonCode) =>
    findings.push(warningFinding('bodyOpeningWarningText', null, reasonCode, 'BLOCKED'));
  const snapshot = input.payload.brief;
  if (input.draftInvalidations.length > 0) blockMetadata('DRAFT_INVALIDATED');
  if (input.brief.invalidations.length > 0) blockMetadata('BRIEF_INVALIDATED');
  if (
    input.brief.state !== 'ACTIVE' ||
    input.brief.status !== 'USER_CONFIRMED' ||
    input.brief.readinessStatus !== 'READY_FOR_DRAFT_GENERATION'
  ) {
    blockMetadata('BRIEF_NOT_READY');
  }
  if (input.draftBriefId !== snapshot.briefId || snapshot.briefId !== input.brief.briefId) {
    blockMetadata('DRAFT_BRIEF_ID_MISMATCH');
  }
  if (
    input.draftBriefVersionId !== snapshot.briefVersionId ||
    snapshot.briefVersionId !== input.brief.currentVersionId
  ) {
    blockMetadata('BRIEF_VERSION_MISMATCH');
  }
  if (
    snapshot.briefInputHash !== input.brief.payloadHash ||
    input.draftInputHash !== snapshot.briefInputHash
  ) {
    blockMetadata('BRIEF_INPUT_HASH_MISMATCH');
  }
  if (snapshot.briefLockHash !== input.brief.lockHash) {
    blockMetadata('BRIEF_LOCK_HASH_MISMATCH');
  }
  if (!planMatches(snapshot.spoilerPlan, input.brief.spoilerPlan)) {
    blockMetadata('SPOILER_PLAN_MISMATCH');
  }

  const plan = snapshot.spoilerPlan;
  const warnings = input.payload.spoilerWarnings;
  const classes = Object.fromEntries(
    WARNING_FIELDS.map((field) => [field, warningClass(warnings[field])]),
  ) as Readonly<Record<WarningField, WarningClass>>;
  if (plan.level === 'NO_SPOILER') {
    if (!planValid(plan)) blockMetadata('NO_SPOILER_PLAN_INVALID');
    for (const field of WARNING_FIELDS) {
      if (classes[field] !== 'EMPTY') {
        findings.push(
          warningFinding(field, warnings[field], 'NO_SPOILER_WARNING_PRESENT', 'BLOCKED'),
        );
      }
    }
  } else if (plan.level === 'LIGHT_SPOILER') {
    if (!planValid(plan)) blockMetadata('LIGHT_SPOILER_PLAN_INVALID');
    const openingClass = classes.bodyOpeningWarningText;
    if (openingClass === 'EMPTY') {
      findings.push(
        warningFinding('bodyOpeningWarningText', null, 'LIGHT_OPENING_WARNING_MISSING', 'BLOCKED'),
      );
    } else if (openingClass === 'FULL') {
      findings.push(
        warningFinding(
          'bodyOpeningWarningText',
          warnings.bodyOpeningWarningText,
          'LIGHT_OPENING_WARNING_FULL',
          'BLOCKED',
        ),
      );
    } else if (openingClass === 'AMBIGUOUS') {
      findings.push(
        warningFinding(
          'bodyOpeningWarningText',
          warnings.bodyOpeningWarningText,
          'WARNING_SCOPE_AMBIGUOUS',
          'REVIEW_REQUIRED',
        ),
      );
    }
    for (const field of [
      'coverWarningText',
      'titleWarningMarker',
      'pinnedCommentWarningText',
    ] as const) {
      if (classes[field] !== 'EMPTY') {
        findings.push(
          warningFinding(field, warnings[field], 'LIGHT_WARNING_SURFACE_MISMATCH', 'BLOCKED'),
        );
      }
    }
  } else {
    if (!planValid(plan)) blockMetadata('FULL_SPOILER_PLAN_INVALID');
    for (const field of WARNING_FIELDS) {
      const classification = classes[field];
      if (classification === 'EMPTY') {
        findings.push(warningFinding(field, null, 'FULL_WARNING_MISSING', 'BLOCKED'));
      } else if (classification === 'LIGHT') {
        findings.push(warningFinding(field, warnings[field], 'FULL_WARNING_DOWNGRADED', 'BLOCKED'));
      } else if (classification === 'AMBIGUOUS') {
        findings.push(
          warningFinding(field, warnings[field], 'WARNING_SCOPE_AMBIGUOUS', 'REVIEW_REQUIRED'),
        );
      }
    }
    const selected = artifacts.find(({ artifact }) => artifact.artifactKind === 'SELECTED_TITLE');
    const marker = normalizeDraftText(warnings.titleWarningMarker ?? '');
    if (selected === undefined || marker.length === 0 || !selected.text.includes(marker)) {
      findings.push(
        warningFinding(
          'titleWarningMarker',
          warnings.titleWarningMarker,
          'TITLE_MARKER_MISSING',
          'BLOCKED',
        ),
      );
    }
  }

  let scannedCodePoints = 0;
  let scanTruncated = false;
  if (plan.level !== 'FULL_TRICK_ANALYSIS') {
    for (const materialized of artifacts) {
      const points = Array.from(materialized.text);
      const remaining = Math.max(0, MAX_SCAN_CODE_POINTS - scannedCodePoints);
      const scanned = points.slice(0, remaining).join('');
      for (const segment of segmentStatementText(scanned)) {
        for (const match of segment.text.matchAll(ANSWER_STYLE)) {
          const start = segment.startCodePoint + codePointOffset(segment.text, match.index ?? 0);
          const end = start + Array.from(match[0]).length;
          findings.push(
            locatedFinding(
              materialized,
              start,
              end,
              AMBIGUOUS_CONTEXT.test(segment.text)
                ? 'ANSWER_STYLE_AMBIGUOUS'
                : 'ANSWER_STYLE_CANDIDATE',
            ),
          );
        }
      }
      scannedCodePoints += Math.min(points.length, remaining);
      if (points.length > remaining) {
        const start = Math.max(0, Math.min(points.length - 1, remaining - 1));
        findings.push(locatedFinding(materialized, start, start + 1, 'SCAN_TRUNCATED'));
        scanTruncated = true;
        break;
      }
    }
  }

  const inputHash = factMappingHash({
    artifacts: artifacts.map(({ artifact }) => ({
      artifactId: artifact.artifactId,
      artifactKind: artifact.artifactKind,
      codePointLength: artifact.codePointLength,
      order: artifact.order,
      textHash: artifact.textHash,
      workIds: artifact.workIds,
    })),
    briefCurrent: {
      ...input.brief,
      invalidations: sortedInvalidations(input.brief.invalidations),
    },
    checkerVersion: SPOILER_QUALITY_CHECKER_VERSION,
    draft: {
      dependencyHash: input.draftDependencyHash,
      draftBriefId: input.draftBriefId,
      draftBriefVersionId: input.draftBriefVersionId,
      draftId: input.draftId,
      draftRevision: input.draftRevision,
      draftState: input.draftState,
      draftStatus: input.draftStatus,
      draftVersionId: input.draftVersionId,
      inputHash: input.draftInputHash,
      invalidations: sortedInvalidations(input.draftInvalidations),
      lockHash: input.draftLockHash,
      structuralValid: input.structuralValid,
    },
    frozenBrief: {
      briefId: snapshot.briefId,
      briefInputHash: snapshot.briefInputHash,
      briefLockHash: snapshot.briefLockHash,
      briefVersionId: snapshot.briefVersionId,
      dependencies: snapshot.dependencies,
      spoilerPlan: snapshot.spoilerPlan,
    },
    versions: {
      candidateDetector: SPOILER_CANDIDATE_DETECTOR_VERSION,
      copyContract: COPY_CONTRACT_VERSION,
      draftStructuralValidation: COPY_STRUCTURAL_VALIDATION_VERSION,
      locator: DRAFT_TEXT_LOCATOR_VERSION,
      normalization: SPOILER_NORMALIZATION_VERSION,
      policy: SPOILER_QUALITY_POLICY_VERSION,
      spoilerDeclarationPolicy: SPOILER_DECLARATION_POLICY_VERSION,
      warningClassifier: SPOILER_WARNING_CLASSIFIER_VERSION,
    },
    warnings: warningHashSummary(warnings),
  });

  const blocked = findings.filter(({ disposition }) => disposition === 'BLOCKED').length;
  const reviewRequired = findings.length - blocked;
  const reasonCodes = new Set(findings.map(({ reasonCode }) => reasonCode));
  let selected = findings.slice(0, MAX_FINDINGS);
  let truncated = scanTruncated || selected.length < findings.length;
  while (
    selected.length > 0 &&
    Buffer.byteLength(
      JSON.stringify({ findings: selected, reasonCodes: [...reasonCodes] }),
      'utf8',
    ) > MAX_EVALUATION_BYTES
  ) {
    selected = selected.slice(0, -1);
    truncated = true;
  }
  if (truncated) reasonCodes.add('FINDINGS_TRUNCATED');
  const status: SpoilerQualityEvaluationStatus =
    blocked > 0 ? 'BLOCKED' : reviewRequired > 0 || truncated ? 'REVIEW_REQUIRED' : 'PASS';
  return Object.freeze({
    checkerVersion: SPOILER_QUALITY_CHECKER_VERSION,
    counts: Object.freeze({ blocked, reviewRequired }),
    draftId: input.draftId,
    draftRevision: input.draftRevision,
    draftVersionId: input.draftVersionId,
    evaluatedAt: input.evaluatedAt,
    findings: Object.freeze(selected),
    inputHash,
    policyVersion: SPOILER_QUALITY_POLICY_VERSION,
    reasonCodes: Object.freeze([...reasonCodes].sort()),
    status,
    truncated,
  });
}
