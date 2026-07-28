import { describe, expect, it } from 'vitest';

import {
  CONTENT_AI_CREDENTIAL_REFERENCE,
  ProviderConfigLoader,
  assertConfiguredModel,
  assertCurrentConfigRevision,
  type ProviderSettingsSnapshot,
} from '../packages/providers/src/index.js';
import { createProviderConfig, createProviderContext } from './support/provider-test-utils.js';

function settings(overrides: Partial<ProviderSettingsSnapshot> = {}): ProviderSettingsSnapshot {
  return {
    credentialReference: CONTENT_AI_CREDENTIAL_REFERENCE,
    embeddingModelId: 'model-embedding',
    imageModelId: 'model-image',
    providerBaseUrl: 'https://relay.invalid/base/v1/',
    providerProtocol: 'OPENAI_COMPATIBLE',
    researchModelId: 'model-research',
    reviewModelId: 'model-review',
    revision: 11,
    setupState: 'PROVIDER_CONFIGURED_UNVERIFIED',
    writingModelId: 'model-writing',
    ...overrides,
  };
}

describe('Issue 012 provider configuration', () => {
  it('loads only the Issue 010 settings shape and returns a deep-frozen secret-free config', () => {
    const loader = new ProviderConfigLoader({
      readProviderSettings: () => settings(),
    });
    const config = loader.load('provider-a');
    expect(config).toEqual({
      baseUrl: 'https://relay.invalid/base/v1',
      credentialReference: 'CONTENT_AI_API_KEY',
      modelIds: {
        embedding: 'model-embedding',
        image: 'model-image',
        research: 'model-research',
        review: 'model-review',
        writing: 'model-writing',
      },
      protocol: 'OPENAI_COMPATIBLE',
      providerId: 'provider-a',
      revision: 11,
      verificationState: 'CONFIGURED_UNVERIFIED',
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.modelIds)).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/credential[^R]|authorization|bearer/iu);
  });

  it.each([
    { providerBaseUrl: null },
    { credentialReference: null },
    { setupState: 'PROVIDER_CONFIG_INCOMPLETE' },
    { providerProtocol: 'invalid' as 'OPENAI_COMPATIBLE' },
    { revision: -1 },
  ])('rejects an incomplete provider snapshot %#', (override) => {
    const loader = new ProviderConfigLoader({
      readProviderSettings: () => settings(override),
    });
    expect(() => loader.load('provider-a')).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }),
    );
  });

  it.each([
    'https://user:pass@relay.invalid/v1',
    'https://relay.invalid/v1?mode=test',
    'https://relay.invalid/v1#fragment',
    'http://relay.invalid/v1',
  ])('rejects unsafe configured URL %s', (providerBaseUrl) => {
    const loader = new ProviderConfigLoader({
      readProviderSettings: () => settings({ providerBaseUrl }),
    });
    expect(() => loader.load('provider-a')).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }),
    );
  });

  it('allows Issue 010 loopback HTTP without performing a request', () => {
    const loader = new ProviderConfigLoader({
      readProviderSettings: () => settings({ providerBaseUrl: 'http://127.0.0.1:43199/v1/' }),
    });
    expect(loader.load('provider-a').baseUrl).toBe('http://127.0.0.1:43199/v1');
  });

  it('detects a stale revision before a provider call', () => {
    expect(() =>
      assertCurrentConfigRevision(createProviderConfig(), 8, {
        modelId: 'model-writing',
        operation: 'TEXT_GENERATION',
        requestId: 'request-stale',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PROVIDER_STALE_CONFIGURATION',
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
      }),
    );
  });

  it('rejects missing or caller-selected model IDs', () => {
    for (const modelId of ['', 'caller-override']) {
      expect(() =>
        assertConfiguredModel(createProviderConfig(), modelId, {
          operation: 'TEXT_GENERATION',
          requestId: 'request-model',
        }),
      ).toThrowError(expect.objectContaining({ code: 'PROVIDER_MODEL_NOT_CONFIGURED' }));
    }
  });

  it('accepts only model IDs present in the loaded config', () => {
    expect(() =>
      assertConfiguredModel(createProviderConfig(), 'model-writing', {
        operation: 'TEXT_GENERATION',
        requestId: createProviderContext('TEXT_GENERATION', 'RESPONSES').requestId,
      }),
    ).not.toThrow();
  });
});
