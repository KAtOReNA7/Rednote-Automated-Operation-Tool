// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderCapabilitySettings } from '../apps/web-ui/src/provider-capability-settings.js';
import type { DesktopBridge } from '../packages/shared/src/index.js';

function installBridge(overrides: Partial<DesktopBridge> = {}): void {
  const bridge = {
    cancelProviderCapabilityProbe: async (input: { readonly runId: string }) => ({
      ok: true as const,
      value: {
        completedRequestCount: 0,
        currentCapability: null,
        plannedRequestCount: 5,
        runId: input.runId,
        sentRequestCount: 0,
        status: 'RUNNING' as const,
      },
    }),
    getProviderCapabilityProbeProgress: async (input: { readonly runId: string }) => ({
      ok: true as const,
      value: {
        completedRequestCount: 5,
        currentCapability: null,
        plannedRequestCount: 5,
        runId: input.runId,
        sentRequestCount: 5,
        status: 'SUCCEEDED' as const,
      },
    }),
    getProviderCapabilityState: async () => ({
      ok: true as const,
      value: {
        activeRun: null,
        derivedState: 'NOT_PROBED' as const,
        entries: [],
        history: [],
        runId: null,
      },
    }),
    previewProviderCapabilityProbe: async () => ({
      ok: true as const,
      value: {
        budgetCheck: 'UNIT_POLICY_READY' as const,
        credentialBindingVersion: 2,
        expiresAt: '2099-01-01T00:00:00.000Z',
        feeEstimate: 'UNKNOWN' as const,
        planHash: 'a'.repeat(64),
        profile: 'CORE' as const,
        requestCount: 5,
        settingsRevision: 7,
        startToken: 'b'.repeat(43),
      },
    }),
    startProviderCapabilityProbe: async () => ({
      ok: true as const,
      value: {
        completedRequestCount: 0,
        currentCapability: null,
        plannedRequestCount: 5,
        runId: 'probe-renderer-000001',
        sentRequestCount: 0,
        status: 'RUNNING' as const,
      },
    }),
    ...overrides,
  } as unknown as DesktopBridge;
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    value: bridge,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Issue 013 capability settings renderer', () => {
  it('keeps confirmation unchecked and previews without starting', async () => {
    const start = vi.fn<DesktopBridge['startProviderCapabilityProbe']>(async () => ({
      ok: true,
      value: {
        completedRequestCount: 0,
        currentCapability: null,
        plannedRequestCount: 5,
        runId: 'probe-renderer-000001',
        sentRequestCount: 0,
        status: 'RUNNING',
      },
    }));
    installBridge({ startProviderCapabilityProbe: start });
    const user = userEvent.setup();
    render(<ProviderCapabilitySettings disabled={false} revision={7} />);

    expect(await screen.findByText(/NOT_PROBED/u)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '预览探测计划' }));
    expect(await screen.findByText(/将发送/u)).toHaveTextContent('5');
    const confirmation = screen.getByRole('checkbox', {
      name: /我确认主动执行这些请求/u,
    });
    expect(confirmation).not.toBeChecked();
    expect(screen.getByRole('button', { name: '开始能力探测' })).toBeDisabled();
    expect(start).not.toHaveBeenCalled();
  });

  it('starts only after explicit confirmation and shows bounded progress', async () => {
    installBridge();
    const user = userEvent.setup();
    render(<ProviderCapabilitySettings disabled={false} revision={7} />);
    await screen.findByText(/NOT_PROBED/u);
    await user.click(screen.getByRole('button', { name: '预览探测计划' }));
    await user.click(screen.getByRole('checkbox', { name: /我确认主动执行这些请求/u }));
    await user.click(screen.getByRole('button', { name: '开始能力探测' }));
    expect(await screen.findByText(/能力探测已开始/u)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/SUCCEEDED/u)).toBeInTheDocument());
  });

  it('renders slot/model/mode/observedAt matrix and safe history without URLs', async () => {
    installBridge({
      getProviderCapabilityState: async () => ({
        ok: true,
        value: {
          activeRun: null,
          derivedState: 'PROBE_COMPLETE',
          entries: [
            {
              capability: 'text',
              confidence: 'CONFIRMED',
              maxContextTokens: null,
              modelId: 'fixture-model',
              modelSlot: 'RESEARCH',
              observedAt: '2026-07-28T00:00:00.000Z',
              protocolMode: 'RESPONSES',
              rateLimitRequests: null,
              rateLimitTokens: null,
              reasonCode: 'NOT_PROBED',
              safeDetails: {},
              source: 'PROBED',
              stale: false,
              state: 'SUPPORTED',
            },
          ],
          history: [
            {
              completedAt: '2026-07-28T00:00:01.000Z',
              plannedRequestCount: 5,
              profile: 'CORE',
              reasonCode: null,
              runId: 'probe-renderer-000002',
              sentRequestCount: 5,
              startedAt: '2026-07-28T00:00:00.000Z',
              status: 'SUCCEEDED',
            },
          ],
          runId: 'probe-renderer-000002',
        },
      }),
    });
    render(<ProviderCapabilitySettings disabled={false} revision={7} />);
    expect(await screen.findByRole('table', { name: '当前能力矩阵' })).toBeInTheDocument();
    expect(screen.getByText('RESEARCH')).toBeInTheDocument();
    expect(screen.getByText('fixture-model')).toBeInTheDocument();
    expect(screen.getByText('RESPONSES')).toBeInTheDocument();
    expect(screen.getByText('2026-07-28T00:00:00.000Z')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/https?:\/\/|authorization|api.?key/iu);
  });
});
