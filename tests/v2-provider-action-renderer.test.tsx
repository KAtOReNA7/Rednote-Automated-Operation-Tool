// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderActionControl } from '../apps/web-ui/src/v2/provider-action-control.js';
import type { V2Bridge } from '../packages/v2/src/index.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteV2');
  window.history.replaceState(null, '', '/');
});

function expose(methods: Partial<V2Bridge>): void {
  Object.defineProperty(window, 'rednoteV2', {
    configurable: true,
    value: methods as V2Bridge,
  });
}

describe('V2 R07 provider action renderer', () => {
  it('requires preview and explicit confirmation and lets the user cancel without execution', async () => {
    const previewProviderAction = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        expiresAt: '2026-08-09T12:02:00.000Z',
        feeEstimate: 'UNKNOWN',
        fetchEnabled: false,
        kind: 'WEEKLY_PLAN',
        modelSlot: 'research',
        previewToken: 'preview-token',
        requestCount: 1,
        searchEnabled: false,
        summary: '使用 research 模型槽生成下一周计划候选。',
      },
    });
    const confirmProviderAction = vi.fn();
    expose({ confirmProviderAction, previewProviderAction });
    const user = userEvent.setup();
    render(
      <ProviderActionControl
        intent={{ expectedRevision: 0, kind: 'WEEKLY_PLAN', weekKey: '2026-W31' }}
        label="预览生成下周计划"
        onSuccess={vi.fn()}
      />,
    );
    expect(previewProviderAction).not.toHaveBeenCalled();
    expect(confirmProviderAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '预览生成下周计划' }));
    expect(await screen.findByText('搜索 / 抓取')).toBeVisible();
    expect(screen.getByText('关闭 / 关闭')).toBeVisible();
    expect(confirmProviderAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(confirmProviderAction).not.toHaveBeenCalled();
    expect(screen.getByText('已取消，未调用模型、未写入结果。')).toBeVisible();
  });

  it('confirms once, refreshes persisted data, and exposes uncertain outcomes as blocking state', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const previewProviderAction = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        expiresAt: '2026-08-09T12:02:00.000Z',
        feeEstimate: 'UNKNOWN',
        fetchEnabled: false,
        kind: 'REPLY_SUGGESTION',
        modelSlot: 'writing',
        previewToken: 'preview-token',
        requestCount: 1,
        searchEnabled: false,
        summary: '生成回复建议。',
      },
    });
    const confirmProviderAction = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          costAmountMicroUsd: null,
          costState: 'UNPRICED_USAGE',
          externalRequestCount: 1,
          kind: 'REPLY_SUGGESTION',
          status: 'SUCCEEDED',
        },
      })
      .mockResolvedValueOnce({
        error: {
          affectedFields: [],
          code: 'PROVIDER_ACTION_UNCERTAIN',
          message: '请求结果不确定，系统未写入业务结果，请先检查本地账本。',
          severity: 'ERROR',
          suggestedAction: '打开设置与模型账本核对后再决定',
        },
        ok: false,
      });
    expose({ confirmProviderAction, previewProviderAction });
    const user = userEvent.setup();
    const view = render(
      <ProviderActionControl
        intent={{
          expectedRevision: 0,
          idempotencyKey: 'reply-one',
          itemId: 'interaction-one',
          kind: 'REPLY_SUGGESTION',
        }}
        label="预览生成回复建议"
        onSuccess={onSuccess}
      />,
    );
    await user.click(screen.getByRole('button', { name: '预览生成回复建议' }));
    await user.click(screen.getByRole('button', { name: '确认并执行一次' }));
    expect(confirmProviderAction).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    view.unmount();

    render(
      <ProviderActionControl
        intent={{
          expectedRevision: 0,
          idempotencyKey: 'reply-two',
          itemId: 'interaction-two',
          kind: 'REPLY_SUGGESTION',
        }}
        label="再次预览"
        onSuccess={onSuccess}
      />,
    );
    await user.click(screen.getByRole('button', { name: '再次预览' }));
    await user.click(screen.getByRole('button', { name: '确认并执行一次' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请求结果不确定');
    expect(screen.getByRole('button', { name: '前往设置' })).toBeVisible();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
