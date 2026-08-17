import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';

import electron from 'electron';

import { createPortableTemp } from './portable-temp.mjs';

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
    geometry.inner.width !== desired.width && desired.width > attainable.width + 1;
  const heightLimited =
    Math.abs(geometry.inner.height - desired.height) > 1 && desired.height > attainable.height + 1;
  const workAreaLimited =
    (geometry.inner.width === desired.width || widthLimited) &&
    (Math.abs(geometry.inner.height - desired.height) <= 1 || heightLimited) &&
    (widthLimited || heightLimited);
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
  return waitFor(async () => {
    const state = await readNavigationState(client, sessionId);
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
      target.focus();
      target.click();
      return true;
    })()`,
  );
  assert(clicked, `${route} navigation link was not found.`);
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
    library: '.v2-library-feature',
    overview: '.v2-overview-lead',
    review: '.v2-review-dashboard, .v2-review-empty-state',
    settings: '.v2-settings-board',
    'weekly-plan': '.v2-weekly-stage',
  }[route];
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
      if (evidenceDirectory !== null && [1024, 1280, 1440, 2048].includes(viewport.width)) {
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

  process.stdout.write(
    `${JSON.stringify({
      contentDynamic,
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
      statePreserved: true,
      viewportNegotiations: [...viewportNegotiations.values()],
      zoom: { before: zoomBefore, reset: zoomReset, zoomed },
    })}\n`,
  );
} catch (error) {
  throw new Error(
    `V2 responsive Electron smoke failed: ${error instanceof Error ? error.message : String(error)}${stderr.trim() === '' ? '' : `; stderr=${stderr.slice(0, 1_024)}`}`,
    { cause: error },
  );
} finally {
  client?.close();
  if (child.exitCode === null) child.kill();
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit();
    else child.once('exit', resolveExit);
  });
  await rm(userData, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  await temporary.cleanup();
}
