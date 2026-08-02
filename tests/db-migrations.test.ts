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
      'profile_id',
      'topic_version_id',
      'current_version_id',
      'brief_state',
      'brief_revision',
      'content_type',
      'target_reader',
      'core_judgment',
      'counterpoints_json',
      'spoiler_level',
      'required_claim_ids_json',
      'score_type',
      'desired_action',
      'forbidden_phrases_json',
      'status',
      'created_at',
      'updated_at',
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
    experience_assertion_revisions: [
      'id',
      'assertion_id',
      'revision',
      'previous_revision_id',
      'reading_state_revision_id',
      'assertion_kind',
      'confirmation_scope',
      'statement',
      'statement_hash',
      'status',
      'provenance',
      'confirmed_at',
      'invalidated_at',
      'created_at',
    ],
    experience_assertions: [
      'id',
      'reading_state_id',
      'current_revision_id',
      'revision',
      'created_at',
      'updated_at',
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
      'experiment_contract_version',
      'profile_id',
      'experiment_state',
      'experiment_revision',
      'created_at',
      'updated_at',
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
    expression_permission_dependencies: [
      'snapshot_id',
      'dependency_type',
      'dependency_id',
      'observed_revision',
      'dependency_key',
      'created_at',
    ],
    expression_permission_invalidations: [
      'id',
      'event_identity',
      'snapshot_id',
      'reading_state_id',
      'dependency_type',
      'dependency_id',
      'observed_revision',
      'reason_code',
      'created_at',
    ],
    expression_permission_snapshots: [
      'id',
      'reading_state_id',
      'reading_state_revision_id',
      'snapshot_version',
      'authenticity_policy_version',
      'score_policy_version',
      'spoiler_policy_version',
      'dossier_id',
      'dossier_version_id',
      'dossier_readiness',
      'spoiler_level',
      'spoiler_warning_required',
      'spoiler_warning_placement',
      'spoiler_user_confirmation_required',
      'personal_experience_permission',
      'first_person_permission',
      'public_research_analysis_permission',
      'personal_score_permission',
      'research_score_permission',
      'personal_content_mode',
      'research_content_mode',
      'content_brief_readiness',
      'blocking_reason_codes_json',
      'warning_reason_codes_json',
      'dependency_hash',
      'evaluated_at',
      'published_at',
    ],
    personal_score_records: [
      'id',
      'reading_state_id',
      'reading_state_revision_id',
      'assertion_revision_id',
      'revision',
      'score_basis_points',
      'status',
      'provenance',
      'created_at',
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
      'draft_version_id',
      'fact_mapping_version_id',
      'fact_mapping_run_id',
      'check_type',
      'result',
      'summary_status',
      'severity',
      'reason_code',
      'details_json',
      'checker_version',
      'input_hash',
      'legacy_unresolved',
      'created_at',
    ],
    reading_authenticity_audit_events: [
      'id',
      'event_type',
      'reading_state_id',
      'profile_id',
      'book_id',
      'revision',
      'actor',
      'details_json',
      'created_at',
    ],
    reading_spoiler_preference_revisions: [
      'id',
      'preference_id',
      'revision',
      'previous_revision_id',
      'policy_version',
      'spoiler_level',
      'warning_included',
      'user_confirmed',
      'provenance',
      'created_at',
    ],
    reading_spoiler_preferences: [
      'id',
      'reading_state_id',
      'current_revision_id',
      'revision',
      'created_at',
      'updated_at',
    ],
    reading_state_revisions: [
      'id',
      'reading_state_id',
      'revision',
      'previous_revision_id',
      'contract_version',
      'state',
      'memory_confidence',
      'confirmation_kind',
      'finished_at',
      'finished_at_precision',
      'last_read_at',
      'last_read_at_precision',
      'expression_id',
      'edition_id',
      'user_note',
      'provenance',
      'provenance_identity',
      'legacy_payload_json',
      'created_at',
    ],
    reading_states: [
      'id',
      'profile_id',
      'book_id',
      'current_revision_id',
      'current_snapshot_id',
      'revision',
      'created_at',
      'updated_at',
    ],
    research_analysis_score_records: [
      'id',
      'reading_state_id',
      'reading_state_revision_id',
      'dossier_id',
      'dossier_version_id',
      'revision',
      'score_basis_points',
      'status',
      'public_label',
      'provenance',
      'created_at',
    ],
    research_dossier_audit_events: [
      'id',
      'event_type',
      'dossier_id',
      'version_id',
      'plan_id',
      'run_id',
      'actor',
      'before_json',
      'after_json',
      'created_at',
    ],
    research_dossier_build_plans: [
      'id',
      'dossier_id',
      'contract_version',
      'plan_hash',
      'input_hash',
      'expected_dossier_revision',
      'expected_current_version_id',
      'build_mode',
      'counts_json',
      'preview_json',
      'no_op',
      'estimated_local_writes',
      'estimated_model_requests',
      'budget_conclusion',
      'status',
      'revision',
      'created_at',
      'expires_at',
      'updated_at',
    ],
    research_dossier_build_runs: [
      'id',
      'dossier_id',
      'plan_id',
      'execution_id',
      'job_id',
      'input_hash',
      'status',
      'result_version_id',
      'external_request_count',
      'cost_state',
      'error_code',
      'revision',
      'created_at',
      'updated_at',
    ],
    research_dossier_coverage_snapshots: [
      'id',
      'version_id',
      'coverage_policy_version',
      'input_hash',
      'overall_basis_points',
      'required_basis_points',
      'optional_basis_points',
      'verified_count',
      'blocked_count',
      'stale_count',
      'insufficient_count',
      'gap_count',
      'reason_codes_json',
      'created_at',
    ],
    research_dossier_dependencies: [
      'id',
      'version_id',
      'entry_id',
      'dependency_type',
      'dependency_id',
      'dependency_revision',
      'dependency_key',
      'created_at',
    ],
    research_dossier_entries: [
      'id',
      'version_id',
      'section_id',
      'section_key',
      'entry_kind',
      'semantic_key',
      'predicate',
      'display_value',
      'structured_value_json',
      'fact_status',
      'source_count',
      'evidence_count',
      'conflict_id',
      'gap_id',
      'provenance',
      'revision',
      'created_at',
      'updated_at',
    ],
    research_dossier_entry_claims: ['entry_id', 'claim_id', 'claim_revision'],
    research_dossier_entry_evaluations: ['entry_id', 'evaluation_id', 'input_identity_hash'],
    research_dossier_entry_evidence: [
      'entry_id',
      'evidence_id',
      'evidence_revision',
      'source_id',
      'source_revision',
    ],
    research_dossier_gap_claims: ['gap_id', 'claim_id'],
    research_dossier_gaps: [
      'id',
      'version_id',
      'section_key',
      'semantic_key',
      'reason_code',
      'required',
      'blocking',
      'audit_ref',
      'created_at',
    ],
    research_dossier_invalidations: [
      'id',
      'event_identity',
      'dossier_id',
      'current_version_id',
      'dependency_type',
      'dependency_id',
      'observed_revision',
      'reason_code',
      'created_at',
    ],
    research_dossier_sections: [
      'id',
      'version_id',
      'section_key',
      'position',
      'readiness_required',
      'coverage_basis_points',
      'verified_count',
      'blocked_count',
      'stale_count',
      'insufficient_count',
      'gap_count',
      'reason_codes_json',
      'created_at',
    ],
    research_dossier_versions: [
      'id',
      'dossier_id',
      'version_number',
      'previous_version_id',
      'schema_version',
      'coverage_policy_version',
      'fact_policy_version',
      'input_hash',
      'build_mode',
      'build_run_id',
      'readiness',
      'reason_codes_json',
      'warnings_json',
      'legacy_payload_json',
      'revision',
      'created_at',
      'published_at',
    ],
    research_dossiers: [
      'id',
      'book_id',
      'subject_type',
      'subject_id',
      'current_version_id',
      'revision',
      'state',
      'readiness',
      'invalidation_reasons_json',
      'created_at',
      'updated_at',
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
    topic_audit_events: [
      'id',
      'event_type',
      'profile_id',
      'topic_id',
      'generation_plan_id',
      'quota_plan_version_id',
      'actor',
      'details_json',
      'created_at',
    ],
    topic_candidate_invalidations: [
      'id',
      'event_identity',
      'topic_id',
      'version_id',
      'dependency_type',
      'dependency_id',
      'observed_revision',
      'reason_code',
      'created_at',
    ],
    topic_candidate_versions: [
      'id',
      'topic_id',
      'version_number',
      'previous_version_id',
      'schema_version',
      'content_type',
      'topic_angle',
      'central_question',
      'candidate_judgment',
      'analysis_mode',
      'spoiler_level',
      'spoiler_warning_required',
      'spoiler_warning_placement',
      'spoiler_user_confirmation_required',
      'comparison_dimension',
      'required_public_labels_json',
      'semantic_fingerprint',
      'fingerprint_policy_version',
      'eligibility_state',
      'eligibility_reason_codes_json',
      'eligibility_policy_version',
      'ranking_policy_version',
      'total_score_basis_points',
      'ranking_complete',
      'tie_break_key',
      'dependency_hash',
      'input_hash',
      'estimated_external_cost_microusd',
      'cost_state',
      'approval_workload_units',
      'workload_state',
      'provenance',
      'created_at',
    ],
    topic_context_claims: [
      'version_id',
      'claim_id',
      'work_id',
      'fact_status',
      'context_only',
      'created_at',
    ],
    topic_dependencies: [
      'version_id',
      'dependency_type',
      'dependency_id',
      'observed_revision',
      'dependency_key',
      'created_at',
    ],
    topic_generation_plan_inputs: [
      'plan_id',
      'work_id',
      'catalog_revision',
      'dossier_version_id',
      'permission_snapshot_id',
      'created_at',
    ],
    topic_generation_plans: [
      'id',
      'profile_id',
      'contract_version',
      'plan_hash',
      'input_hash',
      'input_work_count',
      'counts_json',
      'expected_policy_versions_json',
      'local_combination_upper_bound',
      'deduplication_limit',
      'estimated_local_writes',
      'estimated_model_requests',
      'budget_conclusion',
      'model_execution_state',
      'status',
      'revision',
      'created_at',
      'expires_at',
      'updated_at',
    ],
    topic_generation_runs: [
      'id',
      'plan_id',
      'execution_id',
      'job_id',
      'status',
      'result_candidate_count',
      'external_request_count',
      'cost_state',
      'error_code',
      'revision',
      'created_at',
      'updated_at',
    ],
    topic_quota_plan_categories: [
      'plan_version_id',
      'content_type',
      'selected_count',
      'required_count',
      'shortfall_count',
      'locked_eligible_count',
      'held_count',
      'archived_count',
      'conflicts_json',
      'created_at',
    ],
    topic_quota_plan_events: [
      'id',
      'plan_version_id',
      'event_type',
      'reason_code',
      'dependency_type',
      'dependency_id',
      'event_identity',
      'created_at',
    ],
    topic_quota_plan_member_scores: [
      'plan_version_id',
      'topic_id',
      'component_type',
      'knowledge_state',
      'value_basis_points',
      'reason_codes_json',
      'created_at',
    ],
    topic_quota_plan_members: [
      'plan_version_id',
      'content_type',
      'position',
      'topic_id',
      'topic_version_id',
      'semantic_fingerprint',
      'eligibility_state',
      'total_score_basis_points',
      'locked',
      'selection_reason_codes_json',
      'created_at',
    ],
    topic_quota_plan_roots: [
      'id',
      'profile_id',
      'quota_profile_id',
      'current_plan_version_id',
      'revision',
      'created_at',
      'updated_at',
    ],
    topic_quota_plan_runs: [
      'id',
      'profile_id',
      'quota_profile_id',
      'execution_id',
      'job_id',
      'pool_snapshot_hash',
      'max_work_exposure',
      'total_candidate_count',
      'status',
      'plan_version_id',
      'error_code',
      'revision',
      'created_at',
      'updated_at',
    ],
    topic_quota_plan_versions: [
      'id',
      'root_id',
      'version_number',
      'previous_version_id',
      'quota_profile_id',
      'pool_snapshot_hash',
      'ranking_policy_version',
      'solver_version',
      'status',
      'total_selected',
      'total_required',
      'estimated_cost_state',
      'estimated_cost_microusd',
      'workload_state',
      'workload_units',
      'reason_codes_json',
      'created_at',
    ],
    topic_quota_profiles: [
      'id',
      'profile_version',
      'solver_version',
      'total_required',
      'max_work_exposure',
      'immutable',
      'created_at',
    ],
    topic_quota_requirements: [
      'quota_profile_id',
      'content_type',
      'required_count',
      'position',
      'created_at',
    ],
    topic_ranking_components: [
      'version_id',
      'component_type',
      'knowledge_state',
      'value_basis_points',
      'reason_codes_json',
      'input_dependencies_json',
      'policy_version',
      'created_at',
    ],
    topic_state_transitions: [
      'id',
      'topic_id',
      'revision',
      'previous_transition_id',
      'from_state',
      'to_state',
      'action',
      'expected_revision',
      'actor',
      'details_json',
      'created_at',
    ],
    topic_subject_memberships: [
      'version_id',
      'ordinal',
      'subject_type',
      'subject_id',
      'work_id',
      'expression_id',
      'edition_id',
      'role',
      'expression_form',
      'catalog_revision',
      'created_at',
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
      'topic_contract_version',
      'profile_id',
      'semantic_fingerprint',
      'canonical_topic_id',
      'candidate_state',
      'current_version_number',
      'topic_revision',
      'created_at',
      'updated_at',
    ],
    system_prediction_scores: [
      'id',
      'profile_id',
      'book_id',
      'score_basis_points',
      'purpose',
      'provenance',
      'created_at',
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
        appliedVersions: MIGRATIONS.map(({ version }) => version),
        backupPath: null,
        databasePath,
        schemaVersion: MIGRATIONS.length,
      });
      expect(tables).toEqual(
        [
          ...BUSINESS_TABLE_NAMES,
          'content_brief_arguments',
          'content_brief_audiences',
          'content_brief_audit_events',
          'content_brief_dependencies',
          'content_brief_evidence_refs',
          'content_brief_experiment_bindings',
          'content_brief_expression_policies',
          'content_brief_field_states',
          'content_brief_forbidden_expressions',
          'content_brief_generation_plans',
          'content_brief_generation_runs',
          'content_brief_invalidations',
          'content_brief_judgments',
          'content_brief_objectives',
          'content_brief_policy_registry',
          'content_brief_readiness_snapshots',
          'content_brief_score_plans',
          'content_brief_spoiler_plans',
          'content_brief_structure_slots',
          'content_brief_subjects',
          'content_brief_transitions',
          'content_brief_versions',
          'content_draft_audit_events',
          'content_draft_blocks',
          'content_draft_dependencies',
          'content_draft_field_states',
          'content_draft_heads',
          'content_draft_invalidations',
          'content_draft_lineage_refs',
          'content_draft_mutation_plans',
          'content_draft_mutation_runs',
          'content_draft_pinned_comments',
          'content_draft_spoiler_warnings',
          'content_draft_tags',
          'content_draft_titles',
          'content_draft_transitions',
          'content_draft_versions',
          'experiment_arms',
          'experiment_assignment_plans',
          'experiment_assignment_units',
          'experiment_audit_events',
          'experiment_controlled_conditions',
          'experiment_current_assignments',
          'experiment_current_designs',
          'experiment_dependencies',
          'experiment_design_versions',
          'experiment_guardrails',
          'experiment_invalidations',
          'experiment_policy_events',
          'experiment_policy_registry',
          'experiment_popularity_snapshots',
          'experiment_primary_metrics',
          'experiment_primary_variables',
          'experiment_replication_structures',
          'experiment_sample_plans',
          'experiment_state_transitions',
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
          'fact_mapping_artifacts',
          'fact_mapping_check_versions',
          'fact_mapping_checks',
          'fact_mapping_decisions',
          'fact_mapping_dependencies',
          'fact_mapping_heads',
          'fact_mapping_invalidations',
          'fact_mapping_link_evidence',
          'fact_mapping_links',
          'fact_mapping_plans',
          'fact_mapping_policy_registry',
          'fact_mapping_runs',
          'fact_mapping_signals',
          'fact_mapping_statements',
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
          'v2_weekly_plan_snapshots',
          'v2_workspaces',
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
        schemaVersion: MIGRATIONS.length,
      });
      expect(row.count).toBe(MIGRATIONS.length);
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
          `INSERT INTO reading_states(id, profile_id, book_id)
           VALUES ('reading-1', 'primary', 'book-1')`,
        )
        .run();

      database.prepare("DELETE FROM authors WHERE id = 'author-1'").run();
      expect(database.prepare("SELECT author_id FROM books WHERE id = 'book-1'").get()).toEqual({
        author_id: null,
      });

      expect(() => database.prepare("DELETE FROM books WHERE id = 'book-1'").run()).toThrow(
        /FOREIGN KEY constraint failed/iu,
      );
      expect(
        database
          .prepare("SELECT count(*) AS count FROM reading_states WHERE id = 'reading-1'")
          .get(),
      ).toEqual({ count: 1 });

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
