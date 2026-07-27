export const DESKTOP_BRIDGE_KEY = 'rednoteDesktop' as const;

export const DESKTOP_IPC_CHANNELS = Object.freeze({
  getAppInfo: 'desktop:get-app-info',
  getFoundationHealth: 'desktop:get-foundation-health',
  getRuntimeCapabilities: 'desktop:get-runtime-capabilities',
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
  readonly code: 'FOUNDATION_UNAVAILABLE' | 'INTERNAL_ERROR' | 'INVALID_REQUEST';
  readonly message: string;
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

export interface DesktopBridge {
  getAppInfo(): Promise<DesktopResult<AppInfo>>;
  getFoundationHealth(): Promise<DesktopResult<FoundationHealth>>;
  getRuntimeCapabilities(): Promise<DesktopResult<RuntimeCapabilities>>;
  getWindowState(): Promise<DesktopResult<WindowState>>;
}
