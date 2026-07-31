import type { ContentDraftPayloadV1 } from '@mystery-operations/copy';
import type {
  DraftArtifactKind,
  FactMappingCheckVersionV1,
  FactMappingMode,
  FactMappingPlanV1,
  FactMappingRunV1,
  FactMappingRollupV1,
  MappingRelation,
  StatementDisposition,
  StatementKind,
  FactDomain,
  FactMateriality,
  ReadingAuthenticityReasonCode,
  ReadingAuthenticityStatus,
} from '@mystery-operations/quality';

export type FactMappingDisplayStatus =
  'AWAITING_REVIEW' | 'FACT_BLOCKED' | 'PASS' | 'STALE' | 'UNCHECKED';

export interface PreviewReadingAuthenticityInput {
  readonly draftId: string;
  readonly expectedRevision: number;
}

export interface ReadingAuthenticityFindingView {
  readonly artifactId: string;
  readonly artifactKind: DraftArtifactKind;
  readonly disposition: 'BLOCKED' | 'REVIEW_REQUIRED';
  readonly draftVersionId: string;
  readonly endCodePoint: number;
  readonly reasonCode: ReadingAuthenticityReasonCode;
  readonly selectedTextHash: string;
  readonly startCodePoint: number;
  readonly textHash: string;
}

export interface ReadingAuthenticityReadModel {
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftVersionId: string;
  readonly evaluatedAt: string;
  readonly evaluationStatus: Exclude<ReadingAuthenticityStatus, 'STALE' | 'NOT_RUN'>;
  readonly findings: readonly ReadingAuthenticityFindingView[];
  readonly reasonCodes: readonly ReadingAuthenticityReasonCode[];
  readonly savedStatus: ReadingAuthenticityStatus;
  readonly truncated: boolean;
}

export interface ReadingAuthenticityPreview {
  readonly expiresAt: string;
  readonly preview: {
    readonly costState: 'NOT_APPLICABLE';
    readonly externalRequestCount: 0;
    readonly readModel: ReadingAuthenticityReadModel;
    readonly writes: readonly ['APPEND_QUALITY_CHECK'];
  };
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmReadingAuthenticityInput {
  readonly confirmation: 'SAVE_READING_AUTHENTICITY_CHECK';
  readonly expectedRevision: number;
  readonly previewHash: string;
  readonly token: string;
}

export interface ReadingAuthenticityResult {
  readonly readModel: ReadingAuthenticityReadModel;
}

export interface GetFactMappingChecksInput {
  readonly limit: number;
  readonly offset: number;
  readonly status: FactMappingDisplayStatus | null;
}

export interface GetFactMappingCheckInput {
  readonly draftId: string;
}

export interface GetFactMappingClaimChainInput {
  readonly statementId: string;
}

export interface FactMappingListItemView {
  readonly briefVersionId: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftVersionId: string;
  readonly profileId: ContentDraftPayloadV1['profileId'];
  readonly status: FactMappingDisplayStatus;
  readonly structuralStatus: 'READY_FOR_QUALITY_PIPELINE';
  readonly versionNumber: number;
  readonly workIds: readonly string[];
}

export interface FactMappingListView {
  readonly items: readonly FactMappingListItemView[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface FactMappingStatementView {
  readonly artifactId: string;
  readonly artifactKind: DraftArtifactKind;
  readonly claimId: string | null;
  readonly compatibilityReasonCode: string | null;
  readonly disposition: StatementDisposition;
  readonly domain: FactDomain;
  readonly factPolicyReasonCode: string | null;
  readonly fragment: string;
  readonly kind: StatementKind;
  readonly materiality: FactMateriality;
  readonly protectedSignals: readonly string[];
  readonly relation: MappingRelation | null;
  readonly statementId: string;
  readonly statementOrder: number;
  readonly startCodePoint: number;
  readonly endCodePoint: number;
}

export interface FactMappingCandidateView {
  readonly claimId: string;
  readonly current: boolean;
  readonly evaluationStatus: string | null;
  readonly evidenceCount: number;
  readonly factPolicyReasonCode: string;
  readonly factPolicySatisfied: boolean;
  readonly predicate: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly valueSummary: string;
  readonly valueType: string;
}

export interface FactMappingClaimChainView {
  readonly claim: {
    readonly claimId: string;
    readonly current: boolean;
    readonly predicate: string;
    readonly revision: number;
    readonly scopeSummary: string;
    readonly subjectId: string;
    readonly subjectType: string;
    readonly valueSummary: string;
    readonly valueType: string;
  };
  readonly conflicts: readonly {
    readonly conflictId: string;
    readonly state: string;
  }[];
  readonly evaluation: {
    readonly createdAt: string;
    readonly evaluationId: string;
    readonly policyVersion: string;
    readonly reasonCode: string;
    readonly status: string;
  };
  readonly evidence: readonly {
    readonly excerpt: string;
    readonly relation: 'CONTRADICTS' | 'QUALIFIES' | 'SUPPORTS';
    readonly revision: number;
    readonly source: {
      readonly authorityTier: string;
      readonly availability: string;
      readonly contentHashSummary: string;
      readonly current: boolean;
      readonly displayHost: string | null;
      readonly independence: string;
      readonly language: string;
      readonly lineageGroup: string | null;
      readonly publisherOrSite: string | null;
      readonly revisionId: string;
      readonly title: string;
      readonly useClass: string;
    };
    readonly summaryZh: string | null;
    readonly summaryZhIsEvidence: false;
  }[];
  readonly statementId: string;
}

export interface FactMappingDetailView extends FactMappingListItemView {
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly artifactKind: DraftArtifactKind;
    readonly codePointLength: number;
    readonly coveredStatementCount: number;
    readonly textHash: string;
  }[];
  readonly candidates: readonly FactMappingCandidateView[];
  readonly checkVersion: FactMappingCheckVersionV1 | null;
  readonly history: readonly {
    readonly createdAt: string;
    readonly current: boolean;
    readonly dependencyHash: string;
    readonly inputHash: string;
    readonly reasonCodes: readonly string[];
    readonly status: FactMappingDisplayStatus;
    readonly versionId: string;
    readonly versionNumber: number;
  }[];
  readonly invalidationReasons: readonly string[];
  readonly rollup: FactMappingRollupV1 | null;
  readonly runs: readonly FactMappingRunV1[];
  readonly statements: readonly FactMappingStatementView[];
}

interface FactMappingDecisionBase {
  readonly draftId: string;
  readonly expectedRevision: number;
  readonly reason: string | null;
  readonly statementId: string;
}

export type PreviewFactMappingDecisionInput =
  | (FactMappingDecisionBase & {
      readonly kind: 'CONFIRM_CLASSIFICATION';
    })
  | (FactMappingDecisionBase & {
      readonly domain: FactDomain;
      readonly kind: 'RECLASSIFY';
      readonly materiality: FactMateriality;
      readonly statementKind: StatementKind;
    })
  | (FactMappingDecisionBase & {
      readonly kind: 'SPLIT';
      readonly splitCodePoint: number;
    })
  | (FactMappingDecisionBase & {
      readonly claimId: string;
      readonly kind: 'MAP_CLAIM';
      readonly relation: Extract<
        MappingRelation,
        'EXACT' | 'NARROWER_THAN_CLAIM' | 'SUPPORTED_PARAPHRASE'
      >;
    })
  | (FactMappingDecisionBase & {
      readonly kind: 'UNMAP_CLAIM';
    })
  | (FactMappingDecisionBase & {
      readonly kind: 'UNDO';
      readonly targetVersionId: string;
    })
  | (FactMappingDecisionBase & {
      readonly kind: 'REOPEN';
    });

export interface FactMappingDecisionPreviewView {
  readonly after: {
    readonly claimId: string | null;
    readonly disposition: StatementDisposition;
    readonly domain: FactDomain;
    readonly kind: StatementKind;
    readonly materiality: FactMateriality;
    readonly relation: MappingRelation | null;
  };
  readonly before: {
    readonly claimId: string | null;
    readonly disposition: StatementDisposition;
    readonly domain: FactDomain;
    readonly kind: StatementKind;
    readonly materiality: FactMateriality;
    readonly relation: MappingRelation | null;
  };
  readonly draftId: string;
  readonly draftVersionId: string;
  readonly expectedRevision: number;
  readonly expectedStatus: 'AWAITING_REVIEW' | 'FACT_BLOCKED' | 'PASS';
  readonly kind: PreviewFactMappingDecisionInput['kind'];
  readonly statementId: string;
}

export interface FactMappingDecisionPreview {
  readonly expiresAt: string;
  readonly preview: FactMappingDecisionPreviewView;
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmFactMappingDecisionInput {
  readonly confirmation: 'APPLY_FACT_MAPPING_ACTION';
  readonly executionId: string;
  readonly kind: PreviewFactMappingDecisionInput['kind'];
  readonly previewHash: string;
  readonly token: string;
}

export interface FactMappingDecisionResult {
  readonly decisionId: string;
  readonly detail: FactMappingDetailView;
  readonly kind: PreviewFactMappingDecisionInput['kind'];
}

export type PreviewFactMappingActionInput =
  | {
      readonly draftId: string;
      readonly kind: 'START';
      readonly mode: FactMappingMode;
    }
  | {
      readonly executionId: string;
      readonly expectedRevision: number;
      readonly kind: 'CANCEL';
    };

export type FactMappingActionPreviewView =
  | {
      readonly kind: 'START';
      readonly plan: FactMappingPlanV1;
      readonly writes: readonly string[];
    }
  | {
      readonly executionId: string;
      readonly expectedRevision: number;
      readonly kind: 'CANCEL';
    };

export type FactMappingActionPreview =
  | {
      readonly expiresAt: string;
      readonly kind: 'START';
      readonly preview: Extract<FactMappingActionPreviewView, { readonly kind: 'START' }>;
      readonly previewHash: string;
      readonly token: string;
    }
  | {
      readonly expiresAt: string;
      readonly kind: 'CANCEL';
      readonly preview: Extract<FactMappingActionPreviewView, { readonly kind: 'CANCEL' }>;
      readonly previewHash: string;
      readonly token: string;
    };

export interface ConfirmFactMappingActionInput {
  readonly confirmation: 'APPLY_FACT_MAPPING_ACTION';
  readonly executionId: string | null;
  readonly kind: PreviewFactMappingActionInput['kind'];
  readonly previewHash: string;
  readonly token: string;
}

export type FactMappingActionResult =
  | {
      readonly enqueueRequired: true;
      readonly kind: 'START';
      readonly run: FactMappingRunV1;
    }
  | {
      readonly kind: 'CANCEL';
      readonly run: FactMappingRunV1;
    };
