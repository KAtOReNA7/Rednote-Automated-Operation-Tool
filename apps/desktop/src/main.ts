import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

import { app, BrowserWindow, protocol, screen, session } from 'electron';

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

const APP_PROTOCOL = 'rednote';
const LOCAL_RENDERER_URL = `${APP_PROTOCOL}://app/index.html`;
const DEVELOPMENT_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/.*)?$/u;
const isSmokeMode = process.argv.includes('--issue006-smoke');
const smokeOutputPath = resolveSmokeOutputPath(process.argv);
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

    mainWindow.on('page-title-updated', (event, title) => {
      const renderer = parseRendererSmokeTitle(title);
      if (renderer === null) {
        return;
      }
      event.preventDefault();
      clearTimeout(timeout);
      const ok =
        renderer.appInfo &&
        renderer.foundation &&
        renderer.navigationCount === 10 &&
        renderer.preload &&
        renderer.renderer &&
        renderer.runtimeCapabilities &&
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
      });
      setTimeout(() => {
        app.exit(ok ? 0 : 4);
      }, 1_000);
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
    .catch(() => {
      if (isSmokeMode && smokeOutputPath !== null) {
        writeSmokeReport(smokeOutputPath, {
          error: 'STARTUP_FAILED',
          ok: false,
        });
      }
      app.exit(1);
    });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
