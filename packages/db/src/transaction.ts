import type { DatabaseSync } from 'node:sqlite';

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

export function runInTransaction<T>(database: DatabaseSync, action: () => T): T {
  if (database.isTransaction) {
    throw new Error('Nested transactions are not supported; use the active transaction.');
  }

  database.exec('BEGIN IMMEDIATE');

  try {
    const result = action();

    if (isPromiseLike(result)) {
      throw new TypeError('Transaction actions must be synchronous.');
    }

    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.isTransaction) {
      database.exec('ROLLBACK');
    }
    throw error;
  }
}
