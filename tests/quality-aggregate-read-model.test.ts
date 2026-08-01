import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { DesktopCopyRuntime } from '../apps/desktop/src/copy-runtime.js';
import {
  SqliteCopyIntegrityRepository,
  SqliteReadingAuthenticityRepository,
  SqliteSpoilerQualityRepository,
} from '../packages/db/src/index.js';
import { DESKTOP_IPC_CHANNELS } from '../packages/shared/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { createReadyCopyRepositoryFixture, requiredFixtureValue } from './support/copy-fixtures.js';

const NOW = '2026-08-01T16:00:00.000Z';
const SNAPSHOT_TABLES = [
  'quality_checks',
  'drafts',
  'content_draft_heads',
  'content_draft_versions',
  'content_draft_invalidations',
  'jobs',
  'approvals',
  'post_packages',
  'publications',
  'audit_events',
] as const;

afterEach(cleanTemporaryDatabases);

function snapshot(database: DatabaseSync) {
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table) => [
      table,
      JSON.stringify(database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
    ]),
  );
}

function identity(evaluation: {
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftVersionId: string;
  readonly inputHash: string;
}) {
  return {
    draftId: evaluation.draftId,
    draftRevision: evaluation.draftRevision,
    draftVersionId: evaluation.draftVersionId,
    inputHash: evaluation.inputHash,
  };
}

function getInput(draftId: string, limit = 20, versionOffset = 0) {
  return { draftId, runLimit: limit, runOffset: 0, versionLimit: limit, versionOffset };
}

function allKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

describe('M3 Issue 030 read model and existing copy:get runtime', () => {
  it('reads exact-current saved results in one side-effect-free snapshot and stales old versions', async () => {
    const { database } = await createInitializedDatabase('quality aggregate read model');
    const fixture = createReadyCopyRepositoryFixture(database, 'quality-aggregate');
    const reading = new SqliteReadingAuthenticityRepository(database);
    const spoiler = new SqliteSpoilerQualityRepository(database);
    const integrity = new SqliteCopyIntegrityRepository(database);
    const preparedReading = reading.prepare(fixture.created.draftId, fixture.created.revision, NOW);
    reading.confirm(identity(preparedReading.evaluation), NOW);
    const preparedSpoiler = spoiler.prepare(fixture.created.draftId, fixture.created.revision, NOW);
    spoiler.confirm(identity(preparedSpoiler.evaluation), NOW);
    const preparedIntegrity = integrity.prepare(
      fixture.created.draftId,
      fixture.created.revision,
      NOW,
    );
    integrity.confirm(identity(preparedIntegrity.evaluation), NOW);
    const runtime = new DesktopCopyRuntime(database, { clock: () => new Date(NOW) });
    try {
      const before = snapshot(database);
      const detail = runtime.get(getInput(fixture.created.draftId));
      expect(snapshot(database)).toEqual(before);
      const readiness = requiredFixtureValue(detail.qualityReadiness, 'quality readiness');
      expect(readiness).toMatchObject({
        advisoryCandidate: null,
        canCreateApproval: false,
        canExport: false,
        canPublish: false,
        draft: {
          draftId: detail.draftId,
          revision: detail.revision,
          status: detail.status,
        },
        status: 'STALE_OR_INCOMPLETE',
      });
      expect(readiness.sources.map(({ checkType }) => checkType)).toEqual([
        'STRUCTURED_OUTPUT',
        'FACT_MAPPING',
        'READING_AUTHENTICITY',
        'SPOILER',
        'DUPLICATION',
        'TITLE_BODY_CONSISTENCY',
        'INTERNAL_CONSISTENCY',
      ]);
      expect(readiness.sources.find(({ checkType }) => checkType === 'FACT_MAPPING')).toMatchObject(
        {
          status: 'NOT_RUN',
        },
      );
      expect(readiness.sources.at(-1)).toMatchObject({
        capability: 'DEFERRED_029B',
        status: 'NOT_RUN',
      });
      expect(allKeys(readiness)).not.toEqual(
        expect.arrayContaining(['inputHash', 'hash', 'digest', 'payload', 'path', 'token', 'sql']),
      );
      expect(JSON.stringify(readiness)).not.toContain(
        requiredFixtureValue(fixture.payload.blocks[0]).text,
      );
      expect(
        Object.entries(DESKTOP_IPC_CHANNELS).filter(([name]) => name === 'getCopyDraft'),
      ).toEqual([['getCopyDraft', 'copy:get']]);

      const nextPayload = {
        ...fixture.payload,
        titles: fixture.payload.titles.map((title) =>
          title.titleId === fixture.payload.selectedTitleId
            ? { ...title, text: `${title.text}（修订）` }
            : title,
        ),
      };
      const next = fixture.copy.saveVersion(
        detail.draftId,
        detail.revision,
        nextPayload,
        ['USER_EDIT'],
        '2026-08-01T16:01:00.000Z',
      );
      const beforeStaleRead = snapshot(database);
      const changed = runtime.get(getInput(next.draftId));
      expect(snapshot(database)).toEqual(beforeStaleRead);
      expect(changed.qualityReadiness).toMatchObject({
        draft: { revision: next.revision },
        status: 'STALE_OR_INCOMPLETE',
      });
      expect(
        changed.qualityReadiness?.sources
          .filter(({ checkType }) =>
            ['READING_AUTHENTICITY', 'SPOILER', 'DUPLICATION', 'TITLE_BODY_CONSISTENCY'].includes(
              checkType,
            ),
          )
          .map(({ status }) => status),
      ).toEqual(['STALE', 'STALE', 'STALE', 'STALE']);
      expect(database.prepare('SELECT count(*) AS count FROM model_runs').get()).toEqual({
        count: 0,
      });
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('turns a malformed saved source into a bounded unavailable row without leaking the error', async () => {
    const { database } = await createInitializedDatabase('quality aggregate unavailable source');
    const fixture = createReadyCopyRepositoryFixture(database, 'quality-unavailable');
    const reading = new SqliteReadingAuthenticityRepository(database);
    const prepared = reading.prepare(fixture.created.draftId, fixture.created.revision, NOW);
    reading.confirm(identity(prepared.evaluation), NOW);
    database
      .prepare(
        `UPDATE quality_checks SET details_json = '{}' WHERE check_type = 'READING_AUTHENTICITY'`,
      )
      .run();
    const runtime = new DesktopCopyRuntime(database, { clock: () => new Date(NOW) });
    try {
      const before = snapshot(database);
      const result = runtime.get(getInput(fixture.created.draftId, 1, 1));
      expect(snapshot(database)).toEqual(before);
      expect(
        result.qualityReadiness?.sources.find(
          ({ checkType }) => checkType === 'READING_AUTHENTICITY',
        ),
      ).toMatchObject({
        capability: 'UNAVAILABLE',
        reason: 'SOURCE_UNAVAILABLE',
        status: 'NOT_RUN',
      });
      expect(JSON.stringify(result.qualityReadiness)).not.toMatch(/stack|SELECT |sqlite|\\|:\//iu);
    } finally {
      await runtime.close();
      database.close();
    }
  });
});
