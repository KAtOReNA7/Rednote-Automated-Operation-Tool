import { describe, expect, it } from 'vitest';

import {
  type DesktopIpcOperation,
  validateDesktopIpcRequest,
} from '../apps/desktop/src/ipc-policy.js';

const RENDERER = 'rednote://app/index.html';

const validRequests: Readonly<Record<DesktopIpcOperation, readonly unknown[]>> = {
  buildDiagnosticPreview: [],
  cancelProviderCapabilityProbe: [
    {
      confirmation: 'CANCEL_PROVIDER_CAPABILITY_PROBE',
      runId: 'probe-runtime-000001',
    },
  ],
  clearCredential: [
    {
      confirmation: 'DELETE_CONTENT_AI_API_KEY',
      slot: 'CONTENT_AI_API_KEY',
    },
  ],
  confirmModelCacheClear: [
    {
      confirmation: 'CLEAR_MODEL_RESULT_CACHE',
      expectedBytes: 0,
      expectedCount: 0,
      previewToken: 'a'.repeat(43),
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
  createModelPriceSchedule: [
    {
      cachedInputPerMillionUsd: null,
      cacheWritePerMillionUsd: null,
      callUsd: null,
      expectedSettingsRevision: 0,
      imageGenerationCallUsd: null,
      imageUsd: null,
      inputPerMillionUsd: '1.25',
      inputTokensIncludeCachedInput: false,
      modelId: 'fixture-model',
      operationKind: 'TEXT_GENERATION',
      outputPerMillionUsd: '2.5',
      protocolMode: null,
      searchCallUsd: null,
      toolUnitUsd: null,
      usageSemanticsVersion: 'usage-v1',
    },
  ],
  createModelUnitPolicy: [
    {
      expectedSettingsRevision: 0,
      maxExternalCallsMonthly: 400,
      maxExternalCallsWeekly: 100,
      maxImageGenerationCalls: null,
      maxImages: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      maxToolCalls: null,
      maxWebSearchCalls: null,
      scopeKind: 'GLOBAL',
      scopeValue: null,
    },
  ],
  exportDiagnosticReport: [{ expectedPreviewHash: 'a'.repeat(64) }],
  getAppInfo: [],
  getCredentialStatus: [{ slot: 'CONTENT_AI_API_KEY' }],
  getFoundationHealth: [],
  getModelAccounting: [],
  getProviderCapabilityProbeProgress: [{ runId: 'probe-runtime-000001' }],
  getProviderCapabilityState: [],
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
  previewProviderCapabilityProbe: [
    {
      includeToolCalling: false,
      profile: 'CORE',
      selectedCapabilities: [],
    },
  ],
  previewModelCacheClear: [],
  setCredential: [
    {
      plaintext: 'runtime-only-unusable-value',
      slot: 'CONTENT_AI_API_KEY',
    },
  ],
  startLocalApiPairing: [],
  startProviderCapabilityProbe: [
    {
      confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
      credentialBindingVersion: 0,
      planHash: 'a'.repeat(64),
      settingsRevision: 0,
      startToken: 'a'.repeat(43),
    },
  ],
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

  it('rejects provider capability URL, model, credential, prompt, header, and body injection', () => {
    const preview = validRequests.previewProviderCapabilityProbe[0] as Record<string, unknown>;
    for (const extra of [
      { baseUrl: 'https://outside.invalid/v1' },
      { model: 'caller-model' },
      { credential: 'caller-secret' },
      { prompt: 'caller prompt' },
      { headers: { Authorization: 'Bearer bad' } },
      { body: { arbitrary: true } },
    ]) {
      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [{ ...preview, ...extra }],
          RENDERER,
          'previewProviderCapabilityProbe',
        ),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    }
  });

  it('requires exact capability confirmation, revision, hash and single bounded token', () => {
    const start = validRequests.startProviderCapabilityProbe[0] as Record<string, unknown>;
    for (const invalid of [
      { ...start, confirmation: 'YES' },
      { ...start, startToken: 'short' },
      { ...start, planHash: 'not-a-hash' },
      { ...start, settingsRevision: -1 },
      { ...start, credentialBindingVersion: 1.5 },
    ]) {
      expect(
        validateDesktopIpcRequest(RENDERER, [invalid], RENDERER, 'startProviderCapabilityProbe'),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    }
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
