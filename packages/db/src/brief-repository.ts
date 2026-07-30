import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  BRIEF_LIMITS,
  CONTENT_BRIEF_GENERATION_PROMPT_VERSION,
  CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
  CONTENT_BRIEF_READINESS_POLICY_VERSION,
  CONTENT_BRIEF_SCHEMA_VERSION,
  BriefError,
  applyBriefModelCandidate,
  assertContentBriefDraft,
  assertLockedFieldsPreserved,
  briefSemanticHash,
  buildLocalBriefScaffold,
  canonicalBriefJson,
  contentBriefFieldValue,
  createBriefGenerationPlan,
  evaluateBriefReadiness,
  type BriefDependency,
  type BriefEvidenceRef,
  type BriefGenerationJobPayload,
  type BriefGenerationPlan,
  type BriefGenerationRun,
  type BriefProfileId,
  type BriefReadinessContext,
  type BriefReadinessSnapshot,
  type BriefScaffoldInput,
  type BriefVersionState,
  type ContentBriefDraft,
} from '@mystery-operations/briefs';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SYSTEM_LOCKED_PATHS = new Set([
  'topicId',
  'topicVersionId',
  'subjects',
  'evidenceMap',
  'experimentBinding',
  'expressionPolicy',
  'scorePlan',
  'spoilerPlan',
  'forbiddenExpressions.system',
  'contractVersion',
  'schemaVersion',
  'profileId',
]);
const BRIEF_PROFILE_VALUES = new Set<BriefProfileId>([
  'NON_SPOILER_SINGLE_BOOK_VERDICT',
  'FULL_TRICK_LOGIC_ANALYSIS',
  'CROSS_WORK_COMPARISON',
  'WEB_VS_PUBLISHED_MYSTERY',
  'MYSTERY_AND_CULTURAL_PHENOMENON',
]);
const BRIEF_READING_STATE_BY_STORAGE: Readonly<
  Record<string, ContentBriefDraft['expressionPolicy']['readingState']>
> = Object.freeze({
  R1_READ_CLEAR: 'R1',
  R2_READ_FUZZY: 'R2',
  R3_READ_UNCONFIRMED_DETAILS: 'R3',
  S1_RESEARCH_ONLY: 'S1',
  S2_RESEARCH_INSUFFICIENT: 'S2',
  UNCLASSIFIED: 'UNCLASSIFIED',
});

interface BriefRootRow extends Row {
  readonly brief_revision: number;
  readonly brief_state: 'ACTIVE' | 'ARCHIVED';
  readonly current_version_id: string;
  readonly experiment_id: string | null;
  readonly id: string;
  readonly profile_id: BriefProfileId;
  readonly topic_id: string;
  readonly topic_version_id: string;
  readonly updated_at: string;
}

interface BriefVersionRow extends Row {
  readonly brief_id: string;
  readonly confirmed_at: string | null;
  readonly created_at: string;
  readonly dependency_hash: string;
  readonly id: string;
  readonly input_hash: string;
  readonly lock_snapshot_hash: string;
  readonly locked_at: string | null;
  readonly payload_json: string;
  readonly previous_version_id: string | null;
  readonly prompt_version: string;
  readonly readiness_reason_codes_json: string;
  readonly readiness_status: BriefReadinessSnapshot['status'];
  readonly schema_version: string;
  readonly status: BriefVersionState;
  readonly version_number: number;
  readonly warnings_json: string;
}

export interface BriefListItem {
  readonly briefId: string;
  readonly experimentBound: boolean;
  readonly profileId: BriefProfileId;
  readonly readiness: BriefReadinessSnapshot['status'];
  readonly revision: number;
  readonly stale: boolean;
  readonly state: 'ACTIVE' | 'ARCHIVED';
  readonly topicId: string;
  readonly updatedAt: string;
  readonly versionNumber: number;
}

export interface BriefListView {
  readonly counts: Readonly<Record<BriefReadinessSnapshot['status'], number>>;
  readonly items: readonly BriefListItem[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface BriefDetailView extends BriefListItem {
  readonly dependencies: readonly BriefDependency[];
  readonly draft: ContentBriefDraft;
  readonly evidencePage: {
    readonly items: readonly BriefEvidenceRef[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
  readonly generationRuns: readonly BriefGenerationRun[];
  readonly generationPage: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
  readonly history: readonly {
    readonly action: string;
    readonly createdAt: string;
    readonly fromState: 'ACTIVE' | 'ARCHIVED' | null;
    readonly revision: number;
    readonly toState: 'ACTIVE' | 'ARCHIVED';
  }[];
  readonly historyPage: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
  readonly invalidationReasons: readonly string[];
  readonly readinessReasonCodes: readonly string[];
  readonly versionHistory: {
    readonly items: readonly {
      readonly changeKinds: readonly string[];
      readonly createdAt: string;
      readonly isCurrent: boolean;
      readonly readiness: BriefReadinessSnapshot['status'];
      readonly status: BriefVersionState;
      readonly versionId: string;
      readonly versionNumber: number;
    }[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
}

export interface BriefVersionDiff {
  readonly changedFields: readonly string[];
  readonly fromVersionId: string;
  readonly toVersionId: string;
}

export interface BriefGenerationExecution {
  readonly draft: ContentBriefDraft;
  readonly plan: BriefGenerationPlan;
  readonly run: BriefGenerationRun;
}

function identifier(value: string, maximum: number = BRIEF_LIMITS.identifierBytes): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.trim() !== value ||
    Buffer.byteLength(value, 'utf8') > maximum
  ) {
    throw new BriefError('BRIEF_INVALID_CONTRACT');
  }
  return value;
}

function iso(value: string): string {
  if (!UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new BriefError('BRIEF_INVALID_CONTRACT');
  }
  return value;
}

function integer(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BriefError('BRIEF_INVALID_CONTRACT');
  }
  return value;
}

function parseStrings(value: unknown): readonly string[] {
  if (typeof value !== 'string') throw new BriefError('BRIEF_CONFLICT');
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new BriefError('BRIEF_CONFLICT');
  }
  return Object.freeze(parsed);
}

function parseDraft(value: unknown): ContentBriefDraft {
  if (typeof value !== 'string') throw new BriefError('BRIEF_CONFLICT');
  return assertContentBriefDraft(JSON.parse(value) as unknown);
}

function spoilerCompatibility(draft: ContentBriefDraft): 'NONE' | 'LIGHT' | 'FULL' {
  return draft.spoilerPlan.level === 'NO_SPOILER'
    ? 'NONE'
    : draft.spoilerPlan.level === 'LIGHT_SPOILER'
      ? 'LIGHT'
      : 'FULL';
}

function scoreCompatibility(draft: ContentBriefDraft): 'NONE' | 'PERSONAL' | 'RESEARCH_ANALYSIS' {
  return draft.scorePlan.kind === 'NONE'
    ? 'NONE'
    : draft.scorePlan.kind === 'PERSONAL_SCORE'
      ? 'PERSONAL'
      : 'RESEARCH_ANALYSIS';
}

function rootStatus(readiness: BriefReadinessSnapshot['status']): string {
  if (readiness === 'READY_FOR_DRAFT_GENERATION') return 'RESEARCH_READY';
  if (readiness === 'FACT_BLOCKED') return 'FACT_BLOCKED';
  if (readiness === 'STALE') return 'REVIEW_REQUIRED';
  return 'RESEARCHING';
}

function changeKinds(
  current: ContentBriefDraft,
  previous: ContentBriefDraft | null,
): readonly string[] {
  if (previous === null) return Object.freeze(['INITIAL_SCAFFOLD']);
  const sections = [
    'targetAudience',
    'contentObjective',
    'coreJudgment',
    'supportingArguments',
    'strongestCounterargument',
    'evidenceMap',
    'structurePlan',
    'spoilerPlan',
    'scorePlan',
    'expressionPolicy',
    'forbiddenExpressions',
    'fieldStates',
    'experimentBinding',
    'openQuestionsAndLimitations',
  ] as const;
  return Object.freeze(
    sections.filter(
      (section) => canonicalBriefJson(current[section]) !== canonicalBriefJson(previous[section]),
    ),
  );
}

function readinessCounts(): Record<BriefReadinessSnapshot['status'], number> {
  return {
    AUTHENTICITY_BLOCKED: 0,
    DOSSIER_NOT_READY: 0,
    DRAFT_INCOMPLETE: 0,
    EVIDENCE_MAPPING_INCOMPLETE: 0,
    EXPERIMENT_MISMATCH: 0,
    FACT_BLOCKED: 0,
    READY_FOR_DRAFT_GENERATION: 0,
    SPOILER_POLICY_INCOMPLETE: 0,
    STALE: 0,
  };
}

export class SqliteBriefRepository {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public list(input: {
    readonly limit: number;
    readonly offset: number;
    readonly profileId: BriefProfileId | null;
    readonly query: string;
    readonly readiness: BriefReadinessSnapshot['status'] | null;
    readonly state: 'ACTIVE' | 'ARCHIVED' | null;
  }): BriefListView {
    const limit = integer(input.limit, 1, BRIEF_LIMITS.maxPageSize);
    const offset = integer(input.offset, 0, BRIEF_LIMITS.maxPageOffset);
    if (Buffer.byteLength(input.query, 'utf8') > 512) {
      throw new BriefError('BRIEF_INVALID_CONTRACT');
    }
    const filters = ["brief.profile_id <> 'LEGACY_UNCLASSIFIED'"];
    const parameters: Array<number | string> = [];
    if (input.profileId !== null) {
      filters.push('brief.profile_id = ?');
      parameters.push(input.profileId);
    }
    if (input.state !== null) {
      filters.push('brief.brief_state = ?');
      parameters.push(input.state);
    }
    if (input.readiness !== null) {
      filters.push(`CASE WHEN EXISTS (
        SELECT 1 FROM content_brief_invalidations AS invalidation
        WHERE invalidation.version_id = version.id
      ) THEN 'STALE' ELSE version.readiness_status END = ?`);
      parameters.push(input.readiness);
    }
    if (input.query.length > 0) {
      filters.push(`(
        brief.target_reader LIKE ? ESCAPE '\\' OR
        brief.core_judgment LIKE ? ESCAPE '\\' OR
        brief.topic_id LIKE ? ESCAPE '\\'
      )`);
      const escaped = `%${input.query
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_')}%`;
      parameters.push(escaped, escaped, escaped);
    }
    const where = filters.join(' AND ');
    const total = (
      this.#database
        .prepare(
          `SELECT count(*) AS count
           FROM content_briefs AS brief
           JOIN content_brief_versions AS version
             ON version.id = brief.current_version_id
           WHERE ${where}`,
        )
        .get(...parameters) as { readonly count: number }
    ).count;
    const rows = this.#database
      .prepare(
        `SELECT
           brief.id, brief.topic_id, brief.experiment_id, brief.profile_id,
           brief.brief_state, brief.brief_revision, brief.updated_at,
           version.version_number, version.readiness_status,
           EXISTS (
             SELECT 1 FROM content_brief_invalidations AS invalidation
             WHERE invalidation.version_id = version.id
           ) AS stale
         FROM content_briefs AS brief
         JOIN content_brief_versions AS version
           ON version.id = brief.current_version_id
         WHERE ${where}
         ORDER BY brief.updated_at DESC, brief.id
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters, limit, offset) as unknown as readonly {
      readonly brief_revision: number;
      readonly brief_state: 'ACTIVE' | 'ARCHIVED';
      readonly experiment_id: string | null;
      readonly id: string;
      readonly profile_id: BriefProfileId;
      readonly readiness_status: BriefReadinessSnapshot['status'];
      readonly stale: number;
      readonly topic_id: string;
      readonly updated_at: string;
      readonly version_number: number;
    }[];
    const counts = readinessCounts();
    const countRows = this.#database
      .prepare(
        `SELECT
           CASE WHEN EXISTS (
             SELECT 1 FROM content_brief_invalidations AS invalidation
             WHERE invalidation.version_id = version.id
           ) THEN 'STALE' ELSE version.readiness_status END AS readiness,
           count(*) AS count
         FROM content_briefs AS brief
         JOIN content_brief_versions AS version ON version.id = brief.current_version_id
         WHERE brief.profile_id <> 'LEGACY_UNCLASSIFIED'
         GROUP BY readiness`,
      )
      .all() as unknown as readonly {
      readonly count: number;
      readonly readiness: BriefReadinessSnapshot['status'];
    }[];
    for (const row of countRows) counts[row.readiness] = row.count;
    return Object.freeze({
      counts: Object.freeze(counts),
      items: Object.freeze(
        rows.map((row) =>
          Object.freeze({
            briefId: row.id,
            experimentBound: row.experiment_id !== null,
            profileId: row.profile_id,
            readiness: row.stale === 1 ? 'STALE' : row.readiness_status,
            revision: row.brief_revision,
            stale: row.stale === 1,
            state: row.brief_state,
            topicId: row.topic_id,
            updatedAt: row.updated_at,
            versionNumber: row.version_number,
          }),
        ),
      ),
      limit,
      offset,
      total,
    });
  }

  public get(
    briefIdValue: string,
    pagination: {
      readonly evidenceLimit: number;
      readonly evidenceOffset: number;
      readonly generationLimit: number;
      readonly generationOffset: number;
      readonly historyLimit: number;
      readonly historyOffset: number;
      readonly versionLimit: number;
      readonly versionOffset: number;
    } = {
      evidenceLimit: 25,
      evidenceOffset: 0,
      generationLimit: 25,
      generationOffset: 0,
      historyLimit: 25,
      historyOffset: 0,
      versionLimit: 25,
      versionOffset: 0,
    },
  ): BriefDetailView {
    const briefId = identifier(briefIdValue);
    const root = this.#requireRoot(briefId);
    const version = this.#requireVersion(root.current_version_id);
    const draft = parseDraft(version.payload_json);
    const staleReasons = this.#database
      .prepare(
        `SELECT DISTINCT reason_code
         FROM content_brief_invalidations
         WHERE version_id = ?
         ORDER BY reason_code
         LIMIT ?`,
      )
      .all(version.id, BRIEF_LIMITS.reasonCodes) as unknown as readonly {
      readonly reason_code: string;
    }[];
    const versionLimit = integer(pagination.versionLimit, 1, 100);
    const versionOffset = integer(pagination.versionOffset, 0, BRIEF_LIMITS.maxPageOffset);
    const historyLimit = integer(pagination.historyLimit, 1, 100);
    const historyOffset = integer(pagination.historyOffset, 0, BRIEF_LIMITS.maxPageOffset);
    const evidenceLimit = integer(pagination.evidenceLimit, 1, 100);
    const evidenceOffset = integer(pagination.evidenceOffset, 0, BRIEF_LIMITS.maxPageOffset);
    const generationLimit = integer(pagination.generationLimit, 1, 100);
    const generationOffset = integer(pagination.generationOffset, 0, BRIEF_LIMITS.maxPageOffset);
    const versionTotal = (
      this.#database
        .prepare('SELECT count(*) AS count FROM content_brief_versions WHERE brief_id = ?')
        .get(briefId) as { readonly count: number }
    ).count;
    const versions = this.#database
      .prepare(
        `SELECT id, payload_json, version_number, status, readiness_status, created_at
         FROM content_brief_versions
         WHERE brief_id = ?
         ORDER BY version_number DESC
         LIMIT ? OFFSET ?`,
      )
      .all(briefId, versionLimit, versionOffset) as unknown as readonly {
      readonly created_at: string;
      readonly id: string;
      readonly payload_json: string;
      readonly readiness_status: BriefReadinessSnapshot['status'];
      readonly status: BriefVersionState;
      readonly version_number: number;
    }[];
    const historyTotal = (
      this.#database
        .prepare('SELECT count(*) AS count FROM content_brief_transitions WHERE brief_id = ?')
        .get(briefId) as { readonly count: number }
    ).count;
    const history = this.#database
      .prepare(
        `SELECT action, created_at, from_state, revision, to_state
         FROM content_brief_transitions
         WHERE brief_id = ?
         ORDER BY revision DESC
         LIMIT ? OFFSET ?`,
      )
      .all(briefId, historyLimit, historyOffset) as unknown as readonly {
      readonly action: string;
      readonly created_at: string;
      readonly from_state: 'ACTIVE' | 'ARCHIVED' | null;
      readonly revision: number;
      readonly to_state: 'ACTIVE' | 'ARCHIVED';
    }[];
    const dependencies = this.#database
      .prepare(
        `SELECT dependency_type, dependency_id, observed_revision, dependency_hash
         FROM content_brief_dependencies
         WHERE version_id = ?
         ORDER BY dependency_type, dependency_id
         LIMIT ?`,
      )
      .all(version.id, BRIEF_LIMITS.dependencies) as unknown as readonly {
      readonly dependency_hash: string;
      readonly dependency_id: string;
      readonly dependency_type: BriefDependency['dependencyType'];
      readonly observed_revision: string;
    }[];
    const generationTotal = (
      this.#database
        .prepare('SELECT count(*) AS count FROM content_brief_generation_runs WHERE brief_id = ?')
        .get(briefId) as { readonly count: number }
    ).count;
    const runs = this.#database
      .prepare(
        `SELECT
           id, brief_id, execution_id, plan_id, status, external_request_count,
           cost_state, result_version_id, stable_error_code, revision
         FROM content_brief_generation_runs
         WHERE brief_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(briefId, generationLimit, generationOffset) as unknown as readonly {
      readonly brief_id: string;
      readonly cost_state: BriefGenerationRun['costState'];
      readonly execution_id: string;
      readonly external_request_count: 0 | 1;
      readonly id: string;
      readonly plan_id: string;
      readonly result_version_id: string | null;
      readonly revision: number;
      readonly stable_error_code: string | null;
      readonly status: BriefGenerationRun['status'];
    }[];
    return Object.freeze({
      briefId,
      dependencies: Object.freeze(
        dependencies.map((dependency) =>
          Object.freeze({
            dependencyHash: dependency.dependency_hash,
            dependencyId: dependency.dependency_id,
            dependencyType: dependency.dependency_type,
            observedRevision: dependency.observed_revision,
          }),
        ),
      ),
      draft,
      evidencePage: Object.freeze({
        items: Object.freeze(
          draft.evidenceMap.slice(evidenceOffset, evidenceOffset + evidenceLimit),
        ),
        limit: evidenceLimit,
        offset: evidenceOffset,
        total: draft.evidenceMap.length,
      }),
      experimentBound: root.experiment_id !== null,
      generationRuns: Object.freeze(runs.map((run) => this.#runView(run))),
      generationPage: Object.freeze({
        limit: generationLimit,
        offset: generationOffset,
        total: generationTotal,
      }),
      history: Object.freeze(
        history.map((item) =>
          Object.freeze({
            action: item.action,
            createdAt: item.created_at,
            fromState: item.from_state,
            revision: item.revision,
            toState: item.to_state,
          }),
        ),
      ),
      historyPage: Object.freeze({
        limit: historyLimit,
        offset: historyOffset,
        total: historyTotal,
      }),
      invalidationReasons: Object.freeze(staleReasons.map((item) => item.reason_code)),
      profileId: root.profile_id,
      readiness: staleReasons.length > 0 ? 'STALE' : version.readiness_status,
      readinessReasonCodes:
        staleReasons.length > 0
          ? Object.freeze(staleReasons.map((item) => item.reason_code))
          : parseStrings(version.readiness_reason_codes_json),
      revision: root.brief_revision,
      stale: staleReasons.length > 0,
      state: root.brief_state,
      topicId: root.topic_id,
      updatedAt: root.updated_at,
      versionHistory: Object.freeze({
        items: Object.freeze(
          versions.map((item) => {
            const itemDraft = parseDraft(item.payload_json);
            const previous =
              item.version_number === 1
                ? null
                : this.#database
                    .prepare(
                      `SELECT payload_json FROM content_brief_versions
                       WHERE brief_id = ? AND version_number = ?`,
                    )
                    .get(briefId, item.version_number - 1);
            const previousDraft =
              previous === undefined || previous === null
                ? null
                : parseDraft((previous as { readonly payload_json: string }).payload_json);
            return Object.freeze({
              changeKinds: changeKinds(itemDraft, previousDraft),
              createdAt: item.created_at,
              isCurrent: item.id === root.current_version_id,
              readiness: item.readiness_status,
              status: item.status,
              versionId: item.id,
              versionNumber: item.version_number,
            });
          }),
        ),
        limit: versionLimit,
        offset: versionOffset,
        total: versionTotal,
      }),
      versionNumber: version.version_number,
    });
  }

  public prepareScaffoldFromTopic(
    topicIdValue: string,
    assignmentPlanIdValue: string | null,
  ): BriefScaffoldInput {
    const topicId = identifier(topicIdValue);
    const assignmentPlanId =
      assignmentPlanIdValue === null ? null : identifier(assignmentPlanIdValue);
    const topic = this.#database
      .prepare(
        `SELECT
           topic.profile_id, topic.candidate_state,
           version.id AS version_id, version.content_type,
           version.candidate_judgment, version.analysis_mode,
           version.spoiler_level, version.comparison_dimension,
           version.required_public_labels_json
         FROM topics AS topic
         JOIN topic_candidate_versions AS version
           ON version.topic_id = topic.id
          AND version.version_number = topic.current_version_number
         WHERE topic.id = ?
           AND topic.candidate_state = 'LOCKED'
           AND version.eligibility_state = 'ELIGIBLE'
           AND NOT EXISTS (
             SELECT 1 FROM topic_candidate_invalidations AS invalidation
             WHERE invalidation.topic_id = topic.id
               AND invalidation.version_id = version.id
           )`,
      )
      .get(topicId) as
      | {
          readonly analysis_mode: 'PERSONAL' | 'PUBLIC_RESEARCH';
          readonly candidate_judgment: string | null;
          readonly candidate_state: 'LOCKED';
          readonly comparison_dimension: string | null;
          readonly content_type: string;
          readonly profile_id: string;
          readonly required_public_labels_json: string;
          readonly spoiler_level: BriefScaffoldInput['spoilerLevel'];
          readonly version_id: string;
        }
      | undefined;
    if (topic === undefined || !BRIEF_PROFILE_VALUES.has(topic.content_type as BriefProfileId)) {
      throw new BriefError('BRIEF_NOT_READY');
    }
    const profileId = topic.content_type as BriefProfileId;
    const subjectRows = this.#database
      .prepare(
        `SELECT
           subject_type, subject_id, work_id, expression_id, edition_id,
           role, expression_form
         FROM topic_subject_memberships
         WHERE version_id = ?
         ORDER BY ordinal`,
      )
      .all(topic.version_id) as unknown as readonly {
      readonly edition_id: string | null;
      readonly expression_form: BriefScaffoldInput['subjects'][number]['expressionForm'];
      readonly expression_id: string | null;
      readonly role: BriefScaffoldInput['subjects'][number]['role'];
      readonly subject_id: string;
      readonly subject_type: BriefScaffoldInput['subjects'][number]['subjectType'];
      readonly work_id: string;
    }[];
    if (subjectRows.length === 0 || subjectRows.length > BRIEF_LIMITS.subjects) {
      throw new BriefError('BRIEF_NOT_READY');
    }
    const subjects = Object.freeze(
      subjectRows.map((row) =>
        Object.freeze({
          editionId: row.edition_id,
          expressionForm: row.expression_form,
          expressionId: row.expression_id,
          role: row.role,
          subjectId: row.subject_id,
          subjectType: row.subject_type,
          workId: row.work_id,
        }),
      ),
    );
    const primary = subjects.find((subject) => subject.role === 'PRIMARY');
    if (primary === undefined) throw new BriefError('BRIEF_NOT_READY');

    const permission = this.#database
      .prepare(
        `SELECT
           state_root.id AS reading_state_id, state_root.revision,
           state_root.current_revision_id, state_root.current_snapshot_id,
           state_revision.state, snapshot.id AS snapshot_id,
           spoiler.user_confirmed AS spoiler_user_confirmed
         FROM reading_states AS state_root
         JOIN reading_state_revisions AS state_revision
           ON state_revision.id = state_root.current_revision_id
         JOIN expression_permission_snapshots AS snapshot
           ON snapshot.id = state_root.current_snapshot_id
          AND snapshot.reading_state_revision_id = state_root.current_revision_id
         JOIN reading_spoiler_preferences AS spoiler_root
           ON spoiler_root.reading_state_id = state_root.id
         JOIN reading_spoiler_preference_revisions AS spoiler
           ON spoiler.id = spoiler_root.current_revision_id
         WHERE state_root.profile_id = ?
           AND state_root.book_id = ?
           AND snapshot.content_brief_readiness NOT IN ('BLOCKED', 'STALE_REVIEW_REQUIRED')
           AND NOT EXISTS (
             SELECT 1 FROM expression_permission_invalidations AS invalidation
             WHERE invalidation.snapshot_id = snapshot.id
           )`,
      )
      .get(topic.profile_id, primary.workId) as
      | {
          readonly current_revision_id: string;
          readonly current_snapshot_id: string;
          readonly reading_state_id: string;
          readonly revision: number;
          readonly snapshot_id: string;
          readonly spoiler_user_confirmed: number;
          readonly state: string;
        }
      | undefined;
    const readingState =
      permission === undefined ? undefined : BRIEF_READING_STATE_BY_STORAGE[permission.state];
    if (permission === undefined || readingState === undefined) {
      throw new BriefError('BRIEF_NOT_READY');
    }
    const assertionRows = this.#database
      .prepare(
        `SELECT assertion.id
         FROM experience_assertions AS assertion
         JOIN experience_assertion_revisions AS revision
           ON revision.id = assertion.current_revision_id
         WHERE assertion.reading_state_id = ?
           AND revision.reading_state_revision_id = ?
           AND revision.status = 'CONFIRMED'
         ORDER BY assertion.id`,
      )
      .all(permission.reading_state_id, permission.current_revision_id) as unknown as readonly {
      readonly id: string;
    }[];
    const allowedAssertionIds = Object.freeze(assertionRows.map((row) => row.id));

    const evidenceRows = this.#database
      .prepare(
        `SELECT
           context.claim_id, context.context_only,
           dossier.id AS dossier_id, version.id AS dossier_version_id,
           entry.id AS dossier_entry_id, entry.display_value,
           evaluation.id AS fact_evaluation_id, evaluation.status AS fact_status,
           locator.id AS evidence_locator_id, locator.source_id,
           locator.source_revision, source_revision.language
         FROM topic_context_claims AS context
         JOIN research_dossier_entry_claims AS entry_claim
           ON entry_claim.claim_id = context.claim_id
         JOIN research_dossier_entries AS entry
           ON entry.id = entry_claim.entry_id
         JOIN research_dossier_versions AS version
           ON version.id = entry.version_id
         JOIN research_dossiers AS dossier
           ON dossier.id = version.dossier_id
          AND dossier.current_version_id = version.id
          AND dossier.readiness = 'READY_FOR_CONTENT_BRIEF'
         JOIN research_dossier_entry_evaluations AS entry_evaluation
           ON entry_evaluation.entry_id = entry.id
         JOIN fact_evaluations AS evaluation
           ON evaluation.id = entry_evaluation.evaluation_id
          AND evaluation.claim_id = context.claim_id
          AND evaluation.status = context.fact_status
         JOIN research_dossier_entry_evidence AS entry_evidence
           ON entry_evidence.entry_id = entry.id
         JOIN claim_evidence AS locator
           ON locator.id = entry_evidence.evidence_id
          AND locator.claim_id = context.claim_id
          AND locator.locator_validated = 1
          AND locator.verification_status = 'VALIDATED'
         JOIN source_revisions AS source_revision
           ON source_revision.source_id = locator.source_id
          AND source_revision.revision = locator.source_revision
         WHERE context.version_id = ?
         ORDER BY context.claim_id, entry.id, locator.id
         LIMIT ?`,
      )
      .all(topic.version_id, BRIEF_LIMITS.evidenceRefs) as unknown as readonly {
      readonly claim_id: string;
      readonly context_only: number;
      readonly display_value: string;
      readonly dossier_entry_id: string;
      readonly dossier_id: string;
      readonly dossier_version_id: string;
      readonly evidence_locator_id: string;
      readonly fact_evaluation_id: string;
      readonly fact_status: ContentBriefDraft['evidenceMap'][number]['factStatus'];
      readonly language: string;
      readonly source_id: string;
      readonly source_revision: number;
    }[];
    const evidenceRefs = Object.freeze(
      evidenceRows.map((row) => {
        const identity = {
          claimId: row.claim_id,
          dossierEntryId: row.dossier_entry_id,
          evidenceLocatorId: row.evidence_locator_id,
          topicVersionId: topic.version_id,
        };
        return Object.freeze({
          claimId: row.claim_id,
          current: true,
          dependencyHash: briefSemanticHash(identity),
          displaySummary: row.display_value.slice(0, 512),
          dossierEntryId: row.dossier_entry_id,
          dossierId: row.dossier_id,
          dossierVersionId: row.dossier_version_id,
          evidenceLocatorId: row.evidence_locator_id,
          factEvaluationId: row.fact_evaluation_id,
          factStatus: row.fact_status,
          fieldPath: row.context_only === 1 ? 'openQuestionsAndLimitations' : 'coreJudgment',
          locatorValid: true,
          refId: `brief-evidence:${briefSemanticHash(identity)}`,
          role: row.context_only === 1 ? ('CONTEXT' as const) : ('FACT' as const),
          sourceLanguage: row.language,
          sourceRevisionId: `${row.source_id}:${row.source_revision}`,
        });
      }),
    );

    let experimentBinding: BriefScaffoldInput['experimentBinding'] = null;
    if (assignmentPlanId !== null) {
      const binding = this.#database
        .prepare(
          `SELECT
             experiment.id AS experiment_id,
             current_design.design_version_id,
             assignment.id AS assignment_plan_id,
             unit.arm_id, arm.value_identity AS arm_value_identity,
             unit.work_id, unit.popularity_stratum, unit.structure_fingerprint
           FROM experiments AS experiment
           JOIN experiment_current_designs AS current_design
             ON current_design.experiment_id = experiment.id
           JOIN experiment_current_assignments AS current_assignment
             ON current_assignment.design_version_id = current_design.design_version_id
           JOIN experiment_assignment_plans AS assignment
             ON assignment.id = current_assignment.assignment_plan_id
            AND assignment.design_version_id = current_design.design_version_id
           JOIN experiment_assignment_units AS unit
             ON unit.assignment_plan_id = assignment.id
            AND unit.topic_id = ?
           JOIN experiment_arms AS arm
             ON arm.design_version_id = current_design.design_version_id
            AND arm.arm_id = unit.arm_id
           WHERE assignment.id = ?
             AND experiment.experiment_state = 'LOCKED'
             AND assignment.status = 'READY_TO_LOCK'
             AND unit.topic_version_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM experiment_invalidations AS invalidation
               WHERE invalidation.design_version_id = current_design.design_version_id
             )`,
        )
        .get(topicId, assignmentPlanId, topic.version_id) as
        | {
            readonly arm_id: string;
            readonly arm_value_identity: string;
            readonly assignment_plan_id: string;
            readonly design_version_id: string;
            readonly experiment_id: string;
            readonly popularity_stratum: 'HOT' | 'WARM' | 'COLD' | 'UNKNOWN';
            readonly structure_fingerprint: string;
            readonly work_id: string;
          }
        | undefined;
      if (binding === undefined) throw new BriefError('BRIEF_NOT_READY');
      const conditionRows = this.#database
        .prepare(
          `SELECT condition_kind, value_identity
           FROM experiment_controlled_conditions
           WHERE design_version_id = ?
           ORDER BY condition_kind`,
        )
        .all(binding.design_version_id) as unknown as readonly {
        readonly condition_kind: string;
        readonly value_identity: string;
      }[];
      experimentBinding = Object.freeze({
        armId: binding.arm_id,
        armValueIdentity: binding.arm_value_identity,
        assignmentCurrent: true,
        assignmentPlanId: binding.assignment_plan_id,
        controlledConditions: Object.freeze(
          conditionRows.map((row) =>
            Object.freeze({ kind: row.condition_kind, valueIdentity: row.value_identity }),
          ),
        ),
        designCurrent: true,
        designVersionId: binding.design_version_id,
        experimentId: binding.experiment_id,
        experimentLocked: true,
        experimentStale: false,
        popularityStratum: binding.popularity_stratum,
        structureFingerprint: binding.structure_fingerprint,
        topicId,
        topicVersionId: topic.version_id,
        workId: binding.work_id,
      });
    }

    return Object.freeze({
      allowedAssertionIds,
      candidateJudgment: topic.candidate_judgment,
      comparisonDimension: topic.comparison_dimension,
      evidenceRefs,
      experimentBinding,
      expressionMode:
        topic.analysis_mode === 'PERSONAL'
          ? ('PERSONAL_EXPERIENCE' as const)
          : ('PUBLIC_RESEARCH_ANALYSIS' as const),
      permissionCurrent: true,
      permissionRevision: permission.revision,
      permissionSnapshotId: permission.snapshot_id,
      profileId,
      r2AssertionIds: readingState === 'R2' ? allowedAssertionIds : Object.freeze([]),
      readingState,
      requiredPublicLabels: parseStrings(topic.required_public_labels_json),
      scoreKind: 'NONE',
      scoreValueSourceId: null,
      spoilerLevel: topic.spoiler_level,
      spoilerUserConfirmed: permission.spoiler_user_confirmed === 1,
      subjects,
      topicId,
      topicVersionId: topic.version_id,
    });
  }

  public deriveReadinessContext(draftValue: unknown): BriefReadinessContext {
    const draft = assertContentBriefDraft(draftValue);
    const topic = this.#database
      .prepare(
        `SELECT
           topic.candidate_state, topic.current_version_number,
           version.version_number, version.content_type, version.eligibility_state,
           NOT EXISTS (
             SELECT 1 FROM topic_candidate_invalidations AS invalidation
             WHERE invalidation.topic_id = topic.id
               AND invalidation.version_id = version.id
           ) AS version_valid
         FROM topics AS topic
         JOIN topic_candidate_versions AS version
           ON version.id = ? AND version.topic_id = topic.id
         WHERE topic.id = ?`,
      )
      .get(draft.topicVersionId, draft.topicId) as
      | {
          readonly candidate_state: string;
          readonly content_type: string;
          readonly current_version_number: number;
          readonly eligibility_state: string;
          readonly version_number: number;
          readonly version_valid: number;
        }
      | undefined;
    const topicCurrent =
      topic !== undefined &&
      topic.current_version_number === topic.version_number &&
      topic.content_type === draft.profileId &&
      topic.version_valid === 1;

    const subjectRows = this.#database
      .prepare(
        `SELECT
           subject_type, subject_id, work_id, expression_id, edition_id,
           role, expression_form
         FROM topic_subject_memberships
         WHERE version_id = ?
         ORDER BY ordinal`,
      )
      .all(draft.topicVersionId) as unknown as readonly {
      readonly edition_id: string | null;
      readonly expression_form: ContentBriefDraft['subjects'][number]['expressionForm'];
      readonly expression_id: string | null;
      readonly role: ContentBriefDraft['subjects'][number]['role'];
      readonly subject_id: string;
      readonly subject_type: ContentBriefDraft['subjects'][number]['subjectType'];
      readonly work_id: string;
    }[];
    const trustedSubjects = subjectRows.map((row) => ({
      editionId: row.edition_id,
      expressionForm: row.expression_form,
      expressionId: row.expression_id,
      role: row.role,
      subjectId: row.subject_id,
      subjectType: row.subject_type,
      workId: row.work_id,
    }));
    const subjectsCurrent =
      subjectRows.length > 0 &&
      canonicalBriefJson(trustedSubjects) === canonicalBriefJson(draft.subjects);

    const permission = this.#database
      .prepare(
        `SELECT
           state_root.revision, state_root.current_revision_id,
           state_root.current_snapshot_id, state_revision.state,
           snapshot.reading_state_revision_id, snapshot.dossier_id,
           snapshot.dossier_version_id, snapshot.dossier_readiness,
           snapshot.spoiler_level, snapshot.spoiler_warning_required,
           snapshot.spoiler_warning_placement,
           snapshot.spoiler_user_confirmation_required,
           snapshot.personal_content_mode, snapshot.research_content_mode,
           snapshot.personal_score_permission, snapshot.research_score_permission,
           snapshot.content_brief_readiness,
           dossier.current_version_id AS current_dossier_version_id,
           dossier.readiness AS current_dossier_readiness,
           NOT EXISTS (
             SELECT 1 FROM expression_permission_invalidations AS invalidation
             WHERE invalidation.snapshot_id = snapshot.id
           ) AS snapshot_valid
         FROM expression_permission_snapshots AS snapshot
         JOIN reading_states AS state_root
           ON state_root.id = snapshot.reading_state_id
         JOIN reading_state_revisions AS state_revision
           ON state_revision.id = state_root.current_revision_id
         LEFT JOIN research_dossiers AS dossier
           ON dossier.id = snapshot.dossier_id
         WHERE snapshot.id = ?`,
      )
      .get(draft.expressionPolicy.permissionSnapshotId) as
      | {
          readonly content_brief_readiness: string;
          readonly current_dossier_readiness: string | null;
          readonly current_dossier_version_id: string | null;
          readonly current_revision_id: string;
          readonly current_snapshot_id: string;
          readonly dossier_id: string | null;
          readonly dossier_readiness: string | null;
          readonly dossier_version_id: string | null;
          readonly personal_content_mode: string;
          readonly personal_score_permission: string;
          readonly reading_state_revision_id: string;
          readonly research_content_mode: string;
          readonly research_score_permission: string;
          readonly revision: number;
          readonly snapshot_valid: number;
          readonly spoiler_level: string;
          readonly spoiler_user_confirmation_required: number;
          readonly spoiler_warning_placement: string;
          readonly spoiler_warning_required: number;
          readonly state: string;
        }
      | undefined;
    const permissionCurrent =
      permission !== undefined &&
      permission.current_snapshot_id === draft.expressionPolicy.permissionSnapshotId &&
      permission.reading_state_revision_id === permission.current_revision_id &&
      permission.revision === draft.expressionPolicy.permissionRevision &&
      BRIEF_READING_STATE_BY_STORAGE[permission.state] === draft.expressionPolicy.readingState &&
      permission.snapshot_valid === 1 &&
      !['BLOCKED', 'STALE_REVIEW_REQUIRED'].includes(permission.content_brief_readiness) &&
      (draft.expressionPolicy.mode === 'PERSONAL_EXPERIENCE'
        ? !['BLOCKED', 'RESEARCH_ONLY', 'STALE_REVIEW_REQUIRED'].includes(
            permission.personal_content_mode,
          )
        : !['BLOCKED', 'STALE_REVIEW_REQUIRED'].includes(permission.research_content_mode)) &&
      (draft.scorePlan.kind !== 'PERSONAL_SCORE' ||
        !['BLOCKED', 'RESEARCH_ONLY', 'STALE_REVIEW_REQUIRED'].includes(
          permission.personal_score_permission,
        )) &&
      (draft.scorePlan.kind !== 'RESEARCH_ANALYSIS_SCORE' ||
        !['BLOCKED', 'STALE_REVIEW_REQUIRED'].includes(permission.research_score_permission)) &&
      permission.spoiler_level === draft.spoilerPlan.level &&
      permission.spoiler_warning_required === (draft.spoilerPlan.warningRequired ? 1 : 0) &&
      permission.spoiler_warning_placement === draft.spoilerPlan.warningPlacement &&
      permission.spoiler_user_confirmation_required ===
        (draft.spoilerPlan.userConfirmationRequired ? 1 : 0);
    const dossierCurrentReady =
      permission !== undefined &&
      permission.dossier_id !== null &&
      permission.dossier_version_id !== null &&
      permission.dossier_readiness === 'READY_FOR_CONTENT_BRIEF' &&
      permission.current_dossier_version_id === permission.dossier_version_id &&
      permission.current_dossier_readiness === 'READY_FOR_CONTENT_BRIEF';

    const evidenceCurrent = draft.evidenceMap.every((reference) => {
      const row = this.#database
        .prepare(
          `SELECT
             evaluation.status AS evaluation_status,
             locator.locator_validated, locator.verification_status,
             locator.source_id, locator.source_revision,
             dossier.current_version_id
           FROM research_dossier_entries AS entry
           JOIN research_dossier_versions AS version
             ON version.id = entry.version_id
           JOIN research_dossiers AS dossier
             ON dossier.id = version.dossier_id
           JOIN research_dossier_entry_claims AS entry_claim
             ON entry_claim.entry_id = entry.id
           JOIN research_dossier_entry_evaluations AS entry_evaluation
             ON entry_evaluation.entry_id = entry.id
           JOIN fact_evaluations AS evaluation
             ON evaluation.id = entry_evaluation.evaluation_id
            AND evaluation.claim_id = entry_claim.claim_id
           JOIN research_dossier_entry_evidence AS entry_evidence
             ON entry_evidence.entry_id = entry.id
           JOIN claim_evidence AS locator
             ON locator.id = entry_evidence.evidence_id
            AND locator.claim_id = entry_claim.claim_id
           JOIN source_revisions AS source_revision
             ON source_revision.source_id = locator.source_id
            AND source_revision.revision = locator.source_revision
           WHERE entry.id = ?
             AND version.id = ?
             AND dossier.id = ?
             AND entry_claim.claim_id = ?
             AND evaluation.id = ?
             AND locator.id = ?`,
        )
        .get(
          reference.dossierEntryId,
          reference.dossierVersionId,
          reference.dossierId,
          reference.claimId,
          reference.factEvaluationId,
          reference.evidenceLocatorId,
        ) as
        | {
            readonly current_version_id: string;
            readonly evaluation_status: string;
            readonly locator_validated: number;
            readonly source_id: string;
            readonly source_revision: number;
            readonly verification_status: string;
          }
        | undefined;
      return (
        row !== undefined &&
        row.current_version_id === reference.dossierVersionId &&
        `${row.source_id}:${row.source_revision}` === reference.sourceRevisionId &&
        row.evaluation_status === reference.factStatus &&
        row.locator_validated === 1 &&
        row.verification_status === 'VALIDATED' &&
        reference.current &&
        reference.locatorValid
      );
    });

    let experimentMatches = draft.experimentBinding === null;
    if (draft.experimentBinding !== null) {
      const binding = draft.experimentBinding;
      const row = this.#database
        .prepare(
          `SELECT 1 AS valid
           FROM experiments AS experiment
           JOIN experiment_current_designs AS current_design
             ON current_design.experiment_id = experiment.id
           JOIN experiment_current_assignments AS current_assignment
             ON current_assignment.design_version_id = current_design.design_version_id
           JOIN experiment_assignment_plans AS assignment
             ON assignment.id = current_assignment.assignment_plan_id
           JOIN experiment_assignment_units AS unit
             ON unit.assignment_plan_id = assignment.id
            AND unit.design_version_id = current_design.design_version_id
           JOIN experiment_arms AS arm
             ON arm.design_version_id = current_design.design_version_id
            AND arm.arm_id = unit.arm_id
           WHERE experiment.id = ?
             AND experiment.experiment_state = 'LOCKED'
             AND current_design.design_version_id = ?
             AND assignment.id = ?
             AND assignment.status = 'READY_TO_LOCK'
             AND unit.topic_id = ?
             AND unit.topic_version_id = ?
             AND unit.work_id = ?
             AND unit.arm_id = ?
             AND arm.value_identity = ?
             AND unit.structure_fingerprint = ?
             AND NOT EXISTS (
               SELECT 1 FROM experiment_invalidations AS invalidation
               WHERE invalidation.design_version_id = current_design.design_version_id
             )
           LIMIT 1`,
        )
        .get(
          binding.experimentId,
          binding.designVersionId,
          binding.assignmentPlanId,
          binding.topicId,
          binding.topicVersionId,
          binding.workId,
          binding.armId,
          binding.armValueIdentity,
          binding.structureFingerprint,
        );
      experimentMatches =
        row !== undefined &&
        binding.topicId === draft.topicId &&
        binding.topicVersionId === draft.topicVersionId &&
        binding.designCurrent &&
        binding.assignmentCurrent &&
        binding.experimentLocked &&
        !binding.experimentStale;
    }

    return Object.freeze({
      dependenciesCurrent:
        topicCurrent &&
        subjectsCurrent &&
        permissionCurrent &&
        evidenceCurrent &&
        experimentMatches,
      dossierCurrentReady,
      experimentMatches,
      factBlocked:
        draft.evidenceMap.some((reference) =>
          ['CONFLICTED', 'FACT_BLOCKED', 'STALE_REVIEW_REQUIRED'].includes(reference.factStatus),
        ) || !evidenceCurrent,
      schemaValid: true,
      topicCurrent,
      topicEligibility: topic?.eligibility_state ?? 'STALE',
      topicState: topic?.candidate_state ?? 'ARCHIVED',
    });
  }

  public createScaffold(
    input: BriefScaffoldInput,
    _contextValue: BriefReadinessContext,
    dependenciesValue: readonly BriefDependency[],
    nowValue: string,
  ): BriefDetailView {
    const now = iso(nowValue);
    const draft = buildLocalBriefScaffold(input);
    const context = this.deriveReadinessContext(draft);
    const dependencyMap = new Map(
      dependenciesValue.map(
        (dependency) =>
          [`${dependency.dependencyType}:${dependency.dependencyId}`, dependency] as const,
      ),
    );
    for (const dependency of this.#databaseDependencies(draft)) {
      dependencyMap.set(`${dependency.dependencyType}:${dependency.dependencyId}`, dependency);
    }
    const dependencies = this.#validateDependencies([...dependencyMap.values()]);
    const readiness = evaluateBriefReadiness(draft, context, now);
    const briefId = this.#idFactory();
    const versionId = this.#idFactory();
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO content_briefs(
             id, topic_id, experiment_id, profile_id, topic_version_id,
             current_version_id, brief_state, brief_revision,
             content_type, target_reader, core_judgment, counterpoints_json,
             spoiler_level, required_claim_ids_json, score_type, desired_action,
             forbidden_phrases_json, status, created_at, updated_at
           ) VALUES (
             ?, ?, ?, 'LEGACY_UNCLASSIFIED', NULL, NULL, 'ACTIVE', 1,
             ?, ?, ?, '[]', ?, ?, ?, NULL, ?, ?, ?, ?
           )`,
        )
        .run(
          briefId,
          draft.topicId,
          draft.experimentBinding?.experimentId ?? null,
          draft.profileId,
          draft.targetAudience.readerDescription ?? '待补充目标读者',
          draft.coreJudgment.statement ?? '待确认中心判断',
          spoilerCompatibility(draft),
          JSON.stringify([...new Set(draft.evidenceMap.map((ref) => ref.claimId))]),
          scoreCompatibility(draft),
          JSON.stringify(draft.forbiddenExpressions.map((item) => item.phrase)),
          rootStatus(readiness.status),
          now,
          now,
        );
      this.#insertVersion({
        briefId,
        dependencies,
        draft,
        now,
        previousVersionId: null,
        readiness,
        status: 'DRAFT',
        versionId,
        versionNumber: 1,
      });
      this.#database
        .prepare(
          `UPDATE content_briefs
           SET profile_id = ?, topic_version_id = ?, current_version_id = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(draft.profileId, draft.topicVersionId, versionId, now, briefId);
      this.#appendTransition(
        briefId,
        versionId,
        1,
        null,
        'CREATE_SCAFFOLD',
        null,
        'ACTIVE',
        0,
        'USER',
        'LOCAL_SCAFFOLD_CREATED',
        now,
      );
      this.#audit(
        briefId,
        versionId,
        'SCAFFOLD_CREATED',
        'USER',
        { externalRequestCount: 0, modelConfigured: false },
        now,
      );
    });
    return this.get(briefId);
  }

  public saveDraft(
    briefIdValue: string,
    expectedRevisionValue: number,
    draftValue: unknown,
    _context: BriefReadinessContext,
    nowValue: string,
  ): BriefDetailView {
    const briefId = identifier(briefIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1, 2_147_483_647);
    const now = iso(nowValue);
    const draft = assertContentBriefDraft(draftValue);
    const root = this.#requireRoot(briefId);
    if (root.brief_revision !== expectedRevision) {
      throw new BriefError('BRIEF_STALE_REVISION', true);
    }
    if (draft.topicId !== root.topic_id || draft.topicVersionId !== root.topic_version_id) {
      throw new BriefError('BRIEF_INVALID_CONTRACT');
    }
    const current = this.#requireVersion(root.current_version_id);
    const currentDraft = parseDraft(current.payload_json);
    assertLockedFieldsPreserved(currentDraft, draft);
    const normalized = assertContentBriefDraft({
      ...draft,
      fieldStates: draft.fieldStates.map((state) =>
        state.lock === 'EDITABLE' &&
        canonicalBriefJson(contentBriefFieldValue(draft, state.path)) !==
          canonicalBriefJson(contentBriefFieldValue(currentDraft, state.path))
          ? { ...state, provenance: 'USER_EDITED' }
          : state,
      ),
    });
    const readiness = evaluateBriefReadiness(
      normalized,
      this.deriveReadinessContext(normalized),
      now,
    );
    const dependencies = this.#loadDependencies(current.id);
    this.#appendVersionAndSwitch(
      root,
      normalized,
      dependencies,
      readiness,
      'USER_CONFIRMED',
      'SAVE_EDIT',
      'USER',
      now,
    );
    return this.get(briefId);
  }

  public changeFieldLock(
    briefIdValue: string,
    expectedRevisionValue: number,
    fieldPathValue: string,
    lock: 'USER_LOCKED' | 'EDITABLE',
    nowValue: string,
  ): BriefDetailView {
    const briefId = identifier(briefIdValue);
    const fieldPath = identifier(fieldPathValue);
    const expectedRevision = integer(expectedRevisionValue, 1, 2_147_483_647);
    const now = iso(nowValue);
    if (SYSTEM_LOCKED_PATHS.has(fieldPath)) throw new BriefError('BRIEF_LOCKED_FIELD');
    const root = this.#requireRoot(briefId);
    if (root.brief_revision !== expectedRevision) {
      throw new BriefError('BRIEF_STALE_REVISION', true);
    }
    const current = this.#requireVersion(root.current_version_id);
    const draft = parseDraft(current.payload_json);
    const existing = draft.fieldStates.find((state) => state.path === fieldPath);
    if (existing === undefined || existing.lock === 'SYSTEM_LOCKED') {
      throw new BriefError('BRIEF_LOCKED_FIELD');
    }
    if (existing.lock === lock) return this.get(briefId);
    const nextDraft = assertContentBriefDraft({
      ...draft,
      fieldStates: draft.fieldStates.map((state) =>
        state.path === fieldPath
          ? {
              ...state,
              lock,
              provenance: lock === 'USER_LOCKED' ? 'USER_CONFIRMED' : state.provenance,
            }
          : state,
      ),
    });
    const readiness = this.#readinessFromVersion(current, now);
    this.#appendVersionAndSwitch(
      root,
      nextDraft,
      this.#loadDependencies(current.id),
      readiness,
      'USER_CONFIRMED',
      lock === 'USER_LOCKED' ? 'LOCK_FIELD' : 'UNLOCK_FIELD',
      'USER',
      now,
    );
    return this.get(briefId);
  }

  public undo(
    briefIdValue: string,
    expectedRevisionValue: number,
    targetVersionIdValue: string,
    nowValue: string,
  ): BriefDetailView {
    const briefId = identifier(briefIdValue);
    const targetVersionId = identifier(targetVersionIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1, 2_147_483_647);
    const now = iso(nowValue);
    const root = this.#requireRoot(briefId);
    if (root.brief_revision !== expectedRevision) {
      throw new BriefError('BRIEF_STALE_REVISION', true);
    }
    const target = this.#requireVersion(targetVersionId);
    if (target.brief_id !== briefId) throw new BriefError('BRIEF_NOT_FOUND');
    const draft = parseDraft(target.payload_json);
    this.#appendVersionAndSwitch(
      root,
      draft,
      this.#loadDependencies(target.id),
      this.#readinessFromVersion(target, now),
      'USER_CONFIRMED',
      'UNDO',
      'USER',
      now,
    );
    return this.get(briefId);
  }

  public cloneVersion(
    briefIdValue: string,
    expectedRevisionValue: number,
    targetVersionIdValue: string,
    nowValue: string,
  ): BriefDetailView {
    const briefId = identifier(briefIdValue);
    const targetVersionId = identifier(targetVersionIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1, 2_147_483_647);
    const now = iso(nowValue);
    const root = this.#requireRoot(briefId);
    if (root.brief_revision !== expectedRevision) {
      throw new BriefError('BRIEF_STALE_REVISION', true);
    }
    const target = this.#requireVersion(targetVersionId);
    if (target.brief_id !== briefId) throw new BriefError('BRIEF_NOT_FOUND');
    const draft = parseDraft(target.payload_json);
    this.#appendVersionAndSwitch(
      root,
      draft,
      this.#loadDependencies(target.id),
      this.#readinessFromVersion(target, now),
      'DRAFT',
      'CLONE',
      'USER',
      now,
    );
    return this.get(briefId);
  }

  public setArchived(
    briefIdValue: string,
    expectedRevisionValue: number,
    archived: boolean,
    nowValue: string,
  ): BriefDetailView {
    const briefId = identifier(briefIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1, 2_147_483_647);
    const now = iso(nowValue);
    const root = this.#requireRoot(briefId);
    if (root.brief_revision !== expectedRevision) {
      throw new BriefError('BRIEF_STALE_REVISION', true);
    }
    const next = archived ? 'ARCHIVED' : 'ACTIVE';
    if (root.brief_state === next) return this.get(briefId);
    runInTransaction(this.#database, () => {
      const changed = this.#database
        .prepare(
          `UPDATE content_briefs
           SET brief_state = ?, brief_revision = brief_revision + 1,
               status = ?, updated_at = ?
           WHERE id = ? AND brief_revision = ?`,
        )
        .run(next, archived ? 'ARCHIVED' : 'RESEARCHING', now, briefId, expectedRevision);
      if (changed.changes !== 1) throw new BriefError('BRIEF_STALE_REVISION', true);
      this.#appendTransition(
        briefId,
        root.current_version_id,
        expectedRevision + 1,
        this.#lastTransitionId(briefId),
        archived ? 'ARCHIVE' : 'RESTORE',
        root.brief_state,
        next,
        expectedRevision,
        'USER',
        archived ? 'USER_ARCHIVED' : 'USER_RESTORED',
        now,
      );
      this.#audit(
        briefId,
        root.current_version_id,
        'STATE_CHANGED',
        'USER',
        { from: root.brief_state, to: next },
        now,
      );
    });
    return this.get(briefId);
  }

  public diffVersions(
    briefIdValue: string,
    fromVersionIdValue: string,
    toVersionIdValue: string,
  ): BriefVersionDiff {
    const briefId = identifier(briefIdValue);
    const from = this.#requireVersion(identifier(fromVersionIdValue));
    const to = this.#requireVersion(identifier(toVersionIdValue));
    if (from.brief_id !== briefId || to.brief_id !== briefId) {
      throw new BriefError('BRIEF_NOT_FOUND');
    }
    return Object.freeze({
      changedFields: changeKinds(parseDraft(to.payload_json), parseDraft(from.payload_json)),
      fromVersionId: from.id,
      toVersionId: to.id,
    });
  }

  public previewGeneration(
    briefIdValue: string,
    expectedRevisionValue: number,
    capabilityState: BriefGenerationPlan['capabilityState'],
    budgetState: BriefGenerationPlan['budgetState'],
    nowValue: string,
  ): BriefGenerationPlan {
    const briefId = identifier(briefIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1, 2_147_483_647);
    const now = iso(nowValue);
    const root = this.#requireRoot(briefId);
    if (root.brief_revision !== expectedRevision) {
      throw new BriefError('BRIEF_STALE_REVISION', true);
    }
    const current = this.#requireVersion(root.current_version_id);
    if (
      current.readiness_status !== 'READY_FOR_DRAFT_GENERATION' ||
      this.#hasInvalidations(current.id)
    ) {
      throw new BriefError('BRIEF_NOT_READY');
    }
    const plan = createBriefGenerationPlan({
      briefId,
      budgetState,
      capabilityState,
      dependencyHash: current.dependency_hash,
      draft: parseDraft(current.payload_json),
      expectedBriefRevision: expectedRevision,
      expectedVersionId: current.id,
      expiresAt: new Date(Date.parse(now) + BRIEF_LIMITS.confirmationTtlMs).toISOString(),
      planId: this.#idFactory(),
    });
    const lockSnapshotHash = current.lock_snapshot_hash;
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO content_brief_generation_plans(
             id, brief_id, version_id, expected_brief_revision, capability_state, budget_state,
             input_hash, dependency_hash, lock_snapshot_hash, preview_hash,
             input_character_count, maximum_output_bytes, maximum_model_requests,
             evidence_ref_count, locked_field_count, editable_field_count,
             subject_ids_json, write_set_json, status, expires_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'PREVIEWED', ?, ?)`,
        )
        .run(
          plan.planId,
          briefId,
          current.id,
          expectedRevision,
          capabilityState,
          budgetState,
          plan.inputHash,
          plan.dependencyHash,
          lockSnapshotHash,
          plan.previewHash,
          plan.inputCharacterCount,
          plan.maximumOutputBytes,
          plan.evidenceRefCount,
          plan.lockedFieldCount,
          plan.editableFieldCount,
          JSON.stringify(plan.subjectIds),
          JSON.stringify(plan.writeSet),
          plan.expiresAt,
          now,
        );
      this.#audit(
        briefId,
        current.id,
        'GENERATION_PREVIEWED',
        'USER',
        {
          capabilityState,
          budgetState,
          maximumModelRequests: 1,
          planId: plan.planId,
        },
        now,
      );
    });
    return plan;
  }

  public confirmGeneration(
    planIdValue: string,
    previewHashValue: string,
    executionIdValue: string,
    nowValue: string,
  ): { readonly payload: BriefGenerationJobPayload; readonly run: BriefGenerationRun } {
    const planId = identifier(planIdValue);
    const previewHash = identifier(previewHashValue, 64);
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    const replay = this.#findRun(executionId);
    if (replay !== null) {
      const row = this.#database
        .prepare(
          `SELECT
             plan.id, plan.brief_id, plan.version_id, plan.expected_brief_revision,
             plan.input_hash, plan.lock_snapshot_hash, plan.preview_hash
           FROM content_brief_generation_plans AS plan
           JOIN content_brief_generation_runs AS run ON run.plan_id = plan.id
           WHERE run.execution_id = ?`,
        )
        .get(executionId) as {
        readonly brief_id: string;
        readonly expected_brief_revision: number;
        readonly input_hash: string;
        readonly id: string;
        readonly lock_snapshot_hash: string;
        readonly preview_hash: string;
        readonly version_id: string;
      };
      if (row.id !== planId || row.preview_hash !== previewHash) {
        throw new BriefError('BRIEF_CONFIRMATION_INVALID');
      }
      return Object.freeze({
        payload: Object.freeze({
          briefId: row.brief_id,
          contractVersion: 'content-brief-generation-v1',
          executionId,
          expectedBriefRevision: row.expected_brief_revision,
          expectedVersionId: row.version_id,
          inputHash: row.input_hash,
          lockSnapshotHash: row.lock_snapshot_hash,
          planId: row.id,
          previewHash: row.preview_hash,
        }),
        run: replay,
      });
    }
    const planRow = this.#database
      .prepare(
        `SELECT
           id, brief_id, version_id, expected_brief_revision, capability_state, budget_state,
           input_hash, dependency_hash, lock_snapshot_hash, preview_hash,
           expires_at, status
         FROM content_brief_generation_plans
         WHERE id = ?`,
      )
      .get(planId) as
      | {
          readonly brief_id: string;
          readonly budget_state: BriefGenerationPlan['budgetState'];
          readonly capability_state: BriefGenerationPlan['capabilityState'];
          readonly dependency_hash: string;
          readonly expected_brief_revision: number;
          readonly expires_at: string;
          readonly id: string;
          readonly input_hash: string;
          readonly lock_snapshot_hash: string;
          readonly preview_hash: string;
          readonly status: string;
          readonly version_id: string;
        }
      | undefined;
    if (
      planRow === undefined ||
      planRow.preview_hash !== previewHash ||
      planRow.status !== 'PREVIEWED' ||
      planRow.expires_at <= now
    ) {
      throw new BriefError('BRIEF_CONFIRMATION_INVALID');
    }
    if (planRow.capability_state !== 'SUPPORTED' || planRow.budget_state !== 'AVAILABLE') {
      throw new BriefError('BRIEF_INVALID_GENERATION');
    }
    const root = this.#requireRoot(planRow.brief_id);
    const current = this.#requireVersion(root.current_version_id);
    if (
      root.brief_revision !== planRow.expected_brief_revision ||
      current.id !== planRow.version_id ||
      current.dependency_hash !== planRow.dependency_hash ||
      current.lock_snapshot_hash !== planRow.lock_snapshot_hash ||
      this.#hasInvalidations(current.id)
    ) {
      throw new BriefError('BRIEF_STALE_REVISION', true);
    }
    const runId = this.#idFactory();
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO content_brief_generation_runs(
             id, brief_id, plan_id, job_id, execution_id, input_hash,
             lock_snapshot_hash, status, external_request_count, cost_state,
             result_version_id, stable_error_code, revision, created_at, updated_at
           ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'CONFIRMED', 0, 'NOT_INCURRED',
                     NULL, NULL, 1, ?, ?)`,
        )
        .run(
          runId,
          root.id,
          planId,
          executionId,
          current.input_hash,
          current.lock_snapshot_hash,
          now,
          now,
        );
      this.#database
        .prepare(
          `UPDATE content_brief_generation_plans SET status = 'CONFIRMED'
           WHERE id = ? AND status = 'PREVIEWED'`,
        )
        .run(planId);
      this.#audit(
        root.id,
        current.id,
        'GENERATION_CONFIRMED',
        'USER',
        { executionId, planId },
        now,
        runId,
      );
    });
    const payload = Object.freeze({
      briefId: root.id,
      contractVersion: 'content-brief-generation-v1' as const,
      executionId,
      expectedBriefRevision: root.brief_revision,
      expectedVersionId: current.id,
      inputHash: planRow.input_hash,
      lockSnapshotHash: current.lock_snapshot_hash,
      planId,
      previewHash,
    });
    return Object.freeze({ payload, run: this.#requireRun(executionId) });
  }

  public loadGenerationExecution(executionIdValue: string): BriefGenerationExecution {
    const executionId = identifier(executionIdValue);
    const row = this.#database
      .prepare(
        `SELECT
           run.id, run.brief_id, run.execution_id, run.plan_id, run.status,
           run.external_request_count, run.cost_state, run.result_version_id,
           run.stable_error_code, run.revision,
           plan.version_id, plan.expected_brief_revision, plan.capability_state, plan.budget_state,
           plan.input_hash, plan.dependency_hash, plan.preview_hash,
           plan.input_character_count, plan.maximum_output_bytes,
           plan.maximum_model_requests, plan.evidence_ref_count,
           plan.locked_field_count, plan.editable_field_count,
           plan.subject_ids_json, plan.write_set_json, plan.expires_at,
           brief.topic_id, brief.topic_version_id, brief.profile_id,
           version.payload_json
         FROM content_brief_generation_runs AS run
         JOIN content_brief_generation_plans AS plan ON plan.id = run.plan_id
         JOIN content_briefs AS brief ON brief.id = run.brief_id
         JOIN content_brief_versions AS version ON version.id = plan.version_id
         WHERE run.execution_id = ?`,
      )
      .get(executionId) as
      | {
          readonly brief_id: string;
          readonly budget_state: BriefGenerationPlan['budgetState'];
          readonly capability_state: BriefGenerationPlan['capabilityState'];
          readonly cost_state: BriefGenerationRun['costState'];
          readonly dependency_hash: string;
          readonly editable_field_count: number;
          readonly evidence_ref_count: number;
          readonly execution_id: string;
          readonly expires_at: string;
          readonly expected_brief_revision: number;
          readonly external_request_count: 0 | 1;
          readonly input_character_count: number;
          readonly input_hash: string;
          readonly id: string;
          readonly locked_field_count: number;
          readonly maximum_model_requests: 1;
          readonly maximum_output_bytes: number;
          readonly payload_json: string;
          readonly plan_id: string;
          readonly preview_hash: string;
          readonly profile_id: BriefProfileId;
          readonly result_version_id: string | null;
          readonly revision: number;
          readonly stable_error_code: string | null;
          readonly status: BriefGenerationRun['status'];
          readonly subject_ids_json: string;
          readonly topic_id: string;
          readonly topic_version_id: string;
          readonly version_id: string;
          readonly write_set_json: string;
        }
      | undefined;
    if (row === undefined) throw new BriefError('BRIEF_NOT_FOUND');
    const plan = Object.freeze({
      briefId: row.brief_id,
      budgetState: row.budget_state,
      capabilityState: row.capability_state,
      contractVersion: 'content-brief-generation-v1' as const,
      dependencyHash: row.dependency_hash,
      editableFieldCount: row.editable_field_count,
      evidenceRefCount: row.evidence_ref_count,
      expiresAt: row.expires_at,
      expectedBriefRevision: row.expected_brief_revision,
      expectedVersionId: row.version_id,
      inputCharacterCount: row.input_character_count,
      inputHash: row.input_hash,
      lockedFieldCount: row.locked_field_count,
      maximumInputCharacters: BRIEF_LIMITS.maxInputCharacters,
      maximumModelRequests: row.maximum_model_requests,
      maximumOutputBytes: row.maximum_output_bytes,
      planId: row.plan_id,
      previewHash: row.preview_hash,
      profileId: row.profile_id,
      subjectIds: parseStrings(row.subject_ids_json),
      topicId: row.topic_id,
      topicVersionId: row.topic_version_id,
      writeSet: parseStrings(row.write_set_json),
    });
    return Object.freeze({
      draft: parseDraft(row.payload_json),
      plan,
      run: this.#runView(row),
    });
  }

  public markGenerationRunning(executionIdValue: string, nowValue: string): BriefGenerationRun {
    return this.#updateRun(executionIdValue, ['CONFIRMED', 'PAUSED'], 'RUNNING', nowValue, {
      costState: 'UNKNOWN_POSSIBLY_INCURRED',
      errorCode: null,
      externalRequestCount: 1,
      resultVersionId: null,
    });
  }

  public publishModelCandidate(
    executionIdValue: string,
    candidateValue: unknown,
    _context: BriefReadinessContext,
    externalRequestCount: 0 | 1,
    costState: BriefGenerationRun['costState'],
    nowValue: string,
  ): BriefGenerationRun {
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    const execution = this.loadGenerationExecution(executionId);
    const root = this.#requireRoot(execution.run.briefId);
    const current = this.#requireVersion(root.current_version_id);
    if (
      root.brief_revision !== execution.plan.expectedBriefRevision ||
      current.id !== execution.plan.expectedVersionId ||
      current.lock_snapshot_hash !== briefSemanticHash(execution.draft.fieldStates) ||
      current.dependency_hash !== execution.plan.dependencyHash ||
      this.#hasInvalidations(current.id)
    ) {
      throw new BriefError('BRIEF_STALE_REVISION', true);
    }
    const merged = applyBriefModelCandidate(execution.draft, candidateValue);
    assertLockedFieldsPreserved(execution.draft, merged.draft);
    if (merged.noOp) {
      this.#updateRun(executionId, ['RUNNING', 'CONFIRMED'], 'NO_OP', now, {
        costState,
        errorCode: null,
        externalRequestCount,
        resultVersionId: current.id,
      });
      this.#audit(
        root.id,
        current.id,
        'GENERATION_NO_OP',
        'LOCAL_SYSTEM',
        { executionId },
        now,
        this.#runId(executionId),
      );
      return this.#requireRun(executionId);
    }
    const readiness = evaluateBriefReadiness(
      merged.draft,
      this.deriveReadinessContext(merged.draft),
      now,
    );
    const nextVersionId = this.#idFactory();
    runInTransaction(this.#database, () => {
      this.#insertVersion({
        briefId: root.id,
        dependencies: this.#loadDependencies(current.id),
        draft: merged.draft,
        now,
        previousVersionId: current.id,
        readiness,
        status: 'MODEL_CANDIDATE',
        versionId: nextVersionId,
        versionNumber: current.version_number + 1,
      });
      const updated = this.#database
        .prepare(
          `UPDATE content_briefs
           SET current_version_id = ?, brief_revision = brief_revision + 1,
               target_reader = ?, core_judgment = ?, counterpoints_json = ?,
               spoiler_level = ?, required_claim_ids_json = ?, score_type = ?,
               forbidden_phrases_json = ?, status = ?, updated_at = ?
           WHERE id = ? AND brief_revision = ? AND current_version_id = ?`,
        )
        .run(
          nextVersionId,
          merged.draft.targetAudience.readerDescription ?? '待补充目标读者',
          merged.draft.coreJudgment.statement ?? '待确认中心判断',
          JSON.stringify(
            merged.draft.strongestCounterargument === null
              ? []
              : [merged.draft.strongestCounterargument.statement],
          ),
          spoilerCompatibility(merged.draft),
          JSON.stringify([...new Set(merged.draft.evidenceMap.map((ref) => ref.claimId))]),
          scoreCompatibility(merged.draft),
          JSON.stringify(merged.draft.forbiddenExpressions.map((item) => item.phrase)),
          rootStatus(readiness.status),
          now,
          root.id,
          root.brief_revision,
          current.id,
        );
      if (updated.changes !== 1) throw new BriefError('BRIEF_STALE_REVISION', true);
      this.#database
        .prepare(
          `UPDATE content_brief_generation_runs
           SET status = 'SUCCEEDED', external_request_count = ?, cost_state = ?,
               result_version_id = ?, stable_error_code = NULL,
               revision = revision + 1, updated_at = ?
           WHERE execution_id = ? AND status IN ('RUNNING', 'CONFIRMED')`,
        )
        .run(externalRequestCount, costState, nextVersionId, now, executionId);
      this.#appendTransition(
        root.id,
        nextVersionId,
        root.brief_revision + 1,
        this.#lastTransitionId(root.id),
        'MODEL_CANDIDATE_PUBLISHED',
        root.brief_state,
        root.brief_state,
        root.brief_revision,
        'LOCAL_SYSTEM',
        'STRICT_CANDIDATE_VALIDATED',
        now,
      );
      this.#audit(
        root.id,
        nextVersionId,
        'MODEL_CANDIDATE_PUBLISHED',
        'LOCAL_SYSTEM',
        { executionId, readiness: readiness.status },
        now,
        this.#runId(executionId),
      );
    });
    return this.#requireRun(executionId);
  }

  public stopGeneration(
    executionIdValue: string,
    status: 'PAUSED' | 'CANCELLED' | 'FAILED' | 'AMBIGUOUS',
    errorCodeValue: string,
    externalRequestCount: 0 | 1,
    costState: BriefGenerationRun['costState'],
    nowValue: string,
  ): BriefGenerationRun {
    const executionId = identifier(executionIdValue);
    const errorCode = identifier(errorCodeValue, 128);
    const now = iso(nowValue);
    return this.#updateRun(
      executionId,
      status === 'PAUSED' ? ['CONFIRMED', 'RUNNING'] : ['CONFIRMED', 'RUNNING', 'PAUSED'],
      status,
      now,
      { costState, errorCode, externalRequestCount, resultVersionId: null },
    );
  }

  public markGenerationQueued(
    executionIdValue: string,
    jobIdValue: string,
    nowValue: string,
  ): BriefGenerationRun {
    const executionId = identifier(executionIdValue);
    const jobId = identifier(jobIdValue);
    const now = iso(nowValue);
    const result = this.#database
      .prepare(
        `UPDATE content_brief_generation_runs
         SET job_id = ?, revision = revision + 1, updated_at = ?
         WHERE execution_id = ? AND status = 'CONFIRMED' AND job_id IS NULL`,
      )
      .run(jobId, now, executionId);
    if (result.changes !== 1) {
      const existing = this.#database
        .prepare(
          `SELECT job_id FROM content_brief_generation_runs
           WHERE execution_id = ? AND status = 'CONFIRMED'`,
        )
        .get(executionId) as { readonly job_id: string | null } | undefined;
      if (existing?.job_id !== jobId) throw new BriefError('BRIEF_CONFLICT');
    }
    return this.#requireRun(executionId);
  }

  public cancelGeneration(
    runIdValue: string,
    expectedRevisionValue: number,
    nowValue: string,
  ): { readonly jobId: string | null; readonly run: BriefGenerationRun } {
    const runId = identifier(runIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1, 2_147_483_647);
    const now = iso(nowValue);
    const row = this.#database
      .prepare(
        `SELECT execution_id, job_id, status, revision
         FROM content_brief_generation_runs WHERE id = ?`,
      )
      .get(runId) as
      | {
          readonly execution_id: string;
          readonly job_id: string | null;
          readonly revision: number;
          readonly status: BriefGenerationRun['status'];
        }
      | undefined;
    if (row === undefined) throw new BriefError('BRIEF_NOT_FOUND');
    if (row.revision !== expectedRevision) throw new BriefError('BRIEF_STALE_REVISION', true);
    if (['SUCCEEDED', 'NO_OP', 'CANCELLED', 'FAILED', 'AMBIGUOUS'].includes(row.status)) {
      return Object.freeze({ jobId: row.job_id, run: this.#requireRun(row.execution_id) });
    }
    if (row.status === 'RUNNING') {
      return Object.freeze({ jobId: row.job_id, run: this.#requireRun(row.execution_id) });
    }
    const result = this.#database
      .prepare(
        `UPDATE content_brief_generation_runs
         SET status = 'CANCELLED', stable_error_code = 'USER_CANCELLED_BEFORE_SEND',
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND status IN ('CONFIRMED', 'PAUSED')`,
      )
      .run(now, runId, expectedRevision);
    if (result.changes !== 1) throw new BriefError('BRIEF_CONFLICT');
    return Object.freeze({ jobId: row.job_id, run: this.#requireRun(row.execution_id) });
  }

  public recoverInterrupted(nowValue: string): {
    readonly ambiguous: number;
    readonly preSendRecoverable: number;
  } {
    const now = iso(nowValue);
    return runInTransaction(this.#database, () => {
      const ambiguous = this.#database
        .prepare(
          `UPDATE content_brief_generation_runs
           SET status = 'AMBIGUOUS', cost_state = 'UNKNOWN_POSSIBLY_INCURRED',
               stable_error_code = 'INTERRUPTED_AFTER_SEND',
               revision = revision + 1, updated_at = ?
           WHERE status = 'RUNNING' AND external_request_count = 1`,
        )
        .run(now).changes;
      const recoverable = this.#database
        .prepare(
          `UPDATE content_brief_generation_runs
           SET status = 'CONFIRMED', stable_error_code = 'RECOVERED_BEFORE_SEND',
               revision = revision + 1, updated_at = ?
           WHERE status = 'RUNNING' AND external_request_count = 0`,
        )
        .run(now).changes;
      return Object.freeze({
        ambiguous: Number(ambiguous),
        preSendRecoverable: Number(recoverable),
      });
    });
  }

  public invalidateDependency(input: {
    readonly dependencyId: string;
    readonly dependencyType: BriefDependency['dependencyType'];
    readonly observedRevision: string;
    readonly reasonCode: string;
    readonly eventIdentity: string;
    readonly createdAt: string;
  }): number {
    const createdAt = iso(input.createdAt);
    const rows = this.#database
      .prepare(
        `SELECT brief_id, version_id
         FROM content_brief_dependencies
         WHERE dependency_type = ? AND dependency_id = ?
         ORDER BY brief_id, version_id
         LIMIT ?`,
      )
      .all(
        input.dependencyType,
        identifier(input.dependencyId, 1_024),
        BRIEF_LIMITS.dependencies,
      ) as unknown as readonly { readonly brief_id: string; readonly version_id: string }[];
    return runInTransaction(this.#database, () => {
      let inserted = 0;
      for (const row of rows) {
        const result = this.#database
          .prepare(
            `INSERT OR IGNORE INTO content_brief_invalidations(
               id, event_identity, brief_id, version_id, dependency_type,
               dependency_id, observed_revision, reason_code, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.#idFactory(),
            `${identifier(input.eventIdentity, 1_024)}:${row.version_id}`,
            row.brief_id,
            row.version_id,
            input.dependencyType,
            input.dependencyId,
            identifier(input.observedRevision),
            identifier(input.reasonCode, 128),
            createdAt,
          );
        inserted += Number(result.changes);
      }
      return inserted;
    });
  }

  #appendVersionAndSwitch(
    root: BriefRootRow,
    draft: ContentBriefDraft,
    dependencies: readonly BriefDependency[],
    readiness: BriefReadinessSnapshot,
    status: BriefVersionState,
    action: string,
    actor: 'USER' | 'LOCAL_SYSTEM',
    now: string,
  ): void {
    const current = this.#requireVersion(root.current_version_id);
    if (briefSemanticHash(draft) === briefSemanticHash(parseDraft(current.payload_json))) return;
    const versionId = this.#idFactory();
    runInTransaction(this.#database, () => {
      this.#insertVersion({
        briefId: root.id,
        dependencies,
        draft,
        now,
        previousVersionId: current.id,
        readiness,
        status,
        versionId,
        versionNumber: current.version_number + 1,
      });
      const changed = this.#database
        .prepare(
          `UPDATE content_briefs
           SET current_version_id = ?, brief_revision = brief_revision + 1,
               target_reader = ?, core_judgment = ?, counterpoints_json = ?,
               spoiler_level = ?, required_claim_ids_json = ?, score_type = ?,
               forbidden_phrases_json = ?, status = ?, updated_at = ?
           WHERE id = ? AND brief_revision = ? AND current_version_id = ?`,
        )
        .run(
          versionId,
          draft.targetAudience.readerDescription ?? '待补充目标读者',
          draft.coreJudgment.statement ?? '待确认中心判断',
          JSON.stringify(
            draft.strongestCounterargument === null
              ? []
              : [draft.strongestCounterargument.statement],
          ),
          spoilerCompatibility(draft),
          JSON.stringify([...new Set(draft.evidenceMap.map((ref) => ref.claimId))]),
          scoreCompatibility(draft),
          JSON.stringify(draft.forbiddenExpressions.map((item) => item.phrase)),
          rootStatus(readiness.status),
          now,
          root.id,
          root.brief_revision,
          current.id,
        );
      if (changed.changes !== 1) throw new BriefError('BRIEF_STALE_REVISION', true);
      this.#appendTransition(
        root.id,
        versionId,
        root.brief_revision + 1,
        this.#lastTransitionId(root.id),
        action,
        root.brief_state,
        root.brief_state,
        root.brief_revision,
        actor,
        action,
        now,
      );
      this.#audit(
        root.id,
        versionId,
        action === 'SAVE_EDIT'
          ? 'EDIT_SAVED'
          : action === 'LOCK_FIELD'
            ? 'FIELD_LOCKED'
            : action === 'UNLOCK_FIELD'
              ? 'FIELD_UNLOCKED'
              : action === 'UNDO'
                ? 'VERSION_UNDONE'
                : 'VERSION_CLONED',
        actor,
        { previousVersionId: current.id },
        now,
      );
    });
  }

  #insertVersion(input: {
    readonly briefId: string;
    readonly dependencies: readonly BriefDependency[];
    readonly draft: ContentBriefDraft;
    readonly now: string;
    readonly previousVersionId: string | null;
    readonly readiness: BriefReadinessSnapshot;
    readonly status: BriefVersionState;
    readonly versionId: string;
    readonly versionNumber: number;
  }): void {
    const dependencyHash = briefSemanticHash(input.dependencies);
    const inputHash = briefSemanticHash({
      dependencies: input.dependencies,
      draft: input.draft,
    });
    const lockHash = briefSemanticHash(input.draft.fieldStates);
    this.#database
      .prepare(
        `INSERT INTO content_brief_versions(
           id, brief_id, version_number, previous_version_id, schema_version,
           profile_version, readiness_policy_version, prompt_version,
           payload_json, status, readiness_status, readiness_reason_codes_json,
           dependency_hash, input_hash, lock_snapshot_hash, warnings_json,
           created_at, confirmed_at, locked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
      )
      .run(
        input.versionId,
        input.briefId,
        input.versionNumber,
        input.previousVersionId,
        CONTENT_BRIEF_SCHEMA_VERSION,
        CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
        CONTENT_BRIEF_READINESS_POLICY_VERSION,
        CONTENT_BRIEF_GENERATION_PROMPT_VERSION,
        canonicalBriefJson(input.draft),
        input.status,
        input.readiness.status,
        JSON.stringify(input.readiness.reasonCodes),
        dependencyHash,
        inputHash,
        lockHash,
        input.now,
        input.status === 'USER_CONFIRMED' ? input.now : null,
        input.draft.fieldStates.some((state) => state.lock === 'USER_LOCKED') ? input.now : null,
      );
    const insertSubject = this.#database.prepare(
      `INSERT INTO content_brief_subjects(
         version_id, ordinal, subject_type, subject_id, work_id,
         expression_id, edition_id, expression_form, role
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.draft.subjects.forEach((subject, ordinal) =>
      insertSubject.run(
        input.versionId,
        ordinal,
        subject.subjectType,
        subject.subjectId,
        subject.workId,
        subject.expressionId,
        subject.editionId,
        subject.expressionForm,
        subject.role,
      ),
    );
    this.#database
      .prepare(
        `INSERT INTO content_brief_audiences(
           version_id, reader_description, knowledge_level, selection_need
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.versionId,
        input.draft.targetAudience.readerDescription,
        input.draft.targetAudience.knowledgeLevel,
        input.draft.targetAudience.selectionNeed,
      );
    this.#database
      .prepare(
        `INSERT INTO content_brief_objectives(
           version_id, reader_outcome, scope_boundary
         ) VALUES (?, ?, ?)`,
      )
      .run(
        input.versionId,
        input.draft.contentObjective.readerOutcome,
        input.draft.contentObjective.scopeBoundary,
      );
    this.#database
      .prepare(
        `INSERT INTO content_brief_judgments(
           version_id, judgment_kind, statement, qualification
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.versionId,
        input.draft.coreJudgment.kind,
        input.draft.coreJudgment.statement,
        input.draft.coreJudgment.qualification,
      );
    const insertArgument = this.#database.prepare(
      `INSERT INTO content_brief_arguments(
         version_id, argument_id, argument_role, argument_kind,
         statement, limitation, response_or_qualification,
         subject_ids_json, evidence_ref_ids_json, ordinal
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.draft.supportingArguments.forEach((argument, ordinal) =>
      insertArgument.run(
        input.versionId,
        argument.argumentId,
        'SUPPORTING',
        argument.kind,
        argument.statement,
        argument.limitation,
        null,
        JSON.stringify(argument.subjectIds),
        JSON.stringify(argument.evidenceRefIds),
        ordinal + 1,
      ),
    );
    if (input.draft.strongestCounterargument !== null) {
      const counter = input.draft.strongestCounterargument;
      insertArgument.run(
        input.versionId,
        counter.argumentId,
        'COUNTERARGUMENT',
        counter.kind,
        counter.statement,
        counter.limitation,
        counter.responseOrQualification,
        JSON.stringify(counter.subjectIds),
        JSON.stringify(counter.evidenceRefIds),
        0,
      );
    }
    const insertEvidence = this.#database.prepare(
      `INSERT INTO content_brief_evidence_refs(
         id, version_id, field_path, evidence_role, dossier_id,
         dossier_version_id, dossier_entry_id, claim_id, fact_evaluation_id,
         evidence_locator_id, source_revision_id, source_id, source_revision,
         fact_status, display_summary, source_language, is_current,
         locator_valid, dependency_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const ref of input.draft.evidenceMap) {
      const source = this.#database
        .prepare(
          `SELECT source_id, source_revision
           FROM claim_evidence WHERE id = ? AND claim_id = ?`,
        )
        .get(ref.evidenceLocatorId, ref.claimId) as
        { readonly source_id: string; readonly source_revision: number } | undefined;
      if (source === undefined) throw new BriefError('BRIEF_INVALID_EVIDENCE');
      insertEvidence.run(
        ref.refId,
        input.versionId,
        ref.fieldPath,
        ref.role,
        ref.dossierId,
        ref.dossierVersionId,
        ref.dossierEntryId,
        ref.claimId,
        ref.factEvaluationId,
        ref.evidenceLocatorId,
        ref.sourceRevisionId,
        source.source_id,
        source.source_revision,
        ref.factStatus,
        ref.displaySummary,
        ref.sourceLanguage,
        ref.current ? 1 : 0,
        ref.locatorValid ? 1 : 0,
        ref.dependencyHash,
      );
    }
    const insertSlot = this.#database.prepare(
      `INSERT INTO content_brief_structure_slots(
         version_id, slot_id, ordinal, slot_function, required,
         subject_ids_json, comparison_dimension
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    input.draft.structurePlan.slots.forEach((slot, ordinal) =>
      insertSlot.run(
        input.versionId,
        slot.slotId,
        ordinal,
        slot.function,
        slot.required ? 1 : 0,
        JSON.stringify(slot.subjectIds),
        input.draft.structurePlan.comparisonDimension,
      ),
    );
    const spoiler = input.draft.spoilerPlan;
    this.#database
      .prepare(
        `INSERT INTO content_brief_spoiler_plans(
           version_id, spoiler_level, warning_required, warning_placement,
           reveal_core_trick, reveal_ending, user_confirmation_required, user_confirmed
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.versionId,
        spoiler.level,
        spoiler.warningRequired ? 1 : 0,
        spoiler.warningPlacement,
        spoiler.revealCoreTrick ? 1 : 0,
        spoiler.revealEnding ? 1 : 0,
        spoiler.userConfirmationRequired ? 1 : 0,
        spoiler.userConfirmed ? 1 : 0,
      );
    const score = input.draft.scorePlan;
    this.#database
      .prepare(
        `INSERT INTO content_brief_score_plans(
           version_id, score_kind, scale, value_source_id,
           public_label_required, public_label
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.versionId,
        score.kind,
        score.scale,
        score.valueSourceId,
        score.publicLabelRequired ? 1 : 0,
        score.publicLabel,
      );
    const expression = input.draft.expressionPolicy;
    this.#database
      .prepare(
        `INSERT INTO content_brief_expression_policies(
           version_id, expression_mode, reading_state, permission_snapshot_id,
           permission_revision, permission_current, first_person_allowed,
           r2_assertion_ids_json, allowed_assertion_ids_json,
           required_public_labels_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.versionId,
        expression.mode,
        expression.readingState,
        expression.permissionSnapshotId,
        expression.permissionRevision,
        expression.permissionCurrent ? 1 : 0,
        expression.firstPersonAllowed ? 1 : 0,
        JSON.stringify(expression.r2AssertionIds),
        JSON.stringify(expression.allowedAssertionIds),
        JSON.stringify(expression.requiredPublicLabels),
      );
    const binding = input.draft.experimentBinding;
    if (binding !== null) {
      this.#database
        .prepare(
          `INSERT INTO content_brief_experiment_bindings(
             version_id, experiment_id, design_version_id, assignment_plan_id,
             topic_id, topic_version_id, work_id, arm_id, arm_value_identity,
             structure_fingerprint, controlled_conditions_json, popularity_stratum,
             design_current, assignment_current, experiment_locked, experiment_stale
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.versionId,
          binding.experimentId,
          binding.designVersionId,
          binding.assignmentPlanId,
          binding.topicId,
          binding.topicVersionId,
          binding.workId,
          binding.armId,
          binding.armValueIdentity,
          binding.structureFingerprint,
          JSON.stringify(binding.controlledConditions),
          binding.popularityStratum,
          binding.designCurrent ? 1 : 0,
          binding.assignmentCurrent ? 1 : 0,
          binding.experimentLocked ? 1 : 0,
          binding.experimentStale ? 1 : 0,
        );
    }
    const insertForbidden = this.#database.prepare(
      `INSERT INTO content_brief_forbidden_expressions(
         version_id, expression_id, category, phrase, reason,
         policy_version, system_rule
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of input.draft.forbiddenExpressions) {
      insertForbidden.run(
        input.versionId,
        item.expressionId,
        item.category,
        item.phrase,
        item.reason,
        item.policyVersion,
        item.system ? 1 : 0,
      );
    }
    const insertField = this.#database.prepare(
      `INSERT INTO content_brief_field_states(
         version_id, field_path, provenance, lock_state, value_hash
       ) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const field of input.draft.fieldStates) {
      const value = input.draft[field.path as keyof ContentBriefDraft] ?? field.path;
      insertField.run(
        input.versionId,
        field.path,
        field.provenance,
        field.lock,
        briefSemanticHash(value),
      );
    }
    const insertDependency = this.#database.prepare(
      `INSERT INTO content_brief_dependencies(
         id, brief_id, version_id, dependency_type, dependency_id,
         observed_revision, dependency_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const dependency of input.dependencies) {
      insertDependency.run(
        this.#idFactory(),
        input.briefId,
        input.versionId,
        dependency.dependencyType,
        dependency.dependencyId,
        dependency.observedRevision,
        dependency.dependencyHash,
        input.now,
      );
    }
    this.#database
      .prepare(
        `INSERT INTO content_brief_readiness_snapshots(
           id, brief_id, version_id, readiness_status, reason_codes_json,
           policy_version, evaluated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#idFactory(),
        input.briefId,
        input.versionId,
        input.readiness.status,
        JSON.stringify(input.readiness.reasonCodes),
        CONTENT_BRIEF_READINESS_POLICY_VERSION,
        input.readiness.evaluatedAt,
      );
  }

  #readinessFromVersion(version: BriefVersionRow, now: string): BriefReadinessSnapshot {
    return Object.freeze({
      evaluatedAt: now,
      policyVersion: CONTENT_BRIEF_READINESS_POLICY_VERSION,
      reasonCodes: parseStrings(version.readiness_reason_codes_json),
      status: version.readiness_status,
    });
  }

  #validateDependencies(value: readonly BriefDependency[]): readonly BriefDependency[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > BRIEF_LIMITS.dependencies) {
      throw new BriefError('BRIEF_INVALID_CONTRACT');
    }
    const dependencies = value.map((dependency) =>
      Object.freeze({
        dependencyHash: identifier(dependency.dependencyHash, 64),
        dependencyId: identifier(dependency.dependencyId, 1_024),
        dependencyType: dependency.dependencyType,
        observedRevision: identifier(dependency.observedRevision),
      }),
    );
    if (
      dependencies.some((item) => !/^[a-f0-9]{64}$/u.test(item.dependencyHash)) ||
      new Set(dependencies.map((item) => `${item.dependencyType}:${item.dependencyId}`)).size !==
        dependencies.length
    ) {
      throw new BriefError('BRIEF_INVALID_CONTRACT');
    }
    return Object.freeze(dependencies);
  }

  #topicQuotaDependency(draft: ContentBriefDraft): BriefDependency | null {
    const row = this.#database
      .prepare(
        `SELECT member.plan_version_id, plan.version_number
         FROM topic_quota_plan_members AS member
         JOIN topic_quota_plan_versions AS plan ON plan.id = member.plan_version_id
         JOIN topic_quota_plan_roots AS root
           ON root.id = plan.root_id
          AND root.current_plan_version_id = plan.id
         WHERE member.topic_id = ?
           AND member.topic_version_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM topic_quota_plan_events AS event
             WHERE event.plan_version_id = plan.id
               AND event.event_type IN ('STALE', 'SUPERSEDED')
           )
         ORDER BY plan.created_at DESC, plan.id
         LIMIT 1`,
      )
      .get(draft.topicId, draft.topicVersionId) as
      { readonly plan_version_id: string; readonly version_number: number } | undefined;
    if (row === undefined) return null;
    const identity = {
      dependencyId: row.plan_version_id,
      dependencyType: 'TOPIC_QUOTA_PLAN' as const,
      observedRevision: String(row.version_number),
    };
    return Object.freeze({
      ...identity,
      dependencyHash: briefSemanticHash(identity),
    });
  }

  #databaseDependencies(draft: ContentBriefDraft): readonly BriefDependency[] {
    const dependencies: BriefDependency[] = [];
    const append = (
      dependencyType: BriefDependency['dependencyType'],
      dependencyId: string,
      observedRevision: string | number,
    ): void => {
      const identity = {
        dependencyId,
        dependencyType,
        observedRevision: String(observedRevision),
      };
      dependencies.push(
        Object.freeze({
          ...identity,
          dependencyHash: briefSemanticHash(identity),
        }),
      );
    };

    const topic = this.#database
      .prepare(
        `SELECT version.version_number, topic.topic_revision
         FROM topic_candidate_versions AS version
         JOIN topics AS topic ON topic.id = version.topic_id
         WHERE version.id = ? AND topic.id = ?`,
      )
      .get(draft.topicVersionId, draft.topicId) as
      { readonly topic_revision: number; readonly version_number: number } | undefined;
    if (topic !== undefined) {
      append('TOPIC_VERSION', draft.topicVersionId, topic.version_number);
      append('TOPIC_STATE', draft.topicId, topic.topic_revision);
      append('TOPIC_ELIGIBILITY', draft.topicId, topic.topic_revision);
    }

    const permission = this.#database
      .prepare(
        `SELECT
           snapshot.reading_state_id, snapshot.reading_state_revision_id,
           state.revision AS reading_state_revision,
           snapshot.dossier_version_id, dossier_version.version_number AS dossier_version_number
         FROM expression_permission_snapshots AS snapshot
         JOIN reading_states AS state ON state.id = snapshot.reading_state_id
         LEFT JOIN research_dossier_versions AS dossier_version
           ON dossier_version.id = snapshot.dossier_version_id
         WHERE snapshot.id = ?`,
      )
      .get(draft.expressionPolicy.permissionSnapshotId) as
      | {
          readonly dossier_version_id: string | null;
          readonly dossier_version_number: number | null;
          readonly reading_state_id: string;
          readonly reading_state_revision: number;
          readonly reading_state_revision_id: string;
        }
      | undefined;
    if (permission !== undefined) {
      append('READING_STATE', permission.reading_state_id, permission.reading_state_revision);
      if (permission.dossier_version_id !== null && permission.dossier_version_number !== null) {
        append('DOSSIER_VERSION', permission.dossier_version_id, permission.dossier_version_number);
      }
    }

    const workStatement = this.#database.prepare(`SELECT catalog_revision FROM books WHERE id = ?`);
    const expressionStatement = this.#database.prepare(
      `SELECT revision FROM expressions WHERE id = ?`,
    );
    const editionStatement = this.#database.prepare(
      `SELECT catalog_revision FROM book_editions WHERE id = ?`,
    );
    for (const subject of draft.subjects) {
      const work = workStatement.get(subject.workId) as
        { readonly catalog_revision: number } | undefined;
      if (work !== undefined) {
        append('WORK_IDENTITY', subject.workId, work.catalog_revision);
      }
      if (subject.expressionId !== null) {
        const expression = expressionStatement.get(subject.expressionId) as
          { readonly revision: number } | undefined;
        if (expression !== undefined) {
          append('EXPRESSION_IDENTITY', subject.expressionId, expression.revision);
        }
      }
      if (subject.editionId !== null) {
        const edition = editionStatement.get(subject.editionId) as
          { readonly catalog_revision: number } | undefined;
        if (edition !== undefined) {
          append('EDITION_IDENTITY', subject.editionId, edition.catalog_revision);
        }
      }
    }

    const assertionStatement = this.#database.prepare(
      `SELECT revision FROM experience_assertions WHERE id = ?`,
    );
    for (const assertionId of draft.expressionPolicy.r2AssertionIds) {
      const assertion = assertionStatement.get(assertionId) as
        { readonly revision: number } | undefined;
      if (assertion !== undefined) {
        append('R2_ASSERTION', assertionId, assertion.revision);
      }
    }

    const evidenceStatement = this.#database.prepare(
      `SELECT
         claim.revision AS claim_revision,
         locator.revision AS locator_revision,
         dossier_version.version_number AS dossier_version_number
       FROM claims AS claim
       JOIN claim_evidence AS locator
         ON locator.id = ? AND locator.claim_id = claim.id
       JOIN research_dossier_versions AS dossier_version ON dossier_version.id = ?
       WHERE claim.id = ?`,
    );
    for (const reference of draft.evidenceMap) {
      const evidence = evidenceStatement.get(
        reference.evidenceLocatorId,
        reference.dossierVersionId,
        reference.claimId,
      ) as
        | {
            readonly claim_revision: number;
            readonly dossier_version_number: number;
            readonly locator_revision: number;
          }
        | undefined;
      if (evidence !== undefined) {
        append('DOSSIER_VERSION', reference.dossierVersionId, evidence.dossier_version_number);
        append('CLAIM', reference.claimId, evidence.claim_revision);
        append('EVIDENCE_LOCATOR', reference.evidenceLocatorId, evidence.locator_revision);
      }
    }

    if (draft.experimentBinding !== null) {
      const experiment = this.#database
        .prepare(
          `SELECT
             design.version_number AS design_version_number,
             assignment.version_number AS assignment_version_number
           FROM experiment_design_versions AS design
           JOIN experiment_assignment_plans AS assignment
             ON assignment.id = ?
            AND assignment.design_version_id = design.id
           WHERE design.id = ?`,
        )
        .get(draft.experimentBinding.assignmentPlanId, draft.experimentBinding.designVersionId) as
        | {
            readonly assignment_version_number: number;
            readonly design_version_number: number;
          }
        | undefined;
      if (experiment !== undefined) {
        append(
          'EXPERIMENT_DESIGN',
          draft.experimentBinding.designVersionId,
          experiment.design_version_number,
        );
        append(
          'EXPERIMENT_ASSIGNMENT',
          draft.experimentBinding.assignmentPlanId,
          experiment.assignment_version_number,
        );
      }
    }

    const quotaDependency = this.#topicQuotaDependency(draft);
    if (quotaDependency !== null) dependencies.push(quotaDependency);
    return Object.freeze(dependencies);
  }

  #loadDependencies(versionId: string): readonly BriefDependency[] {
    const rows = this.#database
      .prepare(
        `SELECT dependency_type, dependency_id, observed_revision, dependency_hash
         FROM content_brief_dependencies
         WHERE version_id = ?
         ORDER BY dependency_type, dependency_id`,
      )
      .all(versionId) as unknown as readonly {
      readonly dependency_hash: string;
      readonly dependency_id: string;
      readonly dependency_type: BriefDependency['dependencyType'];
      readonly observed_revision: string;
    }[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          dependencyHash: row.dependency_hash,
          dependencyId: row.dependency_id,
          dependencyType: row.dependency_type,
          observedRevision: row.observed_revision,
        }),
      ),
    );
  }

  #requireRoot(briefId: string): BriefRootRow {
    const row = this.#database
      .prepare(
        `SELECT
           id, topic_id, experiment_id, profile_id, topic_version_id,
           current_version_id, brief_state, brief_revision, updated_at
         FROM content_briefs
         WHERE id = ? AND profile_id <> 'LEGACY_UNCLASSIFIED'`,
      )
      .get(briefId) as BriefRootRow | undefined;
    if (row === undefined) throw new BriefError('BRIEF_NOT_FOUND');
    return row;
  }

  #requireVersion(versionId: string): BriefVersionRow {
    const row = this.#database
      .prepare(
        `SELECT
           id, brief_id, version_number, previous_version_id, schema_version,
           prompt_version, payload_json, status, readiness_status,
           readiness_reason_codes_json, dependency_hash, input_hash,
           lock_snapshot_hash, warnings_json, created_at, confirmed_at, locked_at
         FROM content_brief_versions WHERE id = ?`,
      )
      .get(versionId) as BriefVersionRow | undefined;
    if (row === undefined) throw new BriefError('BRIEF_NOT_FOUND');
    return row;
  }

  #hasInvalidations(versionId: string): boolean {
    return (
      this.#database
        .prepare(
          'SELECT 1 AS present FROM content_brief_invalidations WHERE version_id = ? LIMIT 1',
        )
        .get(versionId) !== undefined
    );
  }

  #appendTransition(
    briefId: string,
    versionId: string,
    revision: number,
    previousTransitionId: string | null,
    action: string,
    fromState: 'ACTIVE' | 'ARCHIVED' | null,
    toState: 'ACTIVE' | 'ARCHIVED',
    expectedRevision: number,
    actor: 'USER' | 'LOCAL_SYSTEM',
    reasonCode: string,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO content_brief_transitions(
           id, brief_id, version_id, revision, previous_transition_id,
           action, from_state, to_state, expected_revision, actor,
           reason_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#idFactory(),
        briefId,
        versionId,
        revision,
        previousTransitionId,
        action,
        fromState,
        toState,
        expectedRevision,
        actor,
        reasonCode,
        now,
      );
  }

  #lastTransitionId(briefId: string): string | null {
    const row = this.#database
      .prepare(
        `SELECT id FROM content_brief_transitions
         WHERE brief_id = ? ORDER BY revision DESC LIMIT 1`,
      )
      .get(briefId) as { readonly id: string } | undefined;
    return row?.id ?? null;
  }

  #audit(
    briefId: string,
    versionId: string,
    eventType: string,
    actor: 'USER' | 'LOCAL_SYSTEM',
    details: Readonly<Record<string, boolean | number | string>>,
    now: string,
    generationRunId: string | null = null,
  ): void {
    const id = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO content_brief_audit_events(
           id, event_identity, event_type, brief_id, version_id,
           generation_run_id, actor, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        `${eventType}:${briefId}:${id}`,
        eventType,
        briefId,
        versionId,
        generationRunId,
        actor,
        JSON.stringify(details),
        now,
      );
  }

  #findRun(executionId: string): BriefGenerationRun | null {
    const row = this.#database
      .prepare(
        `SELECT
           id, brief_id, execution_id, plan_id, status, external_request_count,
           cost_state, result_version_id, stable_error_code, revision
         FROM content_brief_generation_runs WHERE execution_id = ?`,
      )
      .get(executionId) as
      | {
          readonly brief_id: string;
          readonly cost_state: BriefGenerationRun['costState'];
          readonly execution_id: string;
          readonly external_request_count: 0 | 1;
          readonly id: string;
          readonly plan_id: string;
          readonly result_version_id: string | null;
          readonly revision: number;
          readonly stable_error_code: string | null;
          readonly status: BriefGenerationRun['status'];
        }
      | undefined;
    return row === undefined ? null : this.#runView(row);
  }

  #requireRun(executionId: string): BriefGenerationRun {
    const run = this.#findRun(executionId);
    if (run === null) throw new BriefError('BRIEF_NOT_FOUND');
    return run;
  }

  #runView(row: {
    readonly brief_id: string;
    readonly cost_state: BriefGenerationRun['costState'];
    readonly execution_id: string;
    readonly external_request_count: 0 | 1;
    readonly id: string;
    readonly plan_id: string;
    readonly result_version_id: string | null;
    readonly revision: number;
    readonly stable_error_code: string | null;
    readonly status: BriefGenerationRun['status'];
  }): BriefGenerationRun {
    return Object.freeze({
      briefId: row.brief_id,
      costState: row.cost_state,
      executionId: row.execution_id,
      externalRequestCount: row.external_request_count,
      planId: row.plan_id,
      resultVersionId: row.result_version_id,
      revision: row.revision,
      runId: row.id,
      stableErrorCode: row.stable_error_code,
      status: row.status,
    });
  }

  #updateRun(
    executionIdValue: string,
    from: readonly BriefGenerationRun['status'][],
    to: BriefGenerationRun['status'],
    nowValue: string,
    values: {
      readonly costState?: BriefGenerationRun['costState'];
      readonly errorCode: string | null;
      readonly externalRequestCount: 0 | 1;
      readonly resultVersionId: string | null;
    },
  ): BriefGenerationRun {
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    const current = this.#requireRun(executionId);
    if (current.status === to) return current;
    if (!from.includes(current.status)) throw new BriefError('BRIEF_CONFLICT');
    const placeholders = from.map(() => '?').join(', ');
    const result = this.#database
      .prepare(
        `UPDATE content_brief_generation_runs
         SET status = ?, external_request_count = ?, cost_state = ?,
             result_version_id = ?, stable_error_code = ?,
             revision = revision + 1, updated_at = ?
         WHERE execution_id = ? AND status IN (${placeholders})`,
      )
      .run(
        to,
        values.externalRequestCount,
        values.costState ?? current.costState,
        values.resultVersionId,
        values.errorCode,
        now,
        executionId,
        ...from,
      );
    if (result.changes !== 1) throw new BriefError('BRIEF_CONFLICT');
    return this.#requireRun(executionId);
  }

  #runId(executionId: string): string {
    const row = this.#database
      .prepare('SELECT id FROM content_brief_generation_runs WHERE execution_id = ?')
      .get(executionId) as { readonly id: string } | undefined;
    if (row === undefined) throw new BriefError('BRIEF_NOT_FOUND');
    return row.id;
  }
}
