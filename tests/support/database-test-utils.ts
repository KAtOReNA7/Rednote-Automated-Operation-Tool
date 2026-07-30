import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { connectDatabase, initializeDatabase } from '../../packages/db/src/index.js';

export const BUSINESS_TABLE_NAMES = [
  'account_profiles',
  'app_settings',
  'approvals',
  'assets',
  'audit_events',
  'authors',
  'book_editions',
  'books',
  'claim_evidence',
  'claims',
  'clips',
  'content_briefs',
  'cost_ledger',
  'drafts',
  'experience_assertion_revisions',
  'experience_assertions',
  'experiments',
  'jobs',
  'metric_snapshots',
  'model_runs',
  'expression_permission_dependencies',
  'expression_permission_invalidations',
  'expression_permission_snapshots',
  'personal_score_records',
  'post_packages',
  'publications',
  'quality_checks',
  'reading_authenticity_audit_events',
  'reading_spoiler_preference_revisions',
  'reading_spoiler_preferences',
  'reading_state_revisions',
  'reading_states',
  'research_analysis_score_records',
  'research_dossier_audit_events',
  'research_dossier_build_plans',
  'research_dossier_build_runs',
  'research_dossier_coverage_snapshots',
  'research_dossier_dependencies',
  'research_dossier_entries',
  'research_dossier_entry_claims',
  'research_dossier_entry_evaluations',
  'research_dossier_entry_evidence',
  'research_dossier_gap_claims',
  'research_dossier_gaps',
  'research_dossier_invalidations',
  'research_dossier_sections',
  'research_dossier_versions',
  'research_dossiers',
  'sources',
  'strategy_decisions',
  'system_prediction_scores',
  'topic_audit_events',
  'topic_candidate_invalidations',
  'topic_candidate_versions',
  'topic_context_claims',
  'topic_dependencies',
  'topic_generation_plan_inputs',
  'topic_generation_plans',
  'topic_generation_runs',
  'topic_quota_plan_categories',
  'topic_quota_plan_events',
  'topic_quota_plan_member_scores',
  'topic_quota_plan_members',
  'topic_quota_plan_roots',
  'topic_quota_plan_runs',
  'topic_quota_plan_versions',
  'topic_quota_profiles',
  'topic_quota_requirements',
  'topic_ranking_components',
  'topic_state_transitions',
  'topic_subject_memberships',
  'topics',
] as const;

const createdTemporaryDirectories = new Set<string>();

export function createTemporaryDatabasePath(childDirectory = 'database files'): string {
  const root = mkdtempSync(join(tmpdir(), 'rednote-db-test-'));
  createdTemporaryDirectories.add(root);
  const directory = join(root, childDirectory);
  mkdirSync(directory, { recursive: true });
  return join(directory, 'content.sqlite');
}

export async function createInitializedDatabase(
  childDirectory?: string,
): Promise<{ readonly database: DatabaseSync; readonly databasePath: string }> {
  const databasePath = createTemporaryDatabasePath(childDirectory);
  await initializeDatabase({ databasePath });
  return { database: connectDatabase(databasePath), databasePath };
}

export function cleanTemporaryDatabases(): void {
  const realTemporaryRoot = realpathSync(tmpdir());

  for (const directory of createdTemporaryDirectories) {
    const resolvedDirectory = resolve(directory);
    const pathFromTemporaryRoot = relative(realTemporaryRoot, resolvedDirectory);
    const isInsideTemporaryRoot =
      pathFromTemporaryRoot.length > 0 &&
      !pathFromTemporaryRoot.startsWith('..') &&
      !isAbsolute(pathFromTemporaryRoot);

    if (!isInsideTemporaryRoot) {
      throw new Error(`Refusing to remove unsafe test directory: ${resolvedDirectory}`);
    }

    rmSync(resolvedDirectory, { force: true, recursive: true });
  }

  createdTemporaryDirectories.clear();
}

export function insertMinimalDraft(database: DatabaseSync, suffix = '1'): string {
  const topicId = `topic-${suffix}`;
  const briefId = `brief-${suffix}`;
  const draftId = `draft-${suffix}`;

  database
    .prepare(
      `INSERT INTO topics(
         id, topic_type, angle, core_judgment, audience, spoiler_level, status
       ) VALUES (?, 'BOOK_NOTE', 'angle', 'judgment', 'reader', 'NONE', 'IDEA')`,
    )
    .run(topicId);
  database
    .prepare(
      `INSERT INTO content_briefs(
         id, topic_id, content_type, target_reader, core_judgment, spoiler_level,
         score_type, status
       ) VALUES (?, ?, 'ANALYSIS', 'reader', 'judgment', 'NONE',
                 'RESEARCH_ANALYSIS', 'RESEARCH_READY')`,
    )
    .run(briefId, topicId);
  database
    .prepare(
      `INSERT INTO drafts(id, brief_id, version, title, body, status)
       VALUES (?, ?, 1, 'title', 'body', 'APPROVAL_READY')`,
    )
    .run(draftId, briefId);

  return draftId;
}
