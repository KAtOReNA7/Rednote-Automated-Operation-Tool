import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_SOURCES,
  CAPABILITY_STATES,
  assertCapability,
  createMockCapabilities,
  createUnknownCapabilities,
} from '../packages/providers/src/index.js';
import { createProviderContext } from './support/provider-test-utils.js';

describe('Issue 012 provider capabilities', () => {
  it('uses explicit three-state capabilities and three evidence sources', () => {
    expect(CAPABILITY_STATES).toEqual(['UNKNOWN', 'SUPPORTED', 'UNSUPPORTED']);
    expect(CAPABILITY_SOURCES).toEqual(['CONFIGURED_UNKNOWN', 'MOCK', 'PROBED']);
  });

  it('defaults every live capability to UNKNOWN with nullable observations', () => {
    const capabilities = createUnknownCapabilities();
    expect(capabilities).toEqual({
      batch: 'UNKNOWN',
      imageGeneration: 'UNKNOWN',
      maxContextTokens: null,
      observedAt: null,
      source: 'CONFIGURED_UNKNOWN',
      streaming: 'UNKNOWN',
      structuredJson: 'UNKNOWN',
      text: 'UNKNOWN',
      toolCalling: 'UNKNOWN',
      usage: 'UNKNOWN',
      vision: 'UNKNOWN',
      webSearch: 'UNKNOWN',
    });
    expect(Object.isFrozen(capabilities)).toBe(true);
  });

  it('does not infer capabilities from model IDs or URLs', () => {
    for (const ignored of ['vision-model', 'batch-model', 'image-model']) {
      const capabilities = createUnknownCapabilities();
      expect(capabilities.text, ignored).toBe('UNKNOWN');
      expect(capabilities.vision, ignored).toBe('UNKNOWN');
      expect(capabilities.batch, ignored).toBe('UNKNOWN');
    }
  });

  it('allows Mock to declare supported and unsupported states explicitly', () => {
    const capabilities = createMockCapabilities({ batch: 'UNSUPPORTED', text: 'SUPPORTED' });
    expect(capabilities.source).toBe('MOCK');
    expect(capabilities.text).toBe('SUPPORTED');
    expect(capabilities.batch).toBe('UNSUPPORTED');
    expect(capabilities.toolCalling).toBe('UNSUPPORTED');
  });

  it.each([
    ['UNKNOWN', 'PROVIDER_CAPABILITY_UNKNOWN'],
    ['UNSUPPORTED', 'PROVIDER_CAPABILITY_UNSUPPORTED'],
  ] as const)('rejects %s rather than treating it as supported', (state, code) => {
    const context = createProviderContext('TEXT_GENERATION', 'RESPONSES', {
      capabilities: {
        ...createUnknownCapabilities(),
        text: state,
      },
    });
    expect(() => assertCapability(context.capabilities, 'text', context)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});
