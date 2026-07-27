export const M0_PACKAGE_BOUNDARY = 'shared' as const;

export { DESKTOP_BRIDGE_KEY, DESKTOP_IPC_CHANNELS, FOUNDATION_CHECK_KEYS } from './desktop-api.js';

export type {
  AppInfo,
  ClearCredentialInput,
  ConfirmDataRootSelectionInput,
  DataRootSelection,
  DesktopBridge,
  DesktopError,
  DesktopResult,
  ExportDiagnosticReportInput,
  FoundationCheckKey,
  FoundationHealth,
  GetCredentialStatusInput,
  RuntimeCapabilities,
  SetCredentialInput,
  SetupStateView,
  WindowState,
} from './desktop-api.js';

export type {
  CredentialStatusView,
  DiagnosticExport,
  DiagnosticPreview,
  NonSecretSettingsDraft,
  SettingsBundle,
  SetupState,
} from '@mystery-operations/settings';
