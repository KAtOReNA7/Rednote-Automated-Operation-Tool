import { app, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

import { CatalogError } from '@mystery-operations/catalog';
import { LocalApiError } from '@mystery-operations/local-api';
import {
  type CancelCatalogDiscoveryInput,
  type CancelLocalApiPairingRequest,
  type CancelProviderCapabilityProbeInput,
  type ConfirmModelCacheClearInput,
  type ConfirmCatalogActionInput,
  type ConfirmCatalogDiscoveryInput,
  DESKTOP_IPC_CHANNELS,
  type AppInfo,
  type ClearCredentialInput,
  type ConfirmDataRootSelectionInput,
  type CreateModelPriceScheduleInput,
  type CreateModelUnitPolicyInput,
  type DesktopError,
  type DesktopResult,
  type ExportDiagnosticReportInput,
  type FoundationHealth,
  type GetCredentialStatusInput,
  type GetBrowserClipInput,
  type GetCatalogStateInput,
  type GetCatalogWorkInput,
  type GetProviderCapabilityProbeProgressInput,
  type PreviewProviderCapabilityProbeInput,
  type PreviewCatalogDiscoveryInput,
  type PreviewCatalogUndoInput,
  type PreviewCatalogWorkMergeInput,
  type PreviewCatalogWorkSplitInput,
  type RevokeLocalApiClientRequest,
  type RuntimeCapabilities,
  type SetCredentialInput,
  type StartProviderCapabilityProbeInput,
  type UpdateLocalApiSettingsRequest,
  type UpdateFetchPolicyInput,
  type UpdateSearchProviderConfigInput,
  type WindowState,
} from '@mystery-operations/shared';
import type { NonSecretSettingsDraft } from '@mystery-operations/settings';
import { SettingsError } from '@mystery-operations/settings';

import { type DesktopIpcOperation, validateDesktopIpcRequest } from './ipc-policy.js';
import { ModelAccountingError } from './model-accounting-runtime.js';
import { ProviderCapabilityControlError } from './provider-capability-runtime.js';
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
  if (error instanceof CatalogError) {
    return failure(error.code, error.message, error.retryable, error.safeDetails);
  }
  if (error instanceof LocalApiError) {
    return failure(error.code, error.message, error.retryable, error.context);
  }
  if (error instanceof SettingsError) {
    return failure(error.code, error.message, error.retryable, error.context);
  }
  if (error instanceof ProviderCapabilityControlError) {
    return failure(error.code, error.message, error.retryable);
  }
  if (error instanceof ModelAccountingError) {
    return failure(error.code, error.message, error.retryable);
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
  register('getProviderCapabilityState', DESKTOP_IPC_CHANNELS.getProviderCapabilityState, () =>
    options.settingsRuntime.getProviderCapabilityState(),
  );
  register('getModelAccounting', DESKTOP_IPC_CHANNELS.getModelAccounting, () =>
    options.settingsRuntime.getModelAccounting(),
  );
  register('getSearchState', DESKTOP_IPC_CHANNELS.getSearchState, () =>
    options.settingsRuntime.getSearchState(),
  );
  register('getFetchState', DESKTOP_IPC_CHANNELS.getFetchState, () =>
    options.settingsRuntime.getFetchState(),
  );
  register('listBrowserClips', DESKTOP_IPC_CHANNELS.listBrowserClips, () =>
    options.settingsRuntime.listBrowserClips(),
  );
  register('getBrowserClip', DESKTOP_IPC_CHANNELS.getBrowserClip, (_event, args) =>
    options.settingsRuntime.getBrowserClip((args[0] as GetBrowserClipInput).clipId),
  );
  register('getCatalogState', DESKTOP_IPC_CHANNELS.getCatalogState, (_event, args) =>
    options.settingsRuntime.getCatalogState(args[0] as GetCatalogStateInput),
  );
  register('getCatalogWork', DESKTOP_IPC_CHANNELS.getCatalogWork, (_event, args) =>
    options.settingsRuntime.getCatalogWork((args[0] as GetCatalogWorkInput).workId),
  );
  register(
    'previewCatalogDiscovery',
    DESKTOP_IPC_CHANNELS.previewCatalogDiscovery,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new CatalogError('CATALOG_INVALID_REQUEST');
      }
      return options.settingsRuntime.previewCatalogDiscovery(
        args[0] as PreviewCatalogDiscoveryInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'confirmCatalogDiscovery',
    DESKTOP_IPC_CHANNELS.confirmCatalogDiscovery,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
      }
      return options.settingsRuntime.confirmCatalogDiscovery(
        args[0] as ConfirmCatalogDiscoveryInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register('cancelCatalogDiscovery', DESKTOP_IPC_CHANNELS.cancelCatalogDiscovery, (_event, args) =>
    options.settingsRuntime.cancelCatalogDiscovery(args[0] as CancelCatalogDiscoveryInput),
  );
  register(
    'previewCatalogWorkMerge',
    DESKTOP_IPC_CHANNELS.previewCatalogWorkMerge,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new CatalogError('CATALOG_INVALID_REQUEST');
      }
      return options.settingsRuntime.previewCatalogWorkMerge(
        args[0] as PreviewCatalogWorkMergeInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'confirmCatalogWorkMerge',
    DESKTOP_IPC_CHANNELS.confirmCatalogWorkMerge,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
      }
      return options.settingsRuntime.confirmCatalogAction(
        'MERGE_WORKS',
        args[0] as ConfirmCatalogActionInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'previewCatalogWorkSplit',
    DESKTOP_IPC_CHANNELS.previewCatalogWorkSplit,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new CatalogError('CATALOG_INVALID_REQUEST');
      }
      return options.settingsRuntime.previewCatalogWorkSplit(
        args[0] as PreviewCatalogWorkSplitInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'confirmCatalogWorkSplit',
    DESKTOP_IPC_CHANNELS.confirmCatalogWorkSplit,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
      }
      return options.settingsRuntime.confirmCatalogAction(
        'SPLIT_WORK',
        args[0] as ConfirmCatalogActionInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register('previewCatalogUndo', DESKTOP_IPC_CHANNELS.previewCatalogUndo, (event, args) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new CatalogError('CATALOG_INVALID_REQUEST');
    }
    return options.settingsRuntime.previewCatalogUndo(
      args[0] as PreviewCatalogUndoInput,
      event.sender.id,
      window.id,
    );
  });
  register('confirmCatalogUndo', DESKTOP_IPC_CHANNELS.confirmCatalogUndo, (event, args) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
    }
    return options.settingsRuntime.confirmCatalogAction(
      'UNDO_DECISION',
      args[0] as ConfirmCatalogActionInput,
      event.sender.id,
      window.id,
    );
  });
  register('previewModelCacheClear', DESKTOP_IPC_CHANNELS.previewModelCacheClear, (event) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new ModelAccountingError('MODEL_CACHE_CLEAR_INVALID');
    }
    return options.settingsRuntime.previewModelCacheClear(event.sender.id, window.id);
  });
  register('confirmModelCacheClear', DESKTOP_IPC_CHANNELS.confirmModelCacheClear, (event, args) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new ModelAccountingError('MODEL_CACHE_CLEAR_INVALID');
    }
    return options.settingsRuntime.confirmModelCacheClear(
      args[0] as ConfirmModelCacheClearInput,
      event.sender.id,
      window.id,
    );
  });
  register(
    'createModelPriceSchedule',
    DESKTOP_IPC_CHANNELS.createModelPriceSchedule,
    (_event, args) =>
      options.settingsRuntime.createModelPriceSchedule(args[0] as CreateModelPriceScheduleInput),
  );
  register('createModelUnitPolicy', DESKTOP_IPC_CHANNELS.createModelUnitPolicy, (_event, args) =>
    options.settingsRuntime.createModelUnitPolicy(args[0] as CreateModelUnitPolicyInput),
  );
  register(
    'previewProviderCapabilityProbe',
    DESKTOP_IPC_CHANNELS.previewProviderCapabilityProbe,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new ProviderCapabilityControlError('PROBE_INVALID_REQUEST');
      }
      return options.settingsRuntime.previewProviderCapabilityProbe(
        args[0] as PreviewProviderCapabilityProbeInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'startProviderCapabilityProbe',
    DESKTOP_IPC_CHANNELS.startProviderCapabilityProbe,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new ProviderCapabilityControlError('PROBE_INVALID_REQUEST');
      }
      return options.settingsRuntime.startProviderCapabilityProbe(
        args[0] as StartProviderCapabilityProbeInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'getProviderCapabilityProbeProgress',
    DESKTOP_IPC_CHANNELS.getProviderCapabilityProbeProgress,
    (_event, args) => {
      const input = args[0] as GetProviderCapabilityProbeProgressInput;
      return options.settingsRuntime.getProviderCapabilityProbeProgress(input.runId);
    },
  );
  register(
    'cancelProviderCapabilityProbe',
    DESKTOP_IPC_CHANNELS.cancelProviderCapabilityProbe,
    (_event, args) =>
      options.settingsRuntime.cancelProviderCapabilityProbe(
        args[0] as CancelProviderCapabilityProbeInput,
      ),
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
  register('updateFetchPolicy', DESKTOP_IPC_CHANNELS.updateFetchPolicy, (_event, args) =>
    options.settingsRuntime.updateFetchPolicy(args[0] as UpdateFetchPolicyInput),
  );
  register(
    'updateSearchProviderConfig',
    DESKTOP_IPC_CHANNELS.updateSearchProviderConfig,
    (_event, args) =>
      options.settingsRuntime.updateSearchProviderConfig(
        args[0] as UpdateSearchProviderConfigInput,
      ),
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
  register('getLocalApiStatus', DESKTOP_IPC_CHANNELS.getLocalApiStatus, () =>
    options.settingsRuntime.getLocalApiStatus(),
  );
  register(
    'updateLocalApiSettings',
    DESKTOP_IPC_CHANNELS.updateLocalApiSettings,
    (_event, args) => {
      const input = args[0] as UpdateLocalApiSettingsRequest;
      return options.settingsRuntime.updateLocalApiSettings(input);
    },
  );
  register('startLocalApiPairing', DESKTOP_IPC_CHANNELS.startLocalApiPairing, (event) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
    }
    return options.settingsRuntime.startLocalApiPairing(window.id);
  });
  register('cancelLocalApiPairing', DESKTOP_IPC_CHANNELS.cancelLocalApiPairing, (event, args) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
    }
    const input = args[0] as CancelLocalApiPairingRequest;
    return options.settingsRuntime.cancelLocalApiPairing(input.pairingSessionId, window.id);
  });
  register('listLocalApiClients', DESKTOP_IPC_CHANNELS.listLocalApiClients, () =>
    options.settingsRuntime.listLocalApiClients(),
  );
  register('revokeLocalApiClient', DESKTOP_IPC_CHANNELS.revokeLocalApiClient, (_event, args) => {
    const input = args[0] as RevokeLocalApiClientRequest;
    return options.settingsRuntime.revokeLocalApiClient(
      input.clientId,
      input.expectedRevision,
      input.confirmation,
    );
  });

  return () => {
    for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
