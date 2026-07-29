import { contextBridge, ipcRenderer } from 'electron';

import {
  type CancelCatalogDiscoveryInput,
  type CancelLocalApiPairingRequest,
  type CancelProviderCapabilityProbeInput,
  DESKTOP_BRIDGE_KEY,
  DESKTOP_IPC_CHANNELS,
  type ClearCredentialInput,
  type ConfirmDataRootSelectionInput,
  type ConfirmCatalogActionInput,
  type ConfirmCatalogDiscoveryInput,
  type ConfirmModelCacheClearInput,
  type CreateModelPriceScheduleInput,
  type CreateModelUnitPolicyInput,
  type DesktopBridge,
  type ExportDiagnosticReportInput,
  type GetCredentialStatusInput,
  type GetCatalogStateInput,
  type GetCatalogWorkInput,
  type GetBrowserClipInput,
  type GetProviderCapabilityProbeProgressInput,
  type NonSecretSettingsDraft,
  type PreviewProviderCapabilityProbeInput,
  type PreviewCatalogDiscoveryInput,
  type PreviewCatalogUndoInput,
  type PreviewCatalogWorkMergeInput,
  type PreviewCatalogWorkSplitInput,
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
  previewModelCacheClear: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewModelCacheClear),
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
