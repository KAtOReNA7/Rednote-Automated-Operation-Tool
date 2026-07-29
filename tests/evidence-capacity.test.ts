import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 019 evidence query capacity', () => {
  it('uses the fact-key index and stable pagination without an all-pairs comparison', async () => {
    const { database } = await createInitializedDatabase();
    try {
      database
        .prepare(
          `INSERT INTO books(id, canonical_title, work_type, discovery_status)
           VALUES ('work-capacity', '容量作品', 'MYSTERY', 'DISCOVERED')`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO fact_subjects(subject_type, subject_id, work_id)
           VALUES ('WORK', 'work-capacity', 'work-capacity')`,
        )
        .run();
      const insert = database.prepare(
        `INSERT INTO claims(
           id, contract_version, subject_type, subject_id, predicate, value_type,
           value_json, normalized_value, scope_json, normalized_scope_hash,
           policy_version, key_fact, semantic_fingerprint, status,
           provenance_json, created_at
         ) VALUES (
           ?, 'atomic-claim-v1', 'WORK', 'work-capacity', 'publication_date',
           'DATE_WITH_PRECISION',
           ?, ?, '{}',
           '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
           'fact-policy-v1', 1, ?, 'ACTIVE',
           '{"kind":"MANUAL","runId":null}', '2026-07-29T02:00:00.000Z'
         )`,
      );
      database.exec('BEGIN IMMEDIATE');
      try {
        for (let index = 0; index < 10_000; index += 1) {
          const date = `20${String(index % 100).padStart(2, '0')}`;
          const value = JSON.stringify({ precision: 'YEAR', value: date });
          insert.run(
            `claim-capacity-${String(index).padStart(5, '0')}`,
            value,
            value,
            index.toString(16).padStart(64, '0'),
          );
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      const plan = database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id
           FROM claims
           WHERE subject_type = 'WORK' AND subject_id = 'work-capacity'
             AND predicate = 'publication_date'
             AND normalized_scope_hash =
               '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
             AND policy_version = 'fact-policy-v1'
           ORDER BY id
           LIMIT 25 OFFSET 5000`,
        )
        .all() as unknown as readonly { readonly detail: string }[];
      expect(plan.some((row) => row.detail.includes('idx_claims_fact_key'))).toBe(true);
      const page = database
        .prepare(
          `SELECT id FROM claims
           WHERE subject_type = 'WORK' AND subject_id = 'work-capacity'
             AND predicate = 'publication_date'
             AND normalized_scope_hash =
               '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
           ORDER BY id LIMIT 25 OFFSET 5000`,
        )
        .all() as unknown as readonly { readonly id: string }[];
      expect(page).toHaveLength(25);
      expect(page[0]?.id).toBe('claim-capacity-05000');
      expect(database.prepare('SELECT count(*) AS count FROM fact_conflicts').get()).toEqual({
        count: 0,
      });
    } finally {
      database.close();
    }
  }, 30_000);
});
