import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  SqliteCatalogRepository,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';
import { syntheticObservation } from './support/bibliography-fixtures.js';

afterEach(cleanTemporaryDatabases);

const NOW = '2026-07-29T00:00:00.000Z';

function scalar(database: DatabaseSync, sql: string): number {
  return (
    database.prepare(sql).get() as {
      readonly count: number;
    }
  ).count;
}

describe('Issue 018 SQLite catalog repository', () => {
  it('freezes the normalized migration v11 identity', () => {
    expect(MIGRATIONS[10]).toMatchObject({
      foreignKeysDisabled: true,
      name: 'bibliographic_catalog_and_entity_resolution',
      version: 11,
    });
    expect(migrationChecksum(MIGRATIONS[10] as (typeof MIGRATIONS)[number])).toBe(
      'ad0e67dab752e41e1903df13b88665c99194fb527d5f5efb01c96b4d855c3750',
    );
  });

  it('upgrades v10 to v11 without losing Work, Edition, author or downstream IDs', async () => {
    const databasePath = createTemporaryDatabasePath('升级书目 数据');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 10) });
    let database = connectDatabase(databasePath);
    const longSuffix = 'x'.repeat(150);
    database
      .prepare(
        `INSERT INTO authors(id, canonical_name, country_or_region)
         VALUES (?, '历史作者', 'CN')`,
      )
      .run(`author-${longSuffix}`);
    database
      .prepare(
        `INSERT INTO books(
          id, canonical_title, original_title, author_id, language, work_type, discovery_status
        ) VALUES (?, '历史作品', 'Legacy Work', ?, 'zh-CN', 'MYSTERY', 'IMPORTED')`,
      )
      .run(`work-${longSuffix}`, `author-${longSuffix}`);
    database
      .prepare(
        `INSERT INTO book_editions(id, book_id, isbn, publisher)
         VALUES ('edition-legacy', ?, '9780306406157', '历史出版社')`,
      )
      .run(`work-${longSuffix}`);
    database
      .prepare(
        `INSERT INTO reading_states(id, book_id, state)
         VALUES ('reading-legacy', ?, 'NOT_READ')`,
      )
      .run(`work-${longSuffix}`);
    database.close();

    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({ appliedVersions: [11, 12], schemaVersion: 12 });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      const columns = (
        database.prepare('PRAGMA table_info(book_editions)').all() as {
          readonly name: string;
        }[]
      ).map((row) => row.name);
      expect(columns).toContain('expression_id');
      expect(columns).not.toContain('book_id');
      expect(
        database.prepare('SELECT book_id FROM reading_states WHERE id = ?').get('reading-legacy'),
      ).toEqual({ book_id: `work-${longSuffix}` });
      expect(
        database.prepare('SELECT id, isbn FROM book_editions WHERE id = ?').get('edition-legacy'),
      ).toEqual({ id: 'edition-legacy', isbn: '9780306406157' });
      expect(
        database
          .prepare(
            `SELECT expression.work_id
             FROM book_editions AS edition
             JOIN expressions AS expression ON expression.id = edition.expression_id
             WHERE edition.id = 'edition-legacy'`,
          )
          .get(),
      ).toEqual({ work_id: `work-${longSuffix}` });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }

    const backup = connectDatabase(result.backupPath as string);
    try {
      expect(
        backup.prepare('SELECT canonical_title FROM books WHERE id = ?').get(`work-${longSuffix}`),
      ).toEqual({ canonical_title: '历史作品' });
      expect(
        (
          backup.prepare('PRAGMA table_info(book_editions)').all() as { readonly name: string }[]
        ).map((row) => row.name),
      ).toContain('book_id');
    } finally {
      backup.close();
    }
  });

  it('matches the synthetic gold fixture exactly with zero automatic false positives', async () => {
    const { database } = await createInitializedDatabase('gold fixture');
    try {
      const repository = new SqliteCatalogRepository(database);
      const first = repository.insertSyntheticObservation(
        syntheticObservation('gold-a', {
          contributors: ['作者甲'],
          isbn: '9780306406157',
          originalTitle: 'Synthetic Case A',
          title: '合成谜案 A',
        }),
        null,
        NOW,
      );
      const replay = repository.insertSyntheticObservation(
        syntheticObservation('gold-a', {
          contributors: ['作者甲'],
          isbn: '9780306406157',
          originalTitle: 'Synthetic Case A',
          title: '合成谜案 A',
        }),
        null,
        NOW,
      );
      const exact = repository.insertSyntheticObservation(
        syntheticObservation('gold-a-reprint', {
          contributors: ['作者甲'],
          isbn: '9780306406157',
          originalTitle: 'Synthetic Case A',
          title: '合成谜案 A',
        }),
        null,
        NOW,
      );
      const conflicting = repository.insertSyntheticObservation(
        syntheticObservation('gold-conflict', {
          contributors: ['另一作者'],
          isbn: '9780306406157',
          title: '完全不同的合成作品',
        }),
        null,
        NOW,
      );
      const titleOnly = repository.insertSyntheticObservation(
        syntheticObservation('gold-title-only', {
          contributors: ['作者甲'],
          isbn: null,
          title: '合成谜案 A',
        }),
        null,
        NOW,
      );
      const distinct = repository.insertSyntheticObservation(
        syntheticObservation('gold-b', {
          contributors: ['作者乙'],
          isbn: '9780140328721',
          title: '合成谜案 B',
        }),
        null,
        NOW,
      );
      const missingTitle = repository.insertSyntheticObservation(
        syntheticObservation('gold-missing-title', {
          isbn: '9781861972712',
          title: null,
        }),
        null,
        NOW,
      );

      expect(first).toMatchObject({ editions: 1, expressions: 1, observations: 1, works: 1 });
      expect(replay).toEqual({
        editions: 0,
        expressions: 0,
        observations: 0,
        reviewCases: 0,
        works: 0,
      });
      expect(exact).toMatchObject({ observations: 1, reviewCases: 0, works: 0 });
      expect(conflicting).toMatchObject({ observations: 1, reviewCases: 1, works: 0 });
      expect(titleOnly).toMatchObject({ observations: 1, reviewCases: 1, works: 0 });
      expect(distinct).toMatchObject({ editions: 1, expressions: 1, observations: 1, works: 1 });
      expect(missingTitle).toMatchObject({ observations: 1, reviewCases: 1, works: 0 });

      const summary = repository.getSummary();
      expect(summary.counts).toEqual({
        editions: 2,
        expressions: 2,
        observations: 6,
        openReviewCases: 3,
        works: 2,
      });
      expect(
        database.prepare(`SELECT count(*) AS count FROM books WHERE canonical_title = ''`).get(),
      ).toEqual({ count: 0 });
      const links = database
        .prepare(
          `SELECT observation_id, entity_type, link_outcome
           FROM observation_entity_links ORDER BY observation_id, entity_type`,
        )
        .all() as {
        readonly entity_type: string;
        readonly link_outcome: string;
        readonly observation_id: string;
      }[];
      expect(
        links.filter(
          (link) =>
            link.observation_id === 'observation-gold-a-reprint' &&
            link.link_outcome === 'EXACT_LINK',
        ),
      ).toHaveLength(3);
      expect(
        links.some(
          (link) =>
            link.observation_id === 'observation-gold-conflict' &&
            link.link_outcome === 'EXACT_LINK',
        ),
      ).toBe(false);
      expect(
        links.some(
          (link) =>
            link.observation_id === 'observation-gold-title-only' &&
            link.link_outcome === 'EXACT_LINK',
        ),
      ).toBe(false);
    } finally {
      database.close();
    }
  });

  it('keeps publication relationships directional, unknown-capable and outside product gates', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const repository = new SqliteCatalogRepository(database);
      repository.insertSyntheticObservation(
        syntheticObservation('publication', {
          contributors: ['合成人物'],
          isbn: '9780140328721',
          organizations: ['合成机构甲'],
        }),
        null,
        NOW,
      );
      const work = repository.getSummary().works[0];
      expect(work).toBeDefined();
      database
        .prepare(
          `INSERT INTO catalog_agents(
            id, agent_type, canonical_name, normalized_name, created_at, updated_at
          ) VALUES
            ('org-subject', 'ORGANIZATION', '合成机构甲', '合成机构甲', ?, ?),
            ('org-object', 'ORGANIZATION', '合成机构乙', '合成机构乙', ?, ?)`,
        )
        .run(NOW, NOW, NOW, NOW);
      const beforeGates = {
        approvals: scalar(database, 'SELECT count(*) AS count FROM approvals'),
        briefs: scalar(database, 'SELECT count(*) AS count FROM content_briefs'),
        packages: scalar(database, 'SELECT count(*) AS count FROM post_packages'),
        topics: scalar(database, 'SELECT count(*) AS count FROM topics'),
      };
      database
        .prepare(
          `INSERT INTO publication_relationships(
            id, role, subject_agent_id, object_agent_id, scope_type, scope_id,
            language, territory, format, verification_state, created_at, updated_at
          ) VALUES (
            'relationship-synthetic', 'LICENSOR', 'org-subject', 'org-object',
            'WORK', ?, NULL, NULL, NULL, 'OBSERVED_UNVERIFIED', ?, ?
          )`,
        )
        .run(work?.workId as string, NOW, NOW);
      const detail = repository.getWorkDetail(work?.workId as string);
      expect(detail?.publicationRelationships).toEqual([
        {
          language: null,
          objectAgentName: '合成机构乙',
          role: 'LICENSOR',
          scopeId: work?.workId,
          scopeType: 'WORK',
          subjectAgentName: '合成机构甲',
          territory: null,
          verificationState: 'OBSERVED_UNVERIFIED',
        },
      ]);
      expect({
        approvals: scalar(database, 'SELECT count(*) AS count FROM approvals'),
        briefs: scalar(database, 'SELECT count(*) AS count FROM content_briefs'),
        packages: scalar(database, 'SELECT count(*) AS count FROM post_packages'),
        topics: scalar(database, 'SELECT count(*) AS count FROM topics'),
      }).toEqual(beforeGates);
      expect(() =>
        database
          .prepare(
            `INSERT INTO publication_relationships(
              id, role, subject_agent_id, verification_state, created_at, updated_at
            ) VALUES ('forbidden-evidence', 'AGENCY', 'org-subject', 'EVIDENCE_CONFIRMED', ?, ?)`,
          )
          .run(NOW, NOW),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('merges, redirects and atomically undoes downstream Work references', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const repository = new SqliteCatalogRepository(database);
      repository.insertSyntheticObservation(
        syntheticObservation('decision-a', { isbn: '9780306406157', title: '保留作品' }),
        null,
        NOW,
      );
      repository.insertSyntheticObservation(
        syntheticObservation('decision-b', { isbn: '9780140328721', title: '重复作品' }),
        null,
        NOW,
      );
      const works = repository.getSummary().works;
      const survivor = works.find((work) => work.canonicalTitle === '保留作品');
      const duplicate = works.find((work) => work.canonicalTitle === '重复作品');
      expect(survivor).toBeDefined();
      expect(duplicate).toBeDefined();
      database
        .prepare(
          `INSERT INTO reading_states(id, book_id, state)
           VALUES ('reading-decision', ?, 'NOT_READ')`,
        )
        .run(duplicate?.workId as string);

      const preview = repository.previewWorkMerge(
        survivor?.workId as string,
        duplicate?.workId as string,
        survivor?.revision as number,
        duplicate?.revision as number,
      );
      expect(preview.affected).toMatchObject({
        downstreamReferences: 1,
        editions: 1,
        expressions: 1,
      });
      const decisionId = repository.mergeWorks(preview, '2026-07-29T00:00:01.000Z');
      expect(
        database.prepare('SELECT book_id FROM reading_states WHERE id = ?').get('reading-decision'),
      ).toEqual({ book_id: survivor?.workId });
      expect(
        database
          .prepare(
            `SELECT to_entity_id, active FROM entity_redirects
             WHERE from_entity_id = ?`,
          )
          .get(duplicate?.workId as string),
      ).toEqual({ active: 1, to_entity_id: survivor?.workId });

      const undoPreview = repository.previewUndoDecision(decisionId);
      const undoId = repository.undoDecision(undoPreview, '2026-07-29T00:00:02.000Z');
      expect(undoId).not.toBe(decisionId);
      expect(
        database.prepare('SELECT book_id FROM reading_states WHERE id = ?').get('reading-decision'),
      ).toEqual({ book_id: duplicate?.workId });
      expect(
        database
          .prepare('SELECT active FROM entity_redirects WHERE from_entity_id = ?')
          .get(duplicate?.workId as string),
      ).toEqual({ active: 0 });
      expect(scalar(database, `SELECT count(*) AS count FROM resolution_decisions`)).toBe(2);

      const restored = repository.getWorkDetail(duplicate?.workId as string);
      const expressionId = restored?.expressions[0]?.expressionId;
      expect(expressionId).toBeDefined();
      const splitPreview = repository.previewWorkSplit(
        duplicate?.workId as string,
        restored?.revision as number,
        [expressionId as string],
        '拆分后的作品',
      );
      const splitDecisionId = repository.splitWork(
        splitPreview,
        'work-confirmed-split',
        '2026-07-29T00:00:03.000Z',
      );
      expect(
        database
          .prepare('SELECT work_id FROM expressions WHERE id = ?')
          .get(expressionId as string),
      ).toEqual({ work_id: 'work-confirmed-split' });
      repository.undoDecision(
        repository.previewUndoDecision(splitDecisionId),
        '2026-07-29T00:00:04.000Z',
      );
      expect(
        database
          .prepare('SELECT work_id FROM expressions WHERE id = ?')
          .get(expressionId as string),
      ).toEqual({ work_id: duplicate?.workId });
      expect(
        database
          .prepare('SELECT catalog_state FROM books WHERE id = ?')
          .get('work-confirmed-split'),
      ).toEqual({ catalog_state: 'RETIRED' });
      expect(repository.resolveWorkId('work-confirmed-split')).toBe(duplicate?.workId);
      expect(
        scalar(database, `SELECT count(*) AS count FROM catalog_audit_events`),
      ).toBeGreaterThan(0);
      expect(() =>
        database.prepare('DELETE FROM resolution_decisions WHERE id = ?').run(decisionId),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('rejects stale concurrent decisions without partial moves', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const repository = new SqliteCatalogRepository(database);
      repository.insertSyntheticObservation(
        syntheticObservation('stale-a', { isbn: '9780306406157', title: '并发甲' }),
        null,
        NOW,
      );
      repository.insertSyntheticObservation(
        syntheticObservation('stale-b', { isbn: '9780140328721', title: '并发乙' }),
        null,
        NOW,
      );
      const [left, right] = repository.getSummary().works;
      expect(left).toBeDefined();
      expect(right).toBeDefined();
      const preview = repository.previewWorkMerge(
        left?.workId as string,
        right?.workId as string,
        left?.revision as number,
        right?.revision as number,
      );
      database
        .prepare('UPDATE books SET catalog_revision = catalog_revision + 1 WHERE id = ?')
        .run(right?.workId as string);
      expect(() => repository.mergeWorks(preview, '2026-07-29T00:00:03.000Z')).toThrow();
      expect(
        database
          .prepare('SELECT catalog_state FROM books WHERE id = ?')
          .get(right?.workId as string),
      ).toEqual({ catalog_state: 'ACTIVE' });
      expect(scalar(database, 'SELECT count(*) AS count FROM resolution_decisions')).toBe(0);
    } finally {
      database.close();
    }
  });
});
