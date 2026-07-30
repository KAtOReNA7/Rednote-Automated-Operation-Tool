import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 021 reading authenticity migration', () => {
  it('appends one migration without changing v1-v13 identities', () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(MIGRATIONS[13]).toMatchObject({
      foreignKeysDisabled: true,
      name: 'reading_authenticity_policy',
      version: 14,
    });
    expect(MIGRATIONS.slice(0, 13).map(migrationChecksum)).toHaveLength(13);
  });

  it('conservatively upgrades legacy reading rows and preserves scores as integers', async () => {
    const databasePath = createTemporaryDatabasePath('真实性升级 中文 空格');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 13) });
    let database = connectDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO books(
           id, canonical_title, work_type, discovery_status, catalog_state, catalog_revision
         ) VALUES ('work-reading-legacy', '旧阅读状态', 'NOVEL', 'USER_ADDED', 'ACTIVE', 1)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO reading_states(
           id, book_id, state, memory_note, user_confirmed_at,
           personal_score, score_confirmed_at
         ) VALUES (
           'reading-legacy', 'work-reading-legacy', 'READ_CLEAR', '记忆明确',
           '2026-07-30T01:00:00.000Z', 87.5, '2026-07-30T01:01:00.000Z'
         )`,
      )
      .run();
    database.close();

    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({ appliedVersions: [14, 15, 16, 17, 18], schemaVersion: 18 });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT state, memory_confidence, confirmation_kind, user_note
             FROM reading_state_revisions
             WHERE reading_state_id = 'reading-legacy'`,
          )
          .get(),
      ).toEqual({
        confirmation_kind: 'LEGACY_MIGRATION',
        memory_confidence: 'CLEAR',
        state: 'R1_READ_CLEAR',
        user_note: '记忆明确',
      });
      expect(
        database
          .prepare(
            `SELECT score_basis_points, status, provenance
             FROM personal_score_records
             WHERE reading_state_id = 'reading-legacy'`,
          )
          .get(),
      ).toEqual({
        provenance: 'LEGACY_MIGRATION',
        score_basis_points: 8750,
        status: 'ACTIVE',
      });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('fails closed for legacy not-read/unknown values and freezes historical rows', async () => {
    const databasePath = createTemporaryDatabasePath('真实性保守升级');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 13) });
    let database = connectDatabase(databasePath);
    database.exec(`
      INSERT INTO books(
        id, canonical_title, work_type, discovery_status, catalog_state, catalog_revision
      ) VALUES
        ('work-not-read', '未读旧状态', 'NOVEL', 'USER_ADDED', 'ACTIVE', 1),
        ('work-unknown', '未知旧状态', 'NOVEL', 'USER_ADDED', 'ACTIVE', 1);
      INSERT INTO reading_states(id, book_id, state) VALUES
        ('reading-not-read', 'work-not-read', 'NOT_READ'),
        ('reading-unknown', 'work-unknown', 'UNKNOWN');
    `);
    database.close();

    await initializeDatabase({ databasePath });
    database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT state, memory_confidence
             FROM reading_state_revisions ORDER BY reading_state_id`,
          )
          .all(),
      ).toEqual([
        { memory_confidence: 'UNKNOWN', state: 'UNCLASSIFIED' },
        { memory_confidence: 'UNKNOWN', state: 'UNCLASSIFIED' },
      ]);
      expect(() =>
        database
          .prepare(
            `UPDATE reading_state_revisions
             SET state = 'R1_READ_CLEAR'
             WHERE reading_state_id = 'reading-unknown'`,
          )
          .run(),
      ).toThrow(/append-only/u);
      expect(() =>
        database
          .prepare(
            `INSERT INTO reading_state_revisions(
               id, reading_state_id, revision, contract_version, state,
               memory_confidence, confirmation_kind, finished_at_precision,
               last_read_at_precision, provenance, provenance_identity, created_at
             ) VALUES (
               'invalid-combination', 'reading-unknown', 2, 'reading-state-v1',
               'R1_READ_CLEAR', 'UNKNOWN', 'USER_EXPLICIT', 'UNKNOWN', 'UNKNOWN',
               'USER_UI', 'invalid', '2026-07-30T01:00:00.000Z'
             )`,
          )
          .run(),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('creates strict indexed tables with complete foreign keys', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const names = [
        'reading_states',
        'reading_state_revisions',
        'experience_assertions',
        'experience_assertion_revisions',
        'personal_score_records',
        'research_analysis_score_records',
        'system_prediction_scores',
        'reading_spoiler_preferences',
        'reading_spoiler_preference_revisions',
        'expression_permission_snapshots',
        'expression_permission_dependencies',
        'expression_permission_invalidations',
        'reading_authenticity_audit_events',
      ];
      const tables = database
        .prepare(
          `SELECT name, strict FROM pragma_table_list
           WHERE name IN (${names.map(() => '?').join(',')})`,
        )
        .all(...names) as unknown as readonly { readonly name: string; readonly strict: number }[];
      expect(tables).toHaveLength(names.length);
      expect(tables.every(({ strict }) => strict === 1)).toBe(true);
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('rolls back the whole v14 migration when its final statement fails', async () => {
    const databasePath = createTemporaryDatabasePath('真实性回滚');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 13) });
    let database = connectDatabase(databasePath);
    database.exec(`
      INSERT INTO books(
        id, canonical_title, work_type, discovery_status, catalog_state, catalog_revision
      ) VALUES ('work-rollback', '回滚书目', 'NOVEL', 'USER_ADDED', 'ACTIVE', 1);
      INSERT INTO reading_states(id, book_id, state)
      VALUES ('reading-rollback', 'work-rollback', 'READ_FUZZY');
    `);
    database.close();

    const v14 = MIGRATIONS[13];
    if (v14 === undefined) throw new Error('missing v14 migration');
    await expect(
      initializeDatabase({
        databasePath,
        migrations: [
          ...MIGRATIONS.slice(0, 13),
          {
            ...v14,
            sql: `${v14.sql}\nINSERT INTO issue021_missing_table(id) VALUES (1);`,
          },
        ],
      }),
    ).rejects.toThrow();

    database = connectDatabase(databasePath);
    try {
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({ version: 13 });
      expect(
        database
          .prepare(
            `SELECT state
             FROM reading_states
             WHERE id = 'reading-rollback'`,
          )
          .get(),
      ).toEqual({ state: 'READ_FUZZY' });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM sqlite_master
             WHERE type = 'table' AND name = 'reading_state_revisions'`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
