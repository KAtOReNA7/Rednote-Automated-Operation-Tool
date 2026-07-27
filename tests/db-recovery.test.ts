import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  MigrationError,
  connectDatabase,
  initializeDatabase,
} from '../packages/db/src/index.js';
import type { Migration } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

const FAILING_MIGRATION: Migration = {
  name: 'simulated_failure',
  sql: `
    CREATE TABLE migration_probe(id TEXT PRIMARY KEY) STRICT;
    INSERT INTO migration_probe(id) VALUES ('temporary-row');
    INSERT INTO table_that_does_not_exist(id) VALUES ('failure');
  `,
  version: 2,
};

const MIGRATIONS_WITH_FAILURE = [...MIGRATIONS, FAILING_MIGRATION] as const;
const SUCCESSFUL_SECOND_MIGRATION: Migration = {
  name: 'successful_incremental_upgrade',
  sql: `
    CREATE TABLE migration_upgrade_probe(
      id TEXT PRIMARY KEY,
      note TEXT NOT NULL
    ) STRICT;
  `,
  version: 2,
};

async function createVersionOneDatabase(databasePath: string): Promise<void> {
  await initializeDatabase({ databasePath });
  const database = connectDatabase(databasePath);
  try {
    database
      .prepare(
        `INSERT INTO account_profiles(id, working_name)
         VALUES ('profile-before-failure', 'Persistent User')`,
      )
      .run();
  } finally {
    database.close();
  }
}

describe('pre-migration backup and failure recovery', () => {
  it('applies a versioned incremental migration after backing up version one', async () => {
    const databasePath = createTemporaryDatabasePath();
    await createVersionOneDatabase(databasePath);

    const result = await initializeDatabase({
      databasePath,
      migrations: [...MIGRATIONS, SUCCESSFUL_SECOND_MIGRATION],
    });

    expect(result.appliedVersions).toEqual([2]);
    expect(result.schemaVersion).toBe(2);
    expect(existsSync(result.backupPath ?? '')).toBe(true);
    const database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT working_name
             FROM account_profiles
             WHERE id = 'profile-before-failure'`,
          )
          .get(),
      ).toEqual({ working_name: 'Persistent User' });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM sqlite_schema
             WHERE type = 'table' AND name = 'migration_upgrade_probe'`,
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('backs up and preserves a pre-existing unversioned database during initialization', async () => {
    const databasePath = createTemporaryDatabasePath();
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE legacy_local_data(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO legacy_local_data(id, value) VALUES ('legacy-1', 'keep-me');
    `);
    legacyDatabase.close();

    const result = await initializeDatabase({ databasePath });

    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath ?? '')).toBe(true);
    const migratedDatabase = connectDatabase(databasePath);
    try {
      expect(
        migratedDatabase.prepare("SELECT value FROM legacy_local_data WHERE id = 'legacy-1'").get(),
      ).toEqual({ value: 'keep-me' });
      expect(
        migratedDatabase.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({ version: 1 });
    } finally {
      migratedDatabase.close();
    }
  });

  it('backs up an existing database before applying a pending migration', async () => {
    const databasePath = createTemporaryDatabasePath();
    await createVersionOneDatabase(databasePath);

    let error: unknown;
    try {
      await initializeDatabase({
        databasePath,
        migrations: MIGRATIONS_WITH_FAILURE,
        now: () => new Date('2026-07-27T12:34:56.789Z'),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MigrationError);
    const migrationError = error as MigrationError;
    expect(migrationError.message).toContain('SQLite migration 2 failed');
    expect(migrationError.cause).toBeInstanceOf(Error);
    expect(migrationError.backupPath).not.toBeNull();
    expect(migrationError.backupPath).toMatch(/content\.before-migration\..+\.sqlite\.bak$/u);
    expect(existsSync(migrationError.backupPath ?? '')).toBe(true);

    const backupDatabase = new DatabaseSync(migrationError.backupPath ?? '', {
      readOnly: true,
    });
    try {
      expect(
        backupDatabase
          .prepare(
            `SELECT working_name
             FROM account_profiles
             WHERE id = 'profile-before-failure'`,
          )
          .get(),
      ).toEqual({ working_name: 'Persistent User' });
    } finally {
      backupDatabase.close();
    }
  });

  it('never overwrites an existing backup filename', async () => {
    const databasePath = createTemporaryDatabasePath();
    await createVersionOneDatabase(databasePath);
    const fixedDate = new Date('2026-07-27T12:34:56.789Z');
    const extension = extname(databasePath);
    const stem = basename(databasePath, extension);
    const reservedBackupPath = join(
      dirname(databasePath),
      'backups',
      `${stem}.before-migration.${fixedDate.toISOString().replaceAll(':', '-')}${extension}.bak`,
    );

    mkdirSync(dirname(reservedBackupPath), { recursive: true });
    writeFileSync(reservedBackupPath, 'do-not-overwrite', 'utf8');

    let error: unknown;
    try {
      await initializeDatabase({
        databasePath,
        migrations: MIGRATIONS_WITH_FAILURE,
        now: () => fixedDate,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MigrationError);
    expect(readFileSync(reservedBackupPath, 'utf8')).toBe('do-not-overwrite');
    expect((error as MigrationError).backupPath).not.toBe(reservedBackupPath);
    expect((error as MigrationError).backupPath).toContain('.1.sqlite.bak');
  });

  it('keeps the source database openable, its data intact, and its version unchanged', async () => {
    const databasePath = createTemporaryDatabasePath();
    await createVersionOneDatabase(databasePath);

    await expect(
      initializeDatabase({
        databasePath,
        migrations: MIGRATIONS_WITH_FAILURE,
      }),
    ).rejects.toMatchObject({
      migrationVersion: 2,
      name: 'MigrationError',
    });

    const database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT working_name
             FROM account_profiles
             WHERE id = 'profile-before-failure'`,
          )
          .get(),
      ).toEqual({ working_name: 'Persistent User' });
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({
        version: 1,
      });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM sqlite_schema
             WHERE type = 'table' AND name = 'migration_probe'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('leaves no half-applied schema when first-time initialization fails', async () => {
    const databasePath = createTemporaryDatabasePath();
    const failingInitialMigration: Migration = {
      name: 'failing_initial',
      sql: `
        CREATE TABLE first_half(id TEXT PRIMARY KEY) STRICT;
        INSERT INTO missing_second_half(id) VALUES ('failure');
      `,
      version: 1,
    };

    await expect(
      initializeDatabase({
        databasePath,
        migrations: [failingInitialMigration],
      }),
    ).rejects.toBeInstanceOf(MigrationError);

    const database = new DatabaseSync(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM sqlite_schema
             WHERE type = 'table'
               AND name IN ('first_half', 'schema_migrations')`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    } finally {
      database.close();
    }
  });
});
