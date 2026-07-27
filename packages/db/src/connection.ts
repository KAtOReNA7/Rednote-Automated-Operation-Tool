import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BUSY_TIMEOUT_MILLISECONDS = 5_000;

export function resolveDatabasePath(databasePath: string): string {
  if (databasePath.trim().length === 0) {
    throw new TypeError('databasePath must not be empty.');
  }

  return databasePath === ':memory:' ? databasePath : resolve(databasePath);
}

export function connectDatabase(databasePath: string): DatabaseSync {
  const resolvedPath = resolveDatabasePath(databasePath);

  if (resolvedPath !== ':memory:') {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath, {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    timeout: BUSY_TIMEOUT_MILLISECONDS,
  });

  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLISECONDS};
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `);

    const row = database.prepare('PRAGMA foreign_keys').get() as
      { readonly foreign_keys: number } | undefined;

    if (row?.foreign_keys !== 1) {
      throw new Error('SQLite foreign key enforcement could not be enabled.');
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
