import type {
  TopicBatchStateChangeDraft,
  TopicCandidateState,
  TopicContentType,
  TopicEligibilityState,
  TopicStateChangeDraft,
} from '@mystery-operations/topics';

export interface GetTopicPoolInput {
  readonly contentType: TopicContentType | null;
  readonly eligibility: TopicEligibilityState | null;
  readonly limit: number;
  readonly offset: number;
  readonly profileId: string;
  readonly query: string;
  readonly state: TopicCandidateState | null;
}

export interface GetTopicInput {
  readonly historyLimit: number;
  readonly topicId: string;
}

export interface TopicRankingComponentView {
  readonly knowledgeState: 'KNOWN' | 'UNKNOWN';
  readonly reasonCodes: readonly string[];
  readonly type:
    | 'EVIDENCE_SUFFICIENCY'
    | 'CONTENT_FIT'
    | 'DIFFERENTIATION'
    | 'ESTIMATED_COST'
    | 'APPROVAL_WORKLOAD';
  readonly valueBasisPoints: number | null;
}

export interface TopicPoolItem {
  readonly analysisMode: 'PERSONAL' | 'PUBLIC_RESEARCH';
  readonly candidateState: TopicCandidateState;
  readonly contentType: TopicContentType;
  readonly eligibility: TopicEligibilityState;
  readonly eligibilityReasonCodes: readonly string[];
  readonly fingerprint: string;
  readonly rankingComplete: boolean;
  readonly revision: number;
  readonly spoilerLevel: 'NO_SPOILER' | 'LIGHT_SPOILER' | 'FULL_TRICK_ANALYSIS';
  readonly stale: boolean;
  readonly topicAngle: string;
  readonly topicId: string;
  readonly totalScoreBasisPoints: number;
  readonly versionNumber: number;
}

export interface TopicDetailView extends TopicPoolItem {
  readonly candidateJudgment: string | null;
  readonly centralQuestion: string;
  readonly comparisonDimension: string | null;
  readonly history: readonly {
    readonly action: string;
    readonly createdAt: string;
    readonly fromState: TopicCandidateState | null;
    readonly revision: number;
    readonly toState: TopicCandidateState;
  }[];
  readonly ranking: readonly TopicRankingComponentView[];
  readonly requiredPublicLabels: readonly string[];
  readonly spoilerPolicy: {
    readonly userConfirmationRequired: boolean;
    readonly warningPlacement: 'NONE' | 'BODY_OPENING' | 'COVER_TITLE_AND_BODY_OPENING';
    readonly warningRequired: boolean;
  };
  readonly subjects: readonly {
    readonly expressionForm: string | null;
    readonly role: string;
    readonly subjectId: string;
    readonly subjectType: string;
    readonly workId: string;
  }[];
}

export interface TopicQuotaCategoryView {
  readonly archivedCount: number;
  readonly conflicts: readonly {
    readonly code: 'OVER_LOCKED';
    readonly topicIds: readonly string[];
  }[];
  readonly contentType: TopicContentType;
  readonly heldCount: number;
  readonly lockedEligibleCount: number;
  readonly required: number;
  readonly selected: number;
  readonly shortfall: number;
}

export interface TopicQuotaPlanView {
  readonly categories: readonly TopicQuotaCategoryView[];
  readonly createdAt: string;
  readonly members: readonly {
    readonly contentType: TopicContentType;
    readonly locked: boolean;
    readonly position: number;
    readonly scoreBasisPoints: number;
    readonly topicId: string;
  }[];
  readonly planVersionId: string;
  readonly poolSnapshotHash: string;
  readonly status: 'COMPLETE' | 'INCOMPLETE' | 'STALE' | 'SUPERSEDED';
  readonly totalRequired: number;
  readonly totalSelected: number;
  readonly versionNumber: number;
}

export interface TopicGenerationRunView {
  readonly createdAt: string;
  readonly externalRequestCount: 0;
  readonly resultCandidateCount: number;
  readonly revision: number;
  readonly runId: string;
  readonly status:
    | 'CONFIRMED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'NO_OP'
    | 'CANCEL_REQUESTED'
    | 'CANCELLED'
    | 'FAILED'
    | 'AMBIGUOUS';
  readonly updatedAt: string;
}

export interface TopicPoolWorkspaceView {
  readonly counts: Readonly<Record<TopicContentType, number>>;
  readonly currentPlan: TopicQuotaPlanView | null;
  readonly items: readonly TopicPoolItem[];
  readonly limit: number;
  readonly offset: number;
  readonly planHistory: readonly TopicQuotaPlanView[];
  readonly profileId: string;
  readonly recentGenerationRuns: readonly TopicGenerationRunView[];
  readonly total: number;
}

export type PreviewTopicActionInput =
  | {
      readonly kind: 'GENERATE';
      readonly profileId: string;
    }
  | {
      readonly draft: TopicStateChangeDraft;
      readonly kind: 'STATE_CHANGE';
    }
  | {
      readonly expectedRevision: number;
      readonly kind: 'STATE_UNDO';
      readonly topicId: string;
    }
  | {
      readonly draft: TopicBatchStateChangeDraft;
      readonly kind: 'BATCH_STATE_CHANGE';
    }
  | {
      readonly kind: 'QUOTA_PLAN';
      readonly maxWorkExposure: number;
      readonly profileId: string;
    }
  | {
      readonly expectedRevision: number;
      readonly kind: 'CANCEL_GENERATION';
      readonly runId: string;
    };

export type TopicActionPreviewView =
  | {
      readonly counts: Readonly<Record<TopicContentType, number>>;
      readonly deduplicationLimit: number;
      readonly estimatedLocalWrites: number;
      readonly estimatedModelRequests: 0;
      readonly expectedPolicyVersions: Readonly<{
        readonly authenticity: string;
        readonly dossierCoverage: string;
        readonly expressionPermission: string;
        readonly fact: string;
        readonly spoiler: string;
        readonly topicEligibility: string;
        readonly topicFingerprint: string;
      }>;
      readonly inputWorkCount: number;
      readonly kind: 'GENERATE';
      readonly localCombinationUpperBound: number;
      readonly modelExecutionState: 'UNCONFIGURED_DISABLED';
      readonly planHash: string;
    }
  | {
      readonly action: string;
      readonly after: TopicCandidateState;
      readonly before: TopicCandidateState;
      readonly expectedRevision: number;
      readonly kind: 'STATE_CHANGE' | 'STATE_UNDO';
      readonly topicId: string;
    }
  | {
      readonly action: string;
      readonly items: readonly {
        readonly after: TopicCandidateState;
        readonly before: TopicCandidateState;
        readonly expectedRevision: number;
        readonly topicId: string;
      }[];
      readonly kind: 'BATCH_STATE_CHANGE';
    }
  | {
      readonly categories: readonly TopicQuotaCategoryView[];
      readonly kind: 'QUOTA_PLAN';
      readonly maxWorkExposure: number;
      readonly noOp: boolean;
      readonly poolSnapshotHash: string;
      readonly status: 'COMPLETE' | 'INCOMPLETE';
      readonly totalRequired: 30;
      readonly totalSelected: number;
      readonly warnings: readonly string[];
    }
  | {
      readonly expectedRevision: number;
      readonly kind: 'CANCEL_GENERATION';
      readonly runId: string;
    };

export interface TopicActionPreview {
  readonly expiresAt: string;
  readonly kind: PreviewTopicActionInput['kind'];
  readonly preview: TopicActionPreviewView;
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmTopicActionInput {
  readonly confirmation: 'APPLY_TOPIC_ACTION';
  readonly executionId: string | null;
  readonly kind: PreviewTopicActionInput['kind'];
  readonly previewHash: string;
  readonly token: string;
}

export interface TopicGenerationExecutionView {
  readonly createdCount: number;
  readonly duplicateCount: number;
  readonly executionId: string;
  readonly externalRequestCount: 0;
  readonly noOp: boolean;
  readonly planId: string;
  readonly replayed: boolean;
  readonly runId: string;
  readonly status: 'CONFIRMED' | 'SUCCEEDED' | 'NO_OP';
}

export interface TopicQuotaExecutionView {
  readonly executionId: string;
  readonly expectedPlanStatus: 'COMPLETE' | 'INCOMPLETE';
  readonly externalRequestCount: 0;
  readonly planVersionId: string | null;
  readonly runId: string;
  readonly status: 'CONFIRMED' | 'RUNNING' | 'SUCCEEDED' | 'NO_OP' | 'CANCELLED' | 'FAILED';
  readonly totalSelected: number;
}

export interface TopicBatchApplyView {
  readonly failed: number;
  readonly items: readonly {
    readonly errorCode: string | null;
    readonly ok: boolean;
    readonly revision: number | null;
    readonly topicId: string;
  }[];
  readonly succeeded: number;
}

export type TopicActionResult =
  | {
      readonly generation: TopicGenerationExecutionView;
      readonly kind: 'GENERATE';
    }
  | {
      readonly detail: TopicDetailView;
      readonly kind: 'STATE_CHANGE' | 'STATE_UNDO';
    }
  | {
      readonly batch: TopicBatchApplyView;
      readonly kind: 'BATCH_STATE_CHANGE';
    }
  | {
      readonly kind: 'QUOTA_PLAN';
      readonly quota: TopicQuotaExecutionView;
    }
  | {
      readonly kind: 'CANCEL_GENERATION';
      readonly run: {
        readonly revision: number;
        readonly runId: string;
        readonly status: 'CANCELLED';
      };
    };
