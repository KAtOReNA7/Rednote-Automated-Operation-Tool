import { afterEach, describe, expect, it } from 'vitest';

import { DesktopCopyRuntime } from '../apps/desktop/src/copy-runtime.js';
import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import { DESKTOP_IPC_CHANNELS } from '../packages/shared/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { createReadyCopyRepositoryFixture, requiredFixtureValue } from './support/copy-fixtures.js';

const RENDERER = 'rednote://app/index.html';

afterEach(cleanTemporaryDatabases);

describe('Issue 029A existing Copy runtime and two narrow IPC operations', () => {
  it('binds a read-only preview to sender/window/revision/version/hash and consumes it once', async () => {
    const { database } = await createInitializedDatabase('copy integrity runtime');
    const fixture = createReadyCopyRepositoryFixture(database, 'copy-integrity-runtime');
    const runtime = new DesktopCopyRuntime(database, {
      clock: () => new Date('2026-08-01T14:00:00.000Z'),
    });
    try {
      const preview = runtime.previewIntegrity(
        { draftId: fixture.created.draftId, expectedRevision: fixture.created.revision },
        10,
        20,
      );
      expect(preview.preview).toMatchObject({
        costState: 'NOT_APPLICABLE',
        externalRequestCount: 0,
        readModel: { internalConsistencyStatus: 'NOT_RUN' },
        writes: ['APPEND_DUPLICATION_QUALITY_CHECK', 'APPEND_TITLE_BODY_CONSISTENCY_QUALITY_CHECK'],
      });
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 0,
      });
      expect(() =>
        runtime.confirmIntegrity(
          {
            confirmation: 'SAVE_COPY_INTEGRITY_CHECKS',
            expectedRevision: fixture.created.revision,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          10,
          21,
        ),
      ).toThrow(/COPY_INTEGRITY_CONFIRMATION_INVALID/u);

      const current = runtime.previewIntegrity(
        { draftId: fixture.created.draftId, expectedRevision: fixture.created.revision },
        10,
        20,
      );
      const confirmed = runtime.confirmIntegrity(
        {
          confirmation: 'SAVE_COPY_INTEGRITY_CHECKS',
          expectedRevision: fixture.created.revision,
          previewHash: current.previewHash,
          token: current.token,
        },
        10,
        20,
      );
      expect(confirmed.readModel.checks.map(({ savedStatus }) => savedStatus)).not.toContain(
        'NOT_RUN',
      );
      expect(() =>
        runtime.confirmIntegrity(
          {
            confirmation: 'SAVE_COPY_INTEGRITY_CHECKS',
            expectedRevision: fixture.created.revision,
            previewHash: current.previewHash,
            token: current.token,
          },
          10,
          20,
        ),
      ).toThrow(/COPY_INTEGRITY_CONFIRMATION_INVALID/u);
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 2,
      });
      expect(database.prepare(`SELECT count(*) AS count FROM jobs`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT count(*) AS count FROM model_runs`).get()).toEqual({
        count: 0,
      });
      expect(JSON.stringify(confirmed)).not.toMatch(
        /payload_json|details_json|inputHash|authorization|secret|[A-Z]:\\/iu,
      );
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('rejects stale and expired confirmations while exact-object validation exposes only two channels', async () => {
    const { database } = await createInitializedDatabase('copy integrity IPC');
    const fixture = createReadyCopyRepositoryFixture(database, 'copy-integrity-ipc');
    let now = new Date('2026-08-01T14:00:00.000Z');
    const runtime = new DesktopCopyRuntime(database, { clock: () => now });
    try {
      const stale = runtime.previewIntegrity(
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
            title.titleId === selectedId ? { ...title, text: title.text + '（变化）' } : title,
          ),
        },
        ['USER_EDIT'],
        '2026-08-01T14:00:01.000Z',
      );
      expect(() =>
        runtime.confirmIntegrity(
          {
            confirmation: 'SAVE_COPY_INTEGRITY_CHECKS',
            expectedRevision: fixture.created.revision,
            previewHash: stale.previewHash,
            token: stale.token,
          },
          1,
          2,
        ),
      ).toThrow(/COPY_INTEGRITY_STALE_REVISION/u);

      const expired = runtime.previewIntegrity(
        { draftId: next.draftId, expectedRevision: next.revision },
        3,
        4,
      );
      now = new Date('2026-08-01T14:06:00.000Z');
      expect(() =>
        runtime.confirmIntegrity(
          {
            confirmation: 'SAVE_COPY_INTEGRITY_CHECKS',
            expectedRevision: next.revision,
            previewHash: expired.previewHash,
            token: expired.token,
          },
          3,
          4,
        ),
      ).toThrow(/COPY_INTEGRITY_CONFIRMATION_INVALID/u);

      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [{ draftId: next.draftId, expectedRevision: next.revision, rawBody: 'forbidden' }],
          RENDERER,
          'previewCopyIntegrity',
        ),
      ).not.toBeNull();
      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [
            {
              confirmation: 'SAVE_COPY_INTEGRITY_CHECKS',
              expectedRevision: next.revision,
              inputHash: 'a'.repeat(64),
              previewHash: 'a'.repeat(64),
              token: 'a'.repeat(43),
            },
          ],
          RENDERER,
          'confirmCopyIntegrity',
        ),
      ).not.toBeNull();
      expect(
        Object.values(DESKTOP_IPC_CHANNELS).filter((channel) =>
          channel.startsWith('quality:copy-integrity:'),
        ),
      ).toEqual(['quality:copy-integrity:preview', 'quality:copy-integrity:confirm']);
    } finally {
      await runtime.close();
      database.close();
    }
  });
});
