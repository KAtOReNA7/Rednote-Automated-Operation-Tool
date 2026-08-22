import { describe, expect, it } from 'vitest';

import type { TextGenerationResult } from '../packages/providers/src/contracts.js';
import { emptyProviderUsage } from '../packages/providers/src/usage.js';
import { ProviderError } from '../packages/providers/src/errors.js';
import { textSha256 } from '../packages/providers/src/codecs/text-sha256.js';
import type {
  BrowserTextRequest,
  WebTextProviderPort,
} from '../apps/web-ui/src/v2/web/browser-provider.js';
import { BrowserWorkspaceRepository } from '../apps/web-ui/src/v2/web/repository.js';
import { WebWorkspaceRuntime } from '../apps/web-ui/src/v2/web/runtime.js';
import { MemoryFolder, MemoryLock } from './support/web-folder-fixture.js';

class ScriptedBrowserPort implements WebTextProviderPort {
  public readonly calls: BrowserTextRequest[] = [];
  public failure: Error | null = null;

  public async generate(request: BrowserTextRequest): Promise<TextGenerationResult> {
    this.calls.push(request);
    if (this.failure !== null) throw this.failure;
    const text =
      request.purpose === 'CAPABILITY_PROBE'
        ? '{"supported":true}'
        : request.purpose === 'CONTENT_COPY'
          ? JSON.stringify({
              body: '这是一段合成文案正文。',
              materialNotes: '合成素材说明。',
              tags: ['推理小说', '合成'],
              title: '合成模型标题',
            })
          : '感谢你的留言。这是一条合成回复建议，请在发送前确认。';
    return Object.freeze({
      finishReason: 'STOP',
      latencyMs: 5,
      modelId: request.modelId,
      outputTruncated: false,
      protocolMode: 'CHAT_COMPLETIONS',
      providerRequestId: 'synthetic-request',
      refusal: null,
      text,
      usage: { ...emptyProviderUsage(), inputTokens: 10, outputTokens: 20 },
      warnings: [],
    });
  }
}

async function createRuntime(
  folder = new MemoryFolder(),
  providerPort = new ScriptedBrowserPort(),
) {
  let token = 0;
  const runtime = await WebWorkspaceRuntime.connectPort(
    new BrowserWorkspaceRepository(folder, {
      createId: () => 'ws_w2syntheticworkspace000001',
      lock: new MemoryLock(),
      now: () => new Date('2026-08-23T08:00:00.000Z'),
    }),
    {
      channelFactory: () => null,
      createToken: () => `w2-token-${String(++token)}`,
      nowMs: () => Date.parse('2026-08-23T08:00:00.000Z'),
      providerPort,
    },
  );
  return { folder, providerPort, runtime };
}

async function lockAndGenerate(runtime: WebWorkspaceRuntime, count = 3): Promise<void> {
  await runtime.ensurePlan();
  await runtime.saveBrief('合成 W2 Brief');
  await runtime.confirmAllCandidates();
  await runtime.lockPlan();
  const ids = runtime
    .queue()
    .slice(0, count)
    .map((item) => item.candidate.id);
  await runtime.executeGeneration((await runtime.previewGeneration(ids)).token);
}

async function readyProvider(runtime: WebWorkspaceRuntime): Promise<void> {
  await runtime.saveProviderSettings(
    {
      baseUrl: 'https://provider.invalid/v1',
      budgetPerCallMicrounits: 10,
      estimatedCostPerCallMicrounits: 1,
      writingModelId: 'synthetic-model',
    },
    0,
  );
  runtime.setSessionApiKey('synthetic-session-key');
  const preview = await runtime.previewProviderAction('CAPABILITY_PROBE', 'provider-settings');
  await runtime.executeProviderAction(preview.token);
}

describe('Web W2 domain, Provider and persistence W2-04..W2-25/W2-29', () => {
  it('W2-07..W2-10 preserves the complete local interaction state machine without sending', async () => {
    const { folder, runtime } = await createRuntime();
    const created = await runtime.createInteraction({
      kind: 'COMMENT',
      relatedContentPackageId: null,
      userText: '  合成评论  ',
    });
    expect(
      await runtime.createInteraction({
        kind: 'COMMENT',
        relatedContentPackageId: null,
        userText: '合成评论',
      }),
    ).toEqual({ duplicate: true, itemId: created.itemId });
    await runtime.saveManualReply(created.itemId, 0, '人工建议 v1');
    let item = runtime.view.state.interactions[0];
    if (item === undefined) throw new Error('missing interaction');
    await runtime.confirmInteractions([
      {
        expectedRevision: item.revision,
        expectedVersionId: item.currentSuggestionVersionId ?? '',
        itemId: item.itemId,
      },
    ]);
    item = runtime.view.state.interactions[0];
    if (item === undefined) throw new Error('missing confirmed interaction');
    await runtime.transitionInteraction(item.itemId, item.revision, 'MARK_MANUAL_SENT');
    item = runtime.view.state.interactions[0];
    if (item === undefined) throw new Error('missing sent interaction');
    await runtime.transitionInteraction(item.itemId, item.revision, 'UNDO_MANUAL_SENT');
    const second = await runtime.createInteraction({
      kind: 'DIRECT_MESSAGE',
      relatedContentPackageId: null,
      userText: '合成私信',
    });
    await runtime.transitionInteraction(second.itemId, 0, 'SKIP');
    await runtime.transitionInteraction(second.itemId, 1, 'REOPEN');
    const deletion = runtime.previewDeleteInteraction(second.itemId);
    await runtime.confirmDeleteInteraction(deletion.token);
    const reopened = (await createRuntime(folder)).runtime;
    expect(reopened.view.state.interactions.map((value) => value.status)).toEqual([
      'CONFIRMED',
      'DELETED',
    ]);
    expect(JSON.stringify(reopened.view.state)).not.toMatch(/sentAutomatically|platformToken/iu);
  });

  it('W2-11..W2-14 previews strict catalog and clip files before idempotent persistence', async () => {
    const { folder, runtime } = await createRuntime();
    const catalog = JSON.stringify({
      format: 'rednote-web-catalog',
      items: [
        {
          author: '合成作者',
          id: 'catalog-item-1',
          sourcePath: 'materials/catalog-item-1.txt',
          summary: '合成简介',
          title: '合成作品',
        },
      ],
      version: 1,
    });
    const preview = await runtime.previewLibraryImport(catalog, 'CATALOG');
    expect(runtime.view.state.library).toHaveLength(0);
    expect(await runtime.confirmLibraryImport(preview.token)).toEqual({ imported: 1 });
    const duplicate = await runtime.previewLibraryImport(catalog, 'CATALOG');
    expect(duplicate.duplicateCount).toBe(1);
    expect(await runtime.confirmLibraryImport(duplicate.token)).toEqual({ imported: 0 });

    const clip = {
      capturedAt: '2026-08-23T08:00:00.000Z',
      clipIdentity: textSha256('https://public.invalid/article'),
      format: 'rednote-web-clip',
      pageTitle: '公开页面合成标题',
      screenshotDataUrl: null,
      selectedText: '用户主动选择的合成文本',
      sourceUrl: 'https://public.invalid/article',
      userNote: null,
      version: 1,
    } as const;
    await expect(
      runtime.previewLibraryImport(
        JSON.stringify({ ...clip, clipIdentity: 'a'.repeat(64) }),
        'CLIPPER',
      ),
    ).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    const clipPreview = await runtime.previewLibraryImport(JSON.stringify(clip), 'CLIPPER');
    expect(await runtime.confirmLibraryImport(clipPreview.token)).toEqual({ imported: 1 });
    const replay = await runtime.previewLibraryImport(
      JSON.stringify({ ...clip, capturedAt: '2026-08-23T09:00:00.000Z' }),
      'CLIPPER',
    );
    expect(await runtime.confirmLibraryImport(replay.token)).toEqual({ imported: 0 });
    const conflict = await runtime.previewLibraryImport(
      JSON.stringify({ ...clip, pageTitle: '冲突标题' }),
      'CLIPPER',
    );
    await expect(runtime.confirmLibraryImport(conflict.token)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await expect(
      runtime.previewLibraryImport('{"format":"future"}', 'CLIPPER'),
    ).rejects.toBeTruthy();
    expect((await createRuntime(folder)).runtime.view.state.library).toHaveLength(2);
  });

  it('W2-16/W2-17 stores versioned approved-only metrics and deterministic decisions', async () => {
    const { folder, runtime } = await createRuntime();
    await lockAndGenerate(runtime, 3);
    for (const queueItem of runtime.queue().slice(0, 3)) {
      if (queueItem.package === null) throw new Error('missing package');
      await runtime.approveContent(queueItem.package.id, queueItem.package.revision);
    }
    for (const [index, item] of runtime.queue().slice(0, 3).entries()) {
      if (item.package === null) throw new Error('missing approved package');
      await runtime.saveMetric({
        collections: 10 + index,
        comments: 5,
        likes: 20,
        newFollowers: 2,
        packageId: item.package.id,
        publishedAt: '2026-08-23T08:00:00.000Z',
        snapshotWindow: '7D',
        views: 200,
      });
    }
    const review = runtime.metrics('7D');
    expect(review).toMatchObject({ status: 'READY', totals: { views: 600 } });
    await runtime.decideStrategy(review, 'ACCEPTED');
    const reopened = (await createRuntime(folder)).runtime;
    expect(reopened.metrics('7D')).toEqual(review);
    expect(reopened.view.state.strategyDecisions[0]?.status).toBe('ACCEPTED');
  });

  it('W2-18..W2-23 runs content and reply only after bound preview and explicit save', async () => {
    const providerPort = new ScriptedBrowserPort();
    const { folder, runtime } = await createRuntime(new MemoryFolder(), providerPort);
    await lockAndGenerate(runtime, 1);
    const item = runtime.queue()[0];
    if (item?.package === null || item === undefined) throw new Error('missing package');
    await readyProvider(runtime);
    const contentPreview = await runtime.previewProviderAction('CONTENT_COPY', item.package.id);
    expect(contentPreview).toMatchObject({
      canConfirm: true,
      fetchEnabled: false,
      maxRequests: 1,
      searchEnabled: false,
    });
    const contentResult = await runtime.executeProviderAction(contentPreview.token);
    expect(runtime.queue()[0]?.package?.versions).toHaveLength(1);
    await runtime.saveModelContentResult(contentResult, item.package.revision);
    const interaction = await runtime.createInteraction({
      kind: 'COMMENT',
      relatedContentPackageId: item.package.id,
      userText: '模型回复合成输入',
    });
    const replyPreview = await runtime.previewProviderAction(
      'REPLY_SUGGESTION',
      interaction.itemId,
    );
    const replyResult = await runtime.executeProviderAction(replyPreview.token);
    await runtime.saveReplyResult(replyResult, 0);
    expect(providerPort.calls.map((call) => call.purpose)).toEqual([
      'CAPABILITY_PROBE',
      'CONTENT_COPY',
      'REPLY_SUGGESTION',
    ]);
    expect(providerPort.calls.every((call) => call.apiKey === 'synthetic-session-key')).toBe(true);
    const snapshotText = [...folder.files.values()]
      .map((bytes) => new TextDecoder().decode(bytes))
      .join('\n');
    expect(snapshotText).not.toContain('synthetic-session-key');
    expect(runtime.diagnostics()).not.toHaveProperty('baseUrl');
    const reopened = (await createRuntime(folder, providerPort)).runtime;
    expect(reopened.queue()[0]?.package?.versions.at(-1)).toMatchObject({
      modelId: 'synthetic-model',
      source: 'MODEL',
    });
    expect(reopened.view.state.interactions[0]?.replies[0]?.source).toBe('MODEL');
    expect(reopened.hasSessionApiKey()).toBe(false);
  });

  it('W2-19/W2-20 blocks incomplete settings and rejects stale preview with zero calls', async () => {
    const providerPort = new ScriptedBrowserPort();
    const { runtime } = await createRuntime(new MemoryFolder(), providerPort);
    const blocked = await runtime.previewProviderAction('CAPABILITY_PROBE', 'provider-settings');
    expect(blocked.canConfirm).toBe(false);
    await expect(runtime.executeProviderAction(blocked.token)).rejects.toMatchObject({
      code: 'SCHEMA_INVALID',
    });
    await runtime.saveProviderSettings(
      {
        baseUrl: 'https://provider.invalid/v1',
        budgetPerCallMicrounits: 10,
        estimatedCostPerCallMicrounits: 1,
        writingModelId: 'synthetic-model',
      },
      0,
    );
    runtime.setSessionApiKey('synthetic-session-key');
    const preview = await runtime.previewProviderAction('CAPABILITY_PROBE', 'provider-settings');
    await runtime.savePersona(
      { ...runtime.view.state.persona, name: '变化后的人设' },
      runtime.view.state.persona.revision,
    );
    await expect(runtime.executeProviderAction(preview.token)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect(providerPort.calls).toHaveLength(0);
  });

  it('W2-22 preserves the snapshot and records only a safe Provider problem on network failure', async () => {
    const providerPort = new ScriptedBrowserPort();
    const { runtime } = await createRuntime(new MemoryFolder(), providerPort);
    await lockAndGenerate(runtime, 1);
    await readyProvider(runtime);
    const item = runtime.queue()[0]?.package;
    if (item === null || item === undefined) throw new Error('missing package');
    const generation = runtime.view.generation;
    providerPort.failure = new ProviderError('PROVIDER_NETWORK_UNREACHABLE', {
      operation: 'STRUCTURED_GENERATION',
      outcomeCertainty: 'MAY_HAVE_EXECUTED',
      providerId: 'synthetic-provider',
      requestId: 'synthetic-request',
      retryDisposition: 'DO_NOT_RETRY',
    });
    const preview = await runtime.previewProviderAction('CONTENT_COPY', item.id);
    await expect(runtime.executeProviderAction(preview.token)).rejects.toMatchObject({
      code: 'PROVIDER_NETWORK_UNREACHABLE',
    });
    expect(runtime.view.generation).toBe(generation);
    expect(runtime.queue()[0]?.package?.versions).toHaveLength(1);
    expect(runtime.diagnostics().lastError).toMatchObject({
      code: 'PROVIDER_NETWORK_UNREACHABLE',
      layer: 'provider',
    });
    expect(JSON.stringify(runtime.diagnostics())).not.toMatch(
      /synthetic-request|synthetic-provider/u,
    );
  });

  it('W2-04/W2-06/W2-25/W2-29 keeps all slices in one serialized generation chain', async () => {
    const { folder, runtime } = await createRuntime();
    await lockAndGenerate(runtime, 1);
    const first = runtime.queue()[0]?.package;
    if (first === null || first === undefined) throw new Error('missing content package');
    await runtime.createInteraction({
      kind: 'COMMENT',
      relatedContentPackageId: first.id,
      userText: '连续闭环互动',
    });
    const catalog = JSON.stringify({
      format: 'rednote-web-catalog',
      items: [{ author: null, id: 'work-one', sourcePath: null, summary: '摘要', title: '作品' }],
      version: 1,
    });
    const preview = await runtime.previewLibraryImport(catalog, 'CATALOG');
    await runtime.confirmLibraryImport(preview.token);
    const reopened = (await createRuntime(folder)).runtime;
    expect(reopened.view.state).toMatchObject({
      interactions: [{ relatedContentPackageId: first.id }],
      library: [{ id: 'work-one' }],
      schemaVersion: 2,
    });
    expect(reopened.queue().filter((item) => item.state === 'HAS_VERSION')).toHaveLength(1);
  });
});
