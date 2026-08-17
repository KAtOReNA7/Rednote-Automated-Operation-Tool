import { useEffect, useRef, useState } from 'react';

import { Button, Icon, PageHeader, StatusPill, useV2Controller } from '../components.js';
import { ContentCopyGenerationControl } from '../content-copy-generation-control.js';
import { type V2Session, withPersistedContentPackages } from '../mock-provider.js';
import { ProviderActionControl } from '../provider-action-control.js';

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

function displayGeneratedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.UTC(1970, 0, 2)) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function ContentPage(): React.JSX.Element {
  const { navigate, notify, session, setSession, setUi, ui } = useV2Controller();
  const { activeContentId: activeId, contentSelectedIds: selectedIds } = ui;
  const active = session.content.find(({ id }) => id === activeId) ?? session.content[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exportId, setExportId] = useState('');
  const [queueQuery, setQueueQuery] = useState('');
  const [queueStatus, setQueueStatus] = useState<'ALL' | 'ATTENTION'>('ALL');
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
      if (bridge === undefined) return fail('本机内容桥接不可用，未批准任何内容包。');
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
  const selectedPlanItemIds =
    session.content.length === 0
      ? selectedIds
      : selectedPackages.map(({ candidateId }) => candidateId);
  const selectable = session.content.length === 0 ? generationCandidates : session.content;
  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length;
  const filteredSelectable = selectable.filter((item) => {
    const searchMatches = `${item.book}\n${item.title}`
      .toLocaleLowerCase('zh-CN')
      .includes(queueQuery.trim().toLocaleLowerCase('zh-CN'));
    const needsAttention = !['已确认', '已批准'].includes(item.status);
    return searchMatches && (queueStatus === 'ALL' || needsAttention);
  });
  const canPreviewGeneration = selectedPlanItemIds.length > 0;

  return (
    <div className="v2-page v2-content-page">
      <PageHeader
        actions={
          canPreviewGeneration ? (
            <ContentCopyGenerationControl
              onComplete={async () => {
                const refreshed = await window.rednoteV2?.readContentPackages({
                  weekKey: session.weekKey,
                });
                if (refreshed?.ok === true) applyWorkspace(refreshed.value);
              }}
              selectedPlanItemIds={selectedPlanItemIds}
              weekKey={session.weekKey}
            />
          ) : null
        }
        description="封面、文案、状态和检查信息同屏，但只保留一个主要任务。"
        eyebrow="内容工作台"
        title="把一份内容做成可确认的版本"
      />
      {error === '' ? null : (
        <div className="v2-form-error" ref={errorRef} role="alert" tabIndex={-1}>
          <Icon name="warning-circle" />
          <span>{error}</span>
        </div>
      )}
      <div className="v2-content-grid v2-content-canvas v2-content-workbench">
        <section
          aria-label="内容包列表"
          className="v2-card v2-package-list v2-content-queue v2-content-queue-rail"
        >
          <header>
            <span>
              <strong>内容队列</strong>
              <small>
                {session.content.length === 0
                  ? `${selectable.length} 个锁定计划项`
                  : `${session.content.length} 个内容版本`}
              </small>
            </span>
            {selectable.length === 0 ? null : (
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
            )}
          </header>
          <div className="v2-content-queue-items">
            {filteredSelectable.map((item) => {
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
            {selectable.length === 0 ? (
              <div className="v2-content-queue-empty">
                <Icon name="calendar-blank" size={24} />
                <strong>暂无锁定计划项</strong>
                <small>先在本周计划中锁定内容。</small>
              </div>
            ) : filteredSelectable.length === 0 ? (
              <div className="v2-content-queue-empty">
                <strong>没有匹配内容</strong>
                <small>调整筛选或搜索关键词。</small>
              </div>
            ) : null}
          </div>
          <footer className="v2-content-queue-tools">
            <label>
              <Icon name="magnifying-glass" size={15} />
              <input
                aria-label="搜索内容队列"
                onChange={(event) => setQueueQuery(event.target.value)}
                placeholder="搜索作品或标题"
                value={queueQuery}
              />
            </label>
            <div aria-label="内容筛选" className="v2-segmented" role="group">
              <button
                aria-pressed={queueStatus === 'ALL'}
                onClick={() => setQueueStatus('ALL')}
                type="button"
              >
                全部
              </button>
              <button
                aria-pressed={queueStatus === 'ATTENTION'}
                onClick={() => setQueueStatus('ATTENTION')}
                type="button"
              >
                待处理
              </button>
            </div>
          </footer>
        </section>
        {active === undefined ? (
          <section
            aria-label="尚未生成内容"
            className="v2-card v2-package-detail v2-content-empty-stage"
          >
            <div className="v2-content-empty-copy">
              <div className="v2-content-empty-icon">
                <Icon name="file-text" size={34} />
              </div>
              <p className="v2-kicker">编辑工作区</p>
              {generationCandidates.length > 0 ? (
                <>
                  <h2>选择一项内容开始编辑</h2>
                  <p>选择后可检查封面、文案、版本状态和建议发布时间。</p>
                  <p className="v2-content-empty-note">当前没有发起模型请求，也不会产生费用。</p>
                </>
              ) : (
                <>
                  <h2>尚无可编辑内容</h2>
                  <p>先在本周计划中锁定内容，再返回这里生成版本。</p>
                  <Button
                    icon="calendar-blank"
                    onClick={() => navigate('weekly-plan')}
                    tone="primary"
                  >
                    前往本周计划
                  </Button>
                  <p className="v2-content-empty-note">
                    此按钮只切换页面，不会调用模型或产生费用。
                  </p>
                </>
              )}
            </div>
          </section>
        ) : (
          <section
            aria-label={`${active.book} 内容包`}
            className="v2-card v2-package-detail v2-content-stage v2-content-editor-stage"
          >
            <div className="v2-package-grid v2-content-editor-grid">
              <div className="v2-content-cover-column">
                <figure className="v2-content-cover-stage">
                  <img alt={active.coverAlt} src={active.cover} />
                  <figcaption>
                    <Icon name="image-square" size={16} />
                    封面 ·{' '}
                    {active.provenance.coverSource === 'GENERATED_IMAGE'
                      ? '模型生成版本'
                      : active.provenance.copyModelRunId === null
                        ? '历史版本'
                        : '待补封面'}
                  </figcaption>
                </figure>
                <ProviderActionControl
                  intent={{
                    expectedRevision: active.revision,
                    expectedVersionId: active.versionId,
                    kind: 'CONTENT_COVER',
                    packageId: active.id,
                    weekKey: active.weekKey,
                  }}
                  label="生成或重新生成封面"
                  onSuccess={async () => {
                    const result = await window.rednoteV2?.readContentPackages({
                      weekKey: active.weekKey,
                    });
                    if (result?.ok === true) applyWorkspace(result.value);
                  }}
                  presentation="dialog"
                />
              </div>
              <div className="v2-package-fields">
                <div className="v2-content-editor-heading">
                  <p className="v2-kicker">{active.book}</p>
                  <h2>{active.title}</h2>
                  <div className="v2-content-version-line">
                    <StatusPill status={active.status} />
                    <small>
                      v{active.version} · revision {active.revision}
                    </small>
                  </div>
                  <small className="v2-content-provenance">
                    文案 {active.provenance.copyModelId ?? '历史版本'} · 封面{' '}
                    {active.provenance.coverModelId ?? '历史版本'} ·{' '}
                    {displayGeneratedAt(active.provenance.generatedAt)}
                  </small>
                </div>
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
                <div className="v2-content-save-row">
                  <Button disabled={busy} icon="pencil-simple" onClick={save} tone="primary">
                    保存新版本
                  </Button>
                  <Button disabled={busy} icon="check" onClick={() => approve([active.id])}>
                    提交审批
                  </Button>
                </div>
              </div>
            </div>
            <details className="v2-content-generation-check">
              <summary>生成检查：模型、能力、费用与外部工具</summary>
              <p>
                文案模型 {active.provenance.copyModelId ?? '历史版本'}；封面模型{' '}
                {active.provenance.coverModelId ?? '历史版本'}。Search / Fetch
                保持关闭，每次操作均先预览再确认。
              </p>
            </details>
          </section>
        )}
        <aside
          aria-label="版本检查器"
          className="v2-card v2-content-inspector v2-workspace-inspector"
        >
          <p className="v2-kicker">版本检查器</p>
          <h2>
            {active === undefined
              ? generationCandidates.length === 0
                ? '尚无可检查版本'
                : '等待选择内容'
              : `v${active.version} · ${active.status}`}
          </h2>
          <dl className="v2-facts">
            <div>
              <dt>封面</dt>
              <dd>{active === undefined ? '—' : active.coverAlt === '' ? '待补充' : '已关联'}</dd>
            </div>
            <div>
              <dt>文案</dt>
              <dd>
                {active === undefined ? '未关联' : draft.body.trim() === '' ? '待补充' : '已保存'}
              </dd>
            </div>
            <div>
              <dt>标签</dt>
              <dd>
                {active === undefined
                  ? '未关联'
                  : active.tags.length > 0
                    ? `${active.tags.length} 个`
                    : '待补充'}
              </dd>
            </div>
            <div>
              <dt>剧透警告</dt>
              <dd>{active === undefined ? '等待内容' : '随正文人工检查'}</dd>
            </div>
            <div>
              <dt>建议时间</dt>
              <dd>{active === undefined ? '—' : active.time}</dd>
            </div>
          </dl>
          <div className="v2-content-history">
            <strong>历史版本</strong>
            <small>
              {active === undefined
                ? '等待选择内容后显示。'
                : `当前 v${active.version}，保存修改将追加新版本。`}
            </small>
          </div>
          {active === undefined ? null : (
            <div className="v2-content-inspector-actions">
              <Button
                disabled={busy}
                icon="check"
                onClick={() => approve([active.id])}
                tone="primary"
              >
                批准当前版本
              </Button>
              {selectedPackages.length > 1 ? (
                <Button disabled={busy} icon="check" onClick={() => approve(selectedIds)}>
                  {window.rednoteV2 === undefined ? '批量通过' : '批量批准'} (
                  {selectedPackages.length})
                </Button>
              ) : null}
              <Button
                disabled={busy || selectedPackages.length === 0}
                icon="export"
                onClick={exportSelected}
              >
                导出所选
              </Button>
              {exportId === '' ? null : (
                <Button disabled={busy} icon="export" onClick={openExport}>
                  打开导出目录
                </Button>
              )}
            </div>
          )}
          <p className="v2-manual-note">保存后仍需人工批准；导出不会自动发布到平台。</p>
        </aside>
      </div>
    </div>
  );
}
