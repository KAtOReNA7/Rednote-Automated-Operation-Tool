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
  readonly originKind: 'BROWSER_CLIP' | 'FETCH_DOCUMENT' | 'SYNTHETIC_FIXTURE';
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
