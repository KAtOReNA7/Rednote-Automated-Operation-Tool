import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  READING_AUTHENTICITY_CHECKER_VERSION,
  ReadingAuthenticityError,
} from '../packages/quality/src/index.js';
import { SqliteReadingAuthenticityRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { createReadyCopyRepositoryFixture, requiredFixtureValue } from './support/copy-fixtures.js';

const NOW = '2026-07-31T02:00:00.000Z';

afterEach(cleanTemporaryDatabases);

describe('Issue 027 SQLite reading authenticity checks', () => {
  it('keeps preview read-only and appends one bounded content-addressed summary', async () => {
    const { database } = await createInitializedDatabase('reading authenticity repository');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'reading-check');
      const repository = new SqliteReadingAuthenticityRepository(database);
      database
        .prepare(
          `INSERT INTO system_prediction_scores(
             id, profile_id, book_id, score_basis_points, purpose, provenance, created_at
           ) VALUES (?, 'primary', ?, 9876, 'INTERNAL_ORDERING_ONLY', 'SCRIPTED_FIXTURE', ?)`,
        )
        .run(
          'internal-score-must-not-be-read',
          requiredFixtureValue(fixture.payload.brief.workIds[0]),
          NOW,
        );
      const headBefore = database
        .prepare(
          `SELECT current_version_id, draft_revision FROM content_draft_heads WHERE draft_id = ?`,
        )
        .get(fixture.created.draftId);

      const preview = repository.prepare(fixture.created.draftId, fixture.created.revision, NOW);
      expect(preview).toMatchObject({
        evaluation: { status: 'PASS' },
        savedStatus: 'NOT_RUN',
      });
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 0,
      });
      expect(JSON.stringify(preview)).not.toMatch(/9876|internal-score-must-not-be-read/iu);

      const saved = repository.confirm(preview.evaluation, '2026-07-31T02:00:01.000Z');
      expect(saved.savedStatus).toBe('PASS');
      repository.confirm(preview.evaluation, '2026-07-31T02:00:02.000Z');
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 1,
      });
      expect(
        database
          .prepare(
            `SELECT check_type, result, summary_status, reason_code, fact_mapping_version_id,
               fact_mapping_run_id, details_json, checker_version, input_hash, legacy_unresolved
             FROM quality_checks`,
          )
          .get(),
      ).toMatchObject({
        check_type: 'READING_AUTHENTICITY',
        checker_version: READING_AUTHENTICITY_CHECKER_VERSION,
        fact_mapping_run_id: null,
        fact_mapping_version_id: null,
        input_hash: preview.evaluation.inputHash,
        legacy_unresolved: 0,
        reason_code: null,
        result: 'PASS',
        summary_status: null,
      });
      const details = database.prepare(`SELECT details_json FROM quality_checks`).get() as {
        readonly details_json: string;
      };
      expect(Buffer.byteLength(details.details_json, 'utf8')).toBeLessThanOrEqual(4_096);
      expect(details.details_json).not.toMatch(
        /system_prediction|internal-score|[A-Z]:\\|\\\\|statement|payload_json/iu,
      );
      expect(
        database
          .prepare(
            `SELECT current_version_id, draft_revision FROM content_draft_heads WHERE draft_id = ?`,
          )
          .get(fixture.created.draftId),
      ).toEqual(headBefore);
    } finally {
      database.close();
    }
  });

  it('reports a prior non-current input as stale without changing or deleting it', async () => {
    const { database } = await createInitializedDatabase('reading authenticity stale');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'reading-stale');
      const versionId = requiredFixtureValue(
        fixture.created.versionHistory.items.find(({ isCurrent }) => isCurrent),
      ).versionId;
      database
        .prepare(
          `INSERT INTO quality_checks(
             id, draft_id, draft_version_id, check_type, result, severity, details_json,
             checker_version, input_hash, legacy_unresolved, created_at
           ) VALUES (?, ?, ?, 'READING_AUTHENTICITY', 'PASS', 'INFO', ?, ?, ?, 0, ?)`,
        )
        .run(
          'reading-authenticity-prior-input',
          fixture.created.draftId,
          versionId,
          JSON.stringify({ schemaVersion: 1, status: 'PASS' }),
          READING_AUTHENTICITY_CHECKER_VERSION,
          'b'.repeat(64),
          NOW,
        );
      const result = new SqliteReadingAuthenticityRepository(database).prepare(
        fixture.created.draftId,
        fixture.created.revision,
        NOW,
      );
      expect(result.savedStatus).toBe('STALE');
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 1,
      });
    } finally {
      database.close();
    }
  });

  it('rejects a preview after the immutable current DraftVersion changes', async () => {
    const { database } = await createInitializedDatabase('reading authenticity current version');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'reading-current');
      const repository = new SqliteReadingAuthenticityRepository(database);
      const preview = repository.prepare(fixture.created.draftId, fixture.created.revision, NOW);
      const selectedId = requiredFixtureValue(fixture.created.payload.selectedTitleId);
      fixture.copy.saveVersion(
        fixture.created.draftId,
        fixture.created.revision,
        {
          ...fixture.created.payload,
          titles: fixture.created.payload.titles.map((title) =>
            title.titleId === selectedId ? { ...title, text: `${title.text}（新版本）` } : title,
          ),
        },
        ['USER_EDIT'],
        '2026-07-31T02:00:03.000Z',
      );
      expect(() => repository.confirm(preview.evaluation, '2026-07-31T02:00:04.000Z')).toThrow(
        ReadingAuthenticityError,
      );
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 0,
      });
    } finally {
      database.close();
    }
  });

  it('has no new schema object and the repository cannot name the internal prediction table', () => {
    const source = readFileSync(
      new URL('../packages/db/src/reading-authenticity-repository.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('system_prediction_scores');
    expect(source).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TRIGGER)\b/iu);
    expect(source).toContain('INSERT OR IGNORE INTO quality_checks');
  });
});
