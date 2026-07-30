import { describe, expect, it } from 'vitest';

import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';

const RENDERER = 'rednote://app/index.html';

describe('M3 Issue 022 Topic IPC boundary', () => {
  it('accepts exact bounded pool, detail, preview, and confirmation inputs', () => {
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            contentType: 'CROSS_WORK_COMPARISON',
            eligibility: 'ELIGIBLE',
            limit: 100,
            offset: 1_000_000,
            profileId: 'primary',
            query: '合成选题',
            state: 'LOCKED',
          },
        ],
        RENDERER,
        'getTopicPool',
      ),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ historyLimit: 100, topicId: 'topic-ipc' }],
        RENDERER,
        'getTopic',
      ),
    ).toBeNull();
    for (const preview of [
      { kind: 'GENERATE', profileId: 'primary' },
      {
        draft: {
          action: 'LOCK',
          expectedRevision: 1,
          topicId: 'topic-ipc',
        },
        kind: 'STATE_CHANGE',
      },
      { expectedRevision: 2, kind: 'STATE_UNDO', topicId: 'topic-ipc' },
      {
        draft: {
          action: 'HOLD',
          items: [{ expectedRevision: 2, topicId: 'topic-ipc' }],
        },
        kind: 'BATCH_STATE_CHANGE',
      },
      { kind: 'QUOTA_PLAN', maxWorkExposure: 3, profileId: 'primary' },
      { expectedRevision: 2, kind: 'CANCEL_GENERATION', runId: 'topic-run-ipc' },
    ]) {
      expect(
        validateDesktopIpcRequest(RENDERER, [preview], RENDERER, 'previewTopicAction'),
      ).toBeNull();
    }
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            confirmation: 'APPLY_TOPIC_ACTION',
            executionId: 'topic-execution-ipc',
            kind: 'GENERATE',
            previewHash: 'a'.repeat(64),
            token: 'b'.repeat(43),
          },
        ],
        RENDERER,
        'confirmTopicAction',
      ),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            confirmation: 'APPLY_TOPIC_ACTION',
            executionId: 'topic-quota-execution-ipc',
            kind: 'QUOTA_PLAN',
            previewHash: 'a'.repeat(64),
            token: 'b'.repeat(43),
          },
        ],
        RENDERER,
        'confirmTopicAction',
      ),
    ).toBeNull();
  });

  it.each([
    ['untrusted sender', 'https://example.test/', [{ kind: 'GENERATE', profileId: 'primary' }]],
    [
      'extra action field',
      RENDERER,
      [{ automaticPublish: true, kind: 'GENERATE', profileId: 'primary' }],
    ],
    ['unsafe identifier', RENDERER, [{ kind: 'GENERATE', profileId: '../profile' }]],
    [
      'fractional revision',
      RENDERER,
      [
        {
          draft: { action: 'LOCK', expectedRevision: 1.5, topicId: 'topic-ipc' },
          kind: 'STATE_CHANGE',
        },
      ],
    ],
    [
      'empty batch',
      RENDERER,
      [{ draft: { action: 'HOLD', items: [] }, kind: 'BATCH_STATE_CHANGE' }],
    ],
    [
      'oversized batch',
      RENDERER,
      [
        {
          draft: {
            action: 'HOLD',
            items: Array.from({ length: 51 }, (_, index) => ({
              expectedRevision: 1,
              topicId: `topic-ipc-${index}`,
            })),
          },
          kind: 'BATCH_STATE_CHANGE',
        },
      ],
    ],
  ])('rejects %s', (_label, sender, args) => {
    expect(validateDesktopIpcRequest(sender, args, RENDERER, 'previewTopicAction')).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
      ok: false,
    });
  });

  it('rejects malformed hashes/tokens, secret-like extras, and invalid execution-ID placement', () => {
    for (const input of [
      {
        confirmation: 'APPLY_TOPIC_ACTION',
        executionId: null,
        kind: 'QUOTA_PLAN',
        previewHash: 'a'.repeat(64),
        token: 'b'.repeat(43),
      },
      {
        confirmation: 'APPLY_TOPIC_ACTION',
        executionId: 'topic-execution-ipc',
        kind: 'GENERATE',
        previewHash: 'not-a-hash',
        token: 'short',
      },
      {
        apiKey: 'forbidden',
        confirmation: 'APPLY_TOPIC_ACTION',
        executionId: 'topic-execution-ipc',
        kind: 'GENERATE',
        previewHash: 'a'.repeat(64),
        token: 'b'.repeat(43),
      },
    ]) {
      expect(
        validateDesktopIpcRequest(RENDERER, [input], RENDERER, 'confirmTopicAction'),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    }
  });
});
