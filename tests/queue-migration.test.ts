import { existsSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import type { Migration, MigrationError } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

const ISSUE_007_CHECKSUM = '8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907';

async function createIssue007Database(databasePath: string): Promise<void> {
  await initializeDatabase({
    databasePath,
    migrations: [MIGRATIONS[0] as Migration],
  });
}

function tableDefinitions(databasePath: string): readonly unknown[] {
  const database = connectDatabase(databasePath);
  try {
    return database
      .prepare(
        `SELECT name, sql
         FROM sqlite_schema
         WHERE type = 'table'
           AND name NOT IN ('jobs', 'schema_migrations')
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all();
  } finally {
    database.close();
  }
}

describe('Issue 009 immutable queue migration', () => {
  it('keeps the Issue 007 migration checksum unchanged', () => {
    expect(migrationChecksum(MIGRATIONS[0] as Migration)).toBe(ISSUE_007_CHECKSUM);
  });

  it('adds one consecutive immutable migration', () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([1, 2]);
    expect(MIGRATIONS[1]).toMatchObject({
      name: 'persistent_local_job_queue',
      version: 2,
    });
    expect(Object.isFrozen(MIGRATIONS[1])).toBe(true);
  });

  it('is idempotent when the queue migration is already applied', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath });

    await expect(initializeDatabase({ databasePath })).resolves.toMatchObject({
      appliedVersions: [],
      backupPath: null,
      schemaVersion: 2,
    });
  });

  it('preserves existing jobs while assigning safe queue metadata', async () => {
    const databasePath = createTemporaryDatabasePath();
    await createIssue007Database(databasePath);
    const oldDatabase = connectDatabase(databasePath);
    oldDatabase
      .prepare(
        `INSERT INTO jobs(
           id, job_type, payload_json, status, attempt_count, max_attempts,
           next_run_at, last_error, created_at, updated_at
         ) VALUES (
           'legacy-job', 'LEGACY', '{"book":"保留"}', 'QUEUED', 0, 3,
           '2026-07-27T12:00:00.000Z', NULL,
           '2026-07-27T11:00:00.000Z', '2026-07-27T11:00:00.000Z'
         )`,
      )
      .run();
    oldDatabase.close();

    const result = await initializeDatabase({ databasePath });
    const migrated = connectDatabase(databasePath);
    try {
      expect(result.appliedVersions).toEqual([2]);
      expect(result.backupPath).not.toBeNull();
      expect(existsSync(result.backupPath ?? '')).toBe(true);
      expect(
        migrated
          .prepare(
            `SELECT id, job_type, idempotency_key, payload_json, priority,
                    status, attempt_count, max_attempts
             FROM jobs WHERE id = 'legacy-job'`,
          )
          .get(),
      ).toEqual({
        attempt_count: 0,
        id: 'legacy-job',
        idempotency_key: 'legacy:legacy-job',
        job_type: 'LEGACY',
        max_attempts: 3,
        payload_json: '{"book":"保留"}',
        priority: 0,
        status: 'QUEUED',
      });
    } finally {
      migrated.close();
    }
  });

  it('rolls back the complete queue table rebuild when migration two fails', async () => {
    const databasePath = createTemporaryDatabasePath();
    await createIssue007Database(databasePath);
    const oldDatabase = connectDatabase(databasePath);
    oldDatabase
      .prepare(
        `INSERT INTO jobs(id, job_type, payload_json, status, created_at, updated_at)
         VALUES (
           'rollback-job', 'LEGACY', '{}', 'QUEUED',
           '2026-07-27T12:00:00.000Z', '2026-07-27T12:00:00.000Z'
         )`,
      )
      .run();
    oldDatabase.close();
    const failingMigration: Migration = {
      ...(MIGRATIONS[1] as Migration),
      sql: `${(MIGRATIONS[1] as Migration).sql}
            INSERT INTO missing_queue_migration_table(id) VALUES ('fail');`,
    };

    await expect(
      initializeDatabase({
        databasePath,
        migrations: [MIGRATIONS[0] as Migration, failingMigration],
      }),
    ).rejects.toMatchObject({
      migrationVersion: 2,
      name: 'MigrationError',
    } satisfies Partial<MigrationError>);

    const database = connectDatabase(databasePath);
    try {
      expect(
        database.prepare("SELECT payload_json FROM jobs WHERE id = 'rollback-job'").get(),
      ).toEqual({ payload_json: '{}' });
      expect(
        database
          .prepare('PRAGMA table_info(jobs)')
          .all()
          .map((row) => (row as { readonly name: string }).name),
      ).toContain('locked_at');
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({ version: 1 });
    } finally {
      database.close();
    }
  });

  it('creates a pre-migration backup before applying the queue migration', async () => {
    const databasePath = createTemporaryDatabasePath();
    await createIssue007Database(databasePath);
    const result = await initializeDatabase({ databasePath });

    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath ?? '')).toBe(true);
  });

  it('does not alter unrelated business table definitions', async () => {
    const databasePath = createTemporaryDatabasePath();
    await createIssue007Database(databasePath);
    const before = tableDefinitions(databasePath);
    await initializeDatabase({ databasePath });
    const after = tableDefinitions(databasePath);

    expect(after).toEqual(before);
  });
});
