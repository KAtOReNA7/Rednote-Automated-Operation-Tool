import { describe, expect, it } from 'vitest';

import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import { experimentDraft } from './support/experiment-fixtures.js';

const RENDERER = 'rednote://app/index.html';

describe('M3 Issue 023 experiment IPC boundary', () => {
  it('accepts exact bounded list, detail, preview, and confirmation inputs', () => {
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            limit: 100,
            offset: 1_000_000,
            profileId: 'primary',
            query: '单变量',
            state: 'ASSIGNMENT_READY',
          },
        ],
        RENDERER,
        'getExperiments',
      ),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            experimentId: 'experiment-ipc',
            historyLimit: 100,
            historyOffset: 0,
            versionLimit: 100,
            versionOffset: 0,
          },
        ],
        RENDERER,
        'getExperiment',
      ),
    ).toBeNull();
    for (const preview of [
      { design: experimentDraft(3), kind: 'CREATE_DRAFT', profileId: 'primary' },
      { experimentId: 'experiment-ipc', kind: 'SAVE_ASSIGNMENT' },
      {
        action: 'LOCK',
        expectedRevision: 2,
        experimentId: 'experiment-ipc',
        kind: 'STATE_ACTION',
      },
      {
        design: experimentDraft(3),
        expectedRevision: 3,
        experimentId: 'experiment-ipc',
        kind: 'CLONE_VERSION',
      },
    ]) {
      expect(
        validateDesktopIpcRequest(RENDERER, [preview], RENDERER, 'previewExperimentAction'),
      ).toBeNull();
    }
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            confirmation: 'APPLY_EXPERIMENT_ACTION',
            kind: 'SAVE_ASSIGNMENT',
            previewHash: 'a'.repeat(64),
            token: 'b'.repeat(43),
          },
        ],
        RENDERER,
        'confirmExperimentAction',
      ),
    ).toBeNull();
  });

  it.each([
    [
      'untrusted sender',
      'https://example.test/',
      [{ experimentId: 'experiment-ipc', kind: 'SAVE_ASSIGNMENT' }],
    ],
    [
      'extra production field',
      RENDERER,
      [{ automaticBrief: true, experimentId: 'experiment-ipc', kind: 'SAVE_ASSIGNMENT' }],
    ],
    [
      'factorial action',
      RENDERER,
      [
        {
          action: 'FACTORIAL',
          expectedRevision: 1,
          experimentId: 'experiment-ipc',
          kind: 'STATE_ACTION',
        },
      ],
    ],
    ['unsafe identifier', RENDERER, [{ experimentId: '../experiment', kind: 'SAVE_ASSIGNMENT' }]],
    [
      'fractional revision',
      RENDERER,
      [
        {
          action: 'LOCK',
          expectedRevision: 1.5,
          experimentId: 'experiment-ipc',
          kind: 'STATE_ACTION',
        },
      ],
    ],
    [
      'multiple changed dimensions',
      RENDERER,
      [
        {
          design: {
            ...experimentDraft(3),
            primaryVariable: {
              ...experimentDraft(3).primaryVariable,
              arms: experimentDraft(3).primaryVariable.arms.map((arm) => ({
                ...arm,
                changedDimensions: ['CONTENT_STRUCTURE', 'TITLE_PATTERN'],
              })),
            },
          },
          kind: 'CREATE_DRAFT',
          profileId: 'primary',
        },
      ],
    ],
  ])('rejects %s', (_label, sender, args) => {
    expect(
      validateDesktopIpcRequest(sender, args, RENDERER, 'previewExperimentAction'),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
  });

  it('rejects malformed confirmation, hashes, tokens, and secret-like extras', () => {
    for (const input of [
      {
        confirmation: 'START_REAL_EXPERIMENT',
        kind: 'SAVE_ASSIGNMENT',
        previewHash: 'a'.repeat(64),
        token: 'b'.repeat(43),
      },
      {
        confirmation: 'APPLY_EXPERIMENT_ACTION',
        kind: 'SAVE_ASSIGNMENT',
        previewHash: 'not-a-hash',
        token: 'short',
      },
      {
        apiKey: 'forbidden',
        confirmation: 'APPLY_EXPERIMENT_ACTION',
        kind: 'SAVE_ASSIGNMENT',
        previewHash: 'a'.repeat(64),
        token: 'b'.repeat(43),
      },
    ]) {
      expect(
        validateDesktopIpcRequest(RENDERER, [input], RENDERER, 'confirmExperimentAction'),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    }
  });
});
