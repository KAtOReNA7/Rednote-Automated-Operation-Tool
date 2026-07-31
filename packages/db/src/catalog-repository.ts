import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  BIBLIOGRAPHIC_OBSERVATION_VERSION,
  BIBLIOGRAPHY_NORMALIZATION_VERSION,
  DISCOVERY_RUN_VERSION,
  ENTITY_RESOLUTION_RULE_VERSION,
  type BibliographicObservationV1,
  type BibliographicOriginKind,
  type BibliographyDiscoveryPersistenceV1,
  type BibliographyJobResultV1,
  type DiscoveryExecutionStateV1,
  type DiscoveryInputScopeV1,
  type DiscoveryOriginInputV1,
  type DiscoveryPlanV1,
  type DiscoveryProcessCountsV1,
  CatalogError,
  catalogSemanticHash,
  compareBibliographicEntities,
  normalizeBibliographicText,
  validateBibliographicObservationV1,
  validateDiscoveryPlanV1,
} from '@mystery-operations/catalog';

import { runInTransaction } from './transaction.js';

type Row = Readonly<Record<string, number | string | null>>;

const ZERO_COUNTS: DiscoveryProcessCountsV1 = Object.freeze({
  editions: 0,
  expressions: 0,
  observations: 0,
  reviewCases: 0,
  works: 0,
});

export interface CatalogSummaryViewV1 {
  readonly counts: {
    readonly editions: number;
    readonly expressions: number;
    readonly observations: number;
    readonly openReviewCases: number;
    readonly works: number;
  };
  readonly coverage: readonly CatalogCoverageViewV1[];
  readonly latestRun: CatalogRunViewV1 | null;
  readonly reviewCases: readonly CatalogResolutionCaseViewV1[];
  readonly synthetic: boolean;
  readonly works: readonly CatalogWorkListItemV1[];
}

export interface CatalogCoverageViewV1 {
  readonly conflictCount: number;
  readonly editionCount: number;
  readonly exactLinkCount: number;
  readonly expressionCount: number;
  readonly gapReason: string | null;
  readonly invalidIdentifierCount: number;
  readonly label: string;
  readonly manualDecisionCount: number;
  readonly observationCount: number;
  readonly postResolutionCount: number;
  readonly plannedObservations: number;
  readonly preResolutionCount: number;
  readonly provenanceCompleteCount: number;
  readonly rejectedCount: number;
  readonly reviewCount: number;
  readonly required: boolean;
  readonly stratumId: string;
  readonly synthetic: boolean;
  readonly unresolvedCount: number;
  readonly workCount: number;
}

export interface CatalogRunViewV1 {
  readonly executionId: string | null;
  readonly externalRequestCount: 0;
  readonly jobId: string | null;
  readonly planId: string;
  readonly revision: number;
  readonly runId: string;
  readonly status: string;
  readonly synthetic: boolean;
}

export interface CatalogResolutionCaseViewV1 {
  readonly candidateEntityId: string | null;
  readonly caseId: string;
  readonly entityType: string;
  readonly observationId: string;
  readonly outcome: string;
  readonly revision: number;
}

export interface CatalogWorkListItemV1 {
  readonly canonicalTitle: string;
  readonly editionCount: number;
  readonly expressionCount: number;
  readonly revision: number;
  readonly state: string;
  readonly workId: string;
}

export interface SyntheticObservationResolutionV1 {
  readonly authorAgentId: string;
  readonly workId: string;
}

export interface CatalogWorkDetailV1 extends CatalogWorkListItemV1 {
  readonly aliases: readonly {
    readonly kind: string;
    readonly normalized: string;
    readonly raw: string;
  }[];
  readonly expressions: readonly {
    readonly editions: readonly {
      readonly editionId: string;
      readonly identifiers: readonly {
        readonly namespace: string;
        readonly value: string;
      }[];
      readonly label: string | null;
      readonly publisher: string | null;
      readonly state: string;
    }[];
    readonly expressionId: string;
    readonly kind: string;
    readonly language: string | null;
    readonly state: string;
    readonly title: string | null;
  }[];
  readonly observationIds: readonly string[];
  readonly observations: readonly {
    readonly factStatus: 'NOT_A_FACT';
    readonly fieldProvenanceCount: number;
    readonly observationId: string;
    readonly originKind: string;
    readonly truthStatus: 'UNVERIFIED';
  }[];
  readonly publicationRelationships: readonly {
    readonly language: string | null;
    readonly objectAgentName: string | null;
    readonly role: string;
    readonly scopeId: string | null;
    readonly scopeType: string | null;
    readonly subjectAgentName: string;
    readonly territory: string | null;
    readonly verificationState: string;
  }[];
  readonly relations: readonly {
    readonly agentName: string;
    readonly role: string;
    readonly scopeId: string;
    readonly scopeType: string;
    readonly verificationState: string;
  }[];
}

export interface WorkMergePreviewV1 {
  readonly affected: {
    readonly downstreamReferences: number;
    readonly editions: number;
    readonly expressions: number;
    readonly observations: number;
    readonly relations: number;
  };
  readonly duplicateRevision: number;
  readonly duplicateWorkId: string;
  readonly previewHash: string;
  readonly survivorRevision: number;
  readonly survivorWorkId: string;
}

export interface WorkSplitPreviewV1 {
  readonly expressionIds: readonly string[];
  readonly newCanonicalTitle: string;
  readonly previewHash: string;
  readonly sourceRevision: number;
  readonly sourceWorkId: string;
}

export interface UndoDecisionPreviewV1 {
  readonly decisionId: string;
  readonly decisionType: 'MERGE' | 'SPLIT';
  readonly previewHash: string;
}

function json(value: unknown, maximum = 262_144): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > maximum) {
    throw new CatalogError('CATALOG_INVALID_REQUEST');
  }
  return serialized;
}

function numberValue(row: Row | undefined, field: string): number {
  return (row?.[field] as number | undefined) ?? 0;
}

function runCounts(row: Row): DiscoveryProcessCountsV1 {
  return Object.freeze({
    editions: row.edition_count as number,
    expressions: row.expression_count as number,
    observations: row.observation_count as number,
    reviewCases: row.review_case_count as number,
    works: row.work_count as number,
  });
}

function assertExpectedRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new CatalogError('CATALOG_STALE_REVISION', {
      retryable: true,
      safeDetails: { actualRevision: actual, expectedRevision: expected },
    });
  }
}

export class SqliteCatalogRepository implements BibliographyDiscoveryPersistenceV1 {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public listAvailableOrigins(
    scope: DiscoveryInputScopeV1,
    maximum: number,
  ): readonly DiscoveryOriginInputV1[] {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_000_000) {
      throw new CatalogError('CATALOG_INVALID_REQUEST');
    }
    const requested = new Set(scope.originKinds);
    const allowedIds = new Set(scope.originRecordIds);
    const results: DiscoveryOriginInputV1[] = [];
    const append = (kind: BibliographicOriginKind, rows: readonly Row[]): void => {
      for (const row of rows) {
        const id = row.id as string;
        if (allowedIds.size > 0 && !allowedIds.has(id)) continue;
        results.push({
          originKind: kind,
          originRecordId: id,
          originRevision: (row.revision as number | null) ?? 1,
          sequence: 0,
        });
        if (results.length >= maximum) break;
      }
    };
    if (requested.has('SEARCH_CANDIDATE')) {
      append(
        'SEARCH_CANDIDATE',
        this.#database
          .prepare(
            `SELECT id, 1 AS revision
             FROM search_result_candidates
             WHERE evidence_eligibility = 'LEAD_ONLY'
               AND fetch_state = 'NOT_FETCHED'
               AND truth_status = 'UNVERIFIED'
               AND fact_status = 'NOT_A_FACT'
             ORDER BY created_at, id
             LIMIT ?`,
          )
          .all(maximum) as Row[],
      );
    }
    if (results.length < maximum && requested.has('FETCH_DOCUMENT')) {
      append(
        'FETCH_DOCUMENT',
        this.#database
          .prepare(
            `SELECT id, 1 AS revision
             FROM fetched_documents
             WHERE evidence_eligibility = 'FETCHED_NOT_EVIDENCE'
               AND truth_status = 'UNVERIFIED'
               AND fact_status = 'NOT_A_FACT'
             ORDER BY created_at, id
             LIMIT ?`,
          )
          .all(maximum - results.length) as Row[],
      );
    }
    if (results.length < maximum && requested.has('BROWSER_CLIP_CANDIDATE')) {
      append(
        'BROWSER_CLIP_CANDIDATE',
        this.#database
          .prepare(
            `SELECT link.candidate_id AS id, clip.revision + 1 AS revision
             FROM clip_search_candidate_links AS link
             JOIN clips AS clip ON clip.id = link.clip_id
             JOIN search_result_candidates AS candidate ON candidate.id = link.candidate_id
             WHERE candidate.evidence_eligibility = 'LEAD_ONLY'
               AND candidate.fetch_state = 'NOT_FETCHED'
               AND candidate.truth_status = 'UNVERIFIED'
               AND candidate.fact_status = 'NOT_A_FACT'
             ORDER BY clip.created_at, link.candidate_id
             LIMIT ?`,
          )
          .all(maximum - results.length) as Row[],
      );
    }
    return Object.freeze(
      results.slice(0, maximum).map((input, index) =>
        Object.freeze({
          ...input,
          sequence: index + 1,
        }),
      ),
    );
  }

  public createDiscoveryPreview(
    planInput: DiscoveryPlanV1,
    runId: string,
    origins: readonly DiscoveryOriginInputV1[],
  ): CatalogRunViewV1 {
    const plan = validateDiscoveryPlanV1(planInput);
    if (
      origins.length > plan.limits.maxObservations ||
      origins.some((origin, index) => origin.sequence !== index + 1)
    ) {
      throw new CatalogError('CATALOG_INVALID_PLAN');
    }
    return runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO discovery_profiles (
            id, revision, contract_version, purpose, synthetic, profile_json
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id, revision) DO NOTHING`,
        )
        .run(
          plan.profile.profileId,
          plan.profile.revision,
          plan.profile.contractVersion,
          plan.profile.purpose,
          plan.profile.synthetic ? 1 : 0,
          json(plan.profile, 131_072),
        );
      this.#database
        .prepare(
          `INSERT INTO discovery_plans (
            id, contract_version, profile_id, profile_revision, plan_hash, plan_json,
            estimated_external_requests, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          plan.planId,
          plan.contractVersion,
          plan.profile.profileId,
          plan.profile.revision,
          plan.planHash,
          json(plan),
          plan.createdAt,
          plan.expiresAt,
        );
      const stratumStatement = this.#database.prepare(
        `INSERT INTO discovery_plan_strata (
          plan_id, stratum_id, label, required, target_observations, priority, gap_policy
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const stratum of plan.profile.strata) {
        stratumStatement.run(
          plan.planId,
          stratum.stratumId,
          stratum.label,
          stratum.required ? 1 : 0,
          stratum.targetObservations,
          stratum.priority,
          stratum.gapPolicy,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO discovery_runs (
            id, contract_version, plan_id, plan_hash, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'PREVIEWED', ?, ?)`,
        )
        .run(
          runId,
          DISCOVERY_RUN_VERSION,
          plan.planId,
          plan.planHash,
          plan.createdAt,
          plan.createdAt,
        );
      const originStatement = this.#database.prepare(
        `INSERT INTO discovery_run_origins (
          run_id, sequence, origin_kind, origin_record_id, origin_revision
        ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const origin of origins) {
        originStatement.run(
          runId,
          origin.sequence,
          origin.originKind,
          origin.originRecordId,
          origin.originRevision,
        );
      }
      const coverageStatement = this.#database.prepare(
        `INSERT INTO discovery_run_stratum_coverage (
          run_id, stratum_id, planned_observations, synthetic
        ) VALUES (?, ?, ?, ?)`,
      );
      for (const stratum of plan.profile.strata) {
        coverageStatement.run(
          runId,
          stratum.stratumId,
          stratum.targetObservations,
          plan.profile.synthetic ? 1 : 0,
        );
      }
      this.#audit(
        'DISCOVERY_PREVIEWED',
        'DISCOVERY_RUN',
        runId,
        {
          originCount: origins.length,
          planHash: plan.planHash,
        },
        plan.createdAt,
      );
      return this.#runView(runId);
    });
  }

  public confirmDiscoveryRun(
    runId: string,
    expectedRevision: number,
    now: string,
  ): CatalogRunViewV1 {
    return runInTransaction(this.#database, () => {
      const row = this.#getRunRow(runId);
      assertExpectedRevision(row.revision as number, expectedRevision);
      if (row.status !== 'PREVIEWED') throw new CatalogError('CATALOG_CONFLICT');
      const plan = JSON.parse(row.plan_json as string) as DiscoveryPlanV1;
      if (Date.parse(plan.expiresAt) <= Date.parse(now)) {
        throw new CatalogError('CATALOG_CONFIRMATION_EXPIRED');
      }
      this.#database
        .prepare(
          `UPDATE discovery_runs
           SET status = 'CONFIRMED', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status = 'PREVIEWED'`,
        )
        .run(now, runId, expectedRevision);
      this.#audit('DISCOVERY_CONFIRMED', 'DISCOVERY_RUN', runId, {}, now);
      return this.#runView(runId);
    });
  }

  public attachDiscoveryJob(runId: string, jobId: string, now: string): void {
    const changed = this.#database
      .prepare(
        `UPDATE discovery_runs
         SET job_id = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'CONFIRMED' AND job_id IS NULL`,
      )
      .run(jobId, now, runId).changes;
    if (changed !== 1) {
      const row = this.#getRunRow(runId);
      if (row.job_id !== jobId) throw new CatalogError('CATALOG_CONFLICT');
    }
  }

  public getDiscoveryRun(runId: string): CatalogRunViewV1 {
    return this.#runView(runId);
  }

  public cancelDiscoveryRun(
    runId: string,
    expectedRevision: number,
    now: string,
  ): CatalogRunViewV1 {
    return runInTransaction(this.#database, () => {
      const row = this.#getRunRow(runId);
      assertExpectedRevision(row.revision as number, expectedRevision);
      if (!['PREVIEWED', 'CONFIRMED', 'RUNNING', 'INTERRUPTED'].includes(row.status as string)) {
        throw new CatalogError('CATALOG_CONFLICT');
      }
      this.#database
        .prepare(
          `UPDATE discovery_runs
           SET status = 'CANCELLED', finished_at = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(now, now, runId, expectedRevision);
      this.#audit('DISCOVERY_CANCELLED', 'DISCOVERY_RUN', runId, {}, now);
      return this.#runView(runId);
    });
  }

  public beginExecution(
    runId: string,
    executionId: string,
    planHash: string,
    now: string,
  ): DiscoveryExecutionStateV1 {
    return runInTransaction(this.#database, () => {
      const row = this.#getRunRow(runId);
      if (row.plan_hash !== planHash) throw new CatalogError('CATALOG_CONFLICT');
      if (row.execution_id !== null && row.execution_id !== executionId) {
        throw new CatalogError('CATALOG_CONFLICT');
      }
      const plan = validateDiscoveryPlanV1(JSON.parse(row.plan_json as string));
      if (['COMPLETED', 'COMPLETED_WITH_GAPS', 'AWAITING_REVIEW'].includes(row.status as string)) {
        return Object.freeze({
          checkpoint: row.checkpoint_sequence as number,
          counts: runCounts(row),
          plan,
          state: 'EXISTING_COMPLETED' as const,
        });
      }
      if (!['CONFIRMED', 'INTERRUPTED', 'RUNNING'].includes(row.status as string)) {
        throw new CatalogError('CATALOG_CONFLICT');
      }
      const state = row.status === 'RUNNING' ? 'RESUMED' : 'CREATED';
      this.#database
        .prepare(
          `UPDATE discovery_runs
           SET execution_id = ?, status = 'RUNNING',
               started_at = COALESCE(started_at, ?), finished_at = NULL,
               stable_error_code = NULL, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(executionId, now, now, runId);
      return Object.freeze({
        checkpoint: row.checkpoint_sequence as number,
        counts: runCounts(row),
        plan,
        state,
      });
    });
  }

  public getOriginBatch(
    runId: string,
    afterSequence: number,
    limit: number,
  ): readonly DiscoveryOriginInputV1[] {
    return Object.freeze(
      (
        this.#database
          .prepare(
            `SELECT sequence, origin_kind, origin_record_id, origin_revision
             FROM discovery_run_origins
             WHERE run_id = ? AND processed = 0 AND sequence > ?
             ORDER BY sequence
             LIMIT ?`,
          )
          .all(runId, afterSequence, limit) as Row[]
      ).map((row) =>
        Object.freeze({
          originKind: row.origin_kind as BibliographicOriginKind,
          originRecordId: row.origin_record_id as string,
          originRevision: row.origin_revision as number,
          sequence: row.sequence as number,
        }),
      ),
    );
  }

  public processOrigin(
    runId: string,
    input: DiscoveryOriginInputV1,
    now: string,
  ): DiscoveryProcessCountsV1 {
    return runInTransaction(this.#database, () => {
      const row = this.#database
        .prepare(
          `SELECT processed FROM discovery_run_origins
           WHERE run_id = ? AND sequence = ? AND origin_kind = ?
             AND origin_record_id = ? AND origin_revision = ?`,
        )
        .get(
          runId,
          input.sequence,
          input.originKind,
          input.originRecordId,
          input.originRevision,
        ) as Row | undefined;
      if (row === undefined) throw new CatalogError('CATALOG_INVALID_REQUEST');
      if (row.processed === 1) return ZERO_COUNTS;
      const observation = this.#observationFromOrigin(input, now);
      const counts = this.#insertObservationAndResolve(observation, runId, now);
      this.#database
        .prepare(
          `UPDATE discovery_run_origins SET processed = 1
           WHERE run_id = ? AND sequence = ? AND processed = 0`,
        )
        .run(runId, input.sequence);
      return counts;
    });
  }

  public insertSyntheticObservation(
    observationInput: BibliographicObservationV1,
    runId: string | null,
    now: string,
  ): DiscoveryProcessCountsV1 {
    const observation = validateBibliographicObservationV1(observationInput);
    if (observation.originKind !== 'SYNTHETIC_FIXTURE') {
      throw new CatalogError('CATALOG_INVALID_OBSERVATION');
    }
    return runInTransaction(this.#database, () =>
      this.#insertObservationAndResolve(observation, runId, now),
    );
  }

  public getSyntheticObservationResolution(
    observationId: string,
  ): SyntheticObservationResolutionV1 | null {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(observationId)) {
      throw new CatalogError('CATALOG_INVALID_REQUEST');
    }
    const row = this.#database
      .prepare(
        `SELECT link.entity_id AS work_id, relation.agent_id AS author_agent_id
         FROM bibliographic_observations AS observation
         JOIN observation_entity_links AS link
           ON link.observation_id = observation.id AND link.entity_type = 'WORK'
         JOIN catalog_agent_relations AS relation
           ON relation.scope_type = 'WORK'
          AND relation.scope_id = link.entity_id
          AND relation.role = 'AUTHOR'
         WHERE observation.id = ? AND observation.origin_kind = 'SYNTHETIC_FIXTURE'
         ORDER BY relation.id
         LIMIT 1`,
      )
      .get(observationId) as Row | undefined;
    return row === undefined
      ? null
      : Object.freeze({
          authorAgentId: row.author_agent_id as string,
          workId: row.work_id as string,
        });
  }

  public saveCheckpoint(
    runId: string,
    checkpoint: number,
    counts: DiscoveryProcessCountsV1,
    now: string,
  ): void {
    const changed = this.#database
      .prepare(
        `UPDATE discovery_runs
         SET checkpoint_sequence = ?, observation_count = ?, work_count = ?,
             expression_count = ?, edition_count = ?, review_case_count = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'RUNNING' AND checkpoint_sequence <= ?`,
      )
      .run(
        checkpoint,
        counts.observations,
        counts.works,
        counts.expressions,
        counts.editions,
        counts.reviewCases,
        now,
        runId,
        checkpoint,
      ).changes;
    if (changed !== 1) throw new CatalogError('CATALOG_STALE_REVISION', { retryable: true });
  }

  public finishExecution(
    runId: string,
    counts: DiscoveryProcessCountsV1,
    now: string,
  ): BibliographyJobResultV1 {
    return runInTransaction(this.#database, () => {
      const row = this.#getRunRow(runId);
      if (['AWAITING_REVIEW', 'COMPLETED', 'COMPLETED_WITH_GAPS'].includes(row.status as string)) {
        return this.#jobResult(
          row.status as BibliographyJobResultV1['status'],
          runId,
          runCounts(row),
        );
      }
      const openReview = numberValue(
        this.#database
          .prepare(
            `SELECT count(*) AS count
             FROM resolution_cases AS resolution
             JOIN bibliographic_observations AS observation
               ON observation.id = resolution.observation_id
             JOIN discovery_run_origins AS origin
               ON origin.run_id = ?
              AND origin.origin_kind = observation.origin_kind
              AND origin.origin_record_id = observation.origin_record_id
              AND origin.origin_revision = observation.origin_revision
             WHERE resolution.status = 'OPEN'`,
          )
          .get(runId) as Row,
        'count',
      );
      const coverageRows = this.#database
        .prepare(
          `SELECT coverage.stratum_id, coverage.observation_count,
                  coverage.planned_observations, strata.required
           FROM discovery_run_stratum_coverage AS coverage
           JOIN discovery_plan_strata AS strata
             ON strata.plan_id = ? AND strata.stratum_id = coverage.stratum_id
           WHERE coverage.run_id = ?`,
        )
        .all(row.plan_id as string, runId) as Row[];
      let gaps = 0;
      for (const coverage of coverageRows) {
        if (
          coverage.required === 1 &&
          (coverage.observation_count as number) < (coverage.planned_observations as number)
        ) {
          gaps += 1;
          this.#database
            .prepare(
              `UPDATE discovery_run_stratum_coverage
               SET gap_reason = CASE
                 WHEN observation_count = 0 THEN 'NO_ELIGIBLE_PERSISTED_INPUT'
                 ELSE 'TARGET_NOT_REACHED'
               END
               WHERE run_id = ? AND stratum_id = ?`,
            )
            .run(runId, coverage.stratum_id as string);
        }
      }
      const status: BibliographyJobResultV1['status'] =
        openReview > 0 ? 'AWAITING_REVIEW' : gaps > 0 ? 'COMPLETED_WITH_GAPS' : 'COMPLETED';
      this.#database
        .prepare(
          `UPDATE discovery_runs
           SET status = ?, observation_count = ?, work_count = ?,
               expression_count = ?, edition_count = ?, review_case_count = ?,
               finished_at = ?, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          status,
          counts.observations,
          counts.works,
          counts.expressions,
          counts.editions,
          counts.reviewCases,
          now,
          now,
          runId,
        );
      return this.#jobResult(status, runId, counts);
    });
  }

  public interruptExecution(
    runId: string,
    state: 'CANCELLED' | 'FAILED' | 'INTERRUPTED',
    stableError: string | null,
    now: string,
  ): BibliographyJobResultV1 {
    return runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `UPDATE discovery_runs
           SET status = ?, stable_error_code = ?, finished_at = ?,
               revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(state, stableError, now, now, runId);
      const row = this.#getRunRow(runId);
      return Object.freeze({
        ...this.#jobResult(state, runId, runCounts(row)),
        stableError,
      });
    });
  }

  public getSummary(limit = 50, offset = 0, query = ''): CatalogSummaryViewV1 {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      query.length > 512
    ) {
      throw new CatalogError('CATALOG_INVALID_REQUEST');
    }
    const normalizedQuery = query.trim().length === 0 ? null : `%${query.trim().toLowerCase()}%`;
    const workRows = this.#database
      .prepare(
        `SELECT book.id, book.canonical_title, book.catalog_state, book.catalog_revision,
                count(DISTINCT expression.id) AS expression_count,
                count(DISTINCT edition.id) AS edition_count
         FROM books AS book
         LEFT JOIN expressions AS expression
           ON expression.work_id = book.id AND expression.catalog_state = 'ACTIVE'
         LEFT JOIN book_editions AS edition
           ON edition.expression_id = expression.id AND edition.catalog_state = 'ACTIVE'
         WHERE book.catalog_state = 'ACTIVE'
           AND (? IS NULL OR lower(book.canonical_title) LIKE ?)
         GROUP BY book.id
         ORDER BY lower(book.canonical_title), book.id
         LIMIT ? OFFSET ?`,
      )
      .all(normalizedQuery, normalizedQuery, limit, offset) as Row[];
    const count = (table: string, where = ''): number =>
      numberValue(
        this.#database.prepare(`SELECT count(*) AS count FROM ${table} ${where}`).get() as Row,
        'count',
      );
    const latestRunRow = this.#database
      .prepare(
        `SELECT run.*, profile.synthetic, plan.plan_json
         FROM discovery_runs AS run
         JOIN discovery_plans AS plan ON plan.id = run.plan_id
         JOIN discovery_profiles AS profile
           ON profile.id = plan.profile_id AND profile.revision = plan.profile_revision
         ORDER BY run.created_at DESC LIMIT 1`,
      )
      .get() as Row | undefined;
    const latestRun = latestRunRow === undefined ? null : this.#rowToRunView(latestRunRow);
    const coverage =
      latestRun === null
        ? []
        : (
            this.#database
              .prepare(
                `SELECT coverage.*, strata.label, strata.required
               FROM discovery_run_stratum_coverage AS coverage
               JOIN discovery_runs AS run ON run.id = coverage.run_id
               JOIN discovery_plan_strata AS strata
                 ON strata.plan_id = run.plan_id AND strata.stratum_id = coverage.stratum_id
               WHERE coverage.run_id = ?
               ORDER BY strata.priority, coverage.stratum_id`,
              )
              .all(latestRun.runId) as Row[]
          ).map((row) =>
            Object.freeze({
              conflictCount: row.conflict_count as number,
              editionCount: row.edition_count as number,
              exactLinkCount: row.exact_link_count as number,
              expressionCount: row.expression_count as number,
              gapReason: row.gap_reason as string | null,
              invalidIdentifierCount: row.invalid_identifier_count as number,
              label: row.label as string,
              manualDecisionCount: row.manual_decision_count as number,
              observationCount: row.observation_count as number,
              postResolutionCount: row.post_resolution_count as number,
              plannedObservations: row.planned_observations as number,
              preResolutionCount: row.pre_resolution_count as number,
              provenanceCompleteCount: row.provenance_complete_count as number,
              rejectedCount: row.rejected_count as number,
              required: row.required === 1,
              reviewCount: row.review_count as number,
              stratumId: row.stratum_id as string,
              synthetic: row.synthetic === 1,
              unresolvedCount: row.unresolved_count as number,
              workCount: row.work_count as number,
            }),
          );
    const cases = (
      this.#database
        .prepare(
          `SELECT id, observation_id, entity_type, candidate_entity_id,
                  outcome, revision
           FROM resolution_cases
           WHERE status = 'OPEN'
           ORDER BY updated_at DESC, id
           LIMIT 100`,
        )
        .all() as Row[]
    ).map((row) =>
      Object.freeze({
        candidateEntityId: row.candidate_entity_id as string | null,
        caseId: row.id as string,
        entityType: row.entity_type as string,
        observationId: row.observation_id as string,
        outcome: row.outcome as string,
        revision: row.revision as number,
      }),
    );
    return Object.freeze({
      counts: Object.freeze({
        editions: count('book_editions', "WHERE catalog_state = 'ACTIVE'"),
        expressions: count('expressions', "WHERE catalog_state = 'ACTIVE'"),
        observations: count('bibliographic_observations'),
        openReviewCases: count('resolution_cases', "WHERE status = 'OPEN'"),
        works: count('books', "WHERE catalog_state = 'ACTIVE'"),
      }),
      coverage: Object.freeze(coverage),
      latestRun,
      reviewCases: Object.freeze(cases),
      synthetic: latestRun?.synthetic ?? false,
      works: Object.freeze(
        workRows.map((row) =>
          Object.freeze({
            canonicalTitle: row.canonical_title as string,
            editionCount: row.edition_count as number,
            expressionCount: row.expression_count as number,
            revision: row.catalog_revision as number,
            state: row.catalog_state as string,
            workId: row.id as string,
          }),
        ),
      ),
    });
  }

  public getWorkDetail(workId: string): CatalogWorkDetailV1 | null {
    const work = this.#database
      .prepare(
        `SELECT book.id, book.canonical_title, book.catalog_state, book.catalog_revision,
                count(DISTINCT expression.id) AS expression_count,
                count(DISTINCT edition.id) AS edition_count
         FROM books AS book
         LEFT JOIN expressions AS expression ON expression.work_id = book.id
         LEFT JOIN book_editions AS edition ON edition.expression_id = expression.id
         WHERE book.id = ?
         GROUP BY book.id`,
      )
      .get(workId) as Row | undefined;
    if (work === undefined) return null;
    const expressionRows = this.#database
      .prepare(
        `SELECT id, expression_kind, canonical_title, language, catalog_state
         FROM expressions WHERE work_id = ? ORDER BY created_at, id`,
      )
      .all(workId) as Row[];
    const expressions = expressionRows.map((expression) => {
      const editionRows = this.#database
        .prepare(
          `SELECT id, edition_label, publisher, catalog_state
           FROM book_editions WHERE expression_id = ? ORDER BY id`,
        )
        .all(expression.id as string) as Row[];
      return Object.freeze({
        editions: Object.freeze(
          editionRows.map((edition) =>
            Object.freeze({
              editionId: edition.id as string,
              identifiers: Object.freeze(
                (
                  this.#database
                    .prepare(
                      `SELECT namespace, normalized_value
                       FROM bibliographic_identifiers
                       WHERE entity_id = ? ORDER BY namespace, normalized_value`,
                    )
                    .all(edition.id as string) as Row[]
                ).map((identifier) =>
                  Object.freeze({
                    namespace: identifier.namespace as string,
                    value: identifier.normalized_value as string,
                  }),
                ),
              ),
              label: edition.edition_label as string | null,
              publisher: edition.publisher as string | null,
              state: edition.catalog_state as string,
            }),
          ),
        ),
        expressionId: expression.id as string,
        kind: expression.expression_kind as string,
        language: expression.language as string | null,
        state: expression.catalog_state as string,
        title: expression.canonical_title as string | null,
      });
    });
    const expressionIds = expressionRows.map((row) => row.id as string);
    const editionIds = expressions.flatMap((expression) =>
      expression.editions.map((edition) => edition.editionId),
    );
    const scopeIds = [workId, ...expressionIds, ...editionIds];
    const relationRows =
      scopeIds.length === 0
        ? []
        : (this.#database
            .prepare(
              `SELECT relation.scope_type, relation.scope_id, relation.role,
                      relation.verification_state, agent.canonical_name
               FROM catalog_agent_relations AS relation
               JOIN catalog_agents AS agent ON agent.id = relation.agent_id
               WHERE relation.scope_id IN (${scopeIds.map(() => '?').join(',')})
               ORDER BY relation.scope_type, relation.scope_id, relation.role`,
            )
            .all(...scopeIds) as Row[]);
    const aliases = this.#database
      .prepare(
        `SELECT alias_kind, raw_value, normalized_value
         FROM catalog_entity_aliases
         WHERE entity_type = 'WORK' AND entity_id = ?
         ORDER BY alias_kind, normalized_value`,
      )
      .all(workId) as Row[];
    const observationRows = this.#database
      .prepare(
        `SELECT DISTINCT observation.id AS observation_id, observation.origin_kind,
                observation.truth_status, observation.fact_status,
                (SELECT count(*) FROM bibliographic_observation_fields AS field
                 WHERE field.observation_id = observation.id) AS provenance_count
         FROM observation_entity_links AS link
         JOIN bibliographic_observations AS observation ON observation.id = link.observation_id
         WHERE (link.entity_type = 'WORK' AND link.entity_id = ?)
            OR (link.entity_type = 'EXPRESSION' AND link.entity_id IN (
              SELECT id FROM expressions WHERE work_id = ?
            ))
            OR (link.entity_type = 'EDITION' AND link.entity_id IN (
              SELECT edition.id FROM book_editions AS edition
              JOIN expressions AS expression ON expression.id = edition.expression_id
              WHERE expression.work_id = ?
            ))
         ORDER BY observation.id`,
      )
      .all(workId, workId, workId) as Row[];
    const publicationRows =
      scopeIds.length === 0
        ? []
        : (this.#database
            .prepare(
              `SELECT relationship.role, relationship.scope_type, relationship.scope_id,
                      relationship.language, relationship.territory,
                      relationship.verification_state,
                      subject.canonical_name AS subject_name,
                      object.canonical_name AS object_name
               FROM publication_relationships AS relationship
               JOIN catalog_agents AS subject ON subject.id = relationship.subject_agent_id
               LEFT JOIN catalog_agents AS object ON object.id = relationship.object_agent_id
               WHERE relationship.scope_id IN (${scopeIds.map(() => '?').join(',')})
               ORDER BY relationship.role, relationship.id`,
            )
            .all(...scopeIds) as Row[]);
    return Object.freeze({
      aliases: Object.freeze(
        aliases.map((alias) =>
          Object.freeze({
            kind: alias.alias_kind as string,
            normalized: alias.normalized_value as string,
            raw: alias.raw_value as string,
          }),
        ),
      ),
      canonicalTitle: work.canonical_title as string,
      editionCount: work.edition_count as number,
      expressionCount: work.expression_count as number,
      expressions: Object.freeze(expressions),
      observationIds: Object.freeze(observationRows.map((row) => row.observation_id as string)),
      observations: Object.freeze(
        observationRows.map((row) =>
          Object.freeze({
            factStatus: row.fact_status as 'NOT_A_FACT',
            fieldProvenanceCount: row.provenance_count as number,
            observationId: row.observation_id as string,
            originKind: row.origin_kind as string,
            truthStatus: row.truth_status as 'UNVERIFIED',
          }),
        ),
      ),
      publicationRelationships: Object.freeze(
        publicationRows.map((row) =>
          Object.freeze({
            language: row.language as string | null,
            objectAgentName: row.object_name as string | null,
            role: row.role as string,
            scopeId: row.scope_id as string | null,
            scopeType: row.scope_type as string | null,
            subjectAgentName: row.subject_name as string,
            territory: row.territory as string | null,
            verificationState: row.verification_state as string,
          }),
        ),
      ),
      relations: Object.freeze(
        relationRows.map((relation) =>
          Object.freeze({
            agentName: relation.canonical_name as string,
            role: relation.role as string,
            scopeId: relation.scope_id as string,
            scopeType: relation.scope_type as string,
            verificationState: relation.verification_state as string,
          }),
        ),
      ),
      revision: work.catalog_revision as number,
      state: work.catalog_state as string,
      workId: work.id as string,
    });
  }

  public previewWorkMerge(
    survivorWorkId: string,
    duplicateWorkId: string,
    survivorRevision: number,
    duplicateRevision: number,
  ): WorkMergePreviewV1 {
    if (survivorWorkId === duplicateWorkId) throw new CatalogError('CATALOG_INVALID_REQUEST');
    const survivor = this.#workRow(survivorWorkId);
    const duplicate = this.#workRow(duplicateWorkId);
    assertExpectedRevision(survivor.catalog_revision as number, survivorRevision);
    assertExpectedRevision(duplicate.catalog_revision as number, duplicateRevision);
    if (survivor.catalog_state !== 'ACTIVE' || duplicate.catalog_state !== 'ACTIVE') {
      throw new CatalogError('CATALOG_CONFLICT');
    }
    const expressions = numberValue(
      this.#database
        .prepare('SELECT count(*) AS count FROM expressions WHERE work_id = ?')
        .get(duplicateWorkId) as Row,
      'count',
    );
    const editions = numberValue(
      this.#database
        .prepare(
          `SELECT count(*) AS count FROM book_editions
           WHERE expression_id IN (SELECT id FROM expressions WHERE work_id = ?)`,
        )
        .get(duplicateWorkId) as Row,
      'count',
    );
    const observations = numberValue(
      this.#database
        .prepare(
          `SELECT count(DISTINCT observation_id) AS count
           FROM observation_entity_links
           WHERE (entity_type = 'WORK' AND entity_id = ?)
              OR (entity_type = 'EXPRESSION' AND entity_id IN (
                SELECT id FROM expressions WHERE work_id = ?
              ))
              OR (entity_type = 'EDITION' AND entity_id IN (
                SELECT edition.id FROM book_editions AS edition
                JOIN expressions AS expression ON expression.id = edition.expression_id
                WHERE expression.work_id = ?
              ))`,
        )
        .get(duplicateWorkId, duplicateWorkId, duplicateWorkId) as Row,
      'count',
    );
    const relations = numberValue(
      this.#database
        .prepare(
          `SELECT count(*) AS count FROM catalog_agent_relations
           WHERE scope_id = ? OR scope_id IN (
             SELECT id FROM expressions WHERE work_id = ?
           ) OR scope_id IN (
             SELECT edition.id FROM book_editions AS edition
             JOIN expressions AS expression ON expression.id = edition.expression_id
             WHERE expression.work_id = ?
           )`,
        )
        .get(duplicateWorkId, duplicateWorkId, duplicateWorkId) as Row,
      'count',
    );
    const downstreamReferences = ['reading_states', 'research_dossiers', 'topics'].reduce(
      (sum, table) =>
        sum +
        numberValue(
          this.#database
            .prepare(`SELECT count(*) AS count FROM ${table} WHERE book_id = ?`)
            .get(duplicateWorkId) as Row,
          'count',
        ),
      0,
    );
    const withoutHash = {
      affected: {
        downstreamReferences,
        editions,
        expressions,
        observations,
        relations,
      },
      duplicateRevision,
      duplicateWorkId,
      survivorRevision,
      survivorWorkId,
    };
    return Object.freeze({
      ...withoutHash,
      affected: Object.freeze(withoutHash.affected),
      previewHash: catalogSemanticHash(withoutHash),
    });
  }

  public mergeWorks(preview: WorkMergePreviewV1, now: string): string {
    if (
      catalogSemanticHash({
        affected: preview.affected,
        duplicateRevision: preview.duplicateRevision,
        duplicateWorkId: preview.duplicateWorkId,
        survivorRevision: preview.survivorRevision,
        survivorWorkId: preview.survivorWorkId,
      }) !== preview.previewHash
    ) {
      throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
    }
    return runInTransaction(this.#database, () => {
      const current = this.previewWorkMerge(
        preview.survivorWorkId,
        preview.duplicateWorkId,
        preview.survivorRevision,
        preview.duplicateRevision,
      );
      if (current.previewHash !== preview.previewHash) {
        throw new CatalogError('CATALOG_STALE_REVISION', { retryable: true });
      }
      const duplicateReading = this.#database
        .prepare('SELECT id FROM reading_states WHERE book_id = ?')
        .get(preview.duplicateWorkId) as Row | undefined;
      const survivorReading = this.#database
        .prepare('SELECT id FROM reading_states WHERE book_id = ?')
        .get(preview.survivorWorkId) as Row | undefined;
      if (duplicateReading !== undefined && survivorReading !== undefined) {
        throw new CatalogError('CATALOG_CONFLICT', {
          safeDetails: { reason: 'READING_STATE_COLLISION' },
        });
      }
      const expressionIds = (
        this.#database
          .prepare('SELECT id FROM expressions WHERE work_id = ? ORDER BY id')
          .all(preview.duplicateWorkId) as Row[]
      ).map((row) => row.id as string);
      const downstream = Object.fromEntries(
        ['reading_states', 'research_dossiers', 'topics'].map((table) => [
          table,
          (
            this.#database
              .prepare(`SELECT id FROM ${table} WHERE book_id = ? ORDER BY id`)
              .all(preview.duplicateWorkId) as Row[]
          ).map((row) => row.id as string),
        ]),
      );
      const before = {
        downstream,
        duplicateRevision: preview.duplicateRevision,
        duplicateWorkId: preview.duplicateWorkId,
        expressionIds,
        survivorRevision: preview.survivorRevision,
        survivorWorkId: preview.survivorWorkId,
      };
      const decisionId = `decision-${this.#idFactory()}`;
      this.#database
        .prepare(
          'UPDATE expressions SET work_id = ?, revision = revision + 1, updated_at = ? WHERE work_id = ?',
        )
        .run(preview.survivorWorkId, now, preview.duplicateWorkId);
      for (const table of ['reading_states', 'research_dossiers', 'topics']) {
        this.#database
          .prepare(`UPDATE ${table} SET book_id = ? WHERE book_id = ?`)
          .run(preview.survivorWorkId, preview.duplicateWorkId);
      }
      this.#database
        .prepare(
          `UPDATE books SET catalog_state = 'MERGED',
             catalog_revision = catalog_revision + 1, updated_at = ?
           WHERE id = ? AND catalog_revision = ?`,
        )
        .run(now, preview.duplicateWorkId, preview.duplicateRevision);
      this.#database
        .prepare(
          `UPDATE books SET catalog_revision = catalog_revision + 1, updated_at = ?
           WHERE id = ? AND catalog_revision = ?`,
        )
        .run(now, preview.survivorWorkId, preview.survivorRevision);
      this.#database
        .prepare(
          `INSERT INTO entity_redirects (
            entity_type, from_entity_id, to_entity_id, decision_id, created_at, updated_at
          ) VALUES ('WORK', ?, ?, ?, ?, ?)
          ON CONFLICT(entity_type, from_entity_id) DO UPDATE SET
            to_entity_id = excluded.to_entity_id,
            decision_id = excluded.decision_id,
            active = 1,
            updated_at = excluded.updated_at`,
        )
        .run(preview.duplicateWorkId, preview.survivorWorkId, decisionId, now, now);
      const after = {
        duplicateState: 'MERGED',
        movedExpressionCount: expressionIds.length,
        survivorWorkId: preview.survivorWorkId,
      };
      this.#insertDecision(
        decisionId,
        'MERGE',
        preview.survivorWorkId,
        preview.duplicateWorkId,
        null,
        preview.previewHash,
        before,
        after,
        now,
      );
      this.#lineage(decisionId, 'WORK', preview.survivorWorkId, 'SURVIVOR', null, 0);
      this.#lineage(decisionId, 'WORK', preview.duplicateWorkId, 'MERGED_ENTITY', null, 0);
      expressionIds.forEach((id, index) =>
        this.#lineage(decisionId, 'EXPRESSION', id, 'MOVED_CHILD', preview.duplicateWorkId, index),
      );
      this.#audit(
        'ENTITY_MERGED',
        'WORK',
        preview.survivorWorkId,
        {
          decisionId,
          duplicateWorkId: preview.duplicateWorkId,
        },
        now,
      );
      return decisionId;
    });
  }

  public previewWorkSplit(
    sourceWorkId: string,
    sourceRevision: number,
    expressionIds: readonly string[],
    newCanonicalTitle: string,
  ): WorkSplitPreviewV1 {
    const source = this.#workRow(sourceWorkId);
    assertExpectedRevision(source.catalog_revision as number, sourceRevision);
    if (
      source.catalog_state !== 'ACTIVE' ||
      expressionIds.length < 1 ||
      new Set(expressionIds).size !== expressionIds.length ||
      newCanonicalTitle.trim().length < 1 ||
      newCanonicalTitle.length > 512
    ) {
      throw new CatalogError('CATALOG_INVALID_REQUEST');
    }
    const rows = this.#database
      .prepare(
        `SELECT id FROM expressions
         WHERE work_id = ? AND id IN (${expressionIds.map(() => '?').join(',')})
         ORDER BY id`,
      )
      .all(sourceWorkId, ...expressionIds) as Row[];
    if (rows.length !== expressionIds.length) throw new CatalogError('CATALOG_CONFLICT');
    const withoutHash = {
      expressionIds: Object.freeze([...expressionIds].sort()),
      newCanonicalTitle,
      sourceRevision,
      sourceWorkId,
    };
    return Object.freeze({
      ...withoutHash,
      previewHash: catalogSemanticHash(withoutHash),
    });
  }

  public splitWork(preview: WorkSplitPreviewV1, newWorkId: string, now: string): string {
    const current = this.previewWorkSplit(
      preview.sourceWorkId,
      preview.sourceRevision,
      preview.expressionIds,
      preview.newCanonicalTitle,
    );
    if (current.previewHash !== preview.previewHash) {
      throw new CatalogError('CATALOG_STALE_REVISION', { retryable: true });
    }
    return runInTransaction(this.#database, () => {
      const decisionId = `decision-${this.#idFactory()}`;
      const source = this.#workRow(preview.sourceWorkId);
      this.#database
        .prepare(
          `INSERT INTO books (
            id, canonical_title, original_title, author_id, country_or_region,
            language, work_type, series_name, series_order, synopsis,
            discovery_status, research_score, topic_score, created_at, updated_at,
            catalog_state, catalog_revision
          ) VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, NULL,
                    'USER_CONFIRMED_SPLIT', NULL, NULL, ?, ?, 'ACTIVE', 1)`,
        )
        .run(
          newWorkId,
          preview.newCanonicalTitle,
          source.country_or_region ?? null,
          source.language ?? null,
          source.work_type ?? null,
          now,
          now,
        );
      this.#database
        .prepare(
          `UPDATE expressions
           SET work_id = ?, revision = revision + 1, updated_at = ?
           WHERE work_id = ? AND id IN (${preview.expressionIds.map(() => '?').join(',')})`,
        )
        .run(newWorkId, now, preview.sourceWorkId, ...preview.expressionIds);
      this.#database
        .prepare(
          `UPDATE books SET catalog_revision = catalog_revision + 1, updated_at = ?
           WHERE id = ? AND catalog_revision = ?`,
        )
        .run(now, preview.sourceWorkId, preview.sourceRevision);
      this.#database
        .prepare(
          `INSERT INTO catalog_entity_aliases (
            id, entity_type, entity_id, alias_kind, raw_value, normalized_value,
            normalization_version, created_at
          ) VALUES (?, 'WORK', ?, 'CANONICAL', ?, ?, ?, ?)`,
        )
        .run(
          `alias-${this.#idFactory()}`,
          newWorkId,
          preview.newCanonicalTitle,
          normalizeBibliographicText(preview.newCanonicalTitle).normalized,
          BIBLIOGRAPHY_NORMALIZATION_VERSION,
          now,
        );
      const before = {
        expressionIds: preview.expressionIds,
        sourceRevision: preview.sourceRevision,
        sourceWorkId: preview.sourceWorkId,
      };
      const after = {
        newCanonicalTitle: preview.newCanonicalTitle,
        newWorkId,
      };
      this.#insertDecision(
        decisionId,
        'SPLIT',
        preview.sourceWorkId,
        newWorkId,
        null,
        preview.previewHash,
        before,
        after,
        now,
      );
      this.#lineage(decisionId, 'WORK', newWorkId, 'CREATED_SPLIT', preview.sourceWorkId, 0);
      preview.expressionIds.forEach((id, index) =>
        this.#lineage(decisionId, 'EXPRESSION', id, 'MOVED_CHILD', preview.sourceWorkId, index),
      );
      this.#audit(
        'ENTITY_SPLIT',
        'WORK',
        preview.sourceWorkId,
        {
          decisionId,
          newWorkId,
        },
        now,
      );
      return decisionId;
    });
  }

  public previewUndoDecision(decisionId: string): UndoDecisionPreviewV1 {
    const row = this.#database
      .prepare(
        `SELECT id, decision_type FROM resolution_decisions
         WHERE id = ? AND decision_type IN ('MERGE', 'SPLIT')`,
      )
      .get(decisionId) as Row | undefined;
    if (row === undefined) throw new CatalogError('CATALOG_ENTITY_NOT_FOUND');
    const existingUndo = this.#database
      .prepare(
        `SELECT 1 AS present FROM resolution_decisions
         WHERE parent_decision_id = ? AND decision_type = 'UNDO'`,
      )
      .get(decisionId);
    if (existingUndo !== undefined) throw new CatalogError('CATALOG_CONFLICT');
    const withoutHash = {
      decisionId,
      decisionType: row.decision_type as 'MERGE' | 'SPLIT',
    };
    return Object.freeze({
      ...withoutHash,
      previewHash: catalogSemanticHash(withoutHash),
    });
  }

  public undoDecision(preview: UndoDecisionPreviewV1, now: string): string {
    const current = this.previewUndoDecision(preview.decisionId);
    if (current.previewHash !== preview.previewHash) {
      throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
    }
    return runInTransaction(this.#database, () => {
      const row = this.#database
        .prepare('SELECT * FROM resolution_decisions WHERE id = ?')
        .get(preview.decisionId) as Row;
      const before = JSON.parse(row.before_json as string) as Record<string, unknown>;
      const after = JSON.parse(row.after_json as string) as Record<string, unknown>;
      const undoId = `decision-${this.#idFactory()}`;
      if (row.decision_type === 'MERGE') {
        const duplicateWorkId = before.duplicateWorkId as string;
        const survivorWorkId = before.survivorWorkId as string;
        const expressionIds = before.expressionIds as string[];
        if (expressionIds.length > 0) {
          this.#database
            .prepare(
              `UPDATE expressions SET work_id = ?, revision = revision + 1, updated_at = ?
               WHERE work_id = ? AND id IN (${expressionIds.map(() => '?').join(',')})`,
            )
            .run(duplicateWorkId, now, survivorWorkId, ...expressionIds);
        }
        const downstream = before.downstream as Record<string, string[]>;
        for (const table of ['reading_states', 'research_dossiers', 'topics']) {
          const ids = downstream[table] ?? [];
          if (ids.length > 0) {
            this.#database
              .prepare(
                `UPDATE ${table} SET book_id = ?
                 WHERE book_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
              )
              .run(duplicateWorkId, survivorWorkId, ...ids);
          }
        }
        this.#database
          .prepare(
            `UPDATE books SET catalog_state = 'ACTIVE',
               catalog_revision = catalog_revision + 1, updated_at = ? WHERE id = ?`,
          )
          .run(now, duplicateWorkId);
        this.#database
          .prepare(
            `UPDATE books SET catalog_revision = catalog_revision + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, survivorWorkId);
        this.#database
          .prepare(
            `UPDATE entity_redirects SET active = 0, updated_at = ?
             WHERE entity_type = 'WORK' AND from_entity_id = ? AND decision_id = ?`,
          )
          .run(now, duplicateWorkId, preview.decisionId);
      } else {
        const sourceWorkId = before.sourceWorkId as string;
        const expressionIds = before.expressionIds as string[];
        const newWorkId = after.newWorkId as string;
        if (expressionIds.length > 0) {
          this.#database
            .prepare(
              `UPDATE expressions SET work_id = ?, revision = revision + 1, updated_at = ?
               WHERE work_id = ? AND id IN (${expressionIds.map(() => '?').join(',')})`,
            )
            .run(sourceWorkId, now, newWorkId, ...expressionIds);
        }
        this.#database
          .prepare(
            `UPDATE books SET catalog_state = 'RETIRED',
               catalog_revision = catalog_revision + 1, updated_at = ? WHERE id = ?`,
          )
          .run(now, newWorkId);
        this.#database
          .prepare(
            `UPDATE books SET catalog_revision = catalog_revision + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, sourceWorkId);
        this.#database
          .prepare(
            `INSERT INTO entity_redirects (
              entity_type, from_entity_id, to_entity_id, decision_id, created_at, updated_at
            ) VALUES ('WORK', ?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, from_entity_id) DO UPDATE SET
              to_entity_id = excluded.to_entity_id,
              decision_id = excluded.decision_id,
              active = 1,
              updated_at = excluded.updated_at`,
          )
          .run(newWorkId, sourceWorkId, undoId, now, now);
      }
      this.#insertDecision(
        undoId,
        'UNDO',
        row.survivor_entity_id as string,
        row.affected_entity_id as string,
        preview.decisionId,
        preview.previewHash,
        { parentDecisionId: preview.decisionId },
        { restored: true },
        now,
      );
      this.#audit(
        'DECISION_UNDONE',
        'WORK',
        row.survivor_entity_id as string,
        {
          parentDecisionId: preview.decisionId,
          undoId,
        },
        now,
      );
      return undoId;
    });
  }

  public resolveWorkId(workId: string): string | null {
    const work = this.#database.prepare('SELECT id FROM books WHERE id = ?').get(workId);
    if (work === undefined) return null;
    let current = workId;
    const visited = new Set<string>();
    while (!visited.has(current)) {
      visited.add(current);
      const redirect = this.#database
        .prepare(
          `SELECT to_entity_id FROM entity_redirects
           WHERE entity_type = 'WORK' AND from_entity_id = ? AND active = 1`,
        )
        .get(current) as Row | undefined;
      if (redirect === undefined) return current;
      current = redirect.to_entity_id as string;
    }
    throw new CatalogError('CATALOG_CONFLICT');
  }

  public queryPlanEvidence(): readonly {
    readonly detail: string;
  }[] {
    return Object.freeze(
      (
        this.#database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT book.id
             FROM books AS book
             WHERE book.catalog_state = 'ACTIVE'
               AND lower(book.canonical_title) LIKE ?
             ORDER BY lower(book.canonical_title), book.id
             LIMIT 50 OFFSET 0`,
          )
          .all('%synthetic%') as Row[]
      ).map((row) => Object.freeze({ detail: row.detail as string })),
    );
  }

  #observationFromOrigin(input: DiscoveryOriginInputV1, now: string): BibliographicObservationV1 {
    let row: Row | undefined;
    let candidateId: string | null;
    let documentId: string | null = null;
    let clipId: string | null = null;
    if (input.originKind === 'SEARCH_CANDIDATE') {
      row = this.#database
        .prepare(
          `SELECT id, title, language_hint
           FROM search_result_candidates
           WHERE id = ? AND evidence_eligibility = 'LEAD_ONLY'
             AND fetch_state = 'NOT_FETCHED' AND truth_status = 'UNVERIFIED'
             AND fact_status = 'NOT_A_FACT'`,
        )
        .get(input.originRecordId) as Row | undefined;
      candidateId = row?.id as string | null;
    } else if (input.originKind === 'FETCH_DOCUMENT') {
      row = this.#database
        .prepare(
          `SELECT document.id, document.language_hint,
                  candidate.id AS candidate_id, candidate.title
           FROM fetched_documents AS document
           JOIN fetch_runs AS run ON run.document_id = document.id AND run.status = 'SUCCEEDED'
           JOIN search_result_candidates AS candidate ON candidate.id = run.search_candidate_id
           WHERE document.id = ?
             AND document.evidence_eligibility = 'FETCHED_NOT_EVIDENCE'
             AND document.truth_status = 'UNVERIFIED'
             AND document.fact_status = 'NOT_A_FACT'
             AND candidate.evidence_eligibility = 'LEAD_ONLY'
             AND candidate.fetch_state = 'NOT_FETCHED'
             AND candidate.truth_status = 'UNVERIFIED'
             AND candidate.fact_status = 'NOT_A_FACT'
           ORDER BY run.finished_at DESC LIMIT 1`,
        )
        .get(input.originRecordId) as Row | undefined;
      candidateId = row?.candidate_id as string | null;
      documentId = row?.id as string | null;
    } else if (input.originKind === 'BROWSER_CLIP_CANDIDATE') {
      row = this.#database
        .prepare(
          `SELECT candidate.id AS candidate_id, candidate.title, candidate.language_hint,
                  clip.id AS clip_id, clip.page_title
           FROM clip_search_candidate_links AS link
           JOIN search_result_candidates AS candidate ON candidate.id = link.candidate_id
           JOIN clips AS clip ON clip.id = link.clip_id
           WHERE candidate.id = ?
             AND candidate.evidence_eligibility = 'LEAD_ONLY'
             AND candidate.fetch_state = 'NOT_FETCHED'
             AND candidate.truth_status = 'UNVERIFIED'
             AND candidate.fact_status = 'NOT_A_FACT'`,
        )
        .get(input.originRecordId) as Row | undefined;
      candidateId = row?.candidate_id as string | null;
      clipId = row?.clip_id as string | null;
    } else {
      throw new CatalogError('CATALOG_INVALID_REQUEST');
    }
    if (row === undefined) throw new CatalogError('CATALOG_ENTITY_NOT_FOUND');
    const rawTitle =
      (row.page_title as string | null | undefined) ??
      (row.title as string | null | undefined) ??
      null;
    const displayTitle = rawTitle === null ? null : normalizeBibliographicText(rawTitle);
    const language = (row.language_hint as string | null | undefined)?.trim().slice(0, 32) ?? null;
    const strata =
      language === null
        ? ['time-unknown']
        : language.toLowerCase().startsWith('ja')
          ? ['japan-mystery', 'time-unknown']
          : language.toLowerCase().startsWith('en')
            ? ['western-mystery', 'time-unknown']
            : language.toLowerCase().startsWith('zh')
              ? ['chinese-publishing', 'time-unknown']
              : ['time-unknown'];
    return validateBibliographicObservationV1({
      contractVersion: BIBLIOGRAPHIC_OBSERVATION_VERSION,
      contributorHints: [],
      displayTitle:
        displayTitle === null
          ? null
          : { normalized: displayTitle.normalized, raw: displayTitle.raw },
      factStatus: 'NOT_A_FACT',
      fieldProvenance:
        displayTitle === null
          ? []
          : [
              {
                algorithmVersion: BIBLIOGRAPHY_NORMALIZATION_VERSION,
                field: 'displayTitle',
                inputObservationIds: [],
                originKind: input.originKind,
                originRecordId: input.originRecordId,
              },
            ],
      formatHint: null,
      identifierHints: [],
      languageHints: language === null ? [] : [language],
      normalizationVersion: BIBLIOGRAPHY_NORMALIZATION_VERSION,
      observationId: `observation-${this.#idFactory()}`,
      observedAt: now,
      organizationHints: [],
      originKind: input.originKind,
      originRecordId: input.originRecordId,
      originRevision: input.originRevision,
      originalTitleHint: null,
      publicationDateHint: null,
      publicationYearHint: null,
      scriptHints: [],
      seriesHint: null,
      sourceIdentity: { candidateId, clipId, documentId },
      strata,
      truthStatus: 'UNVERIFIED',
      warnings: ['UNVERIFIED_PERSISTED_DISCOVERY_INPUT'],
      workTypeHint: null,
    });
  }

  #insertObservationAndResolve(
    observation: BibliographicObservationV1,
    runId: string | null,
    now: string,
  ): DiscoveryProcessCountsV1 {
    const existing = this.#database
      .prepare(
        `SELECT id FROM bibliographic_observations
         WHERE origin_kind = ? AND origin_record_id = ? AND origin_revision = ?`,
      )
      .get(observation.originKind, observation.originRecordId, observation.originRevision) as
      Row | undefined;
    if (existing !== undefined) return ZERO_COUNTS;
    this.#database
      .prepare(
        `INSERT INTO bibliographic_observations (
          id, contract_version, origin_kind, origin_record_id, origin_revision,
          observed_at, display_title_raw, display_title_normalized,
          original_title_raw, original_title_normalized, payload_json,
          candidate_id, document_id, clip_id, truth_status, fact_status,
          normalization_version, warnings_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        observation.observationId,
        observation.contractVersion,
        observation.originKind,
        observation.originRecordId,
        observation.originRevision,
        observation.observedAt,
        observation.displayTitle?.raw ?? null,
        observation.displayTitle?.normalized ?? null,
        observation.originalTitleHint?.raw ?? null,
        observation.originalTitleHint?.normalized ?? null,
        json(observation, 131_072),
        observation.sourceIdentity.candidateId,
        observation.sourceIdentity.documentId,
        observation.sourceIdentity.clipId,
        observation.truthStatus,
        observation.factStatus,
        observation.normalizationVersion,
        json(observation.warnings, 8_192),
        now,
      );
    observation.fieldProvenance.forEach((provenance, ordinal) => {
      const hint =
        provenance.field === 'displayTitle'
          ? observation.displayTitle
          : provenance.field === 'originalTitleHint'
            ? observation.originalTitleHint
            : null;
      this.#database
        .prepare(
          `INSERT INTO bibliographic_observation_fields (
            observation_id, field_name, ordinal, raw_value, normalized_value,
            algorithm_version, provenance_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          observation.observationId,
          provenance.field,
          ordinal,
          hint?.raw ?? null,
          hint?.normalized ?? null,
          provenance.algorithmVersion,
          json(provenance, 16_384),
        );
    });
    this.#audit(
      'OBSERVATION_CREATED',
      'OBSERVATION',
      observation.observationId,
      {
        originKind: observation.originKind,
        originRecordId: observation.originRecordId,
      },
      now,
    );
    const resolution = this.#resolveObservation(observation, now);
    if (runId !== null) {
      this.#updateCoverage(runId, observation, resolution);
    }
    return Object.freeze({
      ...resolution,
      observations: 1,
    });
  }

  #resolveObservation(
    observation: BibliographicObservationV1,
    now: string,
  ): Omit<DiscoveryProcessCountsV1, 'observations'> & {
    readonly invalidIdentifiers: number;
    readonly outcome: 'CONFLICT' | 'EXACT_LINK' | 'INSUFFICIENT' | 'PROBABLE_REVIEW';
  } {
    const validIdentifiers = observation.identifierHints.filter(
      (identifier) => identifier.valid && identifier.normalizedValue !== null,
    );
    const invalidIdentifiers = observation.identifierHints.length - validIdentifiers.length;
    const existingRows =
      validIdentifiers.length === 0
        ? []
        : (this.#database
            .prepare(
              `SELECT identifier.namespace, identifier.normalized_value,
                      edition.id AS edition_id, expression.id AS expression_id,
                      work.id AS work_id, lower(trim(work.canonical_title)) AS normalized_title,
                      expression.language
               FROM bibliographic_identifiers AS identifier
               JOIN book_editions AS edition ON edition.id = identifier.entity_id
               JOIN expressions AS expression ON expression.id = edition.expression_id
               JOIN books AS work ON work.id = expression.work_id
               WHERE identifier.namespace = ? AND identifier.normalized_value = ?`,
            )
            .all(
              validIdentifiers[0]?.namespace ?? '',
              validIdentifiers[0]?.normalizedValue ?? '',
            ) as Row[]);
    if (existingRows.length > 0) {
      const existing = existingRows[0] as Row;
      const comparison = compareBibliographicEntities(
        {
          contributorAliases: [],
          entityId: existing.edition_id as string,
          entityType: 'EDITION',
          identifiers: existingRows.map((row) => ({
            namespace: row.namespace as string,
            normalizedValue: row.normalized_value as string,
          })),
          language: existing.language as string | null,
          normalizedTitle: existing.normalized_title as string | null,
        },
        {
          contributorAliases: observation.contributorHints.map(
            (contributor) => contributor.name.normalized,
          ),
          entityId: observation.observationId,
          entityType: 'EDITION',
          identifiers: validIdentifiers.map((identifier) => ({
            namespace: identifier.namespace,
            normalizedValue: identifier.normalizedValue as string,
          })),
          language: observation.languageHints[0] ?? null,
          normalizedTitle: observation.displayTitle?.normalized ?? null,
        },
      );
      if (comparison.outcome === 'EXACT_LINK') {
        this.#linkObservation(
          observation.observationId,
          'WORK',
          existing.work_id as string,
          'EXACT_LINK',
          now,
        );
        this.#linkObservation(
          observation.observationId,
          'EXPRESSION',
          existing.expression_id as string,
          'EXACT_LINK',
          now,
        );
        this.#linkObservation(
          observation.observationId,
          'EDITION',
          existing.edition_id as string,
          'EXACT_LINK',
          now,
        );
        this.#audit(
          'ENTITY_EXACT_LINKED',
          'EDITION',
          existing.edition_id as string,
          {
            observationId: observation.observationId,
          },
          now,
        );
        return {
          editions: 0,
          expressions: 0,
          invalidIdentifiers,
          outcome: 'EXACT_LINK',
          reviewCases: 0,
          works: 0,
        };
      }
      this.#createResolutionCase(
        observation.observationId,
        'EDITION',
        existing.edition_id as string,
        'CONFLICT',
        comparison.features,
        now,
      );
      return {
        editions: 0,
        expressions: 0,
        invalidIdentifiers,
        outcome: 'CONFLICT',
        reviewCases: 1,
        works: 0,
      };
    }
    if (validIdentifiers.length > 0 && observation.displayTitle !== null) {
      return {
        ...this.#createEntityCluster(observation, validIdentifiers, now),
        invalidIdentifiers,
        outcome: 'EXACT_LINK',
      };
    }
    const candidate = observation.displayTitle
      ? (this.#database
          .prepare(
            `SELECT entity_id FROM catalog_entity_aliases
             WHERE entity_type = 'WORK' AND normalized_value = ?
             ORDER BY entity_id LIMIT 1`,
          )
          .get(observation.displayTitle.normalized) as Row | undefined)
      : undefined;
    const outcome = candidate === undefined ? 'INSUFFICIENT' : 'PROBABLE_REVIEW';
    this.#createResolutionCase(
      observation.observationId,
      'WORK',
      (candidate?.entity_id as string | undefined) ?? null,
      outcome,
      {
        contributorOverlap: 0,
        entityTypeCompatible: true,
        languageCompatible: true,
        strongIdentifierConflicts: 0,
        strongIdentifierMatches: 0,
        titleEqual: candidate !== undefined,
      },
      now,
    );
    return {
      editions: 0,
      expressions: 0,
      invalidIdentifiers,
      outcome,
      reviewCases: 1,
      works: 0,
    };
  }

  #createEntityCluster(
    observation: BibliographicObservationV1,
    identifiers: readonly BibliographicObservationV1['identifierHints'][number][],
    now: string,
  ): Omit<DiscoveryProcessCountsV1, 'observations'> {
    if (observation.displayTitle === null) {
      throw new CatalogError('CATALOG_INVALID_OBSERVATION', {
        retryable: false,
        safeDetails: { field: 'displayTitle' },
      });
    }
    const workId = `work-${this.#idFactory()}`;
    const expressionId = `expression-${this.#idFactory()}`;
    const editionId = `edition-${this.#idFactory()}`;
    const displayTitle = observation.displayTitle;
    this.#database
      .prepare(
        `INSERT INTO books (
          id, canonical_title, original_title, author_id, country_or_region, language,
          work_type, series_name, series_order, synopsis, discovery_status,
          research_score, topic_score, created_at, updated_at, catalog_state, catalog_revision
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL,
                  'UNVERIFIED_OBSERVATION', NULL, NULL, ?, ?, 'ACTIVE', 1)`,
      )
      .run(
        workId,
        displayTitle.raw,
        observation.originalTitleHint?.raw ?? null,
        observation.languageHints[0] ?? null,
        observation.workTypeHint ?? 'UNKNOWN',
        observation.seriesHint?.raw ?? null,
        now,
        now,
      );
    const translatorCount = observation.contributorHints.filter((hint) =>
      hint.roles.includes('TRANSLATOR'),
    ).length;
    this.#database
      .prepare(
        `INSERT INTO expressions (
          id, work_id, expression_kind, canonical_title, normalized_title,
          language, script, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        expressionId,
        workId,
        translatorCount > 0 ? 'TRANSLATION' : 'LEGACY_UNSPECIFIED',
        displayTitle.raw,
        displayTitle.normalized,
        observation.languageHints[0] ?? null,
        observation.scriptHints[0] ?? null,
        now,
        now,
      );
    const isbn = identifiers.find((identifier) => identifier.namespace === 'ISBN_13');
    this.#database
      .prepare(
        `INSERT INTO book_editions (
          id, expression_id, isbn, translated_title, translator, publisher,
          publication_date, edition_label, format, platform, is_motie, is_unreleased,
          catalog_state, catalog_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, 'ACTIVE', 1)`,
      )
      .run(
        editionId,
        expressionId,
        isbn?.normalizedValue ?? null,
        observation.originalTitleHint === null ? null : (observation.displayTitle?.raw ?? null),
        observation.contributorHints.find((hint) => hint.roles.includes('TRANSLATOR'))?.name.raw ??
          null,
        observation.organizationHints.find((hint) => hint.roles.includes('PUBLISHER'))?.name.raw ??
          null,
        observation.publicationDateHint,
        observation.formatHint,
        observation.organizationHints.find((hint) => hint.roles.includes('PLATFORM'))?.name.raw ??
          null,
      );
    const aliasStatement = this.#database.prepare(
      `INSERT INTO catalog_entity_aliases (
        id, entity_type, entity_id, alias_kind, raw_value, normalized_value,
        language, script, normalization_version, observation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    aliasStatement.run(
      `alias-${this.#idFactory()}`,
      'WORK',
      workId,
      'CANONICAL',
      displayTitle.raw,
      displayTitle.normalized,
      observation.languageHints[0] ?? null,
      observation.scriptHints[0] ?? null,
      observation.normalizationVersion,
      observation.observationId,
      now,
    );
    if (observation.originalTitleHint !== null) {
      aliasStatement.run(
        `alias-${this.#idFactory()}`,
        'WORK',
        workId,
        'ORIGINAL',
        observation.originalTitleHint.raw,
        observation.originalTitleHint.normalized,
        observation.languageHints[0] ?? null,
        observation.scriptHints[0] ?? null,
        observation.normalizationVersion,
        observation.observationId,
        now,
      );
    }
    for (const identifier of identifiers) {
      this.#database
        .prepare(
          `INSERT INTO bibliographic_identifiers (
            id, entity_type, entity_id, namespace, normalized_value,
            observation_id, created_at
          ) VALUES (?, 'EDITION', ?, ?, ?, ?, ?)`,
        )
        .run(
          `identifier-${this.#idFactory()}`,
          editionId,
          identifier.namespace,
          identifier.normalizedValue,
          observation.observationId,
          now,
        );
    }
    for (const contributor of observation.contributorHints) {
      const agentId = `agent-${this.#idFactory()}`;
      this.#database
        .prepare(
          `INSERT INTO catalog_agents (
            id, agent_type, canonical_name, normalized_name, created_at, updated_at
          ) VALUES (?, 'PERSON', ?, ?, ?, ?)`,
        )
        .run(agentId, contributor.name.raw, contributor.name.normalized, now, now);
      aliasStatement.run(
        `alias-${this.#idFactory()}`,
        'AGENT',
        agentId,
        'CANONICAL',
        contributor.name.raw,
        contributor.name.normalized,
        null,
        null,
        observation.normalizationVersion,
        observation.observationId,
        now,
      );
      for (const role of contributor.roles) {
        const scopeType = ['TRANSLATOR', 'ADAPTER', 'EDITOR'].includes(role)
          ? 'EXPRESSION'
          : 'WORK';
        this.#insertAgentRelation(
          scopeType,
          scopeType === 'WORK' ? workId : expressionId,
          agentId,
          role,
          observation.observationId,
          now,
        );
      }
    }
    for (const organization of observation.organizationHints) {
      const agentId = `agent-${this.#idFactory()}`;
      this.#database
        .prepare(
          `INSERT INTO catalog_agents (
            id, agent_type, canonical_name, normalized_name, created_at, updated_at
          ) VALUES (?, 'ORGANIZATION', ?, ?, ?, ?)`,
        )
        .run(agentId, organization.name.raw, organization.name.normalized, now, now);
      aliasStatement.run(
        `alias-${this.#idFactory()}`,
        'AGENT',
        agentId,
        organization.roles.includes('IMPRINT') ? 'IMPRINT_NAME' : 'CANONICAL',
        organization.name.raw,
        organization.name.normalized,
        null,
        null,
        observation.normalizationVersion,
        observation.observationId,
        now,
      );
      for (const role of organization.roles) {
        this.#insertAgentRelation(
          'EDITION',
          editionId,
          agentId,
          role,
          observation.observationId,
          now,
        );
      }
    }
    this.#linkObservation(
      observation.observationId,
      'WORK',
      workId,
      'CREATED_FROM_OBSERVATION',
      now,
    );
    this.#linkObservation(
      observation.observationId,
      'EXPRESSION',
      expressionId,
      'CREATED_FROM_OBSERVATION',
      now,
    );
    this.#linkObservation(
      observation.observationId,
      'EDITION',
      editionId,
      'CREATED_FROM_OBSERVATION',
      now,
    );
    this.#audit(
      'ENTITY_CREATED',
      'WORK',
      workId,
      {
        editionId,
        expressionId,
        observationId: observation.observationId,
      },
      now,
    );
    return { editions: 1, expressions: 1, reviewCases: 0, works: 1 };
  }

  #insertAgentRelation(
    scopeType: 'EDITION' | 'EXPRESSION' | 'WORK',
    scopeId: string,
    agentId: string,
    role: string,
    observationId: string,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO catalog_agent_relations (
          id, scope_type, scope_id, agent_id, role, verification_state,
          observation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'OBSERVED_UNVERIFIED', ?, ?, ?)`,
      )
      .run(
        `relation-${this.#idFactory()}`,
        scopeType,
        scopeId,
        agentId,
        role,
        observationId,
        now,
        now,
      );
  }

  #linkObservation(
    observationId: string,
    entityType: 'EDITION' | 'EXPRESSION' | 'WORK',
    entityId: string,
    outcome: 'CREATED_FROM_OBSERVATION' | 'EXACT_LINK',
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO observation_entity_links (
          observation_id, entity_type, entity_id, link_outcome, rule_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(observationId, entityType, entityId, outcome, ENTITY_RESOLUTION_RULE_VERSION, now);
  }

  #createResolutionCase(
    observationId: string,
    entityType: 'EDITION' | 'WORK',
    candidateEntityId: string | null,
    outcome: 'CONFLICT' | 'INSUFFICIENT' | 'PROBABLE_REVIEW',
    features: unknown,
    now: string,
  ): void {
    const caseId = `case-${this.#idFactory()}`;
    this.#database
      .prepare(
        `INSERT INTO resolution_cases (
          id, observation_id, entity_type, candidate_entity_id, outcome,
          feature_vector_json, rule_version, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
      )
      .run(
        caseId,
        observationId,
        entityType,
        candidateEntityId,
        outcome,
        json(features, 8_192),
        ENTITY_RESOLUTION_RULE_VERSION,
        now,
        now,
      );
    this.#audit(
      'RESOLUTION_CASE_CREATED',
      'RESOLUTION_CASE',
      caseId,
      {
        observationId,
        outcome,
      },
      now,
    );
  }

  #updateCoverage(
    runId: string,
    observation: BibliographicObservationV1,
    resolution: {
      readonly editions: number;
      readonly expressions: number;
      readonly invalidIdentifiers: number;
      readonly outcome: 'CONFLICT' | 'EXACT_LINK' | 'INSUFFICIENT' | 'PROBABLE_REVIEW';
      readonly reviewCases: number;
      readonly works: number;
    },
  ): void {
    const available = new Set(
      (
        this.#database
          .prepare('SELECT stratum_id FROM discovery_run_stratum_coverage WHERE run_id = ?')
          .all(runId) as Row[]
      ).map((row) => row.stratum_id as string),
    );
    const matched = observation.strata.filter((stratum) => available.has(stratum));
    const targets =
      matched.length > 0 ? matched : available.has('time-unknown') ? ['time-unknown'] : [];
    for (const stratum of targets) {
      this.#database
        .prepare(
          `UPDATE discovery_run_stratum_coverage
           SET observation_count = observation_count + 1,
               work_count = work_count + ?,
               expression_count = expression_count + ?,
               edition_count = edition_count + ?,
               unresolved_count = unresolved_count + ?,
               review_count = review_count + ?,
               conflict_count = conflict_count + ?,
               invalid_identifier_count = invalid_identifier_count + ?,
               exact_link_count = exact_link_count + ?,
               provenance_complete_count = provenance_complete_count + ?,
               pre_resolution_count = pre_resolution_count + 1,
               post_resolution_count = post_resolution_count + ?
           WHERE run_id = ? AND stratum_id = ?`,
        )
        .run(
          resolution.works,
          resolution.expressions,
          resolution.editions,
          resolution.outcome === 'INSUFFICIENT' ? 1 : 0,
          resolution.outcome === 'PROBABLE_REVIEW' ? 1 : 0,
          resolution.outcome === 'CONFLICT' ? 1 : 0,
          resolution.invalidIdentifiers,
          resolution.outcome === 'EXACT_LINK' || resolution.works > 0 ? 1 : 0,
          observation.fieldProvenance.length > 0 ? 1 : 0,
          resolution.outcome === 'EXACT_LINK' ? 1 : 0,
          runId,
          stratum,
        );
    }
  }

  #jobResult(
    status: BibliographyJobResultV1['status'],
    runId: string,
    counts: DiscoveryProcessCountsV1,
  ): BibliographyJobResultV1 {
    return Object.freeze({
      counts: Object.freeze({
        editions: counts.editions,
        expressions: counts.expressions,
        observations: counts.observations,
        reviewCases: counts.reviewCases,
        works: counts.works,
      }),
      runId,
      stableError: null,
      status,
    });
  }

  #getRunRow(runId: string): Row {
    const row = this.#database
      .prepare(
        `SELECT run.*, plan.plan_json, profile.synthetic
         FROM discovery_runs AS run
         JOIN discovery_plans AS plan ON plan.id = run.plan_id
         JOIN discovery_profiles AS profile
           ON profile.id = plan.profile_id AND profile.revision = plan.profile_revision
         WHERE run.id = ?`,
      )
      .get(runId) as Row | undefined;
    if (row === undefined) throw new CatalogError('CATALOG_RUN_NOT_FOUND');
    return row;
  }

  #runView(runId: string): CatalogRunViewV1 {
    return this.#rowToRunView(this.#getRunRow(runId));
  }

  #rowToRunView(row: Row): CatalogRunViewV1 {
    return Object.freeze({
      executionId: row.execution_id as string | null,
      externalRequestCount: 0 as const,
      jobId: row.job_id as string | null,
      planId: row.plan_id as string,
      revision: row.revision as number,
      runId: row.id as string,
      status: row.status as string,
      synthetic: row.synthetic === 1,
    });
  }

  #workRow(workId: string): Row {
    const row = this.#database.prepare('SELECT * FROM books WHERE id = ?').get(workId) as
      Row | undefined;
    if (row === undefined) throw new CatalogError('CATALOG_ENTITY_NOT_FOUND');
    return row;
  }

  #insertDecision(
    decisionId: string,
    type: 'MERGE' | 'SPLIT' | 'UNDO',
    survivorId: string,
    affectedId: string,
    parentDecisionId: string | null,
    previewHash: string,
    before: unknown,
    after: unknown,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO resolution_decisions (
          id, decision_type, entity_type, survivor_entity_id, affected_entity_id,
          parent_decision_id, preview_hash, before_json, after_json, actor, created_at
        ) VALUES (?, ?, 'WORK', ?, ?, ?, ?, ?, ?, 'USER', ?)`,
      )
      .run(
        decisionId,
        type,
        survivorId,
        affectedId,
        parentDecisionId,
        previewHash,
        json(before),
        json(after),
        now,
      );
  }

  #lineage(
    decisionId: string,
    entityType: 'EXPRESSION' | 'WORK',
    entityId: string,
    kind: 'CREATED_SPLIT' | 'MERGED_ENTITY' | 'MOVED_CHILD' | 'SURVIVOR',
    parentEntityId: string | null,
    ordinal: number,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO entity_lineage_memberships (
          decision_id, entity_type, entity_id, membership_kind, parent_entity_id, ordinal
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(decisionId, entityType, entityId, kind, parentEntityId, ordinal);
  }

  #audit(
    eventType: string,
    entityType: string,
    entityId: string,
    details: unknown,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO catalog_audit_events (
          id, event_type, entity_type, entity_id, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `audit-${this.#idFactory()}`,
        eventType,
        entityType,
        entityId,
        json(details, 65_536),
        now,
      );
  }
}
