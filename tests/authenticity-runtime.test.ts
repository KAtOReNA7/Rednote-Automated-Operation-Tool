import { afterEach, describe, expect, it } from 'vitest';

import { DesktopAuthenticityRuntime } from '../apps/desktop/src/authenticity-runtime.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { insertAuthenticityWork } from './support/authenticity-fixtures.js';

afterEach(cleanTemporaryDatabases);

function statePreviewInput(workId: string, expectedRevision = 0) {
  return {
    draft: {
      confirmationKind: 'USER_EXPLICIT' as const,
      expectedRevision,
      finishedAt: null,
      finishedAtPrecision: 'UNKNOWN' as const,
      lastReadAt: null,
      lastReadAtPrecision: 'UNKNOWN' as const,
      memoryConfidence: 'CLEAR' as const,
      nextState: 'R1_READ_CLEAR' as const,
      profileId: 'primary',
      provenance: 'USER_UI' as const,
      subject: { editionId: null, expressionId: null, workId },
      userNote: null,
    },
    kind: 'STATE_CHANGE' as const,
  };
}

describe('Issue 021 desktop authenticity runtime', () => {
  it('binds one-use confirmation to sender/window/hash/kind', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'runtime-work', '运行时书');
      const runtime = new DesktopAuthenticityRuntime(database);
      const first = runtime.preview(statePreviewInput('runtime-work'), 11, 22);
      expect(first).toMatchObject({
        kind: 'STATE_CHANGE',
        preview: {
          after: { state: 'R1_READ_CLEAR' },
          before: { state: 'UNCLASSIFIED' },
        },
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_AUTHENTICITY_ACTION',
            kind: first.kind,
            previewHash: first.previewHash,
            token: first.token,
          },
          12,
          22,
        ),
      ).toThrow(/AUTHENTICITY_CONFIRMATION_INVALID/iu);

      const second = runtime.preview(statePreviewInput('runtime-work'), 11, 22);
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_AUTHENTICITY_ACTION',
            kind: 'STATE_UNDO',
            previewHash: second.previewHash,
            token: second.token,
          },
          11,
          22,
        ),
      ).toThrow(/AUTHENTICITY_CONFIRMATION_INVALID/iu);

      const third = runtime.preview(statePreviewInput('runtime-work'), 11, 22);
      const result = runtime.confirm(
        {
          confirmation: 'APPLY_AUTHENTICITY_ACTION',
          kind: third.kind,
          previewHash: third.previewHash,
          token: third.token,
        },
        11,
        22,
      );
      expect(result).toMatchObject({
        batch: null,
        detail: { readingState: 'R1_READ_CLEAR', revision: 1 },
        kind: 'STATE_CHANGE',
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_AUTHENTICITY_ACTION',
            kind: third.kind,
            previewHash: third.previewHash,
            token: third.token,
          },
          11,
          22,
        ),
      ).toThrow(/AUTHENTICITY_CONFIRMATION_INVALID/iu);
    } finally {
      database.close();
    }
  });

  it('clears pending confirmations with the owning window', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertAuthenticityWork(database, 'runtime-clear', '清理确认');
      const runtime = new DesktopAuthenticityRuntime(database);
      const preview = runtime.preview(statePreviewInput('runtime-clear'), 3, 4);
      runtime.clearWindow(4);
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_AUTHENTICITY_ACTION',
            kind: preview.kind,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          3,
          4,
        ),
      ).toThrow(/AUTHENTICITY_CONFIRMATION_INVALID/iu);
      expect(runtime.list({ limit: 25, offset: 0, profileId: 'primary', query: '' })).toMatchObject(
        {
          items: [{ readingState: 'UNCLASSIFIED', revision: 0 }],
          total: 1,
        },
      );
    } finally {
      database.close();
    }
  });
});
