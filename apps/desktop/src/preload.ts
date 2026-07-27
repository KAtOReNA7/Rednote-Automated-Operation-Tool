import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_BRIDGE_KEY,
  DESKTOP_IPC_CHANNELS,
  type DesktopBridge,
} from '@mystery-operations/shared';

const desktopBridge: DesktopBridge = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getAppInfo),
  getFoundationHealth: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getFoundationHealth),
  getRuntimeCapabilities: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getRuntimeCapabilities),
  getWindowState: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getWindowState),
});

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, desktopBridge);
