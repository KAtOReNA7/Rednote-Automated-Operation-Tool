import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  LocalApiClientView,
  LocalApiStatusView,
  PairingView,
} from '@mystery-operations/local-api';
import { selectV2StructuredProtocol } from '@mystery-operations/v2';

import {
  MIGRATIONS,
  SqliteModelAccountingRepository,
  type BrowserClipViewV1,
  SqliteProviderCapabilityRepository,
  SqliteSettingsRepository,
  connectDatabase,
  initializeDatabase,
} from '@mystery-operations/db';
import type {
  AuthenticityActionPreview,
  AuthenticityActionResult,
  AuthenticityLibraryView,
  AuthenticityWorkDetail,
  CancelCatalogDiscoveryInput,
  CancelProviderCapabilityProbeInput,
  CatalogActionKind,
  CatalogActionPreview,
  CatalogActionResult,
  CatalogDiscoveryPreview,
  CatalogRunView,
  CatalogSummaryView,
  CatalogWorkDetail,
  CancelSourceProcessingInput,
  CancelDossierBuildInput,
  ConfirmEvidenceConflictInput,
  ConfirmRealResearchIntakeInput,
  ConfirmSyntheticResearchIntakeInput,
  ConfirmSourceProcessingInput,
  ConfirmDossierBuildInput,
  ConfirmCatalogActionInput,
  ConfirmCatalogDiscoveryInput,
  ConfirmModelCacheClearInput,
  ConfirmModelCacheClearResult,
  ConfirmAuthenticityActionInput,
  ConfirmDataRootSelectionInput,
  CreateModelPriceScheduleInput,
  CreateModelUnitPolicyInput,
  DataRootSelection,
  GetCatalogStateInput,
  GetAuthenticityLibraryInput,
  GetAuthenticityWorkInput,
  GetEvidenceStateInput,
  GetDossierInput,
  ListDossiersInput,
  PreviewCatalogDiscoveryInput,
  PreviewAuthenticityActionInput,
  PreviewCatalogUndoInput,
  PreviewCatalogWorkMergeInput,
  PreviewCatalogWorkSplitInput,
  PreviewEvidenceConflictInput,
  PreviewRealResearchIntakeInput,
  PreviewSyntheticResearchIntakeInput,
  PreviewSourceProcessingInput,
  PreviewDossierBuildInput,
  PreviewProviderCapabilityProbeInput,
  ProviderCapabilityProbePreview,
  ProviderCapabilityProbeProgressView,
  ProviderCapabilityStateView,
  ModelAccountingView,
  ModelCacheClearPreview,
  ModelPriceScheduleView,
  ModelUnitPolicyView,
  FetchStateView,
  SearchStateView,
  EvidenceConflictActionPreview,
  EvidenceConflictView,
  EvidenceStateView,
  SourceProcessingPreview,
  RealResearchIntakePreview,
  RealResearchIntakeResult,
  SyntheticResearchIntakePreview,
  SyntheticResearchIntakeResult,
  DiffDossierVersionsInput,
  DossierBuildPreview,
  DossierBuildRun,
  DossierDetailStateView,
  DossierListStateView,
  DossierVersionDiffView,
  SetupStateView,
  StartProviderCapabilityProbeInput,
  UpdateSearchProviderConfigInput,
  UpdateFetchPolicyInput,
  ConfirmTopicActionInput,
  GetTopicInput,
  GetTopicPoolInput,
  PreviewTopicActionInput,
  TopicActionPreview,
  TopicActionResult,
  TopicDetailView,
  TopicPoolWorkspaceView,
  ConfirmExperimentActionInput,
  ExperimentActionPreview,
  ExperimentActionResult,
  ExperimentDetailView,
  ExperimentListView,
  GetExperimentInput,
  GetExperimentsInput,
  PreviewExperimentActionInput,
  BriefActionPreview,
  BriefActionResult,
  BriefDetailView,
  BriefListView,
  ConfirmBriefActionInput,
  GetBriefInput,
  GetBriefsInput,
  PreviewBriefActionInput,
  ConfirmCopyActionInput,
  CopyActionPreview,
  CopyActionResult,
  CopyDraftDetailView,
  CopyDraftListView,
  CopyDraftVersionDiffView,
  DiffCopyDraftVersionsInput,
  GetCopyDraftInput,
  GetCopyDraftsInput,
  PreviewCopyActionInput,
  ConfirmCopyIntegrityInput,
  CopyIntegrityPreview,
  CopyIntegrityResult,
  PreviewCopyIntegrityInput,
  ConfirmFactMappingActionInput,
  ConfirmFactMappingDecisionInput,
  ConfirmReadingAuthenticityInput,
  FactMappingActionPreview,
  FactMappingActionResult,
  FactMappingClaimChainView,
  FactMappingDetailView,
  FactMappingDecisionPreview,
  FactMappingDecisionResult,
  FactMappingListView,
  GetFactMappingCheckInput,
  GetFactMappingChecksInput,
  GetFactMappingClaimChainInput,
  PreviewFactMappingActionInput,
  PreviewFactMappingDecisionInput,
  PreviewReadingAuthenticityInput,
  ReadingAuthenticityPreview,
  ReadingAuthenticityResult,
  ConfirmSpoilerQualityInput,
  PreviewSpoilerQualityInput,
  SpoilerQualityPreview,
  SpoilerQualityResult,
} from '@mystery-operations/shared';
import {
  CREDENTIAL_SLOT,
  type CredentialStatusView,
  type DiagnosticExport,
  type DiagnosticPreview,
  type NonSecretSettingsDraft,
  type ProjectLocatorState,
  type SettingsBundle,
  SettingsError,
  SettingsService,
} from '@mystery-operations/settings';
import {
  DATA_ROOT_FORMAT_VERSION,
  LocalDiagnosticReportStore,
  LocalProjectLocator,
  ModelResultCacheStore,
  initializeProjectDataRoot,
  openProjectDataRoot,
  type ProjectDataRoot,
} from '@mystery-operations/storage';

import { type AsyncSafeStorage, ElectronCredentialStore } from './credential-store.js';
import { DataRootSelectionBroker, type DirectoryDialog } from './data-root-selection.js';
import { DesktopLocalApiRuntime } from './local-api-runtime.js';
import { DesktopModelAccountingRuntime } from './model-accounting-runtime.js';
import {
  ProviderCapabilityControlError,
  ProviderCapabilityRuntime,
} from './provider-capability-runtime.js';
import { DesktopSearchRuntime } from './search-runtime.js';
import { DesktopFetchRuntime } from './fetch-runtime.js';
import { DesktopBrowserClipRuntime } from './browser-clip-runtime.js';
import { DesktopCatalogRuntime } from './catalog-runtime.js';
import { DesktopEvidenceRuntime } from './evidence-runtime.js';
import { DesktopDossierRuntime } from './dossier-runtime.js';
import { DesktopAuthenticityRuntime } from './authenticity-runtime.js';
import { DesktopTopicRuntime } from './topic-runtime.js';
import { DesktopExperimentRuntime } from './experiment-runtime.js';
import { DesktopBriefRuntime } from './brief-runtime.js';
import { DesktopCopyRuntime } from './copy-runtime.js';
import { DesktopFactMappingRuntime } from './fact-mapping-runtime.js';
import { DesktopReadingAuthenticityRuntime } from './reading-authenticity-runtime.js';
import { DesktopSpoilerQualityRuntime } from './spoiler-quality-runtime.js';
import { V2ProviderRuntime } from './v2-provider-runtime.js';
import type {
  V2CapabilityProbePreview,
  V2CapabilityProbeProgress,
  V2CapabilityProbeStepDiagnostic,
  V2CapabilityProbeSummaryState,
  V2ProviderActionExecutionRequest,
  V2ProviderActionExecutionResult,
  V2ProviderActionReadiness,
  V2ProviderSettingsDraft,
  V2ProviderSettingsView,
} from '@mystery-operations/v2';
import {
  disabledLocalApiSmoke,
  type LocalApiSmokeReport,
  runEnabledLocalApiSmoke,
} from './local-api-smoke.js';

const PROJECT_DATABASE_FILE = 'rednote.sqlite';
const SECRET_EGRESS_TARGET_COUNT = 50;
const V2_R07_PROBE_SELECTION = Object.freeze({
  includeToolCalling: false,
  profile: 'CUSTOM' as const,
  selectedCapabilities: Object.freeze(['structuredJson', 'imageGeneration'] as const),
  structuredProtocolModes: Object.freeze(['RESPONSES', 'CHAT_COMPLETIONS'] as const),
  targetModelSlots: Object.freeze(['RESEARCH', 'WRITING', 'IMAGE'] as const),
});

function v2ProbeDiagnosticCode(
  entry: ProviderCapabilityStateView['entries'][number] | undefined,
  fallback: string,
): string {
  if (entry === undefined) return fallback;
  if (entry.safeDetails.modelIdMismatch === 1) return 'MODEL_ID_MISMATCH';
  if (entry.safeDetails.modelNotFound === 1) return 'MODEL_NOT_FOUND';
  if (entry.safeDetails.endpointNotFound === 1) return 'ENDPOINT_OR_ROUTE_NOT_FOUND';
  return entry.reasonCode;
}

function v2ProbeReason(
  code: string,
  sent: boolean,
  details?: {
    readonly errorCode?: string;
    readonly errorParam?: string;
    readonly errorType?: string;
    readonly status?: number;
  },
): string {
  if (!sent)
    return code === 'CONFIG_STALE' ? '配置在探测期间发生变化，该步骤未发送。' : '该步骤未发送。';
  const reasons: Readonly<Record<string, string>> = Object.freeze({
    ABORTED: '用户取消了本次能力检查。',
    AMBIGUOUS_OUTCOME: '请求已结束，但返回证据不足，能力保持未知。',
    AUTHENTICATION_REJECTED: '凭据无效或被 Provider 拒绝（HTTP 401）。',
    CONFIG_STALE: '配置在探测期间发生变化，结果未继续采用。',
    ENDPOINT_EXPLICITLY_UNSUPPORTED: 'Provider 明确表示该能力或 endpoint 不受支持。',
    ENDPOINT_OR_ROUTE_NOT_FOUND: '请求路由不存在或当前协议与 endpoint 不兼容（HTTP 404）。',
    INTERNAL_ERROR: '探测计划发生本地内部错误，未确认能力。',
    INVALID_CONTENT_TYPE: '返回内容类型不符合协议，能力保持未知。',
    INVALID_JSON: '返回内容不是有效 JSON，能力保持未知。',
    INVALID_RESPONSE: '返回格式不符合能力证据合同，能力保持未知。',
    MODEL_EXPLICITLY_UNSUPPORTED: 'Provider 明确表示该模型不支持所需能力。',
    MODEL_ID_MISMATCH: '响应中的模型身份与配置模型不一致，结果未采用。',
    MODEL_NOT_FOUND: '配置的模型 ID 不存在或当前不可用（HTTP 404）。',
    NETWORK_UNREACHABLE: '网络连接失败，未获得能力证据。',
    NOT_PROBED: '请求获得了符合强证据合同的明确结果。',
    OUTPUT_VARIANT_UNSUPPORTED: '图片仅返回 URL，未提供允许的 inline 图片证据。',
    PERMISSION_REJECTED: '凭据没有访问该能力的权限（HTTP 403）。',
    PROTOCOL_EXPLICITLY_UNSUPPORTED: 'Provider 明确表示当前协议不受支持。',
    RATE_LIMITED: 'Provider 限流（HTTP 429），能力保持未知。',
    SCHEMA_MISMATCH: '结构化输出未满足固定 Schema 证据，能力保持未知。',
    TIMEOUT: '请求超时，能力保持未知。',
    TLS_FAILURE: 'TLS 连接或证书校验失败，能力保持未知。',
  });
  if (code === 'AMBIGUOUS_OUTCOME' && details?.status === 400) {
    const fields = [
      details.errorCode === undefined ? null : `code=${details.errorCode}`,
      details.errorType === undefined ? null : `type=${details.errorType}`,
      details.errorParam === undefined ? null : `param=${details.errorParam}`,
    ].filter((value): value is string => value !== null);
    return `Provider 拒绝了请求参数（HTTP 400）${fields.length === 0 ? '' : `：${fields.join('，')}`}；能力保持未知。`;
  }
  return reasons[code] ?? '请求已结束，但没有足够的允许证据确认能力。';
}

function v2ProbeSlot(slot: 'IMAGE' | 'RESEARCH' | 'WRITING'): 'image' | 'research' | 'writing' {
  return slot === 'IMAGE' ? 'image' : slot === 'RESEARCH' ? 'research' : 'writing';
}

function containsPlaintext(directory: string, plaintext: Buffer): boolean {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) {
      continue;
    }
    if (status.isDirectory()) {
      if (containsPlaintext(path, plaintext)) {
        return true;
      }
    } else if (status.isFile() && readFileSync(path).indexOf(plaintext) !== -1) {
      return true;
    }
  }
  return false;
}

interface RuntimeVersions {
  readonly appVersion: string;
  readonly chromiumVersion: string;
  readonly electronVersion: string;
  readonly nodeVersion: string;
}

interface ActiveProject {
  readonly accounting: DesktopModelAccountingRuntime;
  readonly authenticity: DesktopAuthenticityRuntime;
  readonly briefs: DesktopBriefRuntime;
  readonly copy: DesktopCopyRuntime;
  readonly factMapping: DesktopFactMappingRuntime;
  readonly readingAuthenticity: DesktopReadingAuthenticityRuntime;
  readonly spoilerQuality: DesktopSpoilerQualityRuntime;
  readonly catalog: DesktopCatalogRuntime;
  readonly evidence: DesktopEvidenceRuntime;
  readonly experiments: DesktopExperimentRuntime;
  readonly dossier: DesktopDossierRuntime;
  readonly capabilities: ProviderCapabilityRuntime;
  readonly clipper: DesktopBrowserClipRuntime;
  readonly database: DatabaseSync;
  readonly fetch: DesktopFetchRuntime;
  readonly root: ProjectDataRoot;
  readonly search: DesktopSearchRuntime;
  readonly service: SettingsService;
  readonly topics: DesktopTopicRuntime;
  readonly v2Provider: V2ProviderRuntime;
}

export class DesktopSettingsRuntime {
  readonly #credentials: ElectronCredentialStore;
  readonly #locator: LocalProjectLocator;
  readonly #localApi = new DesktopLocalApiRuntime();
  readonly #safeStorage: AsyncSafeStorage;
  readonly #selectionBroker: DataRootSelectionBroker;
  readonly #userDataPath: string;
  readonly #versions: RuntimeVersions;
  #active: ActiveProject | null = null;
  #locatorState: ProjectLocatorState = { status: 'NOT_CONFIGURED' };
  #safeStorageAvailable = false;

  public constructor(
    userDataPath: string,
    safeStorage: AsyncSafeStorage,
    dialog: DirectoryDialog,
    versions: RuntimeVersions,
  ) {
    this.#credentials = new ElectronCredentialStore(userDataPath, safeStorage);
    this.#safeStorage = safeStorage;
    this.#locator = new LocalProjectLocator(userDataPath);
    this.#selectionBroker = new DataRootSelectionBroker(dialog);
    this.#userDataPath = userDataPath;
    this.#versions = versions;
  }

  public async initialize(): Promise<void> {
    this.#safeStorageAvailable = await this.#safeStorage.isAsyncEncryptionAvailable();
    this.#locatorState = await this.#locator.read();
    if (this.#locatorState.status !== 'READY') {
      return;
    }
    const root = await openProjectDataRoot(this.#locatorState.record.activeDataRoot);
    this.#active = await this.#openActiveProject(root);
    await this.#localApi.attachProject(this.#active.database, this.#active.clipper);
  }

  public async ensureV2Project(rootPath: string): Promise<void> {
    if (this.#active !== null) return;
    const root = await initializeProjectDataRoot(rootPath);
    const prepared = await this.#openActiveProject(root);
    try {
      const record = await this.#locator.activate(
        {
          databasePath: join(root.databaseDirectory, PROJECT_DATABASE_FILE),
          displayPath: root.rootPath,
          instanceId: root.marker.instanceId,
          rootPath: root.rootPath,
        },
        null,
        new Date().toISOString(),
      );
      await this.#localApi.attachProject(prepared.database, prepared.clipper);
      this.#active = prepared;
      this.#locatorState = {
        displayPath: root.rootPath,
        record,
        status: 'READY',
      };
    } catch (error) {
      prepared.database.close();
      throw error;
    }
  }

  public async executeV2ProviderAction(
    request: V2ProviderActionExecutionRequest,
  ): Promise<V2ProviderActionExecutionResult> {
    if (this.#active === null) {
      return {
        costAmountMicroUsd: null,
        costState: 'NOT_INCURRED',
        externalRequestCount: 0,
        outcomeCertainty: 'NOT_SENT',
        output: null,
        stableErrorCode: 'SETUP_NOT_INITIALIZED',
        status: 'BLOCKED',
        modelRunId: null,
      };
    }
    return this.#active.v2Provider.execute(request);
  }

  public async inspectV2ProviderAction(
    request: Omit<V2ProviderActionExecutionRequest, 'executionId'>,
  ): Promise<V2ProviderActionReadiness> {
    if (this.#active === null) {
      return {
        blockReasons: ['本地设置项目尚未就绪。'],
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
        readinessBinding: 'settings-unavailable',
        reasonCode: 'PROVIDER_NOT_CONFIGURED',
        reasonMessage: '本地设置项目尚未就绪。',
        unknownCostApproved: request.userApprovedUnknownCost === true,
      };
    }
    return this.#active.v2Provider.inspect(request);
  }

  public async getV2ProviderSettings(): Promise<V2ProviderSettingsView> {
    const active = this.#requireActive();
    const bundle = await active.service.getSettings();
    const capability = active.capabilities.getState();
    const accounting = active.accounting.getView();
    const [weekly, content, reply] = await Promise.all([
      active.v2Provider.inspect({
        input: {},
        kind: 'WEEKLY_PLAN',
        modelSlot: 'research',
        userApprovedUnknownCost: false,
      }),
      active.v2Provider.inspect({
        input: {},
        kind: 'CONTENT_PACKAGES',
        modelSlot: 'writing',
        userApprovedUnknownCost: false,
      }),
      active.v2Provider.inspect({
        input: {},
        kind: 'REPLY_SUGGESTION',
        modelSlot: 'writing',
        userApprovedUnknownCost: false,
      }),
    ]);
    const credentialState = bundle.credential.requiresReauth
      ? ('REAUTH_REQUIRED' as const)
      : bundle.credential.available
        ? ('CONFIGURED' as const)
        : ('NOT_CONFIGURED' as const);
    const latestRun =
      capability.runId === null
        ? null
        : (capability.history.find((candidate) => candidate.runId === capability.runId) ?? null);
    let planSteps: readonly {
      readonly capability: 'imageGeneration' | 'structuredJson';
      readonly modelId: string;
      readonly modelSlots: readonly ('IMAGE' | 'RESEARCH' | 'WRITING')[];
      readonly protocolMode: 'CHAT_COMPLETIONS' | 'NOT_APPLICABLE' | 'RESPONSES';
    }[];
    try {
      planSteps = active.capabilities.describePlan(V2_R07_PROBE_SELECTION).steps.filter(
        (
          candidate,
        ): candidate is typeof candidate & {
          readonly capability: 'imageGeneration' | 'structuredJson';
          readonly modelId: string;
          readonly modelSlots: readonly ('IMAGE' | 'RESEARCH' | 'WRITING')[];
          readonly protocolMode: 'CHAT_COMPLETIONS' | 'NOT_APPLICABLE' | 'RESPONSES';
        } =>
          candidate.modelId !== null &&
          (candidate.capability === 'structuredJson' || candidate.capability === 'imageGeneration'),
      );
    } catch {
      planSteps = [];
    }
    const relevantEntries = capability.entries.filter(
      (entry) =>
        (entry.capability === 'structuredJson' &&
          (entry.modelSlot === 'RESEARCH' || entry.modelSlot === 'WRITING')) ||
        (entry.capability === 'imageGeneration' && entry.modelSlot === 'IMAGE'),
    );
    if (capability.derivedState === 'STALE' && relevantEntries.length > 0) {
      const grouped = new Map<string, (typeof planSteps)[number]>();
      for (const entry of relevantEntries) {
        if (entry.modelId === null) continue;
        const key = `${entry.modelId}\0${entry.protocolMode}\0${entry.capability}`;
        const existing = grouped.get(key);
        const modelSlot = entry.modelSlot as 'IMAGE' | 'RESEARCH' | 'WRITING';
        grouped.set(key, {
          capability: entry.capability as 'imageGeneration' | 'structuredJson',
          modelId: entry.modelId,
          modelSlots: Object.freeze([...(existing?.modelSlots ?? []), modelSlot]),
          protocolMode: entry.protocolMode as 'CHAT_COMPLETIONS' | 'NOT_APPLICABLE' | 'RESPONSES',
        });
      }
      planSteps = Object.freeze([...grouped.values()]);
    }
    const sentRequestCount =
      capability.activeRun?.sentRequestCount ?? latestRun?.sentRequestCount ?? 0;
    const diagnosticEntries = capability.activeRun === null ? relevantEntries : [];
    const steps: readonly V2CapabilityProbeStepDiagnostic[] = Object.freeze(
      planSteps.map((planned, index) => {
        const matches = diagnosticEntries.filter(
          (entry) =>
            entry.modelId === planned.modelId &&
            entry.capability === planned.capability &&
            entry.protocolMode === planned.protocolMode &&
            planned.modelSlots.includes(entry.modelSlot as 'IMAGE' | 'RESEARCH' | 'WRITING'),
        );
        const primary = matches.find((entry) => entry.source !== 'NOT_PROBED') ?? matches[0];
        const sent = primary?.source !== 'NOT_PROBED' || index < sentRequestCount;
        const fullyMapped = planned.modelSlots.every((modelSlot) =>
          matches.some((entry) => entry.modelSlot === modelSlot),
        );
        const state =
          fullyMapped && matches.every((entry) => entry.state === primary?.state)
            ? (primary?.state ?? 'UNKNOWN')
            : ('UNKNOWN' as const);
        const fallbackCode = sent
          ? (latestRun?.reasonCode ?? 'AMBIGUOUS_OUTCOME')
          : (latestRun?.reasonCode ?? 'NOT_PROBED');
        const diagnosticCode = v2ProbeDiagnosticCode(primary, fallbackCode);
        return Object.freeze({
          capability: planned.capability,
          deduplicated: planned.modelSlots.length > 1,
          diagnosticCode,
          errorCode: primary?.safeDetails.errorCode ?? null,
          errorParam: primary?.safeDetails.errorParam ?? null,
          errorType: primary?.safeDetails.errorType ?? null,
          httpStatus: primary?.safeDetails.status ?? null,
          mappedSlots: Object.freeze(planned.modelSlots.map(v2ProbeSlot)),
          modelId: planned.modelId,
          observedAt: primary?.observedAt ?? null,
          protocolMode: planned.protocolMode,
          receivedContentType: primary?.safeDetails.receivedContentType ?? null,
          reason: v2ProbeReason(diagnosticCode, sent, primary?.safeDetails),
          requestId: primary?.safeDetails.requestId ?? null,
          sent,
          stale: matches.some((entry) => entry.stale) || capability.derivedState === 'STALE',
          state,
          transportVariant: primary?.safeDetails.transportVariant ?? null,
        });
      }),
    );
    const confirmedCount = steps.filter((step) => step.state !== 'UNKNOWN').length;
    const summaryState: V2CapabilityProbeSummaryState =
      capability.activeRun?.status === 'RUNNING'
        ? 'RUNNING'
        : latestRun === null
          ? 'NOT_RUN'
          : capability.derivedState === 'STALE'
            ? 'STALE'
            : latestRun.status === 'FAILED' || latestRun.status === 'INTERRUPTED'
              ? 'FAILED'
              : latestRun.status === 'CANCELLED'
                ? 'CANCELLED'
                : confirmedCount === steps.length && steps.length > 0
                  ? 'COMPLETE'
                  : confirmedCount > 0
                    ? 'PARTIAL'
                    : 'NONE_CONFIRMED';
    const runDiagnostic =
      latestRun === null
        ? null
        : Object.freeze({
            completedAt: latestRun.completedAt,
            completedRequestCount: latestRun.sentRequestCount,
            costState: 'UNKNOWN' as const,
            fetchEnabled: false as const,
            plannedRequestCount: latestRun.plannedRequestCount,
            runId: latestRun.runId,
            searchEnabled: false as const,
            sentRequestCount: latestRun.sentRequestCount,
            startedAt: latestRun.startedAt,
            status: latestRun.status,
          });
    const diagnosticText =
      runDiagnostic === null
        ? ''
        : [
            `run=${runDiagnostic.runId} status=${summaryState}`,
            `time=${runDiagnostic.startedAt}..${runDiagnostic.completedAt ?? '未结束'}`,
            `requests=${runDiagnostic.plannedRequestCount}/${runDiagnostic.sentRequestCount}/${runDiagnostic.completedRequestCount}`,
            'Search=关闭 Fetch=关闭 fee=UNKNOWN',
            ...steps.map(
              (step) =>
                `${step.mappedSlots.join('+')} model=${step.modelId} capability=${step.capability} protocol=${step.protocolMode} state=${step.state} code=${step.diagnosticCode} sent=${step.sent ? 'yes' : 'no'} stale=${step.stale ? 'yes' : 'no'} observedAt=${step.observedAt ?? '无'} receivedContentType=${step.receivedContentType ?? 'MISSING'} transportVariant=${step.transportVariant ?? 'REJECTED'}${step.httpStatus === null ? '' : ` responseStatus=${step.httpStatus}`}${step.errorCode == null ? '' : ` error.code=${step.errorCode}`}${step.errorType == null ? '' : ` error.type=${step.errorType}`}${step.errorParam == null ? '' : ` error.param=${step.errorParam}`}${step.requestId == null ? '' : ` requestId=${step.requestId}`} reason=${step.reason}`,
            ),
          ].join('\n');
    const slot = (
      modelSlot: 'IMAGE' | 'RESEARCH' | 'WRITING',
      modelId: string | null,
      capabilityName: 'imageGeneration' | 'structuredJson' = 'structuredJson',
    ) => {
      const entries = capability.entries.filter(
        (candidate) =>
          candidate.capability === capabilityName &&
          candidate.modelSlot === modelSlot &&
          candidate.modelId === modelId,
      );
      if (capabilityName === 'structuredJson') {
        const selected = selectV2StructuredProtocol(
          entries
            .filter(
              (candidate) =>
                candidate.protocolMode === 'RESPONSES' ||
                candidate.protocolMode === 'CHAT_COMPLETIONS',
            )
            .map((candidate) => ({
              protocolMode: candidate.protocolMode as 'CHAT_COMPLETIONS' | 'RESPONSES',
              stale: candidate.stale,
              state: candidate.state,
            })),
        );
        return { modelId, protocolMode: selected.protocolMode, state: selected.state };
      }
      const currentEntries = entries.filter((candidate) => !candidate.stale);
      const supported =
        currentEntries.find(
          (candidate) => candidate.state === 'SUPPORTED' && candidate.protocolMode === 'RESPONSES',
        ) ??
        currentEntries.find(
          (candidate) =>
            candidate.state === 'SUPPORTED' && candidate.protocolMode === 'CHAT_COMPLETIONS',
        ) ??
        currentEntries.find((candidate) => candidate.state === 'SUPPORTED');
      const state =
        supported !== undefined
          ? ('SUPPORTED' as const)
          : currentEntries.length > 0 &&
              currentEntries.every((candidate) => candidate.state === 'UNSUPPORTED')
            ? ('UNSUPPORTED' as const)
            : ('UNKNOWN' as const);
      return {
        modelId,
        protocolMode:
          supported?.protocolMode === 'RESPONSES' || supported?.protocolMode === 'CHAT_COMPLETIONS'
            ? supported.protocolMode
            : supported?.protocolMode === 'NOT_APPLICABLE' && capabilityName === 'imageGeneration'
              ? ('IMAGES_GENERATIONS' as const)
              : null,
        state:
          currentEntries.length === 0 && (entries.length > 0 || capability.derivedState === 'STALE')
            ? ('STALE' as const)
            : state,
      };
    };
    return Object.freeze({
      accounting: Object.freeze({
        hardLimitMicroUsd: accounting.hardLimitMicroUsd,
        hardStop: accounting.hardStop,
        priceReadyForContent: content.feeEstimateMicroUsd !== null,
        priceReadyForReply: reply.feeEstimateMicroUsd !== null,
        priceReadyForWeeklyPlan: weekly.feeEstimateMicroUsd !== null,
        warning: accounting.warning,
      }),
      capabilityProbe: Object.freeze({
        activeRun: capability.activeRun,
        diagnosticText,
        derivedState: capability.derivedState,
        latestRun: runDiagnostic,
        steps,
        summaryState,
      }),
      credentialState,
      providerBaseUrl: bundle.settings.providerBaseUrl,
      providerConfigured:
        bundle.settings.providerBaseUrl !== null &&
        bundle.settings.researchModelId !== null &&
        bundle.settings.writingModelId !== null &&
        bundle.settings.imageModelId !== null,
      research: Object.freeze(slot('RESEARCH', bundle.settings.researchModelId)),
      revision: bundle.settings.revision,
      setupAvailable: true,
      writing: Object.freeze(slot('WRITING', bundle.settings.writingModelId)),
      image: Object.freeze(slot('IMAGE', bundle.settings.imageModelId, 'imageGeneration')),
    });
  }

  public async updateV2ProviderSettings(
    input: V2ProviderSettingsDraft,
  ): Promise<V2ProviderSettingsView> {
    const active = this.#requireActive();
    const current = await active.service.getSettings();
    await active.service.updateNonSecretSettings({
      account: { bio: current.account.bio, workingName: current.account.workingName },
      budget: {
        hardLimitDollars: (current.settings.monthlyHardLimitCents / 100).toFixed(2),
        warningDollars: (current.settings.monthlyWarningCents / 100).toFixed(2),
      },
      expectedRevision: input.expectedRevision,
      models: {
        embedding: current.settings.embeddingModelId,
        image: input.imageModelId,
        research: input.researchModelId,
        review: current.settings.reviewModelId,
        writing: input.writingModelId,
      },
      providerBaseUrl: input.providerBaseUrl,
    });
    return this.getV2ProviderSettings();
  }

  public async setV2ProviderCredential(plaintext: string): Promise<V2ProviderSettingsView> {
    await this.#requireActive().service.setCredential(plaintext);
    return this.getV2ProviderSettings();
  }

  public async clearV2ProviderCredential(): Promise<V2ProviderSettingsView> {
    await this.#requireActive().service.clearCredential('DELETE_CONTENT_AI_API_KEY');
    return this.getV2ProviderSettings();
  }

  public previewV2ProviderCapabilityProbe(
    senderId: number,
    windowId: number,
  ): V2CapabilityProbePreview {
    const active = this.#requireActive();
    const preview = active.capabilities.preview(V2_R07_PROBE_SELECTION, senderId, windowId);
    if (preview.requestCount > 3) {
      throw new ProviderCapabilityControlError('PROBE_INVALID_REQUEST');
    }
    const accounting = active.accounting.getView();
    return {
      budgetReady: !accounting.hardStop,
      credentialBindingVersion: preview.credentialBindingVersion,
      expiresAt: preview.expiresAt,
      feeEstimate: preview.feeEstimate,
      planHash: preview.planHash,
      requestCount: preview.requestCount,
      fetchEnabled: false,
      searchEnabled: false,
      settingsRevision: preview.settingsRevision,
      startToken: preview.startToken,
      modelIds: Object.freeze([
        ...new Set(
          Object.values(
            active.database
              .prepare(
                "SELECT research_model_id, writing_model_id, image_model_id FROM app_settings WHERE id='app'",
              )
              .get() as Record<string, string | null>,
          ).filter((value): value is string => value !== null),
        ),
      ]),
      userApprovedUnknownCost: false,
    };
  }

  public async startV2ProviderCapabilityProbe(
    input: {
      readonly confirmation: 'START_PROVIDER_CAPABILITY_PROBE';
      readonly credentialBindingVersion: number;
      readonly planHash: string;
      readonly settingsRevision: number;
      readonly startToken: string;
      readonly userApprovedUnknownCost: boolean;
    },
    senderId: number,
    windowId: number,
  ): Promise<V2CapabilityProbeProgress> {
    const active = this.#requireActive();
    if (active.accounting.getView().hardStop) {
      throw new ProviderCapabilityControlError('BUDGET_UNPRICED_LIMIT_REQUIRED');
    }
    return active.capabilities.start(input, senderId, windowId, input.userApprovedUnknownCost);
  }

  public getV2ProviderCapabilityProbeProgress(runId: string): V2CapabilityProbeProgress {
    return this.#requireActive().capabilities.getProgress(runId);
  }

  public async runIsolatedSmoke(
    rootPath: string,
    unusableRuntimeValue: string,
    localApi: {
      readonly mode: 'disabled' | 'enabled';
      readonly port: number;
      readonly windowId: number;
    },
    capability: {
      readonly port: number;
      readonly windowId: number;
    },
  ): Promise<{
    readonly capability: {
      readonly matrixComplete: boolean;
      readonly plannedRequestCount: number;
      readonly sentRequestCount: number;
      readonly startupAutoRequestCount: 0;
      readonly status: 'SUCCEEDED';
    };
    readonly credentialCleared: boolean;
    readonly credentialRoundtrip: boolean;
    readonly locator: boolean;
    readonly localApi: LocalApiSmokeReport;
    readonly safeStorage: boolean;
    readonly secretEgressSafeCount: number;
    readonly settings: boolean;
  }> {
    if (!this.#safeStorageAvailable) {
      throw new SettingsError('CREDENTIAL_STORE_UNAVAILABLE');
    }
    let smokePhase = 'INITIALIZE_ROOT';
    try {
      const root = await initializeProjectDataRoot(rootPath);
      smokePhase = 'OPEN_PROJECT';
      const prepared = await this.#openActiveProject(root);
      smokePhase = 'ACTIVATE_LOCATOR';
      const record = await this.#locator.activate(
        {
          databasePath: join(root.databaseDirectory, PROJECT_DATABASE_FILE),
          displayPath: root.rootPath,
          instanceId: root.marker.instanceId,
          rootPath: root.rootPath,
        },
        null,
        new Date().toISOString(),
      );
      this.#active = prepared;
      await this.#localApi.attachProject(prepared.database, prepared.clipper);
      this.#locatorState = { displayPath: root.rootPath, record, status: 'READY' };
      smokePhase = 'SET_CREDENTIAL';
      const configured = await prepared.service.setCredential(unusableRuntimeValue);
      smokePhase = 'RESOLVE_CREDENTIAL';
      const resolved = await this.#credentials.resolveForProvider(CREDENTIAL_SLOT);
      const credentialRoundtrip =
        configured.status === 'CONFIGURED' && resolved === unusableRuntimeValue;
      smokePhase = 'CONFIGURE_CAPABILITY_FIXTURE';
      const current = await prepared.service.getSettings();
      const configuredSettings = await prepared.service.updateNonSecretSettings({
        account: {
          bio: current.account.bio,
          workingName: current.account.workingName,
        },
        budget: {
          hardLimitDollars: (current.settings.monthlyHardLimitCents / 100).toFixed(2),
          warningDollars: (current.settings.monthlyWarningCents / 100).toFixed(2),
        },
        expectedRevision: current.settings.revision,
        models: {
          embedding: current.settings.embeddingModelId,
          image: 'issue013-smoke-model',
          research: 'issue013-smoke-model',
          review: 'issue013-smoke-model',
          writing: 'issue013-smoke-model',
        },
        providerBaseUrl: `http://127.0.0.1:${capability.port}/v1`,
      });
      prepared.accounting.createUnitPolicy({
        expectedSettingsRevision: configuredSettings.settings.revision,
        maxExternalCallsMonthly: 32,
        maxExternalCallsWeekly: 32,
        maxImageGenerationCalls: 8,
        maxImages: 8,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxToolCalls: 8,
        maxWebSearchCalls: 8,
        scopeKind: 'GLOBAL',
        scopeValue: null,
      });
      smokePhase = 'PREVIEW_CAPABILITY_PROBE';
      const capabilityPreview = prepared.capabilities.preview(
        { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
        capability.windowId,
        capability.windowId,
      );
      smokePhase = 'RUN_CAPABILITY_PROBE';
      const capabilityStarted = await prepared.capabilities.start(
        {
          confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
          credentialBindingVersion: capabilityPreview.credentialBindingVersion,
          planHash: capabilityPreview.planHash,
          settingsRevision: capabilityPreview.settingsRevision,
          startToken: capabilityPreview.startToken,
        },
        capability.windowId,
        capability.windowId,
      );
      let capabilityProgress = capabilityStarted;
      for (
        let attempt = 0;
        attempt < 500 && capabilityProgress.status === 'RUNNING';
        attempt += 1
      ) {
        await new Promise<void>((resolveDelay) => {
          setTimeout(resolveDelay, 10);
        });
        capabilityProgress = prepared.capabilities.getProgress(capabilityStarted.runId);
      }
      if (capabilityProgress.status !== 'SUCCEEDED') {
        throw new SettingsError('SETTINGS_INVALID');
      }
      const capabilityState = prepared.capabilities.getState();
      smokePhase = 'EXPORT_DIAGNOSTIC';
      const preview = await prepared.service.buildDiagnosticPreview();
      await prepared.service.exportDiagnosticReport(preview.hash);
      const encodedValue = Buffer.from(unusableRuntimeValue, 'utf8');
      smokePhase = 'CHECK_SECRET_EGRESS_USER_DATA';
      const userDataSafe = !containsPlaintext(
        join(this.#userDataPath, 'local-settings'),
        encodedValue,
      );
      smokePhase = 'CHECK_SECRET_EGRESS_PROJECT';
      const projectSafe = !containsPlaintext(root.rootPath, encodedValue);
      const secretEgressSafeCount = userDataSafe && projectSafe ? SECRET_EGRESS_TARGET_COUNT : 0;
      if (secretEgressSafeCount !== SECRET_EGRESS_TARGET_COUNT) {
        throw new SettingsError('CREDENTIAL_CORRUPT');
      }
      smokePhase = 'CLEAR_CREDENTIAL';
      const cleared = await prepared.service.clearCredential('DELETE_CONTENT_AI_API_KEY');
      smokePhase = 'LOCAL_API_RUNTIME';
      const localApiReport =
        localApi.mode === 'enabled'
          ? await runEnabledLocalApiSmoke(this, localApi.port, localApi.windowId)
          : disabledLocalApiSmoke(this);
      return {
        capability: {
          matrixComplete: capabilityState.derivedState === 'PROBE_COMPLETE',
          plannedRequestCount: capabilityProgress.plannedRequestCount,
          sentRequestCount: capabilityProgress.sentRequestCount,
          startupAutoRequestCount: 0,
          status: 'SUCCEEDED',
        },
        credentialCleared: cleared.status === 'NOT_CONFIGURED',
        credentialRoundtrip,
        locator: (await this.#locator.read()).status === 'READY',
        localApi: localApiReport,
        safeStorage: true,
        secretEgressSafeCount,
        settings: (await prepared.service.getSettings()).settings.revision >= 2,
      };
    } catch (error) {
      const systemCode =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'NONE';
      throw new SettingsError(error instanceof SettingsError ? error.code : 'SETTINGS_INVALID', {
        cause: error,
        context: { smokePhase, systemCode },
      });
    }
  }

  public async getSetupState(): Promise<SetupStateView> {
    if (this.#locatorState.status === 'NOT_CONFIGURED') {
      return { project: { status: 'NOT_CONFIGURED' }, setupState: 'NO_PROJECT' };
    }
    if (this.#locatorState.status === 'RECOVERY_REQUIRED') {
      return {
        project: {
          errorCode: this.#locatorState.code,
          status: 'RECOVERY_REQUIRED',
        },
        setupState: 'NO_PROJECT',
      };
    }
    const setupState =
      this.#active === null
        ? 'NO_PROJECT'
        : (await this.#active.service.getSettings()).settings.setupState;
    return {
      project: {
        displayPath: this.#locatorState.displayPath,
        revision: this.#locatorState.record.revision,
        status: 'READY',
      },
      setupState,
    };
  }

  public async getSettings(): Promise<SettingsBundle> {
    return this.#requireActive().service.getSettings();
  }

  public async selectDataRoot(
    window: Parameters<DataRootSelectionBroker['select']>[0],
    senderId: number,
  ): Promise<DataRootSelection | null> {
    return this.#selectionBroker.select(window, senderId);
  }

  public async confirmDataRootSelection(
    input: ConfirmDataRootSelectionInput,
    senderId: number,
    windowId: number,
  ): Promise<SetupStateView> {
    if (input.confirmation !== 'ACTIVATE_DATA_ROOT') {
      throw new SettingsError('DATA_ROOT_SELECTION_INVALID');
    }
    const selectedPath = this.#selectionBroker.consume(input.token, senderId, windowId);
    const root =
      input.mode === 'OPEN_EXISTING'
        ? await openProjectDataRoot(selectedPath)
        : await initializeProjectDataRoot(selectedPath);
    const databasePath = join(root.databaseDirectory, PROJECT_DATABASE_FILE);
    if (input.mode === 'OPEN_EXISTING' && !existsSync(databasePath)) {
      throw new SettingsError('PROJECT_ROOT_MISSING');
    }
    const prepared = await this.#openActiveProject(root);
    try {
      const record = await this.#locator.activate(
        {
          databasePath,
          displayPath: root.rootPath,
          instanceId: root.marker.instanceId,
          rootPath: root.rootPath,
        },
        input.expectedRevision,
        new Date().toISOString(),
      );
      const previous = this.#active;
      await this.#localApi.attachProject(prepared.database, prepared.clipper);
      this.#active = prepared;
      this.#locatorState = {
        displayPath: root.rootPath,
        record,
        status: 'READY',
      };
      await previous?.capabilities.close();
      await previous?.catalog.close();
      await previous?.dossier.close();
      await previous?.topics.close();
      await previous?.briefs.close();
      await previous?.copy.close();
      await previous?.factMapping.close();
      previous?.database.close();
      return this.getSetupState();
    } catch (error) {
      await prepared.catalog.close();
      await prepared.dossier.close();
      await prepared.topics.close();
      await prepared.briefs.close();
      await prepared.copy.close();
      await prepared.factMapping.close();
      prepared.database.close();
      throw error;
    }
  }

  public async updateNonSecretSettings(input: NonSecretSettingsDraft): Promise<SettingsBundle> {
    return this.#requireActive().service.updateNonSecretSettings(input);
  }

  public async setCredential(plaintext: string): Promise<CredentialStatusView> {
    return this.#requireActive().service.setCredential(plaintext);
  }

  public async clearCredential(confirmation: string): Promise<CredentialStatusView> {
    return this.#requireActive().service.clearCredential(confirmation);
  }

  public async getCredentialStatus(): Promise<CredentialStatusView> {
    if (this.#active === null) {
      return this.#credentials.getStatus(CREDENTIAL_SLOT);
    }
    return this.#active.service.getCredentialStatus();
  }

  public getProviderCapabilityState(): ProviderCapabilityStateView {
    return this.#requireActive().capabilities.getState();
  }

  public getModelAccounting(): ModelAccountingView {
    return this.#requireActive().accounting.getView();
  }

  public getSearchState(): SearchStateView {
    return this.#requireActive().search.getState();
  }

  public getFetchState(): FetchStateView {
    return this.#requireActive().fetch.getState();
  }

  public listBrowserClips(): readonly BrowserClipViewV1[] {
    return this.#requireActive().clipper.listClips();
  }

  public getBrowserClip(clipId: string): BrowserClipViewV1 | null {
    return this.#requireActive().clipper.getClip(clipId);
  }

  public getCatalogState(input: GetCatalogStateInput): CatalogSummaryView {
    return this.#requireActive().catalog.getState(input);
  }

  public getCatalogWork(workId: string): CatalogWorkDetail | null {
    return this.#requireActive().catalog.getWork(workId);
  }

  public getAuthenticityLibrary(input: GetAuthenticityLibraryInput): AuthenticityLibraryView {
    return this.#requireActive().authenticity.list(input);
  }

  public getAuthenticityWork(input: GetAuthenticityWorkInput): AuthenticityWorkDetail {
    return this.#requireActive().authenticity.get(input);
  }

  public previewAuthenticityAction(
    input: PreviewAuthenticityActionInput,
    senderId: number,
    windowId: number,
  ): AuthenticityActionPreview {
    return this.#requireActive().authenticity.preview(input, senderId, windowId);
  }

  public confirmAuthenticityAction(
    input: ConfirmAuthenticityActionInput,
    senderId: number,
    windowId: number,
  ): AuthenticityActionResult {
    return this.#requireActive().authenticity.confirm(input, senderId, windowId);
  }

  public getTopicPool(input: GetTopicPoolInput): TopicPoolWorkspaceView {
    return this.#requireActive().topics.list(input);
  }

  public getTopic(input: GetTopicInput): TopicDetailView {
    return this.#requireActive().topics.get(input);
  }

  public previewTopicAction(
    input: PreviewTopicActionInput,
    senderId: number,
    windowId: number,
  ): TopicActionPreview {
    return this.#requireActive().topics.preview(input, senderId, windowId);
  }

  public confirmTopicAction(
    input: ConfirmTopicActionInput,
    senderId: number,
    windowId: number,
  ): TopicActionResult {
    return this.#requireActive().topics.confirm(input, senderId, windowId);
  }

  public getExperiments(input: GetExperimentsInput): ExperimentListView {
    return this.#requireActive().experiments.list(input);
  }

  public getExperiment(input: GetExperimentInput): ExperimentDetailView {
    return this.#requireActive().experiments.get(input);
  }

  public previewExperimentAction(
    input: PreviewExperimentActionInput,
    senderId: number,
    windowId: number,
  ): ExperimentActionPreview {
    return this.#requireActive().experiments.preview(input, senderId, windowId);
  }

  public confirmExperimentAction(
    input: ConfirmExperimentActionInput,
    senderId: number,
    windowId: number,
  ): ExperimentActionResult {
    return this.#requireActive().experiments.confirm(input, senderId, windowId);
  }

  public getBriefs(input: GetBriefsInput): BriefListView {
    return this.#requireActive().briefs.list(input);
  }

  public getBrief(input: GetBriefInput): BriefDetailView {
    return this.#requireActive().briefs.get(input);
  }

  public getCopyDrafts(input: GetCopyDraftsInput): CopyDraftListView {
    return this.#requireActive().copy.list(input);
  }

  public getCopyDraft(input: GetCopyDraftInput): CopyDraftDetailView {
    return this.#requireActive().copy.get(input);
  }

  public previewCopyAction(
    input: PreviewCopyActionInput,
    senderId: number,
    windowId: number,
  ): CopyActionPreview {
    return this.#requireActive().copy.preview(input, senderId, windowId);
  }

  public confirmCopyAction(
    input: ConfirmCopyActionInput,
    senderId: number,
    windowId: number,
  ): CopyActionResult {
    return this.#requireActive().copy.confirm(input, senderId, windowId);
  }

  public diffCopyDraftVersions(input: DiffCopyDraftVersionsInput): CopyDraftVersionDiffView {
    return this.#requireActive().copy.diff(input);
  }

  public getFactMappingChecks(input: GetFactMappingChecksInput): FactMappingListView {
    return this.#requireActive().factMapping.list(input);
  }

  public getFactMappingCheck(input: GetFactMappingCheckInput): FactMappingDetailView {
    return this.#requireActive().factMapping.get(input);
  }

  public getFactMappingClaimChain(input: GetFactMappingClaimChainInput): FactMappingClaimChainView {
    return this.#requireActive().factMapping.getClaimChain(input);
  }

  public previewFactMappingAction(
    input: PreviewFactMappingActionInput,
    senderId: number,
    windowId: number,
  ): FactMappingActionPreview {
    return this.#requireActive().factMapping.preview(input, senderId, windowId);
  }

  public confirmFactMappingAction(
    input: ConfirmFactMappingActionInput,
    senderId: number,
    windowId: number,
  ): FactMappingActionResult {
    return this.#requireActive().factMapping.confirm(input, senderId, windowId);
  }

  public previewFactMappingDecision(
    input: PreviewFactMappingDecisionInput,
    senderId: number,
    windowId: number,
  ): FactMappingDecisionPreview {
    return this.#requireActive().factMapping.previewDecision(input, senderId, windowId);
  }

  public confirmFactMappingDecision(
    input: ConfirmFactMappingDecisionInput,
    senderId: number,
    windowId: number,
  ): FactMappingDecisionResult {
    return this.#requireActive().factMapping.confirmDecision(input, senderId, windowId);
  }

  public previewReadingAuthenticity(
    input: PreviewReadingAuthenticityInput,
    senderId: number,
    windowId: number,
  ): ReadingAuthenticityPreview {
    return this.#requireActive().readingAuthenticity.preview(input, senderId, windowId);
  }

  public confirmReadingAuthenticity(
    input: ConfirmReadingAuthenticityInput,
    senderId: number,
    windowId: number,
  ): ReadingAuthenticityResult {
    return this.#requireActive().readingAuthenticity.confirm(input, senderId, windowId);
  }

  public previewSpoilerQuality(
    input: PreviewSpoilerQualityInput,
    senderId: number,
    windowId: number,
  ): SpoilerQualityPreview {
    return this.#requireActive().spoilerQuality.preview(input, senderId, windowId);
  }

  public confirmSpoilerQuality(
    input: ConfirmSpoilerQualityInput,
    senderId: number,
    windowId: number,
  ): SpoilerQualityResult {
    return this.#requireActive().spoilerQuality.confirm(input, senderId, windowId);
  }

  public previewCopyIntegrity(
    input: PreviewCopyIntegrityInput,
    senderId: number,
    windowId: number,
  ): CopyIntegrityPreview {
    return this.#requireActive().copy.previewIntegrity(input, senderId, windowId);
  }

  public confirmCopyIntegrity(
    input: ConfirmCopyIntegrityInput,
    senderId: number,
    windowId: number,
  ): CopyIntegrityResult {
    return this.#requireActive().copy.confirmIntegrity(input, senderId, windowId);
  }

  public previewBriefAction(
    input: PreviewBriefActionInput,
    senderId: number,
    windowId: number,
  ): BriefActionPreview {
    return this.#requireActive().briefs.preview(input, senderId, windowId);
  }

  public confirmBriefAction(
    input: ConfirmBriefActionInput,
    senderId: number,
    windowId: number,
  ): BriefActionResult {
    return this.#requireActive().briefs.confirm(input, senderId, windowId);
  }

  public getEvidenceState(input: GetEvidenceStateInput): EvidenceStateView {
    return this.#requireActive().evidence.getState(input);
  }

  public previewEvidenceConflict(
    input: PreviewEvidenceConflictInput,
    senderId: number,
    windowId: number,
  ): EvidenceConflictActionPreview {
    return this.#requireActive().evidence.previewConflict(input, senderId, windowId);
  }

  public confirmEvidenceConflict(
    input: ConfirmEvidenceConflictInput,
    senderId: number,
    windowId: number,
  ): EvidenceConflictView {
    return this.#requireActive().evidence.confirmConflict(input, senderId, windowId);
  }

  public previewSourceProcessing(
    input: PreviewSourceProcessingInput,
    senderId: number,
    windowId: number,
  ): SourceProcessingPreview {
    return this.#requireActive().evidence.previewProcessing(input, senderId, windowId);
  }

  public confirmSourceProcessing(
    input: ConfirmSourceProcessingInput,
    senderId: number,
    windowId: number,
  ): EvidenceStateView {
    return this.#requireActive().evidence.confirmProcessing(input, senderId, windowId);
  }

  public cancelSourceProcessing(input: CancelSourceProcessingInput): EvidenceStateView {
    return this.#requireActive().evidence.cancelProcessing(input);
  }

  public previewRealResearchIntake(
    input: PreviewRealResearchIntakeInput,
    senderId: number,
    windowId: number,
  ): RealResearchIntakePreview {
    return this.#requireActive().evidence.previewRealIntake(input, senderId, windowId);
  }

  public confirmRealResearchIntake(
    input: ConfirmRealResearchIntakeInput,
    senderId: number,
    windowId: number,
  ): Promise<RealResearchIntakeResult> {
    return this.#requireActive().evidence.confirmRealIntake(input, senderId, windowId);
  }

  public previewSyntheticResearchIntake(
    input: PreviewSyntheticResearchIntakeInput,
    senderId: number,
    windowId: number,
  ): SyntheticResearchIntakePreview {
    return this.#requireActive().evidence.previewSyntheticIntake(input, senderId, windowId);
  }

  public confirmSyntheticResearchIntake(
    input: ConfirmSyntheticResearchIntakeInput,
    senderId: number,
    windowId: number,
  ): Promise<SyntheticResearchIntakeResult> {
    return this.#requireActive().evidence.confirmSyntheticIntake(input, senderId, windowId);
  }

  public listDossiers(input: ListDossiersInput): DossierListStateView {
    return this.#requireActive().dossier.list(input);
  }

  public getDossier(input: GetDossierInput): DossierDetailStateView {
    return this.#requireActive().dossier.get(input);
  }

  public previewDossierBuild(
    input: PreviewDossierBuildInput,
    senderId: number,
    windowId: number,
  ): DossierBuildPreview {
    return this.#requireActive().dossier.preview(input, senderId, windowId);
  }

  public confirmDossierBuild(
    input: ConfirmDossierBuildInput,
    senderId: number,
    windowId: number,
  ): DossierBuildRun {
    return this.#requireActive().dossier.confirm(input, senderId, windowId);
  }

  public cancelDossierBuild(input: CancelDossierBuildInput): DossierBuildRun {
    return this.#requireActive().dossier.cancel(input);
  }

  public diffDossierVersions(input: DiffDossierVersionsInput): DossierVersionDiffView {
    return this.#requireActive().dossier.diff(input);
  }

  public previewCatalogDiscovery(
    input: PreviewCatalogDiscoveryInput,
    senderId: number,
    windowId: number,
  ): CatalogDiscoveryPreview {
    return this.#requireActive().catalog.previewDiscovery(input, senderId, windowId);
  }

  public confirmCatalogDiscovery(
    input: ConfirmCatalogDiscoveryInput,
    senderId: number,
    windowId: number,
  ): CatalogRunView {
    return this.#requireActive().catalog.confirmDiscovery(input, senderId, windowId);
  }

  public cancelCatalogDiscovery(input: CancelCatalogDiscoveryInput): CatalogRunView {
    return this.#requireActive().catalog.cancelDiscovery(input);
  }

  public previewCatalogWorkMerge(
    input: PreviewCatalogWorkMergeInput,
    senderId: number,
    windowId: number,
  ): CatalogActionPreview {
    return this.#requireActive().catalog.previewWorkMerge(input, senderId, windowId);
  }

  public previewCatalogWorkSplit(
    input: PreviewCatalogWorkSplitInput,
    senderId: number,
    windowId: number,
  ): CatalogActionPreview {
    return this.#requireActive().catalog.previewWorkSplit(input, senderId, windowId);
  }

  public previewCatalogUndo(
    input: PreviewCatalogUndoInput,
    senderId: number,
    windowId: number,
  ): CatalogActionPreview {
    return this.#requireActive().catalog.previewUndo(input, senderId, windowId);
  }

  public confirmCatalogAction(
    kind: CatalogActionKind,
    input: ConfirmCatalogActionInput,
    senderId: number,
    windowId: number,
  ): CatalogActionResult {
    return this.#requireActive().catalog.confirmAction(kind, input, senderId, windowId);
  }

  public readBrowserClipScreenshot(
    clipId: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mime: 'image/jpeg' | 'image/png' } | null> {
    return this.#requireActive().clipper.readScreenshot(clipId);
  }

  public updateFetchPolicy(input: UpdateFetchPolicyInput): FetchStateView {
    return this.#requireActive().fetch.update(input);
  }

  public updateSearchProviderConfig(input: UpdateSearchProviderConfigInput): SearchStateView {
    return this.#requireActive().search.update(input);
  }

  public previewModelCacheClear(senderId: number, windowId: number): ModelCacheClearPreview {
    return this.#requireActive().accounting.previewCacheClear(senderId, windowId);
  }

  public confirmModelCacheClear(
    input: ConfirmModelCacheClearInput,
    senderId: number,
    windowId: number,
  ): ConfirmModelCacheClearResult {
    return this.#requireActive().accounting.confirmCacheClear(input, senderId, windowId);
  }

  public createModelPriceSchedule(input: CreateModelPriceScheduleInput): ModelPriceScheduleView {
    return this.#requireActive().accounting.createPriceSchedule(input);
  }

  public createModelUnitPolicy(input: CreateModelUnitPolicyInput): ModelUnitPolicyView {
    return this.#requireActive().accounting.createUnitPolicy(input);
  }

  public previewProviderCapabilityProbe(
    input: PreviewProviderCapabilityProbeInput,
    senderId: number,
    windowId: number,
  ): ProviderCapabilityProbePreview {
    return this.#requireActive().capabilities.preview(input, senderId, windowId);
  }

  public startProviderCapabilityProbe(
    input: StartProviderCapabilityProbeInput,
    senderId: number,
    windowId: number,
  ): Promise<ProviderCapabilityProbeProgressView> {
    return this.#requireActive().capabilities.start(input, senderId, windowId);
  }

  public getProviderCapabilityProbeProgress(runId: string): ProviderCapabilityProbeProgressView {
    return this.#requireActive().capabilities.getProgress(runId);
  }

  public cancelProviderCapabilityProbe(
    input: CancelProviderCapabilityProbeInput,
  ): ProviderCapabilityProbeProgressView {
    return this.#requireActive().capabilities.cancel(input);
  }

  public async buildDiagnosticPreview(): Promise<DiagnosticPreview> {
    return this.#requireActive().service.buildDiagnosticPreview();
  }

  public async exportDiagnosticReport(expectedPreviewHash: string): Promise<DiagnosticExport> {
    return this.#requireActive().service.exportDiagnosticReport(expectedPreviewHash);
  }

  public clearWindowSelections(windowId: number): void {
    this.#selectionBroker.clearForWindow(windowId);
    this.#localApi.clearWindowPairings(windowId);
    this.#active?.capabilities.clearWindow(windowId);
    this.#active?.accounting.clearWindow(windowId);
    this.#active?.authenticity.clearWindow(windowId);
    this.#active?.topics.clearWindow(windowId);
    this.#active?.experiments.clearWindow(windowId);
    this.#active?.briefs.clearWindow(windowId);
    this.#active?.copy.clearWindow(windowId);
    this.#active?.factMapping.clearWindow(windowId);
    this.#active?.readingAuthenticity.clearWindow(windowId);
    this.#active?.spoilerQuality.clearWindow(windowId);
    this.#active?.catalog.clearWindow(windowId);
    this.#active?.evidence.clearWindow(windowId);
    this.#active?.dossier.clearWindow(windowId);
  }

  public getLocalApiStatus(): LocalApiStatusView {
    return this.#localApi.getStatus();
  }

  public updateLocalApiSettings(input: {
    readonly enabled: boolean;
    readonly expectedRevision: number;
    readonly port: number;
  }): Promise<LocalApiStatusView> {
    return this.#localApi.updateSettings(input);
  }

  public startLocalApiPairing(windowId: number): PairingView {
    return this.#localApi.startPairing(windowId);
  }

  public cancelLocalApiPairing(pairingSessionId: string, windowId: number): LocalApiStatusView {
    return this.#localApi.cancelPairing(pairingSessionId, windowId);
  }

  public listLocalApiClients(): readonly LocalApiClientView[] {
    return this.#localApi.listClients();
  }

  public revokeLocalApiClient(
    clientId: string,
    expectedRevision: number,
    confirmation: string,
  ): LocalApiClientView {
    return this.#localApi.revokeClient(clientId, expectedRevision, confirmation);
  }

  public async close(): Promise<void> {
    await this.#localApi.close();
    await this.#active?.capabilities.close();
    await this.#active?.catalog.close();
    await this.#active?.dossier.close();
    await this.#active?.topics.close();
    await this.#active?.briefs.close();
    await this.#active?.copy.close();
    await this.#active?.factMapping.close();
    this.#active?.database.close();
    this.#active = null;
  }

  async #openActiveProject(root: ProjectDataRoot): Promise<ActiveProject> {
    const databasePath = join(root.databaseDirectory, PROJECT_DATABASE_FILE);
    await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
    });
    const database = connectDatabase(databasePath);
    const repository = new SqliteSettingsRepository(database);
    const capabilityRepository = new SqliteProviderCapabilityRepository(database);
    const accountingRepository = new SqliteModelAccountingRepository(database);
    const diagnosticStore = new LocalDiagnosticReportStore(root);
    const service = new SettingsService(repository, this.#credentials, {
      diagnosticRuntime: () => ({
        appVersion: this.#versions.appVersion,
        chromiumVersion: this.#versions.chromiumVersion,
        dataRootFormatVersion: DATA_ROOT_FORMAT_VERSION,
        databaseHealthy: true,
        electronVersion: this.#versions.electronVersion,
        nodeVersion: this.#versions.nodeVersion,
        platformVersion: release(),
        queueHealthy: true,
        safeStorageAvailable: this.#safeStorageAvailable,
        schemaVersion: MIGRATIONS.length,
        storageHealthy: true,
        localApiActiveClientCount: this.#localApi.getStatus().activeClientCount,
        localApiEnabled: this.#localApi.getStatus().enabled,
        localApiPort: this.#localApi.getStatus().port,
        localApiState: this.#localApi.getStatus().state,
        localApiVersion: '1',
      }),
      diagnosticStore,
    });
    const capabilities = new ProviderCapabilityRuntime(
      capabilityRepository,
      () => repository.getBundle().settings,
      () => this.#credentials.resolveForProvider(CREDENTIAL_SLOT),
      { accountingRepository },
    );
    capabilities.initialize();
    const accounting = new DesktopModelAccountingRuntime(
      accountingRepository,
      new ModelResultCacheStore(root),
      () => new Date(),
      () => {
        try {
          return capabilities.getConfigFingerprint();
        } catch {
          return '0'.repeat(64);
        }
      },
    );
    const v2Provider = new V2ProviderRuntime({
      accounting: accountingRepository,
      capabilities,
      credentials: this.#credentials,
      root,
      settings: repository,
    });
    const search = new DesktopSearchRuntime(database);
    const clipper = new DesktopBrowserClipRuntime(database, root);
    const fetch = new DesktopFetchRuntime(database, root);
    const catalog = new DesktopCatalogRuntime(database);
    const authenticity = new DesktopAuthenticityRuntime(database);
    const evidence = new DesktopEvidenceRuntime(database, root);
    const dossier = new DesktopDossierRuntime(database);
    const topics = new DesktopTopicRuntime(database);
    const experiments = new DesktopExperimentRuntime(database);
    const briefs = new DesktopBriefRuntime(database);
    const copy = new DesktopCopyRuntime(database);
    const factMapping = new DesktopFactMappingRuntime(database);
    const readingAuthenticity = new DesktopReadingAuthenticityRuntime(database);
    const spoilerQuality = new DesktopSpoilerQualityRuntime(database);
    catalog.start();
    dossier.start();
    topics.start();
    briefs.start();
    copy.start();
    factMapping.start();
    accountingRepository.recoverInterrupted(new Date().toISOString());
    return {
      accounting,
      authenticity,
      briefs,
      copy,
      factMapping,
      readingAuthenticity,
      spoilerQuality,
      capabilities,
      catalog,
      dossier,
      clipper,
      database,
      evidence,
      experiments,
      fetch,
      root,
      search,
      service,
      topics,
      v2Provider,
    };
  }

  #requireActive(): ActiveProject {
    if (this.#active === null) {
      throw new SettingsError('SETUP_NOT_INITIALIZED');
    }
    return this.#active;
  }
}
