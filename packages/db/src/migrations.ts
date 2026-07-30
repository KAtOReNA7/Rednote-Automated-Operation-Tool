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

function optionalAsciiDecimal(column: string): string {
  return `(
    ${column} IS NULL OR (
      length(${column}) BETWEEN 1 AND 48 AND
      ${column} NOT GLOB '*[^0-9.]*' AND
      ${column} NOT LIKE '.%' AND ${column} NOT LIKE '%.' AND
      ${column} NOT LIKE '%..%' AND
      (instr(${column}, '.') = 0 OR (
        instr(substr(${column}, instr(${column}, '.') + 1), '.') = 0 AND
        length(substr(${column}, instr(${column}, '.') + 1)) BETWEEN 1 AND 12
      )) AND
      (${column} = '0' OR ${column} LIKE '0.%' OR ${column} NOT LIKE '0%')
    )
  )`;
}

const MODEL_EXECUTION_CACHE_AND_COST_LEDGER = `
CREATE TABLE model_runs_issue014_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND id = trim(id)),
  execution_id TEXT NOT NULL UNIQUE CHECK (
    length(execution_id) BETWEEN 1 AND 128 AND execution_id = trim(execution_id)
  ),
  job_id TEXT CHECK (job_id IS NULL OR length(job_id) BETWEEN 1 AND 128),
  task_kind TEXT NOT NULL CHECK (length(task_kind) BETWEEN 1 AND 64),
  model_role TEXT NOT NULL CHECK (length(model_role) BETWEEN 1 AND 64),
  model_slot TEXT NOT NULL CHECK (length(model_slot) BETWEEN 1 AND 64),
  provider_config_fingerprint TEXT NOT NULL CHECK (
    length(provider_config_fingerprint) = 64 AND
    provider_config_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 256),
  protocol_mode TEXT NOT NULL CHECK (protocol_mode IN (
    'RESPONSES', 'CHAT_COMPLETIONS', 'IMAGES_GENERATIONS', 'MOCK', 'LEGACY'
  )),
  prompt_template_id TEXT NOT NULL CHECK (length(prompt_template_id) BETWEEN 1 AND 128),
  prompt_version INTEGER NOT NULL CHECK (typeof(prompt_version) = 'integer' AND prompt_version > 0),
  prompt_content_hash TEXT NOT NULL CHECK (length(prompt_content_hash) BETWEEN 1 AND 128),
  input_hash TEXT NOT NULL CHECK (length(input_hash) BETWEEN 1 AND 128),
  cache_key TEXT NOT NULL CHECK (
    length(cache_key) = 64 AND cache_key NOT GLOB '*[^0-9a-f]*'
  ),
  cache_entry_id TEXT
    REFERENCES model_cache_entries(id) ON UPDATE CASCADE ON DELETE SET NULL,
  output_hash TEXT CHECK (output_hash IS NULL OR length(output_hash) = 64),
  local_cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (local_cache_hit IN (0, 1)),
  cache_policy TEXT NOT NULL CHECK (cache_policy IN (
    'READ_WRITE', 'READ_ONLY', 'BYPASS', 'REFRESH', 'LEGACY'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'PLANNED', 'BUDGET_BLOCKED', 'CAPABILITY_BLOCKED', 'CACHE_HIT', 'IN_FLIGHT',
    'SUCCEEDED', 'FAILED', 'CANCELLED', 'AMBIGUOUS', 'CORRUPT'
  )),
  outcome_certainty TEXT NOT NULL CHECK (outcome_certainty IN (
    'NOT_SENT', 'REJECTED_BEFORE_EXECUTION', 'MAY_HAVE_EXECUTED', 'COMPLETED_INVALID_OUTPUT'
  )),
  external_request_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(external_request_count) = 'integer' AND external_request_count BETWEEN 0 AND 32
  ),
  usage_input_tokens INTEGER CHECK (usage_input_tokens IS NULL OR usage_input_tokens >= 0),
  usage_output_tokens INTEGER CHECK (usage_output_tokens IS NULL OR usage_output_tokens >= 0),
  usage_total_tokens INTEGER CHECK (usage_total_tokens IS NULL OR usage_total_tokens >= 0),
  usage_cached_input_tokens INTEGER CHECK (
    usage_cached_input_tokens IS NULL OR usage_cached_input_tokens >= 0
  ),
  usage_cache_write_tokens INTEGER CHECK (
    usage_cache_write_tokens IS NULL OR usage_cache_write_tokens >= 0
  ),
  usage_reasoning_tokens INTEGER CHECK (
    usage_reasoning_tokens IS NULL OR usage_reasoning_tokens >= 0
  ),
  usage_images INTEGER CHECK (usage_images IS NULL OR usage_images >= 0),
  usage_image_generation_calls INTEGER CHECK (
    usage_image_generation_calls IS NULL OR usage_image_generation_calls >= 0
  ),
  usage_web_search_calls INTEGER CHECK (
    usage_web_search_calls IS NULL OR usage_web_search_calls >= 0
  ),
  usage_tool_calls INTEGER CHECK (usage_tool_calls IS NULL OR usage_tool_calls >= 0),
  cost_state TEXT NOT NULL CHECK (cost_state IN (
    'PROVIDER_REPORTED_USD', 'USER_PRICE_TABLE_ESTIMATE', 'UNPRICED_USAGE',
    'UNKNOWN_POSSIBLY_INCURRED', 'NOT_INCURRED'
  )),
  cost_source TEXT CHECK (cost_source IS NULL OR length(cost_source) BETWEEN 1 AND 64),
  cost_amount_microusd INTEGER CHECK (
    cost_amount_microusd IS NULL OR
    (typeof(cost_amount_microusd) = 'integer' AND cost_amount_microusd >= 0)
  ),
  price_schedule_version INTEGER CHECK (
    price_schedule_version IS NULL OR price_schedule_version > 0
  ),
  stable_error_code TEXT CHECK (
    stable_error_code IS NULL OR length(stable_error_code) BETWEEN 1 AND 96
  ),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  started_at TEXT NOT NULL CHECK (started_at ${UTC_REQUIRED}),
  finished_at TEXT CHECK (finished_at ${UTC_OPTIONAL} finished_at ${UTC_REQUIRED}),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  CHECK (
    (status IN ('PLANNED', 'IN_FLIGHT') AND finished_at IS NULL) OR
    (status NOT IN ('PLANNED', 'IN_FLIGHT') AND finished_at IS NOT NULL)
  )
) STRICT;

INSERT INTO model_runs_issue014_new (
  id, execution_id, task_kind, model_role, model_slot, provider_config_fingerprint,
  model_id, protocol_mode, prompt_template_id, prompt_version, prompt_content_hash,
  input_hash, cache_key, output_hash, local_cache_hit, cache_policy, status,
  outcome_certainty, external_request_count, usage_input_tokens, usage_output_tokens,
  usage_images, cost_state, cost_source, cost_amount_microusd, started_at, finished_at,
  created_at, updated_at, revision
)
SELECT
  id,
  'legacy:' || id,
  'LEGACY',
  substr(role, 1, 64),
  'LEGACY',
  '0000000000000000000000000000000000000000000000000000000000000000',
  substr(model, 1, 256),
  'LEGACY',
  'legacy',
  1,
  substr(input_hash, 1, 128),
  substr(input_hash, 1, 128),
  '0000000000000000000000000000000000000000000000000000000000000000',
  CASE WHEN output_hash IS NULL THEN NULL ELSE substr(output_hash, 1, 64) END,
  cached,
  'LEGACY',
  CASE
    WHEN completed_at IS NULL THEN 'AMBIGUOUS'
    WHEN status IN ('CANCELLED', 'FAILED', 'SUCCEEDED') THEN status
    ELSE 'SUCCEEDED'
  END,
  CASE WHEN completed_at IS NULL THEN 'MAY_HAVE_EXECUTED' ELSE 'COMPLETED_INVALID_OUTPUT' END,
  CASE WHEN cached = 1 THEN 0 ELSE 1 END,
  input_tokens,
  output_tokens,
  image_count,
  CASE
    WHEN cached = 1 THEN 'NOT_INCURRED'
    WHEN estimated_cost_usd IS NULL THEN 'UNPRICED_USAGE'
    ELSE 'USER_PRICE_TABLE_ESTIMATE'
  END,
  CASE WHEN estimated_cost_usd IS NULL THEN NULL ELSE 'LEGACY_ESTIMATE' END,
  CASE
    WHEN estimated_cost_usd IS NULL THEN NULL
    ELSE CAST(round(estimated_cost_usd * 1000000.0) AS INTEGER)
  END,
  started_at,
  completed_at,
  started_at,
  coalesce(completed_at, started_at),
  0
FROM model_runs;

CREATE TABLE model_cache_entries (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  cache_key TEXT NOT NULL UNIQUE CHECK (
    length(cache_key) = 64 AND cache_key NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'IN_FLIGHT', 'READY', 'CORRUPT', 'EVICTED', 'AMBIGUOUS'
  )),
  output_type TEXT CHECK (output_type IS NULL OR output_type IN (
    'TEXT', 'STRUCTURED', 'VISION', 'IMAGE'
  )),
  managed_relative_path TEXT CHECK (
    managed_relative_path IS NULL OR (
      length(managed_relative_path) BETWEEN 86 AND 1024 AND
      managed_relative_path GLOB 'cache/model-results/?*' AND
      managed_relative_path NOT LIKE '/%' AND
      managed_relative_path NOT LIKE '%\\%' AND
      managed_relative_path NOT LIKE '%:%' AND
      ('/' || managed_relative_path || '/') NOT GLOB '*/./*' AND
      ('/' || managed_relative_path || '/') NOT GLOB '*/../*'
    )
  ),
  content_hash TEXT CHECK (
    content_hash IS NULL OR
    (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*')
  ),
  output_hash TEXT CHECK (
    output_hash IS NULL OR
    (length(output_hash) = 64 AND output_hash NOT GLOB '*[^0-9a-f]*')
  ),
  size_bytes INTEGER CHECK (
    size_bytes IS NULL OR (typeof(size_bytes) = 'integer' AND size_bytes BETWEEN 1 AND 16777216)
  ),
  format_version INTEGER NOT NULL DEFAULT 1 CHECK (format_version = 1),
  owner_token_hash TEXT CHECK (
    owner_token_hash IS NULL OR
    (length(owner_token_hash) = 64 AND owner_token_hash NOT GLOB '*[^0-9a-f]*')
  ),
  lease_expires_at TEXT CHECK (
    lease_expires_at ${UTC_OPTIONAL} lease_expires_at ${UTC_REQUIRED}
  ),
  last_heartbeat_at TEXT CHECK (
    last_heartbeat_at ${UTC_OPTIONAL} last_heartbeat_at ${UTC_REQUIRED}
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  CHECK (
    (status = 'IN_FLIGHT' AND owner_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (status <> 'IN_FLIGHT' AND owner_token_hash IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status = 'READY' AND managed_relative_path IS NOT NULL AND content_hash IS NOT NULL AND
      output_hash IS NOT NULL AND size_bytes IS NOT NULL AND output_type IS NOT NULL) OR
    status <> 'READY'
  )
) STRICT;

CREATE TABLE model_price_schedules (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  provider_config_fingerprint TEXT NOT NULL CHECK (
    length(provider_config_fingerprint) = 64 AND
    provider_config_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 256),
  operation_kind TEXT NOT NULL CHECK (length(operation_kind) BETWEEN 1 AND 64),
  protocol_mode TEXT CHECK (protocol_mode IS NULL OR length(protocol_mode) BETWEEN 1 AND 32),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  usage_semantics_version TEXT NOT NULL CHECK (
    length(usage_semantics_version) BETWEEN 1 AND 64
  ),
  input_tokens_include_cached INTEGER NOT NULL CHECK (
    input_tokens_include_cached IN (0, 1)
  ),
  input_per_million_usd TEXT,
  output_per_million_usd TEXT,
  cached_input_per_million_usd TEXT,
  cache_write_per_million_usd TEXT,
  image_usd TEXT,
  image_generation_call_usd TEXT,
  web_search_call_usd TEXT,
  tool_unit_usd TEXT,
  call_usd TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  effective_at TEXT NOT NULL CHECK (effective_at ${UTC_REQUIRED}),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  UNIQUE(provider_config_fingerprint, model_id, operation_kind, protocol_mode, version),
  CHECK (
    ${optionalAsciiDecimal('input_per_million_usd')} AND
    ${optionalAsciiDecimal('output_per_million_usd')} AND
    ${optionalAsciiDecimal('cached_input_per_million_usd')} AND
    ${optionalAsciiDecimal('cache_write_per_million_usd')} AND
    ${optionalAsciiDecimal('image_usd')} AND
    ${optionalAsciiDecimal('image_generation_call_usd')} AND
    ${optionalAsciiDecimal('web_search_call_usd')} AND
    ${optionalAsciiDecimal('tool_unit_usd')} AND
    ${optionalAsciiDecimal('call_usd')}
  )
) STRICT;

CREATE TRIGGER model_price_schedule_immutable
BEFORE UPDATE ON model_price_schedules
WHEN
  NEW.provider_config_fingerprint <> OLD.provider_config_fingerprint OR
  NEW.model_id <> OLD.model_id OR
  NEW.operation_kind <> OLD.operation_kind OR
  NEW.protocol_mode IS NOT OLD.protocol_mode OR
  NEW.version <> OLD.version OR
  NEW.currency <> OLD.currency OR
  NEW.usage_semantics_version <> OLD.usage_semantics_version OR
  NEW.input_tokens_include_cached <> OLD.input_tokens_include_cached OR
  NEW.input_per_million_usd IS NOT OLD.input_per_million_usd OR
  NEW.output_per_million_usd IS NOT OLD.output_per_million_usd OR
  NEW.cached_input_per_million_usd IS NOT OLD.cached_input_per_million_usd OR
  NEW.cache_write_per_million_usd IS NOT OLD.cache_write_per_million_usd OR
  NEW.image_usd IS NOT OLD.image_usd OR
  NEW.image_generation_call_usd IS NOT OLD.image_generation_call_usd OR
  NEW.web_search_call_usd IS NOT OLD.web_search_call_usd OR
  NEW.tool_unit_usd IS NOT OLD.tool_unit_usd OR
  NEW.call_usd IS NOT OLD.call_usd OR
  NEW.effective_at <> OLD.effective_at OR
  NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'model price schedule versions are immutable');
END;

CREATE TABLE model_unit_budget_policies (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('GLOBAL', 'TASK_KIND', 'MODEL_ROLE')),
  scope_value TEXT CHECK (
    (scope_kind = 'GLOBAL' AND scope_value IS NULL) OR
    (scope_kind <> 'GLOBAL' AND length(scope_value) BETWEEN 1 AND 64)
  ),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version > 0),
  max_external_calls_monthly INTEGER NOT NULL CHECK (max_external_calls_monthly > 0),
  max_external_calls_weekly INTEGER NOT NULL CHECK (max_external_calls_weekly > 0),
  max_input_tokens INTEGER CHECK (max_input_tokens IS NULL OR max_input_tokens >= 0),
  max_output_tokens INTEGER CHECK (max_output_tokens IS NULL OR max_output_tokens >= 0),
  max_images INTEGER CHECK (max_images IS NULL OR max_images >= 0),
  max_image_generation_calls INTEGER CHECK (
    max_image_generation_calls IS NULL OR max_image_generation_calls >= 0
  ),
  max_web_search_calls INTEGER CHECK (
    max_web_search_calls IS NULL OR max_web_search_calls >= 0
  ),
  max_tool_calls INTEGER CHECK (max_tool_calls IS NULL OR max_tool_calls >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  UNIQUE(scope_kind, scope_value, version)
) STRICT;

CREATE TRIGGER model_unit_budget_policy_immutable
BEFORE UPDATE ON model_unit_budget_policies
WHEN
  NEW.scope_kind <> OLD.scope_kind OR
  NEW.scope_value IS NOT OLD.scope_value OR
  NEW.version <> OLD.version OR
  NEW.max_external_calls_monthly <> OLD.max_external_calls_monthly OR
  NEW.max_external_calls_weekly <> OLD.max_external_calls_weekly OR
  NEW.max_input_tokens IS NOT OLD.max_input_tokens OR
  NEW.max_output_tokens IS NOT OLD.max_output_tokens OR
  NEW.max_images IS NOT OLD.max_images OR
  NEW.max_image_generation_calls IS NOT OLD.max_image_generation_calls OR
  NEW.max_web_search_calls IS NOT OLD.max_web_search_calls OR
  NEW.max_tool_calls IS NOT OLD.max_tool_calls OR
  NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'model unit policy versions are immutable');
END;

CREATE TABLE model_budget_reservations (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL UNIQUE
    REFERENCES model_runs_issue014_new(execution_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  model_run_id TEXT NOT NULL UNIQUE
    REFERENCES model_runs_issue014_new(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  billing_month TEXT NOT NULL CHECK (billing_month GLOB '????-??'),
  week_key TEXT NOT NULL CHECK (week_key GLOB '????-W??'),
  task_kind TEXT NOT NULL CHECK (length(task_kind) BETWEEN 1 AND 64),
  status TEXT NOT NULL CHECK (status IN (
    'ACTIVE', 'SETTLED', 'RELEASED_BEFORE_SEND', 'UNCERTAIN_COMMITTED',
    'EXPIRED_SAFE', 'CANCELLED_BEFORE_SEND'
  )),
  reserved_amount_microusd INTEGER CHECK (
    reserved_amount_microusd IS NULL OR
    (typeof(reserved_amount_microusd) = 'integer' AND reserved_amount_microusd >= 0)
  ),
  unit_demand_json TEXT NOT NULL CHECK (
    json_valid(unit_demand_json) AND length(unit_demand_json) BETWEEN 2 AND 8192
  ),
  sent_state TEXT NOT NULL CHECK (sent_state IN ('NOT_SENT', 'SENT', 'UNKNOWN')),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  settled_at TEXT CHECK (settled_at ${UTC_OPTIONAL} settled_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0)
) STRICT;

CREATE TABLE cost_ledger_issue014_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  settlement_identity TEXT NOT NULL UNIQUE CHECK (
    length(settlement_identity) BETWEEN 1 AND 160
  ),
  execution_id TEXT NOT NULL UNIQUE
    REFERENCES model_runs_issue014_new(execution_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  model_run_id TEXT NOT NULL UNIQUE
    REFERENCES model_runs_issue014_new(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  entry_kind TEXT NOT NULL DEFAULT 'SETTLEMENT' CHECK (
    entry_kind IN ('SETTLEMENT', 'ADJUSTMENT')
  ),
  adjustment_of_id TEXT
    REFERENCES cost_ledger_issue014_new(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  adjustment_reason TEXT CHECK (
    adjustment_reason IS NULL OR adjustment_reason IN ('CORRECTION', 'PROVIDER_CREDIT')
  ),
  billing_month TEXT NOT NULL CHECK (billing_month GLOB '????-??'),
  provider_config_fingerprint TEXT NOT NULL CHECK (
    length(provider_config_fingerprint) = 64 AND
    provider_config_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 256),
  operation_kind TEXT NOT NULL CHECK (length(operation_kind) BETWEEN 1 AND 64),
  cost_state TEXT NOT NULL CHECK (cost_state IN (
    'PROVIDER_REPORTED_USD', 'USER_PRICE_TABLE_ESTIMATE', 'UNPRICED_USAGE',
    'UNKNOWN_POSSIBLY_INCURRED'
  )),
  cost_source TEXT NOT NULL CHECK (length(cost_source) BETWEEN 1 AND 64),
  amount_microusd INTEGER CHECK (
    amount_microusd IS NULL OR
    (typeof(amount_microusd) = 'integer' AND amount_microusd >= 0)
  ),
  comparison_estimate_microusd INTEGER CHECK (
    comparison_estimate_microusd IS NULL OR
    (typeof(comparison_estimate_microusd) = 'integer' AND comparison_estimate_microusd >= 0)
  ),
  price_schedule_id TEXT
    REFERENCES model_price_schedules(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price_schedule_version INTEGER CHECK (
    price_schedule_version IS NULL OR price_schedule_version > 0
  ),
  usage_summary_json TEXT NOT NULL CHECK (
    json_valid(usage_summary_json) AND length(usage_summary_json) BETWEEN 2 AND 8192
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  CHECK (
    (entry_kind = 'SETTLEMENT' AND adjustment_of_id IS NULL AND adjustment_reason IS NULL) OR
    (entry_kind = 'ADJUSTMENT' AND adjustment_of_id IS NOT NULL AND adjustment_reason IS NOT NULL)
  ),
  CHECK (
    (cost_state IN ('UNPRICED_USAGE', 'UNKNOWN_POSSIBLY_INCURRED') AND amount_microusd IS NULL) OR
    (cost_state NOT IN ('UNPRICED_USAGE', 'UNKNOWN_POSSIBLY_INCURRED') AND amount_microusd IS NOT NULL)
  )
) STRICT;

INSERT INTO cost_ledger_issue014_new (
  id, settlement_identity, execution_id, model_run_id, billing_month,
  provider_config_fingerprint, model_id, operation_kind, cost_state, cost_source,
  amount_microusd, usage_summary_json, created_at
)
SELECT
  ledger.id,
  'legacy:' || ledger.id,
  'legacy:' || ledger.model_run_id,
  ledger.model_run_id,
  ledger.billing_month,
  '0000000000000000000000000000000000000000000000000000000000000000',
  substr(runs.model, 1, 256),
  'LEGACY',
  'USER_PRICE_TABLE_ESTIMATE',
  'LEGACY_ESTIMATE',
  CAST(round(ledger.amount_usd * 1000000.0) AS INTEGER),
  ledger.token_or_call_units_json,
  ledger.created_at
FROM cost_ledger AS ledger
JOIN model_runs AS runs ON runs.id = ledger.model_run_id;

DROP TABLE cost_ledger;
DROP TABLE model_runs;
ALTER TABLE model_runs_issue014_new RENAME TO model_runs;
ALTER TABLE model_budget_reservations RENAME TO model_budget_reservations_issue014_tmp;
ALTER TABLE model_budget_reservations_issue014_tmp RENAME TO model_budget_reservations;
ALTER TABLE cost_ledger_issue014_new RENAME TO cost_ledger;

CREATE INDEX idx_model_runs_recent ON model_runs(created_at DESC, id DESC);
CREATE INDEX idx_model_runs_billing ON model_runs(cost_state, created_at);
CREATE INDEX idx_model_runs_cache_key ON model_runs(cache_key, status);
CREATE INDEX idx_model_runs_cache_entry ON model_runs(cache_entry_id);
CREATE INDEX idx_model_runs_job ON model_runs(job_id);
CREATE INDEX idx_model_cache_status_updated ON model_cache_entries(status, updated_at);
CREATE INDEX idx_model_cache_lease ON model_cache_entries(status, lease_expires_at);
CREATE INDEX idx_model_cache_managed_path ON model_cache_entries(managed_relative_path);
CREATE INDEX idx_model_reservations_month_status
  ON model_budget_reservations(billing_month, status);
CREATE INDEX idx_model_reservations_week_status
  ON model_budget_reservations(week_key, status);
CREATE INDEX idx_model_reservations_task_status
  ON model_budget_reservations(task_kind, status);
CREATE INDEX idx_model_price_lookup
  ON model_price_schedules(
    provider_config_fingerprint, model_id, operation_kind, protocol_mode, status, version DESC
  );
CREATE INDEX idx_model_unit_policy_lookup
  ON model_unit_budget_policies(scope_kind, scope_value, status, version DESC);
CREATE INDEX idx_cost_ledger_month_state
  ON cost_ledger(billing_month, cost_state, created_at);
CREATE INDEX idx_cost_ledger_provider_model
  ON cost_ledger(provider_config_fingerprint, model_id, operation_kind);
CREATE INDEX idx_cost_ledger_price_schedule ON cost_ledger(price_schedule_id);
CREATE INDEX idx_cost_ledger_adjustment ON cost_ledger(adjustment_of_id);

CREATE TRIGGER cost_ledger_append_only_update
BEFORE UPDATE ON cost_ledger
BEGIN
  SELECT RAISE(ABORT, 'cost ledger is append-only');
END;

CREATE TRIGGER cost_ledger_append_only_delete
BEFORE DELETE ON cost_ledger
BEGIN
  SELECT RAISE(ABORT, 'cost ledger is append-only');
END;
`;

const SEARCH_PROVIDER_RUNS_AND_RATE_LIMITS = `
CREATE TABLE search_provider_configs (
  provider_instance_id TEXT PRIMARY KEY CHECK (length(provider_instance_id) BETWEEN 1 AND 128),
  provider_kind TEXT NOT NULL CHECK (provider_kind IN (
    'MODEL_WEB_SEARCH', 'SEARCH_API', 'CURATED_SOURCE', 'BROWSER_CLIP', 'MANUAL_URL'
  )),
  provider_mode TEXT NOT NULL CHECK (provider_mode IN (
    'ACTIVE_REMOTE', 'PASSIVE_LOCAL', 'FIXTURE_ONLY'
  )),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  max_results INTEGER NOT NULL CHECK (max_results BETWEEN 1 AND 20),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 600000),
  rate_policy_version INTEGER CHECK (
    rate_policy_version IS NULL OR
    (typeof(rate_policy_version) = 'integer' AND rate_policy_version > 0)
  ),
  max_concurrent INTEGER CHECK (
    max_concurrent IS NULL OR (typeof(max_concurrent) = 'integer' AND max_concurrent BETWEEN 1 AND 32)
  ),
  min_interval_ms INTEGER CHECK (
    min_interval_ms IS NULL OR
    (typeof(min_interval_ms) = 'integer' AND min_interval_ms BETWEEN 0 AND 86400000)
  ),
  max_requests_per_window INTEGER CHECK (
    max_requests_per_window IS NULL OR
    (typeof(max_requests_per_window) = 'integer' AND max_requests_per_window BETWEEN 1 AND 10000)
  ),
  window_ms INTEGER CHECK (
    window_ms IS NULL OR (typeof(window_ms) = 'integer' AND window_ms BETWEEN 1 AND 86400000)
  ),
  max_response_bytes INTEGER CHECK (
    max_response_bytes IS NULL OR
    (typeof(max_response_bytes) = 'integer' AND max_response_bytes BETWEEN 1 AND 2097152)
  ),
  curated_entries_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(curated_entries_json) AND
    json_type(curated_entries_json) = 'array' AND
    length(CAST(curated_entries_json AS BLOB)) BETWEEN 2 AND 65536
  ),
  settings_revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(settings_revision) = 'integer' AND settings_revision > 0
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  CHECK (
    (provider_mode = 'ACTIVE_REMOTE' AND rate_policy_version IS NOT NULL AND
      max_concurrent IS NOT NULL AND min_interval_ms IS NOT NULL AND
      max_requests_per_window IS NOT NULL AND window_ms IS NOT NULL AND
      max_response_bytes IS NOT NULL) OR
    (provider_mode <> 'ACTIVE_REMOTE' AND rate_policy_version IS NULL AND
      max_concurrent IS NULL AND min_interval_ms IS NULL AND
      max_requests_per_window IS NULL AND window_ms IS NULL AND
      max_response_bytes IS NULL)
  )
) STRICT;

CREATE TABLE search_rate_limit_states (
  provider_instance_id TEXT PRIMARY KEY
    REFERENCES search_provider_configs(provider_instance_id)
      ON UPDATE CASCADE ON DELETE CASCADE,
  policy_version INTEGER NOT NULL CHECK (typeof(policy_version) = 'integer' AND policy_version > 0),
  window_started_at TEXT NOT NULL CHECK (window_started_at ${UTC_REQUIRED}),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(request_count) = 'integer' AND request_count BETWEEN 0 AND 10000
  ),
  in_flight INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(in_flight) = 'integer' AND in_flight BETWEEN 0 AND 32
  ),
  last_started_at TEXT CHECK (last_started_at IS NULL OR last_started_at ${UTC_REQUIRED}),
  next_allowed_at TEXT NOT NULL CHECK (next_allowed_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE search_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL UNIQUE CHECK (length(execution_id) BETWEEN 1 AND 128),
  job_id TEXT CHECK (job_id IS NULL OR length(job_id) BETWEEN 1 AND 128),
  provider_kind TEXT NOT NULL CHECK (provider_kind IN (
    'MODEL_WEB_SEARCH', 'SEARCH_API', 'CURATED_SOURCE', 'BROWSER_CLIP', 'MANUAL_URL'
  )),
  provider_instance_id TEXT NOT NULL
    REFERENCES search_provider_configs(provider_instance_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
  provider_mode TEXT NOT NULL CHECK (provider_mode IN (
    'ACTIVE_REMOTE', 'PASSIVE_LOCAL', 'FIXTURE_ONLY'
  )),
  provider_readiness TEXT NOT NULL CHECK (provider_readiness IN (
    'READY', 'DISABLED', 'NOT_CONFIGURED', 'CAPABILITY_UNKNOWN',
    'CAPABILITY_UNSUPPORTED', 'CAPABILITY_STALE', 'RATE_POLICY_REQUIRED',
    'BUDGET_POLICY_REQUIRED', 'CODEC_UNAVAILABLE', 'PENDING_LATER_ISSUE', 'ERROR'
  )),
  request_semantic_hash TEXT NOT NULL CHECK (
    length(request_semantic_hash) = 64 AND request_semantic_hash NOT GLOB '*[^0-9a-f]*'
  ),
  plan_hash TEXT NOT NULL CHECK (
    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  query_hash TEXT NOT NULL CHECK (
    length(query_hash) = 64 AND query_hash NOT GLOB '*[^0-9a-f]*'
  ),
  intent TEXT NOT NULL CHECK (intent IN (
    'BOOK_DISCOVERY', 'BIBLIOGRAPHIC_LOOKUP', 'AUTHOR_RESEARCH',
    'AWARD_RESEARCH', 'PUBLISHING_NEWS', 'REVIEW_LANDSCAPE',
    'CULTURAL_CONTEXT', 'USER_PROVIDED_URL', 'USER_PROVIDED_CLIP'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'IN_FLIGHT', 'RECOVERABLE_PRE_SEND', 'SUCCEEDED', 'PARTIAL', 'EMPTY',
    'RATE_LIMITED_BEFORE_SEND',
    'BUDGET_BLOCKED', 'CAPABILITY_BLOCKED', 'CANCELLED_BEFORE_SEND',
    'CANCELLED_AFTER_SEND', 'FAILED_BEFORE_SEND', 'FAILED_AFTER_SEND', 'AMBIGUOUS'
  )),
  certainty TEXT NOT NULL CHECK (certainty IN (
    'NOT_SENT', 'REJECTED_BEFORE_EXECUTION', 'MAY_HAVE_EXECUTED',
    'COMPLETED_INVALID_OUTPUT'
  )),
  external_request_count INTEGER NOT NULL DEFAULT 0 CHECK (external_request_count IN (0, 1)),
  rate_reserved INTEGER NOT NULL DEFAULT 0 CHECK (rate_reserved IN (0, 1)),
  model_run_id TEXT REFERENCES model_runs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(candidate_count) = 'integer' AND candidate_count BETWEEN 0 AND 20
  ),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(rejected_count) = 'integer' AND rejected_count >= 0
  ),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(duplicate_count) = 'integer' AND duplicate_count >= 0
  ),
  total_appearance_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(total_appearance_count) = 'integer' AND total_appearance_count >= 0
  ),
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  cursor TEXT CHECK (cursor IS NULL OR length(CAST(cursor AS BLOB)) <= 2048),
  rate_policy_version INTEGER CHECK (
    rate_policy_version IS NULL OR
    (typeof(rate_policy_version) = 'integer' AND rate_policy_version > 0)
  ),
  cost_state TEXT CHECK (cost_state IS NULL OR cost_state IN (
    'NOT_INCURRED', 'PROVIDER_REPORTED_USD', 'UNKNOWN_POSSIBLY_INCURRED',
    'UNPRICED_USAGE', 'USER_PRICE_TABLE_ESTIMATE'
  )),
  usage_json TEXT CHECK (
    usage_json IS NULL OR
    (json_valid(usage_json) AND json_type(usage_json) = 'object' AND
      length(CAST(usage_json AS BLOB)) <= 4096)
  ),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(warnings_json) AND json_type(warnings_json) = 'array' AND
    length(CAST(warnings_json AS BLOB)) <= 4096
  ),
  stable_error_code TEXT CHECK (
    stable_error_code IS NULL OR length(stable_error_code) BETWEEN 1 AND 96
  ),
  started_at TEXT NOT NULL CHECK (started_at ${UTC_REQUIRED}),
  finished_at TEXT CHECK (finished_at IS NULL OR finished_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  CHECK (
    (status IN ('IN_FLIGHT', 'RECOVERABLE_PRE_SEND') AND finished_at IS NULL) OR
    (status NOT IN ('IN_FLIGHT', 'RECOVERABLE_PRE_SEND') AND finished_at IS NOT NULL)
  ),
  CHECK (
    (provider_mode = 'ACTIVE_REMOTE' AND rate_policy_version IS NOT NULL) OR
    (provider_mode <> 'ACTIVE_REMOTE' AND rate_policy_version IS NULL)
  ),
  CHECK (rate_reserved = 0 OR provider_mode = 'ACTIVE_REMOTE')
) STRICT;

CREATE TABLE search_result_candidates (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  search_run_id TEXT NOT NULL
    REFERENCES search_runs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  provider_instance_id TEXT NOT NULL CHECK (length(provider_instance_id) BETWEEN 1 AND 128),
  provider_kind TEXT NOT NULL CHECK (provider_kind IN (
    'MODEL_WEB_SEARCH', 'SEARCH_API', 'CURATED_SOURCE', 'BROWSER_CLIP', 'MANUAL_URL'
  )),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN (
    'MODEL_WEB_SEARCH', 'SEARCH_API', 'CURATED_SOURCE', 'BROWSER_CLIP', 'MANUAL_URL'
  )),
  canonical_url TEXT NOT NULL CHECK (length(canonical_url) BETWEEN 1 AND 4096),
  url_hash TEXT NOT NULL CHECK (
    length(url_hash) = 64 AND url_hash NOT GLOB '*[^0-9a-f]*'
  ),
  domain TEXT NOT NULL CHECK (length(domain) BETWEEN 1 AND 255),
  display_host TEXT NOT NULL CHECK (length(display_host) BETWEEN 1 AND 255),
  title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 512),
  preview_text TEXT CHECK (preview_text IS NULL OR length(preview_text) BETWEEN 1 AND 2000),
  preview_kind TEXT NOT NULL CHECK (preview_kind IN ('NONE', 'UPSTREAM_SNIPPET', 'USER_NOTE')),
  upstream_rank INTEGER CHECK (
    upstream_rank IS NULL OR
    (typeof(upstream_rank) = 'integer' AND upstream_rank BETWEEN 0 AND 1000000)
  ),
  upstream_id_hash TEXT CHECK (
    upstream_id_hash IS NULL OR
    (length(upstream_id_hash) = 64 AND upstream_id_hash NOT GLOB '*[^0-9a-f]*')
  ),
  published_at TEXT CHECK (published_at IS NULL OR published_at ${UTC_REQUIRED}),
  language_hint TEXT CHECK (language_hint IS NULL OR length(language_hint) BETWEEN 1 AND 32),
  discovered_at TEXT NOT NULL CHECK (discovered_at ${UTC_REQUIRED}),
  user_supplied INTEGER NOT NULL CHECK (user_supplied IN (0, 1)),
  source_metadata_kind TEXT NOT NULL CHECK (source_metadata_kind IN (
    'WEB_SEARCH_SOURCE', 'URL_CITATION', 'SEARCH_API_RESULT', 'CURATED_ENTRY',
    'BROWSER_CLIP_INPUT', 'MANUAL_URL_INPUT'
  )),
  citation_state TEXT NOT NULL CHECK (citation_state IN (
    'NOT_APPLICABLE', 'CONSULTED_ONLY', 'CITED', 'UNKNOWN'
  )),
  was_consulted INTEGER CHECK (was_consulted IS NULL OR was_consulted IN (0, 1)),
  was_cited INTEGER CHECK (was_cited IS NULL OR was_cited IN (0, 1)),
  evidence_eligibility TEXT NOT NULL DEFAULT 'LEAD_ONLY' CHECK (evidence_eligibility = 'LEAD_ONLY'),
  fetch_state TEXT NOT NULL DEFAULT 'NOT_FETCHED' CHECK (fetch_state = 'NOT_FETCHED'),
  truth_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (truth_status = 'UNVERIFIED'),
  fact_status TEXT NOT NULL DEFAULT 'NOT_A_FACT' CHECK (fact_status = 'NOT_A_FACT'),
  duplicate_of_candidate_id TEXT
    REFERENCES search_result_candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  provenance_json TEXT NOT NULL CHECK (
    json_valid(provenance_json) AND json_type(provenance_json) = 'array' AND
    length(CAST(provenance_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(warnings_json) AND json_type(warnings_json) = 'array' AND
    length(CAST(warnings_json AS BLOB)) BETWEEN 2 AND 4096
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE(search_run_id, canonical_url),
  UNIQUE(search_run_id, url_hash),
  CHECK (
    (preview_kind = 'NONE' AND preview_text IS NULL) OR
    (preview_kind <> 'NONE' AND preview_text IS NOT NULL)
  ),
  CHECK (duplicate_of_candidate_id IS NULL OR duplicate_of_candidate_id <> id)
) STRICT;

CREATE INDEX idx_search_runs_provider_status_time
  ON search_runs(provider_instance_id, status, started_at DESC);
CREATE INDEX idx_search_runs_status_time ON search_runs(status, started_at DESC);
CREATE INDEX idx_search_runs_job ON search_runs(job_id);
CREATE INDEX idx_search_candidates_url_hash ON search_result_candidates(url_hash);
CREATE INDEX idx_search_candidates_run_rank
  ON search_result_candidates(search_run_id, upstream_rank, id);
CREATE INDEX idx_search_candidates_domain ON search_result_candidates(domain, discovered_at DESC);
`;

const CONTROLLED_PUBLIC_PAGE_FETCH = `
CREATE TABLE fetch_profiles (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  contract_version TEXT NOT NULL CHECK (contract_version = 'fetch-profile-v1'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  global_max_concurrent INTEGER NOT NULL CHECK (
    typeof(global_max_concurrent) = 'integer' AND global_max_concurrent BETWEEN 1 AND 8
  ),
  connect_timeout_ms INTEGER NOT NULL CHECK (
    typeof(connect_timeout_ms) = 'integer' AND connect_timeout_ms BETWEEN 100 AND 60000
  ),
  body_timeout_ms INTEGER NOT NULL CHECK (
    typeof(body_timeout_ms) = 'integer' AND body_timeout_ms BETWEEN 100 AND 120000
  ),
  header_timeout_ms INTEGER NOT NULL CHECK (
    typeof(header_timeout_ms) = 'integer' AND header_timeout_ms BETWEEN 100 AND 60000
  ),
  total_timeout_ms INTEGER NOT NULL CHECK (
    typeof(total_timeout_ms) = 'integer' AND total_timeout_ms BETWEEN 500 AND 300000
  ),
  header_bytes INTEGER NOT NULL CHECK (
    typeof(header_bytes) = 'integer' AND header_bytes BETWEEN 1024 AND 32768
  ),
  header_count INTEGER NOT NULL CHECK (
    typeof(header_count) = 'integer' AND header_count BETWEEN 1 AND 100
  ),
  raw_bytes INTEGER NOT NULL CHECK (
    typeof(raw_bytes) = 'integer' AND raw_bytes BETWEEN 1024 AND 2097152
  ),
  decoded_bytes INTEGER NOT NULL CHECK (
    typeof(decoded_bytes) = 'integer' AND decoded_bytes BETWEEN raw_bytes AND 4194304
  ),
  dom_nodes INTEGER NOT NULL CHECK (
    typeof(dom_nodes) = 'integer' AND dom_nodes BETWEEN 100 AND 50000
  ),
  dom_depth INTEGER NOT NULL CHECK (
    typeof(dom_depth) = 'integer' AND dom_depth BETWEEN 4 AND 64
  ),
  sanitized_bytes INTEGER NOT NULL CHECK (
    typeof(sanitized_bytes) = 'integer' AND sanitized_bytes BETWEEN 1024 AND 2097152
  ),
  text_bytes INTEGER NOT NULL CHECK (
    typeof(text_bytes) = 'integer' AND text_bytes BETWEEN 1024 AND 2097152
  ),
  redirect_count INTEGER NOT NULL CHECK (
    typeof(redirect_count) = 'integer' AND redirect_count BETWEEN 0 AND 3
  ),
  max_external_requests INTEGER NOT NULL CHECK (
    typeof(max_external_requests) = 'integer' AND max_external_requests BETWEEN 3 AND 6
  ),
  min_interval_ms INTEGER NOT NULL CHECK (
    typeof(min_interval_ms) = 'integer' AND min_interval_ms BETWEEN 0 AND 86400000
  ),
  max_requests_per_window INTEGER NOT NULL CHECK (
    typeof(max_requests_per_window) = 'integer' AND max_requests_per_window BETWEEN 1 AND 10000
  ),
  window_ms INTEGER NOT NULL CHECK (
    typeof(window_ms) = 'integer' AND window_ms BETWEEN 1000 AND 86400000
  ),
  rate_policy_revision INTEGER NOT NULL CHECK (
    typeof(rate_policy_revision) = 'integer' AND rate_policy_revision > 0
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  CHECK (max_external_requests >= redirect_count + 3)
) STRICT;

CREATE TABLE fetch_origin_rate_states (
  origin TEXT PRIMARY KEY CHECK (
    length(origin) BETWEEN 8 AND 512 AND
    (origin GLOB 'http://*' OR origin GLOB 'https://*')
  ),
  policy_revision INTEGER NOT NULL CHECK (
    typeof(policy_revision) = 'integer' AND policy_revision > 0
  ),
  window_started_at TEXT NOT NULL CHECK (window_started_at ${UTC_REQUIRED}),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(request_count) = 'integer' AND request_count BETWEEN 0 AND 10000
  ),
  in_flight INTEGER NOT NULL DEFAULT 0 CHECK (in_flight IN (0, 1)),
  last_started_at TEXT CHECK (last_started_at IS NULL OR last_started_at ${UTC_REQUIRED}),
  next_allowed_at TEXT NOT NULL CHECK (next_allowed_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE fetch_robots_cache (
  origin TEXT NOT NULL CHECK (
    length(origin) BETWEEN 8 AND 512 AND
    (origin GLOB 'http://*' OR origin GLOB 'https://*')
  ),
  user_agent_hash TEXT NOT NULL CHECK (
    length(user_agent_hash) = 64 AND user_agent_hash NOT GLOB '*[^0-9a-f]*'
  ),
  policy_version TEXT NOT NULL CHECK (policy_version = 'robots-rfc9309-subset-v1'),
  result TEXT NOT NULL CHECK (result IN ('ALLOWED', 'DISALLOWED', 'UNKNOWN')),
  body_hash TEXT CHECK (
    body_hash IS NULL OR
    (length(body_hash) = 64 AND body_hash NOT GLOB '*[^0-9a-f]*')
  ),
  parsed_rules_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(parsed_rules_json) AND json_type(parsed_rules_json) = 'array' AND
    length(CAST(parsed_rules_json AS BLOB)) BETWEEN 2 AND 131072
  ),
  crawl_delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(crawl_delay_ms) = 'integer' AND crawl_delay_ms BETWEEN 0 AND 3600000
  ),
  checked_at TEXT NOT NULL CHECK (checked_at ${UTC_REQUIRED}),
  expires_at TEXT NOT NULL CHECK (expires_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (origin, user_agent_hash, policy_version),
  CHECK (expires_at > checked_at)
) STRICT, WITHOUT ROWID;

CREATE TABLE fetched_documents (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  final_canonical_url TEXT NOT NULL CHECK (length(final_canonical_url) BETWEEN 1 AND 4096),
  final_canonical_url_hash TEXT NOT NULL CHECK (
    length(final_canonical_url_hash) = 64 AND
    final_canonical_url_hash NOT GLOB '*[^0-9a-f]*'
  ),
  raw_body_hash TEXT NOT NULL CHECK (
    length(raw_body_hash) = 64 AND raw_body_hash NOT GLOB '*[^0-9a-f]*'
  ),
  mime_type TEXT NOT NULL CHECK (
    mime_type IN ('text/html', 'application/xhtml+xml', 'text/plain')
  ),
  charset TEXT NOT NULL CHECK (
    charset IN ('utf-8', 'gb18030', 'big5', 'shift_jis', 'euc-jp', 'iso-2022-jp')
  ),
  language_hint TEXT CHECK (language_hint IS NULL OR length(language_hint) BETWEEN 1 AND 32),
  sanitizer_version TEXT NOT NULL CHECK (sanitizer_version = 'fetch-sanitizer-v1'),
  extractor_version TEXT NOT NULL CHECK (extractor_version = 'fetch-extractor-v1'),
  privacy_policy_version TEXT NOT NULL CHECK (privacy_policy_version = 'fetch-privacy-v1'),
  sanitized_html_hash TEXT NOT NULL CHECK (
    length(sanitized_html_hash) = 64 AND sanitized_html_hash NOT GLOB '*[^0-9a-f]*'
  ),
  sanitized_html_bytes INTEGER NOT NULL CHECK (
    typeof(sanitized_html_bytes) = 'integer' AND sanitized_html_bytes BETWEEN 1 AND 2097152
  ),
  sanitized_html_path TEXT NOT NULL CHECK (
    length(sanitized_html_path) BETWEEN 1 AND 1024 AND
    sanitized_html_path GLOB 'sources/snapshots/??/*' AND
    instr(sanitized_html_path, '..') = 0 AND instr(sanitized_html_path, char(92)) = 0
  ),
  extracted_text_hash TEXT NOT NULL CHECK (
    length(extracted_text_hash) = 64 AND extracted_text_hash NOT GLOB '*[^0-9a-f]*'
  ),
  extracted_text_bytes INTEGER NOT NULL CHECK (
    typeof(extracted_text_bytes) = 'integer' AND extracted_text_bytes BETWEEN 1 AND 2097152
  ),
  extracted_text_path TEXT NOT NULL CHECK (
    length(extracted_text_path) BETWEEN 1 AND 1024 AND
    extracted_text_path GLOB 'sources/snapshots/??/*' AND
    instr(extracted_text_path, '..') = 0 AND instr(extracted_text_path, char(92)) = 0
  ),
  normalized_content_hash TEXT NOT NULL CHECK (
    length(normalized_content_hash) = 64 AND normalized_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  redacted_email_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(redacted_email_count) = 'integer' AND redacted_email_count >= 0
  ),
  redacted_phone_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(redacted_phone_count) = 'integer' AND redacted_phone_count >= 0
  ),
  redacted_address_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(redacted_address_count) = 'integer' AND redacted_address_count >= 0
  ),
  evidence_eligibility TEXT NOT NULL DEFAULT 'FETCHED_NOT_EVIDENCE'
    CHECK (evidence_eligibility = 'FETCHED_NOT_EVIDENCE'),
  truth_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (truth_status = 'UNVERIFIED'),
  fact_status TEXT NOT NULL DEFAULT 'NOT_A_FACT' CHECK (fact_status = 'NOT_A_FACT'),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (
    normalized_content_hash, sanitizer_version, extractor_version, privacy_policy_version
  )
) STRICT;

CREATE TABLE fetch_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL UNIQUE CHECK (length(execution_id) BETWEEN 1 AND 128),
  job_id TEXT CHECK (job_id IS NULL OR length(job_id) BETWEEN 1 AND 128),
  search_candidate_id TEXT NOT NULL
    REFERENCES search_result_candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  expected_canonical_url_hash TEXT NOT NULL CHECK (
    length(expected_canonical_url_hash) = 64 AND
    expected_canonical_url_hash NOT GLOB '*[^0-9a-f]*'
  ),
  candidate_url_hash TEXT NOT NULL CHECK (
    length(candidate_url_hash) = 64 AND candidate_url_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_semantic_hash TEXT NOT NULL CHECK (
    length(request_semantic_hash) = 64 AND request_semantic_hash NOT GLOB '*[^0-9a-f]*'
  ),
  plan_hash TEXT NOT NULL CHECK (
    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  selection_kind TEXT NOT NULL CHECK (
    selection_kind IN ('USER_SELECTED', 'RESEARCH_PLAN_SELECTED', 'FIXTURE_SELECTED')
  ),
  selection_reason_code TEXT NOT NULL CHECK (length(selection_reason_code) BETWEEN 1 AND 128),
  fetch_profile_id TEXT NOT NULL
    REFERENCES fetch_profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  profile_revision INTEGER NOT NULL CHECK (
    typeof(profile_revision) = 'integer' AND profile_revision > 0
  ),
  origin TEXT NOT NULL CHECK (
    length(origin) BETWEEN 8 AND 512 AND
    (origin GLOB 'http://*' OR origin GLOB 'https://*')
  ),
  status TEXT NOT NULL CHECK (status IN (
    'PLANNED', 'RECOVERABLE_PRE_SEND', 'ROBOTS_CHECKING', 'ROBOTS_BLOCKED',
    'RATE_LIMITED_BEFORE_SEND',
    'FETCHING', 'RECEIVED', 'SANITIZING', 'EXTRACTING', 'PERSISTING', 'SUCCEEDED',
    'REJECTED', 'CANCELLED_BEFORE_SEND', 'CANCELLED_AFTER_SEND',
    'FAILED_BEFORE_SEND', 'FAILED_AFTER_SEND', 'AMBIGUOUS'
  )),
  send_state TEXT NOT NULL CHECK (send_state IN (
    'NOT_SENT', 'ROBOTS_SENT', 'PAGE_SENT', 'UNKNOWN'
  )),
  rate_reserved INTEGER NOT NULL DEFAULT 0 CHECK (rate_reserved IN (0, 1)),
  active_rate_origin TEXT CHECK (
    active_rate_origin IS NULL OR
    (length(active_rate_origin) BETWEEN 8 AND 512 AND
      (active_rate_origin GLOB 'http://*' OR active_rate_origin GLOB 'https://*'))
  ),
  robots_dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(robots_dispatch_count) = 'integer' AND robots_dispatch_count BETWEEN 0 AND 2
  ),
  page_dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(page_dispatch_count) = 'integer' AND page_dispatch_count BETWEEN 0 AND 4
  ),
  external_request_count INTEGER NOT NULL DEFAULT 0 CHECK (
    external_request_count = robots_dispatch_count + page_dispatch_count AND
    external_request_count BETWEEN 0 AND 6
  ),
  final_canonical_url TEXT CHECK (
    final_canonical_url IS NULL OR length(final_canonical_url) BETWEEN 1 AND 4096
  ),
  final_canonical_url_hash TEXT CHECK (
    final_canonical_url_hash IS NULL OR
    (length(final_canonical_url_hash) = 64 AND
      final_canonical_url_hash NOT GLOB '*[^0-9a-f]*')
  ),
  response_mime TEXT CHECK (
    response_mime IS NULL OR
    response_mime IN ('text/html', 'application/xhtml+xml', 'text/plain')
  ),
  response_charset TEXT CHECK (
    response_charset IS NULL OR
    response_charset IN ('utf-8', 'gb18030', 'big5', 'shift_jis', 'euc-jp', 'iso-2022-jp')
  ),
  received_bytes INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(received_bytes) = 'integer' AND received_bytes BETWEEN 0 AND 4194304
  ),
  redirect_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(redirect_count) = 'integer' AND redirect_count BETWEEN 0 AND 3
  ),
  redacted_email_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(redacted_email_count) = 'integer' AND redacted_email_count >= 0
  ),
  redacted_phone_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(redacted_phone_count) = 'integer' AND redacted_phone_count >= 0
  ),
  redacted_address_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(redacted_address_count) = 'integer' AND redacted_address_count >= 0
  ),
  evidence_eligibility TEXT NOT NULL DEFAULT 'FETCHED_NOT_EVIDENCE'
    CHECK (evidence_eligibility = 'FETCHED_NOT_EVIDENCE'),
  truth_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (truth_status = 'UNVERIFIED'),
  fact_status TEXT NOT NULL DEFAULT 'NOT_A_FACT' CHECK (fact_status = 'NOT_A_FACT'),
  document_id TEXT REFERENCES fetched_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  stable_error_code TEXT CHECK (
    stable_error_code IS NULL OR length(stable_error_code) BETWEEN 1 AND 96
  ),
  started_at TEXT NOT NULL CHECK (started_at ${UTC_REQUIRED}),
  finished_at TEXT CHECK (finished_at IS NULL OR finished_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  CHECK (expected_canonical_url_hash = candidate_url_hash),
  CHECK (
    (status IN (
      'PLANNED', 'RECOVERABLE_PRE_SEND', 'ROBOTS_CHECKING', 'FETCHING', 'RECEIVED',
      'SANITIZING', 'EXTRACTING', 'PERSISTING'
    ) AND finished_at IS NULL) OR
    (status NOT IN (
      'PLANNED', 'RECOVERABLE_PRE_SEND', 'ROBOTS_CHECKING', 'FETCHING', 'RECEIVED',
      'SANITIZING', 'EXTRACTING', 'PERSISTING'
    ) AND finished_at IS NOT NULL)
  ),
  CHECK ((status = 'SUCCEEDED' AND document_id IS NOT NULL) OR
         (status <> 'SUCCEEDED' AND document_id IS NULL)),
  CHECK (
    (status IN (
      'PLANNED', 'RECOVERABLE_PRE_SEND', 'ROBOTS_CHECKING', 'FETCHING',
      'RECEIVED', 'SANITIZING', 'EXTRACTING', 'PERSISTING', 'SUCCEEDED'
    ) AND stable_error_code IS NULL) OR
    (status NOT IN (
      'PLANNED', 'RECOVERABLE_PRE_SEND', 'ROBOTS_CHECKING', 'FETCHING',
      'RECEIVED', 'SANITIZING', 'EXTRACTING', 'PERSISTING', 'SUCCEEDED'
    ) AND stable_error_code IS NOT NULL)
  ),
  CHECK ((rate_reserved = 0 AND active_rate_origin IS NULL) OR
         (rate_reserved = 1 AND active_rate_origin IS NOT NULL)),
  CHECK ((final_canonical_url IS NULL) = (final_canonical_url_hash IS NULL))
) STRICT;

CREATE TABLE fetch_redirect_hops (
  fetch_run_id TEXT NOT NULL
    REFERENCES fetch_runs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  hop INTEGER NOT NULL CHECK (typeof(hop) = 'integer' AND hop BETWEEN 1 AND 3),
  status_code INTEGER NOT NULL CHECK (status_code IN (301, 302, 303, 307, 308)),
  from_host TEXT NOT NULL CHECK (length(from_host) BETWEEN 1 AND 255),
  from_url_hash TEXT NOT NULL CHECK (
    length(from_url_hash) = 64 AND from_url_hash NOT GLOB '*[^0-9a-f]*'
  ),
  to_host TEXT NOT NULL CHECK (length(to_host) BETWEEN 1 AND 255),
  to_url_hash TEXT NOT NULL CHECK (
    length(to_url_hash) = 64 AND to_url_hash NOT GLOB '*[^0-9a-f]*'
  ),
  policy_result TEXT NOT NULL CHECK (policy_result IN ('FOLLOWED', 'REJECTED')),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (fetch_run_id, hop)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_fetch_runs_candidate_status_time
  ON fetch_runs(search_candidate_id, status, started_at DESC);
CREATE INDEX idx_fetch_runs_origin_status_time ON fetch_runs(origin, status, started_at DESC);
CREATE INDEX idx_fetch_runs_status_time ON fetch_runs(status, started_at DESC);
CREATE INDEX idx_fetch_runs_document ON fetch_runs(document_id);
CREATE INDEX idx_fetch_runs_job ON fetch_runs(job_id);
CREATE INDEX idx_fetch_documents_url_hash ON fetched_documents(final_canonical_url_hash);
CREATE INDEX idx_fetch_documents_content_hash ON fetched_documents(normalized_content_hash);
CREATE INDEX idx_fetch_robots_expiry ON fetch_robots_cache(expires_at);
CREATE INDEX idx_fetch_redirect_to_hash ON fetch_redirect_hops(to_url_hash);
`;

const BROWSER_CLIPPER_SAMPLES = `
ALTER TABLE clips ADD COLUMN normalized_url TEXT;
ALTER TABLE clips ADD COLUMN url_hash TEXT;
ALTER TABLE clips ADD COLUMN capture_id TEXT;
ALTER TABLE clips ADD COLUMN local_api_client_id TEXT
  REFERENCES local_api_clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE clips ADD COLUMN extension_origin TEXT;
ALTER TABLE clips ADD COLUMN capture_source TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK (capture_source IN ('LEGACY', 'BROWSER_EXTENSION'));
ALTER TABLE clips ADD COLUMN browser_family TEXT
  CHECK (browser_family IS NULL OR browser_family IN ('CHROME', 'EDGE', 'CHROMIUM_UNKNOWN'));
ALTER TABLE clips ADD COLUMN contract_version TEXT;
ALTER TABLE clips ADD COLUMN extension_build_version TEXT;
ALTER TABLE clips ADD COLUMN public_page_confirmed INTEGER NOT NULL DEFAULT 0
  CHECK (public_page_confirmed IN (0, 1));
ALTER TABLE clips ADD COLUMN selected_text_hash TEXT;
ALTER TABLE clips ADD COLUMN screenshot_mime TEXT
  CHECK (screenshot_mime IS NULL OR screenshot_mime IN ('image/png', 'image/jpeg'));
ALTER TABLE clips ADD COLUMN screenshot_hash TEXT;
ALTER TABLE clips ADD COLUMN screenshot_bytes INTEGER
  CHECK (screenshot_bytes IS NULL OR screenshot_bytes BETWEEN 1 AND 6291456);
ALTER TABLE clips ADD COLUMN screenshot_width INTEGER
  CHECK (screenshot_width IS NULL OR screenshot_width > 0);
ALTER TABLE clips ADD COLUMN screenshot_height INTEGER
  CHECK (screenshot_height IS NULL OR screenshot_height > 0);
ALTER TABLE clips ADD COLUMN status TEXT NOT NULL DEFAULT 'STORED'
  CHECK (status = 'STORED');
ALTER TABLE clips ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE clips ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX idx_clips_extension_capture
  ON clips(extension_origin, capture_id)
  WHERE extension_origin IS NOT NULL AND capture_id IS NOT NULL;
CREATE INDEX idx_clips_url_hash ON clips(url_hash);
CREATE INDEX idx_clips_client_created ON clips(local_api_client_id, created_at DESC);
CREATE INDEX idx_clips_origin_created ON clips(extension_origin, created_at DESC);
CREATE INDEX idx_clips_status_updated ON clips(status, updated_at DESC);

CREATE TRIGGER clips_browser_insert_guard
BEFORE INSERT ON clips
WHEN NEW.capture_source = 'BROWSER_EXTENSION'
BEGIN
  SELECT CASE WHEN
    NEW.normalized_url IS NULL OR length(NEW.normalized_url) NOT BETWEEN 1 AND 4096 OR
    NEW.url_hash IS NULL OR length(NEW.url_hash) <> 64 OR
    NEW.url_hash GLOB '*[^0-9a-f]*' OR
    NEW.capture_id IS NULL OR length(NEW.capture_id) <> 36 OR
    NEW.local_api_client_id IS NULL OR
    NEW.extension_origin IS NULL OR
    NEW.extension_origin NOT GLOB 'chrome-extension://????????????????????????????????' OR
    NEW.contract_version <> 'browser-clip-v1' OR
    NEW.extension_build_version IS NULL OR
    NEW.public_page_confirmed <> 1 OR
    NEW.updated_at IS NULL OR
    length(COALESCE(NEW.page_title, '')) NOT BETWEEN 1 AND 512 OR
    length(COALESCE(NEW.account_name, '')) > 200 OR
    length(COALESCE(NEW.selected_text, '')) > 12000 OR
    length(COALESCE(NEW.user_note, '')) > 2000 OR
    (NEW.selected_text IS NULL) <> (NEW.selected_text_hash IS NULL) OR
    (NEW.selected_text_hash IS NOT NULL AND (
      length(NEW.selected_text_hash) <> 64 OR NEW.selected_text_hash GLOB '*[^0-9a-f]*'
    )) OR
    (
      (NEW.screenshot_path IS NULL) <>
      (NEW.screenshot_mime IS NULL OR NEW.screenshot_hash IS NULL OR
       NEW.screenshot_bytes IS NULL OR NEW.screenshot_width IS NULL OR NEW.screenshot_height IS NULL)
    ) OR
    (NEW.screenshot_hash IS NOT NULL AND (
      length(NEW.screenshot_hash) <> 64 OR NEW.screenshot_hash GLOB '*[^0-9a-f]*'
    ))
  THEN RAISE(ABORT, 'browser clip invariant') END;
END;

CREATE TABLE clip_ingest_receipts (
  extension_origin TEXT NOT NULL CHECK (
    extension_origin GLOB 'chrome-extension://????????????????????????????????'
  ),
  capture_id TEXT NOT NULL CHECK (length(capture_id) = 36),
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  client_id TEXT NOT NULL
    REFERENCES local_api_clients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
  clip_id TEXT REFERENCES clips(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES search_result_candidates(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  stable_error TEXT,
  PRIMARY KEY (extension_origin, capture_id),
  CHECK (
    (status = 'SUCCEEDED' AND clip_id IS NOT NULL AND candidate_id IS NOT NULL AND stable_error IS NULL)
    OR (status = 'IN_PROGRESS' AND clip_id IS NULL AND candidate_id IS NULL AND stable_error IS NULL)
    OR (status = 'FAILED' AND clip_id IS NULL AND candidate_id IS NULL AND stable_error IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE clip_search_candidate_links (
  clip_id TEXT PRIMARY KEY REFERENCES clips(id) ON UPDATE CASCADE ON DELETE CASCADE,
  candidate_id TEXT NOT NULL UNIQUE
    REFERENCES search_result_candidates(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT, WITHOUT ROWID;

CREATE TABLE clip_ingest_rate_states (
  client_id TEXT PRIMARY KEY
    REFERENCES local_api_clients(id) ON UPDATE CASCADE ON DELETE CASCADE,
  minute_started_at TEXT NOT NULL CHECK (minute_started_at ${UTC_REQUIRED}),
  minute_count INTEGER NOT NULL CHECK (minute_count BETWEEN 0 AND 30),
  day_started_at TEXT NOT NULL CHECK (day_started_at ${UTC_REQUIRED}),
  day_count INTEGER NOT NULL CHECK (day_count BETWEEN 0 AND 500),
  day_screenshot_bytes INTEGER NOT NULL CHECK (
    day_screenshot_bytes BETWEEN 0 AND 104857600
  ),
  failed_count INTEGER NOT NULL CHECK (failed_count BETWEEN 0 AND 100),
  in_flight INTEGER NOT NULL CHECK (in_flight IN (0, 1)),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED})
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_clip_receipts_client_created
  ON clip_ingest_receipts(client_id, created_at DESC);
CREATE INDEX idx_clip_receipts_status_updated
  ON clip_ingest_receipts(status, updated_at DESC);
CREATE INDEX idx_clip_links_candidate ON clip_search_candidate_links(candidate_id);
`;

const BIBLIOGRAPHIC_CATALOG = `
ALTER TABLE books ADD COLUMN catalog_state TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (catalog_state IN ('ACTIVE', 'MERGED', 'RETIRED'));
ALTER TABLE books ADD COLUMN catalog_revision INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(catalog_revision) = 'integer' AND catalog_revision > 0);

CREATE TABLE catalog_agents (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  agent_type TEXT NOT NULL CHECK (agent_type IN ('PERSON', 'ORGANIZATION')),
  canonical_name TEXT NOT NULL CHECK (length(trim(canonical_name)) BETWEEN 1 AND 512),
  normalized_name TEXT NOT NULL CHECK (length(trim(normalized_name)) BETWEEN 1 AND 512),
  country_or_region TEXT CHECK (
    country_or_region IS NULL OR length(country_or_region) BETWEEN 1 AND 128
  ),
  catalog_state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (catalog_state IN ('ACTIVE', 'MERGED', 'RETIRED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

INSERT INTO catalog_agents (
  id, agent_type, canonical_name, normalized_name, country_or_region
)
SELECT
  id, 'PERSON', canonical_name, lower(trim(canonical_name)), country_or_region
FROM authors;

CREATE TABLE expressions (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  work_id TEXT NOT NULL REFERENCES books(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  expression_kind TEXT NOT NULL CHECK (expression_kind IN (
    'ORIGINAL', 'TRANSLATION', 'REVISED', 'ADAPTED', 'SERIALIZED', 'LEGACY_UNSPECIFIED'
  )),
  canonical_title TEXT CHECK (
    canonical_title IS NULL OR length(trim(canonical_title)) BETWEEN 1 AND 512
  ),
  normalized_title TEXT CHECK (
    normalized_title IS NULL OR length(trim(normalized_title)) BETWEEN 1 AND 512
  ),
  language TEXT CHECK (language IS NULL OR length(language) BETWEEN 1 AND 32),
  script TEXT CHECK (script IS NULL OR length(script) BETWEEN 1 AND 32),
  catalog_state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (catalog_state IN ('ACTIVE', 'MERGED', 'RETIRED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  UNIQUE (work_id, id)
) STRICT;

INSERT INTO expressions (
  id, work_id, expression_kind, canonical_title, normalized_title, language
)
SELECT
  'legacy-expression-' || id,
  id,
  'LEGACY_UNSPECIFIED',
  canonical_title,
  lower(trim(canonical_title)),
  language
FROM books;

CREATE TABLE book_editions_issue018_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  expression_id TEXT NOT NULL
    REFERENCES expressions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  isbn TEXT UNIQUE,
  translated_title TEXT,
  translator TEXT,
  publisher TEXT,
  publication_date TEXT,
  edition_label TEXT,
  format TEXT CHECK (format IS NULL OR length(format) BETWEEN 1 AND 128),
  platform TEXT CHECK (platform IS NULL OR length(platform) BETWEEN 1 AND 128),
  cover_asset_id TEXT REFERENCES assets(id) ON UPDATE CASCADE ON DELETE SET NULL,
  is_motie INTEGER NOT NULL DEFAULT 0 CHECK (is_motie IN (0, 1)),
  is_unreleased INTEGER NOT NULL DEFAULT 0 CHECK (is_unreleased IN (0, 1)),
  source_id TEXT REFERENCES sources(id) ON UPDATE CASCADE ON DELETE SET NULL,
  catalog_state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (catalog_state IN ('ACTIVE', 'MERGED', 'RETIRED')),
  catalog_revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(catalog_revision) = 'integer' AND catalog_revision > 0
  )
) STRICT;

INSERT INTO book_editions_issue018_new (
  id, expression_id, isbn, translated_title, translator, publisher,
  publication_date, edition_label, cover_asset_id, is_motie, is_unreleased, source_id
)
SELECT
  edition.id,
  expression.id,
  edition.isbn,
  edition.translated_title,
  edition.translator,
  edition.publisher,
  edition.publication_date,
  edition.edition_label,
  edition.cover_asset_id,
  edition.is_motie,
  edition.is_unreleased,
  edition.source_id
FROM book_editions AS edition
JOIN expressions AS expression
  ON expression.work_id = edition.book_id
 AND expression.expression_kind = 'LEGACY_UNSPECIFIED';

DROP TABLE book_editions;
ALTER TABLE book_editions_issue018_new RENAME TO book_editions;

CREATE INDEX idx_expressions_work_state
  ON expressions(work_id, catalog_state, canonical_title);
CREATE INDEX idx_expressions_title
  ON expressions(normalized_title, catalog_state);
CREATE INDEX idx_book_editions_expression
  ON book_editions(expression_id, catalog_state, id);
CREATE INDEX idx_book_editions_cover_asset_id ON book_editions(cover_asset_id);
CREATE INDEX idx_book_editions_source_id ON book_editions(source_id);
CREATE INDEX idx_books_catalog_title
  ON books(catalog_state, lower(canonical_title), id);

CREATE TABLE bibliographic_observations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  contract_version TEXT NOT NULL CHECK (
    contract_version = 'bibliographic-observation-v1'
  ),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN (
    'SEARCH_CANDIDATE', 'FETCH_DOCUMENT', 'BROWSER_CLIP_CANDIDATE', 'SYNTHETIC_FIXTURE'
  )),
  origin_record_id TEXT NOT NULL CHECK (length(origin_record_id) BETWEEN 1 AND 128),
  origin_revision INTEGER NOT NULL CHECK (
    typeof(origin_revision) = 'integer' AND origin_revision > 0
  ),
  observed_at TEXT NOT NULL CHECK (observed_at ${UTC_REQUIRED}),
  display_title_raw TEXT CHECK (
    display_title_raw IS NULL OR length(display_title_raw) BETWEEN 1 AND 2000
  ),
  display_title_normalized TEXT CHECK (
    display_title_normalized IS NULL OR length(display_title_normalized) BETWEEN 1 AND 2000
  ),
  original_title_raw TEXT CHECK (
    original_title_raw IS NULL OR length(original_title_raw) BETWEEN 1 AND 2000
  ),
  original_title_normalized TEXT CHECK (
    original_title_normalized IS NULL OR length(original_title_normalized) BETWEEN 1 AND 2000
  ),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json) = 'object' AND
    length(CAST(payload_json AS BLOB)) BETWEEN 2 AND 131072
  ),
  candidate_id TEXT REFERENCES search_result_candidates(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  document_id TEXT REFERENCES fetched_documents(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  clip_id TEXT REFERENCES clips(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  truth_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (truth_status = 'UNVERIFIED'),
  fact_status TEXT NOT NULL DEFAULT 'NOT_A_FACT' CHECK (fact_status = 'NOT_A_FACT'),
  normalization_version TEXT NOT NULL CHECK (
    normalization_version = 'bibliography-normalization-v1'
  ),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(warnings_json) AND json_type(warnings_json) = 'array' AND
    length(CAST(warnings_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (origin_kind, origin_record_id, origin_revision),
  CHECK (
    (display_title_raw IS NULL) = (display_title_normalized IS NULL) AND
    (original_title_raw IS NULL) = (original_title_normalized IS NULL)
  ),
  CHECK (
    (origin_kind = 'SEARCH_CANDIDATE' AND candidate_id IS NOT NULL AND
      document_id IS NULL AND clip_id IS NULL) OR
    (origin_kind = 'FETCH_DOCUMENT' AND candidate_id IS NOT NULL AND
      document_id IS NOT NULL AND clip_id IS NULL) OR
    (origin_kind = 'BROWSER_CLIP_CANDIDATE' AND candidate_id IS NOT NULL AND
      clip_id IS NOT NULL AND document_id IS NULL) OR
    (origin_kind = 'SYNTHETIC_FIXTURE' AND candidate_id IS NULL AND
      document_id IS NULL AND clip_id IS NULL)
  )
) STRICT;

CREATE TABLE bibliographic_observation_fields (
  observation_id TEXT NOT NULL REFERENCES bibliographic_observations(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (length(field_name) BETWEEN 1 AND 128),
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 63),
  raw_value TEXT CHECK (raw_value IS NULL OR length(raw_value) BETWEEN 1 AND 2000),
  normalized_value TEXT CHECK (
    normalized_value IS NULL OR length(normalized_value) BETWEEN 1 AND 2000
  ),
  algorithm_version TEXT NOT NULL CHECK (length(algorithm_version) BETWEEN 1 AND 128),
  provenance_json TEXT NOT NULL CHECK (
    json_valid(provenance_json) AND json_type(provenance_json) = 'object' AND
    length(CAST(provenance_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  PRIMARY KEY (observation_id, field_name, ordinal)
) STRICT, WITHOUT ROWID;

CREATE TABLE catalog_entity_aliases (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('WORK', 'EXPRESSION', 'EDITION', 'AGENT')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) >= 1),
  alias_kind TEXT NOT NULL CHECK (alias_kind IN (
    'CANONICAL', 'ORIGINAL', 'TRANSLATED', 'PEN_NAME', 'ROMANIZED',
    'FORMER_NAME', 'IMPRINT_NAME', 'LEGACY'
  )),
  raw_value TEXT NOT NULL CHECK (length(raw_value) BETWEEN 1 AND 2000),
  normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 1 AND 2000),
  language TEXT CHECK (language IS NULL OR length(language) BETWEEN 1 AND 32),
  script TEXT CHECK (script IS NULL OR length(script) BETWEEN 1 AND 32),
  normalization_version TEXT NOT NULL CHECK (
    normalization_version = 'bibliography-normalization-v1'
  ),
  observation_id TEXT REFERENCES bibliographic_observations(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (entity_type, entity_id, alias_kind, normalized_value)
) STRICT;

INSERT INTO catalog_entity_aliases (
  id, entity_type, entity_id, alias_kind, raw_value, normalized_value,
  normalization_version
)
SELECT
  'legacy-work-title-' || id,
  'WORK',
  id,
  'CANONICAL',
  canonical_title,
  lower(trim(canonical_title)),
  'bibliography-normalization-v1'
FROM books;

INSERT OR IGNORE INTO catalog_entity_aliases (
  id, entity_type, entity_id, alias_kind, raw_value, normalized_value,
  normalization_version
)
SELECT
  'legacy-work-original-' || id,
  'WORK',
  id,
  'ORIGINAL',
  original_title,
  lower(trim(original_title)),
  'bibliography-normalization-v1'
FROM books
WHERE original_title IS NOT NULL AND length(trim(original_title)) > 0;

INSERT INTO catalog_entity_aliases (
  id, entity_type, entity_id, alias_kind, raw_value, normalized_value,
  normalization_version
)
SELECT
  'legacy-agent-name-' || id,
  'AGENT',
  id,
  'CANONICAL',
  canonical_name,
  lower(trim(canonical_name)),
  'bibliography-normalization-v1'
FROM authors;

CREATE TABLE catalog_agent_relations (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('WORK', 'EXPRESSION', 'EDITION')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) >= 1),
  agent_id TEXT NOT NULL REFERENCES catalog_agents(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN (
    'AUTHOR', 'COAUTHOR', 'ORIGINAL_CREATOR', 'TRANSLATOR', 'ADAPTER', 'EDITOR',
    'PUBLISHER', 'IMPRINT', 'DISTRIBUTOR', 'PLATFORM'
  )),
  verification_state TEXT NOT NULL DEFAULT 'OBSERVED_UNVERIFIED' CHECK (
    verification_state IN ('OBSERVED_UNVERIFIED', 'USER_CONFIRMED', 'EVIDENCE_PENDING')
  ),
  observation_id TEXT REFERENCES bibliographic_observations(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  UNIQUE (scope_type, scope_id, agent_id, role)
) STRICT;

INSERT INTO catalog_agent_relations (
  id, scope_type, scope_id, agent_id, role, verification_state
)
SELECT
  'legacy-work-author-' || id,
  'WORK',
  id,
  author_id,
  'AUTHOR',
  'OBSERVED_UNVERIFIED'
FROM books
WHERE author_id IS NOT NULL;

CREATE TABLE publication_relationships (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  role TEXT NOT NULL CHECK (role IN ('RIGHTS_PARTY', 'LICENSOR', 'LICENSEE', 'AGENCY')),
  subject_agent_id TEXT NOT NULL REFERENCES catalog_agents(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  object_agent_id TEXT REFERENCES catalog_agents(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  scope_type TEXT CHECK (scope_type IS NULL OR scope_type IN ('WORK', 'EXPRESSION', 'EDITION')),
  scope_id TEXT CHECK (scope_id IS NULL OR length(scope_id) >= 1),
  language TEXT CHECK (language IS NULL OR length(language) BETWEEN 1 AND 32),
  territory TEXT CHECK (territory IS NULL OR length(territory) BETWEEN 1 AND 128),
  format TEXT CHECK (format IS NULL OR length(format) BETWEEN 1 AND 128),
  valid_from TEXT,
  valid_until TEXT,
  verification_state TEXT NOT NULL CHECK (
    verification_state IN ('OBSERVED_UNVERIFIED', 'USER_CONFIRMED', 'EVIDENCE_PENDING')
  ),
  observation_id TEXT REFERENCES bibliographic_observations(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  CHECK ((scope_type IS NULL) = (scope_id IS NULL)),
  CHECK (object_agent_id IS NULL OR object_agent_id <> subject_agent_id),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
) STRICT;

CREATE TABLE bibliographic_identifiers (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  entity_type TEXT NOT NULL CHECK (entity_type = 'EDITION'),
  entity_id TEXT NOT NULL REFERENCES book_editions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  namespace TEXT NOT NULL CHECK (
    namespace = 'ISBN_13' OR namespace GLOB 'PLATFORM:*' OR namespace GLOB 'PUBLISHER:*'
  ),
  normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 1 AND 256),
  observation_id TEXT NOT NULL REFERENCES bibliographic_observations(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (namespace, normalized_value)
) STRICT;

CREATE TABLE observation_entity_links (
  observation_id TEXT NOT NULL REFERENCES bibliographic_observations(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('WORK', 'EXPRESSION', 'EDITION', 'AGENT')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) >= 1),
  link_outcome TEXT NOT NULL CHECK (link_outcome IN (
    'EXACT_LINK', 'USER_CONFIRMED', 'CREATED_FROM_OBSERVATION'
  )),
  rule_version TEXT NOT NULL CHECK (
    rule_version = 'entity-resolution-v1' OR rule_version = 'user-decision-v1'
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (observation_id, entity_type, entity_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE discovery_profiles (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  contract_version TEXT NOT NULL CHECK (
    contract_version = 'discovery-portfolio-profile-v1'
  ),
  purpose TEXT NOT NULL CHECK (purpose IN ('PILOT_CONTENT', 'MARKET_MAP', 'CUSTOM')),
  synthetic INTEGER NOT NULL CHECK (synthetic IN (0, 1)),
  profile_json TEXT NOT NULL CHECK (
    json_valid(profile_json) AND json_type(profile_json) = 'object' AND
    length(CAST(profile_json AS BLOB)) BETWEEN 2 AND 131072
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (id, revision)
) STRICT, WITHOUT ROWID;

CREATE TABLE discovery_plans (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  contract_version TEXT NOT NULL CHECK (contract_version = 'discovery-plan-v1'),
  profile_id TEXT NOT NULL,
  profile_revision INTEGER NOT NULL,
  plan_hash TEXT NOT NULL UNIQUE CHECK (
    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  plan_json TEXT NOT NULL CHECK (
    json_valid(plan_json) AND json_type(plan_json) = 'object' AND
    length(CAST(plan_json AS BLOB)) BETWEEN 2 AND 262144
  ),
  estimated_external_requests INTEGER NOT NULL DEFAULT 0
    CHECK (estimated_external_requests = 0),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  expires_at TEXT NOT NULL CHECK (expires_at ${UTC_REQUIRED}),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  FOREIGN KEY (profile_id, profile_revision)
    REFERENCES discovery_profiles(id, revision) ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (expires_at > created_at)
) STRICT;

CREATE TABLE discovery_plan_strata (
  plan_id TEXT NOT NULL REFERENCES discovery_plans(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  stratum_id TEXT NOT NULL CHECK (length(stratum_id) BETWEEN 1 AND 128),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 128),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  target_observations INTEGER NOT NULL CHECK (target_observations >= 0),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 1000),
  gap_policy TEXT NOT NULL CHECK (gap_policy IN ('ALLOW_EXPLAINED', 'REQUIRE_PROCESSED')),
  PRIMARY KEY (plan_id, stratum_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE discovery_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  contract_version TEXT NOT NULL CHECK (contract_version = 'discovery-run-v1'),
  plan_id TEXT NOT NULL REFERENCES discovery_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  plan_hash TEXT NOT NULL CHECK (
    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  execution_id TEXT UNIQUE CHECK (
    execution_id IS NULL OR length(execution_id) BETWEEN 1 AND 128
  ),
  job_id TEXT CHECK (job_id IS NULL OR length(job_id) BETWEEN 1 AND 128),
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT', 'PREVIEWED', 'CONFIRMED', 'RUNNING', 'AWAITING_REVIEW',
    'COMPLETED', 'COMPLETED_WITH_GAPS', 'CANCELLED', 'FAILED', 'INTERRUPTED'
  )),
  checkpoint_sequence INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_sequence >= 0),
  observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  work_count INTEGER NOT NULL DEFAULT 0 CHECK (work_count >= 0),
  expression_count INTEGER NOT NULL DEFAULT 0 CHECK (expression_count >= 0),
  edition_count INTEGER NOT NULL DEFAULT 0 CHECK (edition_count >= 0),
  review_case_count INTEGER NOT NULL DEFAULT 0 CHECK (review_case_count >= 0),
  external_request_count INTEGER NOT NULL DEFAULT 0 CHECK (external_request_count = 0),
  stable_error_code TEXT CHECK (
    stable_error_code IS NULL OR length(stable_error_code) BETWEEN 1 AND 96
  ),
  started_at TEXT,
  finished_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  CHECK ((status = 'RUNNING') = (started_at IS NOT NULL AND finished_at IS NULL))
) STRICT;

CREATE TABLE discovery_run_origins (
  run_id TEXT NOT NULL REFERENCES discovery_runs(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN (
    'SEARCH_CANDIDATE', 'FETCH_DOCUMENT', 'BROWSER_CLIP_CANDIDATE', 'SYNTHETIC_FIXTURE'
  )),
  origin_record_id TEXT NOT NULL CHECK (length(origin_record_id) BETWEEN 1 AND 128),
  origin_revision INTEGER NOT NULL CHECK (origin_revision > 0),
  processed INTEGER NOT NULL DEFAULT 0 CHECK (processed IN (0, 1)),
  PRIMARY KEY (run_id, sequence),
  UNIQUE (run_id, origin_kind, origin_record_id, origin_revision)
) STRICT, WITHOUT ROWID;

CREATE TABLE discovery_run_stratum_coverage (
  run_id TEXT NOT NULL REFERENCES discovery_runs(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  stratum_id TEXT NOT NULL CHECK (length(stratum_id) BETWEEN 1 AND 128),
  planned_observations INTEGER NOT NULL CHECK (planned_observations >= 0),
  observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  work_count INTEGER NOT NULL DEFAULT 0 CHECK (work_count >= 0),
  expression_count INTEGER NOT NULL DEFAULT 0 CHECK (expression_count >= 0),
  edition_count INTEGER NOT NULL DEFAULT 0 CHECK (edition_count >= 0),
  unresolved_count INTEGER NOT NULL DEFAULT 0 CHECK (unresolved_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  invalid_identifier_count INTEGER NOT NULL DEFAULT 0 CHECK (invalid_identifier_count >= 0),
  exact_link_count INTEGER NOT NULL DEFAULT 0 CHECK (exact_link_count >= 0),
  manual_decision_count INTEGER NOT NULL DEFAULT 0 CHECK (manual_decision_count >= 0),
  provenance_complete_count INTEGER NOT NULL DEFAULT 0 CHECK (provenance_complete_count >= 0),
  pre_resolution_count INTEGER NOT NULL DEFAULT 0 CHECK (pre_resolution_count >= 0),
  post_resolution_count INTEGER NOT NULL DEFAULT 0 CHECK (post_resolution_count >= 0),
  gap_reason TEXT CHECK (gap_reason IS NULL OR length(gap_reason) BETWEEN 1 AND 256),
  synthetic INTEGER NOT NULL CHECK (synthetic IN (0, 1)),
  PRIMARY KEY (run_id, stratum_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE resolution_cases (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  observation_id TEXT NOT NULL REFERENCES bibliographic_observations(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('WORK', 'EXPRESSION', 'EDITION', 'AGENT')),
  candidate_entity_id TEXT CHECK (
    candidate_entity_id IS NULL OR length(candidate_entity_id) >= 1
  ),
  outcome TEXT NOT NULL CHECK (outcome IN (
    'PROBABLE_REVIEW', 'CONFLICT', 'INSUFFICIENT'
  )),
  feature_vector_json TEXT NOT NULL CHECK (
    json_valid(feature_vector_json) AND json_type(feature_vector_json) = 'object' AND
    length(CAST(feature_vector_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  rule_version TEXT NOT NULL CHECK (rule_version = 'entity-resolution-v1'),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE entity_redirects (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('WORK', 'EXPRESSION', 'EDITION', 'AGENT')),
  from_entity_id TEXT NOT NULL CHECK (length(from_entity_id) >= 1),
  to_entity_id TEXT NOT NULL CHECK (length(to_entity_id) >= 1),
  decision_id TEXT NOT NULL CHECK (length(decision_id) BETWEEN 1 AND 128),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  PRIMARY KEY (entity_type, from_entity_id),
  CHECK (from_entity_id <> to_entity_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE resolution_decisions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  decision_type TEXT NOT NULL CHECK (decision_type IN ('MERGE', 'SPLIT', 'UNDO')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('WORK', 'EXPRESSION', 'EDITION', 'AGENT')),
  survivor_entity_id TEXT NOT NULL CHECK (length(survivor_entity_id) >= 1),
  affected_entity_id TEXT NOT NULL CHECK (length(affected_entity_id) >= 1),
  parent_decision_id TEXT REFERENCES resolution_decisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  preview_hash TEXT NOT NULL CHECK (
    length(preview_hash) = 64 AND preview_hash NOT GLOB '*[^0-9a-f]*'
  ),
  before_json TEXT NOT NULL CHECK (
    json_valid(before_json) AND json_type(before_json) = 'object' AND
    length(CAST(before_json AS BLOB)) BETWEEN 2 AND 262144
  ),
  after_json TEXT NOT NULL CHECK (
    json_valid(after_json) AND json_type(after_json) = 'object' AND
    length(CAST(after_json AS BLOB)) BETWEEN 2 AND 262144
  ),
  actor TEXT NOT NULL CHECK (actor = 'USER'),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE entity_lineage_memberships (
  decision_id TEXT NOT NULL REFERENCES resolution_decisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('WORK', 'EXPRESSION', 'EDITION', 'AGENT')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) >= 1),
  membership_kind TEXT NOT NULL CHECK (membership_kind IN (
    'SURVIVOR', 'MERGED_ENTITY', 'MOVED_CHILD', 'RESTORED_ENTITY', 'CREATED_SPLIT'
  )),
  parent_entity_id TEXT CHECK (parent_entity_id IS NULL OR length(parent_entity_id) >= 1),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (decision_id, entity_type, entity_id, membership_kind, ordinal)
) STRICT, WITHOUT ROWID;

CREATE TABLE catalog_audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'DISCOVERY_PREVIEWED', 'DISCOVERY_CONFIRMED', 'DISCOVERY_CANCELLED',
    'OBSERVATION_CREATED', 'ENTITY_CREATED', 'ENTITY_EXACT_LINKED',
    'RESOLUTION_CASE_CREATED', 'ENTITY_MERGED', 'ENTITY_SPLIT', 'DECISION_UNDONE'
  )),
  entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
  entity_id TEXT NOT NULL CHECK (length(entity_id) >= 1),
  details_json TEXT NOT NULL CHECK (
    json_valid(details_json) AND json_type(details_json) = 'object' AND
    length(CAST(details_json AS BLOB)) BETWEEN 2 AND 65536
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE INDEX idx_catalog_agents_name_state
  ON catalog_agents(normalized_name, catalog_state, id);
CREATE INDEX idx_catalog_alias_lookup
  ON catalog_entity_aliases(entity_type, normalized_value, entity_id);
CREATE INDEX idx_catalog_alias_entity
  ON catalog_entity_aliases(entity_type, entity_id, alias_kind);
CREATE INDEX idx_catalog_agent_rel_scope
  ON catalog_agent_relations(scope_type, scope_id, role);
CREATE INDEX idx_catalog_agent_rel_agent
  ON catalog_agent_relations(agent_id, role, scope_type);
CREATE INDEX idx_publication_rel_scope
  ON publication_relationships(scope_type, scope_id, role);
CREATE INDEX idx_publication_rel_agents
  ON publication_relationships(subject_agent_id, object_agent_id, role);
CREATE INDEX idx_observation_origin
  ON bibliographic_observations(origin_kind, origin_record_id, origin_revision);
CREATE INDEX idx_observation_title
  ON bibliographic_observations(display_title_normalized, observed_at DESC);
CREATE INDEX idx_observation_candidate ON bibliographic_observations(candidate_id);
CREATE INDEX idx_observation_document ON bibliographic_observations(document_id);
CREATE INDEX idx_observation_clip ON bibliographic_observations(clip_id);
CREATE INDEX idx_identifier_entity
  ON bibliographic_identifiers(entity_type, entity_id, namespace);
CREATE INDEX idx_observation_links_entity
  ON observation_entity_links(entity_type, entity_id, observation_id);
CREATE INDEX idx_discovery_runs_status_time
  ON discovery_runs(status, updated_at DESC);
CREATE INDEX idx_discovery_origins_pending
  ON discovery_run_origins(run_id, processed, sequence);
CREATE INDEX idx_resolution_cases_queue
  ON resolution_cases(status, outcome, updated_at DESC);
CREATE INDEX idx_redirect_target
  ON entity_redirects(entity_type, to_entity_id, active);
CREATE INDEX idx_resolution_decisions_entity
  ON resolution_decisions(entity_type, survivor_entity_id, created_at DESC);

CREATE TRIGGER bibliographic_observations_append_only_update
BEFORE UPDATE ON bibliographic_observations
BEGIN
  SELECT RAISE(ABORT, 'bibliographic observations are append-only');
END;

CREATE TRIGGER bibliographic_observations_append_only_delete
BEFORE DELETE ON bibliographic_observations
BEGIN
  SELECT RAISE(ABORT, 'bibliographic observations are append-only');
END;

CREATE TRIGGER resolution_decisions_append_only_update
BEFORE UPDATE ON resolution_decisions
BEGIN
  SELECT RAISE(ABORT, 'resolution decisions are append-only');
END;

CREATE TRIGGER resolution_decisions_append_only_delete
BEFORE DELETE ON resolution_decisions
BEGIN
  SELECT RAISE(ABORT, 'resolution decisions are append-only');
END;

CREATE TRIGGER catalog_audit_append_only_update
BEFORE UPDATE ON catalog_audit_events
BEGIN
  SELECT RAISE(ABORT, 'catalog audit is append-only');
END;

CREATE TRIGGER catalog_audit_append_only_delete
BEFORE DELETE ON catalog_audit_events
BEGIN
  SELECT RAISE(ABORT, 'catalog audit is append-only');
END;
`;

const SOURCE_EVIDENCE_AND_FACT_CONFLICTS = `
CREATE TABLE source_revisions (
  source_id TEXT NOT NULL REFERENCES sources(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
  contract_version TEXT NOT NULL CHECK (
    contract_version = 'source-evidence-v1' OR contract_version = 'legacy-source-v1'
  ),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN (
    'FETCH_DOCUMENT', 'BROWSER_CLIP', 'SYNTHETIC_FIXTURE', 'LEGACY_SOURCE'
  )),
  origin_record_id TEXT NOT NULL CHECK (length(origin_record_id) BETWEEN 1 AND 128),
  origin_revision INTEGER NOT NULL CHECK (
    typeof(origin_revision) = 'integer' AND origin_revision > 0
  ),
  content_hash TEXT NOT NULL CHECK (length(content_hash) BETWEEN 1 AND 128),
  canonical_url_hash TEXT CHECK (
    canonical_url_hash IS NULL OR
    (length(canonical_url_hash) = 64 AND canonical_url_hash NOT GLOB '*[^0-9a-f]*')
  ),
  display_host TEXT CHECK (
    display_host IS NULL OR length(display_host) BETWEEN 1 AND 253
  ),
  extracted_text_hash TEXT CHECK (
    extracted_text_hash IS NULL OR
    (length(extracted_text_hash) = 64 AND extracted_text_hash NOT GLOB '*[^0-9a-f]*')
  ),
  extracted_text_path TEXT CHECK (
    extracted_text_path IS NULL OR (
      length(extracted_text_path) BETWEEN 1 AND 1024 AND
      extracted_text_path GLOB 'sources/snapshots/??/*' AND
      instr(extracted_text_path, '..') = 0 AND
      instr(extracted_text_path, char(92)) = 0 AND
      instr(extracted_text_path, ':') = 0 AND
      substr(extracted_text_path, 1, 1) <> '/'
    )
  ),
  language TEXT NOT NULL CHECK (length(language) BETWEEN 1 AND 32),
  availability TEXT NOT NULL CHECK (
    availability IN ('AVAILABLE', 'UNAVAILABLE', 'RETRACTED', 'SUPERSEDED')
  ),
  retrieved_at TEXT NOT NULL CHECK (retrieved_at ${UTC_REQUIRED}),
  published_at TEXT,
  published_at_precision TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (
    published_at_precision IN ('YEAR', 'MONTH', 'DAY', 'UNKNOWN') AND
    ((published_at_precision = 'UNKNOWN' AND published_at IS NULL) OR
      (published_at_precision <> 'UNKNOWN' AND published_at IS NOT NULL))
  ),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(warnings_json) AND json_type(warnings_json) = 'array' AND
    length(CAST(warnings_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  provenance_json TEXT NOT NULL CHECK (
    json_valid(provenance_json) AND json_type(provenance_json) = 'object' AND
    length(CAST(provenance_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  PRIMARY KEY (source_id, revision),
  UNIQUE (origin_kind, origin_record_id, origin_revision),
  CHECK ((extracted_text_hash IS NULL) = (extracted_text_path IS NULL)),
  CHECK ((origin_kind = 'SYNTHETIC_FIXTURE') = (synthetic = 1)),
  CHECK (
    origin_kind IN ('LEGACY_SOURCE', 'BROWSER_CLIP') OR extracted_text_hash IS NOT NULL
  ),
  CHECK (
    contract_version = 'legacy-source-v1' OR
    (canonical_url_hash IS NOT NULL AND display_host IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

INSERT INTO source_revisions (
  source_id, revision, contract_version, origin_kind, origin_record_id,
  origin_revision, content_hash, canonical_url_hash, display_host,
  extracted_text_hash, extracted_text_path, language, availability,
  retrieved_at, published_at, published_at_precision, warnings_json,
  provenance_json, synthetic, created_at, updated_at
)
SELECT
  id, 1, 'legacy-source-v1', 'LEGACY_SOURCE', id, 1, content_hash, NULL, NULL,
  NULL, NULL, language, 'AVAILABLE', retrieved_at, NULL, 'UNKNOWN', '[]',
  json_object(
    'originKind', 'LEGACY_SOURCE',
    'originRecordId', id,
    'originRevision', 1
  ),
  0, retrieved_at, retrieved_at
FROM sources;

CREATE TABLE source_classifications (
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  classification_revision INTEGER NOT NULL CHECK (
    typeof(classification_revision) = 'integer' AND classification_revision > 0
  ),
  authority_tier TEXT NOT NULL CHECK (authority_tier IN (
    'OFFICIAL_PRIMARY', 'INDEPENDENT_SECONDARY', 'DISCUSSION_CONTEXT', 'UNKNOWN'
  )),
  use_class TEXT NOT NULL CHECK (use_class IN (
    'KEY_FACT_ELIGIBLE', 'SUPPORTING_ONLY', 'CONTEXT_ONLY', 'NOT_CLASSIFIED'
  )),
  independence_state TEXT NOT NULL CHECK (independence_state IN (
    'CONFIRMED_INDEPENDENT', 'DEPENDENT', 'UNKNOWN'
  )),
  lineage_group TEXT CHECK (
    lineage_group IS NULL OR length(lineage_group) BETWEEN 1 AND 128
  ),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 128),
  classified_by TEXT NOT NULL CHECK (
    classified_by IN ('USER', 'DETERMINISTIC_RULE', 'SYNTHETIC_FIXTURE')
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (source_id, source_revision, classification_revision),
  FOREIGN KEY (source_id, source_revision)
    REFERENCES source_revisions(source_id, revision)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (
    authority_tier <> 'DISCUSSION_CONTEXT' OR use_class = 'CONTEXT_ONLY'
  ),
  CHECK (
    independence_state <> 'CONFIRMED_INDEPENDENT' OR lineage_group IS NOT NULL
  )
) STRICT, WITHOUT ROWID;

INSERT INTO source_classifications (
  source_id, source_revision, classification_revision, authority_tier,
  use_class, independence_state, lineage_group, reason_code, classified_by, created_at
)
SELECT
  source_id, revision, 1, 'UNKNOWN', 'NOT_CLASSIFIED', 'UNKNOWN',
  NULL, 'LEGACY_SOURCE_REQUIRES_REVIEW', 'DETERMINISTIC_RULE', created_at
FROM source_revisions;

CREATE TABLE source_lineage (
  source_id TEXT NOT NULL REFERENCES sources(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  parent_source_id TEXT NOT NULL REFERENCES sources(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (relation IN (
    'REPRINT_OF', 'MIRROR_OF', 'DERIVED_FROM', 'SAME_PRESS_RELEASE'
  )),
  confirmed_by TEXT NOT NULL CHECK (confirmed_by = 'USER'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (source_id, parent_source_id, relation),
  CHECK (source_id <> parent_source_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE fact_subjects (
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'WORK', 'EXPRESSION', 'EDITION', 'AGENT', 'PUBLICATION_RELATIONSHIP'
  )),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
  work_id TEXT REFERENCES books(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  expression_id TEXT REFERENCES expressions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  edition_id TEXT REFERENCES book_editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  agent_id TEXT REFERENCES catalog_agents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  publication_relationship_id TEXT REFERENCES publication_relationships(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (subject_type, subject_id),
  CHECK (
    (subject_type = 'WORK' AND work_id IS NOT NULL AND work_id = subject_id AND
      expression_id IS NULL AND
      edition_id IS NULL AND agent_id IS NULL AND publication_relationship_id IS NULL) OR
    (subject_type = 'EXPRESSION' AND expression_id IS NOT NULL AND
      expression_id = subject_id AND work_id IS NULL AND
      edition_id IS NULL AND agent_id IS NULL AND publication_relationship_id IS NULL) OR
    (subject_type = 'EDITION' AND edition_id IS NOT NULL AND
      edition_id = subject_id AND work_id IS NULL AND
      expression_id IS NULL AND agent_id IS NULL AND publication_relationship_id IS NULL) OR
    (subject_type = 'AGENT' AND agent_id IS NOT NULL AND
      agent_id = subject_id AND work_id IS NULL AND
      expression_id IS NULL AND edition_id IS NULL AND publication_relationship_id IS NULL) OR
    (subject_type = 'PUBLICATION_RELATIONSHIP' AND
      publication_relationship_id IS NOT NULL AND
      publication_relationship_id = subject_id AND work_id IS NULL AND
      expression_id IS NULL AND edition_id IS NULL AND agent_id IS NULL)
  )
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO fact_subjects(subject_type, subject_id, work_id)
SELECT 'WORK', claim.subject_id, book.id
FROM claims AS claim JOIN books AS book ON book.id = claim.subject_id
WHERE claim.subject_type IN ('WORK', 'BOOK');

INSERT OR IGNORE INTO fact_subjects(subject_type, subject_id, expression_id)
SELECT 'EXPRESSION', claim.subject_id, expression.id
FROM claims AS claim JOIN expressions AS expression ON expression.id = claim.subject_id
WHERE claim.subject_type = 'EXPRESSION';

INSERT OR IGNORE INTO fact_subjects(subject_type, subject_id, edition_id)
SELECT 'EDITION', claim.subject_id, edition.id
FROM claims AS claim JOIN book_editions AS edition ON edition.id = claim.subject_id
WHERE claim.subject_type IN ('EDITION', 'BOOK_EDITION');

INSERT OR IGNORE INTO fact_subjects(subject_type, subject_id, agent_id)
SELECT 'AGENT', claim.subject_id, agent.id
FROM claims AS claim JOIN catalog_agents AS agent ON agent.id = claim.subject_id
WHERE claim.subject_type IN ('AGENT', 'AUTHOR');

INSERT OR IGNORE INTO fact_subjects(
  subject_type, subject_id, publication_relationship_id
)
SELECT 'PUBLICATION_RELATIONSHIP', claim.subject_id, relationship.id
FROM claims AS claim
JOIN publication_relationships AS relationship ON relationship.id = claim.subject_id
WHERE claim.subject_type = 'PUBLICATION_RELATIONSHIP';

CREATE TABLE issue019_claim_compatibility_guard (
  incompatible_count INTEGER NOT NULL CHECK (incompatible_count = 0)
) STRICT;

INSERT INTO issue019_claim_compatibility_guard(incompatible_count)
SELECT count(*)
FROM claims AS claim
LEFT JOIN fact_subjects AS subject
  ON subject.subject_id = claim.subject_id
 AND subject.subject_type = CASE claim.subject_type
   WHEN 'BOOK' THEN 'WORK'
   WHEN 'BOOK_EDITION' THEN 'EDITION'
   WHEN 'AUTHOR' THEN 'AGENT'
   ELSE claim.subject_type
 END
WHERE subject.subject_id IS NULL;

DROP TABLE issue019_claim_compatibility_guard;

CREATE TABLE predicate_registry (
  predicate TEXT PRIMARY KEY CHECK (
    length(predicate) BETWEEN 1 AND 128 AND
    predicate NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  predicate_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(predicate_version) = 'integer' AND predicate_version > 0
  ),
  value_type TEXT NOT NULL CHECK (value_type IN (
    'TEXT', 'INTEGER', 'DECIMAL_TEXT', 'DATE_WITH_PRECISION', 'IDENTIFIER',
    'ENUM', 'DATE', 'BOOLEAN', 'ENTITY_REF', 'LEGACY_JSON'
  )),
  value_schema_version TEXT NOT NULL CHECK (
    length(value_schema_version) BETWEEN 1 AND 64
  ),
  multiple_allowed INTEGER NOT NULL DEFAULT 0 CHECK (multiple_allowed IN (0, 1)),
  material_conflict INTEGER NOT NULL DEFAULT 1 CHECK (material_conflict IN (0, 1)),
  normalization_version TEXT NOT NULL CHECK (
    normalization_version = 'claim-normalization-v1' OR
    normalization_version = 'legacy-json-v1'
  ),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED})
) STRICT;

INSERT INTO predicate_registry(
  predicate, predicate_version, value_type, value_schema_version,
  multiple_allowed, material_conflict, normalization_version
) VALUES
  ('canonical_title', 1, 'TEXT', 'text-v1', 0, 1, 'claim-normalization-v1'),
  ('original_title', 1, 'TEXT', 'text-v1', 0, 1, 'claim-normalization-v1'),
  ('translated_title', 1, 'TEXT', 'text-v1', 1, 1, 'claim-normalization-v1'),
  ('author', 1, 'ENTITY_REF', 'entity-ref-v1', 1, 1, 'claim-normalization-v1'),
  ('translator', 1, 'ENTITY_REF', 'entity-ref-v1', 1, 1, 'claim-normalization-v1'),
  ('publisher', 1, 'ENTITY_REF', 'entity-ref-v1', 1, 1, 'claim-normalization-v1'),
  ('imprint', 1, 'TEXT', 'text-v1', 1, 1, 'claim-normalization-v1'),
  ('publication_date', 1, 'DATE_WITH_PRECISION', 'date-precision-v1', 0, 1,
    'claim-normalization-v1'),
  ('isbn', 1, 'IDENTIFIER', 'identifier-v1', 1, 1, 'claim-normalization-v1'),
  ('platform_identifier', 1, 'IDENTIFIER', 'identifier-v1', 1, 1,
    'claim-normalization-v1'),
  ('language', 1, 'IDENTIFIER', 'identifier-v1', 1, 1, 'claim-normalization-v1'),
  ('territory', 1, 'IDENTIFIER', 'identifier-v1', 1, 1, 'claim-normalization-v1'),
  ('format', 1, 'ENUM', 'enum-v1', 1, 1, 'claim-normalization-v1'),
  ('award_nomination', 1, 'TEXT', 'text-v1', 1, 1, 'claim-normalization-v1'),
  ('award_win', 1, 'TEXT', 'text-v1', 1, 1, 'claim-normalization-v1'),
  ('series_membership', 1, 'ENTITY_REF', 'entity-ref-v1', 1, 1,
    'claim-normalization-v1'),
  ('series_order', 1, 'DECIMAL_TEXT', 'decimal-text-v1', 0, 1,
    'claim-normalization-v1'),
  ('publication_relationship', 1, 'ENTITY_REF', 'entity-ref-v1', 1, 1,
    'claim-normalization-v1'),
  ('page_count', 1, 'INTEGER', 'integer-v1', 0, 1, 'claim-normalization-v1'),
  ('official_title', 1, 'TEXT', 'text-v1', 0, 1, 'claim-normalization-v1');

INSERT OR IGNORE INTO predicate_registry(
  predicate, predicate_version, value_type, value_schema_version,
  multiple_allowed, material_conflict, normalization_version
)
SELECT predicate, 1, 'LEGACY_JSON', 'legacy-json-v1', 0, 1, 'legacy-json-v1'
FROM claims;

CREATE TABLE claims_issue019_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  contract_version TEXT NOT NULL CHECK (
    contract_version IN ('atomic-claim-v1', 'legacy-claim-v1')
  ),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL REFERENCES predicate_registry(predicate)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  predicate_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(predicate_version) = 'integer' AND predicate_version > 0
  ),
  value_type TEXT NOT NULL CHECK (value_type IN (
    'TEXT', 'INTEGER', 'DECIMAL_TEXT', 'DATE_WITH_PRECISION', 'IDENTIFIER',
    'ENUM', 'DATE', 'BOOLEAN', 'ENTITY_REF', 'LEGACY_JSON'
  )),
  value_json TEXT NOT NULL CHECK (
    json_valid(value_json) AND length(CAST(value_json AS BLOB)) BETWEEN 1 AND 32768
  ),
  normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 1 AND 8192),
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(scope_json) AND json_type(scope_json) = 'object' AND
    length(CAST(scope_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  normalized_scope_hash TEXT NOT NULL CHECK (
    length(normalized_scope_hash) = 64 AND
    normalized_scope_hash NOT GLOB '*[^0-9a-f]*'
  ),
  policy_version TEXT NOT NULL DEFAULT 'fact-policy-v1'
    CHECK (policy_version = 'fact-policy-v1'),
  key_fact INTEGER NOT NULL DEFAULT 0 CHECK (key_fact IN (0, 1)),
  claimant_source_id TEXT,
  claimant_source_revision INTEGER,
  semantic_fingerprint TEXT NOT NULL CHECK (
    length(semantic_fingerprint) = 64 AND
    semantic_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('CANDIDATE', 'ACTIVE', 'REJECTED')
  ),
  provenance_json TEXT NOT NULL CHECK (
    json_valid(provenance_json) AND json_type(provenance_json) = 'object' AND
    length(CAST(provenance_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  legacy_conflict_status TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  FOREIGN KEY (subject_type, subject_id)
    REFERENCES fact_subjects(subject_type, subject_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (claimant_source_id, claimant_source_revision)
    REFERENCES source_revisions(source_id, revision)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (
    (claimant_source_id IS NULL) = (claimant_source_revision IS NULL)
  )
) STRICT;

INSERT INTO claims_issue019_new(
  id, contract_version, subject_type, subject_id, predicate, predicate_version, value_type,
  value_json, normalized_value, scope_json, normalized_scope_hash,
  key_fact, semantic_fingerprint, status, provenance_json,
  confidence, legacy_conflict_status, created_at
)
SELECT
  claim.id,
  'legacy-claim-v1',
  CASE claim.subject_type
    WHEN 'BOOK' THEN 'WORK'
    WHEN 'BOOK_EDITION' THEN 'EDITION'
    WHEN 'AUTHOR' THEN 'AGENT'
    ELSE claim.subject_type
  END,
  claim.subject_id,
  claim.predicate,
  1,
  registry.value_type,
  claim.value_json,
  claim.value_json,
  '{}',
  '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  0,
  lower(hex(randomblob(32))),
  'ACTIVE',
  json_object('kind', 'LEGACY_MIGRATION', 'runId', NULL),
  claim.confidence,
  claim.conflict_status,
  claim.created_at
FROM claims AS claim
JOIN predicate_registry AS registry ON registry.predicate = claim.predicate;

CREATE TABLE claim_evidence_issue019_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  claim_id TEXT NOT NULL REFERENCES claims_issue019_new(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  locator_version TEXT NOT NULL CHECK (
    locator_version IN ('evidence-locator-v1', 'legacy-unlocated-v1')
  ),
  locator_kind TEXT NOT NULL CHECK (locator_kind IN ('CHAR_RANGE', 'LEGACY_UNLOCATED')),
  locator_json TEXT NOT NULL CHECK (
    json_valid(locator_json) AND json_type(locator_json) = 'object' AND
    length(CAST(locator_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  excerpt TEXT NOT NULL CHECK (length(excerpt) BETWEEN 1 AND 8000),
  excerpt_hash TEXT NOT NULL CHECK (
    length(excerpt_hash) = 64 AND excerpt_hash NOT GLOB '*[^0-9a-f]*'
  ),
  supports_or_contradicts TEXT NOT NULL CHECK (
    supports_or_contradicts IN ('SUPPORTS', 'CONTRADICTS', 'QUALIFIES')
  ),
  language TEXT NOT NULL CHECK (length(language) BETWEEN 1 AND 32),
  summary_zh TEXT CHECK (summary_zh IS NULL OR length(summary_zh) BETWEEN 1 AND 8000),
  summary_method TEXT CHECK (
    summary_method IS NULL OR summary_method IN ('MANUAL', 'MODEL_CANDIDATE')
  ),
  model_execution_id TEXT CHECK (
    model_execution_id IS NULL OR length(model_execution_id) BETWEEN 1 AND 128
  ),
  locator_validated INTEGER NOT NULL CHECK (locator_validated IN (0, 1)),
  verification_status TEXT NOT NULL DEFAULT 'VALIDATED' CHECK (
    verification_status IN ('PENDING', 'VALIDATED', 'REJECTED', 'STALE')
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  FOREIGN KEY (source_id, source_revision)
    REFERENCES source_revisions(source_id, revision)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE (claim_id, source_id, source_revision, excerpt_hash),
  CHECK ((summary_zh IS NULL) = (summary_method IS NULL)),
  CHECK (
    (summary_method = 'MODEL_CANDIDATE' AND model_execution_id IS NOT NULL) OR
    summary_method IS NULL OR summary_method = 'MANUAL'
  ),
  CHECK (
    (locator_kind = 'CHAR_RANGE' AND locator_validated = 1) OR
    (locator_kind = 'LEGACY_UNLOCATED' AND locator_validated = 0)
  )
) STRICT;

INSERT INTO claim_evidence_issue019_new(
  id, claim_id, source_id, source_revision, locator_version, locator_kind,
  locator_json, excerpt, excerpt_hash, supports_or_contradicts, language,
  locator_validated
)
SELECT
  'legacy:' || evidence.claim_id || ':' || evidence.source_id,
  evidence.claim_id,
  evidence.source_id,
  1,
  'legacy-unlocated-v1',
  'LEGACY_UNLOCATED',
  json_object('legacyLocator', evidence.locator),
  evidence.evidence_excerpt,
  '0000000000000000000000000000000000000000000000000000000000000000',
  evidence.supports_or_contradicts,
  source.language,
  0
FROM claim_evidence AS evidence
JOIN sources AS source ON source.id = evidence.source_id;

DROP TABLE claim_evidence;
DROP TABLE claims;
ALTER TABLE claims_issue019_new RENAME TO claims;
ALTER TABLE claim_evidence_issue019_new RENAME TO claim_evidence;

CREATE TABLE fact_conflicts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  conflict_key TEXT NOT NULL UNIQUE CHECK (length(conflict_key) BETWEEN 1 AND 512),
  claim_left_id TEXT NOT NULL REFERENCES claims(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_right_id TEXT NOT NULL REFERENCES claims(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN (
    'OPEN', 'FACT_BLOCKED', 'RESOLVED_ACCEPT', 'RESOLVED_MULTIVALUE',
    'RESOLVED_SCOPE_SPLIT', 'DISMISSED_DEPENDENT_SOURCE', 'SUPERSEDED', 'REOPENED'
  )),
  material INTEGER NOT NULL DEFAULT 1 CHECK (material = 1),
  policy_version TEXT NOT NULL CHECK (policy_version = 'fact-policy-v1'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  CHECK (claim_left_id < claim_right_id)
) STRICT;

CREATE TABLE fact_conflict_decisions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  conflict_id TEXT NOT NULL REFERENCES fact_conflicts(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'ACCEPT_CLAIM', 'ACCEPT_MULTIVALUE', 'SPLIT_SCOPE',
    'DISMISS_DEPENDENT_SOURCE', 'UNDO', 'REOPEN'
  )),
  accepted_claim_id TEXT REFERENCES claims(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  parent_decision_id TEXT REFERENCES fact_conflict_decisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  expected_revision INTEGER NOT NULL CHECK (expected_revision > 0),
  resulting_revision INTEGER NOT NULL CHECK (
    resulting_revision = expected_revision + 1
  ),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  preview_hash TEXT NOT NULL CHECK (
    length(preview_hash) = 64 AND preview_hash NOT GLOB '*[^0-9a-f]*'
  ),
  actor TEXT NOT NULL CHECK (actor = 'USER'),
  before_json TEXT NOT NULL CHECK (
    json_valid(before_json) AND json_type(before_json) = 'object' AND
    length(CAST(before_json AS BLOB)) BETWEEN 2 AND 65536
  ),
  after_json TEXT NOT NULL CHECK (
    json_valid(after_json) AND json_type(after_json) = 'object' AND
    length(CAST(after_json AS BLOB)) BETWEEN 2 AND 65536
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE fact_evaluations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  claim_id TEXT NOT NULL REFERENCES claims(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN (
    'NOT_EVALUATED', 'INSUFFICIENT', 'SUPPORTED_NOT_VERIFIED', 'VERIFIED',
    'CONFLICTED', 'FACT_BLOCKED', 'STALE_REVIEW_REQUIRED', 'REJECTED'
  )),
  policy_version TEXT NOT NULL CHECK (policy_version = 'fact-policy-v1'),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 128),
  qualifying_source_ids_json TEXT NOT NULL CHECK (
    json_valid(qualifying_source_ids_json) AND
    json_type(qualifying_source_ids_json) = 'array' AND
    length(CAST(qualifying_source_ids_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  source_revision_digest TEXT NOT NULL CHECK (
    length(source_revision_digest) = 64 AND
    source_revision_digest NOT GLOB '*[^0-9a-f]*'
  ),
  independence_snapshot_json TEXT NOT NULL CHECK (
    json_valid(independence_snapshot_json) AND
    json_type(independence_snapshot_json) = 'array' AND
    length(CAST(independence_snapshot_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  input_identity_hash TEXT NOT NULL UNIQUE CHECK (
    length(input_identity_hash) = 64 AND
    input_identity_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE fact_audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'SOURCE_REGISTERED', 'SOURCE_REVISION_ADDED', 'CLAIM_CREATED',
    'SOURCE_LINEAGE_CONFIRMED', 'EVIDENCE_ATTACHED', 'FACT_EVALUATED', 'CONFLICT_OPENED',
    'CONFLICT_RESOLVED', 'CONFLICT_UNDONE', 'CONFLICT_REOPENED',
    'PROCESSING_PLAN_CONFIRMED', 'PROCESSING_CANCELLED'
  )),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'SOURCE', 'CLAIM', 'EVIDENCE', 'CONFLICT', 'PROCESSING_RUN'
  )),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 256),
  details_json TEXT NOT NULL CHECK (
    json_valid(details_json) AND json_type(details_json) = 'object' AND
    length(CAST(details_json AS BLOB)) BETWEEN 2 AND 65536
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE source_processing_plans (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  contract_version TEXT NOT NULL CHECK (
    contract_version = 'source-processing-plan-v1'
  ),
  plan_hash TEXT NOT NULL UNIQUE CHECK (
    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  plan_json TEXT NOT NULL CHECK (
    json_valid(plan_json) AND json_type(plan_json) = 'object' AND
    length(CAST(plan_json AS BLOB)) BETWEEN 2 AND 131072
  ),
  estimated_external_requests INTEGER NOT NULL CHECK (
    estimated_external_requests BETWEEN 0 AND 128
  ),
  estimated_fee TEXT NOT NULL CHECK (estimated_fee = 'UNKNOWN'),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  expires_at TEXT NOT NULL CHECK (expires_at ${UTC_REQUIRED}),
  CHECK (expires_at > created_at)
) STRICT;

CREATE TABLE source_processing_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL UNIQUE CHECK (length(execution_id) BETWEEN 1 AND 128),
  plan_id TEXT NOT NULL REFERENCES source_processing_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  job_id TEXT REFERENCES jobs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN (
    'PLANNED', 'CONFIRMED', 'RUNNING', 'PAUSED', 'CANCEL_REQUESTED',
    'CANCELLED', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'BUDGET_BLOCKED',
    'CAPABILITY_BLOCKED'
  )),
  current_step TEXT CHECK (
    current_step IS NULL OR current_step IN (
      'CLASSIFY', 'EXTRACT_CLAIMS', 'SUMMARIZE', 'RECONCILE'
    )
  ),
  completed_steps_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(completed_steps_json) AND json_type(completed_steps_json) = 'array' AND
    length(CAST(completed_steps_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  external_request_count INTEGER NOT NULL DEFAULT 0 CHECK (
    external_request_count BETWEEN 0 AND 128
  ),
  cost_state TEXT NOT NULL DEFAULT 'NOT_INCURRED' CHECK (
    cost_state IN ('NOT_INCURRED', 'UNKNOWN_POSSIBLY_INCURRED', 'UNPRICED_USAGE')
  ),
  stable_error_code TEXT CHECK (
    stable_error_code IS NULL OR length(stable_error_code) BETWEEN 1 AND 128
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE INDEX idx_source_revisions_origin
  ON source_revisions(origin_kind, origin_record_id, origin_revision);
CREATE INDEX idx_source_revisions_availability
  ON source_revisions(availability, created_at DESC);
CREATE INDEX idx_source_classification_current
  ON source_classifications(source_id, source_revision, classification_revision DESC);
CREATE INDEX idx_source_classification_revision
  ON source_classifications(source_revision, source_id);
CREATE INDEX idx_source_lineage_parent ON source_lineage(parent_source_id, relation);
CREATE INDEX idx_fact_subjects_work ON fact_subjects(work_id);
CREATE INDEX idx_fact_subjects_expression ON fact_subjects(expression_id);
CREATE INDEX idx_fact_subjects_edition ON fact_subjects(edition_id);
CREATE INDEX idx_fact_subjects_agent ON fact_subjects(agent_id);
CREATE INDEX idx_fact_subjects_publication_relationship
  ON fact_subjects(publication_relationship_id);
CREATE INDEX idx_claims_fact_key
  ON claims(subject_type, subject_id, predicate, normalized_scope_hash, policy_version);
CREATE INDEX idx_claims_subject_id ON claims(subject_id, subject_type);
CREATE INDEX idx_claims_claimant_source
  ON claims(claimant_source_id, claimant_source_revision, id);
CREATE INDEX idx_claims_claimant_source_revision
  ON claims(claimant_source_revision, claimant_source_id, id);
CREATE INDEX idx_claims_predicate_value
  ON claims(predicate, normalized_value, id);
CREATE INDEX idx_claim_evidence_claim ON claim_evidence(claim_id, created_at, id);
CREATE INDEX idx_claim_evidence_source
  ON claim_evidence(source_id, source_revision, claim_id);
CREATE INDEX idx_claim_evidence_source_revision
  ON claim_evidence(source_revision, source_id, claim_id);
CREATE INDEX idx_fact_conflicts_claim_left ON fact_conflicts(claim_left_id, state);
CREATE INDEX idx_fact_conflicts_claim_right ON fact_conflicts(claim_right_id, state);
CREATE INDEX idx_fact_evaluations_claim_time
  ON fact_evaluations(claim_id, created_at DESC, id DESC);
CREATE INDEX idx_fact_decisions_conflict_time
  ON fact_conflict_decisions(conflict_id, created_at DESC);
CREATE INDEX idx_fact_decisions_accepted_claim
  ON fact_conflict_decisions(accepted_claim_id, conflict_id);
CREATE INDEX idx_fact_decisions_parent
  ON fact_conflict_decisions(parent_decision_id, conflict_id);
CREATE INDEX idx_source_processing_runs_status
  ON source_processing_runs(status, updated_at DESC);
CREATE INDEX idx_source_processing_runs_plan
  ON source_processing_runs(plan_id, created_at DESC);
CREATE INDEX idx_source_processing_runs_job ON source_processing_runs(job_id);

CREATE TRIGGER source_revisions_append_only_update
BEFORE UPDATE ON source_revisions
BEGIN
  SELECT RAISE(ABORT, 'source revisions are append-only');
END;

CREATE TRIGGER source_revisions_append_only_delete
BEFORE DELETE ON source_revisions
BEGIN
  SELECT RAISE(ABORT, 'source revisions are append-only');
END;

CREATE TRIGGER source_classifications_append_only_update
BEFORE UPDATE ON source_classifications
BEGIN
  SELECT RAISE(ABORT, 'source classifications are append-only');
END;

CREATE TRIGGER source_classifications_append_only_delete
BEFORE DELETE ON source_classifications
BEGIN
  SELECT RAISE(ABORT, 'source classifications are append-only');
END;

CREATE TRIGGER source_lineage_append_only_update
BEFORE UPDATE ON source_lineage
BEGIN
  SELECT RAISE(ABORT, 'source lineage is append-only');
END;

CREATE TRIGGER source_lineage_append_only_delete
BEFORE DELETE ON source_lineage
BEGIN
  SELECT RAISE(ABORT, 'source lineage is append-only');
END;

CREATE TRIGGER claim_evidence_append_only_update
BEFORE UPDATE ON claim_evidence
BEGIN
  SELECT RAISE(ABORT, 'claim evidence is append-only');
END;

CREATE TRIGGER claim_evidence_append_only_delete
BEFORE DELETE ON claim_evidence
BEGIN
  SELECT RAISE(ABORT, 'claim evidence is append-only');
END;

CREATE TRIGGER fact_evaluations_append_only_update
BEFORE UPDATE ON fact_evaluations
BEGIN
  SELECT RAISE(ABORT, 'fact evaluations are append-only');
END;

CREATE TRIGGER fact_evaluations_append_only_delete
BEFORE DELETE ON fact_evaluations
BEGIN
  SELECT RAISE(ABORT, 'fact evaluations are append-only');
END;

CREATE TRIGGER fact_conflict_decisions_append_only_update
BEFORE UPDATE ON fact_conflict_decisions
BEGIN
  SELECT RAISE(ABORT, 'fact conflict decisions are append-only');
END;

CREATE TRIGGER fact_conflict_decisions_append_only_delete
BEFORE DELETE ON fact_conflict_decisions
BEGIN
  SELECT RAISE(ABORT, 'fact conflict decisions are append-only');
END;

CREATE TRIGGER fact_audit_events_append_only_update
BEFORE UPDATE ON fact_audit_events
BEGIN
  SELECT RAISE(ABORT, 'fact audit is append-only');
END;

CREATE TRIGGER fact_audit_events_append_only_delete
BEFORE DELETE ON fact_audit_events
BEGIN
  SELECT RAISE(ABORT, 'fact audit is append-only');
END;

CREATE TRIGGER source_processing_plans_append_only_update
BEFORE UPDATE ON source_processing_plans
BEGIN
  SELECT RAISE(ABORT, 'source processing plans are append-only');
END;

CREATE TRIGGER source_processing_plans_append_only_delete
BEFORE DELETE ON source_processing_plans
BEGIN
  SELECT RAISE(ABORT, 'source processing plans are append-only');
END;
`;

const VERSIONED_RESEARCH_DOSSIERS = `
ALTER TABLE research_dossiers RENAME TO research_dossiers_issue020_legacy;

INSERT OR IGNORE INTO fact_subjects(subject_type, subject_id, work_id)
SELECT 'WORK', legacy.book_id, legacy.book_id
FROM research_dossiers_issue020_legacy AS legacy
JOIN books AS book ON book.id = legacy.book_id;

CREATE TABLE research_dossiers (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 512),
  book_id TEXT NOT NULL REFERENCES books(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('WORK', 'EXPRESSION', 'EDITION')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
  current_version_id TEXT REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  state TEXT NOT NULL DEFAULT 'NOT_BUILT' CHECK (state IN (
    'NOT_BUILT', 'CURRENT', 'REBUILD_REQUIRED', 'BUILDING', 'FAILED', 'SUPERSEDED'
  )),
  readiness TEXT NOT NULL DEFAULT 'NOT_BUILT' CHECK (readiness IN (
    'NOT_BUILT', 'BUILD_REQUIRED', 'INSUFFICIENT_COVERAGE',
    'FACT_BLOCKED', 'STALE', 'READY_FOR_CONTENT_BRIEF'
  )),
  invalidation_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(invalidation_reasons_json) AND
    json_type(invalidation_reasons_json) = 'array' AND
    length(CAST(invalidation_reasons_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  UNIQUE (subject_type, subject_id),
  FOREIGN KEY (subject_type, subject_id)
    REFERENCES fact_subjects(subject_type, subject_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE research_dossier_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 768),
  dossier_id TEXT NOT NULL REFERENCES research_dossiers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (
    typeof(version_number) = 'integer' AND version_number > 0
  ),
  previous_version_id TEXT REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  schema_version TEXT NOT NULL CHECK (length(schema_version) BETWEEN 1 AND 64),
  coverage_policy_version TEXT NOT NULL CHECK (
    length(coverage_policy_version) BETWEEN 1 AND 64
  ),
  fact_policy_version TEXT NOT NULL CHECK (length(fact_policy_version) BETWEEN 1 AND 64),
  input_hash TEXT NOT NULL CHECK (
    length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
  ),
  build_mode TEXT NOT NULL CHECK (
    build_mode IN ('INITIAL', 'INCREMENTAL', 'FULL_REBUILD', 'LEGACY_MIGRATION')
  ),
  build_run_id TEXT CHECK (
    build_run_id IS NULL OR length(build_run_id) BETWEEN 1 AND 256
  ),
  readiness TEXT NOT NULL CHECK (readiness IN (
    'NOT_BUILT', 'BUILD_REQUIRED', 'INSUFFICIENT_COVERAGE',
    'FACT_BLOCKED', 'STALE', 'READY_FOR_CONTENT_BRIEF'
  )),
  reason_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND
    length(CAST(reason_codes_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(warnings_json) AND json_type(warnings_json) = 'array' AND
    length(CAST(warnings_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  legacy_payload_json TEXT CHECK (
    legacy_payload_json IS NULL OR (
      json_valid(legacy_payload_json) AND json_type(legacy_payload_json) = 'object'
    )
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision = 1),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  published_at TEXT NOT NULL CHECK (published_at ${UTC_REQUIRED}),
  UNIQUE (dossier_id, version_number),
  UNIQUE (dossier_id, input_hash),
  UNIQUE (id, dossier_id)
) STRICT;

CREATE TABLE research_dossier_sections (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 768),
  version_id TEXT NOT NULL REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  section_key TEXT NOT NULL CHECK (section_key IN (
    'IDENTITY', 'BIBLIOGRAPHY', 'CREATORS', 'PUBLICATION_HISTORY', 'AWARDS',
    'SERIES_AND_RELATIONSHIPS', 'SYNOPSIS_AND_THEMES',
    'RECEPTION_AND_DISCUSSION', 'OPEN_CONFLICTS', 'RESEARCH_GAPS'
  )),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
  readiness_required INTEGER NOT NULL CHECK (readiness_required IN (0, 1)),
  coverage_basis_points INTEGER NOT NULL CHECK (coverage_basis_points BETWEEN 0 AND 10000),
  verified_count INTEGER NOT NULL CHECK (verified_count >= 0),
  blocked_count INTEGER NOT NULL CHECK (blocked_count >= 0),
  stale_count INTEGER NOT NULL CHECK (stale_count >= 0),
  insufficient_count INTEGER NOT NULL CHECK (insufficient_count >= 0),
  gap_count INTEGER NOT NULL CHECK (gap_count >= 0),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND
    length(CAST(reason_codes_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (version_id, section_key),
  UNIQUE (version_id, position),
  UNIQUE (id, version_id)
) STRICT;

CREATE TABLE research_dossier_gaps (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 768),
  version_id TEXT NOT NULL REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  section_key TEXT NOT NULL CHECK (section_key IN (
    'IDENTITY', 'BIBLIOGRAPHY', 'CREATORS', 'PUBLICATION_HISTORY', 'AWARDS',
    'SERIES_AND_RELATIONSHIPS', 'SYNOPSIS_AND_THEMES',
    'RECEPTION_AND_DISCUSSION', 'OPEN_CONFLICTS', 'RESEARCH_GAPS'
  )),
  semantic_key TEXT NOT NULL CHECK (length(semantic_key) BETWEEN 1 AND 1024),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'NO_CLAIM', 'INSUFFICIENT_EVIDENCE', 'SOURCE_INDEPENDENCE_UNKNOWN',
    'FACT_CONFLICTED', 'EVIDENCE_STALE', 'SOURCE_UNAVAILABLE',
    'SECTION_NOT_RESEARCHED', 'POLICY_VERSION_STALE'
  )),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  blocking INTEGER NOT NULL CHECK (blocking IN (0, 1)),
  audit_ref TEXT CHECK (audit_ref IS NULL OR length(audit_ref) BETWEEN 1 AND 256),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (version_id, semantic_key, reason_code),
  UNIQUE (id, version_id)
) STRICT;

CREATE TABLE research_dossier_entries (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 768),
  version_id TEXT NOT NULL REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  section_id TEXT NOT NULL,
  section_key TEXT NOT NULL CHECK (section_key IN (
    'IDENTITY', 'BIBLIOGRAPHY', 'CREATORS', 'PUBLICATION_HISTORY', 'AWARDS',
    'SERIES_AND_RELATIONSHIPS', 'SYNOPSIS_AND_THEMES',
    'RECEPTION_AND_DISCUSSION', 'OPEN_CONFLICTS', 'RESEARCH_GAPS'
  )),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('CONSENSUS', 'DISPUTED', 'GAP')),
  semantic_key TEXT NOT NULL CHECK (length(semantic_key) BETWEEN 1 AND 1024),
  predicate TEXT NOT NULL CHECK (length(predicate) BETWEEN 1 AND 128),
  display_value TEXT NOT NULL CHECK (
    length(CAST(display_value AS BLOB)) BETWEEN 0 AND 8000
  ),
  structured_value_json TEXT NOT NULL CHECK (
    json_valid(structured_value_json) AND
    length(CAST(structured_value_json AS BLOB)) BETWEEN 1 AND 32768
  ),
  fact_status TEXT NOT NULL CHECK (fact_status IN (
    'NOT_EVALUATED', 'INSUFFICIENT', 'SUPPORTED_NOT_VERIFIED', 'VERIFIED',
    'CONFLICTED', 'FACT_BLOCKED', 'STALE_REVIEW_REQUIRED', 'REJECTED'
  )),
  source_count INTEGER NOT NULL CHECK (source_count >= 0),
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
  conflict_id TEXT REFERENCES fact_conflicts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  gap_id TEXT,
  provenance TEXT NOT NULL CHECK (provenance = 'LOCAL_DETERMINISTIC'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision = 1),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  UNIQUE (version_id, entry_kind, semantic_key),
  UNIQUE (id, version_id),
  FOREIGN KEY (section_id, version_id)
    REFERENCES research_dossier_sections(id, version_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (gap_id, version_id)
    REFERENCES research_dossier_gaps(id, version_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE research_dossier_entry_claims (
  entry_id TEXT NOT NULL REFERENCES research_dossier_entries(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_revision INTEGER NOT NULL CHECK (claim_revision > 0),
  PRIMARY KEY (entry_id, claim_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE research_dossier_entry_evaluations (
  entry_id TEXT NOT NULL REFERENCES research_dossier_entries(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  evaluation_id TEXT NOT NULL REFERENCES fact_evaluations(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  input_identity_hash TEXT NOT NULL CHECK (
    length(input_identity_hash) = 64 AND
    input_identity_hash NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (entry_id, evaluation_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE research_dossier_entry_evidence (
  entry_id TEXT NOT NULL REFERENCES research_dossier_entries(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  evidence_id TEXT NOT NULL REFERENCES claim_evidence(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  evidence_revision INTEGER NOT NULL CHECK (evidence_revision > 0),
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  PRIMARY KEY (entry_id, evidence_id),
  FOREIGN KEY (source_id, source_revision)
    REFERENCES source_revisions(source_id, revision)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TABLE research_dossier_gap_claims (
  gap_id TEXT NOT NULL REFERENCES research_dossier_gaps(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  PRIMARY KEY (gap_id, claim_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE research_dossier_dependencies (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 768),
  version_id TEXT NOT NULL REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  entry_id TEXT REFERENCES research_dossier_entries(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'CLAIM', 'FACT_EVALUATION', 'EVIDENCE', 'SOURCE_REVISION',
    'CONFLICT', 'FACT_POLICY', 'COVERAGE_POLICY', 'SUBJECT'
  )),
  dependency_id TEXT NOT NULL CHECK (length(dependency_id) BETWEEN 1 AND 256),
  dependency_revision TEXT NOT NULL CHECK (length(dependency_revision) BETWEEN 1 AND 128),
  dependency_key TEXT NOT NULL CHECK (
    length(dependency_key) = 64 AND dependency_key NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (version_id, dependency_key)
) STRICT;

CREATE TABLE research_dossier_coverage_snapshots (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 768),
  version_id TEXT NOT NULL UNIQUE REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  coverage_policy_version TEXT NOT NULL CHECK (
    coverage_policy_version = 'dossier-coverage-policy-v1'
  ),
  input_hash TEXT NOT NULL CHECK (
    length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
  ),
  overall_basis_points INTEGER NOT NULL CHECK (overall_basis_points BETWEEN 0 AND 10000),
  required_basis_points INTEGER NOT NULL CHECK (required_basis_points BETWEEN 0 AND 10000),
  optional_basis_points INTEGER NOT NULL CHECK (optional_basis_points BETWEEN 0 AND 10000),
  verified_count INTEGER NOT NULL CHECK (verified_count >= 0),
  blocked_count INTEGER NOT NULL CHECK (blocked_count >= 0),
  stale_count INTEGER NOT NULL CHECK (stale_count >= 0),
  insufficient_count INTEGER NOT NULL CHECK (insufficient_count >= 0),
  gap_count INTEGER NOT NULL CHECK (gap_count >= 0),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND
    length(CAST(reason_codes_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE research_dossier_build_plans (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  dossier_id TEXT NOT NULL REFERENCES research_dossiers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  contract_version TEXT NOT NULL CHECK (contract_version = 'dossier-build-plan-v1'),
  plan_hash TEXT NOT NULL UNIQUE CHECK (
    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  input_hash TEXT NOT NULL CHECK (
    length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
  ),
  expected_dossier_revision INTEGER NOT NULL CHECK (expected_dossier_revision > 0),
  expected_current_version_id TEXT REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  build_mode TEXT NOT NULL CHECK (build_mode IN ('INITIAL', 'INCREMENTAL', 'FULL_REBUILD')),
  counts_json TEXT NOT NULL CHECK (
    json_valid(counts_json) AND json_type(counts_json) = 'object' AND
    length(CAST(counts_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  preview_json TEXT NOT NULL CHECK (
    json_valid(preview_json) AND json_type(preview_json) = 'object' AND
    length(CAST(preview_json AS BLOB)) BETWEEN 2 AND 262144
  ),
  no_op INTEGER NOT NULL CHECK (no_op IN (0, 1)),
  estimated_local_writes INTEGER NOT NULL CHECK (
    estimated_local_writes BETWEEN 0 AND 16384
  ),
  estimated_model_requests INTEGER NOT NULL DEFAULT 0 CHECK (estimated_model_requests = 0),
  budget_conclusion TEXT NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK (budget_conclusion = 'NOT_APPLICABLE'),
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (
    status IN ('PLANNED', 'CONFIRMED', 'CONSUMED', 'EXPIRED', 'CANCELLED')
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  expires_at TEXT NOT NULL CHECK (expires_at ${UTC_REQUIRED} AND expires_at > created_at),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE research_dossier_build_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  dossier_id TEXT NOT NULL REFERENCES research_dossiers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  plan_id TEXT NOT NULL REFERENCES research_dossier_build_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  execution_id TEXT NOT NULL UNIQUE CHECK (length(execution_id) BETWEEN 1 AND 256),
  job_id TEXT REFERENCES jobs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  input_hash TEXT NOT NULL CHECK (
    length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'CONFIRMED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'NO_OP',
    'CANCEL_REQUESTED', 'CANCELLED', 'FAILED', 'AMBIGUOUS'
  )),
  result_version_id TEXT REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  external_request_count INTEGER NOT NULL DEFAULT 0 CHECK (external_request_count = 0),
  cost_state TEXT NOT NULL DEFAULT 'NOT_INCURRED' CHECK (cost_state = 'NOT_INCURRED'),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE research_dossier_invalidations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 768),
  event_identity TEXT NOT NULL UNIQUE CHECK (length(event_identity) BETWEEN 1 AND 512),
  dossier_id TEXT NOT NULL REFERENCES research_dossiers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  current_version_id TEXT NOT NULL REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'CLAIM', 'FACT_EVALUATION', 'EVIDENCE', 'SOURCE_REVISION',
    'CONFLICT', 'FACT_POLICY', 'COVERAGE_POLICY', 'SUBJECT'
  )),
  dependency_id TEXT NOT NULL CHECK (length(dependency_id) BETWEEN 1 AND 256),
  observed_revision TEXT NOT NULL CHECK (length(observed_revision) BETWEEN 1 AND 128),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE research_dossier_audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 768),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'DOSSIER_CREATED', 'BUILD_PLANNED', 'BUILD_CONFIRMED', 'BUILD_STARTED',
    'VERSION_PUBLISHED', 'BUILD_NO_OP', 'BUILD_CANCELLED', 'BUILD_FAILED',
    'DOSSIER_INVALIDATED'
  )),
  dossier_id TEXT NOT NULL REFERENCES research_dossiers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  version_id TEXT REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  plan_id TEXT REFERENCES research_dossier_build_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  run_id TEXT REFERENCES research_dossier_build_runs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('USER', 'LOCAL_SYSTEM', 'MIGRATION')),
  before_json TEXT CHECK (
    before_json IS NULL OR (
      json_valid(before_json) AND length(CAST(before_json AS BLOB)) <= 65536
    )
  ),
  after_json TEXT CHECK (
    after_json IS NULL OR (
      json_valid(after_json) AND length(CAST(after_json AS BLOB)) <= 65536
    )
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

INSERT INTO research_dossiers(
  id, book_id, subject_type, subject_id, current_version_id, revision,
  state, readiness, invalidation_reasons_json, created_at, updated_at
)
SELECT
  min(legacy.id), legacy.book_id, 'WORK', legacy.book_id, NULL, 1,
  'REBUILD_REQUIRED', 'BUILD_REQUIRED', '["LEGACY_DOSSIER_REQUIRES_REBUILD"]',
  min(legacy.created_at), max(legacy.created_at)
FROM research_dossiers_issue020_legacy AS legacy
GROUP BY legacy.book_id;

INSERT INTO research_dossier_versions(
  id, dossier_id, version_number, previous_version_id, schema_version,
  coverage_policy_version, fact_policy_version, input_hash, build_mode,
  build_run_id, readiness, reason_codes_json, warnings_json,
  legacy_payload_json, revision, created_at, published_at
)
SELECT
  'legacy-version:' || legacy.id,
  root.id,
  legacy.version,
  (
    SELECT 'legacy-version:' || previous.id
    FROM research_dossiers_issue020_legacy AS previous
    WHERE previous.book_id = legacy.book_id AND previous.version < legacy.version
    ORDER BY previous.version DESC, previous.id DESC
    LIMIT 1
  ),
  'legacy-unversioned-v0',
  'legacy-unversioned-v0',
  'fact-policy-v1',
  lower(hex(randomblob(32))),
  'LEGACY_MIGRATION',
  NULL,
  'INSUFFICIENT_COVERAGE',
  '["LEGACY_DOSSIER_REQUIRES_REBUILD"]',
  '["LEGACY_UNVERIFIED_PAYLOAD_PRESERVED"]',
  json_object(
    'legacyId', legacy.id,
    'researchQuestions', json(legacy.research_questions_json),
    'summary', legacy.summary,
    'consensus', json(legacy.consensus_json),
    'disputes', json(legacy.disputes_json),
    'sourceCoverageScore', legacy.source_coverage_score,
    'status', legacy.status
  ),
  1,
  legacy.created_at,
  legacy.created_at
FROM research_dossiers_issue020_legacy AS legacy
JOIN research_dossiers AS root
  ON root.subject_type = 'WORK' AND root.subject_id = legacy.book_id;

UPDATE research_dossiers
SET current_version_id = (
  SELECT version.id
  FROM research_dossier_versions AS version
  WHERE version.dossier_id = research_dossiers.id
  ORDER BY version.version_number DESC, version.id DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM research_dossier_versions AS version
  WHERE version.dossier_id = research_dossiers.id
);

DROP TABLE research_dossiers_issue020_legacy;

CREATE INDEX idx_research_dossiers_book ON research_dossiers(book_id);
CREATE INDEX idx_research_dossiers_subject_id ON research_dossiers(subject_id, subject_type);
CREATE INDEX idx_research_dossiers_current_version
  ON research_dossiers(current_version_id) WHERE current_version_id IS NOT NULL;
CREATE INDEX idx_research_dossiers_state ON research_dossiers(state, updated_at, id);
CREATE INDEX idx_research_dossiers_readiness
  ON research_dossiers(readiness, updated_at, id);
CREATE INDEX idx_research_dossier_versions_history
  ON research_dossier_versions(dossier_id, version_number DESC, id);
CREATE INDEX idx_research_dossier_versions_previous
  ON research_dossier_versions(previous_version_id) WHERE previous_version_id IS NOT NULL;
CREATE INDEX idx_research_dossier_sections_version
  ON research_dossier_sections(version_id, position);
CREATE INDEX idx_research_dossier_entries_page
  ON research_dossier_entries(version_id, section_key, semantic_key, id);
CREATE INDEX idx_research_dossier_entries_conflict
  ON research_dossier_entries(conflict_id) WHERE conflict_id IS NOT NULL;
CREATE INDEX idx_research_dossier_entries_section
  ON research_dossier_entries(section_id, version_id);
CREATE INDEX idx_research_dossier_entries_gap
  ON research_dossier_entries(gap_id, version_id) WHERE gap_id IS NOT NULL;
CREATE INDEX idx_research_dossier_gaps_page
  ON research_dossier_gaps(version_id, blocking DESC, section_key, semantic_key, id);
CREATE INDEX idx_research_dossier_entry_claims_claim
  ON research_dossier_entry_claims(claim_id, entry_id);
CREATE INDEX idx_research_dossier_entry_evaluations_evaluation
  ON research_dossier_entry_evaluations(evaluation_id, entry_id);
CREATE INDEX idx_research_dossier_entry_evidence_evidence
  ON research_dossier_entry_evidence(evidence_id, entry_id);
CREATE INDEX idx_research_dossier_entry_evidence_source
  ON research_dossier_entry_evidence(source_id, source_revision, entry_id);
CREATE INDEX idx_research_dossier_entry_evidence_source_revision
  ON research_dossier_entry_evidence(source_revision, source_id, entry_id);
CREATE INDEX idx_research_dossier_gap_claims_claim
  ON research_dossier_gap_claims(claim_id, gap_id);
CREATE INDEX idx_research_dossier_dependencies_lookup
  ON research_dossier_dependencies(
    dependency_type, dependency_id, dependency_revision, version_id
  );
CREATE INDEX idx_research_dossier_dependencies_version
  ON research_dossier_dependencies(version_id, dependency_key);
CREATE INDEX idx_research_dossier_dependencies_entry
  ON research_dossier_dependencies(entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX idx_research_dossier_plans_dossier
  ON research_dossier_build_plans(dossier_id, created_at DESC, id);
CREATE INDEX idx_research_dossier_plans_current_version
  ON research_dossier_build_plans(expected_current_version_id)
  WHERE expected_current_version_id IS NOT NULL;
CREATE INDEX idx_research_dossier_runs_dossier
  ON research_dossier_build_runs(dossier_id, created_at DESC, id);
CREATE INDEX idx_research_dossier_runs_plan
  ON research_dossier_build_runs(plan_id, created_at DESC, id);
CREATE INDEX idx_research_dossier_runs_result_version
  ON research_dossier_build_runs(result_version_id) WHERE result_version_id IS NOT NULL;
CREATE UNIQUE INDEX idx_research_dossier_runs_one_active
  ON research_dossier_build_runs(dossier_id)
  WHERE status IN ('CONFIRMED', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED');
CREATE INDEX idx_research_dossier_invalidations_dossier
  ON research_dossier_invalidations(dossier_id, created_at DESC, id);
CREATE INDEX idx_research_dossier_invalidations_current_version
  ON research_dossier_invalidations(current_version_id, created_at DESC, id);
CREATE INDEX idx_research_dossier_audit_dossier
  ON research_dossier_audit_events(dossier_id, created_at DESC, id);
CREATE INDEX idx_research_dossier_audit_version
  ON research_dossier_audit_events(version_id) WHERE version_id IS NOT NULL;
CREATE INDEX idx_research_dossier_audit_plan
  ON research_dossier_audit_events(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_research_dossier_audit_run
  ON research_dossier_audit_events(run_id) WHERE run_id IS NOT NULL;

CREATE TRIGGER research_dossiers_current_version_guard
BEFORE UPDATE OF current_version_id ON research_dossiers
WHEN NEW.current_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM research_dossier_versions AS version
  WHERE version.id = NEW.current_version_id AND version.dossier_id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'current dossier version must belong to dossier');
END;

CREATE TRIGGER research_dossier_versions_append_only_update
BEFORE UPDATE ON research_dossier_versions
BEGIN
  SELECT RAISE(ABORT, 'research dossier versions are append-only');
END;
CREATE TRIGGER research_dossier_versions_append_only_delete
BEFORE DELETE ON research_dossier_versions
BEGIN
  SELECT RAISE(ABORT, 'research dossier versions are append-only');
END;
CREATE TRIGGER research_dossier_sections_append_only_update
BEFORE UPDATE ON research_dossier_sections
BEGIN
  SELECT RAISE(ABORT, 'research dossier sections are append-only');
END;
CREATE TRIGGER research_dossier_sections_append_only_delete
BEFORE DELETE ON research_dossier_sections
BEGIN
  SELECT RAISE(ABORT, 'research dossier sections are append-only');
END;
CREATE TRIGGER research_dossier_entries_append_only_update
BEFORE UPDATE ON research_dossier_entries
BEGIN
  SELECT RAISE(ABORT, 'research dossier entries are append-only');
END;
CREATE TRIGGER research_dossier_entries_append_only_delete
BEFORE DELETE ON research_dossier_entries
BEGIN
  SELECT RAISE(ABORT, 'research dossier entries are append-only');
END;
CREATE TRIGGER research_dossier_entry_claims_append_only_update
BEFORE UPDATE ON research_dossier_entry_claims
BEGIN
  SELECT RAISE(ABORT, 'research dossier entry claims are append-only');
END;
CREATE TRIGGER research_dossier_entry_claims_append_only_delete
BEFORE DELETE ON research_dossier_entry_claims
BEGIN
  SELECT RAISE(ABORT, 'research dossier entry claims are append-only');
END;
CREATE TRIGGER research_dossier_entry_evaluations_append_only_update
BEFORE UPDATE ON research_dossier_entry_evaluations
BEGIN
  SELECT RAISE(ABORT, 'research dossier entry evaluations are append-only');
END;
CREATE TRIGGER research_dossier_entry_evaluations_append_only_delete
BEFORE DELETE ON research_dossier_entry_evaluations
BEGIN
  SELECT RAISE(ABORT, 'research dossier entry evaluations are append-only');
END;
CREATE TRIGGER research_dossier_entry_evidence_append_only_update
BEFORE UPDATE ON research_dossier_entry_evidence
BEGIN
  SELECT RAISE(ABORT, 'research dossier entry evidence is append-only');
END;
CREATE TRIGGER research_dossier_entry_evidence_append_only_delete
BEFORE DELETE ON research_dossier_entry_evidence
BEGIN
  SELECT RAISE(ABORT, 'research dossier entry evidence is append-only');
END;
CREATE TRIGGER research_dossier_gap_claims_append_only_update
BEFORE UPDATE ON research_dossier_gap_claims
BEGIN
  SELECT RAISE(ABORT, 'research dossier gap claims are append-only');
END;
CREATE TRIGGER research_dossier_gap_claims_append_only_delete
BEFORE DELETE ON research_dossier_gap_claims
BEGIN
  SELECT RAISE(ABORT, 'research dossier gap claims are append-only');
END;
CREATE TRIGGER research_dossier_gaps_append_only_update
BEFORE UPDATE ON research_dossier_gaps
BEGIN
  SELECT RAISE(ABORT, 'research dossier gaps are append-only');
END;
CREATE TRIGGER research_dossier_gaps_append_only_delete
BEFORE DELETE ON research_dossier_gaps
BEGIN
  SELECT RAISE(ABORT, 'research dossier gaps are append-only');
END;
CREATE TRIGGER research_dossier_dependencies_append_only_update
BEFORE UPDATE ON research_dossier_dependencies
BEGIN
  SELECT RAISE(ABORT, 'research dossier dependencies are append-only');
END;
CREATE TRIGGER research_dossier_dependencies_append_only_delete
BEFORE DELETE ON research_dossier_dependencies
BEGIN
  SELECT RAISE(ABORT, 'research dossier dependencies are append-only');
END;
CREATE TRIGGER research_dossier_coverage_append_only_update
BEFORE UPDATE ON research_dossier_coverage_snapshots
BEGIN
  SELECT RAISE(ABORT, 'research dossier coverage is append-only');
END;
CREATE TRIGGER research_dossier_coverage_append_only_delete
BEFORE DELETE ON research_dossier_coverage_snapshots
BEGIN
  SELECT RAISE(ABORT, 'research dossier coverage is append-only');
END;
CREATE TRIGGER research_dossier_invalidations_append_only_update
BEFORE UPDATE ON research_dossier_invalidations
BEGIN
  SELECT RAISE(ABORT, 'research dossier invalidations are append-only');
END;
CREATE TRIGGER research_dossier_invalidations_append_only_delete
BEFORE DELETE ON research_dossier_invalidations
BEGIN
  SELECT RAISE(ABORT, 'research dossier invalidations are append-only');
END;
CREATE TRIGGER research_dossier_audit_append_only_update
BEFORE UPDATE ON research_dossier_audit_events
BEGIN
  SELECT RAISE(ABORT, 'research dossier audit is append-only');
END;
CREATE TRIGGER research_dossier_audit_append_only_delete
BEFORE DELETE ON research_dossier_audit_events
BEGIN
  SELECT RAISE(ABORT, 'research dossier audit is append-only');
END;

CREATE TRIGGER research_dossier_invalidate_source_revision
AFTER INSERT ON source_revisions
WHEN NEW.revision > 1
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'SOURCE_REVISION:' || NEW.source_id || ':' || NEW.revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'SOURCE_REVISION',
    NEW.source_id,
    CAST(NEW.revision AS TEXT),
    'SOURCE_REVISION_CHANGED',
    NEW.created_at
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'SOURCE_REVISION'
    AND dependency.dependency_id = NEW.source_id
    AND dependency.dependency_revision NOT LIKE CAST(NEW.revision AS TEXT) || '.%';

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["SOURCE_REVISION_CHANGED"]',
      revision = revision + 1,
      updated_at = NEW.created_at
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'SOURCE_REVISION'
      AND dependency.dependency_id = NEW.source_id
      AND dependency.dependency_revision NOT LIKE CAST(NEW.revision AS TEXT) || '.%'
  );
END;

CREATE TRIGGER research_dossier_invalidate_source_classification
AFTER INSERT ON source_classifications
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'SOURCE_CLASSIFICATION:' || NEW.source_id || ':' || NEW.source_revision || ':' ||
      NEW.classification_revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'SOURCE_REVISION',
    NEW.source_id,
    CAST(NEW.source_revision AS TEXT) || '.' || CAST(NEW.classification_revision AS TEXT),
    'SOURCE_CLASSIFICATION_CHANGED',
    NEW.created_at
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'SOURCE_REVISION'
    AND dependency.dependency_id = NEW.source_id
    AND dependency.dependency_revision <>
      CAST(NEW.source_revision AS TEXT) || '.' || CAST(NEW.classification_revision AS TEXT);

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["SOURCE_CLASSIFICATION_CHANGED"]',
      revision = revision + 1,
      updated_at = NEW.created_at
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'SOURCE_REVISION'
      AND dependency.dependency_id = NEW.source_id
      AND dependency.dependency_revision <>
        CAST(NEW.source_revision AS TEXT) || '.' || CAST(NEW.classification_revision AS TEXT)
  );
END;

CREATE TRIGGER research_dossier_invalidate_evidence_insert
AFTER INSERT ON claim_evidence
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'EVIDENCE_INSERT:' || NEW.id || ':' || NEW.revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'EVIDENCE',
    NEW.id,
    CAST(NEW.revision AS TEXT),
    'EVIDENCE_CHANGED',
    NEW.created_at
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'CLAIM'
    AND dependency.dependency_id = NEW.claim_id;

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["EVIDENCE_CHANGED"]',
      revision = revision + 1,
      updated_at = NEW.created_at
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'CLAIM'
      AND dependency.dependency_id = NEW.claim_id
  );
END;

CREATE TRIGGER research_dossier_invalidate_evidence_update
AFTER UPDATE ON claim_evidence
WHEN NEW.revision <> OLD.revision OR
     NEW.verification_status <> OLD.verification_status OR
     NEW.locator_json <> OLD.locator_json
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'EVIDENCE_UPDATE:' || NEW.id || ':' || NEW.revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'EVIDENCE',
    NEW.id,
    CAST(NEW.revision AS TEXT),
    'EVIDENCE_CHANGED',
    (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'EVIDENCE'
    AND dependency.dependency_id = NEW.id
    AND dependency.dependency_revision <> CAST(NEW.revision AS TEXT);

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["EVIDENCE_CHANGED"]',
      revision = revision + 1,
      updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'EVIDENCE'
      AND dependency.dependency_id = NEW.id
      AND dependency.dependency_revision <> CAST(NEW.revision AS TEXT)
  );
END;

CREATE TRIGGER research_dossier_invalidate_claim_update
AFTER UPDATE ON claims
WHEN NEW.revision <> OLD.revision OR NEW.status <> OLD.status OR
     NEW.value_json <> OLD.value_json OR NEW.scope_json <> OLD.scope_json
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'CLAIM:' || NEW.id || ':' || NEW.revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'CLAIM',
    NEW.id,
    CAST(NEW.revision AS TEXT),
    'CLAIM_CHANGED',
    (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'CLAIM'
    AND dependency.dependency_id = NEW.id
    AND dependency.dependency_revision <> CAST(NEW.revision AS TEXT);

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["CLAIM_CHANGED"]',
      revision = revision + 1,
      updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'CLAIM'
      AND dependency.dependency_id = NEW.id
      AND dependency.dependency_revision <> CAST(NEW.revision AS TEXT)
  );
END;

CREATE TRIGGER research_dossier_invalidate_evaluation_insert
AFTER INSERT ON fact_evaluations
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'FACT_EVALUATION:' || NEW.id || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'FACT_EVALUATION',
    NEW.id,
    NEW.input_identity_hash,
    'FACT_EVALUATION_CHANGED',
    NEW.created_at
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'CLAIM'
    AND dependency.dependency_id = NEW.claim_id;

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["FACT_EVALUATION_CHANGED"]',
      revision = revision + 1,
      updated_at = NEW.created_at
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'CLAIM'
      AND dependency.dependency_id = NEW.claim_id
  );
END;

CREATE TRIGGER research_dossier_invalidate_conflict_insert
AFTER INSERT ON fact_conflicts
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT DISTINCT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'CONFLICT_INSERT:' || NEW.id || ':' || NEW.revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'CONFLICT',
    NEW.id,
    CAST(NEW.revision AS TEXT),
    'CONFLICT_CHANGED',
    NEW.created_at
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'CLAIM'
    AND dependency.dependency_id IN (NEW.claim_left_id, NEW.claim_right_id);

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["CONFLICT_CHANGED"]',
      revision = revision + 1,
      updated_at = NEW.created_at
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'CLAIM'
      AND dependency.dependency_id IN (NEW.claim_left_id, NEW.claim_right_id)
  );
END;

CREATE TRIGGER research_dossier_invalidate_conflict_update
AFTER UPDATE ON fact_conflicts
WHEN NEW.revision <> OLD.revision OR NEW.state <> OLD.state
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'CONFLICT_UPDATE:' || NEW.id || ':' || NEW.revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'CONFLICT',
    NEW.id,
    CAST(NEW.revision AS TEXT),
    'CONFLICT_CHANGED',
    NEW.updated_at
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'CONFLICT'
    AND dependency.dependency_id = NEW.id
    AND dependency.dependency_revision <> CAST(NEW.revision AS TEXT);

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["CONFLICT_CHANGED"]',
      revision = revision + 1,
      updated_at = NEW.updated_at
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'CONFLICT'
      AND dependency.dependency_id = NEW.id
      AND dependency.dependency_revision <> CAST(NEW.revision AS TEXT)
  );
END;

CREATE TRIGGER research_dossier_invalidate_work_subject
AFTER UPDATE OF catalog_revision, catalog_state ON books
WHEN NEW.catalog_revision <> OLD.catalog_revision OR NEW.catalog_state <> OLD.catalog_state
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'SUBJECT_WORK:' || NEW.id || ':' || NEW.catalog_revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'SUBJECT',
    dependency.dependency_id,
    CAST(NEW.catalog_revision AS TEXT),
    'SUBJECT_CHANGED',
    NEW.updated_at
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'SUBJECT'
    AND (
      dependency.dependency_id = 'WORK:' || NEW.id OR
      dependency.dependency_id IN (
        SELECT 'EXPRESSION:' || expression.id
        FROM expressions AS expression
        WHERE expression.work_id = NEW.id
      ) OR
      dependency.dependency_id IN (
        SELECT 'EDITION:' || edition.id
        FROM book_editions AS edition
        JOIN expressions AS expression ON expression.id = edition.expression_id
        WHERE expression.work_id = NEW.id
      )
    );

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["SUBJECT_CHANGED"]',
      revision = revision + 1,
      updated_at = NEW.updated_at
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'SUBJECT'
      AND (
        dependency.dependency_id = 'WORK:' || NEW.id OR
        dependency.dependency_id IN (
          SELECT 'EXPRESSION:' || expression.id
          FROM expressions AS expression
          WHERE expression.work_id = NEW.id
        ) OR
        dependency.dependency_id IN (
          SELECT 'EDITION:' || edition.id
          FROM book_editions AS edition
          JOIN expressions AS expression ON expression.id = edition.expression_id
          WHERE expression.work_id = NEW.id
        )
      )
  );
END;

CREATE TRIGGER research_dossier_invalidate_expression_subject
AFTER UPDATE OF work_id, revision, catalog_state ON expressions
WHEN NEW.work_id <> OLD.work_id OR NEW.revision <> OLD.revision OR
     NEW.catalog_state <> OLD.catalog_state
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'SUBJECT_EXPRESSION:' || NEW.id || ':' || NEW.revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'SUBJECT',
    dependency.dependency_id,
    CAST(NEW.revision AS TEXT),
    'SUBJECT_CHANGED',
    NEW.updated_at
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'SUBJECT'
    AND (
      dependency.dependency_id = 'EXPRESSION:' || NEW.id OR
      dependency.dependency_id IN (
        SELECT 'EDITION:' || edition.id
        FROM book_editions AS edition
        WHERE edition.expression_id = NEW.id
      )
    );

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["SUBJECT_CHANGED"]',
      revision = revision + 1,
      updated_at = NEW.updated_at
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'SUBJECT'
      AND (
        dependency.dependency_id = 'EXPRESSION:' || NEW.id OR
        dependency.dependency_id IN (
          SELECT 'EDITION:' || edition.id
          FROM book_editions AS edition
          WHERE edition.expression_id = NEW.id
        )
      )
  );
END;

CREATE TRIGGER research_dossier_invalidate_edition_subject
AFTER UPDATE OF expression_id, catalog_revision, catalog_state ON book_editions
WHEN NEW.expression_id <> OLD.expression_id OR
     NEW.catalog_revision <> OLD.catalog_revision OR
     NEW.catalog_state <> OLD.catalog_state
BEGIN
  INSERT OR IGNORE INTO research_dossier_invalidations(
    id, event_identity, dossier_id, current_version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'dossier-invalidation-' || lower(hex(randomblob(16))),
    'SUBJECT_EDITION:' || NEW.id || ':' || NEW.catalog_revision || ':' || dossier.id,
    dossier.id,
    dossier.current_version_id,
    'SUBJECT',
    dependency.dependency_id,
    CAST(NEW.catalog_revision AS TEXT),
    'SUBJECT_CHANGED',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM research_dossier_dependencies AS dependency
  JOIN research_dossiers AS dossier
    ON dossier.current_version_id = dependency.version_id
  WHERE dependency.dependency_type = 'SUBJECT'
    AND dependency.dependency_id = 'EDITION:' || NEW.id;

  UPDATE research_dossiers
  SET state = 'REBUILD_REQUIRED',
      readiness = 'BUILD_REQUIRED',
      invalidation_reasons_json = '["SUBJECT_CHANGED"]',
      revision = revision + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE current_version_id IN (
    SELECT dependency.version_id
    FROM research_dossier_dependencies AS dependency
    WHERE dependency.dependency_type = 'SUBJECT'
      AND dependency.dependency_id = 'EDITION:' || NEW.id
  );
END;
`;

const READING_AUTHENTICITY_POLICY = `
DROP INDEX idx_reading_states_state;
ALTER TABLE reading_states RENAME TO reading_states_issue021_legacy;

CREATE TABLE reading_states_issue021_new (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) BETWEEN 1 AND 4096),
  profile_id TEXT NOT NULL REFERENCES account_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  book_id TEXT NOT NULL REFERENCES books(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  current_revision_id TEXT,
  current_snapshot_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  created_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL DEFAULT ${UTC_NOW} CHECK (updated_at ${UTC_REQUIRED}),
  UNIQUE (profile_id, book_id),
  UNIQUE (book_id),
  UNIQUE (id, profile_id, book_id),
  FOREIGN KEY (current_revision_id, id)
    REFERENCES reading_state_revisions(id, reading_state_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (current_snapshot_id, id)
    REFERENCES expression_permission_snapshots(id, reading_state_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE reading_state_revisions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 4096),
  reading_state_id TEXT NOT NULL REFERENCES reading_states_issue021_new(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  previous_revision_id TEXT REFERENCES reading_state_revisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  contract_version TEXT NOT NULL CHECK (contract_version = 'reading-state-v1'),
  state TEXT NOT NULL CHECK (state IN (
    'R1_READ_CLEAR', 'R2_READ_FUZZY', 'R3_READ_UNCONFIRMED_DETAILS',
    'S1_RESEARCH_ONLY', 'S2_RESEARCH_INSUFFICIENT', 'UNCLASSIFIED'
  )),
  memory_confidence TEXT NOT NULL CHECK (memory_confidence IN (
    'CLEAR', 'PARTIAL', 'FADED', 'NOT_APPLICABLE', 'UNKNOWN'
  )),
  confirmation_kind TEXT NOT NULL CHECK (confirmation_kind IN (
    'USER_EXPLICIT', 'USER_BATCH_EXPLICIT', 'USER_UNDO', 'LEGACY_MIGRATION'
  )),
  finished_at TEXT CHECK (
    finished_at IS NULL OR finished_at GLOB '????-??-??' OR
    finished_at GLOB '????-??' OR finished_at GLOB '????'
  ),
  finished_at_precision TEXT NOT NULL CHECK (
    finished_at_precision IN ('DAY', 'MONTH', 'YEAR', 'UNKNOWN')
  ),
  last_read_at TEXT CHECK (
    last_read_at IS NULL OR last_read_at GLOB '????-??-??' OR
    last_read_at GLOB '????-??' OR last_read_at GLOB '????'
  ),
  last_read_at_precision TEXT NOT NULL CHECK (
    last_read_at_precision IN ('DAY', 'MONTH', 'YEAR', 'UNKNOWN')
  ),
  expression_id TEXT REFERENCES expressions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  edition_id TEXT REFERENCES book_editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  user_note TEXT CHECK (
    user_note IS NULL OR length(CAST(user_note AS BLOB)) BETWEEN 1 AND 65536
  ),
  provenance TEXT NOT NULL CHECK (provenance IN ('USER_UI', 'LEGACY_MIGRATION')),
  provenance_identity TEXT NOT NULL CHECK (
    length(provenance_identity) BETWEEN 1 AND 256
  ),
  legacy_payload_json TEXT CHECK (
    legacy_payload_json IS NULL OR (
      json_valid(legacy_payload_json) AND json_type(legacy_payload_json) = 'object'
    )
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (reading_state_id, revision),
  UNIQUE (id, reading_state_id),
  CHECK (
    (state = 'R1_READ_CLEAR' AND memory_confidence = 'CLEAR') OR
    (state = 'R2_READ_FUZZY' AND memory_confidence IN ('PARTIAL', 'FADED')) OR
    (state = 'R3_READ_UNCONFIRMED_DETAILS' AND memory_confidence IN ('FADED', 'UNKNOWN')) OR
    (state IN ('S1_RESEARCH_ONLY', 'S2_RESEARCH_INSUFFICIENT') AND
      memory_confidence = 'NOT_APPLICABLE') OR
    (state = 'UNCLASSIFIED' AND memory_confidence = 'UNKNOWN')
  ),
  CHECK (
    (finished_at IS NULL AND finished_at_precision = 'UNKNOWN') OR
    (finished_at IS NOT NULL AND finished_at_precision <> 'UNKNOWN')
  ),
  CHECK (
    (last_read_at IS NULL AND last_read_at_precision = 'UNKNOWN') OR
    (last_read_at IS NOT NULL AND last_read_at_precision <> 'UNKNOWN')
  )
) STRICT;

INSERT INTO reading_states_issue021_new (
  id, profile_id, book_id, revision, created_at, updated_at
)
SELECT
  legacy.id,
  'primary',
  legacy.book_id,
  1,
  COALESCE(legacy.user_confirmed_at, ${UTC_NOW}),
  COALESCE(legacy.user_confirmed_at, ${UTC_NOW})
FROM reading_states_issue021_legacy AS legacy;

INSERT INTO reading_state_revisions (
  id, reading_state_id, revision, previous_revision_id, contract_version,
  state, memory_confidence, confirmation_kind,
  finished_at, finished_at_precision, last_read_at, last_read_at_precision,
  expression_id, edition_id, user_note, provenance, provenance_identity,
  legacy_payload_json, created_at
)
SELECT
  'legacy-reading-revision-' || legacy.rowid,
  legacy.id,
  1,
  NULL,
  'reading-state-v1',
  CASE
    WHEN legacy.state = 'READ_CLEAR' AND legacy.user_confirmed_at IS NOT NULL
      THEN 'R1_READ_CLEAR'
    WHEN legacy.state = 'READ_FUZZY' THEN 'R2_READ_FUZZY'
    WHEN legacy.state = 'READ_UNVERIFIED' THEN 'R3_READ_UNCONFIRMED_DETAILS'
    ELSE 'UNCLASSIFIED'
  END,
  CASE
    WHEN legacy.state = 'READ_CLEAR' AND legacy.user_confirmed_at IS NOT NULL THEN 'CLEAR'
    WHEN legacy.state = 'READ_FUZZY' THEN 'PARTIAL'
    WHEN legacy.state = 'READ_UNVERIFIED' THEN 'UNKNOWN'
    ELSE 'UNKNOWN'
  END,
  'LEGACY_MIGRATION',
  NULL,
  'UNKNOWN',
  NULL,
  'UNKNOWN',
  NULL,
  NULL,
  legacy.memory_note,
  'LEGACY_MIGRATION',
  'migration-v14',
  json_object(
    'legacyState', legacy.state,
    'legacyUserConfirmedAt', legacy.user_confirmed_at,
    'legacyScoreConfirmedAt', legacy.score_confirmed_at
  ),
  COALESCE(legacy.user_confirmed_at, ${UTC_NOW})
FROM reading_states_issue021_legacy AS legacy;

UPDATE reading_states_issue021_new
SET current_revision_id = (
  SELECT revision.id
  FROM reading_state_revisions AS revision
  WHERE revision.reading_state_id = reading_states_issue021_new.id
    AND revision.revision = 1
);

ALTER TABLE reading_states_issue021_new RENAME TO reading_states;

CREATE TABLE experience_assertions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  reading_state_id TEXT NOT NULL REFERENCES reading_states(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  current_revision_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  UNIQUE (id, reading_state_id),
  FOREIGN KEY (current_revision_id, id)
    REFERENCES experience_assertion_revisions(id, assertion_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE experience_assertion_revisions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  assertion_id TEXT NOT NULL REFERENCES experience_assertions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  previous_revision_id TEXT REFERENCES experience_assertion_revisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  reading_state_revision_id TEXT NOT NULL REFERENCES reading_state_revisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  assertion_kind TEXT NOT NULL CHECK (assertion_kind IN (
    'READING_IMPRESSION', 'PLOT_OR_STRUCTURE_MEMORY', 'CHARACTER_MEMORY',
    'TRICK_OR_REASONING_MEMORY', 'PERSONAL_PREFERENCE', 'PERSONAL_SCORE'
  )),
  confirmation_scope TEXT NOT NULL CHECK (
    confirmation_scope IN ('EXACT_STATEMENT', 'EXACT_STRUCTURED_OPINION')
  ),
  statement TEXT NOT NULL CHECK (
    length(CAST(statement AS BLOB)) BETWEEN 1 AND 2000
  ),
  statement_hash TEXT NOT NULL CHECK (
    length(statement_hash) = 64 AND statement_hash NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'REVOKED')),
  provenance TEXT NOT NULL CHECK (provenance = 'USER_UI'),
  confirmed_at TEXT NOT NULL CHECK (confirmed_at ${UTC_REQUIRED}),
  invalidated_at TEXT CHECK (
    invalidated_at IS NULL OR invalidated_at ${UTC_REQUIRED}
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (assertion_id, revision),
  UNIQUE (id, assertion_id),
  CHECK (
    (status = 'CONFIRMED' AND invalidated_at IS NULL) OR
    (status = 'REVOKED' AND invalidated_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE personal_score_records (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  reading_state_id TEXT NOT NULL REFERENCES reading_states(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  reading_state_revision_id TEXT NOT NULL REFERENCES reading_state_revisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  assertion_revision_id TEXT REFERENCES experience_assertion_revisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  score_basis_points INTEGER CHECK (
    score_basis_points IS NULL OR (
      typeof(score_basis_points) = 'integer' AND score_basis_points BETWEEN 0 AND 10000
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  provenance TEXT NOT NULL CHECK (provenance IN ('USER_UI', 'LEGACY_MIGRATION')),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (reading_state_id, revision),
  CHECK (
    (status = 'ACTIVE' AND score_basis_points IS NOT NULL) OR
    (status = 'REVOKED' AND score_basis_points IS NULL)
  )
) STRICT;

INSERT INTO personal_score_records (
  id, reading_state_id, reading_state_revision_id, assertion_revision_id,
  revision, score_basis_points, status, provenance, created_at
)
SELECT
  'legacy-personal-score-' || legacy.rowid,
  legacy.id,
  revision.id,
  NULL,
  1,
  CAST(round(legacy.personal_score * 100) AS INTEGER),
  'ACTIVE',
  'LEGACY_MIGRATION',
  COALESCE(legacy.score_confirmed_at, legacy.user_confirmed_at, ${UTC_NOW})
FROM reading_states_issue021_legacy AS legacy
JOIN reading_state_revisions AS revision
  ON revision.reading_state_id = legacy.id AND revision.revision = 1
WHERE legacy.personal_score IS NOT NULL
  AND legacy.state = 'READ_CLEAR'
  AND legacy.user_confirmed_at IS NOT NULL
  AND legacy.score_confirmed_at IS NOT NULL;

DROP TABLE reading_states_issue021_legacy;

CREATE TABLE research_analysis_score_records (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  reading_state_id TEXT NOT NULL REFERENCES reading_states(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  reading_state_revision_id TEXT NOT NULL REFERENCES reading_state_revisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dossier_id TEXT NOT NULL REFERENCES research_dossiers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dossier_version_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  score_basis_points INTEGER CHECK (
    score_basis_points IS NULL OR (
      typeof(score_basis_points) = 'integer' AND score_basis_points BETWEEN 0 AND 10000
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  public_label TEXT NOT NULL CHECK (public_label = '资料分析评分'),
  provenance TEXT NOT NULL CHECK (provenance = 'USER_UI'),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (reading_state_id, revision),
  FOREIGN KEY (dossier_version_id, dossier_id)
    REFERENCES research_dossier_versions(id, dossier_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (
    (status = 'ACTIVE' AND score_basis_points IS NOT NULL) OR
    (status = 'REVOKED' AND score_basis_points IS NULL)
  )
) STRICT;

CREATE TABLE system_prediction_scores (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  profile_id TEXT NOT NULL REFERENCES account_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  book_id TEXT NOT NULL REFERENCES books(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  score_basis_points INTEGER CHECK (
    score_basis_points IS NULL OR (
      typeof(score_basis_points) = 'integer' AND score_basis_points BETWEEN 0 AND 10000
    )
  ),
  purpose TEXT NOT NULL CHECK (purpose = 'INTERNAL_ORDERING_ONLY'),
  provenance TEXT NOT NULL CHECK (provenance IN ('SCRIPTED_FIXTURE', 'FUTURE_INTERNAL')),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE reading_spoiler_preferences (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  reading_state_id TEXT NOT NULL UNIQUE REFERENCES reading_states(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  current_revision_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  UNIQUE (id, reading_state_id),
  FOREIGN KEY (current_revision_id, id)
    REFERENCES reading_spoiler_preference_revisions(id, preference_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE reading_spoiler_preference_revisions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  preference_id TEXT NOT NULL REFERENCES reading_spoiler_preferences(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  previous_revision_id TEXT REFERENCES reading_spoiler_preference_revisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  policy_version TEXT NOT NULL CHECK (policy_version = 'spoiler-policy-v1'),
  spoiler_level TEXT NOT NULL CHECK (spoiler_level IN (
    'NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS'
  )),
  warning_included INTEGER NOT NULL CHECK (warning_included IN (0, 1)),
  user_confirmed INTEGER NOT NULL CHECK (user_confirmed IN (0, 1)),
  provenance TEXT NOT NULL CHECK (provenance IN ('USER_UI', 'LEGACY_MIGRATION')),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (preference_id, revision),
  UNIQUE (id, preference_id)
) STRICT;

INSERT INTO reading_spoiler_preferences (
  id, reading_state_id, revision, created_at, updated_at
)
SELECT
  'spoiler-preference-' || rowid,
  id,
  1,
  created_at,
  updated_at
FROM reading_states;

INSERT INTO reading_spoiler_preference_revisions (
  id, preference_id, revision, previous_revision_id, policy_version,
  spoiler_level, warning_included, user_confirmed, provenance, created_at
)
SELECT
  'spoiler-revision-' || preference.rowid,
  preference.id,
  1,
  NULL,
  'spoiler-policy-v1',
  'NO_SPOILER',
  0,
  0,
  'LEGACY_MIGRATION',
  preference.created_at
FROM reading_spoiler_preferences AS preference;

UPDATE reading_spoiler_preferences
SET current_revision_id = (
  SELECT revision.id
  FROM reading_spoiler_preference_revisions AS revision
  WHERE revision.preference_id = reading_spoiler_preferences.id
    AND revision.revision = 1
);

CREATE TABLE expression_permission_snapshots (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  reading_state_id TEXT NOT NULL REFERENCES reading_states(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  reading_state_revision_id TEXT NOT NULL REFERENCES reading_state_revisions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  snapshot_version TEXT NOT NULL CHECK (snapshot_version = 'expression-permission-v1'),
  authenticity_policy_version TEXT NOT NULL CHECK (
    authenticity_policy_version = 'reading-authenticity-policy-v1'
  ),
  score_policy_version TEXT NOT NULL CHECK (score_policy_version = 'score-origin-policy-v1'),
  spoiler_policy_version TEXT NOT NULL CHECK (spoiler_policy_version = 'spoiler-policy-v1'),
  dossier_id TEXT REFERENCES research_dossiers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dossier_version_id TEXT,
  dossier_readiness TEXT CHECK (dossier_readiness IS NULL OR dossier_readiness IN (
    'NOT_BUILT', 'BUILD_REQUIRED', 'INSUFFICIENT_COVERAGE',
    'FACT_BLOCKED', 'STALE', 'READY_FOR_CONTENT_BRIEF'
  )),
  spoiler_level TEXT NOT NULL CHECK (spoiler_level IN (
    'NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS'
  )),
  spoiler_warning_required INTEGER NOT NULL CHECK (
    spoiler_warning_required IN (0, 1)
  ),
  spoiler_warning_placement TEXT NOT NULL CHECK (spoiler_warning_placement IN (
    'NONE', 'BODY_OPENING', 'COVER_TITLE_AND_BODY_OPENING'
  )),
  spoiler_user_confirmation_required INTEGER NOT NULL CHECK (
    spoiler_user_confirmation_required IN (0, 1)
  ),
  personal_experience_permission TEXT NOT NULL CHECK (
    personal_experience_permission IN (
      'ALLOWED', 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY', 'RESEARCH_ONLY',
      'BLOCKED', 'STALE_REVIEW_REQUIRED'
    )
  ),
  first_person_permission TEXT NOT NULL CHECK (first_person_permission IN (
    'ALLOWED', 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY', 'RESEARCH_ONLY',
    'BLOCKED', 'STALE_REVIEW_REQUIRED'
  )),
  public_research_analysis_permission TEXT NOT NULL CHECK (
    public_research_analysis_permission IN (
      'ALLOWED', 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY', 'RESEARCH_ONLY',
      'BLOCKED', 'STALE_REVIEW_REQUIRED'
    )
  ),
  personal_score_permission TEXT NOT NULL CHECK (personal_score_permission IN (
    'ALLOWED', 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY', 'RESEARCH_ONLY',
    'BLOCKED', 'STALE_REVIEW_REQUIRED'
  )),
  research_score_permission TEXT NOT NULL CHECK (research_score_permission IN (
    'ALLOWED', 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY', 'RESEARCH_ONLY',
    'BLOCKED', 'STALE_REVIEW_REQUIRED'
  )),
  personal_content_mode TEXT NOT NULL CHECK (personal_content_mode IN (
    'ALLOWED', 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY', 'RESEARCH_ONLY',
    'BLOCKED', 'STALE_REVIEW_REQUIRED'
  )),
  research_content_mode TEXT NOT NULL CHECK (research_content_mode IN (
    'ALLOWED', 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY', 'RESEARCH_ONLY',
    'BLOCKED', 'STALE_REVIEW_REQUIRED'
  )),
  content_brief_readiness TEXT NOT NULL CHECK (content_brief_readiness IN (
    'ALLOWED', 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY', 'RESEARCH_ONLY',
    'BLOCKED', 'STALE_REVIEW_REQUIRED'
  )),
  blocking_reason_codes_json TEXT NOT NULL CHECK (
    json_valid(blocking_reason_codes_json) AND
    json_type(blocking_reason_codes_json) = 'array' AND
    length(CAST(blocking_reason_codes_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  warning_reason_codes_json TEXT NOT NULL CHECK (
    json_valid(warning_reason_codes_json) AND
    json_type(warning_reason_codes_json) = 'array' AND
    length(CAST(warning_reason_codes_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  dependency_hash TEXT NOT NULL CHECK (
    length(dependency_hash) = 64 AND dependency_hash NOT GLOB '*[^0-9a-f]*'
  ),
  evaluated_at TEXT NOT NULL CHECK (evaluated_at ${UTC_REQUIRED}),
  published_at TEXT NOT NULL CHECK (published_at ${UTC_REQUIRED}),
  UNIQUE (id, reading_state_id),
  FOREIGN KEY (dossier_version_id, dossier_id)
    REFERENCES research_dossier_versions(id, dossier_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK ((dossier_id IS NULL) = (dossier_version_id IS NULL)),
  CHECK ((dossier_id IS NULL) = (dossier_readiness IS NULL))
) STRICT;

CREATE TABLE expression_permission_dependencies (
  snapshot_id TEXT NOT NULL REFERENCES expression_permission_snapshots(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'READING_STATE', 'EXPERIENCE_ASSERTION', 'DOSSIER_VERSION',
    'DOSSIER_READINESS', 'AUTHENTICITY_POLICY', 'SCORE_POLICY',
    'SPOILER_POLICY', 'CATALOG_SUBJECT', 'PROFILE'
  )),
  dependency_id TEXT NOT NULL CHECK (length(dependency_id) BETWEEN 1 AND 1024),
  observed_revision TEXT NOT NULL CHECK (length(observed_revision) BETWEEN 1 AND 256),
  dependency_key TEXT NOT NULL CHECK (
    length(dependency_key) = 64 AND dependency_key NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (snapshot_id, dependency_key)
) STRICT, WITHOUT ROWID;

CREATE TABLE expression_permission_invalidations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  event_identity TEXT NOT NULL UNIQUE CHECK (
    length(event_identity) BETWEEN 1 AND 1024
  ),
  snapshot_id TEXT NOT NULL REFERENCES expression_permission_snapshots(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  reading_state_id TEXT NOT NULL REFERENCES reading_states(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'READING_STATE', 'EXPERIENCE_ASSERTION', 'DOSSIER_VERSION',
    'DOSSIER_READINESS', 'AUTHENTICITY_POLICY', 'SCORE_POLICY',
    'SPOILER_POLICY', 'CATALOG_SUBJECT', 'PROFILE'
  )),
  dependency_id TEXT NOT NULL CHECK (length(dependency_id) BETWEEN 1 AND 1024),
  observed_revision TEXT NOT NULL CHECK (length(observed_revision) BETWEEN 1 AND 256),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'READING_STATE_CHANGED', 'ASSERTION_CHANGED', 'DOSSIER_CHANGED',
    'POLICY_CHANGED', 'CATALOG_SUBJECT_CHANGED', 'PROFILE_CHANGED',
    'LEGACY_REVIEW_REQUIRED'
  )),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE reading_authenticity_audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LEGACY_MIGRATED', 'STATE_CHANGED', 'STATE_UNDONE',
    'ASSERTION_CONFIRMED', 'ASSERTION_REVOKED',
    'PERSONAL_SCORE_SET', 'PERSONAL_SCORE_REVOKED',
    'RESEARCH_SCORE_SET', 'RESEARCH_SCORE_REVOKED',
    'SPOILER_PREFERENCE_CHANGED', 'BATCH_APPLIED', 'SNAPSHOT_PUBLISHED'
  )),
  reading_state_id TEXT NOT NULL REFERENCES reading_states(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  profile_id TEXT NOT NULL REFERENCES account_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  book_id TEXT NOT NULL REFERENCES books(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  actor TEXT NOT NULL CHECK (actor IN ('USER', 'MIGRATION')),
  details_json TEXT NOT NULL CHECK (
    json_valid(details_json) AND json_type(details_json) = 'object' AND
    length(CAST(details_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

INSERT INTO reading_authenticity_audit_events (
  id, event_type, reading_state_id, profile_id, book_id,
  revision, actor, details_json, created_at
)
SELECT
  'legacy-authenticity-audit-' || rowid,
  'LEGACY_MIGRATED',
  id,
  profile_id,
  book_id,
  revision,
  'MIGRATION',
  '{"result":"FAIL_CLOSED_MAPPING"}',
  updated_at
FROM reading_states;

CREATE INDEX idx_reading_states_profile_work
  ON reading_states(profile_id, book_id);
CREATE INDEX idx_reading_states_current_revision
  ON reading_states(current_revision_id);
CREATE INDEX idx_reading_states_current_snapshot
  ON reading_states(current_snapshot_id);
CREATE INDEX idx_reading_state_revisions_state
  ON reading_state_revisions(state, memory_confidence, reading_state_id);
CREATE INDEX idx_reading_state_revisions_history
  ON reading_state_revisions(reading_state_id, revision DESC);
CREATE INDEX idx_reading_state_revisions_expression
  ON reading_state_revisions(expression_id, reading_state_id);
CREATE INDEX idx_reading_state_revisions_edition
  ON reading_state_revisions(edition_id, reading_state_id);
CREATE INDEX idx_reading_state_revisions_previous
  ON reading_state_revisions(previous_revision_id);
CREATE INDEX idx_experience_assertions_reading
  ON experience_assertions(reading_state_id, updated_at DESC);
CREATE INDEX idx_experience_assertions_current_revision
  ON experience_assertions(current_revision_id);
CREATE INDEX idx_assertion_revisions_reading_revision
  ON experience_assertion_revisions(reading_state_revision_id, status, assertion_kind);
CREATE INDEX idx_assertion_revisions_history
  ON experience_assertion_revisions(assertion_id, revision DESC);
CREATE INDEX idx_assertion_revisions_previous
  ON experience_assertion_revisions(previous_revision_id);
CREATE INDEX idx_personal_scores_current
  ON personal_score_records(reading_state_id, revision DESC, status);
CREATE INDEX idx_personal_scores_reading_revision
  ON personal_score_records(reading_state_revision_id, status);
CREATE INDEX idx_personal_scores_assertion
  ON personal_score_records(assertion_revision_id);
CREATE INDEX idx_research_scores_current
  ON research_analysis_score_records(reading_state_id, revision DESC, status);
CREATE INDEX idx_research_scores_reading_revision
  ON research_analysis_score_records(reading_state_revision_id, status);
CREATE INDEX idx_research_scores_dossier
  ON research_analysis_score_records(dossier_id, dossier_version_id, status);
CREATE INDEX idx_research_scores_dossier_version
  ON research_analysis_score_records(dossier_version_id, dossier_id);
CREATE INDEX idx_internal_scores_work
  ON system_prediction_scores(profile_id, book_id, created_at DESC);
CREATE INDEX idx_internal_scores_book
  ON system_prediction_scores(book_id, profile_id, created_at DESC);
CREATE INDEX idx_spoiler_preferences_reading
  ON reading_spoiler_preferences(reading_state_id);
CREATE INDEX idx_spoiler_preferences_current_revision
  ON reading_spoiler_preferences(current_revision_id);
CREATE INDEX idx_spoiler_revisions_history
  ON reading_spoiler_preference_revisions(preference_id, revision DESC);
CREATE INDEX idx_spoiler_revisions_previous
  ON reading_spoiler_preference_revisions(previous_revision_id);
CREATE INDEX idx_permission_snapshots_reading
  ON expression_permission_snapshots(reading_state_id, published_at DESC);
CREATE INDEX idx_permission_snapshots_reading_revision
  ON expression_permission_snapshots(reading_state_revision_id);
CREATE INDEX idx_permission_snapshots_dossier
  ON expression_permission_snapshots(dossier_id, dossier_version_id);
CREATE INDEX idx_permission_snapshots_dossier_version
  ON expression_permission_snapshots(dossier_version_id, dossier_id);
CREATE INDEX idx_permission_dependencies_lookup
  ON expression_permission_dependencies(
    dependency_type, dependency_id, observed_revision, snapshot_id
  );
CREATE INDEX idx_permission_invalidations_snapshot
  ON expression_permission_invalidations(snapshot_id, created_at DESC);
CREATE INDEX idx_permission_invalidations_reading
  ON expression_permission_invalidations(reading_state_id, created_at DESC);
CREATE INDEX idx_authenticity_audit_reading
  ON reading_authenticity_audit_events(reading_state_id, created_at DESC);
CREATE INDEX idx_authenticity_audit_profile_work
  ON reading_authenticity_audit_events(profile_id, book_id, created_at DESC);
CREATE INDEX idx_authenticity_audit_book
  ON reading_authenticity_audit_events(book_id, created_at DESC);

CREATE TRIGGER reading_states_immutable_identity
BEFORE UPDATE OF id, profile_id, created_at ON reading_states
BEGIN
  SELECT RAISE(ABORT, 'reading state identity is immutable');
END;

CREATE TRIGGER reading_states_delete_guard
BEFORE DELETE ON reading_states
BEGIN
  SELECT RAISE(ABORT, 'reading states cannot be deleted');
END;

CREATE TRIGGER reading_states_current_revision_guard
BEFORE UPDATE OF current_revision_id, revision ON reading_states
WHEN NEW.current_revision_id IS NOT OLD.current_revision_id OR NEW.revision <> OLD.revision
BEGIN
  SELECT CASE WHEN
    NEW.current_revision_id IS NULL OR
    NEW.revision <> OLD.revision + 1 OR
    NOT EXISTS (
      SELECT 1 FROM reading_state_revisions AS revision
      WHERE revision.id = NEW.current_revision_id
        AND revision.reading_state_id = NEW.id
        AND revision.revision = NEW.revision
    )
  THEN RAISE(ABORT, 'reading state current revision invariant') END;
END;

CREATE TRIGGER reading_states_current_snapshot_guard
BEFORE UPDATE OF current_snapshot_id ON reading_states
WHEN NEW.current_snapshot_id IS NOT OLD.current_snapshot_id
BEGIN
  SELECT CASE WHEN
    NEW.current_snapshot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM expression_permission_snapshots AS snapshot
      WHERE snapshot.id = NEW.current_snapshot_id
        AND snapshot.reading_state_id = NEW.id
        AND snapshot.reading_state_revision_id = NEW.current_revision_id
    )
  THEN RAISE(ABORT, 'reading state current snapshot invariant') END;
END;

CREATE TRIGGER reading_state_revisions_append_only_update
BEFORE UPDATE ON reading_state_revisions
BEGIN
  SELECT RAISE(ABORT, 'reading state revisions are append-only');
END;

CREATE TRIGGER reading_state_revisions_append_only_delete
BEFORE DELETE ON reading_state_revisions
BEGIN
  SELECT RAISE(ABORT, 'reading state revisions are append-only');
END;

CREATE TRIGGER experience_assertions_immutable_identity
BEFORE UPDATE OF id, reading_state_id, created_at ON experience_assertions
BEGIN
  SELECT RAISE(ABORT, 'experience assertion identity is immutable');
END;

CREATE TRIGGER experience_assertions_delete_guard
BEFORE DELETE ON experience_assertions
BEGIN
  SELECT RAISE(ABORT, 'experience assertions cannot be deleted');
END;

CREATE TRIGGER experience_assertions_current_guard
BEFORE UPDATE OF current_revision_id, revision ON experience_assertions
WHEN NEW.current_revision_id IS NOT OLD.current_revision_id OR NEW.revision <> OLD.revision
BEGIN
  SELECT CASE WHEN
    NEW.current_revision_id IS NULL OR
    NEW.revision <> OLD.revision + 1 OR
    NOT EXISTS (
      SELECT 1 FROM experience_assertion_revisions AS revision
      WHERE revision.id = NEW.current_revision_id
        AND revision.assertion_id = NEW.id
        AND revision.revision = NEW.revision
    )
  THEN RAISE(ABORT, 'experience assertion current revision invariant') END;
END;

CREATE TRIGGER experience_assertion_revisions_append_only_update
BEFORE UPDATE ON experience_assertion_revisions
BEGIN
  SELECT RAISE(ABORT, 'experience assertion revisions are append-only');
END;

CREATE TRIGGER experience_assertion_revisions_append_only_delete
BEFORE DELETE ON experience_assertion_revisions
BEGIN
  SELECT RAISE(ABORT, 'experience assertion revisions are append-only');
END;

CREATE TRIGGER personal_scores_append_only_update
BEFORE UPDATE ON personal_score_records
BEGIN
  SELECT RAISE(ABORT, 'personal scores are append-only');
END;

CREATE TRIGGER personal_scores_append_only_delete
BEFORE DELETE ON personal_score_records
BEGIN
  SELECT RAISE(ABORT, 'personal scores are append-only');
END;

CREATE TRIGGER research_scores_append_only_update
BEFORE UPDATE ON research_analysis_score_records
BEGIN
  SELECT RAISE(ABORT, 'research scores are append-only');
END;

CREATE TRIGGER research_scores_append_only_delete
BEFORE DELETE ON research_analysis_score_records
BEGIN
  SELECT RAISE(ABORT, 'research scores are append-only');
END;

CREATE TRIGGER internal_scores_append_only_update
BEFORE UPDATE ON system_prediction_scores
BEGIN
  SELECT RAISE(ABORT, 'internal prediction scores are append-only');
END;

CREATE TRIGGER internal_scores_append_only_delete
BEFORE DELETE ON system_prediction_scores
BEGIN
  SELECT RAISE(ABORT, 'internal prediction scores are append-only');
END;

CREATE TRIGGER spoiler_preferences_immutable_identity
BEFORE UPDATE OF id, reading_state_id, created_at ON reading_spoiler_preferences
BEGIN
  SELECT RAISE(ABORT, 'spoiler preference identity is immutable');
END;

CREATE TRIGGER spoiler_preferences_current_guard
BEFORE UPDATE OF current_revision_id, revision ON reading_spoiler_preferences
WHEN NEW.current_revision_id IS NOT OLD.current_revision_id OR NEW.revision <> OLD.revision
BEGIN
  SELECT CASE WHEN
    NEW.current_revision_id IS NULL OR
    NEW.revision <> OLD.revision + 1 OR
    NOT EXISTS (
      SELECT 1 FROM reading_spoiler_preference_revisions AS revision
      WHERE revision.id = NEW.current_revision_id
        AND revision.preference_id = NEW.id
        AND revision.revision = NEW.revision
    )
  THEN RAISE(ABORT, 'spoiler preference current revision invariant') END;
END;

CREATE TRIGGER spoiler_preferences_delete_guard
BEFORE DELETE ON reading_spoiler_preferences
BEGIN
  SELECT RAISE(ABORT, 'spoiler preferences cannot be deleted');
END;

CREATE TRIGGER spoiler_revisions_append_only_update
BEFORE UPDATE ON reading_spoiler_preference_revisions
BEGIN
  SELECT RAISE(ABORT, 'spoiler preference revisions are append-only');
END;

CREATE TRIGGER spoiler_revisions_append_only_delete
BEFORE DELETE ON reading_spoiler_preference_revisions
BEGIN
  SELECT RAISE(ABORT, 'spoiler preference revisions are append-only');
END;

CREATE TRIGGER permission_snapshots_append_only_update
BEFORE UPDATE ON expression_permission_snapshots
BEGIN
  SELECT RAISE(ABORT, 'permission snapshots are append-only');
END;

CREATE TRIGGER permission_snapshots_append_only_delete
BEFORE DELETE ON expression_permission_snapshots
BEGIN
  SELECT RAISE(ABORT, 'permission snapshots are append-only');
END;

CREATE TRIGGER permission_dependencies_append_only_update
BEFORE UPDATE ON expression_permission_dependencies
BEGIN
  SELECT RAISE(ABORT, 'permission dependencies are append-only');
END;

CREATE TRIGGER permission_dependencies_append_only_delete
BEFORE DELETE ON expression_permission_dependencies
BEGIN
  SELECT RAISE(ABORT, 'permission dependencies are append-only');
END;

CREATE TRIGGER permission_invalidations_append_only_update
BEFORE UPDATE ON expression_permission_invalidations
BEGIN
  SELECT RAISE(ABORT, 'permission invalidations are append-only');
END;

CREATE TRIGGER permission_invalidations_append_only_delete
BEFORE DELETE ON expression_permission_invalidations
BEGIN
  SELECT RAISE(ABORT, 'permission invalidations are append-only');
END;

CREATE TRIGGER authenticity_audit_append_only_update
BEFORE UPDATE ON reading_authenticity_audit_events
BEGIN
  SELECT RAISE(ABORT, 'authenticity audit is append-only');
END;

CREATE TRIGGER authenticity_audit_append_only_delete
BEFORE DELETE ON reading_authenticity_audit_events
BEGIN
  SELECT RAISE(ABORT, 'authenticity audit is append-only');
END;

CREATE TRIGGER invalidate_permission_on_reading_change
AFTER UPDATE OF current_revision_id ON reading_states
WHEN OLD.current_snapshot_id IS NOT NULL AND
     NEW.current_revision_id IS NOT OLD.current_revision_id
BEGIN
  INSERT OR IGNORE INTO expression_permission_invalidations (
    id, event_identity, snapshot_id, reading_state_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  ) VALUES (
    'permission-invalidation-' || lower(hex(randomblob(16))),
    'READING_STATE:' || NEW.id || ':' || NEW.revision || ':' || OLD.current_snapshot_id,
    OLD.current_snapshot_id,
    NEW.id,
    'READING_STATE',
    NEW.current_revision_id,
    CAST(NEW.revision AS TEXT),
    'READING_STATE_CHANGED',
    NEW.updated_at
  );
END;

CREATE TRIGGER invalidate_permission_on_assertion_change
AFTER UPDATE OF current_revision_id ON experience_assertions
WHEN NEW.current_revision_id IS NOT OLD.current_revision_id
BEGIN
  INSERT OR IGNORE INTO expression_permission_invalidations (
    id, event_identity, snapshot_id, reading_state_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'permission-invalidation-' || lower(hex(randomblob(16))),
    'ASSERTION:' || NEW.id || ':' || NEW.revision || ':' || state.current_snapshot_id,
    state.current_snapshot_id,
    state.id,
    'EXPERIENCE_ASSERTION',
    NEW.id,
    CAST(NEW.revision AS TEXT),
    'ASSERTION_CHANGED',
    NEW.updated_at
  FROM reading_states AS state
  WHERE state.id = NEW.reading_state_id
    AND state.current_snapshot_id IS NOT NULL;
END;

CREATE TRIGGER invalidate_permission_on_spoiler_change
AFTER UPDATE OF current_revision_id ON reading_spoiler_preferences
WHEN NEW.current_revision_id IS NOT OLD.current_revision_id
BEGIN
  INSERT OR IGNORE INTO expression_permission_invalidations (
    id, event_identity, snapshot_id, reading_state_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'permission-invalidation-' || lower(hex(randomblob(16))),
    'SPOILER:' || NEW.id || ':' || NEW.revision || ':' || state.current_snapshot_id,
    state.current_snapshot_id,
    state.id,
    'SPOILER_POLICY',
    NEW.id,
    CAST(NEW.revision AS TEXT),
    'POLICY_CHANGED',
    NEW.updated_at
  FROM reading_states AS state
  WHERE state.id = NEW.reading_state_id
    AND state.current_snapshot_id IS NOT NULL;
END;

CREATE TRIGGER invalidate_permission_on_dossier_change
AFTER UPDATE OF current_version_id, readiness, state, revision ON research_dossiers
WHEN NEW.current_version_id IS NOT OLD.current_version_id OR
     NEW.readiness <> OLD.readiness OR
     NEW.state <> OLD.state OR
     NEW.revision <> OLD.revision
BEGIN
  INSERT OR IGNORE INTO expression_permission_invalidations (
    id, event_identity, snapshot_id, reading_state_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'permission-invalidation-' || lower(hex(randomblob(16))),
    'DOSSIER:' || NEW.id || ':' || NEW.revision || ':' || snapshot.id,
    snapshot.id,
    snapshot.reading_state_id,
    'DOSSIER_READINESS',
    NEW.id,
    CAST(NEW.revision AS TEXT),
    'DOSSIER_CHANGED',
    NEW.updated_at
  FROM expression_permission_dependencies AS dependency
  JOIN expression_permission_snapshots AS snapshot
    ON snapshot.id = dependency.snapshot_id
  WHERE dependency.dependency_type IN ('DOSSIER_VERSION', 'DOSSIER_READINESS')
    AND dependency.dependency_id = NEW.id;
END;

CREATE TRIGGER invalidate_permission_on_catalog_work_change
AFTER UPDATE OF catalog_revision, catalog_state ON books
WHEN NEW.catalog_revision <> OLD.catalog_revision OR NEW.catalog_state <> OLD.catalog_state
BEGIN
  INSERT OR IGNORE INTO expression_permission_invalidations (
    id, event_identity, snapshot_id, reading_state_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'permission-invalidation-' || lower(hex(randomblob(16))),
    'CATALOG_WORK:' || NEW.id || ':' || NEW.catalog_revision || ':' || snapshot.id,
    snapshot.id,
    snapshot.reading_state_id,
    'CATALOG_SUBJECT',
    NEW.id,
    CAST(NEW.catalog_revision AS TEXT),
    'CATALOG_SUBJECT_CHANGED',
    NEW.updated_at
  FROM expression_permission_dependencies AS dependency
  JOIN expression_permission_snapshots AS snapshot
    ON snapshot.id = dependency.snapshot_id
  WHERE dependency.dependency_type = 'CATALOG_SUBJECT'
    AND dependency.dependency_id = NEW.id;
END;

CREATE TRIGGER invalidate_permission_on_profile_ownership_change
AFTER UPDATE OF ownership ON account_profiles
WHEN NEW.ownership <> OLD.ownership
BEGIN
  INSERT OR IGNORE INTO expression_permission_invalidations (
    id, event_identity, snapshot_id, reading_state_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    'permission-invalidation-' || lower(hex(randomblob(16))),
    'PROFILE:' || NEW.id || ':' || NEW.updated_at || ':' || snapshot.id,
    snapshot.id,
    snapshot.reading_state_id,
    'PROFILE',
    NEW.id,
    NEW.updated_at,
    'PROFILE_CHANGED',
    NEW.updated_at
  FROM expression_permission_dependencies AS dependency
  JOIN expression_permission_snapshots AS snapshot
    ON snapshot.id = dependency.snapshot_id
  WHERE dependency.dependency_type = 'PROFILE'
    AND dependency.dependency_id = NEW.id;
END;
`;

const TOPIC_POOL_AND_FIRST_30_QUOTA = `
ALTER TABLE topics ADD COLUMN topic_contract_version TEXT CHECK (
  topic_contract_version IS NULL OR topic_contract_version IN (
    'legacy-topic-v0', 'topic-candidate-v1'
  )
);
ALTER TABLE topics ADD COLUMN profile_id TEXT
  REFERENCES account_profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE topics ADD COLUMN semantic_fingerprint TEXT CHECK (
  semantic_fingerprint IS NULL OR (
    length(semantic_fingerprint) = 64 AND
    semantic_fingerprint NOT GLOB '*[^0-9a-f]*'
  )
);
ALTER TABLE topics ADD COLUMN canonical_topic_id TEXT
  REFERENCES topics(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE topics ADD COLUMN candidate_state TEXT CHECK (
  candidate_state IS NULL OR candidate_state IN ('PROPOSED', 'LOCKED', 'HELD', 'ARCHIVED')
);
ALTER TABLE topics ADD COLUMN current_version_number INTEGER CHECK (
  current_version_number IS NULL OR (
    typeof(current_version_number) = 'integer' AND current_version_number > 0
  )
);
ALTER TABLE topics ADD COLUMN topic_revision INTEGER CHECK (
  topic_revision IS NULL OR (
    typeof(topic_revision) = 'integer' AND topic_revision > 0
  )
);
ALTER TABLE topics ADD COLUMN created_at TEXT CHECK (
  created_at IS NULL OR created_at ${UTC_REQUIRED}
);
ALTER TABLE topics ADD COLUMN updated_at TEXT CHECK (
  updated_at IS NULL OR updated_at ${UTC_REQUIRED}
);

UPDATE topics
SET
  topic_contract_version = 'legacy-topic-v0',
  profile_id = 'primary',
  candidate_state = CASE WHEN status = 'ARCHIVED' THEN 'ARCHIVED' ELSE 'HELD' END,
  topic_revision = 1,
  created_at = ${UTC_NOW},
  updated_at = ${UTC_NOW}
WHERE topic_contract_version IS NULL;

CREATE TABLE topic_candidate_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 512),
  topic_id TEXT NOT NULL REFERENCES topics(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (
    typeof(version_number) = 'integer' AND version_number > 0
  ),
  previous_version_id TEXT REFERENCES topic_candidate_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  schema_version TEXT NOT NULL CHECK (
    schema_version IN ('legacy-topic-v0', 'topic-candidate-v1')
  ),
  content_type TEXT NOT NULL CHECK (content_type IN (
    'LEGACY_UNCLASSIFIED',
    'NON_SPOILER_SINGLE_BOOK_VERDICT',
    'FULL_TRICK_LOGIC_ANALYSIS',
    'CROSS_WORK_COMPARISON',
    'WEB_VS_PUBLISHED_MYSTERY',
    'MYSTERY_AND_CULTURAL_PHENOMENON'
  )),
  topic_angle TEXT NOT NULL CHECK (
    (schema_version = 'topic-candidate-v1' AND
      length(CAST(topic_angle AS BLOB)) BETWEEN 1 AND 1000) OR
    (schema_version = 'legacy-topic-v0' AND
      length(CAST(topic_angle AS BLOB)) BETWEEN 1 AND 65536)
  ),
  central_question TEXT NOT NULL CHECK (
    (schema_version = 'topic-candidate-v1' AND
      length(CAST(central_question AS BLOB)) BETWEEN 1 AND 1000) OR
    (schema_version = 'legacy-topic-v0' AND
      length(CAST(central_question AS BLOB)) BETWEEN 1 AND 65536)
  ),
  candidate_judgment TEXT CHECK (
    candidate_judgment IS NULL OR length(CAST(candidate_judgment AS BLOB)) BETWEEN 1 AND 1000
  ),
  analysis_mode TEXT NOT NULL CHECK (
    analysis_mode IN ('PERSONAL', 'PUBLIC_RESEARCH', 'LEGACY_UNCLASSIFIED')
  ),
  spoiler_level TEXT NOT NULL CHECK (
    spoiler_level IN ('NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS')
  ),
  spoiler_warning_required INTEGER NOT NULL CHECK (spoiler_warning_required IN (0, 1)),
  spoiler_warning_placement TEXT NOT NULL CHECK (
    spoiler_warning_placement IN ('NONE', 'BODY_OPENING', 'COVER_TITLE_AND_BODY_OPENING')
  ),
  spoiler_user_confirmation_required INTEGER NOT NULL CHECK (
    spoiler_user_confirmation_required IN (0, 1)
  ),
  comparison_dimension TEXT CHECK (
    comparison_dimension IS NULL OR comparison_dimension IN (
      'TRICK_STRUCTURE', 'NARRATIVE_PERSPECTIVE', 'FAIR_PLAY',
      'SOCIAL_CONTEXT', 'PUBLICATION_FORM', 'RECEPTION'
    )
  ),
  required_public_labels_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(required_public_labels_json) AND
    json_type(required_public_labels_json) = 'array' AND
    length(CAST(required_public_labels_json AS BLOB)) BETWEEN 2 AND 512
  ),
  semantic_fingerprint TEXT CHECK (
    semantic_fingerprint IS NULL OR (
      length(semantic_fingerprint) = 64 AND
      semantic_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  ),
  fingerprint_policy_version TEXT CHECK (
    fingerprint_policy_version IS NULL OR
    fingerprint_policy_version = 'topic-semantic-fingerprint-v1'
  ),
  eligibility_state TEXT NOT NULL CHECK (eligibility_state IN (
    'ELIGIBLE', 'DOSSIER_NOT_READY', 'AUTHENTICITY_BLOCKED', 'FACT_BLOCKED',
    'STALE', 'INSUFFICIENT_COMPARISON_SET', 'SPOILER_POLICY_INCOMPLETE',
    'DUPLICATE', 'ARCHIVED'
  )),
  eligibility_reason_codes_json TEXT NOT NULL CHECK (
    json_valid(eligibility_reason_codes_json) AND
    json_type(eligibility_reason_codes_json) = 'array' AND
    length(CAST(eligibility_reason_codes_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  eligibility_policy_version TEXT NOT NULL CHECK (
    eligibility_policy_version IN ('legacy-topic-v0', 'topic-eligibility-policy-v1')
  ),
  ranking_policy_version TEXT CHECK (
    ranking_policy_version IS NULL OR ranking_policy_version = 'topic-ranking-policy-v1'
  ),
  total_score_basis_points INTEGER CHECK (
    total_score_basis_points IS NULL OR (
      typeof(total_score_basis_points) = 'integer' AND
      total_score_basis_points BETWEEN 0 AND 10000
    )
  ),
  ranking_complete INTEGER NOT NULL DEFAULT 0 CHECK (ranking_complete IN (0, 1)),
  tie_break_key TEXT CHECK (
    tie_break_key IS NULL OR length(tie_break_key) BETWEEN 1 AND 512
  ),
  dependency_hash TEXT NOT NULL CHECK (
    length(dependency_hash) = 64 AND dependency_hash NOT GLOB '*[^0-9a-f]*'
  ),
  input_hash TEXT NOT NULL CHECK (
    length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
  ),
  estimated_external_cost_microusd INTEGER CHECK (
    estimated_external_cost_microusd IS NULL OR (
      typeof(estimated_external_cost_microusd) = 'integer' AND
      estimated_external_cost_microusd BETWEEN 0 AND 9000000000000
    )
  ),
  cost_state TEXT NOT NULL CHECK (cost_state IN ('KNOWN', 'UNKNOWN')),
  approval_workload_units INTEGER CHECK (
    approval_workload_units IS NULL OR (
      typeof(approval_workload_units) = 'integer' AND
      approval_workload_units BETWEEN 0 AND 10000
    )
  ),
  workload_state TEXT NOT NULL CHECK (workload_state IN ('KNOWN', 'UNKNOWN')),
  provenance TEXT NOT NULL CHECK (
    provenance IN ('LOCAL_DETERMINISTIC', 'SCRIPTED_MOCK', 'LEGACY_MIGRATION')
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (topic_id, version_number),
  UNIQUE (id, topic_id),
  CHECK (
    (schema_version = 'legacy-topic-v0' AND
      content_type = 'LEGACY_UNCLASSIFIED' AND
      analysis_mode = 'LEGACY_UNCLASSIFIED' AND
      semantic_fingerprint IS NULL AND fingerprint_policy_version IS NULL AND
      eligibility_policy_version = 'legacy-topic-v0' AND
      ranking_policy_version IS NULL AND total_score_basis_points IS NULL AND
      tie_break_key IS NULL AND provenance = 'LEGACY_MIGRATION') OR
    (schema_version = 'topic-candidate-v1' AND
      content_type <> 'LEGACY_UNCLASSIFIED' AND
      analysis_mode <> 'LEGACY_UNCLASSIFIED' AND
      semantic_fingerprint IS NOT NULL AND
      fingerprint_policy_version = 'topic-semantic-fingerprint-v1' AND
      eligibility_policy_version = 'topic-eligibility-policy-v1' AND
      ranking_policy_version = 'topic-ranking-policy-v1' AND
      tie_break_key IS NOT NULL AND provenance <> 'LEGACY_MIGRATION')
  ),
  CHECK (
    (cost_state = 'KNOWN' AND estimated_external_cost_microusd IS NOT NULL) OR
    (cost_state = 'UNKNOWN' AND estimated_external_cost_microusd IS NULL)
  ),
  CHECK (
    (workload_state = 'KNOWN' AND approval_workload_units IS NOT NULL) OR
    (workload_state = 'UNKNOWN' AND approval_workload_units IS NULL)
  ),
  CHECK (
    (spoiler_level = 'NO_SPOILER' AND spoiler_warning_required = 0 AND
      spoiler_warning_placement = 'NONE' AND spoiler_user_confirmation_required = 0) OR
    (spoiler_level = 'LIGHT_SPOILER' AND spoiler_warning_required = 1 AND
      spoiler_warning_placement = 'BODY_OPENING' AND spoiler_user_confirmation_required = 0) OR
    (spoiler_level = 'FULL_TRICK_ANALYSIS' AND spoiler_warning_required = 1 AND
      spoiler_warning_placement = 'COVER_TITLE_AND_BODY_OPENING' AND
      spoiler_user_confirmation_required = 1)
  )
) STRICT;

CREATE TABLE topic_subject_memberships (
  version_id TEXT NOT NULL REFERENCES topic_candidate_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (
    typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 5
  ),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('WORK', 'EXPRESSION', 'EDITION')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 256),
  work_id TEXT NOT NULL REFERENCES books(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  expression_id TEXT REFERENCES expressions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  edition_id TEXT REFERENCES book_editions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('PRIMARY', 'COMPARISON', 'CONTEXT')),
  expression_form TEXT CHECK (
    expression_form IS NULL OR expression_form IN (
      'WEB_SERIALIZED', 'PUBLISHED_EDITION', 'OTHER_VERIFIED'
    )
  ),
  catalog_revision INTEGER NOT NULL CHECK (
    typeof(catalog_revision) = 'integer' AND catalog_revision > 0
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (version_id, ordinal),
  UNIQUE (version_id, subject_type, subject_id),
  CHECK (
    (subject_type = 'WORK' AND subject_id = work_id AND
      expression_id IS NULL AND edition_id IS NULL AND expression_form IS NULL) OR
    (subject_type = 'EXPRESSION' AND subject_id = expression_id AND
      expression_id IS NOT NULL AND edition_id IS NULL AND expression_form IS NOT NULL) OR
    (subject_type = 'EDITION' AND subject_id = edition_id AND
      expression_id IS NOT NULL AND edition_id IS NOT NULL AND expression_form IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_context_claims (
  version_id TEXT NOT NULL REFERENCES topic_candidate_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_id TEXT NOT NULL REFERENCES claims(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  work_id TEXT NOT NULL REFERENCES books(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  fact_status TEXT NOT NULL CHECK (fact_status IN (
    'VERIFIED', 'SUPPORTED_NOT_VERIFIED', 'INSUFFICIENT', 'CONFLICTED',
    'FACT_BLOCKED', 'STALE_REVIEW_REQUIRED'
  )),
  context_only INTEGER NOT NULL CHECK (context_only IN (0, 1)),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (version_id, claim_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_ranking_components (
  version_id TEXT NOT NULL REFERENCES topic_candidate_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  component_type TEXT NOT NULL CHECK (component_type IN (
    'EVIDENCE_SUFFICIENCY', 'CONTENT_FIT', 'DIFFERENTIATION',
    'ESTIMATED_COST', 'APPROVAL_WORKLOAD'
  )),
  knowledge_state TEXT NOT NULL CHECK (knowledge_state IN ('KNOWN', 'UNKNOWN')),
  value_basis_points INTEGER CHECK (
    value_basis_points IS NULL OR (
      typeof(value_basis_points) = 'integer' AND value_basis_points BETWEEN 0 AND 10000
    )
  ),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND
    length(CAST(reason_codes_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  input_dependencies_json TEXT NOT NULL CHECK (
    json_valid(input_dependencies_json) AND json_type(input_dependencies_json) = 'array' AND
    length(CAST(input_dependencies_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  policy_version TEXT NOT NULL CHECK (policy_version = 'topic-ranking-policy-v1'),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (version_id, component_type),
  CHECK (
    (knowledge_state = 'KNOWN' AND value_basis_points IS NOT NULL) OR
    (knowledge_state = 'UNKNOWN' AND value_basis_points IS NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_dependencies (
  version_id TEXT NOT NULL REFERENCES topic_candidate_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'CATALOG_SUBJECT', 'DOSSIER_VERSION', 'DOSSIER_READINESS',
    'EXPRESSION_PERMISSION', 'AUTHENTICITY_POLICY', 'SPOILER_POLICY',
    'FACT_POLICY', 'CONTEXT_CLAIM', 'TOPIC_POOL', 'TOPIC_POLICY'
  )),
  dependency_id TEXT NOT NULL CHECK (length(dependency_id) BETWEEN 1 AND 1024),
  observed_revision TEXT NOT NULL CHECK (length(observed_revision) BETWEEN 1 AND 256),
  dependency_key TEXT NOT NULL CHECK (
    length(dependency_key) = 64 AND dependency_key NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (version_id, dependency_key)
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_state_transitions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  topic_id TEXT NOT NULL REFERENCES topics(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  previous_transition_id TEXT REFERENCES topic_state_transitions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  from_state TEXT CHECK (
    from_state IS NULL OR from_state IN ('PROPOSED', 'LOCKED', 'HELD', 'ARCHIVED')
  ),
  to_state TEXT NOT NULL CHECK (to_state IN ('PROPOSED', 'LOCKED', 'HELD', 'ARCHIVED')),
  action TEXT NOT NULL CHECK (
    action IN ('CREATE', 'LOCK', 'HOLD', 'RESUME', 'ARCHIVE', 'RESTORE', 'UNDO', 'LEGACY_MIGRATION')
  ),
  expected_revision INTEGER NOT NULL CHECK (
    typeof(expected_revision) = 'integer' AND expected_revision >= 0
  ),
  actor TEXT NOT NULL CHECK (actor IN ('USER', 'LOCAL_SYSTEM', 'MIGRATION')),
  details_json TEXT NOT NULL CHECK (
    json_valid(details_json) AND json_type(details_json) = 'object' AND
    length(CAST(details_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (topic_id, revision)
) STRICT;

CREATE TABLE topic_generation_plans (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  profile_id TEXT NOT NULL REFERENCES account_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  contract_version TEXT NOT NULL CHECK (contract_version = 'topic-generation-plan-v1'),
  plan_hash TEXT NOT NULL UNIQUE CHECK (
    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  input_hash TEXT NOT NULL CHECK (
    length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
  ),
  input_work_count INTEGER NOT NULL CHECK (
    typeof(input_work_count) = 'integer' AND input_work_count BETWEEN 0 AND 5000
  ),
  counts_json TEXT NOT NULL CHECK (
    json_valid(counts_json) AND json_type(counts_json) = 'object' AND
    length(CAST(counts_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  expected_policy_versions_json TEXT NOT NULL CHECK (
    json_valid(expected_policy_versions_json) AND
    json_type(expected_policy_versions_json) = 'object' AND
    length(CAST(expected_policy_versions_json AS BLOB)) BETWEEN 2 AND 4096
  ),
  local_combination_upper_bound INTEGER NOT NULL CHECK (
    typeof(local_combination_upper_bound) = 'integer' AND
    local_combination_upper_bound BETWEEN 0 AND 5000
  ),
  deduplication_limit INTEGER NOT NULL CHECK (
    typeof(deduplication_limit) = 'integer' AND deduplication_limit BETWEEN 1 AND 5000
  ),
  estimated_local_writes INTEGER NOT NULL CHECK (
    typeof(estimated_local_writes) = 'integer' AND estimated_local_writes BETWEEN 0 AND 100000
  ),
  estimated_model_requests INTEGER NOT NULL DEFAULT 0 CHECK (estimated_model_requests = 0),
  budget_conclusion TEXT NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK (budget_conclusion = 'NOT_APPLICABLE'),
  model_execution_state TEXT NOT NULL DEFAULT 'UNCONFIGURED_DISABLED'
    CHECK (model_execution_state = 'UNCONFIGURED_DISABLED'),
  status TEXT NOT NULL CHECK (
    status IN ('PREVIEWED', 'CONFIRMED', 'CONSUMED', 'CANCELLED', 'EXPIRED')
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  expires_at TEXT NOT NULL CHECK (expires_at ${UTC_REQUIRED} AND expires_at > created_at),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE topic_generation_plan_inputs (
  plan_id TEXT NOT NULL REFERENCES topic_generation_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  work_id TEXT NOT NULL REFERENCES books(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision > 0),
  dossier_version_id TEXT NOT NULL REFERENCES research_dossier_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  permission_snapshot_id TEXT NOT NULL REFERENCES expression_permission_snapshots(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (plan_id, work_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_generation_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  plan_id TEXT NOT NULL REFERENCES topic_generation_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  execution_id TEXT NOT NULL UNIQUE CHECK (length(execution_id) BETWEEN 1 AND 256),
  job_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'CONFIRMED', 'RUNNING', 'SUCCEEDED', 'NO_OP', 'CANCEL_REQUESTED',
    'CANCELLED', 'FAILED', 'AMBIGUOUS'
  )),
  result_candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(result_candidate_count) = 'integer' AND result_candidate_count BETWEEN 0 AND 5000
  ),
  external_request_count INTEGER NOT NULL DEFAULT 0 CHECK (external_request_count = 0),
  cost_state TEXT NOT NULL DEFAULT 'NOT_INCURRED' CHECK (cost_state = 'NOT_INCURRED'),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE topic_quota_profiles (
  id TEXT PRIMARY KEY CHECK (id = 'FIRST_30_V1'),
  profile_version TEXT NOT NULL CHECK (profile_version = 'FIRST_30_V1'),
  solver_version TEXT NOT NULL CHECK (solver_version = 'topic-quota-solver-v1'),
  total_required INTEGER NOT NULL CHECK (total_required = 30),
  max_work_exposure INTEGER NOT NULL CHECK (
    typeof(max_work_exposure) = 'integer' AND max_work_exposure BETWEEN 1 AND 10
  ),
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE topic_quota_requirements (
  quota_profile_id TEXT NOT NULL REFERENCES topic_quota_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  content_type TEXT NOT NULL CHECK (content_type IN (
    'NON_SPOILER_SINGLE_BOOK_VERDICT',
    'FULL_TRICK_LOGIC_ANALYSIS',
    'CROSS_WORK_COMPARISON',
    'WEB_VS_PUBLISHED_MYSTERY',
    'MYSTERY_AND_CULTURAL_PHENOMENON'
  )),
  required_count INTEGER NOT NULL CHECK (
    typeof(required_count) = 'integer' AND required_count BETWEEN 1 AND 30
  ),
  position INTEGER NOT NULL CHECK (
    typeof(position) = 'integer' AND position BETWEEN 0 AND 4
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (quota_profile_id, content_type),
  UNIQUE (quota_profile_id, position)
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_quota_plan_roots (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  profile_id TEXT NOT NULL REFERENCES account_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  quota_profile_id TEXT NOT NULL REFERENCES topic_quota_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  current_plan_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  UNIQUE (profile_id, quota_profile_id),
  UNIQUE (id, profile_id),
  FOREIGN KEY (current_plan_version_id, id)
    REFERENCES topic_quota_plan_versions(id, root_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE topic_quota_plan_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  root_id TEXT NOT NULL REFERENCES topic_quota_plan_roots(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (
    typeof(version_number) = 'integer' AND version_number > 0
  ),
  previous_version_id TEXT REFERENCES topic_quota_plan_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  quota_profile_id TEXT NOT NULL REFERENCES topic_quota_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  pool_snapshot_hash TEXT NOT NULL CHECK (
    length(pool_snapshot_hash) = 64 AND pool_snapshot_hash NOT GLOB '*[^0-9a-f]*'
  ),
  ranking_policy_version TEXT NOT NULL CHECK (
    ranking_policy_version = 'topic-ranking-policy-v1'
  ),
  solver_version TEXT NOT NULL CHECK (solver_version = 'topic-quota-solver-v1'),
  status TEXT NOT NULL CHECK (status IN ('COMPLETE', 'INCOMPLETE')),
  total_selected INTEGER NOT NULL CHECK (
    typeof(total_selected) = 'integer' AND total_selected BETWEEN 0 AND 100
  ),
  total_required INTEGER NOT NULL CHECK (total_required = 30),
  estimated_cost_state TEXT NOT NULL CHECK (estimated_cost_state IN ('KNOWN', 'UNKNOWN')),
  estimated_cost_microusd INTEGER CHECK (
    estimated_cost_microusd IS NULL OR (
      typeof(estimated_cost_microusd) = 'integer' AND
      estimated_cost_microusd BETWEEN 0 AND 9000000000000
    )
  ),
  workload_state TEXT NOT NULL CHECK (workload_state IN ('KNOWN', 'UNKNOWN')),
  workload_units INTEGER CHECK (
    workload_units IS NULL OR (
      typeof(workload_units) = 'integer' AND workload_units BETWEEN 0 AND 1000000
    )
  ),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND
    length(CAST(reason_codes_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (root_id, version_number),
  UNIQUE (root_id, pool_snapshot_hash),
  UNIQUE (id, root_id),
  CHECK (
    (estimated_cost_state = 'KNOWN' AND estimated_cost_microusd IS NOT NULL) OR
    (estimated_cost_state = 'UNKNOWN' AND estimated_cost_microusd IS NULL)
  ),
  CHECK (
    (workload_state = 'KNOWN' AND workload_units IS NOT NULL) OR
    (workload_state = 'UNKNOWN' AND workload_units IS NULL)
  )
) STRICT;

CREATE TABLE topic_quota_plan_categories (
  plan_version_id TEXT NOT NULL REFERENCES topic_quota_plan_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  content_type TEXT NOT NULL CHECK (content_type IN (
    'NON_SPOILER_SINGLE_BOOK_VERDICT',
    'FULL_TRICK_LOGIC_ANALYSIS',
    'CROSS_WORK_COMPARISON',
    'WEB_VS_PUBLISHED_MYSTERY',
    'MYSTERY_AND_CULTURAL_PHENOMENON'
  )),
  selected_count INTEGER NOT NULL CHECK (selected_count BETWEEN 0 AND 100),
  required_count INTEGER NOT NULL CHECK (required_count BETWEEN 1 AND 30),
  shortfall_count INTEGER NOT NULL CHECK (
    shortfall_count >= 0 AND shortfall_count = max(0, required_count - selected_count)
  ),
  locked_eligible_count INTEGER NOT NULL CHECK (locked_eligible_count BETWEEN 0 AND 10000),
  held_count INTEGER NOT NULL CHECK (held_count BETWEEN 0 AND 10000),
  archived_count INTEGER NOT NULL CHECK (archived_count BETWEEN 0 AND 10000),
  conflicts_json TEXT NOT NULL CHECK (
    json_valid(conflicts_json) AND json_type(conflicts_json) = 'array' AND
    length(CAST(conflicts_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (plan_version_id, content_type)
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_quota_plan_members (
  plan_version_id TEXT NOT NULL REFERENCES topic_quota_plan_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  content_type TEXT NOT NULL CHECK (content_type IN (
    'NON_SPOILER_SINGLE_BOOK_VERDICT',
    'FULL_TRICK_LOGIC_ANALYSIS',
    'CROSS_WORK_COMPARISON',
    'WEB_VS_PUBLISHED_MYSTERY',
    'MYSTERY_AND_CULTURAL_PHENOMENON'
  )),
  position INTEGER NOT NULL CHECK (
    typeof(position) = 'integer' AND position BETWEEN 1 AND 100
  ),
  topic_id TEXT NOT NULL REFERENCES topics(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  topic_version_id TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL CHECK (
    length(semantic_fingerprint) = 64 AND
    semantic_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  eligibility_state TEXT NOT NULL CHECK (eligibility_state = 'ELIGIBLE'),
  total_score_basis_points INTEGER NOT NULL CHECK (
    typeof(total_score_basis_points) = 'integer' AND
    total_score_basis_points BETWEEN 0 AND 10000
  ),
  locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
  selection_reason_codes_json TEXT NOT NULL CHECK (
    json_valid(selection_reason_codes_json) AND
    json_type(selection_reason_codes_json) = 'array' AND
    length(CAST(selection_reason_codes_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (plan_version_id, content_type, position),
  UNIQUE (plan_version_id, topic_id),
  UNIQUE (plan_version_id, semantic_fingerprint),
  FOREIGN KEY (topic_version_id, topic_id)
    REFERENCES topic_candidate_versions(id, topic_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_quota_plan_member_scores (
  plan_version_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  component_type TEXT NOT NULL CHECK (component_type IN (
    'EVIDENCE_SUFFICIENCY', 'CONTENT_FIT', 'DIFFERENTIATION',
    'ESTIMATED_COST', 'APPROVAL_WORKLOAD'
  )),
  knowledge_state TEXT NOT NULL CHECK (knowledge_state IN ('KNOWN', 'UNKNOWN')),
  value_basis_points INTEGER CHECK (
    value_basis_points IS NULL OR (
      typeof(value_basis_points) = 'integer' AND value_basis_points BETWEEN 0 AND 10000
    )
  ),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND
    length(CAST(reason_codes_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (plan_version_id, topic_id, component_type),
  FOREIGN KEY (plan_version_id, topic_id)
    REFERENCES topic_quota_plan_members(plan_version_id, topic_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (
    (knowledge_state = 'KNOWN' AND value_basis_points IS NOT NULL) OR
    (knowledge_state = 'UNKNOWN' AND value_basis_points IS NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE topic_quota_plan_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  plan_version_id TEXT NOT NULL REFERENCES topic_quota_plan_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('PUBLISHED', 'STALE', 'SUPERSEDED')),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 128),
  dependency_type TEXT CHECK (
    dependency_type IS NULL OR dependency_type IN (
      'CATALOG_SUBJECT', 'DOSSIER_VERSION', 'DOSSIER_READINESS',
      'EXPRESSION_PERMISSION', 'AUTHENTICITY_POLICY', 'SPOILER_POLICY',
      'FACT_POLICY', 'CONTEXT_CLAIM', 'TOPIC_POOL', 'TOPIC_POLICY'
    )
  ),
  dependency_id TEXT CHECK (
    dependency_id IS NULL OR length(dependency_id) BETWEEN 1 AND 1024
  ),
  event_identity TEXT NOT NULL UNIQUE CHECK (length(event_identity) BETWEEN 1 AND 1024),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  CHECK ((dependency_type IS NULL) = (dependency_id IS NULL))
) STRICT;

CREATE TABLE topic_quota_plan_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  profile_id TEXT NOT NULL REFERENCES account_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  quota_profile_id TEXT NOT NULL REFERENCES topic_quota_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  execution_id TEXT NOT NULL UNIQUE CHECK (length(execution_id) BETWEEN 1 AND 256),
  job_id TEXT REFERENCES jobs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  pool_snapshot_hash TEXT NOT NULL CHECK (
    length(pool_snapshot_hash) = 64 AND pool_snapshot_hash NOT GLOB '*[^0-9a-f]*'
  ),
  max_work_exposure INTEGER NOT NULL CHECK (
    typeof(max_work_exposure) = 'integer' AND max_work_exposure BETWEEN 1 AND 10
  ),
  total_candidate_count INTEGER NOT NULL CHECK (
    typeof(total_candidate_count) = 'integer' AND total_candidate_count BETWEEN 0 AND 10000
  ),
  status TEXT NOT NULL CHECK (
    status IN ('CONFIRMED', 'RUNNING', 'SUCCEEDED', 'NO_OP', 'CANCELLED', 'FAILED')
  ),
  plan_version_id TEXT REFERENCES topic_quota_plan_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  CHECK (
    (status IN ('SUCCEEDED', 'NO_OP') AND plan_version_id IS NOT NULL) OR
    (status NOT IN ('SUCCEEDED', 'NO_OP') AND plan_version_id IS NULL)
  )
) STRICT;

CREATE TABLE topic_candidate_invalidations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  event_identity TEXT NOT NULL UNIQUE CHECK (length(event_identity) BETWEEN 1 AND 1024),
  topic_id TEXT NOT NULL REFERENCES topics(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES topic_candidate_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'CATALOG_SUBJECT', 'DOSSIER_VERSION', 'DOSSIER_READINESS',
    'EXPRESSION_PERMISSION', 'AUTHENTICITY_POLICY', 'SPOILER_POLICY',
    'FACT_POLICY', 'CONTEXT_CLAIM', 'TOPIC_POOL', 'TOPIC_POLICY'
  )),
  dependency_id TEXT NOT NULL CHECK (length(dependency_id) BETWEEN 1 AND 1024),
  observed_revision TEXT NOT NULL CHECK (length(observed_revision) BETWEEN 1 AND 256),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE topic_audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LEGACY_MIGRATED', 'GENERATION_PREVIEWED', 'GENERATION_CONFIRMED',
    'CANDIDATE_CREATED', 'DUPLICATE_LINKED', 'STATE_CHANGED', 'STATE_UNDONE',
    'PLAN_PREVIEWED', 'PLAN_PUBLISHED', 'PLAN_NO_OP', 'PLAN_STALE',
    'RUN_CANCELLED', 'RUN_FAILED'
  )),
  profile_id TEXT NOT NULL REFERENCES account_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  topic_id TEXT REFERENCES topics(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  generation_plan_id TEXT REFERENCES topic_generation_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  quota_plan_version_id TEXT REFERENCES topic_quota_plan_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('USER', 'LOCAL_SYSTEM', 'MIGRATION')),
  details_json TEXT NOT NULL CHECK (
    json_valid(details_json) AND json_type(details_json) = 'object' AND
    length(CAST(details_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

INSERT INTO topic_candidate_versions (
  id, topic_id, version_number, previous_version_id, schema_version,
  content_type, topic_angle, central_question, candidate_judgment,
  analysis_mode, spoiler_level, spoiler_warning_required, spoiler_warning_placement,
  spoiler_user_confirmation_required, comparison_dimension,
  required_public_labels_json, semantic_fingerprint, fingerprint_policy_version,
  eligibility_state, eligibility_reason_codes_json, eligibility_policy_version,
  ranking_policy_version, total_score_basis_points, ranking_complete, tie_break_key,
  dependency_hash, input_hash, estimated_external_cost_microusd, cost_state,
  approval_workload_units, workload_state, provenance, created_at
)
SELECT
  'legacy-topic-version:' || rowid,
  id,
  1,
  NULL,
  'legacy-topic-v0',
  'LEGACY_UNCLASSIFIED',
  angle,
  angle,
  CASE
    WHEN length(CAST(core_judgment AS BLOB)) <= 1000 THEN core_judgment
    ELSE NULL
  END,
  'LEGACY_UNCLASSIFIED',
  CASE spoiler_level
    WHEN 'NONE' THEN 'NO_SPOILER'
    WHEN 'LIGHT' THEN 'LIGHT_SPOILER'
    ELSE 'FULL_TRICK_ANALYSIS'
  END,
  CASE spoiler_level WHEN 'NONE' THEN 0 ELSE 1 END,
  CASE spoiler_level
    WHEN 'NONE' THEN 'NONE'
    WHEN 'LIGHT' THEN 'BODY_OPENING'
    ELSE 'COVER_TITLE_AND_BODY_OPENING'
  END,
  CASE spoiler_level WHEN 'FULL' THEN 1 ELSE 0 END,
  NULL,
  '[]',
  NULL,
  NULL,
  CASE WHEN status = 'ARCHIVED' THEN 'ARCHIVED' ELSE 'STALE' END,
  '["LEGACY_TOPIC_REQUIRES_REVIEW"]',
  'legacy-topic-v0',
  NULL,
  NULL,
  0,
  NULL,
  lower(hex(randomblob(32))),
  lower(hex(randomblob(32))),
  NULL,
  'UNKNOWN',
  NULL,
  'UNKNOWN',
  'LEGACY_MIGRATION',
  created_at
FROM topics
WHERE topic_contract_version = 'legacy-topic-v0';

INSERT INTO topic_subject_memberships (
  version_id, ordinal, subject_type, subject_id, work_id,
  expression_id, edition_id, role, expression_form, catalog_revision, created_at
)
SELECT
  version.id,
  0,
  'WORK',
  topic.book_id,
  topic.book_id,
  NULL,
  NULL,
  'PRIMARY',
  NULL,
  book.catalog_revision,
  version.created_at
FROM topics AS topic
JOIN topic_candidate_versions AS version
  ON version.topic_id = topic.id AND version.version_number = 1
JOIN books AS book ON book.id = topic.book_id
WHERE topic.topic_contract_version = 'legacy-topic-v0'
  AND topic.book_id IS NOT NULL;

UPDATE topics
SET current_version_number = 1
WHERE topic_contract_version = 'legacy-topic-v0';

INSERT INTO topic_state_transitions (
  id, topic_id, revision, previous_transition_id, from_state, to_state,
  action, expected_revision, actor, details_json, created_at
)
SELECT
  'legacy-topic-transition:' || rowid,
  id,
  1,
  NULL,
  NULL,
  candidate_state,
  'LEGACY_MIGRATION',
  0,
  'MIGRATION',
  '{"result":"FAIL_CLOSED_HELD_OR_ARCHIVED"}',
  created_at
FROM topics
WHERE topic_contract_version = 'legacy-topic-v0';

INSERT INTO topic_audit_events (
  id, event_type, profile_id, topic_id, generation_plan_id,
  quota_plan_version_id, actor, details_json, created_at
)
SELECT
  'legacy-topic-audit:' || rowid,
  'LEGACY_MIGRATED',
  profile_id,
  id,
  NULL,
  NULL,
  'MIGRATION',
  '{"eligibility":"STALE","requiresReview":true}',
  created_at
FROM topics
WHERE topic_contract_version = 'legacy-topic-v0';

INSERT INTO topic_quota_profiles (
  id, profile_version, solver_version, total_required,
  max_work_exposure, immutable, created_at
) VALUES (
  'FIRST_30_V1', 'FIRST_30_V1', 'topic-quota-solver-v1',
  30, 3, 1, ${UTC_NOW}
);

INSERT INTO topic_quota_requirements (
  quota_profile_id, content_type, required_count, position, created_at
) VALUES
  ('FIRST_30_V1', 'NON_SPOILER_SINGLE_BOOK_VERDICT', 10, 0, ${UTC_NOW}),
  ('FIRST_30_V1', 'FULL_TRICK_LOGIC_ANALYSIS', 8, 1, ${UTC_NOW}),
  ('FIRST_30_V1', 'CROSS_WORK_COMPARISON', 6, 2, ${UTC_NOW}),
  ('FIRST_30_V1', 'WEB_VS_PUBLISHED_MYSTERY', 3, 3, ${UTC_NOW}),
  ('FIRST_30_V1', 'MYSTERY_AND_CULTURAL_PHENOMENON', 3, 4, ${UTC_NOW});

CREATE UNIQUE INDEX idx_topics_canonical_fingerprint
  ON topics(profile_id, semantic_fingerprint)
  WHERE topic_contract_version = 'topic-candidate-v1' AND canonical_topic_id IS NULL;
CREATE INDEX idx_topics_pool_page
  ON topics(profile_id, candidate_state, updated_at DESC, id)
  WHERE topic_contract_version = 'topic-candidate-v1';
CREATE INDEX idx_topics_pool_type_state
  ON topics(profile_id, topic_type, candidate_state, updated_at DESC, id)
  WHERE topic_contract_version = 'topic-candidate-v1';
CREATE INDEX idx_topics_duplicate_canonical
  ON topics(canonical_topic_id, updated_at DESC)
  WHERE canonical_topic_id IS NOT NULL;
CREATE INDEX idx_topic_versions_current
  ON topic_candidate_versions(topic_id, version_number DESC, id);
CREATE INDEX idx_topic_versions_eligible_ranking
  ON topic_candidate_versions(
    content_type, eligibility_state, total_score_basis_points DESC, tie_break_key, topic_id
  )
  WHERE schema_version = 'topic-candidate-v1';
CREATE INDEX idx_topic_versions_fingerprint
  ON topic_candidate_versions(semantic_fingerprint, created_at DESC)
  WHERE semantic_fingerprint IS NOT NULL;
CREATE INDEX idx_topic_versions_previous
  ON topic_candidate_versions(previous_version_id)
  WHERE previous_version_id IS NOT NULL;
CREATE INDEX idx_topic_subjects_work
  ON topic_subject_memberships(work_id, version_id, ordinal);
CREATE INDEX idx_topic_subjects_expression
  ON topic_subject_memberships(expression_id, version_id)
  WHERE expression_id IS NOT NULL;
CREATE INDEX idx_topic_subjects_edition
  ON topic_subject_memberships(edition_id, version_id)
  WHERE edition_id IS NOT NULL;
CREATE INDEX idx_topic_context_claims_claim
  ON topic_context_claims(claim_id, version_id);
CREATE INDEX idx_topic_context_claims_work
  ON topic_context_claims(work_id, version_id);
CREATE INDEX idx_topic_ranking_component_page
  ON topic_ranking_components(component_type, knowledge_state, value_basis_points DESC, version_id);
CREATE INDEX idx_topic_dependencies_lookup
  ON topic_dependencies(
    dependency_type, dependency_id, observed_revision, version_id
  );
CREATE INDEX idx_topic_state_history
  ON topic_state_transitions(topic_id, revision DESC, id);
CREATE INDEX idx_topic_state_previous
  ON topic_state_transitions(previous_transition_id)
  WHERE previous_transition_id IS NOT NULL;
CREATE INDEX idx_topic_generation_plans_profile
  ON topic_generation_plans(profile_id, created_at DESC, id);
CREATE INDEX idx_topic_generation_inputs_work
  ON topic_generation_plan_inputs(work_id, plan_id);
CREATE INDEX idx_topic_generation_inputs_dossier
  ON topic_generation_plan_inputs(dossier_version_id, plan_id);
CREATE INDEX idx_topic_generation_inputs_permission
  ON topic_generation_plan_inputs(permission_snapshot_id, plan_id);
CREATE INDEX idx_topic_generation_runs_plan
  ON topic_generation_runs(plan_id, created_at DESC, id);
CREATE INDEX idx_topic_generation_runs_status
  ON topic_generation_runs(status, updated_at, id);
CREATE INDEX idx_topic_generation_runs_job
  ON topic_generation_runs(job_id)
  WHERE job_id IS NOT NULL;
CREATE INDEX idx_research_dossier_build_runs_job
  ON research_dossier_build_runs(job_id)
  WHERE job_id IS NOT NULL;
CREATE INDEX idx_topic_quota_roots_profile
  ON topic_quota_plan_roots(profile_id, quota_profile_id);
CREATE INDEX idx_topic_quota_roots_quota_profile
  ON topic_quota_plan_roots(quota_profile_id, profile_id);
CREATE INDEX idx_topic_quota_roots_current_version
  ON topic_quota_plan_roots(current_plan_version_id)
  WHERE current_plan_version_id IS NOT NULL;
CREATE INDEX idx_topic_quota_versions_history
  ON topic_quota_plan_versions(root_id, version_number DESC, id);
CREATE INDEX idx_topic_quota_versions_previous
  ON topic_quota_plan_versions(previous_version_id)
  WHERE previous_version_id IS NOT NULL;
CREATE INDEX idx_topic_quota_versions_pool
  ON topic_quota_plan_versions(pool_snapshot_hash, created_at DESC, id);
CREATE INDEX idx_topic_quota_versions_quota_profile
  ON topic_quota_plan_versions(quota_profile_id, created_at DESC, id);
CREATE INDEX idx_topic_quota_members_topic
  ON topic_quota_plan_members(topic_id, plan_version_id);
CREATE INDEX idx_topic_quota_members_version
  ON topic_quota_plan_members(topic_version_id, plan_version_id);
CREATE INDEX idx_topic_quota_members_type_position
  ON topic_quota_plan_members(plan_version_id, content_type, position);
CREATE INDEX idx_topic_quota_member_scores_topic
  ON topic_quota_plan_member_scores(topic_id, plan_version_id);
CREATE INDEX idx_topic_quota_events_plan
  ON topic_quota_plan_events(plan_version_id, created_at DESC, id);
CREATE INDEX idx_topic_quota_runs_profile
  ON topic_quota_plan_runs(profile_id, created_at DESC, id);
CREATE INDEX idx_topic_quota_runs_status
  ON topic_quota_plan_runs(status, updated_at, id);
CREATE INDEX idx_topic_quota_runs_quota_profile
  ON topic_quota_plan_runs(quota_profile_id, created_at DESC, id);
CREATE INDEX idx_topic_quota_runs_plan_version
  ON topic_quota_plan_runs(plan_version_id)
  WHERE plan_version_id IS NOT NULL;
CREATE INDEX idx_topic_quota_runs_job
  ON topic_quota_plan_runs(job_id)
  WHERE job_id IS NOT NULL;
CREATE INDEX idx_topic_invalidations_topic
  ON topic_candidate_invalidations(topic_id, created_at DESC, id);
CREATE INDEX idx_topic_invalidations_version
  ON topic_candidate_invalidations(version_id, created_at DESC, id);
CREATE INDEX idx_topic_audit_profile
  ON topic_audit_events(profile_id, created_at DESC, id);
CREATE INDEX idx_topic_audit_topic
  ON topic_audit_events(topic_id, created_at DESC, id)
  WHERE topic_id IS NOT NULL;
CREATE INDEX idx_topic_audit_generation_plan
  ON topic_audit_events(generation_plan_id, created_at DESC, id)
  WHERE generation_plan_id IS NOT NULL;
CREATE INDEX idx_topic_audit_quota_plan
  ON topic_audit_events(quota_plan_version_id, created_at DESC, id)
  WHERE quota_plan_version_id IS NOT NULL;

CREATE TRIGGER topics_issue022_insert_guard
BEFORE INSERT ON topics
WHEN NEW.topic_contract_version = 'topic-candidate-v1'
BEGIN
  SELECT CASE WHEN
    NEW.profile_id IS NULL OR
    NEW.semantic_fingerprint IS NULL OR
    NEW.candidate_state IS NULL OR
    NEW.topic_revision <> 1 OR
    NEW.current_version_number IS NOT NULL OR
    NEW.created_at IS NULL OR NEW.updated_at IS NULL OR
    NEW.status <> 'IDEA' OR
    NEW.trend_score IS NOT NULL OR NEW.fit_score IS NOT NULL OR
    NEW.evidence_score IS NOT NULL OR NEW.novelty_score IS NOT NULL OR
    NEW.effort_score IS NOT NULL OR NEW.priority_score IS NOT NULL
  THEN RAISE(ABORT, 'topic candidate root invariant') END;
END;

CREATE TRIGGER topics_issue022_identity_guard
BEFORE UPDATE OF
  id, topic_contract_version, profile_id, semantic_fingerprint,
  canonical_topic_id, created_at, topic_type, angle, core_judgment,
  audience, spoiler_level, trend_score, fit_score, evidence_score,
  novelty_score, effort_score, priority_score, status
ON topics
WHEN OLD.topic_contract_version = 'topic-candidate-v1'
BEGIN
  SELECT RAISE(ABORT, 'topic candidate identity is immutable');
END;

CREATE TRIGGER topics_issue022_current_version_guard
BEFORE UPDATE OF current_version_number ON topics
WHEN OLD.topic_contract_version = 'topic-candidate-v1'
BEGIN
  SELECT CASE WHEN
    NEW.current_version_number IS NULL OR
    NEW.current_version_number <> COALESCE(OLD.current_version_number, 0) + 1 OR
    NOT EXISTS (
      SELECT 1
      FROM topic_candidate_versions AS version
      WHERE version.topic_id = OLD.id
        AND version.version_number = NEW.current_version_number
    )
  THEN RAISE(ABORT, 'topic current version transition invalid') END;
END;

CREATE TRIGGER topics_issue022_state_guard
BEFORE UPDATE OF candidate_state, topic_revision ON topics
WHEN OLD.topic_contract_version = 'topic-candidate-v1'
BEGIN
  SELECT CASE WHEN
    NEW.topic_revision <> OLD.topic_revision + 1 OR
    NEW.candidate_state = OLD.candidate_state OR
    NOT (
      (OLD.candidate_state = 'PROPOSED' AND NEW.candidate_state IN ('LOCKED', 'HELD', 'ARCHIVED')) OR
      (OLD.candidate_state = 'LOCKED' AND NEW.candidate_state IN ('PROPOSED', 'HELD', 'ARCHIVED')) OR
      (OLD.candidate_state = 'HELD' AND NEW.candidate_state IN ('PROPOSED', 'LOCKED', 'ARCHIVED')) OR
      (OLD.candidate_state = 'ARCHIVED' AND NEW.candidate_state IN ('PROPOSED', 'LOCKED', 'HELD'))
    )
  THEN RAISE(ABORT, 'topic state transition invalid') END;
END;

CREATE TRIGGER topics_issue022_delete_guard
BEFORE DELETE ON topics
WHEN OLD.topic_contract_version = 'topic-candidate-v1'
BEGIN
  SELECT RAISE(ABORT, 'topic candidates cannot be deleted');
END;

CREATE TRIGGER topic_subject_expression_guard
BEFORE INSERT ON topic_subject_memberships
WHEN NEW.subject_type = 'EXPRESSION'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM expressions AS expression
    WHERE expression.id = NEW.expression_id
      AND expression.work_id = NEW.work_id
      AND expression.catalog_state = 'ACTIVE'
      AND expression.revision = NEW.catalog_revision
  ) THEN RAISE(ABORT, 'topic expression subject mismatch') END;
END;

CREATE TRIGGER topic_subject_edition_guard
BEFORE INSERT ON topic_subject_memberships
WHEN NEW.subject_type = 'EDITION'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM book_editions AS edition
    JOIN expressions AS expression ON expression.id = edition.expression_id
    WHERE edition.id = NEW.edition_id
      AND edition.expression_id = NEW.expression_id
      AND expression.work_id = NEW.work_id
      AND edition.catalog_state = 'ACTIVE'
      AND edition.catalog_revision = NEW.catalog_revision
  ) THEN RAISE(ABORT, 'topic edition subject mismatch') END;
END;

CREATE TRIGGER topic_candidate_labels_guard
BEFORE INSERT ON topic_candidate_versions
WHEN NEW.schema_version = 'topic-candidate-v1'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.required_public_labels_json) AS label
    WHERE label.type <> 'text' OR label.value NOT IN ('公开资料整理', '资料分析评分')
  ) THEN RAISE(ABORT, 'topic public label invalid') END;
END;

CREATE TRIGGER topic_candidate_versions_append_only_update
BEFORE UPDATE ON topic_candidate_versions
BEGIN
  SELECT RAISE(ABORT, 'topic candidate versions are append-only');
END;

CREATE TRIGGER topic_candidate_versions_append_only_delete
BEFORE DELETE ON topic_candidate_versions
BEGIN
  SELECT RAISE(ABORT, 'topic candidate versions are append-only');
END;

CREATE TRIGGER topic_subject_memberships_append_only_update
BEFORE UPDATE ON topic_subject_memberships
BEGIN
  SELECT RAISE(ABORT, 'topic subjects are append-only');
END;

CREATE TRIGGER topic_subject_memberships_append_only_delete
BEFORE DELETE ON topic_subject_memberships
BEGIN
  SELECT RAISE(ABORT, 'topic subjects are append-only');
END;

CREATE TRIGGER topic_context_claims_append_only_update
BEFORE UPDATE ON topic_context_claims
BEGIN
  SELECT RAISE(ABORT, 'topic context claims are append-only');
END;

CREATE TRIGGER topic_context_claims_append_only_delete
BEFORE DELETE ON topic_context_claims
BEGIN
  SELECT RAISE(ABORT, 'topic context claims are append-only');
END;

CREATE TRIGGER topic_ranking_components_append_only_update
BEFORE UPDATE ON topic_ranking_components
BEGIN
  SELECT RAISE(ABORT, 'topic ranking components are append-only');
END;

CREATE TRIGGER topic_ranking_components_append_only_delete
BEFORE DELETE ON topic_ranking_components
BEGIN
  SELECT RAISE(ABORT, 'topic ranking components are append-only');
END;

CREATE TRIGGER topic_dependencies_append_only_update
BEFORE UPDATE ON topic_dependencies
BEGIN
  SELECT RAISE(ABORT, 'topic dependencies are append-only');
END;

CREATE TRIGGER topic_dependencies_append_only_delete
BEFORE DELETE ON topic_dependencies
BEGIN
  SELECT RAISE(ABORT, 'topic dependencies are append-only');
END;

CREATE TRIGGER topic_state_transitions_append_only_update
BEFORE UPDATE ON topic_state_transitions
BEGIN
  SELECT RAISE(ABORT, 'topic state transitions are append-only');
END;

CREATE TRIGGER topic_state_transitions_append_only_delete
BEFORE DELETE ON topic_state_transitions
BEGIN
  SELECT RAISE(ABORT, 'topic state transitions are append-only');
END;

CREATE TRIGGER topic_quota_profiles_append_only_update
BEFORE UPDATE ON topic_quota_profiles
BEGIN
  SELECT RAISE(ABORT, 'topic quota profiles are immutable');
END;

CREATE TRIGGER topic_quota_profiles_append_only_delete
BEFORE DELETE ON topic_quota_profiles
BEGIN
  SELECT RAISE(ABORT, 'topic quota profiles are immutable');
END;

CREATE TRIGGER topic_quota_requirements_append_only_update
BEFORE UPDATE ON topic_quota_requirements
BEGIN
  SELECT RAISE(ABORT, 'topic quota requirements are immutable');
END;

CREATE TRIGGER topic_quota_requirements_append_only_delete
BEFORE DELETE ON topic_quota_requirements
BEGIN
  SELECT RAISE(ABORT, 'topic quota requirements are immutable');
END;

CREATE TRIGGER topic_quota_plan_versions_append_only_update
BEFORE UPDATE ON topic_quota_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'topic quota plan versions are append-only');
END;

CREATE TRIGGER topic_quota_plan_versions_append_only_delete
BEFORE DELETE ON topic_quota_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'topic quota plan versions are append-only');
END;

CREATE TRIGGER topic_quota_plan_categories_append_only_update
BEFORE UPDATE ON topic_quota_plan_categories
BEGIN
  SELECT RAISE(ABORT, 'topic quota categories are append-only');
END;

CREATE TRIGGER topic_quota_plan_categories_append_only_delete
BEFORE DELETE ON topic_quota_plan_categories
BEGIN
  SELECT RAISE(ABORT, 'topic quota categories are append-only');
END;

CREATE TRIGGER topic_quota_plan_members_append_only_update
BEFORE UPDATE ON topic_quota_plan_members
BEGIN
  SELECT RAISE(ABORT, 'topic quota members are append-only');
END;

CREATE TRIGGER topic_quota_plan_members_append_only_delete
BEFORE DELETE ON topic_quota_plan_members
BEGIN
  SELECT RAISE(ABORT, 'topic quota members are append-only');
END;

CREATE TRIGGER topic_quota_member_scores_append_only_update
BEFORE UPDATE ON topic_quota_plan_member_scores
BEGIN
  SELECT RAISE(ABORT, 'topic quota score snapshots are append-only');
END;

CREATE TRIGGER topic_quota_member_scores_append_only_delete
BEFORE DELETE ON topic_quota_plan_member_scores
BEGIN
  SELECT RAISE(ABORT, 'topic quota score snapshots are append-only');
END;

CREATE TRIGGER topic_quota_plan_events_append_only_update
BEFORE UPDATE ON topic_quota_plan_events
BEGIN
  SELECT RAISE(ABORT, 'topic quota plan events are append-only');
END;

CREATE TRIGGER topic_quota_plan_events_append_only_delete
BEFORE DELETE ON topic_quota_plan_events
BEGIN
  SELECT RAISE(ABORT, 'topic quota plan events are append-only');
END;

CREATE TRIGGER topic_quota_plan_runs_delete_guard
BEFORE DELETE ON topic_quota_plan_runs
BEGIN
  SELECT RAISE(ABORT, 'topic quota plan runs cannot be deleted');
END;

CREATE TRIGGER topic_candidate_invalidations_append_only_update
BEFORE UPDATE ON topic_candidate_invalidations
BEGIN
  SELECT RAISE(ABORT, 'topic invalidations are append-only');
END;

CREATE TRIGGER topic_candidate_invalidations_append_only_delete
BEFORE DELETE ON topic_candidate_invalidations
BEGIN
  SELECT RAISE(ABORT, 'topic invalidations are append-only');
END;

CREATE TRIGGER topic_audit_events_append_only_update
BEFORE UPDATE ON topic_audit_events
BEGIN
  SELECT RAISE(ABORT, 'topic audit is append-only');
END;

CREATE TRIGGER topic_audit_events_append_only_delete
BEFORE DELETE ON topic_audit_events
BEGIN
  SELECT RAISE(ABORT, 'topic audit is append-only');
END;

CREATE TRIGGER topic_quota_root_current_guard
BEFORE UPDATE OF current_plan_version_id, revision ON topic_quota_plan_roots
BEGIN
  SELECT CASE WHEN
    NEW.current_plan_version_id IS NULL OR
    NEW.revision <> OLD.revision + 1 OR
    NOT EXISTS (
      SELECT 1 FROM topic_quota_plan_versions AS version
      WHERE version.id = NEW.current_plan_version_id AND version.root_id = OLD.id
    )
  THEN RAISE(ABORT, 'topic quota current transition invalid') END;
END;

CREATE TRIGGER topic_generation_plan_state_guard
BEFORE UPDATE OF status, revision ON topic_generation_plans
BEGIN
  SELECT CASE WHEN
    NEW.revision <> OLD.revision + 1 OR
    NOT (
      (OLD.status = 'PREVIEWED' AND NEW.status IN ('CONFIRMED', 'CANCELLED', 'EXPIRED')) OR
      (OLD.status = 'CONFIRMED' AND NEW.status IN ('CONSUMED', 'CANCELLED'))
    )
  THEN RAISE(ABORT, 'topic generation plan transition invalid') END;
END;

CREATE TRIGGER topic_generation_plans_delete_guard
BEFORE DELETE ON topic_generation_plans
BEGIN
  SELECT RAISE(ABORT, 'topic generation plans cannot be deleted');
END;

CREATE TRIGGER topic_generation_runs_delete_guard
BEFORE DELETE ON topic_generation_runs
BEGIN
  SELECT RAISE(ABORT, 'topic generation runs cannot be deleted');
END;

CREATE TRIGGER topic_generation_run_state_guard
BEFORE UPDATE ON topic_generation_runs
BEGIN
  SELECT CASE WHEN
    NEW.revision <> OLD.revision + 1 OR
    NOT (
      (OLD.status = 'CONFIRMED' AND NEW.status = 'CONFIRMED' AND
        OLD.job_id IS NULL AND NEW.job_id IS NOT NULL) OR
      (OLD.status = 'CONFIRMED' AND NEW.status IN ('RUNNING', 'CANCELLED', 'FAILED')) OR
      (OLD.status = 'RUNNING' AND NEW.status IN ('SUCCEEDED', 'NO_OP', 'CANCELLED', 'FAILED')) OR
      (OLD.status = 'CANCEL_REQUESTED' AND NEW.status IN ('CANCELLED', 'FAILED'))
    )
  THEN RAISE(ABORT, 'topic generation run transition invalid') END;
END;

CREATE TRIGGER topic_quota_plan_run_state_guard
BEFORE UPDATE ON topic_quota_plan_runs
BEGIN
  SELECT CASE WHEN
    NEW.revision <> OLD.revision + 1 OR
    NOT (
      (OLD.status = 'CONFIRMED' AND NEW.status = 'CONFIRMED' AND
        OLD.job_id IS NULL AND NEW.job_id IS NOT NULL) OR
      (OLD.status = 'CONFIRMED' AND NEW.status IN ('RUNNING', 'CANCELLED', 'FAILED')) OR
      (OLD.status = 'RUNNING' AND NEW.status IN ('SUCCEEDED', 'NO_OP', 'CANCELLED', 'FAILED'))
    )
  THEN RAISE(ABORT, 'topic quota plan run transition invalid') END;
END;

CREATE TRIGGER topic_quota_plan_roots_delete_guard
BEFORE DELETE ON topic_quota_plan_roots
BEGIN
  SELECT RAISE(ABORT, 'topic quota roots cannot be deleted');
END;

CREATE TRIGGER invalidate_topic_on_dossier_invalidation
AFTER INSERT ON research_dossier_invalidations
BEGIN
  INSERT OR IGNORE INTO topic_candidate_invalidations (
    id, event_identity, topic_id, version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'DOSSIER_INVALIDATED:' || NEW.id || ':' || dependency.version_id,
    version.topic_id,
    dependency.version_id,
    'DOSSIER_VERSION',
    NEW.current_version_id,
    NEW.observed_revision,
    'DOSSIER_CHANGED',
    NEW.created_at
  FROM topic_dependencies AS dependency
  JOIN topic_candidate_versions AS version ON version.id = dependency.version_id
  JOIN topics AS topic
    ON topic.id = version.topic_id AND topic.current_version_number = version.version_number
  WHERE dependency.dependency_type = 'DOSSIER_VERSION'
    AND dependency.dependency_id = NEW.current_version_id;
END;

CREATE TRIGGER invalidate_topic_on_permission_invalidation
AFTER INSERT ON expression_permission_invalidations
BEGIN
  INSERT OR IGNORE INTO topic_candidate_invalidations (
    id, event_identity, topic_id, version_id, dependency_type,
    dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'PERMISSION_INVALIDATED:' || NEW.id || ':' || dependency.version_id,
    version.topic_id,
    dependency.version_id,
    'EXPRESSION_PERMISSION',
    NEW.snapshot_id,
    NEW.observed_revision,
    'AUTHENTICITY_CHANGED',
    NEW.created_at
  FROM topic_dependencies AS dependency
  JOIN topic_candidate_versions AS version ON version.id = dependency.version_id
  JOIN topics AS topic
    ON topic.id = version.topic_id AND topic.current_version_number = version.version_number
  WHERE dependency.dependency_type = 'EXPRESSION_PERMISSION'
    AND dependency.dependency_id = NEW.snapshot_id;
END;

CREATE TRIGGER invalidate_current_quota_on_topic_state
AFTER UPDATE OF candidate_state, topic_revision ON topics
WHEN OLD.topic_contract_version = 'topic-candidate-v1'
  AND NEW.candidate_state <> OLD.candidate_state
BEGIN
  INSERT OR IGNORE INTO topic_quota_plan_events (
    id, plan_version_id, event_type, reason_code,
    dependency_type, dependency_id, event_identity, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    root.current_plan_version_id,
    'STALE',
    'TOPIC_STATE_CHANGED',
    'TOPIC_POOL',
    NEW.id,
    'TOPIC_STATE_CHANGED:' || NEW.id || ':' || NEW.topic_revision || ':' ||
      root.current_plan_version_id,
    NEW.updated_at
  FROM topic_quota_plan_roots AS root
  WHERE root.profile_id = NEW.profile_id
    AND root.current_plan_version_id IS NOT NULL;
END;

CREATE TRIGGER invalidate_current_quota_on_topic_version
AFTER INSERT ON topic_candidate_versions
WHEN NEW.schema_version = 'topic-candidate-v1'
BEGIN
  INSERT OR IGNORE INTO topic_quota_plan_events (
    id, plan_version_id, event_type, reason_code,
    dependency_type, dependency_id, event_identity, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    root.current_plan_version_id,
    'STALE',
    'TOPIC_POOL_CHANGED',
    'TOPIC_POOL',
    NEW.topic_id,
    'TOPIC_POOL_CHANGED:' || NEW.id || ':' || root.current_plan_version_id,
    NEW.created_at
  FROM topic_quota_plan_roots AS root
  JOIN topics AS topic ON topic.id = NEW.topic_id AND topic.profile_id = root.profile_id
  WHERE root.current_plan_version_id IS NOT NULL;
END;

CREATE TRIGGER invalidate_quota_on_candidate_invalidation
AFTER INSERT ON topic_candidate_invalidations
BEGIN
  INSERT OR IGNORE INTO topic_quota_plan_events (
    id, plan_version_id, event_type, reason_code,
    dependency_type, dependency_id, event_identity, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    root.current_plan_version_id,
    'STALE',
    NEW.reason_code,
    NEW.dependency_type,
    NEW.dependency_id,
    'TOPIC_DEPENDENCY_CHANGED:' || NEW.id || ':' || root.current_plan_version_id,
    NEW.created_at
  FROM topics AS topic
  JOIN topic_quota_plan_roots AS root ON root.profile_id = topic.profile_id
  WHERE topic.id = NEW.topic_id
    AND root.current_plan_version_id IS NOT NULL;
END;
`;

const VERSIONED_EXPERIMENT_MANAGEMENT = `
ALTER TABLE experiments ADD COLUMN experiment_contract_version TEXT CHECK (
  experiment_contract_version IS NULL OR
  experiment_contract_version IN ('legacy-experiment-v0', 'experiment-design-v1')
);
ALTER TABLE experiments ADD COLUMN profile_id TEXT
  REFERENCES account_profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE experiments ADD COLUMN experiment_state TEXT CHECK (
  experiment_state IS NULL OR experiment_state IN (
    'DRAFT', 'VALIDATED', 'ASSIGNMENT_READY', 'LOCKED',
    'HELD', 'ARCHIVED', 'SUPERSEDED', 'STALE'
  )
);
ALTER TABLE experiments ADD COLUMN experiment_revision INTEGER CHECK (
  experiment_revision IS NULL OR (
    typeof(experiment_revision) = 'integer' AND experiment_revision > 0
  )
);
ALTER TABLE experiments ADD COLUMN created_at TEXT CHECK (
  created_at IS NULL OR created_at ${UTC_REQUIRED}
);
ALTER TABLE experiments ADD COLUMN updated_at TEXT CHECK (
  updated_at IS NULL OR updated_at ${UTC_REQUIRED}
);

UPDATE experiments
SET
  experiment_contract_version = 'legacy-experiment-v0',
  profile_id = 'primary',
  experiment_state = 'DRAFT',
  experiment_revision = 1,
  created_at = start_at,
  updated_at = start_at
WHERE experiment_contract_version IS NULL;

CREATE TABLE experiment_design_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 1024),
  experiment_id TEXT NOT NULL REFERENCES experiments(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (
    typeof(version_number) = 'integer' AND version_number > 0
  ),
  previous_version_id TEXT REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  schema_version TEXT NOT NULL CHECK (
    schema_version IN ('legacy-experiment-v0', 'experiment-design-v1')
  ),
  design_state TEXT NOT NULL CHECK (design_state IN (
    'DRAFT', 'VALIDATED', 'ASSIGNMENT_READY', 'LOCKED',
    'HELD', 'ARCHIVED', 'SUPERSEDED', 'STALE'
  )),
  design_payload_json TEXT NOT NULL CHECK (
    json_valid(design_payload_json) AND json_type(design_payload_json) = 'object' AND
    length(CAST(design_payload_json AS BLOB)) BETWEEN 2 AND 262144
  ),
  hypothesis_json TEXT NOT NULL CHECK (
    json_valid(hypothesis_json) AND json_type(hypothesis_json) = 'object' AND
    length(CAST(hypothesis_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  primary_variable_kind TEXT CHECK (
    primary_variable_kind IS NULL OR primary_variable_kind IN (
      'CONTENT_STRUCTURE', 'TITLE_PATTERN', 'COVER_INFORMATION_DENSITY',
      'SPOILER_MODE', 'COMPARISON_FORMAT', 'PUBLICATION_TIME_WINDOW'
    )
  ),
  primary_metric_id TEXT CHECK (
    primary_metric_id IS NULL OR primary_metric_id IN (
      'SAVE_RATE', 'COMMENT_RATE', 'FOLLOW_CONVERSION_RATE',
      'ENGAGEMENT_RATE', 'PROFILE_VISIT_RATE',
      'APPROVAL_WORK_UNITS', 'FACT_BLOCK_RATE'
    )
  ),
  sample_plan_json TEXT NOT NULL CHECK (
    json_valid(sample_plan_json) AND json_type(sample_plan_json) = 'object' AND
    length(CAST(sample_plan_json AS BLOB)) BETWEEN 2 AND 65536
  ),
  stratification_plan_json TEXT NOT NULL CHECK (
    json_valid(stratification_plan_json) AND
    json_type(stratification_plan_json) = 'object' AND
    length(CAST(stratification_plan_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  quota_plan_version_id TEXT REFERENCES topic_quota_plan_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  structure_fingerprint TEXT CHECK (
    structure_fingerprint IS NULL OR (
      length(structure_fingerprint) = 64 AND
      structure_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  ),
  variable_registry_version TEXT NOT NULL CHECK (
    length(variable_registry_version) BETWEEN 1 AND 128
  ),
  metric_registry_version TEXT NOT NULL CHECK (
    length(metric_registry_version) BETWEEN 1 AND 128
  ),
  assignment_policy_version TEXT NOT NULL CHECK (
    length(assignment_policy_version) BETWEEN 1 AND 128
  ),
  popularity_policy_version TEXT NOT NULL CHECK (
    length(popularity_policy_version) BETWEEN 1 AND 128
  ),
  replication_policy_version TEXT NOT NULL CHECK (
    length(replication_policy_version) BETWEEN 1 AND 128
  ),
  dependency_hash TEXT NOT NULL CHECK (
    length(dependency_hash) = 64 AND dependency_hash NOT GLOB '*[^0-9a-f]*'
  ),
  design_hash TEXT NOT NULL CHECK (
    length(design_hash) = 64 AND design_hash NOT GLOB '*[^0-9a-f]*'
  ),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(warnings_json) AND json_type(warnings_json) = 'array' AND
    length(CAST(warnings_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(reasons_json) AND json_type(reasons_json) = 'array' AND
    length(CAST(reasons_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  locked_at TEXT CHECK (locked_at ${UTC_OPTIONAL} locked_at ${UTC_REQUIRED}),
  archived_at TEXT CHECK (archived_at ${UTC_OPTIONAL} archived_at ${UTC_REQUIRED}),
  UNIQUE (experiment_id, version_number),
  UNIQUE (id, experiment_id),
  CHECK (
    (schema_version = 'legacy-experiment-v0' AND
      primary_variable_kind IS NULL AND primary_metric_id IS NULL AND
      structure_fingerprint IS NULL) OR
    (schema_version = 'experiment-design-v1' AND
      primary_variable_kind IS NOT NULL AND primary_metric_id IS NOT NULL AND
      structure_fingerprint IS NOT NULL)
  )
) STRICT;

CREATE TABLE experiment_primary_variables (
  design_version_id TEXT PRIMARY KEY REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  variable_kind TEXT NOT NULL CHECK (variable_kind IN (
    'CONTENT_STRUCTURE', 'TITLE_PATTERN', 'COVER_INFORMATION_DENSITY',
    'SPOILER_MODE', 'COMPARISON_FORMAT', 'PUBLICATION_TIME_WINDOW'
  )),
  registry_version TEXT NOT NULL CHECK (length(registry_version) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE experiment_arms (
  design_version_id TEXT NOT NULL REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  arm_id TEXT NOT NULL CHECK (length(arm_id) BETWEEN 1 AND 256),
  role TEXT NOT NULL CHECK (role IN ('CONTROL', 'TREATMENT')),
  value_identity TEXT NOT NULL CHECK (length(value_identity) BETWEEN 1 AND 256),
  label TEXT NOT NULL CHECK (length(CAST(label AS BLOB)) BETWEEN 1 AND 1024),
  changed_dimensions_json TEXT NOT NULL CHECK (
    json_valid(changed_dimensions_json) AND
    json_type(changed_dimensions_json) = 'array' AND
    json_array_length(changed_dimensions_json) = 1 AND
    length(CAST(changed_dimensions_json AS BLOB)) BETWEEN 3 AND 512
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (design_version_id, arm_id),
  UNIQUE (design_version_id, value_identity)
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX idx_experiment_arms_one_control
  ON experiment_arms(design_version_id)
  WHERE role = 'CONTROL';

CREATE TABLE experiment_controlled_conditions (
  design_version_id TEXT NOT NULL REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  condition_kind TEXT NOT NULL CHECK (condition_kind IN (
    'CONTENT_STRUCTURE', 'TITLE_PATTERN', 'COVER_INFORMATION_DENSITY',
    'SPOILER_MODE', 'COMPARISON_FORMAT', 'PUBLICATION_TIME_WINDOW',
    'TOPIC_CONTENT_TYPE', 'ANALYSIS_MODE', 'WORK_POPULARITY_STRATUM'
  )),
  value_identity TEXT NOT NULL CHECK (length(value_identity) BETWEEN 1 AND 256),
  availability TEXT NOT NULL CHECK (
    availability IN ('FIXED', 'FUTURE_NOT_IMPLEMENTED')
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (design_version_id, condition_kind)
) STRICT, WITHOUT ROWID;

CREATE TABLE experiment_primary_metrics (
  design_version_id TEXT PRIMARY KEY REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  metric_id TEXT NOT NULL CHECK (metric_id IN (
    'SAVE_RATE', 'COMMENT_RATE', 'FOLLOW_CONVERSION_RATE',
    'ENGAGEMENT_RATE', 'PROFILE_VISIT_RATE',
    'APPROVAL_WORK_UNITS', 'FACT_BLOCK_RATE'
  )),
  metric_spec_json TEXT NOT NULL CHECK (
    json_valid(metric_spec_json) AND json_type(metric_spec_json) = 'object' AND
    length(CAST(metric_spec_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  availability TEXT NOT NULL CHECK (
    availability IN (
      'DEFINED_NOT_AVAILABLE', 'AVAILABLE_FOR_FUTURE_COLLECTION', 'UNSUPPORTED'
    )
  ),
  registry_version TEXT NOT NULL CHECK (length(registry_version) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE experiment_guardrails (
  design_version_id TEXT NOT NULL REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  metric_id TEXT NOT NULL CHECK (metric_id IN (
    'SAVE_RATE', 'COMMENT_RATE', 'FOLLOW_CONVERSION_RATE',
    'ENGAGEMENT_RATE', 'PROFILE_VISIT_RATE',
    'APPROVAL_WORK_UNITS', 'FACT_BLOCK_RATE'
  )),
  metric_spec_json TEXT NOT NULL CHECK (
    json_valid(metric_spec_json) AND json_type(metric_spec_json) = 'object' AND
    length(CAST(metric_spec_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  guardrail_direction TEXT NOT NULL CHECK (
    guardrail_direction IN ('NOT_INCREASE', 'NOT_DECREASE', 'LIMIT')
  ),
  violation_condition TEXT NOT NULL CHECK (
    length(CAST(violation_condition AS BLOB)) BETWEEN 1 AND 4096
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (design_version_id, metric_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE experiment_replication_structures (
  design_version_id TEXT PRIMARY KEY REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  structure_identity TEXT NOT NULL CHECK (length(structure_identity) BETWEEN 1 AND 256),
  structure_version TEXT NOT NULL CHECK (length(structure_version) BETWEEN 1 AND 128),
  content_type TEXT NOT NULL CHECK (content_type IN (
    'NON_SPOILER_SINGLE_BOOK_VERDICT', 'FULL_TRICK_LOGIC_ANALYSIS',
    'CROSS_WORK_COMPARISON', 'WEB_VS_PUBLISHED_MYSTERY',
    'MYSTERY_AND_CULTURAL_PHENOMENON'
  )),
  analysis_mode TEXT NOT NULL CHECK (analysis_mode IN ('PERSONAL', 'PUBLIC_RESEARCH')),
  spoiler_level TEXT NOT NULL CHECK (
    spoiler_level IN ('NO_SPOILER', 'LIGHT_SPOILER', 'FULL_TRICK_ANALYSIS')
  ),
  comparison_dimension TEXT CHECK (
    comparison_dimension IS NULL OR length(comparison_dimension) BETWEEN 1 AND 128
  ),
  structural_slots_json TEXT NOT NULL CHECK (
    json_valid(structural_slots_json) AND json_type(structural_slots_json) = 'array' AND
    json_array_length(structural_slots_json) BETWEEN 1 AND 16
  ),
  required_labels_json TEXT NOT NULL CHECK (
    json_valid(required_labels_json) AND json_type(required_labels_json) = 'array' AND
    json_array_length(required_labels_json) BETWEEN 0 AND 16
  ),
  semantic_fingerprint TEXT NOT NULL CHECK (
    length(semantic_fingerprint) = 64 AND
    semantic_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE experiment_sample_plans (
  design_version_id TEXT PRIMARY KEY REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  assignment_unit TEXT NOT NULL CHECK (assignment_unit = 'TOPIC_CANDIDATE'),
  target_topic_ids_json TEXT NOT NULL CHECK (
    json_valid(target_topic_ids_json) AND json_type(target_topic_ids_json) = 'array' AND
    json_array_length(target_topic_ids_json) BETWEEN 0 AND 500
  ),
  inclusion_rules_json TEXT NOT NULL CHECK (
    json_valid(inclusion_rules_json) AND json_type(inclusion_rules_json) = 'array'
  ),
  exclusion_rules_json TEXT NOT NULL CHECK (
    json_valid(exclusion_rules_json) AND json_type(exclusion_rules_json) = 'array'
  ),
  arm_target_counts_json TEXT NOT NULL CHECK (
    json_valid(arm_target_counts_json) AND json_type(arm_target_counts_json) = 'object'
  ),
  minimum_distinct_work_count INTEGER NOT NULL CHECK (
    typeof(minimum_distinct_work_count) = 'integer' AND
    minimum_distinct_work_count BETWEEN 3 AND 100
  ),
  max_topics_per_work INTEGER NOT NULL CHECK (
    typeof(max_topics_per_work) = 'integer' AND max_topics_per_work BETWEEN 1 AND 10
  ),
  deterministic_seed TEXT NOT NULL CHECK (length(deterministic_seed) BETWEEN 1 AND 256),
  blocking_keys_json TEXT NOT NULL CHECK (
    json_valid(blocking_keys_json) AND json_type(blocking_keys_json) = 'array'
  ),
  quota_plan_version_id TEXT REFERENCES topic_quota_plan_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE experiment_popularity_snapshots (
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 256),
  design_version_id TEXT NOT NULL REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  work_id TEXT NOT NULL REFERENCES books(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  stratum TEXT NOT NULL CHECK (stratum IN ('HOT', 'WARM', 'COLD', 'UNKNOWN')),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN (
      'NOT_AVAILABLE', 'USER_CONFIRMED_SYNTHETIC', 'USER_CONFIRMED_OBSERVATION'
    )
  ),
  availability TEXT NOT NULL CHECK (
    availability IN ('AVAILABLE', 'UNAVAILABLE', 'STALE_REVIEW_REQUIRED')
  ),
  confidence TEXT NOT NULL CHECK (confidence IN ('CONFIRMED', 'UNAVAILABLE')),
  observed_at TEXT CHECK (observed_at ${UTC_OPTIONAL} observed_at ${UTC_REQUIRED}),
  window_start TEXT CHECK (window_start ${UTC_OPTIONAL} window_start ${UTC_REQUIRED}),
  window_end TEXT CHECK (window_end ${UTC_OPTIONAL} window_end ${UTC_REQUIRED}),
  metric_reference TEXT CHECK (
    metric_reference IS NULL OR length(CAST(metric_reference AS BLOB)) BETWEEN 1 AND 4096
  ),
  provenance_json TEXT NOT NULL CHECK (
    json_valid(provenance_json) AND json_type(provenance_json) = 'array' AND
    length(CAST(provenance_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (id, design_version_id),
  UNIQUE (id, design_version_id, work_id),
  UNIQUE (design_version_id, work_id),
  CHECK (
    (stratum = 'UNKNOWN' AND source_kind = 'NOT_AVAILABLE' AND
      availability = 'UNAVAILABLE' AND confidence = 'UNAVAILABLE' AND
      observed_at IS NULL AND window_start IS NULL AND window_end IS NULL AND
      metric_reference IS NULL) OR
    (stratum <> 'UNKNOWN' AND source_kind <> 'NOT_AVAILABLE' AND
      availability = 'AVAILABLE' AND confidence = 'CONFIRMED' AND
      observed_at IS NOT NULL AND window_start IS NOT NULL AND
      window_end IS NOT NULL AND metric_reference IS NOT NULL)
  ),
  CHECK (window_end IS NULL OR window_start IS NULL OR window_end >= window_start)
) STRICT, WITHOUT ROWID;

CREATE TABLE experiment_assignment_plans (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  experiment_id TEXT NOT NULL REFERENCES experiments(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  design_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (
    typeof(version_number) = 'integer' AND version_number > 0
  ),
  previous_version_id TEXT REFERENCES experiment_assignment_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  input_hash TEXT NOT NULL CHECK (
    length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'
  ),
  assignment_hash TEXT NOT NULL CHECK (
    length(assignment_hash) = 64 AND assignment_hash NOT GLOB '*[^0-9a-f]*'
  ),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 128),
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT', 'INSUFFICIENT_SAMPLE', 'INSUFFICIENT_REPLICATION',
    'UNBALANCED', 'READY_TO_LOCK', 'STALE'
  )),
  arm_counts_json TEXT NOT NULL CHECK (
    json_valid(arm_counts_json) AND json_type(arm_counts_json) = 'object'
  ),
  imbalance_json TEXT NOT NULL CHECK (
    json_valid(imbalance_json) AND json_type(imbalance_json) = 'object'
  ),
  shortfall_json TEXT NOT NULL CHECK (
    json_valid(shortfall_json) AND json_type(shortfall_json) = 'object'
  ),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND
    length(CAST(reason_codes_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  distinct_work_count INTEGER NOT NULL CHECK (
    typeof(distinct_work_count) = 'integer' AND distinct_work_count BETWEEN 0 AND 500
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  locked_at TEXT CHECK (locked_at ${UTC_OPTIONAL} locked_at ${UTC_REQUIRED}),
  UNIQUE (experiment_id, version_number),
  UNIQUE (design_version_id, input_hash),
  UNIQUE (id, design_version_id),
  FOREIGN KEY (design_version_id, experiment_id)
    REFERENCES experiment_design_versions(id, experiment_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE experiment_assignment_units (
  assignment_plan_id TEXT NOT NULL REFERENCES experiment_assignment_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  design_version_id TEXT NOT NULL,
  assignment_order INTEGER NOT NULL CHECK (
    typeof(assignment_order) = 'integer' AND assignment_order BETWEEN 1 AND 500
  ),
  topic_id TEXT NOT NULL REFERENCES topics(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  topic_version_id TEXT NOT NULL,
  work_id TEXT NOT NULL REFERENCES books(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  arm_id TEXT NOT NULL,
  popularity_snapshot_id TEXT NOT NULL,
  popularity_stratum TEXT NOT NULL CHECK (
    popularity_stratum IN ('HOT', 'WARM', 'COLD', 'UNKNOWN')
  ),
  structure_fingerprint TEXT NOT NULL CHECK (
    length(structure_fingerprint) = 64 AND
    structure_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  blocking_key TEXT NOT NULL CHECK (
    length(CAST(blocking_key AS BLOB)) BETWEEN 1 AND 4096
  ),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND
    length(CAST(reason_codes_json AS BLOB)) BETWEEN 2 AND 8192
  ),
  dependency_versions_json TEXT NOT NULL CHECK (
    json_valid(dependency_versions_json) AND
    json_type(dependency_versions_json) = 'object' AND
    length(CAST(dependency_versions_json AS BLOB)) BETWEEN 2 AND 16384
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  PRIMARY KEY (assignment_plan_id, assignment_order),
  UNIQUE (assignment_plan_id, topic_id),
  FOREIGN KEY (assignment_plan_id, design_version_id)
    REFERENCES experiment_assignment_plans(id, design_version_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (topic_version_id, topic_id)
    REFERENCES topic_candidate_versions(id, topic_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (design_version_id, arm_id)
    REFERENCES experiment_arms(design_version_id, arm_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (popularity_snapshot_id, design_version_id, work_id)
    REFERENCES experiment_popularity_snapshots(id, design_version_id, work_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TABLE experiment_current_designs (
  experiment_id TEXT PRIMARY KEY REFERENCES experiments(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  design_version_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  FOREIGN KEY (design_version_id, experiment_id)
    REFERENCES experiment_design_versions(id, experiment_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE experiment_current_assignments (
  design_version_id TEXT PRIMARY KEY REFERENCES experiment_design_versions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  assignment_plan_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED}),
  FOREIGN KEY (assignment_plan_id, design_version_id)
    REFERENCES experiment_assignment_plans(id, design_version_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE experiment_dependencies (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  experiment_id TEXT NOT NULL REFERENCES experiments(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  design_version_id TEXT NOT NULL,
  assignment_plan_id TEXT REFERENCES experiment_assignment_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'TOPIC_VERSION', 'TOPIC_STATE', 'TOPIC_ELIGIBILITY', 'TOPIC_QUOTA_PLAN',
    'WORK_IDENTITY', 'DOSSIER_VERSION', 'EXPRESSION_PERMISSION', 'REPLICATION_STRUCTURE',
    'VARIABLE_POLICY', 'METRIC_POLICY', 'ASSIGNMENT_POLICY',
    'POPULARITY_POLICY', 'POPULARITY_SNAPSHOT', 'EXPERIMENT_DESIGN'
  )),
  dependency_id TEXT NOT NULL CHECK (length(dependency_id) BETWEEN 1 AND 1024),
  observed_revision TEXT NOT NULL CHECK (length(observed_revision) BETWEEN 1 AND 256),
  dependency_key TEXT NOT NULL CHECK (
    length(dependency_key) = 64 AND dependency_key NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (design_version_id, dependency_key),
  FOREIGN KEY (design_version_id, experiment_id)
    REFERENCES experiment_design_versions(id, experiment_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE experiment_invalidations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  event_identity TEXT NOT NULL UNIQUE CHECK (length(event_identity) BETWEEN 1 AND 2048),
  experiment_id TEXT NOT NULL REFERENCES experiments(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  design_version_id TEXT NOT NULL,
  assignment_plan_id TEXT REFERENCES experiment_assignment_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN (
    'TOPIC_VERSION', 'TOPIC_STATE', 'TOPIC_ELIGIBILITY', 'TOPIC_QUOTA_PLAN',
    'WORK_IDENTITY', 'DOSSIER_VERSION', 'EXPRESSION_PERMISSION', 'REPLICATION_STRUCTURE',
    'VARIABLE_POLICY', 'METRIC_POLICY', 'ASSIGNMENT_POLICY',
    'POPULARITY_POLICY', 'POPULARITY_SNAPSHOT', 'EXPERIMENT_DESIGN'
  )),
  dependency_id TEXT NOT NULL CHECK (length(dependency_id) BETWEEN 1 AND 1024),
  observed_revision TEXT NOT NULL CHECK (length(observed_revision) BETWEEN 1 AND 256),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  FOREIGN KEY (design_version_id, experiment_id)
    REFERENCES experiment_design_versions(id, experiment_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE experiment_state_transitions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  experiment_id TEXT NOT NULL REFERENCES experiments(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  design_version_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  previous_transition_id TEXT REFERENCES experiment_state_transitions(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  from_state TEXT CHECK (
    from_state IS NULL OR from_state IN (
      'DRAFT', 'VALIDATED', 'ASSIGNMENT_READY', 'LOCKED',
      'HELD', 'ARCHIVED', 'SUPERSEDED', 'STALE'
    )
  ),
  to_state TEXT NOT NULL CHECK (to_state IN (
    'DRAFT', 'VALIDATED', 'ASSIGNMENT_READY', 'LOCKED',
    'HELD', 'ARCHIVED', 'SUPERSEDED', 'STALE'
  )),
  action TEXT NOT NULL CHECK (action IN (
    'CREATE', 'VALIDATE', 'ASSIGNMENT_READY', 'LOCK', 'HOLD',
    'RESUME', 'CLONE', 'ARCHIVE', 'RESTORE', 'INVALIDATE', 'LEGACY_MIGRATION'
  )),
  expected_revision INTEGER NOT NULL CHECK (
    typeof(expected_revision) = 'integer' AND expected_revision >= 0
  ),
  actor TEXT NOT NULL CHECK (actor IN ('USER', 'LOCAL_SYSTEM', 'MIGRATION')),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (experiment_id, revision),
  FOREIGN KEY (design_version_id, experiment_id)
    REFERENCES experiment_design_versions(id, experiment_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE experiment_audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  event_identity TEXT NOT NULL UNIQUE CHECK (length(event_identity) BETWEEN 1 AND 2048),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LEGACY_MIGRATED', 'DRAFT_CREATED', 'DESIGN_VALIDATED',
    'ASSIGNMENT_PREVIEWED', 'ASSIGNMENT_SAVED', 'DESIGN_LOCKED',
    'STATE_CHANGED', 'VERSION_CLONED', 'DEPENDENCY_INVALIDATED'
  )),
  experiment_id TEXT NOT NULL REFERENCES experiments(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  design_version_id TEXT NOT NULL,
  assignment_plan_id TEXT REFERENCES experiment_assignment_plans(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('USER', 'LOCAL_SYSTEM', 'MIGRATION')),
  details_json TEXT NOT NULL CHECK (
    json_valid(details_json) AND json_type(details_json) = 'object' AND
    length(CAST(details_json AS BLOB)) BETWEEN 2 AND 32768
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  FOREIGN KEY (design_version_id, experiment_id)
    REFERENCES experiment_design_versions(id, experiment_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

CREATE TABLE experiment_policy_registry (
  policy_kind TEXT PRIMARY KEY CHECK (policy_kind IN (
    'REPLICATION_STRUCTURE', 'VARIABLE_POLICY', 'METRIC_POLICY',
    'ASSIGNMENT_POLICY', 'POPULARITY_POLICY'
  )),
  current_version TEXT NOT NULL CHECK (length(current_version) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision > 0
  ),
  updated_at TEXT NOT NULL CHECK (updated_at ${UTC_REQUIRED})
) STRICT;

CREATE TABLE experiment_policy_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  policy_kind TEXT NOT NULL CHECK (policy_kind IN (
    'REPLICATION_STRUCTURE', 'VARIABLE_POLICY', 'METRIC_POLICY',
    'ASSIGNMENT_POLICY', 'POPULARITY_POLICY'
  )),
  from_version TEXT NOT NULL CHECK (length(from_version) BETWEEN 1 AND 128),
  to_version TEXT NOT NULL CHECK (length(to_version) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision > 1
  ),
  created_at TEXT NOT NULL CHECK (created_at ${UTC_REQUIRED}),
  UNIQUE (policy_kind, revision)
) STRICT;

INSERT INTO experiment_policy_registry (
  policy_kind, current_version, revision, updated_at
) VALUES
  ('REPLICATION_STRUCTURE', 'experiment-replication-policy-v1', 1, ${UTC_NOW}),
  ('VARIABLE_POLICY', 'experiment-variable-registry-v1', 1, ${UTC_NOW}),
  ('METRIC_POLICY', 'experiment-metric-registry-v1', 1, ${UTC_NOW}),
  ('ASSIGNMENT_POLICY', 'experiment-assignment-policy-v1', 1, ${UTC_NOW}),
  ('POPULARITY_POLICY', 'work-popularity-stratum-v1', 1, ${UTC_NOW});

INSERT INTO experiment_design_versions (
  id, experiment_id, version_number, schema_version, design_state,
  design_payload_json, hypothesis_json, sample_plan_json, stratification_plan_json,
  variable_registry_version, metric_registry_version, assignment_policy_version,
  popularity_policy_version, replication_policy_version,
  dependency_hash, design_hash, warnings_json, reasons_json, created_at
)
SELECT
  lower(hex(randomblob(16))),
  id,
  1,
  'legacy-experiment-v0',
  'DRAFT',
  json_object(
    'name', name,
    'hypothesis', hypothesis,
    'primaryMetric', primary_metric,
    'guardrailMetrics', json(guardrail_metrics_json),
    'variableName', variable_name,
    'variants', json(variants_json),
    'startAt', start_at,
    'endAt', end_at,
    'legacyStatus', status
  ),
  json_object('legacyText', hypothesis),
  json_object('legacyUnvalidated', 1),
  json_object('legacyUnvalidated', 1),
  'legacy-unvalidated',
  'legacy-unvalidated',
  'legacy-unvalidated',
  'legacy-unvalidated',
  'legacy-unvalidated',
  lower(hex(randomblob(32))),
  lower(hex(randomblob(32))),
  json_array('LEGACY_REVIEW_REQUIRED'),
  json_array('NOT_VALIDATED'),
  start_at
FROM experiments
WHERE experiment_contract_version = 'legacy-experiment-v0';

INSERT INTO experiment_current_designs (
  experiment_id, design_version_id, revision, updated_at
)
SELECT experiment_id, id, 1, created_at
FROM experiment_design_versions
WHERE schema_version = 'legacy-experiment-v0';

INSERT INTO experiment_state_transitions (
  id, experiment_id, design_version_id, revision, from_state, to_state,
  action, expected_revision, actor, reason_code, created_at
)
SELECT
  lower(hex(randomblob(16))),
  experiment_id,
  id,
  1,
  NULL,
  'DRAFT',
  'LEGACY_MIGRATION',
  0,
  'MIGRATION',
  'LEGACY_REVIEW_REQUIRED',
  created_at
FROM experiment_design_versions
WHERE schema_version = 'legacy-experiment-v0';

INSERT INTO experiment_audit_events (
  id, event_identity, event_type, experiment_id, design_version_id,
  actor, details_json, created_at
)
SELECT
  lower(hex(randomblob(16))),
  'LEGACY_MIGRATED:' || experiment_id || ':' || id,
  'LEGACY_MIGRATED',
  experiment_id,
  id,
  'MIGRATION',
  json_object('state', 'DRAFT', 'requiresReview', 1),
  created_at
FROM experiment_design_versions
WHERE schema_version = 'legacy-experiment-v0';

CREATE TRIGGER experiments_v1_required_insert
BEFORE INSERT ON experiments
WHEN NEW.experiment_contract_version = 'experiment-design-v1' AND (
  NEW.profile_id IS NULL OR NEW.experiment_state IS NULL OR
  NEW.experiment_revision IS NULL OR NEW.created_at IS NULL OR NEW.updated_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'experiment v1 root fields required');
END;

CREATE TRIGGER experiments_v1_required_update
BEFORE UPDATE ON experiments
WHEN NEW.experiment_contract_version = 'experiment-design-v1' AND (
  NEW.profile_id IS NULL OR NEW.experiment_state IS NULL OR
  NEW.experiment_revision IS NULL OR NEW.created_at IS NULL OR NEW.updated_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'experiment v1 root fields required');
END;

CREATE TRIGGER experiment_current_design_complete_insert
BEFORE INSERT ON experiment_current_designs
WHEN (
  SELECT schema_version FROM experiment_design_versions
  WHERE id = NEW.design_version_id
) = 'experiment-design-v1' AND (
  (SELECT count(*) FROM experiment_primary_variables
   WHERE design_version_id = NEW.design_version_id) <> 1 OR
  (SELECT count(*) FROM experiment_primary_metrics
   WHERE design_version_id = NEW.design_version_id) <> 1 OR
  (SELECT count(*) FROM experiment_replication_structures
   WHERE design_version_id = NEW.design_version_id) <> 1 OR
  (SELECT count(*) FROM experiment_sample_plans
   WHERE design_version_id = NEW.design_version_id) <> 1 OR
  (SELECT count(*) FROM experiment_arms
   WHERE design_version_id = NEW.design_version_id) NOT BETWEEN 2 AND 6 OR
  (SELECT count(*) FROM experiment_arms
   WHERE design_version_id = NEW.design_version_id AND role = 'CONTROL') <> 1 OR
  EXISTS (
    SELECT 1
    FROM experiment_primary_variables AS variable
    JOIN experiment_design_versions AS design
      ON design.id = variable.design_version_id
    WHERE variable.design_version_id = NEW.design_version_id
      AND variable.variable_kind <> design.primary_variable_kind
  ) OR
  EXISTS (
    SELECT 1
    FROM experiment_primary_metrics AS metric
    JOIN experiment_design_versions AS design
      ON design.id = metric.design_version_id
    WHERE metric.design_version_id = NEW.design_version_id
      AND metric.metric_id <> design.primary_metric_id
  ) OR
  EXISTS (
    SELECT 1
    FROM experiment_arms AS arm
    JOIN experiment_primary_variables AS variable
      ON variable.design_version_id = arm.design_version_id
    WHERE arm.design_version_id = NEW.design_version_id
      AND json_extract(arm.changed_dimensions_json, '$[0]') <> variable.variable_kind
  )
)
BEGIN
  SELECT RAISE(ABORT, 'experiment design incomplete');
END;

CREATE TRIGGER experiment_current_design_complete_update
BEFORE UPDATE OF design_version_id ON experiment_current_designs
WHEN (
  SELECT schema_version FROM experiment_design_versions
  WHERE id = NEW.design_version_id
) = 'experiment-design-v1' AND (
  (SELECT count(*) FROM experiment_primary_variables
   WHERE design_version_id = NEW.design_version_id) <> 1 OR
  (SELECT count(*) FROM experiment_primary_metrics
   WHERE design_version_id = NEW.design_version_id) <> 1 OR
  (SELECT count(*) FROM experiment_replication_structures
   WHERE design_version_id = NEW.design_version_id) <> 1 OR
  (SELECT count(*) FROM experiment_sample_plans
   WHERE design_version_id = NEW.design_version_id) <> 1 OR
  (SELECT count(*) FROM experiment_arms
   WHERE design_version_id = NEW.design_version_id) NOT BETWEEN 2 AND 6 OR
  (SELECT count(*) FROM experiment_arms
   WHERE design_version_id = NEW.design_version_id AND role = 'CONTROL') <> 1 OR
  EXISTS (
    SELECT 1
    FROM experiment_primary_variables AS variable
    JOIN experiment_design_versions AS design
      ON design.id = variable.design_version_id
    WHERE variable.design_version_id = NEW.design_version_id
      AND variable.variable_kind <> design.primary_variable_kind
  ) OR
  EXISTS (
    SELECT 1
    FROM experiment_primary_metrics AS metric
    JOIN experiment_design_versions AS design
      ON design.id = metric.design_version_id
    WHERE metric.design_version_id = NEW.design_version_id
      AND metric.metric_id <> design.primary_metric_id
  ) OR
  EXISTS (
    SELECT 1
    FROM experiment_arms AS arm
    JOIN experiment_primary_variables AS variable
      ON variable.design_version_id = arm.design_version_id
    WHERE arm.design_version_id = NEW.design_version_id
      AND json_extract(arm.changed_dimensions_json, '$[0]') <> variable.variable_kind
  )
)
BEGIN
  SELECT RAISE(ABORT, 'experiment design incomplete');
END;

CREATE TRIGGER experiment_guardrail_not_primary_insert
BEFORE INSERT ON experiment_guardrails
WHEN EXISTS (
  SELECT 1 FROM experiment_primary_metrics AS metric
  WHERE metric.design_version_id = NEW.design_version_id
    AND metric.metric_id = NEW.metric_id
)
BEGIN
  SELECT RAISE(ABORT, 'guardrail cannot duplicate primary metric');
END;

CREATE TRIGGER experiment_primary_not_guardrail_insert
BEFORE INSERT ON experiment_primary_metrics
WHEN EXISTS (
  SELECT 1 FROM experiment_guardrails AS guardrail
  WHERE guardrail.design_version_id = NEW.design_version_id
    AND guardrail.metric_id = NEW.metric_id
)
BEGIN
  SELECT RAISE(ABORT, 'primary metric cannot duplicate guardrail');
END;

CREATE TRIGGER experiment_arm_matches_primary_insert
BEFORE INSERT ON experiment_arms
WHEN json_extract(NEW.changed_dimensions_json, '$[0]') <> (
  SELECT variable_kind FROM experiment_primary_variables
  WHERE design_version_id = NEW.design_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'arm changes more than the primary variable');
END;

CREATE TRIGGER experiment_invalidate_on_topic_change
AFTER UPDATE OF current_version_number, candidate_state, topic_revision ON topics
WHEN
  NEW.current_version_number <> OLD.current_version_number OR
  NEW.candidate_state <> OLD.candidate_state OR
  NEW.topic_revision <> OLD.topic_revision
BEGIN
  INSERT OR IGNORE INTO experiment_invalidations (
    id, event_identity, experiment_id, design_version_id, assignment_plan_id,
    dependency_type, dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'TOPIC_CHANGED:' || NEW.id || ':' || NEW.topic_revision || ':' || dependency.id,
    dependency.experiment_id,
    dependency.design_version_id,
    dependency.assignment_plan_id,
    dependency.dependency_type,
    NEW.id,
    CAST(NEW.topic_revision AS TEXT),
    'TOPIC_CHANGED',
    NEW.updated_at
  FROM experiment_dependencies AS dependency
  JOIN experiment_current_designs AS current
    ON current.design_version_id = dependency.design_version_id
  WHERE dependency.dependency_type IN (
      'TOPIC_VERSION', 'TOPIC_STATE', 'TOPIC_ELIGIBILITY'
    )
    AND dependency.dependency_id = NEW.id;
END;

CREATE TRIGGER experiment_invalidate_on_topic_dependency
AFTER INSERT ON topic_candidate_invalidations
BEGIN
  INSERT OR IGNORE INTO experiment_invalidations (
    id, event_identity, experiment_id, design_version_id, assignment_plan_id,
    dependency_type, dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'TOPIC_DEPENDENCY_CHANGED:' || NEW.id || ':' || dependency.id,
    dependency.experiment_id,
    dependency.design_version_id,
    dependency.assignment_plan_id,
    dependency.dependency_type,
    NEW.topic_id,
    NEW.observed_revision,
    'TOPIC_DEPENDENCY_CHANGED',
    NEW.created_at
  FROM experiment_dependencies AS dependency
  JOIN experiment_current_designs AS current
    ON current.design_version_id = dependency.design_version_id
  WHERE dependency.dependency_type IN (
      'TOPIC_VERSION', 'TOPIC_STATE', 'TOPIC_ELIGIBILITY'
    )
    AND dependency.dependency_id = NEW.topic_id;
END;

CREATE TRIGGER experiment_invalidate_on_quota_change
AFTER UPDATE OF current_plan_version_id, revision ON topic_quota_plan_roots
WHEN
  NEW.revision <> OLD.revision OR
  NEW.current_plan_version_id IS NOT OLD.current_plan_version_id
BEGIN
  INSERT OR IGNORE INTO experiment_invalidations (
    id, event_identity, experiment_id, design_version_id, assignment_plan_id,
    dependency_type, dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'QUOTA_CHANGED:' || NEW.id || ':' || NEW.revision || ':' || dependency.id,
    dependency.experiment_id,
    dependency.design_version_id,
    dependency.assignment_plan_id,
    'TOPIC_QUOTA_PLAN',
    dependency.dependency_id,
    CAST(NEW.revision AS TEXT),
    'QUOTA_PLAN_CHANGED',
    NEW.updated_at
  FROM experiment_dependencies AS dependency
  JOIN experiment_current_designs AS current
    ON current.design_version_id = dependency.design_version_id
  WHERE dependency.dependency_type = 'TOPIC_QUOTA_PLAN'
    AND dependency.dependency_id = OLD.current_plan_version_id;
END;

CREATE TRIGGER experiment_invalidate_on_work_change
AFTER UPDATE OF catalog_revision, catalog_state ON books
WHEN NEW.catalog_revision <> OLD.catalog_revision OR NEW.catalog_state <> OLD.catalog_state
BEGIN
  INSERT OR IGNORE INTO experiment_invalidations (
    id, event_identity, experiment_id, design_version_id, assignment_plan_id,
    dependency_type, dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'WORK_CHANGED:' || NEW.id || ':' || NEW.catalog_revision || ':' || dependency.id,
    dependency.experiment_id,
    dependency.design_version_id,
    dependency.assignment_plan_id,
    'WORK_IDENTITY',
    NEW.id,
    CAST(NEW.catalog_revision AS TEXT),
    'WORK_IDENTITY_CHANGED',
    NEW.updated_at
  FROM experiment_dependencies AS dependency
  JOIN experiment_current_designs AS current
    ON current.design_version_id = dependency.design_version_id
  WHERE dependency.dependency_type = 'WORK_IDENTITY'
    AND dependency.dependency_id = NEW.id;
END;

CREATE TRIGGER experiment_invalidate_on_dossier
AFTER INSERT ON research_dossier_invalidations
BEGIN
  INSERT OR IGNORE INTO experiment_invalidations (
    id, event_identity, experiment_id, design_version_id, assignment_plan_id,
    dependency_type, dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'DOSSIER_CHANGED:' || NEW.id || ':' || dependency.id,
    dependency.experiment_id,
    dependency.design_version_id,
    dependency.assignment_plan_id,
    'DOSSIER_VERSION',
    dependency.dependency_id,
    NEW.observed_revision,
    'DOSSIER_CHANGED',
    NEW.created_at
  FROM experiment_dependencies AS dependency
  JOIN experiment_current_designs AS current
    ON current.design_version_id = dependency.design_version_id
  WHERE dependency.dependency_type = 'DOSSIER_VERSION'
    AND dependency.dependency_id = NEW.current_version_id;
END;

CREATE TRIGGER experiment_invalidate_on_permission
AFTER INSERT ON expression_permission_invalidations
BEGIN
  INSERT OR IGNORE INTO experiment_invalidations (
    id, event_identity, experiment_id, design_version_id, assignment_plan_id,
    dependency_type, dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'PERMISSION_CHANGED:' || NEW.id || ':' || dependency.id,
    dependency.experiment_id,
    dependency.design_version_id,
    dependency.assignment_plan_id,
    'EXPRESSION_PERMISSION',
    dependency.dependency_id,
    NEW.observed_revision,
    'EXPRESSION_PERMISSION_CHANGED',
    NEW.created_at
  FROM experiment_dependencies AS dependency
  JOIN experiment_current_designs AS current
    ON current.design_version_id = dependency.design_version_id
  WHERE dependency.dependency_type = 'EXPRESSION_PERMISSION'
    AND dependency.dependency_id = NEW.snapshot_id;
END;

CREATE TRIGGER experiment_invalidate_on_popularity
AFTER INSERT ON experiment_popularity_snapshots
BEGIN
  INSERT OR IGNORE INTO experiment_invalidations (
    id, event_identity, experiment_id, design_version_id, assignment_plan_id,
    dependency_type, dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'POPULARITY_CHANGED:' || NEW.id || ':' || dependency.id,
    dependency.experiment_id,
    dependency.design_version_id,
    dependency.assignment_plan_id,
    'POPULARITY_SNAPSHOT',
    dependency.dependency_id,
    NEW.id,
    'POPULARITY_STRATUM_CHANGED',
    NEW.created_at
  FROM experiment_dependencies AS dependency
  JOIN experiment_popularity_snapshots AS previous
    ON previous.id = dependency.dependency_id
  JOIN experiment_current_designs AS current
    ON current.design_version_id = dependency.design_version_id
  WHERE dependency.dependency_type = 'POPULARITY_SNAPSHOT'
    AND previous.work_id = NEW.work_id
    AND previous.id <> NEW.id;
END;

CREATE TRIGGER experiment_policy_registry_audit
AFTER UPDATE OF current_version, revision ON experiment_policy_registry
WHEN NEW.current_version <> OLD.current_version AND NEW.revision = OLD.revision + 1
BEGIN
  INSERT INTO experiment_policy_events (
    id, policy_kind, from_version, to_version, revision, created_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.policy_kind,
    OLD.current_version,
    NEW.current_version,
    NEW.revision,
    NEW.updated_at
  );

  INSERT OR IGNORE INTO experiment_invalidations (
    id, event_identity, experiment_id, design_version_id, assignment_plan_id,
    dependency_type, dependency_id, observed_revision, reason_code, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    'POLICY_CHANGED:' || NEW.policy_kind || ':' || NEW.revision || ':' || dependency.id,
    dependency.experiment_id,
    dependency.design_version_id,
    dependency.assignment_plan_id,
    dependency.dependency_type,
    dependency.dependency_id,
    NEW.current_version,
    'POLICY_VERSION_CHANGED',
    NEW.updated_at
  FROM experiment_dependencies AS dependency
  JOIN experiment_current_designs AS current
    ON current.design_version_id = dependency.design_version_id
  WHERE dependency.dependency_type = NEW.policy_kind
    AND dependency.dependency_id = OLD.current_version;
END;

CREATE TRIGGER experiment_policy_registry_revision_guard
BEFORE UPDATE ON experiment_policy_registry
WHEN
  NEW.current_version = OLD.current_version OR
  NEW.revision <> OLD.revision + 1 OR
  NEW.policy_kind <> OLD.policy_kind
BEGIN
  SELECT RAISE(ABORT, 'invalid experiment policy revision');
END;

CREATE INDEX idx_experiments_profile_state_updated
  ON experiments(profile_id, experiment_state, updated_at DESC, id);
CREATE INDEX idx_experiment_design_history
  ON experiment_design_versions(experiment_id, version_number DESC);
CREATE INDEX idx_experiment_design_status
  ON experiment_design_versions(design_state, created_at DESC);
CREATE INDEX idx_experiment_assignment_status
  ON experiment_assignment_plans(experiment_id, status, created_at DESC);
CREATE INDEX idx_experiment_assignment_topic
  ON experiment_assignment_units(topic_id, topic_version_id, assignment_plan_id);
CREATE INDEX idx_experiment_assignment_work_stratum
  ON experiment_assignment_units(work_id, popularity_stratum, assignment_plan_id);
CREATE INDEX idx_experiment_dependency_lookup
  ON experiment_dependencies(dependency_type, dependency_id, design_version_id);
CREATE INDEX idx_experiment_dependency_assignment
  ON experiment_dependencies(assignment_plan_id, dependency_type);
CREATE INDEX idx_experiment_invalidation_design
  ON experiment_invalidations(design_version_id, created_at DESC);
CREATE INDEX idx_experiment_invalidation_dependency
  ON experiment_invalidations(dependency_type, dependency_id, created_at DESC);
CREATE INDEX idx_experiment_transition_history
  ON experiment_state_transitions(experiment_id, revision DESC);
CREATE INDEX idx_experiment_popularity_work
  ON experiment_popularity_snapshots(work_id, stratum, created_at DESC);

CREATE TRIGGER experiment_design_versions_immutable_update
BEFORE UPDATE ON experiment_design_versions
BEGIN SELECT RAISE(ABORT, 'experiment design history is immutable'); END;
CREATE TRIGGER experiment_design_versions_immutable_delete
BEFORE DELETE ON experiment_design_versions
BEGIN SELECT RAISE(ABORT, 'experiment design history is immutable'); END;
CREATE TRIGGER experiment_assignment_plans_immutable_update
BEFORE UPDATE ON experiment_assignment_plans
BEGIN SELECT RAISE(ABORT, 'experiment assignment history is immutable'); END;
CREATE TRIGGER experiment_assignment_plans_immutable_delete
BEFORE DELETE ON experiment_assignment_plans
BEGIN SELECT RAISE(ABORT, 'experiment assignment history is immutable'); END;
CREATE TRIGGER experiment_assignment_units_immutable_update
BEFORE UPDATE ON experiment_assignment_units
BEGIN SELECT RAISE(ABORT, 'experiment assignment units are immutable'); END;
CREATE TRIGGER experiment_assignment_units_immutable_delete
BEFORE DELETE ON experiment_assignment_units
BEGIN SELECT RAISE(ABORT, 'experiment assignment units are immutable'); END;
CREATE TRIGGER experiment_state_transitions_immutable_update
BEFORE UPDATE ON experiment_state_transitions
BEGIN SELECT RAISE(ABORT, 'experiment transitions are immutable'); END;
CREATE TRIGGER experiment_state_transitions_immutable_delete
BEFORE DELETE ON experiment_state_transitions
BEGIN SELECT RAISE(ABORT, 'experiment transitions are immutable'); END;
CREATE TRIGGER experiment_audit_events_immutable_update
BEFORE UPDATE ON experiment_audit_events
BEGIN SELECT RAISE(ABORT, 'experiment audit is immutable'); END;
CREATE TRIGGER experiment_audit_events_immutable_delete
BEFORE DELETE ON experiment_audit_events
BEGIN SELECT RAISE(ABORT, 'experiment audit is immutable'); END;
CREATE TRIGGER experiment_dependencies_immutable_update
BEFORE UPDATE ON experiment_dependencies
BEGIN SELECT RAISE(ABORT, 'experiment dependencies are immutable'); END;
CREATE TRIGGER experiment_dependencies_immutable_delete
BEFORE DELETE ON experiment_dependencies
BEGIN SELECT RAISE(ABORT, 'experiment dependencies are immutable'); END;
CREATE TRIGGER experiment_invalidations_immutable_update
BEFORE UPDATE ON experiment_invalidations
BEGIN SELECT RAISE(ABORT, 'experiment invalidations are immutable'); END;
CREATE TRIGGER experiment_invalidations_immutable_delete
BEFORE DELETE ON experiment_invalidations
BEGIN SELECT RAISE(ABORT, 'experiment invalidations are immutable'); END;
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
  Object.freeze({
    foreignKeysDisabled: true,
    name: 'model_execution_cache_and_cost_ledger',
    sql: MODEL_EXECUTION_CACHE_AND_COST_LEDGER,
    version: 7,
  }),
  Object.freeze({
    name: 'search_provider_runs_and_rate_limits',
    sql: SEARCH_PROVIDER_RUNS_AND_RATE_LIMITS,
    version: 8,
  }),
  Object.freeze({
    name: 'controlled_public_page_fetch',
    sql: CONTROLLED_PUBLIC_PAGE_FETCH,
    version: 9,
  }),
  Object.freeze({
    name: 'browser_clipper_samples',
    sql: BROWSER_CLIPPER_SAMPLES,
    version: 10,
  }),
  Object.freeze({
    foreignKeysDisabled: true,
    name: 'bibliographic_catalog_and_entity_resolution',
    sql: BIBLIOGRAPHIC_CATALOG,
    version: 11,
  }),
  Object.freeze({
    foreignKeysDisabled: true,
    name: 'source_evidence_atomic_facts_and_conflicts',
    sql: SOURCE_EVIDENCE_AND_FACT_CONFLICTS,
    version: 12,
  }),
  Object.freeze({
    foreignKeysDisabled: true,
    name: 'versioned_research_dossiers',
    sql: VERSIONED_RESEARCH_DOSSIERS,
    version: 13,
  }),
  Object.freeze({
    foreignKeysDisabled: true,
    name: 'reading_authenticity_policy',
    sql: READING_AUTHENTICITY_POLICY,
    version: 14,
  }),
  Object.freeze({
    name: 'topic_pool_and_first_30_quota',
    sql: TOPIC_POOL_AND_FIRST_30_QUOTA,
    version: 15,
  }),
  Object.freeze({
    name: 'versioned_experiment_management',
    sql: VERSIONED_EXPERIMENT_MANAGEMENT,
    version: 16,
  }),
]);
