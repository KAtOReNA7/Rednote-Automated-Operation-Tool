import { useMemo, useState } from 'react';

import type { MetricWindow } from '@mystery-operations/v2';

import type {
  RuntimeView,
  WebAiPreview,
  WebAiResult,
  WebDeletePreview,
  WebImportPreview,
  WebWorkspaceRuntime,
} from './runtime.js';
import {
  WebButton as Button,
  WebPageHeader as PageHeader,
  webSafeErrorMessage,
  WebStatusPill as StatusPill,
} from './ui.js';
import type { WebInteractionKind } from './w2-state.js';

const INTERACTION_STATUS_LABEL = Object.freeze({
  CONFIRMED: '已确认',
  DELETED: '已删除',
  MANUAL_SENT: '已记录手工发送',
  NEW: '待处理',
  SKIPPED: '已跳过',
  SUGGESTED: '待确认建议',
});

const CAPABILITY_LABEL = Object.freeze({
  STALE: '已过期，需重新确认',
  SUPPORTED: '已确认支持',
  UNKNOWN: '尚未确认',
  UNSUPPORTED: '不支持',
});

function errorMessage(error: unknown): string {
  return webSafeErrorMessage(error);
}

export function AiPreviewCard({
  onConfirm,
  preview,
}: {
  readonly onConfirm: () => void;
  readonly preview: WebAiPreview;
}): React.JSX.Element {
  return (
    <section className="web-preview" aria-label="AI 调用预览">
      <strong>{preview.canConfirm ? '调用预览已就绪' : '调用被本地条件阻止'}</strong>
      <small>
        模型 {preview.modelId ?? '未配置'} · 最多 1 次请求 · Search 关闭 · Fetch 关闭 · 费用上界{' '}
        {preview.estimatedCostMicrounits === null
          ? '未知'
          : `${preview.estimatedCostMicrounits} 微单位`}
      </small>
      {preview.blockers.length === 0 ? null : (
        <ul>
          {preview.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      <Button disabled={!preview.canConfirm} onClick={onConfirm} tone="primary">
        确认并执行一次
      </Button>
    </section>
  );
}

export function InteractionPage({
  runtime,
  view,
}: {
  readonly runtime: WebWorkspaceRuntime;
  readonly view: RuntimeView;
}): React.JSX.Element {
  const visible = view.state.interactions.filter((item) => item.status !== 'DELETED');
  const [activeId, setActiveId] = useState(visible[0]?.itemId ?? '');
  const active = visible.find((item) => item.itemId === activeId) ?? visible[0] ?? null;
  const [kind, setKind] = useState<WebInteractionKind>('COMMENT');
  const [relatedId, setRelatedId] = useState('');
  const [userText, setUserText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [preview, setPreview] = useState<WebAiPreview | null>(null);
  const [result, setResult] = useState<WebAiResult | null>(null);
  const [deletePreview, setDeletePreview] = useState<WebDeletePreview | null>(null);
  const [status, setStatus] = useState('');
  const packages = Object.values(view.state.contentByWeek).flatMap(
    (workspace) => workspace.packages,
  );
  const run = async (operation: () => Promise<void>, success: string): Promise<void> => {
    try {
      await operation();
      setStatus(success);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  const create = async (): Promise<void> => {
    try {
      const created = await runtime.createInteraction({
        kind,
        relatedContentPackageId: relatedId === '' ? null : relatedId,
        userText,
      });
      setActiveId(created.itemId);
      setUserText('');
      setStatus(created.duplicate ? '相同互动已存在，未重复写入。' : '互动已保存到本地工作区。');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  const previewReply = async (): Promise<void> => {
    if (active === null) return;
    try {
      setPreview(await runtime.previewProviderAction('REPLY_SUGGESTION', active.itemId));
      setResult(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  const executeReply = async (): Promise<void> => {
    if (preview === null) return;
    try {
      const next = await runtime.executeProviderAction(preview.token);
      setResult(next);
      setReplyText(next.text);
      setPreview(null);
      setStatus('模型回复仅在页面中预览；尚未保存，也不会自动发送。');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  return (
    <div className="web-page">
      <PageHeader
        eyebrow={`${visible.length} 条本地互动 · 不自动发送`}
        title="互动"
        description="导入评论或私信后，本地编辑、确认并手工记录发送；产品不存在平台写入路径。"
      />
      <section className="v2-card web-import-strip">
        <label className="v2-field">
          <span>类型</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as WebInteractionKind)}
          >
            <option value="COMMENT">评论</option>
            <option value="DIRECT_MESSAGE">私信</option>
          </select>
        </label>
        <label className="v2-field">
          <span>关联内容包（可不关联）</span>
          <select value={relatedId} onChange={(event) => setRelatedId(event.target.value)}>
            <option value="">不关联</option>
            {packages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.versions.at(-1)?.fields.title}
              </option>
            ))}
          </select>
        </label>
        <label className="v2-field web-grow">
          <span>评论或私信原文</span>
          <input value={userText} onChange={(event) => setUserText(event.target.value)} />
        </label>
        <Button disabled={userText.trim() === ''} onClick={() => void create()} tone="primary">
          保存本地互动
        </Button>
      </section>
      {active === null ? (
        <section className="v2-card web-empty">
          <h2>尚无互动</h2>
          <p>上方录入只保存到本地目录，不会访问或操作平台。</p>
        </section>
      ) : (
        <div className="web-three-column">
          <section className="v2-card web-list-rail">
            <h2>收件箱</h2>
            {visible.map((item) => (
              <button
                aria-pressed={item.itemId === active.itemId}
                key={item.itemId}
                onClick={() => {
                  setActiveId(item.itemId);
                  setPreview(null);
                  setResult(null);
                  setDeletePreview(null);
                }}
                type="button"
              >
                <strong>{item.kind === 'COMMENT' ? '评论' : '私信'}</strong>
                <span>{item.userText}</span>
                <StatusPill status={INTERACTION_STATUS_LABEL[item.status]} />
              </button>
            ))}
          </section>
          <section className="v2-card web-work-area">
            <p className="v2-kicker">原始消息</p>
            <blockquote>{active.userText}</blockquote>
            <label className="v2-field">
              <span>回复建议</span>
              <textarea
                rows={8}
                value={replyText || active.replies.at(-1)?.text || ''}
                onChange={(event) => setReplyText(event.target.value)}
              />
            </label>
            <div className="web-action-row">
              <Button onClick={() => void previewReply()}>预览 AI 回复</Button>
              <Button
                disabled={replyText.trim() === ''}
                onClick={() =>
                  void run(
                    () => runtime.saveManualReply(active.itemId, active.revision, replyText),
                    '已追加人工回复版本。',
                  )
                }
              >
                保存人工版本
              </Button>
              <Button
                disabled={result === null}
                onClick={() =>
                  void run(async () => {
                    if (result !== null) await runtime.saveReplyResult(result, active.revision);
                    setResult(null);
                  }, '模型建议已保存为新版本。')
                }
                tone="primary"
              >
                保存模型建议
              </Button>
            </div>
            {preview === null ? null : (
              <AiPreviewCard onConfirm={() => void executeReply()} preview={preview} />
            )}
          </section>
          <aside className="v2-card web-inspector">
            <h2>处理状态</h2>
            <dl className="v2-facts">
              <div>
                <dt>状态</dt>
                <dd>{INTERACTION_STATUS_LABEL[active.status]}</dd>
              </div>
              <div>
                <dt>回复版本</dt>
                <dd>{active.replies.length}</dd>
              </div>
              <div>
                <dt>关联内容</dt>
                <dd>{active.relatedContentPackageId ?? '未关联'}</dd>
              </div>
            </dl>
            <div className="web-action-stack">
              <Button
                disabled={active.status !== 'SUGGESTED'}
                onClick={() =>
                  void run(
                    () =>
                      runtime.confirmInteractions([
                        {
                          expectedRevision: active.revision,
                          expectedVersionId: active.currentSuggestionVersionId ?? '',
                          itemId: active.itemId,
                        },
                      ]),
                    '建议已确认，仍不会自动发送。',
                  )
                }
                tone="primary"
              >
                确认当前建议
              </Button>
              <Button
                disabled={!visible.some((item) => item.status === 'SUGGESTED')}
                onClick={() =>
                  void run(
                    () =>
                      runtime.confirmInteractions(
                        visible
                          .filter((item) => item.status === 'SUGGESTED')
                          .map((item) => ({
                            expectedRevision: item.revision,
                            expectedVersionId: item.currentSuggestionVersionId ?? '',
                            itemId: item.itemId,
                          })),
                      ),
                    '当前所有待确认建议已批量确认，仍不会自动发送。',
                  )
                }
              >
                批量确认待处理建议
              </Button>
              <Button
                disabled={active.status !== 'CONFIRMED'}
                onClick={() =>
                  void run(
                    () =>
                      runtime.transitionInteraction(
                        active.itemId,
                        active.revision,
                        'MARK_MANUAL_SENT',
                      ),
                    '已记录由用户在官方客户端手工发送。',
                  )
                }
              >
                记录手工发送
              </Button>
              <Button
                disabled={active.status !== 'MANUAL_SENT'}
                onClick={() =>
                  void run(
                    () =>
                      runtime.transitionInteraction(
                        active.itemId,
                        active.revision,
                        'UNDO_MANUAL_SENT',
                      ),
                    '已撤销手工发送记录；平台上的实际操作不会被改变。',
                  )
                }
              >
                撤销手工发送记录
              </Button>
              <Button
                disabled={!['NEW', 'SUGGESTED'].includes(active.status)}
                onClick={() =>
                  void run(
                    () => runtime.transitionInteraction(active.itemId, active.revision, 'SKIP'),
                    '已跳过。',
                  )
                }
              >
                跳过
              </Button>
              <Button
                disabled={active.status !== 'SKIPPED'}
                onClick={() =>
                  void run(
                    () => runtime.transitionInteraction(active.itemId, active.revision, 'REOPEN'),
                    '已重新打开。',
                  )
                }
              >
                重新打开
              </Button>
              <Button
                onClick={() => setDeletePreview(runtime.previewDeleteInteraction(active.itemId))}
              >
                预览删除
              </Button>
            </div>
            {deletePreview === null ? null : (
              <section className="web-preview" role="alert">
                <strong>确认从工作队列隐藏这条互动？</strong>
                <small>只写入可恢复的本地删除标记；不会操作平台或物理擦除历史快照。</small>
                <Button
                  onClick={() =>
                    void run(async () => {
                      await runtime.confirmDeleteInteraction(deletePreview.token);
                      setDeletePreview(null);
                    }, '互动已标记删除。')
                  }
                >
                  确认本地删除
                </Button>
              </section>
            )}
          </aside>
        </div>
      )}
      <p className="web-live-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

export function LibraryPage({
  runtime,
  view,
}: {
  readonly runtime: WebWorkspaceRuntime;
  readonly view: RuntimeView;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [activeId, setActiveId] = useState(view.state.library[0]?.id ?? '');
  const [preview, setPreview] = useState<WebImportPreview | null>(null);
  const [status, setStatus] = useState('');
  const filtered = useMemo(
    () =>
      view.state.library.filter((item) =>
        `${item.title}\n${item.author ?? ''}\n${item.summary}`
          .toLocaleLowerCase('zh-CN')
          .includes(query.toLocaleLowerCase('zh-CN')),
      ),
    [query, view.state.library],
  );
  const shown = filtered.slice(page * 12, page * 12 + 12);
  const active = view.state.library.find((item) => item.id === activeId) ?? shown[0] ?? null;
  const chooseFile = async (file: File): Promise<void> => {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { format?: unknown };
      const kind = parsed.format === 'rednote-web-clip' ? 'CLIPPER' : 'CATALOG';
      setPreview(await runtime.previewLibraryImport(raw, kind));
      setStatus('导入预览已完成；确认前没有写入工作区。');
    } catch (error) {
      setPreview(null);
      setStatus(errorMessage(error));
    }
  };
  return (
    <div className="web-page">
      <PageHeader
        eyebrow={`${view.state.library.length} 条本地资料`}
        title="书库"
        description="导入严格版本化的 Catalog 或 Clipper 文件；搜索、分页和详情均来自工作区快照。"
        actions={
          <label className="v2-button v2-button--primary web-file-button">
            选择导入文件
            <input
              accept=".json,.rednote-clip.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void chooseFile(file);
              }}
              type="file"
            />
          </label>
        }
      />
      <section className="v2-card web-library-tools">
        <label className="v2-field">
          <span>搜索本地书库</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <span>{filtered.length} 条结果</span>
      </section>
      {preview === null ? null : (
        <section className="v2-card web-preview">
          <strong>{preview.sourceLabel}</strong>
          <small>
            {preview.itemCount} 项 · {preview.duplicateCount} 项已存在
          </small>
          <Button
            onClick={() =>
              void (async () => {
                try {
                  const result = await runtime.confirmLibraryImport(preview.token);
                  setPreview(null);
                  setStatus(`已导入 ${result.imported} 项。`);
                } catch (error) {
                  setStatus(errorMessage(error));
                }
              })()
            }
            tone="primary"
          >
            确认写入书库
          </Button>
        </section>
      )}
      {shown.length === 0 ? (
        <section className="v2-card web-empty">
          <h2>{query === '' ? '书库尚无资料' : '没有匹配结果'}</h2>
          <p>选择本地 Catalog JSON 或扩展导出的 .rednote-clip.json；选择文件不会自动写入。</p>
        </section>
      ) : (
        <div className="web-library-layout">
          <section className="web-library-grid">
            {shown.map((item) => (
              <button
                aria-pressed={item.id === active?.id}
                className="v2-card"
                key={item.id}
                onClick={() => setActiveId(item.id)}
                type="button"
              >
                <span className="web-cover-placeholder">本地资料</span>
                <strong>{item.title}</strong>
                <small>
                  {item.author ??
                    (item.sourceKind === 'CLIPPER' ? item.sourceOrigin : '作者未填写')}
                </small>
              </button>
            ))}
          </section>
          <aside className="v2-card web-inspector">
            <h2>{active?.title}</h2>
            <p>{active?.summary}</p>
            <dl className="v2-facts">
              <div>
                <dt>来源</dt>
                <dd>
                  {active?.sourceKind === 'CLIPPER'
                    ? active.sourceOrigin
                    : (active?.sourcePath ?? '本地 Catalog')}
                </dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>已保存</dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
      <div className="web-action-row">
        <Button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
          上一页
        </Button>
        <span>第 {page + 1} 页</span>
        <Button
          disabled={(page + 1) * 12 >= filtered.length}
          onClick={() => setPage((value) => value + 1)}
        >
          下一页
        </Button>
      </div>
      <p className="web-live-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

const EMPTY_METRIC = {
  collections: '0',
  comments: '0',
  likes: '0',
  newFollowers: '0',
  publishedAt: '',
  views: '0',
};

export function ReviewPage({
  runtime,
  view,
}: {
  readonly runtime: WebWorkspaceRuntime;
  readonly view: RuntimeView;
}): React.JSX.Element {
  const approved = Object.values(view.state.contentByWeek)
    .flatMap((workspace) => workspace.packages)
    .filter((item) => item.status === 'APPROVED');
  const [window, setWindow] = useState<MetricWindow>('7D');
  const [packageId, setPackageId] = useState(approved[0]?.id ?? '');
  const [draft, setDraft] = useState(EMPTY_METRIC);
  const [status, setStatus] = useState('');
  const review = runtime.metrics(window);
  const save = async (): Promise<void> => {
    try {
      const date = new Date(draft.publishedAt);
      date.setUTCSeconds(0, 0);
      await runtime.saveMetric({
        collections: Number(draft.collections),
        comments: Number(draft.comments),
        likes: Number(draft.likes),
        newFollowers: Number(draft.newFollowers),
        packageId,
        publishedAt: date.toISOString(),
        snapshotWindow: window,
        views: Number(draft.views),
      });
      setStatus(
        `已保存 1 条“${window === '7D' ? '发布后 7 天' : window === '72H' ? '发布后 72 小时' : '发布后 24 小时'}”数据。`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  return (
    <div className="web-page">
      <PageHeader
        eyebrow="真实本地指标 · 确定性复盘"
        title="数据复盘"
        description="仅为已审批内容录入发布数据；无数据时不显示模拟指标或趋势。"
        actions={
          <label className="v2-field web-window-select">
            <span>观察窗口</span>
            <select
              value={window}
              onChange={(event) => setWindow(event.target.value as MetricWindow)}
            >
              <option value="24H">发布后 24 小时</option>
              <option value="72H">发布后 72 小时</option>
              <option value="7D">发布后 7 天</option>
            </select>
          </label>
        }
      />
      {approved.length === 0 ? (
        <section className="v2-card web-empty">
          <h2>尚无已审批内容</h2>
          <p>先在内容页批准一个版本；该步骤不会调用模型或产生费用。</p>
        </section>
      ) : (
        <section className="v2-card web-metric-form">
          <label className="v2-field">
            <span>已审批内容</span>
            <select value={packageId} onChange={(event) => setPackageId(event.target.value)}>
              {approved.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.versions.at(-1)?.fields.title}
                </option>
              ))}
            </select>
          </label>
          <div className="web-metric-grid">
            <label className="v2-field">
              <span>发布时间</span>
              <input
                type="datetime-local"
                value={draft.publishedAt}
                onChange={(event) => setDraft({ ...draft, publishedAt: event.target.value })}
              />
            </label>
            {(['views', 'likes', 'collections', 'comments', 'newFollowers'] as const).map(
              (field) => (
                <label className="v2-field" key={field}>
                  <span>
                    {
                      {
                        views: '浏览量',
                        likes: '点赞数',
                        collections: '收藏数',
                        comments: '评论数',
                        newFollowers: '新增关注',
                      }[field]
                    }
                  </span>
                  <input
                    min="0"
                    placeholder="0"
                    step="1"
                    type="number"
                    value={draft[field]}
                    onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                  />
                </label>
              ),
            )}
          </div>
          <Button
            disabled={packageId === '' || draft.publishedAt === ''}
            onClick={() => void save()}
            tone="primary"
          >
            保存本页指标
          </Button>
        </section>
      )}
      <section className="web-kpi-grid">
        {Object.entries(review.totals).map(([key, value]) => (
          <article className="v2-card" key={key}>
            <span>
              {
                {
                  views: '浏览量',
                  likes: '点赞数',
                  collections: '收藏数',
                  comments: '评论数',
                  newFollowers: '新增关注',
                }[key as keyof typeof review.totals]
              }
            </span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="v2-card">
        <h2>策略建议</h2>
        {review.status === 'INSUFFICIENT_DATA' ? (
          <p>当前样本不足；至少需要 3 个内容包且每个浏览量不少于 100，系统不会虚构结论。</p>
        ) : (
          review.recommendations.map((item) => (
            <article className="web-recommendation" key={item.id}>
              <p>{item.text}</p>
              <div className="web-action-row">
                <Button onClick={() => void runtime.decideStrategy(review, 'ACCEPTED')}>
                  采纳
                </Button>
                <Button onClick={() => void runtime.decideStrategy(review, 'REJECTED')}>
                  拒绝
                </Button>
              </div>
            </article>
          ))
        )}
      </section>
      <p className="web-live-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

export function SettingsPage({
  runtime,
  view,
}: {
  readonly runtime: WebWorkspaceRuntime;
  readonly view: RuntimeView;
}): React.JSX.Element {
  const provider = view.state.provider;
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
  const [modelId, setModelId] = useState(provider.writingModelId ?? '');
  const [cost, setCost] = useState(provider.estimatedCostPerCallMicrounits?.toString() ?? '');
  const [budget, setBudget] = useState(provider.budgetPerCallMicrounits?.toString() ?? '');
  const [key, setKey] = useState('');
  const [preview, setPreview] = useState<WebAiPreview | null>(null);
  const [status, setStatus] = useState('');
  const diagnostics = runtime.diagnostics();
  const save = async (): Promise<void> => {
    try {
      await runtime.saveProviderSettings(
        {
          baseUrl: baseUrl === '' ? null : baseUrl,
          budgetPerCallMicrounits: budget === '' ? null : Number(budget),
          estimatedCostPerCallMicrounits: cost === '' ? null : Number(cost),
          writingModelId: modelId === '' ? null : modelId,
        },
        provider.revision,
      );
      setStatus('非秘密 AI 设置已保存到工作区。');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  const sessionKey = (): void => {
    try {
      runtime.setSessionApiKey(key);
      setKey('');
      setStatus('API key 仅保存在当前页面内存；刷新或关闭即清除。');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  return (
    <div className="web-page">
      <PageHeader
        eyebrow="本地目录、账号与会话 AI 设置"
        title="设置"
        description="非秘密配置写入工作区；API key 只在当前浏览器页面内存中使用，不是系统凭据保险箱。"
      />
      <div className="web-settings-layout">
        <section className="v2-card web-settings-main">
          <h2>AI 服务</h2>
          <label className="v2-field">
            <span>HTTPS Base URL</span>
            <input
              placeholder="https://provider.example/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="v2-field">
            <span>写作模型 ID</span>
            <input value={modelId} onChange={(event) => setModelId(event.target.value)} />
          </label>
          <div className="web-two-column">
            <label className="v2-field">
              <span>单次费用上界（微单位）</span>
              <input
                min="0"
                step="1"
                type="number"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
            </label>
            <label className="v2-field">
              <span>单次预算（微单位）</span>
              <input
                min="0"
                step="1"
                type="number"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>
          </div>
          <Button onClick={() => void save()} tone="primary">
            保存非秘密设置
          </Button>
          <hr />
          <label className="v2-field">
            <span>本次会话 API key（永不回显）</span>
            <input
              autoComplete="off"
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <div className="web-action-row">
            <Button disabled={key === ''} onClick={sessionKey}>
              仅存入页面内存
            </Button>
            <Button
              disabled={!runtime.hasSessionApiKey()}
              onClick={() => {
                runtime.clearSessionApiKey();
                setStatus('会话 API key 已从内存清除。');
              }}
            >
              清除会话 key
            </Button>
          </div>
          <p>
            浏览器会把本次用户明确确认的请求直接发送到所配 HTTPS Provider；是否允许 CORS
            取决于对方服务。
          </p>
        </section>
        <aside className="v2-card web-inspector">
          <h2>能力与费用</h2>
          <dl className="v2-facts">
            <div>
              <dt>Provider</dt>
              <dd>{provider.baseUrl === null ? '未配置' : '已配置'}</dd>
            </div>
            <div>
              <dt>会话 key</dt>
              <dd>{runtime.hasSessionApiKey() ? '已输入' : '刷新后需重新输入'}</dd>
            </div>
            <div>
              <dt>结构化 JSON</dt>
              <dd>{CAPABILITY_LABEL[provider.structuredJson]}</dd>
            </div>
            <div>
              <dt>费用</dt>
              <dd>{provider.estimatedCostPerCallMicrounits === null ? '未知' : '可计算'}</dd>
            </div>
          </dl>
          <Button
            onClick={() =>
              void (async () => {
                try {
                  setPreview(
                    await runtime.previewProviderAction('CAPABILITY_PROBE', 'provider-settings'),
                  );
                } catch (error) {
                  setStatus(errorMessage(error));
                }
              })()
            }
          >
            预览能力检查
          </Button>
          {preview === null ? null : (
            <AiPreviewCard
              preview={preview}
              onConfirm={() =>
                void (async () => {
                  try {
                    await runtime.executeProviderAction(preview.token);
                    setPreview(null);
                    setStatus('结构化 JSON 能力已由用户明确检查。');
                  } catch (error) {
                    setStatus(errorMessage(error));
                  }
                })()
              }
            />
          )}
        </aside>
      </div>
      <details className="v2-card web-diagnostics">
        <summary>高级脱敏诊断</summary>
        <dl>
          {Object.entries(diagnostics).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="web-live-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
