import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  FactMappingActionPreview,
  FactMappingClaimChainView,
  FactMappingDecisionPreview,
  FactMappingDetailView,
  FactMappingDisplayStatus,
  FactMappingListView,
  PreviewFactMappingActionInput,
  PreviewFactMappingDecisionInput,
} from '@mystery-operations/shared';

const PAGE_SIZE = 12;
type FactMappingMode = Extract<PreviewFactMappingActionInput, { readonly kind: 'START' }>['mode'];
type FactMappingRun = FactMappingDetailView['runs'][number];

const STATUS_LABELS: Readonly<Record<FactMappingDisplayStatus, string>> = {
  AWAITING_REVIEW: '待人工复核',
  FACT_BLOCKED: '关键事实阻塞',
  PASS: '本项通过',
  STALE: '依赖已变化',
  UNCHECKED: '尚未检查',
};

const KIND_LABELS: Readonly<Record<string, string>> = {
  AMBIGUOUS: '待判断',
  ANALYTICAL_JUDGMENT: '分析判断',
  FACT: '事实',
  LABEL_OR_WARNING: '标签 / 警告',
  MIXED: '事实与观点混合',
  OPINION: '观点',
  PERSONAL_EXPERIENCE: '第一人称体验（Issue 027）',
  RHETORICAL: '修辞',
};

function executionId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function active(run: FactMappingRun): boolean {
  return ['PLANNED', 'QUEUED', 'RUNNING'].includes(run.status);
}

export function FactMappingWorkbench(): React.JSX.Element {
  const [list, setList] = useState<FactMappingListView | null>(null);
  const [detail, setDetail] = useState<FactMappingDetailView | null>(null);
  const [chain, setChain] = useState<FactMappingClaimChainView | null>(null);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<FactMappingDisplayStatus | null>(null);
  const [mode, setMode] = useState<FactMappingMode>('LOCAL_MANUAL');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('正在读取可检查的 DraftVersion…');
  const [actionPreview, setActionPreview] = useState<FactMappingActionPreview | null>(null);
  const [decisionPreview, setDecisionPreview] = useState<FactMappingDecisionPreview | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [candidateByStatement, setCandidateByStatement] = useState<
    Readonly<Record<string, string>>
  >({});

  const loadDetail = useCallback(async (draftId: string) => {
    const method = window.rednoteDesktop?.getFactMappingCheck;
    if (method === undefined) {
      setMessage('当前桌面桥接尚未提供事实映射详情。');
      return;
    }
    const result = await method({ draftId });
    if (!result.ok) {
      setMessage(`读取事实映射失败：${result.error.code}`);
      return;
    }
    setDetail(result.value);
    setChain(null);
    setActionPreview(null);
    setDecisionPreview(null);
    setMessage(
      result.value.status === 'UNCHECKED'
        ? '该 Draft 尚未执行 FACT_MAPPING。'
        : `已打开事实映射检查 v${result.value.checkVersion?.versionNumber ?? 0}。`,
    );
  }, []);

  const loadList = useCallback(async () => {
    const method = window.rednoteDesktop?.getFactMappingChecks;
    if (method === undefined) {
      setMessage('当前桌面桥接尚未提供事实映射列表。');
      return;
    }
    const result = await method({ limit: PAGE_SIZE, offset, status });
    if (!result.ok) {
      setMessage(`读取 READY Draft 失败：${result.error.code}`);
      return;
    }
    setList(result.value);
    if (
      result.value.items.length > 0 &&
      !result.value.items.some(({ draftId }) => draftId === detail?.draftId)
    ) {
      const first = result.value.items[0];
      if (first !== undefined) void loadDetail(first.draftId);
    }
    if (result.value.total === 0) {
      setDetail(null);
      setMessage('当前筛选下没有 READY Draft。');
    }
  }, [detail?.draftId, loadDetail, offset, status]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const previewStart = useCallback(async () => {
    if (detail === null) return;
    const method = window.rednoteDesktop?.previewFactMappingAction;
    if (method === undefined) return;
    setBusy(true);
    try {
      const result = await method({ draftId: detail.draftId, kind: 'START', mode });
      if (!result.ok) {
        setMessage(`检查预览失败：${result.error.code}`);
        return;
      }
      setActionPreview(result.value);
      setDecisionPreview(null);
      setMessage('检查计划已绑定当前 DraftVersion、候选集和依赖 hash；尚未执行。');
    } finally {
      setBusy(false);
    }
  }, [detail, mode]);

  const confirmStart = useCallback(async () => {
    if (actionPreview?.kind !== 'START') return;
    const method = window.rednoteDesktop?.confirmFactMappingAction;
    if (method === undefined) return;
    setBusy(true);
    try {
      const result = await method({
        confirmation: 'APPLY_FACT_MAPPING_ACTION',
        executionId: executionId('fact-mapping'),
        kind: 'START',
        previewHash: actionPreview.previewHash,
        token: actionPreview.token,
      });
      if (!result.ok) {
        setMessage(`启动被拒绝：${result.error.code}`);
        return;
      }
      setActionPreview(null);
      setMessage('事实映射检查已进入本地队列；模型辅助模式最多发出 1 次受控请求。');
      await loadDetail(result.value.run.draftId);
      await loadList();
    } finally {
      setBusy(false);
    }
  }, [actionPreview, loadDetail, loadList]);

  const previewCancel = useCallback(async (run: FactMappingRun) => {
    const method = window.rednoteDesktop?.previewFactMappingAction;
    if (method === undefined) return;
    const result = await method({
      executionId: run.executionId,
      expectedRevision: run.revision,
      kind: 'CANCEL',
    });
    if (!result.ok) {
      setMessage(`取消预览失败：${result.error.code}`);
      return;
    }
    setActionPreview(result.value);
    setDecisionPreview(null);
  }, []);

  const confirmCancel = useCallback(async () => {
    if (actionPreview?.kind !== 'CANCEL') return;
    const method = window.rednoteDesktop?.confirmFactMappingAction;
    if (method === undefined) return;
    const result = await method({
      confirmation: 'APPLY_FACT_MAPPING_ACTION',
      executionId: actionPreview.preview.executionId,
      kind: 'CANCEL',
      previewHash: actionPreview.previewHash,
      token: actionPreview.token,
    });
    if (!result.ok) {
      setMessage(`取消失败：${result.error.code}`);
      return;
    }
    setActionPreview(null);
    setMessage(
      result.value.run.status === 'RUNNING'
        ? '取消请求已送达；若模型请求可能已发送，结果会保守进入 AMBIGUOUS。'
        : '检查已在发送前取消。',
    );
    if (detail !== null) await loadDetail(detail.draftId);
  }, [actionPreview, detail, loadDetail]);

  const previewDecision = useCallback(async (input: PreviewFactMappingDecisionInput) => {
    const method = window.rednoteDesktop?.previewFactMappingDecision;
    if (method === undefined) return;
    const result = await method(input);
    if (!result.ok) {
      setMessage(`人工复核预览失败：${result.error.code}`);
      return;
    }
    setDecisionPreview(result.value);
    setActionPreview(null);
    setMessage('人工 decision 预览已生成；确认后将创建新的不可变检查版本。');
  }, []);

  const confirmDecision = useCallback(async () => {
    if (decisionPreview === null || detail === null) return;
    const method = window.rednoteDesktop?.confirmFactMappingDecision;
    if (method === undefined) return;
    setBusy(true);
    try {
      const result = await method({
        confirmation: 'APPLY_FACT_MAPPING_ACTION',
        executionId: executionId('fact-decision'),
        kind: decisionPreview.preview.kind,
        previewHash: decisionPreview.previewHash,
        token: decisionPreview.token,
      });
      if (!result.ok) {
        setMessage(`人工复核确认失败：${result.error.code}`);
        return;
      }
      setDetail(result.value.detail);
      setDecisionPreview(null);
      setMessage('已追加人工 decision 和新的不可变 FACT_MAPPING 版本。');
      await loadList();
    } finally {
      setBusy(false);
    }
  }, [decisionPreview, detail, loadList]);

  const openChain = useCallback(async (statementId: string) => {
    const method = window.rednoteDesktop?.getFactMappingClaimChain;
    if (method === undefined) return;
    const result = await method({ statementId });
    if (!result.ok) {
      setMessage(`证据链读取失败：${result.error.code}`);
      return;
    }
    setChain(result.value);
  }, []);

  const activeRuns = useMemo(() => detail?.runs.filter((run) => active(run)) ?? [], [detail]);
  const canConfirmModel =
    actionPreview?.kind !== 'START' ||
    actionPreview.preview.plan.mode !== 'MODEL_ASSISTED' ||
    (actionPreview.preview.plan.capabilityState === 'SUPPORTED' &&
      actionPreview.preview.plan.budgetState === 'AVAILABLE' &&
      actionPreview.preview.plan.credentialState === 'AVAILABLE');

  return (
    <section className="fact-mapping-workbench" aria-labelledby="fact-mapping-title">
      <header className="fact-mapping-hero">
        <div>
          <p className="section-kicker">M3 · FACT_MAPPING V1</p>
          <h2 id="fact-mapping-title">事实映射工作台</h2>
          <p>
            把当前不可变 DraftVersion 的公开文字拆成 Statement，并回溯到 current
            Claim、FactEvaluation、Evidence 与
            SourceRevision。这里不会改写文案，也不会自动搜索或补事实。
          </p>
        </div>
        <div className="fact-mapping-metrics" aria-label="事实映射摘要">
          <span>
            <strong>{list?.total ?? 0}</strong>READY Draft
          </span>
          <span>
            <strong>{detail?.statements.length ?? 0}</strong>Statement
          </span>
          <span>
            <strong>{detail?.rollup?.counts.BLOCKING_KEY_FACT ?? 0}</strong>关键阻塞
          </span>
        </div>
      </header>

      <div className="fact-mapping-boundaries" aria-label="事实映射边界">
        <span>事实映射通过只代表本项检查通过，不代表整体质量、审批或可发布</span>
        <span>观点和分析判断不要求 Claim，但第一人称与评分仍待 Issue 027 检查</span>
        <span>缺少关键事实来源将产生 FACT_BLOCKED；系统不会自动补写或搜索</span>
        <span>中文摘要不是证据；模型建议不是事实结论</span>
        <span>数字、日期、排名和奖项必须匹配类型化 Claim 与 current 证据链</span>
        <span>修改文案会产生新 DraftVersion，需要重新检查</span>
      </div>

      <div className="fact-mapping-toolbar">
        <label>
          状态筛选
          <select
            onChange={(event) => {
              setOffset(0);
              setStatus(
                event.target.value === '' ? null : (event.target.value as FactMappingDisplayStatus),
              );
            }}
            value={status ?? ''}
          >
            <option value="">全部</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          检查模式
          <select onChange={(event) => setMode(event.target.value as FactMappingMode)} value={mode}>
            <option value="LOCAL_MANUAL">纯本地手工（0 次模型请求）</option>
            <option value="MODEL_ASSISTED">模型辅助候选（最多 1 次）</option>
          </select>
        </label>
        <button
          disabled={busy || detail === null}
          onClick={() => void previewStart()}
          type="button"
        >
          预览事实检查
        </button>
        <button
          onClick={() =>
            document.getElementById('copy-workbench-title')?.scrollIntoView({ behavior: 'smooth' })
          }
          type="button"
        >
          返回文案编辑
        </button>
      </div>

      <div className="fact-mapping-layout">
        <aside className="fact-mapping-list">
          <h3>可检查 Draft</h3>
          {list?.items.length === 0 ? <p className="fact-empty">暂无符合条件的 Draft。</p> : null}
          <ol>
            {list?.items.map((item) => (
              <li key={item.draftId}>
                <button
                  className={detail?.draftId === item.draftId ? 'is-current' : ''}
                  onClick={() => void loadDetail(item.draftId)}
                  type="button"
                >
                  <strong>{STATUS_LABELS[item.status]}</strong>
                  <span>
                    Draft v{item.versionNumber} · {item.profileId}
                  </span>
                  <small>{item.workIds.join(' / ')}</small>
                </button>
              </li>
            ))}
          </ol>
          <div className="fact-pagination">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              type="button"
            >
              上一页
            </button>
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, list?.total ?? 0)}
            </span>
            <button
              disabled={offset + PAGE_SIZE >= (list?.total ?? 0)}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              type="button"
            >
              下一页
            </button>
          </div>
        </aside>

        <main className="fact-mapping-detail">
          {detail === null ? (
            <p className="fact-empty">选择一个 READY Draft 查看事实映射。</p>
          ) : (
            <>
              <section className="fact-summary">
                <div>
                  <p className="section-kicker">Immutable DraftVersion</p>
                  <h3>
                    Draft v{detail.versionNumber} · {STATUS_LABELS[detail.status]}
                  </h3>
                  <p>
                    {detail.profileId} · Work {detail.workIds.join(' / ')} · Brief{' '}
                    {detail.briefVersionId}
                  </p>
                </div>
                <div className={`fact-status fact-status--${detail.status.toLowerCase()}`}>
                  {detail.status}
                </div>
              </section>

              {detail.invalidationReasons.length > 0 ? (
                <div className="fact-alert" role="alert">
                  已失效：{detail.invalidationReasons.join(' / ')}。历史仍保留，系统不会自动重跑。
                </div>
              ) : null}

              <section className="fact-artifacts">
                <h4>公开 artifact 覆盖</h4>
                <div>
                  {detail.artifacts.map((artifact) => (
                    <span key={`${artifact.artifactKind}:${artifact.artifactId}`}>
                      <strong>{artifact.artifactKind}</strong>
                      {artifact.coveredStatementCount} 条 · {artifact.codePointLength} code points
                    </span>
                  ))}
                </div>
              </section>

              <section className="fact-runs">
                <h4>运行进度与历史</h4>
                {detail.runs.length === 0 ? <p>尚无运行。</p> : null}
                <ol>
                  {detail.runs.map((run) => (
                    <li key={run.runId}>
                      <span>
                        {run.mode} · {run.status} · 外部请求 {run.externalRequestCount}
                      </span>
                      <small>
                        {run.reasonCode ?? '无错误码'} · revision {run.revision}
                      </small>
                      {active(run) ? (
                        <button onClick={() => void previewCancel(run)} type="button">
                          预览取消
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="fact-statements">
                <h4>按 artifact 顺序的 Statement</h4>
                {detail.statements.map((statement) => {
                  const selectedCandidate = candidateByStatement[statement.statementId] ?? '';
                  return (
                    <article key={statement.statementId}>
                      <header>
                        <span>
                          #{statement.statementOrder + 1} · {statement.artifactKind}
                        </span>
                        <strong>{KIND_LABELS[statement.kind] ?? statement.kind}</strong>
                        <span>{statement.disposition}</span>
                      </header>
                      <blockquote>{statement.fragment}</blockquote>
                      <dl>
                        <div>
                          <dt>Locator</dt>
                          <dd>
                            {statement.startCodePoint}–{statement.endCodePoint}
                          </dd>
                        </div>
                        <div>
                          <dt>Materiality</dt>
                          <dd>{statement.materiality}</dd>
                        </div>
                        <div>
                          <dt>Domain</dt>
                          <dd>{statement.domain}</dd>
                        </div>
                        <div>
                          <dt>Relation</dt>
                          <dd>{statement.relation ?? '未映射'}</dd>
                        </div>
                        <div>
                          <dt>Compatibility</dt>
                          <dd>{statement.compatibilityReasonCode ?? '未计算'}</dd>
                        </div>
                        <div>
                          <dt>FactPolicy</dt>
                          <dd>{statement.factPolicyReasonCode ?? '未计算'}</dd>
                        </div>
                      </dl>
                      {statement.protectedSignals.length > 0 ? (
                        <p className="fact-signals">
                          Protected signals：{statement.protectedSignals.join(' / ')}
                        </p>
                      ) : null}
                      <div className="fact-review-actions">
                        <button
                          onClick={() =>
                            void previewDecision({
                              draftId: detail.draftId,
                              expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                              kind: 'CONFIRM_CLASSIFICATION',
                              reason: decisionReason.trim() || null,
                              statementId: statement.statementId,
                            })
                          }
                          type="button"
                        >
                          确认分类
                        </button>
                        <button
                          onClick={() =>
                            void previewDecision({
                              domain: 'NOT_APPLICABLE',
                              draftId: detail.draftId,
                              expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                              kind: 'RECLASSIFY',
                              materiality: 'NOT_APPLICABLE',
                              reason: decisionReason.trim() || null,
                              statementId: statement.statementId,
                              statementKind: 'OPINION',
                            })
                          }
                          type="button"
                        >
                          改为观点
                        </button>
                        <button
                          onClick={() =>
                            void previewDecision({
                              domain: 'NOT_APPLICABLE',
                              draftId: detail.draftId,
                              expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                              kind: 'RECLASSIFY',
                              materiality: 'NOT_APPLICABLE',
                              reason: decisionReason.trim() || null,
                              statementId: statement.statementId,
                              statementKind: 'ANALYTICAL_JUDGMENT',
                            })
                          }
                          type="button"
                        >
                          改为分析
                        </button>
                        <button
                          onClick={() =>
                            void previewDecision({
                              domain: 'OTHER',
                              draftId: detail.draftId,
                              expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                              kind: 'RECLASSIFY',
                              materiality: 'SUPPORTING_FACT',
                              reason: decisionReason.trim() || null,
                              statementId: statement.statementId,
                              statementKind: 'FACT',
                            })
                          }
                          type="button"
                        >
                          改为事实
                        </button>
                        <button
                          disabled={statement.endCodePoint - statement.startCodePoint < 2}
                          onClick={() =>
                            void previewDecision({
                              draftId: detail.draftId,
                              expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                              kind: 'SPLIT',
                              reason: decisionReason.trim() || null,
                              splitCodePoint:
                                statement.startCodePoint +
                                Math.floor((statement.endCodePoint - statement.startCodePoint) / 2),
                              statementId: statement.statementId,
                            })
                          }
                          type="button"
                        >
                          在中点拆分
                        </button>
                        <button
                          onClick={() =>
                            void previewDecision({
                              draftId: detail.draftId,
                              expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                              kind: 'REOPEN',
                              reason: decisionReason.trim() || null,
                              statementId: statement.statementId,
                            })
                          }
                          type="button"
                        >
                          Reopen
                        </button>
                      </div>
                      {statement.kind === 'FACT' ? (
                        <div className="fact-map-row">
                          <select
                            aria-label={`Statement ${statement.statementOrder + 1} Claim candidate`}
                            onChange={(event) =>
                              setCandidateByStatement((current) => ({
                                ...current,
                                [statement.statementId]: event.target.value,
                              }))
                            }
                            value={selectedCandidate}
                          >
                            <option value="">选择 allowlisted Claim</option>
                            {detail.candidates.map((candidate) => (
                              <option key={candidate.claimId} value={candidate.claimId}>
                                {candidate.subjectId} · {candidate.predicate} ·{' '}
                                {candidate.valueSummary}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={selectedCandidate === ''}
                            onClick={() =>
                              void previewDecision({
                                claimId: selectedCandidate,
                                draftId: detail.draftId,
                                expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                                kind: 'MAP_CLAIM',
                                reason: decisionReason.trim() || null,
                                relation: 'EXACT',
                                statementId: statement.statementId,
                              })
                            }
                            type="button"
                          >
                            映射并本地校验
                          </button>
                          <button
                            disabled={statement.claimId === null}
                            onClick={() =>
                              void previewDecision({
                                draftId: detail.draftId,
                                expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                                kind: 'UNMAP_CLAIM',
                                reason: decisionReason.trim() || null,
                                statementId: statement.statementId,
                              })
                            }
                            type="button"
                          >
                            撤销映射
                          </button>
                          <button
                            disabled={statement.claimId === null}
                            onClick={() => void openChain(statement.statementId)}
                            type="button"
                          >
                            展开证据链
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </section>

              <label className="fact-reason">
                人工复核理由（protected signal 降为非事实时必填）
                <textarea
                  maxLength={500}
                  onChange={(event) => setDecisionReason(event.target.value)}
                  value={decisionReason}
                />
              </label>

              {chain !== null ? (
                <section className="fact-chain">
                  <h4>Claim → FactEvaluation → Evidence → SourceRevision</h4>
                  <p>
                    {chain.claim.subjectType}:{chain.claim.subjectId} · {chain.claim.predicate} ·{' '}
                    {chain.claim.valueType} {chain.claim.valueSummary}
                  </p>
                  <p>
                    Evaluation {chain.evaluation.status} · {chain.evaluation.policyVersion} ·{' '}
                    {chain.evaluation.createdAt}
                  </p>
                  {chain.conflicts.map((conflict) => (
                    <p className="fact-alert" key={conflict.conflictId}>
                      Conflict {conflict.conflictId} · {conflict.state}
                    </p>
                  ))}
                  <ol>
                    {chain.evidence.map((evidence, index) => (
                      <li key={`${evidence.source.revisionId}:${index}`}>
                        <strong>{evidence.relation}</strong> · {evidence.source.authorityTier} ·{' '}
                        {evidence.source.independence} · lineage{' '}
                        {evidence.source.lineageGroup ?? '未知'}
                        <blockquote>{evidence.excerpt}</blockquote>
                        <p>
                          {evidence.source.title} · {evidence.source.publisherOrSite ?? '未知站点'}{' '}
                          · revision {evidence.source.revisionId} · {evidence.source.availability}
                        </p>
                        {evidence.summaryZh !== null ? (
                          <p className="fact-non-evidence">非证据中文摘要：{evidence.summaryZh}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <section className="fact-history">
                <h4>不可变版本、input diff 与失效原因</h4>
                <ol>
                  {detail.history.map((version, index) => (
                    <li key={version.versionId}>
                      <span>
                        v{version.versionNumber} · {version.status}
                        {version.current ? ' · current' : ''}
                      </span>
                      <small>
                        input {version.inputHash.slice(0, 12)} · dependency{' '}
                        {version.dependencyHash.slice(0, 12)} ·{' '}
                        {version.reasonCodes.join(' / ') || '无原因'}
                      </small>
                      {index > 0 && detail.statements[0] !== undefined ? (
                        <button
                          onClick={() =>
                            void previewDecision({
                              draftId: detail.draftId,
                              expectedRevision: detail.checkVersion?.decisionRevision ?? 0,
                              kind: 'UNDO',
                              reason: decisionReason.trim() || null,
                              statementId: detail.statements.at(0)?.statementId ?? '',
                              targetVersionId: version.versionId,
                            })
                          }
                          type="button"
                        >
                          撤销到此版本
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </main>
      </div>

      {actionPreview !== null ? (
        <section className="fact-confirmation" aria-live="polite">
          <div>
            <h3>{actionPreview.kind === 'START' ? '检查计划预览' : '取消预览'}</h3>
            {actionPreview.kind === 'START' ? (
              <p>
                artifact {actionPreview.preview.plan.artifactCount} · code points{' '}
                {actionPreview.preview.plan.inputCodePointCount} · protected signals{' '}
                {actionPreview.preview.plan.protectedSignalCount} · candidates{' '}
                {actionPreview.preview.plan.candidateClaimCount} · 最大模型请求{' '}
                {actionPreview.preview.plan.maximumModelRequests}
                <br />
                capability {actionPreview.preview.plan.capabilityState} · cache{' '}
                {actionPreview.preview.plan.cacheState} · budget{' '}
                {actionPreview.preview.plan.budgetState} · credential{' '}
                {actionPreview.preview.plan.credentialState}
              </p>
            ) : (
              <p>
                execution {actionPreview.preview.executionId} · revision{' '}
                {actionPreview.preview.expectedRevision}
              </p>
            )}
          </div>
          <button
            disabled={busy || !canConfirmModel}
            onClick={() => void (actionPreview.kind === 'START' ? confirmStart() : confirmCancel())}
            type="button"
          >
            {canConfirmModel ? '显式确认' : '模型能力 / 预算 / 凭据未就绪'}
          </button>
        </section>
      ) : null}

      {decisionPreview !== null ? (
        <section className="fact-confirmation" aria-live="polite">
          <div>
            <h3>人工 decision 预览</h3>
            <p>
              {decisionPreview.preview.kind} · {decisionPreview.preview.before.disposition} →{' '}
              {decisionPreview.preview.after.disposition} · 聚合预计{' '}
              {decisionPreview.preview.expectedStatus}
            </p>
            <small>
              expected revision {decisionPreview.preview.expectedRevision} · token
              单次、短期并绑定当前窗口
            </small>
          </div>
          <button disabled={busy} onClick={() => void confirmDecision()} type="button">
            确认追加不可变版本
          </button>
        </section>
      ) : null}

      <footer className="fact-status-line" aria-live="polite">
        {message} {activeRuns.length > 0 ? `· ${activeRuns.length} 个活动检查` : ''}
      </footer>
    </section>
  );
}
