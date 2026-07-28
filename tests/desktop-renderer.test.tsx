// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DesktopBridge } from '../packages/shared/src/index.js';
import { App } from '../apps/web-ui/src/app.js';
import { ErrorBoundary } from '../apps/web-ui/src/error-boundary.js';
import { NAVIGATION_ITEMS, resolveRoute } from '../apps/web-ui/src/routes.js';

const bridge: DesktopBridge = {
  buildDiagnosticPreview: async () => ({
    ok: true,
    value: { content: '{}\n', hash: 'a'.repeat(64) },
  }),
  clearCredential: async () => ({
    ok: true,
    value: { available: true, requiresReauth: false, status: 'NOT_CONFIGURED' },
  }),
  confirmModelCacheClear: async () => ({
    ok: true,
    value: { deletedFiles: 0, orphanFiles: 0, tombstonedEntries: 0 },
  }),
  confirmDataRootSelection: async () => ({
    ok: true,
    value: {
      project: { displayPath: 'C:\\测试 数据', revision: 0, status: 'READY' },
      setupState: 'LOCAL_PROJECT_READY',
    },
  }),
  createModelPriceSchedule: async (input) => ({
    ok: true,
    value: {
      id: 'price-fixture',
      modelId: input.modelId,
      operationKind: input.operationKind,
      protocolMode: input.protocolMode,
      status: 'ACTIVE',
      version: 1,
    },
  }),
  createModelUnitPolicy: async (input) => ({
    ok: true,
    value: {
      id: 'units-fixture',
      maxExternalCallsMonthly: input.maxExternalCallsMonthly,
      maxExternalCallsWeekly: input.maxExternalCallsWeekly,
      scopeKind: input.scopeKind,
      scopeValue: input.scopeValue,
      status: 'ACTIVE',
      version: 1,
    },
  }),
  exportDiagnosticReport: async (input) => ({
    ok: true,
    value: {
      managedPath: 'exports/diagnostics/report.json',
      previewHash: input.expectedPreviewHash,
    },
  }),
  getAppInfo: async () => ({
    ok: true,
    value: { name: '红笺本地运营台', platform: 'win32', version: '0.0.0' },
  }),
  getFoundationHealth: async () => ({
    ok: true,
    value: {
      checks: {
        backup: true,
        cleanup: true,
        foreignKeys: true,
        migrations: true,
        nodeSqlite: true,
        queueLifecycle: true,
        reopen: true,
        wal: true,
      },
      schemaVersion: 6,
      status: 'ready',
    },
  }),
  getModelAccounting: async () => ({
    ok: true,
    value: {
      billingMonth: '2026-07',
      cacheBytes: 0,
      cacheEntries: 0,
      cacheHitCount: 0,
      estimatedKnownMicroUsd: '0',
      hardLimitMicroUsd: '100000000',
      hardStop: false,
      outstandingReservationMicroUsd: '0',
      priceSchedules: [],
      providerReportedMicroUsd: '0',
      recentRuns: [],
      uncertainReservationMicroUsd: '0',
      unitPolicies: [],
      unknownCostCallCount: 0,
      warning: false,
      warningLimitMicroUsd: '80000000',
    },
  }),
  getProviderCapabilityState: async () => ({
    ok: true,
    value: {
      activeRun: null,
      derivedState: 'NOT_PROBED',
      entries: [],
      history: [],
      runId: null,
    },
  }),
  previewProviderCapabilityProbe: async () => ({
    ok: true,
    value: {
      budgetCheck: 'UNIT_POLICY_READY',
      credentialBindingVersion: 0,
      expiresAt: '2099-01-01T00:00:00.000Z',
      feeEstimate: 'UNKNOWN',
      planHash: 'a'.repeat(64),
      profile: 'CORE',
      requestCount: 1,
      settingsRevision: 0,
      startToken: 'a'.repeat(43),
    },
  }),
  previewModelCacheClear: async () => ({
    ok: true,
    value: {
      bytes: 0,
      count: 0,
      expiresAt: '2099-01-01T00:00:00.000Z',
      outputTypes: [],
      previewToken: 'a'.repeat(43),
    },
  }),
  startProviderCapabilityProbe: async () => ({
    ok: true,
    value: {
      completedRequestCount: 0,
      currentCapability: null,
      plannedRequestCount: 1,
      runId: 'probe-runtime-000001',
      sentRequestCount: 0,
      status: 'RUNNING',
    },
  }),
  getProviderCapabilityProbeProgress: async (input) => ({
    ok: true,
    value: {
      completedRequestCount: 1,
      currentCapability: null,
      plannedRequestCount: 1,
      runId: input.runId,
      sentRequestCount: 1,
      status: 'SUCCEEDED',
    },
  }),
  cancelProviderCapabilityProbe: async (input) => ({
    ok: true,
    value: {
      completedRequestCount: 0,
      currentCapability: null,
      plannedRequestCount: 1,
      runId: input.runId,
      sentRequestCount: 0,
      status: 'RUNNING',
    },
  }),
  getLocalApiStatus: async () => ({
    ok: true,
    value: {
      activeClientCount: 0,
      enabled: false,
      endpoint: null,
      port: 43_119,
      projectReady: true,
      revision: 0,
      state: 'DISABLED',
    },
  }),
  getRuntimeCapabilities: async () => ({
    ok: true,
    value: {
      chromiumVersion: '150.0.0',
      electronVersion: '43.2.0',
      nodeSqlite: true,
      nodeVersion: '24.18.0',
      v8Version: '15.0.0',
    },
  }),
  getCredentialStatus: async () => ({
    ok: true,
    value: { available: true, requiresReauth: false, status: 'NOT_CONFIGURED' },
  }),
  getSettings: async () => ({
    ok: true,
    value: {
      account: {
        bio: '',
        contentScope: {
          excluded: ['偶像', '音乐', '演唱会', '泛娱乐', '粉圈'],
          focus: '推理小说',
          schemaVersion: 1,
        },
        occupationDisclosure: 'DEFERRED',
        ownership: 'PERSONAL',
        tone: {
          humor: '少量冷幽默',
          schemaVersion: 1,
          sentenceStyle: '短句直接',
          voice: '观点鲜明',
        },
        workingName: '未命名账号',
      },
      credential: { available: true, requiresReauth: false, status: 'NOT_CONFIGURED' },
      providerCapability: 'UNPROBED',
      settings: {
        credentialReference: null,
        embeddingModelId: null,
        imageModelId: null,
        monthlyHardLimitCents: 10000,
        monthlyWarningCents: 8000,
        providerBaseUrl: null,
        providerProtocol: 'OPENAI_COMPATIBLE',
        researchModelId: null,
        reviewModelId: null,
        revision: 0,
        setupState: 'LOCAL_PROJECT_READY',
        updatedAt: '2026-07-27T00:00:00.000Z',
        writingModelId: null,
      },
    },
  }),
  getSetupState: async () => ({
    ok: true,
    value: {
      project: { displayPath: 'C:\\测试 数据', revision: 0, status: 'READY' },
      setupState: 'LOCAL_PROJECT_READY',
    },
  }),
  getWindowState: async () => ({
    ok: true,
    value: { isFullScreen: false, isMaximized: false },
  }),
  listLocalApiClients: async () => ({ ok: true, value: [] }),
  cancelLocalApiPairing: async () => bridge.getLocalApiStatus(),
  revokeLocalApiClient: async (input) => ({
    ok: true,
    value: {
      clientLabel: null,
      createdAt: '2026-07-28T00:00:00.000Z',
      extensionOrigin: `chrome-extension://${'a'.repeat(32)}`,
      id: input.clientId,
      lastUsedAt: null,
      revision: input.expectedRevision + 1,
      status: 'REVOKED',
      updatedAt: '2026-07-28T00:00:01.000Z',
    },
  }),
  selectDataRoot: async () => ({ ok: true, value: null }),
  setCredential: async () => ({
    ok: true,
    value: { available: true, requiresReauth: false, status: 'CONFIGURED' },
  }),
  startLocalApiPairing: async () => ({
    ok: true,
    value: {
      endpoint: 'http://127.0.0.1:43119',
      expiresAt: '2099-01-01T00:00:00.000Z',
      pairingCode: 'a'.repeat(43),
      pairingSessionId: 'pairing-session-000011',
    },
  }),
  updateLocalApiSettings: async () => bridge.getLocalApiStatus(),
  updateNonSecretSettings: async () => {
    const result = await bridge.getSettings();
    if (!result.ok) {
      throw new Error('fixture settings unavailable');
    }
    return result;
  },
};

beforeEach(() => {
  window.location.hash = '#/overview';
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    value: bridge,
  });
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('React desktop shell', () => {
  it('defines the exact ten destinations in product order', () => {
    expect(NAVIGATION_ITEMS.map(({ label }) => label)).toEqual([
      '总览',
      '书库',
      '资料研究',
      '选题池',
      '内容生产',
      '审批',
      '发布包',
      '数据复盘',
      '任务中心',
      '设置',
    ]);
  });

  it('renders all destinations and the ready overview', async () => {
    render(<App />);
    expect(screen.getAllByRole('link')).toHaveLength(10);
    expect(await screen.findByText('本地安全底座已就绪')).toBeInTheDocument();
    expect(screen.getByText('本机基础设施正常')).toBeInTheDocument();
    expect(screen.getByText('Electron')).toBeInTheDocument();
    expect(screen.getByText('43.2.0')).toBeInTheDocument();
  });

  it('navigates to a real placeholder without presenting fake actions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('本地安全底座已就绪');
    await user.click(screen.getByRole('link', { name: /书库/u }));

    expect(await screen.findByRole('heading', { name: '书库', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('这里还是一个清晰的占位页')).toBeInTheDocument();
    expect(screen.getByText(/尚未在当前里程碑实现/u)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(NAVIGATION_ITEMS)('renders the $label route at $path', async (item) => {
    window.location.hash = `#${item.path}`;
    render(<App />);
    expect(await screen.findByRole('heading', { name: item.label, level: 1 })).toBeInTheDocument();
  });

  it('renders a controlled 404 route', async () => {
    window.location.hash = '#/not-a-route';
    render(<App />);
    expect(await screen.findByText('没有这个本地页面')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回总览' })).toBeInTheDocument();
  });

  it('shows a safe error state when the preload bridge is unavailable', async () => {
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: undefined,
    });
    render(<App />);
    expect(await screen.findByText('本地基础自检未完成')).toBeInTheDocument();
    expect(screen.getByText(/不会连接任何外部服务/u)).toBeInTheDocument();
  });

  it.each(NAVIGATION_ITEMS)('resolves $label at $path', (item) => {
    expect(resolveRoute(item.path)).toEqual(item);
  });

  it('does not resolve unknown or partial routes', () => {
    expect(resolveRoute('/')).toBeNull();
    expect(resolveRoute('/overview/extra')).toBeNull();
  });

  it('supports keyboard navigation with a visible focus target', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('本地安全底座已就绪');
    await user.tab();
    expect(screen.getByRole('link', { name: /总览/u })).toHaveFocus();
  });

  it('contains render failures in the Error Boundary', () => {
    const Throwing = (): React.JSX.Element => {
      throw new Error('synthetic renderer failure');
    };
    render(
      <ErrorBoundary>
        <Throwing />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('桌面壳层暂时无法显示');
    expect(screen.getByRole('alert')).not.toHaveTextContent('synthetic renderer failure');
  });

  it('marks only the active route for assistive technology', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /总览/u })).toHaveAttribute('aria-current', 'page');
    });
    expect(
      screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current')),
    ).toHaveLength(1);
  });
});
