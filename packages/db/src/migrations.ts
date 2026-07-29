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
]);
