import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  SqliteEvidenceRepository,
  SqliteFactMappingRepository,
  connectDatabase,
  initializeDatabase,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';
import {
  attachOfficialFact,
  atomicClaim,
  insertDossierCatalogFixture,
} from './support/dossier-fixtures.js';
import { createReadyCopyRepositoryFixture } from './support/copy-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 026 migration and precise invalidation', () => {
  it('appends v19 and creates normalized STRICT fact-mapping tables and guards', async () => {
    expect(MIGRATIONS[18]).toMatchObject({
      name: 'factual_claim_mapping',
      version: 19,
    });
    const { database } = await createInitializedDatabase('fact mapping migration 中文 空格');
    try {
      const tables = database
        .prepare(
          `SELECT name, sql FROM sqlite_schema
           WHERE type = 'table' AND name LIKE 'fact_mapping_%'
           ORDER BY name`,
        )
        .all() as unknown as readonly { readonly name: string; readonly sql: string }[];
      expect(tables.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          'fact_mapping_artifacts',
          'fact_mapping_checks',
          'fact_mapping_check_versions',
          'fact_mapping_decisions',
          'fact_mapping_dependencies',
          'fact_mapping_heads',
          'fact_mapping_invalidations',
          'fact_mapping_links',
          'fact_mapping_link_evidence',
          'fact_mapping_plans',
          'fact_mapping_policy_registry',
          'fact_mapping_runs',
          'fact_mapping_signals',
          'fact_mapping_statements',
        ]),
      );
      expect(tables.every(({ sql }) => sql.includes('STRICT'))).toBe(true);
      const triggerNames = (
        database
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type = 'trigger' AND name LIKE 'fact_mapping_%'
             ORDER BY name`,
          )
          .all() as unknown as readonly { readonly name: string }[]
      ).map(({ name }) => name);
      expect(triggerNames).toEqual(
        expect.arrayContaining([
          'fact_mapping_artifacts_immutable_update',
          'fact_mapping_check_versions_immutable_update',
          'fact_mapping_head_revision_guard',
          'fact_mapping_link_evidence_guard',
          'fact_mapping_statement_bounds_guard',
          'fact_mapping_statement_overlap_guard',
        ]),
      );
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({
        quick_check: 'ok',
      });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('upgrades v1-v18 with a backup and preserves Issue 025 Draft data', async () => {
    const databasePath = createTemporaryDatabasePath('fact mapping upgrade');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 18) });
    let database = connectDatabase(databasePath);
    const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-upgrade');
    const draftId = fixture.created.draftId;
    const draftVersionId = (
      database
        .prepare('SELECT current_version_id FROM content_draft_heads WHERE draft_id = ?')
        .get(draftId) as { readonly current_version_id: string }
    ).current_version_id;
    database.close();

    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({
      appliedVersions: MIGRATIONS.slice(18).map(({ version }) => version),
      schemaVersion: MIGRATIONS.at(-1)?.version,
    });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT head.current_version_id, version.status
             FROM content_draft_heads AS head
             JOIN content_draft_versions AS version ON version.id = head.current_version_id
             WHERE head.draft_id = ?`,
          )
          .get(draftId),
      ).toEqual({
        current_version_id: draftVersionId,
        status: 'READY_FOR_QUALITY_PIPELINE',
      });
      expect(
        database.prepare('SELECT count(*) AS count FROM fact_mapping_check_versions').get(),
      ).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({
        quick_check: 'ok',
      });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('rolls back every v19 write if the migration fails at its final statement', async () => {
    const databasePath = createTemporaryDatabasePath('fact mapping rollback');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 18) });
    const migration = MIGRATIONS[18];
    if (migration === undefined) throw new Error('Missing v19 migration.');
    await expect(
      initializeDatabase({
        databasePath,
        migrations: [
          ...MIGRATIONS.slice(0, 18),
          {
            ...migration,
            sql: `${migration.sql}\nINSERT INTO issue026_missing_table(id) VALUES (1);`,
          },
        ],
      }),
    ).rejects.toThrow();

    const database = connectDatabase(databasePath);
    try {
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({ version: 18 });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_schema
             WHERE type = 'table' AND name = 'fact_mapping_check_versions'`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({
        quick_check: 'ok',
      });
    } finally {
      database.close();
    }
  });

  it('invalidates only a referenced Claim and leaves an unrelated Work untouched', async () => {
    const { database } = await createInitializedDatabase('fact mapping precise invalidation');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-invalidation');
      const workId = fixture.payload.brief.workIds[0];
      if (workId === undefined) throw new Error('missing fixture work');
      const evidence = new SqliteEvidenceRepository(database);
      evidence.registerSubject('WORK', workId);
      attachOfficialFact(
        evidence,
        atomicClaim('claim-related', workId, 'canonical_title', 'TEXT', '关联作品'),
        'source-related',
        '官方资料：该作品标题为关联作品。',
      );
      insertDossierCatalogFixture(database, 'work-unrelated');
      evidence.registerSubject('WORK', 'work-unrelated');
      attachOfficialFact(
        evidence,
        atomicClaim('claim-unrelated', 'work-unrelated', 'canonical_title', 'TEXT', '无关作品'),
        'source-unrelated',
        '官方资料：该作品标题为无关作品。',
      );

      const repository = new SqliteFactMappingRepository(database);
      const preview = repository.previewStart({
        draftId: fixture.created.draftId,
        mode: 'LOCAL_MANUAL',
        now: '2026-07-31T03:10:00.000Z',
      });
      repository.confirmLocalStart({
        executionId: 'invalidation-execution',
        now: '2026-07-31T03:10:01.000Z',
        planId: preview.plan.planId,
        previewHash: preview.plan.previewHash,
      });
      database
        .prepare(
          `UPDATE claims SET revision = revision + 1, status = 'REJECTED'
           WHERE id = 'claim-unrelated'`,
        )
        .run();
      expect(
        database.prepare('SELECT count(*) AS count FROM fact_mapping_invalidations').get(),
      ).toEqual({ count: 0 });

      database
        .prepare(
          `UPDATE claims SET revision = revision + 1, status = 'REJECTED'
           WHERE id = 'claim-related'`,
        )
        .run();
      expect(repository.get(fixture.created.draftId)).toMatchObject({
        invalidationReasons: ['CLAIM_CHANGED'],
        status: 'STALE',
      });
    } finally {
      database.close();
    }
  });

  it('invalidates an old check on a new DraftVersion and a policy revision', async () => {
    const { database } = await createInitializedDatabase('fact mapping draft policy invalidation');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-draft-policy');
      const repository = new SqliteFactMappingRepository(database);
      const preview = repository.previewStart({
        draftId: fixture.created.draftId,
        mode: 'LOCAL_MANUAL',
        now: '2026-07-31T03:11:00.000Z',
      });
      const execution = repository.confirmLocalStart({
        executionId: 'draft-policy-execution',
        now: '2026-07-31T03:11:01.000Z',
        planId: preview.plan.planId,
        previewHash: preview.plan.previewHash,
      });
      if (fixture.payload.blocks[0] === undefined) {
        throw new Error('missing fixture block');
      }
      fixture.copy.saveVersion(
        fixture.created.draftId,
        fixture.created.revision,
        {
          ...fixture.payload,
          blocks: fixture.payload.blocks.map((block, index) =>
            index === 0 ? { ...block, text: `${block.text} 修订。` } : block,
          ),
        },
        ['USER_EDIT'],
        '2026-07-31T03:11:02.000Z',
      );
      expect(
        database
          .prepare(
            `SELECT reason_code FROM fact_mapping_invalidations
             WHERE check_version_id = ? ORDER BY reason_code`,
          )
          .all(execution.checkVersion.versionId),
      ).toEqual([{ reason_code: 'NEW_DRAFT_VERSION' }]);

      database
        .prepare(
          `UPDATE fact_mapping_policy_registry
           SET current_version = current_version || '-revision-2',
               revision = revision + 1,
               updated_at = '2026-07-31T03:11:03.000Z'
           WHERE policy_kind = 'KEY_FACT'`,
        )
        .run();
      expect(
        database
          .prepare(
            `SELECT reason_code FROM fact_mapping_invalidations
             WHERE check_version_id = ? ORDER BY reason_code`,
          )
          .all(execution.checkVersion.versionId),
      ).toEqual([
        { reason_code: 'FACT_MAPPING_POLICY_CHANGED' },
        { reason_code: 'NEW_DRAFT_VERSION' },
      ]);
    } finally {
      database.close();
    }
  });
});
