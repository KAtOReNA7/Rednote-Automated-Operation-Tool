import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATIONS, connectDatabase, initializeDatabase } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
  insertMinimalDraft,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 025 migration', () => {
  it('appends exactly the next migration and creates normalized STRICT tables', async () => {
    expect(MIGRATIONS[17]).toMatchObject({
      name: 'versioned_copy_generation',
      version: 18,
    });
    const { database } = await createInitializedDatabase('copy migration 中文 空格');
    try {
      const rows = database
        .prepare(
          `SELECT name, sql FROM sqlite_schema
           WHERE type = 'table' AND name LIKE 'content_draft_%'
           ORDER BY name`,
        )
        .all() as unknown as readonly { readonly name: string; readonly sql: string }[];
      expect(rows.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          'content_draft_versions',
          'content_draft_heads',
          'content_draft_titles',
          'content_draft_blocks',
          'content_draft_tags',
          'content_draft_pinned_comments',
          'content_draft_spoiler_warnings',
          'content_draft_lineage_refs',
          'content_draft_field_states',
          'content_draft_dependencies',
          'content_draft_mutation_plans',
          'content_draft_mutation_runs',
          'content_draft_invalidations',
          'content_draft_transitions',
          'content_draft_audit_events',
        ]),
      );
      expect(rows.every(({ sql }) => sql.includes('STRICT'))).toBe(true);
      expect(database.prepare('SELECT * FROM pragma_foreign_key_check').all()).toEqual([]);
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    } finally {
      database.close();
    }
  });

  it('upgrades v1-v17, preserves legacy Draft and marks it STRUCTURE_INVALID', async () => {
    const databasePath = createTemporaryDatabasePath('copy legacy upgrade');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 17) });
    let database = connectDatabase(databasePath);
    insertMinimalDraft(database, 'issue025-upgrade');
    database.close();

    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({ appliedVersions: [18, 19, 20], schemaVersion: 20 });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      expect(database.prepare('SELECT count(*) AS count FROM drafts').get()).toEqual({ count: 1 });
      expect(
        database
          .prepare(
            `SELECT version.source_kind, version.status, version.structural_valid,
                    head.draft_state
               FROM content_draft_versions AS version
               JOIN content_draft_heads AS head ON head.current_version_id = version.id
              WHERE version.draft_id = 'draft-issue025-upgrade'`,
          )
          .get(),
      ).toMatchObject({
        draft_state: 'ACTIVE',
        source_kind: 'LEGACY',
        status: 'STRUCTURE_INVALID',
        structural_valid: 0,
      });
      expect(database.prepare('SELECT * FROM pragma_foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('keeps immutable version, block, lock, lineage, transition and audit histories', async () => {
    const { database } = await createInitializedDatabase('copy immutable schema');
    try {
      const triggerNames = (
        database
          .prepare(
            `SELECT name FROM sqlite_schema
              WHERE type = 'trigger' AND name LIKE 'content_draft_%immutable_%'
              ORDER BY name`,
          )
          .all() as unknown as readonly { readonly name: string }[]
      ).map(({ name }) => name);
      expect(triggerNames).toEqual(
        expect.arrayContaining([
          'content_draft_versions_immutable_update',
          'content_draft_blocks_immutable_update',
          'content_draft_field_states_immutable_update',
          'content_draft_lineage_immutable_update',
          'content_draft_transitions_immutable_update',
          'content_draft_audit_immutable_update',
        ]),
      );
    } finally {
      database.close();
    }
  });
});
