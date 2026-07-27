import { afterEach, describe, expect, it } from 'vitest';

import {
  ApprovalTier,
  ContentStatus,
  QUALITY_CHECK_TYPES,
  QualityCheckType,
  ReadingState,
  ScoreType,
  SpoilerLevel,
} from '../packages/core/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  insertMinimalDraft,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('database AI disclosure invariant', () => {
  it('defaults post_packages.ai_disclosure to false and rejects true', async () => {
    const { database } = await createInitializedDatabase();

    try {
      const draftId = insertMinimalDraft(database);
      database
        .prepare(
          `INSERT INTO post_packages(id, draft_id, status)
           VALUES ('package-default', ?, 'EXPORT_READY')`,
        )
        .run(draftId);

      expect(
        database
          .prepare(
            `SELECT ai_disclosure
             FROM post_packages
             WHERE id = 'package-default'`,
          )
          .get(),
      ).toEqual({ ai_disclosure: 0 });

      const secondDraftId = insertMinimalDraft(database, '2');
      expect(() =>
        database
          .prepare(
            `INSERT INTO post_packages(id, draft_id, ai_disclosure, status)
             VALUES ('package-true', ?, 1, 'EXPORT_READY')`,
          )
          .run(secondDraftId),
      ).toThrow(/CHECK constraint failed/iu);
      expect(() =>
        database
          .prepare(
            `UPDATE post_packages
             SET ai_disclosure = 1
             WHERE id = 'package-default'`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/iu);
      expect(
        database
          .prepare(
            `SELECT ai_disclosure
             FROM post_packages
             WHERE id = 'package-default'`,
          )
          .get(),
      ).toEqual({ ai_disclosure: 0 });
    } finally {
      database.close();
    }
  });
});

describe('database gate exclusions', () => {
  it('contains no source-risk gate fields or secret-bearing configuration fields', async () => {
    const { database } = await createInitializedDatabase();

    try {
      const tables = database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .all()
        .map((row) => (row as { readonly name: string }).name);
      const columns = tables.flatMap((table) =>
        database
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .map((row) => (row as { readonly name: string }).name.toLowerCase()),
      );

      expect(columns).not.toContain('copyright_risk');
      expect(columns).not.toContain('copyright_score');
      expect(columns).not.toContain('copyright_gate');
      expect(columns).not.toContain('copyright_status');
      expect(columns).not.toContain('copyright_approval');
      expect(columns).not.toContain('api_key');
      expect(columns).not.toContain('secret');
      expect(columns).not.toContain('credential');
      expect(columns).not.toContain('access_token');
      expect(columns).not.toContain('refresh_token');
      expect(columns).not.toContain('password');
    } finally {
      database.close();
    }
  });

  it('accepts only the Core quality-check types and rejects AI/source-risk check types', async () => {
    const { database } = await createInitializedDatabase();

    try {
      const draftId = insertMinimalDraft(database);
      const insertCheck = database.prepare(
        `INSERT INTO quality_checks(
           id, draft_id, check_type, result, severity, checker_version
         ) VALUES (?, ?, ?, 'PASS', 'INFO', 'v1')`,
      );

      for (const checkType of QUALITY_CHECK_TYPES) {
        expect(() => insertCheck.run(`check-${checkType}`, draftId, checkType)).not.toThrow();
      }

      expect(QUALITY_CHECK_TYPES).toEqual(Object.values(QualityCheckType));
      expect(() => insertCheck.run('check-ai-disclosure', draftId, 'AI_DISCLOSURE')).toThrow(
        /CHECK constraint failed/iu,
      );
      expect(() => insertCheck.run('check-copyright-risk', draftId, 'COPYRIGHT_RISK')).toThrow(
        /CHECK constraint failed/iu,
      );
    } finally {
      database.close();
    }
  });

  it('does not let source metadata alter state, priority, schedule, or approval data', async () => {
    const { database } = await createInitializedDatabase();

    try {
      const draftId = insertMinimalDraft(database);
      database
        .prepare(
          `INSERT INTO sources(
             id, url, title, source_tier, source_type, retrieved_at, content_hash,
             language
           ) VALUES (
             'source-1', 'https://example.test/one', 'One', 'PRIMARY', 'WEB',
             '2026-07-27T01:02:03.000Z', 'hash-1', 'zh-CN'
           )`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO assets(
             id, asset_type, origin, source_id, mime_type, content_hash
           ) VALUES ('asset-1', 'PHOTO', 'USER_PHOTO', 'source-1', 'image/png', 'asset-hash')`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO approvals(
             id, draft_id, approval_tier, decision, decided_at
           ) VALUES (
             'approval-1', ?, 'FAST', 'APPROVED', '2026-07-27T01:02:03.000Z'
           )`,
        )
        .run(draftId);
      database
        .prepare(
          `INSERT INTO post_packages(id, draft_id, planned_publish_at, status)
           VALUES (
             'package-1', ?, '2026-08-01T01:02:03.000Z', 'EXPORT_READY'
           )`,
        )
        .run(draftId);

      const before = database
        .prepare(
          `SELECT d.status, t.priority_score, p.planned_publish_at, a.approval_tier
           FROM drafts d
           JOIN content_briefs b ON b.id = d.brief_id
           JOIN topics t ON t.id = b.topic_id
           JOIN post_packages p ON p.draft_id = d.id
           JOIN approvals a ON a.draft_id = d.id
           WHERE d.id = ?`,
        )
        .get(draftId);

      database
        .prepare(
          `UPDATE assets
           SET origin = 'OFFICIAL_COVER', source_id = NULL
           WHERE id = 'asset-1'`,
        )
        .run();

      const after = database
        .prepare(
          `SELECT d.status, t.priority_score, p.planned_publish_at, a.approval_tier
           FROM drafts d
           JOIN content_briefs b ON b.id = d.brief_id
           JOIN topics t ON t.id = b.topic_id
           JOIN post_packages p ON p.draft_id = d.id
           JOIN approvals a ON a.draft_id = d.id
           WHERE d.id = ?`,
        )
        .get(draftId);

      expect(after).toEqual(before);
    } finally {
      database.close();
    }
  });
});

describe('database enum alignment with Core', () => {
  it('accepts exactly the Core reading states', async () => {
    const { database } = await createInitializedDatabase();

    try {
      for (const [index, state] of Object.values(ReadingState).entries()) {
        const bookId = `book-reading-${index}`;
        database
          .prepare(
            `INSERT INTO books(id, canonical_title, work_type, discovery_status)
             VALUES (?, 'Book', 'NOVEL', 'DISCOVERED')`,
          )
          .run(bookId);
        expect(() =>
          database
            .prepare(
              `INSERT INTO reading_states(
                 id, book_id, state, user_confirmed_at
               ) VALUES (?, ?, ?, ?)`,
            )
            .run(
              `reading-${index}`,
              bookId,
              state,
              state === ReadingState.READ_CLEAR ? '2026-07-27T01:02:03.000Z' : null,
            ),
        ).not.toThrow();
      }

      database
        .prepare(
          `INSERT INTO books(id, canonical_title, work_type, discovery_status)
           VALUES ('book-invalid-reading', 'Book', 'NOVEL', 'DISCOVERED')`,
        )
        .run();
      expect(() =>
        database
          .prepare(
            `INSERT INTO reading_states(id, book_id, state)
             VALUES ('reading-invalid', 'book-invalid-reading', 'INVALID')`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/iu);
      expect(() =>
        database
          .prepare(
            `INSERT INTO reading_states(id, book_id, state)
             VALUES ('reading-unconfirmed', 'book-invalid-reading', 'READ_CLEAR')`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/iu);
    } finally {
      database.close();
    }
  });

  it('accepts exactly the Core spoiler levels and content statuses', async () => {
    const { database } = await createInitializedDatabase();

    try {
      let index = 0;
      for (const spoilerLevel of Object.values(SpoilerLevel)) {
        for (const status of Object.values(ContentStatus)) {
          expect(() =>
            database
              .prepare(
                `INSERT INTO topics(
                   id, topic_type, angle, core_judgment, audience, spoiler_level, status
                 ) VALUES (?, 'BOOK_NOTE', 'angle', 'judgment', 'reader', ?, ?)`,
              )
              .run(`topic-enum-${index}`, spoilerLevel, status),
          ).not.toThrow();
          index += 1;
        }
      }

      expect(() =>
        database
          .prepare(
            `INSERT INTO topics(
               id, topic_type, angle, core_judgment, audience, spoiler_level, status
             ) VALUES (
               'topic-invalid-spoiler', 'BOOK_NOTE', 'angle', 'judgment', 'reader',
               'INVALID', 'IDEA'
             )`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/iu);
      expect(() =>
        database
          .prepare(
            `INSERT INTO topics(
               id, topic_type, angle, core_judgment, audience, spoiler_level, status
             ) VALUES (
               'topic-invalid-status', 'BOOK_NOTE', 'angle', 'judgment', 'reader',
               'NONE', 'INVALID'
             )`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/iu);
    } finally {
      database.close();
    }
  });

  it('accepts exactly the Core approval tiers and score types', async () => {
    const { database } = await createInitializedDatabase();

    try {
      for (const [index, scoreType] of Object.values(ScoreType).entries()) {
        const topicId = `topic-score-${index}`;
        database
          .prepare(
            `INSERT INTO topics(
               id, topic_type, angle, core_judgment, audience, spoiler_level, status
             ) VALUES (?, 'BOOK_NOTE', 'angle', 'judgment', 'reader', 'NONE', 'IDEA')`,
          )
          .run(topicId);
        expect(() =>
          database
            .prepare(
              `INSERT INTO content_briefs(
                 id, topic_id, content_type, target_reader, core_judgment,
                 spoiler_level, score_type, status
               ) VALUES (?, ?, 'ANALYSIS', 'reader', 'judgment', 'NONE', ?, 'IDEA')`,
            )
            .run(`brief-score-${index}`, topicId, scoreType),
        ).not.toThrow();
      }

      const draftId = insertMinimalDraft(database, 'approval');
      for (const [index, approvalTier] of Object.values(ApprovalTier).entries()) {
        expect(() =>
          database
            .prepare(
              `INSERT INTO approvals(
                 id, draft_id, approval_tier, decision, decided_at
               ) VALUES (?, ?, ?, 'APPROVED', '2026-07-27T01:02:03.000Z')`,
            )
            .run(`approval-${index}`, draftId, approvalTier),
        ).not.toThrow();
      }
    } finally {
      database.close();
    }
  });
});
