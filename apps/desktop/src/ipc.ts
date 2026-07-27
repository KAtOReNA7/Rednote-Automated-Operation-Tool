import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import {
  DESKTOP_IPC_CHANNELS,
  type AppInfo,
  type DesktopError,
  type DesktopResult,
  type FoundationHealth,
  type RuntimeCapabilities,
  type WindowState,
} from '@mystery-operations/shared';

import { validateDesktopIpcRequest } from './ipc-policy.js';

interface RegisterDesktopIpcOptions {
  readonly expectedRendererUrl: string;
  readonly foundationHealth: Promise<FoundationHealth>;
  readonly getWindow: () => BrowserWindow | null;
}

function failure(code: DesktopError['code'], message: string): DesktopResult<never> {
  return {
    error: { code, message },
    ok: false,
  };
}

function success<T>(value: T): DesktopResult<T> {
  return { ok: true, value };
}

export function registerDesktopIpc(options: RegisterDesktopIpcOptions): () => void {
  const register = <T>(
    channel: string,
    read: () => T | Promise<T>,
    errorCode: DesktopError['code'] = 'INTERNAL_ERROR',
  ): void => {
    ipcMain.handle(channel, async (event, ...args: readonly unknown[]) => {
      const invalid = validateDesktopIpcRequest(
        event.senderFrame?.url ?? '',
        args,
        options.expectedRendererUrl,
      );
      if (invalid !== null) {
        return invalid;
      }
      try {
        return success(await read());
      } catch {
        return failure(errorCode, '本地基础设施暂时不可用。');
      }
    });
  };

  register<AppInfo>(DESKTOP_IPC_CHANNELS.getAppInfo, () => ({
    name: '红笺本地运营台',
    platform: 'win32',
    version: app.getVersion(),
  }));
  register<RuntimeCapabilities>(DESKTOP_IPC_CHANNELS.getRuntimeCapabilities, () => ({
    chromiumVersion: process.versions.chrome ?? 'unknown',
    electronVersion: process.versions.electron ?? 'unknown',
    nodeSqlite: true,
    nodeVersion: process.versions.node,
    v8Version: process.versions.v8,
  }));
  register<FoundationHealth>(
    DESKTOP_IPC_CHANNELS.getFoundationHealth,
    () => options.foundationHealth,
    'FOUNDATION_UNAVAILABLE',
  );
  register<WindowState>(DESKTOP_IPC_CHANNELS.getWindowState, () => {
    const window = options.getWindow();
    return {
      isFullScreen: window?.isFullScreen() ?? false,
      isMaximized: window?.isMaximized() ?? false,
    };
  });

  return () => {
    for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
