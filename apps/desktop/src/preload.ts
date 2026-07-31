import { contextBridge, ipcRenderer } from 'electron';

import {
  type ConfirmAuthenticityActionInput,
  type CancelCatalogDiscoveryInput,
  type CancelDossierBuildInput,
  type CancelSourceProcessingInput,
  type CancelLocalApiPairingRequest,
  type CancelProviderCapabilityProbeInput,
  DESKTOP_BRIDGE_KEY,
  DESKTOP_IPC_CHANNELS,
  type ClearCredentialInput,
  type ConfirmDataRootSelectionInput,
  type ConfirmCatalogActionInput,
  type ConfirmCatalogDiscoveryInput,
  type ConfirmEvidenceConflictInput,
  type ConfirmDossierBuildInput,
  type ConfirmSyntheticResearchIntakeInput,
  type ConfirmSourceProcessingInput,
  type ConfirmTopicActionInput,
  type ConfirmExperimentActionInput,
  type ConfirmBriefActionInput,
  type ConfirmModelCacheClearInput,
  type CreateModelPriceScheduleInput,
  type CreateModelUnitPolicyInput,
  type DesktopBridge,
  type ExportDiagnosticReportInput,
  type GetCredentialStatusInput,
  type GetCatalogStateInput,
  type GetCatalogWorkInput,
  type GetAuthenticityLibraryInput,
  type GetAuthenticityWorkInput,
  type GetEvidenceStateInput,
  type GetTopicInput,
  type GetTopicPoolInput,
  type GetExperimentInput,
  type GetExperimentsInput,
  type GetBriefInput,
  type GetBriefsInput,
  type GetDossierInput,
  type ListDossiersInput,
  type GetBrowserClipInput,
  type GetProviderCapabilityProbeProgressInput,
  type NonSecretSettingsDraft,
  type PreviewProviderCapabilityProbeInput,
  type PreviewCatalogDiscoveryInput,
  type PreviewAuthenticityActionInput,
  type PreviewCatalogUndoInput,
  type PreviewCatalogWorkMergeInput,
  type PreviewCatalogWorkSplitInput,
  type PreviewEvidenceConflictInput,
  type PreviewDossierBuildInput,
  type PreviewSyntheticResearchIntakeInput,
  type PreviewSourceProcessingInput,
  type PreviewTopicActionInput,
  type PreviewExperimentActionInput,
  type PreviewBriefActionInput,
  type ConfirmCopyActionInput,
  type DiffCopyDraftVersionsInput,
  type GetCopyDraftInput,
  type GetCopyDraftsInput,
  type PreviewCopyActionInput,
  type ConfirmFactMappingActionInput,
  type ConfirmFactMappingDecisionInput,
  type GetFactMappingCheckInput,
  type GetFactMappingChecksInput,
  type GetFactMappingClaimChainInput,
  type PreviewFactMappingActionInput,
  type PreviewFactMappingDecisionInput,
  type DiffDossierVersionsInput,
  type RevokeLocalApiClientRequest,
  type SetCredentialInput,
  type StartProviderCapabilityProbeInput,
  type UpdateLocalApiSettingsRequest,
  type UpdateFetchPolicyInput,
  type UpdateSearchProviderConfigInput,
} from '@mystery-operations/shared';

const desktopBridge: DesktopBridge = Object.freeze({
  buildDiagnosticPreview: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.buildDiagnosticPreview),
  cancelProviderCapabilityProbe: (input: CancelProviderCapabilityProbeInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.cancelProviderCapabilityProbe, input),
  cancelCatalogDiscovery: (input: CancelCatalogDiscoveryInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.cancelCatalogDiscovery, input),
  cancelDossierBuild: (input: CancelDossierBuildInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.cancelDossierBuild, input),
  clearCredential: (input: ClearCredentialInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.clearCredential, input),
  confirmModelCacheClear: (input: ConfirmModelCacheClearInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmModelCacheClear, input),
  confirmDataRootSelection: (input: ConfirmDataRootSelectionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmDataRootSelection, input),
  confirmCatalogDiscovery: (input: ConfirmCatalogDiscoveryInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmCatalogDiscovery, input),
  confirmCatalogWorkMerge: (input: ConfirmCatalogActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmCatalogWorkMerge, input),
  confirmCatalogWorkSplit: (input: ConfirmCatalogActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmCatalogWorkSplit, input),
  confirmCatalogUndo: (input: ConfirmCatalogActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmCatalogUndo, input),
  confirmAuthenticityAction: (input: ConfirmAuthenticityActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmAuthenticityAction, input),
  confirmEvidenceConflict: (input: ConfirmEvidenceConflictInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmEvidenceConflict, input),
  confirmDossierBuild: (input: ConfirmDossierBuildInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmDossierBuild, input),
  confirmSourceProcessing: (input: ConfirmSourceProcessingInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmSourceProcessing, input),
  confirmSyntheticResearchIntake: (input: ConfirmSyntheticResearchIntakeInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmSyntheticResearchIntake, input),
  confirmTopicAction: (input: ConfirmTopicActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmTopicAction, input),
  confirmExperimentAction: (input: ConfirmExperimentActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmExperimentAction, input),
  confirmBriefAction: (input: ConfirmBriefActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmBriefAction, input),
  confirmCopyAction: (input: ConfirmCopyActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmCopyAction, input),
  confirmFactMappingAction: (input: ConfirmFactMappingActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmFactMappingAction, input),
  confirmFactMappingDecision: (input: ConfirmFactMappingDecisionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmFactMappingDecision, input),
  cancelSourceProcessing: (input: CancelSourceProcessingInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.cancelSourceProcessing, input),
  exportDiagnosticReport: (input: ExportDiagnosticReportInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.exportDiagnosticReport, input),
  createModelPriceSchedule: (input: CreateModelPriceScheduleInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.createModelPriceSchedule, input),
  createModelUnitPolicy: (input: CreateModelUnitPolicyInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.createModelUnitPolicy, input),
  getAppInfo: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getAppInfo),
  getCredentialStatus: (input: GetCredentialStatusInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getCredentialStatus, input),
  getCatalogState: (input: GetCatalogStateInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getCatalogState, input),
  getCatalogWork: (input: GetCatalogWorkInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getCatalogWork, input),
  getAuthenticityLibrary: (input: GetAuthenticityLibraryInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getAuthenticityLibrary, input),
  getAuthenticityWork: (input: GetAuthenticityWorkInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getAuthenticityWork, input),
  getEvidenceState: (input: GetEvidenceStateInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getEvidenceState, input),
  getTopicPool: (input: GetTopicPoolInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getTopicPool, input),
  getTopic: (input: GetTopicInput) => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getTopic, input),
  getExperiments: (input: GetExperimentsInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getExperiments, input),
  getExperiment: (input: GetExperimentInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getExperiment, input),
  getBriefs: (input: GetBriefsInput) => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getBriefs, input),
  getBrief: (input: GetBriefInput) => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getBrief, input),
  getCopyDrafts: (input: GetCopyDraftsInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getCopyDrafts, input),
  getCopyDraft: (input: GetCopyDraftInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getCopyDraft, input),
  getFactMappingChecks: (input: GetFactMappingChecksInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getFactMappingChecks, input),
  getFactMappingCheck: (input: GetFactMappingCheckInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getFactMappingCheck, input),
  getFactMappingClaimChain: (input: GetFactMappingClaimChainInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getFactMappingClaimChain, input),
  getDossier: (input: GetDossierInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getDossier, input),
  getFoundationHealth: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getFoundationHealth),
  getModelAccounting: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getModelAccounting),
  getProviderCapabilityProbeProgress: (input: GetProviderCapabilityProbeProgressInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getProviderCapabilityProbeProgress, input),
  getProviderCapabilityState: () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getProviderCapabilityState),
  getLocalApiStatus: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getLocalApiStatus),
  getRuntimeCapabilities: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getRuntimeCapabilities),
  getSettings: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getSettings),
  getSearchState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getSearchState),
  getFetchState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getFetchState),
  listBrowserClips: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.listBrowserClips),
  listDossiers: (input: ListDossiersInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.listDossiers, input),
  getBrowserClip: (input: GetBrowserClipInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getBrowserClip, input),
  getSetupState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getSetupState),
  getWindowState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getWindowState),
  listLocalApiClients: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.listLocalApiClients),
  selectDataRoot: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.selectDataRoot),
  previewProviderCapabilityProbe: (input: PreviewProviderCapabilityProbeInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewProviderCapabilityProbe, input),
  previewCatalogDiscovery: (input: PreviewCatalogDiscoveryInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewCatalogDiscovery, input),
  previewCatalogWorkMerge: (input: PreviewCatalogWorkMergeInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewCatalogWorkMerge, input),
  previewCatalogWorkSplit: (input: PreviewCatalogWorkSplitInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewCatalogWorkSplit, input),
  previewCatalogUndo: (input: PreviewCatalogUndoInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewCatalogUndo, input),
  previewAuthenticityAction: (input: PreviewAuthenticityActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewAuthenticityAction, input),
  previewEvidenceConflict: (input: PreviewEvidenceConflictInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewEvidenceConflict, input),
  previewDossierBuild: (input: PreviewDossierBuildInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewDossierBuild, input),
  previewSourceProcessing: (input: PreviewSourceProcessingInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewSourceProcessing, input),
  previewSyntheticResearchIntake: (input: PreviewSyntheticResearchIntakeInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewSyntheticResearchIntake, input),
  previewTopicAction: (input: PreviewTopicActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewTopicAction, input),
  previewExperimentAction: (input: PreviewExperimentActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewExperimentAction, input),
  previewBriefAction: (input: PreviewBriefActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewBriefAction, input),
  previewCopyAction: (input: PreviewCopyActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewCopyAction, input),
  previewFactMappingAction: (input: PreviewFactMappingActionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewFactMappingAction, input),
  previewFactMappingDecision: (input: PreviewFactMappingDecisionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewFactMappingDecision, input),
  diffCopyDraftVersions: (input: DiffCopyDraftVersionsInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.diffCopyDraftVersions, input),
  previewModelCacheClear: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewModelCacheClear),
  diffDossierVersions: (input: DiffDossierVersionsInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.diffDossierVersions, input),
  setCredential: (input: SetCredentialInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setCredential, input),
  startLocalApiPairing: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.startLocalApiPairing),
  startProviderCapabilityProbe: (input: StartProviderCapabilityProbeInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.startProviderCapabilityProbe, input),
  cancelLocalApiPairing: (input: CancelLocalApiPairingRequest) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.cancelLocalApiPairing, input),
  revokeLocalApiClient: (input: RevokeLocalApiClientRequest) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.revokeLocalApiClient, input),
  updateLocalApiSettings: (input: UpdateLocalApiSettingsRequest) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateLocalApiSettings, input),
  updateNonSecretSettings: (input: NonSecretSettingsDraft) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateNonSecretSettings, input),
  updateFetchPolicy: (input: UpdateFetchPolicyInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateFetchPolicy, input),
  updateSearchProviderConfig: (input: UpdateSearchProviderConfigInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateSearchProviderConfig, input),
});

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, desktopBridge);
