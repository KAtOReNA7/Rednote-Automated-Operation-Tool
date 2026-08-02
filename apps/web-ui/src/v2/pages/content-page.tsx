import { useEffect, useRef, useState } from 'react';

import { Button, Icon, PageHeader, StatusPill, useV2Controller } from '../components.js';
import { type V2Session, withPersistedContentPackages } from '../mock-provider.js';

interface EditableFields {
  readonly body: string;
  readonly materials: string;
  readonly tags: string;
  readonly time: string;
  readonly title: string;
}

function editableFields(item: V2Session['content'][number] | undefined): EditableFields {
  return {
    body: item?.body ?? '',
    materials: item?.materials ?? '',
    tags: item?.tags.join('，') ?? '',
    time: item?.time ?? '',
    title: item?.title ?? '',
  };
}

function approvalRefs(content: V2Session['content'], ids: readonly string[]) {
  return content
    .filter(({ id }) => ids.includes(id))
    .map((item) => ({
      expectedRevision: item.revision,
      expectedVersionId: item.versionId,
      packageId: item.id,
    }));
}

function stableKey(prefix: string, values: readonly string[]): string {
  let hash = 2_166_136_261;
  for (const character of values.join('\n')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
}

export function ContentPage(): React.JSX.Element {
  const { notify, session, setSession, setUi, ui } = useV2Controller();
  const { activeContentId: activeId, contentSelectedIds: selectedIds } = ui;
  const active = session.content.find(({ id }) => id === activeId) ?? session.content[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exportId, setExportId] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<EditableFields>(() => editableFields(active));

  useEffect(() => {
    setDraft(editableFields(active));
    setError('');
  }, [active?.id, active?.versionId]);

  const fail = (message: string): void => {
    setError(message);
    window.requestAnimationFrame(() => errorRef.current?.focus());
  };
  const updateDraft = (field: keyof EditableFields, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (window.rednoteV2 !== undefined || active === undefined) return;
    if (field !== 'body' && field !== 'title') return;
    setSession((current) => ({
      ...current,
      content: current.content.map((item) =>
        item.id === active.id ? { ...item, [field]: value } : item,
      ),
    }));
  };
  const applyWorkspace = (workspace: V2ContentWorkspaceContract): void => {
    setSession((current) => withPersistedContentPackages(current, workspace));
    setUi((current) => ({
      ...current,
      activeContentId: workspace.packages[0]?.id ?? '',
      contentSelectedIds: workspace.packages.map(({ id }) => id),
    }));
  };
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  };
  const generate = (): void => {
    void run(async () => {
      const bridge = window.rednoteV2;
      if (bridge === undefined) return fail('本机内容桥接不可用，未生成内容包。');
      if (session.planStatus !== 'CONFIRMED') return fail('请先锁定周计划，再生成内容包。');
      if (selectedIds.length !== 3) return fail('请从已锁定计划中明确选择 3 项。');
      const result = await bridge.generateContentPackages({
        candidateIds: selectedIds,
        expectedPlanRevision: session.planRevision,
        idempotencyKey: stableKey('content', [session.weekKey, ...selectedIds.slice().sort()]),
        weekKey: session.weekKey,
      });
      if (!result.ok) return fail(result.error.message);
      applyWorkspace(result.value);
      notify('已生成 3 个本地 Scripted 内容包；未调用模型。');
    });
  };
  const save = (): void => {
    if (active === undefined) return;
    void run(async () => {
      const bridge = window.rednoteV2;
      if (bridge === undefined) return fail('本机内容桥接不可用，未保存。');
      const tags = draft.tags
        .split(/[，,\n]/u)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const result = await bridge.saveContentPackage({
        expectedRevision: active.revision,
        expectedVersionId: active.versionId,
        fields: {
          body: draft.body,
          coverKey: active.coverKey as V2ContentPackageFieldsContract['coverKey'],
          materialNotes: draft.materials,
          suggestedTime: draft.time,
          tags,
          title: draft.title,
        },
        packageId: active.id,
      });
      if (!result.ok) return fail(result.error.message);
      const refreshed = await bridge.readContentPackages({ weekKey: session.weekKey });
      if (!refreshed.ok) return fail(refreshed.error.message);
      applyWorkspace(refreshed.value);
      setUi((current) => ({ ...current, activeContentId: result.value.id }));
      notify(
        result.value.version === active.version
          ? '内容没有实质变化，未创建新版本。'
          : `已保存版本 v${result.value.version}。`,
      );
    });
  };
  const approve = (ids: readonly string[]): void => {
    void run(async () => {
      const bridge = window.rednoteV2;
      if (bridge === undefined) {
        if (ids.length === 0) return fail('请先选择内容包。');
        setSession((current) => ({
          ...current,
          content: current.content.map((item) =>
            ids.includes(item.id) ? { ...item, status: '已通过' } : item,
          ),
        }));
        setUi((current) => ({ ...current, contentSelectedIds: [] }));
        return notify(`已通过 ${ids.length} 个模拟内容包；未导出、未发布。`);
      }
      const items = approvalRefs(session.content, ids);
      if (items.length === 0 || items.length !== ids.length) return fail('请选择当前内容包。');
      const result = await bridge.approveContentPackages({ items });
      if (!result.ok) return fail(result.error.message);
      applyWorkspace(result.value);
      notify(`已批准 ${items.length} 个当前版本；未导出、未发布。`);
    });
  };
  const exportSelected = (): void => {
    void run(async () => {
      const bridge = window.rednoteV2;
      if (bridge === undefined) return fail('本机内容桥接不可用，未导出。');
      const items = approvalRefs(session.content, selectedIds);
      if (items.length === 0) return fail('请先选择已批准内容包。');
      const result = await bridge.exportContentPackages({
        idempotencyKey: stableKey(
          'export',
          items.flatMap(({ packageId, expectedVersionId }) => [packageId, expectedVersionId]),
        ),
        items,
      });
      if (!result.ok) return fail(result.error.message);
      setExportId(result.value.exportId);
      notify(`已导出 ${result.value.packageCount} 个本地发布包；仍需用户手动发布。`);
    });
  };
  const openExport = (): void => {
    void run(async () => {
      const bridge = window.rednoteV2;
      if (bridge === undefined || exportId === '') return fail('当前没有可打开的导出目录。');
      const result = await bridge.openContentExport({ exportId });
      if (!result.ok) return fail(result.error.message);
      notify('已打开系统刚生成的受控导出目录。');
    });
  };

  const generationCandidates = session.plan.filter(({ status }) => status !== '已跳过');
  const selectedPackages = session.content.filter(({ id }) => selectedIds.includes(id));
  const selectable = session.content.length === 0 ? generationCandidates : session.content;
  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length;

  return (
    <div className="v2-page">
      <PageHeader
        actions={
          session.content.length === 0 ? (
            <Button disabled={busy} icon="sparkle" onClick={generate} tone="primary">
              生成 3 个内容包 {selectedIds.length > 0 ? `(${selectedIds.length}/3)` : ''}
            </Button>
          ) : (
            <>
              {exportId === '' ? null : (
                <Button disabled={busy} icon="export" onClick={openExport}>
                  打开导出目录
                </Button>
              )}
              <Button disabled={busy} icon="export" onClick={exportSelected}>
                导出所选 {selectedPackages.length > 0 ? `(${selectedPackages.length})` : ''}
              </Button>
              <Button
                disabled={busy}
                icon="check"
                onClick={() => approve(selectedIds)}
                tone="primary"
              >
                {window.rednoteV2 === undefined ? '批量通过' : '批量批准'}{' '}
                {selectedPackages.length > 0 ? `(${selectedPackages.length})` : ''}
              </Button>
            </>
          )
        }
        description="封面、标题、正文、标签、建议日期时间和素材说明在一个工作区完成编辑、批准与本地导出。"
        eyebrow="六字段内容包 · 完全本地"
        title="内容"
      />
      <p className="v2-kicker">本地 Scripted 内容，不是模型生成；费用与业务网络均为 0。</p>
      {error === '' ? null : (
        <div className="v2-form-error" ref={errorRef} role="alert" tabIndex={-1}>
          <Icon name="warning-circle" />
          <span>{error}</span>
        </div>
      )}
      <div className="v2-content-grid">
        <section aria-label="内容包列表" className="v2-card v2-package-list">
          <header>
            <strong>
              {session.content.length === 0 ? '选择锁定计划项' : `内容包 ${session.content.length}`}
            </strong>
            <button
              onClick={() =>
                setUi((current) => ({
                  ...current,
                  contentSelectedIds: allSelected ? [] : selectable.map(({ id }) => id),
                }))
              }
              type="button"
            >
              {allSelected ? '清除选择' : '全选'}
            </button>
          </header>
          {selectable.map((item) => {
            const selected = selectedIds.includes(item.id);
            const label = item.book;
            const subtitle = item.title;
            return (
              <article data-active={'versionId' in item && active?.id === item.id} key={item.id}>
                <button
                  aria-label={`${selected ? '取消选择' : '选择'} ${label}`}
                  onClick={() =>
                    setUi((current) => ({
                      ...current,
                      contentSelectedIds: selected
                        ? current.contentSelectedIds.filter((id) => id !== item.id)
                        : [...current.contentSelectedIds, item.id],
                    }))
                  }
                  type="button"
                >
                  <Icon name={selected ? 'check-square' : 'square'} />
                </button>
                <button
                  disabled={!('versionId' in item)}
                  onClick={() => setUi((current) => ({ ...current, activeContentId: item.id }))}
                  type="button"
                >
                  <span>
                    <strong>{label}</strong>
                    <small>{subtitle}</small>
                  </span>
                  <StatusPill status={item.status} />
                </button>
              </article>
            );
          })}
        </section>
        {active === undefined ? (
          <section aria-label="尚未生成内容" className="v2-card v2-package-detail">
            <Icon name="file-text" size={34} />
            <h2>尚未生成内容包</h2>
            <p>
              {session.planStatus === 'CONFIRMED'
                ? '请在左侧明确选择 3 个计划项，然后生成确定性本地内容。'
                : '当前周计划尚未锁定；生成操作保持禁用门禁。'}
            </p>
          </section>
        ) : (
          <section aria-label={`${active.book} 内容包`} className="v2-card v2-package-detail">
            <div className="v2-section-head">
              <div>
                <p className="v2-kicker">{active.book}</p>
                <h2>{active.title}</h2>
                <small>
                  v{active.version} · revision {active.revision} · {active.status}
                </small>
              </div>
              <div className="v2-header-actions">
                <Button disabled={busy} icon="check" onClick={() => approve([active.id])}>
                  批准当前版本
                </Button>
                <Button disabled={busy} icon="pencil-simple" onClick={save} tone="primary">
                  保存内容
                </Button>
              </div>
            </div>
            <div className="v2-package-grid">
              <figure>
                <img alt={active.coverAlt} src={active.cover} />
                <figcaption>
                  <Icon name="image-square" size={16} />
                  封面 · 已批准演示资产 · 不可在本轮替换
                </figcaption>
              </figure>
              <div className="v2-package-fields">
                <label className="v2-field">
                  <span>标题</span>
                  <input
                    onChange={(event) => updateDraft('title', event.target.value)}
                    value={draft.title}
                  />
                </label>
                <label className="v2-field">
                  <span>正文</span>
                  <textarea
                    onChange={(event) => updateDraft('body', event.target.value)}
                    rows={7}
                    value={draft.body}
                  />
                </label>
                <div className="v2-field-row">
                  <label className="v2-field">
                    <span>建议日期时间</span>
                    <input
                      onChange={(event) => updateDraft('time', event.target.value)}
                      type="datetime-local"
                      value={draft.time}
                    />
                  </label>
                  <label className="v2-field">
                    <span>标签（逗号分隔）</span>
                    <input
                      onChange={(event) => updateDraft('tags', event.target.value)}
                      value={draft.tags}
                    />
                  </label>
                </div>
                <label className="v2-field">
                  <span>素材说明</span>
                  <textarea
                    onChange={(event) => updateDraft('materials', event.target.value)}
                    rows={3}
                    value={draft.materials}
                  />
                </label>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
