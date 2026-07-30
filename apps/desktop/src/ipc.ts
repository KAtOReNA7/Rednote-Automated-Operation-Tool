import { BrowserWindow, app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

import { CatalogError } from '@mystery-operations/catalog';
import { AuthenticityError } from '@mystery-operations/authenticity';
import { DossierError } from '@mystery-operations/dossier';
import { EvidenceError } from '@mystery-operations/evidence';
import { LocalApiError } from '@mystery-operations/local-api';
import { TopicError } from '@mystery-operations/topics';
import { ExperimentError } from '@mystery-operations/experiments';
import {
  type CancelCatalogDiscoveryInput,
  type CancelDossierBuildInput,
  type CancelSourceProcessingInput,
  type CancelLocalApiPairingRequest,
  type CancelProviderCapabilityProbeInput,
  type ConfirmModelCacheClearInput,
  type ConfirmCatalogActionInput,
  type ConfirmAuthenticityActionInput,
  type ConfirmCatalogDiscoveryInput,
  type ConfirmDossierBuildInput,
  type ConfirmEvidenceConflictInput,
  type ConfirmSourceProcessingInput,
  type ConfirmTopicActionInput,
  type ConfirmExperimentActionInput,
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
  type GetAuthenticityLibraryInput,
  type GetAuthenticityWorkInput,
  type GetDossierInput,
  type GetEvidenceStateInput,
  type GetTopicInput,
  type GetTopicPoolInput,
  type GetExperimentInput,
  type GetExperimentsInput,
  type ListDossiersInput,
  type GetProviderCapabilityProbeProgressInput,
  type PreviewProviderCapabilityProbeInput,
  type PreviewCatalogDiscoveryInput,
  type PreviewAuthenticityActionInput,
  type PreviewCatalogUndoInput,
  type PreviewCatalogWorkMergeInput,
  type PreviewCatalogWorkSplitInput,
  type PreviewDossierBuildInput,
  type PreviewEvidenceConflictInput,
  type PreviewSourceProcessingInput,
  type PreviewTopicActionInput,
  type PreviewExperimentActionInput,
  type DiffDossierVersionsInput,
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
  if (error instanceof ExperimentError) {
    return failure(error.code, error.message, error.retryable);
  }
  if (error instanceof TopicError) {
    return failure(error.code, error.message, error.retryable, error.safeDetails);
  }
  if (error instanceof AuthenticityError) {
    return failure(error.code, error.message, error.retryable, error.safeDetails);
  }
  if (error instanceof DossierError) {
    return failure(error.code, error.message, error.retryable, error.safeDetails);
  }
  if (error instanceof EvidenceError) {
    return failure(error.code, error.message, error.retryable);
  }
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
  register('getAuthenticityLibrary', DESKTOP_IPC_CHANNELS.getAuthenticityLibrary, (_event, args) =>
    options.settingsRuntime.getAuthenticityLibrary(args[0] as GetAuthenticityLibraryInput),
  );
  register('getAuthenticityWork', DESKTOP_IPC_CHANNELS.getAuthenticityWork, (_event, args) =>
    options.settingsRuntime.getAuthenticityWork(args[0] as GetAuthenticityWorkInput),
  );
  register(
    'previewAuthenticityAction',
    DESKTOP_IPC_CHANNELS.previewAuthenticityAction,
    (event, args) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window === null) {
        throw new AuthenticityError('AUTHENTICITY_INVALID_REQUEST');
      }
      return options.settingsRuntime.previewAuthenticityAction(
        args[0] as PreviewAuthenticityActionInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'confirmAuthenticityAction',
    DESKTOP_IPC_CHANNELS.confirmAuthenticityAction,
    (event, args) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window === null) {
        throw new AuthenticityError('AUTHENTICITY_CONFIRMATION_INVALID');
      }
      return options.settingsRuntime.confirmAuthenticityAction(
        args[0] as ConfirmAuthenticityActionInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register('getTopicPool', DESKTOP_IPC_CHANNELS.getTopicPool, (_event, args) =>
    options.settingsRuntime.getTopicPool(args[0] as GetTopicPoolInput),
  );
  register('getTopic', DESKTOP_IPC_CHANNELS.getTopic, (_event, args) =>
    options.settingsRuntime.getTopic(args[0] as GetTopicInput),
  );
  register('previewTopicAction', DESKTOP_IPC_CHANNELS.previewTopicAction, (event, args) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) {
      throw new TopicError('TOPIC_INVALID_REQUEST');
    }
    return options.settingsRuntime.previewTopicAction(
      args[0] as PreviewTopicActionInput,
      event.sender.id,
      window.id,
    );
  });
  register('confirmTopicAction', DESKTOP_IPC_CHANNELS.confirmTopicAction, (event, args) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) {
      throw new TopicError('TOPIC_CONFIRMATION_INVALID');
    }
    return options.settingsRuntime.confirmTopicAction(
      args[0] as ConfirmTopicActionInput,
      event.sender.id,
      window.id,
    );
  });
  register('getExperiments', DESKTOP_IPC_CHANNELS.getExperiments, (_event, args) =>
    options.settingsRuntime.getExperiments(args[0] as GetExperimentsInput),
  );
  register('getExperiment', DESKTOP_IPC_CHANNELS.getExperiment, (_event, args) =>
    options.settingsRuntime.getExperiment(args[0] as GetExperimentInput),
  );
  register(
    'previewExperimentAction',
    DESKTOP_IPC_CHANNELS.previewExperimentAction,
    (event, args) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window === null) {
        throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
      }
      return options.settingsRuntime.previewExperimentAction(
        args[0] as PreviewExperimentActionInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'confirmExperimentAction',
    DESKTOP_IPC_CHANNELS.confirmExperimentAction,
    (event, args) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window === null) {
        throw new ExperimentError('EXPERIMENT_CONFIRMATION_INVALID');
      }
      return options.settingsRuntime.confirmExperimentAction(
        args[0] as ConfirmExperimentActionInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register('getEvidenceState', DESKTOP_IPC_CHANNELS.getEvidenceState, (_event, args) =>
    options.settingsRuntime.getEvidenceState(args[0] as GetEvidenceStateInput),
  );
  register(
    'previewEvidenceConflict',
    DESKTOP_IPC_CHANNELS.previewEvidenceConflict,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
      }
      return options.settingsRuntime.previewEvidenceConflict(
        args[0] as PreviewEvidenceConflictInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'confirmEvidenceConflict',
    DESKTOP_IPC_CHANNELS.confirmEvidenceConflict,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
      }
      return options.settingsRuntime.confirmEvidenceConflict(
        args[0] as ConfirmEvidenceConflictInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'previewSourceProcessing',
    DESKTOP_IPC_CHANNELS.previewSourceProcessing,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
      }
      return options.settingsRuntime.previewSourceProcessing(
        args[0] as PreviewSourceProcessingInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register(
    'confirmSourceProcessing',
    DESKTOP_IPC_CHANNELS.confirmSourceProcessing,
    (event, args) => {
      const window = options.getWindow();
      if (window === null || window.webContents.id !== event.sender.id) {
        throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
      }
      return options.settingsRuntime.confirmSourceProcessing(
        args[0] as ConfirmSourceProcessingInput,
        event.sender.id,
        window.id,
      );
    },
  );
  register('cancelSourceProcessing', DESKTOP_IPC_CHANNELS.cancelSourceProcessing, (_event, args) =>
    options.settingsRuntime.cancelSourceProcessing(args[0] as CancelSourceProcessingInput),
  );
  register('listDossiers', DESKTOP_IPC_CHANNELS.listDossiers, (_event, args) =>
    options.settingsRuntime.listDossiers(args[0] as ListDossiersInput),
  );
  register('getDossier', DESKTOP_IPC_CHANNELS.getDossier, (_event, args) =>
    options.settingsRuntime.getDossier(args[0] as GetDossierInput),
  );
  register('previewDossierBuild', DESKTOP_IPC_CHANNELS.previewDossierBuild, (event, args) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new DossierError('DOSSIER_INVALID_REQUEST');
    }
    return options.settingsRuntime.previewDossierBuild(
      args[0] as PreviewDossierBuildInput,
      event.sender.id,
      window.id,
    );
  });
  register('confirmDossierBuild', DESKTOP_IPC_CHANNELS.confirmDossierBuild, (event, args) => {
    const window = options.getWindow();
    if (window === null || window.webContents.id !== event.sender.id) {
      throw new DossierError('DOSSIER_CONFIRMATION_INVALID');
    }
    return options.settingsRuntime.confirmDossierBuild(
      args[0] as ConfirmDossierBuildInput,
      event.sender.id,
      window.id,
    );
  });
  register('cancelDossierBuild', DESKTOP_IPC_CHANNELS.cancelDossierBuild, (_event, args) =>
    options.settingsRuntime.cancelDossierBuild(args[0] as CancelDossierBuildInput),
  );
  register('diffDossierVersions', DESKTOP_IPC_CHANNELS.diffDossierVersions, (_event, args) =>
    options.settingsRuntime.diffDossierVersions(args[0] as DiffDossierVersionsInput),
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
