import { describe, expect, it } from 'vitest';

import {
  OpenAICompatibleProvider,
  decodeChatCompletionsText,
  decodeResponsesText,
  encodeChatCompletionsText,
  encodeResponsesText,
  validateTextRequest,
} from '../packages/providers/src/index.js';
import {
  FakeCredentialResolver,
  ScriptedTransport,
  createProviderConfig,
  createProviderContext,
  createTextRequest,
  jsonResponse,
} from './support/provider-test-utils.js';

function responsesEnvelope(text = '响应文本') {
  return {
    id: 'response-safe-id',
    output: [
      {
        content: [{ text, type: 'output_text' }],
        type: 'message',
      },
    ],
    status: 'completed',
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
  };
}

function chatEnvelope(text = '聊天文本') {
  return {
    choices: [
      {
        finish_reason: 'stop',
        message: { content: text, role: 'assistant' },
      },
    ],
    id: 'chat-safe-id',
    usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 },
  };
}

describe('Issue 012 text generation and codecs', () => {
  it('encodes Responses and Chat Completions independently', () => {
    const request = createTextRequest();
    const responses = encodeResponsesText(
      request,
      createProviderContext('TEXT_GENERATION', 'RESPONSES'),
    );
    const chat = encodeChatCompletionsText(
      request,
      createProviderContext('TEXT_GENERATION', 'CHAT_COMPLETIONS'),
    );
    expect(responses).toHaveProperty('input');
    expect(responses).not.toHaveProperty('messages');
    expect(chat).toHaveProperty('messages');
    expect(chat).not.toHaveProperty('input');
  });

  it.each([
    ['RESPONSES', responsesEnvelope(), '响应文本'],
    ['CHAT_COMPLETIONS', chatEnvelope(), '聊天文本'],
  ] as const)('normalizes a %s response without exposing the raw envelope', (mode, body, text) => {
    const context = createProviderContext('TEXT_GENERATION', mode);
    const result =
      mode === 'RESPONSES'
        ? decodeResponsesText(JSON.stringify(body), context, 12, null)
        : decodeChatCompletionsText(JSON.stringify(body), context, 12, null);
    expect(result.text).toBe(text);
    expect(result.finishReason).toBe('STOP');
    expect(result.latencyMs).toBe(12);
    expect(result.usage.totalTokens).toBe(5);
    expect(result).not.toHaveProperty('raw');
    expect(result).not.toHaveProperty('choices');
    expect(result).not.toHaveProperty('output');
  });

  it('normalizes truncation and refusal without treating refusal as missing output', () => {
    const chatContext = createProviderContext('TEXT_GENERATION', 'CHAT_COMPLETIONS');
    const result = decodeChatCompletionsText(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'length',
            message: { content: null, refusal: 'vendor refusal' },
          },
        ],
      }),
      chatContext,
      1,
      null,
    );
    expect(result.finishReason).toBe('LENGTH');
    expect(result.outputTruncated).toBe(true);
    expect(result.refusal).toEqual({ reason: 'PROVIDER_REFUSAL' });
    expect(JSON.stringify(result.refusal)).not.toContain('vendor refusal');
  });

  it.each([
    { messages: [] },
    {
      messages: Array.from({ length: 65 }, () => ({
        content: [{ text: 'x', type: 'TEXT' as const }],
        role: 'USER' as const,
      })),
    },
    { messages: [{ content: [{ text: '   ', type: 'TEXT' as const }], role: 'USER' as const }] },
    {
      messages: [
        {
          content: [{ text: `bad\u0001`, type: 'TEXT' as const }],
          role: 'USER' as const,
        },
      ],
    },
  ])('rejects invalid or unbounded text input %#', (request) => {
    expect(() =>
      validateTextRequest(request, createProviderContext('TEXT_GENERATION', 'RESPONSES')),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }));
  });

  it.each(['RESPONSES', 'CHAT_COMPLETIONS'] as const)(
    'executes only the explicitly selected %s endpoint',
    async (mode) => {
      const transport = new ScriptedTransport([
        { response: jsonResponse(mode === 'RESPONSES' ? responsesEnvelope() : chatEnvelope()) },
      ]);
      const provider = new OpenAICompatibleProvider(
        createProviderConfig(),
        new FakeCredentialResolver(),
        { nowMilliseconds: () => 100, transport },
      );
      const result = await provider.generateText(
        createTextRequest(),
        createProviderContext('TEXT_GENERATION', mode),
      );
      expect(result.protocolMode).toBe(mode);
      expect(transport.requests).toHaveLength(1);
      expect(transport.requests[0]?.endpoint).toBe(mode);
    },
  );

  it('does not fallback or enumerate endpoints after a 404', async () => {
    const transport = new ScriptedTransport([
      { response: jsonResponse({ vendor: 'not exposed' }, 404) },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    await expect(
      provider.generateText(
        createTextRequest(),
        createProviderContext('TEXT_GENERATION', 'RESPONSES'),
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UPSTREAM_4XX',
      retryDisposition: 'DO_NOT_RETRY',
    });
    expect(transport.requests.map((request) => request.endpoint)).toEqual(['RESPONSES']);
  });

  it('rejects MOCK and image modes in the live-compatible provider', async () => {
    const transport = new ScriptedTransport([]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    for (const mode of ['MOCK', 'IMAGES_GENERATIONS'] as const) {
      await expect(
        provider.generateText(createTextRequest(), createProviderContext('TEXT_GENERATION', mode)),
      ).rejects.toMatchObject({ code: 'PROVIDER_PROTOCOL_ERROR' });
    }
    expect(transport.requests).toHaveLength(0);
  });
});
