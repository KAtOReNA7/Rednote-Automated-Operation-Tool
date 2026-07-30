import type { DatabaseSync } from 'node:sqlite';

import {
  SqliteAuthenticityRepository,
  SqliteExperimentRepository,
  SqliteTopicRepository,
} from '../../packages/db/src/index.js';
import type { ExperimentDesignDraft } from '../../packages/experiments/src/index.js';
import { createInitializedDatabase } from './database-test-utils.js';
import { experimentDraft } from './experiment-fixtures.js';
import { insertTopicReadyWork, type TopicReadyWorkFixture } from './topic-fixtures.js';

export interface ExperimentRepositoryFixture {
  readonly database: DatabaseSync;
  readonly design: ExperimentDesignDraft;
  readonly repository: SqliteExperimentRepository;
  readonly topicIds: readonly string[];
  readonly topicVersionIds: readonly string[];
  readonly works: readonly TopicReadyWorkFixture[];
}

export async function createExperimentRepositoryFixture(
  label: string,
  workCount = 8,
): Promise<ExperimentRepositoryFixture> {
  const { database } = await createInitializedDatabase(label);
  const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
  const works = Array.from({ length: workCount }, (_, index) =>
    insertTopicReadyWork(database, authenticity, {
      workId: `experiment-work-${index + 1}`,
    }),
  );
  const topics = new SqliteTopicRepository(database, () => crypto.randomUUID());
  topics.confirmGeneration(
    topics.previewGeneration('primary', '2026-07-30T08:00:00.000Z'),
    `experiment-topic-generation-${label.replaceAll(/\W/gu, '-')}`,
    '2026-07-30T08:01:00.000Z',
  );
  const rows = database
    .prepare(
      `SELECT topic.id AS topic_id, version.id AS topic_version_id, membership.work_id
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
    readonly topic_version_id: string;
    readonly work_id: string;
  }[];
  const base = experimentDraft(workCount);
  const design: ExperimentDesignDraft = {
    ...base,
    samplePlan: {
      ...base.samplePlan,
      targetTopicIds: rows.map((row) => row.topic_id),
    },
  };
  return Object.freeze({
    database,
    design,
    repository: new SqliteExperimentRepository(database, () => crypto.randomUUID()),
    topicIds: Object.freeze(rows.map((row) => row.topic_id)),
    topicVersionIds: Object.freeze(rows.map((row) => row.topic_version_id)),
    works: Object.freeze(works),
  });
}
