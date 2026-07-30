import { afterEach, describe, expect, it } from 'vitest';

import { SqliteAuthenticityRepository, SqliteTopicRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { insertTopicReadyWork } from './support/topic-fixtures.js';

afterEach(cleanTemporaryDatabases);

const TOPIC_COLUMNS = [
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
] as const;

const VERSION_COLUMNS = [
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
] as const;

type SqlValue = bigint | number | string | null | Uint8Array;

function values(
  row: Readonly<Record<string, unknown>>,
  columns: readonly string[],
): readonly SqlValue[] {
  return columns.map((column) => row[column] as SqlValue);
}

describe('M3 Issue 022 Topic capacity and query plans', () => {
  it('pages a 10,000-candidate pool with bounded DTOs and indexed top-N, fingerprint, and dependency lookups', async () => {
    const { database } = await createInitializedDatabase('topic capacity 中文 空格');
    try {
      const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
      insertTopicReadyWork(database, authenticity, { workId: 'topic-capacity-work' });
      const repository = new SqliteTopicRepository(database, () => crypto.randomUUID());
      repository.confirmGeneration(
        repository.previewGeneration('primary', '2026-07-30T11:00:00.000Z'),
        'topic-capacity-generation',
        '2026-07-30T11:00:01.000Z',
      );
      const seedTopic = database
        .prepare(
          `SELECT * FROM topics
           WHERE topic_contract_version = 'topic-candidate-v1'
           LIMIT 1`,
        )
        .get() as Readonly<Record<string, unknown>>;
      const seedVersion = database
        .prepare(
          `SELECT * FROM topic_candidate_versions
           WHERE schema_version = 'topic-candidate-v1'
           LIMIT 1`,
        )
        .get() as Readonly<Record<string, unknown>>;
      const insertTopic = database.prepare(
        `INSERT INTO topics(${TOPIC_COLUMNS.join(',')})
         VALUES (${TOPIC_COLUMNS.map(() => '?').join(',')})`,
      );
      const insertVersion = database.prepare(
        `INSERT INTO topic_candidate_versions(${VERSION_COLUMNS.join(',')})
         VALUES (${VERSION_COLUMNS.map(() => '?').join(',')})`,
      );

      database.exec('BEGIN IMMEDIATE');
      try {
        for (let index = 1; index < 10_000; index += 1) {
          const suffix = index.toString().padStart(5, '0');
          const fingerprint = index.toString(16).padStart(64, '0');
          insertTopic.run(
            ...values(
              {
                ...seedTopic,
                canonical_topic_id: null,
                current_version_number: null,
                id: `topic-capacity-${suffix}`,
                semantic_fingerprint: fingerprint,
                topic_revision: 1,
              },
              TOPIC_COLUMNS,
            ),
          );
          insertVersion.run(
            ...values(
              {
                ...seedVersion,
                dependency_hash: fingerprint,
                id: `topic-version-capacity-${suffix}`,
                input_hash: fingerprint,
                previous_version_id: null,
                semantic_fingerprint: fingerprint,
                tie_break_key: fingerprint,
                topic_id: `topic-capacity-${suffix}`,
                version_number: 1,
              },
              VERSION_COLUMNS,
            ),
          );
        }
        database
          .prepare(
            `UPDATE topics
             SET current_version_number = 1
             WHERE topic_contract_version = 'topic-candidate-v1'
               AND current_version_number IS NULL`,
          )
          .run();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }

      const page = repository.listPool('primary', {
        contentType: null,
        eligibility: null,
        limit: 100,
        offset: 9_900,
        query: '',
        state: null,
      });
      expect(page).toMatchObject({ limit: 100, offset: 9_900, total: 10_000 });
      expect(page.items).toHaveLength(100);
      expect(JSON.stringify(page).length).toBeLessThan(250_000);
      expect(() =>
        repository.listPool('primary', {
          contentType: null,
          eligibility: null,
          limit: 101,
          offset: 0,
          query: '',
          state: null,
        }),
      ).toThrow(/TOPIC_INVALID_REQUEST/iu);

      const plans = [
        database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT id FROM topics
             WHERE topic_contract_version = 'topic-candidate-v1'
               AND profile_id = 'primary'
               AND candidate_state = 'PROPOSED'
             ORDER BY updated_at DESC, id
             LIMIT 100`,
          )
          .all(),
        database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT id FROM topics
             WHERE topic_contract_version = 'topic-candidate-v1'
               AND profile_id = 'primary'
               AND canonical_topic_id IS NULL
               AND semantic_fingerprint = ?`,
          )
          .all('f'.repeat(64)),
        database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT topic_id FROM topic_candidate_versions
             WHERE schema_version = 'topic-candidate-v1'
               AND content_type = 'NON_SPOILER_SINGLE_BOOK_VERDICT'
               AND eligibility_state = 'ELIGIBLE'
             ORDER BY total_score_basis_points DESC, tie_break_key
             LIMIT 30`,
          )
          .all(),
        database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT version_id FROM topic_dependencies
             WHERE dependency_type = 'TOPIC_POLICY'
               AND dependency_id = 'topic-eligibility-policy-v1'
               AND observed_revision = 'topic-eligibility-policy-v1'`,
          )
          .all(),
      ]
        .flat()
        .map((row) => (row as { readonly detail: string }).detail)
        .join('\n');
      expect(plans).toContain('idx_topics_pool_page');
      expect(plans).toContain('idx_topics_canonical_fingerprint');
      expect(plans).toContain('idx_topic_versions_eligible_ranking');
      expect(plans).toContain('idx_topic_dependencies_lookup');
    } finally {
      database.close();
    }
  }, 45_000);
});
