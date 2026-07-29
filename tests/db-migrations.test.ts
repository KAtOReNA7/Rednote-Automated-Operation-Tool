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
      'expression_id',
      'isbn',
      'translated_title',
      'translator',
      'publisher',
      'publication_date',
      'edition_label',
      'format',
      'platform',
      'cover_asset_id',
      'is_motie',
      'is_unreleased',
      'source_id',
      'catalog_state',
      'catalog_revision',
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
      'catalog_state',
      'catalog_revision',
    ],
    claim_evidence: [
      'id',
      'claim_id',
      'source_id',
      'source_revision',
      'locator_version',
      'locator_kind',
      'locator_json',
      'excerpt',
      'excerpt_hash',
      'supports_or_contradicts',
      'language',
      'summary_zh',
      'summary_method',
      'model_execution_id',
      'locator_validated',
      'verification_status',
      'revision',
      'created_at',
    ],
    claims: [
      'id',
      'contract_version',
      'subject_type',
      'subject_id',
      'predicate',
      'predicate_version',
      'value_type',
      'value_json',
      'normalized_value',
      'scope_json',
      'normalized_scope_hash',
      'policy_version',
      'key_fact',
      'claimant_source_id',
      'claimant_source_revision',
      'semantic_fingerprint',
      'status',
      'provenance_json',
      'confidence',
      'legacy_conflict_status',
      'revision',
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
      'normalized_url',
      'url_hash',
      'capture_id',
      'local_api_client_id',
      'extension_origin',
      'capture_source',
      'browser_family',
      'contract_version',
      'extension_build_version',
      'public_page_confirmed',
      'selected_text_hash',
      'screenshot_mime',
      'screenshot_hash',
      'screenshot_bytes',
      'screenshot_width',
      'screenshot_height',
      'status',
      'revision',
      'updated_at',
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
      'settlement_identity',
      'execution_id',
      'model_run_id',
      'entry_kind',
      'adjustment_of_id',
      'adjustment_reason',
      'billing_month',
      'provider_config_fingerprint',
      'model_id',
      'operation_kind',
      'cost_state',
      'cost_source',
      'amount_microusd',
      'comparison_estimate_microusd',
      'price_schedule_id',
      'price_schedule_version',
      'usage_summary_json',
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
      'execution_id',
      'job_id',
      'task_kind',
      'model_role',
      'model_slot',
      'provider_config_fingerprint',
      'model_id',
      'protocol_mode',
      'prompt_template_id',
      'prompt_version',
      'prompt_content_hash',
      'input_hash',
      'cache_key',
      'cache_entry_id',
      'output_hash',
      'local_cache_hit',
      'cache_policy',
      'status',
      'outcome_certainty',
      'external_request_count',
      'usage_input_tokens',
      'usage_output_tokens',
      'usage_total_tokens',
      'usage_cached_input_tokens',
      'usage_cache_write_tokens',
      'usage_reasoning_tokens',
      'usage_images',
      'usage_image_generation_calls',
      'usage_web_search_calls',
      'usage_tool_calls',
      'cost_state',
      'cost_source',
      'cost_amount_microusd',
      'price_schedule_version',
      'stable_error_code',
      'duration_ms',
      'started_at',
      'finished_at',
      'created_at',
      'updated_at',
      'revision',
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
  it('creates a new database with all PRD and published infrastructure tables', async () => {
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
        appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        backupPath: null,
        databasePath,
        schemaVersion: 12,
      });
      expect(tables).toEqual(
        [
          ...BUSINESS_TABLE_NAMES,
          'clip_ingest_rate_states',
          'clip_ingest_receipts',
          'clip_search_candidate_links',
          'local_api_clients',
          'local_api_settings',
          'model_budget_reservations',
          'model_cache_entries',
          'model_price_schedules',
          'model_unit_budget_policies',
          'provider_capability_entries',
          'provider_capability_probe_runs',
          'schema_migrations',
          'fetch_profiles',
          'fetch_origin_rate_states',
          'fetch_robots_cache',
          'fetched_documents',
          'fetch_runs',
          'fetch_redirect_hops',
          'search_provider_configs',
          'search_rate_limit_states',
          'search_result_candidates',
          'search_runs',
          'bibliographic_identifiers',
          'bibliographic_observation_fields',
          'bibliographic_observations',
          'catalog_agent_relations',
          'catalog_agents',
          'catalog_audit_events',
          'catalog_entity_aliases',
          'discovery_plan_strata',
          'discovery_plans',
          'discovery_profiles',
          'discovery_run_origins',
          'discovery_run_stratum_coverage',
          'discovery_runs',
          'entity_lineage_memberships',
          'entity_redirects',
          'expressions',
          'fact_audit_events',
          'fact_conflict_decisions',
          'fact_conflicts',
          'fact_evaluations',
          'fact_subjects',
          'observation_entity_links',
          'predicate_registry',
          'publication_relationships',
          'resolution_cases',
          'resolution_decisions',
          'source_classifications',
          'source_lineage',
          'source_processing_plans',
          'source_processing_runs',
          'source_revisions',
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
        schemaVersion: 12,
      });
      expect(row.count).toBe(12);
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
             id, execution_id, task_kind, model_role, model_slot,
             provider_config_fingerprint, model_id, protocol_mode, prompt_template_id,
             prompt_version, prompt_content_hash, input_hash, cache_key, cache_policy,
             status, outcome_certainty, cost_state, started_at, finished_at, created_at, updated_at
           ) VALUES (
             'run-1', 'execution-1', 'TEXT', 'WRITER', 'WRITING',
             '0000000000000000000000000000000000000000000000000000000000000000',
             'fixture-model', 'MOCK', 'fixture-prompt', 1, 'prompt-hash', 'input-hash',
             '1111111111111111111111111111111111111111111111111111111111111111',
             'BYPASS', 'SUCCEEDED', 'COMPLETED_INVALID_OUTPUT', 'UNPRICED_USAGE',
             '2026-07-27T01:02:03.000Z', '2026-07-27T01:02:04.000Z',
             '2026-07-27T01:02:03.000Z', '2026-07-27T01:02:04.000Z'
           )`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO cost_ledger(
             id, settlement_identity, execution_id, model_run_id, billing_month,
             provider_config_fingerprint, model_id, operation_kind, cost_state,
             cost_source, usage_summary_json
           ) VALUES (
             'cost-1', 'settlement:execution-1', 'execution-1', 'run-1', '2026-07',
             '0000000000000000000000000000000000000000000000000000000000000000',
             'fixture-model', 'TEXT', 'UNPRICED_USAGE', 'NO_PRICE', '{}'
           )`,
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
