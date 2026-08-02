import type { WebPreferences } from 'electron';

export function createSecureWebPreferences(
  preloadPath: string | undefined,
  production: boolean,
): WebPreferences {
  return {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    devTools: !production,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    ...(preloadPath === undefined ? {} : { preload: preloadPath }),
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  };
}
