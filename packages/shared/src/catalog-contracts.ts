export type CatalogOriginKind = 'BROWSER_CLIP_CANDIDATE' | 'FETCH_DOCUMENT' | 'SEARCH_CANDIDATE';

export type CatalogDiscoveryPurpose = 'CUSTOM' | 'MARKET_MAP' | 'PILOT_CONTENT';

export interface CatalogRunView {
  readonly executionId: string | null;
  readonly externalRequestCount: 0;
  readonly jobId: string | null;
  readonly planId: string;
  readonly revision: number;
  readonly runId: string;
  readonly status: string;
  readonly synthetic: boolean;
}

export interface CatalogCoverageView {
  readonly conflictCount: number;
  readonly editionCount: number;
  readonly exactLinkCount: number;
  readonly expressionCount: number;
  readonly gapReason: string | null;
  readonly invalidIdentifierCount: number;
  readonly label: string;
  readonly manualDecisionCount: number;
  readonly observationCount: number;
  readonly postResolutionCount: number;
  readonly plannedObservations: number;
  readonly preResolutionCount: number;
  readonly provenanceCompleteCount: number;
  readonly rejectedCount: number;
  readonly required: boolean;
  readonly reviewCount: number;
  readonly stratumId: string;
  readonly synthetic: boolean;
  readonly unresolvedCount: number;
  readonly workCount: number;
}

export interface CatalogResolutionCaseView {
  readonly candidateEntityId: string | null;
  readonly caseId: string;
  readonly entityType: string;
  readonly observationId: string;
  readonly outcome: string;
  readonly revision: number;
}

export interface CatalogWorkListItem {
  readonly canonicalTitle: string;
  readonly editionCount: number;
  readonly expressionCount: number;
  readonly revision: number;
  readonly state: string;
  readonly workId: string;
}

export interface CatalogSummaryView {
  readonly counts: {
    readonly editions: number;
    readonly expressions: number;
    readonly observations: number;
    readonly openReviewCases: number;
    readonly works: number;
  };
  readonly coverage: readonly CatalogCoverageView[];
  readonly latestRun: CatalogRunView | null;
  readonly reviewCases: readonly CatalogResolutionCaseView[];
  readonly synthetic: boolean;
  readonly works: readonly CatalogWorkListItem[];
}

export interface CatalogWorkDetail extends CatalogWorkListItem {
  readonly aliases: readonly {
    readonly kind: string;
    readonly normalized: string;
    readonly raw: string;
  }[];
  readonly expressions: readonly {
    readonly editions: readonly {
      readonly editionId: string;
      readonly identifiers: readonly {
        readonly namespace: string;
        readonly value: string;
      }[];
      readonly label: string | null;
      readonly publisher: string | null;
      readonly state: string;
    }[];
    readonly expressionId: string;
    readonly kind: string;
    readonly language: string | null;
    readonly state: string;
    readonly title: string | null;
  }[];
  readonly observationIds: readonly string[];
  readonly observations: readonly {
    readonly factStatus: 'NOT_A_FACT';
    readonly fieldProvenanceCount: number;
    readonly observationId: string;
    readonly originKind: string;
    readonly truthStatus: 'UNVERIFIED';
  }[];
  readonly publicationRelationships: readonly {
    readonly language: string | null;
    readonly objectAgentName: string | null;
    readonly role: string;
    readonly scopeId: string | null;
    readonly scopeType: string | null;
    readonly subjectAgentName: string;
    readonly territory: string | null;
    readonly verificationState: string;
  }[];
  readonly relations: readonly {
    readonly agentName: string;
    readonly role: string;
    readonly scopeId: string;
    readonly scopeType: string;
    readonly verificationState: string;
  }[];
}

export interface GetCatalogStateInput {
  readonly limit: number;
  readonly offset: number;
  readonly query: string;
}

export interface GetCatalogWorkInput {
  readonly workId: string;
}

export interface PreviewCatalogDiscoveryInput {
  readonly batchSize: number;
  readonly maxObservations: number;
  readonly maxRuntimeMs: number;
  readonly originKinds: readonly CatalogOriginKind[];
  readonly purpose: CatalogDiscoveryPurpose;
}

export interface CatalogDiscoveryPreview {
  readonly expiresAt: string;
  readonly originCount: number;
  readonly planHash: string;
  readonly previewHash: string;
  readonly profile: {
    readonly profileId: string;
    readonly strata: readonly {
      readonly label: string;
      readonly required: boolean;
      readonly stratumId: string;
      readonly targetObservations: number;
    }[];
    readonly synthetic: false;
  };
  readonly run: CatalogRunView;
  readonly token: string;
}

export interface ConfirmCatalogDiscoveryInput {
  readonly confirmation: 'START_BIBLIOGRAPHY_DISCOVERY';
  readonly expectedRevision: number;
  readonly previewHash: string;
  readonly token: string;
}

export interface CancelCatalogDiscoveryInput {
  readonly confirmation: 'CANCEL_BIBLIOGRAPHY_DISCOVERY';
  readonly expectedRevision: number;
  readonly runId: string;
}

export interface PreviewCatalogWorkMergeInput {
  readonly duplicateRevision: number;
  readonly duplicateWorkId: string;
  readonly survivorRevision: number;
  readonly survivorWorkId: string;
}

export interface PreviewCatalogWorkSplitInput {
  readonly expressionIds: readonly string[];
  readonly newCanonicalTitle: string;
  readonly sourceRevision: number;
  readonly sourceWorkId: string;
}

export interface PreviewCatalogUndoInput {
  readonly decisionId: string;
}

export type CatalogActionKind = 'MERGE_WORKS' | 'SPLIT_WORK' | 'UNDO_DECISION';

export interface CatalogActionPreview {
  readonly expiresAt: string;
  readonly kind: CatalogActionKind;
  readonly previewHash: string;
  readonly summary: Readonly<Record<string, number | string | readonly string[]>>;
  readonly token: string;
}

export interface ConfirmCatalogActionInput {
  readonly confirmation: 'APPLY_CATALOG_DECISION';
  readonly previewHash: string;
  readonly token: string;
}

export interface CatalogActionResult {
  readonly decisionId: string;
  readonly kind: CatalogActionKind;
}
