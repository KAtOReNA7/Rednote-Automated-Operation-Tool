import { afterEach, describe, expect, it } from 'vitest';

import { SqliteDossierRepository, SqliteEvidenceRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { DOSSIER_NOW, createReadyWorkEvidence } from './support/dossier-fixtures.js';
import { officialClassification, syntheticSource } from './support/evidence-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 020 SQLite dossier repository', () => {
  it('previews, explicitly confirms, publishes, traces, and no-ops deterministically', async () => {
    const { database } = await createInitializedDatabase();
    try {
      let sequence = 0;
      const evidence = new SqliteEvidenceRepository(database, () => `evidence-id-${++sequence}`);
      createReadyWorkEvidence(database, evidence);
      const dossiers = new SqliteDossierRepository(database, () => `dossier-id-${++sequence}`);
      const plan = dossiers.previewBuild({ id: 'work-dossier', type: 'WORK' }, DOSSIER_NOW);
      expect(plan).toMatchObject({
        counts: {
          claimCount: 3,
          conflictCount: 0,
          evidenceCount: 3,
          gapCount: 3,
        },
        estimatedModelRequests: 0,
        noOp: false,
        readinessAfter: 'READY_FOR_CONTENT_BRIEF',
      });
      const confirmed = dossiers.confirmBuild(
        plan.planId,
        plan.planHash,
        'execution-initial',
        '2026-07-29T04:00:10.000Z',
      );
      expect(confirmed.enqueue).toBe(true);
      const published = dossiers.executeBuild(confirmed.payload, '2026-07-29T04:00:20.000Z');
      expect(published).toMatchObject({ noOp: false });
      expect(published.versionId).not.toBeNull();
      expect(dossiers.executeBuild(confirmed.payload, '2026-07-29T04:00:30.000Z')).toMatchObject({
        noOp: false,
        versionId: published.versionId,
      });

      const list = dossiers.listDossiers();
      expect(list).toMatchObject({ total: 1 });
      expect(list.items[0]?.dossier).toMatchObject({
        currentVersionNumber: 1,
        readiness: 'READY_FOR_CONTENT_BRIEF',
        state: 'CURRENT',
      });
      const detail = dossiers.getDossierDetail(plan.dossierId);
      expect(detail.sections).toHaveLength(10);
      expect(detail.entries.filter((entry) => entry.entryKind === 'CONSENSUS')).toHaveLength(3);
      expect(detail.gaps).toHaveLength(3);
      expect(detail.coverage).toMatchObject({
        optionalBasisPoints: 0,
        overallBasisPoints: 6500,
        requiredBasisPoints: 10_000,
      });
      expect(detail.entries.every((entry) => entry.sourceRevisionIds.length === 1)).toBe(true);

      const noOpPlan = dossiers.previewBuild(
        { id: 'work-dossier', type: 'WORK' },
        '2026-07-29T04:01:00.000Z',
      );
      expect(noOpPlan.noOp).toBe(true);
      const noOp = dossiers.confirmBuild(
        noOpPlan.planId,
        noOpPlan.planHash,
        'execution-no-op',
        '2026-07-29T04:01:10.000Z',
      );
      expect(noOp).toMatchObject({ enqueue: false, payload: null });
      expect(noOp.run.status).toBe('NO_OP');
      expect(
        database.prepare('SELECT count(*) AS count FROM research_dossier_versions').get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('precisely invalidates related Source revisions and preserves unrelated dossiers', async () => {
    const { database } = await createInitializedDatabase();
    try {
      let sequence = 0;
      const evidence = new SqliteEvidenceRepository(database, () => `evidence-id-${++sequence}`);
      createReadyWorkEvidence(database, evidence);
      const dossiers = new SqliteDossierRepository(database, () => `dossier-id-${++sequence}`);
      const plan = dossiers.previewBuild({ id: 'work-dossier', type: 'WORK' }, DOSSIER_NOW);
      const confirmed = dossiers.confirmBuild(
        plan.planId,
        plan.planHash,
        'execution-invalidation',
        '2026-07-29T04:00:10.000Z',
      );
      dossiers.executeBuild(confirmed.payload, '2026-07-29T04:00:20.000Z');

      evidence.registerSource(
        syntheticSource(
          'source-unrelated',
          '无关来源第一版',
          officialClassification('unrelated-group'),
        ),
      );
      evidence.addSourceRevision({
        availability: 'AVAILABLE',
        classification: officialClassification('unrelated-group'),
        contentHash: '2'.repeat(64),
        createdAt: '2026-07-29T04:02:00.000Z',
        extractedTextHash: '2'.repeat(64),
        extractedTextPath: `sources/snapshots/22/${'2'.repeat(64)}.txt`,
        language: 'zh-CN',
        originKind: 'SYNTHETIC_FIXTURE',
        originRecordId: 'fixture-unrelated',
        originRevision: 2,
        publishedAt: null,
        publishedAtPrecision: 'UNKNOWN',
        revision: 2,
        sourceId: 'source-unrelated',
        warnings: ['SYNTHETIC_TEST_FIXTURE'],
      });
      expect(dossiers.listDossiers().items[0]?.dossier.state).toBe('CURRENT');

      evidence.addSourceRevision({
        availability: 'AVAILABLE',
        classification: officialClassification('source-title'),
        contentHash: '3'.repeat(64),
        createdAt: '2026-07-29T04:03:00.000Z',
        extractedTextHash: '3'.repeat(64),
        extractedTextPath: `sources/snapshots/33/${'3'.repeat(64)}.txt`,
        language: 'ja-JP',
        originKind: 'SYNTHETIC_FIXTURE',
        originRecordId: 'fixture-source-title',
        originRevision: 2,
        publishedAt: null,
        publishedAtPrecision: 'UNKNOWN',
        revision: 2,
        sourceId: 'source-title',
        warnings: ['SYNTHETIC_TEST_FIXTURE'],
      });
      expect(dossiers.listDossiers().items[0]?.dossier).toMatchObject({
        readiness: 'BUILD_REQUIRED',
        state: 'REBUILD_REQUIRED',
      });
      expect(
        database
          .prepare(
            `SELECT count(DISTINCT dossier_id) AS dossier_count,
                    count(DISTINCT event_identity) AS event_count
             FROM research_dossier_invalidations`,
          )
          .get(),
      ).toMatchObject({ dossier_count: 1 });
    } finally {
      database.close();
    }
  });

  it('rejects stale confirmation and keeps current version on cancellation/failure', async () => {
    const { database } = await createInitializedDatabase();
    try {
      let sequence = 0;
      const evidence = new SqliteEvidenceRepository(database, () => `evidence-id-${++sequence}`);
      createReadyWorkEvidence(database, evidence);
      const dossiers = new SqliteDossierRepository(database, () => `dossier-id-${++sequence}`);
      const stale = dossiers.previewBuild({ id: 'work-dossier', type: 'WORK' }, DOSSIER_NOW);
      database
        .prepare(
          `UPDATE research_dossiers SET revision = revision + 1
           WHERE id = ?`,
        )
        .run(stale.dossierId);
      expect(() =>
        dossiers.confirmBuild(
          stale.planId,
          stale.planHash,
          'execution-stale',
          '2026-07-29T04:00:10.000Z',
        ),
      ).toThrow(/DOSSIER_STALE_REVISION/u);

      const plan = dossiers.previewBuild(
        { id: 'work-dossier', type: 'WORK' },
        '2026-07-29T04:01:00.000Z',
      );
      const confirmed = dossiers.confirmBuild(
        plan.planId,
        plan.planHash,
        'execution-cancel',
        '2026-07-29T04:01:10.000Z',
      );
      const cancelled = dossiers.cancelExecution('execution-cancel', '2026-07-29T04:01:20.000Z');
      expect(cancelled.status).toBe('CANCELLED');
      expect(dossiers.getDossierDetail(plan.dossierId).dossier.currentVersionId).toBeNull();
      expect(confirmed.run.externalRequestCount).toBe(0);
      expect(confirmed.run.costState).toBe('NOT_INCURRED');
    } finally {
      database.close();
    }
  });

  it('rejects a stale publish race and preserves the last current version', async () => {
    const { database } = await createInitializedDatabase();
    try {
      let sequence = 0;
      const evidence = new SqliteEvidenceRepository(database, () => `evidence-id-${++sequence}`);
      createReadyWorkEvidence(database, evidence);
      const dossiers = new SqliteDossierRepository(database, () => `dossier-id-${++sequence}`);
      const initialPlan = dossiers.previewBuild({ id: 'work-dossier', type: 'WORK' }, DOSSIER_NOW);
      const initial = dossiers.confirmBuild(
        initialPlan.planId,
        initialPlan.planHash,
        'execution-race-initial',
        '2026-07-29T04:00:10.000Z',
      );
      dossiers.executeBuild(initial.payload, '2026-07-29T04:00:20.000Z');
      const currentVersionId = dossiers.getDossierDetail(initialPlan.dossierId).dossier
        .currentVersionId;

      const addRevision = (revision: number, createdAt: string): void => {
        const hash = String(revision).repeat(64);
        evidence.addSourceRevision({
          availability: 'AVAILABLE',
          classification: officialClassification('source-title'),
          contentHash: hash,
          createdAt,
          extractedTextHash: hash,
          extractedTextPath: `sources/snapshots/${String(revision).repeat(2)}/${hash}.txt`,
          language: 'ja-JP',
          originKind: 'SYNTHETIC_FIXTURE',
          originRecordId: 'fixture-source-title',
          originRevision: revision,
          publishedAt: null,
          publishedAtPrecision: 'UNKNOWN',
          revision,
          sourceId: 'source-title',
          warnings: ['SYNTHETIC_TEST_FIXTURE'],
        });
      };
      addRevision(2, '2026-07-29T04:01:00.000Z');
      const rebuild = dossiers.previewBuild(
        { id: 'work-dossier', type: 'WORK' },
        '2026-07-29T04:01:10.000Z',
      );
      const confirmed = dossiers.confirmBuild(
        rebuild.planId,
        rebuild.planHash,
        'execution-race',
        '2026-07-29T04:01:20.000Z',
      );
      expect(() =>
        dossiers.previewBuild({ id: 'work-dossier', type: 'WORK' }, '2026-07-29T04:01:25.000Z'),
      ).toThrow(/DOSSIER_CONFLICT/u);
      addRevision(3, '2026-07-29T04:01:30.000Z');
      expect(() => dossiers.executeBuild(confirmed.payload, '2026-07-29T04:01:40.000Z')).toThrow(
        /DOSSIER_INPUT_CHANGED/u,
      );
      const after = dossiers.getDossierDetail(initialPlan.dossierId);
      expect(after.dossier.currentVersionId).toBe(currentVersionId);
      expect(after.versions).toHaveLength(1);
      expect(after.runs.find((run) => run.executionId === 'execution-race')?.status).toBe('FAILED');
    } finally {
      database.close();
    }
  });

  it('invalidates only the changed catalog subject and its descendants', async () => {
    const { database } = await createInitializedDatabase();
    try {
      let sequence = 0;
      const evidence = new SqliteEvidenceRepository(database, () => `evidence-id-${++sequence}`);
      createReadyWorkEvidence(database, evidence);
      database
        .prepare(
          `INSERT INTO expressions(
             id, work_id, expression_kind, canonical_title, normalized_title,
             language, catalog_state, revision, created_at, updated_at
           ) VALUES (
             'expression-dossier', 'work-dossier', 'TRANSLATION',
             'Synthetic Expression', 'synthetic expression', 'en-US',
             'ACTIVE', 1, '2026-07-29T04:00:00.000Z', '2026-07-29T04:00:00.000Z'
           )`,
        )
        .run();
      evidence.registerSubject('EXPRESSION', 'expression-dossier');
      const dossiers = new SqliteDossierRepository(database, () => `dossier-id-${++sequence}`);
      const publish = (
        subject: { readonly id: string; readonly type: 'EXPRESSION' | 'WORK' },
        executionId: string,
        offset: number,
      ): string => {
        const plan = dossiers.previewBuild(
          subject,
          `2026-07-29T04:${String(offset).padStart(2, '0')}:00.000Z`,
        );
        const confirmed = dossiers.confirmBuild(
          plan.planId,
          plan.planHash,
          executionId,
          `2026-07-29T04:${String(offset).padStart(2, '0')}:10.000Z`,
        );
        dossiers.executeBuild(
          confirmed.payload,
          `2026-07-29T04:${String(offset).padStart(2, '0')}:20.000Z`,
        );
        return plan.dossierId;
      };
      const workDossierId = publish({ id: 'work-dossier', type: 'WORK' }, 'execution-work', 0);
      const expressionDossierId = publish(
        { id: 'expression-dossier', type: 'EXPRESSION' },
        'execution-expression',
        1,
      );

      database
        .prepare(
          `UPDATE expressions
           SET revision = revision + 1, updated_at = '2026-07-29T04:02:00.000Z'
           WHERE id = 'expression-dossier'`,
        )
        .run();
      expect(dossiers.getDossierDetail(expressionDossierId).dossier).toMatchObject({
        readiness: 'BUILD_REQUIRED',
        state: 'REBUILD_REQUIRED',
      });
      expect(dossiers.getDossierDetail(workDossierId).dossier.state).toBe('CURRENT');
      expect(
        database
          .prepare(
            `SELECT dependency_type, dependency_id
             FROM research_dossier_invalidations
             WHERE dossier_id = ?`,
          )
          .all(expressionDossierId),
      ).toContainEqual({
        dependency_id: 'EXPRESSION:expression-dossier',
        dependency_type: 'SUBJECT',
      });
    } finally {
      database.close();
    }
  });
});
