import { describe, expect, it } from 'vitest';

import {
  type DesktopIpcOperation,
  validateDesktopIpcRequest,
} from '../apps/desktop/src/ipc-policy.js';

const RENDERER = 'rednote://app/index.html';

const validRequests: Readonly<Record<DesktopIpcOperation, readonly unknown[]>> = {
  buildDiagnosticPreview: [],
  cancelCatalogDiscovery: [
    {
      confirmation: 'CANCEL_BIBLIOGRAPHY_DISCOVERY',
      expectedRevision: 1,
      runId: 'run-fixture-000001',
    },
  ],
  cancelSourceProcessing: [
    {
      confirmation: 'CANCEL_SOURCE_PROCESSING',
      expectedRevision: 2,
      runId: 'evidence-run-fixture',
    },
  ],
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
  confirmCatalogDiscovery: [
    {
      confirmation: 'START_BIBLIOGRAPHY_DISCOVERY',
      expectedRevision: 1,
      previewHash: 'a'.repeat(64),
      token: 'a'.repeat(43),
    },
  ],
  confirmCatalogUndo: [
    {
      confirmation: 'APPLY_CATALOG_DECISION',
      previewHash: 'a'.repeat(64),
      token: 'a'.repeat(43),
    },
  ],
  confirmCatalogWorkMerge: [
    {
      confirmation: 'APPLY_CATALOG_DECISION',
      previewHash: 'a'.repeat(64),
      token: 'a'.repeat(43),
    },
  ],
  confirmCatalogWorkSplit: [
    {
      confirmation: 'APPLY_CATALOG_DECISION',
      previewHash: 'a'.repeat(64),
      token: 'a'.repeat(43),
    },
  ],
  confirmEvidenceConflict: [
    {
      confirmation: 'APPLY_FACT_CONFLICT_DECISION',
      previewHash: 'a'.repeat(64),
      reason: '用户核对了两个来源的限定范围。',
      token: 'a'.repeat(43),
    },
  ],
  confirmSourceProcessing: [
    {
      confirmation: 'START_SOURCE_PROCESSING',
      planHash: 'a'.repeat(64),
      previewHash: 'b'.repeat(64),
      token: 'a'.repeat(43),
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
  getFetchState: [],
  getBrowserClip: [
    { clipId: `clip-${'a'.repeat(8)}-${'b'.repeat(4)}-4ccc-8ddd-${'e'.repeat(12)}` },
  ],
  getCatalogState: [{ limit: 25, offset: 0, query: '' }],
  getCatalogWork: [{ workId: 'work-fixture-000001' }],
  getEvidenceState: [{ limit: 25, offset: 0 }],
  getModelAccounting: [],
  getProviderCapabilityProbeProgress: [{ runId: 'probe-runtime-000001' }],
  getProviderCapabilityState: [],
  getLocalApiStatus: [],
  getRuntimeCapabilities: [],
  getSearchState: [],
  getSettings: [],
  getSetupState: [],
  getWindowState: [],
  listLocalApiClients: [],
  listBrowserClips: [],
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
  previewCatalogDiscovery: [
    {
      batchSize: 50,
      maxObservations: 500,
      maxRuntimeMs: 60_000,
      originKinds: ['SEARCH_CANDIDATE', 'FETCH_DOCUMENT', 'BROWSER_CLIP_CANDIDATE'],
      purpose: 'PILOT_CONTENT',
    },
  ],
  previewCatalogUndo: [{ decisionId: 'decision-fixture-000001' }],
  previewCatalogWorkMerge: [
    {
      duplicateRevision: 1,
      duplicateWorkId: 'work-duplicate-000001',
      survivorRevision: 1,
      survivorWorkId: 'work-survivor-000001',
    },
  ],
  previewCatalogWorkSplit: [
    {
      expressionIds: ['expression-fixture-000001'],
      newCanonicalTitle: '拆分后的作品',
      sourceRevision: 1,
      sourceWorkId: 'work-source-000001',
    },
  ],
  previewEvidenceConflict: [
    {
      acceptedClaimId: 'claim-fixture-000001',
      action: 'ACCEPT_CLAIM',
      conflictId: 'conflict-fixture-000001',
    },
  ],
  previewSourceProcessing: [
    {
      includeModelSteps: false,
      sourceRevisionIds: ['source-fixture:1'],
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
  updateFetchPolicy: [
    {
      enabled: false,
      expectedRevision: 1,
      globalMaxConcurrent: 2,
      maxRequestsPerWindow: 30,
      minIntervalMs: 2_000,
      windowMs: 60_000,
    },
  ],
  updateSearchProviderConfig: [
    {
      curatedEntries: [],
      enabled: true,
      expectedRevision: 1,
      maxResults: 1,
      providerInstanceId: 'manual-url-v1',
      ratePolicy: null,
      timeoutMs: 5_000,
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

  it('rejects catalog SQL, paths, raw payloads, invalid limits and malformed confirmation tokens', () => {
    const state = validRequests.getCatalogState[0] as Record<string, unknown>;
    const discovery = validRequests.previewCatalogDiscovery[0] as Record<string, unknown>;
    const confirmation = validRequests.confirmCatalogWorkMerge[0] as Record<string, unknown>;
    for (const invalid of [
      [{ ...state, sql: 'SELECT * FROM books' }, 'getCatalogState'],
      [{ ...state, absolutePath: 'C:\\private\\catalog.sqlite' }, 'getCatalogState'],
      [{ ...discovery, maxObservations: 0 }, 'previewCatalogDiscovery'],
      [{ ...discovery, batchSize: 1_001 }, 'previewCatalogDiscovery'],
      [{ ...discovery, rawResponse: '<html>unsafe</html>' }, 'previewCatalogDiscovery'],
      [{ ...confirmation, token: 'short' }, 'confirmCatalogWorkMerge'],
      [{ ...confirmation, previewHash: 'not-a-hash' }, 'confirmCatalogWorkMerge'],
      [{ ...confirmation, confirmation: 'YES' }, 'confirmCatalogWorkMerge'],
    ] as const) {
      expect(
        validateDesktopIpcRequest(
          RENDERER,
          [invalid[0]],
          RENDERER,
          invalid[1] as DesktopIpcOperation,
        ),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    }
  });
});
