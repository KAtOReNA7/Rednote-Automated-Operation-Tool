import { afterEach, describe, expect, it } from 'vitest';

import { SqliteAuthenticityRepository, SqliteTopicRepository } from '../packages/db/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import { popularitySnapshot } from './support/experiment-fixtures.js';
import { createExperimentRepositoryFixture } from './support/experiment-repository-fixtures.js';
import { insertTopicReadyWork } from './support/topic-fixtures.js';

afterEach(cleanTemporaryDatabases);

async function createAssigned(label: string) {
  const fixture = await createExperimentRepositoryFixture(label);
  const created = fixture.repository.createDraft(
    'primary',
    fixture.design,
    '2026-07-30T10:00:00.000Z',
  );
  const assigned = fixture.repository.saveAssignment(
    fixture.repository.previewAssignment(created.experimentId),
    '2026-07-30T10:01:00.000Z',
  );
  return { assigned, fixture };
}

describe('M3 Issue 023 precise experiment invalidation', () => {
  it('ignores unrelated Work changes and marks only the related assignment stale without rebuilding it', async () => {
    const { assigned, fixture } = await createAssigned('experiment work invalidation');
    try {
      const authenticity = new SqliteAuthenticityRepository(fixture.database, () =>
        crypto.randomUUID(),
      );
      insertTopicReadyWork(fixture.database, authenticity, {
        workId: 'experiment-unrelated-work',
      });
      fixture.database
        .prepare(
          `UPDATE books
           SET catalog_revision = catalog_revision + 1,
               updated_at = '2026-07-30T10:02:00.000Z'
           WHERE id = 'experiment-unrelated-work'`,
        )
        .run();
      expect(
        fixture.database.prepare('SELECT count(*) AS count FROM experiment_invalidations').get(),
      ).toEqual({ count: 0 });

      const beforePointer = fixture.database
        .prepare(
          `SELECT current.design_version_id, assignment.assignment_plan_id
           FROM experiment_current_designs AS current
           JOIN experiment_current_assignments AS assignment
             ON assignment.design_version_id = current.design_version_id
           WHERE current.experiment_id = ?`,
        )
        .get(assigned.experimentId);
      const beforeAssignment = assigned.assignment?.assignmentHash;
      fixture.database
        .prepare(
          `UPDATE books
           SET catalog_revision = catalog_revision + 1,
               updated_at = '2026-07-30T10:03:00.000Z'
           WHERE id = 'experiment-work-1'`,
        )
        .run();
      const stale = fixture.repository.get(assigned.experimentId);
      expect(stale).toMatchObject({
        assignmentStatus: 'STALE',
        stale: true,
        state: 'STALE',
      });
      expect(stale.invalidationReasons).toContain('WORK_IDENTITY_CHANGED');
      expect(stale.assignment?.assignmentHash).toBe(beforeAssignment);
      expect(
        fixture.database
          .prepare(
            `SELECT current.design_version_id, assignment.assignment_plan_id
             FROM experiment_current_designs AS current
             JOIN experiment_current_assignments AS assignment
               ON assignment.design_version_id = current.design_version_id
             WHERE current.experiment_id = ?`,
          )
          .get(assigned.experimentId),
      ).toEqual(beforePointer);
    } finally {
      fixture.database.close();
    }
  });

  it('propagates Dossier and expression-permission invalidations through exact dependencies', async () => {
    const { assigned, fixture } = await createAssigned('experiment source invalidation');
    try {
      const dossier = fixture.database
        .prepare(
          `SELECT dependency.dependency_id AS version_id, version.dossier_id
           FROM experiment_dependencies AS dependency
           JOIN research_dossier_versions AS version
             ON version.id = dependency.dependency_id
           WHERE dependency.design_version_id = ?
             AND dependency.dependency_type = 'DOSSIER_VERSION'
           LIMIT 1`,
        )
        .get(assigned.designVersionId) as
        { readonly dossier_id: string; readonly version_id: string } | undefined;
      if (dossier === undefined) throw new Error('Missing synthetic Dossier dependency.');
      fixture.database
        .prepare(
          `INSERT INTO research_dossier_invalidations(
             id, event_identity, dossier_id, current_version_id, dependency_type,
             dependency_id, observed_revision, reason_code, created_at
           ) VALUES (?, ?, ?, ?, 'SUBJECT', ?, '2', 'SYNTHETIC_DOSSIER_CHANGED', ?)`,
        )
        .run(
          'experiment-dossier-invalidation',
          'experiment-dossier-invalidation-event',
          dossier.dossier_id,
          dossier.version_id,
          dossier.dossier_id,
          '2026-07-30T10:02:00.000Z',
        );

      const permission = fixture.database
        .prepare(
          `SELECT dependency.dependency_id AS snapshot_id, snapshot.reading_state_id
           FROM experiment_dependencies AS dependency
           JOIN expression_permission_snapshots AS snapshot
             ON snapshot.id = dependency.dependency_id
           WHERE dependency.design_version_id = ?
             AND dependency.dependency_type = 'EXPRESSION_PERMISSION'
           LIMIT 1`,
        )
        .get(assigned.designVersionId) as
        { readonly reading_state_id: string; readonly snapshot_id: string } | undefined;
      if (permission === undefined) throw new Error('Missing synthetic permission dependency.');
      fixture.database
        .prepare(
          `INSERT INTO expression_permission_invalidations(
             id, event_identity, snapshot_id, reading_state_id, dependency_type,
             dependency_id, observed_revision, reason_code, created_at
           ) VALUES (?, ?, ?, ?, 'READING_STATE', ?, '2', 'READING_STATE_CHANGED', ?)`,
        )
        .run(
          'experiment-permission-invalidation',
          'experiment-permission-invalidation-event',
          permission.snapshot_id,
          permission.reading_state_id,
          permission.reading_state_id,
          '2026-07-30T10:03:00.000Z',
        );
      const stale = fixture.repository.get(assigned.experimentId);
      expect(stale.invalidationReasons).toEqual(
        expect.arrayContaining([
          'DOSSIER_CHANGED',
          'EXPRESSION_PERMISSION_CHANGED',
          'TOPIC_DEPENDENCY_CHANGED',
        ]),
      );
      expect(stale).toMatchObject({ assignmentStatus: 'STALE', stale: true, state: 'STALE' });
    } finally {
      fixture.database.close();
    }
  });

  it('invalidates an exact quota dependency when the current plan version changes', async () => {
    const fixture = await createExperimentRepositoryFixture('experiment quota invalidation');
    try {
      const topics = new SqliteTopicRepository(fixture.database, () => crypto.randomUUID());
      const plan = topics.confirmQuotaPlan(
        topics.previewQuotaPlan('primary', 3),
        '2026-07-30T10:00:00.000Z',
      );
      const design = {
        ...fixture.design,
        samplePlan: {
          ...fixture.design.samplePlan,
          quotaPlanVersionId: plan.planVersionId,
        },
      };
      const created = fixture.repository.createDraft('primary', design, '2026-07-30T10:01:00.000Z');
      fixture.database
        .prepare(
          `INSERT INTO topic_quota_plan_versions(
             id, root_id, version_number, previous_version_id, quota_profile_id,
             pool_snapshot_hash, ranking_policy_version, solver_version,
             status, total_selected, total_required,
             estimated_cost_state, estimated_cost_microusd,
             workload_state, workload_units, reason_codes_json, created_at
           )
           SELECT
             'experiment-quota-replacement', root_id, version_number + 1, id,
             quota_profile_id, '${'f'.repeat(64)}', ranking_policy_version, solver_version,
             status, total_selected, total_required,
             estimated_cost_state, estimated_cost_microusd,
             workload_state, workload_units, reason_codes_json,
             '2026-07-30T10:02:00.000Z'
           FROM topic_quota_plan_versions WHERE id = ?`,
        )
        .run(plan.planVersionId);
      fixture.database
        .prepare(
          `UPDATE topic_quota_plan_roots
           SET current_plan_version_id = 'experiment-quota-replacement',
               revision = revision + 1,
               updated_at = '2026-07-30T10:02:00.000Z'
           WHERE current_plan_version_id = ?`,
        )
        .run(plan.planVersionId);
      const stale = fixture.repository.get(created.experimentId);
      expect(stale).toMatchObject({ stale: true, state: 'STALE' });
      expect(stale.invalidationReasons).toContain('QUOTA_PLAN_CHANGED');
    } finally {
      fixture.database.close();
    }
  });

  it('invalidates only the prior design when a Work stratum snapshot changes', async () => {
    const fixture = await createExperimentRepositoryFixture('experiment popularity invalidation');
    try {
      const original = fixture.repository.createDraft(
        'primary',
        fixture.design,
        '2026-07-30T10:00:00.000Z',
      );
      const snapshots = fixture.design.popularitySnapshots.map((snapshot, index) =>
        index === 0 ? popularitySnapshot(snapshot.workId, 'WARM', 99) : snapshot,
      );
      const replacement = fixture.repository.createDraft(
        'primary',
        {
          ...fixture.design,
          name: '独立的合成热度快照设计',
          popularitySnapshots: snapshots,
        },
        '2026-07-30T10:01:00.000Z',
      );
      expect(fixture.repository.get(original.experimentId)).toMatchObject({
        invalidationReasons: expect.arrayContaining(['POPULARITY_STRATUM_CHANGED']),
        stale: true,
        state: 'STALE',
      });
      expect(fixture.repository.get(replacement.experimentId)).toMatchObject({
        stale: false,
        state: 'DRAFT',
      });
    } finally {
      fixture.database.close();
    }
  });

  it('invalidates only dependents of an explicitly versioned experiment policy', async () => {
    const fixture = await createExperimentRepositoryFixture('experiment policy invalidation');
    try {
      const created = fixture.repository.createDraft(
        'primary',
        fixture.design,
        '2026-07-30T10:00:00.000Z',
      );
      fixture.database
        .prepare(
          `UPDATE experiment_policy_registry
           SET current_version = 'experiment-assignment-policy-v2',
               revision = revision + 1,
               updated_at = '2026-07-30T10:01:00.000Z'
           WHERE policy_kind = 'ASSIGNMENT_POLICY'`,
        )
        .run();
      const stale = fixture.repository.get(created.experimentId);
      expect(stale).toMatchObject({ stale: true, state: 'STALE' });
      expect(stale.invalidationReasons).toContain('POLICY_VERSION_CHANGED');
      expect(
        fixture.database
          .prepare(
            `SELECT from_version, to_version, revision
             FROM experiment_policy_events
             WHERE policy_kind = 'ASSIGNMENT_POLICY'`,
          )
          .get(),
      ).toEqual({
        from_version: 'experiment-assignment-policy-v1',
        revision: 2,
        to_version: 'experiment-assignment-policy-v2',
      });
    } finally {
      fixture.database.close();
    }
  });
});
