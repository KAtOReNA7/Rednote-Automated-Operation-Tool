import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_BRIDGE_KEY,
  DESKTOP_IPC_CHANNELS,
  type ClearCredentialInput,
  type ConfirmDataRootSelectionInput,
  type DesktopBridge,
  type ExportDiagnosticReportInput,
  type GetCredentialStatusInput,
  type NonSecretSettingsDraft,
  type SetCredentialInput,
} from '@mystery-operations/shared';

const desktopBridge: DesktopBridge = Object.freeze({
  buildDiagnosticPreview: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.buildDiagnosticPreview),
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
  getRuntimeCapabilities: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getRuntimeCapabilities),
  getSettings: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getSettings),
  getSetupState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getSetupState),
  getWindowState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getWindowState),
  selectDataRoot: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.selectDataRoot),
  setCredential: (input: SetCredentialInput) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setCredential, input),
  updateNonSecretSettings: (input: NonSecretSettingsDraft) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateNonSecretSettings, input),
});

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, desktopBridge);
