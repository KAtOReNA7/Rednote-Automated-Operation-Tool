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
  previewProviderCapabilityProbe: 'providers:preview-capability-probe',
  startProviderCapabilityProbe: 'providers:start-capability-probe',
  getProviderCapabilityProbeProgress: 'providers:get-capability-probe-progress',
  cancelProviderCapabilityProbe: 'providers:cancel-capability-probe',
  selectDataRoot: 'settings:select-data-root',
  confirmDataRootSelection: 'settings:confirm-data-root-selection',
  updateNonSecretSettings: 'settings:update-non-secret',
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

export interface DesktopBridge {
  buildDiagnosticPreview(): Promise<DesktopResult<DiagnosticPreview>>;
  clearCredential(input: ClearCredentialInput): Promise<DesktopResult<CredentialStatusView>>;
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
  getProviderCapabilityState(): Promise<DesktopResult<ProviderCapabilityStateView>>;
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
}
