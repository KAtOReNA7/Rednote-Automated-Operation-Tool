import { describe, expect, it } from 'vitest';

import { isAllowedResourceUrl, isTrustedRendererUrl } from '../apps/desktop/src/security-policy.js';
import { createSecureWebPreferences } from '../apps/desktop/src/window-factory.js';

describe('desktop renderer origin policy', () => {
  it.each([
    ['rednote://app/index.html', 'rednote://app/index.html', true],
    ['rednote://app/assets/app.js', 'rednote://app/index.html', true],
    ['rednote://app/index.html?smoke=1', 'rednote://app/index.html', true],
    ['rednote://app/v2.html#/v2/overview', 'rednote://app/v2.html', true],
    ['rednote://evil/index.html', 'rednote://app/index.html', false],
    ['https://app/index.html', 'rednote://app/index.html', false],
    ['file:///C:/secret.txt', 'rednote://app/index.html', false],
    ['javascript:alert(1)', 'rednote://app/index.html', false],
    ['data:text/html,bad', 'rednote://app/index.html', false],
    ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/', true],
    ['http://127.0.0.1:5173/route', 'http://127.0.0.1:5173/', true],
    ['http://localhost:5173/', 'http://127.0.0.1:5173/', false],
    ['http://127.0.0.1:5174/', 'http://127.0.0.1:5173/', false],
    ['https://127.0.0.1:5173/', 'http://127.0.0.1:5173/', false],
  ])('trust check for %s against %s is %s', (candidate, expected, allowed) => {
    expect(isTrustedRendererUrl(candidate, expected)).toBe(allowed);
  });

  it.each([
    ['rednote://app/assets/app.js', 'rednote://app/index.html', true],
    ['https://cdn.example/app.js', 'rednote://app/index.html', false],
    ['file:///C:/secret.txt', 'rednote://app/index.html', false],
    ['http://127.0.0.1:5173/src/main.tsx', 'http://127.0.0.1:5173/', true],
    ['ws://127.0.0.1:5173/socket', 'http://127.0.0.1:5173/', true],
    ['ws://127.0.0.1:5174/socket', 'http://127.0.0.1:5173/', false],
    ['wss://example.com/socket', 'http://127.0.0.1:5173/', false],
  ])('resource check for %s against %s is %s', (candidate, expected, allowed) => {
    expect(isAllowedResourceUrl(candidate, expected)).toBe(allowed);
  });

  it('pins every security-sensitive BrowserWindow preference', () => {
    expect(createSecureWebPreferences('C:\\应用 路径\\preload.cjs', true)).toEqual({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      preload: 'C:\\应用 路径\\preload.cjs',
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
  });

  it('only permits development tools in an unpackaged build', () => {
    expect(createSecureWebPreferences('preload.cjs', false).devTools).toBe(true);
    expect(createSecureWebPreferences('preload.cjs', true).devTools).toBe(false);
  });

  it('keeps every security preference while omitting preload for the isolated V2 window', () => {
    expect(createSecureWebPreferences(undefined, true)).toEqual({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
  });
});
