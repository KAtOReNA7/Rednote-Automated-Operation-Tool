import type {
  BriefDependency,
  BriefEvidenceRef,
  BriefGenerationPlan,
  BriefGenerationRun,
  BriefProfileId,
  BriefReadinessSnapshot,
  ContentBriefDraft,
} from '@mystery-operations/briefs';

export type {
  BriefAudienceKnowledgeLevel,
  BriefReadinessContext,
  ContentBriefDraft,
} from '@mystery-operations/briefs';

export interface GetBriefsInput {
  readonly limit: number;
  readonly offset: number;
  readonly profileId: BriefProfileId | null;
  readonly query: string;
  readonly readiness: BriefReadinessSnapshot['status'] | null;
  readonly state: 'ACTIVE' | 'ARCHIVED' | null;
}

export interface GetBriefInput {
  readonly briefId: string;
  readonly evidenceLimit: number;
  readonly evidenceOffset: number;
  readonly generationLimit: number;
  readonly generationOffset: number;
  readonly historyLimit: number;
  readonly historyOffset: number;
  readonly versionLimit: number;
  readonly versionOffset: number;
}

export interface BriefListItemView {
  readonly briefId: string;
  readonly experimentBound: boolean;
  readonly profileId: BriefProfileId;
  readonly readiness: BriefReadinessSnapshot['status'];
  readonly revision: number;
  readonly stale: boolean;
  readonly state: 'ACTIVE' | 'ARCHIVED';
  readonly topicId: string;
  readonly updatedAt: string;
  readonly versionNumber: number;
}

export interface BriefListView {
  readonly counts: Readonly<Record<BriefReadinessSnapshot['status'], number>>;
  readonly items: readonly BriefListItemView[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface BriefDetailView extends BriefListItemView {
  readonly dependencies: readonly BriefDependency[];
  readonly draft: ContentBriefDraft;
  readonly evidencePage: {
    readonly items: readonly BriefEvidenceRef[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
  readonly generationRuns: readonly BriefGenerationRun[];
  readonly generationPage: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
  readonly history: readonly {
    readonly action: string;
    readonly createdAt: string;
    readonly fromState: 'ACTIVE' | 'ARCHIVED' | null;
    readonly revision: number;
    readonly toState: 'ACTIVE' | 'ARCHIVED';
  }[];
  readonly historyPage: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
  readonly invalidationReasons: readonly string[];
  readonly readinessReasonCodes: readonly string[];
  readonly versionHistory: {
    readonly items: readonly {
      readonly changeKinds: readonly string[];
      readonly createdAt: string;
      readonly isCurrent: boolean;
      readonly readiness: BriefReadinessSnapshot['status'];
      readonly status: 'DRAFT' | 'MODEL_CANDIDATE' | 'USER_CONFIRMED' | 'ARCHIVED';
      readonly versionId: string;
      readonly versionNumber: number;
    }[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
}

export type PreviewBriefActionInput =
  | {
      readonly assignmentPlanId: string | null;
      readonly kind: 'CREATE_SCAFFOLD';
      readonly topicId: string;
    }
  | {
      readonly briefId: string;
      readonly draft: ContentBriefDraft;
      readonly expectedRevision: number;
      readonly kind: 'SAVE_EDIT';
    }
  | {
      readonly briefId: string;
      readonly expectedRevision: number;
      readonly fieldPath: string;
      readonly kind: 'LOCK_FIELD' | 'UNLOCK_FIELD';
    }
  | {
      readonly briefId: string;
      readonly expectedRevision: number;
      readonly kind: 'CLONE' | 'UNDO';
      readonly targetVersionId: string;
    }
  | {
      readonly briefId: string;
      readonly expectedRevision: number;
      readonly kind: 'ARCHIVE' | 'RESTORE' | 'PREVIEW_GENERATION';
    }
  | {
      readonly expectedRevision: number;
      readonly kind: 'CANCEL_GENERATION';
      readonly runId: string;
    };

export type BriefActionPreviewView =
  | {
      readonly evidenceRefCount: number;
      readonly experimentBound: boolean;
      readonly kind: 'CREATE_SCAFFOLD';
      readonly profileId: BriefProfileId;
      readonly readiness: BriefReadinessSnapshot['status'];
      readonly readinessReasonCodes: readonly string[];
      readonly subjectCount: number;
      readonly topicId: string;
    }
  | {
      readonly briefId: string;
      readonly changedFieldCount: number;
      readonly expectedRevision: number;
      readonly kind: 'SAVE_EDIT';
      readonly readiness: BriefReadinessSnapshot['status'];
      readonly readinessReasonCodes: readonly string[];
    }
  | {
      readonly briefId: string;
      readonly expectedRevision: number;
      readonly fieldPath: string;
      readonly kind: 'LOCK_FIELD' | 'UNLOCK_FIELD';
    }
  | {
      readonly briefId: string;
      readonly expectedRevision: number;
      readonly kind: 'CLONE' | 'UNDO';
      readonly targetVersionId: string;
    }
  | {
      readonly briefId: string;
      readonly expectedRevision: number;
      readonly kind: 'ARCHIVE' | 'RESTORE';
    }
  | ({
      readonly kind: 'PREVIEW_GENERATION';
      readonly modelConfigured: boolean;
      readonly noNetworkBeforeConfirmation: true;
    } & BriefGenerationPlan)
  | {
      readonly expectedRevision: number;
      readonly kind: 'CANCEL_GENERATION';
      readonly runId: string;
    };

export interface BriefActionPreview {
  readonly expiresAt: string;
  readonly kind: PreviewBriefActionInput['kind'];
  readonly preview: BriefActionPreviewView;
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmBriefActionInput {
  readonly confirmation: 'APPLY_CONTENT_BRIEF_ACTION';
  readonly executionId: string | null;
  readonly kind: PreviewBriefActionInput['kind'];
  readonly previewHash: string;
  readonly token: string;
}

export type BriefActionResult =
  | {
      readonly detail: BriefDetailView;
      readonly kind: Exclude<
        PreviewBriefActionInput['kind'],
        'PREVIEW_GENERATION' | 'CANCEL_GENERATION'
      >;
    }
  | {
      readonly generation: {
        readonly enqueueRequired: boolean;
        readonly run: BriefGenerationRun;
      };
      readonly kind: 'PREVIEW_GENERATION';
    }
  | {
      readonly kind: 'CANCEL_GENERATION';
      readonly run: BriefGenerationRun;
    };
