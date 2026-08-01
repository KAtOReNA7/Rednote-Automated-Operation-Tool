import { afterEach, describe, expect, it } from 'vitest';

import { DesktopSpoilerQualityRuntime } from '../apps/desktop/src/spoiler-quality-runtime.js';
import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import { SqliteSpoilerQualityRepository } from '../packages/db/src/index.js';
import {
  SPOILER_QUALITY_CHECKER_VERSION,
  SpoilerQualityError,
  factMappingHash,
} from '../packages/quality/src/index.js';
import { DESKTOP_IPC_CHANNELS } from '../packages/shared/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { createReadyCopyRepositoryFixture, requiredFixtureValue } from './support/copy-fixtures.js';

const RENDERER = 'rednote://app/index.html';
const NOW = '2026-08-01T09:00:00.000Z';

afterEach(cleanTemporaryDatabases);

describe('Issue 028 desktop spoiler quality runtime and IPC', () => {
  it('binds a read-only preview to sender/window/draft/version/revision/hash and consumes it once', async () => {
    const { database } = await createInitializedDatabase('spoiler quality runtime');
    const fixture = createReadyCopyRepositoryFixture(database, 'spoiler-runtime');
    const runtime = new DesktopSpoilerQualityRuntime(
      database,
      () => new Date('2026-08-01T10:00:00.000Z'),
    );
    try {
      const preview = runtime.preview(
        { draftId: fixture.created.draftId, expectedRevision: fixture.created.revision },
        10,
        20,
      );
      expect(preview.preview).toMatchObject({
        costState: 'NOT_APPLICABLE',
        externalRequestCount: 0,
        readModel: { savedStatus: 'NOT_RUN' },
        writes: ['APPEND_QUALITY_CHECK'],
      });
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 0,
      });
      const input = {
        confirmation: 'SAVE_SPOILER_QUALITY_CHECK' as const,
        expectedRevision: fixture.created.revision,
        previewHash: preview.previewHash,
        token: preview.token,
      };
      expect(() => runtime.confirm(input, 10, 21)).toThrow(/SPOILER_QUALITY_CONFIRMATION_INVALID/u);

      const current = runtime.preview(
        { draftId: fixture.created.draftId, expectedRevision: fixture.created.revision },
        10,
        20,
      );
      const confirmed = runtime.confirm(
        { ...input, previewHash: current.previewHash, token: current.token },
        10,
        20,
      );
      expect(confirmed.readModel.savedStatus).toBe('PASS');
      expect(() =>
        runtime.confirm(
          { ...input, previewHash: current.previewHash, token: current.token },
          10,
          20,
        ),
      ).toThrow(/SPOILER_QUALITY_CONFIRMATION_INVALID/u);
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 1,
      });
      expect(database.prepare(`SELECT count(*) AS count FROM model_runs`).get()).toEqual({
        count: 0,
      });
      expect(database.prepare(`SELECT count(*) AS count FROM jobs`).get()).toEqual({ count: 0 });
      expect(JSON.stringify(confirmed)).not.toMatch(
        /payload_json|details_json|tokenDigest|authorization|secret|[A-Z]:\\\\/iu,
      );
    } finally {
      database.close();
    }
  });

  it('rejects stale recomputation, expiry and exact-object violations with exactly two channels', async () => {
    const { database } = await createInitializedDatabase('spoiler quality IPC');
    const fixture = createReadyCopyRepositoryFixture(database, 'spoiler-ipc');
    let now = new Date('2026-08-01T10:00:00.000Z');
    const runtime = new DesktopSpoilerQualityRuntime(database, () => now);
    try {
      const stale = runtime.preview(
        { draftId: fixture.created.draftId, expectedRevision: fixture.created.revision },
        1,
        2,
      );
      const selectedId = requiredFixtureValue(fixture.created.payload.selectedTitleId);
      const next = fixture.copy.saveVersion(
        fixture.created.draftId,
        fixture.created.revision,
        {
          ...fixture.created.payload,
          titles: fixture.created.payload.titles.map((title) =>
            title.titleId === selectedId ? { ...title, text: `${title.text}（变化）` } : title,
          ),
        },
        ['USER_EDIT'],
        '2026-08-01T10:00:01.000Z',
      );
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'SAVE_SPOILER_QUALITY_CHECK',
            expectedRevision: fixture.created.revision,
            previewHash: stale.previewHash,
            token: stale.token,
          },
          1,
          2,
        ),
      ).toThrow(/SPOILER_QUALITY_STALE_REVISION/u);

      const expired = runtime.preview(
        { draftId: next.draftId, expectedRevision: next.revision },
        3,
        4,
      );
      now = new Date('2026-08-01T10:06:00.000Z');
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'SAVE_SPOILER_QUALITY_CHECK',
            expectedRevision: next.revision,
            previewHash: expired.previewHash,
            token: expired.token,
          },
          3,
          4,
        ),
      ).toThrow(/SPOILER_QUALITY_CONFIRMATION_INVALID/u);
      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [{ draftId: next.draftId, expectedRevision: 0, rawBody: 'forbidden' }],
          RENDERER,
          'previewSpoilerQuality',
        ),
      ).not.toBeNull();
      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [
            {
              confirmation: 'SAVE_SPOILER_QUALITY_CHECK',
              expectedRevision: 0,
              inputHash: 'a'.repeat(64),
              previewHash: 'a'.repeat(64),
              token: 'a'.repeat(43),
            },
          ],
          RENDERER,
          'confirmSpoilerQuality',
        ),
      ).not.toBeNull();
      expect(
        Object.values(DESKTOP_IPC_CHANNELS).filter((channel) =>
          channel.startsWith('quality:spoiler:'),
        ),
      ).toEqual(['quality:spoiler:preview', 'quality:spoiler:confirm']);
    } finally {
      database.close();
    }
  });
});

describe('Issue 028 spoiler quality repository integration', () => {
  it('persists one bounded idempotent summary and fails closed on an inconsistent id collision', async () => {
    const first = await createInitializedDatabase('spoiler quality repository');
    try {
      const fixture = createReadyCopyRepositoryFixture(first.database, 'spoiler-quality');
      const repository = new SqliteSpoilerQualityRepository(first.database);
      const preview = repository.prepare(fixture.created.draftId, fixture.created.revision, NOW);
      expect(preview).toMatchObject({ evaluation: { status: 'PASS' }, savedStatus: 'NOT_RUN' });
      expect(first.database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 0,
      });
      repository.confirm(preview.evaluation, '2026-08-01T09:00:01.000Z');
      repository.confirm(preview.evaluation, '2026-08-01T09:00:02.000Z');
      const row = first.database
        .prepare(
          `SELECT check_type, result, severity, summary_status, reason_code,
             fact_mapping_version_id, fact_mapping_run_id, details_json, checker_version,
             input_hash, legacy_unresolved FROM quality_checks`,
        )
        .get() as Record<string, unknown>;
      expect(row).toMatchObject({
        check_type: 'SPOILER',
        checker_version: SPOILER_QUALITY_CHECKER_VERSION,
        fact_mapping_run_id: null,
        fact_mapping_version_id: null,
        input_hash: preview.evaluation.inputHash,
        legacy_unresolved: 0,
        reason_code: null,
        result: 'PASS',
        severity: 'INFO',
        summary_status: null,
      });
      expect(Buffer.byteLength(row.details_json as string, 'utf8')).toBeLessThanOrEqual(4_096);
      expect(row.details_json).not.toMatch(
        /合成 fixture|payload_json|warningText|authorization|secret|[A-Z]:\\\\|\\\\\\\\|\bSELECT\b/iu,
      );
      expect(first.database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 1,
      });
    } finally {
      first.database.close();
    }

    const collision = await createInitializedDatabase('spoiler quality collision');
    try {
      const fixture = createReadyCopyRepositoryFixture(collision.database, 'spoiler-collision');
      const repository = new SqliteSpoilerQualityRepository(collision.database);
      const preview = repository.prepare(fixture.created.draftId, fixture.created.revision, NOW);
      const id = `spoiler-${factMappingHash({
        checkType: 'SPOILER',
        checkerVersion: SPOILER_QUALITY_CHECKER_VERSION,
        draftVersionId: preview.evaluation.draftVersionId,
        inputHash: preview.evaluation.inputHash,
      })}`;
      collision.database
        .prepare(
          `INSERT INTO quality_checks(
             id, draft_id, draft_version_id, check_type, result, severity, details_json,
             checker_version, input_hash, legacy_unresolved, created_at
           ) VALUES (?, ?, ?, 'SPOILER', 'PASS', 'INFO', ?, ?, ?, 0, ?)`,
        )
        .run(
          id,
          preview.evaluation.draftId,
          preview.evaluation.draftVersionId,
          JSON.stringify({ schemaVersion: 1, status: 'PASS', tampered: true }),
          SPOILER_QUALITY_CHECKER_VERSION,
          preview.evaluation.inputHash,
          NOW,
        );
      expect(() => repository.confirm(preview.evaluation, NOW)).toThrow(SpoilerQualityError);
      expect(
        collision.database.prepare(`SELECT count(*) AS count FROM quality_checks`).get(),
      ).toEqual({
        count: 1,
      });
    } finally {
      collision.database.close();
    }
  });

  it('derives STALE after current pointer and Draft/Brief invalidation changes without rewriting history', async () => {
    const { database } = await createInitializedDatabase('spoiler quality stale');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'spoiler-stale');
      const repository = new SqliteSpoilerQualityRepository(database);
      const first = repository.prepare(fixture.created.draftId, fixture.created.revision, NOW);
      repository.confirm(first.evaluation, '2026-08-01T09:01:00.000Z');
      const selectedId = requiredFixtureValue(fixture.created.payload.selectedTitleId);
      const next = fixture.copy.saveVersion(
        fixture.created.draftId,
        fixture.created.revision,
        {
          ...fixture.created.payload,
          titles: fixture.created.payload.titles.map((title) =>
            title.titleId === selectedId ? { ...title, text: `${title.text}（当前版本）` } : title,
          ),
        },
        ['USER_EDIT'],
        '2026-08-01T09:01:01.000Z',
      );
      const current = repository.prepare(next.draftId, next.revision, '2026-08-01T09:01:02.000Z');
      expect(current.savedStatus).toBe('STALE');
      repository.confirm(current.evaluation, '2026-08-01T09:01:03.000Z');
      const currentVersionId = requiredFixtureValue(
        next.versionHistory.items.find(({ isCurrent }) => isCurrent),
      ).versionId;
      database
        .prepare(
          `INSERT INTO content_draft_invalidations(
             id, event_identity, draft_id, version_id, dependency_type,
             dependency_id, observed_revision, reason_code, created_at
           ) VALUES (?, ?, ?, ?, 'BRIEF_VERSION', ?, '6', 'BRIEF_CHANGED', ?)`,
        )
        .run(
          'spoiler-draft-invalidation',
          'spoiler-draft-invalidation-event',
          next.draftId,
          currentVersionId,
          next.briefId,
          '2026-08-01T09:01:04.000Z',
        );
      const briefVersion = database
        .prepare(`SELECT current_version_id FROM content_briefs WHERE id = ?`)
        .get(next.briefId) as { readonly current_version_id: string };
      database
        .prepare(
          `INSERT INTO content_brief_invalidations(
             id, event_identity, brief_id, version_id, dependency_type,
             dependency_id, observed_revision, reason_code, created_at
           ) VALUES (?, ?, ?, ?, 'SPOILER_POLICY', 'spoiler-policy-v1', '2', 'POLICY_CHANGED', ?)`,
        )
        .run(
          'spoiler-brief-invalidation',
          'spoiler-brief-invalidation-event',
          next.briefId,
          briefVersion.current_version_id,
          '2026-08-01T09:01:05.000Z',
        );
      const invalidated = repository.prepare(
        next.draftId,
        next.revision,
        '2026-08-01T09:01:06.000Z',
      );
      expect(invalidated.savedStatus).toBe('STALE');
      expect(invalidated.evaluation).toMatchObject({ status: 'BLOCKED' });
      expect(invalidated.evaluation.reasonCodes).toEqual(
        expect.arrayContaining(['BRIEF_INVALIDATED', 'DRAFT_INVALIDATED']),
      );
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 2,
      });
    } finally {
      database.close();
    }
  });
});
