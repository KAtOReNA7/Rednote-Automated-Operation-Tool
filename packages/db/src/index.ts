export { connectDatabase, resolveDatabasePath } from './connection.js';
export { MigrationError, initializeDatabase, migrationChecksum } from './migration-runner.js';
export { MIGRATIONS } from './migrations.js';
export { runInTransaction } from './transaction.js';

export type { InitializeDatabaseOptions, MigrationResult } from './migration-runner.js';
export type { Migration } from './migrations.js';
