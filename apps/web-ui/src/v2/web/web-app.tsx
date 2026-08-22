import { useEffect, useRef, useState } from 'react';

import {
  loadWorkspaceHandle,
  saveWorkspaceHandle,
  type StoredWorkspaceHandle,
} from './handle-store.js';
import { queryReadWritePermission, requestReadWritePermission } from './folder-port.js';
import {
  WebWorkspaceRuntime,
  type GenerationPreview,
  type RuntimeView,
  type WebAiPreview,
  type WebAiResult,
} from './runtime.js';
import {
  WebButton as Button,
  WebIcon as Icon,
  WebPageHeader as PageHeader,
  webSafeErrorMessage,
  WebStatusPill as StatusPill,
} from './ui.js';
import type { ContentPackageFields } from './contracts.js';
import {
  AiPreviewCard,
  InteractionPage,
  LibraryPage,
  ReviewPage,
  SettingsPage,
} from './w2-pages.js';

type WebRoute =
  'content' | 'interaction' | 'library' | 'overview' | 'review' | 'settings' | 'weekly-plan';
type ConnectionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unsupported' }
  | {
      readonly kind: 'disconnected';
      readonly remembered: StoredWorkspaceHandle | null;
      readonly message: string;
    }
  | {
      readonly kind: 'connected';
      readonly runtime: WebWorkspaceRuntime;
      readonly warning: string | null;
    };

const CONTENT_STATUS_LABEL = Object.freeze({
  APPROVED: '已批准',
  DRAFT: '草稿',
  REVIEW_REQUIRED: '待复核',
});

const ROUTES = [
  { icon: 'house' as const, id: 'overview' as const, label: '总览' },
  { icon: 'calendar-blank' as const, id: 'weekly-plan' as const, label: '本周计划' },
  { icon: 'file-text' as const, id: 'content' as const, label: '内容' },
  { icon: 'bookmark-simple' as const, id: 'interaction' as const, label: '互动' },
  { icon: 'books' as const, id: 'library' as const, label: '书库' },
  { icon: 'export' as const, id: 'review' as const, label: '数据复盘' },
  { icon: 'gear-six' as const, id: 'settings' as const, label: '设置' },
] as const;

function routeFromHash(): WebRoute {
  const candidate = window.location.hash.replace(/^#\/web\//u, '');
  return ROUTES.some((route) => route.id === candidate) ? (candidate as WebRoute) : 'overview';
}

function message(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '目录权限被拒绝；你可以重新选择本地数据目录。';
    if (error.name === 'AbortError') return '已取消选择目录；未创建或覆盖任何文件。';
  }
  return webSafeErrorMessage(error);
}

function useRuntimeView(runtime: WebWorkspaceRuntime): RuntimeView {
  const [view, setView] = useState(() => runtime.view);
  useEffect(() => runtime.subscribe(() => setView(runtime.view)), [runtime]);
  return view;
}

function ConnectionScreen({
  state,
  onConnect,
}: {
  readonly state: Exclude<ConnectionState, { kind: 'connected' }>;
  readonly onConnect: (remembered: StoredWorkspaceHandle | null) => void;
}): React.JSX.Element {
  const unsupported = state.kind === 'unsupported';
  return (
    <main className="web-connect-shell">
      <section className="v2-card web-connect-card" aria-labelledby="web-connect-title">
        <div className="web-connect-icon">
          <Icon name="books" size={38} />
        </div>
        <p className="v2-kicker">Rednote Studio · Web 本地工作台</p>
        <h1 id="web-connect-title">连接你的本地数据目录</h1>
        <p>业务数据只写入你选择的固定文件夹；浏览器站点数据被清除后，重新选择同一目录即可恢复。</p>
        {state.kind === 'loading' ? <p aria-live="polite">正在检查已保存的目录权限…</p> : null}
        {state.kind === 'disconnected' ? (
          <p aria-live="polite" className="web-inline-warning" role="status">
            {state.message}
          </p>
        ) : null}
        {unsupported ? (
          <p className="web-inline-error" role="alert">
            当前浏览器不支持本地文件夹写入。请使用最新版 Chrome 或 Edge。
          </p>
        ) : null}
        <Button
          disabled={unsupported || state.kind === 'loading'}
          icon="books"
          onClick={() => onConnect(state.kind === 'disconnected' ? state.remembered : null)}
          tone="primary"
        >
          {state.kind === 'disconnected' && state.remembered !== null
            ? '重新连接原数据目录'
            : '选择本地数据目录'}
        </Button>
        <ul className="web-connect-facts">
          <li>可选择空目录创建新的 RednoteData 工作区。</li>
          <li>网页不会显示或记录绝对路径。</li>
          <li>选择目录本身不会调用模型、Search、Fetch 或产生费用。</li>
        </ul>
      </section>
    </main>
  );
}

export function WebWorkspaceShell({
  connectionWarning = null,
  route,
  runtime,
  setRoute,
}: {
  readonly connectionWarning?: string | null;
  readonly route: WebRoute;
  readonly runtime: WebWorkspaceRuntime;
  readonly setRoute: (route: WebRoute) => void;
}): React.JSX.Element {
  const view = useRuntimeView(runtime);
  const page =
    route === 'weekly-plan' ? (
      <PlanPage runtime={runtime} view={view} />
    ) : route === 'content' ? (
      <ContentPage runtime={runtime} view={view} />
    ) : route === 'interaction' ? (
      <InteractionPage runtime={runtime} view={view} />
    ) : route === 'library' ? (
      <LibraryPage runtime={runtime} view={view} />
    ) : route === 'review' ? (
      <ReviewPage runtime={runtime} view={view} />
    ) : route === 'settings' ? (
      <SettingsPage runtime={runtime} view={view} />
    ) : (
      <OverviewPage runtime={runtime} view={view} />
    );
  return (
    <div className="v2-shell web-v2-shell" data-web-workspace data-v2-shell>
      <aside aria-label="主导航" className="v2-sidebar">
        <button className="v2-side-brand" onClick={() => setRoute('overview')} type="button">
          <span aria-hidden="true">◉</span>
          <strong>Rednote Studio</strong>
        </button>
        <nav className="v2-nav">
          {ROUTES.map((item) => (
            <a
              aria-current={route === item.id ? 'page' : undefined}
              className="v2-nav-item"
              data-active={route === item.id}
              href={`#/web/${item.id}`}
              key={item.id}
            >
              <Icon name={item.icon} size={21} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="v2-account">
          <Icon name="user-circle" size={29} />
          <span>
            <strong>{view.state.persona.name}</strong>
            <small>
              {view.directoryName} · {view.state.workspaceId.slice(0, 8)}
            </small>
          </span>
        </div>
      </aside>
      <div className="v2-workspace">
        <header className="v2-window-bar">
          <div className="v2-brand">
            <Icon name="bookmark-simple" size={19} />
            <span>Rednote Studio</span>
          </div>
          <strong className="v2-mock-label">本地目录已连接 · generation {view.generation}</strong>
        </header>
        <div className="v2-app-body">
          <main className="v2-main">
            {connectionWarning === null ? null : (
              <div className="web-inline-warning" role="status">
                {connectionWarning}
              </div>
            )}
            {view.recoveryWarning === null ? null : (
              <div className="web-inline-warning" role="status">
                {view.recoveryWarning}
              </div>
            )}
            {page}
          </main>
        </div>
      </div>
    </div>
  );
}

function OverviewPage({
  runtime,
  view,
}: {
  readonly runtime: WebWorkspaceRuntime;
  readonly view: RuntimeView;
}): React.JSX.Element {
  const persona = view.state.persona;
  const [draft, setDraft] = useState(() => ({
    audience: persona.audience,
    boundary: persona.boundary,
    name: persona.name,
    tone: persona.tone,
  }));
  const [status, setStatus] = useState('');
  const plan = view.state.plans[view.state.activeWeekKey];
  const contentCount = view.state.contentByWeek[view.state.activeWeekKey]?.packages.length ?? 0;
  const run = async (operation: () => Promise<void>, success: string): Promise<void> => {
    try {
      await operation();
      setStatus(success);
    } catch (error) {
      setStatus(message(error));
    }
  };
  return (
    <div className="web-page">
      <PageHeader
        eyebrow="本地优先 · 业务数据在你的目录中"
        title="总览"
        description="先保存账号人设，再建立并锁定活动周计划；所有状态都可重载恢复。"
      />
      <section className="web-overview-grid">
        <article className="v2-card web-persona-card">
          <h2>账号人设</h2>
          <p>用于本地计划与零费用结构化草稿，不会上传。</p>
          {(['name', 'audience', 'tone', 'boundary'] as const).map((key) => (
            <label className="v2-field" key={key}>
              <span>
                {
                  {
                    name: '账号名称',
                    audience: '目标受众',
                    tone: '表达语气',
                    boundary: '内容边界',
                  }[key]
                }
              </span>
              {key === 'boundary' ? (
                <textarea
                  rows={3}
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              ) : (
                <input
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              )}
            </label>
          ))}
          <Button
            icon="check"
            onClick={() =>
              void run(() => runtime.savePersona(draft, persona.revision), '人设已保存到本地目录。')
            }
            tone="primary"
          >
            保存人设
          </Button>
        </article>
        <aside className="v2-card web-week-summary">
          <p className="v2-kicker">唯一活动周</p>
          <h2>{view.state.activeWeekKey}</h2>
          <dl className="v2-facts">
            <div>
              <dt>计划</dt>
              <dd>
                {plan === undefined
                  ? '尚未创建'
                  : `${plan.candidates.length} 项 · ${plan.status === 'CONFIRMED' ? '已锁定' : '草稿'}`}
              </dd>
            </div>
            <div>
              <dt>内容版本</dt>
              <dd>
                {contentCount} / {plan?.candidates.length ?? 0}
              </dd>
            </div>
            <div>
              <dt>待处理互动</dt>
              <dd>
                {
                  view.state.interactions.filter((item) =>
                    ['NEW', 'SUGGESTED', 'CONFIRMED'].includes(item.status),
                  ).length
                }
              </dd>
            </div>
            <div>
              <dt>书库资料</dt>
              <dd>{view.state.library.length}</dd>
            </div>
            <div>
              <dt>指标版本</dt>
              <dd>{view.state.metricSnapshots.length}</dd>
            </div>
            <div>
              <dt>快照</dt>
              <dd>{view.snapshotHashPrefix}</dd>
            </div>
          </dl>
          <Button
            icon="calendar-blank"
            onClick={() =>
              void run(
                () => runtime.switchWeek(runtime.suggestedNextWeek()),
                '已原子切换到下一周。',
              )
            }
          >
            切换到下一周
          </Button>
        </aside>
      </section>
      <p className="web-live-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

function PlanPage({
  runtime,
  view,
}: {
  readonly runtime: WebWorkspaceRuntime;
  readonly view: RuntimeView;
}): React.JSX.Element {
  const plan = view.state.plans[view.state.activeWeekKey];
  const range = runtime.activeWeekRange();
  const [brief, setBrief] = useState(
    plan?.brief.text ?? '围绕公版推理经典，安排 21 个可继续编辑的本地选题。',
  );
  const [status, setStatus] = useState('');
  const run = async (operation: () => Promise<void>, success: string): Promise<void> => {
    try {
      await operation();
      setStatus(success);
    } catch (error) {
      setStatus(message(error));
    }
  };
  return (
    <div className="web-page">
      <PageHeader
        eyebrow={`${view.state.activeWeekKey} · ${range.startDate} 至 ${range.endDate}`}
        title={runtime.activeWeekHeading()}
        description="计划、Brief、候选和内容始终绑定同一个活动周。"
        actions={
          <Button
            disabled={plan !== undefined}
            icon="plus"
            onClick={() => void run(() => runtime.ensurePlan(), '已创建 21 个本地候选。')}
            tone="primary"
          >
            {plan === undefined ? '创建 21 项计划' : '计划已创建'}
          </Button>
        }
      />
      {plan === undefined ? (
        <section className="v2-card web-empty">
          <Icon name="calendar-blank" size={34} />
          <h2>活动周尚无计划</h2>
          <p>创建后只写入所选目录，不调用模型或网络。</p>
        </section>
      ) : (
        <>
          <section className="v2-card web-plan-actions">
            <label className="v2-field">
              <span>周计划 Brief</span>
              <textarea rows={3} value={brief} onChange={(event) => setBrief(event.target.value)} />
            </label>
            <div>
              <Button onClick={() => void run(() => runtime.saveBrief(brief), 'Brief 已保存。')}>
                保存 Brief
              </Button>
              <Button
                onClick={() => void run(() => runtime.confirmAllCandidates(), '21 项候选已确认。')}
              >
                确认全部候选
              </Button>
              <Button
                disabled={plan.status === 'CONFIRMED'}
                onClick={() => void run(() => runtime.lockPlan(), '活动周计划已锁定。')}
                tone="primary"
              >
                锁定计划
              </Button>
            </div>
          </section>
          <section className="web-plan-grid">
            {plan.candidates.map((item) => (
              <article className="v2-card web-plan-item" key={item.id}>
                <span>
                  {item.day} · {item.date} {item.time}
                </span>
                <strong>{item.title}</strong>
                <small>{item.book}</small>
                <StatusPill
                  status={
                    item.status === 'CONFIRMED'
                      ? '已确认'
                      : item.status === 'PENDING'
                        ? '待确认'
                        : item.status
                  }
                />
              </article>
            ))}
          </section>
        </>
      )}
      <p className="web-live-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

function ContentPage({
  runtime,
  view,
}: {
  readonly runtime: WebWorkspaceRuntime;
  readonly view: RuntimeView;
}): React.JSX.Element {
  const queue = runtime.queue();
  const [generationIds, setGenerationIds] = useState<readonly string[]>([]);
  const [packageIds, setPackageIds] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  const previewRef = useRef<GenerationPreview | null>(null);
  const previousWeekRef = useRef(view.state.activeWeekKey);
  const [activeId, setActiveId] = useState('');
  const [status, setStatus] = useState('');
  const [aiPreview, setAiPreview] = useState<WebAiPreview | null>(null);
  const [aiResult, setAiResult] = useState<WebAiResult | null>(null);
  const active = queue.find((item) => item.package?.id === activeId)?.package ?? null;
  const version = active?.versions.at(-1);
  const [draft, setDraft] = useState<ContentPackageFields | null>(version?.fields ?? null);
  useEffect(() => {
    setDraft(version?.fields ?? null);
    setAiPreview(null);
    setAiResult(null);
  }, [version?.versionId]);
  useEffect(() => {
    const latestQueue = runtime.queue();
    const missing = new Set(
      latestQueue.filter((item) => item.state === 'MISSING').map((item) => item.candidate.id),
    );
    const packages = new Set(
      latestQueue.flatMap((item) => (item.package === null ? [] : [item.package.id])),
    );
    const weekChanged = previousWeekRef.current !== view.state.activeWeekKey;
    previousWeekRef.current = view.state.activeWeekKey;
    if (previewRef.current !== null) {
      previewRef.current = null;
      setPreview(null);
      setStatus('活动周或工作区状态已变化，旧预览已失效；请重新选择并预览。');
    }
    if (weekChanged) {
      setGenerationIds([]);
      setPackageIds([]);
      setActiveId('');
      setDraft(null);
      return;
    }
    setGenerationIds((current) => current.filter((id) => missing.has(id)));
    setPackageIds((current) => current.filter((id) => packages.has(id)));
    setActiveId((current) => (packages.has(current) ? current : ''));
  }, [runtime, view.generation, view.state.activeWeekKey]);
  const toggleGeneration = (candidateId: string): void => {
    if (previewRef.current !== null) {
      previewRef.current = null;
      setPreview(null);
      setStatus('候选选择已变化，旧预览已失效；请重新预览。');
    }
    setGenerationIds((current) =>
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : current.length < 3
          ? [...current, candidateId]
          : current,
    );
  };
  const previewAction = async (): Promise<void> => {
    try {
      const next = await runtime.previewGeneration(generationIds);
      previewRef.current = next;
      setPreview(next);
      setStatus('预览已绑定当前周、plan revision 与输入 hash。');
    } catch (error) {
      setStatus(message(error));
    }
  };
  const execute = async (): Promise<void> => {
    const currentPreview = previewRef.current;
    if (currentPreview === null) return;
    try {
      await runtime.executeGeneration(currentPreview.token);
      setGenerationIds([]);
      previewRef.current = null;
      setPreview(null);
      setStatus('本地零费用草稿已生成并写入新快照。');
    } catch (error) {
      setStatus(message(error));
    }
  };
  const save = async (): Promise<void> => {
    if (active === null || draft === null) return;
    try {
      await runtime.saveContentVersion(active.id, draft, active.revision);
      setStatus('已追加内容新版本。');
    } catch (error) {
      setStatus(message(error));
    }
  };
  const previewAi = async (): Promise<void> => {
    if (active === null) return;
    try {
      setAiPreview(await runtime.previewProviderAction('CONTENT_COPY', active.id));
      setAiResult(null);
    } catch (error) {
      setStatus(message(error));
    }
  };
  const executeAi = async (): Promise<void> => {
    if (aiPreview === null) return;
    try {
      const result = await runtime.executeProviderAction(aiPreview.token);
      setAiResult(result);
      setDraft(result.fields);
      setAiPreview(null);
      setStatus('模型文案仅在页面中预览；确认保存前不会写入工作区。');
    } catch (error) {
      setStatus(message(error));
    }
  };
  const saveAi = async (): Promise<void> => {
    if (active === null || aiResult === null) return;
    try {
      await runtime.saveModelContentResult(aiResult, active.revision);
      setAiResult(null);
      setStatus('模型文案已追加为待复核的新版本。');
    } catch (error) {
      setStatus(message(error));
    }
  };
  return (
    <div className="web-page">
      <PageHeader
        eyebrow={`${view.state.activeWeekKey} · ${queue.length} 项`}
        title="内容"
        description="队列始终保留活动周全部计划项；首次生成与已有版本选择互相独立。"
      />
      {queue.length === 0 ? (
        <section className="v2-card web-empty">
          <h2>尚无同周锁定计划</h2>
          <p>先在本周计划中创建、确认并锁定 21 项。</p>
        </section>
      ) : (
        <div className="web-content-layout">
          <section className="v2-card web-content-queue">
            <header>
              <strong>内容队列</strong>
              <small>{queue.filter((item) => item.state === 'MISSING').length} 项待生成</small>
            </header>
            {queue.map((item) => (
              <article data-state={item.state} key={item.candidate.id}>
                <label>
                  <input
                    checked={generationIds.includes(item.candidate.id)}
                    disabled={item.state !== 'MISSING'}
                    onChange={() => toggleGeneration(item.candidate.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{item.candidate.title}</strong>
                    <small>
                      {item.candidate.book} ·{' '}
                      {item.state === 'MISSING'
                        ? '待生成'
                        : `v${item.package?.versions.length ?? 0}`}
                    </small>
                  </span>
                </label>
                {item.package === null ? null : (
                  <button
                    aria-pressed={active?.id === item.package.id}
                    onClick={() => {
                      setActiveId(item.package?.id ?? '');
                      setPackageIds((current) =>
                        current.includes(item.package?.id ?? '')
                          ? current
                          : [...current, item.package?.id ?? ''],
                      );
                    }}
                    type="button"
                  >
                    编辑
                  </button>
                )}
              </article>
            ))}
          </section>
          <section className="v2-card web-content-editor">
            {queue.some((item) => item.state === 'MISSING') ? (
              <div className="web-empty">
                <Icon name="file-text" size={34} />
                <h2>{active === null ? '选择 1—3 项预览生成' : '继续生成下一批内容'}</h2>
                <p>仅生成同周、已锁定且没有内容包的候选；外部请求为 0。</p>
                <Button
                  disabled={generationIds.length === 0}
                  onClick={() => void previewAction()}
                  tone="primary"
                >
                  预览本地生成（{generationIds.length}/3）
                </Button>
                {preview === null ? null : (
                  <div className="web-preview">
                    <strong>预览已就绪</strong>
                    <small>
                      week {preview.weekKey} · revision {preview.planRevision} · hash{' '}
                      {preview.inputHash.slice(0, 12)} · 请求 0
                    </small>
                    <Button onClick={() => void execute()} tone="primary">
                      确认并生成一次
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="web-preview">
                <strong>活动周内容已全部生成</strong>
                <small>可以继续选择已有内容包编辑并追加版本。</small>
              </div>
            )}
            {active !== null && draft !== null ? (
              <>
                <p className="v2-kicker">
                  {active.weekKey} · v{version?.version}
                </p>
                <h2>{draft.title}</h2>
                <label className="v2-field">
                  <span>标题</span>
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </label>
                <label className="v2-field">
                  <span>正文</span>
                  <textarea
                    rows={9}
                    value={draft.body}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  />
                </label>
                <label className="v2-field">
                  <span>标签</span>
                  <input
                    value={draft.tags.join('，')}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tags: event.target.value
                          .split(/[，,]/u)
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <label className="v2-field">
                  <span>素材说明</span>
                  <textarea
                    rows={3}
                    value={draft.materialNotes}
                    onChange={(event) => setDraft({ ...draft, materialNotes: event.target.value })}
                  />
                </label>
                <div className="web-action-row">
                  <Button onClick={() => void save()} tone="primary">
                    保存内容新版本
                  </Button>
                  <Button onClick={() => void previewAi()}>预览 AI 文案新版本</Button>
                  <Button disabled={aiResult === null} onClick={() => void saveAi()}>
                    保存模型预览
                  </Button>
                </div>
                {aiPreview === null ? null : (
                  <AiPreviewCard onConfirm={() => void executeAi()} preview={aiPreview} />
                )}
              </>
            ) : (
              <div className="web-empty">
                <h2>
                  {queue.some((item) => item.package !== null)
                    ? '选择已有内容包进行编辑'
                    : '等待生成内容'}
                </h2>
                <p>内容版本编辑与待生成候选选择互相独立。</p>
              </div>
            )}
          </section>
          <aside className="v2-card web-content-inspector">
            <p className="v2-kicker">版本检查</p>
            <h2>
              {active === null
                ? '等待生成'
                : `${CONTENT_STATUS_LABEL[active.status]} · ${active.versions.length} 个版本`}
            </h2>
            <dl className="v2-facts">
              <div>
                <dt>活动周</dt>
                <dd>{view.state.activeWeekKey}</dd>
              </div>
              <div>
                <dt>首次生成选择</dt>
                <dd>{generationIds.length} 项</dd>
              </div>
              <div>
                <dt>已有包选择</dt>
                <dd>{packageIds.length} 项</dd>
              </div>
              <div>
                <dt>真实请求</dt>
                <dd>仅在用户确认后最多 1 次</dd>
              </div>
            </dl>
            <Button
              disabled={active === null || active.status === 'APPROVED'}
              onClick={() => {
                if (active !== null)
                  void runtime
                    .approveContent(active.id, active.revision)
                    .then(() => setStatus('当前版本已批准，可在数据复盘录入指标。'))
                    .catch((error: unknown) => setStatus(message(error)));
              }}
              tone="primary"
            >
              批准当前版本
            </Button>
          </aside>
        </div>
      )}
      <p className="web-live-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

export function WebV2App(): React.JSX.Element {
  const [route, setRouteState] = useState<WebRoute>(routeFromHash);
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'loading' });
  useEffect(() => {
    const sync = (): void => setRouteState(routeFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    if (typeof window.showDirectoryPicker !== 'function') {
      setConnection({ kind: 'unsupported' });
      return;
    }
    let active = true;
    void loadWorkspaceHandle()
      .then(async (stored) => {
        if (!active) return;
        if (stored === null)
          return setConnection({
            kind: 'disconnected',
            message: '尚未连接本地数据目录。',
            remembered: null,
          });
        const permission = await queryReadWritePermission(stored.handle);
        if (permission !== 'granted')
          return setConnection({
            kind: 'disconnected',
            message: '浏览器需要你重新确认原数据目录权限。',
            remembered: stored,
          });
        try {
          const runtime = await WebWorkspaceRuntime.connect(stored.handle, stored.workspaceId);
          if (active) setConnection({ kind: 'connected', runtime, warning: null });
          else runtime.close();
        } catch (error) {
          if (active)
            setConnection({ kind: 'disconnected', message: message(error), remembered: stored });
        }
      })
      .catch(() => {
        if (active)
          setConnection({
            kind: 'disconnected',
            message: '目录权限记录不可用，请重新选择原目录。',
            remembered: null,
          });
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (connection.kind === 'connected') connection.runtime.close();
    },
    [connection],
  );
  const connect = async (remembered: StoredWorkspaceHandle | null): Promise<void> => {
    if (window.showDirectoryPicker === undefined) return;
    let runtime: WebWorkspaceRuntime | null = null;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const permission = await queryReadWritePermission(handle);
      if (permission !== 'granted' && (await requestReadWritePermission(handle)) !== 'granted')
        throw new DOMException('directory permission denied', 'NotAllowedError');
      runtime = await WebWorkspaceRuntime.connect(handle, remembered?.workspaceId);
      let warning: string | null = null;
      try {
        await saveWorkspaceHandle({
          directoryName: handle.name,
          handle,
          workspaceId: runtime.view.state.workspaceId,
        });
      } catch {
        warning = '本次未记住目录；业务数据已安全保存，下次打开时请重新选择同一目录。';
      }
      setConnection({ kind: 'connected', runtime, warning });
      runtime = null;
    } catch (error) {
      runtime?.close();
      setConnection({ kind: 'disconnected', message: message(error), remembered });
    }
  };
  const setRoute = (next: WebRoute): void => {
    window.location.hash = `#/web/${next}`;
    setRouteState(next);
    window.scrollTo({ top: 0 });
  };
  return connection.kind === 'connected' ? (
    <WebWorkspaceShell
      connectionWarning={connection.warning}
      route={route}
      runtime={connection.runtime}
      setRoute={setRoute}
    />
  ) : (
    <ConnectionScreen state={connection} onConnect={(stored) => void connect(stored)} />
  );
}
