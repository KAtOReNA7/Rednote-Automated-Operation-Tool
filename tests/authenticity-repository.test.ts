import { afterEach, describe, expect, it } from 'vitest';

import { authenticitySemanticHash } from '../packages/authenticity/src/index.js';
import { SqliteAuthenticityRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  AUTHENTICITY_NOW,
  applyReadingState,
  insertAuthenticityDossier,
  insertAuthenticityExpressionEdition,
  insertAuthenticityWork,
} from './support/authenticity-fixtures.js';

afterEach(cleanTemporaryDatabases);

function repositoryWithStableIds(
  database: Parameters<typeof insertAuthenticityWork>[0],
): SqliteAuthenticityRepository {
  let sequence = 0;
  return new SqliteAuthenticityRepository(database, () => `authenticity-fixture-${++sequence}`);
}

describe('Issue 021 SQLite authenticity repository', () => {
  it('lists unclassified Works and preserves Work/Expression/Edition context', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'work-library-b', '乙书');
      insertAuthenticityWork(database, 'work-library-a', '甲书');
      const context = insertAuthenticityExpressionEdition(database, 'work-library-a');
      const repository = repositoryWithStableIds(database);

      expect(repository.listLibrary('primary', { limit: 1, offset: 0, query: '' })).toMatchObject({
        items: [
          {
            memoryConfidence: 'UNKNOWN',
            readingState: 'UNCLASSIFIED',
            readingStateId: null,
            revision: 0,
            workId: 'work-library-b',
          },
        ],
        limit: 1,
        offset: 0,
        total: 2,
      });
      expect(repository.getWorkDetail('primary', 'work-library-a')).toMatchObject({
        editions: [{ editionId: context.editionId }],
        expressions: [{ expressionId: context.expressionId }],
        readingState: 'UNCLASSIFIED',
        revision: 0,
      });
      expect(
        repository.listLibrary('primary', { limit: 25, offset: 0, query: '乙' }).items,
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('previews, appends, undoes, audits and rejects stale state changes', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'work-state', '状态书');
      insertAuthenticityDossier(database, 'work-state', 'READY_FOR_CONTENT_BRIEF');
      const repository = repositoryWithStableIds(database);
      const firstDraft = {
        confirmationKind: 'USER_EXPLICIT' as const,
        expectedRevision: 0,
        finishedAt: '2026-07-01',
        finishedAtPrecision: 'DAY' as const,
        lastReadAt: null,
        lastReadAtPrecision: 'UNKNOWN' as const,
        memoryConfidence: 'CLEAR' as const,
        nextState: 'R1_READ_CLEAR' as const,
        profileId: 'primary',
        provenance: 'USER_UI' as const,
        subject: {
          editionId: null,
          expressionId: null,
          workId: 'work-state',
        },
        userNote: '合成备注',
      };
      expect(repository.previewStateChange(firstDraft)).toMatchObject({
        after: { memoryConfidence: 'CLEAR', state: 'R1_READ_CLEAR' },
        before: { memoryConfidence: 'UNKNOWN', state: 'UNCLASSIFIED' },
      });
      const first = repository.applyStateChange(firstDraft, AUTHENTICITY_NOW);
      expect(first).toMatchObject({
        permission: {
          contentBriefReadiness: 'ALLOWED',
          firstPersonPermission: 'ALLOWED',
          personalScorePermission: 'ALLOWED',
          publicResearchAnalysisPermission: 'RESEARCH_ONLY',
          stale: false,
        },
        readingState: 'R1_READ_CLEAR',
        revision: 1,
      });

      applyReadingState(
        repository,
        {
          confidence: 'PARTIAL',
          expectedRevision: 1,
          state: 'R2_READ_FUZZY',
          workId: 'work-state',
        },
        '2026-07-30T03:01:00.000Z',
      );
      const undo = repository.previewUndo('primary', 'work-state', 2);
      expect(undo.restore).toEqual({
        memoryConfidence: 'CLEAR',
        state: 'R1_READ_CLEAR',
      });
      const restored = repository.applyUndo(undo, '2026-07-30T03:02:00.000Z');
      expect(restored).toMatchObject({
        history: [
          { confirmationKind: 'USER_UNDO', revision: 3, state: 'R1_READ_CLEAR' },
          { revision: 2, state: 'R2_READ_FUZZY' },
          { revision: 1, state: 'R1_READ_CLEAR' },
        ],
        readingState: 'R1_READ_CLEAR',
        revision: 3,
      });
      expect(
        database
          .prepare(
            `SELECT event_type
             FROM reading_authenticity_audit_events
             WHERE reading_state_id = ?
             ORDER BY created_at, id`,
          )
          .all(restored.readingStateId),
      ).toEqual(
        expect.arrayContaining([
          { event_type: 'STATE_CHANGED' },
          { event_type: 'STATE_UNDONE' },
          { event_type: 'SNAPSHOT_PUBLISHED' },
        ]),
      );
      expect(() => repository.applyStateChange(firstDraft, AUTHENTICITY_NOW)).toThrow(
        /AUTHENTICITY_STALE_REVISION/iu,
      );
    } finally {
      database.close();
    }
  });

  it('binds each R2 assertion to the current reading revision and revokes immediately', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'work-r2', 'R2 书');
      insertAuthenticityDossier(database, 'work-r2', 'READY_FOR_CONTENT_BRIEF');
      const repository = repositoryWithStableIds(database);
      applyReadingState(repository, {
        confidence: 'PARTIAL',
        state: 'R2_READ_FUZZY',
        workId: 'work-r2',
      });
      const impression = {
        assertionId: null,
        assertionKind: 'READING_IMPRESSION' as const,
        confirmationScope: 'EXACT_STATEMENT' as const,
        expectedAssertionRevision: 0,
        expectedReadingRevision: 1,
        profileId: 'primary',
        statement: '我明确记得阅读时注意到叙述节奏。',
        workId: 'work-r2',
      };
      const withImpression = repository.applyAssertion(impression, '2026-07-30T03:01:00.000Z');
      expect(withImpression.permission).toMatchObject({
        firstPersonPermission: 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY',
        personalScorePermission: 'BLOCKED',
      });
      const assertion = withImpression.assertions[0];
      expect(assertion).toMatchObject({ stale: false, status: 'CONFIRMED' });
      if (assertion === undefined) throw new Error('missing assertion fixture');

      const revoke = repository.previewAssertionRevoke({
        assertionId: assertion.assertionId,
        expectedAssertionRevision: assertion.assertionRevision,
        expectedReadingRevision: 1,
        profileId: 'primary',
        workId: 'work-r2',
      });
      const revoked = repository.applyAssertionRevoke(revoke, '2026-07-30T03:02:00.000Z');
      expect(revoked.assertions[0]).toMatchObject({ stale: true, status: 'REVOKED' });
      expect(revoked.permission.firstPersonPermission).toBe('BLOCKED');

      repository.applyAssertion(
        {
          ...impression,
          assertionId: assertion.assertionId,
          expectedAssertionRevision: 2,
          statement: '我再次逐条确认这句原意。',
        },
        '2026-07-30T03:03:00.000Z',
      );
      applyReadingState(
        repository,
        {
          confidence: 'FADED',
          expectedRevision: 1,
          state: 'R2_READ_FUZZY',
          workId: 'work-r2',
        },
        '2026-07-30T03:04:00.000Z',
      );
      const stale = repository.getWorkDetail('primary', 'work-r2');
      expect(stale.assertions[0]).toMatchObject({ stale: true, status: 'CONFIRMED' });
      expect(stale.permission.firstPersonPermission).toBe('BLOCKED');
    } finally {
      database.close();
    }
  });

  it('rejects public first-person assertions outside the current R2 revision', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'work-r3-assertion', 'R3 观点边界书');
      const repository = repositoryWithStableIds(database);
      applyReadingState(repository, {
        confidence: 'UNKNOWN',
        state: 'R3_READ_UNCONFIRMED_DETAILS',
        workId: 'work-r3-assertion',
      });
      expect(() =>
        repository.previewAssertion({
          assertionId: null,
          assertionKind: 'READING_IMPRESSION',
          confirmationScope: 'EXACT_STATEMENT',
          expectedAssertionRevision: 0,
          expectedReadingRevision: 1,
          profileId: 'primary',
          statement: '这条合成陈述不得获得第一人称权限。',
          workId: 'work-r3-assertion',
        }),
      ).toThrow(/AUTHENTICITY_POLICY_BLOCKED/iu);
      expect(database.prepare('SELECT count(*) AS count FROM experience_assertions').get()).toEqual(
        { count: 0 },
      );
    } finally {
      database.close();
    }
  });

  it('stores personal, research and internal scores separately without leaking internal score', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'work-scores', '评分书');
      insertAuthenticityDossier(database, 'work-scores', 'READY_FOR_CONTENT_BRIEF');
      const repository = repositoryWithStableIds(database);
      applyReadingState(repository, {
        confidence: 'CLEAR',
        state: 'R1_READ_CLEAR',
        workId: 'work-scores',
      });
      repository.applyScore(
        {
          expectedReadingRevision: 1,
          expectedRevision: 0,
          origin: 'PERSONAL_SCORE',
          profileId: 'primary',
          scoreBasisPoints: 8750,
          workId: 'work-scores',
        },
        '2026-07-30T03:01:00.000Z',
      );
      repository.applyScore(
        {
          expectedReadingRevision: 1,
          expectedRevision: 0,
          origin: 'RESEARCH_ANALYSIS_SCORE',
          profileId: 'primary',
          scoreBasisPoints: 8200,
          workId: 'work-scores',
        },
        '2026-07-30T03:02:00.000Z',
      );
      database
        .prepare(
          `INSERT INTO system_prediction_scores(
             id, profile_id, book_id, score_basis_points, purpose, provenance, created_at
           ) VALUES (
             'prediction-score', 'primary', 'work-scores', 9100,
             'INTERNAL_ORDERING_ONLY', 'SCRIPTED_FIXTURE', ?
           )`,
        )
        .run(AUTHENTICITY_NOW);

      const detail = repository.getWorkDetail('primary', 'work-scores');
      expect(detail.personalScore).toMatchObject({
        origin: 'PERSONAL_SCORE',
        publicLabel: '个人评分',
        scoreBasisPoints: 8750,
      });
      expect(detail.researchScore).toMatchObject({
        origin: 'RESEARCH_ANALYSIS_SCORE',
        publicLabel: '资料分析评分',
        scoreBasisPoints: 8200,
      });
      expect(JSON.stringify(detail)).not.toContain('9100');
      expect(JSON.stringify(detail)).not.toContain('SYSTEM_PREDICTION_INTERNAL');
      expect(
        database.prepare('SELECT count(*) AS count FROM personal_score_records').get(),
      ).toEqual({ count: 1 });
      expect(
        database.prepare('SELECT count(*) AS count FROM research_analysis_score_records').get(),
      ).toEqual({ count: 1 });
      expect(
        database.prepare('SELECT count(*) AS count FROM system_prediction_scores').get(),
      ).toEqual({ count: 1 });

      const revoked = repository.applyScore(
        {
          expectedReadingRevision: 1,
          expectedRevision: 1,
          origin: 'PERSONAL_SCORE',
          profileId: 'primary',
          scoreBasisPoints: null,
          workId: 'work-scores',
        },
        '2026-07-30T03:03:00.000Z',
      );
      expect(revoked.personalScore?.scoreBasisPoints).toBeNull();
      expect(revoked.personalScore?.status).toBe('REVOKED');
    } finally {
      database.close();
    }
  });

  it('requires explicit full-trick warning settings without elevating authenticity', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'work-spoiler', '剧透书');
      insertAuthenticityDossier(database, 'work-spoiler', 'READY_FOR_CONTENT_BRIEF');
      const repository = repositoryWithStableIds(database);
      applyReadingState(repository, {
        confidence: 'NOT_APPLICABLE',
        state: 'S1_RESEARCH_ONLY',
        workId: 'work-spoiler',
      });
      const preview = repository.previewSpoiler({
        expectedRevision: 1,
        level: 'FULL_TRICK_ANALYSIS',
        profileId: 'primary',
        userConfirmed: true,
        warningIncluded: true,
        workId: 'work-spoiler',
      });
      expect(preview).toMatchObject({
        warningPlacement: 'COVER_TITLE_AND_BODY_OPENING',
        warningRequired: true,
      });
      const detail = repository.applySpoiler(preview.draft, '2026-07-30T03:01:00.000Z');
      expect(detail.permission).toMatchObject({
        firstPersonPermission: 'BLOCKED',
        publicResearchAnalysisPermission: 'RESEARCH_ONLY',
        spoiler: {
          coreTrickDisclosure: true,
          warningRequired: true,
        },
      });
    } finally {
      database.close();
    }
  });

  it('reports bounded batch partial success without overwriting stale rows', async () => {
    const { database } = await createInitializedDatabase();
    try {
      for (const workId of ['work-batch-a', 'work-batch-b']) {
        insertAuthenticityWork(database, workId, workId);
      }
      const repository = repositoryWithStableIds(database);
      const draft = {
        confirmationKind: 'USER_BATCH_EXPLICIT' as const,
        items: [
          { expectedRevision: 0, workId: 'work-batch-a' },
          { expectedRevision: 0, workId: 'work-batch-b' },
        ],
        memoryConfidence: 'NOT_APPLICABLE' as const,
        nextState: 'S1_RESEARCH_ONLY' as const,
        profileId: 'primary',
        provenance: 'USER_UI' as const,
      };
      const preview = repository.previewBatch(draft);
      expect(preview.items).toEqual([
        { before: 'UNCLASSIFIED', expectedRevision: 0, workId: 'work-batch-a' },
        { before: 'UNCLASSIFIED', expectedRevision: 0, workId: 'work-batch-b' },
      ]);
      applyReadingState(
        repository,
        {
          confidence: 'NOT_APPLICABLE',
          state: 'S2_RESEARCH_INSUFFICIENT',
          workId: 'work-batch-b',
        },
        '2026-07-30T03:01:00.000Z',
      );
      const result = repository.applyBatch(draft, '2026-07-30T03:02:00.000Z');
      expect(result).toMatchObject({ failed: 1, succeeded: 1 });
      expect(result.items).toEqual([
        { errorCode: null, ok: true, revision: 1, workId: 'work-batch-a' },
        {
          errorCode: 'AUTHENTICITY_STALE_REVISION',
          ok: false,
          revision: null,
          workId: 'work-batch-b',
        },
      ]);
      expect(repository.getWorkDetail('primary', 'work-batch-b').readingState).toBe(
        'S2_RESEARCH_INSUFFICIENT',
      );
    } finally {
      database.close();
    }
  });

  it('invalidates only related snapshots and uses indexed dependency lookups', async () => {
    const { database } = await createInitializedDatabase();
    try {
      for (const workId of ['work-related', 'work-catalog', 'work-unrelated']) {
        insertAuthenticityWork(database, workId, workId);
        insertAuthenticityDossier(database, workId, 'READY_FOR_CONTENT_BRIEF');
      }
      const repository = repositoryWithStableIds(database);
      for (const workId of ['work-related', 'work-catalog', 'work-unrelated']) {
        applyReadingState(repository, {
          confidence: 'NOT_APPLICABLE',
          state: 'S1_RESEARCH_ONLY',
          workId,
        });
      }
      const beforeRelated = repository.getWorkDetail('primary', 'work-related');
      const beforeCatalog = repository.getWorkDetail('primary', 'work-catalog');
      const beforeUnrelated = repository.getWorkDetail('primary', 'work-unrelated');
      database
        .prepare(
          `UPDATE research_dossiers
           SET readiness = 'FACT_BLOCKED', revision = revision + 1, updated_at = ?
           WHERE id = 'dossier-work-related'`,
        )
        .run('2026-07-30T03:01:00.000Z');
      database
        .prepare(
          `UPDATE books
           SET catalog_revision = catalog_revision + 1, updated_at = ?
           WHERE id = 'work-catalog'`,
        )
        .run('2026-07-30T03:02:00.000Z');

      expect(repository.getWorkDetail('primary', 'work-related').permission).toMatchObject({
        contentBriefReadiness: 'STALE_REVIEW_REQUIRED',
        stale: true,
      });
      expect(repository.getWorkDetail('primary', 'work-catalog').permission).toMatchObject({
        contentBriefReadiness: 'STALE_REVIEW_REQUIRED',
        stale: true,
      });
      expect(repository.getWorkDetail('primary', 'work-unrelated').permission).toMatchObject({
        snapshotId: beforeUnrelated.permission.snapshotId,
        stale: false,
      });
      expect(
        database
          .prepare(
            `SELECT snapshot_id
             FROM expression_permission_invalidations
             ORDER BY created_at, id`,
          )
          .all(),
      ).toEqual(
        expect.arrayContaining([
          { snapshot_id: beforeRelated.permission.snapshotId },
          { snapshot_id: beforeCatalog.permission.snapshotId },
        ]),
      );
      expect(
        database
          .prepare(
            `SELECT snapshot_id
             FROM expression_permission_invalidations
             WHERE snapshot_id = ?`,
          )
          .all(beforeUnrelated.permission.snapshotId),
      ).toEqual([]);

      const plan = database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT snapshot_id
           FROM expression_permission_dependencies
           WHERE dependency_type = 'DOSSIER_READINESS' AND dependency_id = ?`,
        )
        .all('dossier-work-related')
        .map((row) => JSON.stringify(row))
        .join(' ');
      expect(plan).toMatch(/idx_permission_dependencies_lookup/iu);
    } finally {
      database.close();
    }
  });

  it('fails closed when a persisted snapshot has an older policy version', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'work-policy-version', '策略版本书');
      insertAuthenticityDossier(database, 'work-policy-version', 'READY_FOR_CONTENT_BRIEF');
      const repository = repositoryWithStableIds(database);
      applyReadingState(repository, {
        confidence: 'NOT_APPLICABLE',
        state: 'S1_RESEARCH_ONLY',
        workId: 'work-policy-version',
      });
      database.exec(`
        DROP TRIGGER permission_snapshots_append_only_update;
        PRAGMA ignore_check_constraints = ON;
        UPDATE expression_permission_snapshots
        SET authenticity_policy_version = 'reading-authenticity-policy-legacy-fixture';
      `);

      expect(repository.getWorkDetail('primary', 'work-policy-version').permission).toMatchObject({
        contentBriefReadiness: 'STALE_REVIEW_REQUIRED',
        publicResearchAnalysisPermission: 'STALE_REVIEW_REQUIRED',
        stale: true,
      });
      expect(
        repository.listLibrary('primary', { limit: 25, offset: 0, query: '' }).items[0],
      ).toMatchObject({
        contentBriefReadiness: 'STALE_REVIEW_REQUIRED',
        snapshotStale: true,
        workId: 'work-policy-version',
      });
    } finally {
      database.close();
    }
  });

  it('replays deterministic policy and dependency hashes for identical inputs', async () => {
    const payload = {
      assertions: [
        { assertionId: 'b', assertionRevision: 1 },
        { assertionId: 'a', assertionRevision: 2 },
      ],
      policy: 'reading-authenticity-policy-v1',
      workId: 'work-deterministic',
    };
    expect(authenticitySemanticHash(payload)).toBe(authenticitySemanticHash(payload));
    expect(
      authenticitySemanticHash({
        ...payload,
        assertions: [...payload.assertions].reverse(),
      }),
    ).not.toBe(authenticitySemanticHash(payload));
  });
});
