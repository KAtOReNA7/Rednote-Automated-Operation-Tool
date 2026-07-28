// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopBridge, SearchStateView } from '../packages/shared/src/index.js';
import { SearchProviderSettings } from '../apps/web-ui/src/search-provider-settings.js';
import { SearchRunPanel } from '../apps/web-ui/src/search-run-panel.js';

const state: SearchStateView = {
  adapters: [
    {
      budgetState: 'NOT_APPLICABLE',
      capabilityState: 'NOT_APPLICABLE',
      codecState: 'NOT_APPLICABLE',
      credentialState: 'NOT_APPLICABLE',
      curatedEntries: [],
      displayName: '手工 URL',
      enabled: true,
      features: ['manualUrl', 'structuredSources'],
      kind: 'MANUAL_URL',
      maxResults: 1,
      mode: 'PASSIVE_LOCAL',
      providerInstanceId: 'manual-url-v1',
      ratePolicy: null,
      rateState: 'NOT_APPLICABLE',
      readiness: 'READY',
      settingsRevision: 1,
      timeoutMs: 5_000,
    },
    {
      budgetState: 'UNAVAILABLE',
      capabilityState: 'NOT_APPLICABLE',
      codecState: 'UNAVAILABLE',
      credentialState: 'REQUIRED',
      curatedEntries: [],
      displayName: '独立 Search API（接口预留）',
      enabled: false,
      features: ['query', 'structuredSources'],
      kind: 'SEARCH_API',
      maxResults: 20,
      mode: 'ACTIVE_REMOTE',
      providerInstanceId: 'search-api-v1',
      ratePolicy: {
        contractVersion: 'search-rate-policy-v1',
        maxConcurrent: 1,
        maxRequestsPerWindow: 30,
        maxResponseBytes: 2_097_152,
        maxResults: 20,
        minIntervalMs: 1_000,
        revision: 1,
        timeoutMs: 30_000,
        windowMs: 60_000,
      },
      rateState: 'READY',
      readiness: 'CODEC_UNAVAILABLE',
      settingsRevision: 1,
      timeoutMs: 30_000,
    },
  ],
  boundaries: {
    browserClip: 'Issue 017 才接插件。',
    discovery: 'LEAD_ONLY，不是事实。',
    fetching: 'Issue 016 才抓网页。',
  },
  overallReadiness: 'PASSIVE_ONLY',
  recentRuns: [
    {
      candidateCount: 2,
      duplicateCount: 1,
      executionId: 'execution-hidden-from-table',
      finishedAt: '2026-07-28T00:00:01.000Z',
      providerInstanceId: 'manual-url-v1',
      rejectedCount: 0,
      searchRunId: 'run-hidden-from-table',
      stableError: null,
      startedAt: '2026-07-28T00:00:00.000Z',
      status: 'SUCCEEDED',
    },
  ],
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteDesktop');
});

function installBridge(): void {
  const bridge = {
    getSearchState: vi.fn().mockResolvedValue({ ok: true, value: state }),
    updateSearchProviderConfig: vi.fn().mockResolvedValue({ ok: true, value: state }),
  } as unknown as DesktopBridge;
  Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
}

describe('Issue 015 renderer surfaces', () => {
  it('shows five-facet readiness and explicit Issue 016/017 boundaries without execution UI', async () => {
    installBridge();
    render(<SearchProviderSettings />);
    await screen.findByText('手工 URL');
    expect(screen.getByText('PASSIVE_ONLY')).toBeInTheDocument();
    expect(screen.getByText('Issue 016 才抓网页。')).toBeInTheDocument();
    expect(screen.getByText('Issue 017 才接插件。')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /执行搜索|开始搜索|抓取/u }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/API.*key|endpoint|raw JSON/iu)).not.toBeInTheDocument();
  });

  it('shows SearchRun status and counts but omits query, preview, URL, endpoint and identifiers', async () => {
    installBridge();
    render(<SearchRunPanel />);
    await waitFor(() => expect(screen.getByText('SUCCEEDED')).toBeInTheDocument());
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('execution-hidden-from-table')).not.toBeInTheDocument();
    expect(screen.queryByText('run-hidden-from-table')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/https?:\/\/|execution-hidden|run-hidden/iu);
  });
});
