// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { randomUUID } from 'node:crypto';

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderActionControl } from '../apps/web-ui/src/v2/provider-action-control.js';
import { ContentCopyGenerationControl } from '../apps/web-ui/src/v2/content-copy-generation-control.js';
import { V2App } from '../apps/web-ui/src/v2/app.js';
import type { V2Bridge, V2ProviderSettingsView } from '../packages/v2/src/index.js';
import { createMemoryV2Bridge } from './support/v2-test-runtime.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteV2');
  Reflect.deleteProperty(navigator, 'clipboard');
  window.history.replaceState(null, '', '/');
});

function expose(methods: Partial<V2Bridge>): void {
  Object.defineProperty(window, 'rednoteV2', {
    configurable: true,
    value: methods as V2Bridge,
  });
}

describe('V2 R07 provider action renderer', () => {
  it('previews and executes content copy through the dedicated bridge without image requests', async () => {
    const previewContentCopyGeneration = vi.fn(async (input) => ({
      ok: true as const,
      value: {
        blockReasons: input.userApprovedUnknownCost ? [] : ['费用未知；请明确授权。'],
        budgetState: 'UNKNOWN' as const,
        canConfirm: input.userApprovedUnknownCost,
        capabilityEvidenceId: 'chat-evidence',
        credentialBinding: 'credential-binding',
        credentialState: 'CONFIGURED' as const,
        expiresAt: '2026-08-16T12:00:00.000Z',
        feeEstimateMicroUsd: null,
        fetchEnabled: false as const,
        itemBlockReasons: {},
        modelId: 'writing-model',
        previewToken: input.userApprovedUnknownCost ? 'copy-token' : null,
        protocolMode: 'CHAT_COMPLETIONS' as const,
        requestCount: 3 as const,
        searchEnabled: false as const,
        selectedPlanItemIds: input.selectedPlanItemIds,
        unknownCostApproved: input.userApprovedUnknownCost,
        weekKey: input.weekKey,
      },
    }));
    const executeContentCopyGeneration = vi.fn(async () => ({
      ok: true as const,
      value: {
        externalRequestCount: 3 as const,
        items: ['mon-1', 'mon-2', 'mon-3'].map((planItemId) => ({
          message: '文案已生成，待补封面。',
          packageId: `pkg-${planItemId}`,
          planItemId,
          providerRequestId: 'provider-request-safe-1',
          safeDiagnostic: null,
          status: 'SUCCEEDED' as const,
          technicalCode: null,
        })),
        weekKey: '2026-W31',
      },
    }));
    expose({ executeContentCopyGeneration, previewContentCopyGeneration });
    const user = userEvent.setup();
    render(
      <ContentCopyGenerationControl
        onComplete={vi.fn().mockResolvedValue(undefined)}
        selectedPlanItemIds={['mon-1', 'mon-2', 'mon-3']}
        weekKey="2026-W31"
      />,
    );
    await user.click(screen.getByRole('button', { name: '预览生成 3 份文案' }));
    expect(screen.getByText('CHAT_COMPLETIONS')).toBeVisible();
    expect(screen.getByText('0 次')).toBeVisible();
    expect(screen.getByText('关闭 / 关闭')).toBeVisible();
    await user.click(
      screen.getByRole('checkbox', { name: '我了解费用未知，仍授权本次最多 3 次文本请求' }),
    );
    await user.click(screen.getByRole('button', { name: '确认并生成 3 份文案' }));
    expect(executeContentCopyGeneration).toHaveBeenCalledWith({ previewToken: 'copy-token' });
    expect(await screen.findAllByText('成功：文案已生成，待补封面。')).toHaveLength(3);
  });

  it('shows a finite field-level schema reason without response content', async () => {
    expose({
      executeContentCopyGeneration: async () => ({
        ok: true,
        value: {
          externalRequestCount: 1,
          items: [
            {
              message: '模型返回的 JSON 缺少或写错了内容字段，未保存任何内容。',
              packageId: null,
              planItemId: 'mon-1',
              providerRequestId: 'req-safe-123',
              safeDiagnostic: {
                actualRootType: 'object',
                expectedType: 'non-empty string',
                issuePath: ['title'],
                rootKeys: ['body', 'materialNotes', 'tags'],
              },
              status: 'FAILED',
              technicalCode: 'PROVIDER_SCHEMA_VALIDATION_FAILED:title',
            },
          ],
          weekKey: '2026-W31',
        },
      }),
      previewContentCopyGeneration: async () => ({
        ok: true,
        value: {
          blockReasons: [],
          budgetState: 'ALLOWED',
          canConfirm: true,
          capabilityEvidenceId: 'evidence',
          credentialBinding: 'credential',
          credentialState: 'CONFIGURED',
          expiresAt: '2026-08-16T12:00:00.000Z',
          feeEstimateMicroUsd: '1000',
          fetchEnabled: false,
          itemBlockReasons: {},
          modelId: 'writing-model',
          previewToken: 'copy-token',
          protocolMode: 'CHAT_COMPLETIONS',
          requestCount: 1,
          searchEnabled: false,
          selectedPlanItemIds: ['mon-1'],
          unknownCostApproved: false,
          weekKey: '2026-W31',
        },
      }),
    });
    const user = userEvent.setup();
    render(
      <ContentCopyGenerationControl
        onComplete={vi.fn().mockResolvedValue(undefined)}
        selectedPlanItemIds={['mon-1']}
        weekKey="2026-W31"
      />,
    );
    await user.click(screen.getByRole('button', { name: '预览生成 1 份文案' }));
    await user.click(screen.getByRole('button', { name: '确认并生成 1 份文案' }));
    expect(
      await screen.findByText('失败：模型返回的 JSON 缺少或写错了内容字段，未保存任何内容。'),
    ).toBeVisible();
    await user.click(screen.getByText('技术信息'));
    expect(screen.getByText('失败字段：title')).toBeVisible();
    expect(screen.getByText('期望类型：non-empty string')).toBeVisible();
    expect(screen.getByText('实际根类型：object')).toBeVisible();
    expect(screen.getByText('实际根键名：body、materialNotes、tags')).toBeVisible();
  });

  it('shows a retryable error instead of an endless provider-settings loader', async () => {
    expose({
      ...createMemoryV2Bridge(),
      readProviderSettings: async () => ({
        error: {
          affectedFields: [],
          code: 'SETTINGS_NOT_READY',
          message: '本地项目数据尚未就绪。',
          severity: 'WARNING',
          suggestedAction: '重试读取',
        },
        ok: false,
      }),
    });
    window.history.replaceState(null, '', '#/v2/settings');
    const user = userEvent.setup();
    render(<V2App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('本地项目数据尚未就绪。');
    expect(screen.queryByText(/正在读取本机设置/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试读取 AI 设置' }));
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('requires preview and explicit confirmation and lets the user cancel without execution', async () => {
    const previewProviderAction = vi.fn(
      async (input) =>
        ({
          ok: true as const,
          value: {
            blockReasons: input.userApprovedUnknownCost
              ? []
              : ['费用未知；如仍要继续，必须逐次明确授权。'],
            budgetState: 'UNKNOWN',
            canConfirm: input.userApprovedUnknownCost === true,
            capabilityState: 'SUPPORTED',
            configFingerprint: 'fixture-config',
            credentialBinding: 'fixture-credential',
            credentialState: 'CONFIGURED',
            expiresAt: '2026-08-09T12:02:00.000Z',
            feeEstimateMicroUsd: null,
            fetchEnabled: false,
            kind: 'WEEKLY_PLAN',
            modelId: 'research-model',
            modelSlot: 'research',
            protocolMode: 'CHAT_COMPLETIONS',
            previewToken: input.userApprovedUnknownCost ? 'preview-token' : null,
            providerConfigured: true,
            readinessBinding: 'fixture-ready',
            reasonCode: input.userApprovedUnknownCost ? 'READY' : 'UNKNOWN_FEE_CONSENT_REQUIRED',
            reasonMessage: 'fixture',
            requestCount: 1,
            searchEnabled: false,
            summary: '使用 research 模型槽生成下一周计划候选。',
          },
        }) as const,
    );
    const confirmProviderAction = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        costAmountMicroUsd: null,
        costState: 'UNPRICED_USAGE',
        externalRequestCount: 1,
        kind: 'WEEKLY_PLAN',
        status: 'SUCCEEDED',
      },
    });
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
    expect(screen.getByText('费用未知；如仍要继续，必须逐次明确授权。')).toBeVisible();
    expect(screen.getByRole('button', { name: '确认并执行一次' })).toBeDisabled();
    expect(confirmProviderAction).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('checkbox', { name: '我了解费用未知，仍授权本次最多 1 个请求' }),
    );
    expect(previewProviderAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ userApprovedUnknownCost: true }),
    );
    expect(screen.getByRole('button', { name: '确认并执行一次' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '确认并执行一次' }));
    expect(confirmProviderAction).toHaveBeenCalledTimes(1);
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
      capabilityProbe: {
        activeRun: null,
        diagnosticText: '',
        derivedState: 'NEVER_RUN',
        latestRun: null,
        steps: [],
        summaryState: 'NOT_RUN',
      },
      credentialState: 'NOT_CONFIGURED',
      providerBaseUrl: 'https://provider.example/v1',
      providerConfigured: true,
      research: { modelId: 'research-v1', protocolMode: null, state: 'STALE' },
      revision: 1,
      setupAvailable: true,
      writing: { modelId: 'writing-v1', protocolMode: null, state: 'UNSUPPORTED' },
      image: { modelId: 'image-v1', protocolMode: null, state: 'UNKNOWN' },
    };
    const updateProviderSettings = vi.fn(async (input) => {
      settings = {
        ...settings,
        providerBaseUrl: input.providerBaseUrl,
        research: { ...settings.research, modelId: input.researchModelId },
        revision: settings.revision + 1,
        writing: { ...settings.writing, modelId: input.writingModelId },
        image: {
          ...(settings.image ?? { protocolMode: null, state: 'UNKNOWN' as const }),
          modelId: input.imageModelId,
        },
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
        budgetReady: true,
        credentialBindingVersion: 2,
        expiresAt: '2026-08-09T15:00:00.000Z',
        feeEstimate: 'UNKNOWN' as const,
        fetchEnabled: false as const,
        modelIds: ['research-v2', 'writing-v1', 'image-v2'],
        planHash: 'probehash',
        requestCount: 2,
        searchEnabled: false as const,
        settingsRevision: 2,
        startToken: 'probe-token',
      },
    }));
    const startProviderCapabilityProbe = vi.fn(async () => ({
      ok: true as const,
      value: {
        completedRequestCount: 0,
        plannedRequestCount: 2,
        runId: 'probe-run',
        sentRequestCount: 0,
        status: 'RUNNING' as const,
      },
    }));
    const readProviderCapabilityProbeProgress = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          completedRequestCount: 1,
          plannedRequestCount: 2,
          runId: 'probe-run',
          sentRequestCount: 1,
          status: 'RUNNING' as const,
        },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          completedRequestCount: 2,
          plannedRequestCount: 2,
          runId: 'probe-run',
          sentRequestCount: 2,
          status: 'SUCCEEDED' as const,
        },
      });
    expose({
      ...createMemoryV2Bridge(),
      clearProviderCredential,
      previewProviderCapabilityProbe,
      readProviderCapabilityProbeProgress,
      readProviderSettings: async () => ({ ok: true, value: settings }),
      setProviderCredential,
      startProviderCapabilityProbe,
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
    await user.clear(screen.getByRole('textbox', { name: '图片模型 ID' }));
    await user.type(screen.getByRole('textbox', { name: '图片模型 ID' }), 'image-v2');
    await user.click(screen.getByRole('button', { name: '保存 AI 服务设置' }));
    expect(updateProviderSettings).toHaveBeenCalledWith(
      expect.objectContaining({ researchModelId: 'research-v2', imageModelId: 'image-v2' }),
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
    await user.click(screen.getByRole('button', { name: '验证 R07 所需能力' }));
    expect(await screen.findByText(/凭据未配置或需重新认证/)).toBeVisible();
    await user.click(
      screen.getByRole('checkbox', { name: '我了解费用未知，仍授权本次最多 2 个能力检查请求' }),
    );
    expect(screen.getByRole('button', { name: '确认并启动' })).toBeDisabled();
    await user.type(secret, `replacement-${randomUUID()}`);
    await user.click(screen.getByRole('button', { name: '加密保存凭据' }));
    await user.click(screen.getByRole('button', { name: '验证 R07 所需能力' }));
    expect(previewProviderCapabilityProbe).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/费用无法估算/)).toBeVisible();
    expect(screen.getByRole('button', { name: '确认并启动' })).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: '我了解费用未知，仍授权本次最多 2 个能力检查请求' }),
    );
    expect(screen.getByRole('button', { name: '确认并启动' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '确认并启动' }));
    expect(startProviderCapabilityProbe).toHaveBeenCalledWith(
      expect.objectContaining({
        startToken: 'probe-token',
        userApprovedUnknownCost: true,
      }),
    );
    expect(await screen.findByText(/能力检查：检查中/)).toBeVisible();
    expect(await screen.findByText(/能力检查：已完成/)).toBeVisible();
    expect(readProviderCapabilityProbeProgress).toHaveBeenCalledTimes(2);
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

  it('shows mapped partial diagnostics, distinguishes no conclusions, and copies only safe text', async () => {
    const diagnosticText = [
      'run=probe-safe status=PARTIAL',
      'requests=2/2/2',
      'Search=关闭 Fetch=关闭 fee=UNKNOWN',
      'research+writing model=shared-model capability=structuredJson protocol=RESPONSES state=SUPPORTED code=NOT_PROBED',
      'image model=image-model capability=imageGeneration protocol=NOT_APPLICABLE state=UNKNOWN code=OUTPUT_VARIANT_UNSUPPORTED',
    ].join('\n');
    let settings: V2ProviderSettingsView = {
      accounting: {
        hardLimitMicroUsd: '1000000',
        hardStop: false,
        priceReadyForContent: false,
        priceReadyForReply: false,
        priceReadyForWeeklyPlan: false,
        warning: false,
      },
      capabilityProbe: {
        activeRun: null,
        diagnosticText,
        derivedState: 'PROBE_COMPLETE',
        latestRun: {
          completedAt: '2026-08-10T00:00:02.000Z',
          completedRequestCount: 2,
          costState: 'UNKNOWN',
          fetchEnabled: false,
          plannedRequestCount: 2,
          runId: 'probe-safe',
          searchEnabled: false,
          sentRequestCount: 2,
          startedAt: '2026-08-10T00:00:00.000Z',
          status: 'SUCCEEDED',
        },
        steps: [
          {
            capability: 'structuredJson',
            deduplicated: true,
            diagnosticCode: 'NOT_PROBED',
            httpStatus: 200,
            mappedSlots: ['research', 'writing'],
            modelId: 'shared-model',
            observedAt: '2026-08-10T00:00:01.000Z',
            protocolMode: 'RESPONSES',
            reason: '请求获得了符合强证据合同的明确结果。',
            sent: true,
            stale: false,
            state: 'SUPPORTED',
          },
          {
            capability: 'imageGeneration',
            deduplicated: false,
            diagnosticCode: 'AMBIGUOUS_OUTCOME',
            errorCode: 'invalid_parameter',
            errorParam: 'size',
            errorType: 'invalid_request_error',
            httpStatus: 400,
            mappedSlots: ['image'],
            modelId: 'image-model',
            observedAt: '2026-08-10T00:00:02.000Z',
            protocolMode: 'NOT_APPLICABLE',
            reason: 'Provider 拒绝了请求参数（HTTP 400）；能力保持未知。',
            requestId: 'req_fixture_123',
            sent: true,
            stale: false,
            state: 'UNKNOWN',
          },
        ],
        summaryState: 'PARTIAL',
      },
      credentialState: 'CONFIGURED',
      image: { modelId: 'image-model', protocolMode: null, state: 'UNKNOWN' },
      providerBaseUrl: 'https://provider.example/v1',
      providerConfigured: true,
      research: { modelId: 'shared-model', protocolMode: 'RESPONSES', state: 'SUPPORTED' },
      revision: 1,
      setupAvailable: true,
      writing: { modelId: 'shared-model', protocolMode: 'RESPONSES', state: 'SUPPORTED' },
    };
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    expose({
      ...createMemoryV2Bridge(),
      readProviderSettings: async () => ({ ok: true, value: settings }),
    });
    window.history.replaceState(null, '', '#/v2/settings');
    render(<V2App />);
    expect(await screen.findByText(/部分完成：仍有能力保持未知/)).toBeVisible();
    expect(screen.getByText(/research \+ writing/)).toBeVisible();
    expect(screen.getByText(/同一请求已去重并映射到 research、writing/)).toBeVisible();
    expect(screen.getByText(/Provider 拒绝了请求参数/)).toBeVisible();
    expect(screen.getByText(/code=invalid_parameter/)).toBeVisible();
    expect(screen.getByText(/param=size/)).toBeVisible();
    expect(screen.getByText(/requestId=req_fixture_123/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '复制脱敏诊断' }));
    expect(writeText).toHaveBeenCalledWith(diagnosticText);
    expect(diagnosticText).not.toMatch(
      /authorization|api.?key|https?:\/\/|stack|select\s|insert\s|[A-Za-z]:\\/iu,
    );

    cleanup();
    settings = {
      ...settings,
      capabilityProbe: {
        ...settings.capabilityProbe,
        steps: settings.capabilityProbe.steps.map((step) => ({ ...step, state: 'UNKNOWN' })),
        summaryState: 'NONE_CONFIRMED',
      },
      research: { modelId: 'shared-model', protocolMode: null, state: 'UNKNOWN' },
      writing: { modelId: 'shared-model', protocolMode: null, state: 'UNKNOWN' },
    };
    render(<V2App />);
    expect(await screen.findByText('未确认任何能力')).toBeVisible();
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
        configFingerprint: 'fixture-config',
        credentialBinding: 'fixture-credential',
        credentialState: 'CONFIGURED',
        expiresAt: '2026-08-09T12:02:00.000Z',
        feeEstimateMicroUsd: '4200',
        fetchEnabled: false,
        kind: 'REPLY_SUGGESTION',
        modelId: 'writing-model',
        modelSlot: 'writing',
        protocolMode: 'RESPONSES',
        previewToken: 'preview-token',
        providerConfigured: true,
        readinessBinding: 'fixture-ready',
        reasonCode: 'READY',
        reasonMessage: 'ready',
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
