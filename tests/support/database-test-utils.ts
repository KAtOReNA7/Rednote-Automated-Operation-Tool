import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { connectDatabase, initializeDatabase } from '../../packages/db/src/index.js';

export const BUSINESS_TABLE_NAMES = [
  'account_profiles',
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
  'experiments',
  'jobs',
  'metric_snapshots',
  'model_runs',
  'post_packages',
  'publications',
  'quality_checks',
  'reading_states',
  'research_dossiers',
  'sources',
  'strategy_decisions',
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
