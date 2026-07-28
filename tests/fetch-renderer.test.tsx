// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchPolicySettings } from '../apps/web-ui/src/fetch-policy-settings.js';
import { FetchRunPanel } from '../apps/web-ui/src/fetch-run-panel.js';
import type { DesktopBridge, FetchStateView } from '../packages/shared/src/index.js';

const state: FetchStateView = {
  policy: {
    charset: 'ALLOWLIST',
    maxDecodedBytes: 4_194_304,
    maxRawBytes: 2_097_152,
    maxRedirects: 3,
    mime: 'HTML_XHTML_TEXT_ONLY',
    rate: 'PERSISTENT_PER_ORIGIN',
    robots: 'RFC9309_FAIL_CLOSED',
  },
  profile: {
    enabled: false,
    globalMaxConcurrent: 2,
    id: 'controlled-public-page-v1',
    maxRequestsPerWindow: 30,
    minIntervalMs: 2_000,
    perOriginMaxConcurrent: 1,
    revision: 1,
    windowMs: 60_000,
  },
  ready: false,
  recentRuns: [
    {
      candidateId: 'candidate-visible-001',
      charset: 'utf-8',
      displayHost: 'news.example.test',
      documentSaved: true,
      externalRequestCount: 2,
      fetchRunId: 'run-must-not-be-rendered',
      mimeType: 'text/html',
      receivedBytes: 1_024,
      redactionCount: 1,
      redirectCount: 0,
      stableError: null,
      stage: 'SUCCEEDED',
    },
  ],
  storageReady: true,
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteDesktop');
});

function installBridge() {
  const updateFetchPolicy = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      ...state,
      profile: { ...state.profile, enabled: true, revision: 2 },
      ready: true,
    },
  });
  const bridge = {
    getFetchState: vi.fn().mockResolvedValue({ ok: true, value: state }),
    updateFetchPolicy,
  } as unknown as DesktopBridge;
  Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
  return { updateFetchPolicy };
}

describe('Issue 016 limited renderer surfaces', () => {
  it('shows policy/readiness and only submits the bounded policy DTO', async () => {
    const { updateFetchPolicy } = installBridge();
    render(<FetchPolicySettings />);
    const checkbox = await screen.findByRole('checkbox', {
      name: '启用严格 Fetch V1 策略',
    });
    expect(screen.getByText(/不提供任意网址输入/u)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /抓取|执行|遍历/u })).not.toBeInTheDocument();
    fireEvent.click(checkbox);
    await waitFor(() => expect(updateFetchPolicy).toHaveBeenCalledOnce());
    expect(updateFetchPolicy).toHaveBeenCalledWith({
      enabled: true,
      expectedRevision: 1,
      globalMaxConcurrent: 2,
      maxRequestsPerWindow: 30,
      minIntervalMs: 2_000,
      windowMs: 60_000,
    });
  });

  it('shows only bounded run metadata and omits full URL, body, HTML and paths', async () => {
    installBridge();
    render(<FetchRunPanel />);
    await screen.findByText('SUCCEEDED');
    expect(screen.getByText('candidate-visible-001')).toBeInTheDocument();
    expect(screen.getByText('news.example.test')).toBeInTheDocument();
    expect(screen.queryByText('run-must-not-be-rendered')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /https?:\/\/|sources\/snapshots|<main>|raw header|cookie=/iu,
    );
  });
});
