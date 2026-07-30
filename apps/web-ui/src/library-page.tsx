import { useCallback, useEffect, useState } from 'react';

import type {
  CatalogActionPreview,
  CatalogDiscoveryPreview,
  CatalogSummaryView,
  CatalogWorkDetail,
  DesktopError,
} from '@mystery-operations/shared';
import { AuthenticityLibrary } from './authenticity-library.js';

function errorText(error: DesktopError): string {
  const messages: Partial<Record<DesktopError['code'], string>> = {
    CATALOG_CONFIRMATION_EXPIRED: '确认已过期，请重新预览。',
    CATALOG_CONFIRMATION_INVALID: '确认与当前窗口或预览不匹配。',
    CATALOG_CONFLICT: '当前状态已变化，请刷新后重试。',
    CATALOG_ENTITY_NOT_FOUND: '未找到该书目实体。',
    CATALOG_INVALID_REQUEST: '书目操作参数无效。',
    CATALOG_STALE_REVISION: '书目已被更新，请刷新后重试。',
  };
  return messages[error.code] ?? error.message;
}

function ActionPreviewCard({
  preview,
  onConfirm,
  onDismiss,
}: {
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
  readonly preview: CatalogActionPreview;
}): React.JSX.Element {
  return (
    <section className="catalog-confirmation" aria-live="polite">
      <div>
        <p className="section-kicker">变更预览 · {preview.kind}</p>
        <h3>请核对影响范围</h3>
      </div>
      <dl>
        {Object.entries(preview.summary).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{Array.isArray(value) ? value.join('、') : value}</dd>
          </div>
        ))}
      </dl>
      <div className="catalog-actions">
        <button className="secondary-button" onClick={onDismiss} type="button">
          取消
        </button>
        <button className="primary-button" onClick={onConfirm} type="button">
          确认执行
        </button>
      </div>
    </section>
  );
}

export function LibraryPage(): React.JSX.Element {
  const [summary, setSummary] = useState<CatalogSummaryView | null>(null);
  const [selected, setSelected] = useState<CatalogWorkDetail | null>(null);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [discoveryPreview, setDiscoveryPreview] = useState<CatalogDiscoveryPreview | null>(null);
  const [actionPreview, setActionPreview] = useState<CatalogActionPreview | null>(null);
  const [lastDecisionId, setLastDecisionId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const bridge = window.rednoteDesktop;
    if (bridge?.getCatalogState === undefined) {
      setNotice('当前桌面桥接不支持书目库。');
      return;
    }
    const result = await bridge.getCatalogState({ limit: 25, offset, query });
    if (result.ok) {
      setSummary(result.value);
      setNotice(null);
    } else {
      setNotice(errorText(result.error));
    }
  }, [offset, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const openWork = async (workId: string): Promise<void> => {
    const method = window.rednoteDesktop?.getCatalogWork;
    if (method === undefined) return;
    const result = await method({ workId });
    if (result.ok) {
      setSelected(result.value);
      setMergeTarget('');
    } else {
      setNotice(errorText(result.error));
    }
  };

  const previewDiscovery = async (): Promise<void> => {
    const method = window.rednoteDesktop?.previewCatalogDiscovery;
    if (method === undefined) return;
    setBusy(true);
    const result = await method({
      batchSize: 50,
      maxObservations: 500,
      maxRuntimeMs: 60_000,
      originKinds: ['SEARCH_CANDIDATE', 'FETCH_DOCUMENT', 'BROWSER_CLIP_CANDIDATE'],
      purpose: 'PILOT_CONTENT',
    });
    setBusy(false);
    if (result.ok) {
      setDiscoveryPreview(result.value);
    } else {
      setNotice(errorText(result.error));
    }
  };

  const confirmDiscovery = async (): Promise<void> => {
    const method = window.rednoteDesktop?.confirmCatalogDiscovery;
    if (method === undefined || discoveryPreview === null) return;
    setBusy(true);
    const result = await method({
      confirmation: 'START_BIBLIOGRAPHY_DISCOVERY',
      expectedRevision: discoveryPreview.run.revision,
      previewHash: discoveryPreview.previewHash,
      token: discoveryPreview.token,
    });
    setBusy(false);
    setDiscoveryPreview(null);
    if (result.ok) {
      setNotice('发现任务已进入本地队列；全过程不会发起外部请求。');
      await load();
    } else {
      setNotice(errorText(result.error));
    }
  };

  const cancelRun = async (): Promise<void> => {
    const method = window.rednoteDesktop?.cancelCatalogDiscovery;
    const run = summary?.latestRun;
    if (method === undefined || run === null || run === undefined) return;
    const result = await method({
      confirmation: 'CANCEL_BIBLIOGRAPHY_DISCOVERY',
      expectedRevision: run.revision,
      runId: run.runId,
    });
    if (result.ok) {
      setNotice('已请求取消本地发现任务。');
      await load();
    } else {
      setNotice(errorText(result.error));
    }
  };

  const previewMerge = async (): Promise<void> => {
    const method = window.rednoteDesktop?.previewCatalogWorkMerge;
    const duplicate = summary?.works.find((work) => work.workId === mergeTarget);
    if (method === undefined || selected === null || duplicate === undefined) {
      setNotice('请选择一个有效的重复 Work。');
      return;
    }
    const result = await method({
      duplicateRevision: duplicate.revision,
      duplicateWorkId: duplicate.workId,
      survivorRevision: selected.revision,
      survivorWorkId: selected.workId,
    });
    if (result.ok) setActionPreview(result.value);
    else setNotice(errorText(result.error));
  };

  const previewSplit = async (): Promise<void> => {
    const method = window.rednoteDesktop?.previewCatalogWorkSplit;
    const expression = selected?.expressions[0];
    if (method === undefined || selected === null || expression === undefined) {
      setNotice('当前 Work 没有可拆分的 Expression。');
      return;
    }
    const result = await method({
      expressionIds: [expression.expressionId],
      newCanonicalTitle: `${expression.title ?? selected.canonicalTitle}（拆分）`,
      sourceRevision: selected.revision,
      sourceWorkId: selected.workId,
    });
    if (result.ok) setActionPreview(result.value);
    else setNotice(errorText(result.error));
  };

  const previewUndo = async (): Promise<void> => {
    const method = window.rednoteDesktop?.previewCatalogUndo;
    if (method === undefined || lastDecisionId === null) return;
    const result = await method({ decisionId: lastDecisionId });
    if (result.ok) setActionPreview(result.value);
    else setNotice(errorText(result.error));
  };

  const confirmAction = async (): Promise<void> => {
    if (actionPreview === null) return;
    const bridge = window.rednoteDesktop;
    const method =
      actionPreview.kind === 'MERGE_WORKS'
        ? bridge?.confirmCatalogWorkMerge
        : actionPreview.kind === 'SPLIT_WORK'
          ? bridge?.confirmCatalogWorkSplit
          : bridge?.confirmCatalogUndo;
    if (method === undefined) return;
    setBusy(true);
    const result = await method({
      confirmation: 'APPLY_CATALOG_DECISION',
      previewHash: actionPreview.previewHash,
      token: actionPreview.token,
    });
    setBusy(false);
    setActionPreview(null);
    if (result.ok) {
      setLastDecisionId(result.value.decisionId);
      setSelected(null);
      setNotice(`已记录可审计决策 ${result.value.decisionId}。`);
      await load();
    } else {
      setNotice(errorText(result.error));
    }
  };

  const runActive = ['CONFIRMED', 'INTERRUPTED', 'PREVIEWED', 'RUNNING'].includes(
    summary?.latestRun?.status ?? '',
  );

  return (
    <div className="catalog-page">
      <AuthenticityLibrary />
      <section className="catalog-hero">
        <div>
          <p className="section-kicker">Issue 018 · 本地书目发现</p>
          <h2>从线索到可追溯书目</h2>
          <p>
            Work / Expression / Edition 分层保存；候选默认是未验证观察，不会成为事实或自动影响门禁。
          </p>
        </div>
        <div className="catalog-actions">
          <button className="secondary-button" onClick={() => void load()} type="button">
            刷新
          </button>
          {runActive ? (
            <button className="danger-button" onClick={() => void cancelRun()} type="button">
              取消任务
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void previewDiscovery()}
              type="button"
            >
              预览发现计划
            </button>
          )}
        </div>
      </section>

      <div className="catalog-trust-note">
        <strong>本地、零外部调用</strong>
        <span>仅消费已持久化候选；AI 标识、版权风险及出版关系都不参与门禁、评分或排期。</span>
      </div>

      {notice === null ? null : <p className="catalog-notice">{notice}</p>}

      {discoveryPreview === null ? null : (
        <section className="catalog-confirmation">
          <div>
            <p className="section-kicker">启动前确认</p>
            <h3>{discoveryPreview.originCount} 条本地候选</h3>
            <p>外部请求估算：0 · synthetic：否 · 计划将在 {discoveryPreview.expiresAt} 过期</p>
          </div>
          <div className="catalog-strata">
            {discoveryPreview.profile.strata.map((stratum) => (
              <span key={stratum.stratumId}>
                {stratum.label} {stratum.required ? '必需' : '观察'}
              </span>
            ))}
          </div>
          <div className="catalog-actions">
            <button
              className="secondary-button"
              onClick={() => setDiscoveryPreview(null)}
              type="button"
            >
              返回
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void confirmDiscovery()}
              type="button"
            >
              确认进入本地队列
            </button>
          </div>
        </section>
      )}

      {actionPreview === null ? null : (
        <ActionPreviewCard
          onConfirm={() => void confirmAction()}
          onDismiss={() => setActionPreview(null)}
          preview={actionPreview}
        />
      )}

      <section className="catalog-metrics" aria-label="书目统计">
        {[
          ['Work', summary?.counts.works ?? 0],
          ['Expression', summary?.counts.expressions ?? 0],
          ['Edition', summary?.counts.editions ?? 0],
          ['观察', summary?.counts.observations ?? 0],
          ['待复核', summary?.counts.openReviewCases ?? 0],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <div className="catalog-layout">
        <section className="catalog-panel">
          <div className="catalog-panel-heading">
            <div>
              <p className="section-kicker">书目列表</p>
              <h3>Work</h3>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setOffset(0);
                void load();
              }}
            >
              <input
                aria-label="搜索书目"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索规范题名…"
                value={query}
              />
            </form>
          </div>
          <div className="catalog-work-list">
            {summary?.works.map((work) => (
              <button
                className={
                  selected?.workId === work.workId ? 'catalog-work is-selected' : 'catalog-work'
                }
                key={work.workId}
                onClick={() => void openWork(work.workId)}
                type="button"
              >
                <span>
                  <strong>{work.canonicalTitle}</strong>
                  <small>
                    {work.state} · rev {work.revision}
                  </small>
                </span>
                <span>
                  {work.expressionCount} E / {work.editionCount} 版
                </span>
              </button>
            ))}
            {summary?.works.length === 0 ? <p className="catalog-empty">暂无书目。</p> : null}
          </div>
          <div className="catalog-pagination">
            <button
              className="secondary-button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 25))}
              type="button"
            >
              上一页
            </button>
            <span>偏移 {offset}</span>
            <button
              className="secondary-button"
              disabled={(summary?.works.length ?? 0) < 25}
              onClick={() => setOffset(offset + 25)}
              type="button"
            >
              下一页
            </button>
          </div>
        </section>

        <section className="catalog-panel">
          <div className="catalog-panel-heading">
            <div>
              <p className="section-kicker">实体详情</p>
              <h3>{selected?.canonicalTitle ?? '选择一个 Work'}</h3>
            </div>
            <span className="unverified-badge">UNVERIFIED</span>
          </div>
          {selected === null ? (
            <p className="catalog-empty">选择左侧书目查看 Expression、Edition、别名与来源关系。</p>
          ) : (
            <>
              <div className="catalog-entity-tree">
                {selected.expressions.map((expression) => (
                  <article key={expression.expressionId}>
                    <strong>{expression.title ?? '未命名 Expression'}</strong>
                    <span>
                      {expression.kind} · {expression.language ?? '语言未知'}
                    </span>
                    {expression.editions.map((edition) => (
                      <div key={edition.editionId}>
                        <span>{edition.label ?? edition.publisher ?? '未命名 Edition'}</span>
                        <small>
                          {edition.identifiers
                            .map((item) => `${item.namespace}:${item.value}`)
                            .join(' · ') || '无强标识'}
                        </small>
                      </div>
                    ))}
                  </article>
                ))}
              </div>
              <div className="catalog-provenance">
                <strong>别名</strong>
                <span>
                  {selected.aliases.map((alias) => `${alias.kind}: ${alias.raw}`).join(' · ') ||
                    '暂无别名'}
                </span>
                <strong>观察与 provenance</strong>
                <span>
                  {selected.observations
                    .map(
                      (observation) =>
                        `${observation.originKind} · ${observation.truthStatus}/${observation.factStatus} · ${observation.fieldProvenanceCount} 字段`,
                    )
                    .join('；') || '暂无关联观察'}
                </span>
                <strong>作者 / 机构关系</strong>
                <span>
                  {selected.relations
                    .map((relation) => `${relation.role}: ${relation.agentName}`)
                    .join(' · ') || '暂无关系'}
                </span>
                <strong>出版 / 授权关系</strong>
                <span>
                  {selected.publicationRelationships
                    .map(
                      (relation) =>
                        `${relation.role}: ${relation.subjectAgentName} → ${
                          relation.objectAgentName ?? 'UNKNOWN'
                        } (${relation.verificationState})`,
                    )
                    .join(' · ') || '暂无待核验关系'}
                </span>
              </div>
              <div className="catalog-decision-tools">
                <select
                  aria-label="选择重复 Work"
                  onChange={(event) => setMergeTarget(event.target.value)}
                  value={mergeTarget}
                >
                  <option value="">选择待合并 Work…</option>
                  {summary?.works
                    .filter((work) => work.workId !== selected.workId)
                    .map((work) => (
                      <option key={work.workId} value={work.workId}>
                        {work.canonicalTitle}
                      </option>
                    ))}
                </select>
                <button
                  className="secondary-button"
                  onClick={() => void previewMerge()}
                  type="button"
                >
                  预览合并
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void previewSplit()}
                  type="button"
                >
                  预览拆分
                </button>
                <button
                  className="secondary-button"
                  disabled={lastDecisionId === null}
                  onClick={() => void previewUndo()}
                  type="button"
                >
                  撤销上次决策
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="catalog-panel">
        <div className="catalog-panel-heading">
          <div>
            <p className="section-kicker">覆盖与缺口</p>
            <h3>DiscoveryPlan 分层</h3>
          </div>
          <span>{summary?.latestRun?.status ?? '尚未运行'}</span>
        </div>
        <div className="catalog-coverage">
          {summary?.coverage.map((item) => (
            <article key={item.stratumId}>
              <div>
                <strong>{item.label}</strong>
                <span>
                  {item.required ? '必需层' : '观察层'} ·{' '}
                  {item.synthetic ? 'SYNTHETIC' : '真实本地候选'}
                </span>
              </div>
              <strong>
                {item.observationCount} / {item.plannedObservations}
              </strong>
              <small>{item.gapReason ?? '无已记录缺口'}</small>
              <small>
                未解析 {item.unresolvedCount} · 待复核 {item.reviewCount} · 冲突{' '}
                {item.conflictCount} · 无效标识 {item.invalidIdentifierCount}
              </small>
              <small>
                自动关联 {item.exactLinkCount} · 人工决策 {item.manualDecisionCount} · provenance{' '}
                {item.provenanceCompleteCount}/{item.observationCount} · 去重前后{' '}
                {item.preResolutionCount}/{item.postResolutionCount}
              </small>
            </article>
          ))}
          {(summary?.coverage.length ?? 0) === 0 ? (
            <p className="catalog-empty">创建发现计划后，这里会显示分层覆盖和显式缺口原因。</p>
          ) : null}
        </div>
      </section>

      <section className="catalog-panel">
        <div className="catalog-panel-heading">
          <div>
            <p className="section-kicker">人工复核</p>
            <h3>保守消歧队列</h3>
          </div>
          <span>题名/作者相似不会自动合并</span>
        </div>
        <div className="catalog-review-list">
          {summary?.reviewCases.map((item) => (
            <article key={item.caseId}>
              <strong>{item.outcome}</strong>
              <span>
                {item.entityType} · {item.candidateEntityId ?? '无候选实体'}
              </span>
              <small>{item.caseId}</small>
            </article>
          ))}
          {(summary?.reviewCases.length ?? 0) === 0 ? (
            <p className="catalog-empty">当前没有待人工复核的实体候选。</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
