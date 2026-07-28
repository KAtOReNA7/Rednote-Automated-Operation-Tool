export { runFoundationHealthCheck } from './foundation-health.js';
export { registerDesktopIpc } from './ipc.js';
export { validateDesktopIpcRequest } from './ipc-policy.js';
export { DesktopLocalApiRuntime } from './local-api-runtime.js';
export { decodeBrowserClipScreenshot, DesktopBrowserClipRuntime } from './browser-clip-runtime.js';
export {
  attachWebContentsSecurity,
  installSessionSecurity,
  isAllowedResourceUrl,
  isTrustedRendererUrl,
} from './security-policy.js';
export { createSecureWebPreferences } from './window-factory.js';
export {
  createWindowStateStore,
  normalizeWindowBounds,
  parsePersistedWindowState,
} from './window-state.js';

export type { WindowBounds, WindowStateStore, WorkArea } from './window-state.js';
