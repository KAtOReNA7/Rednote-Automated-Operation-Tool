import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  AUTHENTICITY_POLICY_VERSION,
  EXPRESSION_PERMISSION_VERSION,
  SPOILER_POLICY_VERSION,
} from '@mystery-operations/authenticity';
import {
  FIRST_30_PROFILE_ID,
  TOPIC_CANDIDATE_CONTRACT_VERSION,
  TOPIC_CONTENT_TYPES,
  TOPIC_ELIGIBILITY_POLICY_VERSION,
  TOPIC_FINGERPRINT_POLICY_VERSION,
  TOPIC_GENERATION_JOB_CONTRACT_VERSION,
  TOPIC_GENERATION_PLAN_VERSION,
  TOPIC_LIMITS,
  TOPIC_QUOTA_SOLVER_VERSION,
  TOPIC_QUOTA_JOB_CONTRACT_VERSION,
  TOPIC_RANKING_COMPONENTS,
  TOPIC_RANKING_POLICY_VERSION,
  TOPIC_STATE_POLICY_VERSION,
  TopicError,
  assertTopicBatchStateChangeDraft,
  assertTopicGenerationJobPayload,
  assertTopicQuotaPlanJobPayload,
  assertTopicStateChangeDraft,
  buildLocalTopicGenerationPlan,
  createTopicSemanticFingerprint,
  evaluateTopicEligibility,
  evaluateTopicRanking,
  solveFirst30Quota,
  topicSemanticHash,
  transitionTopicState,
  type TopicCandidateDraft,
  type TopicCandidateState,
  type TopicContentType,
  type TopicEligibilityState,
  type TopicGenerationPlanResult,
  type TopicGenerationJobPayloadV1,
  type TopicGenerationWorkInput,
  type TopicQuotaCandidate,
  type TopicQuotaCategoryResult,
  type TopicQuotaPlanResult,
  type TopicQuotaPlanJobPayloadV1,
  type TopicRankingComponent,
  type TopicRankingComponentResult,
  type TopicRankingResult,
  type TopicStateAction,
} from '@mystery-operations/topics';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

interface TopicRootRow extends Row {
  readonly candidate_state: TopicCandidateState;
  readonly canonical_topic_id: string | null;
  readonly current_version_number: number;
  readonly id: string;
  readonly profile_id: string;
  readonly semantic_fingerprint: string;
  readonly topic_revision: number;
}

interface TopicVersionRow extends Row {
  readonly analysis_mode: 'PERSONAL' | 'PUBLIC_RESEARCH';
  readonly approval_workload_units: number | null;
  readonly candidate_state: TopicCandidateState;
  readonly candidate_judgment: string | null;
  readonly central_question: string;
  readonly comparison_dimension: string | null;
  readonly content_type: TopicContentType;
  readonly cost_state: 'KNOWN' | 'UNKNOWN';
  readonly created_at: string;
  readonly dependency_hash: string;
  readonly eligibility_policy_version: string;
  readonly eligibility_reason_codes_json: string;
  readonly eligibility_state: TopicEligibilityState;
  readonly estimated_external_cost_microusd: number | null;
  readonly fingerprint_policy_version: string;
  readonly id: string;
  readonly ranking_complete: number;
  readonly ranking_policy_version: string;
  readonly required_public_labels_json: string;
  readonly semantic_fingerprint: string;
  readonly spoiler_level: 'NO_SPOILER' | 'LIGHT_SPOILER' | 'FULL_TRICK_ANALYSIS';
  readonly spoiler_user_confirmation_required: number;
  readonly spoiler_warning_placement: 'NONE' | 'BODY_OPENING' | 'COVER_TITLE_AND_BODY_OPENING';
  readonly spoiler_warning_required: number;
  readonly tie_break_key: string;
  readonly topic_angle: string;
  readonly topic_id: string;
  readonly topic_revision: number;
  readonly total_score_basis_points: number;
  readonly version_number: number;
  readonly workload_state: 'KNOWN' | 'UNKNOWN';
}

interface GenerationInputRow extends Row {
  readonly authenticity_policy_version: string;
  readonly blocked_count: number;
  readonly book_revision: number;
  readonly coverage_basis_points: number;
  readonly coverage_policy_version: string;
  readonly dossier_id: string;
  readonly dossier_readiness: string;
  readonly dossier_version_id: string;
  readonly fact_policy_version: string;
  readonly gap_count: number;
  readonly personal_content_mode: string;
  readonly permission_snapshot_id: string;
  readonly permission_snapshot_version: string;
  readonly public_research_content_mode: string;
  readonly spoiler_level: 'NO_SPOILER' | 'LIGHT_SPOILER' | 'FULL_TRICK_ANALYSIS';
  readonly spoiler_policy_version: string;
  readonly spoiler_user_confirmation_required: number;
  readonly spoiler_warning_placement: 'NONE' | 'BODY_OPENING' | 'COVER_TITLE_AND_BODY_OPENING';
  readonly spoiler_warning_required: number;
  readonly work_id: string;
}

export interface TopicRankingComponentView {
  readonly knowledgeState: 'KNOWN' | 'UNKNOWN';
  readonly reasonCodes: readonly string[];
  readonly type: TopicRankingComponent;
  readonly valueBasisPoints: number | null;
}

export interface TopicPoolItem {
  readonly analysisMode: 'PERSONAL' | 'PUBLIC_RESEARCH';
  readonly candidateState: TopicCandidateState;
  readonly contentType: TopicContentType;
  readonly eligibility: TopicEligibilityState;
  readonly eligibilityReasonCodes: readonly string[];
  readonly fingerprint: string;
  readonly rankingComplete: boolean;
  readonly revision: number;
  readonly spoilerLevel: 'NO_SPOILER' | 'LIGHT_SPOILER' | 'FULL_TRICK_ANALYSIS';
  readonly stale: boolean;
  readonly topicAngle: string;
  readonly topicId: string;
  readonly totalScoreBasisPoints: number;
  readonly versionNumber: number;
}

export interface TopicPoolView {
  readonly counts: Readonly<Record<TopicContentType, number>>;
  readonly items: readonly TopicPoolItem[];
  readonly limit: number;
  readonly offset: number;
  readonly profileId: string;
  readonly total: number;
}

export interface TopicDetailView extends TopicPoolItem {
  readonly candidateJudgment: string | null;
  readonly centralQuestion: string;
  readonly comparisonDimension: string | null;
  readonly history: readonly {
    readonly action: string;
    readonly createdAt: string;
    readonly fromState: TopicCandidateState | null;
    readonly revision: number;
    readonly toState: TopicCandidateState;
  }[];
  readonly ranking: readonly TopicRankingComponentView[];
  readonly requiredPublicLabels: readonly string[];
  readonly spoilerPolicy: {
    readonly userConfirmationRequired: boolean;
    readonly warningPlacement: 'NONE' | 'BODY_OPENING' | 'COVER_TITLE_AND_BODY_OPENING';
    readonly warningRequired: boolean;
  };
  readonly subjects: readonly {
    readonly expressionForm: string | null;
    readonly role: string;
    readonly subjectId: string;
    readonly subjectType: string;
    readonly workId: string;
  }[];
}

export interface TopicGenerationRepositoryPreview {
  readonly counts: Readonly<Record<TopicContentType, number>>;
  readonly deduplicationLimit: number;
  readonly estimatedLocalWrites: number;
  readonly estimatedModelRequests: 0;
  readonly expectedPolicyVersions: TopicGenerationPlanResult['expectedPolicyVersions'];
  readonly expiresAt: string;
  readonly inputWorkCount: number;
  readonly localCombinationUpperBound: number;
  readonly modelExecutionState: 'UNCONFIGURED_DISABLED';
  readonly plan: TopicGenerationPlanResult;
  readonly planHash: string;
  readonly planId: string;
  readonly profileId: string;
}

export interface TopicGenerationExecutionResult {
  readonly createdCount: number;
  readonly duplicateCount: number;
  readonly executionId: string;
  readonly externalRequestCount: 0;
  readonly noOp: boolean;
  readonly planId: string;
  readonly replayed: boolean;
  readonly runId: string;
  readonly status: 'CONFIRMED' | 'SUCCEEDED' | 'NO_OP';
}

export interface TopicGenerationTerminalResult extends TopicGenerationExecutionResult {
  readonly status: 'SUCCEEDED' | 'NO_OP';
}

export interface TopicGenerationPreparationResult {
  readonly enqueue: boolean;
  readonly payload: TopicGenerationJobPayloadV1 | null;
  readonly run: TopicGenerationExecutionResult;
}

export interface TopicGenerationRunView {
  readonly createdAt: string;
  readonly externalRequestCount: 0;
  readonly resultCandidateCount: number;
  readonly revision: number;
  readonly runId: string;
  readonly status:
    | 'CONFIRMED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'NO_OP'
    | 'CANCEL_REQUESTED'
    | 'CANCELLED'
    | 'FAILED'
    | 'AMBIGUOUS';
  readonly updatedAt: string;
}

export interface TopicGenerationCancelPreview {
  readonly expectedRevision: number;
  readonly profileId: string;
  readonly runId: string;
  readonly statusBefore: 'CONFIRMED' | 'RUNNING' | 'CANCEL_REQUESTED';
}

export interface TopicStateActionPreview {
  readonly action: TopicStateAction;
  readonly after: TopicCandidateState;
  readonly before: TopicCandidateState;
  readonly expectedRevision: number;
  readonly kind: 'TOPIC_STATE';
  readonly policyVersion: typeof TOPIC_STATE_POLICY_VERSION;
  readonly topicId: string;
}

export interface TopicStateUndoPreview extends TopicStateActionPreview {
  readonly action: 'UNDO';
}

export interface TopicBatchStatePreview {
  readonly action: Exclude<TopicStateAction, 'UNDO'>;
  readonly items: readonly TopicStateActionPreview[];
  readonly kind: 'TOPIC_BATCH_STATE';
}

export interface TopicBatchApplyResult {
  readonly failed: number;
  readonly items: readonly {
    readonly errorCode: string | null;
    readonly ok: boolean;
    readonly revision: number | null;
    readonly topicId: string;
  }[];
  readonly succeeded: number;
}

export interface TopicQuotaRepositoryPreview {
  readonly currentPlanVersionId: string | null;
  readonly maxWorkExposure: number;
  readonly noOp: boolean;
  readonly profileId: string;
  readonly result: TopicQuotaPlanResult;
}

export interface TopicQuotaJobPreparationResult {
  readonly enqueue: boolean;
  readonly executionId: string;
  readonly payload: TopicQuotaPlanJobPayloadV1 | null;
  readonly planVersionId: string | null;
  readonly revision: number;
  readonly runId: string;
  readonly status: 'CONFIRMED' | 'RUNNING' | 'SUCCEEDED' | 'NO_OP' | 'CANCELLED' | 'FAILED';
}

export interface TopicQuotaPlanView {
  readonly categories: readonly TopicQuotaCategoryResult[];
  readonly createdAt: string;
  readonly members: readonly {
    readonly contentType: TopicContentType;
    readonly locked: boolean;
    readonly position: number;
    readonly scoreBasisPoints: number;
    readonly topicId: string;
  }[];
  readonly planVersionId: string;
  readonly poolSnapshotHash: string;
  readonly status: 'COMPLETE' | 'INCOMPLETE' | 'STALE' | 'SUPERSEDED';
  readonly totalRequired: number;
  readonly totalSelected: number;
  readonly versionNumber: number;
}

function identifier(value: string, maximum: number = TOPIC_LIMITS.identifierBytes): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.trim() !== value ||
    Buffer.byteLength(value, 'utf8') > maximum
  ) {
    throw new TopicError('TOPIC_INVALID_REQUEST');
  }
  return value;
}

function iso(value: string): string {
  if (!UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TopicError('TOPIC_INVALID_REQUEST');
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TopicError('TOPIC_INVALID_REQUEST');
  }
  return value;
}

function parseStringArray(value: unknown): readonly string[] {
  if (typeof value !== 'string') throw new TopicError('TOPIC_INVALID_CONTRACT');
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new TopicError('TOPIC_INVALID_CONTRACT');
  }
  return Object.freeze(parsed);
}

function asBoolean(value: unknown): boolean {
  return value === 1;
}

function addMinutes(value: string, minutes: number): string {
  return new Date(Date.parse(value) + minutes * 60_000).toISOString();
}

function errorCode(error: unknown): string {
  return error instanceof TopicError ? error.code : 'TOPIC_CONFLICT';
}

function workloadFor(contentType: TopicContentType): number {
  const units: Readonly<Record<TopicContentType, number>> = {
    CROSS_WORK_COMPARISON: 4,
    FULL_TRICK_LOGIC_ANALYSIS: 5,
    MYSTERY_AND_CULTURAL_PHENOMENON: 5,
    NON_SPOILER_SINGLE_BOOK_VERDICT: 2,
    WEB_VS_PUBLISHED_MYSTERY: 5,
  };
  return units[contentType];
}

export class SqliteTopicRepository {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public listPool(
    profileIdValue: string,
    input: {
      readonly contentType: TopicContentType | null;
      readonly eligibility: TopicEligibilityState | null;
      readonly limit: number;
      readonly offset: number;
      readonly query: string;
      readonly state: TopicCandidateState | null;
    },
  ): TopicPoolView {
    const profileId = identifier(profileIdValue);
    this.#requireProfile(profileId);
    const limit = boundedInteger(input.limit, 1, TOPIC_LIMITS.maxPageSize);
    const offset = boundedInteger(input.offset, 0, TOPIC_LIMITS.maxPageOffset);
    if (
      typeof input.query !== 'string' ||
      Buffer.byteLength(input.query, 'utf8') > 512 ||
      (input.contentType !== null && !TOPIC_CONTENT_TYPES.includes(input.contentType))
    ) {
      throw new TopicError('TOPIC_INVALID_REQUEST');
    }
    const filters: string[] = [
      "topic.topic_contract_version = 'topic-candidate-v1'",
      'topic.profile_id = ?',
      'version.version_number = topic.current_version_number',
    ];
    const values: (number | string)[] = [profileId];
    if (input.contentType !== null) {
      filters.push('version.content_type = ?');
      values.push(input.contentType);
    }
    if (input.eligibility !== null) {
      filters.push(
        `CASE WHEN EXISTS (
          SELECT 1 FROM topic_candidate_invalidations AS invalidation
          WHERE invalidation.version_id = version.id
        ) THEN 'STALE' ELSE version.eligibility_state END = ?`,
      );
      values.push(input.eligibility);
    }
    if (input.state !== null) {
      filters.push('topic.candidate_state = ?');
      values.push(input.state);
    }
    if (input.query.length > 0) {
      filters.push(
        "(version.topic_angle LIKE ? ESCAPE '\\' OR version.central_question LIKE ? ESCAPE '\\')",
      );
      const escaped = `%${input.query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      values.push(escaped, escaped);
    }
    const where = filters.join(' AND ');
    const totalRow = this.#database
      .prepare(
        `SELECT count(*) AS count
         FROM topics AS topic
         JOIN topic_candidate_versions AS version ON version.topic_id = topic.id
         WHERE ${where}`,
      )
      .get(...values) as { readonly count: number };
    const rows = this.#database
      .prepare(
        `SELECT
           topic.id AS topic_id,
           topic.candidate_state,
           topic.topic_revision,
           topic.semantic_fingerprint,
           version.*
         FROM topics AS topic
         JOIN topic_candidate_versions AS version ON version.topic_id = topic.id
         WHERE ${where}
         ORDER BY
           CASE topic.candidate_state WHEN 'LOCKED' THEN 0 ELSE 1 END,
           version.total_score_basis_points DESC,
           version.tie_break_key,
           topic.id
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as TopicVersionRow[];
    const items = rows.map((row) => this.#mapPoolItem(row));
    const counts = Object.fromEntries(
      TOPIC_CONTENT_TYPES.map((contentType) => {
        const row = this.#database
          .prepare(
            `SELECT count(*) AS count
             FROM topics AS topic
             JOIN topic_candidate_versions AS version
               ON version.topic_id = topic.id
              AND version.version_number = topic.current_version_number
             WHERE topic.topic_contract_version = 'topic-candidate-v1'
               AND topic.profile_id = ?
               AND version.content_type = ?`,
          )
          .get(profileId, contentType) as { readonly count: number };
        return [contentType, row.count] as const;
      }),
    ) as Record<TopicContentType, number>;
    return Object.freeze({
      counts: Object.freeze(counts),
      items: Object.freeze(items),
      limit,
      offset,
      profileId,
      total: totalRow.count,
    });
  }

  public getTopic(topicIdValue: string, historyLimitValue = 50): TopicDetailView {
    const topicId = identifier(topicIdValue);
    const historyLimit = boundedInteger(historyLimitValue, 1, TOPIC_LIMITS.maxHistoryPageSize);
    const row = this.#database
      .prepare(
        `SELECT
           topic.id AS topic_id,
           topic.candidate_state,
           topic.topic_revision,
           topic.semantic_fingerprint,
           version.*
         FROM topics AS topic
         JOIN topic_candidate_versions AS version
           ON version.topic_id = topic.id
          AND version.version_number = topic.current_version_number
         WHERE topic.id = ? AND topic.topic_contract_version = 'topic-candidate-v1'`,
      )
      .get(topicId) as TopicVersionRow | undefined;
    if (row === undefined) throw new TopicError('TOPIC_NOT_FOUND');
    const base = this.#mapPoolItem(row);
    const subjects = (
      this.#database
        .prepare(
          `SELECT subject_type, subject_id, work_id, role, expression_form
           FROM topic_subject_memberships
           WHERE version_id = ?
           ORDER BY ordinal`,
        )
        .all(row.id) as Row[]
    ).map((subject) =>
      Object.freeze({
        expressionForm: (subject.expression_form as string | null) ?? null,
        role: subject.role as string,
        subjectId: subject.subject_id as string,
        subjectType: subject.subject_type as string,
        workId: subject.work_id as string,
      }),
    );
    const ranking = this.#loadRankingComponents(row.id);
    const history = (
      this.#database
        .prepare(
          `SELECT revision, from_state, to_state, action, created_at
           FROM topic_state_transitions
           WHERE topic_id = ?
           ORDER BY revision DESC
           LIMIT ?`,
        )
        .all(topicId, historyLimit) as Row[]
    ).map((transition) =>
      Object.freeze({
        action: transition.action as string,
        createdAt: transition.created_at as string,
        fromState: (transition.from_state as TopicCandidateState | null) ?? null,
        revision: transition.revision as number,
        toState: transition.to_state as TopicCandidateState,
      }),
    );
    return Object.freeze({
      ...base,
      candidateJudgment: row.candidate_judgment,
      centralQuestion: row.central_question,
      comparisonDimension: row.comparison_dimension,
      history: Object.freeze(history),
      ranking: Object.freeze(ranking),
      requiredPublicLabels: parseStringArray(row.required_public_labels_json),
      spoilerPolicy: Object.freeze({
        userConfirmationRequired: asBoolean(row.spoiler_user_confirmation_required),
        warningPlacement: row.spoiler_warning_placement,
        warningRequired: asBoolean(row.spoiler_warning_required),
      }),
      subjects: Object.freeze(subjects),
    });
  }

  public previewGeneration(
    profileIdValue: string,
    nowValue: string,
  ): TopicGenerationRepositoryPreview {
    const profileId = identifier(profileIdValue);
    const now = iso(nowValue);
    this.#requireProfile(profileId);
    const works = this.#loadGenerationWorks(profileId);
    const plan = buildLocalTopicGenerationPlan(works);
    const inputHash = topicSemanticHash(
      works.map((work) => ({
        catalogRevision: work.catalogRevision,
        dossierVersionId: work.dossier.versionId,
        permissionSnapshotId: work.permission.snapshotId,
        workId: work.workId,
      })),
    );
    const existing = this.#database
      .prepare(
        `SELECT id
         FROM topic_generation_plans
         WHERE profile_id = ? AND plan_hash = ?`,
      )
      .get(profileId, plan.planHash) as { readonly id: string } | undefined;
    const planId = existing?.id ?? this.#id('topic-generation-plan');
    const expiresAt = addMinutes(now, 5);
    if (existing === undefined) {
      runInTransaction(this.#database, () => {
        this.#database
          .prepare(
            `INSERT INTO topic_generation_plans(
               id, profile_id, contract_version, plan_hash, input_hash,
               input_work_count, counts_json, expected_policy_versions_json,
               local_combination_upper_bound,
               deduplication_limit, estimated_local_writes, estimated_model_requests,
               budget_conclusion, model_execution_state, status, revision,
               created_at, expires_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
               'NOT_APPLICABLE', 'UNCONFIGURED_DISABLED', 'PREVIEWED', 1, ?, ?, ?)`,
          )
          .run(
            planId,
            profileId,
            TOPIC_GENERATION_PLAN_VERSION,
            plan.planHash,
            inputHash,
            plan.inputWorkCount,
            JSON.stringify(plan.counts),
            JSON.stringify(plan.expectedPolicyVersions),
            plan.localCombinationUpperBound,
            TOPIC_LIMITS.maxCandidatesPerGeneration,
            plan.estimatedLocalWrites,
            now,
            expiresAt,
            now,
          );
        for (const work of works) {
          this.#database
            .prepare(
              `INSERT INTO topic_generation_plan_inputs(
                 plan_id, work_id, catalog_revision, dossier_version_id,
                 permission_snapshot_id, created_at
               ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              planId,
              work.workId,
              work.catalogRevision,
              work.dossier.versionId,
              work.permission.snapshotId,
              now,
            );
        }
        this.#audit(
          'GENERATION_PREVIEWED',
          profileId,
          null,
          planId,
          null,
          {
            candidateCount: plan.candidates.length,
            externalRequests: 0,
            planHash: plan.planHash,
          },
          now,
        );
      });
    }
    return Object.freeze({
      counts: plan.counts,
      deduplicationLimit: plan.deduplicationLimit,
      estimatedLocalWrites: plan.estimatedLocalWrites,
      estimatedModelRequests: 0,
      expectedPolicyVersions: plan.expectedPolicyVersions,
      expiresAt,
      inputWorkCount: plan.inputWorkCount,
      localCombinationUpperBound: plan.localCombinationUpperBound,
      modelExecutionState: 'UNCONFIGURED_DISABLED',
      plan,
      planHash: plan.planHash,
      planId,
      profileId,
    });
  }

  public prepareGeneration(
    preview: TopicGenerationRepositoryPreview,
    executionIdValue: string,
    nowValue: string,
  ): TopicGenerationPreparationResult {
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    const currentPreview = this.previewGeneration(preview.profileId, now);
    if (
      currentPreview.planHash !== preview.planHash ||
      currentPreview.planId !== preview.planId ||
      currentPreview.plan.contractVersion !== TOPIC_GENERATION_PLAN_VERSION
    ) {
      throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    }
    const payload = assertTopicGenerationJobPayload({
      candidateCount: currentPreview.plan.candidates.length,
      contractVersion: TOPIC_GENERATION_JOB_CONTRACT_VERSION,
      executionId,
      expectedPolicyHash: topicSemanticHash(currentPreview.expectedPolicyVersions),
      inputWorkCount: currentPreview.inputWorkCount,
      planHash: currentPreview.planHash,
      planId: currentPreview.planId,
      profileId: currentPreview.profileId,
    });
    const existing = this.#database
      .prepare(
        `SELECT id, plan_id, job_id, status, result_candidate_count
         FROM topic_generation_runs
         WHERE execution_id = ?`,
      )
      .get(executionId) as
      | {
          readonly id: string;
          readonly job_id: string | null;
          readonly plan_id: string;
          readonly result_candidate_count: number;
          readonly status: string;
        }
      | undefined;
    if (existing !== undefined) {
      const terminal = existing.status === 'SUCCEEDED' || existing.status === 'NO_OP';
      return Object.freeze({
        enqueue: !terminal && existing.status === 'CONFIRMED' && existing.job_id === null,
        payload:
          !terminal && existing.status === 'CONFIRMED' && existing.job_id === null ? payload : null,
        run: Object.freeze({
          createdCount: existing.result_candidate_count,
          duplicateCount: 0,
          executionId,
          externalRequestCount: 0,
          noOp: existing.status === 'NO_OP',
          planId: existing.plan_id,
          replayed: true,
          runId: existing.id,
          status:
            existing.status === 'NO_OP'
              ? 'NO_OP'
              : existing.status === 'SUCCEEDED'
                ? 'SUCCEEDED'
                : 'CONFIRMED',
        }),
      });
    }

    const runId = this.#id('topic-generation-run');
    let inserted = false;
    runInTransaction(this.#database, () => {
      const planRow = this.#database
        .prepare(
          `SELECT id, status, revision
           FROM topic_generation_plans
           WHERE id = ? AND profile_id = ? AND plan_hash = ?`,
        )
        .get(preview.planId, preview.profileId, preview.planHash) as
        { readonly id: string; readonly revision: number; readonly status: string } | undefined;
      if (planRow === undefined) throw new TopicError('TOPIC_PLAN_NOT_FOUND');
      if (planRow.status === 'PREVIEWED') {
        this.#database
          .prepare(
            `UPDATE topic_generation_plans
             SET status = 'CONFIRMED', revision = revision + 1, updated_at = ?
             WHERE id = ? AND revision = ?`,
          )
          .run(now, planRow.id, planRow.revision);
      }
      const insert = this.#database
        .prepare(
          `INSERT OR IGNORE INTO topic_generation_runs(
             id, plan_id, execution_id, job_id, status,
             result_candidate_count, external_request_count, cost_state,
             error_code, revision, created_at, updated_at
           ) VALUES (?, ?, ?, NULL, 'CONFIRMED', 0, 0, 'NOT_INCURRED', NULL, 1, ?, ?)`,
        )
        .run(runId, preview.planId, executionId, now, now);
      inserted = insert.changes === 1;
    });
    const persisted = this.#database
      .prepare(
        `SELECT id, job_id, status
         FROM topic_generation_runs
         WHERE execution_id = ?`,
      )
      .get(executionId) as
      { readonly id: string; readonly job_id: string | null; readonly status: string } | undefined;
    if (persisted === undefined) throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    const enqueue = persisted.status === 'CONFIRMED' && persisted.job_id === null;
    return Object.freeze({
      enqueue,
      payload: enqueue ? payload : null,
      run: Object.freeze({
        createdCount: 0,
        duplicateCount: 0,
        executionId,
        externalRequestCount: 0,
        noOp: false,
        planId: preview.planId,
        replayed: !inserted,
        runId: persisted.id,
        status: 'CONFIRMED',
      }),
    });
  }

  public executeGenerationJob(
    payloadValue: TopicGenerationJobPayloadV1,
    nowValue: string,
    signal?: AbortSignal,
  ): TopicGenerationTerminalResult {
    const payload = assertTopicGenerationJobPayload(payloadValue);
    const now = iso(nowValue);
    const isAborted = (): boolean => signal?.aborted === true;
    if (isAborted()) {
      this.cancelGenerationExecution(payload.executionId, now);
      throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    }
    const run = this.#database
      .prepare(
        `SELECT id, plan_id, status, result_candidate_count
         FROM topic_generation_runs
         WHERE execution_id = ?`,
      )
      .get(payload.executionId) as
      | {
          readonly id: string;
          readonly plan_id: string;
          readonly result_candidate_count: number;
          readonly status: string;
        }
      | undefined;
    if (run === undefined || run.plan_id !== payload.planId) {
      throw new TopicError('TOPIC_PLAN_NOT_FOUND');
    }
    if (run.status === 'SUCCEEDED' || run.status === 'NO_OP') {
      return Object.freeze({
        createdCount: run.result_candidate_count,
        duplicateCount: 0,
        executionId: payload.executionId,
        externalRequestCount: 0,
        noOp: run.status === 'NO_OP',
        planId: run.plan_id,
        replayed: true,
        runId: run.id,
        status: run.status,
      });
    }
    if (run.status !== 'CONFIRMED') {
      throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    }
    const currentPreview = this.previewGeneration(payload.profileId, now);
    if (
      currentPreview.planId !== payload.planId ||
      currentPreview.planHash !== payload.planHash ||
      currentPreview.inputWorkCount !== payload.inputWorkCount ||
      currentPreview.plan.candidates.length !== payload.candidateCount ||
      topicSemanticHash(currentPreview.expectedPolicyVersions) !== payload.expectedPolicyHash
    ) {
      throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    }

    let createdCount = 0;
    let duplicateCount = 0;
    try {
      runInTransaction(this.#database, () => {
        const claim = this.#database
          .prepare(
            `UPDATE topic_generation_runs
             SET status = 'RUNNING', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status = 'CONFIRMED'`,
          )
          .run(now, run.id);
        if (claim.changes !== 1) {
          throw new TopicError('TOPIC_CONFLICT', { retryable: true });
        }
        const works = this.#loadGenerationWorks(payload.profileId);
        const workById = new Map(works.map((work) => [work.workId, work]));
        for (const candidate of currentPreview.plan.candidates) {
          if (isAborted()) {
            throw new TopicError('TOPIC_CONFLICT', { retryable: true });
          }
          const fingerprint = createTopicSemanticFingerprint({
            analysisMode: candidate.analysisMode,
            comparisonDimension: candidate.comparisonDimension,
            contentType: candidate.contentType,
            normalizedAngleIntent: candidate.topicAngle,
            spoilerLevel: candidate.spoilerLevel,
            subjectIds: candidate.subjects.map((subject) => subject.workId),
          }).fingerprint;
          const canonical = this.#database
            .prepare(
              `SELECT id, candidate_state
             FROM topics
             WHERE profile_id = ?
               AND semantic_fingerprint = ?
               AND topic_contract_version = 'topic-candidate-v1'
               AND canonical_topic_id IS NULL
             LIMIT 1`,
            )
            .get(payload.profileId, fingerprint) as
            { readonly candidate_state: TopicCandidateState; readonly id: string } | undefined;
          if (canonical !== undefined) {
            duplicateCount += 1;
            this.#audit(
              'DUPLICATE_LINKED',
              payload.profileId,
              canonical.id,
              payload.planId,
              null,
              {
                candidateState: canonical.candidate_state,
                fingerprint,
                result: 'EXISTING_CANONICAL_REUSED',
              },
              now,
            );
            continue;
          }
          const candidateWorks = [
            ...new Set(candidate.subjects.map((subject) => subject.workId)),
          ].map((workId) => {
            const work = workById.get(workId);
            if (work === undefined) throw new TopicError('TOPIC_SUBJECT_NOT_FOUND');
            return work;
          });
          this.#insertCandidate(payload.profileId, candidate, candidateWorks, now);
          createdCount += 1;
        }
        this.#database
          .prepare(
            `UPDATE topic_generation_runs
           SET status = ?, result_candidate_count = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'RUNNING'`,
          )
          .run(createdCount === 0 ? 'NO_OP' : 'SUCCEEDED', createdCount, now, run.id);
        const confirmedPlan = this.#database
          .prepare('SELECT status, revision FROM topic_generation_plans WHERE id = ?')
          .get(payload.planId) as { readonly revision: number; readonly status: string };
        if (confirmedPlan.status === 'CONFIRMED') {
          this.#database
            .prepare(
              `UPDATE topic_generation_plans
             SET status = 'CONSUMED', revision = revision + 1, updated_at = ?
             WHERE id = ? AND revision = ?`,
            )
            .run(now, payload.planId, confirmedPlan.revision);
        }
        this.#audit(
          'GENERATION_CONFIRMED',
          payload.profileId,
          null,
          payload.planId,
          null,
          {
            createdCount,
            duplicateCount,
            executionId: payload.executionId,
            externalRequests: 0,
          },
          now,
        );
      });
    } catch (error) {
      if (isAborted()) {
        this.cancelGenerationExecution(payload.executionId, now);
      }
      throw error;
    }
    return Object.freeze({
      createdCount,
      duplicateCount,
      executionId: payload.executionId,
      externalRequestCount: 0,
      noOp: createdCount === 0,
      planId: payload.planId,
      replayed: false,
      runId: run.id,
      status: createdCount === 0 ? 'NO_OP' : 'SUCCEEDED',
    });
  }

  public confirmGeneration(
    preview: TopicGenerationRepositoryPreview,
    executionIdValue: string,
    nowValue: string,
  ): TopicGenerationExecutionResult {
    const prepared = this.prepareGeneration(preview, executionIdValue, nowValue);
    return prepared.payload === null
      ? prepared.run
      : this.executeGenerationJob(prepared.payload, nowValue);
  }

  public markGenerationQueued(
    executionIdValue: string,
    jobIdValue: string,
    nowValue: string,
  ): TopicGenerationRunView {
    const executionId = identifier(executionIdValue);
    const jobId = identifier(jobIdValue);
    const now = iso(nowValue);
    const update = this.#database
      .prepare(
        `UPDATE topic_generation_runs
         SET job_id = ?, revision = revision + 1, updated_at = ?
         WHERE execution_id = ? AND status = 'CONFIRMED' AND job_id IS NULL`,
      )
      .run(jobId, now, executionId);
    if (update.changes !== 1) {
      const existing = this.#database
        .prepare('SELECT job_id FROM topic_generation_runs WHERE execution_id = ?')
        .get(executionId) as { readonly job_id: string | null } | undefined;
      if (existing?.job_id !== jobId) {
        throw new TopicError('TOPIC_CONFLICT', { retryable: true });
      }
    }
    const row = this.#database
      .prepare(
        `SELECT
           run.id, run.status, run.result_candidate_count,
           run.external_request_count, run.revision, run.created_at, run.updated_at
         FROM topic_generation_runs AS run
         WHERE run.execution_id = ?`,
      )
      .get(executionId) as Row | undefined;
    if (row === undefined) throw new TopicError('TOPIC_NOT_FOUND');
    return this.#mapGenerationRun(row);
  }

  public cancelGenerationExecution(
    executionIdValue: string,
    nowValue: string,
  ): Readonly<{ runId: string; status: 'CANCELLED' }> {
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    const row = this.#database
      .prepare('SELECT id, status FROM topic_generation_runs WHERE execution_id = ?')
      .get(executionId) as { readonly id: string; readonly status: string } | undefined;
    if (row === undefined) throw new TopicError('TOPIC_NOT_FOUND');
    if (row.status === 'CANCELLED') {
      return Object.freeze({ runId: row.id, status: 'CANCELLED' });
    }
    const update = this.#database
      .prepare(
        `UPDATE topic_generation_runs
         SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
         WHERE id = ? AND status IN ('CONFIRMED', 'RUNNING', 'CANCEL_REQUESTED')`,
      )
      .run(now, row.id);
    if (update.changes !== 1) throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    return Object.freeze({ runId: row.id, status: 'CANCELLED' });
  }

  public failGenerationExecution(
    executionIdValue: string,
    errorCodeValue: string,
    nowValue: string,
  ): void {
    const executionId = identifier(executionIdValue);
    const errorCodeValueSafe = identifier(errorCodeValue, 128);
    const now = iso(nowValue);
    this.#database
      .prepare(
        `UPDATE topic_generation_runs
         SET status = 'FAILED', error_code = ?, revision = revision + 1, updated_at = ?
         WHERE execution_id = ? AND status IN ('CONFIRMED', 'RUNNING', 'CANCEL_REQUESTED')`,
      )
      .run(errorCodeValueSafe, now, executionId);
  }

  public cancelGeneration(
    runIdValue: string,
    expectedRevisionValue: number,
    nowValue: string,
  ): Readonly<{ jobId: string | null; revision: number; runId: string; status: 'CANCELLED' }> {
    const runId = identifier(runIdValue);
    const expectedRevision = boundedInteger(expectedRevisionValue, 1, 2_147_483_647);
    const now = iso(nowValue);
    const result = this.#database
      .prepare(
        `UPDATE topic_generation_runs
         SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?
           AND status IN ('CONFIRMED', 'RUNNING', 'CANCEL_REQUESTED')`,
      )
      .run(now, runId, expectedRevision);
    if (result.changes !== 1) throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    const row = this.#database
      .prepare(
        `SELECT run.id, run.job_id, run.revision, plan.profile_id
         FROM topic_generation_runs AS run
         JOIN topic_generation_plans AS plan ON plan.id = run.plan_id
         WHERE run.id = ?`,
      )
      .get(runId) as {
      readonly id: string;
      readonly job_id: string | null;
      readonly profile_id: string;
      readonly revision: number;
    };
    this.#audit('RUN_CANCELLED', row.profile_id, null, null, null, { runId }, now);
    return Object.freeze({
      jobId: row.job_id,
      revision: row.revision,
      runId,
      status: 'CANCELLED',
    });
  }

  public previewCancelGeneration(
    runIdValue: string,
    expectedRevisionValue: number,
  ): TopicGenerationCancelPreview {
    const runId = identifier(runIdValue);
    const expectedRevision = boundedInteger(expectedRevisionValue, 1, 2_147_483_647);
    const row = this.#database
      .prepare(
        `SELECT run.revision, run.status, plan.profile_id
         FROM topic_generation_runs AS run
         JOIN topic_generation_plans AS plan ON plan.id = run.plan_id
         WHERE run.id = ?`,
      )
      .get(runId) as
      | { readonly profile_id: string; readonly revision: number; readonly status: string }
      | undefined;
    if (row === undefined) throw new TopicError('TOPIC_NOT_FOUND');
    if (
      row.revision !== expectedRevision ||
      !['CONFIRMED', 'RUNNING', 'CANCEL_REQUESTED'].includes(row.status)
    ) {
      throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    }
    return Object.freeze({
      expectedRevision,
      profileId: row.profile_id,
      runId,
      statusBefore: row.status as TopicGenerationCancelPreview['statusBefore'],
    });
  }

  public listGenerationRuns(
    profileIdValue: string,
    limitValue = 20,
  ): readonly TopicGenerationRunView[] {
    const profileId = identifier(profileIdValue);
    const limit = boundedInteger(limitValue, 1, TOPIC_LIMITS.maxHistoryPageSize);
    this.#requireProfile(profileId);
    return Object.freeze(
      (
        this.#database
          .prepare(
            `SELECT
               run.id, run.status, run.result_candidate_count,
               run.external_request_count, run.revision, run.created_at, run.updated_at
             FROM topic_generation_runs AS run
             JOIN topic_generation_plans AS plan ON plan.id = run.plan_id
             WHERE plan.profile_id = ?
             ORDER BY run.created_at DESC, run.id
             LIMIT ?`,
          )
          .all(profileId, limit) as Row[]
      ).map((run) => this.#mapGenerationRun(run)),
    );
  }

  public previewStateChange(rawDraft: unknown): TopicStateActionPreview {
    const draft = assertTopicStateChangeDraft(rawDraft);
    if (draft.action === 'UNDO') return this.previewUndo(draft.topicId, draft.expectedRevision);
    const root = this.#requireTopicRoot(draft.topicId);
    if (root.topic_revision !== draft.expectedRevision) {
      throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    }
    const transition = transitionTopicState(root.candidate_state, draft.action);
    return Object.freeze({
      action: draft.action,
      after: transition.to,
      before: transition.from,
      expectedRevision: draft.expectedRevision,
      kind: 'TOPIC_STATE',
      policyVersion: TOPIC_STATE_POLICY_VERSION,
      topicId: draft.topicId,
    });
  }

  public applyStateChange(preview: TopicStateActionPreview, nowValue: string): TopicDetailView {
    const now = iso(nowValue);
    runInTransaction(this.#database, () => {
      const root = this.#requireTopicRoot(preview.topicId);
      if (
        root.topic_revision !== preview.expectedRevision ||
        root.candidate_state !== preview.before
      ) {
        throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
      }
      const transition =
        preview.action === 'UNDO'
          ? transitionTopicState(root.candidate_state, 'UNDO', preview.after)
          : transitionTopicState(root.candidate_state, preview.action);
      if (transition.to !== preview.after) throw new TopicError('TOPIC_CONFLICT');
      const previous = this.#database
        .prepare(
          `SELECT id
           FROM topic_state_transitions
           WHERE topic_id = ?
           ORDER BY revision DESC
           LIMIT 1`,
        )
        .get(root.id) as { readonly id: string } | undefined;
      const nextRevision = root.topic_revision + 1;
      const update = this.#database
        .prepare(
          `UPDATE topics
           SET candidate_state = ?, topic_revision = ?, updated_at = ?
           WHERE id = ? AND topic_revision = ? AND candidate_state = ?`,
        )
        .run(transition.to, nextRevision, now, root.id, root.topic_revision, root.candidate_state);
      if (update.changes !== 1) {
        throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
      }
      this.#database
        .prepare(
          `INSERT INTO topic_state_transitions(
             id, topic_id, revision, previous_transition_id, from_state, to_state,
             action, expected_revision, actor, details_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USER', ?, ?)`,
        )
        .run(
          this.#id('topic-transition'),
          root.id,
          nextRevision,
          previous?.id ?? null,
          root.candidate_state,
          transition.to,
          preview.action,
          preview.expectedRevision,
          JSON.stringify({ policyVersion: TOPIC_STATE_POLICY_VERSION }),
          now,
        );
      this.#audit(
        preview.action === 'UNDO' ? 'STATE_UNDONE' : 'STATE_CHANGED',
        root.profile_id,
        root.id,
        null,
        null,
        {
          action: preview.action,
          after: transition.to,
          before: transition.from,
          revision: nextRevision,
        },
        now,
      );
    });
    return this.getTopic(preview.topicId);
  }

  public previewUndo(topicIdValue: string, expectedRevisionValue: number): TopicStateUndoPreview {
    const topicId = identifier(topicIdValue);
    const expectedRevision = boundedInteger(expectedRevisionValue, 2, 2_147_483_647);
    const root = this.#requireTopicRoot(topicId);
    if (root.topic_revision !== expectedRevision) {
      throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    }
    const last = this.#database
      .prepare(
        `SELECT from_state, to_state
         FROM topic_state_transitions
         WHERE topic_id = ? AND revision = ?`,
      )
      .get(topicId, expectedRevision) as
      | { readonly from_state: TopicCandidateState | null; readonly to_state: TopicCandidateState }
      | undefined;
    if (last?.from_state === null || last === undefined) {
      throw new TopicError('TOPIC_POLICY_BLOCKED');
    }
    transitionTopicState(root.candidate_state, 'UNDO', last.from_state);
    return Object.freeze({
      action: 'UNDO',
      after: last.from_state,
      before: last.to_state,
      expectedRevision,
      kind: 'TOPIC_STATE',
      policyVersion: TOPIC_STATE_POLICY_VERSION,
      topicId,
    });
  }

  public previewBatchState(rawDraft: unknown): TopicBatchStatePreview {
    const draft = assertTopicBatchStateChangeDraft(rawDraft);
    const items = draft.items.map((item) =>
      this.previewStateChange({
        action: draft.action,
        expectedRevision: item.expectedRevision,
        topicId: item.topicId,
      }),
    );
    return Object.freeze({
      action: draft.action,
      items: Object.freeze(items),
      kind: 'TOPIC_BATCH_STATE',
    });
  }

  public applyBatchState(preview: TopicBatchStatePreview, nowValue: string): TopicBatchApplyResult {
    const now = iso(nowValue);
    const items = preview.items.map((item) => {
      try {
        const detail = this.applyStateChange(item, now);
        return Object.freeze({
          errorCode: null,
          ok: true,
          revision: detail.revision,
          topicId: item.topicId,
        });
      } catch (error) {
        return Object.freeze({
          errorCode: errorCode(error),
          ok: false,
          revision: null,
          topicId: item.topicId,
        });
      }
    });
    const succeeded = items.filter((item) => item.ok).length;
    return Object.freeze({
      failed: items.length - succeeded,
      items: Object.freeze(items),
      succeeded,
    });
  }

  public previewQuotaPlan(
    profileIdValue: string,
    maxWorkExposureValue = 3,
  ): TopicQuotaRepositoryPreview {
    const profileId = identifier(profileIdValue);
    this.#requireProfile(profileId);
    const maxWorkExposure = boundedInteger(maxWorkExposureValue, 1, TOPIC_LIMITS.maxWorkExposure);
    const candidates = this.#loadQuotaCandidates(profileId);
    const result = solveFirst30Quota({ candidates, maxWorkExposure, profileId });
    const root = this.#database
      .prepare(
        `SELECT current_plan_version_id
         FROM topic_quota_plan_roots
         WHERE profile_id = ? AND quota_profile_id = ?`,
      )
      .get(profileId, FIRST_30_PROFILE_ID) as
      { readonly current_plan_version_id: string | null } | undefined;
    const currentPlanVersionId = root?.current_plan_version_id ?? null;
    let noOp = false;
    if (currentPlanVersionId !== null) {
      const current = this.#database
        .prepare(
          `SELECT pool_snapshot_hash,
             EXISTS (
               SELECT 1 FROM topic_quota_plan_events AS event
               WHERE event.plan_version_id = plan.id AND event.event_type = 'STALE'
             ) AS stale
           FROM topic_quota_plan_versions AS plan
           WHERE plan.id = ?`,
        )
        .get(currentPlanVersionId) as
        { readonly pool_snapshot_hash: string; readonly stale: number } | undefined;
      noOp =
        current !== undefined &&
        current.pool_snapshot_hash === result.poolSnapshotHash &&
        !asBoolean(current.stale);
    }
    return Object.freeze({
      currentPlanVersionId,
      maxWorkExposure,
      noOp,
      profileId,
      result,
    });
  }

  public prepareQuotaPlanJob(
    preview: TopicQuotaRepositoryPreview,
    executionIdValue: string,
    nowValue: string,
  ): TopicQuotaJobPreparationResult {
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    const current = this.previewQuotaPlan(preview.profileId, preview.maxWorkExposure);
    if (current.result.poolSnapshotHash !== preview.result.poolSnapshotHash) {
      throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    }
    const payload = assertTopicQuotaPlanJobPayload({
      contractVersion: TOPIC_QUOTA_JOB_CONTRACT_VERSION,
      executionId,
      maxWorkExposure: current.maxWorkExposure,
      poolSnapshotHash: current.result.poolSnapshotHash,
      profileId: current.profileId,
      quotaProfileId: FIRST_30_PROFILE_ID,
      totalCandidateCount: this.#loadQuotaCandidates(current.profileId).length,
    });
    type StoredQuotaRun = Readonly<{
      id: string;
      max_work_exposure: number;
      plan_version_id: string | null;
      pool_snapshot_hash: string;
      profile_id: string;
      quota_profile_id: string;
      revision: number;
      status: TopicQuotaJobPreparationResult['status'];
      total_candidate_count: number;
    }>;
    const loadExisting = (): StoredQuotaRun | undefined =>
      this.#database
        .prepare(
          `SELECT id, profile_id, quota_profile_id, pool_snapshot_hash,
             max_work_exposure, total_candidate_count, status, plan_version_id, revision
           FROM topic_quota_plan_runs
           WHERE execution_id = ?`,
        )
        .get(executionId) as StoredQuotaRun | undefined;
    const asPreparation = (stored: StoredQuotaRun): TopicQuotaJobPreparationResult => {
      if (
        stored.profile_id !== current.profileId ||
        stored.quota_profile_id !== FIRST_30_PROFILE_ID ||
        stored.pool_snapshot_hash !== current.result.poolSnapshotHash ||
        stored.max_work_exposure !== current.maxWorkExposure ||
        stored.total_candidate_count !== payload.totalCandidateCount
      ) {
        throw new TopicError('TOPIC_CONFLICT', { retryable: false });
      }
      const enqueue = stored.status === 'CONFIRMED' || stored.status === 'RUNNING';
      return Object.freeze({
        enqueue,
        executionId,
        payload: enqueue ? payload : null,
        planVersionId: stored.plan_version_id,
        revision: stored.revision,
        runId: stored.id,
        status: stored.status,
      });
    };
    const existing = loadExisting();
    if (existing !== undefined) return asPreparation(existing);
    const runId = this.#id('topic-quota-run');
    const inserted = this.#database
      .prepare(
        `INSERT INTO topic_quota_plan_runs(
           id, profile_id, quota_profile_id, execution_id, pool_snapshot_hash,
           max_work_exposure, total_candidate_count, status, plan_version_id,
           error_code, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', NULL, NULL, 1, ?, ?)
         ON CONFLICT(execution_id) DO NOTHING`,
      )
      .run(
        runId,
        current.profileId,
        FIRST_30_PROFILE_ID,
        executionId,
        current.result.poolSnapshotHash,
        current.maxWorkExposure,
        payload.totalCandidateCount,
        now,
        now,
      );
    if (inserted.changes === 0) {
      const raced = loadExisting();
      if (raced === undefined) throw new TopicError('TOPIC_CONFLICT', { retryable: true });
      return asPreparation(raced);
    }
    return Object.freeze({
      enqueue: true,
      executionId,
      payload,
      planVersionId: null,
      revision: 1,
      runId,
      status: 'CONFIRMED',
    });
  }

  public markQuotaPlanQueued(executionIdValue: string, jobIdValue: string, nowValue: string): void {
    const executionId = identifier(executionIdValue);
    const jobId = identifier(jobIdValue);
    const now = iso(nowValue);
    const updated = this.#database
      .prepare(
        `UPDATE topic_quota_plan_runs
         SET job_id = COALESCE(job_id, ?),
             revision = revision + CASE WHEN job_id IS NULL THEN 1 ELSE 0 END,
             updated_at = ?
         WHERE execution_id = ?
           AND status = 'CONFIRMED'
           AND (job_id IS NULL OR job_id = ?)`,
      )
      .run(jobId, now, executionId, jobId);
    if (updated.changes !== 1) throw new TopicError('TOPIC_CONFLICT', { retryable: true });
  }

  public cancelQuotaPlanExecution(executionIdValue: string, nowValue: string): void {
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    const cancelled = this.#database
      .prepare(
        `UPDATE topic_quota_plan_runs
         SET status = 'CANCELLED', error_code = NULL,
             revision = revision + 1, updated_at = ?
         WHERE execution_id = ? AND status IN ('CONFIRMED', 'RUNNING')`,
      )
      .run(now, executionId);
    if (cancelled.changes === 1) return;
    const current = this.#database
      .prepare('SELECT status FROM topic_quota_plan_runs WHERE execution_id = ?')
      .get(executionId) as { readonly status: string } | undefined;
    if (current?.status !== 'CANCELLED') {
      throw new TopicError(current === undefined ? 'TOPIC_PLAN_NOT_FOUND' : 'TOPIC_CONFLICT', {
        retryable: current !== undefined,
      });
    }
  }

  public failQuotaPlanExecution(
    executionIdValue: string,
    errorCodeValue: string,
    nowValue: string,
  ): void {
    const executionId = identifier(executionIdValue);
    const errorCode = identifier(errorCodeValue, 128);
    const now = iso(nowValue);
    const failed = this.#database
      .prepare(
        `UPDATE topic_quota_plan_runs
         SET status = 'FAILED', error_code = ?,
             revision = revision + 1, updated_at = ?
         WHERE execution_id = ? AND status IN ('CONFIRMED', 'RUNNING')`,
      )
      .run(errorCode, now, executionId);
    if (failed.changes !== 1) {
      throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    }
  }

  public executeQuotaPlanJob(
    payloadValue: TopicQuotaPlanJobPayloadV1,
    nowValue: string,
    signal?: AbortSignal,
  ): Readonly<{
    planVersionId: string;
    status: 'COMPLETE' | 'INCOMPLETE' | 'STALE' | 'SUPERSEDED';
    totalSelected: number;
  }> {
    const payload = assertTopicQuotaPlanJobPayload(payloadValue);
    const now = iso(nowValue);
    if (signal?.aborted === true) throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    const run = this.#database
      .prepare(
        `SELECT id, status, plan_version_id
         FROM topic_quota_plan_runs
         WHERE execution_id = ?`,
      )
      .get(payload.executionId) as
      | { readonly id: string; readonly plan_version_id: string | null; readonly status: string }
      | undefined;
    if (run === undefined) throw new TopicError('TOPIC_PLAN_NOT_FOUND');
    if ((run.status === 'SUCCEEDED' || run.status === 'NO_OP') && run.plan_version_id !== null) {
      const existingPlan = this.#getPlanVersion(run.plan_version_id);
      return Object.freeze({
        planVersionId: existingPlan.planVersionId,
        status: existingPlan.status,
        totalSelected: existingPlan.totalSelected,
      });
    }
    if (run.status !== 'CONFIRMED' && run.status !== 'RUNNING') {
      throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    }
    const preview = this.previewQuotaPlan(payload.profileId, payload.maxWorkExposure);
    if (
      preview.result.poolSnapshotHash !== payload.poolSnapshotHash ||
      this.#loadQuotaCandidates(payload.profileId).length !== payload.totalCandidateCount
    ) {
      throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    }
    if (run.status === 'CONFIRMED') {
      const claim = this.#database
        .prepare(
          `UPDATE topic_quota_plan_runs
           SET status = 'RUNNING', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'CONFIRMED'`,
        )
        .run(now, run.id);
      if (claim.changes !== 1) throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    }
    const plan = this.confirmQuotaPlan(preview, now);
    const finished = this.#database
      .prepare(
        `UPDATE topic_quota_plan_runs
         SET status = ?, plan_version_id = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(preview.noOp ? 'NO_OP' : 'SUCCEEDED', plan.planVersionId, now, run.id);
    if (finished.changes !== 1) throw new TopicError('TOPIC_CONFLICT', { retryable: true });
    return Object.freeze({
      planVersionId: plan.planVersionId,
      status: plan.status,
      totalSelected: plan.totalSelected,
    });
  }

  public confirmQuotaPlan(
    preview: TopicQuotaRepositoryPreview,
    nowValue: string,
  ): TopicQuotaPlanView {
    const now = iso(nowValue);
    const current = this.previewQuotaPlan(preview.profileId, preview.maxWorkExposure);
    if (current.result.poolSnapshotHash !== preview.result.poolSnapshotHash) {
      throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
    }
    if (current.noOp && current.currentPlanVersionId !== null) {
      this.#audit(
        'PLAN_NO_OP',
        preview.profileId,
        null,
        null,
        current.currentPlanVersionId,
        { poolSnapshotHash: current.result.poolSnapshotHash },
        now,
      );
      return this.#getPlanVersion(current.currentPlanVersionId);
    }

    const candidates = new Map(
      this.#loadQuotaCandidates(preview.profileId).map((candidate) => [
        candidate.topicId,
        candidate,
      ]),
    );
    let planVersionId = '';
    runInTransaction(this.#database, () => {
      let root = this.#database
        .prepare(
          `SELECT id, current_plan_version_id, revision
           FROM topic_quota_plan_roots
           WHERE profile_id = ? AND quota_profile_id = ?`,
        )
        .get(preview.profileId, FIRST_30_PROFILE_ID) as
        | {
            readonly current_plan_version_id: string | null;
            readonly id: string;
            readonly revision: number;
          }
        | undefined;
      if (root === undefined) {
        const rootId = this.#id('topic-quota-root');
        this.#database
          .prepare(
            `INSERT INTO topic_quota_plan_roots(
               id, profile_id, quota_profile_id, current_plan_version_id,
               revision, created_at, updated_at
             ) VALUES (?, ?, ?, NULL, 0, ?, ?)`,
          )
          .run(rootId, preview.profileId, FIRST_30_PROFILE_ID, now, now);
        root = Object.freeze({ current_plan_version_id: null, id: rootId, revision: 0 });
      }
      const previousId = root.current_plan_version_id;
      const versionNumber = root.revision + 1;
      planVersionId = this.#id('topic-quota-plan');
      if (previousId !== null) {
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO topic_quota_plan_events(
               id, plan_version_id, event_type, reason_code,
               dependency_type, dependency_id, event_identity, created_at
             ) VALUES (?, ?, 'SUPERSEDED', 'USER_REBUILT_PLAN',
               NULL, NULL, ?, ?)`,
          )
          .run(
            this.#id('topic-quota-event'),
            previousId,
            `PLAN_SUPERSEDED:${previousId}:${planVersionId}`,
            now,
          );
      }
      this.#database
        .prepare(
          `INSERT INTO topic_quota_plan_versions(
             id, root_id, version_number, previous_version_id, quota_profile_id,
             pool_snapshot_hash, ranking_policy_version, solver_version,
             status, total_selected, total_required,
             estimated_cost_state, estimated_cost_microusd,
             workload_state, workload_units, reason_codes_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 30, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          planVersionId,
          root.id,
          versionNumber,
          previousId,
          FIRST_30_PROFILE_ID,
          current.result.poolSnapshotHash,
          TOPIC_RANKING_POLICY_VERSION,
          TOPIC_QUOTA_SOLVER_VERSION,
          current.result.status,
          current.result.totalSelected,
          current.result.estimatedExternalCost.state,
          current.result.estimatedExternalCost.valueMicrousd,
          current.result.workload.state,
          current.result.workload.units,
          JSON.stringify(current.result.warnings),
          now,
        );
      for (const contentType of TOPIC_CONTENT_TYPES) {
        const category = current.result.categories[contentType];
        this.#database
          .prepare(
            `INSERT INTO topic_quota_plan_categories(
               plan_version_id, content_type, selected_count, required_count,
               shortfall_count, locked_eligible_count, held_count, archived_count,
               conflicts_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            planVersionId,
            contentType,
            category.selected,
            category.required,
            category.shortfall,
            category.lockedEligibleCount,
            category.heldCount,
            category.archivedCount,
            JSON.stringify(category.conflicts),
            now,
          );
      }
      for (const member of current.result.members) {
        const candidate = candidates.get(member.topicId);
        if (
          candidate === undefined ||
          candidate.topicVersionId !== member.topicVersionId ||
          candidate.eligibility !== 'ELIGIBLE'
        ) {
          throw new TopicError('TOPIC_STALE_REVISION', { retryable: true });
        }
        this.#database
          .prepare(
            `INSERT INTO topic_quota_plan_members(
               plan_version_id, content_type, position, topic_id, topic_version_id,
               semantic_fingerprint, eligibility_state, total_score_basis_points,
               locked, selection_reason_codes_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, 'ELIGIBLE', ?, ?, ?, ?)`,
          )
          .run(
            planVersionId,
            member.contentType,
            member.position,
            member.topicId,
            member.topicVersionId,
            member.fingerprint,
            member.scoreBasisPoints,
            member.locked ? 1 : 0,
            JSON.stringify(member.reasonCodes),
            now,
          );
        for (const componentType of TOPIC_RANKING_COMPONENTS) {
          const component = candidate.ranking.components[componentType];
          this.#database
            .prepare(
              `INSERT INTO topic_quota_plan_member_scores(
                 plan_version_id, topic_id, component_type, knowledge_state,
                 value_basis_points, reason_codes_json, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              planVersionId,
              member.topicId,
              componentType,
              component.knowledgeState,
              component.valueBasisPoints,
              JSON.stringify(component.reasonCodes),
              now,
            );
        }
      }
      this.#database
        .prepare(
          `UPDATE topic_quota_plan_roots
           SET current_plan_version_id = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(planVersionId, now, root.id, root.revision);
      this.#database
        .prepare(
          `INSERT INTO topic_quota_plan_events(
             id, plan_version_id, event_type, reason_code,
             dependency_type, dependency_id, event_identity, created_at
           ) VALUES (?, ?, 'PUBLISHED', 'USER_CONFIRMED_PLAN',
             NULL, NULL, ?, ?)`,
        )
        .run(this.#id('topic-quota-event'), planVersionId, `PLAN_PUBLISHED:${planVersionId}`, now);
      this.#audit(
        'PLAN_PUBLISHED',
        preview.profileId,
        null,
        null,
        planVersionId,
        {
          poolSnapshotHash: current.result.poolSnapshotHash,
          status: current.result.status,
          totalSelected: current.result.totalSelected,
        },
        now,
      );
    });
    return this.#getPlanVersion(planVersionId);
  }

  public getCurrentQuotaPlan(profileIdValue: string): TopicQuotaPlanView | null {
    const profileId = identifier(profileIdValue);
    this.#requireProfile(profileId);
    const row = this.#database
      .prepare(
        `SELECT current_plan_version_id
         FROM topic_quota_plan_roots
         WHERE profile_id = ? AND quota_profile_id = ?`,
      )
      .get(profileId, FIRST_30_PROFILE_ID) as
      { readonly current_plan_version_id: string | null } | undefined;
    return row?.current_plan_version_id === null || row === undefined
      ? null
      : this.#getPlanVersion(row.current_plan_version_id);
  }

  public listQuotaPlanHistory(
    profileIdValue: string,
    limitValue = 20,
  ): readonly TopicQuotaPlanView[] {
    const profileId = identifier(profileIdValue);
    const limit = boundedInteger(limitValue, 1, TOPIC_LIMITS.maxHistoryPageSize);
    this.#requireProfile(profileId);
    const rows = this.#database
      .prepare(
        `SELECT version.id
         FROM topic_quota_plan_roots AS root
         JOIN topic_quota_plan_versions AS version ON version.root_id = root.id
         WHERE root.profile_id = ? AND root.quota_profile_id = ?
         ORDER BY version.version_number DESC
         LIMIT ?`,
      )
      .all(profileId, FIRST_30_PROFILE_ID, limit) as { readonly id: string }[];
    return Object.freeze(rows.map((row) => this.#getPlanVersion(row.id)));
  }

  #loadGenerationWorks(profileId: string): readonly TopicGenerationWorkInput[] {
    const rows = this.#database
      .prepare(
        `SELECT
           book.id AS work_id,
           book.catalog_revision AS book_revision,
           dossier.id AS dossier_id,
           dossier.readiness AS dossier_readiness,
           version.id AS dossier_version_id,
           version.coverage_policy_version,
           version.fact_policy_version,
           coverage.overall_basis_points AS coverage_basis_points,
           coverage.gap_count,
           coverage.blocked_count,
           snapshot.id AS permission_snapshot_id,
           snapshot.snapshot_version AS permission_snapshot_version,
           snapshot.authenticity_policy_version,
           snapshot.spoiler_policy_version,
           snapshot.personal_content_mode,
           snapshot.research_content_mode AS public_research_content_mode,
           snapshot.spoiler_level,
           snapshot.spoiler_warning_required,
           snapshot.spoiler_warning_placement,
           snapshot.spoiler_user_confirmation_required,
           snapshot.blocking_reason_codes_json
         FROM books AS book
         JOIN research_dossiers AS dossier
           ON dossier.subject_type = 'WORK'
          AND dossier.subject_id = book.id
          AND dossier.book_id = book.id
         JOIN research_dossier_versions AS version
           ON version.id = dossier.current_version_id
          AND version.dossier_id = dossier.id
         JOIN research_dossier_coverage_snapshots AS coverage
           ON coverage.version_id = version.id
         JOIN reading_states AS reading
           ON reading.profile_id = ?
          AND reading.book_id = book.id
         JOIN expression_permission_snapshots AS snapshot
           ON snapshot.id = reading.current_snapshot_id
          AND snapshot.reading_state_id = reading.id
         WHERE book.catalog_state = 'ACTIVE'
           AND dossier.state = 'CURRENT'
           AND dossier.readiness = 'READY_FOR_CONTENT_BRIEF'
           AND version.readiness = 'READY_FOR_CONTENT_BRIEF'
           AND snapshot.snapshot_version = ?
           AND snapshot.authenticity_policy_version = ?
           AND snapshot.spoiler_policy_version = ?
           AND NOT EXISTS (
             SELECT 1
             FROM research_dossier_invalidations AS invalidation
             WHERE invalidation.dossier_id = dossier.id
               AND invalidation.current_version_id = version.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM expression_permission_invalidations AS invalidation
             WHERE invalidation.snapshot_id = snapshot.id
           )
         ORDER BY book.id
         LIMIT ?`,
      )
      .all(
        profileId,
        EXPRESSION_PERMISSION_VERSION,
        AUTHENTICITY_POLICY_VERSION,
        SPOILER_POLICY_VERSION,
        TOPIC_LIMITS.maxCandidatesPerGeneration,
      ) as (GenerationInputRow & { readonly blocking_reason_codes_json: string })[];
    const workIds = new Set(rows.map((row) => row.work_id));
    if (workIds.size === 0) return Object.freeze([]);

    const expressions = this.#database
      .prepare(
        `SELECT
           expression.id AS expression_id,
           expression.work_id,
           expression.revision,
           CASE
             WHEN expression.expression_kind = 'SERIALIZED' THEN 'WEB_SERIALIZED'
             WHEN EXISTS (
               SELECT 1 FROM book_editions AS edition
               WHERE edition.expression_id = expression.id
                 AND edition.catalog_state = 'ACTIVE'
             ) THEN 'PUBLISHED_EDITION'
             ELSE 'OTHER_VERIFIED'
           END AS expression_form
         FROM expressions AS expression
         JOIN reading_states AS reading
           ON reading.profile_id = ? AND reading.book_id = expression.work_id
         JOIN research_dossiers AS dossier
           ON dossier.subject_type = 'WORK'
          AND dossier.subject_id = expression.work_id
          AND dossier.readiness = 'READY_FOR_CONTENT_BRIEF'
         WHERE expression.catalog_state = 'ACTIVE'
           AND expression.work_id IN (SELECT value FROM json_each(?))
         ORDER BY expression.work_id, expression.id
         LIMIT ?`,
      )
      .all(
        profileId,
        JSON.stringify([...workIds]),
        TOPIC_LIMITS.maxCandidatesPerGeneration * TOPIC_LIMITS.maxSubjects,
      ) as Row[];
    const expressionsByWork = new Map<
      string,
      {
        readonly catalogRevision: number;
        readonly expressionForm: 'WEB_SERIALIZED' | 'PUBLISHED_EDITION' | 'OTHER_VERIFIED';
        readonly expressionId: string;
      }[]
    >();
    for (const expression of expressions) {
      const workId = expression.work_id as string;
      if (!workIds.has(workId)) continue;
      const values = expressionsByWork.get(workId) ?? [];
      values.push(
        Object.freeze({
          catalogRevision: expression.revision as number,
          expressionForm: expression.expression_form as
            'WEB_SERIALIZED' | 'PUBLISHED_EDITION' | 'OTHER_VERIFIED',
          expressionId: expression.expression_id as string,
        }),
      );
      expressionsByWork.set(workId, values);
    }

    const contextRows = this.#database
      .prepare(
        `SELECT DISTINCT
           dossier.book_id AS work_id,
           claim.id AS claim_id,
           entry.fact_status,
           CASE
             WHEN entry.section_key IN ('RECEPTION_AND_DISCUSSION', 'SYNOPSIS_AND_THEMES')
               AND entry.entry_kind = 'CONSENSUS'
             THEN 0 ELSE 1
           END AS context_only
         FROM research_dossiers AS dossier
         JOIN research_dossier_versions AS version
           ON version.id = dossier.current_version_id
         JOIN research_dossier_entries AS entry
           ON entry.version_id = version.id
         JOIN research_dossier_entry_claims AS link
           ON link.entry_id = entry.id
         JOIN claims AS claim ON claim.id = link.claim_id
         WHERE dossier.subject_type = 'WORK'
           AND dossier.readiness = 'READY_FOR_CONTENT_BRIEF'
           AND dossier.book_id IN (SELECT value FROM json_each(?))
           AND entry.section_key IN ('RECEPTION_AND_DISCUSSION', 'SYNOPSIS_AND_THEMES')
           AND entry.fact_status IN ('VERIFIED', 'SUPPORTED_NOT_VERIFIED')
         ORDER BY dossier.book_id, claim.id
         LIMIT ?`,
      )
      .all(
        JSON.stringify([...workIds]),
        TOPIC_LIMITS.maxCandidatesPerGeneration * TOPIC_LIMITS.contextClaims,
      ) as Row[];
    const contextByWork = new Map<
      string,
      {
        readonly claimId: string;
        readonly contextOnly: boolean;
        readonly factStatus: 'VERIFIED' | 'SUPPORTED_NOT_VERIFIED';
        readonly workId: string;
      }[]
    >();
    for (const context of contextRows) {
      const workId = context.work_id as string;
      if (!workIds.has(workId)) continue;
      const values = contextByWork.get(workId) ?? [];
      if (values.length < TOPIC_LIMITS.contextClaims) {
        values.push(
          Object.freeze({
            claimId: context.claim_id as string,
            contextOnly: asBoolean(context.context_only),
            factStatus: context.fact_status as 'VERIFIED' | 'SUPPORTED_NOT_VERIFIED',
            workId,
          }),
        );
      }
      contextByWork.set(workId, values);
    }

    return Object.freeze(
      rows.map((row) => {
        const blocking = parseStringArray(row.blocking_reason_codes_json);
        const spoilerSatisfied = !blocking.some(
          (reason) =>
            reason === 'SPOILER_WARNING_REQUIRED' ||
            reason === 'SPOILER_USER_CONFIRMATION_REQUIRED',
        );
        return Object.freeze({
          catalogRevision: row.book_revision,
          contextClaims: Object.freeze(contextByWork.get(row.work_id) ?? []),
          dossier: Object.freeze({
            blockedCount: row.blocked_count,
            coreFactBlocked: false,
            coverageBasisPoints: row.coverage_basis_points,
            coveragePolicyVersion: row.coverage_policy_version,
            dossierId: row.dossier_id,
            factPolicyVersion: row.fact_policy_version,
            gapCount: row.gap_count,
            readiness: 'READY_FOR_CONTENT_BRIEF' as const,
            stale: false,
            versionId: row.dossier_version_id,
            workId: row.work_id,
          }),
          expressions: Object.freeze(expressionsByWork.get(row.work_id) ?? []),
          permission: Object.freeze({
            authenticityPolicyVersion: row.authenticity_policy_version,
            personalContentMode: row.personal_content_mode as
              | 'ALLOWED'
              | 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY'
              | 'RESEARCH_ONLY'
              | 'BLOCKED'
              | 'STALE_REVIEW_REQUIRED',
            publicResearchContentMode: row.public_research_content_mode as
              | 'ALLOWED'
              | 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY'
              | 'RESEARCH_ONLY'
              | 'BLOCKED'
              | 'STALE_REVIEW_REQUIRED',
            snapshotId: row.permission_snapshot_id,
            snapshotVersion: row.permission_snapshot_version,
            spoiler: Object.freeze({
              level: row.spoiler_level,
              satisfied: spoilerSatisfied,
              userConfirmationRequired: asBoolean(row.spoiler_user_confirmation_required),
              warningPlacement: row.spoiler_warning_placement,
              warningRequired: asBoolean(row.spoiler_warning_required),
            }),
            spoilerPolicyVersion: row.spoiler_policy_version,
            stale: false,
            workId: row.work_id,
          }),
          workId: row.work_id,
        });
      }),
    );
  }

  #insertCandidate(
    profileId: string,
    candidate: TopicCandidateDraft,
    works: readonly TopicGenerationWorkInput[],
    now: string,
  ): void {
    const fingerprint = createTopicSemanticFingerprint({
      analysisMode: candidate.analysisMode,
      comparisonDimension: candidate.comparisonDimension,
      contentType: candidate.contentType,
      normalizedAngleIntent: candidate.topicAngle,
      spoilerLevel: candidate.spoilerLevel,
      subjectIds: candidate.subjects.map((subject) => subject.workId),
    }).fingerprint;
    const dossiers = works.map((work) => work.dossier);
    const permissions = works.map((work) => work.permission);
    const contextClaims = works.flatMap((work) => work.contextClaims);
    const eligibility = evaluateTopicEligibility({
      allSubjectsCurrent: true,
      candidate,
      contextClaims,
      dossiers,
      existingFingerprint: null,
      permissions,
      requestedState: 'PROPOSED',
    });
    const sameSubjectTopicCount = (
      this.#database
        .prepare(
          `SELECT count(DISTINCT other.id) AS count
           FROM topics AS other
           JOIN topic_candidate_versions AS other_version
             ON other_version.topic_id = other.id
            AND other_version.version_number = other.current_version_number
           JOIN topic_subject_memberships AS other_subject
             ON other_subject.version_id = other_version.id
           WHERE other.profile_id = ?
             AND other.topic_contract_version = 'topic-candidate-v1'
             AND other_version.content_type = ?
             AND other_subject.work_id IN (
               SELECT value FROM json_each(?)
             )`,
        )
        .get(
          profileId,
          candidate.contentType,
          JSON.stringify([...new Set(candidate.subjects.map((subject) => subject.workId))]),
        ) as { readonly count: number }
    ).count;
    const dependencyKeys = [
      ...candidate.subjects.map(
        (subject) =>
          `CATALOG_SUBJECT:${subject.subjectType}:${subject.subjectId}:${subject.catalogRevision}`,
      ),
      ...dossiers.map(
        (dossier) =>
          `DOSSIER_VERSION:${dossier.versionId}:${dossier.readiness}:${dossier.coverageBasisPoints}`,
      ),
      ...permissions.map(
        (permission) =>
          `EXPRESSION_PERMISSION:${permission.snapshotId}:${permission.snapshotVersion}`,
      ),
      ...candidate.contextClaimIds.map((claimId) => `CONTEXT_CLAIM:${claimId}`),
      `TOPIC_POLICY:${TOPIC_ELIGIBILITY_POLICY_VERSION}`,
    ].sort();
    const ranking = evaluateTopicRanking({
      approvalWorkloadUnits: workloadFor(candidate.contentType),
      candidate,
      dependencyKeys,
      dossiers,
      eligibility: eligibility.state,
      estimatedExternalCostMicrousd: 0,
      sameSubjectTopicCount,
    });
    const topicId = this.#id('topic');
    const versionId = this.#id('topic-version');
    const firstSubject = candidate.subjects[0];
    if (firstSubject === undefined) throw new TopicError('TOPIC_INVALID_CONTRACT');
    const primaryWorkId =
      candidate.subjects.find((subject) => subject.role === 'PRIMARY')?.workId ??
      firstSubject.workId;
    const legacySpoiler =
      candidate.spoilerLevel === 'NO_SPOILER'
        ? 'NONE'
        : candidate.spoilerLevel === 'LIGHT_SPOILER'
          ? 'LIGHT'
          : 'FULL';
    this.#database
      .prepare(
        `INSERT INTO topics(
           id, book_id, topic_type, angle, core_judgment, audience,
           spoiler_level, trend_score, fit_score, evidence_score,
           novelty_score, effort_score, priority_score, status,
           topic_contract_version, profile_id, semantic_fingerprint,
           canonical_topic_id, candidate_state, current_version_number,
           topic_revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'MYSTERY_READERS', ?,
           NULL, NULL, NULL, NULL, NULL, NULL, 'IDEA',
           ?, ?, ?, NULL, 'PROPOSED', NULL, 1, ?, ?)`,
      )
      .run(
        topicId,
        primaryWorkId,
        candidate.contentType,
        candidate.topicAngle,
        candidate.candidateJudgment ?? candidate.centralQuestion,
        legacySpoiler,
        TOPIC_CANDIDATE_CONTRACT_VERSION,
        profileId,
        fingerprint,
        now,
        now,
      );
    this.#database
      .prepare(
        `INSERT INTO topic_candidate_versions(
           id, topic_id, version_number, previous_version_id, schema_version,
           content_type, topic_angle, central_question, candidate_judgment,
           analysis_mode, spoiler_level, spoiler_warning_required, spoiler_warning_placement,
           spoiler_user_confirmation_required, comparison_dimension,
           required_public_labels_json, semantic_fingerprint, fingerprint_policy_version,
           eligibility_state, eligibility_reason_codes_json, eligibility_policy_version,
           ranking_policy_version, total_score_basis_points, ranking_complete, tie_break_key,
           dependency_hash, input_hash, estimated_external_cost_microusd, cost_state,
           approval_workload_units, workload_state, provenance, created_at
         ) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           0, 'KNOWN', ?, 'KNOWN', ?, ?)`,
      )
      .run(
        versionId,
        topicId,
        TOPIC_CANDIDATE_CONTRACT_VERSION,
        candidate.contentType,
        candidate.topicAngle,
        candidate.centralQuestion,
        candidate.candidateJudgment,
        candidate.analysisMode,
        candidate.spoilerLevel,
        candidate.spoilerPolicy.warningRequired ? 1 : 0,
        candidate.spoilerPolicy.warningPlacement,
        candidate.spoilerPolicy.userConfirmationRequired ? 1 : 0,
        candidate.comparisonDimension,
        JSON.stringify(candidate.requiredPublicLabels),
        fingerprint,
        TOPIC_FINGERPRINT_POLICY_VERSION,
        eligibility.state,
        JSON.stringify(eligibility.reasonCodes),
        TOPIC_ELIGIBILITY_POLICY_VERSION,
        TOPIC_RANKING_POLICY_VERSION,
        ranking.totalBasisPoints,
        ranking.complete ? 1 : 0,
        ranking.tieBreakKey,
        eligibility.dependencyHash,
        topicSemanticHash({ candidate, eligibility, ranking }),
        workloadFor(candidate.contentType),
        candidate.provenance,
        now,
      );
    this.#insertCandidateChildren(versionId, candidate, works, ranking, now);
    this.#database
      .prepare(
        `UPDATE topics
         SET current_version_number = 1, updated_at = ?
         WHERE id = ? AND current_version_number IS NULL`,
      )
      .run(now, topicId);
    this.#database
      .prepare(
        `INSERT INTO topic_state_transitions(
           id, topic_id, revision, previous_transition_id, from_state, to_state,
           action, expected_revision, actor, details_json, created_at
         ) VALUES (?, ?, 1, NULL, NULL, 'PROPOSED', 'CREATE', 0,
           'LOCAL_SYSTEM', ?, ?)`,
      )
      .run(
        this.#id('topic-transition'),
        topicId,
        JSON.stringify({ generation: 'LOCAL_DETERMINISTIC', policy: TOPIC_STATE_POLICY_VERSION }),
        now,
      );
    this.#audit(
      'CANDIDATE_CREATED',
      profileId,
      topicId,
      null,
      null,
      {
        contentType: candidate.contentType,
        eligibility: eligibility.state,
        fingerprint,
      },
      now,
    );
  }

  #insertCandidateChildren(
    versionId: string,
    candidate: TopicCandidateDraft,
    works: readonly TopicGenerationWorkInput[],
    ranking: TopicRankingResult,
    now: string,
  ): void {
    for (const [ordinal, subject] of candidate.subjects.entries()) {
      this.#database
        .prepare(
          `INSERT INTO topic_subject_memberships(
             version_id, ordinal, subject_type, subject_id, work_id,
             expression_id, edition_id, role, expression_form,
             catalog_revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          ordinal,
          subject.subjectType,
          subject.subjectId,
          subject.workId,
          subject.expressionId,
          subject.editionId,
          subject.role,
          subject.expressionForm,
          subject.catalogRevision,
          now,
        );
    }
    const contextById = new Map(
      works.flatMap((work) => work.contextClaims).map((claim) => [claim.claimId, claim]),
    );
    for (const claimId of candidate.contextClaimIds) {
      const claim = contextById.get(claimId);
      if (claim === undefined) throw new TopicError('TOPIC_POLICY_BLOCKED');
      this.#database
        .prepare(
          `INSERT INTO topic_context_claims(
             version_id, claim_id, work_id, fact_status, context_only, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          claim.claimId,
          claim.workId,
          claim.factStatus,
          claim.contextOnly ? 1 : 0,
          now,
        );
    }
    for (const componentType of TOPIC_RANKING_COMPONENTS) {
      const component = ranking.components[componentType];
      this.#database
        .prepare(
          `INSERT INTO topic_ranking_components(
             version_id, component_type, knowledge_state, value_basis_points,
             reason_codes_json, input_dependencies_json, policy_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          componentType,
          component.knowledgeState,
          component.valueBasisPoints,
          JSON.stringify(component.reasonCodes),
          JSON.stringify(component.dependencyKeys),
          TOPIC_RANKING_POLICY_VERSION,
          now,
        );
    }

    const dependencies: {
      readonly id: string;
      readonly observed: string;
      readonly type:
        | 'CATALOG_SUBJECT'
        | 'DOSSIER_VERSION'
        | 'DOSSIER_READINESS'
        | 'EXPRESSION_PERMISSION'
        | 'AUTHENTICITY_POLICY'
        | 'SPOILER_POLICY'
        | 'FACT_POLICY'
        | 'CONTEXT_CLAIM'
        | 'TOPIC_POLICY';
    }[] = [];
    for (const subject of candidate.subjects) {
      dependencies.push({
        id: `${subject.subjectType}:${subject.subjectId}`,
        observed: String(subject.catalogRevision),
        type: 'CATALOG_SUBJECT',
      });
    }
    for (const work of works) {
      dependencies.push(
        {
          id: work.dossier.versionId,
          observed: work.dossier.coveragePolicyVersion,
          type: 'DOSSIER_VERSION',
        },
        {
          id: work.dossier.dossierId,
          observed: work.dossier.readiness,
          type: 'DOSSIER_READINESS',
        },
        {
          id: work.permission.snapshotId,
          observed: work.permission.snapshotVersion,
          type: 'EXPRESSION_PERMISSION',
        },
        {
          id: work.dossier.dossierId,
          observed: work.dossier.factPolicyVersion,
          type: 'FACT_POLICY',
        },
      );
    }
    dependencies.push(
      {
        id: 'reading-authenticity',
        observed: AUTHENTICITY_POLICY_VERSION,
        type: 'AUTHENTICITY_POLICY',
      },
      {
        id: 'spoiler',
        observed: SPOILER_POLICY_VERSION,
        type: 'SPOILER_POLICY',
      },
      {
        id: 'topic-eligibility',
        observed: TOPIC_ELIGIBILITY_POLICY_VERSION,
        type: 'TOPIC_POLICY',
      },
    );
    for (const claimId of candidate.contextClaimIds) {
      dependencies.push({ id: claimId, observed: 'CURRENT', type: 'CONTEXT_CLAIM' });
    }
    const unique = new Map(
      dependencies.map((dependency) => [
        `${dependency.type}:${dependency.id}:${dependency.observed}`,
        dependency,
      ]),
    );
    for (const dependency of unique.values()) {
      const key = topicSemanticHash(dependency);
      this.#database
        .prepare(
          `INSERT INTO topic_dependencies(
             version_id, dependency_type, dependency_id,
             observed_revision, dependency_key, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(versionId, dependency.type, dependency.id, dependency.observed, key, now);
    }
  }

  #loadQuotaCandidates(profileId: string): readonly TopicQuotaCandidate[] {
    const rows = this.#database
      .prepare(
        `SELECT
           topic.id AS topic_id,
           topic.candidate_state,
           topic.topic_revision,
           version.*,
           EXISTS (
             SELECT 1 FROM topic_candidate_invalidations AS invalidation
             WHERE invalidation.version_id = version.id
           ) AS invalidated
         FROM topics AS topic
         JOIN topic_candidate_versions AS version
           ON version.topic_id = topic.id
          AND version.version_number = topic.current_version_number
         WHERE topic.profile_id = ?
           AND topic.topic_contract_version = 'topic-candidate-v1'
         ORDER BY topic.id
         LIMIT ?`,
      )
      .all(profileId, TOPIC_LIMITS.maxPlanCandidates) as (TopicVersionRow & {
      readonly invalidated: number;
    })[];
    const versionIdsJson = JSON.stringify(rows.map((row) => row.id));
    const subjectRows = this.#database
      .prepare(
        `SELECT version.id AS version_id, subject.work_id
         FROM topics AS topic
         JOIN topic_candidate_versions AS version
           ON version.topic_id = topic.id
          AND version.version_number = topic.current_version_number
         JOIN topic_subject_memberships AS subject ON subject.version_id = version.id
         WHERE topic.profile_id = ?
           AND topic.topic_contract_version = 'topic-candidate-v1'
           AND version.id IN (SELECT value FROM json_each(?))
         ORDER BY version.id, subject.work_id`,
      )
      .all(profileId, versionIdsJson) as {
      readonly version_id: string;
      readonly work_id: string;
    }[];
    const worksByVersion = new Map<string, string[]>();
    for (const subject of subjectRows) {
      const values = worksByVersion.get(subject.version_id) ?? [];
      if (!values.includes(subject.work_id)) values.push(subject.work_id);
      worksByVersion.set(subject.version_id, values);
    }
    const componentRows = this.#database
      .prepare(
        `SELECT component.*
         FROM topics AS topic
         JOIN topic_candidate_versions AS version
           ON version.topic_id = topic.id
          AND version.version_number = topic.current_version_number
         JOIN topic_ranking_components AS component ON component.version_id = version.id
         WHERE topic.profile_id = ?
           AND topic.topic_contract_version = 'topic-candidate-v1'
           AND version.id IN (SELECT value FROM json_each(?))
         ORDER BY component.version_id, component.component_type`,
      )
      .all(profileId, versionIdsJson) as Row[];
    const componentsByVersion = new Map<string, Map<TopicRankingComponent, Row>>();
    for (const component of componentRows) {
      const versionId = component.version_id as string;
      const values = componentsByVersion.get(versionId) ?? new Map();
      values.set(component.component_type as TopicRankingComponent, component);
      componentsByVersion.set(versionId, values);
    }

    return Object.freeze(
      rows.map((row) => {
        const componentRowsForVersion = componentsByVersion.get(row.id) ?? new Map();
        const components = {} as Record<TopicRankingComponent, TopicRankingComponentResult>;
        for (const componentType of TOPIC_RANKING_COMPONENTS) {
          const component = componentRowsForVersion.get(componentType);
          if (component === undefined) throw new TopicError('TOPIC_INVALID_CONTRACT');
          components[componentType] = Object.freeze({
            dependencyKeys: parseStringArray(component.input_dependencies_json),
            knowledgeState: component.knowledge_state as 'KNOWN' | 'UNKNOWN',
            policyVersion: TOPIC_RANKING_POLICY_VERSION,
            reasonCodes: parseStringArray(
              component.reason_codes_json,
            ) as TopicRankingComponentResult['reasonCodes'],
            type: componentType,
            valueBasisPoints: (component.value_basis_points as number | null) ?? null,
          });
        }
        const ranking: TopicRankingResult = Object.freeze({
          complete: asBoolean(row.ranking_complete),
          components: Object.freeze(components),
          fingerprint: row.semantic_fingerprint,
          knownComponentCount: TOPIC_RANKING_COMPONENTS.filter(
            (type) => components[type].knowledgeState === 'KNOWN',
          ).length,
          policyVersion: TOPIC_RANKING_POLICY_VERSION,
          tieBreakKey: row.tie_break_key,
          totalBasisPoints: row.total_score_basis_points,
        });
        const stale =
          asBoolean(row.invalidated) ||
          row.eligibility_policy_version !== TOPIC_ELIGIBILITY_POLICY_VERSION ||
          row.fingerprint_policy_version !== TOPIC_FINGERPRINT_POLICY_VERSION ||
          row.ranking_policy_version !== TOPIC_RANKING_POLICY_VERSION;
        return Object.freeze({
          contentType: row.content_type,
          eligibility: stale ? ('STALE' as const) : row.eligibility_state,
          estimatedExternalCostMicrousd: row.estimated_external_cost_microusd,
          fingerprint: row.semantic_fingerprint,
          ranking,
          revision: row.topic_revision,
          state: row.candidate_state,
          topicId: row.topic_id,
          topicVersionId: row.id,
          workIds: Object.freeze(worksByVersion.get(row.id) ?? []),
          workloadUnits: row.approval_workload_units,
        });
      }),
    );
  }

  #loadRankingComponents(versionId: string): readonly TopicRankingComponentView[] {
    return Object.freeze(
      (
        this.#database
          .prepare(
            `SELECT component_type, knowledge_state, value_basis_points, reason_codes_json
             FROM topic_ranking_components
             WHERE version_id = ?
             ORDER BY CASE component_type
               WHEN 'EVIDENCE_SUFFICIENCY' THEN 0
               WHEN 'CONTENT_FIT' THEN 1
               WHEN 'DIFFERENTIATION' THEN 2
               WHEN 'ESTIMATED_COST' THEN 3
               ELSE 4
             END`,
          )
          .all(versionId) as Row[]
      ).map((component) =>
        Object.freeze({
          knowledgeState: component.knowledge_state as 'KNOWN' | 'UNKNOWN',
          reasonCodes: parseStringArray(component.reason_codes_json),
          type: component.component_type as TopicRankingComponent,
          valueBasisPoints: (component.value_basis_points as number | null) ?? null,
        }),
      ),
    );
  }

  #mapGenerationRun(run: Row): TopicGenerationRunView {
    return Object.freeze({
      createdAt: run.created_at as string,
      externalRequestCount: 0 as const,
      resultCandidateCount: run.result_candidate_count as number,
      revision: run.revision as number,
      runId: run.id as string,
      status: run.status as TopicGenerationRunView['status'],
      updatedAt: run.updated_at as string,
    });
  }

  #getPlanVersion(planVersionIdValue: string): TopicQuotaPlanView {
    const planVersionId = identifier(planVersionIdValue);
    const row = this.#database
      .prepare(
        `SELECT
           version.id,
           version.version_number,
           version.pool_snapshot_hash,
           version.status,
           version.total_selected,
           version.total_required,
           version.created_at,
           EXISTS (
             SELECT 1 FROM topic_quota_plan_events AS event
             WHERE event.plan_version_id = version.id AND event.event_type = 'STALE'
           ) AS stale,
           EXISTS (
             SELECT 1 FROM topic_quota_plan_events AS event
             WHERE event.plan_version_id = version.id AND event.event_type = 'SUPERSEDED'
           ) AS superseded
         FROM topic_quota_plan_versions AS version
         WHERE version.id = ?`,
      )
      .get(planVersionId) as
      | {
          readonly created_at: string;
          readonly id: string;
          readonly pool_snapshot_hash: string;
          readonly stale: number;
          readonly status: 'COMPLETE' | 'INCOMPLETE';
          readonly superseded: number;
          readonly total_required: number;
          readonly total_selected: number;
          readonly version_number: number;
        }
      | undefined;
    if (row === undefined) throw new TopicError('TOPIC_PLAN_NOT_FOUND');
    const categoryRows = this.#database
      .prepare(
        `SELECT *
         FROM topic_quota_plan_categories
         WHERE plan_version_id = ?
         ORDER BY content_type`,
      )
      .all(planVersionId) as Row[];
    const categories = categoryRows.map((category) => {
      const parsed = JSON.parse(category.conflicts_json as string) as unknown;
      if (!Array.isArray(parsed)) throw new TopicError('TOPIC_INVALID_CONTRACT');
      return Object.freeze({
        archivedCount: category.archived_count as number,
        conflicts: Object.freeze(
          parsed as {
            readonly code: 'OVER_LOCKED';
            readonly topicIds: readonly string[];
          }[],
        ),
        contentType: category.content_type as TopicContentType,
        heldCount: category.held_count as number,
        lockedEligibleCount: category.locked_eligible_count as number,
        required: category.required_count as number,
        selected: category.selected_count as number,
        shortfall: category.shortfall_count as number,
      });
    });
    const members = (
      this.#database
        .prepare(
          `SELECT content_type, position, topic_id, total_score_basis_points, locked
           FROM topic_quota_plan_members
           WHERE plan_version_id = ?
           ORDER BY content_type, position`,
        )
        .all(planVersionId) as Row[]
    ).map((member) =>
      Object.freeze({
        contentType: member.content_type as TopicContentType,
        locked: asBoolean(member.locked),
        position: member.position as number,
        scoreBasisPoints: member.total_score_basis_points as number,
        topicId: member.topic_id as string,
      }),
    );
    const status = asBoolean(row.superseded)
      ? 'SUPERSEDED'
      : asBoolean(row.stale)
        ? 'STALE'
        : row.status;
    return Object.freeze({
      categories: Object.freeze(categories),
      createdAt: row.created_at,
      members: Object.freeze(members),
      planVersionId: row.id,
      poolSnapshotHash: row.pool_snapshot_hash,
      status,
      totalRequired: row.total_required,
      totalSelected: row.total_selected,
      versionNumber: row.version_number,
    });
  }

  #mapPoolItem(row: TopicVersionRow): TopicPoolItem {
    const invalidated = this.#database
      .prepare(
        `SELECT EXISTS (
           SELECT 1 FROM topic_candidate_invalidations
           WHERE version_id = ?
         ) AS invalidated`,
      )
      .get(row.id) as { readonly invalidated: number };
    const stale =
      asBoolean(invalidated.invalidated) ||
      row.eligibility_policy_version !== TOPIC_ELIGIBILITY_POLICY_VERSION ||
      row.fingerprint_policy_version !== TOPIC_FINGERPRINT_POLICY_VERSION ||
      row.ranking_policy_version !== TOPIC_RANKING_POLICY_VERSION;
    return Object.freeze({
      analysisMode: row.analysis_mode,
      candidateState: row.candidate_state,
      contentType: row.content_type,
      eligibility: stale ? 'STALE' : row.eligibility_state,
      eligibilityReasonCodes: stale
        ? Object.freeze(['DEPENDENCY_OR_POLICY_STALE'])
        : parseStringArray(row.eligibility_reason_codes_json),
      fingerprint: row.semantic_fingerprint,
      rankingComplete: asBoolean(row.ranking_complete),
      revision: row.topic_revision,
      spoilerLevel: row.spoiler_level,
      stale,
      topicAngle: row.topic_angle,
      topicId: row.topic_id,
      totalScoreBasisPoints: row.total_score_basis_points,
      versionNumber: row.version_number,
    });
  }

  #audit(
    eventType:
      | 'GENERATION_PREVIEWED'
      | 'GENERATION_CONFIRMED'
      | 'CANDIDATE_CREATED'
      | 'DUPLICATE_LINKED'
      | 'STATE_CHANGED'
      | 'STATE_UNDONE'
      | 'PLAN_PUBLISHED'
      | 'PLAN_NO_OP'
      | 'RUN_CANCELLED',
    profileId: string,
    topicId: string | null,
    generationPlanId: string | null,
    quotaPlanVersionId: string | null,
    details: Readonly<Record<string, boolean | number | string>>,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO topic_audit_events(
           id, event_type, profile_id, topic_id, generation_plan_id,
           quota_plan_version_id, actor, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'LOCAL_SYSTEM', ?, ?)`,
      )
      .run(
        this.#id('topic-audit'),
        eventType,
        profileId,
        topicId,
        generationPlanId,
        quotaPlanVersionId,
        JSON.stringify(details),
        now,
      );
  }

  #requireProfile(profileId: string): void {
    const row = this.#database
      .prepare('SELECT id FROM account_profiles WHERE id = ?')
      .get(profileId);
    if (row === undefined) throw new TopicError('TOPIC_PROFILE_NOT_FOUND');
  }

  #requireTopicRoot(topicId: string): TopicRootRow {
    const row = this.#database
      .prepare(
        `SELECT
           id, profile_id, semantic_fingerprint, canonical_topic_id,
           candidate_state, current_version_number, topic_revision
         FROM topics
         WHERE id = ? AND topic_contract_version = 'topic-candidate-v1'`,
      )
      .get(topicId) as TopicRootRow | undefined;
    if (row === undefined) throw new TopicError('TOPIC_NOT_FOUND');
    return row;
  }

  #id(prefix: string): string {
    return `${prefix}:${this.#idFactory()}`;
  }
}
