import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseV2ProviderActionIntent,
  parseV2ProviderActionOutput,
  selectV2StructuredProtocol,
  toV2Exception,
  V2ProviderActionError,
  type V2ProviderActionExecutionRequest,
  type V2ProviderActionExecutionResult,
  type V2ProviderActionPreview,
  type WeeklyPlan,
} from '../packages/v2/src/index.js';
import { initializeProjectDataRoot } from '../packages/storage/src/index.js';

vi.mock('electron', () => ({
  app: { getAppPath: () => resolve('.') },
  BrowserWindow: {
    fromWebContents: (contents: { readonly testWindow?: unknown }) => contents.testWindow,
  },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: async () => '' },
}));

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

class ScriptedProviderExecution {
  readonly calls: V2ProviderActionExecutionRequest[] = [];
  approvalRequired = false;
  configFingerprint = 'fixture-config';
  credentialBinding = 'fixture-credential';
  contentCapabilityEvidenceId = 'fixture-chat-evidence';
  contentModelId = 'writing-test';
  protocolMode: 'CHAT_COMPLETIONS' | 'RESPONSES' = 'RESPONSES';

  public async inspect(request: Omit<V2ProviderActionExecutionRequest, 'executionId'>) {
    return {
      blockReasons:
        this.approvalRequired && request.userApprovedUnknownCost !== true
          ? ['approval required']
          : [],
      budgetState: 'ALLOWED' as const,
      canConfirm: !this.approvalRequired || request.userApprovedUnknownCost === true,
      capabilityState: 'SUPPORTED' as const,
      configFingerprint: this.configFingerprint,
      credentialBinding: this.credentialBinding,
      credentialState: 'CONFIGURED' as const,
      feeEstimateMicroUsd: '1000',
      modelId: request.modelSlot === 'research' ? 'research-test' : 'writing-test',
      modelSlot: request.modelSlot,
      protocolMode: this.protocolMode,
      providerConfigured: true,
      readinessBinding: `fixture-${this.protocolMode}-${this.configFingerprint}-${this.credentialBinding}`,
      reasonCode:
        this.approvalRequired && request.userApprovedUnknownCost !== true
          ? ('UNKNOWN_FEE_CONSENT_REQUIRED' as const)
          : ('READY' as const),
      reasonMessage: 'fixture',
    };
  }

  public async inspectContentCopy(request: {
    readonly requestCount: 1 | 2 | 3;
    readonly userApprovedUnknownCost: boolean;
  }) {
    return {
      blockReasons:
        this.approvalRequired && !request.userApprovedUnknownCost ? ['approval required'] : [],
      budgetState: 'ALLOWED' as const,
      canConfirm: !this.approvalRequired || request.userApprovedUnknownCost,
      capabilityEvidenceId: this.contentCapabilityEvidenceId,
      credentialBinding: this.credentialBinding,
      credentialState: 'CONFIGURED' as const,
      feeEstimateMicroUsd: this.approvalRequired ? null : '1000',
      modelId: this.contentModelId,
      protocolMode: 'CHAT_COMPLETIONS' as const,
      unknownCostApproved: request.userApprovedUnknownCost,
    };
  }

  public async execute(
    request: V2ProviderActionExecutionRequest,
  ): Promise<V2ProviderActionExecutionResult> {
    this.calls.push(request);
    const output =
      request.kind === 'WEEKLY_PLAN'
        ? {
            candidates: Array.from({ length: 21 }, (_, index) => ({
              book: `测试作品 ${index + 1}`,
              conflictWithIds: [],
              date: '2026-07-27',
              day: '周一',
              id: `candidate-${index + 1}`,
              status: 'PENDING',
              time: '10:00',
              title: `受控计划 ${index + 1}`,
            })),
          }
        : request.kind === 'CONTENT_PACKAGES' ||
            (request.kind === 'CONTENT_COPY_VERSION' && 'candidate' in request.input)
          ? {
              packages: [request.input.candidate].map((candidate) => {
                const id =
                  typeof candidate === 'object' && candidate !== null && 'id' in candidate
                    ? String(Number(String(candidate.id).match(/(\d+)$/u)?.[1] ?? '1'))
                    : '1';
                return {
                  body: `受控正文 ${id}`,
                  coverKey: 'morgue',
                  materialNotes: '仅使用已提供的本地上下文。',
                  suggestedTime: '2026-07-27T10:00',
                  tags: ['推理小说', `本地草稿${id}`],
                  title: `受控内容包 ${id}`,
                };
              }),
            }
          : { replyText: '谢谢你的留言。这是一条待你确认后手动发送的回复建议。' };
    return {
      costAmountMicroUsd: null,
      costState: 'UNPRICED_USAGE',
      externalRequestCount: 1,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      output,
      stableErrorCode: null,
      status: 'SUCCEEDED',
      modelRunId: null,
    };
  }
}

describe('V2 R07 controlled provider adapter', () => {
  it('opens business persistence on the locator-selected ProjectDataRoot', async () => {
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const parent = mkdtempSync(join(tmpdir(), 'rednote-v2-selected-root-'));
    temporaryRoots.push(parent);
    const selected = await initializeProjectDataRoot(join(parent, 'selected-project'));
    const runtime = await V2DesktopRuntime.openProject(selected, {
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
    });
    try {
      expect(await runtime.read({ view: 'WEEKLY_PLAN', weekKey: '2026-W31' })).toMatchObject({
        weekKey: '2026-W31',
      });
    } finally {
      runtime.close();
    }
    expect(existsSync(join(selected.databaseDirectory, 'rednote.sqlite'))).toBe(true);
    expect(existsSync(join(parent, 'v2-project-data'))).toBe(false);
  });

  it('does not mislabel an unexpected local failure as unavailable persistence', () => {
    expect(toV2Exception(new Error('fixture local failure'))).toMatchObject({
      code: 'LOCAL_OPERATION_FAILED',
      message: '本地操作未完成，请重新载入后再试。',
    });
  });

  it('accepts the bounded third R07 packaged restart URL and still rejects other attempts', async () => {
    const { isTrustedV2IpcSender } = await import('../apps/desktop/src/v2-runtime.js');
    const window = {};
    const sender = { testWindow: window };
    const event = {
      sender,
      senderFrame: {
        url: 'rednote://app/v2.html?smoke=1&r07BlackboxPort=43119&r07BlackboxAttempt=3',
      },
    };
    Object.assign(sender, { mainFrame: event.senderFrame });

    expect(isTrustedV2IpcSender(event as never, 'rednote://app/v2.html', window as never)).toBe(
      true,
    );
    event.senderFrame.url =
      'rednote://app/v2.html?smoke=1&r07BlackboxPort=43119&r07BlackboxAttempt=4';
    expect(isTrustedV2IpcSender(event as never, 'rednote://app/v2.html', window as never)).toBe(
      false,
    );
  });

  it('projects a legacy global setup state into the same action-scoped writing configuration', async () => {
    const { resolveV2ActionProviderConfiguration } =
      await import('../apps/desktop/src/v2-provider-runtime.js');
    const legacySettings = {
      credentialReference: 'CONTENT_AI_API_KEY',
      embeddingModelId: null,
      imageModelId: null,
      monthlyHardLimitCents: 10_000,
      monthlyWarningCents: 8_000,
      providerBaseUrl: 'http://127.0.0.1:43119/v1',
      providerProtocol: 'OPENAI_COMPATIBLE',
      researchModelId: 'research-model',
      reviewModelId: null,
      revision: 4,
      setupState: 'PROVIDER_CONFIG_INCOMPLETE',
      updatedAt: '2026-08-16T00:00:00.000Z',
      writingModelId: 'writing-model',
    } as const;

    const writing = resolveV2ActionProviderConfiguration(legacySettings, 'writing');
    const research = resolveV2ActionProviderConfiguration(legacySettings, 'research');

    expect(writing).toMatchObject({ modelId: 'writing-model', providerConfigured: true });
    expect(research).toMatchObject({ modelId: 'research-model', providerConfigured: true });
    expect(writing.settingsForProviderLoader.setupState).toBe('PROVIDER_CONFIGURED_UNVERIFIED');
    expect(legacySettings.setupState).toBe('PROVIDER_CONFIG_INCOMPLETE');
    expect(legacySettings.reviewModelId).toBeNull();
  });

  it('returns the precise changed field instead of the generic provider blocker', () => {
    expect(
      toV2Exception(
        new V2ProviderActionError('PROVIDER_ACTION_CONFIG_CHANGED', ['writingModelId']),
      ),
    ).toMatchObject({ message: '预览后写作模型已变化，请重新预览。' });
    expect(
      toV2Exception(new V2ProviderActionError('PROVIDER_ACTION_STALE', ['weeklyPlan'])),
    ).toMatchObject({ message: '预览后周计划版本已变化，请重新预览。' });
  });

  it('selects a current supported structured protocol deterministically', () => {
    expect(
      selectV2StructuredProtocol([
        { protocolMode: 'CHAT_COMPLETIONS', stale: false, state: 'SUPPORTED' },
        { protocolMode: 'RESPONSES', stale: false, state: 'SUPPORTED' },
      ]),
    ).toEqual({ protocolMode: 'CHAT_COMPLETIONS', state: 'SUPPORTED' });
    expect(
      selectV2StructuredProtocol([
        {
          observedAt: '2026-08-15T00:00:01.000Z',
          protocolMode: 'CHAT_COMPLETIONS',
          stale: false,
          state: 'SUPPORTED',
        },
        {
          observedAt: '2026-08-15T00:00:02.000Z',
          protocolMode: 'RESPONSES',
          stale: false,
          state: 'SUPPORTED',
        },
      ]),
    ).toEqual({ protocolMode: 'RESPONSES', state: 'SUPPORTED' });
    expect(
      selectV2StructuredProtocol([
        { protocolMode: 'RESPONSES', stale: false, state: 'UNSUPPORTED' },
        { protocolMode: 'CHAT_COMPLETIONS', stale: false, state: 'SUPPORTED' },
      ]),
    ).toEqual({ protocolMode: 'CHAT_COMPLETIONS', state: 'SUPPORTED' });
    expect(
      selectV2StructuredProtocol([
        { protocolMode: 'RESPONSES', stale: false, state: 'UNSUPPORTED' },
        { protocolMode: 'CHAT_COMPLETIONS', stale: false, state: 'UNKNOWN' },
      ]),
    ).toEqual({ protocolMode: null, state: 'UNKNOWN' });
    expect(
      selectV2StructuredProtocol([{ protocolMode: 'RESPONSES', stale: true, state: 'SUPPORTED' }]),
    ).toEqual({ protocolMode: null, state: 'STALE' });
  });

  it('accepts exactly one or three append-only copy targets and matching outputs', () => {
    const item = (suffix: number) => ({
      expectedRevision: suffix,
      expectedVersionId: `version-${suffix}`,
      packageId: `package-${suffix}`,
    });
    for (const items of [[item(1)], [item(1), item(2), item(3)]]) {
      expect(
        parseV2ProviderActionIntent({
          items,
          kind: 'CONTENT_COPY_VERSION',
          userApprovedUnknownCost: false,
          weekKey: '2026-W31',
        }),
      ).toMatchObject({ items });
      expect(
        parseV2ProviderActionOutput('CONTENT_COPY_VERSION', {
          packages: items.map((_, index) => ({
            body: `正文 ${index + 1}`,
            coverKey: 'morgue',
            materialNotes: '本地资料说明',
            suggestedTime: '2026-07-27T10:00',
            tags: ['推理小说'],
            title: `标题 ${index + 1}`,
          })),
        }),
      ).toHaveProperty(
        'packages',
        expect.arrayContaining([expect.objectContaining({ coverKey: 'morgue' })]),
      );
    }
    expect(() =>
      parseV2ProviderActionIntent({
        items: [item(1), item(2)],
        kind: 'CONTENT_COPY_VERSION',
        userApprovedUnknownCost: false,
        weekKey: '2026-W31',
      }),
    ).toThrow();
  });

  it('shows a three-item content preview as three bounded writing requests', async () => {
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const root = mkdtempSync(join(tmpdir(), 'rednote-v2-r07-content-preview-'));
    temporaryRoots.push(root);
    const provider = new ScriptedProviderExecution();
    const runtime = await V2DesktopRuntime.open(root, {
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      providerExecution: provider,
    });
    try {
      const initial = (await runtime.read({
        view: 'WEEKLY_PLAN',
        weekKey: '2026-W31',
      })) as WeeklyPlan;
      const confirmed = (await runtime.mutate({
        action: 'CONFIRM_PLAN_CANDIDATES',
        candidateIds: initial.candidates.map(({ id }) => id),
        expectedRevision: initial.revision,
        weekKey: initial.weekKey,
      })) as WeeklyPlan;
      const locked = (await runtime.mutate({
        action: 'LOCK_WEEKLY_PLAN',
        expectedRevision: confirmed.revision,
        weekKey: confirmed.weekKey,
      })) as WeeklyPlan;
      const preview = (await runtime.read(
        {
          intent: {
            candidateIds: locked.candidates.slice(0, 3).map(({ id }) => id),
            expectedPlanRevision: locked.revision,
            idempotencyKey: 'content-three-items',
            kind: 'CONTENT_PACKAGES',
            weekKey: locked.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        { senderId: 1, windowId: 1 },
      )) as V2ProviderActionPreview;

      expect(preview).toMatchObject({
        canConfirm: true,
        requestCount: 3,
        searchEnabled: false,
        fetchEnabled: false,
      });
      await runtime.mutate(
        {
          action: 'CONFIRM_PROVIDER_ACTION',
          confirmation: 'RUN_PROVIDER_ACTION',
          previewToken: preview.previewToken,
        },
        { senderId: 1, windowId: 1 },
      );
      expect(provider.calls).toHaveLength(3);
      expect(provider.calls.every(({ kind }) => kind === 'CONTENT_PACKAGES')).toBe(true);
    } finally {
      runtime.close();
    }
  });

  it('uses the dedicated content-copy evaluator and appends versions for confirmed plan items', async () => {
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const root = mkdtempSync(join(tmpdir(), 'rednote-v2-r07-dedicated-copy-'));
    temporaryRoots.push(root);
    const provider = new ScriptedProviderExecution();
    provider.approvalRequired = true;
    const runtime = await V2DesktopRuntime.open(root, {
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      providerExecution: provider,
    });
    const caller = { senderId: 21, windowId: 34 };
    try {
      const initial = (await runtime.read({
        view: 'WEEKLY_PLAN',
        weekKey: '2026-W31',
      })) as WeeklyPlan;
      const confirmed = (await runtime.mutate({
        action: 'CONFIRM_PLAN_CANDIDATES',
        candidateIds: initial.candidates.map(({ id }) => id),
        expectedRevision: initial.revision,
        weekKey: initial.weekKey,
      })) as WeeklyPlan;
      const locked = (await runtime.mutate({
        action: 'LOCK_WEEKLY_PLAN',
        expectedRevision: confirmed.revision,
        weekKey: confirmed.weekKey,
      })) as WeeklyPlan;
      const selectedPlanItemIds = locked.candidates.slice(0, 3).map(({ id }) => id);
      const blocked = await runtime.read(
        {
          selectedPlanItemIds,
          userApprovedUnknownCost: false,
          view: 'CONTENT_COPY_GENERATION_PREVIEW',
          weekKey: locked.weekKey,
        },
        caller,
      );
      expect(blocked).toMatchObject({
        canConfirm: false,
        previewToken: null,
        protocolMode: 'CHAT_COMPLETIONS',
        requestCount: 3,
      });
      const preview = await runtime.read(
        {
          selectedPlanItemIds: [...selectedPlanItemIds].reverse(),
          userApprovedUnknownCost: true,
          view: 'CONTENT_COPY_GENERATION_PREVIEW',
          weekKey: locked.weekKey,
        },
        caller,
      );
      expect(preview).toMatchObject({
        canConfirm: true,
        fetchEnabled: false,
        protocolMode: 'CHAT_COMPLETIONS',
        requestCount: 3,
        searchEnabled: false,
        selectedPlanItemIds: [...selectedPlanItemIds].sort(),
      });
      const generated = await runtime.mutate(
        {
          action: 'EXECUTE_CONTENT_COPY_GENERATION',
          previewToken: (preview as { previewToken: string }).previewToken,
        },
        caller,
      );
      expect(generated).toMatchObject({
        externalRequestCount: 3,
        items: selectedPlanItemIds.map((planItemId) => ({
          planItemId,
          status: 'SUCCEEDED',
        })),
      });
      const firstWorkspace = (await runtime.read({
        view: 'CONTENT_PACKAGES',
        weekKey: locked.weekKey,
      })) as {
        packages: readonly {
          candidateId: string;
          provenance?: { copyModelRunId: string | null };
          version: number;
        }[];
      };
      expect(firstWorkspace.packages).toHaveLength(3);
      expect(firstWorkspace.packages.every(({ version }) => version === 1)).toBe(true);

      const appendPreview = await runtime.read(
        {
          selectedPlanItemIds: [selectedPlanItemIds[0]],
          userApprovedUnknownCost: true,
          view: 'CONTENT_COPY_GENERATION_PREVIEW',
          weekKey: locked.weekKey,
        },
        caller,
      );
      await runtime.mutate(
        {
          action: 'EXECUTE_CONTENT_COPY_GENERATION',
          previewToken: (appendPreview as { previewToken: string }).previewToken,
        },
        caller,
      );
      const appended = (await runtime.read({
        view: 'CONTENT_PACKAGES',
        weekKey: locked.weekKey,
      })) as { packages: readonly { candidateId: string; version: number }[] };
      expect(
        appended.packages.find(({ candidateId }) => candidateId === selectedPlanItemIds[0]),
      ).toMatchObject({ version: 2 });
      expect(
        provider.calls.every(
          ({ requiredProtocolMode }) => requiredProtocolMode === 'CHAT_COMPLETIONS',
        ),
      ).toBe(true);
      expect(provider.calls.every(({ kind }) => kind === 'CONTENT_COPY_VERSION')).toBe(true);
    } finally {
      runtime.close();
    }
  });

  it('previews offline, consumes one bound token, and persists all three scripted actions', async () => {
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const root = mkdtempSync(join(tmpdir(), 'rednote-v2-r07-'));
    temporaryRoots.push(root);
    const provider = new ScriptedProviderExecution();
    const runtime = await V2DesktopRuntime.open(root, {
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      providerExecution: provider,
    });
    const caller = { senderId: 7, windowId: 11 };
    try {
      const initial = (await runtime.read({
        view: 'WEEKLY_PLAN',
        weekKey: '2026-W31',
      })) as WeeklyPlan;
      const planPreview = (await runtime.read(
        {
          intent: {
            expectedRevision: initial.revision,
            kind: 'WEEKLY_PLAN',
            weekKey: initial.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      expect(provider.calls).toHaveLength(0);
      expect(planPreview).toMatchObject({
        fetchEnabled: false,
        modelSlot: 'research',
        protocolMode: 'RESPONSES',
        requestCount: 1,
        searchEnabled: false,
      });
      await expect(
        runtime.mutate(
          {
            action: 'CONFIRM_PROVIDER_ACTION',
            confirmation: 'RUN_PROVIDER_ACTION',
            previewToken: planPreview.previewToken,
          },
          { senderId: 8, windowId: 11 },
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_ACTION_TOKEN_INVALID' });
      expect(provider.calls).toHaveLength(0);

      const retryPreview = (await runtime.read(
        {
          intent: {
            expectedRevision: initial.revision,
            kind: 'WEEKLY_PLAN',
            weekKey: initial.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      provider.protocolMode = 'CHAT_COMPLETIONS';
      await expect(
        runtime.mutate(
          {
            action: 'CONFIRM_PROVIDER_ACTION',
            confirmation: 'RUN_PROVIDER_ACTION',
            previewToken: retryPreview.previewToken,
          },
          caller,
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_ACTION_STALE' });
      expect(provider.calls).toHaveLength(0);
      const executionPreview = (await runtime.read(
        {
          intent: {
            expectedRevision: initial.revision,
            kind: 'WEEKLY_PLAN',
            weekKey: initial.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      expect(executionPreview.protocolMode).toBe('CHAT_COMPLETIONS');
      await runtime.mutate(
        {
          action: 'CONFIRM_PROVIDER_ACTION',
          confirmation: 'RUN_PROVIDER_ACTION',
          previewToken: executionPreview.previewToken,
        },
        caller,
      );
      const generated = (await runtime.read({
        view: 'WEEKLY_PLAN',
        weekKey: initial.weekKey,
      })) as WeeklyPlan;
      expect(generated.candidates).toHaveLength(21);
      expect(generated.candidates.filter(({ status }) => status === 'PENDING')).toHaveLength(21);
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toMatchObject({ kind: 'WEEKLY_PLAN', modelSlot: 'research' });

      const confirmed = (await runtime.mutate({
        action: 'CONFIRM_PLAN_CANDIDATES',
        candidateIds: generated.candidates.map(({ id }) => id),
        expectedRevision: generated.revision,
        weekKey: generated.weekKey,
      })) as WeeklyPlan;

      const locked = (await runtime.mutate({
        action: 'LOCK_WEEKLY_PLAN',
        expectedRevision: confirmed.revision,
        weekKey: confirmed.weekKey,
      })) as WeeklyPlan;
      const unlocked = (await runtime.mutate({
        action: 'UNLOCK_WEEKLY_PLAN',
        expectedRevision: locked.revision,
        weekKey: locked.weekKey,
      })) as WeeklyPlan;
      expect(unlocked).toMatchObject({ status: 'DRAFT' });
      const relocked = (await runtime.mutate({
        action: 'LOCK_WEEKLY_PLAN',
        expectedRevision: unlocked.revision,
        weekKey: unlocked.weekKey,
      })) as WeeklyPlan;
      const candidateIds = relocked.candidates.slice(0, 3).map(({ id }) => id);
      const contentPreview = (await runtime.read(
        {
          intent: {
            candidateIds,
            expectedPlanRevision: relocked.revision,
            idempotencyKey: 'r07-content-scripted',
            kind: 'CONTENT_PACKAGES',
            weekKey: relocked.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      await runtime.mutate(
        {
          action: 'CONFIRM_PROVIDER_ACTION',
          confirmation: 'RUN_PROVIDER_ACTION',
          previewToken: contentPreview.previewToken,
        },
        caller,
      );
      const content = await runtime.read({ view: 'CONTENT_PACKAGES', weekKey: relocked.weekKey });
      expect(
        (content as { packages: readonly { fields: { title: string } }[] }).packages.map(
          ({ fields }) => fields.title,
        ),
      ).toEqual(expect.arrayContaining(['受控内容包 1', '受控内容包 2', '受控内容包 3']));

      const created = await runtime.mutate({
        action: 'CREATE_INTERACTION',
        expectedRevision: 0,
        kind: 'COMMENT',
        relatedContentPackageId: null,
        userText: '这篇内容的线索分析很有意思。',
      });
      const item = (created as { item: { itemId: string; revision: number } }).item;
      const replyPreview = (await runtime.read(
        {
          intent: {
            expectedRevision: item.revision,
            idempotencyKey: 'r07-reply-scripted',
            itemId: item.itemId,
            kind: 'REPLY_SUGGESTION',
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      await runtime.mutate(
        {
          action: 'CONFIRM_PROVIDER_ACTION',
          confirmation: 'RUN_PROVIDER_ACTION',
          previewToken: replyPreview.previewToken,
        },
        caller,
      );
      const interactions = await runtime.read({ view: 'INTERACTIONS' });
      expect(interactions).toMatchObject({
        items: [{ currentSuggestion: expect.stringContaining('手动发送'), status: 'SUGGESTED' }],
      });
      const nextWeek = (await runtime.read({
        view: 'WEEKLY_PLAN',
        weekKey: '2026-W32',
      })) as WeeklyPlan;
      const nextPreview = (await runtime.read(
        {
          intent: {
            expectedRevision: nextWeek.revision,
            kind: 'WEEKLY_PLAN',
            weekKey: nextWeek.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      await runtime.mutate(
        {
          action: 'CONFIRM_PROVIDER_ACTION',
          confirmation: 'RUN_PROVIDER_ACTION',
          previewToken: nextPreview.previewToken,
        },
        caller,
      );
      expect(await runtime.read({ view: 'WEEKLY_PLAN', weekKey: relocked.weekKey })).toMatchObject({
        revision: relocked.revision,
        status: 'CONFIRMED',
      });
      expect(await runtime.read({ view: 'WEEKLY_PLAN', weekKey: nextWeek.weekKey })).toMatchObject({
        revision: nextWeek.revision + 1,
        status: 'DRAFT',
        weekKey: '2026-W32',
      });
      expect(provider.calls.map(({ kind, modelSlot }) => [kind, modelSlot])).toEqual([
        ['WEEKLY_PLAN', 'research'],
        ['CONTENT_PACKAGES', 'writing'],
        ['CONTENT_PACKAGES', 'writing'],
        ['CONTENT_PACKAGES', 'writing'],
        ['REPLY_SUGGESTION', 'writing'],
        ['WEEKLY_PLAN', 'research'],
      ]);
    } finally {
      runtime.close();
    }
  });

  it('keeps unknown-cost confirmation and its bound readiness snapshot in parity', async () => {
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const root = mkdtempSync(join(tmpdir(), 'rednote-v2-r07-parity-'));
    temporaryRoots.push(root);
    const provider = new ScriptedProviderExecution();
    provider.approvalRequired = true;
    const runtime = await V2DesktopRuntime.open(root, {
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      providerExecution: provider,
    });
    const caller = { senderId: 7, windowId: 11 };
    try {
      const plan = (await runtime.read({ view: 'WEEKLY_PLAN', weekKey: '2026-W34' })) as WeeklyPlan;
      const blocked = (await runtime.read(
        {
          intent: { expectedRevision: plan.revision, kind: 'WEEKLY_PLAN', weekKey: plan.weekKey },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      expect(blocked).toMatchObject({
        canConfirm: false,
        previewToken: null,
        reasonCode: 'UNKNOWN_FEE_CONSENT_REQUIRED',
      });
      expect(provider.calls).toHaveLength(0);

      const approved = (await runtime.read(
        {
          intent: {
            expectedRevision: plan.revision,
            kind: 'WEEKLY_PLAN',
            userApprovedUnknownCost: true,
            weekKey: plan.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      await runtime.mutate(
        {
          action: 'CONFIRM_PROVIDER_ACTION',
          confirmation: 'RUN_PROVIDER_ACTION',
          previewToken: approved.previewToken,
        },
        caller,
      );
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toMatchObject({
        kind: 'WEEKLY_PLAN',
        userApprovedUnknownCost: true,
      });
      await expect(
        runtime.mutate(
          {
            action: 'CONFIRM_PROVIDER_ACTION',
            confirmation: 'RUN_PROVIDER_ACTION',
            previewToken: approved.previewToken,
          },
          caller,
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_ACTION_REPLAYED' });
      expect(provider.calls).toHaveLength(1);
      expect(
        (await runtime.read({ view: 'WEEKLY_PLAN', weekKey: '2026-W33' })) as WeeklyPlan,
      ).toMatchObject({
        revision: 0,
        weekKey: '2026-W33',
      });

      const refreshed = (await runtime.read({
        view: 'WEEKLY_PLAN',
        weekKey: '2026-W34',
      })) as WeeklyPlan;
      const stale = (await runtime.read(
        {
          intent: {
            expectedRevision: refreshed.revision,
            kind: 'WEEKLY_PLAN',
            userApprovedUnknownCost: true,
            weekKey: refreshed.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      provider.configFingerprint = 'changed-config';
      await expect(
        runtime.mutate(
          {
            action: 'CONFIRM_PROVIDER_ACTION',
            confirmation: 'RUN_PROVIDER_ACTION',
            previewToken: stale.previewToken,
          },
          caller,
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_ACTION_CONFIG_CHANGED' });
      expect(provider.calls).toHaveLength(1);

      provider.configFingerprint = 'fixture-config';
      const credentialChanged = (await runtime.read(
        {
          intent: {
            expectedRevision: refreshed.revision,
            kind: 'WEEKLY_PLAN',
            userApprovedUnknownCost: true,
            weekKey: refreshed.weekKey,
          },
          view: 'PROVIDER_ACTION_PREVIEW',
        },
        caller,
      )) as V2ProviderActionPreview;
      provider.credentialBinding = 'changed-credential';
      await expect(
        runtime.mutate(
          {
            action: 'CONFIRM_PROVIDER_ACTION',
            confirmation: 'RUN_PROVIDER_ACTION',
            previewToken: credentialChanged.previewToken,
          },
          caller,
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_ACTION_CREDENTIAL_CHANGED' });
      expect(provider.calls).toHaveLength(1);
    } finally {
      runtime.close();
    }
  });
});
