import type { AuthenticitySpoilerLevel, ReadingStateCode } from '@mystery-operations/authenticity';
import type { StatementKind } from '@mystery-operations/quality';

export type EvidenceConflictAction =
  | 'ACCEPT_CLAIM'
  | 'ACCEPT_MULTIVALUE'
  | 'SPLIT_SCOPE'
  | 'DISMISS_DEPENDENT_SOURCE'
  | 'UNDO'
  | 'REOPEN';

export interface EvidenceSourceView {
  readonly authorityTier:
    'DISCUSSION_CONTEXT' | 'INDEPENDENT_SECONDARY' | 'OFFICIAL_PRIMARY' | 'UNKNOWN';
  readonly availability: 'AVAILABLE' | 'RETRACTED' | 'SUPERSEDED' | 'UNAVAILABLE';
  readonly independenceState: 'CONFIRMED_INDEPENDENT' | 'DEPENDENT' | 'UNKNOWN';
  readonly language: string;
  readonly lineageGroup: string | null;
  readonly originKind: 'BROWSER_CLIP' | 'FETCH_DOCUMENT' | 'SYNTHETIC_FIXTURE' | 'USER_LOCAL_INPUT';
  readonly revision: number;
  readonly sourceId: string;
  readonly title: string;
  readonly useClass: 'CONTEXT_ONLY' | 'KEY_FACT_ELIGIBLE' | 'NOT_CLASSIFIED' | 'SUPPORTING_ONLY';
}

export interface EvidenceClaimView {
  readonly claimId: string;
  readonly evaluationStatus:
    | 'CONFLICTED'
    | 'FACT_BLOCKED'
    | 'INSUFFICIENT'
    | 'NOT_EVALUATED'
    | 'REJECTED'
    | 'STALE_REVIEW_REQUIRED'
    | 'SUPPORTED_NOT_VERIFIED'
    | 'VERIFIED';
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly excerpt: string;
    readonly language: string;
    readonly relation: string;
    readonly sourceId: string;
    readonly sourceRevision: number;
    readonly summaryZh: string | null;
  }[];
  readonly predicate: string;
  readonly subjectId: string;
  readonly subjectType: 'AGENT' | 'EDITION' | 'EXPRESSION' | 'PUBLICATION_RELATIONSHIP' | 'WORK';
  readonly value: unknown;
}

export interface EvidenceConflictView {
  readonly claimLeftId: string;
  readonly claimRightId: string;
  readonly conflictId: string;
  readonly revision: number;
  readonly state:
    | 'DISMISSED_DEPENDENT_SOURCE'
    | 'FACT_BLOCKED'
    | 'OPEN'
    | 'REOPENED'
    | 'RESOLVED_ACCEPT'
    | 'RESOLVED_MULTIVALUE'
    | 'RESOLVED_SCOPE_SPLIT'
    | 'SUPERSEDED';
}

export interface EvidenceStateView {
  readonly claims: readonly EvidenceClaimView[];
  readonly conflicts: readonly EvidenceConflictView[];
  readonly counts: {
    readonly claims: number;
    readonly conflicts: number;
    readonly evaluations: number;
    readonly evidence: number;
    readonly sources: number;
  };
  readonly inbox: readonly {
    readonly factStatus: 'NOT_A_FACT';
    readonly originKind: 'BROWSER_CLIP' | 'FETCH_DOCUMENT';
    readonly originRecordId: string;
    readonly suggestedUse: 'CONTEXT_ONLY' | 'NOT_CLASSIFIED';
    readonly title: string;
    readonly truthStatus: 'UNVERIFIED';
  }[];
  readonly processingRuns: readonly {
    readonly costState: string;
    readonly currentStep: string | null;
    readonly externalRequestCount: number;
    readonly revision: number;
    readonly runId: string;
    readonly status: string;
  }[];
  readonly sources: readonly EvidenceSourceView[];
}

export interface GetEvidenceStateInput {
  readonly limit: number;
  readonly offset: number;
}

export interface PreviewEvidenceConflictInput {
  readonly acceptedClaimId: string | null;
  readonly action: EvidenceConflictAction;
  readonly conflictId: string;
}

export interface EvidenceConflictActionPreview extends EvidenceConflictView {
  readonly acceptedClaimId: string | null;
  readonly action: EvidenceConflictAction;
  readonly affected: {
    readonly claimIds: readonly string[];
    readonly evidenceIds: readonly string[];
    readonly sourceRevisionIds: readonly string[];
    readonly subjects: readonly {
      readonly subjectId: string;
      readonly subjectType:
        'AGENT' | 'EDITION' | 'EXPRESSION' | 'PUBLICATION_RELATIONSHIP' | 'WORK';
    }[];
  };
  readonly afterEvaluations: readonly {
    readonly claimId: string;
    readonly status: EvidenceClaimView['evaluationStatus'];
  }[];
  readonly beforeEvaluations: readonly {
    readonly claimId: string;
    readonly status: EvidenceClaimView['evaluationStatus'];
  }[];
  readonly expiresAt: string;
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmEvidenceConflictInput {
  readonly confirmation: 'APPLY_FACT_CONFLICT_DECISION';
  readonly previewHash: string;
  readonly reason: string;
  readonly token: string;
}

export interface PreviewSourceProcessingInput {
  readonly includeModelSteps: boolean;
  readonly sourceRevisionIds: readonly string[];
}

export interface SourceProcessingPreview {
  readonly estimatedExternalRequests: number;
  readonly estimatedFee: 'UNKNOWN';
  readonly estimatedLocalWrites: number;
  readonly expiresAt: string;
  readonly planHash: string;
  readonly previewHash: string;
  readonly readiness: 'LOCAL_READY' | 'MODEL_UNCONFIGURED';
  readonly runId: string;
  readonly sourceRevisionIds: readonly string[];
  readonly steps: readonly ('CLASSIFY' | 'EXTRACT_CLAIMS' | 'RECONCILE' | 'SUMMARIZE')[];
  readonly token: string;
}

export interface ConfirmSourceProcessingInput {
  readonly confirmation: 'START_SOURCE_PROCESSING';
  readonly planHash: string;
  readonly previewHash: string;
  readonly token: string;
}

export interface CancelSourceProcessingInput {
  readonly confirmation: 'CANCEL_SOURCE_PROCESSING';
  readonly expectedRevision: number;
  readonly runId: string;
}

export interface SyntheticResearchIntakeDraft {
  readonly authorName: string;
  readonly publicationDate: string;
  readonly sourceText: string;
  readonly sourceTitle: string;
  readonly workTitle: string;
}

export interface PreviewSyntheticResearchIntakeInput {
  readonly draft: SyntheticResearchIntakeDraft;
}

export interface SyntheticResearchIntakePreview {
  readonly claimLocators: readonly {
    readonly endCodePoint: number;
    readonly excerpt: string;
    readonly predicate: 'author' | 'canonical_title' | 'publication_date';
    readonly startCodePoint: number;
  }[];
  readonly estimatedExternalRequests: 0;
  readonly estimatedLocalWrites: number;
  readonly estimatedModelRequests: 0;
  readonly expiresAt: string;
  readonly feeState: 'NOT_INCURRED';
  readonly inputHash: string;
  readonly labels: readonly ['MANUAL_INPUT', 'SYNTHETIC_ONLY', 'LOCAL_PERSISTED', 'MODEL_UNUSED'];
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmSyntheticResearchIntakeInput {
  readonly confirmation: 'CREATE_SYNTHETIC_LOCAL_RESEARCH';
  readonly inputHash: string;
  readonly previewHash: string;
  readonly token: string;
}

export interface SyntheticResearchIntakeResult {
  readonly claims: readonly {
    readonly claimId: string;
    readonly evaluationId: string;
    readonly predicate: 'author' | 'canonical_title' | 'publication_date';
    readonly status: EvidenceClaimView['evaluationStatus'];
  }[];
  readonly externalRequestCount: 0;
  readonly feeState: 'NOT_INCURRED';
  readonly labels: SyntheticResearchIntakePreview['labels'];
  readonly modelRequestCount: 0;
  readonly sourceRevisionId: string;
  readonly workId: string;
}

export type RealResearchSourceType =
  'BIBLIOGRAPHIC_NOTE' | 'PUBLIC_DOMAIN_TEXT_EXCERPT' | 'USER_LOCAL_NOTE';

export type RealResearchClaimTarget = 'AUTHORSHIP' | 'NONE' | 'PUBLICATION_DATE' | 'WORK_TITLE';

export interface RealResearchStatementDraft {
  readonly claimTarget: RealResearchClaimTarget;
  readonly confirmed: boolean;
  readonly evidenceExcerpt: string;
  readonly evidenceLocator: string;
  readonly statement: string;
}

export interface RealResearchIntakeDraft {
  readonly authorName: string;
  readonly authorizationConfirmed: boolean;
  readonly editionNote: string;
  readonly publicationDate: string;
  readonly readingState: Extract<
    ReadingStateCode,
    'R1_READ_CLEAR' | 'R2_READ_FUZZY' | 'S1_RESEARCH_ONLY'
  >;
  readonly sourceLocator: string;
  readonly sourceTitle: string;
  readonly sourceType: RealResearchSourceType;
  readonly spoilerConfirmed: boolean;
  readonly spoilerLevel: AuthenticitySpoilerLevel;
  readonly statements: readonly RealResearchStatementDraft[];
  readonly workTitle: string;
}

const REAL_INTAKE_KEYS =
  'authorName authorizationConfirmed editionNote publicationDate readingState sourceLocator sourceTitle sourceType spoilerConfirmed spoilerLevel statements workTitle'.split(
    ' ',
  );
const REAL_STATEMENT_KEYS = 'claimTarget confirmed evidenceExcerpt evidenceLocator statement'.split(
  ' ',
);

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function intakeText(value: unknown, maximum: number, required: boolean): string | null {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    [...value].some((character) => character < ' ' || character === '\u007f')
  ) {
    return null;
  }
  const normalized = value.normalize('NFC');
  return normalized.length <= maximum && (!required || normalized.length > 0) ? normalized : null;
}

export function normalizeRealResearchIntakeDraft(value: unknown): RealResearchIntakeDraft | null {
  if (!exactObject(value, REAL_INTAKE_KEYS) || !Array.isArray(value.statements)) return null;
  const authorName = intakeText(value.authorName, 120, true);
  const editionNote = intakeText(value.editionNote, 512, false);
  const publicationDate = intakeText(value.publicationDate, 10, false);
  const sourceLocator = intakeText(value.sourceLocator, 500, false);
  const sourceTitle = intakeText(value.sourceTitle, 200, true);
  const workTitle = intakeText(value.workTitle, 200, true);
  if (
    authorName === null ||
    editionNote === null ||
    publicationDate === null ||
    sourceLocator === null ||
    sourceTitle === null ||
    workTitle === null ||
    workTitle === authorName ||
    value.authorizationConfirmed !== true ||
    typeof value.spoilerConfirmed !== 'boolean' ||
    !['R1_READ_CLEAR', 'R2_READ_FUZZY', 'S1_RESEARCH_ONLY'].includes(String(value.readingState)) ||
    !['BIBLIOGRAPHIC_NOTE', 'PUBLIC_DOMAIN_TEXT_EXCERPT', 'USER_LOCAL_NOTE'].includes(
      String(value.sourceType),
    ) ||
    !['NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS'].includes(String(value.spoilerLevel)) ||
    (value.spoilerLevel === 'FULL_TRICK_ANALYSIS' && value.spoilerConfirmed !== true) ||
    value.statements.length < 1 ||
    value.statements.length > 5 ||
    (publicationDate.length > 0 &&
      !/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/u.test(publicationDate)) ||
    (publicationDate.length === 10 &&
      new Date(`${publicationDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== publicationDate)
  )
    return null;
  const statements: RealResearchStatementDraft[] = [];
  for (const item of value.statements) {
    if (!exactObject(item, REAL_STATEMENT_KEYS)) return null;
    const statement = intakeText(item.statement, 1_000, true);
    const evidenceExcerpt = intakeText(item.evidenceExcerpt, 2_000, false);
    const evidenceLocator = intakeText(item.evidenceLocator, 500, false);
    if (
      statement === null ||
      evidenceExcerpt === null ||
      evidenceLocator === null ||
      item.confirmed !== true ||
      !['AUTHORSHIP', 'NONE', 'PUBLICATION_DATE', 'WORK_TITLE'].includes(
        String(item.claimTarget),
      ) ||
      (item.claimTarget === 'PUBLICATION_DATE' && publicationDate.length === 0)
    )
      return null;
    statements.push({
      claimTarget: item.claimTarget as RealResearchClaimTarget,
      confirmed: true,
      evidenceExcerpt,
      evidenceLocator,
      statement,
    });
  }
  return Object.freeze({
    authorName,
    authorizationConfirmed: true,
    editionNote,
    publicationDate,
    readingState: value.readingState as RealResearchIntakeDraft['readingState'],
    sourceLocator,
    sourceTitle,
    sourceType: value.sourceType as RealResearchSourceType,
    spoilerConfirmed: value.spoilerConfirmed,
    spoilerLevel: value.spoilerLevel as AuthenticitySpoilerLevel,
    statements: Object.freeze(statements),
    workTitle,
  });
}

export interface PreviewRealResearchIntakeInput {
  readonly draft: RealResearchIntakeDraft;
}

export interface RealResearchIntakePreview {
  readonly canConfirm: boolean;
  readonly entityResolution: {
    readonly candidates: readonly {
      readonly authorNames: readonly string[];
      readonly matchReasons: readonly ('AUTHOR_NAME' | 'WORK_TITLE')[];
      readonly workId: string;
      readonly workTitle: string;
    }[];
    readonly outcome: 'AMBIGUOUS_REVIEW_REQUIRED' | 'CREATE_NEW';
  };
  readonly estimatedExternalRequests: 0;
  readonly estimatedModelRequests: 0;
  readonly expiresAt: string;
  readonly feeState: 'NOT_INCURRED';
  readonly inputHash: string;
  readonly previewHash: string;
  readonly readingState: RealResearchIntakeDraft['readingState'];
  readonly source: {
    readonly originKind: 'USER_LOCAL_INPUT';
    readonly sourceLocator: string | null;
    readonly sourceTitle: string;
    readonly sourceType: RealResearchSourceType;
  };
  readonly spoilerLevel: AuthenticitySpoilerLevel;
  readonly statements: readonly {
    readonly claimTarget: RealResearchClaimTarget;
    readonly classification: StatementKind;
    readonly disposition: 'CLAIM_WITH_EVIDENCE' | 'CLAIM_WITHOUT_EVIDENCE' | 'SOURCE_ONLY_NON_FACT';
    readonly evidenceExcerpt: string | null;
    readonly evidenceLocator: string | null;
    readonly statement: string;
  }[];
  readonly token: string;
}

export interface ConfirmRealResearchIntakeInput {
  readonly confirmation: 'CREATE_AUTHORIZED_REAL_RESEARCH';
  readonly inputHash: string;
  readonly previewHash: string;
  readonly token: string;
}

export interface RealResearchIntakeResult {
  readonly externalRequestCount: 0;
  readonly feeState: 'NOT_INCURRED';
  readonly modelRequestCount: 0;
  readonly readingState: RealResearchIntakeDraft['readingState'];
  readonly scoreRecordsCreated: 0;
  readonly sourceOriginKind: 'USER_LOCAL_INPUT';
  readonly sourceRevisionId: string;
  readonly spoilerLevel: AuthenticitySpoilerLevel;
  readonly statements: readonly {
    readonly claimId: string | null;
    readonly classification: StatementKind;
    readonly evaluationId: string | null;
    readonly evidenceId: string | null;
    readonly status: EvidenceClaimView['evaluationStatus'] | 'SOURCE_ONLY_NON_FACT';
  }[];
  readonly workId: string;
}
