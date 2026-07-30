import { afterEach, describe, expect, it } from 'vitest';

import { DesktopBriefRuntime } from '../apps/desktop/src/brief-runtime.js';
import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  completeBriefDraft,
  createRepositoryScaffoldFixture,
  readyBriefDraft,
} from './support/brief-fixtures.js';

const RENDERER = 'rednote://app/index.html';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 024 desktop runtime and IPC', () => {
  it('binds one-use confirmation to sender/window and keeps scaffold creation local', async () => {
    const { database } = await createInitializedDatabase('brief runtime');
    const fixture = createRepositoryScaffoldFixture(database);
    const runtime = new DesktopBriefRuntime(database, {
      clock: () => new Date('2026-07-30T13:00:00.000Z'),
    });
    try {
      const wrong = runtime.preview(
        {
          assignmentPlanId: null,
          kind: 'CREATE_SCAFFOLD',
          topicId: fixture.input.topicId,
        },
        10,
        20,
      );
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
            executionId: null,
            kind: wrong.kind,
            previewHash: wrong.previewHash,
            token: wrong.token,
          },
          11,
          20,
        ),
      ).toThrow(/BRIEF_CONFIRMATION_INVALID/iu);

      const preview = runtime.preview(
        {
          assignmentPlanId: null,
          kind: 'CREATE_SCAFFOLD',
          topicId: fixture.input.topicId,
        },
        10,
        20,
      );
      expect(preview.preview).toMatchObject({
        evidenceRefCount: 0,
        experimentBound: false,
        kind: 'CREATE_SCAFFOLD',
        profileId: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
        subjectCount: 1,
      });
      const created = runtime.confirm(
        {
          confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
          executionId: null,
          kind: preview.kind,
          previewHash: preview.previewHash,
          token: preview.token,
        },
        10,
        20,
      );
      expect(created).toMatchObject({
        detail: { revision: 1, versionNumber: 1 },
        kind: 'CREATE_SCAFFOLD',
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
            executionId: null,
            kind: preview.kind,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          10,
          20,
        ),
      ).toThrow(/BRIEF_CONFIRMATION_INVALID/iu);
      expect(
        runtime.list({
          limit: 25,
          offset: 0,
          profileId: null,
          query: '',
          readiness: null,
          state: null,
        }).total,
      ).toBe(1);
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('exposes capability state before enqueue and never confirms UNKNOWN capability', async () => {
    const { database } = await createInitializedDatabase('brief runtime capability');
    const fixture = createRepositoryScaffoldFixture(database);
    const runtime = new DesktopBriefRuntime(database, {
      capabilityState: () => 'UNKNOWN',
      clock: () => new Date('2026-07-30T13:10:00.000Z'),
    });
    try {
      const create = runtime.preview(
        {
          assignmentPlanId: null,
          kind: 'CREATE_SCAFFOLD',
          topicId: fixture.input.topicId,
        },
        1,
        2,
      );
      const created = runtime.confirm(
        {
          confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
          executionId: null,
          kind: create.kind,
          previewHash: create.previewHash,
          token: create.token,
        },
        1,
        2,
      );
      if (!('detail' in created)) throw new Error('Expected detail.');
      const save = runtime.preview(
        {
          briefId: created.detail.briefId,
          draft: completeBriefDraft(created.detail.draft),
          expectedRevision: created.detail.revision,
          kind: 'SAVE_EDIT',
        },
        1,
        2,
      );
      const saved = runtime.confirm(
        {
          confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
          executionId: null,
          kind: save.kind,
          previewHash: save.previewHash,
          token: save.token,
        },
        1,
        2,
      );
      if (!('detail' in saved)) throw new Error('Expected detail.');
      expect(saved.detail).toMatchObject({
        readiness: 'READY_FOR_DRAFT_GENERATION',
        readinessReasonCodes: [],
      });
      const generation = runtime.preview(
        {
          briefId: saved.detail.briefId,
          expectedRevision: saved.detail.revision,
          kind: 'PREVIEW_GENERATION',
        },
        1,
        2,
      );
      expect(generation.preview).toMatchObject({
        capabilityState: 'UNKNOWN',
        kind: 'PREVIEW_GENERATION',
        modelConfigured: false,
        noNetworkBeforeConfirmation: true,
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
            executionId: 'must-not-send',
            kind: generation.kind,
            previewHash: generation.previewHash,
            token: generation.token,
          },
          1,
          2,
        ),
      ).toThrow(/BRIEF_INVALID_GENERATION/iu);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM content_brief_generation_runs
             WHERE external_request_count <> 0`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('validates exact Brief request DTOs, origin, token, revision, and size', () => {
    const validList = [
      {
        limit: 25,
        offset: 0,
        profileId: null,
        query: '',
        readiness: null,
        state: null,
      },
    ];
    expect(validateDesktopIpcRequest(RENDERER, validList, RENDERER, 'getBriefs')).toBeNull();
    expect(
      validateDesktopIpcRequest('https://outside.invalid', validList, RENDERER, 'getBriefs'),
    ).toMatchObject({ ok: false });
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ ...validList[0], unexpected: true }],
        RENDERER,
        'getBriefs',
      ),
    ).toMatchObject({ ok: false });
    const validDetail = [
      {
        briefId: 'brief-fixture',
        evidenceLimit: 25,
        evidenceOffset: 0,
        generationLimit: 25,
        generationOffset: 0,
        historyLimit: 25,
        historyOffset: 0,
        versionLimit: 25,
        versionOffset: 0,
      },
    ];
    expect(validateDesktopIpcRequest(RENDERER, validDetail, RENDERER, 'getBrief')).toBeNull();
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ ...validDetail[0], generationOffset: 1_000_001 }],
        RENDERER,
        'getBrief',
      ),
    ).toMatchObject({ ok: false });
    const create = {
      assignmentPlanId: null,
      kind: 'CREATE_SCAFFOLD',
      topicId: 'topic-fixture',
    };
    expect(
      validateDesktopIpcRequest(RENDERER, [create], RENDERER, 'previewBriefAction'),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ ...create, context: { topicCurrent: true } }],
        RENDERER,
        'previewBriefAction',
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
            executionId: null,
            kind: 'ARCHIVE',
            previewHash: 'a'.repeat(64),
            token: 'too-short',
          },
        ],
        RENDERER,
        'confirmBriefAction',
      ),
    ).toMatchObject({ ok: false });
    const boundedLargeDraft = {
      ...readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT'),
      openQuestionsAndLimitations: Array.from(
        { length: 12 },
        (_, index) => `${index}:${'x'.repeat(3_000)}`,
      ),
    };
    const boundedLargeSave = {
      briefId: 'brief-fixture',
      draft: boundedLargeDraft,
      expectedRevision: 1,
      kind: 'SAVE_EDIT',
    };
    expect(Buffer.byteLength(JSON.stringify([boundedLargeSave]), 'utf8')).toBeGreaterThan(
      32 * 1024,
    );
    expect(
      validateDesktopIpcRequest(RENDERER, [boundedLargeSave], RENDERER, 'previewBriefAction'),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ ...create, topicId: 'x'.repeat(2 * 1024 * 1024) }],
        RENDERER,
        'previewBriefAction',
      ),
    ).toMatchObject({ ok: false });
  });
});
