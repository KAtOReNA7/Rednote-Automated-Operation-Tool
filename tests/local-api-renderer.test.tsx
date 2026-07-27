// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { randomBytes, randomUUID } from 'node:crypto';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalApiSettings } from '../apps/web-ui/src/local-api-settings.js';
import type {
  DesktopBridge,
  LocalApiClientView,
  LocalApiStatusView,
  PairingView,
} from '../packages/shared/src/index.js';
import { randomExtensionOrigin } from './support/local-api-test-utils.js';

function ok<T>(value: T) {
  return { ok: true as const, value };
}

function status(overrides: Partial<LocalApiStatusView> = {}): LocalApiStatusView {
  return {
    activeClientCount: 0,
    enabled: false,
    endpoint: null,
    port: 43_119,
    projectReady: true,
    revision: 0,
    state: 'DISABLED',
    ...overrides,
  };
}

function pairing(): PairingView {
  return {
    endpoint: 'http://127.0.0.1:43119',
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    pairingCode: randomBytes(32).toString('base64url'),
    pairingSessionId: randomUUID(),
  };
}

function client(): LocalApiClientView {
  return {
    clientLabel: 'Chrome 收藏夹',
    createdAt: '2026-07-28T01:00:00.000Z',
    extensionOrigin: randomExtensionOrigin(),
    id: randomUUID(),
    lastUsedAt: null,
    revision: 0,
    status: 'ACTIVE',
    updatedAt: '2026-07-28T01:00:00.000Z',
  };
}

function installBridge(
  options: {
    readonly clients?: readonly LocalApiClientView[];
    readonly initialStatus?: LocalApiStatusView;
    readonly pairing?: PairingView;
    readonly updateFailure?: boolean;
  } = {},
) {
  let currentStatus = options.initialStatus ?? status();
  let clients = options.clients ?? [];
  const pairingValue = options.pairing ?? pairing();
  const cancelLocalApiPairing = vi.fn(async () => ok(currentStatus));
  const updateLocalApiSettings = vi.fn(async (input) => {
    if (options.updateFailure) {
      return {
        error: {
          code: 'LOCAL_API_PORT_IN_USE' as const,
          message: '本地插件端口已被占用。',
          retryable: true,
        },
        ok: false as const,
      };
    }
    currentStatus = status({
      enabled: input.enabled,
      endpoint: input.enabled ? `http://127.0.0.1:${input.port}` : null,
      port: input.port,
      revision: input.expectedRevision + 1,
      state: input.enabled ? 'RUNNING' : 'DISABLED',
    });
    return ok(currentStatus);
  });
  const revokeLocalApiClient = vi.fn(async (input) => {
    const current = clients.find(({ id }) => id === input.clientId);
    if (current === undefined) {
      throw new Error('Renderer test client was not found.');
    }
    const revoked = {
      ...current,
      revision: current.revision + 1,
      status: 'REVOKED' as const,
      updatedAt: '2026-07-28T01:00:01.000Z',
    };
    clients = clients.map((value) => (value.id === current.id ? revoked : value));
    return ok(revoked);
  });
  const bridge = {
    cancelLocalApiPairing,
    getLocalApiStatus: vi.fn(async () => ok(currentStatus)),
    listLocalApiClients: vi.fn(async () => ok(clients)),
    revokeLocalApiClient,
    startLocalApiPairing: vi.fn(async () => ok(pairingValue)),
    updateLocalApiSettings,
  } as unknown as DesktopBridge;
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    value: bridge,
  });
  return {
    bridge,
    cancelLocalApiPairing,
    pairingValue,
    revokeLocalApiClient,
    updateLocalApiSettings,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('Issue 011 local plugin settings renderer', () => {
  it('shows the real default-disabled state, configured port, and Issue 017 boundary', async () => {
    installBridge();
    render(<LocalApiSettings />);
    expect(await screen.findByText(/DISABLED · 已停用/u)).toBeInTheDocument();
    expect(screen.getByDisplayValue('43119')).toBeInTheDocument();
    expect(screen.getByText('未监听')).toBeInTheDocument();
    expect(screen.getByText(/Chrome\/Edge 收藏插件将在 Issue 017/u)).toBeInTheDocument();
    expect(screen.getByText(/没有样本保存功能/u)).toBeInTheDocument();
    expect(screen.queryByText(/连接成功/u)).not.toBeInTheDocument();
  });

  it('uses an explicit enable action and presents port conflicts without fabricated success', async () => {
    const user = userEvent.setup();
    const test = installBridge({ updateFailure: true });
    render(<LocalApiSettings />);
    await screen.findByText(/DISABLED/u);
    await user.click(screen.getByRole('button', { name: '明确启用' }));
    expect(test.updateLocalApiSettings).toHaveBeenCalledWith({
      enabled: true,
      expectedRevision: 0,
      port: 43_119,
    });
    expect(await screen.findByText('本地插件端口已被占用。')).toBeInTheDocument();
    expect(screen.queryByText(/已在 IPv4 loopback 上启用/u)).not.toBeInTheDocument();
  });

  it('shows and copies only the short-lived pairing code, then cancels and clears it', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
    const test = installBridge({
      initialStatus: status({
        enabled: true,
        endpoint: 'http://127.0.0.1:43119',
        state: 'RUNNING',
      }),
    });
    render(<LocalApiSettings />);
    await screen.findByText(/RUNNING/u);
    await user.click(screen.getByRole('button', { name: '开始配对' }));
    expect(await screen.findByText(test.pairingValue.pairingCode)).toBeInTheDocument();
    expect(screen.getByText(/剩余 120 秒/u)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '复制配对码' }));
    expect(clipboardWrite).toHaveBeenCalledWith(test.pairingValue.pairingCode);
    await user.click(screen.getByRole('button', { name: '取消配对' }));
    expect(test.cancelLocalApiPairing).toHaveBeenCalledWith({
      pairingSessionId: test.pairingValue.pairingSessionId,
    });
    expect(screen.queryByText(test.pairingValue.pairingCode)).not.toBeInTheDocument();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
  });

  it('lists no token/digest and requires explicit confirmation before revoke', async () => {
    const user = userEvent.setup();
    const activeClient = client();
    const test = installBridge({
      clients: [activeClient],
      initialStatus: status({
        activeClientCount: 1,
        enabled: true,
        endpoint: 'http://127.0.0.1:43119',
        state: 'RUNNING',
      }),
    });
    const { container } = render(<LocalApiSettings />);
    expect(await screen.findByText(activeClient.extensionOrigin)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/token|digest|authorization/iu);
    const revoke = screen.getByRole('button', { name: '撤销' });
    expect(revoke).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: '确认撤销' }));
    expect(revoke).toBeEnabled();
    await user.click(revoke);
    expect(test.revokeLocalApiClient).toHaveBeenCalledWith({
      clientId: activeClient.id,
      confirmation: 'REVOKE_LOCAL_API_CLIENT',
      expectedRevision: activeClient.revision,
    });
    expect(await screen.findByText(/客户端已撤销/u)).toBeInTheDocument();
  });

  it('cancels an active pairing when the component unmounts', async () => {
    const user = userEvent.setup();
    const test = installBridge({
      initialStatus: status({
        enabled: true,
        endpoint: 'http://127.0.0.1:43119',
        state: 'RUNNING',
      }),
    });
    const view = render(<LocalApiSettings />);
    await screen.findByText(/RUNNING/u);
    await user.click(screen.getByRole('button', { name: '开始配对' }));
    await screen.findByText(test.pairingValue.pairingCode);
    view.unmount();
    await waitFor(() => {
      expect(test.cancelLocalApiPairing).toHaveBeenCalledWith({
        pairingSessionId: test.pairingValue.pairingSessionId,
      });
    });
  });
});
