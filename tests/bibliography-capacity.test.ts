import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 018 generated catalog capacity', () => {
  it('handles 10,000 Work with larger child/provenance cardinalities using indexed pagination', async () => {
    const { database } = await createInitializedDatabase('capacity 规模');
    try {
      database.exec(`
          BEGIN IMMEDIATE;

          WITH RECURSIVE seq(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 10000
          )
          INSERT INTO books(
            id, canonical_title, work_type, discovery_status, catalog_state, catalog_revision
          )
          SELECT
            'work-capacity-' || printf('%05d', n),
            'Synthetic Capacity Work ' || printf('%05d', n),
            'MYSTERY',
            'SYNTHETIC_CAPACITY',
            'ACTIVE',
            1
          FROM seq;

          WITH RECURSIVE seq(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 20000
          )
          INSERT INTO expressions(
            id, work_id, expression_kind, canonical_title, normalized_title,
            language, catalog_state, revision
          )
          SELECT
            'expression-capacity-' || printf('%05d', n),
            'work-capacity-' || printf('%05d', ((n - 1) % 10000) + 1),
            CASE WHEN n <= 10000 THEN 'ORIGINAL' ELSE 'TRANSLATION' END,
            'Synthetic Expression ' || printf('%05d', n),
            'synthetic expression ' || printf('%05d', n),
            CASE WHEN n <= 10000 THEN 'ja' ELSE 'zh-CN' END,
            'ACTIVE',
            1
          FROM seq;

          WITH RECURSIVE seq(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 20000
          )
          INSERT INTO book_editions(id, expression_id, edition_label, format)
          SELECT
            'edition-capacity-' || printf('%05d', n),
            'expression-capacity-' || printf('%05d', n),
            'Synthetic Edition ' || printf('%05d', n),
            CASE WHEN n % 2 = 0 THEN 'EBOOK' ELSE 'PAPER' END
          FROM seq;

          WITH RECURSIVE seq(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 20000
          )
          INSERT INTO bibliographic_observations(
            id, contract_version, origin_kind, origin_record_id, origin_revision,
            observed_at, payload_json, truth_status, fact_status,
            normalization_version, warnings_json, created_at
          )
          SELECT
            'observation-capacity-' || printf('%05d', n),
            'bibliographic-observation-v1',
            'SYNTHETIC_FIXTURE',
            'fixture-capacity-' || printf('%05d', n),
            1,
            '2026-07-29T00:00:00.000Z',
            '{}',
            'UNVERIFIED',
            'NOT_A_FACT',
            'bibliography-normalization-v1',
            '["SYNTHETIC_CAPACITY"]',
            '2026-07-29T00:00:00.000Z'
          FROM seq;

          WITH RECURSIVE seq(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 20000
          )
          INSERT INTO catalog_entity_aliases(
            id, entity_type, entity_id, alias_kind, raw_value, normalized_value,
            normalization_version, observation_id, created_at
          )
          SELECT
            'alias-capacity-' || printf('%05d', n),
            'WORK',
            'work-capacity-' || printf('%05d', ((n - 1) % 10000) + 1),
            CASE WHEN n <= 10000 THEN 'CANONICAL' ELSE 'TRANSLATED' END,
            'Synthetic Alias ' || printf('%05d', n),
            'synthetic alias ' || printf('%05d', n),
            'bibliography-normalization-v1',
            'observation-capacity-' || printf('%05d', n),
            '2026-07-29T00:00:00.000Z'
          FROM seq;

          COMMIT;
        `);

      const counts = database
        .prepare(
          `SELECT
              (SELECT count(*) FROM books WHERE catalog_state = 'ACTIVE') AS works,
              (SELECT count(*) FROM expressions) AS expressions,
              (SELECT count(*) FROM book_editions) AS editions,
              (SELECT count(*) FROM bibliographic_observations) AS observations,
              (SELECT count(*) FROM catalog_entity_aliases) AS aliases`,
        )
        .get();
      expect(counts).toEqual({
        aliases: 20_000,
        editions: 20_000,
        expressions: 20_000,
        observations: 20_000,
        works: 10_000,
      });

      const repository = new SqliteCatalogRepository(database);
      const page = repository.getSummary(50, 9_950, '');
      expect(page.works).toHaveLength(50);
      expect(page.counts).toMatchObject({
        editions: 20_000,
        expressions: 20_000,
        observations: 20_000,
        works: 10_000,
      });
      expect(page.works[0]?.workId).toBe('work-capacity-09951');
      expect(page.works.at(-1)?.workId).toBe('work-capacity-10000');

      const plan = repository
        .queryPlanEvidence()
        .map((row) => row.detail)
        .join('\n');
      expect(plan).toContain('idx_books_catalog_title');
      expect(plan).not.toMatch(/SCAN book(?:\s|$)/u);
    } finally {
      database.close();
    }
  }, 60_000);
});
