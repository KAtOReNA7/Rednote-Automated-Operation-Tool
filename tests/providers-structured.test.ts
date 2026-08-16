import { describe, expect, it, vi } from 'vitest';

import {
  OpenAICompatibleProvider,
  validateJsonValueLimits,
  validateRuntimeSchema,
  type RuntimeSchema,
} from '../packages/providers/src/index.js';
import {
  V2_CONTENT_COPY_WIRE_JSON_SCHEMA,
  decodeContentCopyWireText,
  parseContentCopyWireValue,
} from '../packages/v2/src/index.js';
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
  it('uses the schema-owned bounded decoder for a fenced V2 content copy object', async () => {
    const value = {
      body: '合成正文',
      materialNotes: '合成资料说明',
      tags: ['推理小说'],
      title: '合成标题',
    };
    const transport = new ScriptedTransport([
      {
        response: jsonResponse(structuredEnvelope(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``)),
      },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    const result = await provider.generateStructured(
      createTextRequest(),
      {
        decodeText: decodeContentCopyWireText,
        id: 'v2_content_copy_wire',
        jsonSchema: V2_CONTENT_COPY_WIRE_JSON_SCHEMA,
        strictObject: true,
        validate: parseContentCopyWireValue,
        version: 2,
      },
      createProviderContext('STRUCTURED_GENERATION', 'CHAT_COMPLETIONS'),
    );
    expect(result.value).toEqual(value);
    expect(transport.requests).toHaveLength(1);
  });

  it('exposes only finite V2 wire mismatch diagnostics', async () => {
    const transport = new ScriptedTransport([
      {
        response: jsonResponse(
          structuredEnvelope(JSON.stringify({ body: '正文', tags: ['推理小说'] })),
        ),
      },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    const error = await provider
      .generateStructured(
        createTextRequest(),
        {
          decodeText: decodeContentCopyWireText,
          id: 'v2_content_copy_wire',
          jsonSchema: V2_CONTENT_COPY_WIRE_JSON_SCHEMA,
          strictObject: true,
          validate: parseContentCopyWireValue,
          version: 2,
        },
        createProviderContext('STRUCTURED_GENERATION', 'CHAT_COMPLETIONS'),
      )
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'PROVIDER_SCHEMA_VALIDATION_FAILED',
      details: {
        actualFieldType: 'undefined',
        actualRootType: 'object',
        expectedType: 'non-empty string',
        issuePath: ['materialNotes'],
        rootKeys: ['body', 'tags'],
      },
    });
    expect(JSON.stringify(error)).not.toContain('正文');
  });

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
    expect(JSON.parse(transport.requests[0]?.body ?? '{}')).toHaveProperty('stream', false);
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
        contentType: 'MISSING',
        envelopeType: 'CHAT_COMPLETIONS',
        httpStatus: 200,
        issueCode: 'INVALID_ANSWER',
        issuePath: ['answer'],
        providerRequestId: 'UNAVAILABLE',
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
