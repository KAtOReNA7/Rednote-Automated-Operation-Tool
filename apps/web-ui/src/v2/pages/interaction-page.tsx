import { useEffect, useRef, useState } from 'react';

import { Button, Icon, PageHeader, useV2Controller } from '../components.js';
import { withPersistedInteractions, type V2Session } from '../mock-provider.js';
import { ProviderActionControl } from '../provider-action-control.js';

// prettier-ignore
const statusLabels: Readonly<Record<V2InteractionStatusContract, string>> = Object.freeze({ CONFIRMED: '已确认', MANUAL_SENT: '已记录手动发送', NEW: '待生成建议', SKIPPED: '已跳过', SUGGESTED: '待确认' });
type ItemAction = 'MANUAL_SENT' | 'REOPEN' | 'SAVE' | 'SKIP' | 'UNDO_SENT';
type DetailAction = ItemAction | 'CONFIRM' | 'GENERATE';
// prettier-ignore
const detailActionsByStatus: Readonly<Record<V2InteractionStatusContract, readonly (readonly [DetailAction, string])[]>> = Object.freeze({
  CONFIRMED: [['SAVE', '保存建议']],
  MANUAL_SENT: [['UNDO_SENT', '撤销手动发送记录']],
  NEW: [['GENERATE', '生成建议'], ['SKIP', '跳过']],
  SKIPPED: [['REOPEN', '重新打开']],
  SUGGESTED: [['SAVE', '保存建议'], ['CONFIRM', '确认建议'], ['SKIP', '跳过']],
});

function refs(items: V2Session['interactions'], ids: readonly string[]) {
  return items
    .filter(
      ({ id, status, versionId }) => ids.includes(id) && status === 'SUGGESTED' && versionId !== '',
    )
    .map((item) => ({
      expectedRevision: item.revision,
      expectedVersionId: item.versionId,
      itemId: item.id,
    }));
}

export function InteractionPage(): React.JSX.Element {
  const { notify, session, setSession, setUi, ui } = useV2Controller();
  const {
    activeInteractionId: activeId,
    interactionSelectedIds: selectedIds,
    interactionTab: tab,
  } = ui;
  const [busy, setBusy] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deletePreview, setDeletePreview] = useState<V2InteractionDeletePreviewContract | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [newText, setNewText] = useState('');
  const [relatedId, setRelatedId] = useState('');
  const [sentConfirmed, setSentConfirmed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | V2InteractionStatusContract>('ALL');
  const errorRef = useRef<HTMLDivElement>(null);
  const byTab = session.interactions.filter(({ type }) => type === tab);
  const filtered = byTab.filter(({ status }) => statusFilter === 'ALL' || status === statusFilter);
  const active = filtered.find(({ id }) => id === activeId) ?? filtered[0];

  useEffect(() => {
    setDraft(active?.suggestion ?? '');
    setDeletePreview(null);
    setDeleteConfirmed(false);
    setSentConfirmed(false);
  }, [active?.id, active?.versionId]);

  const fail = (message: string): void => {
    setError(message);
    window.requestAnimationFrame(() => errorRef.current?.focus());
  };
  const apply = (workspace: V2InteractionWorkspaceContract, preferredId = ''): void => {
    setSession((current) => withPersistedInteractions(current, workspace));
    setUi((current) => ({
      ...current,
      activeInteractionId:
        workspace.items.find(({ itemId }) => itemId === preferredId)?.itemId ??
        workspace.items[0]?.itemId ??
        '',
      interactionSelectedIds: current.interactionSelectedIds.filter((id) =>
        workspace.items.some(({ itemId }) => itemId === id),
      ),
    }));
  };
  const refresh = async (preferredId = ''): Promise<boolean> => {
    const result = await window.rednoteV2?.readInteractions();
    if (result === undefined) return (fail('本机互动桥接不可用，未保存。'), false);
    if (!result.ok) return (fail(result.error.message), false);
    apply(result.value, preferredId);
    return true;
  };
  const run = (operation: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    setError('');
    void operation().finally(() => setBusy(false));
  };
  const changeTab = (next: '评论' | '私信'): void => {
    setStatusFilter('ALL');
    setUi((current) => ({
      ...current,
      activeInteractionId: session.interactions.find(({ type }) => type === next)?.id ?? '',
      interactionSelectedIds: [],
      interactionTab: next,
    }));
  };
  const create = (): void =>
    run(async () => {
      const result = await window.rednoteV2?.createInteraction({
        expectedRevision: 0,
        kind: tab === '评论' ? 'COMMENT' : 'DIRECT_MESSAGE',
        relatedContentPackageId: session.content.find(({ id }) => id === relatedId)?.id ?? null,
        userText: newText,
      });
      if (result === undefined) return fail('本机互动桥接不可用，未导入。');
      if (!result.ok) return fail(result.error.message);
      if (!result.value.persisted) return fail('互动未能从当前本机项目重新读取，请重试。');
      setNewText('');
      if (!(await refresh(result.value.item.itemId))) return;
      notify(
        result.value.duplicate ? '相同互动记录已存在，未重复写入。' : '互动记录已保存到本机。',
      );
    });
  const confirmSelected = (): void =>
    run(async () => {
      const items = refs(session.interactions, selectedIds);
      if (items.length === 0 || items.length !== selectedIds.length)
        return fail('请选择当前可确认的建议。');
      const result = await window.rednoteV2?.confirmReplySuggestions({ items });
      if (result === undefined) return fail('本机互动桥接不可用，未确认。');
      if (!result.ok) return fail(result.error.message);
      apply(result.value);
      notify(`已确认 ${items.length} 条建议；系统没有发送消息。`);
    });
  const confirmOne = (): void => {
    if (active === undefined || window.rednoteV2 === undefined) return fail('本机互动桥接不可用。');
    run(async () => {
      const result = await window.rednoteV2?.confirmReplySuggestions({
        items: refs(session.interactions, [active.id]),
      });
      if (result === undefined || !result.ok)
        return fail(result?.error.message ?? '本地互动桥接不可用。');
      apply(result.value, active.id);
      notify('建议已确认，尚未发送。');
    });
  };
  const itemAction = (action: ItemAction): void => {
    const bridge = window.rednoteV2;
    if (bridge === undefined || active === undefined) return fail('本机互动桥接不可用，未保存。');
    const item = active;
    const messages = {
      MANUAL_SENT: '仅记录你已在官方端手动发送；系统没有发送消息。',
      REOPEN: '互动项已重新打开。',
      SAVE: '回复建议已保存；实质变化会创建新版本。',
      SKIP: '已跳过，可随时重新打开。',
      UNDO_SENT: '错误标记已撤销；没有执行平台动作。',
    } as const;
    const operation =
      action === 'SAVE'
        ? bridge.saveReplySuggestion({
            expectedRevision: item.revision,
            expectedVersionId: item.versionId,
            itemId: item.id,
            replyText: draft,
          })
        : action === 'MANUAL_SENT'
          ? bridge.markInteractionManualSent({
              confirmed: true,
              expectedRevision: item.revision,
              expectedVersionId: item.versionId,
              itemId: item.id,
            })
          : bridge[
              action === 'REOPEN'
                ? 'reopenInteraction'
                : action === 'SKIP'
                  ? 'skipInteraction'
                  : 'undoInteractionManualSent'
            ]({ expectedRevision: item.revision, itemId: item.id });
    run(async () => {
      const result = await operation;
      if (!result.ok) return fail(result.error.message);
      await refresh(result.value.itemId);
      notify(messages[action]);
    });
  };
  const previewDelete = (): void => {
    if (active === undefined) return;
    run(async () => {
      const result = await window.rednoteV2?.previewInteractionDelete({ itemId: active.id });
      if (result === undefined) return fail('本机互动桥接不可用，未预览删除。');
      if (!result.ok) return fail(result.error.message);
      setDeletePreview(result.value);
    });
  };
  const deleteActive = (): void => {
    if (active === undefined || window.rednoteV2 === undefined) return;
    run(async () => {
      const result = await window.rednoteV2?.deleteInteraction({
        confirmed: true,
        expectedRevision: active.revision,
        itemId: active.id,
      });
      if (result === undefined || !result.ok)
        return fail(result?.error.message ?? '本地互动桥接不可用。');
      apply(result.value);
      notify('本地互动记录已建立墓碑，普通产品接口不再可读。');
    });
  };
  const detailActions = active === undefined ? [] : detailActionsByStatus[active.status];

  return (
    <div className="v2-page v2-interaction-page">
      <PageHeader
        actions={
          <Button disabled={busy} icon="check" onClick={confirmSelected} tone="primary">
            批量确认建议 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </Button>
        }
        description="主动粘贴一条评论或私信，在本机生成、编辑和确认回复建议。"
        eyebrow={`评论 ${session.interactions.filter(({ type }) => type === '评论').length} 条 · 私信 ${session.interactions.filter(({ type }) => type === '私信').length} 条 · 本地保存`}
        title="互动"
      />
      <p className="v2-kicker">回复建议仅在你预览并确认后生成；系统不会发送消息。</p>
      <p className="v2-manual-note">数据保存在本地项目数据中，默认保留至你明确删除，不会上传。</p>
      {error === '' ? null : (
        <div className="v2-form-error" ref={errorRef} role="alert" tabIndex={-1}>
          <Icon name="warning-circle" />
          <span>{error}</span>
        </div>
      )}
      <section aria-label="添加本地互动" className="v2-card v2-reply-detail">
        <div className="v2-segments">
          {(['评论', '私信'] as const).map((value) => (
            <button
              data-active={tab === value}
              key={value}
              onClick={() => changeTab(value)}
              type="button"
            >
              {value}
            </button>
          ))}
        </div>
        <label className="v2-field">
          <span>粘贴一条{tab}</span>
          <textarea
            aria-label="粘贴一条评论或私信"
            onChange={(event) => setNewText(event.target.value)}
            rows={3}
            value={newText}
          />
        </label>
        <label className="v2-field">
          <span>关联内容包（可选）</span>
          <select onChange={(event) => setRelatedId(event.target.value)} value={relatedId}>
            <option value="">不关联</option>
            {session.content.map((item) => (
              <option key={item.id} value={item.id}>
                {item.book}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={busy || newText.trim() === ''}
          icon="plus"
          onClick={create}
          tone="primary"
        >
          保存本地互动
        </Button>
      </section>
      <div className="v2-interaction-grid">
        <section aria-label="本地互动列表" className="v2-card v2-inbox">
          <label className="v2-field">
            <span>状态筛选</span>
            <select
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              value={statusFilter}
            >
              <option value="ALL">全部状态</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {filtered.length === 0 ? (
            <p className="v2-manual-note">当前筛选下没有本地互动。</p>
          ) : null}
          {filtered.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <article data-active={active?.id === item.id} key={item.id}>
                <button
                  aria-label={`${selected ? '取消选择' : '选择'} ${item.type} ${item.id}`}
                  disabled={item.status !== 'SUGGESTED'}
                  onClick={() =>
                    setUi((current) => ({
                      ...current,
                      interactionSelectedIds: selected
                        ? current.interactionSelectedIds.filter((id) => id !== item.id)
                        : [...current.interactionSelectedIds, item.id],
                    }))
                  }
                  type="button"
                >
                  <Icon name={selected ? 'check-square' : 'square'} size={17} />
                </button>
                <button
                  onClick={() => setUi((current) => ({ ...current, activeInteractionId: item.id }))}
                  type="button"
                >
                  <span className="v2-avatar">{item.type.slice(0, 1)}</span>
                  <span>
                    <strong>{item.type}</strong>
                    <small>{item.original}</small>
                  </span>
                  <b>{statusLabels[item.status]}</b>
                </button>
              </article>
            );
          })}
        </section>
        {active === undefined ? (
          <section aria-label="尚无互动详情" className="v2-card v2-reply-detail">
            <h2>尚无本地互动</h2>
            <p>请先在上方主动粘贴一条评论或私信。</p>
          </section>
        ) : (
          <section aria-label="回复详情" className="v2-card v2-reply-detail">
            <div>
              <p className="v2-kicker">
                {active.source === 'MODEL' ? '模型生成建议' : '本地导入记录'}
              </p>
              <h2>
                {active.type} · {statusLabels[active.status]}
              </h2>
              <small>
                revision {active.revision} ·{' '}
                {active.versionId === '' ? '尚无建议版本' : `v${active.version}`}
              </small>
              <blockquote>{active.original}</blockquote>
            </div>
            <label className="v2-field">
              <span>
                <Icon name="sparkle" size={16} /> 回复建议
              </span>
              <textarea
                aria-label="回复建议"
                disabled={
                  active.status === 'NEW' ||
                  active.status === 'SKIPPED' ||
                  active.status === 'MANUAL_SENT'
                }
                onChange={(event) => setDraft(event.target.value)}
                rows={7}
                value={draft}
              />
            </label>
            <div className="v2-reply-actions">
              {detailActions.map(([action, label]) =>
                action === 'GENERATE' ? (
                  <ProviderActionControl
                    disabled={busy}
                    intent={{
                      expectedRevision: active.revision,
                      idempotencyKey: `reply-${active.id}`,
                      itemId: active.id,
                      kind: 'REPLY_SUGGESTION',
                    }}
                    key={action}
                    label="预览生成回复建议"
                    onSuccess={async () => {
                      await refresh(active.id);
                    }}
                  />
                ) : (
                  <Button
                    disabled={busy}
                    key={action}
                    onClick={action === 'CONFIRM' ? confirmOne : () => itemAction(action)}
                  >
                    {label}
                  </Button>
                ),
              )}
            </div>
            {active.status === 'CONFIRMED' ? (
              <label>
                <input
                  checked={sentConfirmed}
                  onChange={(event) => setSentConfirmed(event.target.checked)}
                  type="checkbox"
                />{' '}
                我确认已在小红书官方端手动发送
              </label>
            ) : null}
            {active.status === 'CONFIRMED' ? (
              <Button
                disabled={busy || !sentConfirmed}
                icon="paper-plane-tilt"
                onClick={() => itemAction('MANUAL_SENT')}
              >
                记录已在官方端手动发送
              </Button>
            ) : null}
            <Button disabled={busy} icon="x" onClick={previewDelete}>
              预览删除
            </Button>
            {deletePreview?.itemId === active.id ? (
              <div role="status">
                <p>
                  将创建删除墓碑并解除产品访问；{deletePreview.retainedManagedReferenceCount}{' '}
                  个托管引用等待安全清理，磁盘字节不会在本轮冒充已删除。
                </p>
                <label>
                  <input
                    checked={deleteConfirmed}
                    onChange={(event) => setDeleteConfirmed(event.target.checked)}
                    type="checkbox"
                  />{' '}
                  我确认删除这条本地互动记录
                </label>
                <Button disabled={busy || !deleteConfirmed} onClick={deleteActive}>
                  确认删除本地记录
                </Button>
              </div>
            ) : null}
            <p className="v2-manual-note">未连接平台，不会自动发送评论或私信。</p>
          </section>
        )}
      </div>
    </div>
  );
}
