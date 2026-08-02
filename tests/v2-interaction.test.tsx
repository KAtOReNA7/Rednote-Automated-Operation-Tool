// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { V2LocalInteractionFiles } from '../apps/desktop/src/v2-interaction-files.js';
import { V2App } from '../apps/web-ui/src/v2/app.js';
import { SqliteV2Repository } from '../packages/db/src/index.js';
import {
  DEFAULT_ACCOUNT_PERSONA,
  V2ApplicationFacade,
  V2InteractionApplication,
  V2InteractionError,
  V2_DEFAULT_WEEK_KEY,
  parseInteractionMutationRequest,
  toV2Exception,
  type InteractionBlobRef,
  type InteractionCreateResult,
  type InteractionItem,
  type InteractionKind,
  type InteractionWorkspace,
  type V2Bridge,
  type V2InteractionFilePort,
  type V2Result,
} from '../packages/v2/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';
import { createMemoryV2Bridge } from './support/v2-test-runtime.js';

const databases: DatabaseSync[] = [];

class MemoryInteractionFiles implements V2InteractionFilePort {
  readonly #values = new Map<string, string>();
  public writes = 0;

  public dedupKey(kind: InteractionKind, relatedId: string | null, text: string): string {
    return createHash('sha256')
      .update(`${kind}\0${relatedId ?? ''}\0${text}`)
      .digest('hex');
  }

  public async readText(ref: InteractionBlobRef): Promise<string> {
    const value = this.#values.get(ref.managedPath);
    if (value === undefined) throw new V2InteractionError('INTERACTION_CORRUPT');
    return value;
  }

  public async writeText(text: string): Promise<InteractionBlobRef> {
    this.writes += 1;
    const sha256 = createHash('sha256').update(text).digest('hex');
    const managedPath = `imports/interaction/${sha256}`;
    this.#values.set(managedPath, text);
    return { managedPath, sha256, sizeBytes: Buffer.byteLength(text) };
  }
}

async function harness() {
  const { database } = await createInitializedDatabase('v2 r05 interactions');
  databases.push(database);
  const repository = new SqliteV2Repository(database, {
    now: () => new Date('2026-08-02T12:00:00.000Z'),
  });
  const facade = new V2ApplicationFacade(repository);
  facade.read({ view: 'ACCOUNT_PERSONA' });
  facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY });
  database
    .prepare(
      `INSERT INTO v2_content_packages(
         workspace_id, package_id, week_key, candidate_id, plan_revision,
         current_version, revision, created_at, updated_at
       ) VALUES ('v2-local-workspace', 'r04-package-1', ?, 'mon-1', 0, 1, 0, ?, ?)`,
    )
    .run(V2_DEFAULT_WEEK_KEY, '2026-08-02T12:00:00.000Z', '2026-08-02T12:00:00.000Z');
  const files = new MemoryInteractionFiles();
  return {
    app: new V2InteractionApplication(repository, files),
    database,
    files,
    repository,
  };
}

function createInput(
  kind: InteractionKind,
  userText: string,
  relatedContentPackageId: string | null = null,
) {
  return {
    action: 'CREATE_INTERACTION' as const,
    expectedRevision: 0 as const,
    kind,
    relatedContentPackageId,
    userText,
  };
}

async function createAndSuggest(app: V2InteractionApplication, text: string) {
  const created = (await app.mutate(
    createInput('COMMENT', text),
    DEFAULT_ACCOUNT_PERSONA,
  )) as InteractionCreateResult;
  return app.mutate(
    {
      action: 'GENERATE_REPLY_SUGGESTION',
      expectedRevision: created.item.revision,
      idempotencyKey: `reply-${created.item.itemId}`,
      itemId: created.item.itemId,
    },
    DEFAULT_ACCOUNT_PERSONA,
  ) as Promise<InteractionItem>;
}

afterEach(async () => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteV2');
  for (const database of databases.splice(0)) database.close();
  cleanTemporaryDatabases();
  await cleanTemporaryStorageDirectories();
});

describe('V2-R05 interaction contracts and local persistence', () => {
  it('accepts only exact bounded USER_PASTE commands without leaking rejected text', () => {
    expect(parseInteractionMutationRequest(createInput('COMMENT', '一条评论'))).toMatchObject({
      action: 'CREATE_INTERACTION',
      kind: 'COMMENT',
    });
    const privateText = '不应进入错误消息的正文';
    for (const invalid of [
      createInput('EMAIL' as InteractionKind, privateText),
      createInput('COMMENT', '   '),
      createInput('DIRECT_MESSAGE', '字'.repeat(2_667)),
      { ...createInput('COMMENT', privateText), senderName: 'not-allowed' },
    ]) {
      try {
        parseInteractionMutationRequest(invalid);
        throw new Error('invalid interaction command was accepted');
      } catch (error) {
        expect(JSON.stringify(toV2Exception(error))).not.toContain(privateText);
      }
    }
  });

  it('creates both kinds, validates a stable R04 ID, deduplicates before writing, and restores', async () => {
    const { app, database, files, repository } = await harness();
    const commentInput = createInput('COMMENT', '  评论内容\r\n第二行  ', 'r04-package-1');
    const comment = (await app.mutate(
      commentInput,
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionCreateResult;
    const replay = (await app.mutate(
      commentInput,
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionCreateResult;
    const direct = (await app.mutate(
      createInput('DIRECT_MESSAGE', '私信内容'),
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionCreateResult;

    expect(comment).toMatchObject({
      duplicate: false,
      item: { kind: 'COMMENT', userText: '评论内容\n第二行' },
    });
    expect(replay).toMatchObject({ duplicate: true, item: { itemId: comment.item.itemId } });
    expect(direct.item.kind).toBe('DIRECT_MESSAGE');
    expect(files.writes).toBe(2);
    expect(database.prepare('SELECT count(*) AS count FROM v2_interaction_items').get()).toEqual({
      count: 2,
    });
    await expect(
      app.mutate(createInput('COMMENT', '错误关联', 'missing-package'), DEFAULT_ACCOUNT_PERSONA),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    const restored = new V2InteractionApplication(repository, files);
    await expect(restored.read()).resolves.toMatchObject({
      items: [{ kind: 'COMMENT' }, { kind: 'DIRECT_MESSAGE' }],
    });
    const metadata = JSON.stringify(
      database.prepare('SELECT * FROM v2_interaction_items ORDER BY item_id').all(),
    );
    expect(metadata).not.toMatch(/评论内容|私信内容|第二行/u);
  });

  it('keeps Scripted generation idempotent, versions only material edits, and binds confirmation', async () => {
    const { app, files } = await harness();
    const suggested = await createAndSuggest(app, '这个顺序适合新读者吗？');
    const replay = (await app.mutate(
      {
        action: 'GENERATE_REPLY_SUGGESTION',
        expectedRevision: 0,
        idempotencyKey: `reply-${suggested.itemId}`,
        itemId: suggested.itemId,
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionItem;
    expect(replay).toEqual(suggested);
    expect(files.writes).toBe(2);

    const noOp = (await app.mutate(
      {
        action: 'SAVE_REPLY_SUGGESTION',
        expectedRevision: suggested.revision,
        expectedVersionId: suggested.currentSuggestionVersionId ?? '',
        itemId: suggested.itemId,
        replyText: suggested.currentSuggestion ?? '',
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionItem;
    const edited = (await app.mutate(
      {
        action: 'SAVE_REPLY_SUGGESTION',
        expectedRevision: noOp.revision,
        expectedVersionId: noOp.currentSuggestionVersionId ?? '',
        itemId: noOp.itemId,
        replyText: `${noOp.currentSuggestion} 用户修订。`,
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionItem;
    expect([noOp.currentSuggestionVersion, edited.currentSuggestionVersion]).toEqual([1, 2]);
    const confirmed = (await app.mutate(
      {
        action: 'CONFIRM_REPLY_SUGGESTIONS',
        items: [
          {
            expectedRevision: edited.revision,
            expectedVersionId: edited.currentSuggestionVersionId ?? '',
            itemId: edited.itemId,
          },
        ],
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionWorkspace;
    expect(confirmed.items[0]?.status).toBe('CONFIRMED');

    const current = confirmed.items[0];
    if (current === undefined) throw new Error('missing confirmed item');
    const invalidated = (await app.mutate(
      {
        action: 'SAVE_REPLY_SUGGESTION',
        expectedRevision: current.revision,
        expectedVersionId: current.currentSuggestionVersionId ?? '',
        itemId: current.itemId,
        replyText: `${current.currentSuggestion} 再次修订。`,
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionItem;
    expect(invalidated.status).toBe('SUGGESTED');
    await expect(
      app.mutate(
        {
          action: 'MARK_INTERACTION_MANUAL_SENT',
          confirmed: true,
          expectedRevision: invalidated.revision,
          expectedVersionId: current.currentSuggestionVersionId ?? '',
          itemId: invalidated.itemId,
        },
        DEFAULT_ACCOUNT_PERSONA,
      ),
    ).rejects.toMatchObject({ code: 'INTERACTION_STATE_INVALID' });
  });

  it('enforces skip/reopen and manual-sent correction without external actions', async () => {
    const { app } = await harness();
    const suggested = await createAndSuggest(app, '请推荐短篇。');
    const skipped = (await app.mutate(
      {
        action: 'SKIP_INTERACTION',
        expectedRevision: suggested.revision,
        itemId: suggested.itemId,
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionItem;
    const reopened = (await app.mutate(
      { action: 'REOPEN_INTERACTION', expectedRevision: skipped.revision, itemId: skipped.itemId },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionItem;
    expect(reopened.status).toBe('SUGGESTED');
    await expect(
      app.mutate(
        {
          action: 'REOPEN_INTERACTION',
          expectedRevision: reopened.revision,
          itemId: reopened.itemId,
        },
        DEFAULT_ACCOUNT_PERSONA,
      ),
    ).rejects.toMatchObject({ code: 'INTERACTION_STATE_INVALID' });
    const workspace = (await app.mutate(
      {
        action: 'CONFIRM_REPLY_SUGGESTIONS',
        items: [
          {
            expectedRevision: reopened.revision,
            expectedVersionId: reopened.currentSuggestionVersionId ?? '',
            itemId: reopened.itemId,
          },
        ],
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionWorkspace;
    const confirmed = workspace.items[0];
    if (confirmed === undefined) throw new Error('missing confirmed interaction');
    const sent = (await app.mutate(
      {
        action: 'MARK_INTERACTION_MANUAL_SENT',
        confirmed: true,
        expectedRevision: confirmed.revision,
        expectedVersionId: confirmed.currentSuggestionVersionId ?? '',
        itemId: confirmed.itemId,
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionItem;
    const undone = (await app.mutate(
      {
        action: 'UNDO_INTERACTION_MANUAL_SENT',
        expectedRevision: sent.revision,
        itemId: sent.itemId,
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionItem;
    expect([sent.status, undone.status]).toEqual(['MANUAL_SENT', 'CONFIRMED']);
  });

  it('rolls back an atomic batch containing one stale revision', async () => {
    const { app, repository } = await harness();
    const first = await createAndSuggest(app, '第一条');
    const second = await createAndSuggest(app, '第二条');
    await expect(
      app.mutate(
        {
          action: 'CONFIRM_REPLY_SUGGESTIONS',
          items: [
            {
              expectedRevision: first.revision,
              expectedVersionId: first.currentSuggestionVersionId ?? '',
              itemId: first.itemId,
            },
            {
              expectedRevision: 99,
              expectedVersionId: second.currentSuggestionVersionId ?? '',
              itemId: second.itemId,
            },
          ],
        },
        DEFAULT_ACCOUNT_PERSONA,
      ),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(repository.listInteractions().map(({ status }) => status)).toEqual([
      'SUGGESTED',
      'SUGGESTED',
    ]);
  });

  it('previews and confirms a tombstone while preserving unrelated R04 data and retained blobs', async () => {
    const { app, database, repository } = await harness();
    const first = await createAndSuggest(app, '删除目标');
    const other = await createAndSuggest(app, '保留目标');
    const preview = await app.previewDelete(first.itemId);
    expect(preview).toEqual({
      itemId: first.itemId,
      physicalDeletion: false,
      retainedManagedReferenceCount: 2,
      tombstone: true,
    });
    const remaining = (await app.mutate(
      {
        action: 'DELETE_INTERACTION',
        confirmed: true,
        expectedRevision: first.revision,
        itemId: first.itemId,
      },
      DEFAULT_ACCOUNT_PERSONA,
    )) as InteractionWorkspace;
    expect(remaining.items.map(({ itemId }) => itemId)).toEqual([other.itemId]);
    expect(() => repository.getInteraction(first.itemId)).toThrow();
    await expect(app.previewDelete(first.itemId)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(repository.contentPackageExists('r04-package-1')).toBe(true);
    expect(
      database
        .prepare('SELECT status FROM v2_interaction_items WHERE item_id = ?')
        .get(first.itemId),
    ).toEqual({ status: 'DELETED' });
    expect(
      database.prepare('SELECT count(*) AS count FROM v2_reply_suggestion_versions').get(),
    ).toEqual({ count: 2 });
  });
});

function interactionBridge(app: V2InteractionApplication): V2Bridge {
  const base = createMemoryV2Bridge();
  const run = async <T,>(operation: () => Promise<T>): Promise<V2Result<T>> => {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      return { error: toV2Exception(error), ok: false };
    }
  };
  return {
    ...base,
    confirmReplySuggestions: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'CONFIRM_REPLY_SUGGESTIONS', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionWorkspace>,
      ),
    createInteraction: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'CREATE_INTERACTION', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionCreateResult>,
      ),
    deleteInteraction: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'DELETE_INTERACTION', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionWorkspace>,
      ),
    generateReplySuggestion: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'GENERATE_REPLY_SUGGESTION', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionItem>,
      ),
    markInteractionManualSent: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'MARK_INTERACTION_MANUAL_SENT', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionItem>,
      ),
    previewInteractionDelete: (input) => run(() => app.previewDelete(input.itemId)),
    readInteractions: () => run(() => app.read()),
    reopenInteraction: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'REOPEN_INTERACTION', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionItem>,
      ),
    saveReplySuggestion: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'SAVE_REPLY_SUGGESTION', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionItem>,
      ),
    skipInteraction: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'SKIP_INTERACTION', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionItem>,
      ),
    undoInteractionManualSent: (input) =>
      run(
        () =>
          app.mutate(
            { action: 'UNDO_INTERACTION_MANUAL_SENT', ...input },
            DEFAULT_ACCOUNT_PERSONA,
          ) as Promise<InteractionItem>,
      ),
  };
}

describe('V2-R05 interaction renderer and managed files', () => {
  it('keeps the existing page structure keyboard-reachable and never presents a send action', async () => {
    const { app } = await harness();
    Object.defineProperty(window, 'rednoteV2', {
      configurable: true,
      value: interactionBridge(app),
    });
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => undefined });
    window.history.replaceState(null, '', '/v2.html#/v2/interaction');
    const user = userEvent.setup();
    render(<V2App />);
    expect(await screen.findByText('尚无本地互动')).toBeVisible();
    expect(screen.getByText('本地 Scripted 建议，不是模型生成；系统不会发送消息。')).toBeVisible();
    await user.type(screen.getByLabelText('粘贴一条评论或私信'), '键盘录入评论');
    await user.click(screen.getByRole('button', { name: '保存本地互动' }));
    expect((await screen.findAllByText('键盘录入评论')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '生成建议' }));
    await waitFor(() => expect(screen.getByLabelText('回复建议')).not.toHaveValue(''));
    expect(screen.queryByRole('button', { name: /自动发送|发送消息/u })).not.toBeInTheDocument();
    const select = screen.getByRole('button', { name: /选择 评论/u });
    select.focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: /批量确认建议/u }));
    expect(await screen.findByText(/评论 · 已确认/u)).toBeVisible();
    const record = screen.getByRole('button', { name: '记录已在官方端手动发送' });
    expect(record).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /我确认已在小红书官方端手动发送/u }));
    expect(record).toBeEnabled();
  });

  it('never exposes prototype content IDs while persisted content is restoring', async () => {
    const { app } = await harness();
    const bridge = interactionBridge(app);
    let submitted: Parameters<V2Bridge['createInteraction']>[0] | undefined;
    let restoreContent!: (value: Awaited<ReturnType<V2Bridge['readContentPackages']>>) => void;
    const contentRead = new Promise<Awaited<ReturnType<V2Bridge['readContentPackages']>>>(
      (resolve) => {
        restoreContent = resolve;
      },
    );
    Object.defineProperty(window, 'rednoteV2', {
      configurable: true,
      value: {
        ...bridge,
        createInteraction: (input: Parameters<V2Bridge['createInteraction']>[0]) => {
          submitted = input;
          return bridge.createInteraction(input);
        },
        readContentPackages: () => contentRead,
      },
    });
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => undefined });
    window.history.replaceState(null, '', '/v2.html#/v2/interaction');
    const user = userEvent.setup();
    render(<V2App />);

    expect(screen.queryByRole('option', { name: '《莫格街凶杀案》' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '关联内容包（可选）' })).toHaveValue('');
    restoreContent({
      ok: true,
      value: { packages: [], schemaVersion: 1, weekKey: V2_DEFAULT_WEEK_KEY },
    });
    await waitFor(() => expect(screen.getByText('尚无本地互动')).toBeVisible());
    await user.type(screen.getByLabelText('粘贴一条评论或私信'), '恢复后的评论');
    await user.click(screen.getByRole('button', { name: '保存本地互动' }));

    expect(await screen.findByText('恢复后的评论', { selector: 'small' })).toBeVisible();
    expect(submitted?.relatedContentPackageId).toBeNull();
  });

  it('uses bounded content-addressed IMPORT files and stable dedup hashes', async () => {
    const { root, rootPath } = await createStorageTestContext();
    const files = new V2LocalInteractionFiles(root);
    const text = '本地托管互动正文';
    const first = await files.writeText(text, 'USER_TEXT');
    const second = await files.writeText(text, 'USER_TEXT');
    expect(second).toEqual(first);
    expect(first.managedPath).toMatch(/^imports\/[a-f0-9]{2}\/[a-f0-9]{64}$/u);
    expect(JSON.stringify(first)).not.toContain(rootPath);
    await expect(files.readText(first)).resolves.toBe(text);
    expect(files.dedupKey('COMMENT', null, text)).toMatch(/^[a-f0-9]{64}$/u);
  });
});
