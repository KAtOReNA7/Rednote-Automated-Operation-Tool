export const M0_PACKAGE_BOUNDARY = 'shared' as const;

export { DESKTOP_BRIDGE_KEY, DESKTOP_IPC_CHANNELS, FOUNDATION_CHECK_KEYS } from './desktop-api.js';

export type {
  AppInfo,
  DesktopBridge,
  DesktopError,
  DesktopResult,
  FoundationCheckKey,
  FoundationHealth,
  RuntimeCapabilities,
  WindowState,
} from './desktop-api.js';
