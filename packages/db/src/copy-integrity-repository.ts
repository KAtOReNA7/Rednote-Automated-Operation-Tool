import type { DatabaseSync } from 'node:sqlite';

import { assertContentDraftPayload, type ContentDraftPayloadV1 } from '@mystery-operations/copy';
import {
  COPY_INTEGRITY_CHECKER_VERSION,
  COPY_INTEGRITY_LIMITS,
  CopyIntegrityError,
  evaluateCopyIntegrity,
  factMappingHash,
  type CopyIntegrityBriefTruth,
  type CopyIntegrityCheckEvaluation,
  type CopyIntegrityCheckType,
  type CopyIntegrityEvaluation,
  type CopyIntegrityStatus,
} from '@mystery-operations/quality';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

interface DraftRow extends Row {
  readonly brief_id: string;
  readonly brief_version_id: string;
  readonly content_hash: string;
  readonly draft_id: string;
  readonly draft_revision: number;
  readonly draft_state: string;
  readonly input_hash: string;
  readonly payload_json: string;
  readonly profile_id: ContentDraftPayloadV1['profileId'];
  readonly status: string;
  readonly structural_policy_version: string;
  readonly structural_reason_codes_json: string;
  readonly structural_valid: number;
  readonly version_id: string;
}

type HistoricalRow = Readonly<{
  contentHash: string;
  draftId: string;
  eligibleCount: number;
  payloadJson: string;
  versionId: string;
}>;

type BriefTruthRow = Omit<CopyIntegrityBriefTruth, 'briefId'>;

export interface CopyIntegrityPreparedCheck {
  readonly evaluation: CopyIntegrityEvaluation;
  readonly savedStatuses: Readonly<Record<CopyIntegrityCheckType, CopyIntegrityStatus>>;
}

function draftPayload(value: string): ContentDraftPayloadV1 {
  try {
    return assertContentDraftPayload(JSON.parse(value) as unknown);
  } catch {
    throw new CopyIntegrityError('COPY_INTEGRITY_NOT_READY');
  }
}

function stringArray(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('invalid string array');
    }
    return [...parsed].sort();
  } catch {
    throw new CopyIntegrityError('COPY_INTEGRITY_INVALID_CONTRACT');
  }
}

function validStoredStatus(
  value: unknown,
): value is Exclude<CopyIntegrityStatus, 'STALE' | 'NOT_RUN'> {
  return value === 'PASS' || value === 'BLOCKED' || value === 'REVIEW_REQUIRED';
}

export class SqliteCopyIntegrityRepository {
  readonly #database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.#database = database;
  }

  public prepare(
    draftId: string,
    expectedRevision: number,
    now: string,
  ): CopyIntegrityPreparedCheck {
    const evaluation = this.#evaluate(draftId, expectedRevision, now);
    return {
      evaluation,
      savedStatuses: {
        DUPLICATION: this.#savedStatus(evaluation, 'DUPLICATION'),
        TITLE_BODY_CONSISTENCY: this.#savedStatus(evaluation, 'TITLE_BODY_CONSISTENCY'),
      },
    };
  }

  public confirm(
    expected: Pick<
      CopyIntegrityEvaluation,
      'draftId' | 'draftRevision' | 'draftVersionId' | 'inputHash'
    >,
    now: string,
  ): CopyIntegrityPreparedCheck {
    const evaluation = runInTransaction(this.#database, () => {
      const current = this.#evaluate(expected.draftId, expected.draftRevision, now);
      if (
        current.draftVersionId !== expected.draftVersionId ||
        current.inputHash !== expected.inputHash
      ) {
        throw new CopyIntegrityError('COPY_INTEGRITY_STALE_REVISION');
      }
      for (const check of current.checks) this.#appendCheck(current, check, now);
      return current;
    });
    return {
      evaluation,
      savedStatuses: {
        DUPLICATION: evaluation.checks[0].status,
        TITLE_BODY_CONSISTENCY: evaluation.checks[1].status,
      },
    };
  }

  #appendCheck(
    evaluation: CopyIntegrityEvaluation,
    check: CopyIntegrityCheckEvaluation,
    now: string,
  ): void {
    const detailsJson = JSON.stringify({
      counts: check.counts,
      findings: check.findings,
      reasonCodes: check.reasonCodes,
      schemaVersion: 1,
      status: check.status,
      truncated: check.truncated,
    });
    if (Buffer.byteLength(detailsJson, 'utf8') > 4_096) {
      throw new CopyIntegrityError('COPY_INTEGRITY_INVALID_CONTRACT');
    }
    const id =
      'copy-integrity-' +
      factMappingHash({
        checkerVersion: COPY_INTEGRITY_CHECKER_VERSION,
        checkType: check.checkType,
        draftVersionId: evaluation.draftVersionId,
        inputHash: evaluation.inputHash,
      });
    const result = check.status === 'PASS' ? 'PASS' : 'FAIL';
    const severity =
      check.status === 'PASS'
        ? 'INFO'
        : check.status === 'BLOCKED'
          ? 'BLOCKING'
          : 'REVIEW_REQUIRED';
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO quality_checks(
           id, draft_id, draft_version_id, check_type, result, severity, details_json,
           checker_version, input_hash, legacy_unresolved, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        evaluation.draftId,
        evaluation.draftVersionId,
        check.checkType,
        result,
        severity,
        detailsJson,
        COPY_INTEGRITY_CHECKER_VERSION,
        evaluation.inputHash,
        now,
      );
    const stored = this.#database
      .prepare(
        `SELECT draft_id, draft_version_id, check_type, result, severity, details_json,
           checker_version, input_hash, legacy_unresolved, summary_status, reason_code,
           fact_mapping_version_id, fact_mapping_run_id FROM quality_checks WHERE id = ?`,
      )
      .get(id) as Row | undefined;
    const expected: Row = {
      checker_version: COPY_INTEGRITY_CHECKER_VERSION,
      check_type: check.checkType,
      details_json: detailsJson,
      draft_id: evaluation.draftId,
      draft_version_id: evaluation.draftVersionId,
      fact_mapping_run_id: null,
      fact_mapping_version_id: null,
      input_hash: evaluation.inputHash,
      legacy_unresolved: 0,
      reason_code: null,
      result,
      severity,
      summary_status: null,
    };
    if (
      stored === undefined ||
      Object.entries(expected).some(([key, value]) => stored[key] !== value)
    ) {
      throw new CopyIntegrityError('COPY_INTEGRITY_INVALID_CONTRACT');
    }
  }

  #draft(draftId: string): DraftRow {
    const row = this.#database
      .prepare(
        `SELECT root.id AS draft_id, root.brief_id, head.draft_revision, head.draft_state,
           version.id AS version_id, version.brief_version_id, version.payload_json, version.profile_id,
           version.status, version.structural_valid, version.input_hash, version.content_hash,
           version.structural_policy_version, version.structural_reason_codes_json FROM drafts AS root
         JOIN content_draft_heads AS head ON head.draft_id = root.id
         JOIN content_draft_versions AS version ON version.id = head.current_version_id
         WHERE root.id = ?`,
      )
      .get(draftId) as DraftRow | undefined;
    if (row === undefined) throw new CopyIntegrityError('COPY_INTEGRITY_NOT_FOUND');
    if (
      row.draft_state !== 'ACTIVE' ||
      row.status !== 'READY_FOR_QUALITY_PIPELINE' ||
      row.structural_valid !== 1
    ) {
      throw new CopyIntegrityError('COPY_INTEGRITY_NOT_READY');
    }
    return row;
  }

  #brief(briefId: string, exactVersionId: string): CopyIntegrityBriefTruth {
    const row = this.#database
      .prepare(
        `SELECT current.id AS currentVersionId, current.input_hash AS currentInputHash,
           current.dependency_hash AS currentDependencyHash, current.lock_snapshot_hash AS currentLockHash,
           exact.id AS exactVersionId, exact.input_hash AS exactInputHash,
           exact.dependency_hash AS exactDependencyHash, exact.lock_snapshot_hash AS exactLockHash
           FROM content_briefs AS root
         JOIN content_brief_versions AS current ON current.id = root.current_version_id
         JOIN content_brief_versions AS exact ON exact.brief_id = root.id AND exact.id = ?
         WHERE root.id = ?`,
      )
      .get(exactVersionId, briefId) as BriefTruthRow | undefined;
    if (row === undefined) throw new CopyIntegrityError('COPY_INTEGRITY_NOT_READY');
    return { briefId, ...row };
  }

  #historical(currentVersionId: string, profileId: ContentDraftPayloadV1['profileId']) {
    const rows = this.#database
      .prepare(
        `SELECT version.draft_id AS draftId, version.id AS versionId,
           version.content_hash AS contentHash, version.payload_json AS payloadJson,
           count(*) OVER() AS eligibleCount FROM content_draft_versions AS version
           JOIN content_draft_heads AS head ON head.draft_id = version.draft_id
         WHERE version.status = 'READY_FOR_QUALITY_PIPELINE' AND version.profile_id = ?
           AND version.structural_valid = 1 AND head.draft_state = 'ACTIVE' AND version.id <> ?
         ORDER BY version.created_at DESC, version.draft_id ASC,
           version.version_number DESC, version.id ASC
         LIMIT ?`,
      )
      .all(
        profileId,
        currentVersionId,
        COPY_INTEGRITY_LIMITS.corpus + 1,
      ) as unknown as readonly HistoricalRow[];
    return {
      eligibleCount: rows[0]?.eligibleCount ?? 0,
      items: rows.slice(0, COPY_INTEGRITY_LIMITS.corpus).map((row) => ({
        contentHash: row.contentHash,
        draftId: row.draftId,
        draftVersionId: row.versionId,
        payload: draftPayload(row.payloadJson),
      })),
      truncated: rows.length > COPY_INTEGRITY_LIMITS.corpus,
    };
  }

  #publications() {
    const row = this.#database.prepare(`SELECT count(*) AS total FROM publications`).get() as Row;
    const total = row.total as number;
    return {
      exactPublishedDraftVersionIds: [] as readonly string[],
      total,
      unavailableLineageCount: total,
    };
  }

  #evaluate(draftId: string, expectedRevision: number, now: string): CopyIntegrityEvaluation {
    const row = this.#draft(draftId);
    if (row.draft_revision !== expectedRevision) {
      throw new CopyIntegrityError('COPY_INTEGRITY_STALE_REVISION');
    }
    const historical = this.#historical(row.version_id, row.profile_id);
    return evaluateCopyIntegrity({
      brief: this.#brief(row.brief_id, row.brief_version_id),
      corpusEligibleCount: historical.eligibleCount,
      corpusTruncated: historical.truncated,
      current: {
        contentHash: row.content_hash,
        draftId: row.draft_id,
        draftRevision: row.draft_revision,
        draftState: row.draft_state,
        draftStatus: row.status,
        draftVersionId: row.version_id,
        inputHash: row.input_hash,
        payload: draftPayload(row.payload_json),
        structuralPolicyVersion: row.structural_policy_version,
        structuralReasonCodes: stringArray(row.structural_reason_codes_json),
        structuralValid: row.structural_valid === 1,
      },
      evaluatedAt: now,
      historical: historical.items,
      publications: this.#publications(),
    });
  }

  #savedStatus(
    evaluation: CopyIntegrityEvaluation,
    checkType: CopyIntegrityCheckType,
  ): CopyIntegrityStatus {
    const exact = this.#database
      .prepare(
        `SELECT details_json,
           (draft_version_id = ? AND checker_version = ? AND input_hash = ?) AS exact FROM quality_checks
         WHERE draft_id = ? AND check_type = ? AND legacy_unresolved = 0
         ORDER BY exact DESC, created_at DESC LIMIT 1`,
      )
      .get(
        evaluation.draftVersionId,
        COPY_INTEGRITY_CHECKER_VERSION,
        evaluation.inputHash,
        evaluation.draftId,
        checkType,
      ) as Row | undefined;
    if (exact === undefined) return 'NOT_RUN';
    if (exact.exact === 1) {
      try {
        const parsed = JSON.parse(exact.details_json as string) as { readonly status?: unknown };
        if (validStoredStatus(parsed.status)) return parsed.status;
      } catch {
        throw new CopyIntegrityError('COPY_INTEGRITY_INVALID_CONTRACT');
      }
      throw new CopyIntegrityError('COPY_INTEGRITY_INVALID_CONTRACT');
    }
    return 'STALE';
  }
}
