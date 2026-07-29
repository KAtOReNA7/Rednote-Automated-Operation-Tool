import { afterEach, describe, expect, it } from 'vitest';

import { SqliteDossierRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 020 dossier capacity and query plans', () => {
  it('pages 10,000 dossiers with bounded DTOs and indexed rebuild/dependency lookups', async () => {
    const { database } = await createInitializedDatabase('档案容量 中文 空格');
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
          'work-dossier-capacity-' || printf('%05d', n),
          'Synthetic Dossier Work ' || printf('%05d', n),
          'MYSTERY',
          'SYNTHETIC_CAPACITY',
          'ACTIVE',
          1
        FROM seq;

        INSERT INTO fact_subjects(subject_type, subject_id, work_id)
        SELECT 'WORK', id, id
        FROM books
        WHERE id LIKE 'work-dossier-capacity-%';

        INSERT INTO research_dossiers(
          id, book_id, subject_type, subject_id, revision, state, readiness,
          invalidation_reasons_json, created_at, updated_at
        )
        SELECT
          'dossier-capacity-' || substr(id, -5),
          id,
          'WORK',
          id,
          1,
          'NOT_BUILT',
          'NOT_BUILT',
          '[]',
          '2026-07-29T04:00:00.000Z',
          '2026-07-29T04:00:00.000Z'
        FROM books
        WHERE id LIKE 'work-dossier-capacity-%';

        COMMIT;
      `);

      const repository = new SqliteDossierRepository(database);
      const page = repository.listDossiers(100, 9_900);
      expect(page).toMatchObject({ limit: 100, offset: 9_900, total: 10_000 });
      expect(page.items).toHaveLength(100);
      expect(page.items[0]?.dossier.dossierId).toBe('dossier-capacity-09901');
      expect(page.items.at(-1)?.dossier.dossierId).toBe('dossier-capacity-10000');
      expect(page.items.every((item) => item.dossier.currentVersionId === null)).toBe(true);
      expect(() => repository.listDossiers(101, 0)).toThrow(/DOSSIER_INVALID_REQUEST/u);

      const queryPlans = repository.queryPlanEvidence().join('\n');
      expect(queryPlans).toContain('idx_research_dossier_dependencies_lookup');
      expect(queryPlans).toContain('idx_research_dossiers_state');
      expect(queryPlans).toContain('idx_research_dossier_entries_page');
    } finally {
      database.close();
    }
  }, 45_000);
});
