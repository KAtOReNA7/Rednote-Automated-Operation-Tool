import { describe, expect, it, vi } from 'vitest';

import {
  OpenAICompatibleProvider,
  validateJsonValueLimits,
  validateRuntimeSchema,
  type RuntimeSchema,
} from '../packages/providers/src/index.js';
import {
  FakeCredentialResolver,
  ScriptedTransport,
  createProviderConfig,
  createProviderContext,
  createTestSchema,
  createTextRequest,
  jsonResponse,
} from './support/provider-test-utils.js';

function structuredEnvelope(text: string) {
  return {
    choices: [{ finish_reason: 'stop', message: { content: text } }],
    usage: { completion_tokens: 4, prompt_tokens: 5, total_tokens: 9 },
  };
}

describe('Issue 012 structured generation', () => {
  it('requires a versioned strict-object runtime schema', () => {
    const context = createProviderContext('STRUCTURED_GENERATION', 'CHAT_COMPLETIONS');
    expect(() => validateRuntimeSchema(createTestSchema(), context)).not.toThrow();
    for (const invalid of [
      { ...createTestSchema(), id: 'bad id' },
      { ...createTestSchema(), version: 0 },
      { ...createTestSchema(), strictObject: false as true },
      {
        ...createTestSchema(),
        jsonSchema: { properties: {}, type: 'object' } as RuntimeSchema<unknown>['jsonSchema'],
      },
    ]) {
      expect(() => validateRuntimeSchema(invalid, context)).toThrowError(
        expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }),
      );
    }
  });

  it('returns only the typed value after JSON parsing and runtime validation', async () => {
    const schema = createTestSchema();
    const validate = vi.fn(schema.validate);
    const transport = new ScriptedTransport([
      { response: jsonResponse(structuredEnvelope('{"answer":"已验证"}')) },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    const result = await provider.generateStructured(
      createTextRequest(),
      { ...schema, validate },
      createProviderContext('STRUCTURED_GENERATION', 'CHAT_COMPLETIONS'),
    );
    expect(result.value).toEqual({ answer: '已验证' });
    expect(validate).toHaveBeenCalledOnce();
    expect(result).not.toHaveProperty('text');
    expect(result).not.toHaveProperty('raw');
    expect(JSON.parse(transport.requests[0]?.body ?? '{}')).toHaveProperty(
      'response_format.json_schema.strict',
      true,
    );
  });

  it('maps invalid JSON to a completed-invalid-output error without raw content', async () => {
    const secretBusinessValue = 'synthetic-business-value-never-in-error';
    const transport = new ScriptedTransport([
      { response: jsonResponse(structuredEnvelope(`{"answer":"${secretBusinessValue}"`)) },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    const error = await provider
      .generateStructured(
        createTextRequest(),
        createTestSchema(),
        createProviderContext('STRUCTURED_GENERATION', 'CHAT_COMPLETIONS'),
      )
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'PROVIDER_INVALID_JSON',
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
    });
    expect(JSON.stringify(error)).not.toContain(secretBusinessValue);
    expect(error).not.toHaveProperty('stack');
    expect(transport.requests).toHaveLength(1);
  });

  it('returns finite issue code/path for schema mismatch without the business value', async () => {
    const businessValue = 'synthetic-private-business-value';
    const transport = new ScriptedTransport([
      { response: jsonResponse(structuredEnvelope(`{"wrong":"${businessValue}"}`)) },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    const error = await provider
      .generateStructured(
        createTextRequest(),
        createTestSchema(),
        createProviderContext('STRUCTURED_GENERATION', 'CHAT_COMPLETIONS'),
      )
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'PROVIDER_SCHEMA_VALIDATION_FAILED',
      details: {
        issueCode: 'INVALID_ANSWER',
        issuePath: ['answer'],
        schemaId: 'test_answer',
        schemaVersion: 1,
      },
    });
    expect(JSON.stringify(error)).not.toContain(businessValue);
  });

  it('maps refusal before candidate JSON parsing and does not repair it', async () => {
    const transport = new ScriptedTransport([
      {
        response: jsonResponse({
          choices: [
            {
              finish_reason: 'content_filter',
              message: { content: null, refusal: 'vendor refusal details' },
            },
          ],
        }),
      },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    await expect(
      provider.generateStructured(
        createTextRequest(),
        createTestSchema(),
        createProviderContext('STRUCTURED_GENERATION', 'CHAT_COMPLETIONS'),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REFUSAL' });
    expect(transport.requests).toHaveLength(1);
  });

  it.each([
    [{ nested: { value: { deeper: 'x' } } }, 1_000],
    [Array.from({ length: 1_001 }, () => 1), 1],
    ['x'.repeat(200_001), 1],
  ] as const)('enforces deterministic JSON depth/array/string limits', (value, depthMode) => {
    let candidate: unknown = value;
    if (depthMode === 1_000) {
      candidate = {};
      let current = candidate as Record<string, unknown>;
      for (let index = 0; index < 30; index += 1) {
        current.next = {};
        current = current.next as Record<string, unknown>;
      }
    }
    expect(() =>
      validateJsonValueLimits(
        candidate,
        createProviderContext('STRUCTURED_GENERATION', 'CHAT_COMPLETIONS'),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }));
  });
});
