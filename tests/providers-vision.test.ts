import { describe, expect, it } from 'vitest';

import {
  OpenAICompatibleProvider,
  PROVIDER_LIMITS,
  encodeChatCompletionsVision,
  encodeResponsesVision,
  validateVisionRequest,
} from '../packages/providers/src/index.js';
import {
  FakeCredentialResolver,
  ScriptedTransport,
  TEST_JPEG,
  TEST_PNG,
  createProviderConfig,
  createProviderContext,
  jsonResponse,
} from './support/provider-test-utils.js';

function visionRequest(bytes = TEST_PNG, mimeType: 'image/jpeg' | 'image/png' = 'image/png') {
  return {
    messages: [
      {
        content: [
          { text: '描述这张合成测试图', type: 'TEXT' as const },
          { bytes, mimeType, type: 'IMAGE' as const },
        ],
        role: 'USER' as const,
      },
    ],
  };
}

describe('Issue 012 vision input', () => {
  it.each([
    [TEST_PNG, 'image/png'],
    [TEST_JPEG, 'image/jpeg'],
  ] as const)('accepts in-memory %s bytes with matching magic', (bytes, mimeType) => {
    expect(() =>
      validateVisionRequest(
        visionRequest(bytes, mimeType),
        createProviderContext('VISION_ANALYSIS', 'RESPONSES'),
      ),
    ).not.toThrow();
  });

  it('encodes inline data only inside the selected codec', () => {
    const request = visionRequest();
    const responses = encodeResponsesVision(
      request,
      createProviderContext('VISION_ANALYSIS', 'RESPONSES'),
    );
    const chat = encodeChatCompletionsVision(
      request,
      createProviderContext('VISION_ANALYSIS', 'CHAT_COMPLETIONS'),
    );
    expect(JSON.stringify(responses)).toContain('data:image/png;base64,');
    expect(JSON.stringify(chat)).toContain('data:image/png;base64,');
    expect(JSON.stringify(request)).not.toMatch(/file:\/\/|[A-Z]:\\/u);
  });

  it.each([
    [Uint8Array.from([]), 'image/png'],
    [Uint8Array.from([1, 2, 3]), 'image/png'],
    [TEST_PNG, 'image/jpeg'],
  ] as const)('rejects empty or mismatched bytes %#', (bytes, mimeType) => {
    expect(() =>
      validateVisionRequest(
        visionRequest(bytes, mimeType),
        createProviderContext('VISION_ANALYSIS', 'RESPONSES'),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }));
  });

  it('enforces image count, per-image bytes, and aggregate bytes', () => {
    const identity = createProviderContext('VISION_ANALYSIS', 'RESPONSES');
    const tooMany = {
      messages: [
        {
          content: Array.from({ length: PROVIDER_LIMITS.maxImageCount + 1 }, () => ({
            bytes: TEST_PNG,
            mimeType: 'image/png' as const,
            type: 'IMAGE' as const,
          })),
          role: 'USER' as const,
        },
      ],
    };
    expect(() => validateVisionRequest(tooMany, identity)).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }),
    );
    const oversized = new Uint8Array(PROVIDER_LIMITS.maxInputImageBytes + 1);
    oversized.set(TEST_PNG);
    expect(() => validateVisionRequest(visionRequest(oversized), identity)).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }),
    );
  });

  it('executes a vision call without reading a path or URL', async () => {
    const transport = new ScriptedTransport([
      {
        response: jsonResponse({
          output: [
            {
              content: [{ text: '合成图像描述', type: 'output_text' }],
              type: 'message',
            },
          ],
          status: 'completed',
        }),
      },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    const result = await provider.analyzeVision(
      visionRequest(),
      createProviderContext('VISION_ANALYSIS', 'RESPONSES'),
    );
    expect(result.text).toBe('合成图像描述');
    expect(transport.requests).toHaveLength(1);
  });
});
