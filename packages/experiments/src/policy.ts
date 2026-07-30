import {
  EXPERIMENT_CONTRACT_VERSION,
  EXPERIMENT_FUTURE_BOUND_VARIABLES,
  EXPERIMENT_HYPOTHESIS_VERSION,
  EXPERIMENT_METRIC_REGISTRY_VERSION,
  EXPERIMENT_POPULARITY_POLICY_VERSION,
  EXPERIMENT_REPLICATION_POLICY_VERSION,
  EXPERIMENT_VARIABLE_REGISTRY_VERSION,
  EXPERIMENT_VARIABLE_VALUES,
} from './constants.js';
import {
  assertExperimentDesignDraft,
  type ExperimentDesignDraft,
  type ExperimentMetricSpec,
  type ExperimentValidationSummary,
  type WorkPopularitySnapshotInput,
} from './contracts.js';
import { ExperimentError } from './errors.js';
import { experimentSemanticHash, normalizeExperimentText } from './identity.js';

const VAGUE_HYPOTHESIS = /^(效果更好|更容易爆|更爆|更受欢迎|表现更好)[。.!！]?$/u;

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validateMetricDefinition(metric: ExperimentMetricSpec): void {
  const rateIdentity = metric.metricId.endsWith('_RATE');
  if (
    (rateIdentity && (metric.unit !== 'RATE' || metric.denominator === null)) ||
    (!rateIdentity && (metric.unit === 'RATE' || metric.denominator !== null))
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
}

export function createReplicationFingerprint(
  structure: ExperimentDesignDraft['replicationStructure'],
): string {
  return experimentSemanticHash({
    analysisMode: structure.analysisMode,
    comparisonDimension: structure.comparisonDimension,
    contentType: structure.contentType,
    policyVersion: EXPERIMENT_REPLICATION_POLICY_VERSION,
    requiredLabels: [...structure.requiredLabels].sort(),
    spoilerLevel: structure.spoilerLevel,
    structureIdentity: structure.structureIdentity,
    structureVersion: structure.structureVersion,
    structuralSlots: structure.structuralSlots,
  });
}

export function validatePopularitySnapshot(snapshot: WorkPopularitySnapshotInput): void {
  if (snapshot.policyVersion !== EXPERIMENT_POPULARITY_POLICY_VERSION) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  if (snapshot.stratum === 'UNKNOWN') {
    if (
      snapshot.sourceKind !== 'NOT_AVAILABLE' ||
      snapshot.availability !== 'UNAVAILABLE' ||
      snapshot.confidence !== 'UNAVAILABLE' ||
      snapshot.metricReference !== null ||
      snapshot.observedAt !== null ||
      snapshot.windowStart !== null ||
      snapshot.windowEnd !== null
    ) {
      throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
    }
    return;
  }
  if (
    snapshot.sourceKind === 'NOT_AVAILABLE' ||
    snapshot.availability !== 'AVAILABLE' ||
    snapshot.confidence !== 'CONFIRMED' ||
    snapshot.metricReference === null ||
    snapshot.observedAt === null ||
    snapshot.windowStart === null ||
    snapshot.windowEnd === null ||
    snapshot.provenance.length === 0 ||
    snapshot.windowEnd < snapshot.windowStart
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
}

export function validateExperimentDesign(value: unknown): ExperimentValidationSummary {
  const draft = assertExperimentDesignDraft(value);
  const { hypothesis, primaryVariable, primaryMetric } = draft;
  if (
    VAGUE_HYPOTHESIS.test(normalizeExperimentText(hypothesis.intervention)) ||
    hypothesis.primaryOutcomeMetricId !== primaryMetric.metricId ||
    hypothesis.comparator === hypothesis.intervention ||
    hypothesis.falsificationCondition === hypothesis.rationale ||
    hypothesis.expectedDirection !== primaryMetric.direction
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  validateMetricDefinition(primaryMetric);
  for (const guardrail of draft.guardrails) validateMetricDefinition(guardrail.metric);
  const controls = primaryVariable.arms.filter((arm) => arm.role === 'CONTROL');
  if (controls.length !== 1) throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  if (
    !unique(primaryVariable.arms.map((arm) => arm.armId)) ||
    !unique(primaryVariable.arms.map((arm) => arm.valueIdentity))
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  const allowedValues = EXPERIMENT_VARIABLE_VALUES[primaryVariable.kind];
  for (const arm of primaryVariable.arms) {
    if (
      arm.changedDimensions.length !== 1 ||
      arm.changedDimensions[0] !== primaryVariable.kind ||
      !allowedValues.includes(arm.valueIdentity)
    ) {
      throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
    }
  }
  if (
    !unique(draft.controlledConditions.map((condition) => condition.kind)) ||
    draft.controlledConditions.some((condition) => condition.kind === primaryVariable.kind)
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  if (
    !unique(draft.guardrails.map((guardrail) => guardrail.metric.metricId)) ||
    draft.guardrails.some((guardrail) => guardrail.metric.metricId === primaryMetric.metricId)
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  if (
    primaryMetric.availability === 'AVAILABLE_FOR_FUTURE_COLLECTION' &&
    primaryMetric.metricId === 'APPROVAL_WORK_UNITS'
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  if (draft.replicationStructure.structuralSlots.length === 0) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  const armIds = new Set(primaryVariable.arms.map((arm) => arm.armId));
  if (
    Object.keys(draft.samplePlan.armTargetCounts).length !== armIds.size ||
    Object.keys(draft.samplePlan.armTargetCounts).some((armId) => !armIds.has(armId)) ||
    draft.samplePlan.minimumDistinctWorkCount < 3 ||
    !unique(draft.samplePlan.targetTopicIds) ||
    !unique(draft.popularitySnapshots.map((snapshot) => snapshot.workId))
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  for (const snapshot of draft.popularitySnapshots) validatePopularitySnapshot(snapshot);
  const replicationFingerprint = createReplicationFingerprint(draft.replicationStructure);
  const descriptor = {
    contractVersion: EXPERIMENT_CONTRACT_VERSION,
    draft,
    hypothesisVersion: EXPERIMENT_HYPOTHESIS_VERSION,
    metricRegistryVersion: EXPERIMENT_METRIC_REGISTRY_VERSION,
    popularityPolicyVersion: EXPERIMENT_POPULARITY_POLICY_VERSION,
    replicationFingerprint,
    variableRegistryVersion: EXPERIMENT_VARIABLE_REGISTRY_VERSION,
  };
  const futureBoundVariable = (EXPERIMENT_FUTURE_BOUND_VARIABLES as readonly string[]).includes(
    primaryVariable.kind,
  );
  return Object.freeze({
    designHash: experimentSemanticHash(descriptor),
    futureBoundVariable,
    reasonCodes: Object.freeze([
      'DESIGN_VALID',
      'NO_EFFECT_CONCLUSION',
      ...(futureBoundVariable ? ['FUTURE_BOUND_INTENT_ONLY'] : []),
    ]),
    replicationFingerprint,
    valid: true,
  });
}
