import { afterEach, describe, expect, it } from 'vitest';

import { SqliteAuthenticityRepository, SqliteTopicRepository } from '../packages/db/src/index.js';
import { FIRST_30_QUOTAS, TOPIC_CONTENT_TYPES } from '../packages/topics/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { insertCompleteTopicPortfolio } from './support/topic-fixtures.js';

afterEach(() => {
  cleanTemporaryDatabases();
});

describe('M3 Issue 022 synthetic gold portfolio', () => {
  it('creates five candidate categories and an exact COMPLETE 10/8/6/3/3 plan locally', async () => {
    const { database } = await createInitializedDatabase('topic gold portfolio');
    try {
      const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
      insertCompleteTopicPortfolio(database, authenticity);
      const topics = new SqliteTopicRepository(database, () => crypto.randomUUID());
      const generationPreview = topics.previewGeneration('primary', '2026-07-30T06:00:00.000Z');
      for (const contentType of TOPIC_CONTENT_TYPES) {
        expect(generationPreview.counts[contentType]).toBeGreaterThanOrEqual(
          FIRST_30_QUOTAS[contentType],
        );
      }
      expect(generationPreview).toMatchObject({
        estimatedModelRequests: 0,
        modelExecutionState: 'UNCONFIGURED_DISABLED',
      });

      const generation = topics.confirmGeneration(
        generationPreview,
        'topic-gold-generation',
        '2026-07-30T06:01:00.000Z',
      );
      expect(generation).toMatchObject({
        duplicateCount: 0,
        externalRequestCount: 0,
        replayed: false,
        status: 'SUCCEEDED',
      });
      expect(generation.createdCount).toBe(generationPreview.plan.candidates.length);

      const quotaPreview = topics.previewQuotaPlan('primary', 10);
      expect(quotaPreview.result).toMatchObject({
        estimatedExternalCost: { state: 'KNOWN', valueMicrousd: 0 },
        status: 'COMPLETE',
        totalRequired: 30,
        totalSelected: 30,
        workload: { state: 'KNOWN' },
      });
      const plan = topics.confirmQuotaPlan(quotaPreview, '2026-07-30T06:02:00.000Z');
      expect(plan).toMatchObject({
        status: 'COMPLETE',
        totalRequired: 30,
        totalSelected: 30,
        versionNumber: 1,
      });
      for (const contentType of TOPIC_CONTENT_TYPES) {
        expect(
          plan.categories.find((category) => category.contentType === contentType),
        ).toMatchObject({
          required: FIRST_30_QUOTAS[contentType],
          selected: FIRST_30_QUOTAS[contentType],
          shortfall: 0,
        });
      }
      expect(new Set(plan.members.map((member) => member.topicId)).size).toBe(30);
      const fingerprints = database
        .prepare(
          `SELECT member.semantic_fingerprint
           FROM topic_quota_plan_members AS member
           WHERE member.plan_version_id = ?`,
        )
        .all(plan.planVersionId) as { readonly semantic_fingerprint: string }[];
      expect(new Set(fingerprints.map((row) => row.semantic_fingerprint)).size).toBe(30);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM topic_quota_plan_members
             WHERE plan_version_id = ? AND eligibility_state <> 'ELIGIBLE'`,
          )
          .get(plan.planVersionId),
      ).toEqual({ count: 0 });

      const full = topics.listPool('primary', {
        contentType: 'FULL_TRICK_LOGIC_ANALYSIS',
        eligibility: 'ELIGIBLE',
        limit: 25,
        offset: 0,
        query: '',
        state: null,
      });
      expect(full.items).toHaveLength(8);
      const fullTopic = full.items[0];
      if (fullTopic === undefined) throw new Error('Missing full-trick gold candidate.');
      const fullDetail = topics.getTopic(fullTopic.topicId);
      expect(fullDetail.spoilerPolicy).toEqual({
        userConfirmationRequired: true,
        warningPlacement: 'COVER_TITLE_AND_BODY_OPENING',
        warningRequired: true,
      });
      expect(
        topics
          .listPool('primary', {
            contentType: null,
            eligibility: null,
            limit: 100,
            offset: 0,
            query: '',
            state: null,
          })
          .items.some((item) => item.analysisMode === 'PUBLIC_RESEARCH'),
      ).toBe(true);

      for (const table of [
        'experiments',
        'content_briefs',
        'drafts',
        'quality_checks',
        'approvals',
        'post_packages',
        'publications',
      ]) {
        expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
          count: 0,
        });
      }
    } finally {
      database.close();
    }
  }, 30_000);
});
