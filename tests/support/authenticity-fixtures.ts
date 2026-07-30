import type { DatabaseSync } from 'node:sqlite';

import type { MemoryConfidence, ReadingStateCode } from '../../packages/authenticity/src/index.js';
import type { SqliteAuthenticityRepository } from '../../packages/db/src/index.js';

export const AUTHENTICITY_NOW = '2026-07-30T03:00:00.000Z';

export function insertAuthenticityWork(
  database: DatabaseSync,
  workId: string,
  title = workId,
): void {
  database
    .prepare(
      `INSERT INTO books(
         id, canonical_title, work_type, discovery_status, catalog_state, catalog_revision
       ) VALUES (?, ?, 'NOVEL', 'DISCOVERED', 'ACTIVE', 1)`,
    )
    .run(workId, title);
}

export function insertAuthenticityExpressionEdition(
  database: DatabaseSync,
  workId: string,
): { readonly editionId: string; readonly expressionId: string } {
  const expressionId = `expression-${workId}`;
  const editionId = `edition-${workId}`;
  database
    .prepare(
      `INSERT INTO expressions(
         id, work_id, expression_kind, canonical_title, normalized_title,
         language, catalog_state, revision
       ) VALUES (?, ?, 'ORIGINAL', ?, ?, 'zh-CN', 'ACTIVE', 1)`,
    )
    .run(expressionId, workId, `${workId} 表达`, `${workId} 表达`);
  database
    .prepare(
      `INSERT INTO book_editions(
         id, expression_id, translated_title, publisher, edition_label,
         format, catalog_state, catalog_revision
       ) VALUES (?, ?, ?, '合成出版社', '合成版', 'PAPER', 'ACTIVE', 1)`,
    )
    .run(editionId, expressionId, `${workId} 版本`);
  return { editionId, expressionId };
}

export function insertAuthenticityDossier(
  database: DatabaseSync,
  workId: string,
  readiness: 'FACT_BLOCKED' | 'INSUFFICIENT_COVERAGE' | 'READY_FOR_CONTENT_BRIEF',
): { readonly dossierId: string; readonly versionId: string } {
  const dossierId = `dossier-${workId}`;
  const versionId = `dossier-version-${workId}`;
  database
    .prepare(
      `INSERT OR IGNORE INTO fact_subjects(subject_type, subject_id, work_id)
       VALUES ('WORK', ?, ?)`,
    )
    .run(workId, workId);
  database
    .prepare(
      `INSERT INTO research_dossiers(
         id, book_id, subject_type, subject_id, revision, state, readiness,
         invalidation_reasons_json, created_at, updated_at
       ) VALUES (?, ?, 'WORK', ?, 1, 'CURRENT', ?, '[]', ?, ?)`,
    )
    .run(dossierId, workId, workId, readiness, AUTHENTICITY_NOW, AUTHENTICITY_NOW);
  database
    .prepare(
      `INSERT INTO research_dossier_versions(
         id, dossier_id, version_number, previous_version_id, schema_version,
         coverage_policy_version, fact_policy_version, input_hash, build_mode,
         build_run_id, readiness, reason_codes_json, warnings_json,
         legacy_payload_json, revision, created_at, published_at
       ) VALUES (
         ?, ?, 1, NULL, 'research-dossier-v1', 'coverage-policy-v1',
         'fact-policy-v1', ?, 'INITIAL', NULL, ?, '[]', '[]', NULL, 1, ?, ?
       )`,
    )
    .run(versionId, dossierId, 'a'.repeat(64), readiness, AUTHENTICITY_NOW, AUTHENTICITY_NOW);
  database
    .prepare(
      `UPDATE research_dossiers
       SET current_version_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(versionId, AUTHENTICITY_NOW, dossierId);
  return { dossierId, versionId };
}

export function applyReadingState(
  repository: SqliteAuthenticityRepository,
  input: {
    readonly confidence: MemoryConfidence;
    readonly expectedRevision?: number;
    readonly state: ReadingStateCode;
    readonly workId: string;
  },
  now = AUTHENTICITY_NOW,
): void {
  repository.applyStateChange(
    {
      confirmationKind: 'USER_EXPLICIT',
      expectedRevision: input.expectedRevision ?? 0,
      finishedAt: null,
      finishedAtPrecision: 'UNKNOWN',
      lastReadAt: null,
      lastReadAtPrecision: 'UNKNOWN',
      memoryConfidence: input.confidence,
      nextState: input.state,
      profileId: 'primary',
      provenance: 'USER_UI',
      subject: { editionId: null, expressionId: null, workId: input.workId },
      userNote: null,
    },
    now,
  );
}
