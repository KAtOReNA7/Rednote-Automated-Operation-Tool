import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
  EXPERIMENT_CONTRACT_VERSION,
  EXPERIMENT_LIMITS,
  EXPERIMENT_METRIC_REGISTRY_VERSION,
  EXPERIMENT_POPULARITY_POLICY_VERSION,
  EXPERIMENT_REPLICATION_POLICY_VERSION,
  EXPERIMENT_VARIABLE_REGISTRY_VERSION,
  ExperimentError,
  assertExperimentDesignDraft,
  canonicalExperimentJson,
  experimentSemanticHash,
  solveExperimentAssignment,
  transitionExperimentState,
  validateExperimentDesign,
  type ExperimentAction,
  type ExperimentAssignmentResult,
  type ExperimentDesignDraft,
  type ExperimentDesignState,
  type ExperimentSamplePlanStatus,
  type EXPERIMENT_STATE_POLICY_VERSION,
  type ExperimentTopicInput,
  type ExperimentVariableKind,
  type WorkPopularityStratum,
} from '@mystery-operations/experiments';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

interface ExperimentRootRow extends Row {
  readonly design_version_id: string;
  readonly experiment_revision: number;
  readonly experiment_state: ExperimentDesignState;
  readonly id: string;
  readonly name: string;
  readonly profile_id: string;
  readonly updated_at: string;
  readonly version_number: number;
}

interface TopicAssignmentRow extends Row {
  readonly analysis_mode: ExperimentTopicInput['analysisMode'];
  readonly candidate_state: ExperimentTopicInput['state'];
  readonly content_type: ExperimentTopicInput['contentType'];
  readonly dossier_version_id: string | null;
  readonly eligibility_state: ExperimentTopicInput['eligibility'];
  readonly permission_snapshot_id: string | null;
  readonly quota_plan_member: number;
  readonly spoiler_level: ExperimentTopicInput['spoilerLevel'];
  readonly stale: number;
  readonly topic_id: string;
  readonly topic_version_id: string;
  readonly work_id: string;
}

export interface ExperimentListItem {
  readonly assignmentStatus: ExperimentSamplePlanStatus | null;
  readonly experimentId: string;
  readonly name: string;
  readonly primaryMetricId: string;
  readonly primaryVariableKind: ExperimentVariableKind;
  readonly revision: number;
  readonly stale: boolean;
  readonly state: ExperimentDesignState;
  readonly updatedAt: string;
  readonly versionNumber: number;
}

export interface ExperimentListView {
  readonly items: readonly ExperimentListItem[];
  readonly limit: number;
  readonly offset: number;
  readonly profileId: string;
  readonly total: number;
}

export interface ExperimentDetailView extends ExperimentListItem {
  readonly assignment: {
    readonly armCounts: Readonly<Record<string, number>>;
    readonly assignmentHash: string;
    readonly distinctWorkCount: number;
    readonly imbalanceByStratum: Readonly<Record<string, number>>;
    readonly shortfallByArm: Readonly<Record<string, number>>;
    readonly status: ExperimentSamplePlanStatus;
    readonly strataCounts: Readonly<Record<WorkPopularityStratum, number>>;
    readonly unitCount: number;
  } | null;
  readonly design: ExperimentDesignDraft;
  readonly designVersionId: string;
  readonly history: readonly {
    readonly action: string;
    readonly createdAt: string;
    readonly from: ExperimentDesignState | null;
    readonly revision: number;
    readonly to: ExperimentDesignState;
  }[];
  readonly historyPage: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
  readonly invalidationReasons: readonly string[];
  readonly lockedMeansExecution: false;
  readonly resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION';
  readonly versionHistory: {
    readonly items: readonly {
      readonly changeKinds: readonly string[];
      readonly createdAt: string;
      readonly designHash: string;
      readonly designVersionId: string;
      readonly isCurrent: boolean;
      readonly name: string;
      readonly previousVersionId: string | null;
      readonly primaryMetricId: string;
      readonly primaryVariableKind: ExperimentVariableKind;
      readonly versionNumber: number;
    }[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
}

export interface ExperimentAssignmentPreview {
  readonly designVersionId: string;
  readonly expectedRevision: number;
  readonly experimentId: string;
  readonly previewHash: string;
  readonly result: ExperimentAssignmentResult;
}

export interface ExperimentActionPreview {
  readonly action: Exclude<ExperimentAction, 'CLONE_VERSION'>;
  readonly after: ExperimentDesignState;
  readonly assignmentReady: boolean;
  readonly before: ExperimentDesignState;
  readonly designVersionId: string;
  readonly expectedRevision: number;
  readonly experimentId: string;
  readonly policyVersion: typeof EXPERIMENT_STATE_POLICY_VERSION;
  readonly previewHash: string;
}

function identifier(value: string, maximum = EXPERIMENT_LIMITS.identifierBytes): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    Buffer.byteLength(value, 'utf8') > maximum
  ) {
    throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
  }
  return value;
}

function iso(value: string): string {
  if (!UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
  }
  return value;
}

function integer(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
  }
  return value;
}

function parseCountMap(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== 'string') throw new ExperimentError('EXPERIMENT_CONFLICT');
  const parsed = JSON.parse(value) as unknown;
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((item) => !Number.isSafeInteger(item) || (item as number) < 0)
  ) {
    throw new ExperimentError('EXPERIMENT_CONFLICT');
  }
  return Object.freeze(parsed as Record<string, number>);
}

function designChangeKinds(
  current: ExperimentDesignDraft,
  previous: ExperimentDesignDraft | null,
): readonly string[] {
  if (previous === null) return Object.freeze(['INITIAL_DESIGN']);
  const sections = [
    ['NAME', current.name, previous.name],
    ['HYPOTHESIS', current.hypothesis, previous.hypothesis],
    ['PRIMARY_VARIABLE', current.primaryVariable, previous.primaryVariable],
    ['PRIMARY_METRIC', current.primaryMetric, previous.primaryMetric],
    ['GUARDRAILS', current.guardrails, previous.guardrails],
    ['CONTROLLED_CONDITIONS', current.controlledConditions, previous.controlledConditions],
    ['REPLICATION_STRUCTURE', current.replicationStructure, previous.replicationStructure],
    ['SAMPLE_PLAN', current.samplePlan, previous.samplePlan],
    ['POPULARITY_SNAPSHOTS', current.popularitySnapshots, previous.popularitySnapshots],
  ] as const;
  return Object.freeze(
    sections
      .filter(([, left, right]) => canonicalExperimentJson(left) !== canonicalExperimentJson(right))
      .map(([kind]) => kind),
  );
}

export class SqliteExperimentRepository {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public list(
    profileIdValue: string,
    input: {
      readonly limit: number;
      readonly offset: number;
      readonly query: string;
      readonly state: ExperimentDesignState | null;
    },
  ): ExperimentListView {
    const profileId = identifier(profileIdValue);
    this.#requireProfile(profileId);
    const limit = integer(input.limit, 1, EXPERIMENT_LIMITS.maxPageSize);
    const offset = integer(input.offset, 0, EXPERIMENT_LIMITS.maxPageOffset);
    if (typeof input.query !== 'string' || Buffer.byteLength(input.query, 'utf8') > 512) {
      throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
    }
    const filters = [
      "experiment.experiment_contract_version = 'experiment-design-v1'",
      'experiment.profile_id = ?',
    ];
    const parameters: Array<number | string> = [profileId];
    if (input.query.length > 0) {
      filters.push("experiment.name LIKE ? ESCAPE '\\'");
      parameters.push(
        `%${input.query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
      );
    }
    if (input.state !== null) {
      filters.push(`CASE WHEN EXISTS (
        SELECT 1 FROM experiment_invalidations AS invalidation
        WHERE invalidation.design_version_id = design.id
      ) THEN 'STALE' ELSE experiment.experiment_state END = ?`);
      parameters.push(input.state);
    }
    const where = filters.join(' AND ');
    const total = (
      this.#database
        .prepare(
          `SELECT count(*) AS count
           FROM experiments AS experiment
           JOIN experiment_current_designs AS current
             ON current.experiment_id = experiment.id
           JOIN experiment_design_versions AS design
             ON design.id = current.design_version_id
           WHERE ${where}`,
        )
        .get(...parameters) as { readonly count: number }
    ).count;
    const rows = this.#database
      .prepare(
        `SELECT experiment.id, experiment.name, experiment.experiment_state,
                experiment.experiment_revision, experiment.updated_at,
                design.version_number, design.primary_variable_kind,
                design.primary_metric_id, assignment.status AS assignment_status,
                EXISTS (
                  SELECT 1 FROM experiment_invalidations AS invalidation
                  WHERE invalidation.design_version_id = design.id
                ) AS stale
         FROM experiments AS experiment
         JOIN experiment_current_designs AS current
           ON current.experiment_id = experiment.id
         JOIN experiment_design_versions AS design
           ON design.id = current.design_version_id
         LEFT JOIN experiment_current_assignments AS current_assignment
           ON current_assignment.design_version_id = design.id
         LEFT JOIN experiment_assignment_plans AS assignment
           ON assignment.id = current_assignment.assignment_plan_id
         WHERE ${where}
         ORDER BY experiment.updated_at DESC, experiment.id
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters, limit, offset) as unknown as readonly {
      readonly assignment_status: ExperimentSamplePlanStatus | null;
      readonly experiment_revision: number;
      readonly experiment_state: ExperimentDesignState;
      readonly id: string;
      readonly name: string;
      readonly primary_metric_id: string;
      readonly primary_variable_kind: ExperimentVariableKind;
      readonly stale: number;
      readonly updated_at: string;
      readonly version_number: number;
    }[];
    return Object.freeze({
      items: Object.freeze(
        rows.map((row) =>
          Object.freeze({
            assignmentStatus: row.assignment_status,
            experimentId: row.id,
            name: row.name,
            primaryMetricId: row.primary_metric_id,
            primaryVariableKind: row.primary_variable_kind,
            revision: row.experiment_revision,
            stale: row.stale === 1,
            state: row.stale === 1 ? 'STALE' : row.experiment_state,
            updatedAt: row.updated_at,
            versionNumber: row.version_number,
          }),
        ),
      ),
      limit,
      offset,
      profileId,
      total,
    });
  }

  public get(
    experimentIdValue: string,
    pagination: {
      readonly historyLimit: number;
      readonly historyOffset: number;
      readonly versionLimit: number;
      readonly versionOffset: number;
    } = {
      historyLimit: 25,
      historyOffset: 0,
      versionLimit: 25,
      versionOffset: 0,
    },
  ): ExperimentDetailView {
    const experimentId = identifier(experimentIdValue);
    const historyLimit = integer(pagination.historyLimit, 1, EXPERIMENT_LIMITS.maxHistoryPageSize);
    const historyOffset = integer(pagination.historyOffset, 0, EXPERIMENT_LIMITS.maxPageOffset);
    const versionLimit = integer(pagination.versionLimit, 1, EXPERIMENT_LIMITS.maxHistoryPageSize);
    const versionOffset = integer(pagination.versionOffset, 0, EXPERIMENT_LIMITS.maxPageOffset);
    const root = this.#requireRoot(experimentId);
    const design = this.#loadDraft(root.design_version_id);
    const invalidations = this.#database
      .prepare(
        `SELECT DISTINCT reason_code
         FROM experiment_invalidations
         WHERE design_version_id = ?
         ORDER BY reason_code
         LIMIT 64`,
      )
      .all(root.design_version_id) as unknown as readonly { readonly reason_code: string }[];
    const assignment = this.#database
      .prepare(
        `SELECT plan.id, plan.status, plan.arm_counts_json, plan.assignment_hash,
                plan.distinct_work_count, plan.imbalance_json, plan.shortfall_json,
                (SELECT count(*) FROM experiment_assignment_units AS unit
                 WHERE unit.assignment_plan_id = plan.id) AS unit_count
         FROM experiment_current_assignments AS current
         JOIN experiment_assignment_plans AS plan
           ON plan.id = current.assignment_plan_id
         WHERE current.design_version_id = ?`,
      )
      .get(root.design_version_id) as
      | {
          readonly arm_counts_json: string;
          readonly assignment_hash: string;
          readonly distinct_work_count: number;
          readonly id: string;
          readonly imbalance_json: string;
          readonly shortfall_json: string;
          readonly status: ExperimentSamplePlanStatus;
          readonly unit_count: number;
        }
      | undefined;
    const strata: Record<WorkPopularityStratum, number> = {
      COLD: 0,
      HOT: 0,
      UNKNOWN: 0,
      WARM: 0,
    };
    if (assignment !== undefined) {
      const rows = this.#database
        .prepare(
          `SELECT popularity_stratum, count(*) AS count
           FROM experiment_assignment_units
           WHERE assignment_plan_id = ?
           GROUP BY popularity_stratum`,
        )
        .all(assignment.id) as unknown as readonly {
        readonly count: number;
        readonly popularity_stratum: WorkPopularityStratum;
      }[];
      for (const row of rows) strata[row.popularity_stratum] = row.count;
    }
    const historyTotal = (
      this.#database
        .prepare(
          `SELECT count(*) AS count
           FROM experiment_state_transitions WHERE experiment_id = ?`,
        )
        .get(experimentId) as { readonly count: number }
    ).count;
    const history = this.#database
      .prepare(
        `SELECT action, created_at, from_state, revision, to_state
         FROM experiment_state_transitions
         WHERE experiment_id = ?
         ORDER BY revision DESC
         LIMIT ? OFFSET ?`,
      )
      .all(experimentId, historyLimit, historyOffset) as unknown as readonly {
      readonly action: string;
      readonly created_at: string;
      readonly from_state: ExperimentDesignState | null;
      readonly revision: number;
      readonly to_state: ExperimentDesignState;
    }[];
    const versionTotal = (
      this.#database
        .prepare(
          `SELECT count(*) AS count
           FROM experiment_design_versions WHERE experiment_id = ?`,
        )
        .get(experimentId) as { readonly count: number }
    ).count;
    const versionRows = this.#database
      .prepare(
        `SELECT design.id, design.version_number, design.previous_version_id,
                design.design_payload_json, design.design_hash, design.created_at,
                design.primary_variable_kind, design.primary_metric_id,
                previous.design_payload_json AS previous_payload_json
         FROM experiment_design_versions AS design
         LEFT JOIN experiment_design_versions AS previous
           ON previous.id = design.previous_version_id
         WHERE design.experiment_id = ?
         ORDER BY design.version_number DESC
         LIMIT ? OFFSET ?`,
      )
      .all(experimentId, versionLimit, versionOffset) as unknown as readonly {
      readonly created_at: string;
      readonly design_hash: string;
      readonly design_payload_json: string;
      readonly id: string;
      readonly previous_payload_json: string | null;
      readonly previous_version_id: string | null;
      readonly primary_metric_id: string;
      readonly primary_variable_kind: ExperimentVariableKind;
      readonly version_number: number;
    }[];
    const stale = invalidations.length > 0;
    return Object.freeze({
      assignment:
        assignment === undefined
          ? null
          : Object.freeze({
              armCounts: parseCountMap(assignment.arm_counts_json),
              assignmentHash: assignment.assignment_hash,
              distinctWorkCount: assignment.distinct_work_count,
              imbalanceByStratum: parseCountMap(assignment.imbalance_json),
              shortfallByArm: parseCountMap(assignment.shortfall_json),
              status: stale ? 'STALE' : assignment.status,
              strataCounts: Object.freeze(strata),
              unitCount: assignment.unit_count,
            }),
      assignmentStatus: assignment === undefined ? null : stale ? 'STALE' : assignment.status,
      design,
      designVersionId: root.design_version_id,
      experimentId,
      history: Object.freeze(
        history.map((row) =>
          Object.freeze({
            action: row.action,
            createdAt: row.created_at,
            from: row.from_state,
            revision: row.revision,
            to: row.to_state,
          }),
        ),
      ),
      historyPage: Object.freeze({
        limit: historyLimit,
        offset: historyOffset,
        total: historyTotal,
      }),
      invalidationReasons: Object.freeze(invalidations.map((row) => row.reason_code)),
      lockedMeansExecution: false,
      name: root.name,
      primaryMetricId: design.primaryMetric.metricId,
      primaryVariableKind: design.primaryVariable.kind,
      resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION',
      revision: root.experiment_revision,
      stale,
      state: stale ? 'STALE' : root.experiment_state,
      updatedAt: root.updated_at,
      versionHistory: Object.freeze({
        items: Object.freeze(
          versionRows.map((row) => {
            const current = assertExperimentDesignDraft(JSON.parse(row.design_payload_json));
            const previous =
              row.previous_payload_json === null
                ? null
                : assertExperimentDesignDraft(JSON.parse(row.previous_payload_json));
            return Object.freeze({
              changeKinds: designChangeKinds(current, previous),
              createdAt: row.created_at,
              designHash: row.design_hash,
              designVersionId: row.id,
              isCurrent: row.id === root.design_version_id,
              name: current.name,
              previousVersionId: row.previous_version_id,
              primaryMetricId: row.primary_metric_id,
              primaryVariableKind: row.primary_variable_kind,
              versionNumber: row.version_number,
            });
          }),
        ),
        limit: versionLimit,
        offset: versionOffset,
        total: versionTotal,
      }),
      versionNumber: root.version_number,
    });
  }

  public createDraft(
    profileIdValue: string,
    value: unknown,
    nowValue: string,
  ): ExperimentDetailView {
    const profileId = identifier(profileIdValue);
    this.#requireProfile(profileId);
    const draft = assertExperimentDesignDraft(value);
    const now = iso(nowValue);
    const experimentId = this.#id();
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO experiments(
             id, name, hypothesis, primary_metric, guardrail_metrics_json,
             variable_name, variants_json, start_at, end_at, status,
             experiment_contract_version, profile_id, experiment_state,
             experiment_revision, created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'DRAFT',
             ?, ?, 'DRAFT', 1, ?, ?
           )`,
        )
        .run(
          experimentId,
          draft.name,
          canonicalExperimentJson(draft.hypothesis),
          draft.primaryMetric.metricId,
          canonicalExperimentJson(draft.guardrails.map((item) => item.metric.metricId)),
          draft.primaryVariable.kind,
          canonicalExperimentJson(draft.primaryVariable.arms),
          now,
          EXPERIMENT_CONTRACT_VERSION,
          profileId,
          now,
          now,
        );
      const designVersionId = this.#insertDesignVersion(experimentId, 1, null, 'DRAFT', draft, now);
      this.#database
        .prepare(
          `INSERT INTO experiment_current_designs(
             experiment_id, design_version_id, revision, updated_at
           ) VALUES (?, ?, 1, ?)`,
        )
        .run(experimentId, designVersionId, now);
      this.#insertTransition({
        action: 'CREATE',
        createdAt: now,
        designVersionId,
        expectedRevision: 0,
        experimentId,
        from: null,
        reasonCode: 'DRAFT_CREATED',
        revision: 1,
        to: 'DRAFT',
      });
      this.#audit(
        'DRAFT_CREATED',
        experimentId,
        designVersionId,
        null,
        { externalRequestCount: 0, resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION' },
        now,
      );
    });
    return this.get(experimentId);
  }

  public previewAssignment(experimentIdValue: string): ExperimentAssignmentPreview {
    const experimentId = identifier(experimentIdValue);
    const root = this.#requireRoot(experimentId);
    if (this.#isStale(root.design_version_id)) {
      throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
    }
    const design = this.#loadDraft(root.design_version_id);
    const result = solveExperimentAssignment({
      design,
      topics: this.#loadAssignmentTopics(design),
    });
    const descriptor = {
      assignmentHash: result.assignmentHash,
      designVersionId: root.design_version_id,
      expectedRevision: root.experiment_revision,
      experimentId,
      inputHash: result.inputHash,
    };
    return Object.freeze({
      designVersionId: root.design_version_id,
      expectedRevision: root.experiment_revision,
      experimentId,
      previewHash: experimentSemanticHash(descriptor),
      result,
    });
  }

  public saveAssignment(
    preview: ExperimentAssignmentPreview,
    nowValue: string,
  ): ExperimentDetailView {
    const now = iso(nowValue);
    const current = this.previewAssignment(preview.experimentId);
    if (
      current.designVersionId !== preview.designVersionId ||
      current.expectedRevision !== preview.expectedRevision ||
      current.previewHash !== preview.previewHash ||
      current.result.inputHash !== preview.result.inputHash ||
      current.result.assignmentHash !== preview.result.assignmentHash
    ) {
      throw new ExperimentError('EXPERIMENT_STALE_REVISION');
    }
    const existing = this.#database
      .prepare(
        `SELECT id FROM experiment_assignment_plans
         WHERE design_version_id = ? AND input_hash = ?`,
      )
      .get(preview.designVersionId, preview.result.inputHash);
    if (existing !== undefined) return this.get(preview.experimentId);
    runInTransaction(this.#database, () => {
      const root = this.#requireRoot(preview.experimentId);
      if (
        root.experiment_revision !== preview.expectedRevision ||
        root.design_version_id !== preview.designVersionId ||
        this.#isStale(preview.designVersionId)
      ) {
        throw new ExperimentError('EXPERIMENT_STALE_REVISION');
      }
      const previous = this.#database
        .prepare(
          `SELECT id, version_number FROM experiment_assignment_plans
           WHERE experiment_id = ? ORDER BY version_number DESC LIMIT 1`,
        )
        .get(preview.experimentId) as
        { readonly id: string; readonly version_number: number } | undefined;
      const assignmentPlanId = this.#id();
      this.#database
        .prepare(
          `INSERT INTO experiment_assignment_plans(
             id, experiment_id, design_version_id, version_number,
             previous_version_id, input_hash, assignment_hash, policy_version,
             status, arm_counts_json, imbalance_json, shortfall_json,
             reason_codes_json, distinct_work_count, created_at, locked_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          assignmentPlanId,
          preview.experimentId,
          preview.designVersionId,
          (previous?.version_number ?? 0) + 1,
          previous?.id ?? null,
          preview.result.inputHash,
          preview.result.assignmentHash,
          EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
          preview.result.status,
          canonicalExperimentJson(preview.result.armCounts),
          canonicalExperimentJson(preview.result.imbalanceByStratum),
          canonicalExperimentJson(preview.result.shortfallByArm),
          canonicalExperimentJson(preview.result.reasonCodes),
          preview.result.distinctWorkCount,
          now,
        );
      const design = this.#loadDraft(preview.designVersionId);
      const topics = new Map(
        this.#loadAssignmentTopics(design).map((topic) => [topic.topicId, topic]),
      );
      for (const unit of preview.result.units) {
        const topic = topics.get(unit.topicId);
        if (topic === undefined) throw new ExperimentError('EXPERIMENT_STALE_REVISION');
        this.#database
          .prepare(
            `INSERT INTO experiment_assignment_units(
               assignment_plan_id, design_version_id, assignment_order,
               topic_id, topic_version_id, work_id, arm_id,
               popularity_snapshot_id, popularity_stratum, structure_fingerprint,
               blocking_key, reason_codes_json, dependency_versions_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            assignmentPlanId,
            preview.designVersionId,
            unit.assignmentOrder,
            unit.topicId,
            unit.topicVersionId,
            unit.workId,
            unit.armId,
            unit.popularitySnapshotId,
            unit.popularityStratum,
            unit.structureFingerprint,
            unit.blockingKey,
            canonicalExperimentJson(unit.reasonCodes),
            canonicalExperimentJson({
              dossierVersionId: topic.dossierVersionId,
              permissionSnapshotId: topic.permissionSnapshotId,
              topicVersionId: topic.topicVersionId,
            }),
            now,
          );
        this.#insertAssignmentDependencies(
          preview.experimentId,
          preview.designVersionId,
          assignmentPlanId,
          topic,
          now,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO experiment_current_assignments(
             design_version_id, assignment_plan_id, revision, updated_at
           ) VALUES (?, ?, 1, ?)
           ON CONFLICT(design_version_id) DO UPDATE SET
             assignment_plan_id = excluded.assignment_plan_id,
             revision = experiment_current_assignments.revision + 1,
             updated_at = excluded.updated_at`,
        )
        .run(preview.designVersionId, assignmentPlanId, now);
      const next: ExperimentDesignState =
        preview.result.status === 'READY_TO_LOCK' ? 'ASSIGNMENT_READY' : 'VALIDATED';
      const revision = preview.expectedRevision + 1;
      const changed = this.#database
        .prepare(
          `UPDATE experiments
           SET experiment_state = ?, status = ?, experiment_revision = ?, updated_at = ?
           WHERE id = ? AND experiment_revision = ?`,
        )
        .run(next, next, revision, now, preview.experimentId, preview.expectedRevision);
      if (changed.changes !== 1) throw new ExperimentError('EXPERIMENT_STALE_REVISION');
      const pointer = this.#database
        .prepare(
          `UPDATE experiment_current_designs
           SET revision = ?, updated_at = ?
           WHERE experiment_id = ? AND revision = ?`,
        )
        .run(revision, now, preview.experimentId, preview.expectedRevision);
      if (pointer.changes !== 1) throw new ExperimentError('EXPERIMENT_STALE_REVISION');
      this.#insertTransition({
        action: next === 'ASSIGNMENT_READY' ? 'ASSIGNMENT_READY' : 'VALIDATE',
        createdAt: now,
        designVersionId: preview.designVersionId,
        expectedRevision: preview.expectedRevision,
        experimentId: preview.experimentId,
        from: root.experiment_state,
        reasonCode: next === 'ASSIGNMENT_READY' ? 'ASSIGNMENT_READY' : preview.result.status,
        revision,
        to: next,
      });
      this.#audit(
        'ASSIGNMENT_SAVED',
        preview.experimentId,
        preview.designVersionId,
        assignmentPlanId,
        {
          assignmentHash: preview.result.assignmentHash,
          externalRequestCount: 0,
          status: preview.result.status,
        },
        now,
      );
    });
    return this.get(preview.experimentId);
  }

  public previewAction(
    experimentIdValue: string,
    action: Exclude<ExperimentAction, 'CLONE_VERSION'>,
    expectedRevisionValue: number,
  ): ExperimentActionPreview {
    const experimentId = identifier(experimentIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1, Number.MAX_SAFE_INTEGER);
    const root = this.#requireRoot(experimentId);
    if (root.experiment_revision !== expectedRevision) {
      throw new ExperimentError('EXPERIMENT_STALE_REVISION');
    }
    const assignmentReady = this.#assignmentReady(root.design_version_id);
    const before: ExperimentDesignState = this.#isStale(root.design_version_id)
      ? 'STALE'
      : root.experiment_state;
    const transition = transitionExperimentState(before, action, assignmentReady);
    const descriptor = {
      action,
      after: transition.result.to,
      assignmentReady,
      before,
      designVersionId: root.design_version_id,
      expectedRevision,
      experimentId,
      policyVersion: transition.policyVersion,
    };
    return Object.freeze({ ...descriptor, previewHash: experimentSemanticHash(descriptor) });
  }

  public applyAction(preview: ExperimentActionPreview, nowValue: string): ExperimentDetailView {
    const now = iso(nowValue);
    const current = this.previewAction(
      preview.experimentId,
      preview.action,
      preview.expectedRevision,
    );
    if (current.previewHash !== preview.previewHash) {
      throw new ExperimentError('EXPERIMENT_STALE_REVISION');
    }
    runInTransaction(this.#database, () => {
      const revision = preview.expectedRevision + 1;
      const changed = this.#database
        .prepare(
          `UPDATE experiments
           SET experiment_state = ?, status = ?, experiment_revision = ?, updated_at = ?
           WHERE id = ? AND experiment_revision = ?`,
        )
        .run(
          preview.after,
          preview.after,
          revision,
          now,
          preview.experimentId,
          preview.expectedRevision,
        );
      if (changed.changes !== 1) throw new ExperimentError('EXPERIMENT_STALE_REVISION');
      const pointer = this.#database
        .prepare(
          `UPDATE experiment_current_designs
           SET revision = ?, updated_at = ?
           WHERE experiment_id = ? AND revision = ?`,
        )
        .run(revision, now, preview.experimentId, preview.expectedRevision);
      if (pointer.changes !== 1) throw new ExperimentError('EXPERIMENT_STALE_REVISION');
      this.#insertTransition({
        action: preview.action,
        createdAt: now,
        designVersionId: preview.designVersionId,
        expectedRevision: preview.expectedRevision,
        experimentId: preview.experimentId,
        from: preview.before,
        reasonCode: `USER_${preview.action}`,
        revision,
        to: preview.after,
      });
      this.#audit(
        preview.action === 'LOCK' ? 'DESIGN_LOCKED' : 'STATE_CHANGED',
        preview.experimentId,
        preview.designVersionId,
        null,
        {
          action: preview.action,
          after: preview.after,
          before: preview.before,
          lockedMeansExecution: false,
        },
        now,
      );
    });
    return this.get(preview.experimentId);
  }

  public cloneVersion(
    experimentIdValue: string,
    expectedRevisionValue: number,
    value: unknown,
    nowValue: string,
  ): ExperimentDetailView {
    const experimentId = identifier(experimentIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1, Number.MAX_SAFE_INTEGER);
    const draft = assertExperimentDesignDraft(value);
    const now = iso(nowValue);
    runInTransaction(this.#database, () => {
      const root = this.#requireRoot(experimentId);
      if (root.experiment_revision !== expectedRevision) {
        throw new ExperimentError('EXPERIMENT_STALE_REVISION');
      }
      const designVersionId = this.#insertDesignVersion(
        experimentId,
        root.version_number + 1,
        root.design_version_id,
        'DRAFT',
        draft,
        now,
      );
      const revision = expectedRevision + 1;
      const changed = this.#database
        .prepare(
          `UPDATE experiments
           SET name = ?, hypothesis = ?, primary_metric = ?,
               guardrail_metrics_json = ?, variable_name = ?, variants_json = ?,
               experiment_state = 'DRAFT', status = 'DRAFT',
               experiment_revision = ?, updated_at = ?
           WHERE id = ? AND experiment_revision = ?`,
        )
        .run(
          draft.name,
          canonicalExperimentJson(draft.hypothesis),
          draft.primaryMetric.metricId,
          canonicalExperimentJson(draft.guardrails.map((item) => item.metric.metricId)),
          draft.primaryVariable.kind,
          canonicalExperimentJson(draft.primaryVariable.arms),
          revision,
          now,
          experimentId,
          expectedRevision,
        );
      if (changed.changes !== 1) throw new ExperimentError('EXPERIMENT_STALE_REVISION');
      const pointer = this.#database
        .prepare(
          `UPDATE experiment_current_designs
           SET design_version_id = ?, revision = ?, updated_at = ?
           WHERE experiment_id = ? AND revision = ?`,
        )
        .run(designVersionId, revision, now, experimentId, expectedRevision);
      if (pointer.changes !== 1) throw new ExperimentError('EXPERIMENT_STALE_REVISION');
      this.#insertTransition({
        action: 'CLONE',
        createdAt: now,
        designVersionId,
        expectedRevision,
        experimentId,
        from: root.experiment_state,
        reasonCode: 'VERSION_CLONED',
        revision,
        to: 'DRAFT',
      });
      this.#audit(
        'VERSION_CLONED',
        experimentId,
        designVersionId,
        null,
        { previousDesignVersionId: root.design_version_id },
        now,
      );
    });
    return this.get(experimentId);
  }

  #id(): string {
    return identifier(this.#idFactory());
  }

  #requireProfile(profileId: string): void {
    if (
      this.#database.prepare('SELECT 1 FROM account_profiles WHERE id = ?').get(profileId) ===
      undefined
    ) {
      throw new ExperimentError('EXPERIMENT_NOT_FOUND');
    }
  }

  #requireRoot(experimentId: string): ExperimentRootRow {
    const row = this.#database
      .prepare(
        `SELECT experiment.id, experiment.name, experiment.profile_id,
                experiment.experiment_state, experiment.experiment_revision,
                experiment.updated_at, current.design_version_id, design.version_number
         FROM experiments AS experiment
         JOIN experiment_current_designs AS current
           ON current.experiment_id = experiment.id
         JOIN experiment_design_versions AS design
           ON design.id = current.design_version_id
         WHERE experiment.id = ?
           AND experiment.experiment_contract_version = 'experiment-design-v1'`,
      )
      .get(experimentId) as ExperimentRootRow | undefined;
    if (row === undefined) throw new ExperimentError('EXPERIMENT_NOT_FOUND');
    return row;
  }

  #loadDraft(designVersionId: string): ExperimentDesignDraft {
    const row = this.#database
      .prepare(
        `SELECT design_payload_json FROM experiment_design_versions
         WHERE id = ? AND schema_version = 'experiment-design-v1'`,
      )
      .get(designVersionId) as { readonly design_payload_json: string } | undefined;
    if (row === undefined) throw new ExperimentError('EXPERIMENT_NOT_FOUND');
    return assertExperimentDesignDraft(JSON.parse(row.design_payload_json));
  }

  #isStale(designVersionId: string): boolean {
    return (
      this.#database
        .prepare('SELECT 1 FROM experiment_invalidations WHERE design_version_id = ? LIMIT 1')
        .get(designVersionId) !== undefined
    );
  }

  #assignmentReady(designVersionId: string): boolean {
    return (
      !this.#isStale(designVersionId) &&
      this.#database
        .prepare(
          `SELECT 1
           FROM experiment_current_assignments AS current
           JOIN experiment_assignment_plans AS plan
             ON plan.id = current.assignment_plan_id
           WHERE current.design_version_id = ? AND plan.status = 'READY_TO_LOCK'`,
        )
        .get(designVersionId) !== undefined
    );
  }

  #insertDesignVersion(
    experimentId: string,
    versionNumber: number,
    previousVersionId: string | null,
    state: ExperimentDesignState,
    draft: ExperimentDesignDraft,
    now: string,
  ): string {
    const validation = validateExperimentDesign(draft);
    for (const snapshot of draft.popularitySnapshots) {
      if (
        this.#database.prepare('SELECT 1 FROM books WHERE id = ?').get(snapshot.workId) ===
        undefined
      ) {
        throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
      }
    }
    if (
      draft.samplePlan.quotaPlanVersionId !== null &&
      this.#database
        .prepare('SELECT 1 FROM topic_quota_plan_versions WHERE id = ?')
        .get(draft.samplePlan.quotaPlanVersionId) === undefined
    ) {
      throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
    }
    const designVersionId = this.#id();
    const dependencyHash = experimentSemanticHash({
      assignmentPolicyVersion: EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
      metricRegistryVersion: EXPERIMENT_METRIC_REGISTRY_VERSION,
      popularityPolicyVersion: EXPERIMENT_POPULARITY_POLICY_VERSION,
      popularitySnapshots: draft.popularitySnapshots.map((item) => item.snapshotId).sort(),
      quotaPlanVersionId: draft.samplePlan.quotaPlanVersionId,
      replicationPolicyVersion: EXPERIMENT_REPLICATION_POLICY_VERSION,
      variableRegistryVersion: EXPERIMENT_VARIABLE_REGISTRY_VERSION,
    });
    this.#database
      .prepare(
        `INSERT INTO experiment_design_versions(
           id, experiment_id, version_number, previous_version_id,
           schema_version, design_state, design_payload_json, hypothesis_json,
           primary_variable_kind, primary_metric_id, sample_plan_json,
           stratification_plan_json, quota_plan_version_id, structure_fingerprint,
           variable_registry_version, metric_registry_version,
           assignment_policy_version, popularity_policy_version,
           replication_policy_version, dependency_hash, design_hash,
           warnings_json, reasons_json, created_at, locked_at, archived_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           NULL, NULL
         )`,
      )
      .run(
        designVersionId,
        experimentId,
        versionNumber,
        previousVersionId,
        EXPERIMENT_CONTRACT_VERSION,
        state,
        canonicalExperimentJson(draft),
        canonicalExperimentJson(draft.hypothesis),
        draft.primaryVariable.kind,
        draft.primaryMetric.metricId,
        canonicalExperimentJson(draft.samplePlan),
        canonicalExperimentJson({
          blockingKeys: draft.samplePlan.blockingKeys,
          strata: ['HOT', 'WARM', 'COLD', 'UNKNOWN'],
        }),
        draft.samplePlan.quotaPlanVersionId,
        validation.replicationFingerprint,
        EXPERIMENT_VARIABLE_REGISTRY_VERSION,
        EXPERIMENT_METRIC_REGISTRY_VERSION,
        EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
        EXPERIMENT_POPULARITY_POLICY_VERSION,
        EXPERIMENT_REPLICATION_POLICY_VERSION,
        dependencyHash,
        validation.designHash,
        canonicalExperimentJson([
          'SMALL_SAMPLE_NO_POWER_CLAIM',
          ...(validation.futureBoundVariable ? ['FUTURE_CAPABILITY_NOT_IMPLEMENTED'] : []),
        ]),
        canonicalExperimentJson(validation.reasonCodes),
        now,
      );
    this.#database
      .prepare(
        `INSERT INTO experiment_primary_variables(
           design_version_id, variable_kind, registry_version, created_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(designVersionId, draft.primaryVariable.kind, EXPERIMENT_VARIABLE_REGISTRY_VERSION, now);
    for (const arm of draft.primaryVariable.arms) {
      this.#database
        .prepare(
          `INSERT INTO experiment_arms(
             design_version_id, arm_id, role, value_identity, label,
             changed_dimensions_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          designVersionId,
          arm.armId,
          arm.role,
          arm.valueIdentity,
          arm.label,
          canonicalExperimentJson(arm.changedDimensions),
          now,
        );
    }
    for (const condition of draft.controlledConditions) {
      this.#database
        .prepare(
          `INSERT INTO experiment_controlled_conditions(
             design_version_id, condition_kind, value_identity, availability, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(designVersionId, condition.kind, condition.valueIdentity, condition.availability, now);
    }
    this.#database
      .prepare(
        `INSERT INTO experiment_primary_metrics(
           design_version_id, metric_id, metric_spec_json,
           availability, registry_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        designVersionId,
        draft.primaryMetric.metricId,
        canonicalExperimentJson(draft.primaryMetric),
        draft.primaryMetric.availability,
        EXPERIMENT_METRIC_REGISTRY_VERSION,
        now,
      );
    for (const guardrail of draft.guardrails) {
      this.#database
        .prepare(
          `INSERT INTO experiment_guardrails(
             design_version_id, metric_id, metric_spec_json,
             guardrail_direction, violation_condition, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          designVersionId,
          guardrail.metric.metricId,
          canonicalExperimentJson(guardrail.metric),
          guardrail.direction,
          guardrail.violationCondition,
          now,
        );
    }
    this.#database
      .prepare(
        `INSERT INTO experiment_replication_structures(
           design_version_id, structure_identity, structure_version,
           content_type, analysis_mode, spoiler_level, comparison_dimension,
           structural_slots_json, required_labels_json, semantic_fingerprint, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        designVersionId,
        draft.replicationStructure.structureIdentity,
        draft.replicationStructure.structureVersion,
        draft.replicationStructure.contentType,
        draft.replicationStructure.analysisMode,
        draft.replicationStructure.spoilerLevel,
        draft.replicationStructure.comparisonDimension,
        canonicalExperimentJson(draft.replicationStructure.structuralSlots),
        canonicalExperimentJson(draft.replicationStructure.requiredLabels),
        validation.replicationFingerprint,
        now,
      );
    this.#database
      .prepare(
        `INSERT INTO experiment_sample_plans(
           design_version_id, assignment_unit, target_topic_ids_json,
           inclusion_rules_json, exclusion_rules_json, arm_target_counts_json,
           minimum_distinct_work_count, max_topics_per_work, deterministic_seed,
           blocking_keys_json, quota_plan_version_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        designVersionId,
        draft.samplePlan.assignmentUnit,
        canonicalExperimentJson(draft.samplePlan.targetTopicIds),
        canonicalExperimentJson(draft.samplePlan.inclusionRules),
        canonicalExperimentJson(draft.samplePlan.exclusionRules),
        canonicalExperimentJson(draft.samplePlan.armTargetCounts),
        draft.samplePlan.minimumDistinctWorkCount,
        draft.samplePlan.maxTopicsPerWork,
        draft.samplePlan.deterministicSeed,
        canonicalExperimentJson(draft.samplePlan.blockingKeys),
        draft.samplePlan.quotaPlanVersionId,
        now,
      );
    for (const snapshot of draft.popularitySnapshots) {
      this.#database
        .prepare(
          `INSERT INTO experiment_popularity_snapshots(
             id, design_version_id, work_id, stratum, source_kind,
             availability, confidence, observed_at, window_start, window_end,
             metric_reference, provenance_json, policy_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.snapshotId,
          designVersionId,
          snapshot.workId,
          snapshot.stratum,
          snapshot.sourceKind,
          snapshot.availability,
          snapshot.confidence,
          snapshot.observedAt,
          snapshot.windowStart,
          snapshot.windowEnd,
          snapshot.metricReference,
          canonicalExperimentJson(snapshot.provenance),
          snapshot.policyVersion,
          now,
        );
    }
    this.#insertDesignDependencies(experimentId, designVersionId, draft, now);
    return designVersionId;
  }

  #loadAssignmentTopics(design: ExperimentDesignDraft): readonly ExperimentTopicInput[] {
    if (design.samplePlan.targetTopicIds.length === 0) return Object.freeze([]);
    const placeholders = design.samplePlan.targetTopicIds.map(() => '?').join(',');
    const rows = this.#database
      .prepare(
        `SELECT topic.id AS topic_id, topic.candidate_state,
                version.id AS topic_version_id, version.content_type,
                version.analysis_mode, version.spoiler_level,
                version.eligibility_state, membership.work_id,
                EXISTS (
                  SELECT 1 FROM topic_candidate_invalidations AS invalidation
                  WHERE invalidation.version_id = version.id
                ) AS stale,
                (
                  SELECT dependency_id FROM topic_dependencies AS dependency
                  WHERE dependency.version_id = version.id
                    AND dependency.dependency_type = 'DOSSIER_VERSION'
                  ORDER BY dependency.dependency_id LIMIT 1
                ) AS dossier_version_id,
                (
                  SELECT dependency_id FROM topic_dependencies AS dependency
                  WHERE dependency.version_id = version.id
                    AND dependency.dependency_type = 'EXPRESSION_PERMISSION'
                  ORDER BY dependency.dependency_id LIMIT 1
                ) AS permission_snapshot_id,
                CASE WHEN ? IS NULL THEN 0 ELSE EXISTS (
                  SELECT 1 FROM topic_quota_plan_members AS member
                  WHERE member.plan_version_id = ?
                    AND member.topic_id = topic.id
                    AND member.topic_version_id = version.id
                ) END AS quota_plan_member
         FROM topics AS topic
         JOIN topic_candidate_versions AS version
           ON version.topic_id = topic.id
          AND version.version_number = topic.current_version_number
         JOIN topic_subject_memberships AS membership
           ON membership.version_id = version.id AND membership.ordinal = 0
         WHERE topic.id IN (${placeholders})
           AND topic.topic_contract_version = 'topic-candidate-v1'
         ORDER BY topic.id`,
      )
      .all(
        design.samplePlan.quotaPlanVersionId,
        design.samplePlan.quotaPlanVersionId,
        ...design.samplePlan.targetTopicIds,
      ) as unknown as readonly TopicAssignmentRow[];
    const validation = validateExperimentDesign(design);
    const snapshots = new Map(
      design.popularitySnapshots.map((snapshot) => [snapshot.workId, snapshot]),
    );
    return Object.freeze(
      rows.map((row) => {
        const popularitySnapshot = snapshots.get(row.work_id);
        if (popularitySnapshot === undefined) {
          throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
        }
        const blockingValues = Object.fromEntries(
          design.samplePlan.blockingKeys.map((key) => {
            if (key === 'POPULARITY_STRATUM') return [key, popularitySnapshot.stratum];
            if (key === 'TOPIC_CONTENT_TYPE') return [key, row.content_type];
            if (key === 'ANALYSIS_MODE') return [key, row.analysis_mode];
            if (key === 'SPOILER_MODE') return [key, row.spoiler_level];
            return [key, 'UNKNOWN'];
          }),
        );
        return Object.freeze({
          analysisMode: row.analysis_mode,
          blockingValues: Object.freeze(blockingValues),
          contentType: row.content_type,
          current: true,
          dossierVersionId: row.dossier_version_id ?? 'NOT_AVAILABLE',
          eligibility: row.stale === 1 ? 'STALE' : row.eligibility_state,
          permissionSnapshotId: row.permission_snapshot_id ?? 'NOT_AVAILABLE',
          popularitySnapshot,
          quotaPlanMember: row.quota_plan_member === 1,
          spoilerLevel: row.spoiler_level,
          state: row.candidate_state,
          structureFingerprint: validation.replicationFingerprint,
          topicId: row.topic_id,
          topicVersionId: row.topic_version_id,
          workId: row.work_id,
        });
      }),
    );
  }

  #insertDesignDependencies(
    experimentId: string,
    designVersionId: string,
    design: ExperimentDesignDraft,
    now: string,
  ): void {
    const dependencies: Array<{
      readonly id: string;
      readonly revision: string;
      readonly type: string;
    }> = [
      {
        id: EXPERIMENT_VARIABLE_REGISTRY_VERSION,
        revision: EXPERIMENT_VARIABLE_REGISTRY_VERSION,
        type: 'VARIABLE_POLICY',
      },
      {
        id: EXPERIMENT_METRIC_REGISTRY_VERSION,
        revision: EXPERIMENT_METRIC_REGISTRY_VERSION,
        type: 'METRIC_POLICY',
      },
      {
        id: EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
        revision: EXPERIMENT_ASSIGNMENT_POLICY_VERSION,
        type: 'ASSIGNMENT_POLICY',
      },
      {
        id: EXPERIMENT_REPLICATION_POLICY_VERSION,
        revision: EXPERIMENT_REPLICATION_POLICY_VERSION,
        type: 'REPLICATION_STRUCTURE',
      },
      {
        id: EXPERIMENT_POPULARITY_POLICY_VERSION,
        revision: EXPERIMENT_POPULARITY_POLICY_VERSION,
        type: 'POPULARITY_POLICY',
      },
      { id: designVersionId, revision: '1', type: 'EXPERIMENT_DESIGN' },
    ];
    if (design.samplePlan.quotaPlanVersionId !== null) {
      dependencies.push({
        id: design.samplePlan.quotaPlanVersionId,
        revision: design.samplePlan.quotaPlanVersionId,
        type: 'TOPIC_QUOTA_PLAN',
      });
    }
    for (const snapshot of design.popularitySnapshots) {
      dependencies.push({
        id: snapshot.snapshotId,
        revision: snapshot.snapshotId,
        type: 'POPULARITY_SNAPSHOT',
      });
      const work = this.#database
        .prepare('SELECT catalog_revision FROM books WHERE id = ?')
        .get(snapshot.workId) as { readonly catalog_revision: number } | undefined;
      if (work === undefined) throw new ExperimentError('EXPERIMENT_POLICY_BLOCKED');
      dependencies.push({
        id: snapshot.workId,
        revision: String(work.catalog_revision),
        type: 'WORK_IDENTITY',
      });
    }
    for (const dependency of dependencies) {
      this.#insertDependency(
        experimentId,
        designVersionId,
        null,
        dependency.type,
        dependency.id,
        dependency.revision,
        now,
      );
    }
  }

  #insertAssignmentDependencies(
    experimentId: string,
    designVersionId: string,
    assignmentPlanId: string,
    topic: ExperimentTopicInput,
    now: string,
  ): void {
    const dependencies = [
      { id: topic.topicId, revision: topic.topicVersionId, type: 'TOPIC_VERSION' },
      { id: topic.topicId, revision: topic.state, type: 'TOPIC_STATE' },
      { id: topic.topicId, revision: topic.eligibility, type: 'TOPIC_ELIGIBILITY' },
      { id: topic.workId, revision: topic.workId, type: 'WORK_IDENTITY' },
      {
        id: topic.popularitySnapshot.snapshotId,
        revision: topic.popularitySnapshot.snapshotId,
        type: 'POPULARITY_SNAPSHOT',
      },
      {
        id: topic.dossierVersionId,
        revision: topic.dossierVersionId,
        type: 'DOSSIER_VERSION',
      },
      {
        id: topic.permissionSnapshotId,
        revision: topic.permissionSnapshotId,
        type: 'EXPRESSION_PERMISSION',
      },
    ];
    for (const dependency of dependencies) {
      this.#insertDependency(
        experimentId,
        designVersionId,
        assignmentPlanId,
        dependency.type,
        dependency.id,
        dependency.revision,
        now,
      );
    }
  }

  #insertDependency(
    experimentId: string,
    designVersionId: string,
    assignmentPlanId: string | null,
    dependencyType: string,
    dependencyId: string,
    observedRevision: string,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO experiment_dependencies(
           id, experiment_id, design_version_id, assignment_plan_id,
           dependency_type, dependency_id, observed_revision,
           dependency_key, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#id(),
        experimentId,
        designVersionId,
        assignmentPlanId,
        dependencyType,
        dependencyId,
        observedRevision,
        experimentSemanticHash({
          assignmentPlanId,
          dependencyId,
          dependencyType,
          observedRevision,
        }),
        now,
      );
  }

  #insertTransition(input: {
    readonly action: string;
    readonly createdAt: string;
    readonly designVersionId: string;
    readonly expectedRevision: number;
    readonly experimentId: string;
    readonly from: ExperimentDesignState | null;
    readonly reasonCode: string;
    readonly revision: number;
    readonly to: ExperimentDesignState;
  }): void {
    const previous = this.#database
      .prepare(
        `SELECT id FROM experiment_state_transitions
         WHERE experiment_id = ? ORDER BY revision DESC LIMIT 1`,
      )
      .get(input.experimentId) as { readonly id: string } | undefined;
    this.#database
      .prepare(
        `INSERT INTO experiment_state_transitions(
           id, experiment_id, design_version_id, revision,
           previous_transition_id, from_state, to_state, action,
           expected_revision, actor, reason_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USER', ?, ?)`,
      )
      .run(
        this.#id(),
        input.experimentId,
        input.designVersionId,
        input.revision,
        previous?.id ?? null,
        input.from,
        input.to,
        input.action,
        input.expectedRevision,
        input.reasonCode,
        input.createdAt,
      );
  }

  #audit(
    eventType: string,
    experimentId: string,
    designVersionId: string,
    assignmentPlanId: string | null,
    details: unknown,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO experiment_audit_events(
           id, event_identity, event_type, experiment_id, design_version_id,
           assignment_plan_id, actor, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'USER', ?, ?)`,
      )
      .run(
        this.#id(),
        `${eventType}:${experimentId}:${designVersionId}:${assignmentPlanId ?? now}`,
        eventType,
        experimentId,
        designVersionId,
        assignmentPlanId,
        canonicalExperimentJson(details),
        now,
      );
  }
}
