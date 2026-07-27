import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { connectDatabase, initializeDatabase } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('Windows filesystem persistence', () => {
  it('persists data after close and reopen at a Chinese path containing spaces', async () => {
    expect(process.platform).toBe('win32');
    const databasePath = createTemporaryDatabasePath(
      join('中文 数据库 目录', '第二层 带空格', '第三层'),
    );
    expect(databasePath).toMatch(/^[A-Z]:\\/iu);
    expect(databasePath).toContain('\\');
    expect(databasePath).toContain('中文 数据库 目录');
    expect(databasePath).toContain('第二层 带空格');

    await initializeDatabase({ databasePath });
    const firstConnection = connectDatabase(databasePath);
    firstConnection
      .prepare(
        `INSERT INTO account_profiles(id, working_name, bio)
         VALUES ('profile-windows', 'KAtOReNA7', '关闭后仍需保留')`,
      )
      .run();
    firstConnection.close();

    const reopenedConnection = connectDatabase(databasePath);
    try {
      expect(
        reopenedConnection
          .prepare(
            `SELECT working_name, bio
             FROM account_profiles
             WHERE id = 'profile-windows'`,
          )
          .get(),
      ).toEqual({
        bio: '关闭后仍需保留',
        working_name: 'KAtOReNA7',
      });
    } finally {
      reopenedConnection.close();
    }
  });
});
