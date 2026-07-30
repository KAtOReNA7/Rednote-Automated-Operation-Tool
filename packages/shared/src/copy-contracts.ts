import type {
  ContentDraftPayloadV1,
  CopyDraftStatus,
  CopyMutationPlanV1,
  CopyMutationRunV1,
  CopyRewriteScopeV1,
  DraftStructuralValidationV1,
} from '@mystery-operations/copy';

export type {
  ContentDraftPayloadV1,
  CopyDraftStatus,
  CopyMutationPlanV1,
  CopyMutationRunV1,
  CopyRewriteScopeV1,
  DraftStructuralValidationV1,
} from '@mystery-operations/copy';

export interface GetCopyDraftsInput {
  readonly briefId: string | null;
  readonly limit: number;
  readonly offset: number;
  readonly profileId: ContentDraftPayloadV1['profileId'] | null;
  readonly query: string;
  readonly state: 'ACTIVE' | 'ARCHIVED' | null;
  readonly status: CopyDraftStatus | null;
}

export interface GetCopyDraftInput {
  readonly draftId: string;
  readonly runLimit: number;
  readonly runOffset: number;
  readonly versionLimit: number;
  readonly versionOffset: number;
}

export interface CopyDraftListItemView {
  readonly briefId: string;
  readonly draftId: string;
  readonly profileId: ContentDraftPayloadV1['profileId'];
  readonly revision: number;
  readonly state: 'ACTIVE' | 'ARCHIVED';
  readonly status: CopyDraftStatus;
  readonly updatedAt: string;
  readonly versionNumber: number;
}

export interface CopyDraftListView {
  readonly counts: Readonly<Record<CopyDraftStatus, number>>;
  readonly items: readonly CopyDraftListItemView[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface CopyDraftDetailView extends CopyDraftListItemView {
  readonly invalidationReasons: readonly string[];
  readonly payload: ContentDraftPayloadV1;
  readonly runs: readonly CopyMutationRunV1[];
  readonly validation: DraftStructuralValidationV1;
  readonly versionHistory: {
    readonly items: readonly {
      readonly changeKinds: readonly string[];
      readonly createdAt: string;
      readonly isCurrent: boolean;
      readonly sourceKind: 'LEGACY' | 'MANUAL' | 'MODEL' | 'REWRITE';
      readonly status: CopyDraftStatus;
      readonly versionId: string;
      readonly versionNumber: number;
    }[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
}

export interface DiffCopyDraftVersionsInput {
  readonly draftId: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
}

export interface CopyDraftVersionDiffView {
  readonly changedFields: readonly string[];
  readonly fromVersionId: string;
  readonly toVersionId: string;
}

export type PreviewCopyActionInput =
  | {
      readonly briefId: string;
      readonly kind: 'CREATE_MANUAL_SCAFFOLD';
    }
  | {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly kind: 'SAVE_VERSION';
      readonly payload: ContentDraftPayloadV1;
    }
  | {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly fieldPath: string;
      readonly kind: 'LOCK_FIELD' | 'UNLOCK_FIELD';
    }
  | {
      readonly blockIds: readonly string[];
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly kind: 'REORDER_BLOCKS';
    }
  | {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly kind: 'UNDO';
      readonly targetVersionId: string;
    }
  | {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly kind: 'ARCHIVE' | 'RESTORE' | 'PREVIEW_GENERATION';
    }
  | {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly instruction: string;
      readonly kind: 'PREVIEW_REWRITE';
      readonly scope: CopyRewriteScopeV1;
    }
  | {
      readonly kind: 'CANCEL_MUTATION';
      readonly runId: string;
    };

export type CopyActionPreviewView =
  | {
      readonly briefId: string;
      readonly kind: 'CREATE_MANUAL_SCAFFOLD';
      readonly profileId: ContentDraftPayloadV1['profileId'];
      readonly structuralReasonCodes: readonly string[];
    }
  | {
      readonly changedFields: readonly string[];
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly kind: 'SAVE_VERSION';
      readonly structuralReasonCodes: readonly string[];
    }
  | {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly fieldPath: string;
      readonly kind: 'LOCK_FIELD' | 'UNLOCK_FIELD';
    }
  | {
      readonly blockIds: readonly string[];
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly kind: 'REORDER_BLOCKS';
    }
  | {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly kind: 'UNDO';
      readonly targetVersionId: string;
    }
  | {
      readonly draftId: string;
      readonly expectedRevision: number;
      readonly kind: 'ARCHIVE' | 'RESTORE';
    }
  | (CopyMutationPlanV1 & {
      readonly kind: 'PREVIEW_GENERATION' | 'PREVIEW_REWRITE';
      readonly noNetworkBeforeConfirmation: true;
    })
  | {
      readonly kind: 'CANCEL_MUTATION';
      readonly runId: string;
    };

export interface CopyActionPreview {
  readonly expiresAt: string;
  readonly kind: PreviewCopyActionInput['kind'];
  readonly preview: CopyActionPreviewView;
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmCopyActionInput {
  readonly confirmation: 'APPLY_COPY_ACTION';
  readonly executionId: string | null;
  readonly kind: PreviewCopyActionInput['kind'];
  readonly previewHash: string;
  readonly token: string;
}

export type CopyActionResult =
  | {
      readonly detail: CopyDraftDetailView;
      readonly kind:
        | 'ARCHIVE'
        | 'CREATE_MANUAL_SCAFFOLD'
        | 'LOCK_FIELD'
        | 'REORDER_BLOCKS'
        | 'RESTORE'
        | 'SAVE_VERSION'
        | 'UNDO'
        | 'UNLOCK_FIELD';
    }
  | {
      readonly kind: 'PREVIEW_GENERATION' | 'PREVIEW_REWRITE';
      readonly mutation: {
        readonly enqueueRequired: true;
        readonly run: CopyMutationRunV1;
      };
    }
  | {
      readonly kind: 'CANCEL_MUTATION';
      readonly run: CopyMutationRunV1;
    };
