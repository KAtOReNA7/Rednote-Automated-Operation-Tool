import { afterEach, describe, expect, it } from 'vitest';

import { SqliteAuthenticityRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  AUTHENTICITY_NOW,
  applyReadingState,
  insertAuthenticityDossier,
  insertAuthenticityWork,
} from './support/authenticity-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 021 six-Work synthetic authenticity gold', () => {
  it('freezes state, permission, score and spoiler isolation without content writes', async () => {
    const { database } = await createInitializedDatabase('真实性 金标 空格');
    try {
      const workIds = {
        r1: 'gold-r1',
        r2: 'gold-r2',
        r3: 'gold-r3',
        s1: 'gold-s1',
        s2: 'gold-s2',
        unclassified: 'gold-unclassified',
      } as const;
      for (const [state, workId] of Object.entries(workIds)) {
        insertAuthenticityWork(database, workId, `金标 ${state}`);
      }
      insertAuthenticityDossier(database, workIds.r1, 'FACT_BLOCKED');
      insertAuthenticityDossier(database, workIds.r2, 'READY_FOR_CONTENT_BRIEF');
      insertAuthenticityDossier(database, workIds.r3, 'READY_FOR_CONTENT_BRIEF');
      insertAuthenticityDossier(database, workIds.s1, 'READY_FOR_CONTENT_BRIEF');
      insertAuthenticityDossier(database, workIds.s2, 'INSUFFICIENT_COVERAGE');

      let sequence = 0;
      const repository = new SqliteAuthenticityRepository(
        database,
        () => `gold-authenticity-${++sequence}`,
      );
      applyReadingState(repository, {
        confidence: 'CLEAR',
        state: 'R1_READ_CLEAR',
        workId: workIds.r1,
      });
      applyReadingState(repository, {
        confidence: 'PARTIAL',
        state: 'R2_READ_FUZZY',
        workId: workIds.r2,
      });
      applyReadingState(repository, {
        confidence: 'UNKNOWN',
        state: 'R3_READ_UNCONFIRMED_DETAILS',
        workId: workIds.r3,
      });
      applyReadingState(repository, {
        confidence: 'NOT_APPLICABLE',
        state: 'S1_RESEARCH_ONLY',
        workId: workIds.s1,
      });
      applyReadingState(repository, {
        confidence: 'NOT_APPLICABLE',
        state: 'S2_RESEARCH_INSUFFICIENT',
        workId: workIds.s2,
      });

      const r2Impression = repository.applyAssertion(
        {
          assertionId: null,
          assertionKind: 'READING_IMPRESSION',
          confirmationScope: 'EXACT_STATEMENT',
          expectedAssertionRevision: 0,
          expectedReadingRevision: 1,
          profileId: 'primary',
          statement: '合成金标：我只确认这一条阅读印象。',
          workId: workIds.r2,
        },
        '2026-07-30T03:01:00.000Z',
      ).assertions[0];
      if (r2Impression === undefined) throw new Error('missing gold assertion');
      repository.applyAssertion(
        {
          assertionId: null,
          assertionKind: 'PERSONAL_SCORE',
          confirmationScope: 'EXACT_STRUCTURED_OPINION',
          expectedAssertionRevision: 0,
          expectedReadingRevision: 1,
          profileId: 'primary',
          statement: '合成金标：允许保存这一项个人评分。',
          workId: workIds.r2,
        },
        '2026-07-30T03:02:00.000Z',
      );
      repository.applyAssertionRevoke(
        repository.previewAssertionRevoke({
          assertionId: r2Impression.assertionId,
          expectedAssertionRevision: r2Impression.assertionRevision,
          expectedReadingRevision: 1,
          profileId: 'primary',
          workId: workIds.r2,
        }),
        '2026-07-30T03:03:00.000Z',
      );

      repository.applyScore(
        {
          expectedReadingRevision: 1,
          expectedRevision: 0,
          origin: 'PERSONAL_SCORE',
          profileId: 'primary',
          scoreBasisPoints: 8800,
          workId: workIds.r1,
        },
        '2026-07-30T03:04:00.000Z',
      );
      repository.applyScore(
        {
          expectedReadingRevision: 1,
          expectedRevision: 0,
          origin: 'RESEARCH_ANALYSIS_SCORE',
          profileId: 'primary',
          scoreBasisPoints: 7600,
          workId: workIds.s1,
        },
        '2026-07-30T03:05:00.000Z',
      );
      database
        .prepare(
          `INSERT INTO system_prediction_scores(
             id, profile_id, book_id, score_basis_points, purpose, provenance, created_at
           ) VALUES (
             'gold-internal-score', 'primary', 'gold-unclassified', 9300,
             'INTERNAL_ORDERING_ONLY', 'SCRIPTED_FIXTURE', ?
           )`,
        )
        .run(AUTHENTICITY_NOW);

      repository.applySpoiler(
        {
          expectedRevision: 1,
          level: 'LIGHT_SPOILER',
          profileId: 'primary',
          userConfirmed: false,
          warningIncluded: true,
          workId: workIds.r2,
        },
        '2026-07-30T03:06:00.000Z',
      );
      repository.applySpoiler(
        {
          expectedRevision: 1,
          level: 'FULL_TRICK_ANALYSIS',
          profileId: 'primary',
          userConfirmed: true,
          warningIncluded: true,
          workId: workIds.s1,
        },
        '2026-07-30T03:07:00.000Z',
      );

      const details = Object.fromEntries(
        Object.entries(workIds).map(([key, workId]) => [
          key,
          repository.getWorkDetail('primary', workId),
        ]),
      ) as Record<keyof typeof workIds, ReturnType<typeof repository.getWorkDetail>>;

      expect(
        repository.listLibrary('primary', { limit: 25, offset: 0, query: '' }).items,
      ).toHaveLength(6);
      expect(details.r1.permission).toMatchObject({
        contentBriefReadiness: 'BLOCKED',
        firstPersonPermission: 'ALLOWED',
        personalScorePermission: 'ALLOWED',
        publicResearchAnalysisPermission: 'BLOCKED',
      });
      expect(details.r1.permission.blockingReasonCodes).toContain('DOSSIER_FACT_BLOCKED');
      expect(details.r2.permission).toMatchObject({
        firstPersonPermission: 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY',
        personalScorePermission: 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY',
        publicResearchAnalysisPermission: 'RESEARCH_ONLY',
      });
      expect(details.r2.assertions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assertionKind: 'PERSONAL_SCORE',
            stale: false,
            status: 'CONFIRMED',
          }),
          expect.objectContaining({
            assertionKind: 'READING_IMPRESSION',
            stale: true,
            status: 'REVOKED',
          }),
        ]),
      );
      expect(details.r3.permission).toMatchObject({
        firstPersonPermission: 'BLOCKED',
        personalScorePermission: 'BLOCKED',
        publicResearchAnalysisPermission: 'RESEARCH_ONLY',
      });
      expect(details.s1.permission).toMatchObject({
        firstPersonPermission: 'BLOCKED',
        personalScorePermission: 'BLOCKED',
        publicResearchAnalysisPermission: 'RESEARCH_ONLY',
        researchAnalysisScorePermission: 'RESEARCH_ONLY',
      });
      expect(details.s2.permission).toMatchObject({
        contentBriefReadiness: 'BLOCKED',
        firstPersonPermission: 'BLOCKED',
        personalScorePermission: 'BLOCKED',
        publicResearchAnalysisPermission: 'BLOCKED',
        researchAnalysisScorePermission: 'BLOCKED',
      });
      expect(details.unclassified).toMatchObject({
        readingState: 'UNCLASSIFIED',
        revision: 0,
        permission: {
          contentBriefReadiness: 'BLOCKED',
          firstPersonPermission: 'BLOCKED',
          publicResearchAnalysisPermission: 'BLOCKED',
        },
      });
      expect(details.r1.personalScore).toMatchObject({
        origin: 'PERSONAL_SCORE',
        scoreBasisPoints: 8800,
      });
      expect(details.s1.researchScore).toMatchObject({
        origin: 'RESEARCH_ANALYSIS_SCORE',
        publicLabel: '资料分析评分',
        scoreBasisPoints: 7600,
      });
      expect(JSON.stringify(details)).not.toContain('9300');
      expect(details.r1.permission.spoiler.level).toBe('NO_SPOILER');
      expect(details.r2.permission.spoiler).toMatchObject({
        level: 'LIGHT_SPOILER',
        warningRequired: true,
      });
      expect(details.s1.permission.spoiler).toMatchObject({
        level: 'FULL_TRICK_ANALYSIS',
        userConfirmationRequired: true,
        warningPlacement: 'COVER_TITLE_AND_BODY_OPENING',
        warningRequired: true,
      });
      expect(details.s1.permission.firstPersonPermission).toBe('BLOCKED');

      for (const table of [
        'content_briefs',
        'drafts',
        'approvals',
        'post_packages',
        'publications',
      ]) {
        expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get(), table).toEqual({
          count: 0,
        });
      }
    } finally {
      database.close();
    }
  });
});
