import { afterEach, describe, expect, it } from 'vitest';

import { DesktopReadingAuthenticityRuntime } from '../apps/desktop/src/reading-authenticity-runtime.js';
import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import { DESKTOP_IPC_CHANNELS } from '../packages/shared/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { createReadyCopyRepositoryFixture } from './support/copy-fixtures.js';

const RENDERER = 'rednote://app/index.html';

afterEach(cleanTemporaryDatabases);

describe('Issue 027 desktop reading authenticity runtime and IPC', () => {
  it('binds preview to one sender/window/hash/revision and permits one append only', async () => {
    const { database } = await createInitializedDatabase('reading authenticity runtime');
    const fixture = createReadyCopyRepositoryFixture(database, 'reading-runtime');
    const runtime = new DesktopReadingAuthenticityRuntime(
      database,
      () => new Date('2026-07-31T03:00:00.000Z'),
    );
    try {
      const wrongWindow = runtime.preview(
        { draftId: fixture.created.draftId, expectedRevision: fixture.created.revision },
        10,
        20,
      );
      expect(wrongWindow.preview).toMatchObject({
        costState: 'NOT_APPLICABLE',
        externalRequestCount: 0,
        readModel: { savedStatus: 'NOT_RUN' },
        writes: ['APPEND_QUALITY_CHECK'],
      });
      expect(JSON.stringify(wrongWindow)).not.toMatch(
        /payload_json|details_json|tokenDigest|system_prediction|[A-Z]:\\/iu,
      );
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'SAVE_READING_AUTHENTICITY_CHECK',
            expectedRevision: fixture.created.revision,
            previewHash: wrongWindow.previewHash,
            token: wrongWindow.token,
          },
          10,
          21,
        ),
      ).toThrow(/READING_AUTHENTICITY_CONFIRMATION_INVALID/u);

      const preview = runtime.preview(
        { draftId: fixture.created.draftId, expectedRevision: fixture.created.revision },
        10,
        20,
      );
      const input = {
        confirmation: 'SAVE_READING_AUTHENTICITY_CHECK' as const,
        expectedRevision: fixture.created.revision,
        previewHash: preview.previewHash,
        token: preview.token,
      };
      expect(runtime.confirm(input, 10, 20).readModel.savedStatus).toBe('PASS');
      expect(() => runtime.confirm(input, 10, 20)).toThrow(
        /READING_AUTHENTICITY_CONFIRMATION_INVALID/u,
      );
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 1,
      });
      expect(database.prepare(`SELECT count(*) AS count FROM model_runs`).get()).toEqual({
        count: 0,
      });
      expect(database.prepare(`SELECT count(*) AS count FROM jobs`).get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('rejects expired confirmations and exact-object violations before runtime', async () => {
    const { database } = await createInitializedDatabase('reading authenticity expiry');
    const fixture = createReadyCopyRepositoryFixture(database, 'reading-expiry');
    let now = new Date('2026-07-31T03:00:00.000Z');
    const runtime = new DesktopReadingAuthenticityRuntime(database, () => now);
    try {
      const preview = runtime.preview(
        { draftId: fixture.created.draftId, expectedRevision: fixture.created.revision },
        1,
        2,
      );
      now = new Date('2026-07-31T03:06:00.000Z');
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'SAVE_READING_AUTHENTICITY_CHECK',
            expectedRevision: fixture.created.revision,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          1,
          2,
        ),
      ).toThrow(/READING_AUTHENTICITY_CONFIRMATION_INVALID/u);
      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [{ draftId: fixture.created.draftId, expectedRevision: 0, rawBody: 'forbidden' }],
          RENDERER,
          'previewReadingAuthenticity',
        ),
      ).not.toBeNull();
      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [
            {
              confirmation: 'SAVE_READING_AUTHENTICITY_CHECK',
              expectedRevision: 0,
              inputHash: 'a'.repeat(64),
              previewHash: 'a'.repeat(64),
              token: 'a'.repeat(43),
            },
          ],
          RENDERER,
          'confirmReadingAuthenticity',
        ),
      ).not.toBeNull();
      expect(
        Object.values(DESKTOP_IPC_CHANNELS).filter((channel) =>
          channel.startsWith('quality:reading-authenticity:'),
        ),
      ).toEqual(['quality:reading-authenticity:preview', 'quality:reading-authenticity:confirm']);
    } finally {
      database.close();
    }
  });
});
