import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
  runInTransaction,
} from '../packages/db/src/index.js';
import {
  BUSINESS_TABLE_NAMES,
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

const EXPECTED_DATABASE_COLUMNS: Readonly<Record<(typeof BUSINESS_TABLE_NAMES)[number], string[]>> =
  {
    account_profiles: [
      'id',
      'working_name',
      'bio',
      'occupation_disclosure',
      'ownership',
      'tone_config_json',
      'content_scope_json',
      'created_at',
      'updated_at',
    ],
    app_settings: [
      'id',
      'provider_protocol',
      'provider_base_url',
      'credential_reference',
      'research_model_id',
      'writing_model_id',
      'review_model_id',
      'embedding_model_id',
      'image_model_id',
      'monthly_warning_cents',
      'monthly_hard_limit_cents',
      'setup_state',
      'revision',
      'created_at',
      'updated_at',
      'credential_binding_version',
    ],
    approvals: [
      'id',
      'draft_id',
      'approval_tier',
      'decision',
      'user_note',
      'time_spent_seconds',
      'decided_at',
    ],
    assets: [
      'id',
      'asset_type',
      'origin',
      'source_id',
      'original_path',
      'processed_path',
      'mime_type',
      'width',
      'height',
      'content_hash',
      'generation_run_id',
      'metadata_json',
    ],
    audit_events: [
      'id',
      'event_type',
      'entity_type',
      'entity_id',
      'actor',
      'before_json',
      'after_json',
      'created_at',
    ],
    authors: ['id', 'canonical_name', 'original_name', 'country_or_region', 'profile', 'source_id'],
    book_editions: [
      'id',
      'book_id',
      'isbn',
      'translated_title',
      'translator',
      'publisher',
      'publication_date',
      'edition_label',
      'cover_asset_id',
      'is_motie',
      'is_unreleased',
      'source_id',
    ],
    books: [
      'id',
      'canonical_title',
      'original_title',
      'author_id',
      'country_or_region',
      'language',
      'work_type',
      'series_name',
      'series_order',
      'synopsis',
      'discovery_status',
      'research_score',
      'topic_score',
      'created_at',
      'updated_at',
    ],
    claim_evidence: [
      'claim_id',
      'source_id',
      'evidence_excerpt',
      'locator',
      'supports_or_contradicts',
    ],
    claims: [
      'id',
      'subject_type',
      'subject_id',
      'predicate',
      'value_json',
      'confidence',
      'conflict_status',
      'created_at',
    ],
    clips: [
      'id',
      'url',
      'platform',
      'account_name',
      'page_title',
      'published_at',
      'selected_text',
      'user_note',
      'visible_metrics_json',
      'screenshot_path',
      'tags_json',
      'created_at',
    ],
    content_briefs: [
      'id',
      'topic_id',
      'experiment_id',
      'content_type',
      'target_reader',
      'core_judgment',
      'counterpoints_json',
      'spoiler_level',
      'required_claim_ids_json',
      'score_type',
      'title_variant',
      'visual_variant',
      'desired_action',
      'forbidden_phrases_json',
      'status',
    ],
    cost_ledger: [
      'id',
      'model_run_id',
      'billing_month',
      'cost_source',
      'amount_usd',
      'token_or_call_units_json',
      'created_at',
    ],
    drafts: [
      'id',
      'brief_id',
      'version',
      'title',
      'body',
      'tags_json',
      'pinned_comment',
      'generation_run_id',
      'user_edited',
      'status',
      'created_at',
    ],
    experiments: [
      'id',
      'name',
      'hypothesis',
      'primary_metric',
      'guardrail_metrics_json',
      'variable_name',
      'variants_json',
      'start_at',
      'end_at',
      'status',
    ],
    jobs: [
      'id',
      'job_type',
      'idempotency_key',
      'payload_json',
      'payload_hash',
      'priority',
      'status',
      'attempt_count',
      'max_attempts',
      'next_run_at',
      'lock_owner',
      'lease_token',
      'lease_expires_at',
      'last_heartbeat_at',
      'pause_requested_at',
      'cancel_requested_at',
      'started_at',
      'finished_at',
      'last_error_code',
      'last_error',
      'result_json',
      'created_at',
      'updated_at',
      'revision',
    ],
    metric_snapshots: [
      'id',
      'publication_id',
      'snapshot_window',
      'captured_at',
      'source_method',
      'metrics_json',
      'import_file_path',
      'ocr_confidence',
    ],
    model_runs: [
      'id',
      'role',
      'provider',
      'model',
      'prompt_version',
      'input_hash',
      'output_hash',
      'cached',
      'input_tokens',
      'output_tokens',
      'image_count',
      'estimated_cost_usd',
      'status',
      'started_at',
      'completed_at',
    ],
    post_packages: [
      'id',
      'draft_id',
      'planned_publish_at',
      'export_path',
      'manifest_json',
      'ai_disclosure',
      'exported_at',
      'status',
    ],
    publications: [
      'id',
      'post_package_id',
      'platform',
      'platform_post_url',
      'manually_published_at',
      'user_note',
    ],
    quality_checks: [
      'id',
      'draft_id',
      'check_type',
      'result',
      'severity',
      'details_json',
      'checker_version',
      'created_at',
    ],
    reading_states: [
      'id',
      'book_id',
      'state',
      'memory_note',
      'user_confirmed_at',
      'personal_score',
      'score_confirmed_at',
    ],
    research_dossiers: [
      'id',
      'book_id',
      'version',
      'research_questions_json',
      'summary',
      'consensus_json',
      'disputes_json',
      'source_coverage_score',
      'status',
      'created_at',
    ],
    sources: [
      'id',
      'url',
      'title',
      'publisher_or_site',
      'source_tier',
      'source_type',
      'retrieved_at',
      'content_hash',
      'local_snapshot_path',
      'language',
      'user_supplied',
    ],
    strategy_decisions: [
      'id',
      'period_start',
      'period_end',
      'analysis_json',
      'recommendations_json',
      'user_decision_json',
      'applied_at',
    ],
    topics: [
      'id',
      'book_id',
      'topic_type',
      'angle',
      'core_judgment',
      'audience',
      'spoiler_level',
      'trend_score',
      'fit_score',
      'evidence_score',
      'novelty_score',
      'effort_score',
      'priority_score',
      'status',
    ],
  };

describe('SQLite initialization and migrations', () => {
  it('creates a new database with all 25 PRD tables plus app_settings', async () => {
    const databasePath = createTemporaryDatabasePath('empty directory');
    const result = await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);

    try {
      const tables = database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all()
        .map((row) => (row as { readonly name: string }).name);

      expect(result).toMatchObject({
        appliedVersions: [1, 2, 3, 4, 5, 6],
        backupPath: null,
        databasePath,
        schemaVersion: 6,
      });
      expect(tables).toEqual(
        [
          ...BUSINESS_TABLE_NAMES,
          'local_api_clients',
          'local_api_settings',
          'provider_capability_entries',
          'provider_capability_probe_runs',
          'schema_migrations',
        ].sort(),
      );
    } finally {
      database.close();
    }
  });

  it('matches every PRD table to its frozen column contract', async () => {
    const { database } = await createInitializedDatabase();

    try {
      for (const table of BUSINESS_TABLE_NAMES) {
        const actualColumns = database
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .map((row) => (row as { readonly name: string }).name);
        expect(actualColumns, table).toEqual(EXPECTED_DATABASE_COLUMNS[table]);
      }
    } finally {
      database.close();
    }
  });

  it('records every migration with its immutable checksum in deterministic order', async () => {
    const { database } = await createInitializedDatabase();

    try {
      const rows = database
        .prepare(
          `SELECT version, name, checksum
           FROM schema_migrations
           ORDER BY version`,
        )
        .all();

      expect(rows).toEqual(
        MIGRATIONS.map((migration) => ({
          checksum: migrationChecksum(migration),
          name: migration.name,
          version: migration.version,
        })),
      );
    } finally {
      database.close();
    }
  });

  it('is idempotent when all migrations are already applied', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath });
    const secondRun = await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);

    try {
      const row = database.prepare('SELECT count(*) AS count FROM schema_migrations').get() as {
        readonly count: number;
      };
      expect(secondRun).toMatchObject({
        appliedVersions: [],
        backupPath: null,
        schemaVersion: 6,
      });
      expect(row.count).toBe(6);
    } finally {
      database.close();
    }
  });

  it('rejects foreign key violations', async () => {
    const { database } = await createInitializedDatabase();

    try {
      expect(() =>
        database
          .prepare(
            `INSERT INTO books(
               id, canonical_title, author_id, work_type, discovery_status
             ) VALUES ('book-1', 'Book', 'missing-author', 'NOVEL', 'DISCOVERED')`,
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/iu);
    } finally {
      database.close();
    }
  });

  it('rejects uniqueness and check constraint violations', async () => {
    const { database } = await createInitializedDatabase();
    const insertSource = database.prepare(
      `INSERT INTO sources(
         id, url, title, source_tier, source_type, retrieved_at, content_hash,
         language, user_supplied
       ) VALUES (?, ?, 'Source', 'PRIMARY', 'WEB',
                 '2026-07-27T01:02:03.000Z', ?, 'zh-CN', ?)`,
    );

    try {
      insertSource.run('source-1', 'https://example.test/source', 'hash-1', 0);
      expect(() =>
        insertSource.run('source-2', 'https://example.test/source', 'hash-2', 0),
      ).toThrow(/UNIQUE constraint failed/iu);
      expect(() => insertSource.run('source-3', 'https://example.test/other', 'hash-3', 2)).toThrow(
        /CHECK constraint failed/iu,
      );
    } finally {
      database.close();
    }
  });

  it('rolls back every write when an important transaction fails', async () => {
    const { database } = await createInitializedDatabase();

    try {
      expect(() =>
        runInTransaction(database, () => {
          database
            .prepare(
              `INSERT INTO account_profiles(id, working_name)
               VALUES ('profile-rollback', 'Rollback')`,
            )
            .run();
          throw new Error('simulated write failure');
        }),
      ).toThrow('simulated write failure');

      const row = database
        .prepare(
          `SELECT count(*) AS count
           FROM account_profiles
           WHERE id = 'profile-rollback'`,
        )
        .get() as { readonly count: number };
      expect(row.count).toBe(0);
    } finally {
      database.close();
    }
  });

  it('rejects nested transaction helpers without committing the outer transaction', async () => {
    const { database } = await createInitializedDatabase();

    try {
      expect(() =>
        runInTransaction(database, () => {
          database
            .prepare(
              `INSERT INTO account_profiles(id, working_name)
               VALUES ('profile-outer', 'Outer')`,
            )
            .run();
          runInTransaction(database, () => undefined);
        }),
      ).toThrow(/Nested transactions are not supported/iu);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM account_profiles
             WHERE id = 'profile-outer'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('applies the designed cascade, set-null, and restrict relationships', async () => {
    const { database } = await createInitializedDatabase();

    try {
      database
        .prepare(
          `INSERT INTO authors(id, canonical_name)
           VALUES ('author-1', 'Author')`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO books(
             id, canonical_title, author_id, work_type, discovery_status
           ) VALUES ('book-1', 'Book', 'author-1', 'NOVEL', 'DISCOVERED')`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO reading_states(id, book_id)
           VALUES ('reading-1', 'book-1')`,
        )
        .run();

      database.prepare("DELETE FROM authors WHERE id = 'author-1'").run();
      expect(database.prepare("SELECT author_id FROM books WHERE id = 'book-1'").get()).toEqual({
        author_id: null,
      });

      database.prepare("DELETE FROM books WHERE id = 'book-1'").run();
      expect(
        database
          .prepare("SELECT count(*) AS count FROM reading_states WHERE id = 'reading-1'")
          .get(),
      ).toEqual({ count: 0 });

      database
        .prepare(
          `INSERT INTO model_runs(
             id, role, provider, model, prompt_version, input_hash, status, started_at
           ) VALUES (
             'run-1', 'TEXT', 'fixture', 'fixture-model', 'v1', 'hash', 'DONE',
             '2026-07-27T01:02:03.000Z'
           )`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO cost_ledger(
             id, model_run_id, billing_month, cost_source, amount_usd
           ) VALUES ('cost-1', 'run-1', '2026-07', 'REPORTED', 0)`,
        )
        .run();
      expect(() => database.prepare("DELETE FROM model_runs WHERE id = 'run-1'").run()).toThrow(
        /FOREIGN KEY constraint failed/iu,
      );
    } finally {
      database.close();
    }
  });

  it('rejects migration definitions that are out of sequence before changing the database', async () => {
    const databasePath = createTemporaryDatabasePath();

    await expect(
      initializeDatabase({
        databasePath,
        migrations: [{ name: 'wrong_start', sql: 'CREATE TABLE x(id TEXT);', version: 2 }],
      }),
    ).rejects.toThrow(/expected 1, received 2/iu);
  });

  it('refuses a modified applied migration history', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);
    try {
      database.prepare('UPDATE schema_migrations SET checksum = lower(hex(randomblob(32)))').run();
    } finally {
      database.close();
    }

    await expect(initializeDatabase({ databasePath })).rejects.toThrow(
      /Migration history mismatch/iu,
    );
  });

  it('has an index whose leading column covers every foreign key', async () => {
    const { database } = await createInitializedDatabase();

    try {
      for (const table of BUSINESS_TABLE_NAMES) {
        const foreignKeyColumns = database
          .prepare(`PRAGMA foreign_key_list("${table}")`)
          .all()
          .map((row) => (row as { readonly from: string }).from);
        const indexNames = database
          .prepare(`PRAGMA index_list("${table}")`)
          .all()
          .map((row) => (row as { readonly name: string }).name);
        const indexedLeadingColumns = indexNames.flatMap((indexName) => {
          const firstColumn = database
            .prepare(`PRAGMA index_info("${indexName}")`)
            .all()
            .find((row) => (row as { readonly seqno: number }).seqno === 0) as
            { readonly name: string } | undefined;
          return firstColumn === undefined ? [] : [firstColumn.name];
        });

        for (const foreignKeyColumn of foreignKeyColumns) {
          expect(indexedLeadingColumns, `${table}.${foreignKeyColumn}`).toContain(foreignKeyColumn);
        }
      }
    } finally {
      database.close();
    }
  });
});
