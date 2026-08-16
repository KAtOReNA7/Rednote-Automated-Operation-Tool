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
  parseV2RendererSmokeTitle,
  resolveSmokeOutputPath,
  writeSmokeReport,
} from './smoke-report.js';
import { createSecureWebPreferences } from './window-factory.js';
import { createWindowStateStore } from './window-state.js';
import { DesktopSettingsRuntime } from './settings-runtime.js';
import { registerV2Ipc, V2DesktopRuntime } from './v2-runtime.js';

const APP_PROTOCOL = 'rednote';
const LEGACY_RENDERER_URL = `${APP_PROTOCOL}://app/index.html`;
const V2_RENDERER_URL = `${APP_PROTOCOL}://app/v2.html`;
const DEVELOPMENT_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/.*)?$/u;
const isSmokeMode = process.argv.includes('--issue006-smoke');
const isV2ShellMode = process.argv.includes('--v2-shell');
const smokeOutputPath = resolveSmokeOutputPath(process.argv);
const SMOKE_PROCESS_SAMPLE_PREFIX = '__REDNOTE_SMOKE_PROCESS_SAMPLE__:';
const MAX_SMOKE_PROCESS_COUNT = 32;
const MAX_SMOKE_PROCESS_SAMPLE_BYTES = 4_096;

type SmokeProcessSampleStage = 'before-exit' | 'capability-validated' | 'ready';

async function emitSmokeProcessSample(stage: SmokeProcessSampleStage): Promise<void> {
  if (!isSmokeMode) {
    return;
  }
  const processesByPid = new Map<number, Electron.ProcessMetric['type']>([
    [process.pid, 'Browser'],
  ]);
  for (const metric of app.getAppMetrics()) {
    if (Number.isSafeInteger(metric.pid) && metric.pid > 0 && !processesByPid.has(metric.pid)) {
      processesByPid.set(metric.pid, metric.type);
    }
  }
  const processes = [...processesByPid]
    .sort(([left], [right]) => left - right)
    .map(([pid, type]) => ({ pid, type }));
  if (processes.length === 0 || processes.length > MAX_SMOKE_PROCESS_COUNT) {
    throw new Error('SMOKE_PROCESS_SAMPLE_LIMIT_EXCEEDED');
  }
  const line = `${SMOKE_PROCESS_SAMPLE_PREFIX}${JSON.stringify({
    processes,
    stage,
    truncated: false,
  })}`;
  if (Buffer.byteLength(line, 'utf8') > MAX_SMOKE_PROCESS_SAMPLE_BYTES) {
    throw new Error('SMOKE_PROCESS_SAMPLE_BYTES_EXCEEDED');
  }
  await new Promise<void>((resolveWrite, rejectWrite) => {
    process.stdout.write(`${line}\n`, (error) => {
      if (error !== null && error !== undefined) {
        rejectWrite(error);
        return;
      }
      resolveWrite();
    });
  });
}

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

function resolveR07Blackbox(argv: readonly string[]): { attempt: 1 | 2 | 3; port: number } | null {
  const portArgument = argv.find((value) => value.startsWith('--r07-blackbox-port='));
  const attemptArgument = argv.find((value) => value.startsWith('--r07-blackbox-attempt='));
  const port = Number(portArgument?.slice('--r07-blackbox-port='.length));
  const attempt = Number(attemptArgument?.slice('--r07-blackbox-attempt='.length));
  return Number.isSafeInteger(port) &&
    port >= 1_024 &&
    port <= 65_535 &&
    (attempt === 1 || attempt === 2 || attempt === 3)
    ? { attempt, port }
    : null;
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
const r07Blackbox = isSmokeMode ? resolveR07Blackbox(process.argv) : null;
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
});
let screenshotReader:
  | ((clipId: string) => Promise<{
      readonly bytes: Uint8Array;
      readonly mime: 'image/jpeg' | 'image/png';
    } | null>)
  | null = null;
let v2CoverReader: ((packageId: string, version: number) => Promise<Uint8Array | null>) | null =
  null;

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
  if (candidate !== undefined && DEVELOPMENT_URL_PATTERN.test(candidate)) {
    return isV2ShellMode ? new URL('/v2.html', candidate).toString() : candidate;
  }
  return isV2ShellMode ? V2_RENDERER_URL : LEGACY_RENDERER_URL;
}

function registerLocalRendererProtocol(rendererRoot: string): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') {
      return new Response('Not found', { status: 404 });
    }
    const screenshotMatch = /^\/clip-screenshot\/(clip-[0-9a-f-]{36})$/u.exec(url.pathname);
    if (screenshotMatch !== null) {
      if (url.search !== '' || url.hash !== '' || screenshotReader === null) {
        return new Response('Not found', { status: 404 });
      }
      const screenshot = await screenshotReader(screenshotMatch[1] ?? '');
      if (screenshot === null) return new Response('Not found', { status: 404 });
      return new Response(Uint8Array.from(screenshot.bytes).buffer, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': screenshot.mime,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const coverMatch = /^\/v2-cover\/(pkg-[a-z0-9_-]{1,96})\/(\d{1,6})$/u.exec(url.pathname);
    if (coverMatch !== null) {
      if (url.search !== '' || url.hash !== '' || v2CoverReader === null)
        return new Response('Not found', { status: 404 });
      const bytes = await v2CoverReader(coverMatch[1] ?? '', Number(coverMatch[2]));
      if (bytes === null) return new Response('Not found', { status: 404 });
      return new Response(Uint8Array.from(bytes).buffer, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'image/png',
          'X-Content-Type-Options': 'nosniff',
        },
      });
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

async function startV2Application(
  expectedRendererUrl: string,
  sessionSecurityAudit: ReturnType<typeof installSessionSecurity>,
): Promise<void> {
  const settingsRuntime = new DesktopSettingsRuntime(app.getPath('userData'), safeStorage, dialog, {
    appVersion: app.getVersion(),
    chromiumVersion: process.versions.chrome ?? 'unknown',
    electronVersion: process.versions.electron ?? 'unknown',
    nodeVersion: process.versions.node,
  });
  await settingsRuntime.initialize();
  const projectRoot = await settingsRuntime.ensureV2Project(
    join(app.getPath('userData'), 'v2-project-data'),
  );
  const runtime = await V2DesktopRuntime.openProject(projectRoot, {
    providerExecution: {
      execute: (request) => settingsRuntime.executeV2ProviderAction(request),
      inspect: (request) => settingsRuntime.inspectV2ProviderAction(request),
      inspectContentCopy: (request) => settingsRuntime.inspectV2ContentCopy(request),
    },
    settingsControl: {
      clearCredential: () => settingsRuntime.clearV2ProviderCredential(),
      getCapabilityProgress: (runId) => settingsRuntime.getV2ProviderCapabilityProbeProgress(runId),
      getSettings: () => settingsRuntime.getV2ProviderSettings(),
      previewCapabilityProbe: (caller) =>
        settingsRuntime.previewV2ProviderCapabilityProbe(caller.senderId, caller.windowId),
      setCredential: (plaintext) => settingsRuntime.setV2ProviderCredential(plaintext),
      startCapabilityProbe: (input, caller) =>
        settingsRuntime.startV2ProviderCapabilityProbe(input, caller.senderId, caller.windowId),
      updateSettings: (input) => settingsRuntime.updateV2ProviderSettings(input),
    },
  });
  v2CoverReader = (packageId, version) => runtime.readGeneratedCover(packageId, version);
  let runtimeClosed = false;
  let removeIpcHandlers = (): void => undefined;
  const closeRuntime = (): void => {
    if (runtimeClosed) return;
    removeIpcHandlers();
    runtime.close();
    v2CoverReader = null;
    void settingsRuntime.close();
    runtimeClosed = true;
  };
  let mainWindow: BrowserWindow | null = new BrowserWindow({
    backgroundColor: '#fbfaf7',
    height: 820,
    minHeight: 640,
    minWidth: 960,
    show: false,
    title: 'Rednote V2 · 本机工作台',
    webPreferences: createSecureWebPreferences(
      join(app.getAppPath(), '.vite', 'build', 'v2-preload.cjs'),
      app.isPackaged,
    ),
    width: 1360,
  });
  attachWebContentsSecurity(mainWindow.webContents, expectedRendererUrl);
  removeIpcHandlers = registerV2Ipc({
    expectedRendererUrl,
    getWindow: () => mainWindow,
    runtime,
  });
  mainWindow.once('ready-to-show', () => {
    if (!isSmokeMode) mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    closeRuntime();
    mainWindow = null;
  });

  if (isSmokeMode) {
    if (smokeOutputPath === null) {
      app.exit(2);
      return;
    }
    const timeout = setTimeout(
      () => {
        writeSmokeReport(smokeOutputPath, { error: 'V2_SMOKE_TIMEOUT', ok: false });
        closeRuntime();
        app.exit(3);
      },
      r07Blackbox === null ? 20_000 : 60_000,
    );
    let reported = false;
    mainWindow.on('page-title-updated', (event, title) => {
      const renderer = parseV2RendererSmokeTitle(title);
      if (renderer === null || reported) return;
      reported = true;
      event.preventDefault();
      clearTimeout(timeout);
      void (async () => {
        const persistence = renderer.marker
          ? runtime.smokeSummary()
          : { personaRevision: -1, planRevision: -1, v2TableCount: 8 };
        const blackbox = renderer.blackbox;
        const ok =
          renderer.marker &&
          !renderer.mockMode &&
          renderer.navigationCount === 7 &&
          renderer.preload &&
          persistence.v2TableCount === 8 &&
          sessionSecurityAudit.externalRequestAttempts === 0 &&
          (r07Blackbox === null
            ? persistence.personaRevision === 0 && persistence.planRevision === 2
            : blackbox?.attempt === r07Blackbox.attempt &&
              blackbox.buildCommit.length === 40 &&
              (r07Blackbox.attempt === 1
                ? !blackbox.commentPersisted &&
                  blackbox.contentCount === 0 &&
                  !blackbox.directMessagePersisted
                : blackbox.commentPersisted &&
                  blackbox.contentCount === 3 &&
                  blackbox.directMessagePersisted) &&
              blackbox.imageRequestCount === 0 &&
              (r07Blackbox.attempt === 1
                ? !blackbox.previewCanConfirm && blackbox.previewRequestCount === 0
                : blackbox.previewCanConfirm && blackbox.previewRequestCount === 3) &&
              blackbox.providerProtocol === 'CHAT_COMPLETIONS');
        await emitSmokeProcessSample('capability-validated');
        writeSmokeReport(smokeOutputPath, {
          main: true,
          mode: 'v2',
          ok,
          packaged: app.isPackaged,
          renderer,
          runtime: {
            ipcRegistered: true,
            ...persistence,
            projectDataRootInitialized: true,
            sqliteInitialized: true,
          },
          runtimeVersion: process.versions.electron ?? 'unknown',
          security: {
            contextIsolation: true,
            externalRequestAttempts: sessionSecurityAudit.externalRequestAttempts,
            navigationDenied: true,
            networkDenied: true,
            nodeIntegration: false,
            preload: true,
            sandbox: true,
            webviewDenied: true,
          },
        });
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000));
        await emitSmokeProcessSample('before-exit');
        closeRuntime();
        app.exit(ok ? 0 : 4);
      })().catch((error: unknown) => {
        try {
          writeSmokeReport(smokeOutputPath, {
            error: 'V2_SMOKE_MAIN_HANDLER_FAILED',
            errorCode:
              typeof error === 'object' && error !== null && 'code' in error
                ? String(error.code).slice(0, 64)
                : null,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            ok: false,
          });
        } catch {
          // The original bounded failure remains authoritative when the report path is unavailable.
        }
        app.exit(5);
      });
    });
  }

  const targetUrl = new URL(expectedRendererUrl);
  targetUrl.hash = '/v2/overview';
  if (isSmokeMode) targetUrl.searchParams.set('smoke', '1');
  if (r07Blackbox !== null) {
    targetUrl.searchParams.set('r07BlackboxPort', String(r07Blackbox.port));
    targetUrl.searchParams.set('r07BlackboxAttempt', String(r07Blackbox.attempt));
  }
  await mainWindow.loadURL(targetUrl.toString());
}

async function startLegacyApplication(
  expectedRendererUrl: string,
  sessionSecurityAudit: ReturnType<typeof installSessionSecurity>,
): Promise<void> {
  const foundationHealth = runFoundationHealthCheck();
  const settingsRuntime = new DesktopSettingsRuntime(app.getPath('userData'), safeStorage, dialog, {
    appVersion: app.getVersion(),
    chromiumVersion: process.versions.chrome ?? 'unknown',
    electronVersion: process.versions.electron ?? 'unknown',
    nodeVersion: process.versions.node,
  });
  screenshotReader = (clipId) => settingsRuntime.readBrowserClipScreenshot(clipId);
  let runtimeClosed = false;
  let shutdownStarted = false;
  const closeRuntime = async (): Promise<void> => {
    if (runtimeClosed) {
      return;
    }
    await settingsRuntime.close();
    screenshotReader = null;
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
            renderer.navigationCount === 11 &&
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
          await emitSmokeProcessSample('capability-validated');
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
          await emitSmokeProcessSample('before-exit');
          await closeRuntime();
          app.exit(ok ? 0 : 4);
        } catch (error: unknown) {
          await closeRuntime().catch(() => undefined);
          if (!smokeReportWritten) {
            writeSmokeReport(smokeOutputPath, {
              ...(error instanceof SettingsError && error.context !== undefined
                ? { context: error.context }
                : {}),
              error: 'STORAGE_SMOKE_FAILED',
              errorCode:
                error instanceof Error && 'code' in error && typeof error.code === 'string'
                  ? error.code
                  : 'NONE',
              errorName: error instanceof Error ? error.name : 'UNKNOWN',
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

async function startApplication(): Promise<void> {
  await emitSmokeProcessSample('ready');
  const expectedRendererUrl = rendererUrl();
  registerLocalRendererProtocol(join(app.getAppPath(), '.vite', 'renderer'));
  const sessionSecurityAudit = installSessionSecurity(session.defaultSession, expectedRendererUrl);
  if (isV2ShellMode) {
    await startV2Application(expectedRendererUrl, sessionSecurityAudit);
    return;
  }
  await startLegacyApplication(expectedRendererUrl, sessionSecurityAudit);
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
