import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  connectDatabase,
  initializeDatabase,
  SqliteLocalApiRepository,
} from '../packages/db/dist/index.js';
import { LocalApiServer } from '../packages/local-api/dist/index.js';
import {
  BROWSER_CLIP_BUILD_VERSION,
  BROWSER_CLIP_CONTRACT_VERSION,
} from '../packages/shared/dist/index.js';
import { initializeProjectDataRoot } from '../packages/storage/dist/index.js';
import { DesktopBrowserClipRuntime } from '../apps/desktop/dist/browser-clip-runtime.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixtureBindHost = '127.0.0.1';
const fixtureHostname = 'issue017-fixture.localhost';
const temporaryRoot = join(repositoryRoot, '.rednote-temp', 'clipper-real-smoke');
const evidencePath = join(
  repositoryRoot,
  'docs',
  'evidence',
  'm2-issue017-real-browser-smoke.json',
);
const actionScript = join(repositoryRoot, 'scripts', 'trigger-clipper-action.ps1');
const families = Object.freeze([
  {
    artifact: join(repositoryRoot, 'out', 'clipper', 'chrome-unpacked'),
    expectedProduct: /Chrome\//u,
    installSegments: ['Google', 'Chrome', 'Application', 'chrome.exe'],
    label: 'Chrome',
    slug: 'chrome',
  },
  {
    artifact: join(repositoryRoot, 'out', 'clipper', 'edge-unpacked'),
    expectedProduct: /(?:Edg|Microsoft Edge)\//u,
    installSegments: ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    label: 'Edge',
    slug: 'edge',
  },
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function safeRemove(path) {
  assert(isWithin(repositoryRoot, path), 'Refusing to remove a path outside the repository.');
  await rm(path, { force: true, maxRetries: 4, recursive: true, retryDelay: 150 });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitFor(read, description, timeoutMilliseconds = 20_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== undefined && value !== null && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `${description} timed out.${lastError instanceof Error ? ` ${lastError.message}` : ''}`,
  );
}

async function allocatePort() {
  const server = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: fixtureBindHost, port: 0 }, resolveListen);
  });
  const address = server.address();
  assert(address !== null && typeof address !== 'string', 'Dynamic port allocation failed.');
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error))),
  );
  return address.port;
}

function executableCandidates(family) {
  const bases = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  const fromInstallRoots = bases.map((base) => join(base, ...family.installSegments));
  const fromPath = spawnSync('where.exe', [family.installSegments.at(-1)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const fromWhere =
    fromPath.status === 0
      ? fromPath.stdout
          .split(/\r?\n/u)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  return [...new Set([...fromWhere, ...fromInstallRoots])];
}

function discoverExecutable(family) {
  const executable = executableCandidates(family).find((candidate) => existsSync(candidate));
  assert(executable !== undefined, `${family.label} executable was not found.`);
  return executable;
}

class CdpClient {
  #listeners = new Map();
  #nextId = 1;
  #pending = new Map();
  #socket;

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener(
        'error',
        () => rejectOpen(new Error('Unable to connect to the loopback CDP endpoint.')),
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === 'number') {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (message.error !== undefined) {
          pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        } else {
          pending.resolve(message.result ?? {});
        }
        return;
      }
      if (typeof message.method !== 'string') return;
      for (const listener of this.#listeners.get(message.method) ?? []) {
        listener(message.params ?? {}, message.sessionId);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error('CDP connection closed.'));
      }
      this.#pending.clear();
    });
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? [];
    listeners.push(listener);
    this.#listeners.set(method, listeners);
    return () => {
      const current = this.#listeners.get(method) ?? [];
      this.#listeners.set(
        method,
        current.filter((value) => value !== listener),
      );
    };
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const payload = { id, method, params, ...(sessionId === undefined ? {} : { sessionId }) };
    return new Promise((resolveCommand, rejectCommand) => {
      this.#pending.set(id, { method, reject: rejectCommand, resolve: resolveCommand });
      this.#socket.send(JSON.stringify(payload));
    });
  }

  close() {
    this.#socket.close();
  }
}

async function attach(client, targetId) {
  const { sessionId } = await client.send('Target.attachToTarget', { flatten: true, targetId });
  return sessionId;
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      awaitPromise: true,
      expression,
      returnByValue: true,
      userGesture: false,
    },
    sessionId,
  );
  if (result.exceptionDetails !== undefined) {
    throw new Error('Runtime evaluation failed.');
  }
  return result.result?.value;
}

async function queryNode(client, sessionId, selector) {
  const { root } = await client.send('DOM.getDocument', { depth: 1, pierce: true }, sessionId);
  const { nodeId } = await client.send(
    'DOM.querySelector',
    { nodeId: root.nodeId, selector },
    sessionId,
  );
  assert(nodeId !== 0, `Popup element was not found: ${selector}`);
  return nodeId;
}

async function click(client, sessionId, selector) {
  const model = await waitFor(
    async () => {
      const nodeId = await queryNode(client, sessionId, selector);
      return (await client.send('DOM.getBoxModel', { nodeId }, sessionId)).model;
    },
    `stable popup box model for ${selector}`,
    5_000,
  );
  const x = (model.content[0] + model.content[2] + model.content[4] + model.content[6]) / 4;
  const y = (model.content[1] + model.content[3] + model.content[5] + model.content[7]) / 4;
  await client.send(
    'Input.dispatchMouseEvent',
    { button: 'left', buttons: 1, clickCount: 1, type: 'mousePressed', x, y },
    sessionId,
  );
  await client.send(
    'Input.dispatchMouseEvent',
    { button: 'left', buttons: 0, clickCount: 1, type: 'mouseReleased', x, y },
    sessionId,
  );
}

async function pressSpace(client, sessionId, selector) {
  const nodeId = await queryNode(client, sessionId, selector);
  await client.send('DOM.focus', { nodeId }, sessionId);
  await client.send(
    'Input.dispatchKeyEvent',
    {
      code: 'Space',
      key: ' ',
      nativeVirtualKeyCode: 32,
      text: ' ',
      type: 'keyDown',
      windowsVirtualKeyCode: 32,
    },
    sessionId,
  );
  await client.send(
    'Input.dispatchKeyEvent',
    {
      code: 'Space',
      key: ' ',
      nativeVirtualKeyCode: 32,
      type: 'keyUp',
      windowsVirtualKeyCode: 32,
    },
    sessionId,
  );
}

async function fill(client, sessionId, selector, value) {
  await waitFor(
    async () => {
      const nodeId = await queryNode(client, sessionId, selector);
      await client.send('DOM.focus', { nodeId }, sessionId);
      return true;
    },
    `stable popup focus for ${selector}`,
    5_000,
  );
  await client.send(
    'Input.dispatchKeyEvent',
    {
      code: 'KeyA',
      key: 'a',
      modifiers: 2,
      nativeVirtualKeyCode: 65,
      type: 'rawKeyDown',
      windowsVirtualKeyCode: 65,
    },
    sessionId,
  );
  await client.send(
    'Input.dispatchKeyEvent',
    {
      code: 'KeyA',
      key: 'a',
      modifiers: 2,
      nativeVirtualKeyCode: 65,
      type: 'keyUp',
      windowsVirtualKeyCode: 65,
    },
    sessionId,
  );
  await client.send(
    'Input.dispatchKeyEvent',
    {
      code: 'Backspace',
      key: 'Backspace',
      nativeVirtualKeyCode: 8,
      type: 'keyDown',
      windowsVirtualKeyCode: 8,
    },
    sessionId,
  );
  await client.send('Input.insertText', { text: value }, sessionId);
}

async function chooseLastOption(client, sessionId, selector) {
  await waitFor(
    async () => {
      const nodeId = await queryNode(client, sessionId, selector);
      await client.send('DOM.focus', { nodeId }, sessionId);
      return true;
    },
    `stable popup focus for ${selector}`,
    5_000,
  );
  await client.send(
    'Input.dispatchKeyEvent',
    {
      code: 'End',
      key: 'End',
      nativeVirtualKeyCode: 35,
      type: 'keyDown',
      windowsVirtualKeyCode: 35,
    },
    sessionId,
  );
  await client.send(
    'Input.dispatchKeyEvent',
    {
      code: 'End',
      key: 'End',
      nativeVirtualKeyCode: 35,
      type: 'keyUp',
      windowsVirtualKeyCode: 35,
    },
    sessionId,
  );
}

async function createFixture(family, nonce) {
  const server = createHttpServer((request, response) => {
    const expected = `/?nonce=${encodeURIComponent(nonce)}`;
    if (request.url !== expected || request.method !== 'GET') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Issue 017 ${family.label} 真实侧载</title>
<style>body{font:20px system-ui;margin:48px;max-width:760px}strong{color:#d21f3c}</style></head>
<body data-smoke-nonce="${nonce}"><h1>Issue 017 公开页面侧载验证</h1>
<p id="sample">这是用户主动选择的公开页面文字，仅用于 ${family.label} 本机 loopback 验证。</p>
<p><strong>没有真实 API、没有平台自动化、没有费用。</strong></p></body></html>`);
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0 }, resolveListen);
  });
  const address = server.address();
  assert(address !== null && typeof address !== 'string', 'Fixture listener failed.');
  return {
    close: () =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error))),
      ),
    url: `http://${fixtureHostname}:${address.port}/?nonce=${encodeURIComponent(nonce)}`,
  };
}

async function waitForDevTools(profilePath) {
  const activePortPath = join(profilePath, 'DevToolsActivePort');
  const contents = await waitFor(async () => {
    if (!existsSync(activePortPath)) return undefined;
    const value = await readFile(activePortPath, 'utf8');
    return value.split(/\r?\n/u).length >= 2 ? value : undefined;
  }, 'DevToolsActivePort');
  const [portText, browserPath] = contents.split(/\r?\n/u);
  const port = Number(portText);
  assert(Number.isSafeInteger(port) && port > 0 && port <= 65_535, 'Invalid dynamic CDP port.');
  assert(browserPath?.startsWith('/devtools/browser/'), 'Invalid browser CDP path.');
  return { port, url: `ws://127.0.0.1:${port}${browserPath}` };
}

async function waitForTarget(client, predicate, description, timeoutMilliseconds = 20_000) {
  return waitFor(
    async () => {
      const { targetInfos } = await client.send('Target.getTargets');
      return targetInfos.find(predicate);
    },
    description,
    timeoutMilliseconds,
  );
}

async function openInspectablePopup(client, extensionId) {
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const { targetId } = await client.send('Target.createTarget', {
    background: true,
    url: popupUrl,
  });
  return waitForTarget(
    client,
    (target) => target.targetId === targetId && target.url === popupUrl,
    'inspectable extension popup',
  );
}

async function verifyRealActionGrant(
  client,
  serviceWorkerSession,
  expectedUrl,
  expectedTitle,
  expectedSelection,
) {
  const result = await waitFor(
    () =>
      evaluate(
        client,
        serviceWorkerSession,
        `(async () => {
          const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
          if (tab?.id === undefined) return null;
          try {
            const [capture] = await chrome.scripting.executeScript({
              target: {allFrames: false, tabId: tab.id},
              world: 'ISOLATED',
              func: () => ({
                pageTitle: document.title,
                pageUrl: location.href,
                selectedText: getSelection()?.toString() ?? ''
              })
            });
            return capture?.frameId === 0 ? capture.result : null;
          } catch {
            return null;
          }
        })()`,
      ),
    'activeTab grant from the real extension action',
  );
  assert(
    result.pageUrl === expectedUrl &&
      result.pageTitle === expectedTitle &&
      result.selectedText === expectedSelection,
    'The real action did not grant the expected activeTab page fields.',
  );
}

function triggerAction(browserProcessId, browserFamily) {
  const process = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      actionScript,
      '-BrowserProcessId',
      String(browserProcessId),
      '-BrowserFamily',
      browserFamily,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );
  return new Promise((resolveAction, rejectAction) => {
    let diagnostic = '';
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk) => {
      diagnostic = `${diagnostic}${chunk}`.slice(-1_000);
    });
    const timer = setTimeout(() => {
      process.kill();
      rejectAction(new Error('The real extension action shortcut timed out.'));
    }, 15_000);
    process.once('error', (error) => {
      clearTimeout(timer);
      rejectAction(error);
    });
    process.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveAction();
      else
        rejectAction(
          new Error(
            `The real extension action shortcut could not be triggered.${
              diagnostic.trim() === '' ? '' : ` ${diagnostic.trim()}`
            }`,
          ),
        );
    });
  });
}

async function closeProcess(client, browserProcess) {
  try {
    await client.send('Browser.close');
  } catch {
    // The browser may close the WebSocket before acknowledging Browser.close.
  }
  const exited = await Promise.race([
    new Promise((resolveExit) => browserProcess.once('exit', () => resolveExit(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited) {
    spawnSync('taskkill.exe', ['/PID', String(browserProcess.pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    });
  }
}

function recordExtensionRequest(requestLog, endpoint, params) {
  if (typeof params.request?.url !== 'string' || typeof params.request?.method !== 'string') return;
  const url = new URL(params.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  assert(url.origin === endpoint, 'The extension attempted a non-configured network request.');
  requestLog.push({
    authority: '127.0.0.1:<dynamic>',
    method: params.request.method,
    path: url.pathname,
  });
}

function recordExtensionResponse(responseLog, endpoint, params) {
  if (typeof params.response?.url !== 'string' || typeof params.response?.status !== 'number')
    return;
  const url = new URL(params.response.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  assert(url.origin === endpoint, 'The extension received a non-configured network response.');
  responseLog.push({
    path: url.pathname,
    status: params.response.status,
  });
}

async function runFamily(family) {
  const executable = discoverExecutable(family);
  assert(existsSync(family.artifact), `${family.label} unpacked artifact is missing.`);
  const runRoot = join(temporaryRoot, `${family.slug}-${randomUUID()}`);
  assert(isWithin(temporaryRoot, runRoot), 'Invalid isolated smoke root.');
  const profilePath = join(runRoot, 'browser-profile');
  const projectPath = join(runRoot, 'ProjectDataRoot 中文 空格');
  await mkdir(profilePath, { recursive: true });
  const root = await initializeProjectDataRoot(projectPath);
  const databasePath = join(root.rootPath, 'content.sqlite');
  await initializeDatabase({ databasePath });
  const database = connectDatabase(databasePath);
  const repository = new SqliteLocalApiRepository(database);
  const browserClipRuntime = new DesktopBrowserClipRuntime(database, root);
  const apiPort = await allocatePort();
  const localApi = new LocalApiServer({
    browserClipService: browserClipRuntime,
    port: apiPort,
    repository,
  });
  await localApi.start();
  const pairing = localApi.pairingSessions.start(
    localApi.listener.listenerInstanceId,
    apiPort,
    family.slug === 'chrome' ? 17_001 : 17_002,
  );
  const nonce = randomBytes(24).toString('hex');
  const fixture = await createFixture(family, nonce);
  const browserProcess = spawn(
    executable,
    [
      `--user-data-dir=${profilePath}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-proxy-server',
      '--new-window',
      'about:blank',
    ],
    { detached: false, stdio: 'ignore', windowsHide: false },
  );
  let client;
  let fixtureClosed = false;
  let localApiStopped = false;
  const requests = [];
  const responses = [];
  const responseErrors = [];
  try {
    const devtools = await waitForDevTools(profilePath);
    client = await CdpClient.connect(devtools.url);
    await client.send('Target.setDiscoverTargets', { discover: true });
    const version = await client.send('Browser.getVersion');
    assert(family.expectedProduct.test(version.product), `${family.label} identity did not match.`);
    const httpVersion = await fetch(`http://127.0.0.1:${devtools.port}/json/version`).then(
      (response) => response.json(),
    );
    assert(
      family.expectedProduct.test(httpVersion.Browser),
      `${family.label} HTTP identity failed.`,
    );

    const loaded = await client.send('Extensions.loadUnpacked', {
      enableInIncognito: false,
      path: family.artifact,
    });
    assert(/^[a-p]{32}$/u.test(loaded.id), 'Loaded extension ID has an invalid shape.');
    const { extensions } = await client.send('Extensions.getExtensions');
    const extension = extensions.find((value) => value.id === loaded.id);
    assert(extension?.enabled === true, 'The unpacked extension is not enabled.');
    assert(
      extension.version === BROWSER_CLIP_BUILD_VERSION,
      'Unexpected unpacked extension version.',
    );

    const commandProbe = await openInspectablePopup(client, loaded.id);
    const commandProbeSession = await attach(client, commandProbe.targetId);
    await waitFor(
      async () =>
        (await evaluate(client, commandProbeSession, 'document.readyState')) === 'complete' ||
        undefined,
      `${family.label} command probe`,
    );
    const serviceWorker = await waitForTarget(
      client,
      (target) =>
        target.type === 'service_worker' &&
        target.url === `chrome-extension://${loaded.id}/service-worker.js`,
      `${family.label} extension service worker`,
    );
    const serviceWorkerSession = await attach(client, serviceWorker.targetId);
    await client.send('Network.enable', {}, serviceWorkerSession);
    const stopNetworkListener = client.on('Network.requestWillBeSent', (params, sessionId) => {
      if (sessionId === serviceWorkerSession) {
        recordExtensionRequest(requests, pairing.endpoint, params);
      }
    });
    const stopResponseListener = client.on('Network.responseReceived', (params, sessionId) => {
      if (sessionId === serviceWorkerSession) {
        recordExtensionResponse(responses, pairing.endpoint, params);
        if (params.response?.status >= 400) {
          void client
            .send('Network.getResponseBody', { requestId: params.requestId }, serviceWorkerSession)
            .then(({ body }) => {
              const parsed = JSON.parse(body);
              if (typeof parsed.code === 'string') responseErrors.push(parsed.code);
            })
            .catch(() => undefined);
        }
      }
    });
    const commands = await evaluate(
      client,
      commandProbeSession,
      'chrome.commands.getAll().then((items) => items.map(({name, shortcut}) => ({name, shortcut})))',
    );
    assert(
      commands.some(
        (command) => command.name === '_execute_action' && command.shortcut === 'Alt+Shift+Y',
      ),
      'The extension action shortcut is not effective in the isolated profile.',
    );
    await client.send('Target.closeTarget', { targetId: commandProbe.targetId });

    const { targetId: fixtureTargetId } = await client.send('Target.createTarget', {
      focus: true,
      newWindow: false,
      url: fixture.url,
    });
    const fixtureSession = await attach(client, fixtureTargetId);
    await waitFor(async () => {
      const state = await evaluate(
        client,
        fixtureSession,
        `({href: location.href, nonce: document.body?.dataset.smokeNonce, ready: document.readyState,
             visible: document.visibilityState, focused: document.hasFocus()})`,
      );
      return state?.ready === 'complete' && state.href === fixture.url && state.nonce === nonce
        ? state
        : undefined;
    }, `${family.label} fixture document`).then((state) => {
      assert(state.href === fixture.url, 'CDP URL confirmation did not match exactly.');
      assert(state.nonce === nonce, 'CDP fixture nonce did not match exactly.');
      assert(
        state.visible === 'visible' && state.focused === true,
        'Fixture was not foregrounded.',
      );
    });
    const selectedText = await evaluate(
      client,
      fixtureSession,
      `(() => {
        const node = document.querySelector('#sample');
        const selection = getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      })()`,
    );
    const pageTitle = await evaluate(client, fixtureSession, 'document.title');
    assert(
      typeof selectedText === 'string' && selectedText.length > 0,
      'Fixture selection failed.',
    );
    assert(typeof pageTitle === 'string' && pageTitle.length > 0, 'Fixture title failed.');
    await client.send('Target.activateTarget', { targetId: fixtureTargetId });
    const action = triggerAction(browserProcess.pid, family.slug);
    await verifyRealActionGrant(client, serviceWorkerSession, fixture.url, pageTitle, selectedText);
    await action;
    const popup = await openInspectablePopup(client, loaded.id);
    const popupSession = await attach(client, popup.targetId);
    await client.send('DOM.enable', {}, popupSession);
    await waitFor(
      async () =>
        (await evaluate(client, popupSession, 'document.readyState')) === 'complete' || undefined,
      `${family.label} popup document`,
    );
    await client.send('Target.activateTarget', { targetId: popup.targetId });
    await fill(client, popupSession, '#endpoint', pairing.endpoint);
    await fill(client, popupSession, '#pairing-code', pairing.pairingCode);
    await fill(client, popupSession, '#client-label', `${family.label} isolated smoke`);
    await client.send('Target.activateTarget', { targetId: fixtureTargetId });
    await evaluate(client, popupSession, 'document.querySelector("#pair-form").requestSubmit()');
    try {
      await waitFor(
        async () =>
          (await evaluate(client, popupSession, '!document.querySelector("#clip-form").hidden')) ||
          undefined,
        `${family.label} pairing and activeTab read`,
      );
    } catch (error) {
      const popupState = await evaluate(
        client,
        popupSession,
        `({
          clipFormHidden: document.querySelector('#clip-form').hidden,
          pairingHidden: document.querySelector('#pairing').hidden,
          status: document.querySelector('#status').textContent
        })`,
      );
      const routes = requests.map((request) => `${request.method} ${request.path}`).join(', ');
      const responseStatuses = responses
        .map((response) => `${response.status} ${response.path}`)
        .join(', ');
      const activeClients = database
        .prepare('SELECT count(*) AS count FROM local_api_clients WHERE revoked_at IS NULL')
        .get().count;
      await delay(100);
      throw new Error(
        `${error.message} Popup state: ${JSON.stringify(popupState)}. Loopback routes: ${
          routes || 'none'
        }. Loopback responses: ${responseStatuses || 'none'}. Error codes: ${
          responseErrors.join(', ') || 'none'
        }. Active clients: ${activeClients}.`,
        { cause: error },
      );
    }
    const capturedPage = await evaluate(
      client,
      popupSession,
      `({
        titleMatches: document.querySelector('#page-title').value === ${JSON.stringify(pageTitle)},
        urlMatches: document.querySelector('#page-url').value === ${JSON.stringify(fixture.url)},
        selectionMatches:
          document.querySelector('#selected-text').value === ${JSON.stringify(selectedText)}
      })`,
    );
    assert(
      capturedPage.titleMatches && capturedPage.urlMatches && capturedPage.selectionMatches,
      'The activeTab title, URL, or selection did not match.',
    );
    await client.send('Target.activateTarget', { targetId: popup.targetId });
    await chooseLastOption(client, popupSession, '#platform');
    await fill(client, popupSession, '#account-name', `${family.label} sample account`);
    await fill(client, popupSession, '#user-note', 'Issue 017 loopback smoke');
    await fill(client, popupSession, '#views', '321');
    await fill(client, popupSession, '#likes', '12');
    await click(client, popupSession, 'input[name="tag"][value="REFERENCE"]');
    await client.send('Target.activateTarget', { targetId: fixtureTargetId });
    const captureAction = triggerAction(browserProcess.pid, family.slug);
    await verifyRealActionGrant(client, serviceWorkerSession, fixture.url, pageTitle, selectedText);
    await evaluate(client, popupSession, 'document.querySelector("#capture").click()');
    try {
      await waitFor(
        async () =>
          (await evaluate(
            client,
            popupSession,
            '!document.querySelector("#screenshot-preview").hidden && document.querySelector("#screenshot-preview").src.startsWith("data:image/png;base64,")',
          )) || undefined,
        `${family.label} opt-in visible viewport screenshot`,
      );
    } catch (error) {
      const screenshotState = await evaluate(
        client,
        popupSession,
        `({
          hidden: document.querySelector('#screenshot-preview').hidden,
          hasPngSource: document.querySelector('#screenshot-preview').src.startsWith('data:image/png;base64,'),
          status: document.querySelector('#status').textContent
        })`,
      );
      const browserDiagnostic = await evaluate(
        client,
        serviceWorkerSession,
        `(async () => {
          const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
          if (tab?.windowId === undefined) return {error: 'NO_ACTIVE_WINDOW'};
          try {
            const value = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'});
            return {isPng: value.startsWith('data:image/png;base64,'), ok: true};
          } catch (caught) {
            return {error: String(caught?.message ?? caught), ok: false};
          }
        })()`,
      );
      throw new Error(
        `${error.message} Screenshot state: ${JSON.stringify(
          screenshotState,
        )}. Browser diagnostic: ${JSON.stringify(browserDiagnostic)}.`,
        { cause: error },
      );
    }
    await captureAction;
    await client.send('Target.activateTarget', { targetId: fixtureTargetId });
    const saveAction = triggerAction(browserProcess.pid, family.slug);
    await verifyRealActionGrant(client, serviceWorkerSession, fixture.url, pageTitle, selectedText);
    await saveAction;
    await client.send('Target.activateTarget', { targetId: popup.targetId });
    await pressSpace(client, popupSession, '#public-confirmed');
    await waitFor(
      async () =>
        (await evaluate(
          client,
          popupSession,
          'document.querySelector("#public-confirmed").checked',
        )) || undefined,
      `${family.label} public-page confirmation`,
      5_000,
    );
    await client.send('Target.activateTarget', { targetId: fixtureTargetId });
    await evaluate(client, popupSession, 'document.querySelector("#clip-form").requestSubmit()');
    try {
      await waitFor(
        async () =>
          (
            await evaluate(client, popupSession, 'document.querySelector("#status").textContent')
          ).startsWith('保存成功：') || undefined,
        `${family.label} browser clip save`,
      );
    } catch (error) {
      const saveState = await evaluate(
        client,
        popupSession,
        `({
          status: document.querySelector('#status').textContent,
          submitDisabled: document.querySelector('#clip-form button[type="submit"]').disabled,
          formValid: document.querySelector('#clip-form').checkValidity(),
          publicConfirmed: document.querySelector('#public-confirmed').checked,
          pageTitlePresent: document.querySelector('#page-title').value.length > 0,
          pageUrlPresent: document.querySelector('#page-url').value.length > 0
        })`,
      );
      const routes = requests.map((request) => `${request.method} ${request.path}`).join(', ');
      const responseStatuses = responses
        .map((response) => `${response.status} ${response.path}`)
        .join(', ');
      throw new Error(
        `${error.message} Save state: ${JSON.stringify(saveState)}. Loopback routes: ${
          routes || 'none'
        }. Loopback responses: ${responseStatuses || 'none'}. Error codes: ${
          responseErrors.join(', ') || 'none'
        }.`,
        { cause: error },
      );
    }
    const replayCaptureId = randomUUID();
    const replayClip = {
      accountName: null,
      browserFamily: 'CHROMIUM_UNKNOWN',
      captureId: replayCaptureId,
      capturedAt: new Date().toISOString(),
      contentTags: ['REFERENCE'],
      contractVersion: BROWSER_CLIP_CONTRACT_VERSION,
      extensionBuildVersion: BROWSER_CLIP_BUILD_VERSION,
      pageTitle,
      pageUrl: fixture.url,
      platform: 'OTHER',
      publicPageConfirmed: true,
      publishedAt: null,
      screenshot: null,
      selectedText,
      userNote: null,
      visibleMetrics: {
        comments: null,
        favorites: null,
        likes: null,
        shares: null,
        views: null,
      },
    };
    const replayExpression = `(async () => chrome.runtime.sendMessage(${JSON.stringify({
      clip: replayClip,
      kind: 'SAVE_CLIP',
    })}))()`;
    await client.send('Target.activateTarget', { targetId: fixtureTargetId });
    const replayAction = triggerAction(browserProcess.pid, family.slug);
    await verifyRealActionGrant(client, serviceWorkerSession, fixture.url, pageTitle, selectedText);
    const replayOne = await evaluate(client, popupSession, replayExpression);
    const replayTwo = await evaluate(client, popupSession, replayExpression);
    await replayAction;
    assert(
      replayOne?.error === undefined && replayTwo?.error === undefined,
      'Idempotent replay failed.',
    );
    assert(
      replayOne.ok.receipt.clipId === replayTwo.ok.receipt.clipId &&
        replayOne.ok.receipt.candidateId === replayTwo.ok.receipt.candidateId,
      'Idempotent replay returned different receipts.',
    );

    await waitFor(
      () => (browserClipRuntime.listClips().length === 2 ? true : undefined),
      `${family.label} desktop clip visibility`,
    );
    const clips = browserClipRuntime.listClips();
    const screenshotClip = clips.find((clip) => clip.hasScreenshot);
    assert(
      screenshotClip !== undefined,
      'Saved screenshot clip was not visible to the desktop runtime.',
    );
    const detail = browserClipRuntime.getClip(screenshotClip.clipId);
    const screenshot = await browserClipRuntime.readScreenshot(screenshotClip.clipId);
    assert(detail?.clipId === screenshotClip.clipId, 'Desktop clip detail lookup failed.');
    assert(screenshot !== null && screenshot.bytes.length > 0, 'Secure screenshot read failed.');
    assert(screenshot.mime === 'image/png', 'Visible viewport screenshot MIME did not match.');
    const screenshotRow = database
      .prepare(
        `SELECT screenshot_path, screenshot_hash, screenshot_bytes, screenshot_width,
                screenshot_height, visible_metrics_json
         FROM clips WHERE id = ?`,
      )
      .get(screenshotClip.clipId);
    assert(
      typeof screenshotRow.screenshot_path === 'string' &&
        !isAbsolute(screenshotRow.screenshot_path) &&
        !screenshotRow.screenshot_path.startsWith('..'),
      'Screenshot path was not a managed relative path.',
    );
    assert(
      screenshotRow.screenshot_hash === createHash('sha256').update(screenshot.bytes).digest('hex'),
      'Screenshot hash did not match the securely read bytes.',
    );
    assert(
      screenshotRow.screenshot_bytes === screenshot.bytes.length &&
        screenshotRow.screenshot_width > 0 &&
        screenshotRow.screenshot_height > 0,
      'Screenshot metadata was incomplete.',
    );
    const metrics = JSON.parse(screenshotRow.visible_metrics_json);
    assert(
      metrics.views === 321 &&
        metrics.likes === 12 &&
        metrics.favorites === null &&
        metrics.comments === null &&
        metrics.shares === null,
      'Nullable visible metrics did not persist exactly.',
    );
    const counts = Object.fromEntries(
      [
        'clips',
        'clip_ingest_receipts',
        'search_runs',
        'search_result_candidates',
        'jobs',
        'fetch_runs',
        'model_runs',
      ].map((table) => [
        table,
        database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,
      ]),
    );
    assert(
      counts.clips === 2 &&
        counts.clip_ingest_receipts === 2 &&
        counts.search_runs === 2 &&
        counts.search_result_candidates === 2,
      'Browser clip persistence counts did not match.',
    );
    assert(
      counts.jobs === 0 && counts.fetch_runs === 0 && counts.model_runs === 0,
      'Browser clipping unexpectedly scheduled work or incurred a model run.',
    );
    const runs = database
      .prepare('SELECT external_request_count, cost_state, provider_mode FROM search_runs')
      .all();
    assert(
      runs.every(
        (run) =>
          run.external_request_count === 0 &&
          run.cost_state === 'NOT_INCURRED' &&
          run.provider_mode === 'PASSIVE_LOCAL',
      ),
      'Browser clip search records did not remain passive and cost-free.',
    );
    const candidates = database
      .prepare(
        `SELECT evidence_eligibility, fetch_state, truth_status, fact_status
         FROM search_result_candidates`,
      )
      .all();
    assert(
      candidates.every(
        (candidate) =>
          candidate.evidence_eligibility === 'LEAD_ONLY' &&
          candidate.fetch_state === 'NOT_FETCHED' &&
          candidate.truth_status === 'UNVERIFIED' &&
          candidate.fact_status === 'NOT_A_FACT',
      ),
      'Linked candidates did not retain the frozen passive semantics.',
    );

    await localApi.stop();
    localApiStopped = true;
    await client.send('Target.closeTarget', { targetId: popup.targetId });
    await client.send('Target.activateTarget', { targetId: fixtureTargetId });
    const offlineAction = triggerAction(browserProcess.pid, family.slug);
    await verifyRealActionGrant(client, serviceWorkerSession, fixture.url, pageTitle, selectedText);
    await offlineAction;
    const offlinePopup = await openInspectablePopup(client, loaded.id);
    const offlineSession = await attach(client, offlinePopup.targetId);
    await waitFor(
      async () =>
        (
          await evaluate(client, offlineSession, 'document.querySelector("#status")?.textContent')
        ).includes('桌面应用当前离线') || undefined,
      `${family.label} actionable offline prompt`,
    );
    stopNetworkListener();
    stopResponseListener();
    assert(
      requests.some(
        (request) => request.method === 'POST' && request.path === '/v1/pairings/exchange',
      ) &&
        requests.some(
          (request) => request.method === 'POST' && request.path === '/v1/browser-clips',
        ) &&
        requests.some((request) => request.method === 'GET' && request.path === '/v1/status'),
      'The extension loopback request audit was incomplete.',
    );

    await closeProcess(client, browserProcess);
    client.close();
    await fixture.close();
    fixtureClosed = true;
    database.close();
    await safeRemove(runRoot);
    return {
      assertions: {
        activeTabFieldsMatched: true,
        cdpExactFixtureUrlAndNonce: true,
        desktopListDetailAndScreenshotRead: true,
        extensionLoadedUnpacked: true,
        idempotentReplay: true,
        isolatedProfile: true,
        noFetchJobOrModelRun: true,
        nullableMetricsPersisted: true,
        offlinePrompt: true,
        realActionGesture: true,
        screenshotMetadataVerified: true,
        serviceWorkerObserved: true,
      },
      browser: family.label,
      extensionVersion: extension.version,
      product: version.product,
      requests,
    };
  } finally {
    if (!localApiStopped) await localApi.stop().catch(() => undefined);
    if (client !== undefined && browserProcess.exitCode === null) {
      await closeProcess(client, browserProcess).catch(() => undefined);
      client.close();
    }
    if (!fixtureClosed) await fixture.close().catch(() => undefined);
    try {
      database.close();
    } catch {
      // The successful path already closed the database.
    }
    await safeRemove(runRoot).catch(() => undefined);
  }
}

assert(process.platform === 'win32', 'The real Chrome/Edge smoke is Windows-only.');
await safeRemove(temporaryRoot);
await mkdir(temporaryRoot, { recursive: true });
const results = [];
for (const family of families) {
  process.stdout.write(
    `[clipper-real] ${family.label}: starting isolated real-browser verification\n`,
  );
  results.push(await runFamily(family));
  process.stdout.write(`[clipper-real] ${family.label}: passed and cleaned up\n`);
}
const evidence = {
  browsers: results,
  completedAt: new Date().toISOString(),
  issue: '017',
  recovery: 'CDP_REAL_BROWSER_SMOKE',
  safety: {
    credentialsWrittenToDisk: false,
    defaultProfileUsed: false,
    onlyConfiguredLoopbackObserved: true,
    realApiCalled: false,
    remoteAllowOriginsWildcardUsed: false,
    temporaryProfilesRemoved: true,
  },
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
await safeRemove(temporaryRoot);
process.stdout.write(
  '[clipper-real] Chrome and Edge verification passed; sanitized evidence written\n',
);
