import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  DesktopError,
  ExperimentActionPreview,
  ExperimentDetailView,
  ExperimentListView,
  PreviewExperimentActionInput,
} from '@mystery-operations/shared';

type ExperimentDesignDraft = ExperimentDetailView['design'];
type ExperimentVariableKind = ExperimentDesignDraft['primaryVariable']['kind'];
type ExperimentMetricId = ExperimentDesignDraft['primaryMetric']['metricId'];
type WorkPopularityStratum = 'HOT' | 'WARM' | 'COLD' | 'UNKNOWN';

const EXPERIMENT_VARIABLE_KINDS: readonly ExperimentVariableKind[] = [
  'CONTENT_STRUCTURE',
  'TITLE_PATTERN',
  'COVER_INFORMATION_DENSITY',
  'SPOILER_MODE',
  'COMPARISON_FORMAT',
  'PUBLICATION_TIME_WINDOW',
];
const EXPERIMENT_VARIABLE_VALUES: Readonly<Record<ExperimentVariableKind, readonly string[]>> = {
  COMPARISON_FORMAT: ['PAIRWISE', 'GROUPED_DIMENSION', 'TIMELINE_CONTRAST'],
  CONTENT_STRUCTURE: [
    'CLAIM_EVIDENCE_COUNTERPOINT',
    'QUESTION_ANALYSIS_VERDICT',
    'OBSERVATION_MECHANISM_IMPLICATION',
  ],
  COVER_INFORMATION_DENSITY: ['FUTURE_SPARSE', 'FUTURE_BALANCED', 'FUTURE_DENSE'],
  PUBLICATION_TIME_WINDOW: ['FUTURE_WEEKDAY_DAY', 'FUTURE_WEEKDAY_EVENING', 'FUTURE_WEEKEND'],
  SPOILER_MODE: ['NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS'],
  TITLE_PATTERN: ['FUTURE_QUESTION_LED', 'FUTURE_JUDGMENT_LED', 'FUTURE_CONTRAST_LED'],
};
const EXPERIMENT_METRIC_IDS: readonly ExperimentMetricId[] = [
  'SAVE_RATE',
  'COMMENT_RATE',
  'FOLLOW_CONVERSION_RATE',
  'ENGAGEMENT_RATE',
  'PROFILE_VISIT_RATE',
  'APPROVAL_WORK_UNITS',
  'FACT_BLOCK_RATE',
];

const PAGE_SIZE = 24;
const PROFILE_ID = 'primary';
const STATES = [
  'DRAFT',
  'VALIDATED',
  'ASSIGNMENT_READY',
  'LOCKED',
  'HELD',
  'ARCHIVED',
  'SUPERSEDED',
  'STALE',
] as const;

const STATE_LABELS = new Map([
  ['DRAFT', '草稿'],
  ['VALIDATED', '设计有效'],
  ['ASSIGNMENT_READY', '分配可锁定'],
  ['LOCKED', '设计已冻结'],
  ['HELD', '已暂存'],
  ['ARCHIVED', '已归档'],
  ['SUPERSEDED', '已被新版本替代'],
  ['STALE', '依赖已失效'],
] as const);

const VARIABLE_LABELS = new Map<ExperimentVariableKind, string>([
  ['CONTENT_STRUCTURE', '内容结构'],
  ['TITLE_PATTERN', '未来标题模式（仅意图）'],
  ['COVER_INFORMATION_DENSITY', '未来封面信息密度（仅意图）'],
  ['SPOILER_MODE', '剧透模式'],
  ['COMPARISON_FORMAT', '比较形式'],
  ['PUBLICATION_TIME_WINDOW', '未来发布时段（仅意图）'],
]);

const METRIC_LABELS = new Map<ExperimentMetricId, string>([
  ['SAVE_RATE', '未来收藏率'],
  ['COMMENT_RATE', '未来评论率'],
  ['FOLLOW_CONVERSION_RATE', '未来关注转化率'],
  ['ENGAGEMENT_RATE', '未来互动率'],
  ['PROFILE_VISIT_RATE', '未来主页访问率'],
  ['APPROVAL_WORK_UNITS', '未来人工审批工作量'],
  ['FACT_BLOCK_RATE', '未来事实阻断率'],
]);

interface EditorState {
  readonly analysisMode: 'PERSONAL' | 'PUBLIC_RESEARCH';
  readonly assumptions: string;
  readonly audience: string;
  readonly comparator: string;
  readonly contentType: ExperimentDesignDraft['replicationStructure']['contentType'];
  readonly controlValue: string;
  readonly falsification: string;
  readonly guardrailCondition: string;
  readonly guardrailMetric: ExperimentMetricId | '';
  readonly intervention: string;
  readonly name: string;
  readonly popularityRows: string;
  readonly primaryMetric: ExperimentMetricId;
  readonly primaryVariable: ExperimentVariableKind;
  readonly rationale: string;
  readonly scope: string;
  readonly seed: string;
  readonly slots: string;
  readonly spoilerLevel: ExperimentDesignDraft['replicationStructure']['spoilerLevel'];
  readonly targetTopics: string;
  readonly treatmentValue: string;
}

function initialEditor(): EditorState {
  return {
    analysisMode: 'PUBLIC_RESEARCH',
    assumptions: '未来样本使用相同结构槽位\n未来观测窗口保持一致',
    audience: '希望快速判断推理作品阅读价值的读者',
    comparator: '使用问题—分析—判断结构',
    contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
    controlValue: 'QUESTION_ANALYSIS_VERDICT',
    falsification: '未来主指标未按预登记方向变化，或任一 guardrail 违反预登记条件',
    guardrailCondition: '未来 FACT_BLOCK_RATE 高于预登记阈值',
    guardrailMetric: 'FACT_BLOCK_RATE',
    intervention: '使用主张—证据—反方结构',
    name: '单变量内容结构实验',
    popularityRows: '',
    primaryMetric: 'SAVE_RATE',
    primaryVariable: 'CONTENT_STRUCTURE',
    rationale: '比较同一资料分析结构在不同作品上的未来可观测行为',
    scope: '明确选中的同结构 TopicCandidate',
    seed: 'experiment-seed-v1',
    slots: 'QUESTION\nEVIDENCE\nCOUNTERPOINT\nJUDGMENT',
    spoilerLevel: 'NO_SPOILER',
    targetTopics: '',
    treatmentValue: 'CLAIM_EVIDENCE_COUNTERPOINT',
  };
}

function lines(value: string): readonly string[] {
  return value
    .split(/\r?\n|,/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function metricSpec(metricId: ExperimentMetricId, direction: 'INCREASE' | 'LIMIT') {
  const rate = metricId.endsWith('_RATE');
  return {
    availability: 'DEFINED_NOT_AVAILABLE' as const,
    denominator: rate ? '未来可观测曝光数' : null,
    direction,
    metricId,
    missingValuePolicy: 'KEEP_AS_MISSING' as const,
    numerator: `未来可观测 ${metricId}`,
    observationWindow: '未来发布后七日窗口',
    unit: rate ? ('RATE' as const) : ('WORK_UNIT' as const),
    zeroDenominatorPolicy: 'RETURN_UNAVAILABLE' as const,
  };
}

function popularitySnapshots(value: string) {
  return lines(value).map((row, index) => {
    const [workId, rawStratum = 'UNKNOWN', metricReference, windowStart, windowEnd, provenance] =
      row.split('|').map((item) => item.trim());
    if (workId === undefined || workId.length === 0) throw new Error('每行必须先填写 Work ID。');
    const stratum = rawStratum.toUpperCase() as WorkPopularityStratum;
    if (!['HOT', 'WARM', 'COLD', 'UNKNOWN'].includes(stratum)) {
      throw new Error(`无效热度分层：${rawStratum}`);
    }
    if (stratum === 'UNKNOWN') {
      return {
        availability: 'UNAVAILABLE' as const,
        confidence: 'UNAVAILABLE' as const,
        metricReference: null,
        observedAt: null,
        policyVersion: 'work-popularity-stratum-v1',
        provenance: [] as readonly string[],
        snapshotId: `popularity-ui-${index + 1}-${workId}`,
        sourceKind: 'NOT_AVAILABLE' as const,
        stratum,
        windowEnd: null,
        windowStart: null,
        workId,
      };
    }
    if (
      metricReference === undefined ||
      metricReference.length === 0 ||
      windowStart === undefined ||
      windowEnd === undefined ||
      provenance === undefined ||
      provenance.length === 0
    ) {
      throw new Error('非 UNKNOWN 分层必须填写分类依据、起止时间和来源说明。');
    }
    return {
      availability: 'AVAILABLE' as const,
      confidence: 'CONFIRMED' as const,
      metricReference,
      observedAt: windowEnd,
      policyVersion: 'work-popularity-stratum-v1',
      provenance: [provenance],
      snapshotId: `popularity-ui-${index + 1}-${workId}`,
      sourceKind: 'USER_CONFIRMED_OBSERVATION' as const,
      stratum,
      windowEnd,
      windowStart,
      workId,
    };
  });
}

function buildDesign(editor: EditorState): ExperimentDesignDraft {
  const targetTopicIds = lines(editor.targetTopics);
  const snapshots = popularitySnapshots(editor.popularityRows);
  const structuralSlots = lines(editor.slots);
  const assumptions = lines(editor.assumptions);
  const targetControl = Math.ceil(targetTopicIds.length / 2);
  const targetTreatment = Math.floor(targetTopicIds.length / 2);
  const conditions: ExperimentDesignDraft['controlledConditions'] = [
    {
      availability: 'FIXED',
      kind: 'TOPIC_CONTENT_TYPE',
      valueIdentity: editor.contentType,
    },
    { availability: 'FIXED', kind: 'ANALYSIS_MODE', valueIdentity: editor.analysisMode },
    {
      availability: 'FIXED',
      kind: 'WORK_POPULARITY_STRATUM',
      valueIdentity: 'EXPLICIT_SNAPSHOT_ONLY',
    },
    ...(
      [
        ['CONTENT_STRUCTURE', 'QUESTION_EVIDENCE_JUDGMENT'],
        ['SPOILER_MODE', editor.spoilerLevel],
        ['COMPARISON_FORMAT', 'NOT_APPLICABLE_FIXED'],
        ['TITLE_PATTERN', 'FUTURE_FIXED_NOT_GENERATED'],
        ['COVER_INFORMATION_DENSITY', 'FUTURE_FIXED_NOT_GENERATED'],
        ['PUBLICATION_TIME_WINDOW', 'FUTURE_FIXED_NOT_SCHEDULED'],
      ] as const
    )
      .filter(([kind]) => kind !== editor.primaryVariable)
      .map(([kind, valueIdentity]) => ({
        availability:
          kind === 'TITLE_PATTERN' ||
          kind === 'COVER_INFORMATION_DENSITY' ||
          kind === 'PUBLICATION_TIME_WINDOW'
            ? ('FUTURE_NOT_IMPLEMENTED' as const)
            : ('FIXED' as const),
        kind,
        valueIdentity,
      })),
  ];
  return {
    controlledConditions: conditions,
    guardrails:
      editor.guardrailMetric === ''
        ? []
        : [
            {
              direction: 'NOT_INCREASE',
              metric: metricSpec(editor.guardrailMetric, 'LIMIT'),
              violationCondition: editor.guardrailCondition,
            },
          ],
    hypothesis: {
      assumptions,
      comparator: editor.comparator,
      expectedDirection: 'INCREASE',
      falsificationCondition: editor.falsification,
      intervention: editor.intervention,
      primaryOutcomeMetricId: editor.primaryMetric,
      rationale: editor.rationale,
      scope: editor.scope,
      targetAudienceContext: editor.audience,
    },
    name: editor.name,
    popularitySnapshots: snapshots,
    primaryMetric: metricSpec(editor.primaryMetric, 'INCREASE'),
    primaryVariable: {
      arms: [
        {
          armId: 'control',
          changedDimensions: [editor.primaryVariable],
          label: `Control · ${editor.controlValue}`,
          role: 'CONTROL',
          valueIdentity: editor.controlValue,
        },
        {
          armId: 'treatment',
          changedDimensions: [editor.primaryVariable],
          label: `Treatment · ${editor.treatmentValue}`,
          role: 'TREATMENT',
          valueIdentity: editor.treatmentValue,
        },
      ],
      kind: editor.primaryVariable,
    },
    replicationStructure: {
      analysisMode: editor.analysisMode,
      comparisonDimension: null,
      contentType: editor.contentType,
      requiredLabels: ['EXPERIMENT_REPLICATION'],
      spoilerLevel: editor.spoilerLevel,
      structureIdentity: `ui-${editor.contentType.toLowerCase()}`,
      structureVersion: 'replication-structure-v1',
      structuralSlots,
    },
    samplePlan: {
      armTargetCounts: { control: targetControl, treatment: targetTreatment },
      assignmentUnit: 'TOPIC_CANDIDATE',
      blockingKeys: ['POPULARITY_STRATUM'],
      deterministicSeed: editor.seed,
      exclusionRules: ['HELD_OR_ARCHIVED', 'NOT_CURRENT', 'NOT_ELIGIBLE'],
      inclusionRules: ['EXPLICIT_TOPIC_SELECTION', 'STRUCTURE_MATCH'],
      maxTopicsPerWork: 1,
      minimumDistinctWorkCount: 3,
      quotaPlanVersionId: null,
      targetTopicIds,
    },
  };
}

function editorFromDesign(design: ExperimentDesignDraft): EditorState {
  const guardrail = design.guardrails[0];
  const control = design.primaryVariable.arms.find((arm) => arm.role === 'CONTROL');
  const treatment = design.primaryVariable.arms.find((arm) => arm.role === 'TREATMENT');
  return {
    analysisMode: design.replicationStructure.analysisMode,
    assumptions: design.hypothesis.assumptions.join('\n'),
    audience: design.hypothesis.targetAudienceContext,
    comparator: design.hypothesis.comparator,
    contentType: design.replicationStructure.contentType,
    controlValue: control?.valueIdentity ?? '',
    falsification: design.hypothesis.falsificationCondition,
    guardrailCondition: guardrail?.violationCondition ?? '',
    guardrailMetric: guardrail?.metric.metricId ?? '',
    intervention: design.hypothesis.intervention,
    name: design.name,
    popularityRows: design.popularitySnapshots
      .map((snapshot) =>
        snapshot.stratum === 'UNKNOWN'
          ? `${snapshot.workId}|UNKNOWN`
          : [
              snapshot.workId,
              snapshot.stratum,
              snapshot.metricReference,
              snapshot.windowStart,
              snapshot.windowEnd,
              snapshot.provenance[0] ?? '用户确认',
            ].join('|'),
      )
      .join('\n'),
    primaryMetric: design.primaryMetric.metricId,
    primaryVariable: design.primaryVariable.kind,
    rationale: design.hypothesis.rationale,
    scope: design.hypothesis.scope,
    seed: design.samplePlan.deterministicSeed,
    slots: design.replicationStructure.structuralSlots.join('\n'),
    spoilerLevel: design.replicationStructure.spoilerLevel,
    targetTopics: design.samplePlan.targetTopicIds.join('\n'),
    treatmentValue: treatment?.valueIdentity ?? '',
  };
}

function experimentError(error: DesktopError): string {
  const labels: Partial<Record<DesktopError['code'], string>> = {
    EXPERIMENT_CONFIRMATION_INVALID: '确认已过期、已使用或不属于当前窗口，请重新预览。',
    EXPERIMENT_CONFLICT: '实验数据发生冲突，请刷新后重试。',
    EXPERIMENT_INVALID_CONTRACT: '设计不符合单变量、指标、分层或样本合同。',
    EXPERIMENT_NOT_FOUND: '未找到该实验或本地项目尚未初始化。',
    EXPERIMENT_POLICY_BLOCKED: '当前资格、复现、失效或状态政策阻止此操作。',
    EXPERIMENT_STALE_REVISION: '实验已更新，本次预览失效；请重新加载。',
    EXPERIMENT_UNSUPPORTED: '当前版本不支持该实验能力。',
  };
  return labels[error.code] ?? error.message;
}

function assignmentTone(status: string): string {
  if (status === 'READY_TO_LOCK') return 'ready';
  if (status === 'STALE') return 'stale';
  if (status === 'UNBALANCED') return 'warning';
  return 'insufficient';
}

function availableActions(detail: ExperimentDetailView) {
  if (detail.stale) return [] as const;
  switch (detail.state) {
    case 'DRAFT':
      return ['VALIDATE', 'HOLD', 'ARCHIVE'] as const;
    case 'VALIDATED':
      return ['HOLD', 'ARCHIVE'] as const;
    case 'ASSIGNMENT_READY':
      return ['LOCK', 'HOLD', 'ARCHIVE'] as const;
    case 'LOCKED':
      return ['HOLD', 'ARCHIVE'] as const;
    case 'HELD':
      return ['RESUME', 'ARCHIVE'] as const;
    case 'ARCHIVED':
      return ['RESTORE'] as const;
    default:
      return [] as const;
  }
}

export function ExperimentManagementPage(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<ExperimentListView | null>(null);
  const [detail, setDetail] = useState<ExperimentDetailView | null>(null);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<(typeof STATES)[number] | null>(null);
  const [offset, setOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [versionOffset, setVersionOffset] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ExperimentActionPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorMode, setEditorMode] = useState<'CREATE_DRAFT' | 'CLONE_VERSION'>('CREATE_DRAFT');

  const loadList = useCallback(async (): Promise<void> => {
    const method = window.rednoteDesktop?.getExperiments;
    if (method === undefined) {
      setPhase('error');
      setNotice('当前桌面桥接尚未提供实验管理能力。');
      return;
    }
    setPhase('loading');
    const result = await method({
      limit: PAGE_SIZE,
      offset,
      profileId: PROFILE_ID,
      query,
      state,
    });
    if (!result.ok) {
      setPhase('error');
      setNotice(experimentError(result.error));
      return;
    }
    setWorkspace(result.value);
    setPhase('ready');
  }, [offset, query, state]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openExperiment = useCallback(
    async (experimentId: string, nextVersionOffset = 0, nextHistoryOffset = 0): Promise<void> => {
      const method = window.rednoteDesktop?.getExperiment;
      if (method === undefined) return;
      const result = await method({
        experimentId,
        historyLimit: PAGE_SIZE,
        historyOffset: nextHistoryOffset,
        versionLimit: PAGE_SIZE,
        versionOffset: nextVersionOffset,
      });
      if (!result.ok) {
        setNotice(experimentError(result.error));
        return;
      }
      setDetail(result.value);
      setHistoryOffset(nextHistoryOffset);
      setVersionOffset(nextVersionOffset);
      setEditor(null);
      setPreview(null);
      setNotice('');
    },
    [],
  );

  const requestPreview = async (input: PreviewExperimentActionInput): Promise<void> => {
    const method = window.rednoteDesktop?.previewExperimentAction;
    if (method === undefined) {
      setNotice('桌面桥接未提供实验确认能力。');
      return;
    }
    setNotice('');
    const result = await method(input);
    if (!result.ok) {
      setNotice(experimentError(result.error));
      return;
    }
    setPreview(result.value);
  };

  const confirmPreview = async (): Promise<void> => {
    if (preview === null) return;
    const method = window.rednoteDesktop?.confirmExperimentAction;
    if (method === undefined) return;
    setConfirming(true);
    const result = await method({
      confirmation: 'APPLY_EXPERIMENT_ACTION',
      kind: preview.kind,
      previewHash: preview.previewHash,
      token: preview.token,
    });
    setConfirming(false);
    setPreview(null);
    if (!result.ok) {
      setNotice(experimentError(result.error));
      return;
    }
    setDetail(result.value.detail);
    setEditor(null);
    setNotice(
      result.value.detail.state === 'LOCKED'
        ? '设计与分配已冻结；这不表示已发布、已开始实验或已有结果。'
        : '本地实验设计已更新。',
    );
    await loadList();
  };

  const submitEditor = (): void => {
    if (editor === null) return;
    try {
      const design = buildDesign(editor);
      if (editorMode === 'CREATE_DRAFT') {
        void requestPreview({ design, kind: 'CREATE_DRAFT', profileId: PROFILE_ID });
      } else if (detail !== null) {
        void requestPreview({
          design,
          expectedRevision: detail.revision,
          experimentId: detail.experimentId,
          kind: 'CLONE_VERSION',
        });
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '实验设计输入无效。');
    }
  };

  const variableValues = useMemo(
    () => (editor === null ? [] : [...EXPERIMENT_VARIABLE_VALUES[editor.primaryVariable]]),
    [editor],
  );

  return (
    <div className="experiment-page">
      <section className="experiment-hero">
        <div>
          <p className="section-kicker">M3 · Experiment Design V1</p>
          <h2>把判断变成可反驳、可复现的实验</h2>
          <p>
            每个实验只允许一个主要变量，使用 control / treatment arms，并在至少三个不同 Work
            上复现同一结构。所有指标都只是未来定义。
          </p>
        </div>
        <div className="experiment-hero__status">
          <strong>尚未执行</strong>
          <span>无效果结论 · 无 winner · 无显著性计算</span>
          <button
            className="primary-button"
            onClick={() => {
              setEditor(initialEditor());
              setEditorMode('CREATE_DRAFT');
              setDetail(null);
              setPreview(null);
            }}
            type="button"
          >
            新建实验草稿
          </button>
        </div>
      </section>

      <section className="experiment-policy-strip" aria-label="实验硬约束">
        <span>01 精确一个 primary variable</span>
        <span>02 精确一个 primary metric</span>
        <span>03 ≥ 3 个 canonical Work</span>
        <span>04 UNKNOWN ≠ COLD</span>
        <span>05 LOCKED ≠ RUNNING</span>
      </section>

      {notice.length > 0 ? (
        <div aria-live="polite" className="experiment-notice">
          {notice}
        </div>
      ) : null}

      {preview === null ? null : (
        <section aria-live="polite" className="experiment-preview">
          <div>
            <p className="section-kicker">确认前预览 · {preview.kind}</p>
            {preview.preview.kind === 'SAVE_ASSIGNMENT' ? (
              <>
                <h3>{preview.preview.status}</h3>
                <p>
                  {preview.preview.distinctWorkCount} 个 Work · {preview.preview.unitPage.total} 个
                  Topic · hash {preview.preview.assignmentHash.slice(0, 12)}…
                </p>
                <div className="experiment-balance-row">
                  {Object.entries(preview.preview.armCounts).map(([arm, count]) => (
                    <span key={arm}>
                      {arm} <strong>{count}</strong>
                    </span>
                  ))}
                </div>
                <div className="experiment-preview-units">
                  {preview.preview.units.slice(0, 12).map((unit) => (
                    <span key={unit.topicId}>
                      {unit.topicId} → {unit.armId} · {unit.popularityStratum}
                    </span>
                  ))}
                </div>
                <p>
                  Shortfall：{JSON.stringify(preview.preview.shortfallByArm)} · Strata imbalance：
                  {JSON.stringify(preview.preview.imbalanceByStratum)}
                  {preview.preview.unitPage.truncated ? ' · 其余样本在有界页中省略' : ''}
                </p>
              </>
            ) : preview.preview.kind === 'STATE_ACTION' ? (
              <>
                <h3>
                  {STATE_LABELS.get(preview.preview.before)} →{' '}
                  {STATE_LABELS.get(preview.preview.after)}
                </h3>
                <p>锁定只冻结设计与 assignment，不触发生产、排期、发布或结果计算。</p>
              </>
            ) : (
              <>
                <h3>{preview.preview.name}</h3>
                <p>
                  {VARIABLE_LABELS.get(preview.preview.primaryVariableKind)} ·{' '}
                  {METRIC_LABELS.get(preview.preview.primaryMetricId as ExperimentMetricId)} ·{' '}
                  {preview.preview.targetTopicCount} 个目标 Topic
                </p>
              </>
            )}
          </div>
          <div className="experiment-preview__actions">
            <button className="secondary-button" onClick={() => setPreview(null)} type="button">
              取消
            </button>
            <button
              className="primary-button"
              disabled={confirming}
              onClick={() => void confirmPreview()}
              type="button"
            >
              {confirming ? '正在写入本地版本…' : '确认本次本地操作'}
            </button>
          </div>
        </section>
      )}

      <section className="experiment-toolbar">
        <label>
          <span>搜索实验</span>
          <input
            onChange={(event) => {
              setOffset(0);
              setQuery(event.target.value);
            }}
            placeholder="名称"
            type="search"
            value={query}
          />
        </label>
        <label>
          <span>设计状态</span>
          <select
            onChange={(event) => {
              setOffset(0);
              setState((event.target.value || null) as (typeof STATES)[number] | null);
            }}
            value={state ?? ''}
          >
            <option value="">全部</option>
            {STATES.map((item) => (
              <option key={item} value={item}>
                {STATE_LABELS.get(item)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" onClick={() => void loadList()} type="button">
          刷新
        </button>
      </section>

      <section className="experiment-layout">
        <aside className="experiment-list-panel">
          <header>
            <div>
              <p className="section-kicker">Experiment registry</p>
              <h3>{workspace?.total ?? 0} 个版本化实验</h3>
            </div>
          </header>
          {phase === 'loading' ? (
            <div className="experiment-empty">正在读取本地实验索引…</div>
          ) : phase === 'error' ? (
            <div className="experiment-empty is-error">实验列表暂不可用。</div>
          ) : workspace?.items.length === 0 ? (
            <div className="experiment-empty">
              <strong>还没有实验</strong>
              <span>先创建一份可检验的单变量设计草稿。</span>
            </div>
          ) : (
            <div className="experiment-list">
              {workspace?.items.map((item) => (
                <button
                  className={
                    detail?.experimentId === item.experimentId
                      ? 'experiment-list-item is-selected'
                      : 'experiment-list-item'
                  }
                  key={item.experimentId}
                  onClick={() => void openExperiment(item.experimentId)}
                  type="button"
                >
                  <span
                    className={`experiment-state experiment-state--${item.state.toLowerCase()}`}
                  >
                    {STATE_LABELS.get(item.state)}
                  </span>
                  <strong>{item.name}</strong>
                  <span>
                    v{item.versionNumber} · {VARIABLE_LABELS.get(item.primaryVariableKind)}
                  </span>
                  <small>{METRIC_LABELS.get(item.primaryMetricId as ExperimentMetricId)}</small>
                </button>
              ))}
            </div>
          )}
          <footer className="experiment-pagination">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              type="button"
            >
              上一页
            </button>
            <span>{Math.floor(offset / PAGE_SIZE) + 1}</span>
            <button
              disabled={(workspace?.items.length ?? 0) < PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              type="button"
            >
              下一页
            </button>
          </footer>
        </aside>

        <main className="experiment-detail-panel">
          {editor !== null ? (
            <section className="experiment-editor">
              <header>
                <div>
                  <p className="section-kicker">
                    {editorMode === 'CREATE_DRAFT' ? '新实验草稿' : 'Clone as new version'}
                  </p>
                  <h3>预登记设计</h3>
                </div>
                <button className="text-button" onClick={() => setEditor(null)} type="button">
                  关闭
                </button>
              </header>
              <div className="experiment-form-grid">
                <label className="is-wide">
                  <span>实验名称</span>
                  <input
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null ? current : { ...current, name: event.target.value },
                      )
                    }
                    value={editor.name}
                  />
                </label>
                <label>
                  <span>Primary variable</span>
                  <select
                    onChange={(event) => {
                      const primaryVariable = event.target.value as ExperimentVariableKind;
                      const values = EXPERIMENT_VARIABLE_VALUES[primaryVariable];
                      setEditor((current) =>
                        current === null
                          ? current
                          : {
                              ...current,
                              controlValue: values[0] ?? '',
                              primaryVariable,
                              treatmentValue: values[1] ?? '',
                            },
                      );
                    }}
                    value={editor.primaryVariable}
                  >
                    {EXPERIMENT_VARIABLE_KINDS.map((item) => (
                      <option key={item} value={item}>
                        {VARIABLE_LABELS.get(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Primary metric（仅未来定义）</span>
                  <select
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null
                          ? current
                          : {
                              ...current,
                              primaryMetric: event.target.value as ExperimentMetricId,
                            },
                      )
                    }
                    value={editor.primaryMetric}
                  >
                    {EXPERIMENT_METRIC_IDS.map((item) => (
                      <option key={item} value={item}>
                        {METRIC_LABELS.get(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Control arm</span>
                  <select
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null
                          ? current
                          : { ...current, controlValue: event.target.value },
                      )
                    }
                    value={editor.controlValue}
                  >
                    {variableValues.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Treatment arm</span>
                  <select
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null
                          ? current
                          : { ...current, treatmentValue: event.target.value },
                      )
                    }
                    value={editor.treatmentValue}
                  >
                    {variableValues.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    ['audience', '目标读者 / 情境'],
                    ['intervention', 'Intervention'],
                    ['comparator', 'Comparator'],
                    ['rationale', 'Rationale'],
                    ['falsification', 'Falsification condition'],
                    ['scope', 'Scope'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="is-wide" key={key}>
                    <span>{label}</span>
                    <textarea
                      onChange={(event) =>
                        setEditor((current) =>
                          current === null ? current : { ...current, [key]: event.target.value },
                        )
                      }
                      value={editor[key]}
                    />
                  </label>
                ))}
                <label>
                  <span>内容类型</span>
                  <select
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null
                          ? current
                          : {
                              ...current,
                              contentType: event.target
                                .value as ExperimentDesignDraft['replicationStructure']['contentType'],
                            },
                      )
                    }
                    value={editor.contentType}
                  >
                    <option value="NON_SPOILER_SINGLE_BOOK_VERDICT">不剧透单书判断</option>
                    <option value="FULL_TRICK_LOGIC_ANALYSIS">全诡计逻辑分析</option>
                    <option value="CROSS_WORK_COMPARISON">跨作品比较</option>
                    <option value="WEB_VS_PUBLISHED_MYSTERY">网络与出版推理</option>
                    <option value="MYSTERY_AND_CULTURAL_PHENOMENON">推理与文化现象</option>
                  </select>
                </label>
                <label>
                  <span>分析模式</span>
                  <select
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null
                          ? current
                          : {
                              ...current,
                              analysisMode: event.target.value as EditorState['analysisMode'],
                            },
                      )
                    }
                    value={editor.analysisMode}
                  >
                    <option value="PUBLIC_RESEARCH">资料分析</option>
                    <option value="PERSONAL">第一人称（需既有权限）</option>
                  </select>
                </label>
                <label className="is-wide">
                  <span>结构槽位（每行一个）</span>
                  <textarea
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null ? current : { ...current, slots: event.target.value },
                      )
                    }
                    value={editor.slots}
                  />
                </label>
                <label className="is-wide">
                  <span>目标 Topic ID（每行一个；不会自动改动 Topic）</span>
                  <textarea
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null
                          ? current
                          : { ...current, targetTopics: event.target.value },
                      )
                    }
                    placeholder="topic:…"
                    value={editor.targetTopics}
                  />
                </label>
                <label className="is-wide">
                  <span>Work 分层快照</span>
                  <textarea
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null
                          ? current
                          : { ...current, popularityRows: event.target.value },
                      )
                    }
                    placeholder={
                      'work-id|UNKNOWN\n或 work-id|HOT|分类依据|2026-01-01T00:00:00.000Z|2026-01-08T00:00:00.000Z|用户确认来源'
                    }
                    value={editor.popularityRows}
                  />
                  <small>
                    默认 UNKNOWN；不会根据书名、模型记忆或出版社推断。UNKNOWN 不等于 COLD。
                  </small>
                </label>
                <label>
                  <span>Guardrail（可空）</span>
                  <select
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null
                          ? current
                          : {
                              ...current,
                              guardrailMetric: event.target.value as ExperimentMetricId | '',
                            },
                      )
                    }
                    value={editor.guardrailMetric}
                  >
                    <option value="">无</option>
                    {EXPERIMENT_METRIC_IDS.filter((item) => item !== editor.primaryMetric).map(
                      (item) => (
                        <option key={item} value={item}>
                          {METRIC_LABELS.get(item)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  <span>确定性 seed</span>
                  <input
                    onChange={(event) =>
                      setEditor((current) =>
                        current === null ? current : { ...current, seed: event.target.value },
                      )
                    }
                    value={editor.seed}
                  />
                </label>
              </div>
              <div className="experiment-editor__footer">
                <p>
                  不生成 Content Brief、文案或图片；不写入真实指标，也不计算 effect、显著性或
                  winner。
                </p>
                <button className="primary-button" onClick={submitEditor} type="button">
                  预览版本写入
                </button>
              </div>
            </section>
          ) : detail === null ? (
            <div className="experiment-empty experiment-empty--detail">
              <span>EXPERIMENT / V1</span>
              <strong>选择实验查看设计，或创建一份新草稿</strong>
              <p>所有版本、分配、状态转换与依赖失效都保留本地审计记录。</p>
            </div>
          ) : (
            <section className="experiment-detail">
              <header className="experiment-detail__header">
                <div>
                  <div className="experiment-title-row">
                    <span
                      className={`experiment-state experiment-state--${detail.state.toLowerCase()}`}
                    >
                      {STATE_LABELS.get(detail.state)}
                    </span>
                    <span>v{detail.versionNumber}</span>
                    <span>revision {detail.revision}</span>
                  </div>
                  <h3>{detail.name}</h3>
                  <p>{detail.design.hypothesis.scope}</p>
                </div>
                <div className="experiment-action-stack">
                  {!detail.stale && !['LOCKED', 'HELD', 'ARCHIVED'].includes(detail.state) ? (
                    <button
                      className="primary-button"
                      onClick={() =>
                        void requestPreview({
                          experimentId: detail.experimentId,
                          kind: 'SAVE_ASSIGNMENT',
                        })
                      }
                      type="button"
                    >
                      预览确定性分配
                    </button>
                  ) : null}
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setEditor(editorFromDesign(detail.design));
                      setEditorMode('CLONE_VERSION');
                    }}
                    type="button"
                  >
                    Clone 新版本
                  </button>
                </div>
              </header>

              {detail.stale ? (
                <div className="experiment-stale-banner">
                  <strong>依赖已变化，当前设计/分配不可继续锁定</strong>
                  <span>{detail.invalidationReasons.join(' · ')}</span>
                  <span>系统不会自动重排或解锁；请 clone 新版本后重新确认。</span>
                </div>
              ) : null}

              <div className="experiment-summary-grid">
                <article>
                  <span>Primary variable</span>
                  <strong>{VARIABLE_LABELS.get(detail.design.primaryVariable.kind)}</strong>
                  <small>严格单一维度</small>
                </article>
                <article>
                  <span>Primary metric</span>
                  <strong>{METRIC_LABELS.get(detail.design.primaryMetric.metricId)}</strong>
                  <small>{detail.design.primaryMetric.availability}</small>
                </article>
                <article>
                  <span>Replication</span>
                  <strong>{detail.design.samplePlan.minimumDistinctWorkCount}+ Works</strong>
                  <small>{detail.design.replicationStructure.structureVersion}</small>
                </article>
                <article>
                  <span>Result</span>
                  <strong>尚未执行</strong>
                  <small>无效果结论</small>
                </article>
              </div>

              <div className="experiment-section-grid">
                <article className="experiment-card">
                  <p className="section-kicker">Falsifiable hypothesis</p>
                  <h4>{detail.design.hypothesis.intervention}</h4>
                  <dl>
                    <div>
                      <dt>Comparator</dt>
                      <dd>{detail.design.hypothesis.comparator}</dd>
                    </div>
                    <div>
                      <dt>Expected direction</dt>
                      <dd>
                        {detail.design.hypothesis.expectedDirection} ·{' '}
                        {detail.design.hypothesis.primaryOutcomeMetricId}
                      </dd>
                    </div>
                    <div>
                      <dt>Falsification</dt>
                      <dd>{detail.design.hypothesis.falsificationCondition}</dd>
                    </div>
                  </dl>
                </article>
                <article className="experiment-card">
                  <p className="section-kicker">Control / Treatment</p>
                  <div className="experiment-arm-list">
                    {detail.design.primaryVariable.arms.map((arm) => (
                      <div data-role={arm.role} key={arm.armId}>
                        <span>{arm.role}</span>
                        <strong>{arm.valueIdentity}</strong>
                        <small>{arm.changedDimensions.join('')}</small>
                      </div>
                    ))}
                  </div>
                  <p className="experiment-caption">
                    Controlled-condition diff：PASS · 每个 arm 仅改变{' '}
                    {detail.design.primaryVariable.kind}。
                  </p>
                </article>
                <article className="experiment-card">
                  <p className="section-kicker">Controlled conditions</p>
                  <ul className="experiment-condition-list">
                    {detail.design.controlledConditions.map((condition) => (
                      <li key={condition.kind}>
                        <span>{condition.kind}</span>
                        <strong>{condition.valueIdentity}</strong>
                        <small>{condition.availability}</small>
                      </li>
                    ))}
                  </ul>
                </article>
                <article className="experiment-card">
                  <p className="section-kicker">Guardrails</p>
                  {detail.design.guardrails.length === 0 ? (
                    <p>未配置 guardrail。</p>
                  ) : (
                    <ul className="experiment-condition-list">
                      {detail.design.guardrails.map((guardrail) => (
                        <li key={guardrail.metric.metricId}>
                          <span>{METRIC_LABELS.get(guardrail.metric.metricId)}</span>
                          <strong>{guardrail.direction}</strong>
                          <small>{guardrail.violationCondition}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </div>

              <article className="experiment-card">
                <p className="section-kicker">Popularity strata snapshots</p>
                <div className="experiment-strata-table">
                  {detail.design.popularitySnapshots.map((snapshot) => (
                    <div key={`${snapshot.snapshotId}-${snapshot.workId}`}>
                      <span>{snapshot.workId}</span>
                      <strong data-stratum={snapshot.stratum}>{snapshot.stratum}</strong>
                      <small>
                        {snapshot.sourceKind} · {snapshot.metricReference ?? '无可用依据'}
                      </small>
                    </div>
                  ))}
                </div>
                <p className="experiment-caption">
                  热度仅作分层，不替代事实门禁、Topic eligibility 或 ranking；UNKNOWN 不等于冷门。
                </p>
              </article>

              {detail.assignment === null ? (
                <article className="experiment-assignment-empty">
                  <strong>还没有保存 assignment plan</strong>
                  <span>
                    预览会验证 Topic current / eligible / held / archived、同结构复现与 Work 分层。
                  </span>
                </article>
              ) : (
                <article
                  className={`experiment-assignment experiment-assignment--${assignmentTone(
                    detail.assignment.status,
                  )}`}
                >
                  <header>
                    <div>
                      <p className="section-kicker">Assignment plan</p>
                      <h4>{detail.assignment.status}</h4>
                    </div>
                    <span>{detail.assignment.unitCount} Topics</span>
                  </header>
                  <div className="experiment-balance-grid">
                    {Object.entries(detail.assignment.armCounts).map(([arm, count]) => (
                      <div key={arm}>
                        <span>{arm}</span>
                        <strong>{count}</strong>
                        <small>shortfall {detail.assignment?.shortfallByArm[arm] ?? 0}</small>
                      </div>
                    ))}
                    {Object.entries(detail.assignment.strataCounts).map(([stratum, count]) => (
                      <div key={stratum}>
                        <span>{stratum}</span>
                        <strong>{count}</strong>
                        <small>独立保留的分层</small>
                      </div>
                    ))}
                  </div>
                </article>
              )}

              <div className="experiment-detail__actions">
                {availableActions(detail).map((action) => (
                  <button
                    className={action === 'LOCK' ? 'primary-button' : 'secondary-button'}
                    key={action}
                    onClick={() =>
                      void requestPreview({
                        action,
                        expectedRevision: detail.revision,
                        experimentId: detail.experimentId,
                        kind: 'STATE_ACTION',
                      })
                    }
                    type="button"
                  >
                    {action}
                  </button>
                ))}
              </div>

              <article className="experiment-card">
                <p className="section-kicker">Immutable design versions & diff</p>
                <ol className="experiment-history">
                  {detail.versionHistory.items.map((version) => (
                    <li key={version.designVersionId}>
                      <strong>
                        v{version.versionNumber} · {version.isCurrent ? 'CURRENT' : 'HISTORICAL'}
                      </strong>
                      <span>{version.changeKinds.join(' · ')}</span>
                      <small>
                        {version.primaryVariableKind} / {version.primaryMetricId} ·{' '}
                        {version.createdAt}
                      </small>
                    </li>
                  ))}
                </ol>
                <div className="experiment-pagination">
                  <button
                    disabled={versionOffset === 0}
                    onClick={() =>
                      void openExperiment(
                        detail.experimentId,
                        Math.max(0, versionOffset - PAGE_SIZE),
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
                      versionOffset + detail.versionHistory.items.length >=
                      detail.versionHistory.total
                    }
                    onClick={() =>
                      void openExperiment(
                        detail.experimentId,
                        versionOffset + PAGE_SIZE,
                        historyOffset,
                      )
                    }
                    type="button"
                  >
                    下一页版本
                  </button>
                </div>
              </article>

              <article className="experiment-card">
                <p className="section-kicker">State transition history</p>
                <ol className="experiment-history">
                  {detail.history.map((event) => (
                    <li key={`${event.revision}-${event.action}`}>
                      <strong>
                        r{event.revision} · {event.action}
                      </strong>
                      <span>
                        {event.from === null ? '∅' : STATE_LABELS.get(event.from)} →{' '}
                        {STATE_LABELS.get(event.to)}
                      </span>
                      <small>{event.createdAt}</small>
                    </li>
                  ))}
                </ol>
                <div className="experiment-pagination">
                  <button
                    disabled={historyOffset === 0}
                    onClick={() =>
                      void openExperiment(
                        detail.experimentId,
                        versionOffset,
                        Math.max(0, historyOffset - PAGE_SIZE),
                      )
                    }
                    type="button"
                  >
                    上一页状态
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
                    disabled={historyOffset + detail.history.length >= detail.historyPage.total}
                    onClick={() =>
                      void openExperiment(
                        detail.experimentId,
                        versionOffset,
                        historyOffset + PAGE_SIZE,
                      )
                    }
                    type="button"
                  >
                    下一页状态
                  </button>
                </div>
              </article>
            </section>
          )}
        </main>
      </section>
    </div>
  );
}
