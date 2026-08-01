import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 019 migration v12', () => {
  it('appends one migration while preserving every v1-v11 identity', () => {
    expect(MIGRATIONS.slice(0, 13).map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(MIGRATIONS[11]).toMatchObject({
      foreignKeysDisabled: true,
      name: 'source_evidence_atomic_facts_and_conflicts',
      version: 12,
    });
    const historical = MIGRATIONS.slice(0, 11).map(migrationChecksum);
    expect(historical).toHaveLength(11);
    expect(historical.every((hash) => /^[a-f0-9]{64}$/u.test(hash))).toBe(true);
    expect(historical.slice(0, 6)).toEqual([
      '8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907',
      'ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce',
      '11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed',
      'c84c82c50f2170c20154c754d0604319082c6683737624a9c14d3a508315471c',
      '88c29c6160122eea91dc8f3b88c0cd0aafc58f91c3cfd6bcfdd2020209f6d808',
      'c3e2f5d21dbe9b86ba3cb6dc7967cb158228bd9112c6d322aac27e27392537f5',
    ]);
    expect(historical[7]).toBe('74a0da30be52302edf3c1d2f8574250514c2914fc9f64265f46b689c7075d78c');
    expect(historical[8]).toBe('7bea82d3317a4db13b929f288b0cb0f0f399d2c8fd5da78522827df33209a4de');
    expect(historical[10]).toBe('ad0e67dab752e41e1903df13b88665c99194fb527d5f5efb01c96b4d855c3750');
  });

  it('upgrades v11 with backup while preserving compatible Source, Claim, Evidence, Work, and IDs', async () => {
    const databasePath = createTemporaryDatabasePath('证据升级 中文 空格');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 11) });
    let database = connectDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO books(id, canonical_title, work_type, discovery_status)
         VALUES ('work-legacy-evidence', '旧事实作品', 'MYSTERY', 'DISCOVERED')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO sources(
           id, url, title, source_tier, source_type, retrieved_at,
           content_hash, language, user_supplied
         ) VALUES (
           'source-legacy-evidence', 'https://legacy.invalid/source', '旧来源',
           'PRIMARY', 'WEB', '2026-07-29T01:00:00.000Z',
           'legacy-hash', 'zh-CN', 1
         )`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO claims(
           id, subject_type, subject_id, predicate, value_json,
           confidence, conflict_status, created_at
         ) VALUES (
           'claim-legacy-evidence', 'BOOK', 'work-legacy-evidence',
           'legacy_title', '"旧标题"', 0.8, 'UNRESOLVED',
           '2026-07-29T01:00:00.000Z'
         )`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO claim_evidence(
           claim_id, source_id, evidence_excerpt, locator, supports_or_contradicts
         ) VALUES (
           'claim-legacy-evidence', 'source-legacy-evidence',
           '旧来源中的短摘录', 'paragraph-1', 'SUPPORTS'
         )`,
      )
      .run();
    database.close();

    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({
      appliedVersions: MIGRATIONS.slice(11).map(({ version }) => version),
      schemaVersion: MIGRATIONS.length,
    });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT id, contract_version, subject_type, subject_id
             FROM claims WHERE id = 'claim-legacy-evidence'`,
          )
          .get(),
      ).toEqual({
        contract_version: 'legacy-claim-v1',
        id: 'claim-legacy-evidence',
        subject_id: 'work-legacy-evidence',
        subject_type: 'WORK',
      });
      expect(
        database
          .prepare(
            `SELECT source_id, revision, origin_kind
             FROM source_revisions WHERE source_id = 'source-legacy-evidence'`,
          )
          .get(),
      ).toEqual({
        origin_kind: 'LEGACY_SOURCE',
        revision: 1,
        source_id: 'source-legacy-evidence',
      });
      expect(
        database
          .prepare(
            `SELECT claim_id, locator_kind, locator_validated
             FROM claim_evidence WHERE claim_id = 'claim-legacy-evidence'`,
          )
          .get(),
      ).toEqual({
        claim_id: 'claim-legacy-evidence',
        locator_kind: 'LEGACY_UNLOCATED',
        locator_validated: 0,
      });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('fails closed and rolls back when a legacy polymorphic subject cannot be proven', async () => {
    const databasePath = createTemporaryDatabasePath('证据迁移回滚');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 11) });
    let database = connectDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO claims(
           id, subject_type, subject_id, predicate, value_json,
           confidence, conflict_status, created_at
         ) VALUES (
           'claim-incompatible', 'UNKNOWN_ENTITY', 'missing-entity',
           'unknown_predicate', '"value"', 0.5, 'UNKNOWN',
           '2026-07-29T01:00:00.000Z'
         )`,
      )
      .run();
    database.close();

    await expect(initializeDatabase({ databasePath })).rejects.toThrow();
    database = connectDatabase(databasePath);
    try {
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({ version: 11 });
      expect(
        database
          .prepare("SELECT count(*) AS count FROM claims WHERE id = 'claim-incompatible'")
          .get(),
      ).toEqual({ count: 1 });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM sqlite_schema WHERE type = 'table' AND name = 'source_revisions'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('creates STRICT tables, append-only guards, foreign keys, and a clean database', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const tables = database
        .prepare(
          `SELECT name, strict
           FROM pragma_table_list
           WHERE name IN (
             'source_revisions', 'source_classifications', 'source_lineage',
             'fact_subjects', 'predicate_registry', 'claims', 'claim_evidence',
             'fact_conflicts', 'fact_conflict_decisions', 'fact_evaluations',
             'fact_audit_events', 'source_processing_plans', 'source_processing_runs'
           )
           ORDER BY name`,
        )
        .all() as unknown as readonly { readonly name: string; readonly strict: number }[];
      expect(tables).toHaveLength(13);
      expect(tables.every((table) => table.strict === 1)).toBe(true);
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(() =>
        database
          .prepare(
            `INSERT INTO fact_subjects(subject_type, subject_id)
             VALUES ('WORK', 'missing-work')`,
          )
          .run(),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});

describe('authorized user-local source migration v20', () => {
  it('preserves v19 revisions and adds only the truthful USER_LOCAL_INPUT origin', async () => {
    expect(MIGRATIONS[19]).toMatchObject({
      foreignKeysDisabled: true,
      name: 'authorized_user_local_source_origin',
      version: 20,
    });
    const databasePath = createTemporaryDatabasePath('真实本地来源升级');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 19) });
    let database = connectDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO sources(id, url, title, source_tier, source_type, retrieved_at,
           content_hash, language, user_supplied)
         VALUES ('source-before-v20', 'https://legacy.invalid/item', '迁移前来源',
           'UNKNOWN', 'LEGACY_SOURCE', '2026-08-01T01:00:00.000Z',
           'legacy-content', 'zh-CN', 1)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO source_revisions(
           source_id, revision, contract_version, origin_kind, origin_record_id,
           origin_revision, content_hash, language, availability, retrieved_at,
           published_at_precision, warnings_json, provenance_json, synthetic,
           created_at, updated_at)
         VALUES ('source-before-v20', 1, 'legacy-source-v1', 'LEGACY_SOURCE',
           'source-before-v20', 1, 'legacy-content', 'zh-CN', 'AVAILABLE',
           '2026-08-01T01:00:00.000Z', 'UNKNOWN', '[]', '{}', 0,
           '2026-08-01T01:00:00.000Z', '2026-08-01T01:00:00.000Z')`,
      )
      .run();
    database.close();

    const migrated = await initializeDatabase({ databasePath });
    expect(migrated.appliedVersions).toEqual([20]);
    expect(migrated.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT source_id, revision, origin_kind, content_hash
             FROM source_revisions WHERE source_id = 'source-before-v20'`,
          )
          .get(),
      ).toEqual({
        content_hash: 'legacy-content',
        origin_kind: 'LEGACY_SOURCE',
        revision: 1,
        source_id: 'source-before-v20',
      });
      database
        .prepare(
          `INSERT INTO sources(id, url, title, source_tier, source_type, retrieved_at,
             content_hash, language, user_supplied)
           VALUES ('source-user-local', 'https://user-local-input.invalid/item',
             '真实本地来源', 'UNKNOWN', 'USER_LOCAL_NOTE',
             '2026-08-01T02:00:00.000Z', ?, 'zh-CN', 1)`,
        )
        .run('a'.repeat(64));
      database
        .prepare(
          `INSERT INTO source_revisions(
             source_id, revision, contract_version, origin_kind, origin_record_id,
             origin_revision, content_hash, canonical_url_hash, display_host,
             extracted_text_hash, extracted_text_path, language, availability,
             retrieved_at, published_at_precision, warnings_json, provenance_json,
             synthetic, created_at, updated_at)
           VALUES ('source-user-local', 1, 'source-evidence-v1', 'USER_LOCAL_INPUT',
             'user-local-record', 1, ?, ?, 'user-local-input.invalid', ?,
             'sources/snapshots/aa/local.txt', 'zh-CN', 'AVAILABLE',
             '2026-08-01T02:00:00.000Z', 'UNKNOWN', '[]', '{}', 0,
             '2026-08-01T02:00:00.000Z', '2026-08-01T02:00:00.000Z')`,
        )
        .run('a'.repeat(64), 'b'.repeat(64), 'a'.repeat(64));
      expect(() =>
        database
          .prepare(
            `UPDATE source_revisions SET language = 'en-US'
             WHERE source_id = 'source-user-local' AND revision = 1`,
          )
          .run(),
      ).toThrow(/append-only/u);
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
