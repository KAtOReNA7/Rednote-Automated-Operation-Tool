import { afterEach, describe, expect, it } from 'vitest';

import {
  SqliteAuthenticityRepository,
  SqliteExperimentRepository,
  SqliteTopicRepository,
} from '../packages/db/src/index.js';
import type { ExperimentDesignDraft } from '../packages/experiments/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { experimentDraft } from './support/experiment-fixtures.js';
import { insertTopicReadyWork } from './support/topic-fixtures.js';

const NOW = '2026-07-30T08:00:00.000Z';

afterEach(cleanTemporaryDatabases);

async function createExperimentFixture(): Promise<{
  readonly database: Awaited<ReturnType<typeof createInitializedDatabase>>['database'];
  readonly design: ExperimentDesignDraft;
  readonly repository: SqliteExperimentRepository;
  readonly topicIds: readonly string[];
}> {
  const { database } = await createInitializedDatabase('experiment repository 中文 空格');
  const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
  for (let index = 1; index <= 8; index += 1) {
    insertTopicReadyWork(database, authenticity, { workId: `experiment-work-${index}` });
  }
  const topics = new SqliteTopicRepository(database, () => crypto.randomUUID());
  topics.confirmGeneration(
    topics.previewGeneration('primary', NOW),
    'experiment-topic-generation',
    '2026-07-30T08:01:00.000Z',
  );
  const rows = database
    .prepare(
      `SELECT topic.id AS topic_id, membership.work_id
       FROM topics AS topic
       JOIN topic_candidate_versions AS version
         ON version.topic_id = topic.id
        AND version.version_number = topic.current_version_number
       JOIN topic_subject_memberships AS membership
         ON membership.version_id = version.id AND membership.ordinal = 0
       WHERE topic.topic_contract_version = 'topic-candidate-v1'
         AND version.content_type = 'NON_SPOILER_SINGLE_BOOK_VERDICT'
       ORDER BY membership.work_id`,
    )
    .all() as unknown as readonly {
    readonly topic_id: string;
    readonly work_id: string;
  }[];
  const base = experimentDraft();
  const design: ExperimentDesignDraft = {
    ...base,
    samplePlan: {
      ...base.samplePlan,
      targetTopicIds: rows.map((row) => row.topic_id),
    },
  };
  return {
    database,
    design,
    repository: new SqliteExperimentRepository(database, () => crypto.randomUUID()),
    topicIds: rows.map((row) => row.topic_id),
  };
}

describe('SQLite M3 Issue 023 experiment repository', () => {
  it('persists one immutable design version without creating production content', async () => {
    const fixture = await createExperimentFixture();
    try {
      const detail = fixture.repository.createDraft(
        'primary',
        fixture.design,
        '2026-07-30T08:02:00.000Z',
      );
      expect(detail).toMatchObject({
        assignment: null,
        assignmentStatus: null,
        lockedMeansExecution: false,
        resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION',
        revision: 1,
        stale: false,
        state: 'DRAFT',
        versionNumber: 1,
      });
      expect(
        fixture.repository.list('primary', { limit: 25, offset: 0, query: '', state: null }),
      ).toMatchObject({
        total: 1,
      });
      expect(
        fixture.database
          .prepare(
            `SELECT
               (SELECT count(*) FROM experiment_primary_variables) AS variables,
               (SELECT count(*) FROM experiment_primary_metrics) AS metrics,
               (SELECT count(*) FROM experiment_arms) AS arms,
               (SELECT count(*) FROM experiment_guardrails) AS guardrails`,
          )
          .get(),
      ).toEqual({ arms: 2, guardrails: 2, metrics: 1, variables: 1 });
      for (const table of ['content_briefs', 'drafts', 'assets', 'post_packages', 'publications']) {
        expect(
          (
            fixture.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
              readonly count: number;
            }
          ).count,
          table,
        ).toBe(0);
      }
      expect(detail).not.toHaveProperty('effect');
      expect(JSON.stringify(detail)).not.toMatch(/pValue|winner|significance|power/iu);
    } finally {
      fixture.database.close();
    }
  });

  it('saves a deterministic balanced assignment, no-ops replay, and locks only the design', async () => {
    const fixture = await createExperimentFixture();
    try {
      const draft = fixture.repository.createDraft(
        'primary',
        fixture.design,
        '2026-07-30T08:02:00.000Z',
      );
      const preview = fixture.repository.previewAssignment(draft.experimentId);
      expect(preview.result).toMatchObject({
        armCounts: { control: 4, treatment: 4 },
        distinctWorkCount: 8,
        status: 'READY_TO_LOCK',
      });
      const saved = fixture.repository.saveAssignment(preview, '2026-07-30T08:03:00.000Z');
      expect(saved).toMatchObject({
        assignment: {
          status: 'READY_TO_LOCK',
          strataCounts: { COLD: 2, HOT: 2, UNKNOWN: 2, WARM: 2 },
          unitCount: 8,
        },
        revision: 2,
        state: 'ASSIGNMENT_READY',
      });

      const replay = fixture.repository.saveAssignment(
        fixture.repository.previewAssignment(draft.experimentId),
        '2026-07-30T08:04:00.000Z',
      );
      expect(replay.revision).toBe(2);
      expect(
        fixture.database.prepare('SELECT count(*) AS count FROM experiment_assignment_plans').get(),
      ).toEqual({ count: 1 });

      const locked = fixture.repository.applyAction(
        fixture.repository.previewAction(draft.experimentId, 'LOCK', 2),
        '2026-07-30T08:05:00.000Z',
      );
      expect(locked).toMatchObject({
        lockedMeansExecution: false,
        resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION',
        revision: 3,
        state: 'LOCKED',
      });
      expect(
        fixture.database.prepare('SELECT count(*) AS count FROM content_briefs').get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.database.close();
    }
  });

  it('fails stale revisions, preserves history, and requires cloning for a locked design change', async () => {
    const fixture = await createExperimentFixture();
    try {
      const created = fixture.repository.createDraft(
        'primary',
        fixture.design,
        '2026-07-30T08:02:00.000Z',
      );
      fixture.repository.saveAssignment(
        fixture.repository.previewAssignment(created.experimentId),
        '2026-07-30T08:03:00.000Z',
      );
      fixture.repository.applyAction(
        fixture.repository.previewAction(created.experimentId, 'LOCK', 2),
        '2026-07-30T08:04:00.000Z',
      );
      expect(() => fixture.repository.previewAction(created.experimentId, 'HOLD', 2)).toThrowError(
        'EXPERIMENT_STALE_REVISION',
      );

      const cloned = fixture.repository.cloneVersion(
        created.experimentId,
        3,
        { ...fixture.design, name: '克隆后的合成单变量实验' },
        '2026-07-30T08:05:00.000Z',
      );
      expect(cloned).toMatchObject({
        assignment: null,
        name: '克隆后的合成单变量实验',
        revision: 4,
        state: 'DRAFT',
        versionHistory: {
          items: [
            {
              changeKinds: ['NAME'],
              isCurrent: true,
              versionNumber: 2,
            },
            {
              changeKinds: ['INITIAL_DESIGN'],
              isCurrent: false,
              versionNumber: 1,
            },
          ],
          total: 2,
        },
        versionNumber: 2,
      });
      expect(
        fixture.database
          .prepare(
            `SELECT count(*) AS count
             FROM experiment_design_versions WHERE experiment_id = ?`,
          )
          .get(created.experimentId),
      ).toEqual({ count: 2 });
      expect(() =>
        fixture.database
          .prepare(
            `UPDATE experiment_design_versions
             SET design_payload_json = '{}' WHERE id = ?`,
          )
          .run(created.designVersionId),
      ).toThrow(/immutable/iu);
    } finally {
      fixture.database.close();
    }
  });

  it('invalidates only designs that depend on a changed Topic', async () => {
    const fixture = await createExperimentFixture();
    try {
      const created = fixture.repository.createDraft(
        'primary',
        fixture.design,
        '2026-07-30T08:02:00.000Z',
      );
      fixture.repository.saveAssignment(
        fixture.repository.previewAssignment(created.experimentId),
        '2026-07-30T08:03:00.000Z',
      );
      fixture.database
        .prepare(
          `INSERT INTO topics(
             id, topic_type, angle, core_judgment, audience, spoiler_level, status
           ) VALUES (
             'unrelated-legacy-topic', 'LEGACY', '无关角度',
             '无关判断', '合成受众', 'NONE', 'IDEA'
           )`,
        )
        .run();
      expect(
        fixture.database.prepare('SELECT count(*) AS count FROM experiment_invalidations').get(),
      ).toEqual({ count: 0 });

      const target = fixture.topicIds[0];
      if (target === undefined) throw new Error('Missing synthetic target.');
      fixture.database
        .prepare(
          `UPDATE topics
           SET candidate_state = 'HELD', topic_revision = topic_revision + 1,
               updated_at = '2026-07-30T08:04:00.000Z'
           WHERE id = ?`,
        )
        .run(target);
      const stale = fixture.repository.get(created.experimentId);
      expect(stale).toMatchObject({
        assignmentStatus: 'STALE',
        stale: true,
        state: 'STALE',
      });
      expect(stale.invalidationReasons).toContain('TOPIC_CHANGED');
      expect(() => fixture.repository.previewAction(created.experimentId, 'LOCK', 2)).toThrowError(
        'EXPERIMENT_POLICY_BLOCKED',
      );
    } finally {
      fixture.database.close();
    }
  });
});
