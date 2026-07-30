import { describe, expect, it } from 'vitest';

import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';

const RENDERER = 'rednote://app/index.html';

function stateAction(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      confirmationKind: 'USER_EXPLICIT',
      expectedRevision: 0,
      finishedAt: null,
      finishedAtPrecision: 'UNKNOWN',
      lastReadAt: null,
      lastReadAtPrecision: 'UNKNOWN',
      memoryConfidence: 'UNKNOWN',
      nextState: 'UNCLASSIFIED',
      profileId: 'primary',
      provenance: 'USER_UI',
      subject: {
        editionId: null,
        expressionId: null,
        workId: 'work-ipc',
      },
      userNote: null,
      ...overrides,
    },
    kind: 'STATE_CHANGE',
  };
}

describe('Issue 021 authenticity IPC boundary', () => {
  it('accepts exact bounded list/detail/action/confirmation inputs', () => {
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ limit: 25, offset: 0, profileId: 'primary', query: '' }],
        RENDERER,
        'getAuthenticityLibrary',
      ),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ historyLimit: 50, historyOffset: 0, profileId: 'primary', workId: 'work-ipc' }],
        RENDERER,
        'getAuthenticityWork',
      ),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(RENDERER, [stateAction()], RENDERER, 'previewAuthenticityAction'),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            confirmation: 'APPLY_AUTHENTICITY_ACTION',
            kind: 'STATE_CHANGE',
            previewHash: 'a'.repeat(64),
            token: 'a'.repeat(43),
          },
        ],
        RENDERER,
        'confirmAuthenticityAction',
      ),
    ).toBeNull();
  });

  it.each([
    ['untrusted sender', 'https://example.test', [stateAction()]],
    ['extra top-level field', RENDERER, [{ ...stateAction(), automaticInference: true }]],
    [
      'extra nested subject field',
      RENDERER,
      [
        stateAction({
          subject: {
            editionId: null,
            expressionId: null,
            inferredFromPurchase: true,
            workId: 'work-ipc',
          },
        }),
      ],
    ],
    ['unsafe profile', RENDERER, [stateAction({ profileId: '../profile' })]],
    ['fractional revision', RENDERER, [stateAction({ expectedRevision: 0.5 })]],
    [
      'illegal confidence matrix',
      RENDERER,
      [stateAction({ memoryConfidence: 'CLEAR', nextState: 'S1_RESEARCH_ONLY' })],
    ],
    ['oversized note', RENDERER, [stateAction({ userNote: '字'.repeat(30_000) })]],
  ])('rejects %s', (_label, sender, args) => {
    expect(
      validateDesktopIpcRequest(sender, args, RENDERER, 'previewAuthenticityAction'),
    ).toMatchObject({ ok: false });
  });

  it('rejects over-capacity batches, secret-like extras and malformed confirmations', () => {
    const batch = {
      draft: {
        confirmationKind: 'USER_BATCH_EXPLICIT',
        items: Array.from({ length: 51 }, (_, index) => ({
          expectedRevision: 0,
          workId: `work-${index}`,
        })),
        memoryConfidence: 'UNKNOWN',
        nextState: 'UNCLASSIFIED',
        profileId: 'primary',
        provenance: 'USER_UI',
      },
      kind: 'BATCH_STATE_CHANGE',
    };
    expect(
      validateDesktopIpcRequest(RENDERER, [batch], RENDERER, 'previewAuthenticityAction'),
    ).toMatchObject({ ok: false });
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            confirmation: 'APPLY_AUTHENTICITY_ACTION',
            kind: 'STATE_CHANGE',
            previewHash: 'not-a-hash',
            token: 'short',
          },
        ],
        RENDERER,
        'confirmAuthenticityAction',
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            apiKey: 'forbidden',
            confirmation: 'APPLY_AUTHENTICITY_ACTION',
            kind: 'STATE_CHANGE',
            previewHash: 'a'.repeat(64),
            token: 'a'.repeat(43),
          },
        ],
        RENDERER,
        'confirmAuthenticityAction',
      ),
    ).toMatchObject({ ok: false });
  });
});
