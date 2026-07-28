import { contextBridge, ipcRenderer } from 'electron';

import {
  type CancelLocalApiPairingRequest,
  type CancelProviderCapabilityProbeInput,
  DESKTOP_BRIDGE_KEY,
  DESKTOP_IPC_CHANNELS,
  type ClearCredentialInput,
  type ConfirmDataRootSelectionInput,
  type ConfirmModelCacheClearInput,
  type CreateModelPriceScheduleInput,
  type CreateModelUnitPolicyInput,
  type DesktopBridge,
  type ExportDiagnosticReportInput,
  type GetCredentialStatusInput,
  type GetBrowserClipInput,
  type GetProviderCapabilityProbeProgressInput,
  type NonSecretSettingsDraft,
  type PreviewProviderCapabilityProbeInput,
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
  clearCredential: (input: ClearCredentialInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.clearCredential, input),
  confirmModelCacheClear: (input: ConfirmModelCacheClearInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmModelCacheClear, input),
  confirmDataRootSelection: (input: ConfirmDataRootSelectionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmDataRootSelection, input),
  exportDiagnosticReport: (input: ExportDiagnosticReportInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.exportDiagnosticReport, input),
  createModelPriceSchedule: (input: CreateModelPriceScheduleInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.createModelPriceSchedule, input),
  createModelUnitPolicy: (input: CreateModelUnitPolicyInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.createModelUnitPolicy, input),
  getAppInfo: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getAppInfo),
  getCredentialStatus: (input: GetCredentialStatusInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getCredentialStatus, input),
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
