import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { app, BrowserWindow, dialog, protocol, safeStorage, screen, session } from 'electron';

import { SettingsError } from '@mystery-operations/settings';

import { runFoundationHealthCheck } from './foundation-health.js';
import { registerDesktopIpc } from './ipc.js';
import { attachWebContentsSecurity, installSessionSecurity } from './security-policy.js';
import {
  parseRendererSmokeTitle,
  resolveSmokeOutputPath,
  writeSmokeReport,
} from './smoke-report.js';
import { createSecureWebPreferences } from './window-factory.js';
import { createWindowStateStore } from './window-state.js';
import { DesktopSettingsRuntime } from './settings-runtime.js';

const APP_PROTOCOL = 'rednote';
const LOCAL_RENDERER_URL = `${APP_PROTOCOL}://app/index.html`;
const DEVELOPMENT_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/.*)?$/u;
const isSmokeMode = process.argv.includes('--issue006-smoke');
const smokeOutputPath = resolveSmokeOutputPath(process.argv);

function resolveLocalApiSmoke(argv: readonly string[]): {
  readonly mode: 'disabled' | 'enabled';
  readonly port: number;
} | null {
  const modeArgument = argv.find((value) => value.startsWith('--issue011-smoke-mode='));
  const portArgument = argv.find((value) => value.startsWith('--issue011-smoke-port='));
  const mode = modeArgument?.slice('--issue011-smoke-mode='.length);
  const port = Number(portArgument?.slice('--issue011-smoke-port='.length));
  return (mode === 'disabled' || mode === 'enabled') &&
    Number.isSafeInteger(port) &&
    port >= 1_024 &&
    port <= 65_535
    ? { mode, port }
    : null;
}

function resolveCapabilitySmokePort(argv: readonly string[]): number | null {
  const prefix = '--issue013-smoke-port=';
  const argument = argv.find((value) => value.startsWith(prefix));
  const port = Number(argument?.slice(prefix.length));
  return Number.isSafeInteger(port) && port >= 1_024 && port <= 65_535 ? port : null;
}

function resolveSmokeWorkspacePath(argv: readonly string[]): string | null {
  const prefix = '--issue010-smoke-workspace=';
  const argument = argv.find((value) => value.startsWith(prefix));
  if (argument === undefined) {
    return null;
  }
  const candidate = resolve(argument.slice(prefix.length));
  const temporaryRoot = resolve(tmpdir());
  const relativePath = relative(temporaryRoot, candidate);
  const name = candidate.split(/[\\/]/u).at(-1) ?? '';
  return isAbsolute(candidate) &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath) &&
    /^rednote-issue010-smoke-[a-zA-Z0-9-]+$/u.test(name)
    ? candidate
    : null;
}

const smokeWorkspacePath = isSmokeMode ? resolveSmokeWorkspacePath(process.argv) : null;
const localApiSmoke = isSmokeMode ? resolveLocalApiSmoke(process.argv) : null;
const capabilitySmokePort = isSmokeMode ? resolveCapabilitySmokePort(process.argv) : null;
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
});

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      allowServiceWorkers: false,
      bypassCSP: false,
      corsEnabled: false,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: APP_PROTOCOL,
  },
]);

if (smokeWorkspacePath !== null) {
  const isolatedUserData = join(smokeWorkspacePath, 'userData 中文 空格');
  mkdirSync(isolatedUserData, { recursive: true });
  app.setPath('userData', isolatedUserData);
}

function rendererUrl(): string {
  const candidate = process.env.DESKTOP_DEV_SERVER_URL;
  return candidate !== undefined && DEVELOPMENT_URL_PATTERN.test(candidate)
    ? candidate
    : LOCAL_RENDERER_URL;
}

function registerLocalRendererProtocol(rendererRoot: string): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') {
      return new Response('Not found', { status: 404 });
    }

    const decodedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const candidate = resolve(rendererRoot, `.${decodedPath}`);
    const relativePath = relative(rendererRoot, candidate);

    if (relativePath.startsWith(`..${sep}`) || relativePath === '..' || !existsSync(candidate)) {
      return new Response('Not found', { status: 404 });
    }

    const contentType = CONTENT_TYPES[extname(candidate).toLowerCase()];
    if (contentType === undefined) {
      return new Response('Unsupported resource', { status: 415 });
    }
    const content = await readFile(candidate);
    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}

async function startApplication(): Promise<void> {
  const expectedRendererUrl = rendererUrl();
  const rendererRoot = join(app.getAppPath(), '.vite', 'renderer');
  if (expectedRendererUrl === LOCAL_RENDERER_URL) {
    registerLocalRendererProtocol(rendererRoot);
  }

  const sessionSecurityAudit = installSessionSecurity(session.defaultSession, expectedRendererUrl);
  const foundationHealth = runFoundationHealthCheck();
  const settingsRuntime = new DesktopSettingsRuntime(app.getPath('userData'), safeStorage, dialog, {
    appVersion: app.getVersion(),
    chromiumVersion: process.versions.chrome ?? 'unknown',
    electronVersion: process.versions.electron ?? 'unknown',
    nodeVersion: process.versions.node,
  });
  let runtimeClosed = false;
  let shutdownStarted = false;
  const closeRuntime = async (): Promise<void> => {
    if (runtimeClosed) {
      return;
    }
    await settingsRuntime.close();
    runtimeClosed = true;
  };
  app.on('before-quit', (event) => {
    if (runtimeClosed) {
      return;
    }
    event.preventDefault();
    if (!shutdownStarted) {
      shutdownStarted = true;
      void closeRuntime().finally(() => app.quit());
    }
  });
  await settingsRuntime.initialize();
  if (isSmokeMode && (localApiSmoke === null || capabilitySmokePort === null)) {
    throw new Error('INVALID_LOCAL_API_SMOKE_ARGUMENTS');
  }
  const settingsSmoke =
    smokeWorkspacePath === null
      ? null
      : await settingsRuntime.runIsolatedSmoke(
          join(smokeWorkspacePath, 'project data 中文 空格'),
          `unusable-runtime-${randomUUID()}`,
          {
            mode: localApiSmoke?.mode ?? 'disabled',
            port: localApiSmoke?.port ?? 43_119,
            windowId: 11,
          },
          {
            port: capabilitySmokePort ?? 43_120,
            windowId: 13,
          },
        );
  const stateStore = createWindowStateStore(join(app.getPath('userData'), 'window-state.json'));
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const persistedState = stateStore.load(workAreas);

  let mainWindow: BrowserWindow | null = new BrowserWindow({
    ...persistedState.bounds,
    backgroundColor: '#101417',
    minHeight: 640,
    minWidth: 960,
    show: false,
    title: '红笺本地运营台',
    webPreferences: createSecureWebPreferences(
      join(app.getAppPath(), '.vite', 'build', 'preload.cjs'),
      app.isPackaged,
    ),
  });
  attachWebContentsSecurity(mainWindow.webContents, expectedRendererUrl);
  const removeIpcHandlers = registerDesktopIpc({
    expectedRendererUrl,
    foundationHealth,
    getWindow: () => mainWindow,
    settingsRuntime,
  });

  if (persistedState.isMaximized && !isSmokeMode) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    if (!isSmokeMode) {
      mainWindow?.show();
    }
  });
  mainWindow.on('close', () => {
    if (mainWindow !== null && !isSmokeMode) {
      stateStore.save({
        bounds: mainWindow.getNormalBounds(),
        isMaximized: mainWindow.isMaximized(),
      });
    }
  });
  mainWindow.on('closed', () => {
    if (mainWindow !== null) {
      settingsRuntime.clearWindowSelections(mainWindow.id);
    }
    removeIpcHandlers();
    mainWindow = null;
  });

  if (isSmokeMode) {
    if (smokeOutputPath === null) {
      app.exit(2);
      return;
    }
    const timeout = setTimeout(() => {
      writeSmokeReport(smokeOutputPath, {
        error: 'SMOKE_TIMEOUT',
        ok: false,
      });
      app.exit(3);
    }, 20_000);

    let smokeReported = false;
    let smokeReportWritten = false;
    mainWindow.on('page-title-updated', (event, title) => {
      const renderer = parseRendererSmokeTitle(title);
      if (renderer === null || smokeReported) {
        return;
      }
      smokeReported = true;
      event.preventDefault();
      clearTimeout(timeout);
      void (async () => {
        try {
          await foundationHealth;
          const ok =
            renderer.appInfo &&
            renderer.foundation &&
            renderer.localApiBridge &&
            renderer.navigationCount === 10 &&
            renderer.preload &&
            renderer.renderer &&
            renderer.runtimeCapabilities &&
            renderer.settings &&
            renderer.setupState &&
            renderer.credentialStatus &&
            settingsSmoke?.capability.matrixComplete === true &&
            settingsSmoke.capability.startupAutoRequestCount === 0 &&
            settingsSmoke.capability.status === 'SUCCEEDED' &&
            settingsSmoke.capability.sentRequestCount ===
              settingsSmoke.capability.plannedRequestCount &&
            settingsSmoke.credentialCleared === true &&
            settingsSmoke.credentialRoundtrip &&
            settingsSmoke.locator &&
            settingsSmoke.safeStorage &&
            settingsSmoke.secretEgressSafeCount === 50 &&
            settingsSmoke.settings &&
            settingsSmoke.localApi.mode === localApiSmoke?.mode &&
            settingsSmoke.localApi.enabled === (localApiSmoke?.mode === 'enabled') &&
            settingsSmoke.localApi.port ===
              (localApiSmoke?.mode === 'enabled' ? localApiSmoke.port : 43_119) &&
            settingsSmoke.localApi.pairingAuthRotationRevoke &&
            settingsSmoke.localApi.hostRejected &&
            settingsSmoke.localApi.originRejectedWithoutAcao &&
            settingsSmoke.localApi.oversizedBodyRejected &&
            settingsSmoke.localApi.preflight &&
            renderer.windowState &&
            sessionSecurityAudit.externalRequestAttempts === 0;
          writeSmokeReport(smokeOutputPath, {
            main: true,
            ok,
            packaged: app.isPackaged,
            renderer,
            runtimeVersion: process.versions.electron ?? 'unknown',
            security: {
              contextIsolation: true,
              externalRequestAttempts: sessionSecurityAudit.externalRequestAttempts,
              navigationDenied: true,
              networkDenied: true,
              nodeIntegration: false,
              sandbox: true,
              webviewDenied: true,
            },
            settings: settingsSmoke,
            storage: true,
          });
          smokeReportWritten = true;
          await new Promise<void>((resolveDelay) => {
            setTimeout(resolveDelay, 5_000);
          });
          await closeRuntime();
          app.exit(ok ? 0 : 4);
        } catch {
          await closeRuntime().catch(() => undefined);
          if (!smokeReportWritten) {
            writeSmokeReport(smokeOutputPath, {
              error: 'STORAGE_SMOKE_FAILED',
              ok: false,
            });
          }
          app.exit(5);
        }
      })();
    });
  }

  const targetUrl = new URL(expectedRendererUrl);
  if (isSmokeMode) {
    targetUrl.searchParams.set('smoke', '1');
  }
  await mainWindow.loadURL(targetUrl.toString());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window !== undefined) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });
  app
    .whenReady()
    .then(startApplication)
    .catch((error: unknown) => {
      if (isSmokeMode && smokeOutputPath !== null) {
        writeSmokeReport(smokeOutputPath, {
          ...(error instanceof SettingsError && error.context !== undefined
            ? { context: error.context }
            : {}),
          error: error instanceof SettingsError ? error.code : 'STARTUP_FAILED',
          ok: false,
        });
      }
      app.exit(1);
    });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
