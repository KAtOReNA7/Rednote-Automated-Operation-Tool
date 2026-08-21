import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';

import {
  connectDatabase,
  initializeDatabase,
  createSqliteSnapshot,
  estimateSqliteSnapshotBytes,
  enumerateManagedFileInventory,
  inspectSqliteSnapshot,
  SqliteCatalogRepository,
  SqliteV2Repository,
} from '@mystery-operations/db';
import {
  createControlledBackupSnapshot,
  createLocalDiagnosticPreview,
  executeControlledRestore,
  initializeProjectDataRoot,
  prepareControlledRestore,
  summarizeLocalDiagnosticCategories,
  writeLocalDiagnosticPackage,
  type ControlledBackupDatabaseAdapter,
  type ControlledRestorePreflight,
  type ProjectDataRoot,
} from '@mystery-operations/storage';
import {
  V2ApplicationFacade,
  V2ContentApplication,
  V2ContractError,
  V2InteractionApplication,
  V2_IPC_CHANNELS,
  isInteractionMutationRequest,
  parseV2MutationRequest,
  parseV2ReadRequest,
  toV2Exception,
  type AccountPersona,
  deterministicReview,
  type MetricWindow,
  type MetricsReview,
  V2_PROVIDER_ACTION_LIMITS,
  V2ProviderActionError,
  parseContentPackageFields,
  providerActionModelSlot,
  providerActionSummary,
  type V2ProviderActionExecutionRequest,
  type V2ProviderActionExecutionResult,
  type V2ProviderActionIntent,
  type V2ProviderActionPreview,
  type V2ProviderActionReadiness,
  type V2ProviderActionResult,
  type V2CapabilityProbePreview,
  type V2CapabilityProbeProgress,
  type V2CatalogWorkDetail,
  type V2CatalogWorkListView,
  type V2MaintenanceDirectorySelection,
  type V2MaintenanceBackupPreconditions,
  type V2MaintenancePreview,
  type V2MaintenanceView,
  type V2DiagnosticPreview,
  type V2DiagnosticView,
  type V2ProviderSettingsDraft,
  type V2ProviderSettingsView,
  type V2ContentCopyGenerationPreview,
  type V2ContentCopyGenerationReadiness,
  type V2ContentCopyGenerationResult,
  type V2Result,
  weekDateRange,
  type WeeklyPlan,
} from '@mystery-operations/v2';

import { discoverApprovedV2Covers, V2LocalContentFiles } from './v2-content-files.js';
import { V2LocalInteractionFiles } from './v2-interaction-files.js';

const V2_DATA_ROOT_DIRECTORY = 'v2-project-data';
const PROJECT_DATABASE_FILE = 'rednote.sqlite';
const BACKUP_SPACE_MARGIN_BYTES = 1024 * 1024;

export interface V2ActionCaller {
  readonly senderId: number;
  readonly windowId: number;
}

export interface V2ProviderExecutionPort {
  execute(request: V2ProviderActionExecutionRequest): Promise<V2ProviderActionExecutionResult>;
  inspect(
    request: Omit<V2ProviderActionExecutionRequest, 'executionId'>,
  ): Promise<V2ProviderActionReadiness>;
  inspectContentCopy?(request: {
    readonly input: Readonly<Record<string, unknown>>;
    readonly requestCount: 1 | 2 | 3;
    readonly userApprovedUnknownCost: boolean;
  }): Promise<V2ContentCopyGenerationReadiness>;
}

export interface V2SettingsControlPort {
  clearCredential(): Promise<V2ProviderSettingsView>;
  getCapabilityProgress(runId: string): V2CapabilityProbeProgress;
  getSettings(): Promise<V2ProviderSettingsView>;
  previewCapabilityProbe(caller: V2ActionCaller): V2CapabilityProbePreview;
  setCredential(plaintext: string): Promise<V2ProviderSettingsView>;
  startCapabilityProbe(
    input: {
      readonly confirmation: 'START_PROVIDER_CAPABILITY_PROBE';
      readonly credentialBindingVersion: number;
      readonly planHash: string;
      readonly settingsRevision: number;
      readonly startToken: string;
      readonly userApprovedUnknownCost: boolean;
    },
    caller: V2ActionCaller,
  ): Promise<V2CapabilityProbeProgress>;
  updateSettings(input: V2ProviderSettingsDraft): Promise<V2ProviderSettingsView>;
}

export interface V2MaintenanceDirectoryPicker {
  select(
    caller: V2ActionCaller,
    operation: 'BACKUP' | 'DIAGNOSTICS' | 'RESTORE',
  ): Promise<{ readonly displayLabel: string; readonly path: string } | null>;
}

interface MaintenanceSelectionLease {
  readonly caller: V2ActionCaller;
  readonly displayLabel: string;
  readonly expiresAtMs: number;
  readonly identity: { readonly dev: number; readonly ino: number };
  readonly operation: 'BACKUP' | 'DIAGNOSTICS' | 'RESTORE';
  readonly path: string;
}

interface MaintenanceConfirmationLease extends MaintenanceSelectionLease {
  readonly backupPreflight?: ControlledRestorePreflight;
  readonly token: string;
}

interface MaintenanceOperationState {
  readonly caller: V2ActionCaller;
  readonly controller: AbortController;
  readonly operation: 'BACKUP' | 'RESTORE';
  backupDurability: V2MaintenanceView['backupDurability'];
  cancelRequested: boolean;
  outcome: V2MaintenanceView['backupOutcome'];
  running: boolean;
  stage: V2MaintenanceView['backupStage'];
}

interface DiagnosticPreviewLease {
  readonly caller: V2ActionCaller;
  readonly expiresAtMs: number;
  readonly payload: {
    readonly application: { readonly build: string | null; readonly version: string | null };
    readonly collectedAt: string;
    readonly fileCategories: readonly {
      readonly category:
        'generated-images' | 'imports' | 'photos' | 'source-snapshots' | 'source-screenshots';
      readonly itemCount: number;
      readonly totalBytes: number;
    }[];
    readonly format: 'rednote-local-diagnostics';
    readonly health: {
      readonly database: 'healthy' | 'unavailable';
      readonly storage: 'healthy' | 'unavailable';
    };
    readonly runtime: { readonly node: string | null; readonly platform: string | null };
    readonly version: 1;
  };
  readonly previewHash: string;
}

interface DiagnosticConfirmationLease extends DiagnosticPreviewLease {
  readonly directory: MaintenanceSelectionLease;
  readonly token: string;
}

interface DiagnosticResultLease {
  readonly caller: V2ActionCaller;
  readonly expiresAtMs: number;
  readonly fileName: string;
  readonly path: string;
}

interface DiagnosticOperationState {
  readonly caller: V2ActionCaller;
  outcome: V2DiagnosticView['outcome'];
  result: V2DiagnosticView['result'];
  stage: V2DiagnosticView['stage'];
}

const uncheckedBackupPreconditions = (): V2MaintenanceBackupPreconditions =>
  Object.freeze({
    directory: 'NOT_CHECKED',
    maintenanceLock: 'NOT_CHECKED',
    space: 'NOT_CHECKED',
    write: 'NOT_CHECKED',
  });

function sameMaintenanceCaller(left: V2ActionCaller, right: V2ActionCaller): boolean {
  return left.senderId === right.senderId && left.windowId === right.windowId;
}

function maintenanceCallerKey(caller: V2ActionCaller): string {
  return `${caller.senderId}:${caller.windowId}`;
}

interface ProviderPreviewLease {
  readonly caller: V2ActionCaller;
  readonly expiresAtMs: number;
  readonly intent: V2ProviderActionIntent;
  readonly inputHash: string;
  readonly readiness: V2ProviderActionReadiness;
}

interface ContentCopyPreviewLease {
  readonly caller: V2ActionCaller;
  readonly capabilityEvidenceId: string;
  readonly credentialBinding: string;
  readonly expiresAtMs: number;
  readonly modelId: string;
  readonly planRevision: number;
  readonly selectedPlanItemIds: readonly string[];
  readonly weekKey: string;
}

function providerInputHash(input: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function readinessAffectedFields(readiness: V2ProviderActionReadiness): readonly string[] {
  if (!readiness.providerConfigured)
    return readiness.modelId === null
      ? [readiness.modelSlot === 'research' ? 'researchModelId' : 'writingModelId']
      : ['providerBaseUrl'];
  if (readiness.credentialState !== 'CONFIGURED') return ['credentialBinding'];
  if (readiness.capabilityState !== 'SUPPORTED') return [`${readiness.modelSlot}Capability`];
  if (readiness.budgetState === 'BLOCKED') return ['budget'];
  if (readiness.feeEstimateMicroUsd === null && !readiness.unknownCostApproved)
    return ['unknownCostConsent'];
  return [];
}

function providerBusinessBlock(
  intent: V2ProviderActionIntent,
  error: V2ProviderActionError,
): string {
  if (intent.kind === 'CONTENT_PACKAGES') {
    if (error.affectedFields.includes('existingContent'))
      return '所选计划项已有内容版本；请在内容包中选择“生成新版本”。';
    if (error.affectedFields.includes('candidateIds'))
      return '所选计划项已变化或不可生成，请重新选择 3 个锁定计划项。';
    return '周计划尚未锁定或已变化，请重新载入后再选择 3 个计划项。';
  }
  if (intent.kind === 'REPLY_SUGGESTION') {
    return error.affectedFields.includes('interaction')
      ? '互动记录尚未保存或已更新，请重新载入互动页后再试。'
      : '当前互动状态不能生成回复建议。';
  }
  return '目标周计划已变化，请重新载入后再预览。';
}

function combinedExternalRequestCount(
  results: readonly V2ProviderActionExecutionResult[],
): 0 | 1 | 2 | 3 {
  const count = results.reduce<number>((total, item) => total + item.externalRequestCount, 0);
  if (count > 3) throw new V2ProviderActionError('PROVIDER_ACTION_UNCERTAIN');
  return count as 0 | 1 | 2 | 3;
}

const unavailableProviderExecution: V2ProviderExecutionPort = {
  execute: async () => ({
    costAmountMicroUsd: null,
    costState: 'NOT_INCURRED',
    externalRequestCount: 0,
    outcomeCertainty: 'NOT_SENT',
    output: null,
    stableErrorCode: 'PROVIDER_NOT_CONFIGURED',
    status: 'BLOCKED',
    modelRunId: null,
  }),
  inspect: async (request) => ({
    blockReasons: ['本机 Provider runtime 不可用。'],
    budgetState: 'UNKNOWN',
    canConfirm: false,
    capabilityState: 'UNKNOWN',
    configFingerprint: null,
    credentialBinding: null,
    credentialState: 'NOT_CONFIGURED',
    feeEstimateMicroUsd: null,
    modelId: null,
    modelSlot: request.modelSlot,
    protocolMode: null,
    providerConfigured: false,
    readinessBinding: 'unavailable',
    reasonCode: 'PROVIDER_NOT_CONFIGURED',
    reasonMessage: '本机 Provider runtime 不可用。',
    unknownCostApproved: request.userApprovedUnknownCost === true,
  }),
};

const unavailableSettingsControl: V2SettingsControlPort = {
  clearCredential: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  getCapabilityProgress: () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  getSettings: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  previewCapabilityProbe: () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  setCredential: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  startCapabilityProbe: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  updateSettings: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
};

export class V2DesktopRuntime {
  #catalog: SqliteCatalogRepository;
  #content: V2ContentApplication;
  #database: DatabaseSync;
  #facade: V2ApplicationFacade;
  #interaction: V2InteractionApplication;
  readonly #maintenanceConfirmations = new Map<string, MaintenanceConfirmationLease>();
  #maintenanceCloseRequested = false;
  readonly #maintenancePicker: V2MaintenanceDirectoryPicker | null;
  readonly #maintenancePreconditions = new Map<string, V2MaintenanceBackupPreconditions>();
  #maintenanceOperation: MaintenanceOperationState | null = null;
  #maintenancePromise: Promise<void> | null = null;
  #maintenanceRunning = false;
  readonly #maintenanceSelections = new Map<string, MaintenanceSelectionLease>();
  readonly #diagnosticConfirmations = new Map<string, DiagnosticConfirmationLease>();
  readonly #diagnosticPreviews = new Map<string, DiagnosticPreviewLease>();
  readonly #diagnosticResults = new Map<string, DiagnosticResultLease>();
  readonly #diagnosticSelections = new Map<string, MaintenanceSelectionLease>();
  readonly #diagnosticStates = new Map<string, DiagnosticOperationState>();
  #diagnosticRunning = false;
  readonly #openDirectory: (path: string) => Promise<string>;
  readonly #assetsDirectory: string;
  readonly #root: ProjectDataRoot;
  readonly #runtimeIdentity: {
    readonly appVersion: string;
    readonly buildCommit: string;
  };
  #repository: SqliteV2Repository;
  readonly #providerExecution: V2ProviderExecutionPort;
  readonly #settingsControl: V2SettingsControlPort;
  readonly #providerPreviews = new Map<string, ProviderPreviewLease>();
  readonly #contentCopyPreviews = new Map<string, ContentCopyPreviewLease>();
  readonly #usedProviderPreviews = new Set<string>();
  #closed = false;

  private constructor(
    database: DatabaseSync,
    contentFiles: V2LocalContentFiles,
    interactionFiles: V2LocalInteractionFiles,
    providerExecution: V2ProviderExecutionPort,
    settingsControl: V2SettingsControlPort,
    root: ProjectDataRoot,
    options: {
      readonly appVersion: string;
      readonly assetsDirectory: string;
      readonly buildCommit: string;
      readonly maintenancePicker?: V2MaintenanceDirectoryPicker;
      readonly openDirectory: (path: string) => Promise<string>;
    },
  ) {
    this.#database = database;
    this.#catalog = new SqliteCatalogRepository(database);
    this.#repository = new SqliteV2Repository(database);
    this.#facade = new V2ApplicationFacade(this.#repository);
    this.#content = new V2ContentApplication(this.#repository, contentFiles);
    this.#interaction = new V2InteractionApplication(this.#repository, interactionFiles);
    this.#providerExecution = providerExecution;
    this.#settingsControl = settingsControl;
    this.#root = root;
    this.#assetsDirectory = options.assetsDirectory;
    this.#openDirectory = options.openDirectory;
    this.#maintenancePicker = options.maintenancePicker ?? null;
    this.#runtimeIdentity = {
      appVersion: options.appVersion,
      buildCommit: options.buildCommit,
    };
  }

  public static async open(
    userDataPath: string,
    options: {
      readonly assetsDirectory?: string;
      readonly openDirectory?: (path: string) => Promise<string>;
      readonly appVersion?: string;
      readonly buildCommit?: string;
      readonly maintenancePicker?: V2MaintenanceDirectoryPicker;
      readonly providerExecution?: V2ProviderExecutionPort;
      readonly settingsControl?: V2SettingsControlPort;
    } = {},
  ): Promise<V2DesktopRuntime> {
    const root = await initializeProjectDataRoot(join(userDataPath, V2_DATA_ROOT_DIRECTORY));
    return V2DesktopRuntime.openProject(root, options);
  }

  public static async openProject(
    root: ProjectDataRoot,
    options: {
      readonly assetsDirectory?: string;
      readonly openDirectory?: (path: string) => Promise<string>;
      readonly appVersion?: string;
      readonly buildCommit?: string;
      readonly maintenancePicker?: V2MaintenanceDirectoryPicker;
      readonly providerExecution?: V2ProviderExecutionPort;
      readonly settingsControl?: V2SettingsControlPort;
    } = {},
  ): Promise<V2DesktopRuntime> {
    const databasePath = join(root.databaseDirectory, PROJECT_DATABASE_FILE);
    await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
    });
    const assetsDirectory =
      options.assetsDirectory ?? join(app.getAppPath(), '.vite', 'renderer', 'assets');
    const contentFiles = new V2LocalContentFiles(
      root,
      await discoverApprovedV2Covers(assetsDirectory),
      { openDirectory: options.openDirectory ?? ((path) => shell.openPath(path)) },
    );
    return new V2DesktopRuntime(
      connectDatabase(databasePath),
      contentFiles,
      new V2LocalInteractionFiles(root),
      options.providerExecution ?? unavailableProviderExecution,
      options.settingsControl ?? unavailableSettingsControl,
      root,
      {
        appVersion: options.appVersion ?? 'local',
        assetsDirectory,
        buildCommit: options.buildCommit ?? 'local',
        ...(options.maintenancePicker === undefined
          ? {}
          : { maintenancePicker: options.maintenancePicker }),
        openDirectory: options.openDirectory ?? ((path) => shell.openPath(path)),
      },
    );
  }

  public async read(input: unknown, caller?: V2ActionCaller) {
    const request = parseV2ReadRequest(input);
    if (request.view === 'MAINTENANCE') {
      if (caller === undefined) throw new V2ContractError('INVALID_REQUEST');
      return this.#maintenanceView(caller);
    }
    if (request.view === 'LOCAL_DIAGNOSTICS') {
      if (caller === undefined) throw new V2ContractError('INVALID_REQUEST');
      return this.#diagnosticView(caller);
    }
    this.#assertDataAvailable();
    if (request.view === 'CATALOG_WORKS') {
      const summary = this.#catalog.getSummary(request.limit + 1, request.offset, request.query);
      return {
        hasMore: summary.works.length > request.limit,
        limit: request.limit,
        offset: request.offset,
        query: request.query,
        totalWorks: summary.counts.works,
        works: summary.works.slice(0, request.limit).map((work) => ({ ...work })),
      } satisfies V2CatalogWorkListView;
    }
    if (request.view === 'CATALOG_WORK') {
      const detail = this.#catalog.getWorkDetail(request.workId);
      if (detail === null) return null;
      return {
        aliases: detail.aliases.map((alias) => ({ ...alias })),
        canonicalTitle: detail.canonicalTitle,
        editionCount: detail.editionCount,
        expressionCount: detail.expressionCount,
        expressions: detail.expressions.map((expression) => ({
          ...expression,
          editions: expression.editions.map((edition) => ({
            ...edition,
            identifiers: edition.identifiers.map((identifier) => ({ ...identifier })),
          })),
        })),
        observations: detail.observations.map((observation) => ({ ...observation })),
        publicationRelationships: detail.publicationRelationships.map((relation) => ({
          ...relation,
        })),
        relations: detail.relations.map((relation) => ({ ...relation })),
        revision: detail.revision,
        sourceBoundary: detail.observations.length === 0 ? 'MISSING' : 'UNVERIFIED_OBSERVATIONS',
        state: detail.state,
        workId: detail.workId,
      } satisfies V2CatalogWorkDetail;
    }
    if (request.view === 'CONTENT_COPY_GENERATION_PREVIEW') {
      if (caller === undefined) throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
      return this.#previewContentCopyGeneration(request, caller);
    }
    if (request.view === 'PROVIDER_ACTION_PREVIEW') {
      if (caller === undefined) throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
      return this.#previewProviderAction(request.intent, caller);
    }
    if (request.view === 'PROVIDER_SETTINGS') {
      return this.#settingsOperation(() => this.#settingsControl.getSettings());
    }
    if (request.view === 'PROVIDER_CAPABILITY_PROBE_PREVIEW') {
      if (caller === undefined) throw new V2ContractError('CAPABILITY_PROBE_BLOCKED');
      return this.#settingsOperation(() => this.#settingsControl.previewCapabilityProbe(caller));
    }
    if (request.view === 'PROVIDER_CAPABILITY_PROBE_PROGRESS') {
      return this.#settingsOperation(() =>
        this.#settingsControl.getCapabilityProgress(request.runId),
      );
    }
    if (request.view === 'CONTENT_PACKAGES') return this.#content.read(request.weekKey);
    if (request.view === 'INTERACTIONS') return this.#interaction.read();
    if (request.view === 'INTERACTION_DELETE_PREVIEW')
      return this.#interaction.previewDelete(request.itemId);
    if (request.view === 'METRICS_REVIEW') return this.#metricsReview(request.snapshotWindow);
    return this.#facade.read(request);
  }

  public async mutate(input: unknown, caller?: V2ActionCaller) {
    const request = parseV2MutationRequest(input);
    if (
      request.action === 'BUILD_LOCAL_DIAGNOSTIC_PREVIEW' ||
      request.action === 'SELECT_LOCAL_DIAGNOSTIC_DIRECTORY' ||
      request.action === 'PREVIEW_LOCAL_DIAGNOSTIC_EXPORT' ||
      request.action === 'CONFIRM_LOCAL_DIAGNOSTIC_EXPORT' ||
      request.action === 'OPEN_LOCAL_DIAGNOSTIC_RESULT'
    ) {
      if (caller === undefined) throw new V2ContractError('INVALID_REQUEST');
      return this.#mutateDiagnostics(request, caller);
    }
    if (
      request.action === 'SELECT_BACKUP_DIRECTORY' ||
      request.action === 'SELECT_RESTORE_DIRECTORY' ||
      request.action === 'PREVIEW_CONTROLLED_BACKUP' ||
      request.action === 'PREVIEW_CONTROLLED_RESTORE' ||
      request.action === 'CONFIRM_CONTROLLED_BACKUP' ||
      request.action === 'CONFIRM_CONTROLLED_RESTORE' ||
      request.action === 'CANCEL_CONTROLLED_MAINTENANCE'
    ) {
      if (caller === undefined) throw new V2ContractError('INVALID_REQUEST');
      return this.#mutateMaintenance(request, caller);
    }
    this.#assertDataAvailable();
    if (request.action === 'EXECUTE_CONTENT_COPY_GENERATION') {
      if (caller === undefined) throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
      return this.#executeContentCopyGeneration(request.previewToken, caller);
    }
    if (request.action === 'CONFIRM_PROVIDER_ACTION') {
      if (caller === undefined) throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
      return this.#confirmProviderAction(request.previewToken, caller);
    }
    if (request.action === 'UPDATE_PROVIDER_SETTINGS') {
      return this.#settingsOperation(() => this.#settingsControl.updateSettings(request));
    }
    if (request.action === 'SET_PROVIDER_CREDENTIAL') {
      return this.#settingsOperation(() => this.#settingsControl.setCredential(request.plaintext));
    }
    if (request.action === 'CLEAR_PROVIDER_CREDENTIAL') {
      return this.#settingsOperation(() => this.#settingsControl.clearCredential());
    }
    if (request.action === 'START_PROVIDER_CAPABILITY_PROBE') {
      if (caller === undefined) throw new V2ContractError('CAPABILITY_PROBE_BLOCKED');
      return this.#settingsOperation(() =>
        this.#settingsControl.startCapabilityProbe(request, caller),
      );
    }
    if (isInteractionMutationRequest(request)) {
      const persona = this.#facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
      return this.#interaction.mutate(request, persona);
    }
    if (request.action === 'GENERATE_CONTENT_PACKAGES') {
      const persona = this.#facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: request.weekKey,
      }) as WeeklyPlan;
      return this.#content.generate(request, persona, plan);
    }
    if (request.action === 'SAVE_CONTENT_PACKAGE') return this.#content.save(request);
    if (request.action === 'APPROVE_CONTENT_PACKAGES') return this.#content.approve(request.items);
    if (request.action === 'EXPORT_CONTENT_PACKAGES')
      return this.#content.export(request.items, request.idempotencyKey);
    if (request.action === 'OPEN_CONTENT_EXPORT') {
      await this.#content.openExport(request.exportId);
      return { opened: true };
    }
    if (request.action === 'SAVE_METRIC_SNAPSHOTS') {
      this.#repository.saveMetricSnapshots(request.snapshots);
      const firstSnapshot = request.snapshots.at(0);
      if (firstSnapshot === undefined) throw new V2ContractError('INVALID_REQUEST');
      return this.#metricsReview(firstSnapshot.snapshotWindow);
    }
    if (request.action === 'DECIDE_STRATEGY_RECOMMENDATION') {
      if (request.status === 'PENDING') throw new V2ContractError('INVALID_REQUEST');
      this.#repository.decision(request.id, request.status, request.expectedRevision);
      return this.#metricsReview('7D');
    }
    return this.#facade.mutate(request);
  }

  async #settingsOperation<T>(operation: () => Promise<T> | T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof V2ContractError) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { readonly code: unknown }).code)
          : '';
      if (code.includes('CREDENTIAL') || code.includes('ENCRYPTION')) {
        throw new V2ContractError('CREDENTIAL_ERROR');
      }
      if (code.includes('PROBE') || code.includes('CAPABILITY') || code.includes('BUDGET')) {
        throw new V2ContractError('CAPABILITY_PROBE_BLOCKED');
      }
      if (code.includes('SETUP') || code.includes('PROJECT') || code.includes('DATA_ROOT')) {
        throw new V2ContractError('SETTINGS_NOT_READY');
      }
      throw new V2ContractError('SETTINGS_INVALID');
    }
  }

  public smokeSummary() {
    this.#assertDataAvailable();
    return this.#repository.summary();
  }

  public readGeneratedCover(packageId: string, version: number): Promise<Uint8Array | null> {
    this.#assertDataAvailable();
    return this.#content.readGeneratedCover(packageId, version);
  }

  public close(): void {
    if (this.#closed) return;
    if (this.#maintenanceRunning) {
      const state = this.#maintenanceOperation;
      if (state !== null && this.#isMaintenanceCancellable(state)) {
        state.cancelRequested = true;
        state.controller.abort();
      }
      this.#maintenanceCloseRequested = true;
      return;
    }
    this.#closeNow();
  }

  #closeNow(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#providerPreviews.clear();
    this.#contentCopyPreviews.clear();
    this.#usedProviderPreviews.clear();
    this.#maintenanceSelections.clear();
    this.#maintenanceConfirmations.clear();
    this.#maintenancePreconditions.clear();
    this.#diagnosticConfirmations.clear();
    this.#diagnosticPreviews.clear();
    this.#diagnosticResults.clear();
    this.#diagnosticSelections.clear();
    this.#diagnosticStates.clear();
    this.#closed = true;
  }

  #diagnosticView(caller: V2ActionCaller): V2DiagnosticView {
    this.#purgeDiagnosticLeases();
    const state = this.#diagnosticStates.get(maintenanceCallerKey(caller));
    const selection = [...this.#diagnosticSelections.entries()].find(([, value]) =>
      sameMaintenanceCaller(value.caller, caller),
    );
    return Object.freeze({
      directory:
        selection === undefined
          ? null
          : Object.freeze({ displayLabel: selection[1].displayLabel, token: selection[0] }),
      outcome: state?.outcome ?? 'IDLE',
      result: state?.result ?? null,
      stage: state?.stage ?? 'IDLE',
    });
  }

  async #buildDiagnosticPayload(collectedAt: string): Promise<DiagnosticPreviewLease['payload']> {
    const categories = await summarizeLocalDiagnosticCategories(this.#root);
    return Object.freeze({
      application: Object.freeze({
        build: /^[a-f0-9]{40}$/u.test(this.#runtimeIdentity.buildCommit)
          ? this.#runtimeIdentity.buildCommit
          : null,
        version:
          this.#runtimeIdentity.appVersion === 'local' ? null : this.#runtimeIdentity.appVersion,
      }),
      collectedAt,
      fileCategories: categories,
      format: 'rednote-local-diagnostics' as const,
      health: Object.freeze({ database: 'healthy' as const, storage: 'healthy' as const }),
      runtime: Object.freeze({
        node: process.versions.node ?? null,
        platform: process.platform ?? null,
      }),
      version: 1 as const,
    });
  }

  #diagnosticPreview(
    lease: DiagnosticPreviewLease,
    confirmationToken: string | null,
  ): V2DiagnosticPreview {
    const preview = createLocalDiagnosticPreview(lease.payload);
    return Object.freeze({
      categories: preview.categories.map((category) =>
        Object.freeze({
          category: category.category,
          estimatedBytes: category.totalBytes,
          itemCount: category.itemCount,
        }),
      ),
      confirmationToken,
      estimatedBytes: preview.estimatedBytes,
      excluded: preview.excluded,
      state: 'PREVIEW',
    });
  }

  async #mutateDiagnostics(
    request: Extract<
      ReturnType<typeof parseV2MutationRequest>,
      {
        readonly action:
          | 'BUILD_LOCAL_DIAGNOSTIC_PREVIEW'
          | 'SELECT_LOCAL_DIAGNOSTIC_DIRECTORY'
          | 'PREVIEW_LOCAL_DIAGNOSTIC_EXPORT'
          | 'CONFIRM_LOCAL_DIAGNOSTIC_EXPORT'
          | 'OPEN_LOCAL_DIAGNOSTIC_RESULT';
      }
    >,
    caller: V2ActionCaller,
  ): Promise<V2DiagnosticPreview | V2DiagnosticView | { readonly opened: true }> {
    this.#purgeDiagnosticLeases();
    if (request.action === 'BUILD_LOCAL_DIAGNOSTIC_PREVIEW') {
      if (this.#maintenanceRunning || this.#diagnosticRunning)
        throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
      const payload = await this.#buildDiagnosticPayload(new Date().toISOString());
      const previewHash = createLocalDiagnosticPreview(payload).previewHash;
      const lease: DiagnosticPreviewLease = Object.freeze({
        caller,
        expiresAtMs: Date.now() + 120_000,
        payload,
        previewHash,
      });
      this.#diagnosticPreviews.set(maintenanceCallerKey(caller), lease);
      for (const [token, selection] of this.#diagnosticSelections) {
        if (sameMaintenanceCaller(selection.caller, caller))
          this.#diagnosticSelections.delete(token);
      }
      for (const [token, confirmation] of this.#diagnosticConfirmations) {
        if (sameMaintenanceCaller(confirmation.caller, caller))
          this.#diagnosticConfirmations.delete(token);
      }
      this.#diagnosticStates.delete(maintenanceCallerKey(caller));
      return this.#diagnosticPreview(lease, null);
    }
    if (request.action === 'SELECT_LOCAL_DIAGNOSTIC_DIRECTORY') {
      if (this.#maintenanceRunning || this.#diagnosticRunning || this.#maintenancePicker === null)
        throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
      const preview = this.#diagnosticPreviews.get(maintenanceCallerKey(caller));
      if (preview === undefined || preview.expiresAtMs < Date.now())
        throw new V2ContractError('INVALID_REQUEST');
      const picked = await this.#maintenancePicker.select(caller, 'DIAGNOSTICS');
      if (picked === null) return this.#diagnosticView(caller);
      const identity = await this.#directoryIdentity(picked.path);
      const token = randomUUID().replaceAll('-', '');
      this.#diagnosticSelections.set(
        token,
        Object.freeze({
          caller,
          displayLabel: picked.displayLabel,
          expiresAtMs: Date.now() + 120_000,
          identity,
          operation: 'DIAGNOSTICS',
          path: picked.path,
        }),
      );
      return this.#diagnosticView(caller);
    }
    if (request.action === 'PREVIEW_LOCAL_DIAGNOSTIC_EXPORT') {
      if (this.#maintenanceRunning || this.#diagnosticRunning)
        throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
      const selection = this.#diagnosticSelections.get(request.directoryToken);
      const preview = this.#diagnosticPreviews.get(maintenanceCallerKey(caller));
      if (
        selection === undefined ||
        preview === undefined ||
        !sameMaintenanceCaller(selection.caller, caller) ||
        selection.expiresAtMs < Date.now() ||
        preview.expiresAtMs < Date.now()
      )
        throw new V2ContractError('INVALID_REQUEST');
      const identity = await this.#directoryIdentity(selection.path);
      if (identity.dev !== selection.identity.dev || identity.ino !== selection.identity.ino)
        throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
      this.#diagnosticSelections.delete(request.directoryToken);
      const token = randomUUID().replaceAll('-', '');
      const confirmation: DiagnosticConfirmationLease = Object.freeze({
        ...preview,
        directory: selection,
        token,
      });
      this.#diagnosticConfirmations.set(token, confirmation);
      return this.#diagnosticPreview(preview, token);
    }
    if (request.action === 'OPEN_LOCAL_DIAGNOSTIC_RESULT') {
      const result = this.#diagnosticResults.get(request.resultToken);
      if (
        result === undefined ||
        !sameMaintenanceCaller(result.caller, caller) ||
        result.expiresAtMs < Date.now()
      )
        throw new V2ContractError('INVALID_REQUEST');
      this.#diagnosticResults.delete(request.resultToken);
      const opened = await this.#openDirectory(result.path);
      if (opened !== '') throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
      return Object.freeze({ opened: true });
    }
    if (this.#maintenanceRunning || this.#diagnosticRunning)
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    const confirmation = this.#diagnosticConfirmations.get(request.confirmationToken);
    if (
      confirmation === undefined ||
      !sameMaintenanceCaller(confirmation.caller, caller) ||
      confirmation.expiresAtMs < Date.now()
    )
      throw new V2ContractError('INVALID_REQUEST');
    this.#diagnosticConfirmations.delete(request.confirmationToken);
    const currentDirectory = await this.#directoryIdentity(confirmation.directory.path);
    if (
      currentDirectory.dev !== confirmation.directory.identity.dev ||
      currentDirectory.ino !== confirmation.directory.identity.ino
    )
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    const state: DiagnosticOperationState = {
      caller,
      outcome: 'IDLE',
      result: null,
      stage: 'PREFLIGHT',
    };
    this.#diagnosticStates.set(maintenanceCallerKey(caller), state);
    this.#diagnosticRunning = true;
    void (async () => {
      try {
        state.stage = 'WRITING';
        const currentPayload = await this.#buildDiagnosticPayload(confirmation.payload.collectedAt);
        const result = await writeLocalDiagnosticPackage({
          directory: confirmation.directory.path,
          payload: currentPayload,
          previewHash: confirmation.previewHash,
        });
        if (result.outcome !== 'SUCCESS') {
          state.outcome = result.outcome;
          state.stage = 'IDLE';
          return;
        }
        state.stage = 'VERIFYING';
        const resultToken = randomUUID().replaceAll('-', '');
        this.#diagnosticResults.set(
          resultToken,
          Object.freeze({
            caller,
            expiresAtMs: Date.now() + 120_000,
            fileName: result.fileName,
            path: confirmation.directory.path,
          }),
        );
        state.outcome = 'SUCCESS';
        state.result = Object.freeze({
          fileName: result.fileName,
          resultToken,
          sizeBytes: result.sizeBytes,
          summaryHash: `${result.sha256.slice(0, 4)}…${result.sha256.slice(-4)}`,
        });
        state.stage = 'PUBLISHING';
      } catch {
        state.outcome = 'FAILED_CLEAN';
        state.stage = 'IDLE';
      } finally {
        this.#diagnosticRunning = false;
      }
    })();
    return this.#diagnosticView(caller);
  }

  #purgeDiagnosticLeases(): void {
    const now = Date.now();
    for (const [key, value] of this.#diagnosticPreviews)
      if (value.expiresAtMs < now) this.#diagnosticPreviews.delete(key);
    for (const [key, value] of this.#diagnosticSelections)
      if (value.expiresAtMs < now) this.#diagnosticSelections.delete(key);
    for (const [key, value] of this.#diagnosticConfirmations)
      if (value.expiresAtMs < now) this.#diagnosticConfirmations.delete(key);
    for (const [key, value] of this.#diagnosticResults)
      if (value.expiresAtMs < now) this.#diagnosticResults.delete(key);
  }

  #maintenanceView(caller: V2ActionCaller): V2MaintenanceView {
    const selectionFor = (
      operation: 'BACKUP' | 'RESTORE',
    ): V2MaintenanceDirectorySelection | null => {
      this.#purgeMaintenanceLeases();
      const selection = [...this.#maintenanceSelections.entries()].find(
        ([, value]) => value.operation === operation && sameMaintenanceCaller(value.caller, caller),
      );
      if (selection !== undefined)
        return { displayLabel: selection[1].displayLabel, token: selection[0] };
      const confirmation = [...this.#maintenanceConfirmations.entries()].find(
        ([, value]) => value.operation === operation && sameMaintenanceCaller(value.caller, caller),
      );
      return confirmation === undefined
        ? null
        : { displayLabel: confirmation[1].displayLabel, token: confirmation[0] };
    };
    const state = this.#maintenanceOperation;
    const callerState =
      state !== null && sameMaintenanceCaller(state.caller, caller) ? state : null;
    return Object.freeze({
      backupDurability: callerState?.operation === 'BACKUP' ? callerState.backupDurability : null,
      backupDirectory: selectionFor('BACKUP'),
      backupOutcome: callerState?.operation === 'BACKUP' ? callerState.outcome : 'IDLE',
      backupPreconditions:
        this.#maintenancePreconditions.get(maintenanceCallerKey(caller)) ??
        uncheckedBackupPreconditions(),
      backupStage: callerState?.operation === 'BACKUP' ? callerState.stage : 'IDLE',
      cancelRequested: callerState?.cancelRequested === true,
      canCancel: callerState !== null && this.#isMaintenanceCancellable(callerState),
      maintenanceLocked:
        (this.#maintenanceRunning || this.#diagnosticRunning) && callerState === null,
      operation: callerState?.operation ?? null,
      restoreDirectory: selectionFor('RESTORE'),
      restoreOutcome: callerState?.operation === 'RESTORE' ? callerState.outcome : 'IDLE',
      restoreStage: callerState?.operation === 'RESTORE' ? callerState.stage : 'IDLE',
    });
  }

  async #mutateMaintenance(
    request: Extract<
      ReturnType<typeof parseV2MutationRequest>,
      {
        readonly action:
          | 'SELECT_BACKUP_DIRECTORY'
          | 'SELECT_RESTORE_DIRECTORY'
          | 'PREVIEW_CONTROLLED_BACKUP'
          | 'PREVIEW_CONTROLLED_RESTORE'
          | 'CONFIRM_CONTROLLED_BACKUP'
          | 'CONFIRM_CONTROLLED_RESTORE'
          | 'CANCEL_CONTROLLED_MAINTENANCE';
      }
    >,
    caller: V2ActionCaller,
  ): Promise<V2MaintenanceView | V2MaintenancePreview> {
    if (request.action === 'CANCEL_CONTROLLED_MAINTENANCE') return this.#cancelMaintenance(caller);
    if (this.#maintenanceRunning || this.#diagnosticRunning)
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    if (
      request.action === 'SELECT_BACKUP_DIRECTORY' ||
      request.action === 'SELECT_RESTORE_DIRECTORY'
    ) {
      return this.#selectMaintenanceDirectory(
        caller,
        request.action === 'SELECT_BACKUP_DIRECTORY' ? 'BACKUP' : 'RESTORE',
      );
    }
    if (
      request.action === 'PREVIEW_CONTROLLED_BACKUP' ||
      request.action === 'PREVIEW_CONTROLLED_RESTORE'
    ) {
      return this.#previewMaintenance(
        caller,
        request.directoryToken,
        request.action === 'PREVIEW_CONTROLLED_BACKUP' ? 'BACKUP' : 'RESTORE',
      );
    }
    return this.#confirmMaintenance(
      caller,
      request.confirmationToken,
      request.action === 'CONFIRM_CONTROLLED_BACKUP' ? 'BACKUP' : 'RESTORE',
    );
  }

  async #selectMaintenanceDirectory(
    caller: V2ActionCaller,
    operation: 'BACKUP' | 'RESTORE',
  ): Promise<V2MaintenanceView> {
    if (this.#maintenancePicker === null) throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    this.#clearMaintenanceLeases(caller, operation);
    const picked = await this.#maintenancePicker.select(caller, operation);
    if (picked === null) return this.#maintenanceView(caller);
    const identity = await this.#directoryIdentity(picked.path);
    const token = randomUUID().replaceAll('-', '');
    this.#purgeMaintenanceLeases();
    this.#maintenanceSelections.set(token, {
      caller,
      displayLabel: picked.displayLabel,
      expiresAtMs: Date.now() + 120_000,
      identity,
      operation,
      path: picked.path,
    });
    this.#maintenancePreconditions.set(
      maintenanceCallerKey(caller),
      uncheckedBackupPreconditions(),
    );
    if (
      this.#maintenanceOperation !== null &&
      !this.#maintenanceOperation.running &&
      sameMaintenanceCaller(this.#maintenanceOperation.caller, caller)
    )
      this.#maintenanceOperation = null;
    return this.#maintenanceView(caller);
  }

  async #previewMaintenance(
    caller: V2ActionCaller,
    token: string,
    operation: 'BACKUP' | 'RESTORE',
  ): Promise<V2MaintenancePreview> {
    const selection = await this.#consumeMaintenanceSelection(token, caller, operation);
    const backupPreconditions =
      operation === 'BACKUP' ? await this.#backupPreflight(selection) : null;
    if (backupPreconditions !== null)
      this.#maintenancePreconditions.set(maintenanceCallerKey(caller), backupPreconditions);
    const canConfirm =
      backupPreconditions === null ||
      Object.values(backupPreconditions).every((value) => value === 'PASSED');
    const confirmationToken = canConfirm ? randomUUID().replaceAll('-', '') : null;
    const confirmation =
      confirmationToken === null
        ? null
        : {
            ...selection,
            token: confirmationToken,
            ...(operation === 'RESTORE'
              ? { backupPreflight: await this.#prepareRestore(selection.path) }
              : {}),
          };
    if (confirmation !== null && confirmationToken !== null)
      this.#maintenanceConfirmations.set(confirmationToken, confirmation);
    const restore = confirmation?.backupPreflight;
    return Object.freeze({
      backupPreconditions,
      canConfirm,
      confirmationToken,
      fileCount: restore?.backupFileCount ?? null,
      operation,
      stage: 'PREFLIGHT',
      summary:
        operation === 'BACKUP'
          ? '预检已创建并清理临时写入探针；仅在确认后创建受控备份。'
          : `已核对 ${restore?.backupFileCount ?? 0} 个备份文件；恢复将替换当前本地数据。`,
    });
  }

  async #confirmMaintenance(
    caller: V2ActionCaller,
    token: string,
    operation: 'BACKUP' | 'RESTORE',
  ): Promise<V2MaintenanceView> {
    this.#purgeMaintenanceLeases();
    const lease = this.#maintenanceConfirmations.get(token);
    if (
      lease === undefined ||
      lease.operation !== operation ||
      lease.caller.senderId !== caller.senderId ||
      lease.caller.windowId !== caller.windowId ||
      lease.expiresAtMs < Date.now()
    )
      throw new V2ContractError('INVALID_REQUEST');
    this.#maintenanceConfirmations.delete(token);
    const current = await this.#directoryIdentity(lease.path);
    if (current.dev !== lease.identity.dev || current.ino !== lease.identity.ino)
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    if (operation === 'RESTORE' && lease.backupPreflight === undefined)
      throw new V2ContractError('INVALID_REQUEST');
    const state: MaintenanceOperationState = {
      backupDurability: null,
      caller,
      cancelRequested: false,
      controller: new AbortController(),
      operation,
      outcome: 'IDLE',
      running: true,
      stage: 'PREFLIGHT',
    };
    this.#maintenanceOperation = state;
    this.#maintenanceRunning = true;
    this.#maintenancePromise = this.#runMaintenance(lease, state)
      .catch(() => this.#settleMaintenanceFailure(state))
      .finally(() => {
        state.running = false;
        this.#maintenanceRunning = false;
        this.#maintenancePromise = null;
        if (this.#maintenanceCloseRequested) this.#closeNow();
      });
    void this.#maintenancePromise;
    return this.#maintenanceView(caller);
  }

  #cancelMaintenance(caller: V2ActionCaller): V2MaintenanceView {
    const state = this.#maintenanceOperation;
    if (state === null || !state.running || !sameMaintenanceCaller(state.caller, caller))
      throw new V2ContractError('INVALID_REQUEST');
    if (!this.#isMaintenanceCancellable(state)) return this.#maintenanceView(caller);
    state.cancelRequested = true;
    state.controller.abort();
    return this.#maintenanceView(caller);
  }

  #isMaintenanceCancellable(state: MaintenanceOperationState): boolean {
    return (
      state.running &&
      !state.cancelRequested &&
      (state.stage === 'PREFLIGHT' || state.stage === 'BUILDING_STAGING')
    );
  }

  #setMaintenanceStage(
    state: MaintenanceOperationState,
    stage: V2MaintenanceView['backupStage'],
  ): void {
    if (this.#maintenanceOperation === state && state.running) state.stage = stage;
  }

  async #runMaintenance(
    lease: MaintenanceConfirmationLease,
    state: MaintenanceOperationState,
  ): Promise<void> {
    if (state.operation === 'BACKUP') {
      const result = await createControlledBackupSnapshot({
        appVersion: this.#runtimeIdentity.appVersion,
        buildCommit: this.#runtimeIdentity.buildCommit,
        database: this.#backupAdapter(),
        databasePath: join(this.#root.databaseDirectory, PROJECT_DATABASE_FILE),
        onStage: (stage) => this.#setMaintenanceStage(state, stage),
        root: this.#root,
        selectedBackupRoot: lease.path,
        signal: state.controller.signal,
        v2DataVersion: 1,
      });
      state.backupDurability = result.durability;
      state.outcome = 'SUCCESS';
      state.stage = 'SUCCESS';
      return;
    }
    await this.#runRestoreMaintenance(lease, state);
  }

  async #runRestoreMaintenance(
    lease: MaintenanceConfirmationLease,
    state: MaintenanceOperationState,
  ): Promise<void> {
    const preflight = lease.backupPreflight;
    if (preflight === undefined) throw new V2ContractError('INVALID_REQUEST');
    const runtime = this.#restoreRuntimeIdentity();
    // The database is deliberately closed before the root-level switch. It is only reopened
    // after the switched root passes the storage verifier.
    this.#database.close();
    try {
      const result = await executeControlledRestore({
        backupPath: lease.path,
        database: this.#backupAdapter(),
        onStage: (stage) => this.#setMaintenanceStage(state, stage),
        preflight,
        root: this.#root,
        runtime,
        signal: state.controller.signal,
      });
      if (result.outcome === 'SAFETY_UNPROVEN') {
        state.outcome = 'SAFETY_UNPROVEN';
        state.stage = 'SAFETY_UNPROVEN';
        this.#closed = true;
        return;
      }
      try {
        await this.#reopenAfterRestore();
      } catch {
        state.outcome = 'SAFETY_UNPROVEN';
        state.stage = 'SAFETY_UNPROVEN';
        this.#closed = true;
        return;
      }
      state.outcome = result.outcome;
      state.stage = result.stage;
    } catch {
      try {
        await this.#reopenAfterRestore();
      } catch {
        state.outcome = 'SAFETY_UNPROVEN';
        state.stage = 'SAFETY_UNPROVEN';
        this.#closed = true;
        return;
      }
      state.outcome = state.cancelRequested ? 'CANCELLED' : 'FAILED';
      state.stage = state.cancelRequested ? 'CANCELLED' : 'FAILED';
    }
  }

  #settleMaintenanceFailure(state: MaintenanceOperationState): void {
    if (this.#maintenanceOperation !== state) return;
    if (state.operation === 'BACKUP') {
      state.outcome = state.cancelRequested ? 'CANCELLED' : 'FAILED';
      state.stage = state.cancelRequested ? 'CANCELLED' : 'FAILED';
      return;
    }
    state.outcome = 'SAFETY_UNPROVEN';
    state.stage = 'SAFETY_UNPROVEN';
    this.#closed = true;
  }

  async #reopenAfterRestore(): Promise<void> {
    const databasePath = join(this.#root.databaseDirectory, PROJECT_DATABASE_FILE);
    const assets = await discoverApprovedV2Covers(this.#assetsDirectory);
    this.#database = connectDatabase(databasePath);
    this.#catalog = new SqliteCatalogRepository(this.#database);
    this.#repository = new SqliteV2Repository(this.#database);
    this.#facade = new V2ApplicationFacade(this.#repository);
    this.#content = new V2ContentApplication(
      this.#repository,
      new V2LocalContentFiles(this.#root, assets, { openDirectory: this.#openDirectory }),
    );
    this.#interaction = new V2InteractionApplication(
      this.#repository,
      new V2LocalInteractionFiles(this.#root),
    );
  }

  #backupAdapter(): ControlledBackupDatabaseAdapter {
    return {
      createSnapshot: (destinationPath, signal) =>
        createSqliteSnapshot(this.#database, destinationPath, signal),
      enumerateManagedFiles: (snapshotPath, signal) =>
        enumerateManagedFileInventory(snapshotPath, signal),
      estimateSnapshotBytes: () => estimateSqliteSnapshotBytes(this.#database),
      inspectSnapshot: (snapshotPath) => inspectSqliteSnapshot(snapshotPath),
    };
  }

  #restoreRuntimeIdentity() {
    const identity = inspectSqliteSnapshot(
      join(this.#root.databaseDirectory, PROJECT_DATABASE_FILE),
    );
    return {
      appVersion: this.#runtimeIdentity.appVersion,
      migrationFingerprint: identity.migrationFingerprint,
      schemaVersion: identity.schemaVersion,
      v2DataVersion: 1,
    };
  }

  async #prepareRestore(backupPath: string): Promise<ControlledRestorePreflight> {
    return prepareControlledRestore({
      backupPath,
      database: this.#backupAdapter(),
      policy: { allowedSourceAppVersions: ['0.0.0'] },
      root: this.#root,
      runtime: this.#restoreRuntimeIdentity(),
    }).catch(() => {
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    });
  }

  async #backupPreflight(
    selection: MaintenanceSelectionLease,
  ): Promise<V2MaintenanceBackupPreconditions> {
    const preconditions: {
      directory: V2MaintenanceBackupPreconditions['directory'];
      maintenanceLock: V2MaintenanceBackupPreconditions['maintenanceLock'];
      space: V2MaintenanceBackupPreconditions['space'];
      write: V2MaintenanceBackupPreconditions['write'];
    } = {
      directory: 'NOT_CHECKED',
      maintenanceLock: 'NOT_CHECKED',
      space: 'NOT_CHECKED',
      write: 'NOT_CHECKED',
    };
    try {
      const current = await this.#directoryIdentity(selection.path);
      preconditions.directory =
        current.dev === selection.identity.dev && current.ino === selection.identity.ino
          ? 'PASSED'
          : 'FAILED';
    } catch {
      preconditions.directory = 'FAILED';
    }
    if (preconditions.directory !== 'PASSED') return Object.freeze(preconditions);
    preconditions.maintenanceLock =
      this.#maintenanceRunning || this.#diagnosticRunning ? 'FAILED' : 'PASSED';
    try {
      const estimate = estimateSqliteSnapshotBytes(this.#database);
      const required = estimate + BACKUP_SPACE_MARGIN_BYTES;
      const filesystem = await statfs(selection.path);
      const available = BigInt(filesystem.bavail) * BigInt(filesystem.bsize);
      preconditions.space =
        Number.isSafeInteger(required) && available >= BigInt(required) ? 'PASSED' : 'FAILED';
    } catch {
      preconditions.space = 'FAILED';
    }
    const checkPath = join(
      selection.path,
      `.${randomUUID().replaceAll('-', '')}.rednote-write-check`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        checkPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      await unlink(checkPath);
      const current = await this.#directoryIdentity(selection.path);
      preconditions.write =
        current.dev === selection.identity.dev && current.ino === selection.identity.ino
          ? 'PASSED'
          : 'FAILED';
    } catch {
      preconditions.write = 'FAILED';
    } finally {
      await handle?.close().catch(() => undefined);
      await unlink(checkPath).catch(() => undefined);
    }
    return Object.freeze(preconditions);
  }

  #clearMaintenanceLeases(caller: V2ActionCaller, operation: 'BACKUP' | 'RESTORE'): void {
    for (const [token, lease] of this.#maintenanceSelections) {
      if (lease.operation === operation && sameMaintenanceCaller(lease.caller, caller))
        this.#maintenanceSelections.delete(token);
    }
    for (const [token, lease] of this.#maintenanceConfirmations) {
      if (lease.operation === operation && sameMaintenanceCaller(lease.caller, caller))
        this.#maintenanceConfirmations.delete(token);
    }
  }

  async #consumeMaintenanceSelection(
    token: string,
    caller: V2ActionCaller,
    operation: 'BACKUP' | 'RESTORE',
  ): Promise<MaintenanceSelectionLease> {
    this.#purgeMaintenanceLeases();
    const selection = this.#maintenanceSelections.get(token);
    if (
      selection === undefined ||
      selection.operation !== operation ||
      selection.caller.senderId !== caller.senderId ||
      selection.caller.windowId !== caller.windowId ||
      selection.expiresAtMs < Date.now()
    )
      throw new V2ContractError('INVALID_REQUEST');
    this.#maintenanceSelections.delete(token);
    const current = await this.#directoryIdentity(selection.path);
    if (current.dev !== selection.identity.dev || current.ino !== selection.identity.ino)
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    return selection;
  }

  async #directoryIdentity(path: string): Promise<{ readonly dev: number; readonly ino: number }> {
    try {
      const status = await lstat(path);
      if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('invalid');
      return { dev: status.dev, ino: status.ino };
    } catch {
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    }
  }

  #purgeMaintenanceLeases(): void {
    const now = Date.now();
    for (const [token, lease] of this.#maintenanceSelections) {
      if (lease.expiresAtMs < now) this.#maintenanceSelections.delete(token);
    }
    for (const [token, lease] of this.#maintenanceConfirmations) {
      if (lease.expiresAtMs < now) this.#maintenanceConfirmations.delete(token);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('V2_RUNTIME_CLOSED');
  }

  #assertDataAvailable(): void {
    this.#assertOpen();
    if (this.#maintenanceRunning || this.#diagnosticRunning)
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
  }

  async #metricsReview(snapshotWindow: MetricWindow): Promise<MetricsReview> {
    const workspace = await this.#content.read('2026-W01');
    const titles = new Map(workspace.packages.map((item) => [item.id, item.fields.title]));
    const review = deterministicReview(
      this.#repository.listMetricSnapshots(),
      titles,
      snapshotWindow,
    );
    const decisions = this.#repository.syncStrategyRecommendations(review.recommendations);
    return {
      ...review,
      recommendations: review.recommendations.map((item) => {
        const decision = decisions.get(item.id);
        return decision === undefined ? item : { ...item, status: decision.status };
      }),
    } as MetricsReview;
  }

  async #evaluateContentCopyGeneration(input: {
    readonly selectedPlanItemIds: readonly string[];
    readonly userApprovedUnknownCost: boolean;
    readonly weekKey: string;
  }) {
    const plan = this.#facade.read({ view: 'WEEKLY_PLAN', weekKey: input.weekKey }) as WeeklyPlan;
    const selectedPlanItemIds = Object.freeze([...input.selectedPlanItemIds].sort());
    const itemBlockReasons: Record<string, string> = {};
    const candidates = selectedPlanItemIds.flatMap((id) => {
      const candidate = plan.candidates.find((item) => item.id === id);
      if (candidate === undefined) {
        itemBlockReasons[id] = '计划项已删除或不属于当前锁定周计划。';
        return [];
      }
      if (candidate.status === 'SKIPPED') {
        itemBlockReasons[id] = '计划项已跳过，不能生成文案。';
        return [];
      }
      return [candidate];
    });
    const businessReasons = [
      ...(this.#database.isOpen ? [] : ['本地项目数据不可读写。']),
      ...(plan.status === 'CONFIRMED' ? [] : ['请先锁定当前周计划。']),
      ...(selectedPlanItemIds.length >= 1 && selectedPlanItemIds.length <= 3
        ? []
        : ['请选择 1 至 3 个计划项。']),
      ...Object.values(itemBlockReasons),
    ];
    const persona = this.#facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
    const providerInput = Object.freeze({
      candidates: Object.freeze(candidates),
      persona,
      weekKey: input.weekKey,
    });
    const readiness =
      this.#providerExecution.inspectContentCopy === undefined
        ? Object.freeze({
            blockReasons: Object.freeze(['专用内容文案 Provider runtime 不可用。']),
            budgetState: 'UNKNOWN' as const,
            canConfirm: false,
            capabilityEvidenceId: null,
            credentialBinding: null,
            credentialState: 'NOT_CONFIGURED' as const,
            feeEstimateMicroUsd: null,
            modelId: null,
            protocolMode: null,
            unknownCostApproved: input.userApprovedUnknownCost,
          })
        : await this.#providerExecution.inspectContentCopy({
            input: providerInput,
            requestCount: selectedPlanItemIds.length as 1 | 2 | 3,
            userApprovedUnknownCost: input.userApprovedUnknownCost,
          });
    return Object.freeze({
      candidates: Object.freeze(candidates),
      itemBlockReasons: Object.freeze(itemBlockReasons),
      persona,
      plan,
      providerInput,
      readiness: Object.freeze({
        ...readiness,
        blockReasons: Object.freeze([...businessReasons, ...readiness.blockReasons]),
        canConfirm: businessReasons.length === 0 && readiness.canConfirm,
      }),
      selectedPlanItemIds,
    });
  }

  async #previewContentCopyGeneration(
    request: {
      readonly selectedPlanItemIds: readonly string[];
      readonly userApprovedUnknownCost: boolean;
      readonly weekKey: string;
    },
    caller: V2ActionCaller,
  ): Promise<V2ContentCopyGenerationPreview> {
    this.#removeExpiredProviderPreviews();
    const evaluated = await this.#evaluateContentCopyGeneration(request);
    const expiresAtMs = Date.now() + V2_PROVIDER_ACTION_LIMITS.tokenTtlMs;
    const { readiness } = evaluated;
    const canIssueToken =
      readiness.canConfirm &&
      readiness.modelId !== null &&
      readiness.credentialBinding !== null &&
      readiness.capabilityEvidenceId !== null;
    const previewToken = canIssueToken ? randomBytes(32).toString('base64url') : null;
    if (
      previewToken !== null &&
      readiness.modelId !== null &&
      readiness.credentialBinding !== null &&
      readiness.capabilityEvidenceId !== null
    ) {
      this.#contentCopyPreviews.set(previewToken, {
        caller,
        capabilityEvidenceId: readiness.capabilityEvidenceId,
        credentialBinding: readiness.credentialBinding,
        expiresAtMs,
        modelId: readiness.modelId,
        planRevision: evaluated.plan.revision,
        selectedPlanItemIds: evaluated.selectedPlanItemIds,
        weekKey: request.weekKey,
      });
    }
    return Object.freeze({
      ...readiness,
      expiresAt: new Date(expiresAtMs).toISOString(),
      fetchEnabled: false,
      itemBlockReasons: evaluated.itemBlockReasons,
      previewToken,
      requestCount: evaluated.selectedPlanItemIds.length as 1 | 2 | 3,
      searchEnabled: false,
      selectedPlanItemIds: evaluated.selectedPlanItemIds,
      weekKey: request.weekKey,
    });
  }

  async #executeContentCopyGeneration(
    previewToken: string,
    caller: V2ActionCaller,
  ): Promise<V2ContentCopyGenerationResult> {
    const lease = this.#contentCopyPreviews.get(previewToken);
    if (lease === undefined) throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
    this.#contentCopyPreviews.delete(previewToken);
    if (lease.expiresAtMs < Date.now()) throw new V2ProviderActionError('PROVIDER_ACTION_EXPIRED');
    if (lease.caller.senderId !== caller.senderId || lease.caller.windowId !== caller.windowId) {
      throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
    }
    const evaluated = await this.#evaluateContentCopyGeneration({
      selectedPlanItemIds: lease.selectedPlanItemIds,
      userApprovedUnknownCost: true,
      weekKey: lease.weekKey,
    });
    if (evaluated.plan.revision !== lease.planRevision) {
      throw new V2ProviderActionError('PROVIDER_ACTION_SOURCE_CHANGED', ['weeklyPlan']);
    }
    if (evaluated.readiness.modelId !== lease.modelId) {
      throw new V2ProviderActionError('PROVIDER_ACTION_CONFIG_CHANGED', ['writingModelId']);
    }
    if (evaluated.readiness.credentialBinding !== lease.credentialBinding) {
      throw new V2ProviderActionError('PROVIDER_ACTION_CREDENTIAL_CHANGED', ['credentialBinding']);
    }
    if (evaluated.readiness.capabilityEvidenceId !== lease.capabilityEvidenceId) {
      throw new V2ProviderActionError('PROVIDER_ACTION_CONFIG_CHANGED', ['writingCapability']);
    }
    if (!evaluated.readiness.canConfirm) {
      throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED', ['contentCopyReadiness']);
    }
    const results: V2ContentCopyGenerationResult['items'][number][] = [];
    let externalRequestCount = 0;
    for (const candidate of evaluated.candidates) {
      const executed = await this.#providerExecution.execute({
        executionId: `v2-r07-${randomUUID()}`,
        input: Object.freeze({
          candidate,
          persona: evaluated.persona,
          weekKey: lease.weekKey,
        }),
        kind: 'CONTENT_COPY_VERSION',
        modelSlot: 'writing',
        requiredProtocolMode: 'CHAT_COMPLETIONS',
        userApprovedUnknownCost: true,
      });
      externalRequestCount += executed.externalRequestCount;
      if (
        executed.status !== 'SUCCEEDED' ||
        typeof executed.output !== 'object' ||
        executed.output === null ||
        !('packages' in executed.output) ||
        !Array.isArray(executed.output.packages) ||
        executed.output.packages.length !== 1
      ) {
        const technicalCode = executed.stableErrorCode;
        results.push({
          message: contentCopyFailureMessage(executed.status, technicalCode),
          packageId: null,
          planItemId: candidate.id,
          providerRequestId: executed.providerRequestId ?? null,
          safeDiagnostic: executed.safeDiagnostic ?? null,
          status: 'FAILED',
          technicalCode,
        });
        continue;
      }
      try {
        const saved = await this.#content.appendOrCreateModelCopy(
          evaluated.plan,
          candidate.id,
          executed.output.packages[0],
          executed.modelRunId ?? null,
        );
        results.push({
          message: '文案已生成，待补封面。',
          packageId: saved.id,
          planItemId: candidate.id,
          providerRequestId: executed.providerRequestId ?? null,
          safeDiagnostic: null,
          status: 'SUCCEEDED',
          technicalCode: null,
        });
      } catch {
        results.push({
          message: '文案已返回但本地保存失败，未覆盖历史版本。',
          packageId: null,
          planItemId: candidate.id,
          providerRequestId: executed.providerRequestId ?? null,
          safeDiagnostic: null,
          status: 'FAILED',
          technicalCode: 'CONTENT_VERSION_PERSISTENCE_FAILED',
        });
      }
    }
    if (externalRequestCount > 3) throw new V2ProviderActionError('PROVIDER_ACTION_UNCERTAIN');
    return Object.freeze({
      externalRequestCount: externalRequestCount as 0 | 1 | 2 | 3,
      items: Object.freeze(results),
      weekKey: lease.weekKey,
    });
  }

  async #previewProviderAction(
    intent: V2ProviderActionIntent,
    caller: V2ActionCaller,
  ): Promise<V2ProviderActionPreview> {
    this.#removeExpiredProviderPreviews();
    let input: Readonly<Record<string, unknown>> = Object.freeze({});
    let businessBlock: {
      readonly code: V2ProviderActionError['code'];
      readonly message: string;
    } | null = null;
    try {
      input = await this.#providerInput(intent);
    } catch (error) {
      if (!(error instanceof V2ProviderActionError)) throw error;
      businessBlock = { code: error.code, message: providerBusinessBlock(intent, error) };
    }
    const readiness = await this.#providerExecution.inspect({
      input,
      kind: intent.kind,
      modelSlot: providerActionModelSlot(intent.kind),
      userApprovedUnknownCost: intent.userApprovedUnknownCost === true,
    });
    const canConfirm = businessBlock === null && readiness.canConfirm;
    const previewToken = canConfirm ? randomBytes(32).toString('base64url') : null;
    const expiresAtMs = Date.now() + V2_PROVIDER_ACTION_LIMITS.tokenTtlMs;
    if (previewToken !== null) {
      this.#providerPreviews.set(previewToken, {
        caller,
        expiresAtMs,
        intent,
        inputHash: providerInputHash(input),
        readiness,
      });
    }
    const targetWeekKey =
      intent.kind === 'WEEKLY_PLAN' || intent.kind === 'PLAN_ITEM_REPLACEMENT'
        ? intent.weekKey
        : null;
    const targetWeek = targetWeekKey === null ? null : weekDateRange(targetWeekKey);
    const planningBrief =
      intent.kind === 'WEEKLY_PLAN' && 'plan' in input
        ? (input.plan as WeeklyPlan).brief.text
        : undefined;
    const replacementFeedback =
      intent.kind === 'PLAN_ITEM_REPLACEMENT' && 'feedback' in input
        ? (input.feedback as WeeklyPlan['itemFeedback'][number])
        : undefined;
    return Object.freeze({
      ...readiness,
      ...(businessBlock === null ? {} : { businessReasonCode: businessBlock.code }),
      blockReasons:
        businessBlock === null
          ? readiness.blockReasons
          : [businessBlock.message, ...readiness.blockReasons],
      canConfirm,
      expiresAt: new Date(expiresAtMs).toISOString(),
      fetchEnabled: false,
      kind: intent.kind,
      previewToken,
      requestCount: intent.kind === 'CONTENT_PACKAGES' ? 3 : 1,
      reasonMessage: businessBlock?.message ?? readiness.reasonMessage,
      searchEnabled: false,
      summary: providerActionSummary(intent.kind),
      ...(planningBrief === undefined ? {} : { planningBrief }),
      ...(replacementFeedback === undefined
        ? {}
        : {
            itemFeedback: `${replacementFeedback.reason}${
              replacementFeedback.details === '' ? '' : ` · ${replacementFeedback.details}`
            }`,
            itemScope: replacementFeedback.candidateId,
          }),
      ...(targetWeek === null
        ? {}
        : {
            targetEndDate: targetWeek.endDate,
            targetStartDate: targetWeek.startDate,
            targetWeekKey: targetWeekKey as string,
          }),
    });
  }

  async #confirmProviderAction(
    previewToken: string,
    caller: V2ActionCaller,
  ): Promise<V2ProviderActionResult> {
    const lease = this.#providerPreviews.get(previewToken);
    if (lease === undefined) {
      if (this.#usedProviderPreviews.has(previewToken))
        throw new V2ProviderActionError('PROVIDER_ACTION_REPLAYED');
      throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
    }
    this.#providerPreviews.delete(previewToken);
    if (lease.expiresAtMs < Date.now()) throw new V2ProviderActionError('PROVIDER_ACTION_EXPIRED');
    if (lease.caller.senderId !== caller.senderId || lease.caller.windowId !== caller.windowId)
      throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
    this.#usedProviderPreviews.add(previewToken);
    const input = await this.#providerInput(lease.intent);
    const currentReadiness = await this.#providerExecution.inspect({
      input,
      kind: lease.intent.kind,
      modelSlot: providerActionModelSlot(lease.intent.kind),
      userApprovedUnknownCost: lease.intent.userApprovedUnknownCost === true,
    });
    if (!currentReadiness.canConfirm)
      throw new V2ProviderActionError(
        currentReadiness.reasonCode === 'BUDGET_HARD_STOP'
          ? 'PROVIDER_ACTION_BUDGET_HARD_STOP'
          : currentReadiness.reasonCode === 'UNKNOWN_FEE_CONSENT_REQUIRED'
            ? 'PROVIDER_ACTION_UNKNOWN_FEE_CONSENT_REQUIRED'
            : currentReadiness.reasonCode === 'READY'
              ? 'PROVIDER_ACTION_BLOCKED'
              : currentReadiness.reasonCode,
        readinessAffectedFields(currentReadiness),
      );
    if (providerInputHash(input) !== lease.inputHash)
      throw new V2ProviderActionError('PROVIDER_ACTION_SOURCE_CHANGED');
    if (currentReadiness.modelId !== lease.readiness.modelId)
      throw new V2ProviderActionError('PROVIDER_ACTION_CONFIG_CHANGED', [
        currentReadiness.modelSlot === 'research' ? 'researchModelId' : 'writingModelId',
      ]);
    if (currentReadiness.configFingerprint !== lease.readiness.configFingerprint)
      throw new V2ProviderActionError('PROVIDER_ACTION_CONFIG_CHANGED', ['providerBaseUrl']);
    if (currentReadiness.credentialBinding !== lease.readiness.credentialBinding)
      throw new V2ProviderActionError('PROVIDER_ACTION_CREDENTIAL_CHANGED', ['credentialBinding']);
    if (currentReadiness.readinessBinding !== lease.readiness.readinessBinding)
      throw new V2ProviderActionError('PROVIDER_ACTION_STALE');
    const executed = await this.#executeProviderAction(lease.intent, input);
    if (executed.externalRequestCount > 3) {
      throw new V2ProviderActionError('PROVIDER_ACTION_UNCERTAIN');
    }
    if (executed.status === 'OUTCOME_UNCERTAIN') {
      throw new V2ProviderActionError(
        lease.intent.kind === 'CONTENT_COVER' &&
          executed.stableErrorCode === 'PROVIDER_UPSTREAM_5XX'
          ? 'PROVIDER_ACTION_IMAGE_SERVICE_UNAVAILABLE'
          : 'PROVIDER_ACTION_UNCERTAIN',
      );
    }
    if (executed.status === 'CANCELLED') {
      throw new V2ProviderActionError('PROVIDER_ACTION_CANCELLED');
    }
    if (executed.status !== 'SUCCEEDED')
      throw new V2ProviderActionError(
        executed.stableErrorCode === 'BUDGET_HARD_LIMIT_REACHED'
          ? 'PROVIDER_ACTION_BUDGET_HARD_STOP'
          : executed.stableErrorCode === 'BUDGET_UNPRICED_LIMIT_REQUIRED'
            ? 'PROVIDER_ACTION_UNKNOWN_FEE_CONSENT_REQUIRED'
            : 'PROVIDER_ACTION_BLOCKED',
        executed.stableErrorCode === null ? [] : [executed.stableErrorCode],
      );
    await this.#persistProviderOutput(lease.intent, executed.output, executed.modelRunId ?? null);
    return Object.freeze({
      costAmountMicroUsd: executed.costAmountMicroUsd,
      costState: executed.costState,
      externalRequestCount: executed.externalRequestCount,
      kind: lease.intent.kind,
      status: 'SUCCEEDED',
    });
  }

  async #executeProviderAction(
    intent: V2ProviderActionIntent,
    input: Readonly<Record<string, unknown>>,
  ): Promise<V2ProviderActionExecutionResult> {
    const execute = (executionId: string, actionInput: Readonly<Record<string, unknown>>) =>
      this.#providerExecution.execute({
        executionId,
        input: actionInput,
        kind: intent.kind,
        modelSlot: providerActionModelSlot(intent.kind),
        userApprovedUnknownCost: intent.userApprovedUnknownCost === true,
      });
    if (intent.kind !== 'CONTENT_PACKAGES') return execute(`v2-r07-${randomUUID()}`, input);

    const candidates = input.candidates;
    const persona = input.persona;
    if (!Array.isArray(candidates) || candidates.length !== 3 || persona === undefined) {
      throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['candidateIds']);
    }
    const results: V2ProviderActionExecutionResult[] = [];
    for (const candidate of candidates) {
      const result = await execute(
        `v2-r07-${randomUUID()}`,
        Object.freeze({ candidate, persona, weekKey: input.weekKey }),
      );
      results.push(result);
      if (result.status !== 'SUCCEEDED') {
        return Object.freeze({
          ...result,
          externalRequestCount: combinedExternalRequestCount(results),
        });
      }
    }
    const packages = results.flatMap((result) => {
      const output = result.output;
      return typeof output === 'object' && output !== null && 'packages' in output
        ? (output as { readonly packages: unknown[] }).packages
        : [];
    });
    if (packages.length !== 3)
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
    return Object.freeze({
      costAmountMicroUsd: results.every(({ costAmountMicroUsd }) => costAmountMicroUsd !== null)
        ? results.reduce((total, item) => total + (item.costAmountMicroUsd ?? 0), 0)
        : null,
      costState: results[0]?.costState ?? 'NOT_INCURRED',
      externalRequestCount: combinedExternalRequestCount(results),
      modelRunId: null,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      output: Object.freeze({ packages }),
      stableErrorCode: null,
      status: 'SUCCEEDED',
    });
  }

  async #providerInput(intent: V2ProviderActionIntent): Promise<Readonly<Record<string, unknown>>> {
    const persona = this.#facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
    if (intent.kind === 'WEEKLY_PLAN') {
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: intent.weekKey,
      }) as WeeklyPlan;
      if (
        plan.revision !== intent.expectedRevision ||
        plan.brief.revision !== intent.briefRevision ||
        plan.status !== 'DRAFT'
      ) {
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['weeklyPlan']);
      }
      return Object.freeze({ persona, plan, weekKey: intent.weekKey });
    }
    if (intent.kind === 'PLAN_ITEM_REPLACEMENT') {
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: intent.weekKey,
      }) as WeeklyPlan;
      const feedback = plan.itemFeedback.find((item) => item.feedbackId === intent.feedbackId);
      const candidate =
        feedback === undefined
          ? undefined
          : plan.candidates.find((item) => item.id === feedback.candidateId);
      if (
        plan.revision !== intent.expectedRevision ||
        plan.status !== 'DRAFT' ||
        feedback?.status !== 'RECORDED' ||
        candidate === undefined
      )
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['feedbackId']);
      return Object.freeze({ candidate, feedback, persona, weekKey: intent.weekKey });
    }
    if (intent.kind === 'CONTENT_PACKAGES') {
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: intent.weekKey,
      }) as WeeklyPlan;
      const existing = await this.#content.read(intent.weekKey);
      if (plan.revision !== intent.expectedPlanRevision || plan.status !== 'CONFIRMED') {
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['weeklyPlan']);
      }
      if (intent.candidateIds.some((id) => !plan.candidates.some((item) => item.id === id))) {
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['candidateIds']);
      }
      if (existing.packages.some((item) => intent.candidateIds.includes(item.candidateId))) {
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['existingContent']);
      }
      return Object.freeze({
        candidates: plan.candidates.filter((item) => intent.candidateIds.includes(item.id)),
        persona,
        weekKey: intent.weekKey,
      });
    }
    if (intent.kind === 'CONTENT_COPY_VERSION') {
      const workspace = await this.#content.read(intent.weekKey);
      const contentPackages = intent.items.map((ref) => {
        const current = workspace.packages.find((item) => item.id === ref.packageId);
        if (
          current === undefined ||
          current.revision !== ref.expectedRevision ||
          current.versionId !== ref.expectedVersionId
        )
          throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['contentPackage']);
        return current;
      });
      return Object.freeze({ contentPackages: Object.freeze(contentPackages), persona });
    }
    if (intent.kind === 'CONTENT_COVER') {
      const workspace = await this.#content.read(intent.weekKey);
      const current = workspace.packages.find((item) => item.id === intent.packageId);
      if (
        current === undefined ||
        current.revision !== intent.expectedRevision ||
        current.versionId !== intent.expectedVersionId
      )
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['contentPackage']);
      return Object.freeze({ contentPackage: current, persona });
    }
    if (intent.kind !== 'REPLY_SUGGESTION')
      throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED');
    const workspace = await this.#interaction.read();
    const item = workspace.items.find((candidate) => candidate.itemId === intent.itemId);
    if (
      item === undefined ||
      item.revision !== intent.expectedRevision ||
      !['CONFIRMED', 'NEW', 'SUGGESTED'].includes(item.status)
    ) {
      throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['interaction']);
    }
    return Object.freeze({ interaction: item, persona });
  }

  async #persistProviderOutput(
    intent: V2ProviderActionIntent,
    output: unknown,
    modelRunId: string | null,
  ): Promise<void> {
    if (typeof output !== 'object' || output === null || Array.isArray(output)) {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID');
    }
    const value = output as Readonly<Record<string, unknown>>;
    if (intent.kind === 'WEEKLY_PLAN') {
      if (Object.keys(value).length !== 1 || !('candidates' in value))
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidates']);
      this.#facade.applyGeneratedWeeklyPlan(
        intent.weekKey,
        intent.expectedRevision,
        value.candidates,
      );
      return;
    }
    if (intent.kind === 'PLAN_ITEM_REPLACEMENT') {
      if (Object.keys(value).length !== 1 || !('candidate' in value))
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidate']);
      this.#facade.stagePlanItemReplacement(
        intent.weekKey,
        intent.expectedRevision,
        intent.feedbackId,
        value.candidate,
      );
      return;
    }
    if (intent.kind === 'CONTENT_COPY_VERSION') {
      if (modelRunId === null)
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['modelRunId']);
      if (
        Object.keys(value).length !== 1 ||
        !Array.isArray(value.packages) ||
        value.packages.length !== intent.items.length
      )
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
      for (const [index, ref] of intent.items.entries()) {
        await this.#content.appendModelCopy(
          ref.packageId,
          ref.expectedRevision,
          ref.expectedVersionId,
          value.packages[index],
          modelRunId,
        );
      }
      return;
    }
    if (intent.kind === 'CONTENT_COVER') {
      if (modelRunId === null)
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['modelRunId']);
      if (typeof value.base64 !== 'string' || value.mimeType !== 'image/png')
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['cover']);
      await this.#content.appendGeneratedCover(
        intent.packageId,
        intent.expectedRevision,
        intent.expectedVersionId,
        Buffer.from(value.base64, 'base64'),
        modelRunId,
      );
      return;
    }
    if (intent.kind === 'CONTENT_PACKAGES') {
      if (
        Object.keys(value).length !== 1 ||
        !Array.isArray(value.packages) ||
        value.packages.length !== 3
      ) {
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
      }
      let fields;
      try {
        fields = value.packages.map(parseContentPackageFields);
      } catch {
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
      }
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: intent.weekKey,
      }) as WeeklyPlan;
      await this.#content.generateFromFields(
        {
          action: 'GENERATE_CONTENT_PACKAGES',
          candidateIds: intent.candidateIds,
          expectedPlanRevision: intent.expectedPlanRevision,
          idempotencyKey: intent.idempotencyKey,
          weekKey: intent.weekKey,
        },
        plan,
        fields,
      );
      return;
    }
    if (
      intent.kind !== 'REPLY_SUGGESTION' ||
      Object.keys(value).length !== 1 ||
      typeof value.replyText !== 'string'
    ) {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['replyText']);
    }
    await this.#interaction.generateFromReply(
      {
        action: 'GENERATE_REPLY_SUGGESTION',
        expectedRevision: intent.expectedRevision,
        idempotencyKey: intent.idempotencyKey,
        itemId: intent.itemId,
      },
      value.replyText,
      modelRunId,
    );
  }

  #removeExpiredProviderPreviews(): void {
    const now = Date.now();
    for (const [token, lease] of this.#providerPreviews) {
      if (lease.expiresAtMs < now) this.#providerPreviews.delete(token);
    }
    for (const [token, lease] of this.#contentCopyPreviews) {
      if (lease.expiresAtMs < now) this.#contentCopyPreviews.delete(token);
    }
  }
}

function contentCopyFailureMessage(
  status: V2ProviderActionExecutionResult['status'],
  technicalCode: string | null,
): string {
  if (status === 'OUTCOME_UNCERTAIN') {
    return '请求结果不确定，未保存；请核对账本后再决定是否单独重试。';
  }
  if (technicalCode?.startsWith('PROVIDER_UPSTREAM_4XX:HTTP_400') === true) {
    return 'Provider 不接受当前结构化输出参数（HTTP 400），未保存任何内容。';
  }
  if (technicalCode?.startsWith('PROVIDER_INVALID_JSON:CONTENT_JSON') === true) {
    return '模型返回了文本，但文本不是可解析的 JSON，未保存任何内容。';
  }
  if (technicalCode?.startsWith('PROVIDER_INVALID_JSON:ENVELOPE_JSON') === true) {
    return 'Provider 返回的响应不是有效 JSON，未保存任何内容。';
  }
  if (technicalCode?.startsWith('PROVIDER_SCHEMA_VALIDATION_FAILED') === true) {
    return '模型返回的 JSON 缺少或写错了内容字段，未保存任何内容。';
  }
  if (technicalCode?.startsWith('PROVIDER_PROTOCOL_ERROR') === true) {
    return 'Provider 返回了响应，但缺少可读取的文案内容，未保存任何内容。';
  }
  if (technicalCode?.startsWith('PROVIDER_INVALID_CONTENT_TYPE') === true) {
    return 'Provider 返回了不支持的响应格式，未保存任何内容。';
  }
  return '文案请求未完成；请展开技术码查看脱敏原因，其他成功项不受影响。';
}

export function isTrustedV2IpcSender(
  event: IpcMainInvokeEvent,
  expectedRendererUrl: string,
  expectedWindow: BrowserWindow | null,
): boolean {
  const senderFrame = event.senderFrame;
  const owningWindow = BrowserWindow.fromWebContents(event.sender);
  if (
    senderFrame === null ||
    senderFrame !== event.sender.mainFrame ||
    expectedWindow === null ||
    owningWindow !== expectedWindow
  ) {
    return false;
  }
  try {
    const actual = new URL(senderFrame.url);
    const expected = new URL(expectedRendererUrl);
    return (
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      (actual.search === '' ||
        actual.search === '?smoke=1' ||
        /^\?smoke=1&r07BlackboxPort=\d{4,5}&r07BlackboxAttempt=[123]$/u.test(actual.search)) &&
      actual.username === '' &&
      actual.password === ''
    );
  } catch {
    return false;
  }
}

export function registerV2Ipc(options: {
  readonly expectedRendererUrl: string;
  readonly getWindow: () => BrowserWindow | null;
  readonly runtime: V2DesktopRuntime;
}): () => void {
  const caller = (event: IpcMainInvokeEvent): V2ActionCaller => ({
    senderId: event.sender.id,
    windowId: options.getWindow()?.id ?? -1,
  });
  ipcMain.removeHandler(V2_IPC_CHANNELS.read);
  ipcMain.removeHandler(V2_IPC_CHANNELS.mutate);
  const register = (
    channel: string,
    action: (input: unknown, caller: V2ActionCaller) => Promise<unknown>,
  ): void => {
    ipcMain.handle(
      channel,
      async (event, ...args: readonly unknown[]): Promise<V2Result<unknown>> => {
        if (
          args.length !== 1 ||
          !isTrustedV2IpcSender(event, options.expectedRendererUrl, options.getWindow())
        ) {
          return { error: toV2Exception(new V2ContractError('INVALID_REQUEST')), ok: false };
        }
        try {
          return { ok: true, value: await action(args[0], caller(event)) };
        } catch (error) {
          return { error: toV2Exception(error), ok: false };
        }
      },
    );
  };
  register(V2_IPC_CHANNELS.read, (input, requestCaller) =>
    options.runtime.read(input, requestCaller),
  );
  register(V2_IPC_CHANNELS.mutate, (input, requestCaller) =>
    options.runtime.mutate(input, requestCaller),
  );
  return () => {
    ipcMain.removeHandler(V2_IPC_CHANNELS.read);
    ipcMain.removeHandler(V2_IPC_CHANNELS.mutate);
  };
}
