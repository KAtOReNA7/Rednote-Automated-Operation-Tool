// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsPage } from '../apps/web-ui/src/settings-page.js';
import type {
  DesktopBridge,
  DesktopResult,
  SettingsBundle,
  SetupStateView,
} from '../packages/shared/src/index.js';
import { runtimeUnusableValue } from './support/settings-test-utils.js';

function settingsBundle(
  overrides: {
    readonly credentialStatus?: SettingsBundle['credential']['status'];
    readonly providerBaseUrl?: string | null;
    readonly revision?: number;
    readonly workingName?: string;
  } = {},
): SettingsBundle {
  const credentialStatus = overrides.credentialStatus ?? 'NOT_CONFIGURED';
  return {
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
      workingName: overrides.workingName ?? '未命名账号',
    },
    credential: {
      available: credentialStatus !== 'UNAVAILABLE',
      requiresReauth: credentialStatus === 'CORRUPT' || credentialStatus === 'REAUTH_REQUIRED',
      status: credentialStatus,
    },
    providerCapability: 'UNPROBED',
    settings: {
      credentialReference: credentialStatus === 'CONFIGURED' ? 'CONTENT_AI_API_KEY' : null,
      embeddingModelId: null,
      imageModelId: null,
      monthlyHardLimitCents: 10_000,
      monthlyWarningCents: 8_000,
      providerBaseUrl: overrides.providerBaseUrl ?? null,
      providerProtocol: 'OPENAI_COMPATIBLE',
      researchModelId: null,
      reviewModelId: null,
      revision: overrides.revision ?? 0,
      setupState: 'LOCAL_PROJECT_READY',
      updatedAt: '2026-07-27T00:00:00.000Z',
      writingModelId: null,
    },
  };
}

const READY_SETUP: SetupStateView = {
  project: {
    displayPath: 'C:\\本地项目 数据',
    revision: 0,
    status: 'READY',
  },
  setupState: 'LOCAL_PROJECT_READY',
};

function ok<T>(value: T): DesktopResult<T> {
  return { ok: true, value };
}

function makeBridge(
  overrides: Partial<DesktopBridge> = {},
  bundle = settingsBundle(),
): DesktopBridge {
  return {
    buildDiagnosticPreview: async () =>
      ok({
        content: '{"credential":{"configured":false},"provider":{"capability":"UNPROBED"}}\n',
        hash: 'a'.repeat(64),
      }),
    clearCredential: async () =>
      ok({ available: true, requiresReauth: false, status: 'NOT_CONFIGURED' }),
    confirmModelCacheClear: async () =>
      ok({ deletedFiles: 0, orphanFiles: 0, tombstonedEntries: 0 }),
    confirmDataRootSelection: async () => ok(READY_SETUP),
    createModelPriceSchedule: async (input) =>
      ok({
        id: 'price-fixture',
        modelId: input.modelId,
        operationKind: input.operationKind,
        protocolMode: input.protocolMode,
        status: 'ACTIVE',
        version: 1,
      }),
    createModelUnitPolicy: async (input) =>
      ok({
        id: 'units-fixture',
        maxExternalCallsMonthly: input.maxExternalCallsMonthly,
        maxExternalCallsWeekly: input.maxExternalCallsWeekly,
        scopeKind: input.scopeKind,
        scopeValue: input.scopeValue,
        status: 'ACTIVE',
        version: 1,
      }),
    exportDiagnosticReport: async (input) =>
      ok({
        managedPath: 'exports/diagnostics/basic-report.json',
        previewHash: input.expectedPreviewHash,
      }),
    getAppInfo: async () => ok({ name: '红笺本地运营台', platform: 'win32', version: '0.0.0' }),
    getCredentialStatus: async () => ok(bundle.credential),
    getFoundationHealth: async () =>
      ok({
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
      }),
    getModelAccounting: async () =>
      ok({
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
      }),
    getProviderCapabilityState: async () =>
      ok({
        activeRun: null,
        derivedState: 'NOT_PROBED',
        entries: [],
        history: [],
        runId: null,
      }),
    previewProviderCapabilityProbe: async (input) =>
      ok({
        budgetCheck: 'UNIT_POLICY_READY',
        credentialBindingVersion: 0,
        expiresAt: '2099-01-01T00:00:00.000Z',
        feeEstimate: 'UNKNOWN',
        planHash: 'a'.repeat(64),
        profile: input.profile,
        requestCount: 1,
        settingsRevision: bundle.settings.revision,
        startToken: 'a'.repeat(43),
      }),
    previewModelCacheClear: async () =>
      ok({
        bytes: 0,
        count: 0,
        expiresAt: '2099-01-01T00:00:00.000Z',
        outputTypes: [],
        previewToken: 'a'.repeat(43),
      }),
    startProviderCapabilityProbe: async () =>
      ok({
        completedRequestCount: 0,
        currentCapability: null,
        plannedRequestCount: 1,
        runId: 'probe-runtime-000001',
        sentRequestCount: 0,
        status: 'RUNNING',
      }),
    getProviderCapabilityProbeProgress: async (input) =>
      ok({
        completedRequestCount: 1,
        currentCapability: null,
        plannedRequestCount: 1,
        runId: input.runId,
        sentRequestCount: 1,
        status: 'SUCCEEDED',
      }),
    cancelProviderCapabilityProbe: async (input) =>
      ok({
        completedRequestCount: 0,
        currentCapability: null,
        plannedRequestCount: 1,
        runId: input.runId,
        sentRequestCount: 0,
        status: 'RUNNING',
      }),
    getLocalApiStatus: async () =>
      ok({
        activeClientCount: 0,
        enabled: false,
        endpoint: null,
        port: 43_119,
        projectReady: true,
        revision: 0,
        state: 'DISABLED',
      }),
    getRuntimeCapabilities: async () =>
      ok({
        chromiumVersion: '150',
        electronVersion: '43.2.0',
        nodeSqlite: true,
        nodeVersion: '24',
        v8Version: '15',
      }),
    getSettings: async () => ok(bundle),
    getSetupState: async () => ok(READY_SETUP),
    getWindowState: async () => ok({ isFullScreen: false, isMaximized: false }),
    listLocalApiClients: async () => ok([]),
    cancelLocalApiPairing: async () =>
      ok({
        activeClientCount: 0,
        enabled: false,
        endpoint: null,
        port: 43_119,
        projectReady: true,
        revision: 0,
        state: 'DISABLED',
      }),
    revokeLocalApiClient: async (input) =>
      ok({
        clientLabel: null,
        createdAt: '2026-07-28T00:00:00.000Z',
        extensionOrigin: `chrome-extension://${'a'.repeat(32)}`,
        id: input.clientId,
        lastUsedAt: null,
        revision: input.expectedRevision + 1,
        status: 'REVOKED',
        updatedAt: '2026-07-28T00:00:01.000Z',
      }),
    selectDataRoot: async () => ok(null),
    setCredential: async () => ok({ available: true, requiresReauth: false, status: 'CONFIGURED' }),
    startLocalApiPairing: async () =>
      ok({
        endpoint: 'http://127.0.0.1:43119',
        expiresAt: '2099-01-01T00:00:00.000Z',
        pairingCode: 'a'.repeat(43),
        pairingSessionId: 'pairing-session-000011',
      }),
    updateLocalApiSettings: async (input) =>
      ok({
        activeClientCount: 0,
        enabled: input.enabled,
        endpoint: input.enabled ? `http://127.0.0.1:${input.port}` : null,
        port: input.port,
        projectReady: true,
        revision: input.expectedRevision + 1,
        state: input.enabled ? 'RUNNING' : 'DISABLED',
      }),
    updateNonSecretSettings: async () => ok(bundle),
    ...overrides,
  };
}

function installBridge(bridge: DesktopBridge): void {
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    value: bridge,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('Issue 010 settings wizard renderer', () => {
  it('renders all six ordered steps, persisted defaults, and only an unprobed capability state', async () => {
    installBridge(makeBridge());
    render(<SettingsPage />);

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '设置向导与本地凭据引用',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '数据目录' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '中转站与模型' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '密钥状态' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '预算' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '账号策略' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '确认' })).toBeInTheDocument();
    expect(screen.getByLabelText('月度预警（美元）')).toHaveValue('80.00');
    expect(screen.getByLabelText('月度硬上限（美元，最高 100）')).toHaveValue('100.00');
    expect(screen.getByLabelText('工作名称')).toHaveValue('未命名账号');
    expect(screen.getAllByText(/尚未进行能力探测/u)).toHaveLength(2);
    expect(screen.queryByText(/连接成功|验证成功|能力可用/u)).not.toBeInTheDocument();
  });

  it('keeps the credential password-only, never prefills it, and clears on cancel and save', async () => {
    const setCredential = vi.fn<DesktopBridge['setCredential']>(async () =>
      ok({ available: true, requiresReauth: false, status: 'CONFIGURED' }),
    );
    installBridge(makeBridge({ setCredential }));
    const user = userEvent.setup();
    render(<SettingsPage />);
    const input = await screen.findByLabelText('内容 AI API 密钥');

    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: /显示密钥|复制密钥|导出密钥/u }),
    ).not.toBeInTheDocument();

    const canceledValue = runtimeUnusableValue();
    await user.type(input, canceledValue);
    await user.click(screen.getByRole('button', { name: '取消输入' }));
    expect(input).toHaveValue('');
    expect(document.body.textContent).not.toContain(canceledValue);

    const savedValue = runtimeUnusableValue();
    await user.type(input, savedValue);
    await user.click(screen.getByRole('button', { name: '安全保存密钥' }));
    await waitFor(() => expect(setCredential).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('');
    expect(document.body.textContent).not.toContain(savedValue);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('clears the sensitive DOM value on unmount and protects unsaved navigation', async () => {
    installBridge(makeBridge());
    const user = userEvent.setup();
    const rendered = render(<SettingsPage />);
    const input = (await screen.findByLabelText('内容 AI API 密钥')) as HTMLInputElement;
    const value = runtimeUnusableValue();
    await user.type(input, value);

    const event = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    rendered.unmount();
    expect(input.value).toBe('');
    expect(document.body.textContent).not.toContain(value);
  });

  it('reloads persisted state after saving instead of trusting the draft', async () => {
    const first = settingsBundle();
    const persisted = settingsBundle({
      providerBaseUrl: 'https://persisted.example/v1',
      revision: 1,
      workingName: '持久化账号',
    });
    const getSettings = vi
      .fn<DesktopBridge['getSettings']>()
      .mockResolvedValueOnce(ok(first))
      .mockResolvedValue(ok(persisted));
    const update = vi.fn<DesktopBridge['updateNonSecretSettings']>(async () => ok(persisted));
    installBridge(makeBridge({ getSettings, updateNonSecretSettings: update }, first));
    const user = userEvent.setup();
    render(<SettingsPage />);

    const name = await screen.findByLabelText('工作名称');
    await user.clear(name);
    await user.type(name, '只在草稿中');
    await user.click(screen.getByRole('button', { name: '保存非秘密设置' }));

    await waitFor(() => expect(getSettings).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('工作名称')).toHaveValue('持久化账号');
    expect(screen.getByLabelText('Base URL（可稍后填写）')).toHaveValue(
      'https://persisted.example/v1',
    );
  });

  it('shows loading, first-run, recovery, error, unavailable, and conflict states', async () => {
    let resolveSetup: ((result: DesktopResult<SetupStateView>) => void) | undefined;
    const pending = new Promise<DesktopResult<SetupStateView>>((resolve) => {
      resolveSetup = resolve;
    });
    installBridge(makeBridge({ getSetupState: async () => pending }));
    const loading = render(<SettingsPage />);
    expect(screen.getByText('正在读取本地设置')).toBeInTheDocument();
    resolveSetup?.(ok({ project: { status: 'NOT_CONFIGURED' }, setupState: 'NO_PROJECT' }));
    expect(await screen.findByText('先建立本地项目')).toBeInTheDocument();
    loading.unmount();

    installBridge(
      makeBridge({
        getSetupState: async () =>
          ok({
            project: {
              errorCode: 'PROJECT_LOCATOR_INVALID',
              status: 'RECOVERY_REQUIRED',
            },
            setupState: 'NO_PROJECT',
          }),
      }),
    );
    const recovery = render(<SettingsPage />);
    expect(await screen.findByText('本地项目定位记录不可用')).toBeInTheDocument();
    recovery.unmount();

    installBridge(
      makeBridge({
        getSetupState: async () => ({
          error: {
            code: 'INTERNAL_ERROR',
            message: '安全的读取失败说明',
            retryable: false,
          },
          ok: false,
        }),
      }),
    );
    const error = render(<SettingsPage />);
    expect(await screen.findByText('安全的读取失败说明')).toBeInTheDocument();
    error.unmount();

    const unavailable = settingsBundle({ credentialStatus: 'UNAVAILABLE' });
    installBridge(makeBridge({}, unavailable));
    const unavailableView = render(<SettingsPage />);
    expect(await screen.findByText(/系统保护不可用/u)).toBeInTheDocument();
    expect(screen.getByLabelText('内容 AI API 密钥').closest('fieldset')).toBeDisabled();
    unavailableView.unmount();

    installBridge(
      makeBridge({
        updateNonSecretSettings: async () => ({
          error: {
            code: 'SETTINGS_REVISION_CONFLICT',
            message: '设置已在其他位置更新，请刷新后重试。',
            retryable: true,
          },
          ok: false,
        }),
      }),
    );
    const conflict = render(<SettingsPage />);
    const user = userEvent.setup();
    const workingName = await screen.findByLabelText('工作名称');
    await user.type(workingName, '变更');
    await user.click(screen.getByRole('button', { name: '保存非秘密设置' }));
    expect(await screen.findByText('设置已在其他位置更新，请刷新后重试。')).toBeInTheDocument();
    conflict.unmount();
  });

  it('requires explicit destructive confirmations and exports only a preview-bound report', async () => {
    const configured = settingsBundle({ credentialStatus: 'CONFIGURED' });
    const clearCredential = vi.fn<DesktopBridge['clearCredential']>(async () =>
      ok({ available: true, requiresReauth: false, status: 'NOT_CONFIGURED' }),
    );
    const exportDiagnosticReport = vi.fn<DesktopBridge['exportDiagnosticReport']>(async (input) =>
      ok({
        managedPath: 'exports/diagnostics/basic-report.json',
        previewHash: input.expectedPreviewHash,
      }),
    );
    installBridge(makeBridge({ clearCredential, exportDiagnosticReport }, configured));
    const user = userEvent.setup();
    render(<SettingsPage />);
    await screen.findByText('当前：已配置');

    await user.click(screen.getByRole('button', { name: '删除本地密钥' }));
    expect(clearCredential).not.toHaveBeenCalled();
    expect(screen.getByText('删除前请确认，之后需要重新输入密钥。')).toBeInTheDocument();
    await user.click(screen.getByLabelText('我知道删除后需要重新输入密钥'));
    await user.click(screen.getByRole('button', { name: '删除本地密钥' }));
    await waitFor(() => expect(clearCredential).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: '生成预览' }));
    expect(await screen.findByText(/"configured":false/u)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '导出当前预览' }));
    await waitFor(() =>
      expect(exportDiagnosticReport).toHaveBeenCalledWith({
        expectedPreviewHash: 'a'.repeat(64),
      }),
    );
  });

  it('uses semantic controls that remain keyboard reachable', async () => {
    installBridge(makeBridge());
    render(<SettingsPage />);
    await screen.findByRole('heading', { name: '设置向导与本地凭据引用' });
    const choose = screen.getByRole('button', { name: '选择数据目录' });
    choose.focus();
    expect(choose).toHaveFocus();
    fireEvent.keyDown(choose, { key: 'Enter' });
  });
});
