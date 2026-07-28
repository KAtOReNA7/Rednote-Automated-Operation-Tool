import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopModelAccountingRuntime } from '../apps/desktop/src/model-accounting-runtime.js';
import {
  SqliteModelAccountingRepository,
  connectDatabase,
  initializeDatabase,
} from '../packages/db/src/index.js';
import { ModelResultCacheStore, initializeProjectDataRoot } from '../packages/storage/src/index.js';
import {
  cleanTemporaryDatabases,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';
import {
  cleanTemporaryStorageDirectories,
  createTemporaryStoragePath,
} from './support/storage-test-utils.js';

afterEach(() => {
  cleanTemporaryDatabases();
  cleanTemporaryStorageDirectories();
});

describe('Issue 014 model accounting desktop runtime', () => {
  it('binds a cache-clear preview token to one sender/window and consumes it once', async () => {
    const databasePath = createTemporaryDatabasePath('accounting runtime');
    await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);
    const root = await initializeProjectDataRoot(
      join(await createTemporaryStoragePath('accounting runtime root'), 'project'),
    );
    const runtime = new DesktopModelAccountingRuntime(
      new SqliteModelAccountingRepository(database),
      new ModelResultCacheStore(root),
      () => new Date('2026-07-28T00:00:00.000Z'),
    );

    const wrongWindow = runtime.previewCacheClear(10, 20);
    expect(() =>
      runtime.confirmCacheClear(
        {
          confirmation: 'CLEAR_MODEL_RESULT_CACHE',
          expectedBytes: wrongWindow.bytes,
          expectedCount: wrongWindow.count,
          previewToken: wrongWindow.previewToken,
        },
        10,
        21,
      ),
    ).toThrowError('MODEL_CACHE_CLEAR_INVALID');

    const preview = runtime.previewCacheClear(10, 20);
    const input = {
      confirmation: 'CLEAR_MODEL_RESULT_CACHE' as const,
      expectedBytes: preview.bytes,
      expectedCount: preview.count,
      previewToken: preview.previewToken,
    };
    expect(runtime.confirmCacheClear(input, 10, 20)).toEqual({
      deletedFiles: 0,
      orphanFiles: 0,
      tombstonedEntries: 0,
    });
    expect(() => runtime.confirmCacheClear(input, 10, 20)).toThrowError(
      'MODEL_CACHE_CLEAR_INVALID',
    );
    database.close();
  });
});
