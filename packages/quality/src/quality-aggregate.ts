export const QUALITY_READINESS_SCHEMA_VERSION = 'quality-readiness-v1' as const;

export const QUALITY_READINESS_CHECK_TYPES = [
  'STRUCTURED_OUTPUT',
  'FACT_MAPPING',
  'READING_AUTHENTICITY',
  'SPOILER',
  'DUPLICATION',
  'TITLE_BODY_CONSISTENCY',
  'INTERNAL_CONSISTENCY',
] as const;

export type QualityReadinessCheckType = (typeof QUALITY_READINESS_CHECK_TYPES)[number];
export type QualityReadinessSourceStatus =
  'PASS' | 'BLOCKED' | 'REVIEW_REQUIRED' | 'STALE' | 'NOT_RUN';
export type QualityReadinessCapability = 'AVAILABLE' | 'DEFERRED_029B' | 'UNAVAILABLE';
export type QualityReadinessStatus =
  | 'STALE_OR_INCOMPLETE'
  | 'BLOCKED_BY_QUALITY'
  | 'REQUIRES_DETAILED_REVIEW'
  | 'READY_FOR_FAST_APPROVAL';
export type QualityReadinessReason =
  | 'SAVED_EXACT_CURRENT'
  | 'SAVED_RESULT_STALE'
  | 'SAVED_RESULT_MISSING'
  | 'CURRENT_STRUCTURE_VALID'
  | 'CURRENT_STRUCTURE_INVALID'
  | 'CURRENT_DRAFT_INVALIDATED'
  | 'CURRENT_DRAFT_NOT_READY'
  | 'SOURCE_UNAVAILABLE'
  | 'DEFERRED_029B';

export interface QualityReadinessSourceInput {
  readonly capability: QualityReadinessCapability;
  readonly checkType: QualityReadinessCheckType;
  readonly reason: QualityReadinessReason;
  readonly status: QualityReadinessSourceStatus;
}

export interface QualityReadinessSourceRow extends QualityReadinessSourceInput {
  readonly nextAction: string;
  readonly summary: string;
}

export interface QualityReadinessResult {
  readonly advisoryCandidate: 'FAST_CANDIDATE' | 'FOCUSED_CANDIDATE' | null;
  readonly canCreateApproval: false;
  readonly canExport: false;
  readonly canPublish: false;
  readonly counts: {
    readonly blocker: number;
    readonly missing: number;
    readonly review: number;
    readonly stale: number;
  };
  readonly draft: {
    readonly draftId: string;
    readonly revision: number;
    readonly status: string;
    readonly versionId: string;
  };
  readonly schemaVersion: typeof QUALITY_READINESS_SCHEMA_VERSION;
  readonly sources: readonly QualityReadinessSourceRow[];
  readonly status: QualityReadinessStatus;
}

export interface EvaluateQualityReadinessInput {
  readonly draft: QualityReadinessResult['draft'];
  readonly fullSpoilerReviewRequired: boolean;
  readonly sources: readonly QualityReadinessSourceInput[];
}

const LABELS: Readonly<Record<QualityReadinessCheckType, string>> = Object.freeze({
  DUPLICATION: '重复与同质化确定性子集',
  FACT_MAPPING: '事实映射',
  INTERNAL_CONSISTENCY: '内部一致性',
  READING_AUTHENTICITY: '阅读真实性与评分来源',
  SPOILER: '剧透声明与警告',
  STRUCTURED_OUTPUT: '结构化输出',
  TITLE_BODY_CONSISTENCY: '标题与正文一致性确定性子集',
});

function isSourceStatus(value: unknown): value is QualityReadinessSourceStatus {
  return ['PASS', 'BLOCKED', 'REVIEW_REQUIRED', 'STALE', 'NOT_RUN'].includes(String(value));
}

function row(input: QualityReadinessSourceInput): QualityReadinessSourceRow {
  if (!isSourceStatus(input.status)) throw new TypeError('QUALITY_READINESS_INVALID_STATUS');
  const label = LABELS[input.checkType];
  if (label === undefined) throw new TypeError('QUALITY_READINESS_INVALID_CHECK_TYPE');
  if (input.capability === 'DEFERRED_029B') {
    if (input.checkType !== 'INTERNAL_CONSISTENCY' || input.status !== 'NOT_RUN') {
      throw new TypeError('QUALITY_READINESS_INVALID_CAPABILITY');
    }
    return Object.freeze({
      ...input,
      nextAction: '按重点流程人工复核内部矛盾；029B 未实施。',
      summary: `${label}语义阶段尚未实施，不能记为通过。`,
    });
  }
  if (input.capability === 'UNAVAILABLE') {
    return Object.freeze({
      ...input,
      nextAction: '刷新质量总览；持续失败时保留为不完整并检查本地数据。',
      summary: `${label}读取不可用，当前不能判定。`,
    });
  }
  const copy: Readonly<Record<QualityReadinessSourceStatus, readonly [string, string]>> = {
    BLOCKED: [`${label}存在已保存的当前阻断。`, '修订内容或映射，再重新运行并保存该检查。'],
    NOT_RUN: [`${label}尚无已保存的当前结果。`, '在现有检查区域运行并确认保存。'],
    PASS: [`${label}已有已保存的当前通过结果。`, '无需操作；修改 Draft 后必须重新检查。'],
    REVIEW_REQUIRED: [`${label}需要人工复核。`, '在现有检查区域查看有限规则原因并人工确认。'],
    STALE: [`${label}的已保存结果已陈旧。`, '针对当前 DraftVersion 重新运行并保存。'],
  };
  return Object.freeze({
    ...input,
    nextAction: copy[input.status][1],
    summary: copy[input.status][0],
  });
}

export function evaluateQualityReadiness(
  input: EvaluateQualityReadinessInput,
): QualityReadinessResult {
  if (
    input.sources.length !== QUALITY_READINESS_CHECK_TYPES.length ||
    QUALITY_READINESS_CHECK_TYPES.some(
      (checkType, index) => input.sources[index]?.checkType !== checkType,
    )
  ) {
    throw new TypeError('QUALITY_READINESS_INVALID_SOURCE_SET');
  }
  const sources = Object.freeze(input.sources.map(row));
  const deferredInternal = sources.some(
    ({ capability, checkType }) =>
      checkType === 'INTERNAL_CONSISTENCY' && capability === 'DEFERRED_029B',
  );
  const incomplete = sources.some(
    ({ capability, status }) =>
      capability === 'UNAVAILABLE' ||
      status === 'STALE' ||
      (status === 'NOT_RUN' && capability !== 'DEFERRED_029B'),
  );
  const blocked = sources.some(({ status }) => status === 'BLOCKED');
  const detailedReview =
    deferredInternal ||
    input.fullSpoilerReviewRequired ||
    sources.some(({ status }) => status === 'REVIEW_REQUIRED');
  const status: QualityReadinessStatus = incomplete
    ? 'STALE_OR_INCOMPLETE'
    : blocked
      ? 'BLOCKED_BY_QUALITY'
      : detailedReview
        ? 'REQUIRES_DETAILED_REVIEW'
        : 'READY_FOR_FAST_APPROVAL';
  return Object.freeze({
    advisoryCandidate:
      status === 'READY_FOR_FAST_APPROVAL'
        ? 'FAST_CANDIDATE'
        : status === 'REQUIRES_DETAILED_REVIEW'
          ? 'FOCUSED_CANDIDATE'
          : null,
    canCreateApproval: false,
    canExport: false,
    canPublish: false,
    counts: Object.freeze({
      blocker: sources.filter(({ status: value }) => value === 'BLOCKED').length,
      missing: sources.filter(
        ({ capability, status: value }) => value === 'NOT_RUN' && capability !== 'DEFERRED_029B',
      ).length,
      review:
        sources.filter(({ status: value }) => value === 'REVIEW_REQUIRED').length +
        Number(deferredInternal) +
        Number(input.fullSpoilerReviewRequired),
      stale: sources.filter(({ status: value }) => value === 'STALE').length,
    }),
    draft: Object.freeze({ ...input.draft }),
    schemaVersion: QUALITY_READINESS_SCHEMA_VERSION,
    sources,
    status,
  });
}
