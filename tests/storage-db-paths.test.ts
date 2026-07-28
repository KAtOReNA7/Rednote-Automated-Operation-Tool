import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import type { Migration } from '../packages/db/src/index.js';
import {
  isManagedRelativePath,
  type FileCategory,
} from '../packages/shared/src/storage-contracts.js';
import {
  cleanTemporaryDatabases,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';

afterEach(async () => {
  cleanTemporaryDatabases();
  await cleanTemporaryStorageDirectories();
});

const ISSUE_007_CHECKSUM = '8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907';
const ISSUE_009_CHECKSUM = 'ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce';
const ISSUE_008_CHECKSUM = '11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed';
const PATH_FIELDS = [
  {
    category: 'SOURCE_SNAPSHOT',
    column: 'local_snapshot_path',
    table: 'sources',
    valid: `sources/snapshots/aa/${'a'.repeat(64)}`,
  },
  {
    category: 'CLIP_SCREENSHOT',
    column: 'screenshot_path',
    table: 'clips',
    valid: `sources/screenshots/bb/${'b'.repeat(64)}`,
  },
  {
    category: 'PHOTO_ORIGINAL',
    column: 'original_path',
    table: 'assets',
    valid: `photos/originals/cc/${'c'.repeat(64)}`,
  },
  {
    category: 'PHOTO_PROCESSED',
    column: 'processed_path',
    table: 'assets',
    valid: `photos/processed/dd/${'d'.repeat(64)}`,
  },
  {
    category: 'EXPORT',
    column: 'export_path',
    table: 'post_packages',
    valid: `exports/ee/${'e'.repeat(64)}`,
  },
  {
    category: 'IMPORT',
    column: 'import_file_path',
    table: 'metric_snapshots',
    valid: `imports/ff/${'f'.repeat(64)}`,
  },
] as const satisfies readonly {
  readonly category: FileCategory;
  readonly column: string;
  readonly table: string;
  readonly valid: string;
}[];

function seedPathRows(database: ReturnType<typeof connectDatabase>): void {
  database
    .prepare(
      `INSERT INTO sources(
         id, url, title, source_tier, source_type, retrieved_at, content_hash, language
       ) VALUES (
         'source-path', 'https://example.test/path', 'Source', 'PRIMARY', 'WEB',
         '2026-07-27T00:00:00.000Z', 'source-hash', 'zh-CN'
       )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO clips(
         id, url, platform, visible_metrics_json, tags_json, created_at
       ) VALUES (
         'clip-path', 'https://example.test/clip', 'fixture', '{}', '[]',
         '2026-07-27T00:00:00.000Z'
       )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO assets(
         id, asset_type, origin, mime_type, content_hash
       ) VALUES ('asset-path', 'PHOTO', 'LOCAL', 'application/octet-stream', 'asset-hash')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO topics(
         id, topic_type, angle, core_judgment, audience, spoiler_level, status
       ) VALUES ('topic-path', 'BOOK', 'Angle', 'Judgment', 'Reader', 'NONE', 'IDEA')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO content_briefs(
         id, topic_id, content_type, target_reader, core_judgment, spoiler_level,
         score_type, status
       ) VALUES (
         'brief-path', 'topic-path', 'POST', 'Reader', 'Judgment', 'NONE',
         'RESEARCH_ANALYSIS', 'IDEA'
       )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO drafts(id, brief_id, version, title, body, status)
       VALUES ('draft-path', 'brief-path', 1, 'Title', 'Body', 'IDEA')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO post_packages(id, draft_id, status)
       VALUES ('package-path', 'draft-path', 'IDEA')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO publications(
         id, post_package_id, platform, platform_post_url, manually_published_at
       ) VALUES (
         'publication-path', 'package-path', 'fixture', 'https://example.test/post',
         '2026-07-27T00:00:00.000Z'
       )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO metric_snapshots(
         id, publication_id, snapshot_window, captured_at, source_method, metrics_json
       ) VALUES (
         'metric-path', 'publication-path', 'D1', '2026-07-27T00:00:00.000Z',
         'MANUAL', '{}'
       )`,
    )
    .run();
}

function rowId(table: string): string {
  return {
    assets: 'asset-path',
    clips: 'clip-path',
    metric_snapshots: 'metric-path',
    post_packages: 'package-path',
    sources: 'source-path',
  }[table] as string;
}

describe('managed local path migration', () => {
  it('keeps migrations 1 and 2 immutable and appends one stable consecutive migration', () => {
    expect(migrationChecksum(MIGRATIONS[0] as Migration)).toBe(ISSUE_007_CHECKSUM);
    expect(migrationChecksum(MIGRATIONS[1] as Migration)).toBe(ISSUE_009_CHECKSUM);
    expect(MIGRATIONS.slice(0, 3).map(({ version }) => version)).toEqual([1, 2, 3]);
    expect(MIGRATIONS[2]).toMatchObject({
      name: 'managed_local_file_paths',
      version: 3,
    });
    expect(migrationChecksum(MIGRATIONS[2] as Migration)).toBe(ISSUE_008_CHECKSUM);
    expect(Object.isFrozen(MIGRATIONS[2])).toBe(true);
  });

  it('enumerates exactly the nine real Schema path columns', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);
    try {
      const rows = database
        .prepare(
          `SELECT m.name AS table_name, p.name AS column_name
           FROM sqlite_schema AS m
           JOIN pragma_table_info(m.name) AS p
           WHERE m.type = 'table' AND p.name LIKE '%path%'
           ORDER BY m.name, p.cid`,
        )
        .all();
      expect(rows).toEqual([
        { column_name: 'original_path', table_name: 'assets' },
        { column_name: 'processed_path', table_name: 'assets' },
        { column_name: 'screenshot_path', table_name: 'clips' },
        { column_name: 'sanitized_html_path', table_name: 'fetched_documents' },
        { column_name: 'extracted_text_path', table_name: 'fetched_documents' },
        { column_name: 'import_file_path', table_name: 'metric_snapshots' },
        { column_name: 'managed_relative_path', table_name: 'model_cache_entries' },
        { column_name: 'export_path', table_name: 'post_packages' },
        { column_name: 'local_snapshot_path', table_name: 'sources' },
      ]);
    } finally {
      database.close();
    }
  });

  it('accepts legal field-specific paths and preserves NULL semantics', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);
    try {
      seedPathRows(database);
      for (const field of PATH_FIELDS) {
        expect(isManagedRelativePath(field.valid, field.category)).toBe(true);
        database
          .prepare(`UPDATE "${field.table}" SET "${field.column}" = ? WHERE id = ?`)
          .run(field.valid, rowId(field.table));
        expect(
          database
            .prepare(`SELECT "${field.column}" AS path FROM "${field.table}" WHERE id = ?`)
            .get(rowId(field.table)),
        ).toEqual({ path: field.valid });
        database
          .prepare(`UPDATE "${field.table}" SET "${field.column}" = NULL WHERE id = ?`)
          .run(rowId(field.table));
      }
    } finally {
      database.close();
    }
  });

  it('shares an invalid-path corpus between TypeScript and every SQLite field constraint', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);
    try {
      seedPathRows(database);
      for (const field of PATH_FIELDS) {
        const prefix = field.valid.split('/').slice(0, -2).join('/');
        const invalidCandidates = [
          '',
          '/absolute',
          'C:/absolute',
          'C:\\absolute',
          'file:///absolute',
          'wrong/aa/file',
          `${prefix}//file`,
          `${prefix}/./file`,
          `${prefix}/../file`,
          `${prefix}/file/`,
          `${prefix}/.rednote-tmp-owned.partial`,
          `${prefix}/\nfile`,
        ];
        for (const candidate of invalidCandidates) {
          expect(
            isManagedRelativePath(candidate, field.category),
            `${field.column}: ${candidate}`,
          ).toBe(false);
          expect(
            () =>
              database
                .prepare(`UPDATE "${field.table}" SET "${field.column}" = ? WHERE id = ?`)
                .run(candidate, rowId(field.table)),
            `${field.column}: ${candidate}`,
          ).toThrow(/CHECK constraint failed/iu);
        }
      }
    } finally {
      database.close();
    }
  });

  it('migrates version 2 data without rebuilding tables and writes an independent controlled backup', async () => {
    const { root } = await createStorageTestContext();
    const databasePath = join(root.databaseDirectory, 'project.sqlite');
    await initializeDatabase({
      databasePath,
      migrations: MIGRATIONS.slice(0, 2),
    });
    const before = connectDatabase(databasePath);
    let schemaBefore: readonly unknown[];
    try {
      seedPathRows(before);
      before
        .prepare(
          `UPDATE sources
           SET local_snapshot_path = 'sources/snapshots/aa/legacy-valid-path'
           WHERE id = 'source-path'`,
        )
        .run();
      schemaBefore = before
        .prepare(
          `SELECT type, name, tbl_name
           FROM sqlite_schema
           WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
           ORDER BY type, name`,
        )
        .all();
    } finally {
      before.close();
    }

    const result = await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
      migrations: MIGRATIONS.slice(0, 3),
    });
    expect(result).toMatchObject({ appliedVersions: [3], schemaVersion: 3 });
    expect(result.backupPath?.startsWith(root.backupDatabaseDirectory)).toBe(true);
    expect(existsSync(result.backupPath ?? '')).toBe(true);

    const migrated = connectDatabase(databasePath);
    try {
      expect(
        migrated.prepare("SELECT local_snapshot_path FROM sources WHERE id = 'source-path'").get(),
      ).toEqual({ local_snapshot_path: 'sources/snapshots/aa/legacy-valid-path' });
      expect(
        migrated
          .prepare(
            `SELECT type, name, tbl_name
             FROM sqlite_schema
             WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
             ORDER BY type, name`,
          )
          .all(),
      ).toEqual(schemaBefore);
      expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        migrated.prepare("SELECT strict FROM pragma_table_list WHERE name = 'sources'").get(),
      ).toEqual({ strict: 1 });
    } finally {
      migrated.close();
    }

    const backup = new DatabaseSync(result.backupPath ?? '', { readOnly: true });
    try {
      expect(backup.prepare('PRAGMA user_version').get()).toBeDefined();
      expect(backup.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual(
        {
          version: 2,
        },
      );
      expect(backup.prepare('SELECT count(*) AS count FROM sources').get()).toEqual({ count: 1 });
    } finally {
      backup.close();
    }
  });

  it('rolls back migration 3 with a later failing migration and leaves the version 2 source openable', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 2) });
    const failingMigration: Migration = {
      name: 'simulated_failure_after_paths',
      sql: 'CREATE TABLE issue008_partial(id TEXT) STRICT; SELECT * FROM missing_table;',
      version: 4,
    };

    await expect(
      initializeDatabase({
        databasePath,
        migrations: [...MIGRATIONS.slice(0, 3), failingMigration],
      }),
    ).rejects.toMatchObject({ migrationVersion: 4 });
    const database = connectDatabase(databasePath);
    try {
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({
        version: 2,
      });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_schema
             WHERE type = 'trigger' AND name LIKE 'validate_%_path_%'`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_schema
             WHERE type = 'table' AND name = 'issue008_partial'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('does not start migration when an explicit backup directory cannot be created', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 2) });
    const blockedDirectory = `${databasePath}.blocked-backup-directory`;
    await writeFile(blockedDirectory, 'not a directory', 'utf8');

    await expect(
      initializeDatabase({
        backupDirectory: blockedDirectory,
        databasePath,
      }),
    ).rejects.toMatchObject({ backupPath: null, migrationVersion: 3 });
    const database = connectDatabase(databasePath);
    try {
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({
        version: 2,
      });
    } finally {
      database.close();
    }
  });

  it('keeps an immutable published file as an orphan when a database path write fails and reuses it', async () => {
    const { repository, root } = await createStorageTestContext();
    const databasePath = join(root.databaseDirectory, 'project.sqlite');
    await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);
    const content = Buffer.from('published before database failure');
    const descriptor = await repository.putBuffer(content, {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'snapshot.html',
    });
    try {
      seedPathRows(database);
      expect(() =>
        database
          .prepare(
            "UPDATE sources SET local_snapshot_path = 'C:\\outside' WHERE id = 'source-path'",
          )
          .run(),
      ).toThrow(/CHECK constraint failed/iu);
      expect(existsSync(root.resolve(descriptor.managedPath))).toBe(true);

      const retried = await repository.putBuffer(content, {
        category: 'SOURCE_SNAPSHOT',
        displayName: 'snapshot retry.html',
      });
      expect(retried.managedPath).toBe(descriptor.managedPath);
      database
        .prepare('UPDATE sources SET local_snapshot_path = ? WHERE id = ?')
        .run(retried.managedPath, 'source-path');
      expect(
        database.prepare("SELECT local_snapshot_path FROM sources WHERE id = 'source-path'").get(),
      ).toEqual({ local_snapshot_path: descriptor.managedPath });
    } finally {
      database.close();
    }
  });
});
