import { backup, DatabaseSync } from 'node:sqlite';

export interface SqliteRuntimeCapabilities {
  readonly backup: true;
  readonly databaseSync: true;
  readonly nodeSqlite: true;
  readonly timeoutOption: true;
}

export function assertSqliteRuntimeCapabilities(): SqliteRuntimeCapabilities {
  if (typeof DatabaseSync !== 'function') {
    throw new Error('The current runtime cannot load node:sqlite DatabaseSync.');
  }

  if (typeof backup !== 'function') {
    throw new Error('The current runtime does not expose node:sqlite backup.');
  }

  const database = new DatabaseSync(':memory:', {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    timeout: 1,
  });

  try {
    const row = database.prepare('SELECT 1 AS available').get() as
      { readonly available: number } | undefined;

    if (row?.available !== 1) {
      throw new Error('node:sqlite DatabaseSync did not execute a capability probe.');
    }
  } finally {
    database.close();
  }

  return {
    backup: true,
    databaseSync: true,
    nodeSqlite: true,
    timeoutOption: true,
  };
}
