import { afterEach, describe, expect, it } from 'vitest';

import { COPY_PROTECTED_TABLES } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { createReadyCopyRepositoryFixture, requiredFixtureValue } from './support/copy-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 025 SQLite copy repository', () => {
  it('creates, edits, locks, undoes, archives and restores immutable versions', async () => {
    const { database } = await createInitializedDatabase('copy repository');
    try {
      const fixture = createReadyCopyRepositoryFixture(database);
      expect(fixture.created).toMatchObject({
        revision: 0,
        state: 'ACTIVE',
        status: 'READY_FOR_QUALITY_PIPELINE',
        versionNumber: 1,
      });
      const selectedId = requiredFixtureValue(
        fixture.created.payload.selectedTitleId,
        'selected title',
      );
      const editedPayload = {
        ...fixture.created.payload,
        titles: fixture.created.payload.titles.map((title) =>
          title.titleId === selectedId ? { ...title, text: `${title.text}（用户编辑）` } : title,
        ),
      };
      const edited = fixture.copy.saveVersion(
        fixture.created.draftId,
        fixture.created.revision,
        editedPayload,
        ['USER_EDIT'],
        '2026-07-30T14:00:01.000Z',
      );
      expect(edited).toMatchObject({ revision: 1, versionNumber: 2 });
      const locked = fixture.copy.changeFieldLock(
        edited.draftId,
        edited.revision,
        'selectedTitle',
        'USER_LOCKED',
        '2026-07-30T14:00:02.000Z',
      );
      expect(locked.payload.fieldStates.find(({ path }) => path === 'selectedTitle')?.lock).toBe(
        'USER_LOCKED',
      );
      expect(() =>
        fixture.copy.saveVersion(
          locked.draftId,
          locked.revision,
          {
            ...locked.payload,
            titles: locked.payload.titles.map((title) =>
              title.titleId === locked.payload.selectedTitleId
                ? { ...title, text: '试图覆盖锁定标题' }
                : title,
            ),
          },
          ['USER_EDIT'],
          '2026-07-30T14:00:03.000Z',
        ),
      ).toThrow(/COPY_LOCKED_FIELD/u);
      const unlocked = fixture.copy.changeFieldLock(
        locked.draftId,
        locked.revision,
        'selectedTitle',
        'EDITABLE',
        '2026-07-30T14:00:04.000Z',
      );
      const first = requiredFixtureValue(
        unlocked.versionHistory.items.find(({ versionNumber }) => versionNumber === 1),
        'first Draft version',
      );
      const undone = fixture.copy.undo(
        unlocked.draftId,
        unlocked.revision,
        first.versionId,
        '2026-07-30T14:00:05.000Z',
      );
      expect(undone.versionNumber).toBe(5);
      const archived = fixture.copy.setArchived(
        undone.draftId,
        undone.revision,
        true,
        '2026-07-30T14:00:06.000Z',
      );
      expect(archived.state).toBe('ARCHIVED');
      const restored = fixture.copy.setArchived(
        archived.draftId,
        archived.revision,
        false,
        '2026-07-30T14:00:07.000Z',
      );
      expect(restored.state).toBe('ACTIVE');
      expect(restored.versionHistory.total).toBe(5);
      const diff = fixture.copy.diffVersions(
        restored.draftId,
        first.versionId,
        requiredFixtureValue(
          edited.versionHistory.items.find(({ isCurrent }) => isCurrent),
          'edited current Draft version',
        ).versionId,
      );
      expect(diff.changedFields).toContain('titles');
    } finally {
      database.close();
    }
  });

  it('binds mutation plans, blocks unsupported capability/budget and preserves idempotency', async () => {
    const { database } = await createInitializedDatabase('copy mutation repository');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'copy-plan');
      const blocked = fixture.copy.previewMutation({
        budgetState: 'AVAILABLE',
        capabilityState: 'UNKNOWN',
        draftId: fixture.created.draftId,
        expectedRevision: fixture.created.revision,
        expiresAt: '2026-07-30T14:10:00.000Z',
        now: '2026-07-30T14:00:01.000Z',
        operation: 'FULL_GENERATION',
      });
      expect(() =>
        fixture.copy.confirmMutation(
          blocked.planId,
          blocked.previewHash,
          'blocked-execution',
          '2026-07-30T14:00:02.000Z',
        ),
      ).toThrow(/COPY_GENERATION_BLOCKED/u);
      const plan = fixture.copy.previewMutation({
        budgetState: 'AVAILABLE',
        capabilityState: 'SUPPORTED',
        draftId: fixture.created.draftId,
        expectedRevision: fixture.created.revision,
        expiresAt: '2026-07-30T14:10:00.000Z',
        now: '2026-07-30T14:00:03.000Z',
        operation: 'FULL_GENERATION',
      });
      const first = fixture.copy.confirmMutation(
        plan.planId,
        plan.previewHash,
        'idempotent-execution',
        '2026-07-30T14:00:04.000Z',
      );
      const replay = fixture.copy.confirmMutation(
        plan.planId,
        plan.previewHash,
        'idempotent-execution',
        '2026-07-30T14:00:05.000Z',
      );
      expect(replay.run.runId).toBe(first.run.runId);
      expect(replay.payload).toEqual(first.payload);
    } finally {
      database.close();
    }
  });

  it('cancels before send, pauses safe restart and marks after-send restart ambiguous', async () => {
    const { database } = await createInitializedDatabase('copy recovery repository');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'copy-recovery');
      const firstPlan = fixture.copy.previewMutation({
        budgetState: 'AVAILABLE',
        capabilityState: 'SUPPORTED',
        draftId: fixture.created.draftId,
        expectedRevision: fixture.created.revision,
        expiresAt: '2026-07-30T14:10:00.000Z',
        now: '2026-07-30T14:00:01.000Z',
        operation: 'FULL_GENERATION',
      });
      const first = fixture.copy.confirmMutation(
        firstPlan.planId,
        firstPlan.previewHash,
        'cancel-before-send',
        '2026-07-30T14:00:02.000Z',
      );
      expect(
        fixture.copy.cancelMutation(first.run.runId, '2026-07-30T14:00:03.000Z').run,
      ).toMatchObject({
        costState: 'NOT_INCURRED',
        externalRequestCount: 0,
        status: 'CANCELLED',
      });

      const secondPlan = fixture.copy.previewMutation({
        budgetState: 'AVAILABLE',
        capabilityState: 'SUPPORTED',
        draftId: fixture.created.draftId,
        expectedRevision: fixture.created.revision,
        expiresAt: '2026-07-30T14:10:00.000Z',
        now: '2026-07-30T14:00:04.000Z',
        operation: 'FULL_GENERATION',
      });
      fixture.copy.confirmMutation(
        secondPlan.planId,
        secondPlan.previewHash,
        'restart-execution',
        '2026-07-30T14:00:05.000Z',
      );
      expect(fixture.copy.recoverInterrupted('2026-07-30T14:00:06.000Z')).toEqual({
        ambiguous: 0,
        paused: 1,
      });
      expect(fixture.copy.loadMutationExecution('restart-execution').run.status).toBe('PAUSED');
      fixture.copy.markMutationRunning('restart-execution', '2026-07-30T14:00:07.000Z');
      expect(fixture.copy.recoverInterrupted('2026-07-30T14:00:08.000Z')).toEqual({
        ambiguous: 1,
        paused: 0,
      });
      expect(fixture.copy.loadMutationExecution('restart-execution').run).toMatchObject({
        costState: 'UNKNOWN_POSSIBLY_INCURRED',
        status: 'AMBIGUOUS',
      });
    } finally {
      database.close();
    }
  });

  it('rejects confirmation when current Draft revision changed after preview', async () => {
    const { database } = await createInitializedDatabase('copy stale preview');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'copy-stale-preview');
      const plan = fixture.copy.previewMutation({
        budgetState: 'AVAILABLE',
        capabilityState: 'SUPPORTED',
        draftId: fixture.created.draftId,
        expectedRevision: fixture.created.revision,
        expiresAt: '2026-07-30T14:10:00.000Z',
        now: '2026-07-30T14:00:01.000Z',
        operation: 'FULL_GENERATION',
      });
      fixture.copy.saveVersion(
        fixture.created.draftId,
        fixture.created.revision,
        {
          ...fixture.created.payload,
          titles: fixture.created.payload.titles.map((title, index) =>
            index === 0 ? { ...title, text: `${title.text} · 并发编辑` } : title,
          ),
        },
        ['USER_EDIT'],
        '2026-07-30T14:00:02.000Z',
      );
      expect(() =>
        fixture.copy.confirmMutation(
          plan.planId,
          plan.previewHash,
          'stale-execution',
          '2026-07-30T14:00:03.000Z',
        ),
      ).toThrow(/COPY_GENERATION_BLOCKED/u);
    } finally {
      database.close();
    }
  });

  it('invalidates only matching current dependencies and never writes downstream tables', async () => {
    const { database } = await createInitializedDatabase('copy invalidation');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'copy-invalidation');
      const dependency = requiredFixtureValue(
        fixture.created.payload.brief.dependencies.at(0),
        'first Draft dependency',
      );
      expect(
        fixture.copy.invalidateDependency({
          dependencyId: dependency.dependencyId,
          dependencyType: dependency.dependencyType,
          observedRevision: '2',
          reasonCode: 'DEPENDENCY_CHANGED',
          now: '2026-07-30T14:00:01.000Z',
        }),
      ).toBe(1);
      expect(
        fixture.copy.invalidateDependency({
          dependencyId: 'unrelated',
          dependencyType: dependency.dependencyType,
          observedRevision: '2',
          reasonCode: 'DEPENDENCY_CHANGED',
          now: '2026-07-30T14:00:02.000Z',
        }),
      ).toBe(0);
      expect(fixture.copy.get(fixture.created.draftId).status).toBe('STALE');
      for (const table of COPY_PROTECTED_TABLES) {
        expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
          count: 0,
        });
      }
    } finally {
      database.close();
    }
  });

  it('uses indexed list and dependency lookup paths', async () => {
    const { database } = await createInitializedDatabase('copy query plan');
    try {
      createReadyCopyRepositoryFixture(database, 'copy-query');
      const dependencyPlan = database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT draft_id, version_id FROM content_draft_dependencies
           WHERE dependency_type = ? AND dependency_id = ?`,
        )
        .all('TOPIC_VERSION', 'topic-version') as unknown as readonly {
        readonly detail: string;
      }[];
      expect(
        dependencyPlan.some(({ detail }) => detail.includes('idx_content_draft_dependency_lookup')),
      ).toBe(true);
    } finally {
      database.close();
    }
  });
});
