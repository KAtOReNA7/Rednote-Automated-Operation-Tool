import { describe, expect, it } from 'vitest';

import {
  type DesktopIpcOperation,
  validateDesktopIpcRequest,
} from '../apps/desktop/src/ipc-policy.js';

const RENDERER = 'rednote://app/index.html';

const validRequests: Readonly<Record<DesktopIpcOperation, readonly unknown[]>> = {
  buildDiagnosticPreview: [],
  clearCredential: [
    {
      confirmation: 'DELETE_CONTENT_AI_API_KEY',
      slot: 'CONTENT_AI_API_KEY',
    },
  ],
  confirmDataRootSelection: [
    {
      confirmation: 'ACTIVATE_DATA_ROOT',
      expectedRevision: 0,
      mode: 'CREATE_OR_OPEN',
      token: 'selection-token-000010',
    },
  ],
  exportDiagnosticReport: [{ expectedPreviewHash: 'a'.repeat(64) }],
  getAppInfo: [],
  getCredentialStatus: [{ slot: 'CONTENT_AI_API_KEY' }],
  getFoundationHealth: [],
  getLocalApiStatus: [],
  getRuntimeCapabilities: [],
  getSettings: [],
  getSetupState: [],
  getWindowState: [],
  listLocalApiClients: [],
  cancelLocalApiPairing: [{ pairingSessionId: 'pairing-session-000011' }],
  revokeLocalApiClient: [
    {
      clientId: 'client-id-000011',
      confirmation: 'REVOKE_LOCAL_API_CLIENT',
      expectedRevision: 0,
    },
  ],
  selectDataRoot: [],
  setCredential: [
    {
      plaintext: 'runtime-only-unusable-value',
      slot: 'CONTENT_AI_API_KEY',
    },
  ],
  startLocalApiPairing: [],
  updateLocalApiSettings: [{ enabled: true, expectedRevision: 0, port: 43_119 }],
  updateNonSecretSettings: [
    {
      account: { bio: '', workingName: '未命名账号' },
      budget: { hardLimitDollars: '100.00', warningDollars: '80.00' },
      expectedRevision: 0,
      models: {
        embedding: null,
        image: null,
        research: null,
        review: null,
        writing: null,
      },
      providerBaseUrl: null,
    },
  ],
};

describe('Issue 010 strict IPC request policy', () => {
  it.each(Object.entries(validRequests) as Array<[DesktopIpcOperation, readonly unknown[]]>)(
    'accepts the exact %s request shape',
    (operation, args) => {
      expect(validateDesktopIpcRequest(RENDERER, args, RENDERER, operation)).toBeNull();
    },
  );

  it.each([
    'rednote://evil/index.html',
    'file:///C:/local.txt',
    'https://example.test/',
    'data:text/html,bad',
  ])('rejects an unauthorized sender origin: %s', (senderUrl) => {
    expect(validateDesktopIpcRequest(senderUrl, [], RENDERER, 'getSettings')).toMatchObject({
      error: {
        code: 'INVALID_REQUEST',
        message: '请求来源未获授权。',
        retryable: false,
      },
      ok: false,
    });
  });

  it.each(Object.entries(validRequests) as Array<[DesktopIpcOperation, readonly unknown[]]>)(
    'rejects extra arguments for %s',
    (operation, args) => {
      expect(
        validateDesktopIpcRequest(RENDERER, [...args, { extra: true }], RENDERER, operation),
      ).toMatchObject({
        error: { code: 'INVALID_REQUEST' },
        ok: false,
      });
    },
  );

  it('rejects extra fields and secret-like fields in non-secret settings', () => {
    const valid = validRequests.updateNonSecretSettings[0] as Record<string, unknown>;
    for (const extra of [
      { arbitrary: true },
      { apiKey: 'must-not-cross-this-method' },
      { authorization: 'must-not-cross-this-method' },
      { ciphertext: 'must-not-cross-this-method' },
      { password: 'must-not-cross-this-method' },
    ]) {
      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [{ ...valid, ...extra }],
          RENDERER,
          'updateNonSecretSettings',
        ),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    }
  });

  it('never accepts a renderer-supplied absolute path for root selection or diagnostics', () => {
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ path: 'C:\\arbitrary project' }],
        RENDERER,
        'selectDataRoot',
      ),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [
          {
            confirmation: 'ACTIVATE_DATA_ROOT',
            expectedRevision: null,
            mode: 'CREATE_OR_OPEN',
            path: 'C:\\arbitrary project',
            token: 'selection-token-000010',
          },
        ],
        RENDERER,
        'confirmDataRootSelection',
      ),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ expectedPreviewHash: 'a'.repeat(64), outputPath: 'C:\\arbitrary.json' }],
        RENDERER,
        'exportDiagnosticReport',
      ),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('enforces fixed credential slot, explicit clear confirmation, and bounded plaintext', () => {
    for (const input of [
      { plaintext: 'value', slot: 'ARBITRARY' },
      { plaintext: '', slot: 'CONTENT_AI_API_KEY' },
      { plaintext: 'line\nbreak', slot: 'CONTENT_AI_API_KEY' },
      { plaintext: 'x'.repeat(16 * 1024 + 1), slot: 'CONTENT_AI_API_KEY' },
    ]) {
      expect(validateDesktopIpcRequest(RENDERER, [input], RENDERER, 'setCredential')).toMatchObject(
        { error: { code: 'INVALID_REQUEST' } },
      );
    }
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ confirmation: 'YES', slot: 'CONTENT_AI_API_KEY' }],
        RENDERER,
        'clearCredential',
      ),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('rejects invalid tokens, stale revision shapes, excessive depth, and oversized input', () => {
    const base = validRequests.confirmDataRootSelection[0] as Record<string, unknown>;
    for (const invalid of [
      { ...base, token: 'C:\\selected project' },
      { ...base, expectedRevision: -1 },
      { ...base, expectedRevision: 1.5 },
      { ...base, confirmation: 'YES' },
    ]) {
      expect(
        validateDesktopIpcRequest(RENDERER, [invalid], RENDERER, 'confirmDataRootSelection'),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    }
    let deep: unknown = 'leaf';
    for (let index = 0; index < 8; index += 1) {
      deep = { child: deep };
    }
    expect(validateDesktopIpcRequest(RENDERER, [deep], RENDERER, 'setCredential')).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ plaintext: 'x'.repeat(33 * 1024), slot: 'CONTENT_AI_API_KEY' }],
        RENDERER,
        'setCredential',
      ),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });
});
