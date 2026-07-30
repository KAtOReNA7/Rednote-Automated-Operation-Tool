import {
  EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
  EXPERIMENT_LIMITS,
  type WorkPopularityStratum,
} from './constants.js';
import {
  type ExperimentAssignmentResult,
  type ExperimentAssignmentUnit,
  type ExperimentDesignDraft,
  type ExperimentTopicInput,
} from './contracts.js';
import { ExperimentError } from './errors.js';
import { experimentSemanticHash } from './identity.js';
import { createReplicationFingerprint, validateExperimentDesign } from './policy.js';

export interface ExperimentAssignmentInput {
  readonly design: ExperimentDesignDraft;
  readonly topics: readonly ExperimentTopicInput[];
}

function recordFromKeys(keys: readonly string[], initial = 0): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, initial]));
}

function statusFor(
  distinctWorkCount: number,
  minimumDistinctWorkCount: number,
  shortfall: Readonly<Record<string, number>>,
  imbalance: Readonly<Record<string, number>>,
): ExperimentAssignmentResult['status'] {
  if (distinctWorkCount < minimumDistinctWorkCount) return 'INSUFFICIENT_REPLICATION';
  if (Object.values(shortfall).some((count) => count > 0)) return 'INSUFFICIENT_SAMPLE';
  if (Object.values(imbalance).some((difference) => difference > 1)) return 'UNBALANCED';
  return 'READY_TO_LOCK';
}

export function solveExperimentAssignment(
  input: ExperimentAssignmentInput,
): ExperimentAssignmentResult {
  const validation = validateExperimentDesign(input.design);
  if (input.topics.length > EXPERIMENT_LIMITS.maxSampleTopics) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  const targetIds = new Set(input.design.samplePlan.targetTopicIds);
  const snapshotByWork = new Map(
    input.design.popularitySnapshots.map((snapshot) => [snapshot.workId, snapshot]),
  );
  const replicationFingerprint = createReplicationFingerprint(input.design.replicationStructure);
  const candidates = input.topics
    .filter((topic) => targetIds.has(topic.topicId))
    .map((topic) => {
      const snapshot = snapshotByWork.get(topic.workId);
      if (snapshot === undefined || snapshot.snapshotId !== topic.popularitySnapshot.snapshotId) {
        throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
      }
      if (!topic.current) throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
      if (topic.eligibility !== 'ELIGIBLE') throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
      if (topic.state === 'HELD' || topic.state === 'ARCHIVED') {
        throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
      }
      if (
        topic.contentType !== input.design.replicationStructure.contentType ||
        topic.analysisMode !== input.design.replicationStructure.analysisMode ||
        topic.spoilerLevel !== input.design.replicationStructure.spoilerLevel ||
        topic.structureFingerprint !== replicationFingerprint
      ) {
        throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
      }
      if (input.design.samplePlan.quotaPlanVersionId !== null && topic.quotaPlanMember !== true) {
        throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
      }
      const blockingKey = input.design.samplePlan.blockingKeys
        .map((key) => `${key}:${topic.blockingValues[key] ?? 'UNKNOWN'}`)
        .join('|');
      return Object.freeze({
        ...topic,
        blockingKey: `${topic.contentType}|${snapshot.stratum}|${blockingKey}`,
      });
    });
  if (
    candidates.length !== targetIds.size ||
    new Set(candidates.map((item) => item.topicId)).size !== candidates.length
  ) {
    throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
  }
  const armIds = input.design.primaryVariable.arms.map((arm) => arm.armId);
  const armCounts = recordFromKeys(armIds);
  const perStratum = new Map<string, Record<string, number>>();
  const workCounts = new Map<string, number>();
  const candidatesByStratum = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const stratum = candidatesByStratum.get(candidate.blockingKey) ?? [];
    stratum.push(candidate);
    candidatesByStratum.set(candidate.blockingKey, stratum);
  }
  const sorted = [...candidatesByStratum]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .flatMap(([blockingKey, stratum]) =>
      [...stratum].sort((left, right) => {
        const leftKey = experimentSemanticHash({
          blockingKey,
          policy: EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
          seed: input.design.samplePlan.deterministicSeed,
          topicId: left.topicId,
          workId: left.workId,
        });
        const rightKey = experimentSemanticHash({
          blockingKey,
          policy: EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
          seed: input.design.samplePlan.deterministicSeed,
          topicId: right.topicId,
          workId: right.workId,
        });
        return leftKey.localeCompare(rightKey) || left.topicId.localeCompare(right.topicId);
      }),
    );
  const units: ExperimentAssignmentUnit[] = [];
  for (const candidate of sorted) {
    const useCount = workCounts.get(candidate.workId) ?? 0;
    if (useCount >= input.design.samplePlan.maxTopicsPerWork) continue;
    const stratumCounts = perStratum.get(candidate.blockingKey) ?? recordFromKeys(armIds);
    const eligibleArms = armIds.filter(
      (armId) => (armCounts[armId] ?? 0) < (input.design.samplePlan.armTargetCounts[armId] ?? 0),
    );
    if (eligibleArms.length === 0) break;
    eligibleArms.sort(
      (left, right) =>
        (stratumCounts[left] ?? 0) - (stratumCounts[right] ?? 0) ||
        (armCounts[left] ?? 0) - (armCounts[right] ?? 0) ||
        left.localeCompare(right),
    );
    const armId = eligibleArms[0];
    if (armId === undefined) throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
    armCounts[armId] = (armCounts[armId] ?? 0) + 1;
    stratumCounts[armId] = (stratumCounts[armId] ?? 0) + 1;
    perStratum.set(candidate.blockingKey, stratumCounts);
    workCounts.set(candidate.workId, useCount + 1);
    units.push(
      Object.freeze({
        armId,
        assignmentOrder: units.length + 1,
        blockingKey: candidate.blockingKey,
        popularitySnapshotId: candidate.popularitySnapshot.snapshotId,
        popularityStratum: candidate.popularitySnapshot.stratum,
        reasonCodes: Object.freeze([
          'ASSIGNMENT_BALANCED',
          candidate.popularitySnapshot.stratum === 'UNKNOWN'
            ? 'UNKNOWN_STRATUM_PRESERVED'
            : 'REPLICATION_READY',
        ]),
        structureFingerprint: candidate.structureFingerprint,
        topicId: candidate.topicId,
        topicVersionId: candidate.topicVersionId,
        workId: candidate.workId,
      }),
    );
  }
  const shortfallByArm = Object.freeze(
    Object.fromEntries(
      armIds.map((armId) => [
        armId,
        Math.max(
          0,
          (input.design.samplePlan.armTargetCounts[armId] ?? 0) - (armCounts[armId] ?? 0),
        ),
      ]),
    ),
  );
  const imbalanceByStratum: Record<string, number> = {};
  for (const [key, counts] of perStratum) {
    const values = armIds.map((armId) => counts[armId] ?? 0);
    imbalanceByStratum[key] = Math.max(...values) - Math.min(...values);
  }
  const distinctWorkCount = new Set(units.map((unit) => unit.workId)).size;
  const status = statusFor(
    distinctWorkCount,
    input.design.samplePlan.minimumDistinctWorkCount,
    shortfallByArm,
    imbalanceByStratum,
  );
  const inputDescriptor = {
    designHash: validation.designHash,
    policyVersion: EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
    topics: candidates
      .map((topic) => ({
        blockingKey: topic.blockingKey,
        popularitySnapshotId: topic.popularitySnapshot.snapshotId,
        topicId: topic.topicId,
        topicVersionId: topic.topicVersionId,
        workId: topic.workId,
      }))
      .sort((left, right) => left.topicId.localeCompare(right.topicId)),
  };
  const inputHash = experimentSemanticHash(inputDescriptor);
  const assignmentDescriptor = {
    inputHash,
    status,
    units: units.map((unit) => ({
      armId: unit.armId,
      blockingKey: unit.blockingKey,
      topicId: unit.topicId,
      workId: unit.workId,
    })),
  };
  const reasonCodes = [
    status === 'READY_TO_LOCK' ? 'ASSIGNMENT_BALANCED' : 'SAMPLE_LIMITATION',
    ...(distinctWorkCount >= input.design.samplePlan.minimumDistinctWorkCount
      ? ['REPLICATION_READY']
      : ['INSUFFICIENT_REPLICATION']),
    ...(Object.values(shortfallByArm).some((value) => value > 0) ? ['ASSIGNMENT_SHORTFALL'] : []),
    'NO_EFFECT_CONCLUSION',
  ];
  return Object.freeze({
    armCounts: Object.freeze({ ...armCounts }),
    assignmentHash: experimentSemanticHash(assignmentDescriptor),
    distinctWorkCount,
    imbalanceByStratum: Object.freeze(imbalanceByStratum),
    inputHash,
    reasonCodes: Object.freeze(reasonCodes),
    shortfallByArm,
    status,
    units: Object.freeze(units),
  });
}

export function countAssignmentStrata(
  units: readonly ExperimentAssignmentUnit[],
): Readonly<Record<WorkPopularityStratum, number>> {
  const counts: Record<WorkPopularityStratum, number> = {
    COLD: 0,
    HOT: 0,
    UNKNOWN: 0,
    WARM: 0,
  };
  for (const unit of units) counts[unit.popularityStratum] += 1;
  return Object.freeze(counts);
}
