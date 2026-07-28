import { contextBridge, ipcRenderer } from 'electron';

import {
  type CancelLocalApiPairingRequest,
  type CancelProviderCapabilityProbeInput,
  DESKTOP_BRIDGE_KEY,
  DESKTOP_IPC_CHANNELS,
  type ClearCredentialInput,
  type ConfirmDataRootSelectionInput,
  type DesktopBridge,
  type ExportDiagnosticReportInput,
  type GetCredentialStatusInput,
  type GetProviderCapabilityProbeProgressInput,
  type NonSecretSettingsDraft,
  type PreviewProviderCapabilityProbeInput,
  type RevokeLocalApiClientRequest,
  type SetCredentialInput,
  type StartProviderCapabilityProbeInput,
  type UpdateLocalApiSettingsRequest,
} from '@mystery-operations/shared';

const desktopBridge: DesktopBridge = Object.freeze({
  buildDiagnosticPreview: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.buildDiagnosticPreview),
  cancelProviderCapabilityProbe: (input: CancelProviderCapabilityProbeInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.cancelProviderCapabilityProbe, input),
  clearCredential: (input: ClearCredentialInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.clearCredential, input),
  confirmDataRootSelection: (input: ConfirmDataRootSelectionInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.confirmDataRootSelection, input),
  exportDiagnosticReport: (input: ExportDiagnosticReportInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.exportDiagnosticReport, input),
  getAppInfo: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getAppInfo),
  getCredentialStatus: (input: GetCredentialStatusInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getCredentialStatus, input),
  getFoundationHealth: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getFoundationHealth),
  getProviderCapabilityProbeProgress: (input: GetProviderCapabilityProbeProgressInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getProviderCapabilityProbeProgress, input),
  getProviderCapabilityState: () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getProviderCapabilityState),
  getLocalApiStatus: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getLocalApiStatus),
  getRuntimeCapabilities: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getRuntimeCapabilities),
  getSettings: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getSettings),
  getSetupState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getSetupState),
  getWindowState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getWindowState),
  listLocalApiClients: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.listLocalApiClients),
  selectDataRoot: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.selectDataRoot),
  previewProviderCapabilityProbe: (input: PreviewProviderCapabilityProbeInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.previewProviderCapabilityProbe, input),
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
});

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, desktopBridge);
