import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  DesktopError,
  EvidenceConflictActionPreview,
  EvidenceConflictView,
  EvidenceStateView,
  SourceProcessingPreview,
  SyntheticResearchIntakeDraft,
  SyntheticResearchIntakePreview,
  SyntheticResearchIntakeResult,
} from '@mystery-operations/shared';

import { DossierWorkspace } from './dossier-workspace.js';

const EMPTY_SYNTHETIC_DRAFT: SyntheticResearchIntakeDraft = Object.freeze({
  authorName: '',
  publicationDate: '',
  sourceText: '',
  sourceTitle: '',
  workTitle: '',
});

function errorText(error: DesktopError): string {
  const messages: Partial<Record<DesktopError['code'], string>> = {
    EVIDENCE_CONFIRMATION_EXPIRED: '确认已过期，请重新预览。',
    EVIDENCE_CONFIRMATION_INVALID: '确认与当前窗口或预览不匹配。',
    EVIDENCE_CONFLICT: '冲突状态已变化，请刷新后重试。',
    EVIDENCE_INVALID_REQUEST: '资料研究请求不符合有限合同。',
    EVIDENCE_INVALID_SOURCE: '来源或不可变版本不符合受控合同。',
    EVIDENCE_NOT_FOUND: '没有找到对应的来源、事实或冲突。',
    EVIDENCE_POLICY_BLOCKED: '当前能力、预算或事实政策不允许执行。',
    EVIDENCE_STALE_REVISION: '资料已更新，请刷新后重新预览。',
  };
  return messages[error.code] ?? error.message;
}

function statusLabel(status: string): string {
  const labels: Readonly<Record<string, string>> = {
    CONFLICTED: '有矛盾',
    FACT_BLOCKED: '事实阻断',
    INSUFFICIENT: '证据不足',
    NOT_EVALUATED: '未评估',
    REJECTED: '已拒绝',
    STALE_REVIEW_REQUIRED: '来源已更新',
    SUPPORTED_NOT_VERIFIED: '有支持，未验证',
    VERIFIED: '已验证',
  };
  return labels[status] ?? status;
}

function ConflictCard({
  conflict,
  onPreview,
}: {
  readonly conflict: EvidenceConflictView;
  readonly onPreview: (
    conflict: EvidenceConflictView,
    action: 'ACCEPT_CLAIM' | 'REOPEN' | 'UNDO',
    acceptedClaimId: string | null,
  ) => void;
}): React.JSX.Element {
  const active = ['FACT_BLOCKED', 'OPEN', 'REOPENED'].includes(conflict.state);
  return (
    <article className="evidence-conflict-card">
      <div>
        <p className="section-kicker">实质冲突 · r{conflict.revision}</p>
        <h3>{conflict.conflictId}</h3>
        <p>
          {conflict.claimLeftId} ↔ {conflict.claimRightId}
        </p>
      </div>
      <span className={active ? 'fact-status fact-status--blocked' : 'fact-status'}>
        {conflict.state}
      </span>
      <div className="evidence-actions">
        {active ? (
          <>
            <button
              className="secondary-button"
              onClick={() => onPreview(conflict, 'ACCEPT_CLAIM', conflict.claimLeftId)}
              type="button"
            >
              接受左侧事实
            </button>
            <button
              className="secondary-button"
              onClick={() => onPreview(conflict, 'ACCEPT_CLAIM', conflict.claimRightId)}
              type="button"
            >
              接受右侧事实
            </button>
          </>
        ) : (
          <>
            <button
              className="secondary-button"
              onClick={() => onPreview(conflict, 'UNDO', null)}
              type="button"
            >
              撤销决定
            </button>
            <button
              className="danger-button"
              onClick={() => onPreview(conflict, 'REOPEN', null)}
              type="button"
            >
              重新打开
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function ResearchPage(): React.JSX.Element {
  const [state, setState] = useState<EvidenceStateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<ReadonlySet<string>>(new Set());
  const [includeModelSteps, setIncludeModelSteps] = useState(false);
  const [processingPreview, setProcessingPreview] = useState<SourceProcessingPreview | null>(null);
  const [conflictPreview, setConflictPreview] = useState<EvidenceConflictActionPreview | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [syntheticBusy, setSyntheticBusy] = useState(false);
  const [syntheticDraft, setSyntheticDraft] =
    useState<SyntheticResearchIntakeDraft>(EMPTY_SYNTHETIC_DRAFT);
  const [syntheticPreview, setSyntheticPreview] = useState<SyntheticResearchIntakePreview | null>(
    null,
  );
  const [syntheticResult, setSyntheticResult] = useState<SyntheticResearchIntakeResult | null>(
    null,
  );

  const load = useCallback(async (): Promise<void> => {
    const method = window.rednoteDesktop?.getEvidenceState;
    if (method === undefined) {
      setLoading(false);
      setNotice('当前桌面桥接不支持资料证据功能。');
      return;
    }
    setLoading(true);
    const result = await method({ limit: 50, offset: 0 });
    setLoading(false);
    if (result.ok) {
      setState(result.value);
      setNotice(null);
    } else {
      setNotice(errorText(result.error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRevisionIds = useMemo(() => [...selectedSources].sort(), [selectedSources]);

  const toggleSource = (identity: string): void => {
    setSelectedSources((current) => {
      const next = new Set(current);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
  };

  const previewProcessing = async (): Promise<void> => {
    const method = window.rednoteDesktop?.previewSourceProcessing;
    if (method === undefined || selectedRevisionIds.length === 0) {
      setNotice('请先选择至少一个 Source revision。');
      return;
    }
    const result = await method({
      includeModelSteps,
      sourceRevisionIds: selectedRevisionIds,
    });
    if (result.ok) {
      setProcessingPreview(result.value);
      setNotice(null);
    } else {
      setNotice(errorText(result.error));
    }
  };

  const confirmProcessing = async (): Promise<void> => {
    const method = window.rednoteDesktop?.confirmSourceProcessing;
    if (method === undefined || processingPreview === null) return;
    const result = await method({
      confirmation: 'START_SOURCE_PROCESSING',
      planHash: processingPreview.planHash,
      previewHash: processingPreview.previewHash,
      token: processingPreview.token,
    });
    setProcessingPreview(null);
    if (result.ok) {
      setState(result.value);
      setNotice('本地分类与事实调和已完成；外部请求 0，费用未发生。');
    } else {
      setNotice(errorText(result.error));
    }
  };

  const cancelProcessing = async (runId: string, expectedRevision: number): Promise<void> => {
    const method = window.rednoteDesktop?.cancelSourceProcessing;
    if (method === undefined) return;
    const result = await method({
      confirmation: 'CANCEL_SOURCE_PROCESSING',
      expectedRevision,
      runId,
    });
    if (result.ok) {
      setState(result.value);
      setNotice('已记录协作取消请求；不会启动新的外部调用。');
    } else {
      setNotice(errorText(result.error));
    }
  };

  const updateSyntheticDraft = (field: keyof SyntheticResearchIntakeDraft, value: string): void => {
    setSyntheticDraft((current) => ({ ...current, [field]: value }));
    setSyntheticPreview(null);
  };

  const previewSyntheticIntake = async (): Promise<void> => {
    const method = window.rednoteDesktop?.previewSyntheticResearchIntake;
    if (method === undefined) {
      setNotice('当前桌面桥接尚未提供合成本地研究输入。');
      return;
    }
    setSyntheticBusy(true);
    try {
      const result = await method({ draft: syntheticDraft });
      if (result.ok) {
        setSyntheticPreview(result.value);
        setNotice(null);
      } else {
        setNotice(errorText(result.error));
      }
    } finally {
      setSyntheticBusy(false);
    }
  };

  const confirmSyntheticIntake = async (): Promise<void> => {
    const method = window.rednoteDesktop?.confirmSyntheticResearchIntake;
    if (method === undefined || syntheticPreview === null) return;
    setSyntheticBusy(true);
    try {
      const result = await method({
        confirmation: 'CREATE_SYNTHETIC_LOCAL_RESEARCH',
        inputHash: syntheticPreview.inputHash,
        previewHash: syntheticPreview.previewHash,
        token: syntheticPreview.token,
      });
      setSyntheticPreview(null);
      if (result.ok) {
        setSyntheticResult(result.value);
        setNotice('合成研究输入已本地持久化；模型、外部请求和费用均为 0。');
        await load();
      } else {
        setNotice(errorText(result.error));
      }
    } finally {
      setSyntheticBusy(false);
    }
  };

  const previewConflict = async (
    conflict: EvidenceConflictView,
    action: 'ACCEPT_CLAIM' | 'REOPEN' | 'UNDO',
    acceptedClaimId: string | null,
  ): Promise<void> => {
    const method = window.rednoteDesktop?.previewEvidenceConflict;
    if (method === undefined) return;
    const result = await method({
      acceptedClaimId,
      action,
      conflictId: conflict.conflictId,
    });
    if (result.ok) {
      setConflictPreview(result.value);
      setReason('');
    } else {
      setNotice(errorText(result.error));
    }
  };

  const confirmConflict = async (): Promise<void> => {
    const method = window.rednoteDesktop?.confirmEvidenceConflict;
    if (method === undefined || conflictPreview === null || reason.trim().length === 0) return;
    const result = await method({
      confirmation: 'APPLY_FACT_CONFLICT_DECISION',
      previewHash: conflictPreview.previewHash,
      reason,
      token: conflictPreview.token,
    });
    setConflictPreview(null);
    if (result.ok) {
      setNotice(`冲突已更新为 ${result.value.state}；决定已追加到审计链。`);
      await load();
    } else {
      setNotice(errorText(result.error));
    }
  };

  if (loading) {
    return (
      <div aria-live="polite" className="state-card">
        <span aria-hidden="true" className="loading-mark" />
        <h2>正在读取本地来源与证据</h2>
        <p>只读取有限 DTO，不会连接任何外部服务。</p>
      </div>
    );
  }

  return (
    <div className="research-page">
      <section className="research-hero">
        <div>
          <p className="section-kicker">Issue 019 · Source → Claim → Evidence</p>
          <h2>让每一条关键事实都能回到原文</h2>
          <p>
            官方一手来源或两个确认独立的二级来源才能验证事实。中文摘要帮助阅读，但永远不能替代原文证据。
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} type="button">
          刷新本地状态
        </button>
      </section>

      {notice === null ? null : (
        <div className="catalog-notice" role="status">
          {notice}
        </div>
      )}

      <section aria-labelledby="synthetic-intake-title" className="synthetic-intake">
        <header>
          <div>
            <p className="section-kicker">本地闭环验证 · 上游研究输入</p>
            <h3 id="synthetic-intake-title">手工录入完全合成的最小研究材料</h3>
            <p>
              这里只建立 Work、SourceRevision 与 3 条可追溯原子事实。Dossier、S1
              权限、Topic、Brief、Draft 和 Fact Mapping 仍需在各自工作台逐步人工确认。
            </p>
          </div>
          <div aria-label="执行边界" className="synthetic-intake__labels">
            <span>手工输入</span>
            <span>完全合成</span>
            <span>本地持久化</span>
            <span>模型未使用</span>
            <span>外部请求 0</span>
          </div>
        </header>
        <div className="synthetic-intake__grid">
          <label>
            <span>虚构作品名</span>
            <input
              maxLength={200}
              onChange={(event) => updateSyntheticDraft('workTitle', event.target.value)}
              placeholder="例：自行虚构的推理作品名"
              value={syntheticDraft.workTitle}
            />
          </label>
          <label>
            <span>虚构作者名</span>
            <input
              maxLength={120}
              onChange={(event) => updateSyntheticDraft('authorName', event.target.value)}
              placeholder="不得使用真实作者"
              value={syntheticDraft.authorName}
            />
          </label>
          <label>
            <span>虚构出版日期</span>
            <input
              onChange={(event) => updateSyntheticDraft('publicationDate', event.target.value)}
              type="date"
              value={syntheticDraft.publicationDate}
            />
          </label>
          <label>
            <span>合成来源标题</span>
            <input
              maxLength={200}
              onChange={(event) => updateSyntheticDraft('sourceTitle', event.target.value)}
              placeholder="例：本地合成作品资料卡"
              value={syntheticDraft.sourceTitle}
            />
          </label>
          <label className="synthetic-intake__source">
            <span>短原文（必须逐字包含作品名、作者名和 YYYY-MM-DD 日期）</span>
            <textarea
              maxLength={2000}
              onChange={(event) => updateSyntheticDraft('sourceText', event.target.value)}
              placeholder={'作品名：你的虚构作品\n作者：你的虚构作者\n出版日期：2026-01-02'}
              rows={6}
              value={syntheticDraft.sourceText}
            />
          </label>
        </div>
        <div className="evidence-actions">
          <button
            className="primary-button"
            disabled={syntheticBusy}
            onClick={() => void previewSyntheticIntake()}
            type="button"
          >
            预览 3 条手工事实
          </button>
          <span>预览不写业务数据；确认后只创建上游研究记录。</span>
        </div>
        {syntheticPreview === null ? null : (
          <div aria-live="polite" className="synthetic-intake__preview">
            <div>
              <strong>二次确认：完全合成的本地输入</strong>
              <p>
                {syntheticPreview.claimLocators.map((item) => item.predicate).join(' / ')} ·
                预计本地写入 {syntheticPreview.estimatedLocalWrites} · 模型{' '}
                {syntheticPreview.estimatedModelRequests} · 外部请求{' '}
                {syntheticPreview.estimatedExternalRequests} · 费用未发生
              </p>
              <ul>
                {syntheticPreview.claimLocators.map((item) => (
                  <li key={item.predicate}>
                    {item.predicate} · code points {item.startCodePoint}–{item.endCodePoint} · “
                    {item.excerpt}”
                  </li>
                ))}
              </ul>
            </div>
            <div className="evidence-actions">
              <button onClick={() => setSyntheticPreview(null)} type="button">
                取消
              </button>
              <button
                className="primary-button"
                disabled={syntheticBusy}
                onClick={() => void confirmSyntheticIntake()}
                type="button"
              >
                确认创建上游研究记录
              </button>
            </div>
          </div>
        )}
        {syntheticResult === null ? null : (
          <div aria-live="polite" className="synthetic-intake__result">
            <strong>上游输入已保存，可关闭并重开项目后继续</strong>
            <code>workId: {syntheticResult.workId}</code>
            <code>sourceRevisionId: {syntheticResult.sourceRevisionId}</code>
            <span>
              {syntheticResult.claims
                .map((claim) => `${claim.predicate}=${claim.status}`)
                .join(' · ')}
            </span>
            <p>
              下一步：在下方构建 WORK Dossier；到书库将该合成作品设为 S1；再去选题池生成并 lock
              Topic，最后在内容生产页手工完成 Brief、Draft 与 LOCAL_MANUAL Fact Mapping。
            </p>
          </div>
        )}
      </section>

      <DossierWorkspace />

      <section aria-label="事实证据计数" className="evidence-metrics">
        {Object.entries(state?.counts ?? {}).map(([label, value]) => (
          <article className="metric-card" key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
            <span>本地记录</span>
          </article>
        ))}
      </section>

      <section className="research-grid">
        <article className="evidence-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Source inbox</p>
              <h3>来源与不可变 revision</h3>
            </div>
            <span>{state?.sources.length ?? 0} 条</span>
          </div>
          {(state?.inbox.length ?? 0) > 0 ? (
            <div className="evidence-inbox" aria-label="待分类来源上下文">
              <p className="section-kicker">待分类 Fetch / Clip 上下文</p>
              {state?.inbox.map((item) => (
                <div key={`${item.originKind}:${item.originRecordId}`}>
                  <strong>{item.title}</strong>
                  <small>
                    {item.originKind} · {item.truthStatus} / {item.factStatus} · {item.suggestedUse}
                  </small>
                </div>
              ))}
              <p>这些记录尚不是 Source 或 Evidence，必须由用户显式接纳。</p>
            </div>
          ) : null}
          {state?.sources.length === 0 ? (
            <div className="empty-evidence">
              <strong>还没有已接纳的 Source</strong>
              <p>
                Search、Fetch 和 Browser Clip 仍保持未验证状态；必须由用户明确接纳后才进入这里。
              </p>
            </div>
          ) : (
            <div className="evidence-source-list">
              {state?.sources.map((source) => {
                const identity = `${source.sourceId}:${source.revision}`;
                return (
                  <label className="evidence-source" key={identity}>
                    <input
                      checked={selectedSources.has(identity)}
                      onChange={() => toggleSource(identity)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{source.title}</strong>
                      <small>
                        {source.originKind} · r{source.revision} · {source.language}
                      </small>
                      <small>
                        {source.authorityTier} · {source.useClass} · {source.independenceState}
                      </small>
                      <small>
                        lineage {source.lineageGroup} · {source.availability}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="processing-controls">
            <label>
              <input
                checked={includeModelSteps}
                onChange={(event) => setIncludeModelSteps(event.currentTarget.checked)}
                type="checkbox"
              />
              可选结构化提取与中文摘要
            </label>
            <button
              className="primary-button"
              disabled={selectedRevisionIds.length === 0}
              onClick={() => void previewProcessing()}
              type="button"
            >
              预览处理计划
            </button>
          </div>
        </article>

        <article className="evidence-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Atomic facts</p>
              <h3>Claim、原文与评估</h3>
            </div>
            <span>{state?.claims.length ?? 0} 条</span>
          </div>
          {state?.claims.length === 0 ? (
            <div className="empty-evidence">
              <strong>尚无原子事实</strong>
              <p>纯手工路径不依赖模型；无 locator 的模型记忆不会出现在这里。</p>
            </div>
          ) : (
            <div className="evidence-claim-list">
              {state?.claims.map((claim) => (
                <section className="evidence-claim" key={claim.claimId}>
                  <header>
                    <div>
                      <strong>{claim.predicate}</strong>
                      <small>
                        {claim.subjectType} · {claim.subjectId}
                      </small>
                    </div>
                    <span
                      className={
                        claim.evaluationStatus === 'FACT_BLOCKED'
                          ? 'fact-status fact-status--blocked'
                          : 'fact-status'
                      }
                    >
                      {statusLabel(claim.evaluationStatus)}
                    </span>
                  </header>
                  <code>{JSON.stringify(claim.value)}</code>
                  {claim.evidence.map((evidence) => (
                    <div className="evidence-pair" key={evidence.evidenceId}>
                      <div>
                        <span>原文 · {evidence.language}</span>
                        <blockquote>{evidence.excerpt}</blockquote>
                      </div>
                      <div>
                        <span>中文摘要 · 非证据</span>
                        <p>{evidence.summaryZh ?? '尚未添加中文摘要'}</p>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="evidence-panel" id="evidence-conflicts">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Conflict guard</p>
            <h3>冲突与 FACT_BLOCKED</h3>
          </div>
          <span>{state?.conflicts.length ?? 0} 项</span>
        </div>
        {state?.conflicts.length === 0 ? (
          <div className="empty-evidence">
            <strong>当前没有实质冲突</strong>
            <p>不同 scope、兼容日期精度和同一 canonical entity 的别名不会被误报。</p>
          </div>
        ) : (
          <div className="evidence-conflict-list">
            {state?.conflicts.map((conflict) => (
              <ConflictCard
                conflict={conflict}
                key={conflict.conflictId}
                onPreview={(item, action, accepted) => void previewConflict(item, action, accepted)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="evidence-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Processing history</p>
            <h3>计划、进度与费用状态</h3>
          </div>
        </div>
        {state?.processingRuns.length === 0 ? (
          <div className="empty-evidence">
            <strong>还没有处理历史</strong>
            <p>计划只有在显式确认后执行，不会由 Search、Fetch、Clip、启动或定时器自动触发。</p>
          </div>
        ) : (
          <div className="processing-history">
            {state?.processingRuns.map((run) => (
              <div key={run.runId}>
                <strong>{run.runId}</strong>
                <span>{run.status}</span>
                <span>{run.currentStep ?? '无活动步骤'}</span>
                <span>
                  请求 {run.externalRequestCount} · {run.costState}
                </span>
                {['CONFIRMED', 'PAUSED', 'PLANNED', 'RUNNING'].includes(run.status) ? (
                  <button
                    className="secondary-button"
                    onClick={() => void cancelProcessing(run.runId, run.revision)}
                    type="button"
                  >
                    取消处理
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {processingPreview === null ? null : (
        <section className="evidence-modal" role="dialog" aria-modal="true">
          <div>
            <p className="section-kicker">处理计划预览</p>
            <h3>{processingPreview.readiness}</h3>
            <p>{processingPreview.steps.join(' → ')}</p>
            <p>
              Source revision {processingPreview.sourceRevisionIds.length} · 外部请求上限{' '}
              {processingPreview.estimatedExternalRequests} · 本地写入上限{' '}
              {processingPreview.estimatedLocalWrites} · 费用 {processingPreview.estimatedFee}
            </p>
            {processingPreview.readiness === 'MODEL_UNCONFIGURED' ? (
              <p className="budget-warning">
                structured capability 或模型执行未配置；不会降级、猜测或发送请求。
              </p>
            ) : null}
            <div className="evidence-actions">
              <button
                className="secondary-button"
                onClick={() => setProcessingPreview(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={processingPreview.readiness !== 'LOCAL_READY'}
                onClick={() => void confirmProcessing()}
                type="button"
              >
                明确确认本地执行
              </button>
            </div>
          </div>
        </section>
      )}

      {conflictPreview === null ? null : (
        <section className="evidence-modal" role="dialog" aria-modal="true">
          <div>
            <p className="section-kicker">冲突决定预览 · r{conflictPreview.revision}</p>
            <h3>{conflictPreview.action}</h3>
            <p>{conflictPreview.conflictId}</p>
            <p>
              受影响 Claim {conflictPreview.affected.claimIds.join('、')} · Evidence{' '}
              {conflictPreview.affected.evidenceIds.length} · Source revision{' '}
              {conflictPreview.affected.sourceRevisionIds.join('、') || '无'}
            </p>
            <ul>
              {conflictPreview.beforeEvaluations.map((before) => {
                const after = conflictPreview.afterEvaluations.find(
                  (item) => item.claimId === before.claimId,
                );
                return (
                  <li key={before.claimId}>
                    {before.claimId}: {before.status} → {after?.status ?? 'NOT_EVALUATED'}
                  </li>
                );
              })}
            </ul>
            <label className="reason-field">
              决定理由
              <textarea
                maxLength={2_000}
                onChange={(event) => setReason(event.currentTarget.value)}
                value={reason}
              />
            </label>
            <div className="evidence-actions">
              <button
                className="secondary-button"
                onClick={() => setConflictPreview(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={reason.trim().length === 0}
                onClick={() => void confirmConflict()}
                type="button"
              >
                确认并写入审计链
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
