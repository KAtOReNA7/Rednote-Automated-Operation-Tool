// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { randomUUID } from 'node:crypto';

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderActionControl } from '../apps/web-ui/src/v2/provider-action-control.js';
import { V2App } from '../apps/web-ui/src/v2/app.js';
import type { V2Bridge, V2ProviderSettingsView } from '../packages/v2/src/index.js';
import { createMemoryV2Bridge } from './support/v2-test-runtime.js';

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
        blockReasons: ['费用上界无法估算，请先完善价格配置。'],
        budgetState: 'UNKNOWN',
        canConfirm: false,
        capabilityState: 'SUPPORTED',
        credentialState: 'CONFIGURED',
        expiresAt: '2026-08-09T12:02:00.000Z',
        feeEstimateMicroUsd: null,
        fetchEnabled: false,
        kind: 'WEEKLY_PLAN',
        modelId: 'research-model',
        modelSlot: 'research',
        previewToken: 'preview-token',
        providerConfigured: true,
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
    expect(screen.getByText('research-model')).toBeVisible();
    expect(screen.getByText('费用上界无法估算，请先完善价格配置。')).toBeVisible();
    expect(screen.getByRole('button', { name: '确认并执行一次' })).toBeDisabled();
    expect(confirmProviderAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(confirmProviderAction).not.toHaveBeenCalled();
    expect(screen.getByText('已取消，未调用模型、未写入结果。')).toBeVisible();
  });

  it('persists provider settings, keeps credentials write-only, and probes only after preview', async () => {
    let settings: V2ProviderSettingsView = {
      accounting: {
        hardLimitMicroUsd: '1000000',
        hardStop: false,
        priceReadyForContent: false,
        priceReadyForReply: false,
        priceReadyForWeeklyPlan: false,
        warning: false,
      },
      capabilityProbe: { activeRun: null, derivedState: 'NEVER_RUN' },
      credentialState: 'NOT_CONFIGURED',
      providerBaseUrl: 'https://provider.example/v1',
      providerConfigured: true,
      research: { modelId: 'research-v1', state: 'STALE' },
      revision: 1,
      setupAvailable: true,
      writing: { modelId: 'writing-v1', state: 'UNSUPPORTED' },
    };
    const updateProviderSettings = vi.fn(async (input) => {
      settings = {
        ...settings,
        providerBaseUrl: input.providerBaseUrl,
        research: { ...settings.research, modelId: input.researchModelId },
        revision: settings.revision + 1,
        writing: { ...settings.writing, modelId: input.writingModelId },
      };
      return { ok: true as const, value: settings };
    });
    const setProviderCredential = vi.fn(async () => {
      settings = { ...settings, credentialState: 'CONFIGURED' };
      return { ok: true as const, value: settings };
    });
    const clearProviderCredential = vi.fn(async () => {
      settings = { ...settings, credentialState: 'NOT_CONFIGURED' };
      return { ok: true as const, value: settings };
    });
    const previewProviderCapabilityProbe = vi.fn(async () => ({
      ok: true as const,
      value: {
        budgetReady: false,
        credentialBindingVersion: 2,
        expiresAt: '2026-08-09T15:00:00.000Z',
        feeEstimate: 'UNKNOWN' as const,
        planHash: 'probehash',
        requestCount: 2,
        settingsRevision: 2,
        startToken: 'probe-token',
      },
    }));
    expose({
      ...createMemoryV2Bridge(),
      clearProviderCredential,
      previewProviderCapabilityProbe,
      readProviderSettings: async () => ({ ok: true, value: settings }),
      setProviderCredential,
      updateProviderSettings,
    });
    window.history.replaceState(null, '', '#/v2/settings');
    const user = userEvent.setup();
    render(<V2App />);
    expect(await screen.findByDisplayValue('https://provider.example/v1')).toBeVisible();
    expect(screen.getByText(/研究槽：已过期/)).toBeVisible();
    expect(screen.getByText(/写作槽：不支持/)).toBeVisible();
    expect(previewProviderCapabilityProbe).not.toHaveBeenCalled();
    await user.clear(screen.getByRole('textbox', { name: '研究模型 ID' }));
    await user.type(screen.getByRole('textbox', { name: '研究模型 ID' }), 'research-v2');
    await user.click(screen.getByRole('button', { name: '保存 AI 服务设置' }));
    expect(updateProviderSettings).toHaveBeenCalledWith(
      expect.objectContaining({ researchModelId: 'research-v2' }),
    );
    const runtimeCredential = `credential-${randomUUID()}`;
    const secret = screen.getByLabelText('设置或替换凭据');
    await user.type(secret, runtimeCredential);
    await user.click(screen.getByRole('button', { name: '加密保存凭据' }));
    expect(setProviderCredential).toHaveBeenCalledWith({ plaintext: runtimeCredential });
    expect(secret).toHaveValue('');
    expect(document.body).not.toHaveTextContent(runtimeCredential);
    expect(screen.getByRole('button', { name: '清除凭据' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: '我确认清除凭据' }));
    await user.click(screen.getByRole('button', { name: '清除凭据' }));
    expect(clearProviderCredential).toHaveBeenCalledWith({
      confirmation: 'DELETE_CONTENT_AI_API_KEY',
    });
    await user.click(screen.getByRole('button', { name: '预览能力检查' }));
    expect(previewProviderCapabilityProbe).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/费用无法估算/)).toBeVisible();
    expect(screen.getByRole('button', { name: '确认并启动' })).toBeDisabled();
    cleanup();
    settings = {
      ...settings,
      research: { ...settings.research, state: 'UNKNOWN' },
      writing: { ...settings.writing, state: 'SUPPORTED' },
    };
    render(<V2App />);
    expect(await screen.findByDisplayValue('research-v2')).toBeVisible();
    expect(screen.getByText(/研究槽：未知/)).toBeVisible();
    expect(screen.getByText(/写作槽：支持/)).toBeVisible();
  });

  it('confirms once, refreshes persisted data, and exposes uncertain outcomes as blocking state', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const previewProviderAction = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        blockReasons: [],
        budgetState: 'ALLOWED',
        canConfirm: true,
        capabilityState: 'SUPPORTED',
        credentialState: 'CONFIGURED',
        expiresAt: '2026-08-09T12:02:00.000Z',
        feeEstimateMicroUsd: '4200',
        fetchEnabled: false,
        kind: 'REPLY_SUGGESTION',
        modelId: 'writing-model',
        modelSlot: 'writing',
        previewToken: 'preview-token',
        providerConfigured: true,
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
