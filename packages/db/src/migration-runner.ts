import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

import { connectDatabase, resolveDatabasePath } from './connection.js';
import { MIGRATIONS, type Migration } from './migrations.js';
import { runInTransaction } from './transaction.js';

const SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL CHECK (version > 0),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL CHECK (applied_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;
`;

interface AppliedMigrationRow {
  readonly checksum: string;
  readonly name: string;
  readonly version: number;
}

export interface InitializeDatabaseOptions {
  readonly backupDirectory?: string;
  readonly databasePath: string;
  readonly migrations?: readonly Migration[];
  readonly now?: () => Date;
}

export interface MigrationResult {
  readonly appliedVersions: readonly number[];
  readonly backupPath: string | null;
  readonly databasePath: string;
  readonly schemaVersion: number;
}

export class MigrationError extends Error {
  public readonly backupPath: string | null;
  public readonly migrationVersion: number | null;

  public constructor(
    message: string,
    options: {
      readonly backupPath: string | null;
      readonly cause: unknown;
      readonly migrationVersion: number | null;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'MigrationError';
    this.backupPath = options.backupPath;
    this.migrationVersion = options.migrationVersion;
  }
}

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256')
    .update(
      `${migration.version}\n${migration.name}\n${
        migration.foreignKeysDisabled === true ? 'foreign_keys_disabled\n' : ''
      }${migration.sql}`,
      'utf8',
    )
    .digest('hex');
}

function validateMigrationDefinitions(migrations: readonly Migration[]): void {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;

    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration versions must be consecutive and ordered: expected ${expectedVersion}, received ${migration.version}.`,
      );
    }

    if (migration.name.trim().length === 0 || migration.sql.trim().length === 0) {
      throw new Error(`Migration ${migration.version} must have a non-empty name and SQL body.`);
    }

    const containsTransactionBoundary =
      /(?:^|;)\s*(?:COMMIT|ROLLBACK)(?:\s|;|$)/iu.test(migration.sql) ||
      /(?:^|;)\s*BEGIN(?:\s+(?:DEFERRED|EXCLUSIVE|IMMEDIATE|TRANSACTION))?\s*(?:;|$)/iu.test(
        migration.sql,
      );
    if (containsTransactionBoundary) {
      throw new Error(
        `Migration ${migration.version} contains transaction control; the migration runner owns the transaction.`,
      );
    }
  }

  if (new Set(migrations.map((migration) => migration.name)).size !== migrations.length) {
    throw new Error('Migration names must be unique.');
  }
}

function schemaMigrationsTableExists(database: DatabaseSync): boolean {
  const row = database
    .prepare(
      `SELECT 1 AS present
       FROM sqlite_schema
       WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get() as { readonly present: number } | undefined;

  return row?.present === 1;
}

function loadAppliedMigrations(database: DatabaseSync): readonly AppliedMigrationRow[] {
  if (!schemaMigrationsTableExists(database)) {
    return [];
  }

  return database
    .prepare(
      `SELECT version, name, checksum
       FROM schema_migrations
       ORDER BY version ASC`,
    )
    .all() as unknown as readonly AppliedMigrationRow[];
}

function validateAppliedMigrations(
  appliedMigrations: readonly AppliedMigrationRow[],
  migrations: readonly Migration[],
): void {
  for (const [index, applied] of appliedMigrations.entries()) {
    const expected = migrations[index];

    if (expected === undefined) {
      throw new Error(
        `Database has unknown migration version ${applied.version}; this build only knows through version ${migrations.length}.`,
      );
    }

    if (
      applied.version !== expected.version ||
      applied.name !== expected.name ||
      applied.checksum !== migrationChecksum(expected)
    ) {
      throw new Error(
        `Migration history mismatch at version ${applied.version}; applied migrations are immutable.`,
      );
    }
  }
}

function backupFileName(databasePath: string, now: Date, counter: number): string {
  const extension = extname(databasePath);
  const stem = basename(databasePath, extension);
  const timestamp = now.toISOString().replaceAll(':', '-');
  const suffix = counter === 0 ? '' : `.${counter}`;
  return `${stem}.before-migration.${timestamp}${suffix}${extension || '.sqlite'}.bak`;
}

async function createPreMigrationBackup(
  database: DatabaseSync,
  databasePath: string,
  requestedBackupDirectory: string | undefined,
  now: Date,
): Promise<string> {
  if (
    requestedBackupDirectory !== undefined &&
    (requestedBackupDirectory.trim().length === 0 || !isAbsolute(requestedBackupDirectory))
  ) {
    throw new TypeError('backupDirectory must be an absolute non-empty path.');
  }
  const backupDirectory =
    requestedBackupDirectory === undefined
      ? join(dirname(databasePath), 'backups')
      : resolve(requestedBackupDirectory);
  mkdirSync(backupDirectory, { recursive: true });

  let counter = 0;
  let backupPath: string;

  while (true) {
    backupPath = join(backupDirectory, backupFileName(databasePath, now, counter));

    try {
      closeSync(openSync(backupPath, 'wx'));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      counter += 1;
    }
  }

  try {
    await backup(database, backupPath);
    return backupPath;
  } catch (error) {
    unlinkSync(backupPath);
    throw error;
  }
}

function assertDatabaseIntegrity(database: DatabaseSync): void {
  const integrityRows = database.prepare('PRAGMA quick_check').all() as unknown as readonly {
    readonly quick_check: string;
  }[];
  const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();

  if (integrityRows.length !== 1 || integrityRows[0]?.quick_check !== 'ok') {
    throw new Error(`SQLite quick_check failed: ${JSON.stringify(integrityRows)}`);
  }

  if (foreignKeyRows.length > 0) {
    throw new Error(`SQLite foreign_key_check failed: ${JSON.stringify(foreignKeyRows)}`);
  }
}

export async function initializeDatabase(
  options: InitializeDatabaseOptions,
): Promise<MigrationResult> {
  const databasePath = resolveDatabasePath(options.databasePath);
  const migrations = options.migrations ?? MIGRATIONS;
  const now = options.now ?? (() => new Date());

  if (databasePath === ':memory:') {
    throw new TypeError('initializeDatabase requires a persistent filesystem path.');
  }

  validateMigrationDefinitions(migrations);
  mkdirSync(dirname(databasePath), { recursive: true });

  const databaseAlreadyExisted = existsSync(databasePath);
  let appliedMigrations: readonly AppliedMigrationRow[] = [];
  let backupPath: string | null = null;

  if (databaseAlreadyExisted) {
    const readOnlyDatabase = new DatabaseSync(databasePath, {
      allowExtension: false,
      readOnly: true,
      timeout: 5_000,
    });

    try {
      appliedMigrations = loadAppliedMigrations(readOnlyDatabase);
      validateAppliedMigrations(appliedMigrations, migrations);

      if (appliedMigrations.length < migrations.length) {
        try {
          backupPath = await createPreMigrationBackup(
            readOnlyDatabase,
            databasePath,
            options.backupDirectory,
            now(),
          );
        } catch (error) {
          throw new MigrationError(
            'SQLite pre-migration backup failed; the source database was not migrated.',
            {
              backupPath: null,
              cause: error,
              migrationVersion: migrations[appliedMigrations.length]?.version ?? null,
            },
          );
        }
      }
    } finally {
      readOnlyDatabase.close();
    }
  }

  validateAppliedMigrations(appliedMigrations, migrations);
  const pendingMigrations = migrations.slice(appliedMigrations.length);

  if (pendingMigrations.length === 0) {
    const database = connectDatabase(databasePath);
    try {
      assertDatabaseIntegrity(database);
    } finally {
      database.close();
    }

    return {
      appliedVersions: [],
      backupPath,
      databasePath,
      schemaVersion: appliedMigrations.at(-1)?.version ?? 0,
    };
  }

  const database = connectDatabase(databasePath);
  let failingMigrationVersion: number | null = null;
  const foreignKeysDisabled = pendingMigrations.some(
    (migration) => migration.foreignKeysDisabled === true,
  );

  try {
    if (foreignKeysDisabled) {
      database.exec('PRAGMA foreign_keys = OFF;');
    }
    runInTransaction(database, () => {
      database.exec(SCHEMA_MIGRATIONS_SQL);
      const recordMigration = database.prepare(
        `INSERT INTO schema_migrations(version, name, checksum, applied_at)
         VALUES (?, ?, ?, ?)`,
      );

      for (const migration of pendingMigrations) {
        failingMigrationVersion = migration.version;
        database.exec(migration.sql);
        recordMigration.run(
          migration.version,
          migration.name,
          migrationChecksum(migration),
          now().toISOString(),
        );
      }

      assertDatabaseIntegrity(database);
    });
    if (foreignKeysDisabled) {
      database.exec('PRAGMA foreign_keys = ON;');
      const row = database.prepare('PRAGMA foreign_keys').get() as
        { readonly foreign_keys: number } | undefined;
      if (row?.foreign_keys !== 1) {
        throw new Error('SQLite foreign keys could not be re-enabled after migration.');
      }
    }
  } catch (error) {
    if (foreignKeysDisabled) {
      try {
        database.exec('PRAGMA foreign_keys = ON;');
      } catch {
        // The migration failure remains primary; closing the connection is the safe fallback.
      }
    }
    throw new MigrationError(
      `SQLite migration ${failingMigrationVersion ?? 'setup'} failed; all pending changes were rolled back.${backupPath === null ? '' : ` Pre-migration backup: ${backupPath}`}`,
      {
        backupPath,
        cause: error,
        migrationVersion: failingMigrationVersion,
      },
    );
  } finally {
    database.close();
  }

  return {
    appliedVersions: pendingMigrations.map((migration) => migration.version),
    backupPath,
    databasePath,
    schemaVersion: pendingMigrations.at(-1)?.version ?? appliedMigrations.at(-1)?.version ?? 0,
  };
}
