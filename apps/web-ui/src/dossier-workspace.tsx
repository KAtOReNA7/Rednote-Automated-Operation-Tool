import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  DesktopError,
  DossierBuildPreview,
  DossierDetailStateView,
  DossierListStateView,
  DossierVersionDiffView,
  PreviewDossierBuildInput,
} from '@mystery-operations/shared';

type DossierSubjectType = PreviewDossierBuildInput['subjectType'];

const SECTION_LABELS: Readonly<Record<string, string>> = {
  AWARDS: '奖项',
  BIBLIOGRAPHY: '书目信息',
  CREATORS: '创作者',
  IDENTITY: '身份',
  OPEN_CONFLICTS: '待处理冲突',
  PUBLICATION_HISTORY: '出版历史',
  RECEPTION_AND_DISCUSSION: '评价与讨论',
  RESEARCH_GAPS: '研究缺口',
  SERIES_AND_RELATIONSHIPS: '系列与关系',
  SYNOPSIS_AND_THEMES: '梗概与主题',
};

const READINESS_LABELS: Readonly<Record<string, string>> = {
  BUILD_REQUIRED: '需要重建',
  FACT_BLOCKED: '事实冲突阻断',
  INSUFFICIENT_COVERAGE: '覆盖不足',
  NOT_BUILT: '尚未构建',
  READY_FOR_CONTENT_BRIEF: '可进入内容简报',
  STALE: '版本已过期',
};

const ERROR_LABELS: Partial<Readonly<Record<DesktopError['code'], string>>> = {
  DOSSIER_CAPACITY_EXCEEDED: '当前资料量超过单次构建的安全上限。',
  DOSSIER_CONFIRMATION_INVALID: '确认令牌无效或已过期，请重新预览。',
  DOSSIER_CONFLICT: 'Dossier 状态已变化，请刷新后重试。',
  DOSSIER_INPUT_CHANGED: '依赖事实已变化，本次构建未发布，请重新预览。',
  DOSSIER_INVALID_CONTRACT: 'Dossier 数据不符合冻结合同。',
  DOSSIER_INVALID_PLAN: '构建计划无效，请重新预览。',
  DOSSIER_INVALID_REQUEST: '请求不符合有限 IPC 合同。',
  DOSSIER_NOT_FOUND: '没有找到该 Dossier 或对应研究对象。',
  DOSSIER_POLICY_STALE: '事实或覆盖率策略已更新，需要重新构建。',
  DOSSIER_STALE_REVISION: 'Dossier revision 已变化，请刷新后重试。',
};

function dossierError(error: DesktopError): string {
  return ERROR_LABELS[error.code] ?? error.message;
}

function readinessLabel(value: string): string {
  return READINESS_LABELS[value] ?? value;
}

function percentage(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)}%`;
}

function DossierBadge({
  kind,
}: {
  readonly kind: 'CONSENSUS' | 'DISPUTED' | 'GAP';
}): React.JSX.Element {
  const labels = {
    CONSENSUS: '共识',
    DISPUTED: '争议',
    GAP: '缺口',
  } as const;
  return (
    <span className={`dossier-badge dossier-badge--${kind.toLowerCase()}`}>{labels[kind]}</span>
  );
}

export function DossierWorkspace(): React.JSX.Element {
  const [list, setList] = useState<DossierListStateView | null>(null);
  const [detail, setDetail] = useState<DossierDetailStateView | null>(null);
  const [selectedDossierId, setSelectedDossierId] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState('IDENTITY');
  const [subjectId, setSubjectId] = useState('');
  const [subjectType, setSubjectType] = useState<DossierSubjectType>('WORK');
  const [preview, setPreview] = useState<DossierBuildPreview | null>(null);
  const [compareFrom, setCompareFrom] = useState<string>('');
  const [diff, setDiff] = useState<DossierVersionDiffView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async (): Promise<void> => {
    const method = window.rednoteDesktop?.listDossiers;
    if (method === undefined) {
      setLoading(false);
      setNotice('当前桌面桥接尚未提供 Research Dossier 能力。');
      return;
    }
    const result = await method({ limit: 50, offset: 0 });
    setLoading(false);
    if (!result.ok) {
      setNotice(dossierError(result.error));
      return;
    }
    setList(result.value);
    setNotice(null);
    setSelectedDossierId((current) => current ?? result.value.items[0]?.dossier.dossierId ?? null);
  }, []);

  const loadDetail = useCallback(async (dossierId: string): Promise<void> => {
    const method = window.rednoteDesktop?.getDossier;
    if (method === undefined) return;
    const result = await method({ dossierId, entryLimit: 100, entryOffset: 0 });
    if (!result.ok) {
      setNotice(dossierError(result.error));
      return;
    }
    setDetail(result.value);
    setSubjectId(result.value.dossier.subject.id);
    setSubjectType(result.value.dossier.subject.type);
    setSelectedSection(result.value.sections[0]?.section ?? 'IDENTITY');
    setCompareFrom(result.value.versions[1]?.versionId ?? '');
    setDiff(null);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedDossierId === null) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedDossierId);
  }, [loadDetail, selectedDossierId]);

  const refresh = async (): Promise<void> => {
    await loadList();
    if (selectedDossierId !== null) await loadDetail(selectedDossierId);
  };

  const previewBuild = async (): Promise<void> => {
    const method = window.rednoteDesktop?.previewDossierBuild;
    if (method === undefined || subjectId.trim().length === 0) {
      setNotice('请输入已有 Work、Expression 或 Edition 的 ID。');
      return;
    }
    setBusy(true);
    const result = await method({ subjectId: subjectId.trim(), subjectType });
    setBusy(false);
    if (result.ok) {
      setPreview(result.value);
      setNotice(null);
    } else {
      setNotice(dossierError(result.error));
    }
  };

  const confirmBuild = async (): Promise<void> => {
    const method = window.rednoteDesktop?.confirmDossierBuild;
    if (method === undefined || preview === null) return;
    setBusy(true);
    const result = await method({
      confirmation: 'START_DOSSIER_BUILD',
      planHash: preview.plan.planHash,
      previewHash: preview.previewHash,
      token: preview.token,
    });
    setBusy(false);
    setPreview(null);
    if (!result.ok) {
      setNotice(dossierError(result.error));
      return;
    }
    setSelectedDossierId(result.value.dossierId);
    setNotice(
      result.value.status === 'NO_OP'
        ? '输入未变化：已记录 NO_OP，未创建新版本。'
        : '构建已进入本地队列；外部请求 0，费用未发生。',
    );
    await refresh();
  };

  const cancelBuild = async (runId: string, expectedRevision: number): Promise<void> => {
    const method = window.rednoteDesktop?.cancelDossierBuild;
    if (method === undefined) return;
    const result = await method({
      confirmation: 'CANCEL_DOSSIER_BUILD',
      expectedRevision,
      runId,
    });
    if (!result.ok) {
      setNotice(dossierError(result.error));
      return;
    }
    setNotice('已记录协作取消请求；当前已发布版本不会被替换。');
    if (selectedDossierId !== null) await loadDetail(selectedDossierId);
  };

  const compareVersions = async (): Promise<void> => {
    const method = window.rednoteDesktop?.diffDossierVersions;
    const currentVersionId = detail?.dossier.currentVersionId;
    if (
      method === undefined ||
      detail === null ||
      currentVersionId === null ||
      currentVersionId === undefined
    ) {
      return;
    }
    const result = await method({
      dossierId: detail.dossier.dossierId,
      fromVersionId: compareFrom === '' ? null : compareFrom,
      toVersionId: currentVersionId,
    });
    if (result.ok) setDiff(result.value);
    else setNotice(dossierError(result.error));
  };

  const entries = useMemo(
    () => detail?.entries.filter((entry) => entry.section === selectedSection) ?? [],
    [detail, selectedSection],
  );
  const section = detail?.sections.find((item) => item.section === selectedSection) ?? null;
  const activeRuns =
    detail?.runs.filter((run) =>
      ['CONFIRMED', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(run.status),
    ) ?? [];

  return (
    <section aria-labelledby="dossier-title" className="dossier-workspace">
      <header className="dossier-header">
        <div>
          <p className="section-kicker">Issue 020 · Versioned research dossier</p>
          <h2 id="dossier-title">研究档案</h2>
          <p>把原子事实整理为可追溯、可重建的版本；Dossier 不替代事实裁决，也不会触发外部服务。</p>
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          刷新档案
        </button>
      </header>

      {notice === null ? null : (
        <div className="dossier-notice" role="status">
          {notice}
        </div>
      )}

      <div className="dossier-builder">
        <label>
          研究对象
          <select
            aria-label="Dossier subject type"
            onChange={(event) => setSubjectType(event.currentTarget.value as DossierSubjectType)}
            value={subjectType}
          >
            <option value="WORK">Work</option>
            <option value="EXPRESSION">Expression</option>
            <option value="EDITION">Edition</option>
          </select>
        </label>
        <label className="dossier-builder__id">
          对象 ID
          <input
            maxLength={128}
            onChange={(event) => setSubjectId(event.currentTarget.value)}
            placeholder="从书目目录复制已有 ID"
            value={subjectId}
          />
        </label>
        <button
          className="primary-button"
          disabled={busy || subjectId.trim().length === 0}
          onClick={() => void previewBuild()}
          type="button"
        >
          预览构建
        </button>
      </div>

      <div className="dossier-layout">
        <aside className="dossier-sidebar" aria-label="研究档案列表">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Local dossiers</p>
              <h3>版本索引</h3>
            </div>
            <span>{list?.total ?? 0}</span>
          </div>
          {loading ? (
            <p className="dossier-muted">正在读取本地索引…</p>
          ) : list?.items.length === 0 ? (
            <div className="empty-evidence">
              <strong>尚未构建 Dossier</strong>
              <p>选择已有书目实体并先预览；只有明确确认后才会加入本地队列。</p>
            </div>
          ) : (
            <div className="dossier-list">
              {list?.items.map(({ dossier, subjectLabel }) => (
                <button
                  aria-pressed={selectedDossierId === dossier.dossierId}
                  className="dossier-list__item"
                  key={dossier.dossierId}
                  onClick={() => setSelectedDossierId(dossier.dossierId)}
                  type="button"
                >
                  <span>{subjectLabel}</span>
                  <small>
                    {dossier.subject.type} · v{dossier.currentVersionNumber ?? '—'}
                  </small>
                  <em
                    className={`dossier-readiness dossier-readiness--${dossier.readiness.toLowerCase()}`}
                  >
                    {readinessLabel(dossier.readiness)}
                  </em>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="dossier-main">
          {detail === null ? (
            <div className="empty-evidence dossier-empty-detail">
              <strong>选择一份档案查看证据图谱</strong>
              <p>这里会显示当前版本、覆盖率、缺口、冲突、构建运行与版本差异。</p>
            </div>
          ) : (
            <>
              <div className="dossier-overview">
                <div>
                  <p className="section-kicker">
                    {detail.dossier.subject.type} · revision {detail.dossier.revision}
                  </p>
                  <h3>{detail.dossier.subject.id}</h3>
                  <p>
                    当前版本 v{detail.dossier.currentVersionNumber ?? '—'} · {detail.dossier.state}
                  </p>
                </div>
                <span
                  className={`dossier-readiness dossier-readiness--${detail.dossier.readiness.toLowerCase()}`}
                >
                  {readinessLabel(detail.dossier.readiness)}
                </span>
              </div>

              {detail.dossier.invalidationReasons.length === 0 ? null : (
                <div className="dossier-blocker">
                  <strong>重建原因</strong>
                  <span>{detail.dossier.invalidationReasons.join(' · ')}</span>
                </div>
              )}

              {detail.coverage === null ? (
                <div className="empty-evidence">
                  <strong>尚无覆盖率快照</strong>
                  <p>完成首个本地构建后才会生成版本化覆盖率证据。</p>
                </div>
              ) : (
                <div className="dossier-coverage" aria-label="Dossier coverage">
                  <article>
                    <span>整体覆盖</span>
                    <strong>{percentage(detail.coverage.overallBasisPoints)}</strong>
                  </article>
                  <article>
                    <span>必需事实</span>
                    <strong>{percentage(detail.coverage.requiredBasisPoints)}</strong>
                  </article>
                  <article>
                    <span>可选事实</span>
                    <strong>{percentage(detail.coverage.optionalBasisPoints)}</strong>
                  </article>
                  <article>
                    <span>缺口 / 阻断</span>
                    <strong>
                      {detail.coverage.gapCount} / {detail.coverage.blockedCount}
                    </strong>
                  </article>
                </div>
              )}

              <nav aria-label="Dossier sections" className="dossier-sections">
                {detail.sections.map((item) => (
                  <button
                    aria-current={selectedSection === item.section ? 'page' : undefined}
                    key={item.section}
                    onClick={() => setSelectedSection(item.section)}
                    type="button"
                  >
                    <span>{SECTION_LABELS[item.section] ?? item.section}</span>
                    <small>{percentage(item.coverageBasisPoints)}</small>
                  </button>
                ))}
              </nav>

              <section className="dossier-section-detail">
                <header>
                  <div>
                    <p className="section-kicker">{selectedSection}</p>
                    <h3>{SECTION_LABELS[selectedSection] ?? selectedSection}</h3>
                  </div>
                  <span>
                    {section?.verifiedCount ?? 0} verified · {section?.gapCount ?? 0} gaps
                  </span>
                </header>
                {entries.length === 0 ? (
                  <div className="empty-evidence">
                    <strong>本节没有可发布条目</strong>
                    <p>缺少事实不会被伪装为共识；请查看下方研究缺口。</p>
                  </div>
                ) : (
                  <div className="dossier-entry-list">
                    {entries.map((entry) => (
                      <article className="dossier-entry" key={entry.entryId}>
                        <header>
                          <div>
                            <DossierBadge kind={entry.entryKind} />
                            <strong>{entry.predicate}</strong>
                          </div>
                          <span>{entry.factStatus}</span>
                        </header>
                        <p>{entry.displayValue}</p>
                        <dl>
                          <div>
                            <dt>Claim</dt>
                            <dd>{entry.claimIds.join(' · ') || '—'}</dd>
                          </div>
                          <div>
                            <dt>Evaluation</dt>
                            <dd>{entry.factEvaluationIds.join(' · ') || '—'}</dd>
                          </div>
                          <div>
                            <dt>Evidence</dt>
                            <dd>{entry.evidenceIds.join(' · ') || '—'}</dd>
                          </div>
                          <div>
                            <dt>Source revision</dt>
                            <dd>{entry.sourceRevisionIds.join(' · ') || '—'}</dd>
                          </div>
                        </dl>
                        {entry.conflictId === null ? null : (
                          <button
                            className="text-button"
                            onClick={() =>
                              document
                                .getElementById('evidence-conflicts')
                                ?.scrollIntoView({ behavior: 'smooth' })
                            }
                            type="button"
                          >
                            去冲突处理 · {entry.conflictId}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <div className="dossier-lower-grid">
                <section className="dossier-subpanel">
                  <div className="panel-heading">
                    <div>
                      <p className="section-kicker">Research gaps</p>
                      <h3>真实缺口</h3>
                    </div>
                    <span>{detail.gaps.length}</span>
                  </div>
                  {detail.gaps.length === 0 ? (
                    <p className="dossier-muted">当前版本没有记录缺口。</p>
                  ) : (
                    <ul className="dossier-gap-list">
                      {detail.gaps.map((gap) => (
                        <li key={gap.gapId}>
                          <span>{SECTION_LABELS[gap.section] ?? gap.section}</span>
                          <strong>{gap.reasonCode}</strong>
                          <small>{gap.blocking ? '阻断 readiness' : '非阻断'}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="dossier-subpanel">
                  <div className="panel-heading">
                    <div>
                      <p className="section-kicker">Build runs</p>
                      <h3>本地构建</h3>
                    </div>
                    <span>{detail.runs.length}</span>
                  </div>
                  {detail.runs.length === 0 ? (
                    <p className="dossier-muted">尚无构建运行。</p>
                  ) : (
                    <div className="dossier-run-list">
                      {detail.runs.map((run) => (
                        <div key={run.runId}>
                          <span>
                            <strong>{run.status}</strong>
                            <small>
                              request {run.externalRequestCount} · {run.costState}
                            </small>
                          </span>
                          {activeRuns.some((item) => item.runId === run.runId) ? (
                            <button
                              className="secondary-button"
                              onClick={() => void cancelBuild(run.runId, run.revision)}
                              type="button"
                            >
                              取消
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <section className="dossier-version-panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">Immutable history</p>
                    <h3>版本比较</h3>
                  </div>
                  <span>{detail.versions.length} versions</span>
                </div>
                <div className="dossier-version-controls">
                  <label>
                    对比起点
                    <select
                      onChange={(event) => setCompareFrom(event.currentTarget.value)}
                      value={compareFrom}
                    >
                      <option value="">空版本</option>
                      {detail.versions
                        .filter((version) => version.versionId !== detail.dossier.currentVersionId)
                        .map((version) => (
                          <option key={version.versionId} value={version.versionId}>
                            v{version.versionNumber} · {version.readiness}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    onClick={() => void compareVersions()}
                    type="button"
                  >
                    比较当前版本
                  </button>
                </div>
                {diff === null ? null : (
                  <div className="dossier-diff" aria-live="polite">
                    <span>新增 {diff.addedSemanticKeys.length}</span>
                    <span>更新 {diff.updatedSemanticKeys.length}</span>
                    <span>移除 {diff.removedSemanticKeys.length}</span>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {preview === null ? null : (
        <div aria-modal="true" className="evidence-modal" role="dialog">
          <div>
            <p className="section-kicker">Dossier build preview</p>
            <h3>
              {preview.plan.noOp ? '输入未变化' : readinessLabel(preview.plan.readinessAfter)}
            </h3>
            <p>
              {preview.plan.buildMode} · Claim {preview.plan.counts.claimCount} · Evidence{' '}
              {preview.plan.counts.evidenceCount} · Gap {preview.plan.counts.gapCount}
            </p>
            <div className="dossier-preview-diff">
              <span>新增 {preview.plan.diff.addedSemanticKeys.length}</span>
              <span>更新 {preview.plan.diff.updatedSemanticKeys.length}</span>
              <span>移除 {preview.plan.diff.removedSemanticKeys.length}</span>
            </div>
            <p>
              预计本地写入 {preview.plan.estimatedLocalWrites} · 模型请求{' '}
              {preview.plan.estimatedModelRequests} · 费用 {preview.plan.budgetConclusion}
            </p>
            <p className="dossier-muted">
              确认后只进入 DOSSIER_BUILD_V1 本地队列；若输入已变化，当前版本保持不变。
            </p>
            <div className="evidence-actions">
              <button className="secondary-button" onClick={() => setPreview(null)} type="button">
                返回检查
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void confirmBuild()}
                type="button"
              >
                明确确认本地构建
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
