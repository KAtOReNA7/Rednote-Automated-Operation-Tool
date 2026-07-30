import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AuthenticityActionPreview,
  AuthenticityLibraryView,
  AuthenticityWorkDetail,
  DesktopError,
  PreviewAuthenticityActionInput,
} from '@mystery-operations/shared';

const PROFILE_ID = 'primary';
const PAGE_SIZE = 25;

const READING_OPTIONS = [
  {
    confidence: 'CLEAR',
    label: 'R1 · 读过且记忆明确',
    state: 'R1_READ_CLEAR',
    summary: '可使用第一人称体验与个人评分；可核验事实仍受研究档案约束。',
  },
  {
    confidence: 'PARTIAL',
    label: 'R2 · 读过但记忆模糊',
    state: 'R2_READ_FUZZY',
    summary: '只可使用当前逐条重新确认的个人观点。',
  },
  {
    confidence: 'UNKNOWN',
    label: 'R3 · 读过但无法确认细节',
    state: 'R3_READ_UNCONFIRMED_DETAILS',
    summary: '不生成具体个人体验；研究就绪后仅可做资料分析。',
  },
  {
    confidence: 'NOT_APPLICABLE',
    label: 'S1 · 仅公开资料研究',
    state: 'S1_RESEARCH_ONLY',
    summary: '不代表亲自读过；研究就绪后仅可做“公开资料整理”。',
  },
  {
    confidence: 'NOT_APPLICABLE',
    label: 'S2 · 资料不足或冲突',
    state: 'S2_RESEARCH_INSUFFICIENT',
    summary: '当前不能进入内容生产。',
  },
  {
    confidence: 'UNKNOWN',
    label: '未分类',
    state: 'UNCLASSIFIED',
    summary: '等待用户明确分类；不会自动降级为 S1。',
  },
] as const;

const CONFIDENCE_BY_STATE = {
  R1_READ_CLEAR: ['CLEAR'],
  R2_READ_FUZZY: ['PARTIAL', 'FADED'],
  R3_READ_UNCONFIRMED_DETAILS: ['FADED', 'UNKNOWN'],
  S1_RESEARCH_ONLY: ['NOT_APPLICABLE'],
  S2_RESEARCH_INSUFFICIENT: ['NOT_APPLICABLE'],
  UNCLASSIFIED: ['UNKNOWN'],
} as const;

const PERMISSION_LABELS = {
  ALLOWED: '允许',
  ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY: '仅限逐条确认观点',
  BLOCKED: '阻止',
  RESEARCH_ONLY: '仅资料分析',
  STALE_REVIEW_REQUIRED: '已失效，需复核',
} as const;

type ReadingStateCode = (typeof READING_OPTIONS)[number]['state'];
type MemoryConfidence = (typeof CONFIDENCE_BY_STATE)[keyof typeof CONFIDENCE_BY_STATE][number];

function errorText(error: DesktopError): string {
  const labels: Partial<Record<DesktopError['code'], string>> = {
    AUTHENTICITY_ASSERTION_NOT_FOUND: '未找到该观点确认记录。',
    AUTHENTICITY_CONFIRMATION_INVALID: '确认已过期、已使用或不属于当前窗口，请重新预览。',
    AUTHENTICITY_CONFLICT: '本地状态发生冲突，请刷新后重试。',
    AUTHENTICITY_INVALID_CONTRACT: '输入不符合阅读真实性合同。',
    AUTHENTICITY_INVALID_REQUEST: '阅读真实性操作参数无效。',
    AUTHENTICITY_POLICY_BLOCKED: '当前阅读状态或研究就绪度不允许这项操作。',
    AUTHENTICITY_PROFILE_NOT_FOUND: '未找到本地用户档案。',
    AUTHENTICITY_READING_STATE_NOT_FOUND: '尚无可撤销的阅读状态。',
    AUTHENTICITY_STALE_REVISION: '数据已变化，本次确认已失效，请刷新后重新预览。',
    AUTHENTICITY_SUBJECT_NOT_FOUND: '未找到对应书目。',
  };
  return labels[error.code] ?? error.message;
}

function scoreText(score: number | null): string {
  return score === null ? '未知（不会伪造成 0）' : `${(score / 100).toFixed(2)} / 100`;
}

function stateClass(detail: AuthenticityWorkDetail): string {
  if (detail.permission.stale) return 'stale';
  if (detail.dossier?.readiness === 'FACT_BLOCKED') return 'conflicted';
  if (detail.dossier?.readiness === 'INSUFFICIENT_COVERAGE') return 'insufficient';
  if (detail.dossier?.readiness === 'READY_FOR_CONTENT_BRIEF') return 'ready';
  return detail.readingState === 'UNCLASSIFIED' ? 'unclassified' : 'idle';
}

function PermissionMatrix({ detail }: { readonly detail: AuthenticityWorkDetail }) {
  const rows = [
    ['具体第一人称', detail.permission.firstPersonPermission],
    ['资料型分析', detail.permission.publicResearchAnalysisPermission],
    ['个人评分', detail.permission.personalScorePermission],
    ['资料分析评分', detail.permission.researchAnalysisScorePermission],
    ['未来 content brief', detail.permission.contentBriefReadiness],
  ] as const;
  return (
    <div className="authenticity-matrix" aria-label="表达权限矩阵">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong data-permission={value}>{PERMISSION_LABELS[value]}</strong>
        </div>
      ))}
    </div>
  );
}

function PreviewCard({
  busy,
  onConfirm,
  onDismiss,
  preview,
}: {
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
  readonly preview: AuthenticityActionPreview;
}) {
  const batchNextState =
    preview.preview.kind === 'BATCH_STATE_CHANGE' ? preview.preview.nextState : null;
  return (
    <section className="authenticity-preview" aria-live="polite">
      <div>
        <p className="section-kicker">显式确认 · {preview.kind}</p>
        <h3>请先核对变更预览</h3>
        {preview.preview.kind === 'STATE_CHANGE' ? (
          <p>
            {preview.preview.before.state} / {preview.preview.before.memoryConfidence}
            {' → '}
            {preview.preview.after.state} / {preview.preview.after.memoryConfidence}
          </p>
        ) : null}
        {preview.preview.kind === 'STATE_UNDO' ? (
          <p>
            撤销会追加新 revision，恢复为 {preview.preview.restore.state} /{' '}
            {preview.preview.restore.memoryConfidence}；历史不会被覆盖。
          </p>
        ) : null}
        {preview.preview.kind === 'ASSERTION_CONFIRM' ? (
          <p>
            {preview.preview.assertionKind}：{preview.preview.statement}
          </p>
        ) : null}
        {preview.preview.kind === 'ASSERTION_REVOKE' ? (
          <p>撤销观点 {preview.preview.assertionId}，对应表达权限将立即失效。</p>
        ) : null}
        {preview.preview.kind === 'SCORE_CHANGE' ? (
          <p>
            {preview.preview.publicLabel}：{scoreText(preview.preview.scoreBasisPoints)}
          </p>
        ) : null}
        {preview.preview.kind === 'SPOILER_CHANGE' ? (
          <p>
            {preview.preview.level} ·{' '}
            {preview.preview.warningRequired
              ? `必须在${preview.preview.warningPlacement}放置醒目警告`
              : '无需额外警告'}
          </p>
        ) : null}
        {preview.preview.kind === 'BATCH_STATE_CHANGE' ? (
          <div>
            <p>
              将 {preview.preview.items.length} 本明确选中的书设为 {preview.preview.nextState}
              ；每本独立校验 revision。
            </p>
            <ul>
              {preview.preview.items.map((item) => (
                <li key={item.workId}>
                  {item.workId}: {item.before} → {batchNextState}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <small>一次性确认将在 {preview.expiresAt} 失效，仅绑定当前窗口。</small>
      </div>
      <div className="catalog-actions">
        <button className="secondary-button" onClick={onDismiss} type="button">
          返回修改
        </button>
        <button className="primary-button" disabled={busy} onClick={onConfirm} type="button">
          明确确认并保存
        </button>
      </div>
    </section>
  );
}

export function AuthenticityLibrary(): React.JSX.Element {
  const [library, setLibrary] = useState<AuthenticityLibraryView | null>(null);
  const [detail, setDetail] = useState<AuthenticityWorkDetail | null>(null);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<AuthenticityActionPreview | null>(null);
  const [selectedWorkIds, setSelectedWorkIds] = useState<readonly string[]>([]);
  const [nextState, setNextState] = useState<ReadingStateCode>('UNCLASSIFIED');
  const [memoryConfidence, setMemoryConfidence] = useState<MemoryConfidence>('UNKNOWN');
  const [finishedAt, setFinishedAt] = useState('');
  const [lastReadAt, setLastReadAt] = useState('');
  const [userNote, setUserNote] = useState('');
  const [assertionKind, setAssertionKind] = useState('READING_IMPRESSION');
  const [assertionStatement, setAssertionStatement] = useState('');
  const [personalScore, setPersonalScore] = useState('');
  const [researchScore, setResearchScore] = useState('');
  const [spoilerLevel, setSpoilerLevel] = useState('NO_SPOILER');
  const [warningIncluded, setWarningIncluded] = useState(false);
  const [spoilerConfirmed, setSpoilerConfirmed] = useState(false);

  const adoptDetail = useCallback((value: AuthenticityWorkDetail): void => {
    const currentRevision = value.history[0];
    setDetail(value);
    setNextState(value.readingState);
    setMemoryConfidence(value.memoryConfidence);
    setFinishedAt(currentRevision?.finishedAt ?? '');
    setLastReadAt(currentRevision?.lastReadAt ?? '');
    setUserNote(currentRevision?.userNote ?? '');
    setAssertionKind('READING_IMPRESSION');
    setAssertionStatement('');
    setSpoilerLevel(value.spoilerPreference.level);
    setWarningIncluded(value.spoilerPreference.warningIncluded);
    setSpoilerConfirmed(value.spoilerPreference.userConfirmed);
    setPersonalScore(
      value.personalScore?.scoreBasisPoints === null ||
        value.personalScore?.scoreBasisPoints === undefined
        ? ''
        : String(value.personalScore.scoreBasisPoints / 100),
    );
    setResearchScore(
      value.researchScore?.scoreBasisPoints === null ||
        value.researchScore?.scoreBasisPoints === undefined
        ? ''
        : String(value.researchScore.scoreBasisPoints / 100),
    );
  }, []);

  const loadLibrary = useCallback(async (): Promise<void> => {
    const method = window.rednoteDesktop?.getAuthenticityLibrary;
    if (method === undefined) {
      setLoading(false);
      setNotice('当前桌面桥接不支持阅读真实性管理。');
      return;
    }
    setLoading(true);
    const result = await method({ limit: PAGE_SIZE, offset, profileId: PROFILE_ID, query });
    setLoading(false);
    if (result.ok) {
      setLibrary(result.value);
      setNotice(null);
    } else {
      setNotice(errorText(result.error));
    }
  }, [offset, query]);

  const openWork = useCallback(
    async (workId: string): Promise<void> => {
      const method = window.rednoteDesktop?.getAuthenticityWork;
      if (method === undefined) return;
      setPreview(null);
      setBusy(true);
      const result = await method({
        historyLimit: 50,
        historyOffset: 0,
        profileId: PROFILE_ID,
        workId,
      });
      setBusy(false);
      if (!result.ok) {
        setNotice(errorText(result.error));
        return;
      }
      adoptDetail(result.value);
    },
    [adoptDetail],
  );

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const confidenceOptions = CONFIDENCE_BY_STATE[nextState];
  const selectedOption = READING_OPTIONS.find((option) => option.state === nextState);
  const selectedItems = useMemo(
    () => library?.items.filter((item) => selectedWorkIds.includes(item.workId)) ?? [],
    [library, selectedWorkIds],
  );

  const requestPreview = async (input: PreviewAuthenticityActionInput): Promise<void> => {
    const method = window.rednoteDesktop?.previewAuthenticityAction;
    if (method === undefined) return;
    setPreview(null);
    setBusy(true);
    const result = await method(input);
    setBusy(false);
    if (result.ok) {
      setPreview(result.value);
      setNotice(null);
    } else {
      setNotice(errorText(result.error));
    }
  };

  const confirmPreview = async (): Promise<void> => {
    const method = window.rednoteDesktop?.confirmAuthenticityAction;
    if (method === undefined || preview === null) return;
    setBusy(true);
    const result = await method({
      confirmation: 'APPLY_AUTHENTICITY_ACTION',
      kind: preview.kind,
      previewHash: preview.previewHash,
      token: preview.token,
    });
    setBusy(false);
    setPreview(null);
    if (!result.ok) {
      setNotice(errorText(result.error));
      return;
    }
    if (result.value.batch !== null) {
      const failures = result.value.batch.items
        .filter((item) => !item.ok)
        .map((item) => `${item.workId}: ${item.errorCode ?? 'UNKNOWN'}`);
      setNotice(
        `批量结果：成功 ${result.value.batch.succeeded}，失败 ${result.value.batch.failed}${
          failures.length === 0 ? '' : `；${failures.join('；')}`
        }`,
      );
      setSelectedWorkIds([]);
    } else {
      adoptDetail(result.value.detail);
      setNotice('已追加本地 revision；没有触发任何模型、网络或内容生产。');
    }
    await loadLibrary();
  };

  const previewState = (): Promise<void> => {
    if (detail === null) return Promise.resolve();
    return requestPreview({
      draft: {
        confirmationKind: 'USER_EXPLICIT',
        expectedRevision: detail.revision,
        finishedAt: finishedAt || null,
        finishedAtPrecision: finishedAt ? 'DAY' : 'UNKNOWN',
        lastReadAt: lastReadAt || null,
        lastReadAtPrecision: lastReadAt ? 'DAY' : 'UNKNOWN',
        memoryConfidence,
        nextState,
        profileId: PROFILE_ID,
        provenance: 'USER_UI',
        subject: { editionId: null, expressionId: null, workId: detail.workId },
        userNote: userNote.trim() || null,
      },
      kind: 'STATE_CHANGE',
    });
  };

  const previewBatch = (): Promise<void> => {
    if (selectedItems.length === 0) {
      setNotice('批量操作默认不选择任何书；请先明确勾选。');
      return Promise.resolve();
    }
    return requestPreview({
      draft: {
        confirmationKind: 'USER_BATCH_EXPLICIT',
        items: selectedItems.map((item) => ({
          expectedRevision: item.revision,
          workId: item.workId,
        })),
        memoryConfidence,
        nextState,
        profileId: PROFILE_ID,
        provenance: 'USER_UI',
      },
      kind: 'BATCH_STATE_CHANGE',
    });
  };

  const previewAssertion = (): Promise<void> => {
    if (detail === null) return Promise.resolve();
    return requestPreview({
      draft: {
        assertionId: null,
        assertionKind: assertionKind as
          | 'CHARACTER_MEMORY'
          | 'PERSONAL_PREFERENCE'
          | 'PERSONAL_SCORE'
          | 'PLOT_OR_STRUCTURE_MEMORY'
          | 'READING_IMPRESSION'
          | 'TRICK_OR_REASONING_MEMORY',
        confirmationScope: 'EXACT_STATEMENT',
        expectedAssertionRevision: 0,
        expectedReadingRevision: detail.revision,
        profileId: PROFILE_ID,
        statement: assertionStatement,
        workId: detail.workId,
      },
      kind: 'ASSERTION_CONFIRM',
    });
  };

  const previewScore = (
    origin: 'PERSONAL_SCORE' | 'RESEARCH_ANALYSIS_SCORE',
    raw: string,
  ): Promise<void> => {
    if (detail === null) return Promise.resolve();
    const current = origin === 'PERSONAL_SCORE' ? detail.personalScore : detail.researchScore;
    const parsed = raw.trim() === '' ? null : Math.round(Number(raw) * 100);
    return requestPreview({
      draft: {
        expectedReadingRevision: detail.revision,
        expectedRevision: current?.revision ?? 0,
        origin,
        profileId: PROFILE_ID,
        scoreBasisPoints: parsed,
        workId: detail.workId,
      },
      kind: 'SCORE_CHANGE',
    });
  };

  return (
    <section className="authenticity-shell" data-authenticity-library>
      <header className="authenticity-hero">
        <div>
          <p className="section-kicker">M2 · 阅读真实性控制台</p>
          <h2>我读过什么，只由我确认</h2>
          <p>
            “公开资料整理”不代表用户亲自读过；“资料分析评分”不是个人评分。购买、持有、
            Clip、搜索、Dossier 或模型结果都不会自动判断已读。
          </p>
        </div>
        <div className="authenticity-zero">
          <strong>0</strong>
          <span>真实网络 / 模型 / 费用</span>
        </div>
      </header>

      {notice === null ? null : <p className="catalog-notice">{notice}</p>}
      {preview === null ? null : (
        <PreviewCard
          busy={busy}
          onConfirm={() => void confirmPreview()}
          onDismiss={() => setPreview(null)}
          preview={preview}
        />
      )}

      <div className="authenticity-toolbar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            void loadLibrary();
          }}
        >
          <input
            aria-label="搜索真实性书库"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Work 标题"
            value={query}
          />
          <button className="secondary-button" type="submit">
            搜索
          </button>
        </form>
        <div>
          <select
            aria-label="批量目标阅读状态"
            onChange={(event) => {
              const state = event.target.value as ReadingStateCode;
              setNextState(state);
              setMemoryConfidence(CONFIDENCE_BY_STATE[state][0]);
            }}
            value={nextState}
          >
            {READING_OPTIONS.map((option) => (
              <option key={option.state} value={option.state}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="批量记忆可信度"
            onChange={(event) => setMemoryConfidence(event.target.value as MemoryConfidence)}
            value={memoryConfidence}
          >
            {confidenceOptions.map((confidence) => (
              <option key={confidence} value={confidence}>
                {confidence}
              </option>
            ))}
          </select>
          <button
            className="secondary-button"
            disabled={busy || selectedItems.length === 0}
            onClick={() => void previewBatch()}
            type="button"
          >
            预览批量分类（{selectedItems.length}/50）
          </button>
        </div>
      </div>

      <div className="authenticity-layout">
        <section className="authenticity-list" aria-busy={loading}>
          {loading ? <p className="catalog-empty">正在读取本地书库……</p> : null}
          {!loading && library?.items.length === 0 ? (
            <p className="catalog-empty">暂无可管理的 Work。</p>
          ) : null}
          {library?.items.map((item) => (
            <article
              className={
                detail?.workId === item.workId
                  ? 'authenticity-work is-selected'
                  : 'authenticity-work'
              }
              key={item.workId}
            >
              <label>
                <input
                  aria-label={`批量选择 ${item.workTitle}`}
                  checked={selectedWorkIds.includes(item.workId)}
                  disabled={!selectedWorkIds.includes(item.workId) && selectedWorkIds.length >= 50}
                  onChange={(event) =>
                    setSelectedWorkIds((current) =>
                      event.target.checked
                        ? [...current, item.workId]
                        : current.filter((workId) => workId !== item.workId),
                    )
                  }
                  type="checkbox"
                />
              </label>
              <button onClick={() => void openWork(item.workId)} type="button">
                <span>
                  <strong>{item.workTitle}</strong>
                  <small>
                    {item.readingState} · {item.memoryConfidence}
                  </small>
                </span>
                <span data-readiness={item.contentBriefReadiness}>
                  {item.snapshotStale ? '需复核' : PERMISSION_LABELS[item.contentBriefReadiness]}
                </span>
              </button>
            </article>
          ))}
          <div className="catalog-pagination">
            <button
              className="secondary-button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              type="button"
            >
              上一页
            </button>
            <span>
              {library?.total ?? 0} 本 · 偏移 {offset}
            </span>
            <button
              className="secondary-button"
              disabled={(library?.items.length ?? 0) < PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              type="button"
            >
              下一页
            </button>
          </div>
        </section>

        <section className="authenticity-detail">
          {detail === null ? (
            <div className="authenticity-empty">
              <span>R1 / R2 / R3 / S1 / S2</span>
              <h3>选择一本书管理真实性</h3>
              <p>默认保持未分类；不会根据任何间接数据替你做决定。</p>
            </div>
          ) : (
            <>
              <header>
                <div>
                  <p className="section-kicker">Work · revision {detail.revision}</p>
                  <h3>{detail.workTitle}</h3>
                </div>
                <span className={`authenticity-status is-${stateClass(detail)}`}>
                  {stateClass(detail)}
                </span>
              </header>

              <div className="authenticity-entity-strip">
                <span>{detail.expressions.length} Expression</span>
                <span>{detail.editions.length} Edition</span>
                <span>Dossier: {detail.dossier?.readiness ?? 'NOT_BUILT'}</span>
                <span>
                  体验权限: {PERMISSION_LABELS[detail.permission.personalExperiencePermission]}
                </span>
              </div>

              <section className="authenticity-card">
                <h4>阅读状态与记忆可信度</h4>
                <select
                  aria-label="阅读状态"
                  onChange={(event) => {
                    const state = event.target.value as ReadingStateCode;
                    setNextState(state);
                    setMemoryConfidence(CONFIDENCE_BY_STATE[state][0]);
                  }}
                  value={nextState}
                >
                  {READING_OPTIONS.map((option) => (
                    <option key={option.state} value={option.state}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p>{selectedOption?.summary}</p>
                <select
                  aria-label="记忆可信度"
                  onChange={(event) => setMemoryConfidence(event.target.value as MemoryConfidence)}
                  value={memoryConfidence}
                >
                  {confidenceOptions.map((confidence) => (
                    <option key={confidence} value={confidence}>
                      {confidence}
                    </option>
                  ))}
                </select>
                <div className="authenticity-date-grid">
                  <label>
                    读完日期（可选）
                    <input
                      onChange={(event) => setFinishedAt(event.target.value)}
                      type="date"
                      value={finishedAt}
                    />
                  </label>
                  <label>
                    最近阅读（可选）
                    <input
                      onChange={(event) => setLastReadAt(event.target.value)}
                      type="date"
                      value={lastReadAt}
                    />
                  </label>
                </div>
                <textarea
                  aria-label="有界用户备注"
                  maxLength={2000}
                  onChange={(event) => setUserNote(event.target.value)}
                  placeholder="可选备注；系统不会自动扩大其事实含义"
                  value={userNote}
                />
                <div className="catalog-actions">
                  <button
                    className="secondary-button"
                    disabled={detail.history.length < 2}
                    onClick={() =>
                      void requestPreview({
                        expectedRevision: detail.revision,
                        kind: 'STATE_UNDO',
                        profileId: PROFILE_ID,
                        workId: detail.workId,
                      })
                    }
                    type="button"
                  >
                    预览撤销
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void previewState()}
                    type="button"
                  >
                    预览状态变更
                  </button>
                </div>
              </section>

              <section className="authenticity-card">
                <h4>研究就绪度 × 表达权限</h4>
                <p>Dossier ready 不等于用户读过；R1 也不等于事实研究 ready。</p>
                <PermissionMatrix detail={detail} />
                {detail.permission.blockingReasonCodes.length > 0 ? (
                  <p className="authenticity-reasons">
                    阻止原因：{detail.permission.blockingReasonCodes.join('、')}
                  </p>
                ) : null}
                {detail.permission.warningReasonCodes.length > 0 ? (
                  <p className="authenticity-reasons">
                    警告：{detail.permission.warningReasonCodes.join('、')}
                  </p>
                ) : null}
              </section>

              <section className="authenticity-card">
                <h4>R2 逐条观点确认</h4>
                <p>一次确认只授权这一条原意；状态 revision 改变后自动 stale。</p>
                <div className="authenticity-assertions">
                  {detail.assertions.map((assertion) => (
                    <article key={assertion.assertionId} data-stale={assertion.stale}>
                      <strong>
                        {assertion.assertionKind} · {assertion.status}
                        {assertion.stale ? ' · STALE' : ''}
                      </strong>
                      <span>{assertion.statement}</span>
                      <button
                        className="secondary-button"
                        disabled={assertion.status === 'REVOKED'}
                        onClick={() =>
                          void requestPreview({
                            assertionId: assertion.assertionId,
                            expectedAssertionRevision: assertion.assertionRevision,
                            expectedReadingRevision: detail.revision,
                            kind: 'ASSERTION_REVOKE',
                            profileId: PROFILE_ID,
                            workId: detail.workId,
                          })
                        }
                        type="button"
                      >
                        预览撤销
                      </button>
                    </article>
                  ))}
                  {detail.assertions.length === 0 ? <p>尚无观点确认。</p> : null}
                </div>
                <select
                  aria-label="观点类型"
                  disabled={detail.readingState !== 'R2_READ_FUZZY'}
                  onChange={(event) => setAssertionKind(event.target.value)}
                  value={assertionKind}
                >
                  {[
                    'READING_IMPRESSION',
                    'PLOT_OR_STRUCTURE_MEMORY',
                    'CHARACTER_MEMORY',
                    'TRICK_OR_REASONING_MEMORY',
                    'PERSONAL_PREFERENCE',
                    'PERSONAL_SCORE',
                  ].map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
                <textarea
                  aria-label="逐条确认的个人观点"
                  disabled={detail.readingState !== 'R2_READ_FUZZY'}
                  maxLength={2000}
                  onChange={(event) => setAssertionStatement(event.target.value)}
                  value={assertionStatement}
                />
                <button
                  className="secondary-button"
                  disabled={
                    detail.readingState !== 'R2_READ_FUZZY' ||
                    assertionStatement.trim().length === 0
                  }
                  onClick={() => void previewAssertion()}
                  type="button"
                >
                  预览逐条确认
                </button>
              </section>

              <section className="authenticity-card">
                <h4>评分来源严格隔离</h4>
                <div className="authenticity-score-grid">
                  <label>
                    <strong>个人评分</strong>
                    <span>{scoreText(detail.personalScore?.scoreBasisPoints ?? null)}</span>
                    <input
                      aria-label="个人评分"
                      max="100"
                      min="0"
                      onChange={(event) => setPersonalScore(event.target.value)}
                      step="0.01"
                      type="number"
                      value={personalScore}
                    />
                    <button
                      className="secondary-button"
                      onClick={() => void previewScore('PERSONAL_SCORE', personalScore)}
                      type="button"
                    >
                      预览个人评分
                    </button>
                  </label>
                  <label>
                    <strong>资料分析评分</strong>
                    <span>{scoreText(detail.researchScore?.scoreBasisPoints ?? null)}</span>
                    <input
                      aria-label="资料分析评分"
                      max="100"
                      min="0"
                      onChange={(event) => setResearchScore(event.target.value)}
                      step="0.01"
                      type="number"
                      value={researchScore}
                    />
                    <button
                      className="secondary-button"
                      onClick={() => void previewScore('RESEARCH_ANALYSIS_SCORE', researchScore)}
                      type="button"
                    >
                      预览资料分析评分
                    </button>
                  </label>
                </div>
                <p>系统预测分仅用于内部排序，不进入此 renderer DTO、公开预览或未来发布包。</p>
              </section>

              <section className="authenticity-card">
                <h4>剧透政策</h4>
                <select
                  aria-label="剧透级别"
                  onChange={(event) => setSpoilerLevel(event.target.value)}
                  value={spoilerLevel}
                >
                  <option value="NO_SPOILER">NO_SPOILER</option>
                  <option value="LIGHT_SPOILER">LIGHT_SPOILER</option>
                  <option value="FULL_TRICK_ANALYSIS">FULL_TRICK_ANALYSIS</option>
                </select>
                <label>
                  <input
                    checked={warningIncluded}
                    onChange={(event) => setWarningIncluded(event.target.checked)}
                    type="checkbox"
                  />
                  未来公开内容会在正文前放置醒目剧透警告
                </label>
                <label>
                  <input
                    checked={spoilerConfirmed}
                    onChange={(event) => setSpoilerConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  我明确确认该剧透级别
                </label>
                <p>
                  FULL_TRICK_ANALYSIS
                  允许完整核心诡计分析，但必须警告；警告不会提升事实或第一人称权限。
                </p>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void requestPreview({
                      draft: {
                        expectedRevision: detail.spoilerPreference.revision,
                        level: spoilerLevel as
                          'FULL_TRICK_ANALYSIS' | 'LIGHT_SPOILER' | 'NO_SPOILER',
                        profileId: PROFILE_ID,
                        userConfirmed: spoilerConfirmed,
                        warningIncluded,
                        workId: detail.workId,
                      },
                      kind: 'SPOILER_CHANGE',
                    })
                  }
                  type="button"
                >
                  预览剧透设置
                </button>
              </section>

              <section className="authenticity-card">
                <h4>状态历史</h4>
                <ol className="authenticity-history">
                  {detail.history.map((revision) => (
                    <li key={revision.revisionId}>
                      <strong>
                        rev {revision.revision} · {revision.state}
                      </strong>
                      <span>
                        {revision.memoryConfidence} · {revision.confirmationKind} ·{' '}
                        {revision.createdAt}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
