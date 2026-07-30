import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  BriefActionPreview,
  BriefDetailView,
  BriefListView,
  ContentBriefDraft,
  PreviewBriefActionInput,
  TopicPoolItem,
} from '@mystery-operations/shared';

const PROFILE_LABELS: Readonly<Record<string, string>> = {
  CROSS_WORK_COMPARISON: '跨作品比较',
  FULL_TRICK_LOGIC_ANALYSIS: '全剧透诡计逻辑分析',
  MYSTERY_AND_CULTURAL_PHENOMENON: '推理与文化现象',
  NON_SPOILER_SINGLE_BOOK_VERDICT: '无剧透单书判断',
  WEB_VS_PUBLISHED_MYSTERY: '网文与出版推理比较',
};

const READINESS_LABELS: Readonly<Record<string, string>> = {
  AUTHENTICITY_BLOCKED: '真实性阻塞',
  DOSSIER_NOT_READY: '研究档案未就绪',
  DRAFT_INCOMPLETE: '结构待补充',
  EVIDENCE_MAPPING_INCOMPLETE: '证据映射待补充',
  EXPERIMENT_MISMATCH: '实验绑定不一致',
  FACT_BLOCKED: '事实阻塞',
  READY_FOR_DRAFT_GENERATION: '可生成结构候选',
  SPOILER_POLICY_INCOMPLETE: '剧透策略待确认',
  STALE: '依赖已变化',
};
const ACTION_LABELS: Readonly<Record<string, string>> = {
  ARCHIVE: '归档 Content Brief',
  CANCEL_GENERATION: '取消结构候选任务',
  CLONE: '克隆历史版本',
  CREATE_SCAFFOLD: '创建纯本地 scaffold',
  LOCK_FIELD: '锁定字段',
  PREVIEW_GENERATION: '生成结构候选',
  RESTORE: '恢复 Content Brief',
  SAVE_EDIT: '保存新版本',
  UNDO: '恢复历史版本',
  UNLOCK_FIELD: '解锁字段',
};

const PROFILE_ORDER = [
  'NON_SPOILER_SINGLE_BOOK_VERDICT',
  'FULL_TRICK_LOGIC_ANALYSIS',
  'CROSS_WORK_COMPARISON',
  'WEB_VS_PUBLISHED_MYSTERY',
  'MYSTERY_AND_CULTURAL_PHENOMENON',
] as const;
const PAGE_SIZE = 20;
const DETAIL_PAGE_SIZE = 10;

function text(value: string | null): string {
  return value ?? '';
}

function readinessClass(readiness: string): string {
  return readiness === 'READY_FOR_DRAFT_GENERATION'
    ? 'is-ready'
    : readiness === 'STALE' || readiness.includes('BLOCKED')
      ? 'is-blocked'
      : 'is-draft';
}

export function ContentProductionPage(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<BriefListView | null>(null);
  const [detail, setDetail] = useState<BriefDetailView | null>(null);
  const [draft, setDraft] = useState<ContentBriefDraft | null>(null);
  const [query, setQuery] = useState('');
  const [listOffset, setListOffset] = useState(0);
  const [profileFilter, setProfileFilter] = useState<
    BriefListView['items'][number]['profileId'] | null
  >(null);
  const [readinessFilter, setReadinessFilter] = useState<
    BriefListView['items'][number]['readiness'] | null
  >(null);
  const [stateFilter, setStateFilter] = useState<BriefListView['items'][number]['state'] | null>(
    null,
  );
  const [versionOffset, setVersionOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [evidenceOffset, setEvidenceOffset] = useState(0);
  const [generationOffset, setGenerationOffset] = useState(0);
  const [assignmentPlanId, setAssignmentPlanId] = useState('');
  const [customForbiddenExpression, setCustomForbiddenExpression] = useState('');
  const [message, setMessage] = useState('正在读取本地 Content Brief…');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BriefActionPreview | null>(null);
  const [scaffoldTopics, setScaffoldTopics] = useState<readonly TopicPoolItem[]>([]);

  const loadList = useCallback(async () => {
    const method = window.rednoteDesktop?.getBriefs;
    if (method === undefined) {
      setMessage('当前桌面桥接尚未提供 Brief 列表。');
      return;
    }
    const result = await method({
      limit: PAGE_SIZE,
      offset: listOffset,
      profileId: profileFilter,
      query,
      readiness: readinessFilter,
      state: stateFilter,
    });
    if (!result.ok) {
      setMessage(`读取失败：${result.error.code}`);
      return;
    }
    setWorkspace(result.value);
    setMessage(
      result.value.total === 0
        ? '尚无 Brief。请从已锁定、符合资格的 Topic 创建纯本地 scaffold。'
        : `已加载 ${result.value.total} 个版本化 Brief。`,
    );
    if (detail === null && result.value.items[0] !== undefined) {
      void loadDetail(result.value.items[0].briefId, 0, 0);
    }
  }, [detail, listOffset, profileFilter, query, readinessFilter, stateFilter]);

  const loadDetail = useCallback(
    async (
      briefId: string,
      nextVersionOffset = 0,
      nextHistoryOffset = 0,
      nextEvidenceOffset = 0,
      nextGenerationOffset = 0,
    ) => {
      const method = window.rednoteDesktop?.getBrief;
      if (method === undefined) return;
      const result = await method({
        briefId,
        evidenceLimit: DETAIL_PAGE_SIZE,
        evidenceOffset: nextEvidenceOffset,
        generationLimit: DETAIL_PAGE_SIZE,
        generationOffset: nextGenerationOffset,
        historyLimit: DETAIL_PAGE_SIZE,
        historyOffset: nextHistoryOffset,
        versionLimit: DETAIL_PAGE_SIZE,
        versionOffset: nextVersionOffset,
      });
      if (!result.ok) {
        setMessage(`Brief 读取失败：${result.error.code}`);
        return;
      }
      setDetail(result.value);
      setDraft(result.value.draft);
      setVersionOffset(nextVersionOffset);
      setHistoryOffset(nextHistoryOffset);
      setEvidenceOffset(nextEvidenceOffset);
      setGenerationOffset(nextGenerationOffset);
      setPreview(null);
      setMessage(`已打开 v${result.value.versionNumber}；所有编辑仍需二次确认。`);
    },
    [],
  );

  const loadScaffoldTopics = useCallback(async () => {
    const method = window.rednoteDesktop?.getTopicPool;
    if (method === undefined) return;
    const result = await method({
      contentType: null,
      eligibility: 'ELIGIBLE',
      limit: 100,
      offset: 0,
      profileId: 'primary',
      query: '',
      state: 'LOCKED',
    });
    if (result.ok) {
      setScaffoldTopics(
        result.value.items.filter(
          (item) => item.candidateState === 'LOCKED' && item.eligibility === 'ELIGIBLE',
        ),
      );
    }
  }, []);

  useEffect(() => {
    void loadList();
    void loadScaffoldTopics();
  }, [loadList, loadScaffoldTopics]);

  const issuePreview = useCallback(async (input: PreviewBriefActionInput) => {
    const method = window.rednoteDesktop?.previewBriefAction;
    if (method === undefined) return null;
    setBusy(true);
    try {
      const result = await method(input);
      if (!result.ok) {
        setMessage(`预览被拒绝：${result.error.code}`);
        return null;
      }
      setPreview(result.value);
      setMessage('预览已绑定当前窗口、revision 与输入 hash；尚未执行。');
      return result.value;
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmPreview = useCallback(
    async (executionId: string | null = null) => {
      if (preview === null) return;
      const method = window.rednoteDesktop?.confirmBriefAction;
      if (method === undefined) return;
      setBusy(true);
      try {
        const result = await method({
          confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
          executionId,
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
          setDraft(result.value.detail.draft);
        }
        setMessage(
          result.value.kind === 'PREVIEW_GENERATION'
            ? '结构候选任务已进入本地队列；模型未配置时会在发送前失败，费用为 0。'
            : '操作已保存为新的可审计 revision。',
        );
        await loadList();
      } finally {
        setBusy(false);
      }
    },
    [loadList, preview],
  );

  const dirty = useMemo(
    () =>
      detail !== null && draft !== null && JSON.stringify(detail.draft) !== JSON.stringify(draft),
    [detail, draft],
  );

  const updateDraft = useCallback(
    (
      section: 'targetAudience' | 'contentObjective' | 'coreJudgment',
      field: string,
      value: string,
    ) => {
      setDraft((current) => {
        if (current === null) return current;
        return {
          ...current,
          [section]: {
            ...current[section],
            [field]: value.length === 0 ? null : value,
          },
        } as ContentBriefDraft;
      });
      setPreview(null);
    },
    [],
  );

  const updateArgument = useCallback(
    (
      index: number,
      field: 'evidenceRefIds' | 'kind' | 'limitation' | 'statement',
      value: readonly string[] | string,
    ) => {
      setDraft((current) => {
        if (current === null) return current;
        return {
          ...current,
          supportingArguments: current.supportingArguments.map((argument, argumentIndex) =>
            argumentIndex === index
              ? {
                  ...argument,
                  [field]:
                    field === 'evidenceRefIds'
                      ? value
                      : typeof value === 'string' && value.length > 0
                        ? value
                        : null,
                }
              : argument,
          ),
        } as ContentBriefDraft;
      });
      setPreview(null);
    },
    [],
  );

  const addArgument = useCallback(() => {
    setDraft((current) => {
      if (current === null || current.supportingArguments.length >= 12) return current;
      return {
        ...current,
        supportingArguments: [
          ...current.supportingArguments,
          {
            argumentId: `argument-${globalThis.crypto.randomUUID()}`,
            evidenceRefIds: [],
            kind: 'OPINION',
            limitation: null,
            statement: null,
            subjectIds: current.subjects.map((subject) => subject.subjectId),
          },
        ],
      };
    });
    setPreview(null);
  }, []);

  const removeArgument = useCallback((index: number) => {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            supportingArguments: current.supportingArguments.filter(
              (_, argumentIndex) => argumentIndex !== index,
            ),
          },
    );
    setPreview(null);
  }, []);

  const updateCounterargument = useCallback(
    (
      field: 'evidenceRefIds' | 'kind' | 'limitation' | 'responseOrQualification' | 'statement',
      value: readonly string[] | string,
    ) => {
      setDraft((current) => {
        if (current === null) return current;
        const existing = current.strongestCounterargument ?? {
          argumentId: `counterargument-${globalThis.crypto.randomUUID()}`,
          evidenceRefIds: [],
          kind: 'OPINION' as const,
          limitation: null,
          responseOrQualification: null,
          statement: null,
          subjectIds: current.subjects.map((subject) => subject.subjectId),
        };
        return {
          ...current,
          strongestCounterargument: {
            ...existing,
            [field]:
              field === 'evidenceRefIds'
                ? value
                : typeof value === 'string' && value.length > 0
                  ? value
                  : null,
          },
        } as ContentBriefDraft;
      });
      setPreview(null);
    },
    [],
  );

  const addCustomForbidden = useCallback(() => {
    const phrase = customForbiddenExpression.trim();
    if (phrase.length === 0) return;
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            forbiddenExpressions: [
              ...current.forbiddenExpressions,
              {
                category: 'USER_CUSTOM',
                expressionId: `user:${globalThis.crypto.randomUUID()}`,
                phrase,
                policyVersion: 'user-custom-v1',
                reason: '用户自定义内容约束',
                system: false,
              },
            ],
          },
    );
    setCustomForbiddenExpression('');
    setPreview(null);
  }, [customForbiddenExpression]);

  const removeCustomForbidden = useCallback((expressionId: string) => {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            forbiddenExpressions: current.forbiddenExpressions.filter(
              (rule) => rule.system || rule.expressionId !== expressionId,
            ),
          },
    );
    setPreview(null);
  }, []);

  const totalReady = workspace?.counts.READY_FOR_DRAFT_GENERATION ?? 0;
  const totalStale = workspace?.counts.STALE ?? 0;
  const customRulesLocked =
    draft?.fieldStates.find((field) => field.path === 'forbiddenExpressions.userCustom')?.lock !==
    'EDITABLE';
  const confirmationPanel =
    preview === null ? null : (
      <section className="brief-confirmation" aria-live="polite">
        <div>
          <p className="section-kicker">二次确认</p>
          <h3>{ACTION_LABELS[preview.kind] ?? preview.kind}</h3>
          <p>token 仅在当前窗口短期有效。确认前没有模型请求；输入或 revision 变化会使预览失效。</p>
          {preview.kind === 'PREVIEW_GENERATION' && 'capabilityState' in preview.preview ? (
            <dl className="brief-generation-preview">
              <div>
                <dt>Capability</dt>
                <dd>{preview.preview.capabilityState}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>{preview.preview.budgetState}</dd>
              </div>
              <div>
                <dt>Input</dt>
                <dd>
                  {preview.preview.inputCharacterCount} / {preview.preview.maximumInputCharacters}{' '}
                  chars
                </dd>
              </div>
              <div>
                <dt>Evidence / Subjects</dt>
                <dd>
                  {preview.preview.evidenceRefCount} / {preview.preview.subjectIds.length}
                </dd>
              </div>
              <div>
                <dt>Locked / Editable</dt>
                <dd>
                  {preview.preview.lockedFieldCount} / {preview.preview.editableFieldCount}
                </dd>
              </div>
              <div>
                <dt>Request / Output cap</dt>
                <dd>
                  {preview.preview.maximumModelRequests} / {preview.preview.maximumOutputBytes}{' '}
                  bytes
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
        <div>
          <button onClick={() => setPreview(null)} type="button">
            取消
          </button>
          <button
            disabled={
              preview.kind === 'PREVIEW_GENERATION' &&
              'modelConfigured' in preview.preview &&
              (!preview.preview.modelConfigured || preview.preview.budgetState !== 'AVAILABLE')
            }
            onClick={() =>
              void confirmPreview(
                preview.kind === 'PREVIEW_GENERATION' ? globalThis.crypto.randomUUID() : null,
              )
            }
            type="button"
          >
            {preview.kind === 'PREVIEW_GENERATION' &&
            'modelConfigured' in preview.preview &&
            !preview.preview.modelConfigured
              ? '模型能力未确认'
              : preview.kind === 'PREVIEW_GENERATION' &&
                  'budgetState' in preview.preview &&
                  preview.preview.budgetState !== 'AVAILABLE'
                ? '预算边界未确认'
                : '确认执行'}
          </button>
        </div>
      </section>
    );

  return (
    <div className="brief-workspace">
      <section className="brief-hero">
        <div>
          <p className="section-kicker">M3 · Content Brief V1</p>
          <h2>把研究证据压成可控结构，保留人的判断</h2>
          <p>
            五类 Brief 共享同一条证据、真实性、评分、剧透与实验边界。这里生成的是结构候选，
            不是标题、正文、标签、图片，也不是质量结论。
          </p>
        </div>
        <div className="brief-hero__metrics" aria-label="Brief 状态摘要">
          <span>
            <strong>{workspace?.total ?? 0}</strong>全部版本根
          </span>
          <span>
            <strong>{totalReady}</strong>可生成结构
          </span>
          <span>
            <strong>{totalStale}</strong>依赖已变化
          </span>
        </div>
      </section>

      <section className="brief-policy-strip" aria-label="内容生产安全边界">
        <div>
          <strong>Brief 边界</strong>
          <span>内容简报不是标题、正文或已批准文章</span>
        </div>
        <div>
          <strong>严格结构验证</strong>
          <span>模型候选必须经过 Schema、证据和权限验证</span>
        </div>
        <div>
          <strong>纯本地 scaffold</strong>
          <span>无需配置模型；未知字段保持空白与待确认</span>
        </div>
        <div>
          <strong>Readiness 不伪装</strong>
          <span>低覆盖度或事实冲突的简报不能进入正文生成</span>
        </div>
        <div>
          <strong>锁与费用边界</strong>
          <span>锁定字段不会被覆盖；能力或预算未知时不会发送请求</span>
        </div>
      </section>

      <div className="brief-layout">
        <aside className="brief-list-panel">
          <div className="brief-toolbar">
            <label>
              <span>查找 Brief</span>
              <input
                onChange={(event) => {
                  setListOffset(0);
                  setQuery(event.target.value);
                }}
                placeholder="Topic、读者或中心判断"
                value={query}
              />
            </label>
            <button disabled={busy} onClick={() => void loadList()} type="button">
              刷新
            </button>
          </div>
          <div className="brief-filter-grid" aria-label="Brief 筛选">
            <label>
              <span>Profile</span>
              <select
                onChange={(event) => {
                  setListOffset(0);
                  setProfileFilter(
                    event.target.value === ''
                      ? null
                      : (event.target.value as BriefListView['items'][number]['profileId']),
                  );
                }}
                value={profileFilter ?? ''}
              >
                <option value="">全部类型</option>
                {PROFILE_ORDER.map((profile) => (
                  <option key={profile} value={profile}>
                    {PROFILE_LABELS[profile]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Readiness</span>
              <select
                onChange={(event) => {
                  setListOffset(0);
                  setReadinessFilter(
                    event.target.value === ''
                      ? null
                      : (event.target.value as BriefListView['items'][number]['readiness']),
                  );
                }}
                value={readinessFilter ?? ''}
              >
                <option value="">全部状态</option>
                {Object.entries(READINESS_LABELS).map(([readiness, label]) => (
                  <option key={readiness} value={readiness}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>归档状态</span>
              <select
                onChange={(event) => {
                  setListOffset(0);
                  setStateFilter(
                    event.target.value === ''
                      ? null
                      : (event.target.value as BriefListView['items'][number]['state']),
                  );
                }}
                value={stateFilter ?? ''}
              >
                <option value="">全部</option>
                <option value="ACTIVE">进行中</option>
                <option value="ARCHIVED">已归档</option>
              </select>
            </label>
          </div>

          <div className="brief-profile-meter">
            {PROFILE_ORDER.map((profile) => (
              <div key={profile}>
                <span>{PROFILE_LABELS[profile]}</span>
                <strong>
                  {workspace?.items.filter((item) => item.profileId === profile).length ?? 0}
                </strong>
              </div>
            ))}
          </div>

          <div className="brief-list" role="list">
            {workspace?.items.map((item) => (
              <button
                className={item.briefId === detail?.briefId ? 'is-active' : ''}
                key={item.briefId}
                onClick={() => void loadDetail(item.briefId)}
                role="listitem"
                type="button"
              >
                <span>{PROFILE_LABELS[item.profileId]}</span>
                <strong>{item.topicId}</strong>
                <small className={readinessClass(item.readiness)}>
                  {READINESS_LABELS[item.readiness]}
                </small>
              </button>
            ))}
          </div>
          <div className="brief-pagination" aria-label="Brief 列表分页">
            <button
              disabled={busy || listOffset === 0}
              onClick={() => setListOffset(Math.max(0, listOffset - PAGE_SIZE))}
              type="button"
            >
              上一页
            </button>
            <span>
              {workspace === null || workspace.total === 0 ? 0 : workspace.offset + 1}–
              {workspace === null
                ? 0
                : Math.min(workspace.total, workspace.offset + workspace.items.length)}{' '}
              / {workspace?.total ?? 0}
            </span>
            <button
              disabled={
                busy ||
                workspace === null ||
                workspace.offset + workspace.items.length >= workspace.total
              }
              onClick={() => setListOffset(listOffset + PAGE_SIZE)}
              type="button"
            >
              下一页
            </button>
          </div>
          {workspace?.total === 0 ? (
            <div className="brief-empty">
              <strong>从 Topic 开始</strong>
              <p>仅符合资格且处于 LOCKED 的 Topic 可创建 scaffold；事实缺口不会被自动补成结论。</p>
              {scaffoldTopics.length === 0 ? (
                <small>当前没有可用的已锁定 Topic。</small>
              ) : (
                <div>
                  <label className="brief-assignment-input">
                    <span>可选 Experiment Assignment Plan ID</span>
                    <input
                      onChange={(event) => setAssignmentPlanId(event.target.value)}
                      placeholder="留空表示不绑定；确认时由 main 校验 current/LOCKED"
                      value={assignmentPlanId}
                    />
                  </label>
                  <div className="brief-scaffold-options">
                    {scaffoldTopics.slice(0, 8).map((topic) => (
                      <button
                        disabled={busy}
                        key={topic.topicId}
                        onClick={() =>
                          void issuePreview({
                            assignmentPlanId: assignmentPlanId.trim() || null,
                            kind: 'CREATE_SCAFFOLD',
                            topicId: topic.topicId,
                          })
                        }
                        type="button"
                      >
                        <span>{PROFILE_LABELS[topic.contentType] ?? topic.contentType}</span>
                        <strong>{topic.topicAngle}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </aside>

        <main className="brief-editor">
          {detail === null || draft === null ? (
            <>
              <div className="state-card">
                <p className="section-kicker">内容生产</p>
                <h2>选择一个 Brief 查看结构</h2>
                <p>{message}</p>
              </div>
              {confirmationPanel}
            </>
          ) : (
            <>
              <header className="brief-editor__header">
                <div>
                  <p className="section-kicker">
                    {PROFILE_LABELS[detail.profileId]} · v{detail.versionNumber}
                  </p>
                  <h2>{detail.topicId}</h2>
                  <div className="brief-badges">
                    <span className={readinessClass(detail.readiness)}>
                      {READINESS_LABELS[detail.readiness]}
                    </span>
                    <span>{detail.draft.expressionPolicy.mode}</span>
                    <span>{detail.draft.spoilerPlan.level}</span>
                    <span>{detail.draft.scorePlan.kind}</span>
                  </div>
                </div>
                <div className="brief-actions">
                  <button
                    disabled={busy || !dirty}
                    onClick={() =>
                      void issuePreview({
                        briefId: detail.briefId,
                        draft,
                        expectedRevision: detail.revision,
                        kind: 'SAVE_EDIT',
                      })
                    }
                    type="button"
                  >
                    预览保存
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void issuePreview({
                        briefId: detail.briefId,
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

              {detail.stale ? (
                <div className="brief-alert" role="alert">
                  <strong>依赖已经变化</strong>
                  <span>{detail.invalidationReasons.join(' · ')}</span>
                  <p>旧版本仍保留，但必须重新核对 Topic、Dossier、权限或 Experiment。</p>
                </div>
              ) : null}

              <section className="brief-form-grid">
                <label>
                  <span>目标读者</span>
                  <textarea
                    onChange={(event) =>
                      updateDraft('targetAudience', 'readerDescription', event.target.value)
                    }
                    value={text(draft.targetAudience.readerDescription)}
                  />
                </label>
                <label>
                  <span>选择需求</span>
                  <textarea
                    onChange={(event) =>
                      updateDraft('targetAudience', 'selectionNeed', event.target.value)
                    }
                    value={text(draft.targetAudience.selectionNeed)}
                  />
                </label>
                <label>
                  <span>读者收获</span>
                  <textarea
                    onChange={(event) =>
                      updateDraft('contentObjective', 'readerOutcome', event.target.value)
                    }
                    value={text(draft.contentObjective.readerOutcome)}
                  />
                </label>
                <label>
                  <span>范围边界</span>
                  <textarea
                    onChange={(event) =>
                      updateDraft('contentObjective', 'scopeBoundary', event.target.value)
                    }
                    value={text(draft.contentObjective.scopeBoundary)}
                  />
                </label>
                <label className="is-wide">
                  <span>核心判断</span>
                  <textarea
                    onChange={(event) =>
                      updateDraft('coreJudgment', 'statement', event.target.value)
                    }
                    value={text(draft.coreJudgment.statement)}
                  />
                </label>
                <label>
                  <span>判断类型</span>
                  <select
                    onChange={(event) => updateDraft('coreJudgment', 'kind', event.target.value)}
                    value={draft.coreJudgment.kind}
                  >
                    <option value="OPINION">观点</option>
                    <option value="FACTUAL_SYNTHESIS">事实综合</option>
                    <option value="MIXED">事实与观点混合</option>
                  </select>
                </label>
                <label>
                  <span>可证伪 / 限定条件</span>
                  <textarea
                    onChange={(event) =>
                      updateDraft('coreJudgment', 'qualification', event.target.value)
                    }
                    value={text(draft.coreJudgment.qualification)}
                  />
                </label>
              </section>

              <div className="brief-section-grid brief-argument-grid">
                <section>
                  <header>
                    <div>
                      <p className="section-kicker">Supporting arguments</p>
                      <h3>支撑论点编辑器</h3>
                    </div>
                    <button
                      disabled={busy || draft.supportingArguments.length >= 12}
                      onClick={addArgument}
                      type="button"
                    >
                      添加论点
                    </button>
                  </header>
                  <div className="brief-argument-list">
                    {draft.supportingArguments.map((argument, index) => (
                      <article key={argument.argumentId}>
                        <header>
                          <strong>
                            #{index + 1} · {argument.kind}
                          </strong>
                          <button
                            disabled={busy}
                            onClick={() => removeArgument(index)}
                            type="button"
                          >
                            移除
                          </button>
                        </header>
                        <label>
                          <span>事实 / 观点类型</span>
                          <select
                            onChange={(event) => updateArgument(index, 'kind', event.target.value)}
                            value={argument.kind}
                          >
                            <option value="OPINION">OPINION</option>
                            <option value="FACT">FACT</option>
                            <option value="MIXED">MIXED</option>
                          </select>
                        </label>
                        <label>
                          <span>论点</span>
                          <textarea
                            onChange={(event) =>
                              updateArgument(index, 'statement', event.target.value)
                            }
                            value={text(argument.statement)}
                          />
                        </label>
                        <label>
                          <span>适用限制</span>
                          <textarea
                            onChange={(event) =>
                              updateArgument(index, 'limitation', event.target.value)
                            }
                            value={text(argument.limitation)}
                          />
                        </label>
                        <label>
                          <span>受控 Evidence refs（事实项至少一条 current VERIFIED）</span>
                          <select
                            multiple
                            onChange={(event) =>
                              updateArgument(
                                index,
                                'evidenceRefIds',
                                Array.from(
                                  event.currentTarget.selectedOptions,
                                  (option) => option.value,
                                ),
                              )
                            }
                            value={[...argument.evidenceRefIds]}
                          >
                            {draft.evidenceMap.map((reference) => (
                              <option key={reference.refId} value={reference.refId}>
                                {reference.role} · {reference.displaySummary}
                              </option>
                            ))}
                          </select>
                        </label>
                      </article>
                    ))}
                    {draft.supportingArguments.length === 0 ? (
                      <p className="brief-inline-empty">尚无论点；scaffold 不会伪造内容判断。</p>
                    ) : null}
                  </div>
                </section>

                <section>
                  <header>
                    <div>
                      <p className="section-kicker">Strongest counterargument</p>
                      <h3>最强反方与限定</h3>
                    </div>
                    <strong>
                      {draft.strongestCounterargument === null
                        ? '待补充'
                        : draft.strongestCounterargument.kind}
                    </strong>
                  </header>
                  <div className="brief-counterargument-editor">
                    <label>
                      <span>事实 / 观点类型</span>
                      <select
                        onChange={(event) => updateCounterargument('kind', event.target.value)}
                        value={draft.strongestCounterargument?.kind ?? 'OPINION'}
                      >
                        <option value="OPINION">OPINION</option>
                        <option value="FACT">FACT</option>
                        <option value="MIXED">MIXED</option>
                      </select>
                    </label>
                    <label>
                      <span>最强反方，不构造稻草人</span>
                      <textarea
                        onChange={(event) => updateCounterargument('statement', event.target.value)}
                        value={text(draft.strongestCounterargument?.statement ?? null)}
                      />
                    </label>
                    <label>
                      <span>反方成立的限制</span>
                      <textarea
                        onChange={(event) =>
                          updateCounterargument('limitation', event.target.value)
                        }
                        value={text(draft.strongestCounterargument?.limitation ?? null)}
                      />
                    </label>
                    <label>
                      <span>回应或保留条件</span>
                      <textarea
                        onChange={(event) =>
                          updateCounterargument('responseOrQualification', event.target.value)
                        }
                        value={text(
                          draft.strongestCounterargument?.responseOrQualification ?? null,
                        )}
                      />
                    </label>
                    <label>
                      <span>反方 Evidence refs</span>
                      <select
                        multiple
                        onChange={(event) =>
                          updateCounterargument(
                            'evidenceRefIds',
                            Array.from(
                              event.currentTarget.selectedOptions,
                              (option) => option.value,
                            ),
                          )
                        }
                        value={[...(draft.strongestCounterargument?.evidenceRefIds ?? [])]}
                      >
                        {draft.evidenceMap.map((reference) => (
                          <option key={reference.refId} value={reference.refId}>
                            {reference.role} · {reference.displaySummary}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>
              </div>

              <div className="brief-section-grid">
                <section>
                  <header>
                    <div>
                      <p className="section-kicker">Evidence map</p>
                      <h3>字段级证据链</h3>
                    </div>
                    <strong>{detail.evidencePage.total}</strong>
                  </header>
                  <ul className="brief-evidence-list">
                    {detail.evidencePage.items.map((reference) => (
                      <li key={reference.refId}>
                        <div>
                          <strong>{reference.fieldPath}</strong>
                          <span>{reference.displaySummary}</span>
                        </div>
                        <small>
                          {reference.role} · {reference.factStatus} ·{' '}
                          {reference.current ? 'CURRENT' : 'STALE'}
                        </small>
                      </li>
                    ))}
                    {detail.evidencePage.total === 0 ? (
                      <li>
                        <span>尚无受控证据引用；事实性判断不会进入 ready。</span>
                      </li>
                    ) : null}
                  </ul>
                  <div className="brief-pagination">
                    <button
                      disabled={busy || evidenceOffset === 0}
                      onClick={() =>
                        void loadDetail(
                          detail.briefId,
                          versionOffset,
                          historyOffset,
                          Math.max(0, evidenceOffset - DETAIL_PAGE_SIZE),
                          generationOffset,
                        )
                      }
                      type="button"
                    >
                      上一页证据
                    </button>
                    <span>
                      {detail.evidencePage.total === 0 ? 0 : detail.evidencePage.offset + 1}–
                      {Math.min(
                        detail.evidencePage.total,
                        detail.evidencePage.offset + detail.evidencePage.items.length,
                      )}{' '}
                      / {detail.evidencePage.total}
                    </span>
                    <button
                      disabled={
                        busy ||
                        detail.evidencePage.offset + detail.evidencePage.items.length >=
                          detail.evidencePage.total
                      }
                      onClick={() =>
                        void loadDetail(
                          detail.briefId,
                          versionOffset,
                          historyOffset,
                          evidenceOffset + DETAIL_PAGE_SIZE,
                          generationOffset,
                        )
                      }
                      type="button"
                    >
                      下一页证据
                    </button>
                  </div>
                </section>

                <section>
                  <header>
                    <div>
                      <p className="section-kicker">Provenance & locks</p>
                      <h3>字段来源与锁</h3>
                    </div>
                    <strong>{draft.fieldStates.length}</strong>
                  </header>
                  <ul className="brief-lock-list">
                    {draft.fieldStates.map((field) => (
                      <li key={field.path}>
                        <div>
                          <strong>{field.path}</strong>
                          <span>{field.provenance}</span>
                        </div>
                        <button
                          disabled={busy || field.lock === 'SYSTEM_LOCKED'}
                          onClick={() =>
                            void issuePreview({
                              briefId: detail.briefId,
                              expectedRevision: detail.revision,
                              fieldPath: field.path,
                              kind: field.lock === 'USER_LOCKED' ? 'UNLOCK_FIELD' : 'LOCK_FIELD',
                            })
                          }
                          type="button"
                        >
                          {field.lock}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <div className="brief-section-grid">
                <section>
                  <header>
                    <div>
                      <p className="section-kicker">Profile structure</p>
                      <h3>必需结构槽位</h3>
                    </div>
                    <strong>{draft.structurePlan.slots.length}</strong>
                  </header>
                  <ol className="brief-structure-list">
                    {draft.structurePlan.slots.map((slot, index) => (
                      <li key={slot.slotId}>
                        <div>
                          <strong>
                            {index + 1}. {slot.slotId}
                          </strong>
                          <span>{slot.function}</span>
                        </div>
                        <small>
                          {slot.required ? 'REQUIRED' : 'OPTIONAL'} ·{' '}
                          {slot.subjectIds.join(' · ') || '全局槽位'}
                        </small>
                      </li>
                    ))}
                  </ol>
                  <p className="brief-footnote">
                    比较维度：{draft.structurePlan.comparisonDimension ?? '不适用'}
                    。这里只定义段落功能， 不生成成品标题或正文。
                  </p>
                </section>

                <section>
                  <header>
                    <div>
                      <p className="section-kicker">Forbidden expression registry</p>
                      <h3>禁用表达</h3>
                    </div>
                    <strong>{draft.forbiddenExpressions.length}</strong>
                  </header>
                  <ul className="brief-forbidden-list">
                    {draft.forbiddenExpressions.map((rule) => (
                      <li key={rule.expressionId}>
                        <div>
                          <strong>{rule.phrase}</strong>
                          <span>{rule.reason}</span>
                        </div>
                        <div>
                          <small>
                            {rule.category} · {rule.system ? 'SYSTEM_LOCKED' : 'USER_CUSTOM'}
                          </small>
                          {!rule.system ? (
                            <button
                              disabled={busy || customRulesLocked}
                              onClick={() => removeCustomForbidden(rule.expressionId)}
                              type="button"
                            >
                              删除
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="brief-custom-rule">
                    <input
                      onChange={(event) => setCustomForbiddenExpression(event.target.value)}
                      placeholder="新增用户自定义禁用表达"
                      value={customForbiddenExpression}
                    />
                    <button
                      disabled={
                        busy || customRulesLocked || customForbiddenExpression.trim().length === 0
                      }
                      onClick={addCustomForbidden}
                      type="button"
                    >
                      添加
                    </button>
                  </div>
                </section>
              </div>

              <section className="brief-open-questions">
                <div>
                  <p className="section-kicker">Open questions & limitations</p>
                  <h3>资料缺口保持未知</h3>
                  <p>每行一项；gap 不会自动补成确定事实。</p>
                </div>
                <textarea
                  onChange={(event) => {
                    setDraft((current) =>
                      current === null
                        ? current
                        : {
                            ...current,
                            openQuestionsAndLimitations: event.target.value
                              .split(/\r?\n/u)
                              .map((value) => value.trim())
                              .filter((value) => value.length > 0),
                          },
                    );
                    setPreview(null);
                  }}
                  value={draft.openQuestionsAndLimitations.join('\n')}
                />
              </section>

              {detail.readinessReasonCodes.length > 0 ? (
                <section className="brief-readiness-reasons" aria-label="Readiness 阻塞原因">
                  <div>
                    <p className="section-kicker">Deterministic readiness</p>
                    <h3>{READINESS_LABELS[detail.readiness]}</h3>
                  </div>
                  <ul>
                    {detail.readinessReasonCodes.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <p>低覆盖度、事实冲突或 stale 的简报不能进入未来正文生成。</p>
                </section>
              ) : null}

              <section className="brief-constraint-grid">
                <article>
                  <p className="section-kicker">真实性</p>
                  <h3>{draft.expressionPolicy.readingState}</h3>
                  <p>
                    {draft.expressionPolicy.firstPersonAllowed
                      ? '允许经当前权限确认的第一人称体验'
                      : '不得冒充本人读过或把资料整理写成亲历'}
                  </p>
                  <small>
                    Public labels：
                    {draft.expressionPolicy.requiredPublicLabels.join(' · ') || '无附加标签'}
                  </small>
                  <small>
                    R2 assertion allowlist：
                    {draft.expressionPolicy.r2AssertionIds.join(' · ') || '不适用'}
                  </small>
                  <small>公开资料整理或资料分析评分不代表个人阅读体验。</small>
                </article>
                <article>
                  <p className="section-kicker">剧透计划</p>
                  <h3>{draft.spoilerPlan.level}</h3>
                  <p>{draft.spoilerPlan.warningPlacement}</p>
                  <small>
                    {draft.spoilerPlan.userConfirmationRequired
                      ? draft.spoilerPlan.userConfirmed
                        ? '用户已明确确认'
                        : '等待用户明确确认'
                      : '无需额外确认'}
                  </small>
                </article>
                <article>
                  <p className="section-kicker">评分来源</p>
                  <h3>{draft.scorePlan.kind}</h3>
                  <p>{draft.scorePlan.publicLabel ?? '不输出评分'}</p>
                  <small>个人评分、资料分析评分与内部预测严格隔离</small>
                </article>
                <article>
                  <p className="section-kicker">Experiment</p>
                  <h3>
                    {draft.experimentBinding === null ? '未绑定' : draft.experimentBinding.armId}
                  </h3>
                  <p>
                    {draft.experimentBinding === null
                      ? '不声明任何实验结果'
                      : draft.experimentBinding.armValueIdentity}
                  </p>
                  <small>绑定只约束结构；不代表效果、显著性或 winner</small>
                </article>
              </section>

              <div className="brief-section-grid">
                <section>
                  <header>
                    <div>
                      <p className="section-kicker">Immutable versions & bounded diff</p>
                      <h3>版本历史</h3>
                    </div>
                    <strong>{detail.versionHistory.total}</strong>
                  </header>
                  <ol className="brief-version-list">
                    {detail.versionHistory.items.map((version) => (
                      <li key={version.versionId}>
                        <div>
                          <strong>
                            v{version.versionNumber} ·{' '}
                            {version.isCurrent ? 'CURRENT' : version.status}
                          </strong>
                          <span>
                            {version.changeKinds.join(' · ') || '初始结构'} ·{' '}
                            {READINESS_LABELS[version.readiness]}
                          </span>
                          <small>{version.createdAt}</small>
                        </div>
                        {!version.isCurrent ? (
                          <div>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void issuePreview({
                                  briefId: detail.briefId,
                                  expectedRevision: detail.revision,
                                  kind: 'UNDO',
                                  targetVersionId: version.versionId,
                                })
                              }
                              type="button"
                            >
                              Undo 到此版本
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void issuePreview({
                                  briefId: detail.briefId,
                                  expectedRevision: detail.revision,
                                  kind: 'CLONE',
                                  targetVersionId: version.versionId,
                                })
                              }
                              type="button"
                            >
                              克隆为新 Draft
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <div className="brief-pagination">
                    <button
                      disabled={busy || versionOffset === 0}
                      onClick={() =>
                        void loadDetail(
                          detail.briefId,
                          Math.max(0, versionOffset - DETAIL_PAGE_SIZE),
                          historyOffset,
                        )
                      }
                      type="button"
                    >
                      上一页版本
                    </button>
                    <span>
                      {detail.versionHistory.total === 0 ? 0 : detail.versionHistory.offset + 1}–
                      {Math.min(
                        detail.versionHistory.total,
                        detail.versionHistory.offset + detail.versionHistory.items.length,
                      )}{' '}
                      / {detail.versionHistory.total}
                    </span>
                    <button
                      disabled={
                        busy ||
                        detail.versionHistory.offset + detail.versionHistory.items.length >=
                          detail.versionHistory.total
                      }
                      onClick={() =>
                        void loadDetail(
                          detail.briefId,
                          versionOffset + DETAIL_PAGE_SIZE,
                          historyOffset,
                        )
                      }
                      type="button"
                    >
                      下一页版本
                    </button>
                  </div>
                </section>

                <section>
                  <header>
                    <div>
                      <p className="section-kicker">Append-only transitions</p>
                      <h3>操作历史</h3>
                    </div>
                    <strong>{detail.historyPage.total}</strong>
                  </header>
                  <ol className="brief-version-list">
                    {detail.history.map((event) => (
                      <li key={`${event.revision}:${event.action}`}>
                        <div>
                          <strong>
                            r{event.revision} · {event.action}
                          </strong>
                          <span>
                            {event.fromState ?? '∅'} → {event.toState}
                          </span>
                          <small>{event.createdAt}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="brief-pagination">
                    <button
                      disabled={busy || historyOffset === 0}
                      onClick={() =>
                        void loadDetail(
                          detail.briefId,
                          versionOffset,
                          Math.max(0, historyOffset - DETAIL_PAGE_SIZE),
                        )
                      }
                      type="button"
                    >
                      上一页操作
                    </button>
                    <span>
                      {detail.historyPage.total === 0 ? 0 : detail.historyPage.offset + 1}–
                      {Math.min(
                        detail.historyPage.total,
                        detail.historyPage.offset + detail.history.length,
                      )}{' '}
                      / {detail.historyPage.total}
                    </span>
                    <button
                      disabled={
                        busy ||
                        detail.historyPage.offset + detail.history.length >=
                          detail.historyPage.total
                      }
                      onClick={() =>
                        void loadDetail(
                          detail.briefId,
                          versionOffset,
                          historyOffset + DETAIL_PAGE_SIZE,
                        )
                      }
                      type="button"
                    >
                      下一页操作
                    </button>
                  </div>
                </section>
              </div>

              <section className="brief-generation-card">
                <div>
                  <p className="section-kicker">Structured generation</p>
                  <h3>最多一次受控模型请求</h3>
                  <p>
                    输入只含最小证据摘要、allowlist、锁与政策；候选无法覆盖 USER_LOCKED /
                    SYSTEM_LOCKED 字段。
                  </p>
                  <small>锁定字段不会被重新生成覆盖；每次运行最多一个外部请求。</small>
                </div>
                <button
                  disabled={
                    busy ||
                    detail.readiness !== 'READY_FOR_DRAFT_GENERATION' ||
                    detail.state === 'ARCHIVED'
                  }
                  onClick={() =>
                    void issuePreview({
                      briefId: detail.briefId,
                      expectedRevision: detail.revision,
                      kind: 'PREVIEW_GENERATION',
                    })
                  }
                  type="button"
                >
                  预览结构生成
                </button>
              </section>

              <section className="brief-generation-history">
                <header>
                  <div>
                    <p className="section-kicker">Generation progress & recovery</p>
                    <h3>结构候选任务历史</h3>
                  </div>
                  <strong>{detail.generationPage.total}</strong>
                </header>
                <ol>
                  {detail.generationRuns.map((run) => (
                    <li key={run.runId}>
                      <div>
                        <strong>{run.status}</strong>
                        <span>
                          request {run.externalRequestCount}/1 · cost {run.costState}
                        </span>
                        <small>
                          {run.stableErrorCode ?? '无错误'} · r{run.revision}
                        </small>
                      </div>
                      {['CONFIRMED', 'PAUSED'].includes(run.status) ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void issuePreview({
                              expectedRevision: run.revision,
                              kind: 'CANCEL_GENERATION',
                              runId: run.runId,
                            })
                          }
                          type="button"
                        >
                          预览取消
                        </button>
                      ) : run.status === 'RUNNING' ? (
                        <small>已发送或执行中；仅协作取消，不伪装为未发送</small>
                      ) : null}
                    </li>
                  ))}
                  {detail.generationRuns.length === 0 ? (
                    <li>
                      <span>尚无生成任务；本地 scaffold 不需要模型。</span>
                    </li>
                  ) : null}
                </ol>
                <div className="brief-pagination">
                  <button
                    disabled={busy || generationOffset === 0}
                    onClick={() =>
                      void loadDetail(
                        detail.briefId,
                        versionOffset,
                        historyOffset,
                        evidenceOffset,
                        Math.max(0, generationOffset - DETAIL_PAGE_SIZE),
                      )
                    }
                    type="button"
                  >
                    上一页任务
                  </button>
                  <span>
                    {detail.generationPage.total === 0 ? 0 : detail.generationPage.offset + 1}–
                    {Math.min(
                      detail.generationPage.total,
                      detail.generationPage.offset + detail.generationRuns.length,
                    )}{' '}
                    / {detail.generationPage.total}
                  </span>
                  <button
                    disabled={
                      busy ||
                      detail.generationPage.offset + detail.generationRuns.length >=
                        detail.generationPage.total
                    }
                    onClick={() =>
                      void loadDetail(
                        detail.briefId,
                        versionOffset,
                        historyOffset,
                        evidenceOffset,
                        generationOffset + DETAIL_PAGE_SIZE,
                      )
                    }
                    type="button"
                  >
                    下一页任务
                  </button>
                </div>
              </section>

              {confirmationPanel}

              <footer className="brief-status-line">
                <span>{message}</span>
                <span>最终发布始终由用户手动完成</span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
