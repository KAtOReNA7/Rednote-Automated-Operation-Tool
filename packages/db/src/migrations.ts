export interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly version: number;
}

const UTC_NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const UTC_REQUIRED = "GLOB '????-??-??T??:??:??.???Z'";
const UTC_OPTIONAL = 'IS NULL OR';

const CONTENT_STATUS_CHECK = `CHECK (status IN (
  'IDEA',
  'RESEARCHING',
  'RESEARCH_READY',
  'DRAFTING',
  'REVIEW_REQUIRED',
  'APPROVAL_READY',
  'APPROVED',
  'EXPORT_READY',
  'EXPORTED',
  'MANUALLY_PUBLISHED',
  'MEASURED',
  'FACT_BLOCKED',
  'GENERATION_FAILED',
  'VISUAL_FAILED',
  'USER_REJECTED',
  'ARCHIVED'
))`;

const INITIAL_SCHEMA = `
CREATE TABLE account_profiles (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  working_name TEXT NOT NULL CHECK (length(trim(working_name)) > 0),
  bio TEXT NOT NULL DEFAULT '',
  occupation_disclosure TEXT NOT NULL DEFAULT 'DEFERRED'
    CHECK (length(trim(occupation_disclosure)) > 0),
  ownership TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (ownership = 'PERSONAL'),
  tone_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tone_config_json)),
  content_scope_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(content_scope_json)),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE sources (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  url TEXT NOT NULL UNIQUE CHECK (length(trim(url)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  publisher_or_site TEXT,
  source_tier TEXT NOT NULL CHECK (length(trim(source_tier)) > 0),
  source_type TEXT NOT NULL CHECK (length(trim(source_type)) > 0),
  retrieved_at TEXT NOT NULL CHECK (retrieved_at ${UTC_REQUIRED}),
  content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
  local_snapshot_path TEXT,
  language TEXT NOT NULL CHECK (length(trim(language)) > 0),
  user_supplied INTEGER NOT NULL DEFAULT 0 CHECK (user_supplied IN (0, 1))
) STRICT;

CREATE TABLE authors (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  canonical_name TEXT NOT NULL CHECK (length(trim(canonical_name)) > 0),
  original_name TEXT,
  country_or_region TEXT,
  profile TEXT,
  source_id TEXT REFERENCES sources(id) ON UPDATE CASCADE ON DELETE SET NULL
) STRICT;

CREATE TABLE model_runs (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  role TEXT NOT NULL CHECK (length(trim(role)) > 0),
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  prompt_version TEXT NOT NULL CHECK (length(trim(prompt_version)) > 0),
  input_hash TEXT NOT NULL CHECK (length(trim(input_hash)) > 0),
  output_hash TEXT,
  cached INTEGER NOT NULL DEFAULT 0 CHECK (cached IN (0, 1)),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  estimated_cost_usd REAL CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  status TEXT NOT NULL CHECK (length(trim(status)) > 0),
  started_at TEXT NOT NULL CHECK (started_at ${UTC_REQUIRED}),
  completed_at TEXT CHECK (completed_at ${UTC_OPTIONAL} completed_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE books (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  canonical_title TEXT NOT NULL CHECK (length(trim(canonical_title)) > 0),
  original_title TEXT,
  author_id TEXT REFERENCES authors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  country_or_region TEXT,
  language TEXT,
  work_type TEXT NOT NULL CHECK (length(trim(work_type)) > 0),
  series_name TEXT,
  series_order REAL CHECK (series_order IS NULL OR series_order > 0),
  synopsis TEXT,
  discovery_status TEXT NOT NULL CHECK (length(trim(discovery_status)) > 0),
  research_score REAL CHECK (research_score IS NULL OR research_score BETWEEN 0 AND 100),
  topic_score REAL CHECK (topic_score IS NULL OR topic_score BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  asset_type TEXT NOT NULL CHECK (length(trim(asset_type)) > 0),
  origin TEXT NOT NULL CHECK (length(trim(origin)) > 0),
  source_id TEXT REFERENCES sources(id) ON UPDATE CASCADE ON DELETE SET NULL,
  original_path TEXT,
  processed_path TEXT,
  mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
  generation_run_id TEXT REFERENCES model_runs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE book_editions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  book_id TEXT NOT NULL REFERENCES books(id) ON UPDATE CASCADE ON DELETE CASCADE,
  isbn TEXT UNIQUE,
  translated_title TEXT,
  translator TEXT,
  publisher TEXT,
  publication_date TEXT,
  edition_label TEXT,
  cover_asset_id TEXT REFERENCES assets(id) ON UPDATE CASCADE ON DELETE SET NULL,
  is_motie INTEGER NOT NULL DEFAULT 0 CHECK (is_motie IN (0, 1)),
  is_unreleased INTEGER NOT NULL DEFAULT 0 CHECK (is_unreleased IN (0, 1)),
  source_id TEXT REFERENCES sources(id) ON UPDATE CASCADE ON DELETE SET NULL
) STRICT;

CREATE TABLE reading_states (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  book_id TEXT NOT NULL UNIQUE REFERENCES books(id) ON UPDATE CASCADE ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (state IN ('UNKNOWN', 'READ_CLEAR', 'READ_FUZZY', 'READ_UNVERIFIED', 'NOT_READ')),
  memory_note TEXT,
  user_confirmed_at TEXT
    CHECK (user_confirmed_at ${UTC_OPTIONAL} user_confirmed_at ${UTC_REQUIRED}),
  personal_score REAL CHECK (personal_score IS NULL OR personal_score BETWEEN 0 AND 100),
  score_confirmed_at TEXT
    CHECK (score_confirmed_at ${UTC_OPTIONAL} score_confirmed_at ${UTC_REQUIRED}),
  CHECK (state <> 'READ_CLEAR' OR user_confirmed_at IS NOT NULL),
  CHECK (
    personal_score IS NULL OR
    (state = 'READ_CLEAR' AND score_confirmed_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE claims (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  subject_type TEXT NOT NULL CHECK (length(trim(subject_type)) > 0),
  subject_id TEXT NOT NULL CHECK (length(trim(subject_id)) > 0),
  predicate TEXT NOT NULL CHECK (length(trim(predicate)) > 0),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  conflict_status TEXT NOT NULL CHECK (length(trim(conflict_status)) > 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON UPDATE CASCADE ON DELETE CASCADE,
  evidence_excerpt TEXT NOT NULL CHECK (length(trim(evidence_excerpt)) > 0),
  locator TEXT,
  supports_or_contradicts TEXT NOT NULL
    CHECK (supports_or_contradicts IN ('SUPPORTS', 'CONTRADICTS')),
  PRIMARY KEY (claim_id, source_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE clips (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  url TEXT NOT NULL CHECK (length(trim(url)) > 0),
  platform TEXT NOT NULL CHECK (length(trim(platform)) > 0),
  account_name TEXT,
  page_title TEXT,
  published_at TEXT CHECK (published_at ${UTC_OPTIONAL} published_at ${UTC_REQUIRED}),
  selected_text TEXT,
  user_note TEXT,
  visible_metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(visible_metrics_json)),
  screenshot_path TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE research_dossiers (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  book_id TEXT NOT NULL REFERENCES books(id) ON UPDATE CASCADE ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  research_questions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(research_questions_json)),
  summary TEXT NOT NULL DEFAULT '',
  consensus_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(consensus_json)),
  disputes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(disputes_json)),
  source_coverage_score REAL NOT NULL DEFAULT 0 CHECK (source_coverage_score BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (length(trim(status)) > 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (book_id, version)
) STRICT;

CREATE TABLE experiments (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  hypothesis TEXT NOT NULL CHECK (length(trim(hypothesis)) > 0),
  primary_metric TEXT NOT NULL CHECK (length(trim(primary_metric)) > 0),
  guardrail_metrics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(guardrail_metrics_json)),
  variable_name TEXT NOT NULL CHECK (length(trim(variable_name)) > 0),
  variants_json TEXT NOT NULL CHECK (json_valid(variants_json)),
  start_at TEXT NOT NULL CHECK (start_at ${UTC_REQUIRED}),
  end_at TEXT CHECK (end_at ${UTC_OPTIONAL} end_at ${UTC_REQUIRED}),
  status TEXT NOT NULL CHECK (length(trim(status)) > 0),
  CHECK (end_at IS NULL OR end_at >= start_at)
) STRICT;

CREATE TABLE topics (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  book_id TEXT REFERENCES books(id) ON UPDATE CASCADE ON DELETE SET NULL,
  topic_type TEXT NOT NULL CHECK (length(trim(topic_type)) > 0),
  angle TEXT NOT NULL CHECK (length(trim(angle)) > 0),
  core_judgment TEXT NOT NULL CHECK (length(trim(core_judgment)) > 0),
  audience TEXT NOT NULL CHECK (length(trim(audience)) > 0),
  spoiler_level TEXT NOT NULL CHECK (spoiler_level IN ('NONE', 'LIGHT', 'FULL')),
  trend_score REAL CHECK (trend_score IS NULL OR trend_score BETWEEN 0 AND 100),
  fit_score REAL CHECK (fit_score IS NULL OR fit_score BETWEEN 0 AND 100),
  evidence_score REAL CHECK (evidence_score IS NULL OR evidence_score BETWEEN 0 AND 100),
  novelty_score REAL CHECK (novelty_score IS NULL OR novelty_score BETWEEN 0 AND 100),
  effort_score REAL CHECK (effort_score IS NULL OR effort_score BETWEEN 0 AND 100),
  priority_score REAL CHECK (priority_score IS NULL OR priority_score BETWEEN 0 AND 100),
  status TEXT NOT NULL ${CONTENT_STATUS_CHECK}
) STRICT;

CREATE TABLE content_briefs (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  topic_id TEXT NOT NULL UNIQUE REFERENCES topics(id) ON UPDATE CASCADE ON DELETE CASCADE,
  experiment_id TEXT REFERENCES experiments(id) ON UPDATE CASCADE ON DELETE SET NULL,
  content_type TEXT NOT NULL CHECK (length(trim(content_type)) > 0),
  target_reader TEXT NOT NULL CHECK (length(trim(target_reader)) > 0),
  core_judgment TEXT NOT NULL CHECK (length(trim(core_judgment)) > 0),
  counterpoints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(counterpoints_json)),
  spoiler_level TEXT NOT NULL CHECK (spoiler_level IN ('NONE', 'LIGHT', 'FULL')),
  required_claim_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_claim_ids_json)),
  score_type TEXT NOT NULL
    CHECK (score_type IN ('PERSONAL', 'RESEARCH_ANALYSIS', 'INTERNAL_PREDICTION')),
  title_variant TEXT,
  visual_variant TEXT,
  desired_action TEXT,
  forbidden_phrases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(forbidden_phrases_json)),
  status TEXT NOT NULL ${CONTENT_STATUS_CHECK}
) STRICT;

CREATE TABLE drafts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  brief_id TEXT NOT NULL REFERENCES content_briefs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  pinned_comment TEXT,
  generation_run_id TEXT REFERENCES model_runs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  status TEXT NOT NULL ${CONTENT_STATUS_CHECK},
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (brief_id, version)
) STRICT;

CREATE TABLE quality_checks (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  check_type TEXT NOT NULL CHECK (check_type IN (
    'FACT_MAPPING',
    'INTERNAL_CONSISTENCY',
    'READING_AUTHENTICITY',
    'SPOILER',
    'DUPLICATION',
    'TITLE_BODY_CONSISTENCY',
    'IMAGE_TECHNICAL',
    'STRUCTURED_OUTPUT'
  )),
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  severity TEXT NOT NULL CHECK (length(trim(severity)) > 0),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  checker_version TEXT NOT NULL CHECK (length(trim(checker_version)) > 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (draft_id, check_type, checker_version)
) STRICT;

CREATE TABLE approvals (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  approval_tier TEXT NOT NULL CHECK (approval_tier IN ('FAST', 'FOCUSED')),
  decision TEXT NOT NULL CHECK (length(trim(decision)) > 0),
  user_note TEXT,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0),
  decided_at TEXT NOT NULL CHECK (decided_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE post_packages (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  draft_id TEXT NOT NULL UNIQUE REFERENCES drafts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  planned_publish_at TEXT
    CHECK (planned_publish_at ${UTC_OPTIONAL} planned_publish_at ${UTC_REQUIRED}),
  export_path TEXT,
  manifest_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(manifest_json)),
  ai_disclosure INTEGER NOT NULL DEFAULT 0 CHECK (ai_disclosure = 0),
  exported_at TEXT CHECK (exported_at ${UTC_OPTIONAL} exported_at ${UTC_REQUIRED}),
  status TEXT NOT NULL ${CONTENT_STATUS_CHECK}
) STRICT;

CREATE TABLE publications (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  post_package_id TEXT NOT NULL UNIQUE
    REFERENCES post_packages(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  platform TEXT NOT NULL CHECK (length(trim(platform)) > 0),
  platform_post_url TEXT NOT NULL CHECK (length(trim(platform_post_url)) > 0),
  manually_published_at TEXT NOT NULL CHECK (manually_published_at ${UTC_REQUIRED}),
  user_note TEXT
) STRICT;

CREATE TABLE metric_snapshots (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON UPDATE CASCADE ON DELETE CASCADE,
  snapshot_window TEXT NOT NULL CHECK (length(trim(snapshot_window)) > 0),
  captured_at TEXT NOT NULL CHECK (captured_at ${UTC_REQUIRED}),
  source_method TEXT NOT NULL CHECK (length(trim(source_method)) > 0),
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  import_file_path TEXT,
  ocr_confidence REAL CHECK (ocr_confidence IS NULL OR ocr_confidence BETWEEN 0 AND 1),
  UNIQUE (publication_id, snapshot_window)
) STRICT;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  job_type TEXT NOT NULL CHECK (length(trim(job_type)) > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL CHECK (length(trim(status)) > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
  next_run_at TEXT CHECK (next_run_at ${UTC_OPTIONAL} next_run_at ${UTC_REQUIRED}),
  locked_at TEXT CHECK (locked_at ${UTC_OPTIONAL} locked_at ${UTC_REQUIRED}),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  CHECK (attempt_count <= max_attempts)
) STRICT;

CREATE TABLE cost_ledger (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  model_run_id TEXT NOT NULL UNIQUE
    REFERENCES model_runs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  billing_month TEXT NOT NULL CHECK (billing_month GLOB '????-??'),
  cost_source TEXT NOT NULL CHECK (length(trim(cost_source)) > 0),
  amount_usd REAL NOT NULL CHECK (amount_usd >= 0),
  token_or_call_units_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(token_or_call_units_json)),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE strategy_decisions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  period_start TEXT NOT NULL CHECK (period_start ${UTC_REQUIRED}),
  period_end TEXT NOT NULL CHECK (period_end ${UTC_REQUIRED}),
  analysis_json TEXT NOT NULL CHECK (json_valid(analysis_json)),
  recommendations_json TEXT NOT NULL CHECK (json_valid(recommendations_json)),
  user_decision_json TEXT CHECK (user_decision_json IS NULL OR json_valid(user_decision_json)),
  applied_at TEXT CHECK (applied_at ${UTC_OPTIONAL} applied_at ${UTC_REQUIRED}),
  CHECK (period_end >= period_start),
  CHECK (applied_at IS NULL OR user_decision_json IS NOT NULL)
) STRICT;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  event_type TEXT NOT NULL CHECK (length(trim(event_type)) > 0),
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) > 0),
  entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) > 0),
  actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE INDEX idx_authors_source_id ON authors(source_id);
CREATE INDEX idx_books_author_id ON books(author_id);
CREATE INDEX idx_books_discovery_status ON books(discovery_status);
CREATE INDEX idx_books_created_at ON books(created_at);
CREATE INDEX idx_assets_source_id ON assets(source_id);
CREATE INDEX idx_assets_generation_run_id ON assets(generation_run_id);
CREATE INDEX idx_assets_content_hash ON assets(content_hash);
CREATE INDEX idx_book_editions_book_id ON book_editions(book_id);
CREATE INDEX idx_book_editions_cover_asset_id ON book_editions(cover_asset_id);
CREATE INDEX idx_book_editions_source_id ON book_editions(source_id);
CREATE INDEX idx_reading_states_state ON reading_states(state);
CREATE INDEX idx_sources_retrieved_at ON sources(retrieved_at);
CREATE INDEX idx_sources_content_hash ON sources(content_hash);
CREATE INDEX idx_claims_subject ON claims(subject_type, subject_id);
CREATE INDEX idx_claims_conflict_status ON claims(conflict_status);
CREATE INDEX idx_claim_evidence_source_id ON claim_evidence(source_id);
CREATE INDEX idx_clips_platform_created_at ON clips(platform, created_at);
CREATE INDEX idx_research_dossiers_status ON research_dossiers(status);
CREATE INDEX idx_experiments_status_dates ON experiments(status, start_at, end_at);
CREATE INDEX idx_topics_book_id ON topics(book_id);
CREATE INDEX idx_topics_status_priority ON topics(status, priority_score DESC);
CREATE INDEX idx_content_briefs_experiment_id ON content_briefs(experiment_id);
CREATE INDEX idx_content_briefs_status ON content_briefs(status);
CREATE INDEX idx_drafts_generation_run_id ON drafts(generation_run_id);
CREATE INDEX idx_drafts_status_created_at ON drafts(status, created_at);
CREATE INDEX idx_quality_checks_draft_result ON quality_checks(draft_id, result);
CREATE INDEX idx_approvals_draft_id ON approvals(draft_id);
CREATE INDEX idx_approvals_decided_at ON approvals(decided_at);
CREATE INDEX idx_post_packages_status_planned_at
  ON post_packages(status, planned_publish_at);
CREATE INDEX idx_publications_manually_published_at ON publications(manually_published_at);
CREATE INDEX idx_metric_snapshots_captured_at ON metric_snapshots(captured_at);
CREATE INDEX idx_model_runs_status_started_at ON model_runs(status, started_at);
CREATE INDEX idx_model_runs_input_hash ON model_runs(input_hash);
CREATE INDEX idx_jobs_status_next_run_at ON jobs(status, next_run_at);
CREATE INDEX idx_cost_ledger_billing_month ON cost_ledger(billing_month);
CREATE INDEX idx_strategy_decisions_period ON strategy_decisions(period_start, period_end);
CREATE INDEX idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at);
CREATE INDEX idx_audit_events_created_at ON audit_events(created_at);
`;

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({
    name: 'initial_prd_schema',
    sql: INITIAL_SCHEMA,
    version: 1,
  }),
]);
