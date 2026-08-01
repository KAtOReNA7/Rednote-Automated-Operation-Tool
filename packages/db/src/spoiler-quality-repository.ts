import type { DatabaseSync } from 'node:sqlite';

import { assertContentBriefDraft, briefSemanticHash } from '@mystery-operations/briefs';
import { assertContentDraftPayload, type ContentDraftPayloadV1 } from '@mystery-operations/copy';
import {
  SPOILER_QUALITY_CHECKER_VERSION,
  SpoilerQualityError,
  evaluateSpoilerQuality,
  factMappingHash,
  type SpoilerCurrentBriefTruth,
  type SpoilerInvalidationTruth,
  type SpoilerQualityEvaluation,
  type SpoilerQualityStatus,
} from '@mystery-operations/quality';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

interface DraftRow extends Row {
  readonly brief_id: string;
  readonly brief_version_id: string;
  readonly dependency_hash: string;
  readonly draft_id: string;
  readonly draft_revision: number;
  readonly draft_state: string;
  readonly input_hash: string;
  readonly lock_snapshot_hash: string;
  readonly payload_json: string;
  readonly status: string;
  readonly structural_valid: number;
  readonly version_id: string;
}

interface BriefRow extends Row {
  readonly brief_id: string;
  readonly brief_revision: number;
  readonly brief_state: string;
  readonly current_version_id: string;
  readonly dependency_hash: string;
  readonly input_hash: string;
  readonly lock_snapshot_hash: string;
  readonly payload_json: string;
  readonly readiness_status: string;
  readonly status: string;
}

export interface SpoilerQualityPreparedCheck {
  readonly evaluation: SpoilerQualityEvaluation;
  readonly savedStatus: SpoilerQualityStatus;
}

function draftPayload(value: string): ContentDraftPayloadV1 {
  try {
    return assertContentDraftPayload(JSON.parse(value) as unknown);
  } catch {
    throw new SpoilerQualityError('SPOILER_QUALITY_NOT_READY');
  }
}

function validStoredStatus(
  value: unknown,
): value is Exclude<SpoilerQualityStatus, 'STALE' | 'NOT_RUN'> {
  return value === 'PASS' || value === 'BLOCKED' || value === 'REVIEW_REQUIRED';
}

export class SqliteSpoilerQualityRepository {
  readonly #database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.#database = database;
  }

  public prepare(
    draftId: string,
    expectedRevision: number,
    now: string,
  ): SpoilerQualityPreparedCheck {
    const evaluation = this.#evaluate(draftId, expectedRevision, now);
    return Object.freeze({ evaluation, savedStatus: this.#savedStatus(evaluation) });
  }

  public confirm(
    expected: Pick<
      SpoilerQualityEvaluation,
      'draftId' | 'draftRevision' | 'draftVersionId' | 'inputHash'
    >,
    now: string,
  ): SpoilerQualityPreparedCheck {
    const evaluation = runInTransaction(this.#database, () => {
      const current = this.#evaluate(expected.draftId, expected.draftRevision, now);
      if (
        current.draftVersionId !== expected.draftVersionId ||
        current.inputHash !== expected.inputHash
      ) {
        throw new SpoilerQualityError('SPOILER_QUALITY_STALE_REVISION');
      }
      const detailsJson = JSON.stringify({
        counts: current.counts,
        findings: current.findings,
        reasonCodes: current.reasonCodes,
        schemaVersion: 1,
        status: current.status,
        truncated: current.truncated,
      });
      if (Buffer.byteLength(detailsJson, 'utf8') > 4_096) {
        throw new SpoilerQualityError('SPOILER_QUALITY_INVALID_CONTRACT');
      }
      const id = `spoiler-${factMappingHash({
        checkType: 'SPOILER',
        checkerVersion: SPOILER_QUALITY_CHECKER_VERSION,
        draftVersionId: current.draftVersionId,
        inputHash: current.inputHash,
      })}`;
      const result = current.status === 'PASS' ? 'PASS' : 'FAIL';
      const severity =
        current.status === 'PASS'
          ? 'INFO'
          : current.status === 'BLOCKED'
            ? 'BLOCKING'
            : 'REVIEW_REQUIRED';
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO quality_checks(
             id, draft_id, draft_version_id, check_type, result, severity,
             details_json, checker_version, input_hash, legacy_unresolved, created_at
           ) VALUES (?, ?, ?, 'SPOILER', ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          id,
          current.draftId,
          current.draftVersionId,
          result,
          severity,
          detailsJson,
          SPOILER_QUALITY_CHECKER_VERSION,
          current.inputHash,
          now,
        );
      const stored = this.#database
        .prepare(
          `SELECT draft_id, draft_version_id, check_type, result, severity, details_json,
             checker_version, input_hash, legacy_unresolved, summary_status, reason_code,
             fact_mapping_version_id, fact_mapping_run_id
           FROM quality_checks WHERE id = ?`,
        )
        .get(id) as Row | undefined;
      if (
        stored === undefined ||
        stored.draft_id !== current.draftId ||
        stored.draft_version_id !== current.draftVersionId ||
        stored.check_type !== 'SPOILER' ||
        stored.result !== result ||
        stored.severity !== severity ||
        stored.details_json !== detailsJson ||
        stored.checker_version !== SPOILER_QUALITY_CHECKER_VERSION ||
        stored.input_hash !== current.inputHash ||
        stored.legacy_unresolved !== 0 ||
        stored.summary_status !== null ||
        stored.reason_code !== null ||
        stored.fact_mapping_version_id !== null ||
        stored.fact_mapping_run_id !== null
      ) {
        throw new SpoilerQualityError('SPOILER_QUALITY_INVALID_CONTRACT');
      }
      return current;
    });
    return Object.freeze({ evaluation, savedStatus: evaluation.status });
  }

  #draft(draftId: string): DraftRow {
    const row = this.#database
      .prepare(
        `SELECT root.id AS draft_id, root.brief_id, head.draft_revision, head.draft_state,
           version.id AS version_id, version.brief_version_id, version.payload_json,
           version.status, version.structural_valid, version.input_hash,
           version.dependency_hash, version.lock_snapshot_hash
         FROM drafts AS root
         JOIN content_draft_heads AS head ON head.draft_id = root.id
         JOIN content_draft_versions AS version ON version.id = head.current_version_id
         WHERE root.id = ?`,
      )
      .get(draftId) as DraftRow | undefined;
    if (row === undefined) throw new SpoilerQualityError('SPOILER_QUALITY_NOT_FOUND');
    if (
      row.draft_state !== 'ACTIVE' ||
      row.status !== 'READY_FOR_QUALITY_PIPELINE' ||
      row.structural_valid !== 1
    ) {
      throw new SpoilerQualityError('SPOILER_QUALITY_NOT_READY');
    }
    return row;
  }

  #brief(briefId: string): SpoilerCurrentBriefTruth {
    const row = this.#database
      .prepare(
        `SELECT root.id AS brief_id, root.current_version_id, root.brief_revision,
           root.brief_state, version.payload_json, version.status, version.readiness_status,
           version.input_hash, version.dependency_hash, version.lock_snapshot_hash
         FROM content_briefs AS root
         JOIN content_brief_versions AS version ON version.id = root.current_version_id
         WHERE root.id = ?`,
      )
      .get(briefId) as BriefRow | undefined;
    if (row === undefined) throw new SpoilerQualityError('SPOILER_QUALITY_NOT_READY');
    let payload: ReturnType<typeof assertContentBriefDraft>;
    try {
      payload = assertContentBriefDraft(JSON.parse(row.payload_json) as unknown);
    } catch {
      throw new SpoilerQualityError('SPOILER_QUALITY_NOT_READY');
    }
    return Object.freeze({
      briefId: row.brief_id,
      currentVersionId: row.current_version_id,
      dependencyHash: row.dependency_hash,
      inputHash: row.input_hash,
      invalidations: this.#invalidations(
        'content_brief_invalidations',
        briefId,
        row.current_version_id,
      ),
      lockHash: row.lock_snapshot_hash,
      payloadHash: briefSemanticHash(payload),
      readinessStatus: row.readiness_status,
      revision: row.brief_revision,
      spoilerPlan: payload.spoilerPlan,
      state: row.brief_state,
      status: row.status,
    });
  }

  #invalidations(
    table: 'content_brief_invalidations' | 'content_draft_invalidations',
    ownerId: string,
    versionId: string,
  ): readonly SpoilerInvalidationTruth[] {
    const ownerColumn = table === 'content_brief_invalidations' ? 'brief_id' : 'draft_id';
    const rows = this.#database
      .prepare(
        `SELECT dependency_type, observed_revision, reason_code
         FROM ${table} WHERE ${ownerColumn} = ? AND version_id = ?
         ORDER BY dependency_type, observed_revision, reason_code`,
      )
      .all(ownerId, versionId) as readonly Row[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          dependencyType: row.dependency_type as string,
          observedRevision: row.observed_revision as string,
          reasonCode: row.reason_code as string,
        }),
      ),
    );
  }

  #evaluate(draftId: string, expectedRevision: number, now: string): SpoilerQualityEvaluation {
    const row = this.#draft(draftId);
    if (row.draft_revision !== expectedRevision) {
      throw new SpoilerQualityError('SPOILER_QUALITY_STALE_REVISION');
    }
    return evaluateSpoilerQuality({
      brief: this.#brief(row.brief_id),
      draftBriefId: row.brief_id,
      draftBriefVersionId: row.brief_version_id,
      draftDependencyHash: row.dependency_hash,
      draftId: row.draft_id,
      draftInputHash: row.input_hash,
      draftInvalidations: this.#invalidations(
        'content_draft_invalidations',
        row.draft_id,
        row.version_id,
      ),
      draftLockHash: row.lock_snapshot_hash,
      draftRevision: row.draft_revision,
      draftState: row.draft_state,
      draftStatus: row.status,
      draftVersionId: row.version_id,
      evaluatedAt: now,
      payload: draftPayload(row.payload_json),
      structuralValid: row.structural_valid === 1,
    });
  }

  #savedStatus(evaluation: SpoilerQualityEvaluation): SpoilerQualityStatus {
    const exact = this.#database
      .prepare(
        `SELECT details_json FROM quality_checks
         WHERE draft_id = ? AND draft_version_id = ? AND check_type = 'SPOILER'
           AND checker_version = ? AND input_hash = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(
        evaluation.draftId,
        evaluation.draftVersionId,
        SPOILER_QUALITY_CHECKER_VERSION,
        evaluation.inputHash,
      ) as Row | undefined;
    if (exact !== undefined) {
      try {
        const parsed = JSON.parse(exact.details_json as string) as { readonly status?: unknown };
        if (validStoredStatus(parsed.status)) return parsed.status;
      } catch {
        throw new SpoilerQualityError('SPOILER_QUALITY_INVALID_CONTRACT');
      }
      throw new SpoilerQualityError('SPOILER_QUALITY_INVALID_CONTRACT');
    }
    const prior = this.#database
      .prepare(`SELECT 1 FROM quality_checks WHERE draft_id = ? AND check_type = 'SPOILER' LIMIT 1`)
      .get(evaluation.draftId);
    return prior === undefined ? 'NOT_RUN' : 'STALE';
  }
}
