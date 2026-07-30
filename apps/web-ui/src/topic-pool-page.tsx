import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  DesktopError,
  PreviewTopicActionInput,
  TopicActionPreview,
  TopicDetailView,
  TopicPoolItem,
  TopicPoolWorkspaceView,
  TopicQuotaCategoryView,
  TopicQuotaPlanView,
} from '@mystery-operations/shared';

const PROFILE_ID = 'primary';
const PAGE_SIZE = 25;
const HISTORY_LIMIT = 50;

type TopicContentType = TopicPoolItem['contentType'];
type TopicEligibilityState = TopicPoolItem['eligibility'];
type TopicCandidateState = TopicPoolItem['candidateState'];
type TopicStateAction = 'LOCK' | 'HOLD' | 'RESUME' | 'ARCHIVE' | 'RESTORE';

const CONTENT_TYPES: readonly TopicContentType[] = [
  'NON_SPOILER_SINGLE_BOOK_VERDICT',
  'FULL_TRICK_LOGIC_ANALYSIS',
  'CROSS_WORK_COMPARISON',
  'WEB_VS_PUBLISHED_MYSTERY',
  'MYSTERY_AND_CULTURAL_PHENOMENON',
];

const CONTENT_LABELS = new Map<TopicContentType, string>([
  ['NON_SPOILER_SINGLE_BOOK_VERDICT', '无剧透单书判断'],
  ['FULL_TRICK_LOGIC_ANALYSIS', '完整诡计逻辑分析'],
  ['CROSS_WORK_COMPARISON', '跨作品比较'],
  ['WEB_VS_PUBLISHED_MYSTERY', '网文与出版推理'],
  ['MYSTERY_AND_CULTURAL_PHENOMENON', '推理与文化现象'],
]);

const QUOTA_LABELS = new Map<TopicContentType, string>([
  ['NON_SPOILER_SINGLE_BOOK_VERDICT', '10'],
  ['FULL_TRICK_LOGIC_ANALYSIS', '8'],
  ['CROSS_WORK_COMPARISON', '6'],
  ['WEB_VS_PUBLISHED_MYSTERY', '3'],
  ['MYSTERY_AND_CULTURAL_PHENOMENON', '3'],
]);

const ELIGIBILITY_LABELS = new Map<TopicEligibilityState, string>([
  ['ELIGIBLE', '可入选'],
  ['DOSSIER_NOT_READY', '研究档案未就绪'],
  ['AUTHENTICITY_BLOCKED', '阅读真实性阻断'],
  ['FACT_BLOCKED', '事实阻断'],
  ['STALE', '依赖已失效'],
  ['INSUFFICIENT_COMPARISON_SET', '比较集合不足'],
  ['SPOILER_POLICY_INCOMPLETE', '剧透政策未完成'],
  ['DUPLICATE', '语义重复'],
  ['ARCHIVED', '已归档'],
]);

const STATE_LABELS = new Map<TopicCandidateState, string>([
  ['PROPOSED', '候选'],
  ['LOCKED', '已锁定'],
  ['HELD', '暂缓'],
  ['ARCHIVED', '已归档'],
]);

const RANKING_LABELS = new Map<TopicDetailView['ranking'][number]['type'], string>([
  ['EVIDENCE_SUFFICIENCY', '证据充分度'],
  ['CONTENT_FIT', '内容适配度'],
  ['DIFFERENTIATION', '差异化'],
  ['ESTIMATED_COST', '预计成本'],
  ['APPROVAL_WORKLOAD', '审批工作量'],
]);

const ELIGIBILITY_OPTIONS: readonly TopicEligibilityState[] = [
  'ELIGIBLE',
  'DOSSIER_NOT_READY',
  'AUTHENTICITY_BLOCKED',
  'FACT_BLOCKED',
  'STALE',
  'INSUFFICIENT_COMPARISON_SET',
  'SPOILER_POLICY_INCOMPLETE',
  'DUPLICATE',
  'ARCHIVED',
];

const STATE_OPTIONS: readonly TopicCandidateState[] = ['PROPOSED', 'LOCKED', 'HELD', 'ARCHIVED'];

function topicError(error: DesktopError): string {
  const labels: Partial<Record<DesktopError['code'], string>> = {
    TOPIC_CAPACITY_EXCEEDED: '本次本地计算超过安全上限，请收窄候选范围。',
    TOPIC_CONFIRMATION_INVALID: '确认已过期、已使用或不属于当前窗口，请重新预览。',
    TOPIC_CONFLICT: '选题状态已变化，请刷新后重试。',
    TOPIC_DUPLICATE: '该语义选题已存在，未创建重复记录。',
    TOPIC_INVALID_CONTRACT: '输入不符合 Topic Pool 冻结合同。',
    TOPIC_INVALID_REQUEST: '选题操作参数无效。',
    TOPIC_NOT_FOUND: '未找到该选题。',
    TOPIC_PLAN_CONFLICT: '锁定项或配额约束存在冲突，不能发布计划。',
    TOPIC_PLAN_NOT_FOUND: '未找到该配额计划。',
    TOPIC_POLICY_BLOCKED: '当前资格、状态或转换政策阻止此操作。',
    TOPIC_PROFILE_NOT_FOUND: '未找到本地用户档案。',
    TOPIC_STALE_REVISION: '数据已更新，本次确认失效；请刷新后重新预览。',
    TOPIC_SUBJECT_NOT_FOUND: '候选依赖的作品、表达形态或研究档案不存在。',
  };
  return labels[error.code] ?? error.message;
}

function basisPoints(value: number | null): string {
  return value === null ? '未知（不按 0 或最优处理）' : `${(value / 100).toFixed(2)} / 100`;
}

function stateActions(state: TopicCandidateState): readonly TopicStateAction[] {
  switch (state) {
    case 'PROPOSED':
      return ['LOCK', 'HOLD', 'ARCHIVE'];
    case 'LOCKED':
      return ['HOLD', 'ARCHIVE'];
    case 'HELD':
      return ['RESUME', 'LOCK', 'ARCHIVE'];
    case 'ARCHIVED':
      return ['RESTORE'];
  }
}

function actionLabel(action: TopicStateAction): string {
  return (
    {
      ARCHIVE: '归档',
      HOLD: '暂缓',
      LOCK: '锁定',
      RESTORE: '恢复',
      RESUME: '回到候选',
    } as const
  )[action];
}

function QuotaCategory({
  category,
}: {
  readonly category: TopicQuotaCategoryView;
}): React.JSX.Element {
  return (
    <article className={category.shortfall === 0 ? 'quota-row is-complete' : 'quota-row'}>
      <div>
        <strong>{CONTENT_LABELS.get(category.contentType)}</strong>
        <small>
          锁定且合格 {category.lockedEligibleCount} · 暂缓 {category.heldCount} · 归档{' '}
          {category.archivedCount}
        </small>
      </div>
      <div className="quota-row__numbers">
        <span>
          {category.selected}/{category.required}
        </span>
        <small>{category.shortfall === 0 ? '配额已满足' : `缺 ${category.shortfall}`}</small>
      </div>
      {category.conflicts.map((conflict) => (
        <p className="topic-inline-error" key={`${category.contentType}-${conflict.code}`}>
          锁定项超过配额：{conflict.topicIds.join('、')}
        </p>
      ))}
    </article>
  );
}

function PlanCard({
  current = false,
  plan,
}: {
  readonly current?: boolean;
  readonly plan: TopicQuotaPlanView;
}): React.JSX.Element {
  return (
    <article className={current ? 'topic-plan-card is-current' : 'topic-plan-card'}>
      <header>
        <div>
          <span className={`topic-status topic-status--${plan.status.toLowerCase()}`}>
            {plan.status}
          </span>
          <strong>FIRST_30_V1 · v{plan.versionNumber}</strong>
        </div>
        <small>{plan.createdAt}</small>
      </header>
      <p>
        已选 {plan.totalSelected}/{plan.totalRequired} · snapshot{' '}
        <code>{plan.poolSnapshotHash.slice(0, 12)}</code>
      </p>
    </article>
  );
}

function PreviewPanel({
  busy,
  onConfirm,
  onDismiss,
  preview,
}: {
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
  readonly preview: TopicActionPreview;
}): React.JSX.Element {
  const value = preview.preview;
  return (
    <section aria-live="polite" className="topic-preview">
      <div>
        <p className="section-kicker">显式确认 · {preview.kind}</p>
        <h3>请核对本地变更预览</h3>
        {value.kind === 'GENERATE' ? (
          <>
            <p>
              读取 {value.inputWorkCount} 本就绪作品，最多检查 {value.localCombinationUpperBound}{' '}
              个确定性组合；预计写入 {value.estimatedLocalWrites} 个候选。
            </p>
            <p>
              模型执行：{value.modelExecutionState} · 外部模型请求 {value.estimatedModelRequests}
            </p>
            <p>
              去重上限 {value.deduplicationLimit} · 资格政策{' '}
              {value.expectedPolicyVersions.topicEligibility}
            </p>
          </>
        ) : null}
        {value.kind === 'STATE_CHANGE' || value.kind === 'STATE_UNDO' ? (
          <p>
            {value.topicId}: {STATE_LABELS.get(value.before)} → {STATE_LABELS.get(value.after)}（
            {value.action}）
          </p>
        ) : null}
        {value.kind === 'BATCH_STATE_CHANGE' ? (
          <>
            <p>
              对 {value.items.length} 个明确选中的候选执行 {value.action}，每项独立校验 revision。
            </p>
            <ul>
              {value.items.map((item) => (
                <li key={item.topicId}>
                  {item.topicId}: {STATE_LABELS.get(item.before)} → {STATE_LABELS.get(item.after)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {value.kind === 'QUOTA_PLAN' ? (
          <>
            <p>
              FIRST_30_V1：{value.totalSelected}/{value.totalRequired} · {value.status} ·
              单作品最多暴露 {value.maxWorkExposure} 次
            </p>
            <div className="topic-preview__quotas">
              {value.categories.map((category) => (
                <QuotaCategory category={category} key={category.contentType} />
              ))}
            </div>
            {value.warnings.map((warning) => (
              <p className="topic-inline-warning" key={warning}>
                {warning}
              </p>
            ))}
            {value.noOp ? <p>输入与当前计划相同：确认后返回 NO_OP，不新增版本。</p> : null}
          </>
        ) : null}
        {value.kind === 'CANCEL_GENERATION' ? (
          <p>
            取消本地生成运行 {value.runId}，expected revision {value.expectedRevision}。
          </p>
        ) : null}
        <small>一次性确认令牌将在 {preview.expiresAt} 失效，并且只绑定当前窗口。</small>
      </div>
      <div className="topic-button-row">
        <button className="secondary-button" onClick={onDismiss} type="button">
          返回修改
        </button>
        <button className="primary-button" disabled={busy} onClick={onConfirm} type="button">
          明确确认
        </button>
      </div>
    </section>
  );
}

export function TopicPoolPage(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<TopicPoolWorkspaceView | null>(null);
  const [detail, setDetail] = useState<TopicDetailView | null>(null);
  const [contentType, setContentType] = useState<TopicContentType | null>(null);
  const [eligibility, setEligibility] = useState<TopicEligibilityState | null>(null);
  const [candidateState, setCandidateState] = useState<TopicCandidateState | null>(null);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedTopicIds, setSelectedTopicIds] = useState<readonly string[]>([]);
  const [batchAction, setBatchAction] = useState<TopicStateAction>('HOLD');
  const [maxWorkExposure, setMaxWorkExposure] = useState(3);
  const [preview, setPreview] = useState<TopicActionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const executionCounter = useRef(0);

  const loadWorkspace = useCallback(
    async (preserveNotice = false): Promise<void> => {
      const method = window.rednoteDesktop?.getTopicPool;
      if (method === undefined) {
        setLoading(false);
        setNotice('当前桌面桥接尚未提供 Topic Pool 能力。');
        return;
      }
      setLoading(true);
      const result = await method({
        contentType,
        eligibility,
        limit: PAGE_SIZE,
        offset,
        profileId: PROFILE_ID,
        query,
        state: candidateState,
      });
      setLoading(false);
      if (!result.ok) {
        setNotice(topicError(result.error));
        return;
      }
      setWorkspace(result.value);
      if (!preserveNotice) setNotice(null);
    },
    [candidateState, contentType, eligibility, offset, query],
  );

  const openTopic = useCallback(async (topicId: string): Promise<void> => {
    const method = window.rednoteDesktop?.getTopic;
    if (method === undefined) return;
    setBusy(true);
    const result = await method({ historyLimit: HISTORY_LIMIT, topicId });
    setBusy(false);
    if (!result.ok) {
      setNotice(topicError(result.error));
      return;
    }
    setDetail(result.value);
    setPreview(null);
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectedSet = useMemo(() => new Set(selectedTopicIds), [selectedTopicIds]);
  const itemById = useMemo(
    () => new Map((workspace?.items ?? []).map((item) => [item.topicId, item])),
    [workspace?.items],
  );
  const selectedItems = useMemo(
    () =>
      selectedTopicIds
        .map((topicId) => itemById.get(topicId))
        .filter((item): item is TopicPoolItem => item !== undefined),
    [itemById, selectedTopicIds],
  );

  const requestPreview = async (input: PreviewTopicActionInput): Promise<void> => {
    const method = window.rednoteDesktop?.previewTopicAction;
    if (method === undefined) {
      setNotice('当前桌面桥接不支持选题预览。');
      return;
    }
    setBusy(true);
    setPreview(null);
    const result = await method(input);
    setBusy(false);
    if (!result.ok) {
      setNotice(topicError(result.error));
      return;
    }
    setPreview(result.value);
    setNotice(null);
  };

  const refreshAfterAction = async (topicId: string | null): Promise<void> => {
    await loadWorkspace(true);
    if (topicId !== null) await openTopic(topicId);
  };

  const confirmPreview = async (): Promise<void> => {
    const method = window.rednoteDesktop?.confirmTopicAction;
    if (method === undefined || preview === null) return;
    executionCounter.current += 1;
    const executionId =
      preview.kind === 'GENERATE' || preview.kind === 'QUOTA_PLAN'
        ? `topic-exec-${Date.now()}-${executionCounter.current}`
        : null;
    setBusy(true);
    const result = await method({
      confirmation: 'APPLY_TOPIC_ACTION',
      executionId,
      kind: preview.kind,
      previewHash: preview.previewHash,
      token: preview.token,
    });
    setBusy(false);
    if (!result.ok) {
      setPreview(null);
      setNotice(topicError(result.error));
      return;
    }
    const outcome = result.value;
    setPreview(null);
    if (outcome.kind === 'GENERATE') {
      setNotice(
        outcome.generation.status === 'CONFIRMED'
          ? `本地生成已进入可恢复队列；execution ${outcome.generation.executionId}，外部请求 0。`
          : `本地生成完成：新增 ${outcome.generation.createdCount}，语义复用 ${outcome.generation.duplicateCount}，外部请求 ${outcome.generation.externalRequestCount}。`,
      );
      await refreshAfterAction(null);
      return;
    }
    if (outcome.kind === 'STATE_CHANGE' || outcome.kind === 'STATE_UNDO') {
      setDetail(outcome.detail);
      setNotice('状态已追加新 revision；历史记录未被覆盖。');
      await loadWorkspace(true);
      return;
    }
    if (outcome.kind === 'BATCH_STATE_CHANGE') {
      setSelectedTopicIds([]);
      setNotice(`批量操作完成：成功 ${outcome.batch.succeeded}，失败 ${outcome.batch.failed}。`);
      await refreshAfterAction(detail?.topicId ?? null);
      return;
    }
    if (outcome.kind === 'QUOTA_PLAN') {
      if (outcome.quota.status === 'CONFIRMED' || outcome.quota.status === 'RUNNING') {
        setNotice(
          `FIRST_30_V1 已进入可恢复队列；预计 ${outcome.quota.expectedPlanStatus}，` +
            `当前预览 ${outcome.quota.totalSelected}/30，外部请求 0。`,
        );
      } else if (outcome.quota.status === 'SUCCEEDED' || outcome.quota.status === 'NO_OP') {
        setNotice(
          outcome.quota.expectedPlanStatus === 'COMPLETE'
            ? 'FIRST_30_V1 已生成完整 30 项不可变计划版本。'
            : `计划保持 INCOMPLETE：仅选中 ${outcome.quota.totalSelected}/30，未跨类回填。`,
        );
      } else {
        setNotice(`FIRST_30_V1 本地运行状态：${outcome.quota.status}。`);
      }
      await loadWorkspace(true);
      return;
    }
    if (!('run' in outcome)) return;
    setNotice(`本地生成运行 ${outcome.run.runId} 已取消。`);
    await loadWorkspace(true);
  };

  const previewState = (action: TopicStateAction): void => {
    if (detail === null) return;
    void requestPreview({
      draft: { action, expectedRevision: detail.revision, topicId: detail.topicId },
      kind: 'STATE_CHANGE',
    });
  };

  const previewBatch = (): void => {
    if (selectedItems.length === 0) {
      setNotice('批量操作默认不选中任何候选；请先明确勾选目标。');
      return;
    }
    if (batchAction === 'RESTORE' || batchAction === 'RESUME') {
      setNotice('批量恢复需在对应状态筛选后逐项确认；当前批量工具仅提供 LOCK / HOLD / ARCHIVE。');
      return;
    }
    void requestPreview({
      draft: {
        action: batchAction,
        items: selectedItems.map((item) => ({
          expectedRevision: item.revision,
          topicId: item.topicId,
        })),
      },
      kind: 'BATCH_STATE_CHANGE',
    });
  };

  const toggleSelection = (topicId: string): void => {
    setSelectedTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((candidateId) => candidateId !== topicId)
        : current.length >= 50
          ? current
          : [...current, topicId],
    );
  };

  const currentPlan = workspace?.currentPlan ?? null;
  const poolEmpty = !loading && (workspace?.items.length ?? 0) === 0;

  return (
    <div className="topic-pool-page">
      <section className="topic-hero">
        <div>
          <p className="section-kicker">M3 · Topic Pool · FIRST_30_V1</p>
          <h2>把研究就绪度变成可解释的选题组合</h2>
          <p>
            五类候选共用确定性资格门禁、五项整数排序与语义指纹；锁定只影响优先级，不能绕过事实、真实性或剧透政策。
          </p>
        </div>
        <div className="topic-hero__actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void loadWorkspace()}
            type="button"
          >
            刷新
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void requestPreview({ kind: 'GENERATE', profileId: PROFILE_ID })}
            type="button"
          >
            预览本地候选生成
          </button>
        </div>
      </section>

      <section aria-label="五类选题数量" className="topic-category-grid">
        {CONTENT_TYPES.map((type) => (
          <button
            aria-pressed={contentType === type}
            className={contentType === type ? 'topic-category is-active' : 'topic-category'}
            key={type}
            onClick={() => {
              setContentType((current) => (current === type ? null : type));
              setOffset(0);
            }}
            type="button"
          >
            <span>{CONTENT_LABELS.get(type)}</span>
            <strong>{workspace?.counts[type] ?? 0}</strong>
            <small>FIRST_30 配额 {QUOTA_LABELS.get(type)}</small>
          </button>
        ))}
      </section>

      <section className="topic-policy-strip">
        <strong>候选选题不是内容简报或已批准文章</strong>
        <span>排序用于解释池内优先级，不是爆款或传播结果预测。</span>
        <span>不足时保持缺口，不跨类型补位，也不绕过门禁。</span>
        <span>完整诡计分析未来必须继续显示剧透警告。</span>
        <span>PERSONAL 与 PUBLIC_RESEARCH 权限及评分来源严格隔离。</span>
      </section>

      {notice === null ? null : (
        <div aria-live="polite" className="topic-notice">
          {notice}
        </div>
      )}

      {preview === null ? null : (
        <PreviewPanel
          busy={busy}
          onConfirm={() => void confirmPreview()}
          onDismiss={() => setPreview(null)}
          preview={preview}
        />
      )}

      <section className="topic-toolbar">
        <label>
          搜索候选
          <input
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
            placeholder="选题角度或中心问题"
            value={query}
          />
        </label>
        <label>
          资格
          <select
            onChange={(event) => {
              setEligibility((event.target.value || null) as TopicEligibilityState | null);
              setOffset(0);
            }}
            value={eligibility ?? ''}
          >
            <option value="">全部资格</option>
            {ELIGIBILITY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {ELIGIBILITY_LABELS.get(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select
            onChange={(event) => {
              setCandidateState((event.target.value || null) as TopicCandidateState | null);
              setOffset(0);
            }}
            value={candidateState ?? ''}
          >
            <option value="">全部状态</option>
            {STATE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {STATE_LABELS.get(value)}
              </option>
            ))}
          </select>
        </label>
        <div className="topic-batch">
          <span>已明确选择 {selectedItems.length}</span>
          <select
            aria-label="批量状态动作"
            onChange={(event) => setBatchAction(event.target.value as TopicStateAction)}
            value={batchAction}
          >
            <option value="LOCK">批量锁定</option>
            <option value="HOLD">批量暂缓</option>
            <option value="ARCHIVE">批量归档</option>
          </select>
          <button className="secondary-button" disabled={busy} onClick={previewBatch} type="button">
            预览批量操作
          </button>
        </div>
      </section>

      <section className="topic-main-grid">
        <div className="topic-list-panel">
          <header className="topic-panel-heading">
            <div>
              <p className="section-kicker">候选池</p>
              <h3>{loading ? '正在读取本地候选…' : `${workspace?.total ?? 0} 个结果`}</h3>
            </div>
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, workspace?.total ?? 0)}
            </span>
          </header>

          {poolEmpty ? (
            <div className="topic-empty">
              <strong>当前筛选下没有候选</strong>
              <span>
                若研究档案与阅读真实性已就绪，可先“预览本地候选生成”；配置不足会如实显示缺口。
              </span>
            </div>
          ) : (
            <div className="topic-list">
              {(workspace?.items ?? []).map((item) => (
                <article
                  className={
                    detail?.topicId === item.topicId
                      ? 'topic-list-item is-selected'
                      : 'topic-list-item'
                  }
                  key={item.topicId}
                >
                  <label aria-label={`选择 ${item.topicAngle}`}>
                    <input
                      checked={selectedSet.has(item.topicId)}
                      onChange={() => toggleSelection(item.topicId)}
                      type="checkbox"
                    />
                  </label>
                  <button onClick={() => void openTopic(item.topicId)} type="button">
                    <span className="topic-list-item__meta">
                      <span
                        className={`topic-status topic-status--${item.eligibility.toLowerCase()}`}
                      >
                        {ELIGIBILITY_LABELS.get(item.eligibility)}
                      </span>
                      <span>{STATE_LABELS.get(item.candidateState)}</span>
                      <span>{item.analysisMode}</span>
                    </span>
                    <strong>{item.topicAngle}</strong>
                    <small>{CONTENT_LABELS.get(item.contentType)}</small>
                    <span className="topic-score">
                      {item.rankingComplete
                        ? `总分 ${(item.totalScoreBasisPoints / 100).toFixed(2)}`
                        : '排序含 UNKNOWN'}
                    </span>
                  </button>
                </article>
              ))}
            </div>
          )}

          <div className="topic-pagination">
            <button
              className="secondary-button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              type="button"
            >
              上一页
            </button>
            <button
              className="secondary-button"
              disabled={loading || offset + PAGE_SIZE >= (workspace?.total ?? 0)}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              type="button"
            >
              下一页
            </button>
          </div>
        </div>

        <div className="topic-detail-panel">
          {detail === null ? (
            <div className="topic-empty">
              <strong>选择一个候选查看解释</strong>
              <span>这里会显示资格原因、五项排序、依赖主体、剧透级别和状态历史。</span>
            </div>
          ) : (
            <>
              <header className="topic-panel-heading">
                <div>
                  <p className="section-kicker">{CONTENT_LABELS.get(detail.contentType)}</p>
                  <h3>{detail.topicAngle}</h3>
                </div>
                <span className={`topic-status topic-status--${detail.eligibility.toLowerCase()}`}>
                  {ELIGIBILITY_LABELS.get(detail.eligibility)}
                </span>
              </header>
              <p className="topic-question">{detail.centralQuestion}</p>
              {detail.candidateJudgment === null ? null : (
                <p className="topic-judgment">{detail.candidateJudgment}</p>
              )}
              <dl className="topic-facts">
                <div>
                  <dt>分析权限</dt>
                  <dd>{detail.analysisMode}</dd>
                </div>
                <div>
                  <dt>剧透级别</dt>
                  <dd>{detail.spoilerLevel}</dd>
                </div>
                <div>
                  <dt>警告位置</dt>
                  <dd>
                    {detail.spoilerPolicy.warningRequired
                      ? detail.spoilerPolicy.warningPlacement
                      : '无需警告'}
                  </dd>
                </div>
                <div>
                  <dt>用户确认</dt>
                  <dd>
                    {detail.spoilerPolicy.userConfirmationRequired
                      ? '必须显式确认'
                      : '无需额外确认'}
                  </dd>
                </div>
                <div>
                  <dt>语义指纹</dt>
                  <dd>
                    <code>{detail.fingerprint.slice(0, 16)}</code>
                  </dd>
                </div>
                <div>
                  <dt>revision</dt>
                  <dd>{detail.revision}</dd>
                </div>
              </dl>

              <section className="topic-explanation">
                <h4>确定性资格</h4>
                <ul>
                  {detail.eligibilityReasonCodes.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {detail.requiredPublicLabels.length === 0 ? null : (
                  <p>公开资料标签：{detail.requiredPublicLabels.join('、')}</p>
                )}
              </section>

              <section className="topic-ranking" aria-label="五项可解释排序">
                <h4>五项可解释排序</h4>
                {detail.ranking.map((component) => (
                  <article key={component.type}>
                    <div>
                      <strong>{RANKING_LABELS.get(component.type)}</strong>
                      <span>{component.knowledgeState}</span>
                    </div>
                    <b>{basisPoints(component.valueBasisPoints)}</b>
                    <small>{component.reasonCodes.join(' · ')}</small>
                  </article>
                ))}
              </section>

              <section className="topic-subjects">
                <h4>受版本约束的主体</h4>
                {detail.subjects.map((subject) => (
                  <div key={`${subject.subjectType}-${subject.subjectId}`}>
                    <strong>{subject.role}</strong>
                    <span>
                      {subject.subjectType} · {subject.workId}
                      {subject.expressionForm === null ? '' : ` · ${subject.expressionForm}`}
                    </span>
                  </div>
                ))}
              </section>

              <div className="topic-button-row">
                {stateActions(detail.candidateState).map((action) => (
                  <button
                    className={action === 'ARCHIVE' ? 'danger-button' : 'secondary-button'}
                    disabled={busy}
                    key={action}
                    onClick={() => previewState(action)}
                    type="button"
                  >
                    {actionLabel(action)}
                  </button>
                ))}
                {detail.history.length === 0 ? null : (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void requestPreview({
                        expectedRevision: detail.revision,
                        kind: 'STATE_UNDO',
                        topicId: detail.topicId,
                      })
                    }
                    type="button"
                  >
                    撤销最近状态变更
                  </button>
                )}
              </div>

              <details className="topic-history">
                <summary>状态历史（{detail.history.length}）</summary>
                <ol>
                  {detail.history.map((event) => (
                    <li key={`${event.revision}-${event.createdAt}`}>
                      r{event.revision} · {event.action} · {event.fromState ?? '—'} →{' '}
                      {event.toState}
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
        </div>
      </section>

      <section className="quota-panel">
        <header className="topic-panel-heading">
          <div>
            <p className="section-kicker">首批 30 条组合计划</p>
            <h3>FIRST_30_V1 · 10 / 8 / 6 / 3 / 3</h3>
          </div>
          <span>{currentPlan?.status ?? '尚未生成'}</span>
        </header>
        <div className="quota-controls">
          <label>
            单作品最大暴露次数
            <input
              max={10}
              min={1}
              onChange={(event) => setMaxWorkExposure(Number(event.target.value))}
              type="number"
              value={maxWorkExposure}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void requestPreview({
                kind: 'QUOTA_PLAN',
                maxWorkExposure,
                profileId: PROFILE_ID,
              })
            }
            type="button"
          >
            预览配额计划
          </button>
        </div>
        {currentPlan === null ? (
          <div className="topic-empty">
            <strong>尚无当前计划</strong>
            <span>候选不足时会得到带逐类 shortfall 的 INCOMPLETE 计划，不会跨类补位。</span>
          </div>
        ) : (
          <>
            <PlanCard current plan={currentPlan} />
            <div className="quota-category-list">
              {currentPlan.categories.map((category) => (
                <QuotaCategory category={category} key={category.contentType} />
              ))}
            </div>
          </>
        )}
        {workspace?.planHistory.length ? (
          <details className="topic-plan-history">
            <summary>不可变计划历史（{workspace.planHistory.length}）</summary>
            <div>
              {workspace.planHistory.map((plan) => (
                <PlanCard key={plan.planVersionId} plan={plan} />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="topic-run-panel">
        <header className="topic-panel-heading">
          <div>
            <p className="section-kicker">本地生成运行</p>
            <h3>可恢复、可审计，外部请求恒为 0</h3>
          </div>
          <span>Scripted Mock only</span>
        </header>
        {(workspace?.recentGenerationRuns.length ?? 0) === 0 ? (
          <div className="topic-empty">
            <strong>尚无生成运行</strong>
            <span>真实 provider 路径未配置且保持禁用。</span>
          </div>
        ) : (
          <div className="topic-run-list">
            {workspace?.recentGenerationRuns.map((run) => (
              <article key={run.runId}>
                <div>
                  <strong>{run.status}</strong>
                  <span>{run.runId}</span>
                  <small>
                    候选 {run.resultCandidateCount} · 外部请求 {run.externalRequestCount} · r
                    {run.revision}
                  </small>
                </div>
                {run.status === 'RUNNING' || run.status === 'CANCEL_REQUESTED' ? (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void requestPreview({
                        expectedRevision: run.revision,
                        kind: 'CANCEL_GENERATION',
                        runId: run.runId,
                      })
                    }
                    type="button"
                  >
                    预览取消
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
