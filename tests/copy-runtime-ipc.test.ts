import { afterEach, describe, expect, it } from 'vitest';

import { DesktopCopyRuntime } from '../apps/desktop/src/copy-runtime.js';
import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  createReadyBriefForCopyFixture,
  createReadyCopyRepositoryFixture,
} from './support/copy-fixtures.js';

const RENDERER = 'rednote://app/index.html';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 025 desktop runtime and IPC', () => {
  it('binds a one-use manual-scaffold confirmation to sender and window', async () => {
    const { database } = await createInitializedDatabase('copy runtime');
    const fixture = createReadyBriefForCopyFixture(database, 'copy-runtime');
    const runtime = new DesktopCopyRuntime(database, {
      clock: () => new Date('2026-07-30T14:20:00.000Z'),
    });
    try {
      const wrong = runtime.preview(
        { briefId: fixture.briefId, kind: 'CREATE_MANUAL_SCAFFOLD' },
        10,
        20,
      );
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_COPY_ACTION',
            executionId: null,
            kind: wrong.kind,
            previewHash: wrong.previewHash,
            token: wrong.token,
          },
          11,
          20,
        ),
      ).toThrow(/COPY_CONFIRMATION_INVALID/u);
      const preview = runtime.preview(
        { briefId: fixture.briefId, kind: 'CREATE_MANUAL_SCAFFOLD' },
        10,
        20,
      );
      expect(preview.preview).toMatchObject({
        briefId: fixture.briefId,
        kind: 'CREATE_MANUAL_SCAFFOLD',
      });
      const result = runtime.confirm(
        {
          confirmation: 'APPLY_COPY_ACTION',
          executionId: null,
          kind: preview.kind,
          previewHash: preview.previewHash,
          token: preview.token,
        },
        10,
        20,
      );
      expect(result).toMatchObject({
        detail: { revision: 0, status: 'MANUAL_DRAFT', versionNumber: 1 },
        kind: 'CREATE_MANUAL_SCAFFOLD',
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_COPY_ACTION',
            executionId: null,
            kind: preview.kind,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          10,
          20,
        ),
      ).toThrow(/COPY_CONFIRMATION_INVALID/u);
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('shows capability and budget before enqueue and blocks UNKNOWN without network', async () => {
    const { database } = await createInitializedDatabase('copy runtime capability');
    const fixture = createReadyCopyRepositoryFixture(database, 'copy-capability');
    const runtime = new DesktopCopyRuntime(database, {
      budgetState: () => 'AVAILABLE',
      capabilityState: () => 'UNKNOWN',
      clock: () => new Date('2026-07-30T14:20:00.000Z'),
    });
    try {
      const preview = runtime.preview(
        {
          draftId: fixture.created.draftId,
          expectedRevision: fixture.created.revision,
          kind: 'PREVIEW_GENERATION',
        },
        1,
        2,
      );
      expect(preview.preview).toMatchObject({
        budgetState: 'AVAILABLE',
        capabilityState: 'UNKNOWN',
        kind: 'PREVIEW_GENERATION',
        noNetworkBeforeConfirmation: true,
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_COPY_ACTION',
            executionId: 'must-not-send',
            kind: preview.kind,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          1,
          2,
        ),
      ).toThrow(/COPY_GENERATION_BLOCKED/u);
      expect(database.prepare('SELECT count(*) AS count FROM model_runs').get()).toEqual({
        count: 0,
      });
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('validates exact copy DTOs, pagination, revision, scope and confirmation shapes', () => {
    const valid = [
      [
        'getCopyDrafts',
        {
          briefId: null,
          limit: 25,
          offset: 0,
          profileId: null,
          query: '',
          state: null,
          status: null,
        },
      ],
      [
        'getCopyDraft',
        {
          draftId: 'draft-1',
          runLimit: 20,
          runOffset: 0,
          versionLimit: 20,
          versionOffset: 0,
        },
      ],
      ['previewCopyAction', { briefId: 'brief-1', kind: 'CREATE_MANUAL_SCAFFOLD' }],
      [
        'confirmCopyAction',
        {
          confirmation: 'APPLY_COPY_ACTION',
          executionId: null,
          kind: 'CREATE_MANUAL_SCAFFOLD',
          previewHash: 'a'.repeat(64),
          token: 'a'.repeat(43),
        },
      ],
      [
        'diffCopyDraftVersions',
        { draftId: 'draft-1', fromVersionId: 'version-1', toVersionId: 'version-2' },
      ],
    ] as const;
    for (const [operation, value] of valid) {
      expect(
        validateDesktopIpcRequest(RENDERER, [value], RENDERER, operation),
        operation,
      ).toBeNull();
    }
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ briefId: 'brief-1', kind: 'CREATE_MANUAL_SCAFFOLD', secret: 'no' }],
        RENDERER,
        'previewCopyAction',
      ),
    ).not.toBeNull();
    expect(
      validateDesktopIpcRequest(
        'https://attacker.invalid',
        [valid[0][1]],
        RENDERER,
        'getCopyDrafts',
      ),
    ).not.toBeNull();
  });
});
