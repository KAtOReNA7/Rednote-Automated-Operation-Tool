import type {
  DossierBuildPlan,
  DossierBuildRun,
  DossierCoverageSnapshot,
  DossierEntry,
  DossierGap,
  DossierSection,
  DossierSubjectType,
  ResearchDossier,
  ResearchDossierVersion,
} from '@mystery-operations/dossier';

export type DossierErrorCode =
  | 'DOSSIER_CAPACITY_EXCEEDED'
  | 'DOSSIER_CONFIRMATION_INVALID'
  | 'DOSSIER_CONFLICT'
  | 'DOSSIER_INPUT_CHANGED'
  | 'DOSSIER_INVALID_CONTRACT'
  | 'DOSSIER_INVALID_PLAN'
  | 'DOSSIER_INVALID_REQUEST'
  | 'DOSSIER_NOT_FOUND'
  | 'DOSSIER_POLICY_STALE'
  | 'DOSSIER_STALE_REVISION';

export interface ListDossiersInput {
  readonly limit: number;
  readonly offset: number;
}

export interface GetDossierInput {
  readonly dossierId: string;
  readonly entryLimit: number;
  readonly entryOffset: number;
}

export interface DossierListStateView {
  readonly items: readonly {
    readonly dossier: ResearchDossier;
    readonly subjectLabel: string;
  }[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface DossierDetailStateView {
  readonly coverage: DossierCoverageSnapshot | null;
  readonly dossier: ResearchDossier;
  readonly entries: readonly DossierEntry[];
  readonly entryLimit: number;
  readonly entryOffset: number;
  readonly gaps: readonly DossierGap[];
  readonly runs: readonly DossierBuildRun[];
  readonly sections: readonly DossierSection[];
  readonly versions: readonly ResearchDossierVersion[];
}

export interface PreviewDossierBuildInput {
  readonly subjectId: string;
  readonly subjectType: DossierSubjectType;
}

export interface DossierBuildPreview {
  readonly expiresAt: string;
  readonly plan: DossierBuildPlan;
  readonly previewHash: string;
  readonly token: string;
}

export interface ConfirmDossierBuildInput {
  readonly confirmation: 'START_DOSSIER_BUILD';
  readonly planHash: string;
  readonly previewHash: string;
  readonly token: string;
}

export interface CancelDossierBuildInput {
  readonly confirmation: 'CANCEL_DOSSIER_BUILD';
  readonly expectedRevision: number;
  readonly runId: string;
}

export interface DiffDossierVersionsInput {
  readonly dossierId: string;
  readonly fromVersionId: string | null;
  readonly toVersionId: string;
}

export interface DossierVersionDiffView {
  readonly addedSemanticKeys: readonly string[];
  readonly fromVersionId: string | null;
  readonly removedSemanticKeys: readonly string[];
  readonly toVersionId: string;
  readonly updatedSemanticKeys: readonly string[];
}

export type {
  DossierBuildPlan,
  DossierBuildRun,
  DossierCoverageSnapshot,
  DossierEntry,
  DossierGap,
  DossierSection,
  ResearchDossier,
  ResearchDossierVersion,
};
