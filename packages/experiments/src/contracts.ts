import type {
  TopicAnalysisMode,
  TopicCandidateState,
  TopicContentType,
  TopicEligibilityState,
  TopicSpoilerLevel,
} from '@mystery-operations/topics';

import {
  EXPERIMENT_ACTIONS,
  EXPERIMENT_ARM_ROLES,
  EXPERIMENT_CONFIRMATION_LITERAL,
  EXPERIMENT_CONTROLLED_CONDITION_KINDS,
  EXPERIMENT_DESIGN_STATES,
  EXPERIMENT_EXPECTED_DIRECTIONS,
  EXPERIMENT_LIMITS,
  EXPERIMENT_METRIC_AVAILABILITY,
  EXPERIMENT_METRIC_DIRECTIONS,
  EXPERIMENT_METRIC_IDS,
  EXPERIMENT_MISSING_VALUE_POLICIES,
  EXPERIMENT_POPULARITY_AVAILABILITY,
  EXPERIMENT_POPULARITY_SOURCE_KINDS,
  EXPERIMENT_POPULARITY_STRATA,
  EXPERIMENT_SAMPLE_PLAN_STATUSES,
  EXPERIMENT_VARIABLE_KINDS,
  EXPERIMENT_ZERO_DENOMINATOR_POLICIES,
  type ExperimentAction,
  type ExperimentArmRole,
  type ExperimentControlledConditionKind,
  type ExperimentDesignState,
  type ExperimentExpectedDirection,
  type ExperimentMetricAvailability,
  type ExperimentMetricDirection,
  type ExperimentMetricId,
  type ExperimentMissingValuePolicy,
  type ExperimentSamplePlanStatus,
  type ExperimentVariableKind,
  type ExperimentZeroDenominatorPolicy,
  type WorkPopularityAvailability,
  type WorkPopularitySourceKind,
  type WorkPopularityStratum,
} from './constants.js';
import { ExperimentError } from './errors.js';

export interface ExperimentHypothesisV1 {
  readonly assumptions: readonly string[];
  readonly comparator: string;
  readonly expectedDirection: ExperimentExpectedDirection;
  readonly falsificationCondition: string;
  readonly intervention: string;
  readonly primaryOutcomeMetricId: ExperimentMetricId;
  readonly rationale: string;
  readonly scope: string;
  readonly targetAudienceContext: string;
}

export interface ExperimentArmDraft {
  readonly armId: string;
  readonly changedDimensions: readonly ExperimentVariableKind[];
  readonly label: string;
  readonly role: ExperimentArmRole;
  readonly valueIdentity: string;
}

export interface ExperimentPrimaryVariable {
  readonly arms: readonly ExperimentArmDraft[];
  readonly kind: ExperimentVariableKind;
}

export interface ExperimentControlledCondition {
  readonly availability: 'FIXED' | 'FUTURE_NOT_IMPLEMENTED';
  readonly kind: ExperimentControlledConditionKind;
  readonly valueIdentity: string;
}

export interface ExperimentMetricSpec {
  readonly availability: ExperimentMetricAvailability;
  readonly denominator: string | null;
  readonly direction: ExperimentMetricDirection;
  readonly metricId: ExperimentMetricId;
  readonly missingValuePolicy: ExperimentMissingValuePolicy;
  readonly numerator: string;
  readonly observationWindow: string;
  readonly unit: 'COUNT' | 'RATE' | 'WORK_UNIT';
  readonly zeroDenominatorPolicy: ExperimentZeroDenominatorPolicy;
}

export interface ExperimentGuardrailSpec {
  readonly direction: 'NOT_INCREASE' | 'NOT_DECREASE' | 'LIMIT';
  readonly metric: ExperimentMetricSpec;
  readonly violationCondition: string;
}

export interface ReplicationStructureV1 {
  readonly analysisMode: TopicAnalysisMode;
  readonly comparisonDimension: string | null;
  readonly contentType: TopicContentType;
  readonly requiredLabels: readonly string[];
  readonly spoilerLevel: TopicSpoilerLevel;
  readonly structureIdentity: string;
  readonly structureVersion: string;
  readonly structuralSlots: readonly string[];
}

export interface WorkPopularitySnapshotInput {
  readonly availability: WorkPopularityAvailability;
  readonly confidence: 'CONFIRMED' | 'UNAVAILABLE';
  readonly metricReference: string | null;
  readonly observedAt: string | null;
  readonly policyVersion: string;
  readonly provenance: readonly string[];
  readonly snapshotId: string;
  readonly sourceKind: WorkPopularitySourceKind;
  readonly stratum: WorkPopularityStratum;
  readonly windowEnd: string | null;
  readonly windowStart: string | null;
  readonly workId: string;
}

export interface ExperimentSamplePlanV1 {
  readonly armTargetCounts: Readonly<Record<string, number>>;
  readonly assignmentUnit: 'TOPIC_CANDIDATE';
  readonly blockingKeys: readonly string[];
  readonly deterministicSeed: string;
  readonly exclusionRules: readonly string[];
  readonly inclusionRules: readonly string[];
  readonly maxTopicsPerWork: number;
  readonly minimumDistinctWorkCount: number;
  readonly quotaPlanVersionId: string | null;
  readonly targetTopicIds: readonly string[];
}

export interface ExperimentDesignDraft {
  readonly controlledConditions: readonly ExperimentControlledCondition[];
  readonly guardrails: readonly ExperimentGuardrailSpec[];
  readonly hypothesis: ExperimentHypothesisV1;
  readonly name: string;
  readonly popularitySnapshots: readonly WorkPopularitySnapshotInput[];
  readonly primaryMetric: ExperimentMetricSpec;
  readonly primaryVariable: ExperimentPrimaryVariable;
  readonly replicationStructure: ReplicationStructureV1;
  readonly samplePlan: ExperimentSamplePlanV1;
}

export interface ExperimentTopicInput {
  readonly analysisMode: TopicAnalysisMode;
  readonly blockingValues: Readonly<Record<string, string>>;
  readonly contentType: TopicContentType;
  readonly current: boolean;
  readonly dossierVersionId: string;
  readonly eligibility: TopicEligibilityState;
  readonly permissionSnapshotId: string;
  readonly popularitySnapshot: WorkPopularitySnapshotInput;
  readonly quotaPlanMember: boolean;
  readonly spoilerLevel: TopicSpoilerLevel;
  readonly state: TopicCandidateState;
  readonly structureFingerprint: string;
  readonly topicId: string;
  readonly topicVersionId: string;
  readonly workId: string;
}

export interface ExperimentAssignmentUnit {
  readonly armId: string;
  readonly assignmentOrder: number;
  readonly blockingKey: string;
  readonly popularitySnapshotId: string;
  readonly popularityStratum: WorkPopularityStratum;
  readonly reasonCodes: readonly string[];
  readonly structureFingerprint: string;
  readonly topicId: string;
  readonly topicVersionId: string;
  readonly workId: string;
}

export interface ExperimentAssignmentResult {
  readonly armCounts: Readonly<Record<string, number>>;
  readonly assignmentHash: string;
  readonly distinctWorkCount: number;
  readonly imbalanceByStratum: Readonly<Record<string, number>>;
  readonly inputHash: string;
  readonly reasonCodes: readonly string[];
  readonly shortfallByArm: Readonly<Record<string, number>>;
  readonly status: ExperimentSamplePlanStatus;
  readonly units: readonly ExperimentAssignmentUnit[];
}

export interface ExperimentStateActionDraft {
  readonly action: ExperimentAction;
  readonly expectedRevision: number;
  readonly experimentId: string;
}

export interface ExperimentActionConfirmation {
  readonly confirmation: typeof EXPERIMENT_CONFIRMATION_LITERAL;
  readonly kind: 'CREATE' | 'STATE_ACTION';
  readonly previewHash: string;
  readonly token: string;
}

export interface ExperimentValidationSummary {
  readonly designHash: string;
  readonly futureBoundVariable: boolean;
  readonly reasonCodes: readonly string[];
  readonly replicationFingerprint: string;
  readonly valid: boolean;
}

export interface ExperimentStateTransitionResult {
  readonly from: ExperimentDesignState;
  readonly to: ExperimentDesignState;
}

function invalid(): never {
  throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid();
  }
}

function text(value: unknown, maximum: number = EXPERIMENT_LIMITS.textBytes): string {
  if (typeof value !== 'string') invalid();
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (bytes < 1 || bytes > maximum) invalid();
  return normalized;
}

function identifier(value: unknown): string {
  return text(value, EXPERIMENT_LIMITS.identifierBytes);
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid();
  return value as T;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid();
  }
  return value as number;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function isoOrNull(value: unknown): string | null {
  if (value === null) return null;
  const parsed = text(value, 64);
  if (new Date(parsed).toISOString() !== parsed) invalid();
  return parsed;
}

function stringArray(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return Object.freeze(value.map((item) => text(item)));
}

export function assertExperimentHypothesis(value: unknown): ExperimentHypothesisV1 {
  exactObject(value, [
    'assumptions',
    'comparator',
    'expectedDirection',
    'falsificationCondition',
    'intervention',
    'primaryOutcomeMetricId',
    'rationale',
    'scope',
    'targetAudienceContext',
  ]);
  return Object.freeze({
    assumptions: stringArray(value.assumptions, EXPERIMENT_LIMITS.assumptions),
    comparator: text(value.comparator),
    expectedDirection: enumValue(value.expectedDirection, EXPERIMENT_EXPECTED_DIRECTIONS),
    falsificationCondition: text(value.falsificationCondition),
    intervention: text(value.intervention),
    primaryOutcomeMetricId: enumValue(value.primaryOutcomeMetricId, EXPERIMENT_METRIC_IDS),
    rationale: text(value.rationale),
    scope: text(value.scope),
    targetAudienceContext: text(value.targetAudienceContext),
  });
}

export function assertExperimentMetricSpec(value: unknown): ExperimentMetricSpec {
  exactObject(value, [
    'availability',
    'denominator',
    'direction',
    'metricId',
    'missingValuePolicy',
    'numerator',
    'observationWindow',
    'unit',
    'zeroDenominatorPolicy',
  ]);
  return Object.freeze({
    availability: enumValue(value.availability, EXPERIMENT_METRIC_AVAILABILITY),
    denominator: nullableText(value.denominator),
    direction: enumValue(value.direction, EXPERIMENT_METRIC_DIRECTIONS),
    metricId: enumValue(value.metricId, EXPERIMENT_METRIC_IDS),
    missingValuePolicy: enumValue(value.missingValuePolicy, EXPERIMENT_MISSING_VALUE_POLICIES),
    numerator: text(value.numerator),
    observationWindow: text(value.observationWindow),
    unit: enumValue(value.unit, ['COUNT', 'RATE', 'WORK_UNIT'] as const),
    zeroDenominatorPolicy: enumValue(
      value.zeroDenominatorPolicy,
      EXPERIMENT_ZERO_DENOMINATOR_POLICIES,
    ),
  });
}

export function assertPopularitySnapshot(value: unknown): WorkPopularitySnapshotInput {
  exactObject(value, [
    'availability',
    'confidence',
    'metricReference',
    'observedAt',
    'policyVersion',
    'provenance',
    'snapshotId',
    'sourceKind',
    'stratum',
    'windowEnd',
    'windowStart',
    'workId',
  ]);
  return Object.freeze({
    availability: enumValue(value.availability, EXPERIMENT_POPULARITY_AVAILABILITY),
    confidence: enumValue(value.confidence, ['CONFIRMED', 'UNAVAILABLE'] as const),
    metricReference: nullableText(value.metricReference),
    observedAt: isoOrNull(value.observedAt),
    policyVersion: identifier(value.policyVersion),
    provenance: stringArray(value.provenance, 16),
    snapshotId: identifier(value.snapshotId),
    sourceKind: enumValue(value.sourceKind, EXPERIMENT_POPULARITY_SOURCE_KINDS),
    stratum: enumValue(value.stratum, EXPERIMENT_POPULARITY_STRATA),
    windowEnd: isoOrNull(value.windowEnd),
    windowStart: isoOrNull(value.windowStart),
    workId: identifier(value.workId),
  });
}

export function assertExperimentDesignDraft(value: unknown): ExperimentDesignDraft {
  exactObject(value, [
    'controlledConditions',
    'guardrails',
    'hypothesis',
    'name',
    'popularitySnapshots',
    'primaryMetric',
    'primaryVariable',
    'replicationStructure',
    'samplePlan',
  ]);
  exactObject(value.primaryVariable, ['arms', 'kind']);
  const variableKind = enumValue(value.primaryVariable.kind, EXPERIMENT_VARIABLE_KINDS);
  if (
    !Array.isArray(value.primaryVariable.arms) ||
    value.primaryVariable.arms.length < 2 ||
    value.primaryVariable.arms.length > EXPERIMENT_LIMITS.arms
  ) {
    invalid();
  }
  const arms = value.primaryVariable.arms.map((arm): ExperimentArmDraft => {
    exactObject(arm, ['armId', 'changedDimensions', 'label', 'role', 'valueIdentity']);
    if (!Array.isArray(arm.changedDimensions) || arm.changedDimensions.length > 2) invalid();
    return Object.freeze({
      armId: identifier(arm.armId),
      changedDimensions: Object.freeze(
        arm.changedDimensions.map((item) => enumValue(item, EXPERIMENT_VARIABLE_KINDS)),
      ),
      label: text(arm.label, 512),
      role: enumValue(arm.role, EXPERIMENT_ARM_ROLES),
      valueIdentity: identifier(arm.valueIdentity),
    });
  });
  if (
    !Array.isArray(value.controlledConditions) ||
    value.controlledConditions.length > EXPERIMENT_LIMITS.controlledConditions
  ) {
    invalid();
  }
  const controlledConditions = value.controlledConditions.map(
    (condition): ExperimentControlledCondition => {
      exactObject(condition, ['availability', 'kind', 'valueIdentity']);
      return Object.freeze({
        availability: enumValue(condition.availability, [
          'FIXED',
          'FUTURE_NOT_IMPLEMENTED',
        ] as const),
        kind: enumValue(condition.kind, EXPERIMENT_CONTROLLED_CONDITION_KINDS),
        valueIdentity: identifier(condition.valueIdentity),
      });
    },
  );
  if (!Array.isArray(value.guardrails) || value.guardrails.length > EXPERIMENT_LIMITS.guardrails) {
    invalid();
  }
  const guardrails = value.guardrails.map((guardrail): ExperimentGuardrailSpec => {
    exactObject(guardrail, ['direction', 'metric', 'violationCondition']);
    return Object.freeze({
      direction: enumValue(guardrail.direction, ['NOT_INCREASE', 'NOT_DECREASE', 'LIMIT'] as const),
      metric: assertExperimentMetricSpec(guardrail.metric),
      violationCondition: text(guardrail.violationCondition),
    });
  });
  exactObject(value.replicationStructure, [
    'analysisMode',
    'comparisonDimension',
    'contentType',
    'requiredLabels',
    'spoilerLevel',
    'structureIdentity',
    'structureVersion',
    'structuralSlots',
  ]);
  const replicationStructure = Object.freeze({
    analysisMode: enumValue(value.replicationStructure.analysisMode, [
      'PERSONAL',
      'PUBLIC_RESEARCH',
    ] as const),
    comparisonDimension: nullableText(value.replicationStructure.comparisonDimension),
    contentType: enumValue(value.replicationStructure.contentType, [
      'NON_SPOILER_SINGLE_BOOK_VERDICT',
      'FULL_TRICK_LOGIC_ANALYSIS',
      'CROSS_WORK_COMPARISON',
      'WEB_VS_PUBLISHED_MYSTERY',
      'MYSTERY_AND_CULTURAL_PHENOMENON',
    ] as const),
    requiredLabels: stringArray(value.replicationStructure.requiredLabels, 16),
    spoilerLevel: enumValue(value.replicationStructure.spoilerLevel, [
      'NO_SPOILER',
      'LIGHT_SPOILER',
      'FULL_TRICK_ANALYSIS',
    ] as const),
    structureIdentity: identifier(value.replicationStructure.structureIdentity),
    structureVersion: identifier(value.replicationStructure.structureVersion),
    structuralSlots: stringArray(
      value.replicationStructure.structuralSlots,
      EXPERIMENT_LIMITS.structureSlots,
    ),
  });
  exactObject(value.samplePlan, [
    'armTargetCounts',
    'assignmentUnit',
    'blockingKeys',
    'deterministicSeed',
    'exclusionRules',
    'inclusionRules',
    'maxTopicsPerWork',
    'minimumDistinctWorkCount',
    'quotaPlanVersionId',
    'targetTopicIds',
  ]);
  if (
    value.samplePlan.armTargetCounts === null ||
    typeof value.samplePlan.armTargetCounts !== 'object' ||
    Array.isArray(value.samplePlan.armTargetCounts)
  ) {
    invalid();
  }
  const armTargetCounts = Object.freeze(
    Object.fromEntries(
      Object.entries(value.samplePlan.armTargetCounts).map(([armId, count]) => [
        identifier(armId),
        integer(count, 0, EXPERIMENT_LIMITS.maxSampleTopics),
      ]),
    ),
  );
  const popularitySnapshots = (() => {
    if (
      !Array.isArray(value.popularitySnapshots) ||
      value.popularitySnapshots.length > EXPERIMENT_LIMITS.maxSampleTopics
    ) {
      invalid();
    }
    return Object.freeze(value.popularitySnapshots.map(assertPopularitySnapshot));
  })();
  const draft = Object.freeze({
    controlledConditions: Object.freeze(controlledConditions),
    guardrails: Object.freeze(guardrails),
    hypothesis: assertExperimentHypothesis(value.hypothesis),
    name: text(value.name, 512),
    popularitySnapshots,
    primaryMetric: assertExperimentMetricSpec(value.primaryMetric),
    primaryVariable: Object.freeze({ arms: Object.freeze(arms), kind: variableKind }),
    replicationStructure,
    samplePlan: Object.freeze({
      armTargetCounts,
      assignmentUnit: enumValue(value.samplePlan.assignmentUnit, ['TOPIC_CANDIDATE'] as const),
      blockingKeys: stringArray(value.samplePlan.blockingKeys, EXPERIMENT_LIMITS.blockingKeys),
      deterministicSeed: identifier(value.samplePlan.deterministicSeed),
      exclusionRules: stringArray(value.samplePlan.exclusionRules, EXPERIMENT_LIMITS.rules),
      inclusionRules: stringArray(value.samplePlan.inclusionRules, EXPERIMENT_LIMITS.rules),
      maxTopicsPerWork: integer(
        value.samplePlan.maxTopicsPerWork,
        1,
        EXPERIMENT_LIMITS.maxWorkUses,
      ),
      minimumDistinctWorkCount: integer(value.samplePlan.minimumDistinctWorkCount, 3, 100),
      quotaPlanVersionId:
        value.samplePlan.quotaPlanVersionId === null
          ? null
          : identifier(value.samplePlan.quotaPlanVersionId),
      targetTopicIds: stringArray(
        value.samplePlan.targetTopicIds,
        EXPERIMENT_LIMITS.maxSampleTopics,
      ),
    }),
  } satisfies ExperimentDesignDraft);
  return draft;
}

export function assertExperimentStateActionDraft(value: unknown): ExperimentStateActionDraft {
  exactObject(value, ['action', 'expectedRevision', 'experimentId']);
  return Object.freeze({
    action: enumValue(value.action, EXPERIMENT_ACTIONS),
    expectedRevision: integer(value.expectedRevision, 1, Number.MAX_SAFE_INTEGER),
    experimentId: identifier(value.experimentId),
  });
}

export function assertExperimentActionConfirmation(value: unknown): ExperimentActionConfirmation {
  exactObject(value, ['confirmation', 'kind', 'previewHash', 'token']);
  if (value.confirmation !== EXPERIMENT_CONFIRMATION_LITERAL) invalid();
  return Object.freeze({
    confirmation: EXPERIMENT_CONFIRMATION_LITERAL,
    kind: enumValue(value.kind, ['CREATE', 'STATE_ACTION'] as const),
    previewHash: text(value.previewHash, 64),
    token: text(value.token, 128),
  });
}

export function assertExperimentState(value: unknown): ExperimentDesignState {
  return enumValue(value, EXPERIMENT_DESIGN_STATES);
}

export function assertExperimentPlanStatus(value: unknown): ExperimentSamplePlanStatus {
  return enumValue(value, EXPERIMENT_SAMPLE_PLAN_STATUSES);
}

export function assertBoolean(value: unknown): boolean {
  return boolean(value);
}
