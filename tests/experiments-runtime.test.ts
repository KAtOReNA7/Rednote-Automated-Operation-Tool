import { afterEach, describe, expect, it } from 'vitest';

import { DesktopExperimentRuntime } from '../apps/desktop/src/experiment-runtime.js';
import { SqliteAuthenticityRepository, SqliteTopicRepository } from '../packages/db/src/index.js';
import type { ExperimentDesignDraft } from '../packages/experiments/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { experimentDraft } from './support/experiment-fixtures.js';
import { insertTopicReadyWork } from './support/topic-fixtures.js';

afterEach(cleanTemporaryDatabases);

async function runtimeFixture(): Promise<{
  readonly database: Awaited<ReturnType<typeof createInitializedDatabase>>['database'];
  readonly design: ExperimentDesignDraft;
}> {
  const { database } = await createInitializedDatabase('experiment runtime');
  const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
  for (let index = 1; index <= 3; index += 1) {
    insertTopicReadyWork(database, authenticity, { workId: `experiment-work-${index}` });
  }
  const topics = new SqliteTopicRepository(database, () => crypto.randomUUID());
  topics.confirmGeneration(
    topics.previewGeneration('primary', '2026-07-30T09:00:00.000Z'),
    'experiment-runtime-generation',
    '2026-07-30T09:00:01.000Z',
  );
  const rows = database
    .prepare(
      `SELECT topic.id AS topic_id
       FROM topics AS topic
       JOIN topic_candidate_versions AS version
         ON version.topic_id = topic.id
        AND version.version_number = topic.current_version_number
       JOIN topic_subject_memberships AS membership
         ON membership.version_id = version.id AND membership.ordinal = 0
       WHERE version.content_type = 'NON_SPOILER_SINGLE_BOOK_VERDICT'
       ORDER BY membership.work_id`,
    )
    .all() as unknown as readonly { readonly topic_id: string }[];
  const base = experimentDraft(3);
  return {
    database,
    design: {
      ...base,
      samplePlan: {
        ...base.samplePlan,
        targetTopicIds: rows.map((row) => row.topic_id),
      },
    },
  };
}

describe('M3 Issue 023 desktop experiment runtime', () => {
  it('binds one-use confirmations to sender/window and keeps all operations local', async () => {
    const fixture = await runtimeFixture();
    const runtime = new DesktopExperimentRuntime(
      fixture.database,
      () => new Date('2026-07-30T09:10:00.000Z'),
    );
    try {
      const wrongSender = runtime.preview(
        { design: fixture.design, kind: 'CREATE_DRAFT', profileId: 'primary' },
        10,
        20,
      );
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_EXPERIMENT_ACTION',
            kind: wrongSender.kind,
            previewHash: wrongSender.previewHash,
            token: wrongSender.token,
          },
          11,
          20,
        ),
      ).toThrow(/EXPERIMENT_CONFIRMATION_INVALID/iu);

      const createPreview = runtime.preview(
        { design: fixture.design, kind: 'CREATE_DRAFT', profileId: 'primary' },
        10,
        20,
      );
      expect(createPreview.preview).toMatchObject({
        armCount: 2,
        kind: 'CREATE_DRAFT',
        minimumDistinctWorkCount: 3,
        primaryMetricId: 'SAVE_RATE',
        primaryVariableKind: 'CONTENT_STRUCTURE',
        targetTopicCount: 3,
      });
      const created = runtime.confirm(
        {
          confirmation: 'APPLY_EXPERIMENT_ACTION',
          kind: createPreview.kind,
          previewHash: createPreview.previewHash,
          token: createPreview.token,
        },
        10,
        20,
      );
      expect(created).toMatchObject({
        detail: {
          assignment: null,
          resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION',
          state: 'DRAFT',
        },
        kind: 'CREATE_DRAFT',
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_EXPERIMENT_ACTION',
            kind: createPreview.kind,
            previewHash: createPreview.previewHash,
            token: createPreview.token,
          },
          10,
          20,
        ),
      ).toThrow(/EXPERIMENT_CONFIRMATION_INVALID/iu);

      const assignmentPreview = runtime.preview(
        {
          experimentId: created.detail.experimentId,
          kind: 'SAVE_ASSIGNMENT',
        },
        10,
        20,
      );
      expect(assignmentPreview.preview).toMatchObject({
        distinctWorkCount: 3,
        kind: 'SAVE_ASSIGNMENT',
        status: 'READY_TO_LOCK',
      });
      const assigned = runtime.confirm(
        {
          confirmation: 'APPLY_EXPERIMENT_ACTION',
          kind: assignmentPreview.kind,
          previewHash: assignmentPreview.previewHash,
          token: assignmentPreview.token,
        },
        10,
        20,
      );
      expect(assigned.detail).toMatchObject({
        assignment: { status: 'READY_TO_LOCK', unitCount: 3 },
        revision: 2,
        state: 'ASSIGNMENT_READY',
      });

      const cleared = runtime.preview(
        {
          action: 'LOCK',
          expectedRevision: 2,
          experimentId: created.detail.experimentId,
          kind: 'STATE_ACTION',
        },
        10,
        20,
      );
      runtime.clearWindow(20);
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_EXPERIMENT_ACTION',
            kind: cleared.kind,
            previewHash: cleared.previewHash,
            token: cleared.token,
          },
          10,
          20,
        ),
      ).toThrow(/EXPERIMENT_CONFIRMATION_INVALID/iu);

      const lockPreview = runtime.preview(
        {
          action: 'LOCK',
          expectedRevision: 2,
          experimentId: created.detail.experimentId,
          kind: 'STATE_ACTION',
        },
        10,
        20,
      );
      const locked = runtime.confirm(
        {
          confirmation: 'APPLY_EXPERIMENT_ACTION',
          kind: lockPreview.kind,
          previewHash: lockPreview.previewHash,
          token: lockPreview.token,
        },
        10,
        20,
      );
      expect(locked.detail).toMatchObject({
        lockedMeansExecution: false,
        resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION',
        state: 'LOCKED',
      });
      expect(
        runtime.list({
          limit: 25,
          offset: 0,
          profileId: 'primary',
          query: '',
          state: null,
        }).total,
      ).toBe(1);
      expect(
        runtime.get({
          experimentId: created.detail.experimentId,
          historyLimit: 25,
          historyOffset: 0,
          versionLimit: 25,
          versionOffset: 0,
        }).design.primaryVariable.arms,
      ).toHaveLength(2);
      for (const table of ['content_briefs', 'drafts', 'assets', 'publications']) {
        expect(
          (
            fixture.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
              readonly count: number;
            }
          ).count,
          table,
        ).toBe(0);
      }
    } finally {
      fixture.database.close();
    }
  });
});
