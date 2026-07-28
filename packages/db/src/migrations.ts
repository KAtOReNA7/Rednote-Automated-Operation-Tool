export interface Migration {
  readonly foreignKeysDisabled?: boolean;
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

const PERSISTENT_JOB_QUEUE = `
ALTER TABLE jobs RENAME TO jobs_issue007;
DROP INDEX idx_jobs_status_next_run_at;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  job_type TEXT NOT NULL CHECK (
    length(trim(job_type)) BETWEEN 1 AND 128
  ),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (
    length(trim(idempotency_key)) BETWEEN 1 AND 512
  ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_hash TEXT NOT NULL CHECK (length(trim(payload_hash)) > 0),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -1000 AND 1000),
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED',
    'RUNNING',
    'PAUSE_REQUESTED',
    'PAUSED',
    'CANCEL_REQUESTED',
    'RETRY_WAIT',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  next_run_at TEXT NOT NULL CHECK (next_run_at ${UTC_REQUIRED}),
  lock_owner TEXT CHECK (
    lock_owner IS NULL OR length(trim(lock_owner)) BETWEEN 1 AND 256
  ),
  lease_token TEXT CHECK (
    lease_token IS NULL OR length(trim(lease_token)) BETWEEN 1 AND 256
  ),
  lease_expires_at TEXT CHECK (
    lease_expires_at ${UTC_OPTIONAL} lease_expires_at ${UTC_REQUIRED}
  ),
  last_heartbeat_at TEXT CHECK (
    last_heartbeat_at ${UTC_OPTIONAL} last_heartbeat_at ${UTC_REQUIRED}
  ),
  pause_requested_at TEXT CHECK (
    pause_requested_at ${UTC_OPTIONAL} pause_requested_at ${UTC_REQUIRED}
  ),
  cancel_requested_at TEXT CHECK (
    cancel_requested_at ${UTC_OPTIONAL} cancel_requested_at ${UTC_REQUIRED}
  ),
  started_at TEXT CHECK (started_at ${UTC_OPTIONAL} started_at ${UTC_REQUIRED}),
  finished_at TEXT CHECK (finished_at ${UTC_OPTIONAL} finished_at ${UTC_REQUIRED}),
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR length(trim(last_error_code)) BETWEEN 1 AND 128
  ),
  last_error TEXT CHECK (
    last_error IS NULL OR length(last_error) <= 1000
  ),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CHECK (attempt_count <= max_attempts),
  CHECK (
    (
      status IN ('RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED') AND
      lock_owner IS NOT NULL AND
      lease_token IS NOT NULL AND
      lease_expires_at IS NOT NULL AND
      last_heartbeat_at IS NOT NULL
    ) OR (
      status NOT IN ('RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED') AND
      lock_owner IS NULL AND
      lease_token IS NULL AND
      lease_expires_at IS NULL AND
      last_heartbeat_at IS NULL
    )
  ),
  CHECK (
    (
      status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND
      finished_at IS NOT NULL
    ) OR (
      status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND
      finished_at IS NULL
    )
  )
) STRICT;

INSERT INTO jobs (
  id,
  job_type,
  idempotency_key,
  payload_json,
  payload_hash,
  priority,
  status,
  attempt_count,
  max_attempts,
  next_run_at,
  started_at,
  finished_at,
  last_error_code,
  last_error,
  created_at,
  updated_at,
  revision
)
SELECT
  id,
  job_type,
  'legacy:' || id,
  payload_json,
  'legacy:' || lower(hex(payload_json)),
  0,
  CASE
    WHEN status = 'RUNNING' AND attempt_count < max_attempts THEN 'RETRY_WAIT'
    WHEN status = 'RUNNING' THEN 'FAILED'
    WHEN status = 'PAUSE_REQUESTED' THEN 'PAUSED'
    WHEN status = 'CANCEL_REQUESTED' THEN 'CANCELLED'
    WHEN status IN (
      'QUEUED',
      'PAUSED',
      'RETRY_WAIT',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED'
    ) THEN status
    ELSE 'QUEUED'
  END,
  attempt_count,
  max_attempts,
  coalesce(next_run_at, created_at),
  locked_at,
  CASE
    WHEN status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'CANCEL_REQUESTED') THEN updated_at
    WHEN status = 'RUNNING' AND attempt_count >= max_attempts THEN updated_at
    ELSE NULL
  END,
  CASE WHEN last_error IS NULL THEN NULL ELSE 'LEGACY_ERROR' END,
  CASE WHEN last_error IS NULL THEN NULL ELSE substr(last_error, 1, 1000) END,
  created_at,
  updated_at,
  0
FROM jobs_issue007;

DROP TABLE jobs_issue007;

CREATE INDEX idx_jobs_claim
  ON jobs(priority DESC, next_run_at, created_at, id, status)
  WHERE status IN ('QUEUED', 'RETRY_WAIT');
CREATE INDEX idx_jobs_expired_lease
  ON jobs(lease_expires_at, id, status)
  WHERE status IN ('RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED');
CREATE INDEX idx_jobs_worker_status
  ON jobs(lock_owner, status);
CREATE INDEX idx_jobs_type_status
  ON jobs(job_type, status);
CREATE INDEX idx_jobs_created_at_id
  ON jobs(created_at, id);
CREATE INDEX idx_jobs_next_run_at_id
  ON jobs(next_run_at, id);
`;

const MANAGED_LOCAL_FILE_PATH_TRANSITION_GUARDS = `
CREATE TRIGGER validate_sources_local_snapshot_path_insert
BEFORE INSERT ON sources
WHEN NEW.local_snapshot_path IS NOT NULL AND NOT (
  typeof(NEW.local_snapshot_path) = 'text' AND
  length(NEW.local_snapshot_path) BETWEEN 1 AND 1024 AND
  instr(NEW.local_snapshot_path, char(0)) = 0 AND
  NEW.local_snapshot_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.local_snapshot_path, char(92)) = 0 AND
  instr(NEW.local_snapshot_path, ':') = 0 AND
  substr(NEW.local_snapshot_path, 1, 1) <> '/' AND
  substr(NEW.local_snapshot_path, -1, 1) <> '/' AND
  instr(NEW.local_snapshot_path, '//') = 0 AND
  instr(NEW.local_snapshot_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.local_snapshot_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.local_snapshot_path || '/') NOT GLOB '*/../*' AND
  NEW.local_snapshot_path GLOB 'sources/snapshots/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: sources.local_snapshot_path');
END;

CREATE TRIGGER validate_sources_local_snapshot_path_update
BEFORE UPDATE OF local_snapshot_path ON sources
WHEN NEW.local_snapshot_path IS NOT NULL AND NOT (
  typeof(NEW.local_snapshot_path) = 'text' AND
  length(NEW.local_snapshot_path) BETWEEN 1 AND 1024 AND
  instr(NEW.local_snapshot_path, char(0)) = 0 AND
  NEW.local_snapshot_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.local_snapshot_path, char(92)) = 0 AND
  instr(NEW.local_snapshot_path, ':') = 0 AND
  substr(NEW.local_snapshot_path, 1, 1) <> '/' AND
  substr(NEW.local_snapshot_path, -1, 1) <> '/' AND
  instr(NEW.local_snapshot_path, '//') = 0 AND
  instr(NEW.local_snapshot_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.local_snapshot_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.local_snapshot_path || '/') NOT GLOB '*/../*' AND
  NEW.local_snapshot_path GLOB 'sources/snapshots/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: sources.local_snapshot_path');
END;

CREATE TRIGGER validate_clips_screenshot_path_insert
BEFORE INSERT ON clips
WHEN NEW.screenshot_path IS NOT NULL AND NOT (
  typeof(NEW.screenshot_path) = 'text' AND
  length(NEW.screenshot_path) BETWEEN 1 AND 1024 AND
  instr(NEW.screenshot_path, char(0)) = 0 AND
  NEW.screenshot_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.screenshot_path, char(92)) = 0 AND
  instr(NEW.screenshot_path, ':') = 0 AND
  substr(NEW.screenshot_path, 1, 1) <> '/' AND
  substr(NEW.screenshot_path, -1, 1) <> '/' AND
  instr(NEW.screenshot_path, '//') = 0 AND
  instr(NEW.screenshot_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.screenshot_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.screenshot_path || '/') NOT GLOB '*/../*' AND
  NEW.screenshot_path GLOB 'sources/screenshots/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: clips.screenshot_path');
END;

CREATE TRIGGER validate_clips_screenshot_path_update
BEFORE UPDATE OF screenshot_path ON clips
WHEN NEW.screenshot_path IS NOT NULL AND NOT (
  typeof(NEW.screenshot_path) = 'text' AND
  length(NEW.screenshot_path) BETWEEN 1 AND 1024 AND
  instr(NEW.screenshot_path, char(0)) = 0 AND
  NEW.screenshot_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.screenshot_path, char(92)) = 0 AND
  instr(NEW.screenshot_path, ':') = 0 AND
  substr(NEW.screenshot_path, 1, 1) <> '/' AND
  substr(NEW.screenshot_path, -1, 1) <> '/' AND
  instr(NEW.screenshot_path, '//') = 0 AND
  instr(NEW.screenshot_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.screenshot_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.screenshot_path || '/') NOT GLOB '*/../*' AND
  NEW.screenshot_path GLOB 'sources/screenshots/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: clips.screenshot_path');
END;

CREATE TRIGGER validate_assets_original_path_insert
BEFORE INSERT ON assets
WHEN NEW.original_path IS NOT NULL AND NOT (
  typeof(NEW.original_path) = 'text' AND
  length(NEW.original_path) BETWEEN 1 AND 1024 AND
  instr(NEW.original_path, char(0)) = 0 AND
  NEW.original_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.original_path, char(92)) = 0 AND
  instr(NEW.original_path, ':') = 0 AND
  substr(NEW.original_path, 1, 1) <> '/' AND
  substr(NEW.original_path, -1, 1) <> '/' AND
  instr(NEW.original_path, '//') = 0 AND
  instr(NEW.original_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.original_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.original_path || '/') NOT GLOB '*/../*' AND
  NEW.original_path GLOB 'photos/originals/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: assets.original_path');
END;

CREATE TRIGGER validate_assets_original_path_update
BEFORE UPDATE OF original_path ON assets
WHEN NEW.original_path IS NOT NULL AND NOT (
  typeof(NEW.original_path) = 'text' AND
  length(NEW.original_path) BETWEEN 1 AND 1024 AND
  instr(NEW.original_path, char(0)) = 0 AND
  NEW.original_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.original_path, char(92)) = 0 AND
  instr(NEW.original_path, ':') = 0 AND
  substr(NEW.original_path, 1, 1) <> '/' AND
  substr(NEW.original_path, -1, 1) <> '/' AND
  instr(NEW.original_path, '//') = 0 AND
  instr(NEW.original_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.original_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.original_path || '/') NOT GLOB '*/../*' AND
  NEW.original_path GLOB 'photos/originals/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: assets.original_path');
END;

CREATE TRIGGER validate_assets_processed_path_insert
BEFORE INSERT ON assets
WHEN NEW.processed_path IS NOT NULL AND NOT (
  typeof(NEW.processed_path) = 'text' AND
  length(NEW.processed_path) BETWEEN 1 AND 1024 AND
  instr(NEW.processed_path, char(0)) = 0 AND
  NEW.processed_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.processed_path, char(92)) = 0 AND
  instr(NEW.processed_path, ':') = 0 AND
  substr(NEW.processed_path, 1, 1) <> '/' AND
  substr(NEW.processed_path, -1, 1) <> '/' AND
  instr(NEW.processed_path, '//') = 0 AND
  instr(NEW.processed_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.processed_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.processed_path || '/') NOT GLOB '*/../*' AND
  NEW.processed_path GLOB 'photos/processed/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: assets.processed_path');
END;

CREATE TRIGGER validate_assets_processed_path_update
BEFORE UPDATE OF processed_path ON assets
WHEN NEW.processed_path IS NOT NULL AND NOT (
  typeof(NEW.processed_path) = 'text' AND
  length(NEW.processed_path) BETWEEN 1 AND 1024 AND
  instr(NEW.processed_path, char(0)) = 0 AND
  NEW.processed_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.processed_path, char(92)) = 0 AND
  instr(NEW.processed_path, ':') = 0 AND
  substr(NEW.processed_path, 1, 1) <> '/' AND
  substr(NEW.processed_path, -1, 1) <> '/' AND
  instr(NEW.processed_path, '//') = 0 AND
  instr(NEW.processed_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.processed_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.processed_path || '/') NOT GLOB '*/../*' AND
  NEW.processed_path GLOB 'photos/processed/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: assets.processed_path');
END;

CREATE TRIGGER validate_post_packages_export_path_insert
BEFORE INSERT ON post_packages
WHEN NEW.export_path IS NOT NULL AND NOT (
  typeof(NEW.export_path) = 'text' AND
  length(NEW.export_path) BETWEEN 1 AND 1024 AND
  instr(NEW.export_path, char(0)) = 0 AND
  NEW.export_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.export_path, char(92)) = 0 AND
  instr(NEW.export_path, ':') = 0 AND
  substr(NEW.export_path, 1, 1) <> '/' AND
  substr(NEW.export_path, -1, 1) <> '/' AND
  instr(NEW.export_path, '//') = 0 AND
  instr(NEW.export_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.export_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.export_path || '/') NOT GLOB '*/../*' AND
  NEW.export_path GLOB 'exports/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: post_packages.export_path');
END;

CREATE TRIGGER validate_post_packages_export_path_update
BEFORE UPDATE OF export_path ON post_packages
WHEN NEW.export_path IS NOT NULL AND NOT (
  typeof(NEW.export_path) = 'text' AND
  length(NEW.export_path) BETWEEN 1 AND 1024 AND
  instr(NEW.export_path, char(0)) = 0 AND
  NEW.export_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.export_path, char(92)) = 0 AND
  instr(NEW.export_path, ':') = 0 AND
  substr(NEW.export_path, 1, 1) <> '/' AND
  substr(NEW.export_path, -1, 1) <> '/' AND
  instr(NEW.export_path, '//') = 0 AND
  instr(NEW.export_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.export_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.export_path || '/') NOT GLOB '*/../*' AND
  NEW.export_path GLOB 'exports/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: post_packages.export_path');
END;

CREATE TRIGGER validate_metric_snapshots_import_file_path_insert
BEFORE INSERT ON metric_snapshots
WHEN NEW.import_file_path IS NOT NULL AND NOT (
  typeof(NEW.import_file_path) = 'text' AND
  length(NEW.import_file_path) BETWEEN 1 AND 1024 AND
  instr(NEW.import_file_path, char(0)) = 0 AND
  NEW.import_file_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.import_file_path, char(92)) = 0 AND
  instr(NEW.import_file_path, ':') = 0 AND
  substr(NEW.import_file_path, 1, 1) <> '/' AND
  substr(NEW.import_file_path, -1, 1) <> '/' AND
  instr(NEW.import_file_path, '//') = 0 AND
  instr(NEW.import_file_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.import_file_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.import_file_path || '/') NOT GLOB '*/../*' AND
  NEW.import_file_path GLOB 'imports/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: metric_snapshots.import_file_path');
END;

CREATE TRIGGER validate_metric_snapshots_import_file_path_update
BEFORE UPDATE OF import_file_path ON metric_snapshots
WHEN NEW.import_file_path IS NOT NULL AND NOT (
  typeof(NEW.import_file_path) = 'text' AND
  length(NEW.import_file_path) BETWEEN 1 AND 1024 AND
  instr(NEW.import_file_path, char(0)) = 0 AND
  NEW.import_file_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
  instr(NEW.import_file_path, char(92)) = 0 AND
  instr(NEW.import_file_path, ':') = 0 AND
  substr(NEW.import_file_path, 1, 1) <> '/' AND
  substr(NEW.import_file_path, -1, 1) <> '/' AND
  instr(NEW.import_file_path, '//') = 0 AND
  instr(NEW.import_file_path, '/.rednote-tmp-') = 0 AND
  ('/' || NEW.import_file_path || '/') NOT GLOB '*/./*' AND
  ('/' || NEW.import_file_path || '/') NOT GLOB '*/../*' AND
  NEW.import_file_path GLOB 'imports/?*'
)
BEGIN
  SELECT RAISE(ABORT, 'managed local file path constraint: metric_snapshots.import_file_path');
END;
`;

const MANAGED_LOCAL_FILE_PATHS = `
${MANAGED_LOCAL_FILE_PATH_TRANSITION_GUARDS}

CREATE TABLE sources_issue008_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  url TEXT NOT NULL UNIQUE CHECK (length(trim(url)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  publisher_or_site TEXT,
  source_tier TEXT NOT NULL CHECK (length(trim(source_tier)) > 0),
  source_type TEXT NOT NULL CHECK (length(trim(source_type)) > 0),
  retrieved_at TEXT NOT NULL CHECK (retrieved_at ${UTC_REQUIRED}),
  content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
  local_snapshot_path TEXT CHECK (
    local_snapshot_path IS NULL OR (
      typeof(local_snapshot_path) = 'text' AND
      length(local_snapshot_path) BETWEEN 1 AND 1024 AND
      instr(local_snapshot_path, char(0)) = 0 AND
      local_snapshot_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
      instr(local_snapshot_path, char(92)) = 0 AND
      instr(local_snapshot_path, ':') = 0 AND
      substr(local_snapshot_path, 1, 1) <> '/' AND
      substr(local_snapshot_path, -1, 1) <> '/' AND
      instr(local_snapshot_path, '//') = 0 AND
      instr(local_snapshot_path, '/.rednote-tmp-') = 0 AND
      ('/' || local_snapshot_path || '/') NOT GLOB '*/./*' AND
      ('/' || local_snapshot_path || '/') NOT GLOB '*/../*' AND
      local_snapshot_path GLOB 'sources/snapshots/?*'
    )
  ),
  language TEXT NOT NULL CHECK (length(trim(language)) > 0),
  user_supplied INTEGER NOT NULL DEFAULT 0 CHECK (user_supplied IN (0, 1))
) STRICT;

INSERT INTO sources_issue008_new (
  id, url, title, publisher_or_site, source_tier, source_type, retrieved_at,
  content_hash, local_snapshot_path, language, user_supplied
)
SELECT
  id, url, title, publisher_or_site, source_tier, source_type, retrieved_at,
  content_hash, local_snapshot_path, language, user_supplied
FROM sources;

CREATE TABLE clips_issue008_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  url TEXT NOT NULL CHECK (length(trim(url)) > 0),
  platform TEXT NOT NULL CHECK (length(trim(platform)) > 0),
  account_name TEXT,
  page_title TEXT,
  published_at TEXT CHECK (published_at ${UTC_OPTIONAL} published_at ${UTC_REQUIRED}),
  selected_text TEXT,
  user_note TEXT,
  visible_metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(visible_metrics_json)),
  screenshot_path TEXT CHECK (
    screenshot_path IS NULL OR (
      typeof(screenshot_path) = 'text' AND
      length(screenshot_path) BETWEEN 1 AND 1024 AND
      instr(screenshot_path, char(0)) = 0 AND
      screenshot_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
      instr(screenshot_path, char(92)) = 0 AND
      instr(screenshot_path, ':') = 0 AND
      substr(screenshot_path, 1, 1) <> '/' AND
      substr(screenshot_path, -1, 1) <> '/' AND
      instr(screenshot_path, '//') = 0 AND
      instr(screenshot_path, '/.rednote-tmp-') = 0 AND
      ('/' || screenshot_path || '/') NOT GLOB '*/./*' AND
      ('/' || screenshot_path || '/') NOT GLOB '*/../*' AND
      screenshot_path GLOB 'sources/screenshots/?*'
    )
  ),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED})
) STRICT;

INSERT INTO clips_issue008_new (
  id, url, platform, account_name, page_title, published_at, selected_text, user_note,
  visible_metrics_json, screenshot_path, tags_json, created_at
)
SELECT
  id, url, platform, account_name, page_title, published_at, selected_text, user_note,
  visible_metrics_json, screenshot_path, tags_json, created_at
FROM clips;

CREATE TABLE assets_issue008_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  asset_type TEXT NOT NULL CHECK (length(trim(asset_type)) > 0),
  origin TEXT NOT NULL CHECK (length(trim(origin)) > 0),
  source_id TEXT REFERENCES sources(id) ON UPDATE CASCADE ON DELETE SET NULL,
  original_path TEXT CHECK (
    original_path IS NULL OR (
      typeof(original_path) = 'text' AND
      length(original_path) BETWEEN 1 AND 1024 AND
      instr(original_path, char(0)) = 0 AND
      original_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
      instr(original_path, char(92)) = 0 AND
      instr(original_path, ':') = 0 AND
      substr(original_path, 1, 1) <> '/' AND
      substr(original_path, -1, 1) <> '/' AND
      instr(original_path, '//') = 0 AND
      instr(original_path, '/.rednote-tmp-') = 0 AND
      ('/' || original_path || '/') NOT GLOB '*/./*' AND
      ('/' || original_path || '/') NOT GLOB '*/../*' AND
      original_path GLOB 'photos/originals/?*'
    )
  ),
  processed_path TEXT CHECK (
    processed_path IS NULL OR (
      typeof(processed_path) = 'text' AND
      length(processed_path) BETWEEN 1 AND 1024 AND
      instr(processed_path, char(0)) = 0 AND
      processed_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
      instr(processed_path, char(92)) = 0 AND
      instr(processed_path, ':') = 0 AND
      substr(processed_path, 1, 1) <> '/' AND
      substr(processed_path, -1, 1) <> '/' AND
      instr(processed_path, '//') = 0 AND
      instr(processed_path, '/.rednote-tmp-') = 0 AND
      ('/' || processed_path || '/') NOT GLOB '*/./*' AND
      ('/' || processed_path || '/') NOT GLOB '*/../*' AND
      processed_path GLOB 'photos/processed/?*'
    )
  ),
  mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
  generation_run_id TEXT REFERENCES model_runs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

INSERT INTO assets_issue008_new (
  id, asset_type, origin, source_id, original_path, processed_path, mime_type,
  width, height, content_hash, generation_run_id, metadata_json
)
SELECT
  id, asset_type, origin, source_id, original_path, processed_path, mime_type,
  width, height, content_hash, generation_run_id, metadata_json
FROM assets;

CREATE TABLE post_packages_issue008_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  draft_id TEXT NOT NULL UNIQUE REFERENCES drafts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  planned_publish_at TEXT
    CHECK (planned_publish_at ${UTC_OPTIONAL} planned_publish_at ${UTC_REQUIRED}),
  export_path TEXT CHECK (
    export_path IS NULL OR (
      typeof(export_path) = 'text' AND
      length(export_path) BETWEEN 1 AND 1024 AND
      instr(export_path, char(0)) = 0 AND
      export_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
      instr(export_path, char(92)) = 0 AND
      instr(export_path, ':') = 0 AND
      substr(export_path, 1, 1) <> '/' AND
      substr(export_path, -1, 1) <> '/' AND
      instr(export_path, '//') = 0 AND
      instr(export_path, '/.rednote-tmp-') = 0 AND
      ('/' || export_path || '/') NOT GLOB '*/./*' AND
      ('/' || export_path || '/') NOT GLOB '*/../*' AND
      export_path GLOB 'exports/?*'
    )
  ),
  manifest_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(manifest_json)),
  ai_disclosure INTEGER NOT NULL DEFAULT 0 CHECK (ai_disclosure = 0),
  exported_at TEXT CHECK (exported_at ${UTC_OPTIONAL} exported_at ${UTC_REQUIRED}),
  status TEXT NOT NULL ${CONTENT_STATUS_CHECK}
) STRICT;

INSERT INTO post_packages_issue008_new (
  id, draft_id, planned_publish_at, export_path, manifest_json, ai_disclosure,
  exported_at, status
)
SELECT
  id, draft_id, planned_publish_at, export_path, manifest_json, ai_disclosure,
  exported_at, status
FROM post_packages;

CREATE TABLE metric_snapshots_issue008_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON UPDATE CASCADE ON DELETE CASCADE,
  snapshot_window TEXT NOT NULL CHECK (length(trim(snapshot_window)) > 0),
  captured_at TEXT NOT NULL CHECK (captured_at ${UTC_REQUIRED}),
  source_method TEXT NOT NULL CHECK (length(trim(source_method)) > 0),
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  import_file_path TEXT CHECK (
    import_file_path IS NULL OR (
      typeof(import_file_path) = 'text' AND
      length(import_file_path) BETWEEN 1 AND 1024 AND
      instr(import_file_path, char(0)) = 0 AND
      import_file_path NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') AND
      instr(import_file_path, char(92)) = 0 AND
      instr(import_file_path, ':') = 0 AND
      substr(import_file_path, 1, 1) <> '/' AND
      substr(import_file_path, -1, 1) <> '/' AND
      instr(import_file_path, '//') = 0 AND
      instr(import_file_path, '/.rednote-tmp-') = 0 AND
      ('/' || import_file_path || '/') NOT GLOB '*/./*' AND
      ('/' || import_file_path || '/') NOT GLOB '*/../*' AND
      import_file_path GLOB 'imports/?*'
    )
  ),
  ocr_confidence REAL CHECK (ocr_confidence IS NULL OR ocr_confidence BETWEEN 0 AND 1),
  UNIQUE (publication_id, snapshot_window)
) STRICT;

INSERT INTO metric_snapshots_issue008_new (
  id, publication_id, snapshot_window, captured_at, source_method, metrics_json,
  import_file_path, ocr_confidence
)
SELECT
  id, publication_id, snapshot_window, captured_at, source_method, metrics_json,
  import_file_path, ocr_confidence
FROM metric_snapshots;

DROP TABLE sources;
DROP TABLE clips;
DROP TABLE assets;
DROP TABLE post_packages;
DROP TABLE metric_snapshots;

ALTER TABLE sources_issue008_new RENAME TO sources;
ALTER TABLE clips_issue008_new RENAME TO clips;
ALTER TABLE assets_issue008_new RENAME TO assets;
ALTER TABLE post_packages_issue008_new RENAME TO post_packages;
ALTER TABLE metric_snapshots_issue008_new RENAME TO metric_snapshots;

CREATE INDEX idx_sources_retrieved_at ON sources(retrieved_at);
CREATE INDEX idx_sources_content_hash ON sources(content_hash);
CREATE INDEX idx_clips_platform_created_at ON clips(platform, created_at);
CREATE INDEX idx_assets_source_id ON assets(source_id);
CREATE INDEX idx_assets_generation_run_id ON assets(generation_run_id);
CREATE INDEX idx_assets_content_hash ON assets(content_hash);
CREATE INDEX idx_post_packages_status_planned_at
  ON post_packages(status, planned_publish_at);
CREATE INDEX idx_metric_snapshots_captured_at ON metric_snapshots(captured_at);
`;

const LOCAL_SETTINGS_AND_CREDENTIAL_REFERENCE = `
CREATE TABLE app_settings (
  id TEXT PRIMARY KEY NOT NULL DEFAULT 'app' CHECK (id = 'app'),
  provider_protocol TEXT NOT NULL DEFAULT 'OPENAI_COMPATIBLE'
    CHECK (provider_protocol = 'OPENAI_COMPATIBLE'),
  provider_base_url TEXT CHECK (
    provider_base_url IS NULL OR (
      typeof(provider_base_url) = 'text' AND
      length(provider_base_url) BETWEEN 8 AND 2048 AND
      provider_base_url = trim(provider_base_url) AND
      provider_base_url NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*') AND
      instr(provider_base_url, '@') = 0 AND
      instr(provider_base_url, '?') = 0 AND
      instr(provider_base_url, '#') = 0 AND
      (
        lower(provider_base_url) GLOB 'https://?*' OR
        lower(provider_base_url) = 'http://localhost' OR
        lower(provider_base_url) GLOB 'http://localhost[:/]?*' OR
        lower(provider_base_url) = 'http://127.0.0.1' OR
        lower(provider_base_url) GLOB 'http://127.0.0.1[:/]?*' OR
        lower(provider_base_url) = 'http://[::1]' OR
        lower(provider_base_url) GLOB 'http://[[]::1[]][:/]?*'
      )
    )
  ),
  credential_reference TEXT
    CHECK (credential_reference IS NULL OR credential_reference = 'CONTENT_AI_API_KEY'),
  research_model_id TEXT CHECK (
    research_model_id IS NULL OR (
      typeof(research_model_id) = 'text' AND
      length(research_model_id) BETWEEN 1 AND 200 AND
      research_model_id = trim(research_model_id) AND
      research_model_id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
    )
  ),
  writing_model_id TEXT CHECK (
    writing_model_id IS NULL OR (
      typeof(writing_model_id) = 'text' AND
      length(writing_model_id) BETWEEN 1 AND 200 AND
      writing_model_id = trim(writing_model_id) AND
      writing_model_id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
    )
  ),
  review_model_id TEXT CHECK (
    review_model_id IS NULL OR (
      typeof(review_model_id) = 'text' AND
      length(review_model_id) BETWEEN 1 AND 200 AND
      review_model_id = trim(review_model_id) AND
      review_model_id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
    )
  ),
  embedding_model_id TEXT CHECK (
    embedding_model_id IS NULL OR (
      typeof(embedding_model_id) = 'text' AND
      length(embedding_model_id) BETWEEN 1 AND 200 AND
      embedding_model_id = trim(embedding_model_id) AND
      embedding_model_id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
    )
  ),
  image_model_id TEXT CHECK (
    image_model_id IS NULL OR (
      typeof(image_model_id) = 'text' AND
      length(image_model_id) BETWEEN 1 AND 200 AND
      image_model_id = trim(image_model_id) AND
      image_model_id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
    )
  ),
  monthly_warning_cents INTEGER NOT NULL DEFAULT 8000
    CHECK (typeof(monthly_warning_cents) = 'integer' AND monthly_warning_cents >= 0),
  monthly_hard_limit_cents INTEGER NOT NULL DEFAULT 10000
    CHECK (
      typeof(monthly_hard_limit_cents) = 'integer' AND
      monthly_hard_limit_cents > 0 AND
      monthly_hard_limit_cents <= 10000 AND
      monthly_warning_cents < monthly_hard_limit_cents
    ),
  setup_state TEXT NOT NULL DEFAULT 'LOCAL_PROJECT_READY' CHECK (setup_state IN (
    'LOCAL_PROJECT_READY',
    'PROVIDER_CONFIG_INCOMPLETE',
    'PROVIDER_CONFIGURED_UNVERIFIED',
    'CREDENTIAL_REAUTH_REQUIRED'
  )),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TRIGGER app_settings_revision_monotonic
BEFORE UPDATE ON app_settings
WHEN NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'app_settings revision must increase by one');
END;

CREATE TRIGGER app_settings_no_delete
BEFORE DELETE ON app_settings
BEGIN
  SELECT RAISE(ABORT, 'app_settings singleton cannot be deleted');
END;

CREATE TRIGGER account_profile_settings_insert_shape
BEFORE INSERT ON account_profiles
WHEN NEW.id = 'primary' AND (
  NEW.ownership <> 'PERSONAL' OR
  NEW.occupation_disclosure <> 'DEFERRED' OR
  (SELECT count(*) FROM json_each(NEW.tone_config_json)) <> 4 OR
  json_extract(NEW.tone_config_json, '$.schemaVersion') IS NOT 1 OR
  json_extract(NEW.tone_config_json, '$.voice') IS NOT '观点鲜明' OR
  json_extract(NEW.tone_config_json, '$.sentenceStyle') IS NOT '短句直接' OR
  json_extract(NEW.tone_config_json, '$.humor') IS NOT '少量冷幽默' OR
  (SELECT count(*) FROM json_each(NEW.content_scope_json)) <> 3 OR
  json_extract(NEW.content_scope_json, '$.schemaVersion') IS NOT 1 OR
  json_extract(NEW.content_scope_json, '$.focus') IS NOT '推理小说' OR
  json_type(NEW.content_scope_json, '$.excluded') IS NOT 'array' OR
  json_array_length(json_extract(NEW.content_scope_json, '$.excluded')) IS NOT 5 OR
  json_extract(NEW.content_scope_json, '$.excluded[0]') IS NOT '偶像' OR
  json_extract(NEW.content_scope_json, '$.excluded[1]') IS NOT '音乐' OR
  json_extract(NEW.content_scope_json, '$.excluded[2]') IS NOT '演唱会' OR
  json_extract(NEW.content_scope_json, '$.excluded[3]') IS NOT '泛娱乐' OR
  json_extract(NEW.content_scope_json, '$.excluded[4]') IS NOT '粉圈'
)
BEGIN
  SELECT RAISE(ABORT, 'primary account profile shape invalid');
END;

CREATE TRIGGER account_profile_settings_update_shape
BEFORE UPDATE ON account_profiles
WHEN NEW.id = 'primary' AND (
  NEW.ownership <> 'PERSONAL' OR
  NEW.occupation_disclosure <> 'DEFERRED' OR
  (SELECT count(*) FROM json_each(NEW.tone_config_json)) <> 4 OR
  json_extract(NEW.tone_config_json, '$.schemaVersion') IS NOT 1 OR
  json_extract(NEW.tone_config_json, '$.voice') IS NOT '观点鲜明' OR
  json_extract(NEW.tone_config_json, '$.sentenceStyle') IS NOT '短句直接' OR
  json_extract(NEW.tone_config_json, '$.humor') IS NOT '少量冷幽默' OR
  (SELECT count(*) FROM json_each(NEW.content_scope_json)) <> 3 OR
  json_extract(NEW.content_scope_json, '$.schemaVersion') IS NOT 1 OR
  json_extract(NEW.content_scope_json, '$.focus') IS NOT '推理小说' OR
  json_type(NEW.content_scope_json, '$.excluded') IS NOT 'array' OR
  json_array_length(json_extract(NEW.content_scope_json, '$.excluded')) IS NOT 5 OR
  json_extract(NEW.content_scope_json, '$.excluded[0]') IS NOT '偶像' OR
  json_extract(NEW.content_scope_json, '$.excluded[1]') IS NOT '音乐' OR
  json_extract(NEW.content_scope_json, '$.excluded[2]') IS NOT '演唱会' OR
  json_extract(NEW.content_scope_json, '$.excluded[3]') IS NOT '泛娱乐' OR
  json_extract(NEW.content_scope_json, '$.excluded[4]') IS NOT '粉圈'
)
BEGIN
  SELECT RAISE(ABORT, 'primary account profile shape invalid');
END;

INSERT INTO account_profiles (
  id, working_name, bio, occupation_disclosure, ownership,
  tone_config_json, content_scope_json
) VALUES (
  'primary',
  '未命名账号',
  '',
  'DEFERRED',
  'PERSONAL',
  '{"schemaVersion":1,"voice":"观点鲜明","sentenceStyle":"短句直接","humor":"少量冷幽默"}',
  '{"schemaVersion":1,"focus":"推理小说","excluded":["偶像","音乐","演唱会","泛娱乐","粉圈"]}'
)
ON CONFLICT(id) DO UPDATE SET
  occupation_disclosure = 'DEFERRED',
  ownership = 'PERSONAL',
  tone_config_json =
    '{"schemaVersion":1,"voice":"观点鲜明","sentenceStyle":"短句直接","humor":"少量冷幽默"}',
  content_scope_json =
    '{"schemaVersion":1,"focus":"推理小说","excluded":["偶像","音乐","演唱会","泛娱乐","粉圈"]}',
  updated_at = ${UTC_NOW};

INSERT INTO app_settings(id) VALUES ('app');
`;

const LOCAL_LOOPBACK_API_AND_PLUGIN_CLIENTS = `
CREATE TABLE local_api_settings (
  id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (typeof(enabled) = 'integer' AND enabled IN (0, 1)),
  port INTEGER NOT NULL DEFAULT 43119 CHECK (
    typeof(port) = 'integer' AND port BETWEEN 1024 AND 65535
  ),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TRIGGER local_api_settings_revision_monotonic
BEFORE UPDATE ON local_api_settings
WHEN NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'local_api_settings revision must increase by one');
END;

CREATE TRIGGER local_api_settings_no_delete
BEFORE DELETE ON local_api_settings
BEGIN
  SELECT RAISE(ABORT, 'local_api_settings singleton cannot be deleted');
END;

CREATE TABLE local_api_clients (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    typeof(id) = 'text' AND
    length(id) BETWEEN 8 AND 128 AND
    id = trim(id) AND
    id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
  ),
  extension_origin TEXT NOT NULL CHECK (
    typeof(extension_origin) = 'text' AND
    length(extension_origin) = 51 AND
    substr(extension_origin, 1, 19) = 'chrome-extension://' AND
    substr(extension_origin, 20) NOT GLOB '*[^a-p]*'
  ),
  client_label TEXT CHECK (
    client_label IS NULL OR (
      typeof(client_label) = 'text' AND
      length(client_label) BETWEEN 1 AND 120 AND
      client_label = trim(client_label) AND
      client_label NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
    )
  ),
  token_digest BLOB NOT NULL CHECK (
    typeof(token_digest) = 'blob' AND length(token_digest) = 32
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  last_used_at TEXT CHECK (last_used_at ${UTC_OPTIONAL} last_used_at ${UTC_REQUIRED}),
  revoked_at TEXT CHECK (revoked_at ${UTC_OPTIONAL} revoked_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  CHECK (updated_at >= created_at),
  CHECK (last_used_at IS NULL OR last_used_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) STRICT;

CREATE UNIQUE INDEX idx_local_api_clients_active_origin
  ON local_api_clients(extension_origin)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_local_api_clients_digest_active
  ON local_api_clients(token_digest, revoked_at);
CREATE INDEX idx_local_api_clients_active_created
  ON local_api_clients(revoked_at, created_at, id);

CREATE TRIGGER local_api_clients_revision_monotonic
BEFORE UPDATE ON local_api_clients
WHEN NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'local_api_clients revision must increase by one');
END;

CREATE TRIGGER local_api_clients_no_unrevoke
BEFORE UPDATE OF revoked_at ON local_api_clients
WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'local_api_clients cannot be unrevoked');
END;

INSERT INTO local_api_settings(id) VALUES (1);
`;

const PROVIDER_CAPABILITY_PROBING = `
ALTER TABLE app_settings
  ADD COLUMN credential_binding_version INTEGER NOT NULL DEFAULT 0
  CHECK (
    typeof(credential_binding_version) = 'integer' AND
    credential_binding_version >= 0
  );

CREATE TABLE provider_capability_probe_runs (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) BETWEEN 16 AND 128 AND
    id = trim(id) AND
    id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
  ),
  config_fingerprint TEXT NOT NULL CHECK (
    length(config_fingerprint) = 64 AND
    config_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  settings_revision INTEGER NOT NULL CHECK (
    typeof(settings_revision) = 'integer' AND settings_revision >= 0
  ),
  credential_binding_version INTEGER NOT NULL CHECK (
    typeof(credential_binding_version) = 'integer' AND credential_binding_version >= 0
  ),
  contract_version TEXT NOT NULL CHECK (
    contract_version = 'provider-capabilities-v1'
  ),
  profile TEXT NOT NULL CHECK (profile IN ('CORE', 'FULL', 'CUSTOM')),
  plan_hash TEXT NOT NULL CHECK (
    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  planned_request_count INTEGER NOT NULL CHECK (
    typeof(planned_request_count) = 'integer' AND
    planned_request_count BETWEEN 1 AND 32
  ),
  sent_request_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(sent_request_count) = 'integer' AND
    sent_request_count BETWEEN 0 AND 32 AND
    sent_request_count <= planned_request_count
  ),
  status TEXT NOT NULL CHECK (
    status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED')
  ),
  reason_code TEXT CHECK (
    reason_code IS NULL OR reason_code IN (
      'NOT_PROBED', 'USER_SKIPPED', 'CONFIG_STALE',
      'AUTHENTICATION_REJECTED', 'PERMISSION_REJECTED', 'RATE_LIMITED',
      'QUOTA_UNAVAILABLE', 'NETWORK_UNREACHABLE', 'TLS_FAILURE', 'TIMEOUT',
      'ABORTED', 'ENDPOINT_EXPLICITLY_UNSUPPORTED',
      'MODEL_EXPLICITLY_UNSUPPORTED', 'PROTOCOL_EXPLICITLY_UNSUPPORTED',
      'INVALID_CONTENT_TYPE', 'INVALID_RESPONSE', 'INVALID_JSON',
      'SCHEMA_MISMATCH', 'TOOL_NOT_OBSERVED', 'SEARCH_NOT_OBSERVED',
      'VISION_INCONCLUSIVE', 'OUTPUT_VARIANT_UNSUPPORTED',
      'USAGE_NOT_REPORTED', 'METADATA_NOT_REPORTED', 'AMBIGUOUS_OUTCOME',
      'INTERNAL_ERROR'
    )
  ),
  started_at TEXT NOT NULL CHECK (started_at ${UTC_REQUIRED}),
  completed_at TEXT CHECK (
    completed_at ${UTC_OPTIONAL} completed_at ${UTC_REQUIRED}
  ),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  CHECK (
    (status = 'RUNNING' AND completed_at IS NULL) OR
    (status <> 'RUNNING' AND completed_at IS NOT NULL)
  ),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
) STRICT;

CREATE TABLE provider_capability_entries (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) BETWEEN 16 AND 256 AND
    id = trim(id) AND
    id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
  ),
  run_id TEXT NOT NULL
    REFERENCES provider_capability_probe_runs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  config_fingerprint TEXT NOT NULL CHECK (
    length(config_fingerprint) = 64 AND
    config_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  settings_revision INTEGER NOT NULL CHECK (
    typeof(settings_revision) = 'integer' AND settings_revision >= 0
  ),
  credential_binding_version INTEGER NOT NULL CHECK (
    typeof(credential_binding_version) = 'integer' AND credential_binding_version >= 0
  ),
  contract_version TEXT NOT NULL CHECK (
    contract_version = 'provider-capabilities-v1'
  ),
  model_slot TEXT NOT NULL CHECK (
    model_slot IN ('PROVIDER', 'RESEARCH', 'WRITING', 'REVIEW', 'IMAGE')
  ),
  model_id TEXT CHECK (
    model_id IS NULL OR (
      length(model_id) BETWEEN 1 AND 256 AND
      model_id = trim(model_id) AND
      model_id NOT GLOB ('*[' || char(0) || '-' || char(31) || char(127) || ']*')
    )
  ),
  protocol_mode TEXT NOT NULL CHECK (
    protocol_mode IN ('RESPONSES', 'CHAT_COMPLETIONS', 'NOT_APPLICABLE')
  ),
  capability TEXT NOT NULL CHECK (
    capability IN (
      'batch', 'imageGeneration', 'streaming', 'structuredJson', 'text',
      'toolCalling', 'usage', 'vision', 'webSearch'
    )
  ),
  state TEXT NOT NULL CHECK (state IN ('UNKNOWN', 'SUPPORTED', 'UNSUPPORTED')),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'NOT_PROBED', 'USER_SKIPPED', 'CONFIG_STALE',
      'AUTHENTICATION_REJECTED', 'PERMISSION_REJECTED', 'RATE_LIMITED',
      'QUOTA_UNAVAILABLE', 'NETWORK_UNREACHABLE', 'TLS_FAILURE', 'TIMEOUT',
      'ABORTED', 'ENDPOINT_EXPLICITLY_UNSUPPORTED',
      'MODEL_EXPLICITLY_UNSUPPORTED', 'PROTOCOL_EXPLICITLY_UNSUPPORTED',
      'INVALID_CONTENT_TYPE', 'INVALID_RESPONSE', 'INVALID_JSON',
      'SCHEMA_MISMATCH', 'TOOL_NOT_OBSERVED', 'SEARCH_NOT_OBSERVED',
      'VISION_INCONCLUSIVE', 'OUTPUT_VARIANT_UNSUPPORTED',
      'USAGE_NOT_REPORTED', 'METADATA_NOT_REPORTED', 'AMBIGUOUS_OUTCOME',
      'INTERNAL_ERROR'
    )
  ),
  source TEXT NOT NULL CHECK (source IN ('PROBED', 'METADATA', 'NOT_PROBED')),
  confidence TEXT NOT NULL CHECK (confidence IN ('CONFIRMED', 'INCONCLUSIVE')),
  stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
  safe_details_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(safe_details_json) AND json_type(safe_details_json) = 'object' AND
    length(safe_details_json) <= 2048
  ),
  max_context_tokens INTEGER CHECK (
    max_context_tokens IS NULL OR (
      typeof(max_context_tokens) = 'integer' AND max_context_tokens > 0
    )
  ),
  rate_limit_requests INTEGER CHECK (
    rate_limit_requests IS NULL OR (
      typeof(rate_limit_requests) = 'integer' AND rate_limit_requests >= 0
    )
  ),
  rate_limit_tokens INTEGER CHECK (
    rate_limit_tokens IS NULL OR (
      typeof(rate_limit_tokens) = 'integer' AND rate_limit_tokens >= 0
    )
  ),
  observed_at TEXT CHECK (
    observed_at ${UTC_OPTIONAL} observed_at ${UTC_REQUIRED}
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  CHECK (
    (source = 'NOT_PROBED' AND observed_at IS NULL) OR
    (source <> 'NOT_PROBED' AND observed_at IS NOT NULL)
  ),
  UNIQUE(run_id, model_slot, protocol_mode, capability)
) STRICT;

CREATE INDEX idx_provider_capability_runs_current
  ON provider_capability_probe_runs(
    config_fingerprint, credential_binding_version, status, completed_at DESC
  );
CREATE INDEX idx_provider_capability_entries_current
  ON provider_capability_entries(
    config_fingerprint, credential_binding_version, stale, run_id
  );
CREATE INDEX idx_provider_capability_entries_run
  ON provider_capability_entries(run_id);
`;

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({
    name: 'initial_prd_schema',
    sql: INITIAL_SCHEMA,
    version: 1,
  }),
  Object.freeze({
    name: 'persistent_local_job_queue',
    sql: PERSISTENT_JOB_QUEUE,
    version: 2,
  }),
  Object.freeze({
    foreignKeysDisabled: true,
    name: 'managed_local_file_paths',
    sql: MANAGED_LOCAL_FILE_PATHS,
    version: 3,
  }),
  Object.freeze({
    name: 'local_settings_and_credential_reference',
    sql: LOCAL_SETTINGS_AND_CREDENTIAL_REFERENCE,
    version: 4,
  }),
  Object.freeze({
    name: 'local_loopback_api_and_plugin_clients',
    sql: LOCAL_LOOPBACK_API_AND_PLUGIN_CLIENTS,
    version: 5,
  }),
  Object.freeze({
    name: 'provider_capability_probing',
    sql: PROVIDER_CAPABILITY_PROBING,
    version: 6,
  }),
]);
