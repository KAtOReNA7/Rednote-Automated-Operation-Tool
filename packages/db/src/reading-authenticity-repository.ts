import type { DatabaseSync } from 'node:sqlite';

import {
  AUTHENTICITY_POLICY_VERSION,
  EXPRESSION_PERMISSION_VERSION,
  SCORE_POLICY_VERSION,
  SPOILER_POLICY_VERSION,
} from '@mystery-operations/authenticity';
import { assertContentDraftPayload, type ContentDraftPayloadV1 } from '@mystery-operations/copy';
import {
  READING_AUTHENTICITY_CHECKER_VERSION,
  ReadingAuthenticityError,
  evaluateReadingAuthenticity,
  factMappingHash,
  type ReadingAuthenticityEvaluation,
  type ReadingAuthenticityResearchScoreTruth,
  type ReadingAuthenticityScoreTruth,
  type ReadingAuthenticityStatus,
  type ReadingAuthenticityWorkTruth,
} from '@mystery-operations/quality';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

interface DraftRow extends Row {
  readonly draft_id: string;
  readonly draft_revision: number;
  readonly draft_state: string;
  readonly payload_json: string;
  readonly status: string;
  readonly structural_valid: number;
  readonly version_id: string;
}

export interface ReadingAuthenticityPreparedCheck {
  readonly evaluation: ReadingAuthenticityEvaluation;
  readonly savedStatus: ReadingAuthenticityStatus;
}

function draftPayload(value: string): ContentDraftPayloadV1 {
  try {
    return assertContentDraftPayload(JSON.parse(value) as unknown);
  } catch {
    throw new ReadingAuthenticityError('READING_AUTHENTICITY_NOT_READY');
  }
}

function readingState(value: unknown): ReadingAuthenticityWorkTruth['readingState'] {
  const states: Record<string, ReadingAuthenticityWorkTruth['readingState']> = {
    R1_READ_CLEAR: 'R1',
    R2_READ_FUZZY: 'R2',
    R3_READ_UNCONFIRMED_DETAILS: 'R3',
    S1_RESEARCH_ONLY: 'S1',
    S2_RESEARCH_INSUFFICIENT: 'S2',
    UNCLASSIFIED: 'UNCLASSIFIED',
  };
  return states[String(value)] ?? 'UNCLASSIFIED';
}

function validStoredStatus(
  value: unknown,
): value is Exclude<ReadingAuthenticityStatus, 'STALE' | 'NOT_RUN'> {
  return value === 'PASS' || value === 'BLOCKED' || value === 'REVIEW_REQUIRED';
}

export class SqliteReadingAuthenticityRepository {
  readonly #database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.#database = database;
  }

  public prepare(
    draftId: string,
    expectedRevision: number,
    now: string,
  ): ReadingAuthenticityPreparedCheck {
    const evaluation = this.#evaluate(draftId, expectedRevision, now);
    return Object.freeze({
      evaluation,
      savedStatus: this.#savedStatus(evaluation),
    });
  }

  public confirm(
    expected: Pick<
      ReadingAuthenticityEvaluation,
      'draftId' | 'draftRevision' | 'draftVersionId' | 'inputHash'
    >,
    now: string,
  ): ReadingAuthenticityPreparedCheck {
    const evaluation = runInTransaction(this.#database, () => {
      const current = this.#evaluate(expected.draftId, expected.draftRevision, now);
      if (
        current.draftVersionId !== expected.draftVersionId ||
        current.inputHash !== expected.inputHash
      ) {
        throw new ReadingAuthenticityError('READING_AUTHENTICITY_STALE_REVISION');
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
        throw new ReadingAuthenticityError('READING_AUTHENTICITY_INVALID_CONTRACT');
      }
      const id = `reading-authenticity-${factMappingHash({
        checkType: 'READING_AUTHENTICITY',
        checkerVersion: READING_AUTHENTICITY_CHECKER_VERSION,
        draftVersionId: current.draftVersionId,
        inputHash: current.inputHash,
      })}`;
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO quality_checks(
             id, draft_id, draft_version_id, check_type, result, severity,
             details_json, checker_version, input_hash, legacy_unresolved, created_at
           ) VALUES (?, ?, ?, 'READING_AUTHENTICITY', ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          id,
          current.draftId,
          current.draftVersionId,
          current.status === 'PASS' ? 'PASS' : 'FAIL',
          current.status === 'PASS'
            ? 'INFO'
            : current.status === 'BLOCKED'
              ? 'BLOCKING'
              : 'REVIEW_REQUIRED',
          detailsJson,
          READING_AUTHENTICITY_CHECKER_VERSION,
          current.inputHash,
          now,
        );
      const stored = this.#database
        .prepare(
          `SELECT draft_id, draft_version_id, checker_version, input_hash, details_json
           FROM quality_checks WHERE id = ?`,
        )
        .get(id) as Row | undefined;
      if (
        stored === undefined ||
        stored.draft_id !== current.draftId ||
        stored.draft_version_id !== current.draftVersionId ||
        stored.checker_version !== READING_AUTHENTICITY_CHECKER_VERSION ||
        stored.input_hash !== current.inputHash ||
        stored.details_json !== detailsJson
      ) {
        throw new ReadingAuthenticityError('READING_AUTHENTICITY_INVALID_CONTRACT');
      }
      return current;
    });
    return Object.freeze({ evaluation, savedStatus: evaluation.status });
  }

  #draft(draftId: string): DraftRow {
    const row = this.#database
      .prepare(
        `SELECT root.id AS draft_id, head.draft_revision, head.draft_state,
           version.id AS version_id, version.payload_json, version.status,
           version.structural_valid
         FROM drafts AS root
         JOIN content_draft_heads AS head ON head.draft_id = root.id
         JOIN content_draft_versions AS version ON version.id = head.current_version_id
         WHERE root.id = ?`,
      )
      .get(draftId) as DraftRow | undefined;
    if (row === undefined) {
      throw new ReadingAuthenticityError('READING_AUTHENTICITY_NOT_FOUND');
    }
    if (row.draft_state !== 'ACTIVE') {
      throw new ReadingAuthenticityError('READING_AUTHENTICITY_NOT_READY');
    }
    return row;
  }

  #evaluate(draftId: string, expectedRevision: number, now: string): ReadingAuthenticityEvaluation {
    const row = this.#draft(draftId);
    if (row.draft_revision !== expectedRevision) {
      throw new ReadingAuthenticityError('READING_AUTHENTICITY_STALE_REVISION');
    }
    const payload = draftPayload(row.payload_json);
    return evaluateReadingAuthenticity({
      draftId: row.draft_id,
      draftRevision: row.draft_revision,
      draftStatus: row.status,
      draftVersionId: row.version_id,
      evaluatedAt: now,
      payload,
      structuralValid: row.structural_valid === 1,
      truths: payload.brief.workIds.map((workId) => this.#truth(workId, payload)),
    });
  }

  #truth(workId: string, payload: ContentDraftPayloadV1): ReadingAuthenticityWorkTruth {
    const row = this.#database
      .prepare(
        `SELECT root.id, root.current_revision_id, root.current_snapshot_id, root.revision,
           revision.id AS reading_revision_id, revision.revision AS reading_revision,
           revision.state,
           snapshot.id AS snapshot_id, snapshot.dependency_hash,
           snapshot.first_person_permission, snapshot.personal_score_permission,
           snapshot.research_score_permission,
           CASE WHEN snapshot.id IS NULL OR snapshot.snapshot_version <> ? OR
             snapshot.authenticity_policy_version <> ? OR snapshot.score_policy_version <> ? OR
             snapshot.spoiler_policy_version <> ? OR
             snapshot.reading_state_revision_id <> root.current_revision_id OR EXISTS (
               SELECT 1 FROM expression_permission_invalidations AS invalidation
               WHERE invalidation.snapshot_id = snapshot.id
             ) THEN 0 ELSE 1 END AS permission_current
         FROM reading_states AS root
         JOIN reading_state_revisions AS revision ON revision.id = root.current_revision_id
         LEFT JOIN expression_permission_snapshots AS snapshot
           ON snapshot.id = root.current_snapshot_id
         WHERE root.book_id = ?`,
      )
      .get(
        EXPRESSION_PERMISSION_VERSION,
        AUTHENTICITY_POLICY_VERSION,
        SCORE_POLICY_VERSION,
        SPOILER_POLICY_VERSION,
        workId,
      ) as Row | undefined;
    if (row === undefined) {
      return Object.freeze({
        assertions: Object.freeze([]),
        dossier: null,
        personalScore: null,
        permission: Object.freeze({
          current: false,
          dependencyHash: null,
          firstPersonPermission: null,
          personalScorePermission: null,
          researchScorePermission: null,
          snapshotId: null,
        }),
        readingState: 'UNCLASSIFIED',
        readingStateRevision: null,
        readingStateRevisionId: null,
        researchScore: null,
        workId,
      });
    }
    const expectedSnapshot = payload.brief.expressionPolicy.permissionSnapshotId;
    const permissionCurrent = row.permission_current === 1 && row.snapshot_id === expectedSnapshot;
    const assertionIds = new Set(
      payload.titles
        .flatMap(({ lineage }) => lineage)
        .concat(payload.blocks.flatMap(({ lineage }) => lineage))
        .concat(payload.tags.flatMap(({ lineage }) => lineage))
        .concat(payload.pinnedComment?.lineage ?? [])
        .filter(({ workId: lineageWorkId }) => lineageWorkId === null || lineageWorkId === workId)
        .flatMap(({ experienceAssertionId }) =>
          experienceAssertionId === null ? [] : [experienceAssertionId],
        ),
    );
    const assertions = [...assertionIds].flatMap((assertionId) => {
      const assertion = this.#database
        .prepare(
          `SELECT root.id, revision.id AS revision_id, revision.confirmation_scope,
             revision.statement_hash, revision.status, revision.reading_state_revision_id
           FROM experience_assertions AS root
           JOIN experience_assertion_revisions AS revision
             ON revision.id = root.current_revision_id
           WHERE root.id = ? AND root.reading_state_id = ?`,
        )
        .get(assertionId, row.id as string) as Row | undefined;
      return assertion === undefined
        ? []
        : [
            Object.freeze({
              assertionId: assertion.id as string,
              assertionRevisionId: assertion.revision_id as string,
              confirmationScope: assertion.confirmation_scope as
                'EXACT_STATEMENT' | 'EXACT_STRUCTURED_OPINION',
              current:
                assertion.status === 'CONFIRMED' &&
                assertion.reading_state_revision_id === row.reading_revision_id,
              statementHash: assertion.statement_hash as string,
            }),
          ];
    });
    const sourceId = payload.brief.scorePlan.valueSourceId;
    const personalScore = this.#personalScore(sourceId, row.id as string);
    const researchScore = this.#researchScore(sourceId, row.id as string);
    const dossier =
      researchScore === null
        ? null
        : (this.#database
            .prepare(
              `SELECT id, current_version_id, state, readiness
               FROM research_dossiers WHERE id = ?`,
            )
            .get(researchScore.dossierId) as Row | undefined);
    return Object.freeze({
      assertions: Object.freeze(assertions),
      dossier:
        dossier === null || dossier === undefined
          ? null
          : Object.freeze({
              currentVersionId: dossier.current_version_id as string,
              dossierId: dossier.id as string,
              readinessStatus: dossier.readiness as string,
              state: dossier.state as string,
            }),
      personalScore,
      permission: Object.freeze({
        current: permissionCurrent,
        dependencyHash: row.dependency_hash as string | null,
        firstPersonPermission: row.first_person_permission as string | null,
        personalScorePermission: row.personal_score_permission as string | null,
        researchScorePermission: row.research_score_permission as string | null,
        snapshotId: row.snapshot_id as string | null,
      }),
      readingState: readingState(row.state),
      readingStateRevision: row.reading_revision as number,
      readingStateRevisionId: row.reading_revision_id as string,
      researchScore,
      workId,
    });
  }

  #personalScore(
    sourceId: string | null,
    readingStateId: string,
  ): ReadingAuthenticityScoreTruth | null {
    if (sourceId === null) return null;
    const row = this.#database
      .prepare(
        `SELECT id, reading_state_revision_id, revision, score_basis_points, provenance
         FROM personal_score_records
         WHERE id = ? AND reading_state_id = ? AND status = 'ACTIVE'
           AND revision = (
             SELECT max(current.revision) FROM personal_score_records AS current
             WHERE current.reading_state_id = ?
           )`,
      )
      .get(sourceId, readingStateId, readingStateId) as Row | undefined;
    return row === undefined
      ? null
      : Object.freeze({
          id: row.id as string,
          provenance: row.provenance as 'USER_UI' | 'LEGACY_MIGRATION',
          readingStateRevisionId: row.reading_state_revision_id as string,
          revision: row.revision as number,
          scoreBasisPoints: row.score_basis_points as number,
        });
  }

  #researchScore(
    sourceId: string | null,
    readingStateId: string,
  ): ReadingAuthenticityResearchScoreTruth | null {
    if (sourceId === null) return null;
    const row = this.#database
      .prepare(
        `SELECT id, reading_state_revision_id, dossier_id, dossier_version_id,
           revision, score_basis_points, public_label, provenance
         FROM research_analysis_score_records
         WHERE id = ? AND reading_state_id = ? AND status = 'ACTIVE'
           AND revision = (
             SELECT max(current.revision) FROM research_analysis_score_records AS current
             WHERE current.reading_state_id = ?
           )`,
      )
      .get(sourceId, readingStateId, readingStateId) as Row | undefined;
    return row === undefined
      ? null
      : Object.freeze({
          dossierId: row.dossier_id as string,
          dossierVersionId: row.dossier_version_id as string,
          id: row.id as string,
          provenance: row.provenance as 'USER_UI',
          publicLabel: row.public_label as '资料分析评分',
          readingStateRevisionId: row.reading_state_revision_id as string,
          revision: row.revision as number,
          scoreBasisPoints: row.score_basis_points as number,
        });
  }

  #savedStatus(evaluation: ReadingAuthenticityEvaluation): ReadingAuthenticityStatus {
    const exact = this.#database
      .prepare(
        `SELECT details_json FROM quality_checks
         WHERE draft_id = ? AND draft_version_id = ? AND check_type = 'READING_AUTHENTICITY'
           AND checker_version = ? AND input_hash = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(
        evaluation.draftId,
        evaluation.draftVersionId,
        READING_AUTHENTICITY_CHECKER_VERSION,
        evaluation.inputHash,
      ) as Row | undefined;
    if (exact !== undefined) {
      try {
        const parsed = JSON.parse(exact.details_json as string) as { readonly status?: unknown };
        if (validStoredStatus(parsed.status)) return parsed.status;
      } catch {
        throw new ReadingAuthenticityError('READING_AUTHENTICITY_INVALID_CONTRACT');
      }
      throw new ReadingAuthenticityError('READING_AUTHENTICITY_INVALID_CONTRACT');
    }
    const prior = this.#database
      .prepare(
        `SELECT 1 FROM quality_checks
         WHERE draft_id = ? AND check_type = 'READING_AUTHENTICITY' LIMIT 1`,
      )
      .get(evaluation.draftId);
    return prior === undefined ? 'NOT_RUN' : 'STALE';
  }
}
