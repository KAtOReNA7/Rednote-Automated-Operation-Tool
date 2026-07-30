import {
  EXPERIMENT_POPULARITY_POLICY_VERSION,
  createReplicationFingerprint,
  type ExperimentDesignDraft,
  type ExperimentMetricSpec,
  type ExperimentTopicInput,
  type WorkPopularitySnapshotInput,
  type WorkPopularityStratum,
} from '@mystery-operations/experiments';

function metric(
  metricId: ExperimentMetricSpec['metricId'],
  direction: ExperimentMetricSpec['direction'],
): ExperimentMetricSpec {
  return {
    availability: 'DEFINED_NOT_AVAILABLE',
    denominator: metricId.endsWith('_RATE') ? '未来可观测曝光数' : null,
    direction,
    metricId,
    missingValuePolicy: 'KEEP_AS_MISSING',
    numerator: `未来可观测 ${metricId}`,
    observationWindow: '未来发布后七日窗口',
    unit: metricId.endsWith('_RATE') ? 'RATE' : 'WORK_UNIT',
    zeroDenominatorPolicy: 'RETURN_UNAVAILABLE',
  };
}

export function popularitySnapshot(
  workId: string,
  stratum: WorkPopularityStratum,
  ordinal: number,
): WorkPopularitySnapshotInput {
  if (stratum === 'UNKNOWN') {
    return {
      availability: 'UNAVAILABLE',
      confidence: 'UNAVAILABLE',
      metricReference: null,
      observedAt: null,
      policyVersion: EXPERIMENT_POPULARITY_POLICY_VERSION,
      provenance: [],
      snapshotId: `popularity-${ordinal}`,
      sourceKind: 'NOT_AVAILABLE',
      stratum,
      windowEnd: null,
      windowStart: null,
      workId,
    };
  }
  return {
    availability: 'AVAILABLE',
    confidence: 'CONFIRMED',
    metricReference: `synthetic-popularity-${stratum.toLowerCase()}`,
    observedAt: '2026-07-30T08:00:00.000Z',
    policyVersion: EXPERIMENT_POPULARITY_POLICY_VERSION,
    provenance: ['SYNTHETIC_FIXTURE', `bucket:${stratum}`],
    snapshotId: `popularity-${ordinal}`,
    sourceKind: 'USER_CONFIRMED_SYNTHETIC',
    stratum,
    windowEnd: '2026-07-30T08:00:00.000Z',
    windowStart: '2026-07-23T08:00:00.000Z',
    workId,
  };
}

export function experimentDraft(topicCount = 8): ExperimentDesignDraft {
  const strata: readonly WorkPopularityStratum[] = [
    'HOT',
    'HOT',
    'WARM',
    'WARM',
    'COLD',
    'COLD',
    'UNKNOWN',
    'UNKNOWN',
  ];
  return {
    controlledConditions: [
      {
        availability: 'FIXED',
        kind: 'TOPIC_CONTENT_TYPE',
        valueIdentity: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
      },
      {
        availability: 'FIXED',
        kind: 'ANALYSIS_MODE',
        valueIdentity: 'PUBLIC_RESEARCH',
      },
      {
        availability: 'FIXED',
        kind: 'SPOILER_MODE',
        valueIdentity: 'NO_SPOILER',
      },
      {
        availability: 'FUTURE_NOT_IMPLEMENTED',
        kind: 'TITLE_PATTERN',
        valueIdentity: 'FUTURE_FIXED_NOT_GENERATED',
      },
      {
        availability: 'FUTURE_NOT_IMPLEMENTED',
        kind: 'COVER_INFORMATION_DENSITY',
        valueIdentity: 'FUTURE_FIXED_NOT_GENERATED',
      },
    ],
    guardrails: [
      {
        direction: 'NOT_DECREASE',
        metric: metric('COMMENT_RATE', 'LIMIT'),
        violationCondition: '未来 COMMENT_RATE 低于预先登记阈值',
      },
      {
        direction: 'NOT_INCREASE',
        metric: metric('FACT_BLOCK_RATE', 'LIMIT'),
        violationCondition: '未来 FACT_BLOCK_RATE 高于预先登记阈值',
      },
    ],
    hypothesis: {
      assumptions: ['未来样本使用相同结构槽位', '未来观测窗口保持一致'],
      comparator: '使用问题—分析—判断结构',
      expectedDirection: 'INCREASE',
      falsificationCondition: '未来 SAVE_RATE 未高于 control,或任一 guardrail 违反预登记条件',
      intervention: '使用主张—证据—反方结构',
      primaryOutcomeMetricId: 'SAVE_RATE',
      rationale: '比较同一资料分析结构在不同作品上的未来可观测保存行为',
      scope: '首批候选中的不剧透单书资料分析',
      targetAudienceContext: '希望快速判断推理作品阅读价值的读者',
    },
    name: '合成单变量内容结构实验',
    popularitySnapshots: Array.from({ length: topicCount }, (_, index) =>
      popularitySnapshot(
        `experiment-work-${index + 1}`,
        strata[index % strata.length] ?? 'UNKNOWN',
        index + 1,
      ),
    ),
    primaryMetric: metric('SAVE_RATE', 'INCREASE'),
    primaryVariable: {
      arms: [
        {
          armId: 'control',
          changedDimensions: ['CONTENT_STRUCTURE'],
          label: 'Control · 问题—分析—判断',
          role: 'CONTROL',
          valueIdentity: 'QUESTION_ANALYSIS_VERDICT',
        },
        {
          armId: 'treatment',
          changedDimensions: ['CONTENT_STRUCTURE'],
          label: 'Treatment · 主张—证据—反方',
          role: 'TREATMENT',
          valueIdentity: 'CLAIM_EVIDENCE_COUNTERPOINT',
        },
      ],
      kind: 'CONTENT_STRUCTURE',
    },
    replicationStructure: {
      analysisMode: 'PUBLIC_RESEARCH',
      comparisonDimension: null,
      contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
      requiredLabels: ['公开资料整理'],
      spoilerLevel: 'NO_SPOILER',
      structureIdentity: 'single-book-research-verdict',
      structureVersion: 'replication-structure-v1',
      structuralSlots: ['QUESTION', 'EVIDENCE', 'COUNTERPOINT', 'JUDGMENT'],
    },
    samplePlan: {
      armTargetCounts: {
        control: Math.ceil(topicCount / 2),
        treatment: Math.floor(topicCount / 2),
      },
      assignmentUnit: 'TOPIC_CANDIDATE',
      blockingKeys: ['POPULARITY_STRATUM'],
      deterministicSeed: 'synthetic-experiment-seed-v1',
      exclusionRules: ['HELD_OR_ARCHIVED', 'NOT_CURRENT', 'NOT_ELIGIBLE'],
      inclusionRules: ['EXPLICIT_TOPIC_SELECTION', 'STRUCTURE_MATCH'],
      maxTopicsPerWork: 1,
      minimumDistinctWorkCount: 3,
      quotaPlanVersionId: null,
      targetTopicIds: Array.from(
        { length: topicCount },
        (_, index) => `experiment-topic-${index + 1}`,
      ),
    },
  };
}

export function experimentTopics(draft = experimentDraft()): readonly ExperimentTopicInput[] {
  const fingerprint = createReplicationFingerprint(draft.replicationStructure);
  const snapshotByWork = new Map(
    draft.popularitySnapshots.map((snapshot) => [snapshot.workId, snapshot]),
  );
  return draft.samplePlan.targetTopicIds.map((topicId, index) => {
    const workId = `experiment-work-${index + 1}`;
    const snapshot = snapshotByWork.get(workId);
    if (snapshot === undefined) throw new Error('Synthetic popularity snapshot missing.');
    return {
      analysisMode: draft.replicationStructure.analysisMode,
      blockingValues: { POPULARITY_STRATUM: snapshot.stratum },
      contentType: draft.replicationStructure.contentType,
      current: true,
      dossierVersionId: `dossier-version-${index + 1}`,
      eligibility: 'ELIGIBLE',
      permissionSnapshotId: `permission-snapshot-${index + 1}`,
      popularitySnapshot: snapshot,
      quotaPlanMember: false,
      spoilerLevel: draft.replicationStructure.spoilerLevel,
      state: 'PROPOSED',
      structureFingerprint: fingerprint,
      topicId,
      topicVersionId: `${topicId}:v1`,
      workId,
    };
  });
}
