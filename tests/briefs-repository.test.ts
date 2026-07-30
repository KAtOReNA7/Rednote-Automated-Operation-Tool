import { afterEach, describe, expect, it } from 'vitest';

import { CONTENT_BRIEF_PROFILE_REGISTRY_VERSION } from '../packages/briefs/src/index.js';
import { SqliteBriefRepository, SqliteTopicRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  BRIEF_NOW,
  completeBriefDraft,
  createRepositoryScaffoldFixture,
} from './support/brief-fixtures.js';
import { createExperimentRepositoryFixture } from './support/experiment-repository-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 024 SQLite Brief repository', () => {
  it('creates, edits, locks, undoes, clones, archives and restores immutable versions', async () => {
    const { database } = await createInitializedDatabase('brief repository');
    try {
      let sequence = 0;
      const repository = new SqliteBriefRepository(database, () => `brief-id-${++sequence}`);
      const fixture = createRepositoryScaffoldFixture(database);
      const created = repository.createScaffold(
        fixture.input,
        fixture.context,
        fixture.dependencies,
        BRIEF_NOW,
      );
      const primarySubject = fixture.input.subjects.at(0);
      expect(primarySubject).toBeDefined();
      if (primarySubject === undefined) throw new Error('expected primary subject');
      expect(created).toMatchObject({
        readiness: 'EVIDENCE_MAPPING_INCOMPLETE',
        revision: 1,
        versionNumber: 1,
      });
      expect(created.versionHistory.total).toBe(1);
      expect(created.draft.evidenceMap).toHaveLength(0);
      expect(created.draft.fieldStates).toHaveLength(20);
      expect(created.dependencies).toHaveLength(7);
      expect(created.dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dependencyId: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
            dependencyType: 'PROFILE_POLICY',
          }),
          expect.objectContaining({
            dependencyId: primarySubject.workId,
            dependencyType: 'WORK_IDENTITY',
            observedRevision: '1',
          }),
          expect.objectContaining({
            dependencyType: 'READING_STATE',
          }),
          expect.objectContaining({
            dependencyType: 'DOSSIER_VERSION',
          }),
        ]),
      );
      expect(
        repository.list({
          limit: 25,
          offset: 0,
          profileId: null,
          query: '',
          readiness: null,
          state: null,
        }).total,
      ).toBe(1);
      expect(
        repository.get(created.briefId, {
          evidenceLimit: 1,
          evidenceOffset: 0,
          generationLimit: 1,
          generationOffset: 0,
          historyLimit: 1,
          historyOffset: 0,
          versionLimit: 1,
          versionOffset: 0,
        }),
      ).toMatchObject({
        evidencePage: { items: [], limit: 1, offset: 0, total: 0 },
        generationPage: { limit: 1, offset: 0, total: 0 },
        historyPage: { limit: 1, offset: 0, total: 1 },
        versionHistory: { limit: 1, offset: 0, total: 1 },
      });

      const saved = repository.saveDraft(
        created.briefId,
        created.revision,
        completeBriefDraft(created.draft),
        fixture.context,
        '2026-07-30T12:00:02.000Z',
      );
      expect(saved).toMatchObject({
        readiness: 'READY_FOR_DRAFT_GENERATION',
        revision: 2,
        versionNumber: 2,
      });

      const locked = repository.changeFieldLock(
        saved.briefId,
        saved.revision,
        'coreJudgment',
        'USER_LOCKED',
        '2026-07-30T12:00:03.000Z',
      );
      expect(locked.draft.fieldStates.find((field) => field.path === 'coreJudgment')).toMatchObject(
        { lock: 'USER_LOCKED', provenance: 'USER_CONFIRMED' },
      );
      expect(() =>
        repository.saveDraft(
          locked.briefId,
          locked.revision,
          {
            ...locked.draft,
            coreJudgment: { ...locked.draft.coreJudgment, statement: '覆盖锁定判断' },
          },
          fixture.context,
          '2026-07-30T12:00:04.000Z',
        ),
      ).toThrow(/BRIEF_LOCKED_FIELD/iu);

      const firstVersion = saved.versionHistory.items.find(
        (version) => version.versionNumber === 1,
      );
      const completedVersion = saved.versionHistory.items.find(
        (version) => version.versionNumber === 2,
      );
      expect(firstVersion).toBeDefined();
      expect(completedVersion).toBeDefined();
      if (firstVersion === undefined || completedVersion === undefined) {
        throw new Error('expected immutable version history');
      }
      const undone = repository.undo(
        locked.briefId,
        locked.revision,
        firstVersion.versionId,
        '2026-07-30T12:00:05.000Z',
      );
      expect(undone.versionNumber).toBe(4);
      expect(undone.readiness).toBe('EVIDENCE_MAPPING_INCOMPLETE');
      const cloned = repository.cloneVersion(
        undone.briefId,
        undone.revision,
        completedVersion.versionId,
        '2026-07-30T12:00:05.500Z',
      );
      expect(cloned).toMatchObject({
        readiness: 'READY_FOR_DRAFT_GENERATION',
        versionNumber: 5,
      });
      const archived = repository.setArchived(
        cloned.briefId,
        cloned.revision,
        true,
        '2026-07-30T12:00:06.000Z',
      );
      expect(archived.state).toBe('ARCHIVED');
      expect(
        repository.setArchived(
          archived.briefId,
          archived.revision,
          false,
          '2026-07-30T12:00:07.000Z',
        ).state,
      ).toBe('ACTIVE');
    } finally {
      database.close();
    }
  });

  it('marks only matching dependencies stale and preserves the historical payload', async () => {
    const { database } = await createInitializedDatabase('brief invalidation');
    try {
      let sequence = 0;
      const repository = new SqliteBriefRepository(database, () => `invalidation-${++sequence}`);
      const fixture = createRepositoryScaffoldFixture(database);
      const created = repository.createScaffold(
        fixture.input,
        fixture.context,
        fixture.dependencies,
        BRIEF_NOW,
      );
      const before = JSON.stringify(created.draft);
      expect(
        repository.invalidateDependency({
          createdAt: '2026-07-30T12:01:00.000Z',
          dependencyId: fixture.input.topicVersionId,
          dependencyType: 'TOPIC_VERSION',
          eventIdentity: 'topic-version-changed',
          observedRevision: '2',
          reasonCode: 'TOPIC_VERSION_CHANGED',
        }),
      ).toBe(1);
      const stale = repository.get(created.briefId);
      expect(stale.readiness).toBe('STALE');
      expect(JSON.stringify(stale.draft)).toBe(before);
      expect(
        repository.invalidateDependency({
          createdAt: '2026-07-30T12:01:01.000Z',
          dependencyId: 'unrelated',
          dependencyType: 'TOPIC_VERSION',
          eventIdentity: 'unrelated-change',
          observedRevision: '2',
          reasonCode: 'TOPIC_VERSION_CHANGED',
        }),
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it('automatically invalidates only the Brief bound to a changed Topic version', async () => {
    const { database } = await createInitializedDatabase('brief trigger invalidation');
    try {
      let sequence = 0;
      const repository = new SqliteBriefRepository(database, () => `trigger-${++sequence}`);
      const fixture = createRepositoryScaffoldFixture(database);
      const created = repository.createScaffold(
        fixture.input,
        fixture.context,
        fixture.dependencies,
        BRIEF_NOW,
      );
      const topics = new SqliteTopicRepository(database, () => `topic-trigger-${++sequence}`);
      const changed = topics.applyStateChange(
        topics.previewStateChange({
          action: 'HOLD',
          expectedRevision: 2,
          topicId: fixture.input.topicId,
        }),
        '2026-07-30T12:02:00.000Z',
      );
      expect(changed.candidateState).toBe('HELD');
      expect(repository.get(created.briefId)).toMatchObject({
        readiness: 'STALE',
        readinessReasonCodes: expect.arrayContaining(['TOPIC_CHANGED']),
      });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM content_brief_invalidations
             WHERE brief_id = ?`,
          )
          .get(created.briefId),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('invalidates a Brief only when its bound Work identity changes', async () => {
    const { database } = await createInitializedDatabase('brief work identity invalidation');
    try {
      let sequence = 0;
      const repository = new SqliteBriefRepository(database, () => `work-trigger-${++sequence}`);
      const fixture = createRepositoryScaffoldFixture(database);
      const created = repository.createScaffold(
        fixture.input,
        fixture.context,
        fixture.dependencies,
        BRIEF_NOW,
      );
      const primarySubject = fixture.input.subjects.at(0);
      expect(primarySubject).toBeDefined();
      if (primarySubject === undefined) throw new Error('expected primary subject');
      database
        .prepare(
          `INSERT INTO books(
             id, canonical_title, work_type, discovery_status, created_at, updated_at
           ) VALUES (?, ?, 'NOVEL', 'SYNTHETIC', ?, ?)`,
        )
        .run(
          'unrelated-brief-work',
          '无关合成作品',
          '2026-07-30T12:10:00.000Z',
          '2026-07-30T12:10:00.000Z',
        );
      database
        .prepare(
          `UPDATE books
           SET catalog_revision = catalog_revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run('2026-07-30T12:10:01.000Z', 'unrelated-brief-work');
      expect(repository.get(created.briefId).stale).toBe(false);

      database
        .prepare(
          `UPDATE books
           SET catalog_revision = catalog_revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run('2026-07-30T12:10:02.000Z', primarySubject.workId);
      expect(repository.get(created.briefId)).toMatchObject({
        readiness: 'STALE',
        readinessReasonCodes: expect.arrayContaining(['WORK_IDENTITY_CHANGED']),
      });
    } finally {
      database.close();
    }
  });

  it('derives an optional current locked Experiment assignment from SQLite identities', async () => {
    const fixture = await createExperimentRepositoryFixture('brief experiment binding', 8);
    try {
      const topics = new SqliteTopicRepository(fixture.database, () => crypto.randomUUID());
      for (const topicId of fixture.topicIds) {
        const revision = (
          fixture.database
            .prepare('SELECT topic_revision AS revision FROM topics WHERE id = ?')
            .get(topicId) as { readonly revision: number }
        ).revision;
        topics.applyStateChange(
          topics.previewStateChange({
            action: 'LOCK',
            expectedRevision: revision,
            topicId,
          }),
          '2026-07-30T12:35:00.000Z',
        );
      }
      const experiment = fixture.repository.createDraft(
        'primary',
        fixture.design,
        '2026-07-30T12:35:01.000Z',
      );
      fixture.repository.saveAssignment(
        fixture.repository.previewAssignment(experiment.experimentId),
        '2026-07-30T12:35:02.000Z',
      );
      fixture.repository.applyAction(
        fixture.repository.previewAction(experiment.experimentId, 'LOCK', 2),
        '2026-07-30T12:35:03.000Z',
      );
      const assignmentPlanId = (
        fixture.database
          .prepare(
            `SELECT current.assignment_plan_id
             FROM experiment_current_assignments AS current
             JOIN experiment_current_designs AS design
               ON design.design_version_id = current.design_version_id
             WHERE design.experiment_id = ?`,
          )
          .get(experiment.experimentId) as { readonly assignment_plan_id: string }
      ).assignment_plan_id;
      const briefs = new SqliteBriefRepository(fixture.database);
      const topicId = fixture.topicIds.at(0);
      expect(topicId).toBeDefined();
      if (topicId === undefined) throw new Error('expected assigned Topic');
      const scaffold = briefs.prepareScaffoldFromTopic(topicId, assignmentPlanId);
      expect(scaffold.experimentBinding).toMatchObject({
        assignmentCurrent: true,
        assignmentPlanId,
        designCurrent: true,
        experimentId: experiment.experimentId,
        experimentLocked: true,
        experimentStale: false,
        topicId: fixture.topicIds[0],
      });
      expect(scaffold.experimentBinding?.controlledConditions.length).toBeGreaterThan(0);
    } finally {
      fixture.database.close();
    }
  });
});
