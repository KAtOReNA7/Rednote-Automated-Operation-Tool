import type {
  CredentialStatusView,
  DiagnosticExport,
  DiagnosticPreview,
  NonSecretSettingsDraft,
  SettingsBundle,
  SettingsErrorCode,
  SetupState,
} from '@mystery-operations/settings';
import type {
  ProbeCapability,
  ProbeConfidence,
  ProbeModelSlot,
  ProbeProfile,
  ProbeProtocolMode,
  ProbeReasonCode,
  ProbeRunStatus,
  ProbeSource,
  ProbeState,
} from '@mystery-operations/providers';
import type {
  CancelLocalApiPairingRequest,
  LocalApiClientView,
  LocalApiErrorCode,
  LocalApiStatusView,
  PairingView,
  RevokeLocalApiClientRequest,
  UpdateLocalApiSettingsRequest,
} from './local-api-contracts.js';

export const DESKTOP_BRIDGE_KEY = 'rednoteDesktop' as const;

export const DESKTOP_IPC_CHANNELS = Object.freeze({
  getAppInfo: 'desktop:get-app-info',
  getFoundationHealth: 'desktop:get-foundation-health',
  getRuntimeCapabilities: 'desktop:get-runtime-capabilities',
  getSetupState: 'settings:get-setup-state',
  getSettings: 'settings:get-settings',
  getProviderCapabilityState: 'providers:get-capability-state',
  getSearchState: 'search:get-state',
  getFetchState: 'fetch:get-state',
  getModelAccounting: 'models:get-accounting',
  previewModelCacheClear: 'models:preview-cache-clear',
  confirmModelCacheClear: 'models:confirm-cache-clear',
  createModelPriceSchedule: 'models:create-price-schedule',
  createModelUnitPolicy: 'models:create-unit-policy',
  previewProviderCapabilityProbe: 'providers:preview-capability-probe',
  startProviderCapabilityProbe: 'providers:start-capability-probe',
  getProviderCapabilityProbeProgress: 'providers:get-capability-probe-progress',
  cancelProviderCapabilityProbe: 'providers:cancel-capability-probe',
  selectDataRoot: 'settings:select-data-root',
  confirmDataRootSelection: 'settings:confirm-data-root-selection',
  updateNonSecretSettings: 'settings:update-non-secret',
  updateSearchProviderConfig: 'search:update-provider-config',
  updateFetchPolicy: 'fetch:update-policy',
  setCredential: 'settings:set-credential',
  clearCredential: 'settings:clear-credential',
  getCredentialStatus: 'settings:get-credential-status',
  buildDiagnosticPreview: 'settings:build-diagnostic-preview',
  exportDiagnosticReport: 'settings:export-diagnostic-report',
  getLocalApiStatus: 'local-api:get-status',
  updateLocalApiSettings: 'local-api:update-settings',
  startLocalApiPairing: 'local-api:start-pairing',
  cancelLocalApiPairing: 'local-api:cancel-pairing',
  listLocalApiClients: 'local-api:list-clients',
  revokeLocalApiClient: 'local-api:revoke-client',
  getWindowState: 'desktop:get-window-state',
});

export const FOUNDATION_CHECK_KEYS = Object.freeze([
  'backup',
  'cleanup',
  'foreignKeys',
  'migrations',
  'nodeSqlite',
  'queueLifecycle',
  'reopen',
  'wal',
] as const);

export type FoundationCheckKey = (typeof FOUNDATION_CHECK_KEYS)[number];

export interface DesktopError {
  readonly code:
    | 'FOUNDATION_UNAVAILABLE'
    | 'INTERNAL_ERROR'
    | 'INVALID_REQUEST'
    | 'MODEL_ACCOUNTING_INVALID_REQUEST'
    | 'MODEL_ACCOUNTING_STALE'
    | 'MODEL_CACHE_CLEAR_INVALID'
    | 'MODEL_CACHE_CLEAR_STALE'
    | 'BUDGET_UNPRICED_LIMIT_REQUIRED'
    | 'PROBE_ALREADY_RUNNING'
    | 'PROBE_INVALID_REQUEST'
    | 'PROBE_NOT_RUNNING'
    | 'PROBE_STALE'
    | LocalApiErrorCode
    | SettingsErrorCode;
  readonly context?: Readonly<Record<string, boolean | number | string>>;
  readonly message: string;
  readonly retryable: boolean;
}

export type DesktopResult<T> =
  { readonly ok: true; readonly value: T } | { readonly error: DesktopError; readonly ok: false };

export interface AppInfo {
  readonly name: string;
  readonly platform: 'win32';
  readonly version: string;
}

export interface RuntimeCapabilities {
  readonly chromiumVersion: string;
  readonly electronVersion: string;
  readonly nodeSqlite: true;
  readonly nodeVersion: string;
  readonly v8Version: string;
}

export interface FoundationHealth {
  readonly checks: Readonly<Record<FoundationCheckKey, true>>;
  readonly schemaVersion: number;
  readonly status: 'ready';
}

export interface WindowState {
  readonly isFullScreen: boolean;
  readonly isMaximized: boolean;
}

export interface DataRootSelection {
  readonly displayPath: string;
  readonly expiresAt: string;
  readonly token: string;
}

export interface SetupStateView {
  readonly project:
    | { readonly status: 'NOT_CONFIGURED' }
    | {
        readonly errorCode: SettingsErrorCode;
        readonly status: 'RECOVERY_REQUIRED';
      }
    | {
        readonly displayPath: string;
        readonly revision: number;
        readonly status: 'READY';
      };
  readonly setupState: 'NO_PROJECT' | SetupState;
}

export interface ConfirmDataRootSelectionInput {
  readonly confirmation: 'ACTIVATE_DATA_ROOT';
  readonly expectedRevision: number | null;
  readonly mode: 'CREATE_OR_OPEN' | 'OPEN_EXISTING';
  readonly token: string;
}

export interface SetCredentialInput {
  readonly plaintext: string;
  readonly slot: 'CONTENT_AI_API_KEY';
}

export interface ClearCredentialInput {
  readonly confirmation: 'DELETE_CONTENT_AI_API_KEY';
  readonly slot: 'CONTENT_AI_API_KEY';
}

export interface GetCredentialStatusInput {
  readonly slot: 'CONTENT_AI_API_KEY';
}

export interface ExportDiagnosticReportInput {
  readonly expectedPreviewHash: string;
}

export interface ProviderCapabilityEntryView {
  readonly capability: ProbeCapability;
  readonly confidence: ProbeConfidence;
  readonly maxContextTokens: number | null;
  readonly modelId: string | null;
  readonly modelSlot: ProbeModelSlot;
  readonly observedAt: string | null;
  readonly protocolMode: ProbeProtocolMode;
  readonly rateLimitRequests: number | null;
  readonly rateLimitTokens: number | null;
  readonly reasonCode: ProbeReasonCode;
  readonly source: ProbeSource;
  readonly stale: boolean;
  readonly state: ProbeState;
}

export interface ProviderCapabilityRunHistoryView {
  readonly completedAt: string | null;
  readonly plannedRequestCount: number;
  readonly profile: ProbeProfile;
  readonly reasonCode: ProbeReasonCode | null;
  readonly runId: string;
  readonly sentRequestCount: number;
  readonly startedAt: string;
  readonly status: ProbeRunStatus;
}

export interface ProviderCapabilityStateView {
  readonly activeRun: ProviderCapabilityProbeProgressView | null;
  readonly derivedState:
    'CANCELLED' | 'FAILED' | 'INTERRUPTED' | 'NOT_PROBED' | 'PARTIAL' | 'PROBE_COMPLETE' | 'STALE';
  readonly entries: readonly ProviderCapabilityEntryView[];
  readonly history: readonly ProviderCapabilityRunHistoryView[];
  readonly runId: string | null;
}

export interface PreviewProviderCapabilityProbeInput {
  readonly includeToolCalling: boolean;
  readonly profile: ProbeProfile;
  readonly selectedCapabilities: readonly ProbeCapability[];
}

export interface ProviderCapabilityProbePreview {
  readonly budgetCheck: 'UNIT_POLICY_READY' | 'UNIT_POLICY_REQUIRED';
  readonly credentialBindingVersion: number;
  readonly expiresAt: string;
  readonly feeEstimate: 'UNKNOWN';
  readonly planHash: string;
  readonly profile: ProbeProfile;
  readonly requestCount: number;
  readonly settingsRevision: number;
  readonly startToken: string;
}

export interface StartProviderCapabilityProbeInput {
  readonly confirmation: 'START_PROVIDER_CAPABILITY_PROBE';
  readonly credentialBindingVersion: number;
  readonly planHash: string;
  readonly settingsRevision: number;
  readonly startToken: string;
}

export interface GetProviderCapabilityProbeProgressInput {
  readonly runId: string;
}

export interface CancelProviderCapabilityProbeInput {
  readonly confirmation: 'CANCEL_PROVIDER_CAPABILITY_PROBE';
  readonly runId: string;
}

export interface ProviderCapabilityProbeProgressView {
  readonly completedRequestCount: number;
  readonly currentCapability: ProbeCapability | null;
  readonly plannedRequestCount: number;
  readonly runId: string;
  readonly sentRequestCount: number;
  readonly status: ProbeRunStatus;
}

export interface ModelAccountingRunView {
  readonly costAmountMicroUsd: string | null;
  readonly costState: string;
  readonly executionId: string;
  readonly externalRequestCount: number;
  readonly localCacheHit: boolean;
  readonly modelId: string;
  readonly modelSlot: string;
  readonly protocolMode: string;
  readonly stableErrorCode: string | null;
  readonly status: string;
  readonly taskKind: string;
}

export interface ModelPriceScheduleView {
  readonly id: string;
  readonly modelId: string;
  readonly operationKind: string;
  readonly protocolMode: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly version: number;
}

export interface ModelUnitPolicyView {
  readonly id: string;
  readonly maxExternalCallsMonthly: number;
  readonly maxExternalCallsWeekly: number;
  readonly scopeKind: 'GLOBAL' | 'MODEL_ROLE' | 'TASK_KIND';
  readonly scopeValue: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly version: number;
}

export interface ModelAccountingView {
  readonly billingMonth: string;
  readonly cacheBytes: number;
  readonly cacheEntries: number;
  readonly cacheHitCount: number;
  readonly estimatedKnownMicroUsd: string;
  readonly hardLimitMicroUsd: string;
  readonly hardStop: boolean;
  readonly outstandingReservationMicroUsd: string;
  readonly priceSchedules: readonly ModelPriceScheduleView[];
  readonly providerReportedMicroUsd: string;
  readonly recentRuns: readonly ModelAccountingRunView[];
  readonly uncertainReservationMicroUsd: string;
  readonly unitPolicies: readonly ModelUnitPolicyView[];
  readonly unknownCostCallCount: number;
  readonly warning: boolean;
  readonly warningLimitMicroUsd: string;
}

export interface SearchAdapterView {
  readonly budgetState: string;
  readonly capabilityState: string;
  readonly codecState: string;
  readonly credentialState: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly features: readonly string[];
  readonly kind:
    'BROWSER_CLIP' | 'CURATED_SOURCE' | 'MANUAL_URL' | 'MODEL_WEB_SEARCH' | 'SEARCH_API';
  readonly mode: 'ACTIVE_REMOTE' | 'FIXTURE_ONLY' | 'PASSIVE_LOCAL';
  readonly maxResults: number;
  readonly providerInstanceId:
    | 'browser-clip-v1'
    | 'curated-source-v1'
    | 'manual-url-v1'
    | 'model-web-search-v1'
    | 'search-api-v1';
  readonly ratePolicy: SearchRatePolicyInput | null;
  readonly rateState: string;
  readonly readiness: string;
  readonly settingsRevision: number;
  readonly timeoutMs: number;
  readonly curatedEntries: readonly CuratedSearchEntryInput[];
}

export interface SearchRunView {
  readonly candidateCount: number;
  readonly duplicateCount: number;
  readonly executionId: string;
  readonly finishedAt: string | null;
  readonly providerInstanceId: string;
  readonly rejectedCount: number;
  readonly searchRunId: string;
  readonly stableError: string | null;
  readonly startedAt: string;
  readonly status: string;
}

export interface SearchStateView {
  readonly adapters: readonly SearchAdapterView[];
  readonly boundaries: {
    readonly browserClip: string;
    readonly discovery: string;
    readonly fetching: string;
  };
  readonly overallReadiness: 'ACTIVE_SEARCH_READY' | 'DEGRADED' | 'NOT_READY' | 'PASSIVE_ONLY';
  readonly recentRuns: readonly SearchRunView[];
}

export interface FetchRunView {
  readonly candidateId: string;
  readonly charset: string | null;
  readonly displayHost: string;
  readonly documentSaved: boolean;
  readonly externalRequestCount: number;
  readonly fetchRunId: string;
  readonly mimeType: string | null;
  readonly receivedBytes: number;
  readonly redactionCount: number;
  readonly redirectCount: number;
  readonly stableError: string | null;
  readonly stage: string;
}

export interface FetchStateView {
  readonly policy: {
    readonly charset: 'ALLOWLIST';
    readonly maxDecodedBytes: number;
    readonly maxRedirects: number;
    readonly maxRawBytes: number;
    readonly mime: 'HTML_XHTML_TEXT_ONLY';
    readonly rate: 'PERSISTENT_PER_ORIGIN';
    readonly robots: 'RFC9309_FAIL_CLOSED';
  };
  readonly profile: {
    readonly enabled: boolean;
    readonly globalMaxConcurrent: number;
    readonly id: string;
    readonly maxRequestsPerWindow: number;
    readonly minIntervalMs: number;
    readonly perOriginMaxConcurrent: 1;
    readonly revision: number;
    readonly windowMs: number;
  };
  readonly ready: boolean;
  readonly recentRuns: readonly FetchRunView[];
  readonly storageReady: boolean;
}

export interface UpdateFetchPolicyInput {
  readonly enabled: boolean;
  readonly expectedRevision: number;
  readonly globalMaxConcurrent: number;
  readonly maxRequestsPerWindow: number;
  readonly minIntervalMs: number;
  readonly windowMs: number;
}

export interface SearchRatePolicyInput {
  readonly contractVersion: 'search-rate-policy-v1';
  readonly maxConcurrent: number;
  readonly maxRequestsPerWindow: number;
  readonly maxResponseBytes: number;
  readonly maxResults: number;
  readonly minIntervalMs: number;
  readonly revision: number;
  readonly timeoutMs: number;
  readonly windowMs: number;
}

export interface CuratedSearchEntryInput {
  readonly entryId: string;
  readonly intent:
    | 'AUTHOR_RESEARCH'
    | 'AWARD_RESEARCH'
    | 'BIBLIOGRAPHIC_LOOKUP'
    | 'BOOK_DISCOVERY'
    | 'CULTURAL_CONTEXT'
    | 'PUBLISHING_NEWS'
    | 'REVIEW_LANDSCAPE';
  readonly languageHint: string | null;
  readonly title: string;
  readonly urlTemplate: string;
}

export interface UpdateSearchProviderConfigInput {
  readonly curatedEntries: readonly CuratedSearchEntryInput[];
  readonly enabled: boolean;
  readonly expectedRevision: number;
  readonly maxResults: number;
  readonly providerInstanceId:
    | 'browser-clip-v1'
    | 'curated-source-v1'
    | 'manual-url-v1'
    | 'model-web-search-v1'
    | 'search-api-v1';
  readonly ratePolicy: SearchRatePolicyInput | null;
  readonly timeoutMs: number;
}

export interface ModelCacheClearPreview {
  readonly bytes: number;
  readonly count: number;
  readonly expiresAt: string;
  readonly outputTypes: readonly string[];
  readonly previewToken: string;
}

export interface ConfirmModelCacheClearInput {
  readonly confirmation: 'CLEAR_MODEL_RESULT_CACHE';
  readonly expectedBytes: number;
  readonly expectedCount: number;
  readonly previewToken: string;
}

export interface ConfirmModelCacheClearResult {
  readonly deletedFiles: number;
  readonly orphanFiles: number;
  readonly tombstonedEntries: number;
}

export interface CreateModelPriceScheduleInput {
  readonly cachedInputPerMillionUsd: string | null;
  readonly cacheWritePerMillionUsd: string | null;
  readonly callUsd: string | null;
  readonly expectedSettingsRevision: number;
  readonly imageGenerationCallUsd: string | null;
  readonly imageUsd: string | null;
  readonly inputPerMillionUsd: string | null;
  readonly inputTokensIncludeCachedInput: boolean;
  readonly modelId: string;
  readonly operationKind: string;
  readonly outputPerMillionUsd: string | null;
  readonly protocolMode: string | null;
  readonly searchCallUsd: string | null;
  readonly toolUnitUsd: string | null;
  readonly usageSemanticsVersion: string;
}

export interface CreateModelUnitPolicyInput {
  readonly expectedSettingsRevision: number;
  readonly maxExternalCallsMonthly: number;
  readonly maxExternalCallsWeekly: number;
  readonly maxImageGenerationCalls: number | null;
  readonly maxImages: number | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly maxToolCalls: number | null;
  readonly maxWebSearchCalls: number | null;
  readonly scopeKind: 'GLOBAL' | 'MODEL_ROLE' | 'TASK_KIND';
  readonly scopeValue: string | null;
}

export interface DesktopBridge {
  buildDiagnosticPreview(): Promise<DesktopResult<DiagnosticPreview>>;
  clearCredential(input: ClearCredentialInput): Promise<DesktopResult<CredentialStatusView>>;
  confirmModelCacheClear(
    input: ConfirmModelCacheClearInput,
  ): Promise<DesktopResult<ConfirmModelCacheClearResult>>;
  confirmDataRootSelection(
    input: ConfirmDataRootSelectionInput,
  ): Promise<DesktopResult<SetupStateView>>;
  exportDiagnosticReport(
    input: ExportDiagnosticReportInput,
  ): Promise<DesktopResult<DiagnosticExport>>;
  getAppInfo(): Promise<DesktopResult<AppInfo>>;
  getCredentialStatus(
    input: GetCredentialStatusInput,
  ): Promise<DesktopResult<CredentialStatusView>>;
  getFoundationHealth(): Promise<DesktopResult<FoundationHealth>>;
  getModelAccounting(): Promise<DesktopResult<ModelAccountingView>>;
  getProviderCapabilityState(): Promise<DesktopResult<ProviderCapabilityStateView>>;
  getSearchState?(): Promise<DesktopResult<SearchStateView>>;
  getFetchState?(): Promise<DesktopResult<FetchStateView>>;
  previewProviderCapabilityProbe(
    input: PreviewProviderCapabilityProbeInput,
  ): Promise<DesktopResult<ProviderCapabilityProbePreview>>;
  startProviderCapabilityProbe(
    input: StartProviderCapabilityProbeInput,
  ): Promise<DesktopResult<ProviderCapabilityProbeProgressView>>;
  getProviderCapabilityProbeProgress(
    input: GetProviderCapabilityProbeProgressInput,
  ): Promise<DesktopResult<ProviderCapabilityProbeProgressView>>;
  cancelProviderCapabilityProbe(
    input: CancelProviderCapabilityProbeInput,
  ): Promise<DesktopResult<ProviderCapabilityProbeProgressView>>;
  getLocalApiStatus(): Promise<DesktopResult<LocalApiStatusView>>;
  getRuntimeCapabilities(): Promise<DesktopResult<RuntimeCapabilities>>;
  getSettings(): Promise<DesktopResult<SettingsBundle>>;
  getSetupState(): Promise<DesktopResult<SetupStateView>>;
  getWindowState(): Promise<DesktopResult<WindowState>>;
  listLocalApiClients(): Promise<DesktopResult<readonly LocalApiClientView[]>>;
  previewModelCacheClear(): Promise<DesktopResult<ModelCacheClearPreview>>;
  createModelPriceSchedule(
    input: CreateModelPriceScheduleInput,
  ): Promise<DesktopResult<ModelPriceScheduleView>>;
  createModelUnitPolicy(
    input: CreateModelUnitPolicyInput,
  ): Promise<DesktopResult<ModelUnitPolicyView>>;
  selectDataRoot(): Promise<DesktopResult<DataRootSelection | null>>;
  setCredential(input: SetCredentialInput): Promise<DesktopResult<CredentialStatusView>>;
  startLocalApiPairing(): Promise<DesktopResult<PairingView>>;
  cancelLocalApiPairing(
    input: CancelLocalApiPairingRequest,
  ): Promise<DesktopResult<LocalApiStatusView>>;
  revokeLocalApiClient(
    input: RevokeLocalApiClientRequest,
  ): Promise<DesktopResult<LocalApiClientView>>;
  updateLocalApiSettings(
    input: UpdateLocalApiSettingsRequest,
  ): Promise<DesktopResult<LocalApiStatusView>>;
  updateNonSecretSettings(input: NonSecretSettingsDraft): Promise<DesktopResult<SettingsBundle>>;
  updateSearchProviderConfig?(
    input: UpdateSearchProviderConfigInput,
  ): Promise<DesktopResult<SearchStateView>>;
  updateFetchPolicy?(input: UpdateFetchPolicyInput): Promise<DesktopResult<FetchStateView>>;
}
