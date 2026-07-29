import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  DOSSIER_BUILD_PLAN_VERSION,
  DOSSIER_CONTRACT_VERSION,
  DOSSIER_COVERAGE_POLICY_VERSION,
  DOSSIER_LIMITS,
  DOSSIER_SCHEMA_VERSION,
  DOSSIER_SECTIONS,
  DossierError,
  buildDossierProjection,
  canonicalDossierJson,
  dossierBuildPlanHash,
  dossierSemanticHash,
  validateDossierBuildJobPayload,
  validateDossierBuildPlan,
  validateResearchDossier,
  type DossierBuildJobPayload,
  type DossierBuildPlan,
  type DossierBuildRun,
  type DossierConflictInput,
  type DossierCoverageSnapshot,
  type DossierEntry,
  type DossierEvidenceInput,
  type DossierFactInput,
  type DossierGap,
  type DossierProjection,
  type DossierSection,
  type DossierSectionCoverage,
  type DossierSubject,
  type ResearchDossier,
  type ResearchDossierVersion,
} from '@mystery-operations/dossier';
import { FACT_POLICY_VERSION } from '@mystery-operations/evidence';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

export interface ConfirmDossierBuildResult {
  readonly enqueue: boolean;
  readonly payload: DossierBuildJobPayload | null;
  readonly run: DossierBuildRun;
}

export interface DossierListItem {
  readonly dossier: ResearchDossier;
  readonly subjectLabel: string;
}

export interface DossierListView {
  readonly items: readonly DossierListItem[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface DossierDetailView {
  readonly coverage: DossierCoverageSnapshot | null;
  readonly dossier: ResearchDossier;
  readonly entries: readonly DossierEntry[];
  readonly entryLimit: number;
  readonly entryOffset: number;
  readonly gaps: readonly DossierGap[];
  readonly runs: readonly DossierBuildRun[];
  readonly sections: readonly DossierSection[];
  readonly versions: readonly ResearchDossierVersion[];
}

export interface DossierVersionDiff {
  readonly addedSemanticKeys: readonly string[];
  readonly fromVersionId: string | null;
  readonly removedSemanticKeys: readonly string[];
  readonly toVersionId: string;
  readonly updatedSemanticKeys: readonly string[];
}

export interface DossierInvalidationInput {
  readonly dependencyId: string;
  readonly dependencyType:
    | 'CLAIM'
    | 'CONFLICT'
    | 'COVERAGE_POLICY'
    | 'EVIDENCE'
    | 'FACT_EVALUATION'
    | 'FACT_POLICY'
    | 'SOURCE_REVISION'
    | 'SUBJECT';
  readonly eventIdentity: string;
  readonly observedRevision: string;
  readonly reasonCode: string;
}

export interface DossierBuildExecutionResult {
  readonly noOp: boolean;
  readonly run: DossierBuildRun;
  readonly versionId: string | null;
}

const HASH = /^[a-f0-9]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function identifier(value: string, maximum = 256): string {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code <= 0x1f || code === 0x7f);
    })
  ) {
    throw new DossierError('DOSSIER_INVALID_REQUEST');
  }
  return value;
}

function iso(value: string): string {
  if (!UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new DossierError('DOSSIER_INVALID_REQUEST');
  }
  return value;
}

function integer(value: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DossierError('DOSSIER_INVALID_REQUEST');
  }
  return value;
}

function safeJson(value: unknown, maximum = 262_144): string {
  const json = canonicalDossierJson(value);
  if (Buffer.byteLength(json, 'utf8') > maximum) {
    throw new DossierError('DOSSIER_CAPACITY_EXCEEDED');
  }
  return json;
}

function parseStringArray(value: unknown): readonly string[] {
  if (typeof value !== 'string') throw new DossierError('DOSSIER_INVALID_CONTRACT');
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new DossierError('DOSSIER_INVALID_CONTRACT');
  }
  return Object.freeze([...parsed]);
}

function asCount(
  database: DatabaseSync,
  sql: string,
  ...parameters: (null | number | string)[]
): number {
  const row = database.prepare(sql).get(...parameters) as { readonly count: number };
  return row.count;
}

function zeroSectionCoverage(): readonly DossierSectionCoverage[] {
  return Object.freeze(
    DOSSIER_SECTIONS.map((section) =>
      Object.freeze({
        basisPoints: 0,
        blockedCount: 0,
        gapCount: 0,
        insufficientCount: 0,
        reasonCodes: Object.freeze(['NOT_BUILT']),
        section,
        staleCount: 0,
        verifiedCount: 0,
      }),
    ),
  );
}

function entrySignature(entry: {
  readonly displayValue: string;
  readonly factStatus: string;
  readonly semanticKey: string;
  readonly structuredValue: unknown;
}): string {
  return dossierSemanticHash({
    displayValue: entry.displayValue,
    factStatus: entry.factStatus,
    semanticKey: entry.semanticKey,
    structuredValue: entry.structuredValue,
  });
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

export class SqliteDossierRepository {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public previewBuild(subjectValue: DossierSubject, nowValue: string): DossierBuildPlan {
    const subject = this.#validateSubject(subjectValue);
    const now = iso(nowValue);
    const dossier = this.#ensureDossier(subject, now);
    if (dossier.state === 'BUILDING') {
      throw new DossierError('DOSSIER_CONFLICT', { retryable: true });
    }
    const projection = this.#loadProjection(subject);
    const currentEntries = this.#currentEntrySignatures(dossier.currentVersionId);
    const nextEntries = new Map(
      projection.entries.map((entry) => [entry.semanticKey, entrySignature(entry)] as const),
    );
    const addedSemanticKeys = [...nextEntries.keys()]
      .filter((key) => !currentEntries.has(key))
      .sort();
    const removedSemanticKeys = [...currentEntries.keys()]
      .filter((key) => !nextEntries.has(key))
      .sort();
    const updatedSemanticKeys = [...nextEntries.keys()]
      .filter((key) => {
        const current = currentEntries.get(key);
        return current !== undefined && current !== nextEntries.get(key);
      })
      .sort();
    const currentCoverage = this.#currentCoverage(dossier.currentVersionId);
    const planId = `dossier-plan-${this.#idFactory()}`;
    const expiresAt = new Date(Date.parse(now) + DOSSIER_LIMITS.planTtlMs).toISOString();
    const estimatedLocalWrites =
      5 +
      projection.sections.length +
      projection.entries.length * 4 +
      projection.gaps.length * 2 +
      projection.dependencies.length;
    if (estimatedLocalWrites > DOSSIER_LIMITS.maxLocalWrites) {
      throw new DossierError('DOSSIER_CAPACITY_EXCEEDED');
    }
    const withoutHash = {
      buildMode:
        dossier.currentVersionId === null
          ? ('INITIAL' as const)
          : dossier.state === 'REBUILD_REQUIRED'
            ? ('INCREMENTAL' as const)
            : ('FULL_REBUILD' as const),
      budgetConclusion: 'NOT_APPLICABLE' as const,
      contractVersion: DOSSIER_BUILD_PLAN_VERSION,
      counts: Object.freeze({
        claimCount: this.#projectionClaimCount(projection),
        conflictCount: projection.entries.filter((entry) => entry.entryKind === 'DISPUTED').length,
        dependencyCount: projection.dependencies.length,
        evidenceCount: new Set(projection.entries.flatMap((entry) => [...entry.evidenceIds])).size,
        gapCount: projection.gaps.length,
      }),
      createdAt: now,
      diff: Object.freeze({
        addedSemanticKeys: Object.freeze(addedSemanticKeys),
        removedSemanticKeys: Object.freeze(removedSemanticKeys),
        updatedSemanticKeys: Object.freeze(updatedSemanticKeys),
      }),
      dossierId: dossier.dossierId,
      estimatedLocalWrites,
      estimatedModelRequests: 0 as const,
      expectedCurrentVersionId: dossier.currentVersionId,
      expectedDossierRevision: dossier.revision,
      expiresAt,
      inputHash: projection.inputHash,
      noOp:
        dossier.currentVersionId !== null &&
        this.#currentInputHash(dossier.currentVersionId) === projection.inputHash,
      planId,
      readinessAfter: projection.readiness,
      readinessBefore: dossier.readiness,
      sectionCoverageAfter: projection.coverage.sections,
      sectionCoverageBefore: currentCoverage?.sections ?? zeroSectionCoverage(),
      subject,
    };
    const plan = validateDossierBuildPlan(
      Object.freeze({ ...withoutHash, planHash: dossierBuildPlanHash(withoutHash) }),
    );
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO research_dossier_build_plans(
             id, dossier_id, contract_version, plan_hash, input_hash,
             expected_dossier_revision, expected_current_version_id, build_mode,
             counts_json, preview_json, no_op, estimated_local_writes,
             estimated_model_requests, budget_conclusion, status, revision,
             created_at, expires_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'NOT_APPLICABLE',
                     'PLANNED', 1, ?, ?, ?)`,
        )
        .run(
          plan.planId,
          plan.dossierId,
          plan.contractVersion,
          plan.planHash,
          plan.inputHash,
          plan.expectedDossierRevision,
          plan.expectedCurrentVersionId,
          plan.buildMode,
          safeJson(plan.counts),
          safeJson(plan),
          plan.noOp ? 1 : 0,
          plan.estimatedLocalWrites,
          now,
          expiresAt,
          now,
        );
      this.#audit('BUILD_PLANNED', dossier.dossierId, now, {
        actor: 'USER',
        after: {
          inputHash: plan.inputHash,
          noOp: plan.noOp,
          planHash: plan.planHash,
        },
        planId: plan.planId,
      });
    });
    return plan;
  }

  public confirmBuild(
    planIdValue: string,
    planHashValue: string,
    executionIdValue: string,
    nowValue: string,
  ): ConfirmDossierBuildResult {
    const planId = identifier(planIdValue);
    const planHash = identifier(planHashValue, 64);
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    if (!HASH.test(planHash)) throw new DossierError('DOSSIER_INVALID_REQUEST');
    const replay = this.#database
      .prepare('SELECT * FROM research_dossier_build_runs WHERE execution_id = ?')
      .get(executionId) as Row | undefined;
    if (replay !== undefined) {
      const run = this.#runFromRow(replay);
      if (run.planId !== planId) throw new DossierError('DOSSIER_CONFLICT');
      return Object.freeze({
        enqueue: ['CONFIRMED', 'QUEUED', 'RUNNING'].includes(run.status),
        payload: null,
        run,
      });
    }
    const planRow = this.#database
      .prepare('SELECT * FROM research_dossier_build_plans WHERE id = ?')
      .get(planId) as Row | undefined;
    if (planRow === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
    const plan = validateDossierBuildPlan(JSON.parse(planRow.preview_json as string));
    if (
      plan.planHash !== planHash ||
      planRow.status !== 'PLANNED' ||
      Date.parse(plan.expiresAt) <= Date.parse(now)
    ) {
      throw new DossierError('DOSSIER_CONFIRMATION_INVALID');
    }
    const dossier = this.#getDossierById(plan.dossierId);
    if (
      dossier.revision !== plan.expectedDossierRevision ||
      dossier.currentVersionId !== plan.expectedCurrentVersionId
    ) {
      throw new DossierError('DOSSIER_STALE_REVISION', { retryable: true });
    }
    const projection = this.#loadProjection(plan.subject);
    if (projection.inputHash !== plan.inputHash) {
      throw new DossierError('DOSSIER_INPUT_CHANGED', { retryable: true });
    }
    return runInTransaction(this.#database, () => {
      const changed = this.#database
        .prepare(
          `UPDATE research_dossier_build_plans
           SET status = 'CONFIRMED', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'PLANNED' AND revision = 1`,
        )
        .run(now, plan.planId);
      if (changed.changes !== 1) {
        throw new DossierError('DOSSIER_STALE_REVISION', { retryable: true });
      }
      const runId = `dossier-run-${this.#idFactory()}`;
      if (plan.noOp) {
        this.#database
          .prepare(
            `INSERT INTO research_dossier_build_runs(
               id, dossier_id, plan_id, execution_id, input_hash, status,
               external_request_count, cost_state, revision, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'NO_OP', 0, 'NOT_INCURRED', 1, ?, ?)`,
          )
          .run(runId, plan.dossierId, plan.planId, executionId, plan.inputHash, now, now);
        this.#database
          .prepare(
            `UPDATE research_dossier_build_plans
             SET status = 'CONSUMED', revision = revision + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, plan.planId);
        this.#audit('BUILD_NO_OP', plan.dossierId, now, {
          actor: 'LOCAL_SYSTEM',
          after: { inputHash: plan.inputHash },
          planId: plan.planId,
          runId,
        });
        return Object.freeze({
          enqueue: false,
          payload: null,
          run: this.#getRun(runId),
        });
      }
      this.#database
        .prepare(
          `INSERT INTO research_dossier_build_runs(
             id, dossier_id, plan_id, execution_id, input_hash, status,
             external_request_count, cost_state, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'CONFIRMED', 0, 'NOT_INCURRED', 1, ?, ?)`,
        )
        .run(runId, plan.dossierId, plan.planId, executionId, plan.inputHash, now, now);
      const dossierChanged = this.#database
        .prepare(
          `UPDATE research_dossiers
           SET state = 'BUILDING', readiness = 'BUILD_REQUIRED',
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND current_version_id IS ?`,
        )
        .run(now, plan.dossierId, plan.expectedDossierRevision, plan.expectedCurrentVersionId);
      if (dossierChanged.changes !== 1) {
        throw new DossierError('DOSSIER_STALE_REVISION', { retryable: true });
      }
      this.#audit('BUILD_CONFIRMED', plan.dossierId, now, {
        actor: 'USER',
        after: { executionId, inputHash: plan.inputHash },
        planId: plan.planId,
        runId,
      });
      const payload = validateDossierBuildJobPayload({
        dossierId: plan.dossierId,
        executionId,
        expectedDossierRevision: plan.expectedDossierRevision + 1,
        inputHash: plan.inputHash,
        planHash: plan.planHash,
        planId: plan.planId,
        subjectId: plan.subject.id,
        subjectType: plan.subject.type,
      });
      return Object.freeze({
        enqueue: true,
        payload,
        run: this.#getRun(runId),
      });
    });
  }

  public markQueued(
    executionIdValue: string,
    jobIdValue: string,
    nowValue: string,
  ): DossierBuildRun {
    const executionId = identifier(executionIdValue);
    const jobId = identifier(jobIdValue);
    const now = iso(nowValue);
    const changed = this.#database
      .prepare(
        `UPDATE research_dossier_build_runs
         SET status = 'QUEUED', job_id = ?, revision = revision + 1, updated_at = ?
         WHERE execution_id = ? AND status = 'CONFIRMED'`,
      )
      .run(jobId, now, executionId);
    if (changed.changes === 0) {
      const existing = this.#getRunByExecution(executionId);
      if (
        existing.jobId !== jobId ||
        !['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(existing.status)
      ) {
        throw new DossierError('DOSSIER_CONFLICT');
      }
      return existing;
    }
    return this.#getRunByExecution(executionId);
  }

  public executeBuild(
    payloadValue: unknown,
    nowValue: string,
    signal?: AbortSignal,
  ): DossierBuildExecutionResult {
    const payload = validateDossierBuildJobPayload(payloadValue);
    const now = iso(nowValue);
    let run = this.#getRunByExecution(payload.executionId);
    if (run.status === 'SUCCEEDED') {
      return Object.freeze({ noOp: false, run, versionId: run.resultVersionId });
    }
    if (run.status === 'NO_OP') {
      return Object.freeze({ noOp: true, run, versionId: null });
    }
    if (run.status === 'CANCEL_REQUESTED' || signalAborted(signal)) {
      run = this.#finishCancelled(run, now);
      return Object.freeze({ noOp: false, run, versionId: null });
    }
    if (!['CONFIRMED', 'QUEUED', 'RUNNING'].includes(run.status)) {
      throw new DossierError('DOSSIER_CONFLICT');
    }
    if (run.status !== 'RUNNING') {
      this.#database
        .prepare(
          `UPDATE research_dossier_build_runs
           SET status = 'RUNNING', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status IN ('CONFIRMED', 'QUEUED')`,
        )
        .run(now, run.runId);
      this.#audit('BUILD_STARTED', run.dossierId, now, {
        actor: 'LOCAL_SYSTEM',
        after: { executionId: run.executionId },
        planId: run.planId,
        runId: run.runId,
      });
      run = this.#getRun(run.runId);
    }
    const subject: DossierSubject = Object.freeze({
      id: payload.subjectId,
      type: payload.subjectType,
    });
    const projection = this.#loadProjection(subject);
    if (projection.inputHash !== payload.inputHash) {
      this.failBuild(payload.executionId, 'DOSSIER_INPUT_CHANGED', now);
      throw new DossierError('DOSSIER_INPUT_CHANGED', { retryable: true });
    }
    if (signalAborted(signal)) {
      run = this.#finishCancelled(run, now);
      return Object.freeze({ noOp: false, run, versionId: null });
    }
    const versionId = runInTransaction(this.#database, () => {
      const currentRun = this.#getRun(run.runId);
      if (currentRun.status === 'CANCEL_REQUESTED') {
        throw new DossierError('DOSSIER_CONFLICT', {
          safeDetails: { cancelled: true },
        });
      }
      const dossier = this.#getDossierById(payload.dossierId);
      if (dossier.revision !== payload.expectedDossierRevision || dossier.state !== 'BUILDING') {
        throw new DossierError('DOSSIER_STALE_REVISION', { retryable: true });
      }
      const checkedProjection = this.#loadProjection(subject);
      if (
        checkedProjection.inputHash !== payload.inputHash ||
        checkedProjection.inputHash !== projection.inputHash
      ) {
        throw new DossierError('DOSSIER_INPUT_CHANGED', { retryable: true });
      }
      const existing = this.#database
        .prepare(
          `SELECT id FROM research_dossier_versions
           WHERE dossier_id = ? AND input_hash = ?`,
        )
        .get(dossier.dossierId, projection.inputHash) as Row | undefined;
      if (existing !== undefined) {
        throw new DossierError('DOSSIER_CONFLICT', {
          safeDetails: { noOpRace: true },
        });
      }
      const nextVersion = (
        this.#database
          .prepare(
            `SELECT coalesce(max(version_number), 0) + 1 AS version
             FROM research_dossier_versions WHERE dossier_id = ?`,
          )
          .get(dossier.dossierId) as { readonly version: number }
      ).version;
      const createdVersionId = `dossier-version-${this.#idFactory()}`;
      this.#publishProjection({
        buildMode: dossier.currentVersionId === null ? 'INITIAL' : 'INCREMENTAL',
        dossier,
        now,
        projection,
        runId: run.runId,
        versionId: createdVersionId,
        versionNumber: nextVersion,
      });
      const rootChanged = this.#database
        .prepare(
          `UPDATE research_dossiers
           SET current_version_id = ?, state = 'CURRENT', readiness = ?,
               invalidation_reasons_json = '[]', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND state = 'BUILDING'`,
        )
        .run(
          createdVersionId,
          projection.readiness,
          now,
          dossier.dossierId,
          payload.expectedDossierRevision,
        );
      if (rootChanged.changes !== 1) {
        throw new DossierError('DOSSIER_STALE_REVISION', { retryable: true });
      }
      this.#database
        .prepare(
          `UPDATE research_dossier_build_runs
           SET status = 'SUCCEEDED', result_version_id = ?,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(createdVersionId, now, run.runId);
      this.#database
        .prepare(
          `UPDATE research_dossier_build_plans
           SET status = 'CONSUMED', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'CONFIRMED'`,
        )
        .run(now, run.planId);
      this.#audit('VERSION_PUBLISHED', dossier.dossierId, now, {
        actor: 'LOCAL_SYSTEM',
        after: {
          inputHash: projection.inputHash,
          readiness: projection.readiness,
          versionNumber: nextVersion,
        },
        planId: run.planId,
        runId: run.runId,
        versionId: createdVersionId,
      });
      return createdVersionId;
    });
    return Object.freeze({
      noOp: false,
      run: this.#getRun(run.runId),
      versionId,
    });
  }

  public failBuild(
    executionIdValue: string,
    errorCodeValue: string,
    nowValue: string,
    ambiguous = false,
  ): DossierBuildRun {
    const executionId = identifier(executionIdValue);
    const errorCode = identifier(errorCodeValue, DOSSIER_LIMITS.errorCodeBytes);
    const now = iso(nowValue);
    return runInTransaction(this.#database, () => {
      const run = this.#getRunByExecution(executionId);
      if (['SUCCEEDED', 'NO_OP', 'CANCELLED'].includes(run.status)) return run;
      this.#database
        .prepare(
          `UPDATE research_dossier_build_runs
           SET status = ?, error_code = ?, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(ambiguous ? 'AMBIGUOUS' : 'FAILED', errorCode, now, run.runId);
      this.#restoreDossierAfterUnpublishedRun(run.dossierId, now, 'FAILED');
      this.#audit('BUILD_FAILED', run.dossierId, now, {
        actor: 'LOCAL_SYSTEM',
        after: { errorCode, status: ambiguous ? 'AMBIGUOUS' : 'FAILED' },
        planId: run.planId,
        runId: run.runId,
      });
      return this.#getRun(run.runId);
    });
  }

  public requestCancel(
    runIdValue: string,
    expectedRevisionValue: number,
    nowValue: string,
  ): DossierBuildRun {
    const runId = identifier(runIdValue);
    const expectedRevision = integer(expectedRevisionValue, 1);
    const now = iso(nowValue);
    const changed = this.#database
      .prepare(
        `UPDATE research_dossier_build_runs
         SET status = 'CANCEL_REQUESTED', revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND status IN ('CONFIRMED', 'QUEUED', 'RUNNING')`,
      )
      .run(now, runId, expectedRevision);
    if (changed.changes !== 1) {
      throw new DossierError('DOSSIER_STALE_REVISION', { retryable: true });
    }
    return this.#getRun(runId);
  }

  public cancelExecution(executionIdValue: string, nowValue: string): DossierBuildRun {
    const executionId = identifier(executionIdValue);
    const now = iso(nowValue);
    const run = this.#getRunByExecution(executionId);
    if (run.status === 'CANCELLED') return run;
    if (['SUCCEEDED', 'NO_OP', 'FAILED', 'AMBIGUOUS'].includes(run.status)) {
      return run;
    }
    return this.#finishCancelled(run, now);
  }

  public invalidateDependency(
    input: DossierInvalidationInput,
    nowValue: string,
  ): readonly string[] {
    const now = iso(nowValue);
    const eventIdentity = identifier(input.eventIdentity, 512);
    const dependencyId = identifier(input.dependencyId);
    const observedRevision = identifier(input.observedRevision, 128);
    const reasonCode = identifier(input.reasonCode, 128);
    if (
      ![
        'CLAIM',
        'CONFLICT',
        'COVERAGE_POLICY',
        'EVIDENCE',
        'FACT_EVALUATION',
        'FACT_POLICY',
        'SOURCE_REVISION',
        'SUBJECT',
      ].includes(input.dependencyType)
    ) {
      throw new DossierError('DOSSIER_INVALID_REQUEST');
    }
    return runInTransaction(this.#database, () => {
      const affected = (
        this.#database
          .prepare(
            `SELECT DISTINCT dossier.id
             FROM research_dossier_dependencies AS dependency
             JOIN research_dossiers AS dossier
               ON dossier.current_version_id = dependency.version_id
             WHERE dependency.dependency_type = ?
               AND dependency.dependency_id = ?
               AND dependency.dependency_revision <> ?
             ORDER BY dossier.id`,
          )
          .all(input.dependencyType, dependencyId, observedRevision) as unknown as readonly Row[]
      ).map((row) => row.id as string);
      for (const dossierId of affected) {
        const dossier = this.#getDossierById(dossierId);
        if (dossier.currentVersionId === null) continue;
        const scopedEventIdentity = `${eventIdentity}:${dossierId}`;
        const inserted = this.#database
          .prepare(
            `INSERT OR IGNORE INTO research_dossier_invalidations(
               id, event_identity, dossier_id, current_version_id,
               dependency_type, dependency_id, observed_revision, reason_code, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `dossier-invalidation-${dossierSemanticHash(scopedEventIdentity)}`,
            scopedEventIdentity,
            dossierId,
            dossier.currentVersionId,
            input.dependencyType,
            dependencyId,
            observedRevision,
            reasonCode,
            now,
          );
        if (inserted.changes === 0) continue;
        const reasons = [...new Set([...dossier.invalidationReasons, reasonCode])].sort();
        this.#database
          .prepare(
            `UPDATE research_dossiers
             SET state = 'REBUILD_REQUIRED', readiness = 'BUILD_REQUIRED',
                 invalidation_reasons_json = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND current_version_id = ?`,
          )
          .run(safeJson(reasons), now, dossierId, dossier.currentVersionId);
        this.#audit('DOSSIER_INVALIDATED', dossierId, now, {
          actor: 'LOCAL_SYSTEM',
          after: {
            dependencyId,
            dependencyType: input.dependencyType,
            observedRevision,
            reasonCode,
          },
          versionId: dossier.currentVersionId,
        });
      }
      return Object.freeze(affected);
    });
  }

  public listDossiers(limitValue = 50, offsetValue = 0): DossierListView {
    const limit = integer(limitValue, 1, DOSSIER_LIMITS.maxPageSize);
    const offset = integer(offsetValue);
    const rows = this.#database
      .prepare(
        `SELECT dossier.*,
                CASE dossier.subject_type
                  WHEN 'WORK' THEN book.canonical_title
                  WHEN 'EXPRESSION' THEN expression.canonical_title
                  ELSE coalesce(edition.translated_title, edition.isbn, edition.id)
                END AS subject_label
         FROM research_dossiers AS dossier
         LEFT JOIN books AS book
           ON dossier.subject_type = 'WORK' AND book.id = dossier.subject_id
         LEFT JOIN expressions AS expression
           ON dossier.subject_type = 'EXPRESSION' AND expression.id = dossier.subject_id
         LEFT JOIN book_editions AS edition
           ON dossier.subject_type = 'EDITION' AND edition.id = dossier.subject_id
         ORDER BY dossier.updated_at DESC, dossier.id
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as unknown as readonly Row[];
    return Object.freeze({
      items: Object.freeze(
        rows.map((row) =>
          Object.freeze({
            dossier: this.#dossierFromRow(row),
            subjectLabel: (row.subject_label as string | null) ?? (row.subject_id as string),
          }),
        ),
      ),
      limit,
      offset,
      total: asCount(this.#database, 'SELECT count(*) AS count FROM research_dossiers'),
    });
  }

  public getDossierDetail(
    dossierIdValue: string,
    entryLimitValue = 50,
    entryOffsetValue = 0,
  ): DossierDetailView {
    const dossierId = identifier(dossierIdValue, 512);
    const entryLimit = integer(entryLimitValue, 1, DOSSIER_LIMITS.maxPageSize);
    const entryOffset = integer(entryOffsetValue);
    const dossier = this.#getDossierById(dossierId);
    const versionId = dossier.currentVersionId;
    const sections = versionId === null ? [] : this.#sections(versionId);
    const entries = versionId === null ? [] : this.#entries(versionId, entryLimit, entryOffset);
    const gaps = versionId === null ? [] : this.#gaps(versionId, entryLimit, entryOffset);
    const versions = (
      this.#database
        .prepare(
          `SELECT version.*, CASE WHEN dossier.current_version_id = version.id THEN 1 ELSE 0 END
             AS is_current
           FROM research_dossier_versions AS version
           JOIN research_dossiers AS dossier ON dossier.id = version.dossier_id
           WHERE version.dossier_id = ?
           ORDER BY version.version_number DESC, version.id
           LIMIT 100`,
        )
        .all(dossierId) as unknown as readonly Row[]
    ).map((row) => this.#versionFromRow(row));
    const runs = (
      this.#database
        .prepare(
          `SELECT * FROM research_dossier_build_runs
           WHERE dossier_id = ? ORDER BY created_at DESC, id LIMIT 50`,
        )
        .all(dossierId) as unknown as readonly Row[]
    ).map((row) => this.#runFromRow(row));
    return Object.freeze({
      coverage: versionId === null ? null : this.#currentCoverage(versionId),
      dossier,
      entries: Object.freeze(entries),
      entryLimit,
      entryOffset,
      gaps: Object.freeze(gaps),
      runs: Object.freeze(runs),
      sections: Object.freeze(sections),
      versions: Object.freeze(versions),
    });
  }

  public diffVersions(
    dossierIdValue: string,
    toVersionIdValue: string,
    fromVersionIdValue: string | null,
  ): DossierVersionDiff {
    const dossierId = identifier(dossierIdValue, 512);
    const toVersionId = identifier(toVersionIdValue, 768);
    const fromVersionId = fromVersionIdValue === null ? null : identifier(fromVersionIdValue, 768);
    this.#assertVersionOwner(toVersionId, dossierId);
    if (fromVersionId !== null) this.#assertVersionOwner(fromVersionId, dossierId);
    const load = (versionId: string | null): Map<string, string> => {
      if (versionId === null) return new Map();
      const rows = this.#database
        .prepare(
          `SELECT semantic_key, display_value, structured_value_json, fact_status
           FROM research_dossier_entries WHERE version_id = ?
           ORDER BY semantic_key`,
        )
        .all(versionId) as unknown as readonly Row[];
      return new Map(
        rows.map((row) => [
          row.semantic_key as string,
          dossierSemanticHash({
            displayValue: row.display_value,
            factStatus: row.fact_status,
            semanticKey: row.semantic_key,
            structuredValue: JSON.parse(row.structured_value_json as string),
          }),
        ]),
      );
    };
    const before = load(fromVersionId);
    const after = load(toVersionId);
    return Object.freeze({
      addedSemanticKeys: Object.freeze([...after.keys()].filter((key) => !before.has(key)).sort()),
      fromVersionId,
      removedSemanticKeys: Object.freeze(
        [...before.keys()].filter((key) => !after.has(key)).sort(),
      ),
      toVersionId,
      updatedSemanticKeys: Object.freeze(
        [...after.keys()]
          .filter((key) => before.has(key) && before.get(key) !== after.get(key))
          .sort(),
      ),
    });
  }

  public queryPlanEvidence(): readonly string[] {
    const queries = [
      `EXPLAIN QUERY PLAN
       SELECT version_id FROM research_dossier_dependencies
       WHERE dependency_type = 'SOURCE_REVISION' AND dependency_id = 'source'
         AND dependency_revision <> '2'
       ORDER BY version_id`,
      `EXPLAIN QUERY PLAN
       SELECT id FROM research_dossiers
       WHERE state = 'REBUILD_REQUIRED' ORDER BY updated_at, id LIMIT 50`,
      `EXPLAIN QUERY PLAN
       SELECT id FROM research_dossier_entries
       WHERE version_id = 'version' AND section_key = 'IDENTITY'
       ORDER BY semantic_key, id LIMIT 50 OFFSET 100`,
    ];
    return Object.freeze(
      queries.flatMap((query) =>
        (
          this.#database.prepare(query).all() as unknown as readonly {
            readonly detail: string;
          }[]
        ).map((row) => row.detail),
      ),
    );
  }

  #validateSubject(value: DossierSubject): DossierSubject {
    if (
      !['WORK', 'EXPRESSION', 'EDITION'].includes(value.type) ||
      value.id.trim() !== value.id ||
      value.id.length < 1 ||
      Buffer.byteLength(value.id, 'utf8') > 128
    ) {
      throw new DossierError('DOSSIER_INVALID_REQUEST');
    }
    const row = this.#database
      .prepare(
        `SELECT subject_id FROM fact_subjects
         WHERE subject_type = ? AND subject_id = ?`,
      )
      .get(value.type, value.id);
    if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
    return Object.freeze({ id: value.id, type: value.type });
  }

  #ensureDossier(subject: DossierSubject, now: string): ResearchDossier {
    const existing = this.#database
      .prepare(
        `SELECT * FROM research_dossiers
         WHERE subject_type = ? AND subject_id = ?`,
      )
      .get(subject.type, subject.id) as Row | undefined;
    if (existing !== undefined) return this.#dossierFromRow(existing);
    const bookId = this.#owningWorkId(subject);
    const dossierId = `dossier-${this.#idFactory()}`;
    return runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO research_dossiers(
             id, book_id, subject_type, subject_id, revision, state, readiness,
             invalidation_reasons_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 1, 'NOT_BUILT', 'NOT_BUILT', '[]', ?, ?)`,
        )
        .run(dossierId, bookId, subject.type, subject.id, now, now);
      this.#audit('DOSSIER_CREATED', dossierId, now, {
        actor: 'USER',
        after: { subjectId: subject.id, subjectType: subject.type },
      });
      return this.#getDossierById(dossierId);
    });
  }

  #owningWorkId(subject: DossierSubject): string {
    if (subject.type === 'WORK') return subject.id;
    if (subject.type === 'EXPRESSION') {
      const row = this.#database
        .prepare('SELECT work_id FROM expressions WHERE id = ?')
        .get(subject.id) as Row | undefined;
      if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
      return row.work_id as string;
    }
    const row = this.#database
      .prepare(
        `SELECT expression.work_id
         FROM book_editions AS edition
         JOIN expressions AS expression ON expression.id = edition.expression_id
         WHERE edition.id = ?`,
      )
      .get(subject.id) as Row | undefined;
    if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
    return row.work_id as string;
  }

  #subjectRevision(subject: DossierSubject): string {
    if (subject.type === 'WORK') {
      const row = this.#database
        .prepare('SELECT catalog_revision FROM books WHERE id = ?')
        .get(subject.id) as Row | undefined;
      if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
      return String(row.catalog_revision);
    }
    if (subject.type === 'EXPRESSION') {
      const row = this.#database
        .prepare(
          `SELECT expression.revision AS expression_revision,
                  book.catalog_revision AS work_revision
           FROM expressions AS expression
           JOIN books AS book ON book.id = expression.work_id
           WHERE expression.id = ?`,
        )
        .get(subject.id) as Row | undefined;
      if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
      return `${String(row.expression_revision)}.${String(row.work_revision)}`;
    }
    const row = this.#database
      .prepare(
        `SELECT edition.catalog_revision AS edition_revision,
                expression.revision AS expression_revision,
                book.catalog_revision AS work_revision
         FROM book_editions AS edition
         JOIN expressions AS expression ON expression.id = edition.expression_id
         JOIN books AS book ON book.id = expression.work_id
         WHERE edition.id = ?`,
      )
      .get(subject.id) as Row | undefined;
    if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
    return `${String(row.edition_revision)}.${String(row.expression_revision)}.${String(row.work_revision)}`;
  }

  #loadProjection(subject: DossierSubject): DossierProjection {
    const claimRows = this.#database
      .prepare(
        `SELECT claim.id, claim.revision, claim.predicate, claim.normalized_value,
                claim.value_json, claim.normalized_scope_hash,
                claim.semantic_fingerprint, claim.policy_version, claim.key_fact,
                claim.status, registry.multiple_allowed,
                evaluation.id AS evaluation_id,
                evaluation.status AS evaluation_status,
                evaluation.policy_version AS evaluation_policy_version,
                evaluation.reason_code AS evaluation_reason_code,
                evaluation.input_identity_hash AS evaluation_input_hash,
                evaluation.created_at AS evaluation_created_at
         FROM claims AS claim
         JOIN predicate_registry AS registry ON registry.predicate = claim.predicate
         LEFT JOIN fact_evaluations AS evaluation
           ON evaluation.id = (
             SELECT current.id FROM fact_evaluations AS current
             WHERE current.claim_id = claim.id
             ORDER BY current.created_at DESC, current.id DESC LIMIT 1
           )
         WHERE claim.subject_type = ? AND claim.subject_id = ?
         ORDER BY claim.id
         LIMIT ?`,
      )
      .all(
        subject.type,
        subject.id,
        DOSSIER_LIMITS.maxClaimsPerBuild + 1,
      ) as unknown as readonly Row[];
    if (claimRows.length > DOSSIER_LIMITS.maxClaimsPerBuild) {
      throw new DossierError('DOSSIER_CAPACITY_EXCEEDED');
    }
    const claimIds = claimRows.map((row) => row.id as string);
    const evidenceByClaim = new Map<string, DossierEvidenceInput[]>();
    if (claimIds.length > 0) {
      const placeholders = claimIds.map(() => '?').join(',');
      const evidenceRows = this.#database
        .prepare(
          `WITH latest_source AS (
             SELECT source_id, max(revision) AS revision
             FROM source_revisions GROUP BY source_id
           )
           SELECT evidence.id, evidence.claim_id, evidence.revision AS evidence_revision,
                  evidence.supports_or_contradicts, evidence.verification_status,
                  evidence.source_id, evidence.source_revision,
                  source.availability, latest_source.revision AS source_current_revision,
                  classification.classification_revision
           FROM claim_evidence AS evidence
           JOIN source_revisions AS source
             ON source.source_id = evidence.source_id
            AND source.revision = evidence.source_revision
           JOIN latest_source ON latest_source.source_id = evidence.source_id
           JOIN source_classifications AS classification
             ON classification.source_id = evidence.source_id
            AND classification.source_revision = evidence.source_revision
            AND classification.classification_revision = (
              SELECT max(current.classification_revision)
              FROM source_classifications AS current
              WHERE current.source_id = evidence.source_id
                AND current.source_revision = evidence.source_revision
            )
           WHERE evidence.claim_id IN (${placeholders})
           ORDER BY evidence.claim_id, evidence.id
           LIMIT ?`,
        )
        .all(...claimIds, DOSSIER_LIMITS.maxEvidencePerBuild + 1) as unknown as readonly Row[];
      if (evidenceRows.length > DOSSIER_LIMITS.maxEvidencePerBuild) {
        throw new DossierError('DOSSIER_CAPACITY_EXCEEDED');
      }
      for (const row of evidenceRows) {
        const claimId = row.claim_id as string;
        const items = evidenceByClaim.get(claimId) ?? [];
        items.push(
          Object.freeze({
            availability: row.availability as DossierEvidenceInput['availability'],
            classificationRevision: row.classification_revision as number,
            evidenceId: row.id as string,
            evidenceRevision: row.evidence_revision as number,
            relation: row.supports_or_contradicts as DossierEvidenceInput['relation'],
            sourceCurrentRevision: row.source_current_revision as number,
            sourceId: row.source_id as string,
            sourceRevision: row.source_revision as number,
            verificationStatus:
              row.verification_status as DossierEvidenceInput['verificationStatus'],
          }),
        );
        evidenceByClaim.set(claimId, items);
      }
    }
    const facts: readonly DossierFactInput[] = Object.freeze(
      claimRows.map((row) =>
        Object.freeze({
          claimId: row.id as string,
          claimRevision: row.revision as number,
          evaluation:
            row.evaluation_id === null
              ? null
              : Object.freeze({
                  createdAt: row.evaluation_created_at as string,
                  evaluationId: row.evaluation_id as string,
                  inputIdentityHash: row.evaluation_input_hash as string,
                  policyVersion: row.evaluation_policy_version as string,
                  reasonCode: row.evaluation_reason_code as string,
                  status: row.evaluation_status as NonNullable<
                    DossierFactInput['evaluation']
                  >['status'],
                }),
          evidence: Object.freeze(evidenceByClaim.get(row.id as string) ?? []),
          factPolicyVersion: row.policy_version as string,
          keyFact: row.key_fact === 1,
          multipleAllowed: row.multiple_allowed === 1,
          normalizedScopeHash: row.normalized_scope_hash as string,
          normalizedValue: row.normalized_value as string,
          predicate: row.predicate as string,
          semanticFingerprint: row.semantic_fingerprint as string,
          status: row.status as DossierFactInput['status'],
          structuredValue: JSON.parse(row.value_json as string),
        }),
      ),
    );
    let conflicts: readonly DossierConflictInput[] = Object.freeze([]);
    if (claimIds.length > 0) {
      const placeholders = claimIds.map(() => '?').join(',');
      const rows = this.#database
        .prepare(
          `SELECT id, claim_left_id, claim_right_id, state, revision
           FROM fact_conflicts
           WHERE claim_left_id IN (${placeholders})
              OR claim_right_id IN (${placeholders})
           ORDER BY id LIMIT ?`,
        )
        .all(
          ...claimIds,
          ...claimIds,
          DOSSIER_LIMITS.maxConflictsPerBuild + 1,
        ) as unknown as readonly Row[];
      if (rows.length > DOSSIER_LIMITS.maxConflictsPerBuild) {
        throw new DossierError('DOSSIER_CAPACITY_EXCEEDED');
      }
      conflicts = Object.freeze(
        rows.map((row) =>
          Object.freeze({
            claimIds: Object.freeze([
              row.claim_left_id as string,
              row.claim_right_id as string,
            ]) as readonly [string, string],
            conflictId: row.id as string,
            revision: row.revision as number,
            state: row.state as DossierConflictInput['state'],
          }),
        ),
      );
    }
    return buildDossierProjection({
      conflicts,
      factPolicyVersion: FACT_POLICY_VERSION,
      facts,
      notApplicable: Object.freeze([]),
      subject,
      subjectRevision: this.#subjectRevision(subject),
    });
  }

  #projectionClaimCount(projection: DossierProjection): number {
    return new Set(projection.entries.flatMap((entry) => [...entry.claimIds])).size;
  }

  #publishProjection(input: {
    readonly buildMode: 'FULL_REBUILD' | 'INCREMENTAL' | 'INITIAL';
    readonly dossier: ResearchDossier;
    readonly now: string;
    readonly projection: DossierProjection;
    readonly runId: string;
    readonly versionId: string;
    readonly versionNumber: number;
  }): void {
    this.#database
      .prepare(
        `INSERT INTO research_dossier_versions(
           id, dossier_id, version_number, previous_version_id, schema_version,
           coverage_policy_version, fact_policy_version, input_hash, build_mode,
           build_run_id, readiness, reason_codes_json, warnings_json,
           revision, created_at, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)`,
      )
      .run(
        input.versionId,
        input.dossier.dossierId,
        input.versionNumber,
        input.dossier.currentVersionId,
        DOSSIER_SCHEMA_VERSION,
        DOSSIER_COVERAGE_POLICY_VERSION,
        FACT_POLICY_VERSION,
        input.projection.inputHash,
        input.buildMode,
        input.runId,
        input.projection.readiness,
        safeJson(input.projection.coverage.reasonCodes),
        input.now,
        input.now,
      );
    const sectionIds = new Map<string, string>();
    for (const section of input.projection.sections) {
      const sectionId = `${input.versionId}:${section.section}`;
      sectionIds.set(section.section, sectionId);
      this.#database
        .prepare(
          `INSERT INTO research_dossier_sections(
             id, version_id, section_key, position, readiness_required,
             coverage_basis_points, verified_count, blocked_count, stale_count,
             insufficient_count, gap_count, reason_codes_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sectionId,
          input.versionId,
          section.section,
          section.position,
          section.readinessRequired ? 1 : 0,
          section.coverageBasisPoints,
          section.verifiedCount,
          section.blockedCount,
          section.staleCount,
          section.insufficientCount,
          section.gapCount,
          safeJson(section.reasonCodes),
          input.now,
        );
    }
    const gapIds = new Map<string, string>();
    for (const gap of input.projection.gaps) {
      const gapId = `${input.versionId}:${gap.gapId}`;
      gapIds.set(gap.gapId, gapId);
      this.#database
        .prepare(
          `INSERT INTO research_dossier_gaps(
             id, version_id, section_key, semantic_key, reason_code,
             required, blocking, audit_ref, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          gapId,
          input.versionId,
          gap.section,
          gap.semanticKey,
          gap.reasonCode,
          gap.required ? 1 : 0,
          gap.blocking ? 1 : 0,
          gap.auditRef,
          input.now,
        );
      for (const claimId of gap.claimIds) {
        this.#database
          .prepare(`INSERT INTO research_dossier_gap_claims(gap_id, claim_id) VALUES (?, ?)`)
          .run(gapId, claimId);
      }
    }
    const entryIds = new Map<string, string>();
    for (const entry of input.projection.entries) {
      const entryId = `${input.versionId}:${entry.entryId}`;
      entryIds.set(entry.semanticKey, entryId);
      const sectionId = sectionIds.get(entry.section);
      if (sectionId === undefined) throw new DossierError('DOSSIER_INVALID_CONTRACT');
      let storedGapId: null | string = null;
      if (entry.gapId !== null) {
        const matchedGapId = gapIds.get(entry.gapId);
        if (matchedGapId === undefined) {
          throw new DossierError('DOSSIER_INVALID_CONTRACT');
        }
        storedGapId = matchedGapId;
      }
      this.#database
        .prepare(
          `INSERT INTO research_dossier_entries(
             id, version_id, section_id, section_key, entry_kind, semantic_key,
             predicate, display_value, structured_value_json, fact_status,
             source_count, evidence_count, conflict_id, gap_id, provenance,
             revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          entryId,
          input.versionId,
          sectionId,
          entry.section,
          entry.entryKind,
          entry.semanticKey,
          entry.predicate,
          entry.displayValue,
          safeJson(entry.structuredValue, DOSSIER_LIMITS.structuredValueBytes),
          entry.factStatus,
          entry.sourceCount,
          entry.evidenceCount,
          entry.conflictId,
          storedGapId,
          entry.provenance,
          input.now,
          input.now,
        );
      for (const claimId of entry.claimIds) {
        const claim = this.#database
          .prepare('SELECT revision FROM claims WHERE id = ?')
          .get(claimId) as { readonly revision: number } | undefined;
        if (claim === undefined) throw new DossierError('DOSSIER_INPUT_CHANGED');
        this.#database
          .prepare(
            `INSERT INTO research_dossier_entry_claims(entry_id, claim_id, claim_revision)
             VALUES (?, ?, ?)`,
          )
          .run(entryId, claimId, claim.revision);
      }
      for (const evaluationId of entry.factEvaluationIds) {
        const evaluation = this.#database
          .prepare('SELECT input_identity_hash FROM fact_evaluations WHERE id = ?')
          .get(evaluationId) as { readonly input_identity_hash: string } | undefined;
        if (evaluation === undefined) throw new DossierError('DOSSIER_INPUT_CHANGED');
        this.#database
          .prepare(
            `INSERT INTO research_dossier_entry_evaluations(
               entry_id, evaluation_id, input_identity_hash
             ) VALUES (?, ?, ?)`,
          )
          .run(entryId, evaluationId, evaluation.input_identity_hash);
      }
      for (const evidenceId of entry.evidenceIds) {
        const evidence = this.#database
          .prepare(
            `SELECT revision, source_id, source_revision
             FROM claim_evidence WHERE id = ?`,
          )
          .get(evidenceId) as
          | {
              readonly revision: number;
              readonly source_id: string;
              readonly source_revision: number;
            }
          | undefined;
        if (evidence === undefined) throw new DossierError('DOSSIER_INPUT_CHANGED');
        this.#database
          .prepare(
            `INSERT INTO research_dossier_entry_evidence(
               entry_id, evidence_id, evidence_revision, source_id, source_revision
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            entryId,
            evidenceId,
            evidence.revision,
            evidence.source_id,
            evidence.source_revision,
          );
      }
    }
    for (const item of input.projection.dependencies) {
      this.#database
        .prepare(
          `INSERT INTO research_dossier_dependencies(
             id, version_id, entry_id, dependency_type, dependency_id,
             dependency_revision, dependency_key, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `${input.versionId}:dependency:${item.dependencyKey}`,
          input.versionId,
          item.entrySemanticKey === null ? null : (entryIds.get(item.entrySemanticKey) ?? null),
          item.dependencyType,
          item.dependencyId,
          item.dependencyRevision,
          item.dependencyKey,
          input.now,
        );
    }
    const coverage = input.projection.coverage;
    this.#database
      .prepare(
        `INSERT INTO research_dossier_coverage_snapshots(
           id, version_id, coverage_policy_version, input_hash,
           overall_basis_points, required_basis_points, optional_basis_points,
           verified_count, blocked_count, stale_count, insufficient_count,
           gap_count, reason_codes_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `${input.versionId}:coverage`,
        input.versionId,
        coverage.coveragePolicyVersion,
        coverage.inputHash,
        coverage.overallBasisPoints,
        coverage.requiredBasisPoints,
        coverage.optionalBasisPoints,
        coverage.verifiedCount,
        coverage.blockedCount,
        coverage.staleCount,
        coverage.insufficientCount,
        coverage.gapCount,
        safeJson(coverage.reasonCodes),
        input.now,
      );
  }

  #dossierFromRow(row: Row): ResearchDossier {
    const version =
      row.current_version_id === null
        ? null
        : (this.#database
            .prepare(`SELECT version_number FROM research_dossier_versions WHERE id = ?`)
            .get(row.current_version_id as string) as
            { readonly version_number: number } | undefined);
    return validateResearchDossier({
      contractVersion: DOSSIER_CONTRACT_VERSION,
      createdAt: row.created_at,
      currentVersionId: row.current_version_id,
      currentVersionNumber: version?.version_number ?? null,
      dossierId: row.id,
      invalidationReasons: parseStringArray(row.invalidation_reasons_json),
      readiness: row.readiness,
      revision: row.revision,
      state: row.state,
      subject: Object.freeze({
        id: row.subject_id,
        type: row.subject_type,
      }),
      updatedAt: row.updated_at,
    });
  }

  #getDossierById(dossierId: string): ResearchDossier {
    const row = this.#database
      .prepare('SELECT * FROM research_dossiers WHERE id = ?')
      .get(dossierId) as Row | undefined;
    if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
    return this.#dossierFromRow(row);
  }

  #runFromRow(row: Row): DossierBuildRun {
    return Object.freeze({
      costState: 'NOT_INCURRED',
      createdAt: row.created_at as string,
      dossierId: row.dossier_id as string,
      errorCode: row.error_code as string | null,
      executionId: row.execution_id as string,
      externalRequestCount: 0,
      inputHash: row.input_hash as string,
      jobId: row.job_id as string | null,
      planId: row.plan_id as string,
      resultVersionId: row.result_version_id as string | null,
      revision: row.revision as number,
      runId: row.id as string,
      status: row.status as DossierBuildRun['status'],
      updatedAt: row.updated_at as string,
    });
  }

  #getRun(runId: string): DossierBuildRun {
    const row = this.#database
      .prepare('SELECT * FROM research_dossier_build_runs WHERE id = ?')
      .get(runId) as Row | undefined;
    if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
    return this.#runFromRow(row);
  }

  #getRunByExecution(executionId: string): DossierBuildRun {
    const row = this.#database
      .prepare('SELECT * FROM research_dossier_build_runs WHERE execution_id = ?')
      .get(executionId) as Row | undefined;
    if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
    return this.#runFromRow(row);
  }

  #finishCancelled(run: DossierBuildRun, now: string): DossierBuildRun {
    return runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `UPDATE research_dossier_build_runs
           SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status IN (
             'CONFIRMED', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'
           )`,
        )
        .run(now, run.runId);
      this.#restoreDossierAfterUnpublishedRun(run.dossierId, now, 'CURRENT');
      this.#audit('BUILD_CANCELLED', run.dossierId, now, {
        actor: 'LOCAL_SYSTEM',
        after: { status: 'CANCELLED' },
        planId: run.planId,
        runId: run.runId,
      });
      return this.#getRun(run.runId);
    });
  }

  #restoreDossierAfterUnpublishedRun(
    dossierId: string,
    now: string,
    emptyState: 'CURRENT' | 'FAILED',
  ): void {
    const row = this.#database
      .prepare('SELECT current_version_id FROM research_dossiers WHERE id = ?')
      .get(dossierId) as { readonly current_version_id: string | null };
    if (row.current_version_id === null) {
      this.#database
        .prepare(
          `UPDATE research_dossiers
           SET state = ?, readiness = 'NOT_BUILT',
               revision = revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(emptyState === 'FAILED' ? 'FAILED' : 'NOT_BUILT', now, dossierId);
      return;
    }
    const version = this.#database
      .prepare('SELECT readiness FROM research_dossier_versions WHERE id = ?')
      .get(row.current_version_id) as { readonly readiness: string };
    this.#database
      .prepare(
        `UPDATE research_dossiers
         SET state = 'CURRENT', readiness = ?, revision = revision + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(version.readiness, now, dossierId);
  }

  #currentInputHash(versionId: string): string {
    const row = this.#database
      .prepare('SELECT input_hash FROM research_dossier_versions WHERE id = ?')
      .get(versionId) as { readonly input_hash: string } | undefined;
    if (row === undefined) throw new DossierError('DOSSIER_NOT_FOUND');
    return row.input_hash;
  }

  #currentEntrySignatures(versionId: string | null): Map<string, string> {
    if (versionId === null) return new Map();
    const rows = this.#database
      .prepare(
        `SELECT semantic_key, display_value, structured_value_json, fact_status
         FROM research_dossier_entries WHERE version_id = ? ORDER BY semantic_key`,
      )
      .all(versionId) as unknown as readonly Row[];
    return new Map(
      rows.map((row) => [
        row.semantic_key as string,
        entrySignature({
          displayValue: row.display_value as string,
          factStatus: row.fact_status as string,
          semanticKey: row.semantic_key as string,
          structuredValue: JSON.parse(row.structured_value_json as string),
        }),
      ]),
    );
  }

  #currentCoverage(versionId: string | null): DossierCoverageSnapshot | null {
    if (versionId === null) return null;
    const row = this.#database
      .prepare(`SELECT * FROM research_dossier_coverage_snapshots WHERE version_id = ?`)
      .get(versionId) as Row | undefined;
    if (row === undefined) return null;
    const sections = this.#sections(versionId).map((section) =>
      Object.freeze({
        basisPoints: section.coverageBasisPoints,
        blockedCount: section.blockedCount,
        gapCount: section.gapCount,
        insufficientCount: section.insufficientCount,
        reasonCodes: section.reasonCodes,
        section: section.section,
        staleCount: section.staleCount,
        verifiedCount: section.verifiedCount,
      }),
    );
    return Object.freeze({
      blockedCount: row.blocked_count as number,
      coveragePolicyVersion: DOSSIER_COVERAGE_POLICY_VERSION,
      gapCount: row.gap_count as number,
      inputHash: row.input_hash as string,
      insufficientCount: row.insufficient_count as number,
      optionalBasisPoints: row.optional_basis_points as number,
      overallBasisPoints: row.overall_basis_points as number,
      reasonCodes: parseStringArray(row.reason_codes_json),
      requiredBasisPoints: row.required_basis_points as number,
      sections: Object.freeze(sections),
      staleCount: row.stale_count as number,
      verifiedCount: row.verified_count as number,
    });
  }

  #sections(versionId: string): DossierSection[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM research_dossier_sections
         WHERE version_id = ? ORDER BY position`,
      )
      .all(versionId) as unknown as readonly Row[];
    return rows.map((row) =>
      Object.freeze({
        blockedCount: row.blocked_count as number,
        coverageBasisPoints: row.coverage_basis_points as number,
        entryCount: asCount(
          this.#database,
          `SELECT count(*) AS count FROM research_dossier_entries
           WHERE version_id = ? AND section_key = ?`,
          versionId,
          row.section_key as string,
        ),
        gapCount: row.gap_count as number,
        insufficientCount: row.insufficient_count as number,
        position: row.position as number,
        readinessRequired: row.readiness_required === 1,
        reasonCodes: parseStringArray(row.reason_codes_json),
        section: row.section_key as DossierSection['section'],
        sectionId: row.id as string,
        staleCount: row.stale_count as number,
        verifiedCount: row.verified_count as number,
        versionId,
      }),
    );
  }

  #entries(versionId: string, limit: number, offset: number): DossierEntry[] {
    const rows = this.#database
      .prepare(
        `SELECT entry.*,
                group_concat(DISTINCT claim.claim_id) AS claim_ids,
                group_concat(DISTINCT evaluation.evaluation_id) AS evaluation_ids,
                group_concat(DISTINCT evidence.evidence_id) AS evidence_ids,
                group_concat(
                  DISTINCT evidence.source_id || ':' || evidence.source_revision
                ) AS source_revision_ids
         FROM research_dossier_entries AS entry
         LEFT JOIN research_dossier_entry_claims AS claim ON claim.entry_id = entry.id
         LEFT JOIN research_dossier_entry_evaluations AS evaluation
           ON evaluation.entry_id = entry.id
         LEFT JOIN research_dossier_entry_evidence AS evidence ON evidence.entry_id = entry.id
         WHERE entry.version_id = ?
         GROUP BY entry.id
         ORDER BY entry.section_key, entry.semantic_key, entry.id
         LIMIT ? OFFSET ?`,
      )
      .all(versionId, limit, offset) as unknown as readonly Row[];
    const split = (value: unknown): readonly string[] =>
      typeof value === 'string' && value.length > 0
        ? Object.freeze([...new Set(value.split(','))].sort())
        : Object.freeze([]);
    return rows.map((row) =>
      Object.freeze({
        claimIds: split(row.claim_ids),
        conflictId: row.conflict_id as string | null,
        createdAt: row.created_at as string,
        displayValue: row.display_value as string,
        entryId: row.id as string,
        entryKind: row.entry_kind as DossierEntry['entryKind'],
        evidenceCount: row.evidence_count as number,
        evidenceIds: split(row.evidence_ids),
        factEvaluationIds: split(row.evaluation_ids),
        factStatus: row.fact_status as DossierEntry['factStatus'],
        gapId: row.gap_id as string | null,
        predicate: row.predicate as string,
        provenance: 'LOCAL_DETERMINISTIC',
        revision: row.revision as number,
        section: row.section_key as DossierEntry['section'],
        semanticKey: row.semantic_key as string,
        sourceCount: row.source_count as number,
        sourceRevisionIds: split(row.source_revision_ids),
        structuredValue: JSON.parse(row.structured_value_json as string),
        updatedAt: row.updated_at as string,
        versionId,
      }),
    );
  }

  #gaps(versionId: string, limit: number, offset: number): DossierGap[] {
    const rows = this.#database
      .prepare(
        `SELECT gap.*, group_concat(claim.claim_id) AS claim_ids
         FROM research_dossier_gaps AS gap
         LEFT JOIN research_dossier_gap_claims AS claim ON claim.gap_id = gap.id
         WHERE gap.version_id = ?
         GROUP BY gap.id
         ORDER BY gap.blocking DESC, gap.section_key, gap.semantic_key, gap.id
         LIMIT ? OFFSET ?`,
      )
      .all(versionId, limit, offset) as unknown as readonly Row[];
    return rows.map((row) =>
      Object.freeze({
        auditRef: row.audit_ref as string | null,
        blocking: row.blocking === 1,
        claimIds:
          typeof row.claim_ids === 'string'
            ? Object.freeze([...new Set(row.claim_ids.split(','))].sort())
            : Object.freeze([]),
        createdAt: row.created_at as string,
        gapId: row.id as string,
        reasonCode: row.reason_code as DossierGap['reasonCode'],
        required: row.required === 1,
        section: row.section_key as DossierGap['section'],
        semanticKey: row.semantic_key as string,
        versionId,
      }),
    );
  }

  #versionFromRow(row: Row): ResearchDossierVersion {
    return Object.freeze({
      buildMode:
        row.build_mode === 'LEGACY_MIGRATION'
          ? 'FULL_REBUILD'
          : (row.build_mode as ResearchDossierVersion['buildMode']),
      buildRunId: (row.build_run_id as string | null) ?? 'legacy-migration',
      coveragePolicyVersion:
        row.coverage_policy_version === DOSSIER_COVERAGE_POLICY_VERSION
          ? DOSSIER_COVERAGE_POLICY_VERSION
          : DOSSIER_COVERAGE_POLICY_VERSION,
      createdAt: row.created_at as string,
      dossierId: row.dossier_id as string,
      factPolicyVersion: row.fact_policy_version as string,
      inputHash: row.input_hash as string,
      isCurrent: row.is_current === 1,
      previousVersionId: row.previous_version_id as string | null,
      publishedAt: row.published_at as string,
      readiness: row.readiness as ResearchDossierVersion['readiness'],
      reasonCodes: parseStringArray(row.reason_codes_json),
      revision: row.revision as number,
      schemaVersion: DOSSIER_SCHEMA_VERSION,
      versionId: row.id as string,
      versionNumber: row.version_number as number,
      warnings: parseStringArray(row.warnings_json),
    });
  }

  #assertVersionOwner(versionId: string, dossierId: string): void {
    if (
      this.#database
        .prepare(`SELECT id FROM research_dossier_versions WHERE id = ? AND dossier_id = ?`)
        .get(versionId, dossierId) === undefined
    ) {
      throw new DossierError('DOSSIER_NOT_FOUND');
    }
  }

  #audit(
    eventType: string,
    dossierId: string,
    now: string,
    input: {
      readonly actor: 'LOCAL_SYSTEM' | 'MIGRATION' | 'USER';
      readonly after?: unknown;
      readonly before?: unknown;
      readonly planId?: string;
      readonly runId?: string;
      readonly versionId?: string;
    },
  ): void {
    this.#database
      .prepare(
        `INSERT INTO research_dossier_audit_events(
           id, event_type, dossier_id, version_id, plan_id, run_id, actor,
           before_json, after_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `dossier-audit-${this.#idFactory()}`,
        eventType,
        dossierId,
        input.versionId ?? null,
        input.planId ?? null,
        input.runId ?? null,
        input.actor,
        input.before === undefined ? null : safeJson(input.before, 65_536),
        input.after === undefined ? null : safeJson(input.after, 65_536),
        now,
      );
  }
}
