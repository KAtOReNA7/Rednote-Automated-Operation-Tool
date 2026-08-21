import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';

import electron from 'electron';

import { createPortableTemp } from './portable-temp.mjs';
import { startR07PackagedProviderFixture } from './r07-packaged-provider-fixture.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const ignoredRoot = resolve(repositoryRoot, '.rednote-temp');
const loopbackHost = '127.0.0.1';
const routeSelectors = Object.freeze({
  overview: '.v2-overview-page',
  'weekly-plan': '.v2-weekly-page',
  content: '.v2-content-page',
  interaction: '.v2-interaction-page',
  library: '.v2-library-page',
  review: '.v2-review-page',
  settings: '.v2-settings-page',
});
const routeLabels = Object.freeze({
  content: '内容',
  interaction: '互动',
  library: '书库',
  overview: '总览',
  review: '数据复盘',
  settings: '设置',
  'weekly-plan': '本周计划',
});
const matrix = Object.freeze([
  { height: 720, width: 1024 },
  { height: 800, width: 1280 },
  { height: 900, width: 1440 },
  { height: 1080, width: 1920 },
  { height: 1113, width: 2048 },
]);
const minimumUsableViewport = Object.freeze({ height: 600, width: 960 });
const viewportNegotiations = new Map();
const evidenceDirectory =
  process.env.REDNOTE_RESPONSIVE_EVIDENCE_DIR === undefined
    ? null
    : resolve(process.env.REDNOTE_RESPONSIVE_EVIDENCE_DIR);
const evidencePrefix = (process.env.REDNOTE_RESPONSIVE_EVIDENCE_PREFIX ?? 'production')
  .replace(/[^a-z0-9-]/giu, '-')
  .slice(0, 48);
const evidenceScenario = process.env.REDNOTE_RESPONSIVE_EVIDENCE_SCENARIO ?? 'base';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isWithin(parent, child) {
  const relativePath = relative(parent, child);
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function currentShanghaiWeekKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const target = new Date(`${value.year}-${value.month}-${value.day}T00:00:00.000Z`);
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const year = target.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4));
  first.setUTCDate(first.getUTCDate() + 3 - ((first.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((target.getTime() - first.getTime()) / 604_800_000);
  return `${String(year)}-W${String(week).padStart(2, '0')}`;
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
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: loopbackHost, port: 0 }, resolveListen);
  });
  const address = server.address();
  assert(address !== null && typeof address !== 'string', 'Loopback port allocation failed.');
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error))),
  );
  return address.port;
}

class CdpClient {
  #nextId = 1;
  #pending = new Map();
  #socket;

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener(
        'error',
        () => rejectOpen(new Error('Unable to connect to the Electron loopback CDP endpoint.')),
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== 'number') return;
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error('Electron CDP connection closed.'));
      }
      this.#pending.clear();
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      this.#pending.set(id, { method, reject: rejectCommand, resolve: resolveCommand });
      this.#socket.send(
        JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
      );
    });
  }

  close() {
    this.#socket.close();
  }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      awaitPromise: true,
      expression,
      returnByValue: true,
      userGesture: true,
    },
    sessionId,
  );
  if (result.exceptionDetails !== undefined) throw new Error('Electron runtime evaluation failed.');
  return result.result?.value;
}

async function waitForRendererTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://${loopbackHost}:${String(port)}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const targets = await response.json();
    return targets.find(
      (target) =>
        target.type === 'page' && typeof target.url === 'string' && target.url.includes('/v2.html'),
    );
  }, 'V2 Electron renderer target');
}

async function waitForBrowserEndpoint(port) {
  return waitFor(async () => {
    const response = await fetch(`http://${loopbackHost}:${String(port)}/json/version`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const version = await response.json();
    return typeof version.webSocketDebuggerUrl === 'string' ? version.webSocketDebuggerUrl : false;
  }, 'Electron browser CDP endpoint');
}

async function resizeViewport(client, sessionId, desired) {
  await client.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await evaluate(
      client,
      sessionId,
      `window.resizeBy(${String(desired.width)} - window.innerWidth, ${String(desired.height)} - window.innerHeight)`,
    );
    const viewport = await waitFor(
      async () => {
        const value = await evaluate(
          client,
          sessionId,
          `({ height: window.innerHeight, width: window.innerWidth })`,
        );
        return value.width > 0 && value.height > 0 ? value : false;
      },
      `${String(desired.width)}x${String(desired.height)} Electron viewport`,
      5_000,
    );
    if (viewport.width === desired.width && Math.abs(viewport.height - desired.height) <= 1) {
      viewportNegotiations.set(`${String(desired.width)}x${String(desired.height)}`, {
        actual: viewport,
        mode: 'native',
        requested: desired,
      });
      return viewport;
    }
    await delay(100);
  }
  const geometry = await evaluate(
    client,
    sessionId,
    `({
      available: { height: screen.availHeight, width: screen.availWidth },
      inner: { height: window.innerHeight, width: window.innerWidth },
      outer: { height: window.outerHeight, width: window.outerWidth }
    })`,
  );
  const attainable = {
    height: geometry.inner.height + Math.max(0, geometry.available.height - geometry.outer.height),
    width: geometry.inner.width + Math.max(0, geometry.available.width - geometry.outer.width),
  };
  const widthLimited =
    geometry.inner.width !== desired.width &&
    (desired.width > geometry.available.width + 1 || desired.width > attainable.width + 1);
  const heightLimited =
    Math.abs(geometry.inner.height - desired.height) > 1 &&
    (desired.height > geometry.available.height + 1 || desired.height > attainable.height + 1);
  const externallyManagedWindow = geometry.outer.width === 0 || geometry.outer.height === 0;
  const workAreaLimited =
    (geometry.inner.width === desired.width || widthLimited) &&
    (Math.abs(geometry.inner.height - desired.height) <= 1 || heightLimited) &&
    (widthLimited || heightLimited || externallyManagedWindow);
  if (
    workAreaLimited &&
    geometry.inner.width >= minimumUsableViewport.width &&
    geometry.inner.height >= minimumUsableViewport.height
  ) {
    await client.send(
      'Emulation.setDeviceMetricsOverride',
      {
        deviceScaleFactor: 1,
        height: desired.height,
        mobile: false,
        screenHeight: desired.height,
        screenWidth: desired.width,
        width: desired.width,
      },
      sessionId,
    );
    const emulated = await waitFor(
      async () => {
        const viewport = await evaluate(
          client,
          sessionId,
          `({ height: window.innerHeight, width: window.innerWidth })`,
        );
        return viewport.width === desired.width && Math.abs(viewport.height - desired.height) <= 1
          ? viewport
          : false;
      },
      `${String(desired.width)}x${String(desired.height)} work-area constrained viewport`,
    );
    viewportNegotiations.set(`${String(desired.width)}x${String(desired.height)}`, {
      actual: emulated,
      availableWorkArea: geometry.available,
      mode: 'work-area-emulated-1-to-1',
      nativeClientViewport: geometry.inner,
      requested: desired,
    });
    return emulated;
  }
  throw new Error(
    `Electron viewport mismatch: expected ${String(desired.width)}x${String(desired.height)}, got ${String(geometry.inner.width)}x${String(geometry.inner.height)}; geometry=${JSON.stringify(geometry)}.`,
  );
}

async function waitForRouteRoot(client, sessionId, route, selector) {
  return waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `(() => {
          const root = document.querySelector(${JSON.stringify(selector)});
          return root === null ? false : { hash: window.location.hash, textLength: root.textContent?.trim().length ?? 0 };
        })()`,
      ),
    `${route} route root`,
  );
}

async function readNavigationState(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => ({
      activeElement: document.activeElement === null ? null : {
        className: typeof document.activeElement.className === 'string' ? document.activeElement.className : '',
        label: (document.activeElement.textContent ?? '').trim(),
        tag: document.activeElement.tagName
      },
      items: [...document.querySelectorAll('[data-v2-navigation-item]')].map((element) => {
        const style = getComputedStyle(element);
        return {
          ariaCurrent: element.getAttribute('aria-current'),
          background: style.backgroundColor,
          className: element.className,
          color: style.color,
          dataActive: element.getAttribute('data-active'),
          disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
          focus: element.matches(':focus'),
          focusVisible: element.matches(':focus-visible'),
          hover: element.matches(':hover'),
          label: (element.textContent ?? '').trim(),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          runningTransitions: element.getAnimations().filter(({ playState }) => playState === 'running').length
        };
      }),
      route: window.location.hash
    }))()`,
  );
}

function summarizeNavigationState(state) {
  return {
    activeElement: state.activeElement,
    current: state.items
      .filter(({ ariaCurrent }) => ariaCurrent === 'page')
      .map(({ background, color, dataActive, label }) => ({
        background,
        color,
        dataActive,
        label,
      })),
    focused: state.items
      .filter(({ focus }) => focus)
      .map(({ focusVisible, label }) => ({ focusVisible, label })),
    hovered: state.items.filter(({ hover }) => hover).map(({ label }) => label),
    route: state.route,
    runningTransitions: state.items.reduce((total, item) => total + item.runningTransitions, 0),
  };
}

function assertNavigationState(state, route) {
  const expectedLabel = routeLabels[route];
  const current = state.items.filter(({ ariaCurrent }) => ariaCurrent === 'page');
  const dataActive = state.items.filter(({ dataActive: value }) => value === 'true');
  assert(current.length === 1, `${route} expected one current navigation item.`);
  assert(current[0].label === expectedLabel, `${route} current navigation label mismatched.`);
  assert(dataActive.length === 1, `${route} expected one data-active navigation item.`);
  assert(
    dataActive[0].label === expectedLabel,
    `${route} data-active navigation label mismatched.`,
  );
  assert(current[0].background === 'rgb(36, 27, 41)', `${route} current background mismatched.`);
  assert(current[0].color === 'rgb(255, 255, 255)', `${route} current contrast mismatched.`);
  assert(
    state.items
      .filter(({ ariaCurrent }) => ariaCurrent !== 'page')
      .every(({ background }) => background === 'rgba(0, 0, 0, 0)'),
    `${route} non-current navigation background was not neutral.`,
  );
  assert(
    state.items.every(({ disabled }) => !disabled),
    `${route} unexpectedly disabled navigation.`,
  );
  assert(state.route === `#/v2/${route}`, `${route} route hash mismatched.`);
}

async function waitForNavigationStable(client, sessionId, route) {
  let lastState = null;
  try {
    return await waitFor(async () => {
      const state = await readNavigationState(client, sessionId);
      lastState = summarizeNavigationState(state);
      const current = state.items.filter(({ ariaCurrent }) => ariaCurrent === 'page');
      const expectedLabel = routeLabels[route];
      const transitions = state.items.reduce((total, item) => total + item.runningTransitions, 0);
      return state.route === `#/v2/${route}` &&
        current.length === 1 &&
        current[0].label === expectedLabel &&
        current[0].background === 'rgb(36, 27, 41)' &&
        current[0].color === 'rgb(255, 255, 255)' &&
        transitions === 0
        ? state
        : false;
    }, `${route} stable navigation state`);
  } catch (error) {
    throw new Error(
      `${route} stable navigation state: ${error instanceof Error ? error.message : String(error)} last=${JSON.stringify(lastState)}`,
      { cause: error },
    );
  }
}

async function navigate(client, sessionId, route, selector) {
  await evaluate(client, sessionId, `window.location.hash = ${JSON.stringify(`#/v2/${route}`)}`);
  await waitForRouteRoot(client, sessionId, route, selector);
  const navigation = await waitForNavigationStable(client, sessionId, route);
  assertNavigationState(navigation, route);
  return navigation;
}

async function directNavigate(client, sessionId, route, selector) {
  await evaluate(client, sessionId, `window.location.hash = ${JSON.stringify(`#/v2/${route}`)}`);
  await client.send('Page.reload', {}, sessionId);
  await waitForRouteRoot(client, sessionId, route, selector);
  const navigation = await waitForNavigationStable(client, sessionId, route);
  assertNavigationState(navigation, route);
  return navigation;
}

async function clickNavigate(client, sessionId, route, selector) {
  const clicked = await evaluate(
    client,
    sessionId,
    `(() => {
      const target = [...document.querySelectorAll('[data-v2-navigation-item]')]
        .find((element) => element.getAttribute('href')?.endsWith(${JSON.stringify(`#/v2/${route}`)}));
      if (!(target instanceof HTMLAnchorElement)) return false;
      target.click();
      return true;
    })()`,
  );
  assert(clicked, `${route} navigation link was not found.`);
  await waitFor(
    async () => (await evaluate(client, sessionId, 'window.location.hash')) === `#/v2/${route}`,
    `${route} navigation click hash`,
  );
  await client.send('Page.reload', {}, sessionId);
  await waitForRouteRoot(client, sessionId, route, selector);
  const navigation = await waitForNavigationStable(client, sessionId, route);
  assertNavigationState(navigation, route);
  return navigation;
}

async function clearNavigationEvidenceState(client, sessionId) {
  await evaluate(
    client,
    sessionId,
    `(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return { height: window.innerHeight, width: window.innerWidth };
    })()`,
  );
  const viewport = await evaluate(
    client,
    sessionId,
    `({ height: window.innerHeight, width: window.innerWidth })`,
  );
  await client.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: viewport.width - 2, y: viewport.height - 2 },
    sessionId,
  );
}

async function measureRoute(client, sessionId, route, selector) {
  const navigation = await navigate(client, sessionId, route, selector);
  const primarySelector = {
    content: '.v2-content-workbench',
    interaction: '.v2-interaction-grid',
    library: '.v2-library-feature, .v2-library-empty',
    overview: '.v2-overview-lead',
    review: '.v2-review-dashboard, .v2-review-empty-state',
    settings: '.v2-settings-board',
    'weekly-plan': '.v2-weekly-stage',
  }[route];
  await waitFor(
    () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector(${JSON.stringify(selector)})?.querySelector(${JSON.stringify(primarySelector)}) !== null`,
      ),
    `${route} primary layout`,
  );
  const metrics = await evaluate(
    client,
    sessionId,
    `(() => {
      const root = document.querySelector(${JSON.stringify(selector)});
      const workspace = document.querySelector('.v2-workspace');
      const header = root?.querySelector('.v2-page-header');
      const primary = root?.querySelector(${JSON.stringify(primarySelector)});
      const rect = root?.getBoundingClientRect();
      const workspaceRect = workspace?.getBoundingClientRect();
      const headerRect = header?.getBoundingClientRect();
      const primaryRect = primary?.getBoundingClientRect();
      const visible = [...(root?.querySelectorAll('button, input, select, textarea, a') ?? [])]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
      const clippedControlDetails = visible.filter((element) => {
        const box = element.getBoundingClientRect();
        const intentionallyScrollable = element.closest('.v2-weekly-date-ribbon') !== null;
        return !intentionallyScrollable &&
          (box.right > document.documentElement.clientWidth + 1 || box.left < -1);
      }).map((element) => ({
        label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 80),
        selector: element.tagName.toLowerCase()
      }));
      const gridTemplateColumns = primary === null ? '' : getComputedStyle(primary).gridTemplateColumns;
      return {
        bodyScrollWidth: document.body.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        clientWidth: document.documentElement.clientWidth,
        clippedControlDetails,
        devicePixelRatio: window.devicePixelRatio,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        gridColumnCount: gridTemplateColumns.split(/\\s+/u).filter(Boolean).length,
        gridTemplateColumns,
        headerLeft: Math.round(headerRect?.left ?? -1),
        headerRight: Math.round(headerRect?.right ?? -1),
        primaryLeft: Math.round(primaryRect?.left ?? -1),
        primaryRight: Math.round(primaryRect?.right ?? -1),
        rootLeft: Math.round(rect?.left ?? -1),
        rootRight: Math.round(rect?.right ?? -1),
        rootWidth: Math.round(rect?.width ?? -1),
        scrollWidth: document.documentElement.scrollWidth,
        workspaceWidth: Math.round(workspaceRect?.width ?? -1),
        zoom: window.visualViewport?.scale ?? 1,
      };
    })()`,
  );
  assert(metrics.scrollWidth === metrics.clientWidth, `${route} has document horizontal overflow.`);
  assert(metrics.bodyScrollWidth === metrics.clientWidth, `${route} body exceeds the viewport.`);
  assert(metrics.rootLeft >= 0, `${route} starts outside the viewport.`);
  assert(metrics.rootRight <= metrics.clientWidth + 1, `${route} ends outside the viewport.`);
  assert(metrics.headerLeft === metrics.rootLeft, `${route} header left boundary diverged.`);
  assert(metrics.headerRight === metrics.rootRight, `${route} header right boundary diverged.`);
  assert(metrics.primaryLeft === metrics.rootLeft, `${route} primary left boundary diverged.`);
  assert(metrics.primaryRight === metrics.rootRight, `${route} primary right boundary diverged.`);
  if (['content', 'interaction', 'settings'].includes(route)) {
    const expectedColumns =
      metrics.workspaceWidth <= 860 ? 1 : metrics.workspaceWidth <= 1120 ? 2 : 3;
    assert(
      metrics.gridColumnCount === expectedColumns,
      `${route} expected ${String(expectedColumns)} columns, received ${String(metrics.gridColumnCount)} (${metrics.gridTemplateColumns}).`,
    );
  }
  assert(
    metrics.clippedControlDetails.length === 0,
    `${route} has horizontally clipped controls: ${JSON.stringify(metrics.clippedControlDetails)}`,
  );
  return {
    ...metrics,
    currentNavigationLabel: navigation.items.find(({ ariaCurrent }) => ariaCurrent === 'page')
      ?.label,
  };
}

async function captureViewport(client, sessionId, path) {
  const { data } = await client.send(
    'Page.captureScreenshot',
    { captureBeyondViewport: false, format: 'png', fromSurface: true },
    sessionId,
  );
  await writeFile(path, Buffer.from(data, 'base64'));
}

async function captureAtWorkflowViewports(client, sessionId, name, scrollSelector = null) {
  assert(evidenceDirectory !== null, 'Workflow evidence requires an evidence directory.');
  for (const viewport of [
    { height: 720, width: 1024 },
    { height: 800, width: 1280 },
    { height: 900, width: 1440 },
    { height: 1080, width: 1920 },
  ]) {
    await resizeViewport(client, sessionId, viewport);
    if (scrollSelector !== null) {
      await evaluate(
        client,
        sessionId,
        `document.querySelector(${JSON.stringify(scrollSelector)})?.scrollIntoView({ block: 'start' })`,
      );
      await delay(150);
    }
    await captureViewport(
      client,
      sessionId,
      join(
        evidenceDirectory,
        `${evidencePrefix}-${name}-${String(viewport.width)}x${String(viewport.height)}.png`,
      ),
    );
  }
}

async function assertWeeklyFeedbackReachable(client, sessionId, buttonPattern, description) {
  for (const viewport of [
    { height: 720, width: 1024 },
    { height: 800, width: 1280 },
    { height: 900, width: 1440 },
    { height: 1080, width: 1920 },
  ]) {
    await resizeViewport(client, sessionId, viewport);
    const metrics = await evaluate(
      client,
      sessionId,
      `(() => {
        const button = [...document.querySelectorAll('.v2-item-feedback button')]
          .find((element) => ${buttonPattern}.test(element.textContent ?? ''));
        const batch = document.querySelector('.v2-batch-bar');
        if (!(button instanceof HTMLButtonElement) || !(batch instanceof HTMLElement)) return null;
        button.scrollIntoView({ block: 'end' });
        button.focus({ preventScroll: true });
        const buttonRect = button.getBoundingClientRect();
        const batchRect = batch.getBoundingClientRect();
        return {
          active: document.activeElement === button,
          batchTop: Math.round(batchRect.top),
          bottom: Math.round(buttonRect.bottom),
          left: Math.round(buttonRect.left),
          right: Math.round(buttonRect.right),
          top: Math.round(buttonRect.top),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth
        };
      })()`,
    );
    assert(metrics !== null, `${description} control or batch bar was missing.`);
    assert(metrics.active, `${description} did not receive keyboard focus.`);
    assert(
      metrics.top >= 0 && metrics.bottom <= metrics.viewportHeight,
      `${description} was clipped vertically.`,
    );
    assert(
      metrics.left >= 0 && metrics.right <= metrics.viewportWidth,
      `${description} was clipped horizontally.`,
    );
    assert(
      metrics.bottom + 8 <= metrics.batchTop,
      `${description} overlapped the fixed batch bar: ${JSON.stringify(metrics)}.`,
    );
  }
}

async function configureWorkflowProvider(client, sessionId, port) {
  const result = await evaluate(
    client,
    sessionId,
    `(async () => {
      const bridge = window.rednoteV2;
      const initial = await bridge.readProviderSettings();
      if (!initial.ok) return initial;
      const updated = await bridge.updateProviderSettings({
        expectedRevision: initial.value.revision,
        imageModelId: 'r07-loopback-image',
        providerBaseUrl: ${JSON.stringify(`http://127.0.0.1:${String(port)}/v1`)},
        researchModelId: 'r07-loopback-text',
        writingModelId: 'r07-loopback-text'
      });
      if (!updated.ok) return updated;
      const credential = await bridge.setProviderCredential({
        plaintext: 'unusable-runtime-r08-workflow-evidence'
      });
      if (!credential.ok) return credential;
      const preview = await bridge.previewProviderCapabilityProbe();
      if (!preview.ok) return preview;
      const started = await bridge.startProviderCapabilityProbe({
        confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
        credentialBindingVersion: preview.value.credentialBindingVersion,
        planHash: preview.value.planHash,
        settingsRevision: preview.value.settingsRevision,
        startToken: preview.value.startToken,
        userApprovedUnknownCost: true
      });
      return started;
    })()`,
  );
  assert(result.ok === true, `Could not configure workflow fixture: ${JSON.stringify(result)}`);
  const progress = await waitFor(
    async () => {
      const value = await evaluate(
        client,
        sessionId,
        `(async () => window.rednoteV2.readProviderCapabilityProbeProgress({ runId: ${JSON.stringify(result.value.runId)} }))()`,
      );
      return value.ok === true && value.value.status !== 'RUNNING' ? value : false;
    },
    'workflow fixture capability probe',
    30_000,
  );
  const settings = await evaluate(
    client,
    sessionId,
    `(async () => window.rednoteV2.readProviderSettings())()`,
  );
  assert(
    settings.ok === true && settings.value.textReady === true,
    `Workflow fixture did not confirm structured JSON: ${JSON.stringify({ progress, settings })}`,
  );
}

async function setNativeControlValue(client, sessionId, selector, value) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLSelectElement)) return false;
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
}

async function clickButtonByText(client, sessionId, pattern) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((element) => ${pattern}.test((element.textContent ?? '').trim()));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`,
  );
}

async function clickVisibleButtonByText(client, sessionId, pattern) {
  const found = await evaluate(
    client,
    sessionId,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((element) => ${pattern}.test((element.textContent ?? '').trim()));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    })()`,
  );
  if (!found) return false;
  await delay(100);
  const target = await evaluate(
    client,
    sessionId,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((element) => ${pattern}.test((element.textContent ?? '').trim()));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit !== button && !button.contains(hit)) return null;
      globalThis.__r09ClickObserved = false;
      button.addEventListener('click', () => { globalThis.__r09ClickObserved = true; }, { once: true });
      return { x, y };
    })()`,
  );
  if (target === null) return false;
  await client.send(
    'Input.dispatchMouseEvent',
    { button: 'left', clickCount: 1, type: 'mousePressed', ...target },
    sessionId,
  );
  await client.send(
    'Input.dispatchMouseEvent',
    { button: 'left', clickCount: 1, type: 'mouseReleased', ...target },
    sessionId,
  );
  return evaluate(client, sessionId, `globalThis.__r09ClickObserved === true`);
}

const workflowPreviewViewports = [
  { height: 720, width: 1024 },
  { height: 800, width: 1280 },
  { height: 900, width: 1440 },
];

async function measureWorkflowPreview(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const dialog = document.querySelector('[data-provider-preview-dialog]');
      const head = dialog?.querySelector('.v2-provider-preview-head');
      const body = dialog?.querySelector('.v2-provider-preview-body');
      const footer = dialog?.querySelector('.v2-provider-preview-actions');
      const authorization = footer?.querySelector('input[type="checkbox"]');
      const cancel = [...(footer?.querySelectorAll('button') ?? [])]
        .find((element) => /取消/u.test(element.textContent ?? ''));
      const confirm = [...(footer?.querySelectorAll('button') ?? [])]
        .find((element) => /确认并执行一次/u.test(element.textContent ?? ''));
      const rectOf = (element) => {
        const rect = element?.getBoundingClientRect();
        return rect === undefined
          ? null
          : { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width };
      };
      const visibleOrAbsent = (element) =>
        element === null || element === undefined || getComputedStyle(element).visibility === 'hidden';
      return {
        activeInside: dialog?.contains(document.activeElement) === true,
        authorizationChecked: authorization instanceof HTMLInputElement && authorization.checked,
        authorizationPresent: authorization instanceof HTMLInputElement,
        body: rectOf(body),
        bodyClientWidth: body?.clientWidth ?? -1,
        bodyScrollTop: body?.scrollTop ?? -1,
        bodyScrollWidth: body?.scrollWidth ?? -1,
        bodyScrollHeight: body?.scrollHeight ?? -1,
        batchBarHidden: visibleOrAbsent(document.querySelector('.v2-batch-bar')),
        cancel: rectOf(cancel),
        confirm: rectOf(confirm),
        confirmDisabled: confirm instanceof HTMLButtonElement && confirm.disabled,
        dialog: rectOf(dialog),
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        footer: rectOf(footer),
        head: rectOf(head),
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        toastHidden: visibleOrAbsent(document.querySelector('.v2-toast')),
      };
    })()`,
  );
}

function assertWorkflowPreviewGeometry(measurement, label) {
  const { body, cancel, confirm, dialog, footer, head } = measurement;
  assert(
    dialog !== null && head !== null && body !== null && footer !== null,
    `${label} structure is incomplete.`,
  );
  assert(cancel !== null && confirm !== null, `${label} actions are incomplete.`);
  assert(
    dialog.left >= 0 &&
      dialog.right <= measurement.innerWidth + 1 &&
      dialog.top >= 0 &&
      dialog.bottom <= measurement.innerHeight + 1,
    `${label} left the viewport: ${JSON.stringify(measurement)}.`,
  );
  assert(
    head.top >= dialog.top &&
      head.bottom <= dialog.bottom &&
      footer.top >= dialog.top &&
      footer.bottom <= dialog.bottom,
    `${label} sticky regions left the dialog: ${JSON.stringify(measurement)}.`,
  );
  assert(
    cancel.top >= footer.top &&
      cancel.bottom <= footer.bottom &&
      confirm.top >= footer.top &&
      confirm.bottom <= footer.bottom,
    `${label} confirmation controls are not fully visible: ${JSON.stringify(measurement)}.`,
  );
  assert(
    measurement.documentScrollWidth === measurement.documentClientWidth &&
      measurement.bodyScrollWidth <= measurement.bodyClientWidth + 1,
    `${label} introduced horizontal overflow: ${JSON.stringify(measurement)}.`,
  );
  assert(measurement.authorizationPresent, `${label} unknown-fee authorization is missing.`);
  assert(!measurement.authorizationChecked, `${label} opened with unknown cost pre-authorized.`);
  assert(measurement.confirmDisabled, `${label} did not fail closed before fee authorization.`);
  assert(measurement.batchBarHidden, `${label} left the batch bar visible above the modal.`);
  assert(measurement.toastHidden, `${label} left a Toast visible above the confirmation controls.`);
}

async function dispatchTab(client, sessionId, shift = false) {
  const modifiers = shift ? 8 : 0;
  await client.send(
    'Input.dispatchKeyEvent',
    { code: 'Tab', key: 'Tab', modifiers, type: 'keyDown' },
    sessionId,
  );
  await client.send(
    'Input.dispatchKeyEvent',
    { code: 'Tab', key: 'Tab', modifiers, type: 'keyUp' },
    sessionId,
  );
}

async function assertWorkflowPreviewFocusTrap(client, sessionId, label) {
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector('[data-provider-preview-dialog]')?.contains(document.activeElement) === true`,
      ),
    `${label} initial focus`,
  );
  for (let index = 0; index < 8; index += 1) {
    await dispatchTab(client, sessionId, index === 0);
    assert(
      await evaluate(
        client,
        sessionId,
        `document.querySelector('[data-provider-preview-dialog]')?.contains(document.activeElement) === true`,
      ),
      `${label} allowed keyboard focus to escape.`,
    );
  }
}

async function captureWorkflowPreview(client, sessionId, name, scrollToBottom) {
  assert(evidenceDirectory !== null, 'Workflow preview evidence requires an evidence directory.');
  const measurements = [];
  for (const viewport of workflowPreviewViewports) {
    await resizeViewport(client, sessionId, viewport);
    await evaluate(
      client,
      sessionId,
      `(() => {
        const body = document.querySelector('.v2-provider-preview-body');
        if (body instanceof HTMLElement) body.scrollTop = ${scrollToBottom ? 'body.scrollHeight' : '0'};
      })()`,
    );
    await delay(150);
    const measurement = await measureWorkflowPreview(client, sessionId);
    assertWorkflowPreviewGeometry(
      measurement,
      `${name} ${String(viewport.width)}x${String(viewport.height)}`,
    );
    if (scrollToBottom && measurement.bodyScrollHeight > measurement.body.height + 1) {
      assert(measurement.bodyScrollTop > 0, `${name} body did not scroll independently.`);
    }
    measurements.push({ measurement, viewport });
    await captureViewport(
      client,
      sessionId,
      join(
        evidenceDirectory,
        `${evidencePrefix}-${name}-${String(viewport.width)}x${String(viewport.height)}.png`,
      ),
    );
  }
  return measurements;
}

async function readWeeklyPreviewState(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => ({
      controls: [...document.querySelectorAll('.v2-weekly-page input, .v2-weekly-page select, .v2-weekly-page textarea')]
        .map((element) => ({
          checked: element instanceof HTMLInputElement ? element.checked : null,
          type: element instanceof HTMLInputElement ? element.type : element.tagName,
          value: element.value
        })),
      hash: window.location.hash,
      scrollY: window.scrollY,
      selected: [...document.querySelectorAll('.v2-select-post')]
        .map((element) => ({ active: element.dataset.active ?? null, pressed: element.getAttribute('aria-pressed') }))
    }))()`,
  );
}

async function closeWorkflowPreviewWithEscape(client, sessionId, triggerPattern, label) {
  await client.send(
    'Input.dispatchKeyEvent',
    { code: 'Escape', key: 'Escape', type: 'keyDown' },
    sessionId,
  );
  await client.send(
    'Input.dispatchKeyEvent',
    { code: 'Escape', key: 'Escape', type: 'keyUp' },
    sessionId,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector('[data-provider-preview-dialog]') === null`,
      ),
    `${label} Escape close`,
  );
  const focusReturned = await evaluate(
    client,
    sessionId,
    `document.activeElement instanceof HTMLButtonElement && ${triggerPattern}.test(document.activeElement.textContent ?? '')`,
  );
  assert(focusReturned, `${label} did not return focus to its trigger.`);
}

async function captureWorkflowClosureEvidence(client, sessionId, weekKey, providerPort) {
  await configureWorkflowProvider(client, sessionId, providerPort);

  const created = await evaluate(
    client,
    sessionId,
    `(async () => window.rednoteV2.createInteraction({
      expectedRevision: 0,
      kind: 'COMMENT',
      relatedContentPackageId: null,
      userText: '这本书的密室线索为什么值得重读？'
    }))()`,
  );
  assert(created.ok === true, `Could not seed workflow interaction: ${JSON.stringify(created)}`);
  await reloadWorkspace(client, sessionId);
  await navigate(client, sessionId, 'interaction', routeSelectors.interaction);
  await evaluate(
    client,
    sessionId,
    `document.querySelector('.v2-reply-editor')?.scrollIntoView({ block: 'start' })`,
  );
  await captureAtWorkflowViewports(client, sessionId, 'interaction-pending', '.v2-reply-editor');

  const generated = await evaluate(
    client,
    sessionId,
    `(async () => window.rednoteV2.generateReplySuggestion({
      action: 'GENERATE_REPLY_SUGGESTION',
      expectedRevision: ${String(created.value.item.revision)},
      idempotencyKey: 'r08-workflow-evidence-reply',
      itemId: ${JSON.stringify(created.value.item.itemId)}
    }))()`,
  );
  assert(
    generated.ok === true,
    `Could not seed generated interaction: ${JSON.stringify(generated)}`,
  );
  await reloadWorkspace(client, sessionId);
  await navigate(client, sessionId, 'interaction', routeSelectors.interaction);
  await evaluate(
    client,
    sessionId,
    `document.querySelector('.v2-reply-editor')?.scrollIntoView({ block: 'start' })`,
  );
  await captureAtWorkflowViewports(client, sessionId, 'interaction-generated', '.v2-reply-editor');

  await navigate(client, sessionId, 'weekly-plan', routeSelectors['weekly-plan']);
  assert(
    await evaluate(
      client,
      sessionId,
      `(() => {
        const button = document.querySelector('.v2-select-post');
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`,
    ),
    'Could not select one plan item for workflow evidence.',
  );
  assert(
    await clickButtonByText(client, sessionId, /调整发布时间/u),
    'Unified scheduling action was not available.',
  );
  await waitFor(
    async () =>
      evaluate(client, sessionId, `document.querySelector('.v2-schedule-drawer') !== null`),
    'unified schedule drawer',
  );
  const currentTime = await evaluate(
    client,
    sessionId,
    `document.querySelector('.v2-schedule-drawer input[type="time"]')?.value ?? ''`,
  );
  const nextTime = currentTime === '19:30' ? '18:45' : '19:30';
  assert(
    await setNativeControlValue(
      client,
      sessionId,
      '.v2-schedule-drawer input[type="time"]',
      nextTime,
    ),
    'Schedule time input was not editable.',
  );
  assert(
    await clickButtonByText(client, sessionId, /预览发布时间变更/u),
    'Schedule preview action was not available.',
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `/确认原时间与新时间/u.test(document.querySelector('.v2-schedule-drawer')?.textContent ?? '')`,
      ),
    'schedule old/new preview',
  );
  await captureAtWorkflowViewports(client, sessionId, 'schedule-old-new-preview');
  assert(
    await clickButtonByText(client, sessionId, /取消调整/u),
    'Schedule preview cancel action was not available.',
  );

  assert(
    await setNativeControlValue(
      client,
      sessionId,
      '.v2-weekly-brief textarea',
      '下周重点：密室推理的公平线索；至少两篇女性侦探视角；避免重复作家生平。目标读者是第一次接触古典推理、但愿意核对文本细节的人。每个角度都要说明读者能验证的线索、可能的反方意见，以及为什么值得在本周讨论；不要剧透核心诡计，不要把资料分析写成第一人称阅读体验。优先覆盖封闭空间、叙述误导、女性侦探传统与科学证据四条线，连续两篇不得使用相同作品或相同开场方式。',
    ),
    'Weekly Brief input was not editable.',
  );
  assert(
    await setNativeControlValue(
      client,
      sessionId,
      '.v2-item-feedback textarea',
      '与本周已有密室起源角度重复，请换成读者可验证的线索视角。补充要求：保留目标读者和剧透边界，但不要继续讨论作家生平，也不要复用“第一部”或“开创性”这类宽泛判断。新候选需要明确指出可核对的文本细节、一个合理反方和适合小红书卡片展开的三段结构；如果依据不足，应保持未知并等待人工补充，而不是自动搜索或猜测。',
    ),
    'Plan feedback input was not editable.',
  );
  for (const viewport of [
    { height: 900, width: 1440 },
    { height: 720, width: 1024 },
    { height: 1080, width: 1920 },
    { height: 900, width: 1440 },
  ]) {
    await resizeViewport(client, sessionId, viewport);
    const drafts = await evaluate(
      client,
      sessionId,
      `({
        brief: document.querySelector('.v2-weekly-brief textarea')?.value ?? '',
        feedback: document.querySelector('.v2-item-feedback textarea')?.value ?? ''
      })`,
    );
    assert(drafts.brief.includes('公平线索'), 'Weekly Brief draft changed during resize.');
    assert(drafts.feedback.includes('读者可验证'), 'Plan feedback draft changed during resize.');
  }
  await evaluate(
    client,
    sessionId,
    `document.querySelector('.v2-weekly-brief')?.scrollIntoView({ block: 'start' })`,
  );
  await captureAtWorkflowViewports(client, sessionId, 'weekly-brief-edit', '.v2-weekly-brief');
  assert(
    await clickButtonByText(client, sessionId, /保存目标周 Brief/u),
    'Weekly Brief save action was not available.',
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector('.v2-weekly-brief button')?.disabled === true`,
      ),
    'saved weekly Brief',
  );
  const briefStateBefore = await readWeeklyPreviewState(client, sessionId);
  assert(
    await clickButtonByText(client, sessionId, /预览生成下周计划/u),
    'Weekly plan generation preview was not available.',
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector('[data-provider-preview-dialog]') !== null`,
      ),
    'weekly generation preview dialog',
  );
  await assertWorkflowPreviewFocusTrap(client, sessionId, 'Weekly Brief preview');
  const briefAuthorization = await captureWorkflowPreview(
    client,
    sessionId,
    'brief-preview-authorization',
    false,
  );
  const briefConfirmArea = await captureWorkflowPreview(
    client,
    sessionId,
    'brief-preview-confirm-area',
    true,
  );
  await closeWorkflowPreviewWithEscape(
    client,
    sessionId,
    /预览生成下周计划/u,
    'Weekly Brief preview',
  );
  assert(
    JSON.stringify(await readWeeklyPreviewState(client, sessionId)) ===
      JSON.stringify(briefStateBefore),
    'Weekly Brief, selection, filters, or page scroll changed after closing its preview.',
  );
  await captureAtWorkflowViewports(client, sessionId, 'brief-preview-closed-state');

  await evaluate(
    client,
    sessionId,
    `document.querySelector('.v2-item-feedback')?.scrollIntoView({ block: 'start' })`,
  );
  await assertWeeklyFeedbackReachable(client, sessionId, /保存反馈/u, 'Plan feedback save');
  await captureAtWorkflowViewports(client, sessionId, 'feedback-before-save', '.v2-item-feedback');
  assert(
    await clickButtonByText(client, sessionId, /保存反馈/u),
    'Plan feedback save action was not available.',
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `[...document.querySelectorAll('button')].some((button) => /预览重新生成当前项/u.test(button.textContent ?? ''))`,
      ),
    'recorded plan feedback',
  );
  assert(
    await evaluate(
      client,
      sessionId,
      `/反馈已保存，当前计划未修改/u.test(document.querySelector('.v2-feedback-saved')?.textContent ?? '')`,
    ),
    'Persistent feedback saved state was not visible.',
  );
  await assertWeeklyFeedbackReachable(
    client,
    sessionId,
    /预览重新生成当前项/u,
    'Plan replacement preview',
  );
  await captureAtWorkflowViewports(
    client,
    sessionId,
    'feedback-saved-next-step',
    '.v2-item-feedback',
  );
  const replacementStateBefore = await readWeeklyPreviewState(client, sessionId);
  assert(
    await clickButtonByText(client, sessionId, /预览重新生成当前项/u),
    'One-item replacement preview was not available.',
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector('[data-provider-preview-dialog]') !== null`,
      ),
    'one-item replacement preview dialog',
  );
  await assertWorkflowPreviewFocusTrap(client, sessionId, 'One-item replacement preview');
  const replacementAuthorization = await captureWorkflowPreview(
    client,
    sessionId,
    'item-preview-authorization',
    false,
  );
  const replacementConfirmArea = await captureWorkflowPreview(
    client,
    sessionId,
    'item-preview-confirm-area',
    true,
  );
  await closeWorkflowPreviewWithEscape(
    client,
    sessionId,
    /预览重新生成当前项/u,
    'One-item replacement preview',
  );
  assert(
    JSON.stringify(await readWeeklyPreviewState(client, sessionId)) ===
      JSON.stringify(replacementStateBefore),
    'Plan item, feedback, selection, filters, or page scroll changed after closing the replacement preview.',
  );
  await captureAtWorkflowViewports(client, sessionId, 'item-preview-closed-state');

  const softened = await evaluate(
    client,
    sessionId,
    `(async () => {
      let plan = await window.rednoteV2.readWeeklyPlan({ weekKey: ${JSON.stringify(weekKey)} });
      if (!plan.ok) return plan;
      const skipIds = plan.value.candidates
        .filter(({ status }) => status === 'CONFLICT')
        .map(({ id }) => id);
      const extra = plan.value.candidates.find(({ day, id, status }) => day === '周一' && status !== 'SKIPPED' && !skipIds.includes(id));
      if (extra !== undefined) skipIds.push(extra.id);
      if (skipIds.length > 0) {
        plan = await window.rednoteV2.skipPlanCandidates({
          candidateIds: skipIds,
          expectedRevision: plan.value.revision,
          weekKey: plan.value.weekKey
        });
        if (!plan.ok) return plan;
      }
      const pendingIds = plan.value.candidates
        .filter(({ status }) => status === 'PENDING')
        .map(({ id }) => id);
      if (pendingIds.length > 0) {
        plan = await window.rednoteV2.confirmPlanCandidates({
          candidateIds: pendingIds,
          expectedRevision: plan.value.revision,
          weekKey: plan.value.weekKey
        });
      }
      return plan;
    })()`,
  );
  assert(
    softened.ok === true,
    `Could not prepare soft-target evidence: ${JSON.stringify(softened)}`,
  );
  await reloadWorkspace(client, sessionId);
  await navigate(client, sessionId, 'weekly-plan', routeSelectors['weekly-plan']);
  await evaluate(
    client,
    sessionId,
    `document.querySelector('.v2-quick-actions')?.scrollIntoView({ block: 'start' })`,
  );
  const softState = await evaluate(
    client,
    sessionId,
    `(() => ({
      lockButtons: [...document.querySelectorAll('.v2-quick-actions button')]
        .filter((button) => /锁定本周计划/u.test(button.textContent ?? ''))
        .map((button) => ({ disabled: button.disabled, text: (button.textContent ?? '').trim() })),
      warning: document.querySelector('.v2-soft-target')?.textContent ?? ''
    }))()`,
  );
  assert(
    softState.lockButtons.some(({ disabled }) => disabled === false),
    `Soft daily target still disabled plan locking: ${JSON.stringify({ softState, softened })}`,
  );
  assert(/不是锁定门禁/u.test(softState.warning), 'Soft daily target explanation was not visible.');
  await captureAtWorkflowViewports(
    client,
    sessionId,
    'soft-daily-target-lock-enabled',
    '.v2-quick-actions',
  );
  return {
    briefAuthorization,
    briefConfirmArea,
    replacementAuthorization,
    replacementConfirmArea,
    softState,
  };
}

async function reloadWorkspace(client, sessionId) {
  await evaluate(client, sessionId, 'window.location.reload()');
  await waitFor(
    async () => evaluate(client, sessionId, `document.querySelector('.v2-workspace') !== null`),
    'reloaded V2 Electron workspace',
  );
  await delay(300);
}

async function unlockEvidencePlan(client, sessionId, weekKey) {
  const result = await evaluate(
    client,
    sessionId,
    `(async () => {
      const plan = await window.rednoteV2.readWeeklyPlan({ weekKey: ${JSON.stringify(weekKey)} });
      if (!plan.ok) return plan;
      const draft = plan.value.status === 'DRAFT'
        ? plan
        : await window.rednoteV2.unlockWeeklyPlan({
            expectedRevision: plan.value.revision,
            weekKey: plan.value.weekKey
          });
      if (!draft.ok) return draft;
      return window.rednoteV2.skipPlanCandidates({
        candidateIds: draft.value.candidates.map(({ id }) => id),
        expectedRevision: draft.value.revision,
        weekKey: draft.value.weekKey
      });
    })()`,
  );
  assert(result.ok === true, `Could not unlock isolated evidence plan: ${JSON.stringify(result)}`);
  await reloadWorkspace(client, sessionId);
}

async function captureAdvancedSettings(client, sessionId, evidencePath) {
  await navigate(client, sessionId, 'settings', routeSelectors.settings);
  const opened = await evaluate(
    client,
    sessionId,
    `(() => {
      const button = [...document.querySelectorAll('.v2-settings-page button')]
        .find((element) => /高级诊断/u.test(element.textContent ?? ''));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`,
  );
  assert(opened, 'Advanced settings control was not found.');
  await clearNavigationEvidenceState(client, sessionId);
  await waitForNavigationStable(client, sessionId, 'settings');
  await captureViewport(client, sessionId, evidencePath);
}

async function createLocalEvidenceData(client, sessionId, weekKey) {
  const generated = await evaluate(
    client,
    sessionId,
    `(async () => {
      let plan = await window.rednoteV2.readWeeklyPlan({ weekKey: ${JSON.stringify(weekKey)} });
      if (!plan.ok) return plan;
      if (plan.value.status !== 'CONFIRMED') {
        const confirmed = await window.rednoteV2.confirmPlanCandidates({
          candidateIds: plan.value.candidates.map(({ id }) => id),
          expectedRevision: plan.value.revision,
          weekKey: plan.value.weekKey
        });
        if (!confirmed.ok) return confirmed;
        plan = await window.rednoteV2.lockWeeklyPlan({
          expectedRevision: confirmed.value.revision,
          weekKey: confirmed.value.weekKey
        });
        if (!plan.ok) return plan;
      }
      const candidateIds = plan.value.candidates.slice(0, 3).map(({ id }) => id);
      return window.rednoteV2.generateContentPackages({
        candidateIds,
        expectedPlanRevision: plan.value.revision,
        idempotencyKey: 'r08-responsive-evidence-content',
        weekKey: plan.value.weekKey
      });
    })()`,
  );
  assert(
    generated.ok === true,
    `Could not create isolated content evidence: ${JSON.stringify(generated)}`,
  );
  await reloadWorkspace(client, sessionId);
  await navigate(client, sessionId, 'content', routeSelectors.content);
  const selected = await evaluate(
    client,
    sessionId,
    `(() => {
      const button = [...document.querySelectorAll('.v2-content-queue-items article > button:last-child')]
        .find((element) => element instanceof HTMLButtonElement && !element.disabled);
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`,
  );
  assert(selected, 'Generated content evidence could not be selected.');
  await delay(150);
  const content = await evaluate(
    client,
    sessionId,
    `(async () => window.rednoteV2.readContentPackages({ weekKey: ${JSON.stringify(weekKey)} }))()`,
  );
  assert(content.ok === true, 'Generated content evidence could not be read.');
  return content.value.packages;
}

async function approveAndMeasureEvidence(client, sessionId, packages) {
  const result = await evaluate(
    client,
    sessionId,
    `(async () => {
      const packages = ${JSON.stringify(packages)};
      const approved = await window.rednoteV2.approveContentPackages({
        items: packages.map((item) => ({
          expectedRevision: item.revision,
          expectedVersionId: item.versionId,
          packageId: item.id
        }))
      });
      if (!approved.ok) return approved;
      const publishedAt = '2026-08-17T10:00:00.000Z';
      return window.rednoteV2.saveMetricSnapshots({
        snapshots: approved.value.packages.map((item, index) => ({
          collections: 120 + index * 25,
          comments: 24 + index * 5,
          expectedRevision: 0,
          likes: 430 + index * 60,
          newFollowers: 18 + index * 4,
          packageId: item.id,
          publishedAt,
          snapshotWindow: '7D',
          views: 6800 + index * 900
        }))
      });
    })()`,
  );
  assert(
    result.ok === true,
    `Could not create isolated metric evidence: ${JSON.stringify(result)}`,
  );
  await reloadWorkspace(client, sessionId);
}

async function selectWeeklyState(client, sessionId) {
  await navigate(client, sessionId, 'weekly-plan', routeSelectors['weekly-plan']);
  return evaluate(
    client,
    sessionId,
    `(() => {
      const candidates = [...document.querySelectorAll('.v2-weekly-page button')];
      const button = candidates.find((element) => /待确认/u.test(element.textContent ?? ''));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`,
  );
}

async function readWeeklyState(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => ({
      hash: window.location.hash,
      pressed: [...document.querySelectorAll('.v2-weekly-page button')]
        .filter((element) => /待确认/u.test(element.textContent ?? ''))
        .map((element) => ({ active: element.dataset.active ?? null, pressed: element.getAttribute('aria-pressed') }))
    }))()`,
  );
}

async function prepareContentState(client, sessionId) {
  await navigate(client, sessionId, 'content', routeSelectors.content);
  return evaluate(
    client,
    sessionId,
    `(() => {
      const selection = document.querySelector('.v2-content-queue-items article > button:first-child');
      const title = document.querySelector('.v2-content-editor-stage .v2-package-fields input');
      if (!(selection instanceof HTMLButtonElement) || !(title instanceof HTMLInputElement)) return false;
      selection.click();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(title, '响应式未保存草稿');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
}

async function readContentState(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => ({
      draftTitle: document.querySelector('.v2-content-editor-stage .v2-package-fields input')?.value ?? null,
      hash: window.location.hash,
      selectedCount: [...document.querySelectorAll('.v2-content-queue-items article > button:first-child use')]
        .filter((element) => (element.getAttribute('href') ?? '').endsWith('#check-square')).length
    }))()`,
  );
}

async function openCoverPreview(client, sessionId) {
  await navigate(client, sessionId, 'content', routeSelectors.content);
  const opened = await evaluate(
    client,
    sessionId,
    `(() => {
      const button = [...document.querySelectorAll('.v2-content-page button')]
        .find((element) => /生成或重新生成封面/u.test(element.textContent ?? ''));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`,
  );
  assert(opened, 'Cover generation preview trigger was not available.');
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector('[data-provider-preview-dialog]') !== null`,
      ),
    'cover generation preview dialog',
  );
}

async function measureCoverPreview(client, sessionId) {
  const measurement = await evaluate(
    client,
    sessionId,
    `(() => {
      const dialog = document.querySelector('[data-provider-preview-dialog]');
      const overlay = dialog?.parentElement;
      const footer = dialog?.querySelector('.v2-provider-preview-actions');
      const cancel = [...(footer?.querySelectorAll('button') ?? [])]
        .find((element) => /取消/u.test(element.textContent ?? ''));
      const confirm = [...(footer?.querySelectorAll('button') ?? [])]
        .find((element) => /确认并执行一次/u.test(element.textContent ?? ''));
      const close = dialog?.querySelector('button[aria-label="关闭调用前预览"]');
      const rect = dialog?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      return {
        bodyScrollWidth: document.body.scrollWidth,
        cancelEnabled: cancel instanceof HTMLButtonElement && !cancel.disabled,
        clientWidth: document.documentElement.clientWidth,
        closeEnabled: close instanceof HTMLButtonElement && !close.disabled,
        confirmPresent: confirm instanceof HTMLButtonElement,
        dialogBottom: Math.round(rect?.bottom ?? -1),
        dialogHeight: Math.round(rect?.height ?? -1),
        dialogLeft: Math.round(rect?.left ?? -1),
        dialogRight: Math.round(rect?.right ?? -1),
        dialogTop: Math.round(rect?.top ?? -1),
        footerBottom: Math.round(footerRect?.bottom ?? -1),
        footerTop: Math.round(footerRect?.top ?? -1),
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        outsideWorkbench: dialog?.closest('.v2-content-workbench') === null,
        portalParentIsBody: overlay?.parentElement === document.body,
        scrollWidth: document.documentElement.scrollWidth,
      };
    })()`,
  );
  assert(measurement.portalParentIsBody, 'Cover preview was not portaled to document.body.');
  assert(measurement.outsideWorkbench, 'Cover preview remained inside the content workbench.');
  assert(
    measurement.scrollWidth === measurement.clientWidth,
    'Cover preview caused horizontal overflow.',
  );
  assert(
    measurement.bodyScrollWidth === measurement.clientWidth,
    'Cover preview body exceeded viewport.',
  );
  assert(
    measurement.dialogLeft >= 0 && measurement.dialogRight <= measurement.innerWidth + 1,
    `Cover preview left the horizontal viewport: ${JSON.stringify(measurement)}.`,
  );
  assert(
    measurement.dialogTop >= 0 && measurement.dialogBottom <= measurement.innerHeight + 1,
    `Cover preview left the vertical viewport: ${JSON.stringify(measurement)}.`,
  );
  assert(
    measurement.footerTop >= measurement.dialogTop &&
      measurement.footerBottom <= measurement.innerHeight + 1,
    `Cover preview actions were not visible: ${JSON.stringify(measurement)}.`,
  );
  assert(measurement.cancelEnabled, 'Cover preview cancel action was not clickable.');
  assert(measurement.closeEnabled, 'Cover preview close action was not clickable.');
  assert(measurement.confirmPresent, 'Cover preview confirmation action was missing.');
  return measurement;
}

async function closeCoverPreview(client, sessionId, mode) {
  if (mode === 'cancel') {
    const closed = await evaluate(
      client,
      sessionId,
      `(() => {
        const button = [...document.querySelectorAll('.v2-provider-preview-actions button')]
          .find((element) => /取消/u.test(element.textContent ?? ''));
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`,
    );
    assert(closed, 'Cover preview cancel action could not be used.');
  } else {
    await client.send(
      'Input.dispatchKeyEvent',
      { code: 'Escape', key: 'Escape', type: 'keyDown' },
      sessionId,
    );
    await client.send(
      'Input.dispatchKeyEvent',
      { code: 'Escape', key: 'Escape', type: 'keyUp' },
      sessionId,
    );
  }
  await waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector('[data-provider-preview-dialog]') === null`,
      ),
    `cover generation preview ${mode} close`,
  );
}

async function setZoomEquivalent(client, sessionId, factor) {
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    {
      deviceScaleFactor: 1.5,
      height: Math.round(900 / factor),
      mobile: false,
      screenHeight: 900,
      screenWidth: 1440,
      width: Math.round(1440 / factor),
    },
    sessionId,
  );
  await delay(250);
}

async function clearZoomEquivalent(client, sessionId) {
  await client.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
  await delay(250);
}

function r09SyntheticObservation(suffix, title, author, publisher, isbn) {
  const normalizedTitle = title.normalize('NFKC').toLocaleLowerCase('und');
  return {
    contractVersion: 'bibliographic-observation-v1',
    contributorHints: [
      { name: { normalized: author.toLocaleLowerCase('und'), raw: author }, roles: ['AUTHOR'] },
    ],
    displayTitle: { normalized: normalizedTitle, raw: title },
    factStatus: 'NOT_A_FACT',
    fieldProvenance: [
      {
        algorithmVersion: 'bibliography-normalization-v1',
        field: 'displayTitle',
        inputObservationIds: [],
        originKind: 'SYNTHETIC_FIXTURE',
        originRecordId: `r09-evidence-${suffix}`,
      },
    ],
    formatHint: 'PAPER',
    identifierHints: [
      {
        errorCode: null,
        namespace: 'ISBN_13',
        normalizedValue: isbn,
        rawValue: isbn,
        valid: true,
      },
    ],
    languageHints: ['zh-CN'],
    normalizationVersion: 'bibliography-normalization-v1',
    observationId: `observation-r09-evidence-${suffix}`,
    observedAt: '2026-08-19T00:00:00.000Z',
    organizationHints: [
      {
        name: { normalized: publisher.toLocaleLowerCase('und'), raw: publisher },
        roles: ['PUBLISHER'],
      },
    ],
    originKind: 'SYNTHETIC_FIXTURE',
    originRecordId: `r09-evidence-${suffix}`,
    originRevision: 1,
    originalTitleHint: null,
    publicationDateHint: null,
    publicationYearHint: null,
    scriptHints: ['HANI'],
    seriesHint: null,
    sourceIdentity: { candidateId: null, clipId: null, documentId: null },
    strata: ['synthetic-r09-evidence'],
    truthStatus: 'UNVERIFIED',
    warnings: ['SYNTHETIC_GOLD_FIXTURE'],
    workTypeHint: 'MYSTERY',
  };
}

async function seedR09CatalogEvidence(databasePath) {
  const { connectDatabase } = await import('../packages/db/dist/connection.js');
  const { SqliteCatalogRepository } = await import('../packages/db/dist/catalog-repository.js');
  const database = connectDatabase(databasePath);
  try {
    const catalog = new SqliteCatalogRepository(database);
    catalog.insertSyntheticObservation(
      r09SyntheticObservation(
        'alpha',
        '合成谜案：雾港来信',
        '合成作者甲',
        '合成出版社甲',
        '9780306406157',
      ),
      null,
      '2026-08-19T00:00:00.000Z',
    );
    catalog.insertSyntheticObservation(
      r09SyntheticObservation(
        'beta',
        '合成谜案：钟楼回声',
        '合成作者乙',
        '合成出版社乙',
        '9783161484100',
      ),
      null,
      '2026-08-19T00:00:01.000Z',
    );
  } finally {
    database.close();
  }
}

async function waitForLibraryText(client, sessionId, text) {
  return waitFor(
    async () =>
      evaluate(
        client,
        sessionId,
        `document.querySelector('.v2-library-page')?.textContent?.includes(${JSON.stringify(text)}) === true`,
      ),
    `R09 library text ${text}`,
  );
}

async function prepareR09CatalogEvidence(client, sessionId, userDataPath) {
  assert(evidenceDirectory !== null, 'R09 visual evidence requires an evidence directory.');
  await resizeViewport(client, sessionId, { height: 900, width: 1440 });
  await navigate(client, sessionId, 'library', routeSelectors.library);
  await waitForLibraryText(client, sessionId, '本机 Catalog 尚无作品');
  const emptySearch = await measureR09SearchControls(client, sessionId);
  await clearNavigationEvidenceState(client, sessionId);
  await captureViewport(
    client,
    sessionId,
    join(evidenceDirectory, `${evidencePrefix}-library-empty-1440x900.png`),
  );
  await seedR09CatalogEvidence(join(userDataPath, 'v2-project-data', 'database', 'rednote.sqlite'));
  await reloadWorkspace(client, sessionId);
  await navigate(client, sessionId, 'library', routeSelectors.library);
  await waitForLibraryText(client, sessionId, '合成谜案：雾港来信');
  return emptySearch;
}

async function readR09LibraryState(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => ({
      details: [...document.querySelectorAll('.v2-library-detail details')].map(({ open }) => open),
      hash: window.location.hash,
      input: document.querySelector('.v2-library-search-form input')?.value ?? '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      selected: document.querySelector('.v2-book[data-selected="true"] .v2-book-cover strong')?.textContent?.trim() ?? ''
    }))()`,
  );
}

async function measureR09SearchControls(client, sessionId) {
  const measurement = await evaluate(
    client,
    sessionId,
    `(() => {
      const form = document.querySelector('.v2-library-search-form');
      const input = form?.querySelector('input');
      const button = form?.querySelector('button');
      const badge = document.querySelector('.v2-library-readonly');
      if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement) ||
          !(button instanceof HTMLButtonElement) || !(badge instanceof HTMLElement)) return null;
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width };
      };
      const overlaps = (left, right) =>
        left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
      const formRect = rectOf(form);
      const inputRect = rectOf(input);
      const buttonRect = rectOf(button);
      const badgeRect = rectOf(badge);
      const range = document.createRange();
      range.selectNodeContents(button);
      const textRects = [...range.getClientRects()].filter(({ height, width }) => height > 0 && width > 0);
      const centerX = buttonRect.left + buttonRect.width / 2;
      const centerY = buttonRect.top + buttonRect.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      const style = getComputedStyle(button);
      return {
        badge: badgeRect,
        button: buttonRect,
        buttonClientHeight: button.clientHeight,
        buttonClientWidth: button.clientWidth,
        buttonScrollHeight: button.scrollHeight,
        buttonScrollWidth: button.scrollWidth,
        buttonText: (button.textContent ?? '').trim(),
        covered: hit !== button && !button.contains(hit),
        form: formRect,
        input: inputRect,
        overlaps: {
          badgeButton: overlaps(badgeRect, buttonRect),
          badgeInput: overlaps(badgeRect, inputRect),
          buttonInput: overlaps(buttonRect, inputRect),
        },
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        textLineCount: new Set(textRects.map(({ top }) => Math.round(top))).size,
        whiteSpace: style.whiteSpace,
      };
    })()`,
  );
  assert(measurement !== null, 'R09 search control group was not measurable.');
  assert(measurement.pageOverflow === 0, 'R09 library introduced page-level horizontal overflow.');
  assert(measurement.buttonText === '搜索', 'R09 search button label changed unexpectedly.');
  assert(measurement.whiteSpace === 'nowrap', 'R09 search button allows text wrapping.');
  assert(measurement.textLineCount === 1, 'R09 search button text rendered on multiple lines.');
  assert(measurement.button.width >= 72, 'R09 search button collapsed below its usable width.');
  assert(measurement.input.width >= 180, 'R09 search input collapsed below its usable width.');
  assert(
    measurement.buttonScrollWidth <= measurement.buttonClientWidth &&
      measurement.buttonScrollHeight <= measurement.buttonClientHeight,
    'R09 search button content was clipped.',
  );
  assert(!measurement.covered, 'R09 search button was covered by another element.');
  assert(
    Object.values(measurement.overlaps).every((value) => value === false),
    'R09 search controls overlapped.',
  );
  return measurement;
}

async function captureR09CatalogEvidence(client, sessionId, userDataPath) {
  assert(evidenceDirectory !== null, 'R09 visual evidence requires an evidence directory.');
  await resizeViewport(client, sessionId, { height: 900, width: 1440 });
  await navigate(client, sessionId, 'library', routeSelectors.library);
  await waitForLibraryText(client, sessionId, '合成谜案：雾港来信');
  const main = [];
  for (const viewport of matrix) {
    await resizeViewport(client, sessionId, viewport);
    main.push({ search: await measureR09SearchControls(client, sessionId), viewport });
  }
  await resizeViewport(client, sessionId, { height: 900, width: 1440 });
  assert(
    await setNativeControlValue(client, sessionId, '.v2-library-search-form input', '合成'),
    'R09 library search input was not editable.',
  );
  const initialSelected = (await readR09LibraryState(client, sessionId)).selected;
  assert(
    await evaluate(
      client,
      sessionId,
      `(() => {
        const buttons = [...document.querySelectorAll('.v2-library-shelf article button')];
        const target = buttons.at(-1);
        if (!(target instanceof HTMLButtonElement)) return false;
        target.click();
        return true;
      })()`,
    ),
    'R09 second Work was not selectable.',
  );
  await waitFor(async () => {
    const state = await readR09LibraryState(client, sessionId);
    if (state.selected === '' || state.selected === initialSelected) return false;
    return evaluate(
      client,
      sessionId,
      `document.querySelector('.v2-library-detail h2')?.textContent?.trim() === ${JSON.stringify(state.selected)}`,
    );
  }, 'R09 selected Work detail');
  await evaluate(
    client,
    sessionId,
    `[...document.querySelectorAll('.v2-library-detail details')].forEach((element) => { element.open = true; })`,
  );
  const preserved = await readR09LibraryState(client, sessionId);
  const dynamic = [];
  for (const viewport of [
    { height: 900, width: 1440 },
    { height: 720, width: 1024 },
    { height: 1113, width: 2048 },
    { height: 900, width: 1440 },
  ]) {
    await resizeViewport(client, sessionId, viewport);
    const state = await readR09LibraryState(client, sessionId);
    assert(state.overflow === 0, `R09 library overflowed at ${String(viewport.width)}px.`);
    dynamic.push({ search: await measureR09SearchControls(client, sessionId), state, viewport });
  }
  assert(
    JSON.stringify(dynamic.at(-1)?.state) === JSON.stringify(preserved),
    'R09 selection, search draft, detail disclosure, or route changed during resize.',
  );
  for (const viewport of [
    { height: 720, width: 1024 },
    { height: 900, width: 1440 },
    { height: 1113, width: 2048 },
  ]) {
    await resizeViewport(client, sessionId, viewport);
    await evaluate(
      client,
      sessionId,
      `document.querySelector('.v2-library-detail')?.scrollIntoView({ block: 'start' })`,
    );
    await delay(150);
    await captureViewport(
      client,
      sessionId,
      join(
        evidenceDirectory,
        `${evidencePrefix}-library-detail-expanded-${String(viewport.width)}x${String(viewport.height)}.png`,
      ),
    );
  }

  await resizeViewport(client, sessionId, { height: 900, width: 1440 });
  await evaluate(client, sessionId, `window.scrollTo({ top: 0 })`);

  assert(
    await setNativeControlValue(client, sessionId, '.v2-library-search-form input', '不存在的作品'),
    'R09 no-result query was not editable.',
  );
  assert(
    await clickVisibleButtonByText(client, sessionId, /^搜索$/u),
    'R09 search action was covered or did not receive a real pointer click.',
  );
  await waitForLibraryText(client, sessionId, '没有匹配的作品');
  const noResultSearch = await measureR09SearchControls(client, sessionId);
  await captureViewport(
    client,
    sessionId,
    join(evidenceDirectory, `${evidencePrefix}-library-no-result-1440x900.png`),
  );

  const { connectDatabase } = await import('../packages/db/dist/connection.js');
  const database = connectDatabase(
    join(userDataPath, 'v2-project-data', 'database', 'rednote.sqlite'),
  );
  try {
    database.exec('ALTER TABLE books RENAME TO books_r09_visual_error');
  } finally {
    database.close();
  }
  assert(
    await setNativeControlValue(client, sessionId, '.v2-library-search-form input', ''),
    'R09 error-state query was not editable.',
  );
  assert(
    await clickVisibleButtonByText(client, sessionId, /^搜索$/u),
    'R09 error-state search action was covered or did not receive a real pointer click.',
  );
  await waitForLibraryText(client, sessionId, '书库暂时无法读取');
  const errorSearch = await measureR09SearchControls(client, sessionId);
  await captureViewport(
    client,
    sessionId,
    join(evidenceDirectory, `${evidencePrefix}-library-error-1440x900.png`),
  );
  assert(
    await clickVisibleButtonByText(client, sessionId, /^重新读取$/u),
    'R09 retry action was covered or did not receive a real pointer click.',
  );
  await waitForLibraryText(client, sessionId, '书库暂时无法读取');
  return { dynamic, errorSearch, main, noResultSearch, preserved, retryClick: true };
}

const temporary = await createPortableTemp(repositoryRoot, 'v2-responsive-smoke');
if (evidenceDirectory !== null) {
  assert(isWithin(ignoredRoot, evidenceDirectory), 'Evidence must remain under .rednote-temp.');
  await mkdir(evidenceDirectory, { recursive: true });
}
const userData = join(temporary.root, 'responsive-user-data');
await mkdir(userData, { recursive: true });
const port = await allocatePort();
const childEnvironment = { ...process.env, ...temporary.env };
delete childEnvironment.DESKTOP_DEV_SERVER_URL;
delete childEnvironment.ELECTRON_RUN_AS_NODE;
delete childEnvironment.NODE_OPTIONS;
const child = spawn(
  electron,
  [
    '.',
    '--v2-shell',
    `--user-data-dir=${userData}`,
    `--remote-debugging-address=${loopbackHost}`,
    `--remote-debugging-port=${String(port)}`,
  ],
  {
    cwd: repositoryRoot,
    env: childEnvironment,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  },
);
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

let client;
let workflowProviderFixture;
let workflowEvidence = null;
let r09EmptyEvidence = null;
let r09LibraryEvidence = null;
try {
  const target = await waitForRendererTarget(port);
  client = await CdpClient.connect(await waitForBrowserEndpoint(port));
  const { sessionId } = await client.send('Target.attachToTarget', {
    flatten: true,
    targetId: target.id,
  });
  await waitFor(
    async () => evaluate(client, sessionId, `document.querySelector('.v2-workspace') !== null`),
    'V2 Electron workspace',
  );

  if (evidenceDirectory !== null && evidenceScenario === 'r09-library') {
    r09EmptyEvidence = await prepareR09CatalogEvidence(client, sessionId, userData);
  }

  const evidenceWeekKey = currentShanghaiWeekKey();
  if (evidenceDirectory !== null && evidenceScenario === 'unlocked') {
    await unlockEvidencePlan(client, sessionId, evidenceWeekKey);
  }

  await navigate(client, sessionId, 'overview', routeSelectors.overview);
  await evaluate(client, sessionId, `window.location.hash = '#/v2/weekly-plan'`);
  await waitForRouteRoot(client, sessionId, 'weekly-plan', routeSelectors['weekly-plan']);
  const transitionImmediate = await readNavigationState(client, sessionId);
  const transitionStable = await waitForNavigationStable(client, sessionId, 'weekly-plan');
  assertNavigationState(transitionStable, 'weekly-plan');
  assert(
    transitionImmediate.items.some(({ runningTransitions }) => runningTransitions > 0),
    'Navigation transition timing regression could not be reproduced.',
  );

  const navigationViewports = [
    { height: 720, width: 1024 },
    { height: 800, width: 1280 },
    { height: 900, width: 1440 },
    { height: 1113, width: 2048 },
  ];
  const directNavigation = [];
  const sequentialNavigation = [];
  for (const viewport of navigationViewports) {
    await resizeViewport(client, sessionId, viewport);
    for (const [route, selector] of Object.entries(routeSelectors)) {
      const state = await directNavigate(client, sessionId, route, selector);
      directNavigation.push({ route, state: summarizeNavigationState(state), viewport });
    }

    let state = await directNavigate(client, sessionId, 'overview', routeSelectors.overview);
    sequentialNavigation.push({
      route: 'overview',
      state: summarizeNavigationState(state),
      viewport,
    });
    for (const [route, selector] of Object.entries(routeSelectors).slice(1)) {
      state = await clickNavigate(client, sessionId, route, selector);
      sequentialNavigation.push({ route, state: summarizeNavigationState(state), viewport });
    }
  }

  await resizeViewport(client, sessionId, { height: 900, width: 1440 });
  await navigate(client, sessionId, 'overview', routeSelectors.overview);
  await clearNavigationEvidenceState(client, sessionId);
  await evaluate(
    client,
    sessionId,
    `document.querySelector('[data-v2-navigation-item][href$="#/v2/weekly-plan"]')?.focus()`,
  );
  const focusState = await readNavigationState(client, sessionId);
  assertNavigationState(focusState, 'overview');
  const focusedNonCurrent = focusState.items.find(({ label }) => label === '本周计划');
  assert(focusedNonCurrent?.focusVisible === true, 'Non-current keyboard focus was not visible.');
  assert(focusedNonCurrent.ariaCurrent === null, 'Keyboard focus masqueraded as current route.');
  assert(focusedNonCurrent.dataActive === 'false', 'Keyboard focus masqueraded as active data.');
  assert(
    focusedNonCurrent.background === 'rgba(0, 0, 0, 0)' &&
      focusedNonCurrent.outlineStyle === 'solid' &&
      Number.parseFloat(focusedNonCurrent.outlineWidth) >= 2.5,
    `Keyboard focus style did not remain distinct from current navigation: ${JSON.stringify(focusedNonCurrent)}.`,
  );

  await clearNavigationEvidenceState(client, sessionId);
  const hoverPoint = await evaluate(
    client,
    sessionId,
    `(() => {
      const rect = document.querySelector('[data-v2-navigation-item][href$="#/v2/weekly-plan"]')?.getBoundingClientRect();
      return rect === undefined ? null : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  );
  assert(hoverPoint !== null, 'Non-current hover target was not found.');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint }, sessionId);
  const hoverState = await waitFor(async () => {
    const value = await readNavigationState(client, sessionId);
    return value.items.some(({ hover, label }) => hover && label === '本周计划') ? value : false;
  }, 'non-current navigation hover state');
  const hoveredNonCurrent = hoverState.items.find(({ label }) => label === '本周计划');
  assert(hoveredNonCurrent?.ariaCurrent === null, 'Hover masqueraded as current route.');
  assert(hoveredNonCurrent.dataActive === 'false', 'Hover masqueraded as active data.');
  assert(
    hoveredNonCurrent.background !== 'rgb(36, 27, 41)',
    'Hover used the current-route background.',
  );
  const interactionStates = {
    focus: summarizeNavigationState(focusState),
    hover: summarizeNavigationState(hoverState),
  };
  await clearNavigationEvidenceState(client, sessionId);

  const measurements = [];
  for (const viewport of matrix) {
    await resizeViewport(client, sessionId, viewport);
    for (const [route, selector] of Object.entries(routeSelectors)) {
      const routeMeasurement = {
        route,
        viewport,
        ...(await measureRoute(client, sessionId, route, selector)),
      };
      measurements.push(routeMeasurement);
      if (evidenceDirectory !== null && [1024, 1280, 1440, 1920, 2048].includes(viewport.width)) {
        await clearNavigationEvidenceState(client, sessionId);
        const evidenceNavigation = await waitForNavigationStable(client, sessionId, route);
        assertNavigationState(evidenceNavigation, route);
        assert(
          evidenceNavigation.items.every(({ focus, hover }) => !focus && !hover),
          `${route} evidence retained focus or hover state.`,
        );
        await captureViewport(
          client,
          sessionId,
          join(
            evidenceDirectory,
            `${evidencePrefix}-${route}-${String(viewport.width)}x${String(viewport.height)}.png`,
          ),
        );
      }
    }
  }

  if (evidenceDirectory !== null && evidenceScenario === 'base') {
    await resizeViewport(client, sessionId, { height: 900, width: 1440 });
    await captureAdvancedSettings(
      client,
      sessionId,
      join(evidenceDirectory, `${evidencePrefix}-settings-advanced-1440x900.png`),
    );
    const packages = await createLocalEvidenceData(client, sessionId, evidenceWeekKey);
    await clearNavigationEvidenceState(client, sessionId);
    await waitForNavigationStable(client, sessionId, 'content');
    await captureViewport(
      client,
      sessionId,
      join(evidenceDirectory, `${evidencePrefix}-content-data-1440x900.png`),
    );
    await approveAndMeasureEvidence(client, sessionId, packages);
    await navigate(client, sessionId, 'review', routeSelectors.review);
    await clearNavigationEvidenceState(client, sessionId);
    await waitForNavigationStable(client, sessionId, 'review');
    await captureViewport(
      client,
      sessionId,
      join(evidenceDirectory, `${evidencePrefix}-review-data-1440x900.png`),
    );
  }

  if (evidenceDirectory !== null && evidenceScenario === 'r09-library') {
    r09LibraryEvidence = {
      emptySearch: r09EmptyEvidence,
      ...(await captureR09CatalogEvidence(client, sessionId, userData)),
    };
  }

  if (evidenceScenario === 'base') {
    if (evidenceDirectory === null) {
      await createLocalEvidenceData(client, sessionId, evidenceWeekKey);
    }
    assert(await prepareContentState(client, sessionId), 'Content state controls were not found.');
  }

  const contentStateBefore =
    evidenceScenario === 'base' ? await readContentState(client, sessionId) : null;
  const contentDynamic = [];
  if (contentStateBefore !== null) {
    for (const viewport of [
      { height: 900, width: 1440 },
      { height: 1113, width: 2048 },
      { height: 800, width: 1280 },
      { height: 720, width: 1024 },
      { height: 900, width: 1440 },
    ]) {
      await resizeViewport(client, sessionId, viewport);
      contentDynamic.push({ viewport, state: await readContentState(client, sessionId) });
    }
    assert(
      JSON.stringify(contentDynamic.at(-1)?.state) === JSON.stringify(contentStateBefore),
      'Content selection or draft changed during resize.',
    );
  }

  const coverPreview = [];
  if (contentStateBefore !== null) {
    await resizeViewport(client, sessionId, { height: 900, width: 1440 });
    await openCoverPreview(client, sessionId);
    for (const viewport of [
      { height: 720, width: 1024 },
      { height: 800, width: 1280 },
      { height: 900, width: 1440 },
      { height: 1080, width: 1920 },
      { height: 1113, width: 2048 },
    ]) {
      await resizeViewport(client, sessionId, viewport);
      coverPreview.push({ viewport, measurement: await measureCoverPreview(client, sessionId) });
      if (evidenceDirectory !== null && [1024, 1440, 2048].includes(viewport.width)) {
        await captureViewport(
          client,
          sessionId,
          join(
            evidenceDirectory,
            `${evidencePrefix}-cover-preview-${String(viewport.width)}x${String(viewport.height)}.png`,
          ),
        );
      }
    }
    await setZoomEquivalent(client, sessionId, 1.25);
    coverPreview.push({
      viewport: { effectiveZoom: 1.25, height: 720, width: 1152 },
      measurement: await measureCoverPreview(client, sessionId),
    });
    await clearZoomEquivalent(client, sessionId);
    await resizeViewport(client, sessionId, { height: 900, width: 1440 });
    await closeCoverPreview(client, sessionId, 'cancel');
    assert(
      JSON.stringify(await readContentState(client, sessionId)) ===
        JSON.stringify(contentStateBefore),
      'Content selection or draft changed after cancelling the cover preview.',
    );
    await openCoverPreview(client, sessionId);
    await closeCoverPreview(client, sessionId, 'escape');
    assert(
      JSON.stringify(await readContentState(client, sessionId)) ===
        JSON.stringify(contentStateBefore),
      'Content selection or draft changed after closing the cover preview with Escape.',
    );
  }

  await resizeViewport(client, sessionId, { height: 900, width: 1440 });
  assert(await selectWeeklyState(client, sessionId), 'Weekly-plan state control was not found.');
  const stateBefore = await readWeeklyState(client, sessionId);
  const dynamic = [];
  for (const viewport of [
    { height: 900, width: 1440 },
    { height: 1113, width: 2048 },
    { height: 800, width: 1280 },
    { height: 720, width: 1024 },
    { height: 900, width: 1440 },
  ]) {
    await resizeViewport(client, sessionId, viewport);
    dynamic.push({ viewport, state: await readWeeklyState(client, sessionId) });
  }
  const stateAfter = dynamic.at(-1)?.state;
  assert(
    JSON.stringify(stateAfter) === JSON.stringify(stateBefore),
    'Weekly-plan filter state changed during resize.',
  );

  const zoomBefore = await measureRoute(
    client,
    sessionId,
    'weekly-plan',
    routeSelectors['weekly-plan'],
  );
  await setZoomEquivalent(client, sessionId, 1.25);
  const zoomed = await measureRoute(
    client,
    sessionId,
    'weekly-plan',
    routeSelectors['weekly-plan'],
  );
  assert(
    zoomed.innerWidth === Math.round(zoomBefore.innerWidth / 1.25),
    `Electron browser zoom did not change the rendered viewport: ${JSON.stringify({ before: zoomBefore, zoomed })}`,
  );
  await clearZoomEquivalent(client, sessionId);
  await resizeViewport(client, sessionId, { height: 900, width: 1440 });
  const zoomReset = await waitFor(
    async () => {
      const value = await measureRoute(
        client,
        sessionId,
        'weekly-plan',
        routeSelectors['weekly-plan'],
      );
      return value.innerWidth === zoomBefore.innerWidth ? value : false;
    },
    'Electron browser zoom reset',
    5_000,
  );

  if (evidenceDirectory !== null && evidenceScenario === 'workflow-closure') {
    workflowProviderFixture = await startR07PackagedProviderFixture();
    workflowEvidence = await captureWorkflowClosureEvidence(
      client,
      sessionId,
      evidenceWeekKey,
      workflowProviderFixture.port,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      contentDynamic,
      coverPreview,
      directNavigation,
      dynamic,
      externalBusinessConnections: 0,
      interactionStates,
      matrix: measurements,
      navigationTransition: {
        immediate: summarizeNavigationState(transitionImmediate),
        stable: summarizeNavigationState(transitionStable),
      },
      sequentialNavigation,
      r09LibraryEvidence,
      statePreserved: true,
      viewportNegotiations: [...viewportNegotiations.values()],
      workflowEvidence:
        workflowProviderFixture === undefined
          ? null
          : {
              ...workflowEvidence,
              loopbackRequestCount: workflowProviderFixture.requests.length,
            },
      zoom: { before: zoomBefore, reset: zoomReset, zoomed },
    })}\n`,
  );
} catch (error) {
  throw new Error(
    `V2 responsive Electron smoke failed: ${error instanceof Error ? error.message : String(error)}${stderr.trim() === '' ? '' : `; stderr=${stderr.slice(0, 1_024)}`}`,
    { cause: error },
  );
} finally {
  await workflowProviderFixture?.close();
  client?.close();
  if (child.exitCode === null) child.kill();
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit();
    else child.once('exit', resolveExit);
  });
  await rm(userData, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  await temporary.cleanup();
}
