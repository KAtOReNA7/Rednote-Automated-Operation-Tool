import type {
  ExperimentAction,
  ExperimentDesignDraft,
  ExperimentDesignState,
  ExperimentSamplePlanStatus,
  ExperimentVariableKind,
  WorkPopularityStratum,
} from '@mystery-operations/experiments';

export interface GetExperimentsInput {
  readonly limit: number;
  readonly offset: number;
  readonly profileId: string;
  readonly query: string;
  readonly state: ExperimentDesignState | null;
}

export interface GetExperimentInput {
  readonly experimentId: string;
  readonly historyLimit: number;
  readonly historyOffset: number;
  readonly versionLimit: number;
  readonly versionOffset: number;
}

export interface ExperimentListItem {
  readonly assignmentStatus: ExperimentSamplePlanStatus | null;
  readonly experimentId: string;
  readonly name: string;
  readonly primaryMetricId: string;
  readonly primaryVariableKind: ExperimentVariableKind;
  readonly revision: number;
  readonly stale: boolean;
  readonly state: ExperimentDesignState;
  readonly updatedAt: string;
  readonly versionNumber: number;
}

export interface ExperimentListView {
  readonly items: readonly ExperimentListItem[];
  readonly limit: number;
  readonly offset: number;
  readonly profileId: string;
  readonly total: number;
}

export interface ExperimentDetailView extends ExperimentListItem {
  readonly assignment: {
    readonly armCounts: Readonly<Record<string, number>>;
    readonly assignmentHash: string;
    readonly distinctWorkCount: number;
    readonly imbalanceByStratum: Readonly<Record<string, number>>;
    readonly shortfallByArm: Readonly<Record<string, number>>;
    readonly status: ExperimentSamplePlanStatus;
    readonly strataCounts: Readonly<Record<WorkPopularityStratum, number>>;
    readonly unitCount: number;
  } | null;
  readonly design: ExperimentDesignDraft;
  readonly designVersionId: string;
  readonly history: readonly {
    readonly action: string;
    readonly createdAt: string;
    readonly from: ExperimentDesignState | null;
    readonly revision: number;
    readonly to: ExperimentDesignState;
  }[];
  readonly historyPage: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
  readonly invalidationReasons: readonly string[];
  readonly lockedMeansExecution: false;
  readonly resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION';
  readonly versionHistory: {
    readonly items: readonly {
      readonly changeKinds: readonly string[];
      readonly createdAt: string;
      readonly designHash: string;
      readonly designVersionId: string;
      readonly isCurrent: boolean;
      readonly name: string;
      readonly previousVersionId: string | null;
      readonly primaryMetricId: string;
      readonly primaryVariableKind: ExperimentVariableKind;
      readonly versionNumber: number;
    }[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
}

export type PreviewExperimentActionInput =
  | {
      readonly design: ExperimentDesignDraft;
      readonly kind: 'CREATE_DRAFT';
      readonly profileId: string;
    }
  | {
      readonly experimentId: string;
      readonly kind: 'SAVE_ASSIGNMENT';
    }
  | {
      readonly action: Exclude<ExperimentAction, 'CLONE_VERSION'>;
      readonly expectedRevision: number;
      readonly experimentId: string;
      readonly kind: 'STATE_ACTION';
    }
  | {
      readonly design: ExperimentDesignDraft;
      readonly expectedRevision: number;
      readonly experimentId: string;
      readonly kind: 'CLONE_VERSION';
    };

export type ExperimentActionPreviewView =
  | {
      readonly armCount: number;
      readonly designHash: string;
      readonly futureBoundVariable: boolean;
      readonly kind: 'CREATE_DRAFT' | 'CLONE_VERSION';
      readonly minimumDistinctWorkCount: number;
      readonly name: string;
      readonly primaryMetricId: string;
      readonly primaryVariableKind: ExperimentVariableKind;
      readonly targetTopicCount: number;
      readonly warningCodes: readonly string[];
      readonly workSnapshotCount: number;
    }
  | {
      readonly armCounts: Readonly<Record<string, number>>;
      readonly assignmentHash: string;
      readonly distinctWorkCount: number;
      readonly expectedRevision: number;
      readonly imbalanceByStratum: Readonly<Record<string, number>>;
      readonly kind: 'SAVE_ASSIGNMENT';
      readonly reasonCodes: readonly string[];
      readonly shortfallByArm: Readonly<Record<string, number>>;
      readonly status: ExperimentSamplePlanStatus;
      readonly unitPage: {
        readonly limit: number;
        readonly offset: number;
        readonly total: number;
        readonly truncated: boolean;
      };
      readonly units: readonly {
        readonly armId: string;
        readonly popularityStratum: WorkPopularityStratum;
        readonly topicId: string;
        readonly workId: string;
      }[];
    }
  | {
      readonly action: Exclude<ExperimentAction, 'CLONE_VERSION'>;
      readonly after: ExperimentDesignState;
      readonly assignmentReady: boolean;
      readonly before: ExperimentDesignState;
      readonly expectedRevision: number;
      readonly kind: 'STATE_ACTION';
      readonly lockedMeansExecution: false;
    };

export interface ExperimentActionPreview {
  readonly expiresAt: string;
  readonly kind: PreviewExperimentActionInput['kind'];
  readonly preview: ExperimentActionPreviewView;
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmExperimentActionInput {
  readonly confirmation: 'APPLY_EXPERIMENT_ACTION';
  readonly kind: PreviewExperimentActionInput['kind'];
  readonly previewHash: string;
  readonly token: string;
}

export interface ExperimentActionResult {
  readonly detail: ExperimentDetailView;
  readonly kind: PreviewExperimentActionInput['kind'];
}
