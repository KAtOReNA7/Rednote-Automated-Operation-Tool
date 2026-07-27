import { rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { tmpdir } from 'node:os';

import {
  assertSqliteRuntimeCapabilities,
  connectDatabase,
  initializeDatabase,
  JobQueueRepository,
  MIGRATIONS,
} from '@mystery-operations/db';
import { JobHandlerRegistry, JobQueueService } from '@mystery-operations/workflows';
import type { FoundationHealth } from '@mystery-operations/shared';

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

export async function runFoundationHealthCheck(): Promise<FoundationHealth> {
  const directory = await mkdtemp(join(tmpdir(), '红笺 基础自检-'));
  const databasePath = join(directory, '临时 队列.sqlite');
  const backupPath = join(directory, '临时 备份.sqlite');
  let database: ReturnType<typeof connectDatabase> | undefined;
  let health: FoundationHealth | undefined;

  try {
    const capabilities = assertSqliteRuntimeCapabilities();
    const migration = await initializeDatabase({
      databasePath,
      now: () => FIXED_NOW,
    });

    database = connectDatabase(databasePath);
    const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as
      { readonly foreign_keys: number } | undefined;
    const journalMode = database.prepare('PRAGMA journal_mode').get() as
      { readonly journal_mode: string } | undefined;

    await backup(database, backupPath);

    const registry = new JobHandlerRegistry();
    registry.register('foundation.smoke', async () => ({ checked: true }));

    let identifier = 0;
    const service = new JobQueueService(new JobQueueRepository(database), registry, {
      clock: {
        now: () => FIXED_NOW,
      },
      idFactory: () => `foundation-${++identifier}`,
      leaseDurationMilliseconds: 30_000,
    });
    const queued = service.enqueueJob({
      idempotencyKey: 'foundation-health-check',
      jobType: 'foundation.smoke',
      maxAttempts: 1,
      payload: { scope: 'temporary' },
      priority: 0,
    });
    const claimed = service.claimNextJob('foundation-worker');

    if (claimed === null || claimed.id !== queued.id || claimed.leaseToken === null) {
      throw new Error('Temporary queue lifecycle could not claim its smoke job.');
    }

    const completed = service.completeJob(claimed.id, 'foundation-worker', claimed.leaseToken, {
      checked: true,
    });
    database.close();
    database = undefined;

    const reopened = connectDatabase(databasePath);
    const stored = reopened.prepare('SELECT status FROM jobs WHERE id = ?').get(completed.id) as
      { readonly status: string } | undefined;
    reopened.close();

    if (
      !capabilities.backup ||
      !capabilities.databaseSync ||
      !capabilities.nodeSqlite ||
      !capabilities.timeoutOption ||
      migration.schemaVersion !== MIGRATIONS.length ||
      foreignKeys?.foreign_keys !== 1 ||
      journalMode?.journal_mode.toLowerCase() !== 'wal' ||
      completed.status !== 'SUCCEEDED' ||
      stored?.status !== 'SUCCEEDED'
    ) {
      throw new Error('Temporary foundation verification returned an unexpected result.');
    }

    health = {
      checks: {
        backup: true,
        cleanup: true,
        foreignKeys: true,
        migrations: true,
        nodeSqlite: true,
        queueLifecycle: true,
        reopen: true,
        wal: true,
      },
      schemaVersion: migration.schemaVersion,
      status: 'ready',
    };
  } finally {
    database?.close();
    await rm(directory, { force: true, recursive: true });
  }

  if (health === undefined) {
    throw new Error('Temporary foundation verification did not finish.');
  }

  return health;
}
