import type { DatabaseSync } from 'node:sqlite';

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

const coordinatedTransactions = new WeakSet<DatabaseSync>();

export function runInTransaction<T>(database: DatabaseSync, action: () => T): T {
  if (database.isTransaction) {
    if (coordinatedTransactions.has(database)) return action();
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

export function runInCoordinatedTransaction<T>(database: DatabaseSync, action: () => T): T {
  if (database.isTransaction || coordinatedTransactions.has(database)) {
    throw new Error('A coordinated transaction must own the outer transaction.');
  }
  coordinatedTransactions.add(database);
  try {
    return runInTransaction(database, action);
  } finally {
    coordinatedTransactions.delete(database);
  }
}
