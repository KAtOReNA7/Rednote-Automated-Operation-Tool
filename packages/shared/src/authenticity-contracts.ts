import type {
  AuthenticityErrorCode,
  AuthenticitySpoilerLevel,
  BatchReadingStateDraft,
  DossierPermissionInput,
  ExperienceAssertionDraft,
  ExperienceAssertionKind,
  ExpressionPermissionState,
  MemoryConfidence,
  PublicScoreOrigin,
  ReadingConfirmationKind,
  ReadingDatePrecision,
  ReadingStateChangeDraft,
  ReadingStateCode,
  ScoreRecordDraft,
  SpoilerWarningPlacement,
  SpoilerPreferenceDraft,
} from '@mystery-operations/authenticity';

export type { AuthenticityErrorCode };

export interface GetAuthenticityLibraryInput {
  readonly limit: number;
  readonly offset: number;
  readonly profileId: string;
  readonly query: string;
}

export interface GetAuthenticityWorkInput {
  readonly historyLimit: number;
  readonly historyOffset: number;
  readonly profileId: string;
  readonly workId: string;
}

export interface AuthenticityPermissionView {
  readonly blockingReasonCodes: readonly string[];
  readonly contentBriefModes: {
    readonly personalExperience: ExpressionPermissionState;
    readonly publicResearchAnalysis: ExpressionPermissionState;
  };
  readonly contentBriefReadiness: ExpressionPermissionState;
  readonly dependencyHash: string;
  readonly evaluatedAt: string;
  readonly firstPersonPermission: ExpressionPermissionState;
  readonly personalExperiencePermission: ExpressionPermissionState;
  readonly personalScorePermission: ExpressionPermissionState;
  readonly publicResearchAnalysisPermission: ExpressionPermissionState;
  readonly researchAnalysisScorePermission: ExpressionPermissionState;
  readonly snapshotId: string | null;
  readonly spoiler: {
    readonly coreTrickDisclosure: boolean;
    readonly endingDisclosure: boolean;
    readonly level: AuthenticitySpoilerLevel;
    readonly reasonCodes: readonly string[];
    readonly userConfirmationRequired: boolean;
    readonly warningPlacement: SpoilerWarningPlacement;
    readonly warningRequired: boolean;
  };
  readonly stale: boolean;
  readonly warningReasonCodes: readonly string[];
}

export interface AuthenticityLibraryItem {
  readonly contentBriefReadiness: ExpressionPermissionState;
  readonly dossierReadiness: string;
  readonly memoryConfidence: MemoryConfidence;
  readonly readingState: ReadingStateCode;
  readonly readingStateId: string | null;
  readonly revision: number;
  readonly snapshotStale: boolean;
  readonly workId: string;
  readonly workTitle: string;
}

export interface AuthenticityLibraryView {
  readonly items: readonly AuthenticityLibraryItem[];
  readonly limit: number;
  readonly offset: number;
  readonly profileId: string;
  readonly total: number;
}

export interface ReadingStateRevisionView {
  readonly confirmationKind: ReadingConfirmationKind;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly finishedAtPrecision: ReadingDatePrecision;
  readonly lastReadAt: string | null;
  readonly lastReadAtPrecision: ReadingDatePrecision;
  readonly memoryConfidence: MemoryConfidence;
  readonly provenance: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly state: ReadingStateCode;
  readonly userNote: string | null;
}

export interface ExperienceAssertionView {
  readonly assertionId: string;
  readonly assertionKind: ExperienceAssertionKind;
  readonly assertionRevision: number;
  readonly confirmationScope: string;
  readonly readingStateRevisionId: string;
  readonly stale: boolean;
  readonly statement: string;
  readonly status: 'CONFIRMED' | 'REVOKED';
  readonly updatedAt: string;
}

export interface PublicScoreView {
  readonly origin: PublicScoreOrigin;
  readonly publicLabel: '个人评分' | '资料分析评分';
  readonly revision: number;
  readonly scoreBasisPoints: number | null;
  readonly status: 'ACTIVE' | 'REVOKED';
}

export interface SpoilerPreferenceView {
  readonly level: AuthenticitySpoilerLevel;
  readonly revision: number;
  readonly userConfirmed: boolean;
  readonly warningIncluded: boolean;
}

export interface AuthenticityWorkDetail {
  readonly assertions: readonly ExperienceAssertionView[];
  readonly dossier: DossierPermissionInput | null;
  readonly editions: readonly {
    readonly editionId: string;
    readonly label: string | null;
    readonly publisher: string | null;
  }[];
  readonly expressions: readonly {
    readonly expressionId: string;
    readonly kind: string;
    readonly language: string | null;
    readonly title: string | null;
  }[];
  readonly history: readonly ReadingStateRevisionView[];
  readonly historyLimit: number;
  readonly historyOffset: number;
  readonly memoryConfidence: MemoryConfidence;
  readonly permission: AuthenticityPermissionView;
  readonly personalScore: PublicScoreView | null;
  readonly profileId: string;
  readonly readingState: ReadingStateCode;
  readonly readingStateId: string | null;
  readonly researchScore: PublicScoreView | null;
  readonly revision: number;
  readonly spoilerPreference: SpoilerPreferenceView;
  readonly workId: string;
  readonly workTitle: string;
}

export type PreviewAuthenticityActionInput =
  | {
      readonly draft: ReadingStateChangeDraft;
      readonly kind: 'STATE_CHANGE';
    }
  | {
      readonly expectedRevision: number;
      readonly kind: 'STATE_UNDO';
      readonly profileId: string;
      readonly workId: string;
    }
  | {
      readonly draft: ExperienceAssertionDraft;
      readonly kind: 'ASSERTION_CONFIRM';
    }
  | {
      readonly assertionId: string;
      readonly expectedAssertionRevision: number;
      readonly expectedReadingRevision: number;
      readonly kind: 'ASSERTION_REVOKE';
      readonly profileId: string;
      readonly workId: string;
    }
  | {
      readonly draft: ScoreRecordDraft;
      readonly kind: 'SCORE_CHANGE';
    }
  | {
      readonly draft: SpoilerPreferenceDraft;
      readonly kind: 'SPOILER_CHANGE';
    }
  | {
      readonly draft: BatchReadingStateDraft;
      readonly kind: 'BATCH_STATE_CHANGE';
    };

export type AuthenticityActionPreviewView =
  | {
      readonly after: {
        readonly memoryConfidence: MemoryConfidence;
        readonly state: ReadingStateCode;
      };
      readonly before: {
        readonly memoryConfidence: MemoryConfidence;
        readonly state: ReadingStateCode;
      };
      readonly kind: 'STATE_CHANGE';
      readonly readingStateId: string | null;
    }
  | {
      readonly expectedRevision: number;
      readonly kind: 'STATE_UNDO';
      readonly restore: {
        readonly memoryConfidence: MemoryConfidence;
        readonly state: ReadingStateCode;
      };
      readonly workId: string;
    }
  | {
      readonly assertionKind: ExperienceAssertionKind;
      readonly kind: 'ASSERTION_CONFIRM';
      readonly statement: string;
    }
  | {
      readonly assertionId: string;
      readonly kind: 'ASSERTION_REVOKE';
    }
  | {
      readonly kind: 'SCORE_CHANGE';
      readonly publicLabel: '个人评分' | '资料分析评分';
      readonly scoreBasisPoints: number | null;
    }
  | {
      readonly kind: 'SPOILER_CHANGE';
      readonly level: AuthenticitySpoilerLevel;
      readonly warningPlacement: string;
      readonly warningRequired: boolean;
    }
  | {
      readonly items: readonly {
        readonly before: ReadingStateCode;
        readonly expectedRevision: number;
        readonly workId: string;
      }[];
      readonly kind: 'BATCH_STATE_CHANGE';
      readonly nextState: ReadingStateCode;
    };

export interface AuthenticityActionPreview {
  readonly expiresAt: string;
  readonly kind: PreviewAuthenticityActionInput['kind'];
  readonly preview: AuthenticityActionPreviewView;
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmAuthenticityActionInput {
  readonly confirmation: 'APPLY_AUTHENTICITY_ACTION';
  readonly kind: PreviewAuthenticityActionInput['kind'];
  readonly previewHash: string;
  readonly token: string;
}

export interface AuthenticityBatchApplyResult {
  readonly failed: number;
  readonly items: readonly {
    readonly errorCode: string | null;
    readonly ok: boolean;
    readonly revision: number | null;
    readonly workId: string;
  }[];
  readonly succeeded: number;
}

export type AuthenticityActionResult =
  | {
      readonly batch: null;
      readonly detail: AuthenticityWorkDetail;
      readonly kind: Exclude<PreviewAuthenticityActionInput['kind'], 'BATCH_STATE_CHANGE'>;
    }
  | {
      readonly batch: AuthenticityBatchApplyResult;
      readonly detail: null;
      readonly kind: 'BATCH_STATE_CHANGE';
    };
