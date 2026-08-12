import { describe, expect, it } from 'vitest';

import {
  normalizeOpenAICompatibleResponse,
  OpenAIResponseNormalizationError,
} from '../packages/providers/src/index.js';

const limit = 2 * 1024 * 1024;
const responses = JSON.stringify({
  output: [
    {
      content: [{ text: '{"marker":"REDNOTE_STRUCTURED_OK"}', type: 'output_text' }],
      type: 'message',
    },
  ],
  status: 'completed',
});
const chat = JSON.stringify({
  choices: [
    { finish_reason: 'stop', index: 0, message: { content: '{"marker":"REDNOTE_STRUCTURED_OK"}' } },
  ],
});

describe('bounded OpenAI-compatible response normalizer', () => {
  it.each([
    ['application/json', 'STANDARD_JSON'],
    ['Application/JSON; Charset=UTF-8', 'STANDARD_JSON'],
    ['application/problem+json', 'STANDARD_JSON'],
    ['text/plain', 'NONSTANDARD_MIME_JSON'],
    ['application/octet-stream', 'NONSTANDARD_MIME_JSON'],
    [undefined, 'NONSTANDARD_MIME_JSON'],
  ] as const)('accepts object JSON from %s as %s', (contentType, transportVariant) => {
    expect(
      normalizeOpenAICompatibleResponse({
        body: responses,
        contentType,
        maxBodyBytes: limit,
        protocol: 'RESPONSES',
      }),
    ).toMatchObject({ transportVariant });
  });

  it('rebuilds bounded Chat and Responses SSE into their non-streaming envelopes', () => {
    const chatSse = [
      'data: {"id":"chat-1","model":"fixture","choices":[{"index":0,"delta":{"content":"{\\"marker\\":"}}]}',
      '',
      'data: {"id":"chat-1","model":"fixture","choices":[{"index":0,"delta":{"content":"\\"REDNOTE_STRUCTURED_OK\\"}"},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const chatResult = normalizeOpenAICompatibleResponse({
      body: chatSse,
      contentType: 'text/event-stream',
      maxBodyBytes: limit,
      protocol: 'CHAT_COMPLETIONS',
    });
    expect(JSON.parse(chatResult.body)).toMatchObject({
      choices: [{ message: { content: '{"marker":"REDNOTE_STRUCTURED_OK"}' } }],
    });
    expect(chatResult.transportVariant).toBe('SSE_NORMALIZED');

    const responseSse = `data: ${JSON.stringify({ response: JSON.parse(responses), type: 'response.completed' })}\n\ndata: [DONE]\n\n`;
    expect(
      normalizeOpenAICompatibleResponse({
        body: responseSse,
        contentType: 'text/event-stream; charset=utf-8',
        maxBodyBytes: limit,
        protocol: 'RESPONSES',
      }),
    ).toMatchObject({ body: responses, transportVariant: 'SSE_NORMALIZED' });
  });

  it.each([
    ['text/html', '{"login":true}'],
    ['text/plain', '<html>{}</html>'],
    ['text/plain', '[{"value":1}]'],
    ['text/plain', 'true'],
    ['text/plain', '{broken'],
    ['text/event-stream', 'data: [DONE]\n\n'],
    ['text/event-stream', `data: ${chat}\n\n`],
  ])('rejects unsafe %s body variants', (contentType, body) => {
    expect(() =>
      normalizeOpenAICompatibleResponse({
        body,
        contentType,
        maxBodyBytes: limit,
        protocol: 'CHAT_COMPLETIONS',
      }),
    ).toThrow(OpenAIResponseNormalizationError);
  });
});
