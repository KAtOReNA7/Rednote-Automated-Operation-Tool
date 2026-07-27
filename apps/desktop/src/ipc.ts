import { app, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

import {
  DESKTOP_IPC_CHANNELS,
  type AppInfo,
  type ClearCredentialInput,
  type ConfirmDataRootSelectionInput,
  type DesktopError,
  type DesktopResult,
  type ExportDiagnosticReportInput,
  type FoundationHealth,
  type GetCredentialStatusInput,
  type RuntimeCapabilities,
  type SetCredentialInput,
  type WindowState,
} from '@mystery-operations/shared';
import type { NonSecretSettingsDraft } from '@mystery-operations/settings';
import { SettingsError } from '@mystery-operations/settings';

import { type DesktopIpcOperation, validateDesktopIpcRequest } from './ipc-policy.js';
import type { DesktopSettingsRuntime } from './settings-runtime.js';

interface RegisterDesktopIpcOptions {
  readonly expectedRendererUrl: string;
  readonly foundationHealth: Promise<FoundationHealth>;
  readonly getWindow: () => BrowserWindow | null;
  readonly settingsRuntime: DesktopSettingsRuntime;
}

function failure(
  code: DesktopError['code'],
  message: string,
  retryable = false,
  context?: Readonly<Record<string, boolean | number | string>>,
): DesktopResult<never> {
  return {
    error: {
      code,
      ...(context === undefined ? {} : { context }),
      message,
      retryable,
    },
    ok: false,
  };
}

function safeFailure(error: unknown): DesktopResult<never> {
  if (error instanceof SettingsError) {
    return failure(error.code, error.message, error.retryable, error.context);
  }
  return failure('INTERNAL_ERROR', '本地基础设施暂时不可用。');
}

function success<T>(value: T): DesktopResult<T> {
  return { ok: true, value };
}

export function registerDesktopIpc(options: RegisterDesktopIpcOptions): () => void {
  const register = <T>(
    operation: DesktopIpcOperation,
    channel: string,
    action: (event: IpcMainInvokeEvent, args: readonly unknown[]) => T | Promise<T>,
    errorCode?: DesktopError['code'],
  ): void => {
    ipcMain.handle(channel, async (event, ...args: readonly unknown[]) => {
      const invalid = validateDesktopIpcRequest(
        event.senderFrame?.url ?? '',
        args,
        options.expectedRendererUrl,
        operation,
      );
      if (invalid !== null) {
        return invalid;
      }
      try {
        return success(await action(event, args));
      } catch (error) {
        return errorCode === undefined
          ? safeFailure(error)
          : failure(errorCode, '本地基础设施暂时不可用。');
      }
    });
  };

  register<AppInfo>('getAppInfo', DESKTOP_IPC_CHANNELS.getAppInfo, () => ({
    name: '红笺本地运营台',
    platform: 'win32',
    version: app.getVersion(),
  }));
  register<RuntimeCapabilities>(
    'getRuntimeCapabilities',
    DESKTOP_IPC_CHANNELS.getRuntimeCapabilities,
    () => ({
      chromiumVersion: process.versions.chrome ?? 'unknown',
      electronVersion: process.versions.electron ?? 'unknown',
      nodeSqlite: true,
      nodeVersion: process.versions.node,
      v8Version: process.versions.v8,
    }),
  );
  register<FoundationHealth>(
    'getFoundationHealth',
    DESKTOP_IPC_CHANNELS.getFoundationHealth,
    () => options.foundationHealth,
    'FOUNDATION_UNAVAILABLE',
  );
  register<WindowState>('getWindowState', DESKTOP_IPC_CHANNELS.getWindowState, () => {
    const window = options.getWindow();
    return {
      isFullScreen: window?.isFullScreen() ?? false,
      isMaximized: window?.isMaximized() ?? false,
    };
  });

  register('getSetupState', DESKTOP_IPC_CHANNELS.getSetupState, () =>
    options.settingsRuntime.getSetupState(),
  );
  register('getSettings', DESKTOP_IPC_CHANNELS.getSettings, () =>
    options.settingsRuntime.getSettings(),
  );
  register('selectDataRoot', DESKTOP_IPC_CHANNELS.selectDataRoot, async (event) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new SettingsError('DATA_ROOT_SELECTION_INVALID');
    }
    return options.settingsRuntime.selectDataRoot(window, event.sender.id);
  });
  register(
    'confirmDataRootSelection',
    DESKTOP_IPC_CHANNELS.confirmDataRootSelection,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new SettingsError('DATA_ROOT_SELECTION_INVALID');
      }
      return options.settingsRuntime.confirmDataRootSelection(
        args[0] as ConfirmDataRootSelectionInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'updateNonSecretSettings',
    DESKTOP_IPC_CHANNELS.updateNonSecretSettings,
    (_event, args) =>
      options.settingsRuntime.updateNonSecretSettings(args[0] as NonSecretSettingsDraft),
  );
  register('setCredential', DESKTOP_IPC_CHANNELS.setCredential, (_event, args) => {
    const input = args[0] as SetCredentialInput;
    return options.settingsRuntime.setCredential(input.plaintext);
  });
  register('clearCredential', DESKTOP_IPC_CHANNELS.clearCredential, (_event, args) => {
    const input = args[0] as ClearCredentialInput;
    return options.settingsRuntime.clearCredential(input.confirmation);
  });
  register('getCredentialStatus', DESKTOP_IPC_CHANNELS.getCredentialStatus, (_event, args) => {
    const input = args[0] as GetCredentialStatusInput;
    void input.slot;
    return options.settingsRuntime.getCredentialStatus();
  });
  register('buildDiagnosticPreview', DESKTOP_IPC_CHANNELS.buildDiagnosticPreview, () =>
    options.settingsRuntime.buildDiagnosticPreview(),
  );
  register(
    'exportDiagnosticReport',
    DESKTOP_IPC_CHANNELS.exportDiagnosticReport,
    (_event, args) => {
      const input = args[0] as ExportDiagnosticReportInput;
      return options.settingsRuntime.exportDiagnosticReport(input.expectedPreviewHash);
    },
  );

  return () => {
    for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
