import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import type { Migration } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

const HISTORICAL_HASHES = [
  '8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907',
  'ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce',
  '11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed',
] as const;

afterEach(cleanTemporaryDatabases);

describe('Issue 010 migration v4', () => {
  it('keeps v1-v3 immutable and appends one stable consecutive migration', () => {
    expect(MIGRATIONS.slice(0, 3).map(migrationChecksum)).toEqual(HISTORICAL_HASHES);
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(MIGRATIONS[3]).toMatchObject({
      name: 'local_settings_and_credential_reference',
      version: 4,
    });
    expect(Object.isFrozen(MIGRATIONS[3])).toBe(true);
  });

  it('creates a STRICT singleton with safe defaults and no secret-bearing columns', async () => {
    const path = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath: path });
    const database = connectDatabase(path);
    try {
      expect(
        database.prepare("SELECT strict FROM pragma_table_list WHERE name='app_settings'").get(),
      ).toEqual({ strict: 1 });
      expect(database.prepare("SELECT * FROM app_settings WHERE id='app'").get()).toMatchObject({
        credential_reference: null,
        monthly_hard_limit_cents: 10_000,
        monthly_warning_cents: 8_000,
        provider_protocol: 'OPENAI_COMPATIBLE',
        revision: 0,
        setup_state: 'LOCAL_PROJECT_READY',
      });
      const columns = database
        .prepare('PRAGMA table_info(app_settings)')
        .all()
        .map((row) => (row as { readonly name: string }).name);
      expect(columns).not.toEqual(
        expect.arrayContaining([
          'active_data_root',
          'api_key_value',
          'ciphertext',
          'password_value',
          'secret',
        ]),
      );
      expect(() => database.prepare("INSERT INTO app_settings(id) VALUES ('other')").run()).toThrow(
        /CHECK|UNIQUE/iu,
      );
      expect(() => database.prepare("DELETE FROM app_settings WHERE id='app'").run()).toThrow(
        /singleton/iu,
      );
      expect(() =>
        database
          .prepare(
            `UPDATE account_profiles
             SET tone_config_json = '{}', content_scope_json = '{}'
             WHERE id = 'primary'`,
          )
          .run(),
      ).toThrow(/primary account profile shape invalid/iu);
      expect(() =>
        database
          .prepare(
            `UPDATE account_profiles
             SET content_scope_json = ?
             WHERE id = 'primary'`,
          )
          .run(
            JSON.stringify({
              excluded: ['错误一', '错误二', '错误三', '错误四', '错误五'],
              focus: '推理小说',
              schemaVersion: 1,
            }),
          ),
      ).toThrow(/primary account profile shape invalid/iu);
    } finally {
      database.close();
    }
  });

  it('enforces credential reference, URL, models, cents, setup state, and monotonic revision', async () => {
    const path = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath: path });
    const database = connectDatabase(path);
    try {
      const invalidAssignments = [
        ["credential_reference='arbitrary'", 'credential_reference'],
        ["provider_base_url='https://user:pass@example.test/v1'", 'provider_base_url'],
        ["provider_base_url='https://example.test/v1?query=1'", 'provider_base_url'],
        ["provider_base_url='https://example.test/v1#fragment'", 'provider_base_url'],
        [`research_model_id='${'x'.repeat(201)}'`, 'research_model_id'],
        ['monthly_warning_cents=10000', 'monthly_warning_cents'],
        ['monthly_hard_limit_cents=10001', 'monthly_hard_limit_cents'],
        ["setup_state='PROVIDER_VERIFIED'", 'setup_state'],
      ] as const;
      for (const [assignment, label] of invalidAssignments) {
        expect(
          () =>
            database
              .prepare(`UPDATE app_settings SET ${assignment}, revision=revision+1 WHERE id='app'`)
              .run(),
          label,
        ).toThrow(/CHECK constraint failed/iu);
      }
      expect(() =>
        database.prepare("UPDATE app_settings SET revision=revision+2 WHERE id='app'").run(),
      ).toThrow(/increase by one/iu);
      database
        .prepare(
          `UPDATE app_settings
           SET provider_base_url='https://example.test/v1',
               credential_reference='CONTENT_AI_API_KEY',
               revision=revision+1
           WHERE id='app'`,
        )
        .run();
      expect(database.prepare("SELECT revision FROM app_settings WHERE id='app'").get()).toEqual({
        revision: 1,
      });
    } finally {
      database.close();
    }
  });

  it('is idempotent after v4 is recorded', async () => {
    const path = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath: path });
    await expect(initializeDatabase({ databasePath: path })).resolves.toMatchObject({
      appliedVersions: [],
      backupPath: null,
      schemaVersion: 7,
    });
  });

  it('upgrades v3 with a controlled backup and preserves existing rows', async () => {
    const path = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath: path, migrations: MIGRATIONS.slice(0, 3) });
    const before = connectDatabase(path);
    before
      .prepare("INSERT INTO account_profiles(id, working_name) VALUES ('existing', '保留账号')")
      .run();
    before
      .prepare(
        `INSERT INTO account_profiles(
           id, working_name, bio, occupation_disclosure,
           tone_config_json, content_scope_json
         ) VALUES ('primary', '保留主账号', '保留简介', 'HIDDEN', '{}', '{}')`,
      )
      .run();
    before.close();

    const result = await initializeDatabase({ databasePath: path });
    expect(result.appliedVersions).toEqual([4, 5, 6, 7]);
    expect(existsSync(result.backupPath ?? '')).toBe(true);
    const upgraded = connectDatabase(path);
    try {
      expect(
        upgraded.prepare("SELECT working_name FROM account_profiles WHERE id='existing'").get(),
      ).toEqual({ working_name: '保留账号' });
      expect(
        upgraded
          .prepare(
            `SELECT working_name, bio, occupation_disclosure, ownership,
                    tone_config_json, content_scope_json
             FROM account_profiles WHERE id='primary'`,
          )
          .get(),
      ).toEqual({
        bio: '保留简介',
        content_scope_json:
          '{"schemaVersion":1,"focus":"推理小说","excluded":["偶像","音乐","演唱会","泛娱乐","粉圈"]}',
        occupation_disclosure: 'DEFERRED',
        ownership: 'PERSONAL',
        tone_config_json:
          '{"schemaVersion":1,"voice":"观点鲜明","sentenceStyle":"短句直接","humor":"少量冷幽默"}',
        working_name: '保留主账号',
      });
      expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      upgraded.close();
    }
    const backup = new DatabaseSync(result.backupPath ?? '', { readOnly: true });
    try {
      expect(backup.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual(
        {
          version: 3,
        },
      );
    } finally {
      backup.close();
    }
  });

  it('rolls back v4 when the following migration fails', async () => {
    const path = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath: path, migrations: MIGRATIONS.slice(0, 3) });
    const failing: Migration = {
      name: 'issue010_failure_probe',
      sql: 'CREATE TABLE issue010_probe(id TEXT) STRICT; SELECT * FROM missing_issue010;',
      version: 8,
    };
    await expect(
      initializeDatabase({ databasePath: path, migrations: [...MIGRATIONS, failing] }),
    ).rejects.toMatchObject({ migrationVersion: 8 });
    const database = connectDatabase(path);
    try {
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({
        version: 3,
      });
      expect(
        database
          .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='app_settings'")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_schema
             WHERE name IN ('local_api_settings', 'local_api_clients')`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});
