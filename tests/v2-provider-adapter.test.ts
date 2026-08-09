import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  V2ProviderActionExecutionRequest,
  V2ProviderActionExecutionResult,
  V2ProviderActionPreview,
  WeeklyPlan,
} from '../packages/v2/src/index.js';

vi.mock('electron', () => ({
  app: { getAppPath: () => resolve('.') },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: async () => '' },
}));

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

class ScriptedProviderExecution {
  readonly calls: V2ProviderActionExecutionRequest[] = [];

  public async inspect(request: Omit<V2ProviderActionExecutionRequest, 'executionId'>) {
    return {
      blockReasons: [],
      budgetState: 'ALLOWED' as const,
      canConfirm: true,
      capabilityState: 'SUPPORTED' as const,
      credentialState: 'CONFIGURED' as const,
      feeEstimateMicroUsd: '1000',
      modelId: request.modelSlot === 'research' ? 'research-test' : 'writing-test',
      modelSlot: request.modelSlot,
      providerConfigured: true,
    };
  }

  public async execute(
    request: V2ProviderActionExecutionRequest,
  ): Promise<V2ProviderActionExecutionResult> {
    this.calls.push(request);
    const output =
      request.kind === 'WEEKLY_PLAN'
        ? {
            candidates: [
              ['monday', '周一', '2026-07-27', '10:00'],
              ['wednesday', '周三', '2026-07-29', '14:00'],
              ['friday', '周五', '2026-07-31', '19:30'],
            ].map(([id, day, date, time]) => ({
              book: `测试作品 ${id}`,
              conflictWithIds: [],
              date,
              day,
              id,
              status: 'PENDING',
              time,
              title: `受控计划 ${id}`,
            })),
          }
        : request.kind === 'CONTENT_PACKAGES'
          ? {
              packages: ['morgue', 'yellow-room', 'moonstone'].map((coverKey, index) => ({
                body: `受控正文 ${index + 1}`,
                coverKey,
                materialNotes: '仅使用已提供的本地上下文。',
                suggestedTime: `2026-07-${String(27 + index * 2).padStart(2, '0')}T10:00`,
                tags: ['推理小说', `本地草稿${index + 1}`],
                title: `受控内容包 ${index + 1}`,
              })),
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
    };
  }
}

describe('V2 R07 controlled provider adapter', () => {
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
      await runtime.mutate(
        {
          action: 'CONFIRM_PROVIDER_ACTION',
          confirmation: 'RUN_PROVIDER_ACTION',
          previewToken: retryPreview.previewToken,
        },
        caller,
      );
      const generated = (await runtime.read({
        view: 'WEEKLY_PLAN',
        weekKey: initial.weekKey,
      })) as WeeklyPlan;
      expect(generated.candidates).toHaveLength(3);
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toMatchObject({ kind: 'WEEKLY_PLAN', modelSlot: 'research' });

      const locked = (await runtime.mutate({
        action: 'LOCK_WEEKLY_PLAN',
        expectedRevision: generated.revision,
        weekKey: generated.weekKey,
      })) as WeeklyPlan;
      const candidateIds = locked.candidates.map(({ id }) => id);
      const contentPreview = (await runtime.read(
        {
          intent: {
            candidateIds,
            expectedPlanRevision: locked.revision,
            idempotencyKey: 'r07-content-scripted',
            kind: 'CONTENT_PACKAGES',
            weekKey: locked.weekKey,
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
      const content = await runtime.read({ view: 'CONTENT_PACKAGES', weekKey: locked.weekKey });
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
      expect(await runtime.read({ view: 'WEEKLY_PLAN', weekKey: locked.weekKey })).toMatchObject({
        revision: locked.revision,
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
        ['REPLY_SUGGESTION', 'writing'],
        ['WEEKLY_PLAN', 'research'],
      ]);
    } finally {
      runtime.close();
    }
  });
});
