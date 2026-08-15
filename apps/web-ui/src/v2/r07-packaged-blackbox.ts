const WEEK_KEY = '2026-W31';

async function requireResult<T>(
  result: V2ResultContract<T> | undefined,
  label: string,
): Promise<T> {
  if (result === undefined) throw new Error(`${label}: bridge unavailable`);
  if (!result.ok)
    throw new Error(
      `${label}: ${result.error.code}:${result.error.affectedFields.join(',') || 'NO_DETAIL'}`,
    );
  return result.value;
}

async function establishProviderFixture(
  bridge: NonNullable<Window['rednoteV2']>,
  port: number,
  observe: (phase: string) => void,
) {
  observe('settings-read');
  const current = await requireResult(await bridge.readProviderSettings?.(), 'settings read');
  observe('settings-update');
  await requireResult(
    await bridge.updateProviderSettings?.({
      expectedRevision: current.revision,
      imageModelId: 'r07-loopback-image',
      providerBaseUrl: `http://127.0.0.1:${port}/v1`,
      researchModelId: 'r07-loopback-text',
      writingModelId: 'r07-loopback-text',
    }),
    'settings update',
  );
  observe('credential-set');
  await requireResult(
    await bridge.setProviderCredential?.({ plaintext: 'unusable-runtime-r07-blackbox-only' }),
    'credential setup',
  );
  observe('capability-preview');
  const preview = await requireResult(
    await bridge.previewProviderCapabilityProbe?.(),
    'capability preview',
  );
  if (preview.requestCount > 0) {
    observe('capability-start');
    const started = await requireResult(
      await bridge.startProviderCapabilityProbe?.({
        confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
        credentialBindingVersion: preview.credentialBindingVersion,
        planHash: preview.planHash,
        settingsRevision: preview.settingsRevision,
        startToken: preview.startToken,
        userApprovedUnknownCost: true,
      }),
      'capability start',
    );
    let progress = started;
    observe('capability-progress');
    for (let attempt = 0; progress.status === 'RUNNING' && attempt < 100; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      progress = await requireResult(
        await bridge.readProviderCapabilityProbeProgress?.({ runId: started.runId }),
        'capability progress',
      );
    }
    if (progress.status === 'RUNNING') throw new Error('capability timeout');
  }
  observe('settings-reread');
  const configured = await requireResult(await bridge.readProviderSettings?.(), 'settings reread');
  if (
    configured.writing.state !== 'SUPPORTED' ||
    configured.writing.protocolMode !== 'CHAT_COMPLETIONS'
  )
    throw new Error('writing capability not ready');
  return configured;
}

async function createContent(
  bridge: NonNullable<Window['rednoteV2']>,
  observe: (phase: string) => void,
  generateContent = true,
) {
  observe('plan-read');
  let plan = await requireResult(await bridge.readWeeklyPlan({ weekKey: WEEK_KEY }), 'plan read');
  let content = await requireResult(
    await bridge.readContentPackages({ weekKey: WEEK_KEY }),
    'content read',
  );
  let preview: V2ProviderActionPreviewContract | null = null;
  if (content.packages.length === 0) {
    if (plan.status !== 'CONFIRMED') {
      plan = await requireResult(
        await bridge.confirmPlanCandidates({
          candidateIds: plan.candidates.map(({ id }) => id),
          expectedRevision: plan.revision,
          weekKey: WEEK_KEY,
        }),
        'plan confirm',
      );
      plan = await requireResult(
        await bridge.lockWeeklyPlan({ expectedRevision: plan.revision, weekKey: WEEK_KEY }),
        'plan lock',
      );
    }
    if (!generateContent) return { content, plan, preview };
    const candidateIds = plan.candidates.slice(0, 3).map(({ id }) => id);
    observe('content-preview');
    preview = await requireResult(
      await bridge.previewProviderAction?.({
        candidateIds,
        expectedPlanRevision: plan.revision,
        idempotencyKey: 'r07-packaged-content',
        kind: 'CONTENT_PACKAGES',
        userApprovedUnknownCost: true,
        weekKey: WEEK_KEY,
      }),
      'content preview',
    );
    if (
      !preview.canConfirm ||
      preview.previewToken === null ||
      preview.requestCount !== 3 ||
      preview.protocolMode !== 'CHAT_COMPLETIONS'
    )
      throw new Error('content preview not confirmable');
    observe('content-confirm');
    await requireResult(
      await bridge.confirmProviderAction?.({
        confirmation: 'RUN_PROVIDER_ACTION',
        previewToken: preview.previewToken,
      }),
      'content confirm',
    );
    content = await requireResult(
      await bridge.readContentPackages({ weekKey: WEEK_KEY }),
      'content reread',
    );
  }
  if (content.packages.length !== 3 || content.packages.some(({ status }) => status !== 'DRAFT'))
    throw new Error('content persistence mismatch');
  return { content, plan, preview };
}

async function createInteraction(
  bridge: NonNullable<Window['rednoteV2']>,
  kind: 'COMMENT' | 'DIRECT_MESSAGE',
  observe: (phase: string) => void,
) {
  observe(`${kind.toLowerCase()}-create`);
  const created = await requireResult(
    await bridge.createInteraction({
      expectedRevision: 0,
      kind,
      relatedContentPackageId: null,
      userText: kind === 'COMMENT' ? '本地黑盒评论输入。' : '本地黑盒私信输入。',
    }),
    `${kind} create`,
  );
  if (!created.persisted) throw new Error(`${kind} not persisted`);
  let item = created.item;
  if (item.status === 'NEW') {
    observe(`${kind.toLowerCase()}-preview`);
    const preview = await requireResult(
      await bridge.previewProviderAction?.({
        expectedRevision: item.revision,
        idempotencyKey: `r07-packaged-reply-${kind.toLowerCase()}`,
        itemId: item.itemId,
        kind: 'REPLY_SUGGESTION',
        userApprovedUnknownCost: true,
      }),
      `${kind} reply preview`,
    );
    if (!preview.canConfirm || preview.previewToken === null || preview.requestCount !== 1)
      throw new Error(`${kind} reply not confirmable`);
    observe(`${kind.toLowerCase()}-confirm`);
    await requireResult(
      await bridge.confirmProviderAction?.({
        confirmation: 'RUN_PROVIDER_ACTION',
        previewToken: preview.previewToken,
      }),
      `${kind} reply confirm`,
    );
    const workspace = await requireResult(await bridge.readInteractions(), `${kind} reply reread`);
    item = workspace.items.find(({ itemId }) => itemId === item.itemId) ?? item;
    if (item.currentSuggestion === null || item.currentSuggestionVersionId === null)
      throw new Error(`${kind} reply missing`);
    item = await requireResult(
      await bridge.saveReplySuggestion({
        expectedRevision: item.revision,
        expectedVersionId: item.currentSuggestionVersionId,
        itemId: item.itemId,
        replyText: `${item.currentSuggestion}（黑盒本地修订）`,
      }),
      `${kind} reply save`,
    );
    const confirmed = await requireResult(
      await bridge.confirmReplySuggestions({
        items: [
          {
            expectedRevision: item.revision,
            expectedVersionId: item.currentSuggestionVersionId ?? '',
            itemId: item.itemId,
          },
        ],
      }),
      `${kind} reply approve`,
    );
    item = confirmed.items.find(({ itemId }) => itemId === item.itemId) ?? item;
    item = await requireResult(
      await bridge.markInteractionManualSent({
        confirmed: true,
        expectedRevision: item.revision,
        expectedVersionId: item.currentSuggestionVersionId ?? '',
        itemId: item.itemId,
      }),
      `${kind} manual sent`,
    );
  }
  if (item.relatedContentPackageId !== null || item.status !== 'MANUAL_SENT')
    throw new Error(`${kind} recovery mismatch`);
  return item;
}

export async function runR07PackagedBlackbox(
  port: number,
  attempt: 1 | 2 | 3,
  observe: (phase: string) => void,
) {
  const bridge = window.rednoteV2;
  if (bridge === undefined) throw new Error('V2 bridge unavailable');
  const settings =
    attempt === 1
      ? await establishProviderFixture(bridge, port, observe)
      : attempt === 2
        ? await requireResult(await bridge.readProviderSettings?.(), 'settings recovery')
        : null;
  if (attempt === 1) {
    if (settings === null) throw new Error('settings seed unavailable');
    const { content, plan } = await createContent(bridge, observe, false);
    return {
      attempt,
      buildCommit: __REDNOTE_BUILD_INFO__.commit,
      commentPersisted: false,
      contentCount: content.packages.length,
      directMessagePersisted: false,
      imageRequestCount: 0,
      planRevision: plan.revision,
      previewCanConfirm: false,
      previewRequestCount: 0,
      providerProtocol: settings.writing.protocolMode,
    };
  }
  if (attempt === 3) {
    observe('content-recovery');
    const content = await requireResult(
      await bridge.readContentPackages({ weekKey: WEEK_KEY }),
      'content recovery',
    );
    const interactions = await requireResult(
      await bridge.readInteractions(),
      'interaction recovery',
    );
    if (content.packages.length !== 3 || content.packages.some(({ status }) => status !== 'DRAFT'))
      throw new Error('content restart persistence mismatch');
    return {
      attempt,
      buildCommit: __REDNOTE_BUILD_INFO__.commit,
      commentPersisted: interactions.items.some(
        ({ kind, status }) => kind === 'COMMENT' && status === 'MANUAL_SENT',
      ),
      contentCount: content.packages.length,
      directMessagePersisted: interactions.items.some(
        ({ kind, status }) => kind === 'DIRECT_MESSAGE' && status === 'MANUAL_SENT',
      ),
      imageRequestCount: 0,
      planRevision: 0,
      previewCanConfirm: true,
      previewRequestCount: 3,
      providerProtocol: 'CHAT_COMPLETIONS',
    };
  }
  const { content, plan, preview } = await createContent(bridge, observe);
  const comment = attempt === 2 ? await createInteraction(bridge, 'COMMENT', observe) : null;
  const directMessage =
    attempt === 2 ? await createInteraction(bridge, 'DIRECT_MESSAGE', observe) : null;
  const interactions = await requireResult(await bridge.readInteractions(), 'interaction recovery');
  return {
    attempt,
    buildCommit: __REDNOTE_BUILD_INFO__.commit,
    commentPersisted:
      comment === null
        ? interactions.items.some(
            ({ kind, status }) => kind === 'COMMENT' && status === 'MANUAL_SENT',
          )
        : interactions.items.some(
            ({ itemId, status }) => itemId === comment.itemId && status === 'MANUAL_SENT',
          ),
    contentCount: content.packages.length,
    directMessagePersisted:
      directMessage === null
        ? interactions.items.some(
            ({ kind, status }) => kind === 'DIRECT_MESSAGE' && status === 'MANUAL_SENT',
          )
        : interactions.items.some(
            ({ itemId, status }) => itemId === directMessage.itemId && status === 'MANUAL_SENT',
          ),
    imageRequestCount: 0,
    planRevision: plan.revision,
    previewCanConfirm: preview?.canConfirm === true,
    previewRequestCount: preview?.requestCount ?? 3,
    providerProtocol: settings?.writing.protocolMode ?? 'CHAT_COMPLETIONS',
  };
}
