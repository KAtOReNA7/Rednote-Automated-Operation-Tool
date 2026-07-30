import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  BriefListView,
  ContentDraftPayloadV1,
  CopyActionPreview,
  CopyDraftDetailView,
  CopyDraftListView,
  CopyRewriteScopeV1,
  PreviewCopyActionInput,
} from '@mystery-operations/shared';

const PAGE_SIZE = 12;
const STATUS_LABELS: Readonly<Record<string, string>> = {
  ARCHIVED: '已归档',
  MANUAL_DRAFT: '手工草稿',
  MODEL_CANDIDATE: '模型候选',
  READY_FOR_QUALITY_PIPELINE: '待质量检查',
  STALE: '依赖已变化',
  STRUCTURE_INVALID: '结构待修正',
  SUPERSEDED: '已有后续版本',
};

function executionId(): string {
  return `copy-execution-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function lineage(payload: ContentDraftPayloadV1) {
  return Object.freeze([
    Object.freeze({
      argumentId: null,
      briefFieldPath: 'coreJudgment',
      evidenceRefIds: Object.freeze([]),
      experienceAssertionId: null,
      inputHash: payload.brief.briefInputHash,
      provenance: 'USER_EDITED' as const,
      structureSlotId: null,
      workId: payload.brief.workIds[0] ?? null,
    }),
  ]);
}

function titleText(payload: ContentDraftPayloadV1): string {
  return payload.titles.find(({ titleId }) => titleId === payload.selectedTitleId)?.text ?? '';
}

function withTitle(payload: ContentDraftPayloadV1, text: string): ContentDraftPayloadV1 {
  const selectedId = payload.selectedTitleId ?? 'manual-title-1';
  const selected = {
    kind: 'SELECTED' as const,
    lineage: lineage(payload),
    provenance: 'USER_EDITED' as const,
    text,
    titleId: selectedId,
  };
  return {
    ...payload,
    selectedTitleId: selectedId,
    titles: payload.titles.some(({ titleId }) => titleId === selectedId)
      ? payload.titles.map((title) => (title.titleId === selectedId ? selected : title))
      : [selected, ...payload.titles.map((title) => ({ ...title, kind: 'VARIANT' as const }))],
  };
}

function withTags(payload: ContentDraftPayloadV1, value: string): ContentDraftPayloadV1 {
  const seen = new Set<string>();
  const tags = value
    .split(/[,，\n]/u)
    .map((tag) => tag.replace(/^#+/u, '').trim().normalize('NFC'))
    .filter((tag) => {
      const key = tag.toLocaleLowerCase('zh-CN');
      if (tag.length === 0 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10)
    .map((tag, index) => ({
      lineage: lineage(payload),
      provenance: 'USER_EDITED' as const,
      tagId: `manual-tag-${index + 1}`,
      text: tag,
    }));
  return { ...payload, tags };
}

export function CopyWorkbench(): React.JSX.Element {
  const [briefs, setBriefs] = useState<BriefListView['items']>([]);
  const [briefId, setBriefId] = useState('');
  const [workspace, setWorkspace] = useState<CopyDraftListView | null>(null);
  const [detail, setDetail] = useState<CopyDraftDetailView | null>(null);
  const [draft, setDraft] = useState<ContentDraftPayloadV1 | null>(null);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CopyDraftListView['items'][number]['status'] | null>(null);
  const [preview, setPreview] = useState<CopyActionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('正在读取本地文案 Draft…');
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [rewriteKind, setRewriteKind] = useState<CopyRewriteScopeV1['kind']>('SELECTED_TITLE');
  const [rewriteBlockId, setRewriteBlockId] = useState('');

  const loadList = useCallback(async () => {
    const method = window.rednoteDesktop?.getCopyDrafts;
    if (method === undefined) return;
    const result = await method({
      briefId: null,
      limit: PAGE_SIZE,
      offset,
      profileId: null,
      query,
      state: null,
      status,
    });
    if (!result.ok) {
      setMessage(`读取 Draft 失败：${result.error.code}`);
      return;
    }
    setWorkspace(result.value);
    setMessage(
      result.value.total === 0
        ? '尚无文案 Draft；可从 READY Content Brief 建立手工 scaffold。'
        : `已加载 ${result.value.total} 个版本化 Draft。`,
    );
  }, [offset, query, status]);

  const loadBriefs = useCallback(async () => {
    const method = window.rednoteDesktop?.getBriefs;
    if (method === undefined) return;
    const result = await method({
      limit: 100,
      offset: 0,
      profileId: null,
      query: '',
      readiness: 'READY_FOR_DRAFT_GENERATION',
      state: 'ACTIVE',
    });
    if (!result.ok) return;
    const ready = result.value.items.filter(
      (item) => item.readiness === 'READY_FOR_DRAFT_GENERATION' && !item.stale,
    );
    setBriefs(ready);
    setBriefId((current) => current || ready[0]?.briefId || '');
  }, []);

  const loadDetail = useCallback(async (draftId: string) => {
    const method = window.rednoteDesktop?.getCopyDraft;
    if (method === undefined) return;
    const result = await method({
      draftId,
      runLimit: 20,
      runOffset: 0,
      versionLimit: 20,
      versionOffset: 0,
    });
    if (!result.ok) {
      setMessage(`读取 Draft 详情失败：${result.error.code}`);
      return;
    }
    setDetail(result.value);
    setDraft(result.value.payload);
    setRewriteBlockId(result.value.payload.blocks[0]?.blockId ?? '');
    setPreview(null);
  }, []);

  useEffect(() => {
    void loadBriefs();
  }, [loadBriefs]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const issuePreview = useCallback(async (input: PreviewCopyActionInput) => {
    const method = window.rednoteDesktop?.previewCopyAction;
    if (method === undefined) return;
    setBusy(true);
    try {
      const result = await method(input);
      if (!result.ok) {
        setMessage(`预览被拒绝：${result.error.code}`);
        return;
      }
      setPreview(result.value);
      setMessage('预览已绑定当前窗口、revision、输入 hash 与短期单次令牌；尚未执行。');
    } finally {
      setBusy(false);
    }
  }, []);

  const confirm = useCallback(async () => {
    if (preview === null) return;
    const method = window.rednoteDesktop?.confirmCopyAction;
    if (method === undefined) return;
    const mutation = preview.kind === 'PREVIEW_GENERATION' || preview.kind === 'PREVIEW_REWRITE';
    setBusy(true);
    try {
      const result = await method({
        confirmation: 'APPLY_COPY_ACTION',
        executionId: mutation ? executionId() : null,
        kind: preview.kind,
        previewHash: preview.previewHash,
        token: preview.token,
      });
      if (!result.ok) {
        setMessage(`确认失败：${result.error.code}`);
        return;
      }
      setPreview(null);
      if ('detail' in result.value) {
        setDetail(result.value.detail);
        setDraft(result.value.detail.payload);
      }
      setMessage(mutation ? 'mutation 已进入本地队列。' : '已保存新的不可变 DraftVersion。');
      await loadList();
    } finally {
      setBusy(false);
    }
  }, [loadList, preview]);

  const dirty = useMemo(
    () =>
      detail !== null && draft !== null && JSON.stringify(detail.payload) !== JSON.stringify(draft),
    [detail, draft],
  );

  const rewriteScope = useMemo<CopyRewriteScopeV1>(() => {
    if (rewriteKind === 'BODY_BLOCK' || rewriteKind === 'BODY_BLOCK_RANGE') {
      return {
        blockIds: rewriteBlockId ? [rewriteBlockId] : [],
        kind: rewriteKind,
        warningField: null,
      };
    }
    if (rewriteKind === 'SPOILER_WARNING_ARTIFACT') {
      return {
        blockIds: [],
        kind: rewriteKind,
        warningField: 'bodyOpeningWarningText',
      };
    }
    return { blockIds: [], kind: rewriteKind, warningField: null };
  }, [rewriteBlockId, rewriteKind]);

  return (
    <section className="copy-workbench" aria-labelledby="copy-workbench-title">
      <header className="copy-workbench__hero">
        <div>
          <p className="section-kicker">M3 · Versioned Copy V1</p>
          <h2 id="copy-workbench-title">文案工作台</h2>
          <p>
            标题、正文块、标签、置顶评论与实际剧透警告都以不可变版本保存。生成文案只会进入“待质量检查”，
            不等于已通过质量检查、可导出或可发布。
          </p>
        </div>
        <div className="copy-workbench__metrics">
          <span>
            <strong>{workspace?.total ?? 0}</strong> Draft
          </span>
          <span>
            <strong>{workspace?.counts.READY_FOR_QUALITY_PIPELINE ?? 0}</strong> 待质量检查
          </span>
          <span>
            <strong>{workspace?.counts.STALE ?? 0}</strong> stale
          </span>
        </div>
      </header>

      <div className="copy-boundaries">
        <strong>仍需后续检查</strong>
        <span>事实、真实性、剧透、重复度与标题正文一致性尚未检查。</span>
        <span>局部重写不会修改选择范围以外或已锁定的字段。</span>
        <span>公开资料整理或资料分析评分不是个人体验。</span>
        <span>完整剧透允许，但警告文本必须齐全。</span>
        <span>实验绑定不代表实验已有结果；最终发布始终由用户手动完成。</span>
      </div>

      <div className="copy-create-row">
        <label>
          <span>从 READY Brief 建立手工 scaffold</span>
          <select onChange={(event) => setBriefId(event.target.value)} value={briefId}>
            <option value="">选择 Content Brief</option>
            {briefs.map((brief) => (
              <option key={brief.briefId} value={brief.briefId}>
                {brief.profileId} · v{brief.versionNumber}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || briefId === ''}
          onClick={() => void issuePreview({ briefId, kind: 'CREATE_MANUAL_SCAFFOLD' })}
          type="button"
        >
          预览手工 Draft
        </button>
      </div>

      <div className="copy-workbench__layout">
        <aside className="copy-list">
          <div className="copy-toolbar">
            <input
              onChange={(event) => {
                setOffset(0);
                setQuery(event.target.value);
              }}
              placeholder="查找 Draft"
              value={query}
            />
            <select
              onChange={(event) => {
                setOffset(0);
                setStatus(
                  event.target.value === ''
                    ? null
                    : (event.target.value as CopyDraftListView['items'][number]['status']),
                );
              }}
              value={status ?? ''}
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <ol>
            {workspace?.items.map((item) => (
              <li key={item.draftId}>
                <button
                  className={detail?.draftId === item.draftId ? 'is-current' : ''}
                  onClick={() => void loadDetail(item.draftId)}
                  type="button"
                >
                  <strong>{STATUS_LABELS[item.status] ?? item.status}</strong>
                  <span>{item.profileId}</span>
                  <small>
                    v{item.versionNumber} · r{item.revision}
                  </small>
                </button>
              </li>
            ))}
          </ol>
          <div className="brief-pagination">
            <button
              disabled={offset === 0}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              type="button"
            >
              上一页
            </button>
            <span>{workspace?.total ?? 0}</span>
            <button
              disabled={
                workspace === null || workspace.offset + workspace.items.length >= workspace.total
              }
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              type="button"
            >
              下一页
            </button>
          </div>
        </aside>

        <main className="copy-editor">
          {detail === null || draft === null ? (
            <div className="brief-empty-state">
              <strong>选择一个 Draft</strong>
              <span>也可以先从 READY Brief 建立完全本地的手工 scaffold。</span>
            </div>
          ) : (
            <>
              <header className="copy-editor__status">
                <div>
                  <strong>{STATUS_LABELS[detail.status] ?? detail.status}</strong>
                  <h3>
                    Draft v{detail.versionNumber} · revision {detail.revision}
                  </h3>
                  <small>
                    Brief {detail.briefId} · {draft.profileId}
                  </small>
                </div>
                <div>
                  <button
                    disabled={busy || detail.state === 'ARCHIVED'}
                    onClick={() =>
                      void issuePreview({
                        draftId: detail.draftId,
                        expectedRevision: detail.revision,
                        kind: 'PREVIEW_GENERATION',
                      })
                    }
                    type="button"
                  >
                    预览完整生成
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void issuePreview({
                        draftId: detail.draftId,
                        expectedRevision: detail.revision,
                        kind: detail.state === 'ARCHIVED' ? 'RESTORE' : 'ARCHIVE',
                      })
                    }
                    type="button"
                  >
                    {detail.state === 'ARCHIVED' ? '预览恢复' : '预览归档'}
                  </button>
                </div>
              </header>

              <label className="copy-field">
                <span>选中标题</span>
                <input
                  onChange={(event) => setDraft(withTitle(draft, event.target.value))}
                  value={titleText(draft)}
                />
              </label>
              <div className="copy-field">
                <span>正文块（稳定 ID 与有序结构）</span>
                {draft.blocks.map((block, index) => (
                  <label key={block.blockId}>
                    <small>
                      {index + 1}. {block.kind} · {block.blockId}
                    </small>
                    <textarea
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          blocks: draft.blocks.map((current) =>
                            current.blockId === block.blockId
                              ? { ...current, provenance: 'USER_EDITED', text: event.target.value }
                              : current,
                          ),
                        })
                      }
                      rows={4}
                      value={block.text}
                    />
                  </label>
                ))}
              </div>
              <label className="copy-field">
                <span>标签（逗号分隔，自动 NFC 规范化、去 # 与去重）</span>
                <input
                  onChange={(event) => setDraft(withTags(draft, event.target.value))}
                  value={draft.tags.map(({ text }) => text).join('，')}
                />
              </label>
              <label className="copy-field">
                <span>置顶评论</span>
                <textarea
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      pinnedComment: {
                        lineage: lineage(draft),
                        provenance: 'USER_EDITED',
                        text: event.target.value,
                      },
                    })
                  }
                  rows={3}
                  value={draft.pinnedComment?.text ?? ''}
                />
              </label>

              <fieldset className="copy-warning-grid">
                <legend>剧透警告文本 artifacts（不生成图片）</legend>
                {(
                  [
                    ['coverWarningText', '封面警告'],
                    ['titleWarningMarker', '标题标记'],
                    ['bodyOpeningWarningText', '正文开头警告'],
                    ['pinnedCommentWarningText', '置顶评论警告'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field}>
                    <span>{label}</span>
                    <input
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          spoilerWarnings: {
                            ...draft.spoilerWarnings,
                            [field]: event.target.value || null,
                            provenance: 'USER_EDITED',
                          },
                        })
                      }
                      value={draft.spoilerWarnings[field] ?? ''}
                    />
                  </label>
                ))}
              </fieldset>

              <section className="copy-lineage-card">
                <strong>Brief lineage 与权限快照</strong>
                <span>
                  evidence {draft.brief.allowedEvidenceRefIds.length} · R2 assertions{' '}
                  {draft.brief.allowedExperienceAssertionIds.length} · expression{' '}
                  {draft.brief.expressionPolicy.mode} · score {draft.brief.scorePlan.kind}
                </span>
                <span>
                  public labels：{draft.brief.requiredPublicLabels.join(' / ') || '无'} ·
                  experiment：
                  {draft.brief.experimentBinding === null ? '未绑定' : '已绑定（不代表已有结果）'}
                </span>
              </section>

              <section className="copy-lock-card">
                <strong>字段 provenance / lock</strong>
                <div>
                  {draft.fieldStates
                    .filter(({ path }) =>
                      ['selectedTitle', 'tags', 'pinnedComment', 'spoilerWarnings'].includes(path),
                    )
                    .map((field) => (
                      <button
                        disabled={busy || field.lock === 'SYSTEM_LOCKED'}
                        key={field.path}
                        onClick={() =>
                          void issuePreview({
                            draftId: detail.draftId,
                            expectedRevision: detail.revision,
                            fieldPath: field.path,
                            kind: field.lock === 'USER_LOCKED' ? 'UNLOCK_FIELD' : 'LOCK_FIELD',
                          })
                        }
                        type="button"
                      >
                        {field.path} · {field.provenance} · {field.lock}
                      </button>
                    ))}
                </div>
              </section>

              <div className="copy-save-row">
                <button
                  disabled={!dirty || busy || detail.state === 'ARCHIVED'}
                  onClick={() =>
                    void issuePreview({
                      draftId: detail.draftId,
                      expectedRevision: detail.revision,
                      kind: 'SAVE_VERSION',
                      payload: draft,
                    })
                  }
                  type="button"
                >
                  预览保存新版本
                </button>
                <span>
                  {detail.validation.valid
                    ? '结构完整；仍只可进入待质量检查。'
                    : `结构待修正：${detail.validation.reasonCodes.join('、')}`}
                </span>
              </div>

              <section className="copy-rewrite-card">
                <strong>有限局部重写</strong>
                <div className="copy-rewrite-grid">
                  <select
                    onChange={(event) =>
                      setRewriteKind(event.target.value as CopyRewriteScopeV1['kind'])
                    }
                    value={rewriteKind}
                  >
                    <option value="SELECTED_TITLE">选中标题</option>
                    <option value="TITLE_VARIANTS">标题备选</option>
                    <option value="BODY_BLOCK">单个正文块</option>
                    <option value="TAG_SET">标签组</option>
                    <option value="PINNED_COMMENT">置顶评论</option>
                    <option value="SPOILER_WARNING_ARTIFACT">正文开头剧透警告</option>
                  </select>
                  {rewriteKind === 'BODY_BLOCK' ? (
                    <select
                      onChange={(event) => setRewriteBlockId(event.target.value)}
                      value={rewriteBlockId}
                    >
                      {draft.blocks.map((block) => (
                        <option key={block.blockId} value={block.blockId}>
                          {block.blockId} · {block.kind}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    onChange={(event) => setRewriteInstruction(event.target.value)}
                    placeholder="有限重写方向"
                    value={rewriteInstruction}
                  />
                  <button
                    disabled={busy || rewriteInstruction.trim() === ''}
                    onClick={() =>
                      void issuePreview({
                        draftId: detail.draftId,
                        expectedRevision: detail.revision,
                        instruction: rewriteInstruction,
                        kind: 'PREVIEW_REWRITE',
                        scope: rewriteScope,
                      })
                    }
                    type="button"
                  >
                    预览局部重写
                  </button>
                </div>
              </section>

              <div className="copy-history-grid">
                <section>
                  <strong>不可变版本</strong>
                  <ol>
                    {detail.versionHistory.items.map((version) => (
                      <li key={version.versionId}>
                        <span>
                          v{version.versionNumber} · {version.sourceKind} ·{' '}
                          {STATUS_LABELS[version.status] ?? version.status}
                        </span>
                        {!version.isCurrent && detail.state === 'ACTIVE' ? (
                          <button
                            onClick={() =>
                              void issuePreview({
                                draftId: detail.draftId,
                                expectedRevision: detail.revision,
                                kind: 'UNDO',
                                targetVersionId: version.versionId,
                              })
                            }
                            type="button"
                          >
                            预览 undo
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
                <section>
                  <strong>生成 / 重写历史</strong>
                  <ol>
                    {detail.runs.map((run) => (
                      <li key={run.runId}>
                        <span>
                          {run.status} · request {run.externalRequestCount}/1 · cost {run.costState}
                        </span>
                        {['CONFIRMED', 'QUEUED', 'PAUSED', 'RUNNING'].includes(run.status) ? (
                          <button
                            onClick={() =>
                              void issuePreview({ kind: 'CANCEL_MUTATION', runId: run.runId })
                            }
                            type="button"
                          >
                            预览取消
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </>
          )}
        </main>
      </div>

      {preview === null ? null : (
        <section className="copy-confirmation">
          <div>
            <strong>二次确认：{preview.kind}</strong>
            <span>expires {preview.expiresAt}</span>
            {'maximums' in preview.preview ? (
              <small>
                request ≤ {preview.preview.maximums.modelRequests} · capability{' '}
                {preview.preview.capabilityState} · budget {preview.preview.budgetState}
              </small>
            ) : null}
          </div>
          <button disabled={busy} onClick={() => void confirm()} type="button">
            明确确认
          </button>
          <button disabled={busy} onClick={() => setPreview(null)} type="button">
            取消预览
          </button>
        </section>
      )}

      <footer className="brief-status-line">
        <span>{message}</span>
        <span>READY_FOR_QUALITY_PIPELINE ≠ 可发布</span>
      </footer>
    </section>
  );
}
