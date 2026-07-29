import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  SqliteEvidenceRepository,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';
import { createReadyWorkEvidence } from './support/dossier-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 020 dossier migration', () => {
  it('appends one migration without changing v1-v12 identities', () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(MIGRATIONS[12]).toMatchObject({
      foreignKeysDisabled: true,
      name: 'versioned_research_dossiers',
      version: 13,
    });
    expect(MIGRATIONS.slice(0, 12).map(migrationChecksum)).toHaveLength(12);
    expect(
      MIGRATIONS.slice(0, 12)
        .map(migrationChecksum)
        .every((value) => /^[a-f0-9]{64}$/u.test(value)),
    ).toBe(true);
  });

  it('upgrades legacy dossier rows into append-only versions without promoting old JSON', async () => {
    const databasePath = createTemporaryDatabasePath('档案升级 中文 空格');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 12) });
    let database = connectDatabase(databasePath);
    let sequence = 0;
    const evidence = new SqliteEvidenceRepository(database, () => `migration-id-${++sequence}`);
    createReadyWorkEvidence(database, evidence, 'work-legacy-dossier');
    database.exec(`
      INSERT INTO expressions(
        id, work_id, expression_kind, canonical_title, normalized_title,
        language, catalog_state, revision
      ) VALUES (
        'expression-legacy-dossier', 'work-legacy-dossier', 'TRANSLATION',
        'Legacy Translation', 'legacy translation', 'en-US', 'ACTIVE', 1
      );
      INSERT INTO book_editions(
        id, expression_id, isbn, translated_title, publisher, edition_label,
        format, catalog_state, catalog_revision
      ) VALUES (
        'edition-legacy-dossier', 'expression-legacy-dossier', '9780000000013',
        'Legacy Edition', 'Synthetic Publisher', 'First', 'PAPER', 'ACTIVE', 1
      );
    `);
    database
      .prepare(
        `INSERT INTO research_dossiers(
           id, book_id, version, research_questions_json, summary,
           consensus_json, disputes_json, source_coverage_score, status, created_at
         ) VALUES
           ('legacy-dossier-v1', 'work-legacy-dossier', 1, '["问题一"]',
            '旧摘要一', '["未验证共识一"]', '[]', 50, 'DRAFT',
            '2026-07-29T03:00:00.000Z'),
           ('legacy-dossier-v2', 'work-legacy-dossier', 2, '["问题二"]',
            '旧摘要二', '["未验证共识二"]', '["旧争议"]', 60, 'READY',
            '2026-07-29T03:10:00.000Z')`,
      )
      .run();
    database.close();

    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({ appliedVersions: [13], schemaVersion: 13 });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT subject_type, subject_id, state, readiness, revision
             FROM research_dossiers`,
          )
          .get(),
      ).toEqual({
        readiness: 'BUILD_REQUIRED',
        revision: 1,
        state: 'REBUILD_REQUIRED',
        subject_id: 'work-legacy-dossier',
        subject_type: 'WORK',
      });
      const versions = database
        .prepare(
          `SELECT version_number, build_mode, readiness, legacy_payload_json
           FROM research_dossier_versions ORDER BY version_number`,
        )
        .all() as unknown as readonly Record<string, unknown>[];
      expect(versions).toHaveLength(2);
      expect(versions.map((row) => row.build_mode)).toEqual([
        'LEGACY_MIGRATION',
        'LEGACY_MIGRATION',
      ]);
      expect(JSON.parse(versions[1]?.legacy_payload_json as string)).toMatchObject({
        consensus: ['未验证共识二'],
        summary: '旧摘要二',
      });
      expect(
        database.prepare('SELECT count(*) AS count FROM research_dossier_entries').get(),
      ).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(database.prepare('SELECT count(*) AS count FROM expressions').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT count(*) AS count FROM book_editions').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT count(*) AS count FROM source_revisions').get()).toEqual({
        count: 3,
      });
      expect(database.prepare('SELECT count(*) AS count FROM claims').get()).toEqual({ count: 3 });
      expect(database.prepare('SELECT count(*) AS count FROM claim_evidence').get()).toEqual({
        count: 3,
      });
      expect(() =>
        database
          .prepare(
            `UPDATE research_dossier_versions
             SET readiness = 'READY_FOR_CONTENT_BRIEF'
             WHERE id = 'legacy-version:legacy-dossier-v2'`,
          )
          .run(),
      ).toThrow(/append-only/u);
      expect(() =>
        database
          .prepare(
            `DELETE FROM research_dossier_versions
             WHERE id = 'legacy-version:legacy-dossier-v1'`,
          )
          .run(),
      ).toThrow(/append-only/u);
    } finally {
      database.close();
    }
  });

  it('creates STRICT indexed tables and append-only published history', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const tables = database
        .prepare(
          `SELECT name, strict FROM pragma_table_list
           WHERE name LIKE 'research_dossier_%' OR name = 'research_dossiers'
           ORDER BY name`,
        )
        .all() as unknown as readonly { readonly name: string; readonly strict: number }[];
      expect(tables.length).toBeGreaterThanOrEqual(14);
      expect(tables.every((table) => table.strict === 1)).toBe(true);
      const indexes = database
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'index' AND name LIKE 'idx_research_dossier_%'`,
        )
        .all() as unknown as readonly { readonly name: string }[];
      expect(indexes.map(({ name }) => name)).toContain('idx_research_dossier_dependencies_lookup');
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
