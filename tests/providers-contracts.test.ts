import { describe, expect, it } from 'vitest';

import {
  FINISH_REASONS,
  IMAGE_INPUT_MIME_TYPES,
  IMAGE_QUALITY_HINTS,
  IMAGE_SIZE_HINTS,
  MESSAGE_ROLES,
  OUTCOME_CERTAINTIES,
  PROTOCOL_MODES,
  PROVIDER_ERROR_CODES,
  PROVIDER_OPERATIONS,
  RETRY_DISPOSITIONS,
  TRISTATE_HINTS,
  validateCallContext,
  validateGenerationOptions,
} from '../packages/providers/src/index.js';
import { createProviderContext } from './support/provider-test-utils.js';

describe('Issue 012 provider contracts', () => {
  it('freezes the four operations and four explicit protocol modes', () => {
    expect(PROVIDER_OPERATIONS).toEqual([
      'TEXT_GENERATION',
      'STRUCTURED_GENERATION',
      'VISION_ANALYSIS',
      'IMAGE_GENERATION',
    ]);
    expect(PROTOCOL_MODES).toEqual(['RESPONSES', 'CHAT_COMPLETIONS', 'IMAGES_GENERATIONS', 'MOCK']);
  });

  it('limits roles, finish reasons, image hints, and MIME values', () => {
    expect(MESSAGE_ROLES).toEqual(['SYSTEM', 'USER', 'ASSISTANT']);
    expect(FINISH_REASONS).toContain('UNKNOWN');
    expect(IMAGE_INPUT_MIME_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    expect(IMAGE_SIZE_HINTS).toEqual(['AUTO', 'SQUARE', 'PORTRAIT', 'LANDSCAPE']);
    expect(IMAGE_QUALITY_HINTS).toEqual(['AUTO', 'LOW', 'MEDIUM', 'HIGH']);
    expect(TRISTATE_HINTS).toEqual(['UNSPECIFIED', 'ENABLED', 'DISABLED']);
  });

  it('freezes retry and outcome semantics and all required stable error codes', () => {
    expect(RETRY_DISPOSITIONS).toEqual([
      'DO_NOT_RETRY',
      'RETRY_AUTOMATIC_SAFE',
      'RETRY_QUEUE',
      'RETRY_MANUAL',
    ]);
    expect(OUTCOME_CERTAINTIES).toEqual([
      'NOT_SENT',
      'REJECTED_BEFORE_EXECUTION',
      'MAY_HAVE_EXECUTED',
      'COMPLETED_INVALID_OUTPUT',
    ]);
    for (const code of [
      'PROVIDER_NOT_CONFIGURED',
      'PROVIDER_MODEL_NOT_CONFIGURED',
      'PROVIDER_CAPABILITY_UNKNOWN',
      'PROVIDER_TIMEOUT',
      'PROVIDER_RATE_LIMITED',
      'PROVIDER_INVALID_JSON',
      'PROVIDER_SCHEMA_VALIDATION_FAILED',
      'PROVIDER_AMBIGUOUS_OUTCOME',
    ]) {
      expect(PROVIDER_ERROR_CODES).toContain(code);
    }
  });

  it.each([
    ['requestId', ''],
    ['providerId', ' space'],
    ['modelId', ''],
    ['timeoutMs', 0],
    ['timeoutMs', 300_001],
    ['configRevision', -1],
  ] as const)('rejects invalid call context field %s', (field, value) => {
    const context = createProviderContext('TEXT_GENERATION', 'MOCK', {
      [field]: value,
    });
    expect(() => validateCallContext(context, 'TEXT_GENERATION')).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }),
    );
  });

  it('rejects an operation mismatch and already-aborted calls before execution', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      validateCallContext(
        createProviderContext('TEXT_GENERATION', 'MOCK', { signal: controller.signal }),
        'VISION_ANALYSIS',
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }));
    expect(() =>
      validateCallContext(
        createProviderContext('TEXT_GENERATION', 'MOCK', { signal: controller.signal }),
        'TEXT_GENERATION',
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_ABORTED' }));
  });

  it('rejects secret-bearing trace metadata', () => {
    expect(() =>
      validateCallContext(
        createProviderContext('TEXT_GENERATION', 'MOCK', {
          traceMetadata: { authorization: 'synthetic' },
        }),
        'TEXT_GENERATION',
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }));
  });

  it('accepts configured model IDs with provider namespaces without inferring capability', () => {
    expect(() =>
      validateCallContext(
        createProviderContext('TEXT_GENERATION', 'RESPONSES', {
          modelId: 'vendor/model family',
        }),
        'TEXT_GENERATION',
      ),
    ).not.toThrow();
  });

  it.each([
    [{ temperature: -0.1 }],
    [{ temperature: 2.1 }],
    [{ topP: 0 }],
    [{ topP: 1.1 }],
    [{ maxOutputTokens: 0 }],
    [{ stopSequences: [] }],
    [{ stopSequences: [''] }],
  ])('rejects invalid generation options %#', (options) => {
    expect(() =>
      validateGenerationOptions(options, createProviderContext('TEXT_GENERATION', 'MOCK')),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }));
  });
});
