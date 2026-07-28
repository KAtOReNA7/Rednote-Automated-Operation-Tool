// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelAccountingCenter } from '../apps/web-ui/src/model-accounting-center.js';
import type { DesktopBridge } from '../packages/shared/src/index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Issue 014 accounting task center', () => {
  it('shows UTC, unknown cost, distinct cache language and two-stage clearing', async () => {
    const confirm = vi.fn(async () => ({
      ok: true as const,
      value: { deletedFiles: 1, orphanFiles: 0, tombstonedEntries: 1 },
    }));
    const bridge = {
      confirmModelCacheClear: confirm,
      getModelAccounting: async () => ({
        ok: true as const,
        value: {
          billingMonth: '2026-07',
          cacheBytes: 123,
          cacheEntries: 1,
          cacheHitCount: 1,
          estimatedKnownMicroUsd: '0',
          hardLimitMicroUsd: '100000000',
          hardStop: false,
          outstandingReservationMicroUsd: '0',
          priceSchedules: [],
          providerReportedMicroUsd: '0',
          recentRuns: [
            {
              costAmountMicroUsd: null,
              costState: 'UNKNOWN_POSSIBLY_INCURRED',
              executionId: 'execution-ui',
              externalRequestCount: 1,
              localCacheHit: false,
              modelId: 'fixture-model',
              modelSlot: 'WRITING',
              protocolMode: 'MOCK',
              stableErrorCode: 'INTERRUPTED',
              status: 'AMBIGUOUS',
              taskKind: 'TEXT_GENERATION',
            },
          ],
          uncertainReservationMicroUsd: '1000',
          unitPolicies: [],
          unknownCostCallCount: 1,
          warning: false,
          warningLimitMicroUsd: '80000000',
        },
      }),
      getSettings: async () => ({
        ok: true as const,
        value: {
          settings: { revision: 0 },
        },
      }),
      previewModelCacheClear: async () => ({
        ok: true as const,
        value: {
          bytes: 123,
          count: 1,
          expiresAt: '2099-01-01T00:00:00.000Z',
          outputTypes: ['TEXT'],
          previewToken: 'a'.repeat(43),
        },
      }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });

    render(<ModelAccountingCenter />);
    expect(await screen.findByText('2026-07 UTC')).toBeVisible();
    expect(screen.getByText('未知（不按 $0 处理）')).toBeVisible();
    expect(screen.getByText('命中时未发起外部请求')).toBeVisible();
    expect(screen.getByText('供应商缓存输入不计入本地命中率')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: '预览清理' }));
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: '再次确认清理' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  });
});
