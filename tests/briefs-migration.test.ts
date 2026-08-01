import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATIONS, connectDatabase, initializeDatabase } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
  insertMinimalDraft,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 024 migration', () => {
  it('appends exactly v17 and creates normalized strict Brief tables', async () => {
    expect(MIGRATIONS[16]).toMatchObject({
      name: 'structured_content_brief_generator',
      version: 17,
    });
    const { database } = await createInitializedDatabase('brief migration new 中文');
    try {
      const names = database
        .prepare(
          `SELECT name, sql FROM sqlite_schema
           WHERE type = 'table' AND name LIKE 'content_brief%'
           ORDER BY name`,
        )
        .all() as unknown as readonly { readonly name: string; readonly sql: string }[];
      expect(names.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'content_briefs',
          'content_brief_versions',
          'content_brief_evidence_refs',
          'content_brief_expression_policies',
          'content_brief_field_states',
          'content_brief_experiment_bindings',
          'content_brief_generation_plans',
          'content_brief_generation_runs',
          'content_brief_readiness_snapshots',
        ]),
      );
      expect(names.every((row) => row.sql.includes('STRICT'))).toBe(true);
      expect(database.prepare(`SELECT * FROM pragma_foreign_key_check`).all()).toEqual([]);
      expect(database.prepare(`PRAGMA quick_check`).get()).toEqual({ quick_check: 'ok' });
    } finally {
      database.close();
    }
  });

  it('upgrades v1-v16 without losing legacy drafts and never marks legacy rows ready', async () => {
    const databasePath = createTemporaryDatabasePath('brief upgrade');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 16) });
    let database = connectDatabase(databasePath);
    insertMinimalDraft(database, 'issue024-upgrade');
    database.close();

    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({ appliedVersions: [17, 18, 19, 20], schemaVersion: 20 });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      expect(database.prepare(`SELECT count(*) AS count FROM drafts`).get()).toEqual({ count: 1 });
      expect(
        database
          .prepare(
            `SELECT profile_id, current_version_id, score_type
             FROM content_briefs WHERE id = 'brief-issue024-upgrade'`,
          )
          .get(),
      ).toMatchObject({
        current_version_id: 'legacy-brief-version:brief-issue024-upgrade',
        profile_id: 'LEGACY_UNCLASSIFIED',
        score_type: 'RESEARCH_ANALYSIS',
      });
      expect(
        database
          .prepare(
            `SELECT readiness_status, schema_version
             FROM content_brief_versions
             WHERE brief_id = 'brief-issue024-upgrade'`,
          )
          .get(),
      ).toEqual({
        readiness_status: 'DRAFT_INCOMPLETE',
        schema_version: 'legacy-content-brief-v0',
      });
      expect(database.prepare(`SELECT * FROM pragma_foreign_key_check`).all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('rejects internal prediction in the new compatibility root', async () => {
    const { database } = await createInitializedDatabase('brief score constraint');
    try {
      database
        .prepare(
          `INSERT INTO topics(
             id, topic_type, angle, core_judgment, audience, spoiler_level, status
           ) VALUES ('brief-score-topic', 'BOOK_NOTE', 'a', 'j', 'r', 'NONE', 'IDEA')`,
        )
        .run();
      expect(() =>
        database
          .prepare(
            `INSERT INTO content_briefs(
               id, topic_id, content_type, target_reader, core_judgment,
               spoiler_level, score_type, status
             ) VALUES (
               'brief-score-invalid', 'brief-score-topic', 'ANALYSIS',
               'reader', 'judgment', 'NONE', 'INTERNAL_PREDICTION', 'RESEARCHING'
             )`,
          )
          .run(),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});
