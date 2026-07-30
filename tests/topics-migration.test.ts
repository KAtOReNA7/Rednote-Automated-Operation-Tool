import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  SqliteAuthenticityRepository,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';
import { insertTopicReadyWork } from './support/topic-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 022 Topic Pool migration', () => {
  it('appends only v15 after the frozen v1-v14 history', () => {
    expect(MIGRATIONS.slice(0, 15).map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(MIGRATIONS.slice(0, 14).map(({ name }) => name)).toEqual([
      'initial_prd_schema',
      'persistent_local_job_queue',
      'managed_local_file_paths',
      'local_settings_and_credential_reference',
      'local_loopback_api_and_plugin_clients',
      'provider_capability_probing',
      'model_execution_cache_and_cost_ledger',
      'search_provider_runs_and_rate_limits',
      'controlled_public_page_fetch',
      'browser_clipper_samples',
      'bibliographic_catalog_and_entity_resolution',
      'source_evidence_atomic_facts_and_conflicts',
      'versioned_research_dossiers',
      'reading_authenticity_policy',
    ]);
    expect(MIGRATIONS[14]).toMatchObject({
      name: 'topic_pool_and_first_30_quota',
      version: 15,
    });
    expect(MIGRATIONS.slice(0, 14).map(migrationChecksum)).toHaveLength(14);
  });

  it('upgrades the existing topics identity and preserves M2 catalog, evidence, dossier, and authenticity data', async () => {
    const databasePath = createTemporaryDatabasePath('topic upgrade 中文 空格');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 14) });
    let database = connectDatabase(databasePath);
    const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
    insertTopicReadyWork(database, authenticity, { workId: 'upgrade-work' });
    database
      .prepare(
        `INSERT INTO topics(
           id, book_id, topic_type, angle, core_judgment, audience,
           spoiler_level, status
         ) VALUES (
           'legacy-topic-issue022', 'upgrade-work', 'LEGACY',
           '旧选题角度', '旧候选判断', '合成受众', 'LIGHT', 'IDEA'
         )`,
      )
      .run();
    const before = Object.fromEntries(
      [
        'books',
        'claims',
        'claim_evidence',
        'research_dossiers',
        'research_dossier_versions',
        'reading_states',
        'expression_permission_snapshots',
      ].map((table) => [
        table,
        (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
          .count,
      ]),
    );
    database.close();

    const result = await initializeDatabase({
      databasePath,
      migrations: MIGRATIONS.slice(0, 15),
    });
    expect(result).toMatchObject({ appliedVersions: [15], schemaVersion: 15 });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      for (const [table, count] of Object.entries(before)) {
        expect(
          (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
            .count,
          table,
        ).toBe(count);
      }
      expect(
        database
          .prepare(
            `SELECT topic_contract_version, candidate_state, current_version_number
             FROM topics WHERE id = 'legacy-topic-issue022'`,
          )
          .get(),
      ).toEqual({
        candidate_state: 'HELD',
        current_version_number: 1,
        topic_contract_version: 'legacy-topic-v0',
      });
      expect(
        database
          .prepare(
            `SELECT schema_version, content_type, topic_angle
             FROM topic_candidate_versions
             WHERE topic_id = 'legacy-topic-issue022'`,
          )
          .get(),
      ).toEqual({
        content_type: 'LEGACY_UNCLASSIFIED',
        schema_version: 'legacy-topic-v0',
        topic_angle: '旧选题角度',
      });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('creates strict append-only Topic and quota tables with the frozen 10/8/6/3/3 profile', async () => {
    const { database } = await createInitializedDatabase('topic strict schema');
    try {
      const tableNames = [
        'topic_candidate_versions',
        'topic_subject_memberships',
        'topic_ranking_components',
        'topic_dependencies',
        'topic_state_transitions',
        'topic_generation_plans',
        'topic_generation_runs',
        'topic_quota_profiles',
        'topic_quota_requirements',
        'topic_quota_plan_versions',
        'topic_quota_plan_members',
        'topic_quota_plan_runs',
        'topic_candidate_invalidations',
        'topic_audit_events',
      ];
      const strictTables = database
        .prepare(
          `SELECT name, strict FROM pragma_table_list
           WHERE name IN (${tableNames.map(() => '?').join(',')})`,
        )
        .all(...tableNames) as unknown as readonly {
        readonly name: string;
        readonly strict: number;
      }[];
      expect(strictTables).toHaveLength(tableNames.length);
      expect(strictTables.every(({ strict }) => strict === 1)).toBe(true);
      expect(
        database
          .prepare(
            `SELECT content_type, required_count
             FROM topic_quota_requirements
             WHERE quota_profile_id = 'FIRST_30_V1'
             ORDER BY position`,
          )
          .all(),
      ).toEqual([
        { content_type: 'NON_SPOILER_SINGLE_BOOK_VERDICT', required_count: 10 },
        { content_type: 'FULL_TRICK_LOGIC_ANALYSIS', required_count: 8 },
        { content_type: 'CROSS_WORK_COMPARISON', required_count: 6 },
        { content_type: 'WEB_VS_PUBLISHED_MYSTERY', required_count: 3 },
        { content_type: 'MYSTERY_AND_CULTURAL_PHENOMENON', required_count: 3 },
      ]);
      expect(() =>
        database
          .prepare(
            `UPDATE topic_quota_requirements
             SET required_count = 11
             WHERE quota_profile_id = 'FIRST_30_V1'
               AND content_type = 'NON_SPOILER_SINGLE_BOOK_VERDICT'`,
          )
          .run(),
      ).toThrow(/immutable/iu);
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('rolls back all v15 writes when the final migration statement fails', async () => {
    const databasePath = createTemporaryDatabasePath('topic rollback');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 14) });
    let database = connectDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO topics(
           id, topic_type, angle, core_judgment, audience, spoiler_level, status
         ) VALUES (
           'legacy-topic-rollback', 'LEGACY', '回滚角度',
           '回滚判断', '合成受众', 'NONE', 'IDEA'
         )`,
      )
      .run();
    database.close();

    const v15 = MIGRATIONS[14];
    if (v15 === undefined) throw new Error('missing v15 migration');
    await expect(
      initializeDatabase({
        databasePath,
        migrations: [
          ...MIGRATIONS.slice(0, 14),
          {
            ...v15,
            sql: `${v15.sql}\nINSERT INTO issue022_missing_table(id) VALUES (1);`,
          },
        ],
      }),
    ).rejects.toThrow();

    database = connectDatabase(databasePath);
    try {
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({ version: 14 });
      expect(
        database
          .prepare(
            `SELECT topic_type, angle
             FROM topics WHERE id = 'legacy-topic-rollback'`,
          )
          .get(),
      ).toEqual({ angle: '回滚角度', topic_type: 'LEGACY' });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_master
             WHERE type = 'table' AND name = 'topic_candidate_versions'`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
