import { describe, expect, it } from 'vitest';

import {
  ScriptedMockProvider,
  createMockCapabilities,
  type MockErrorScenario,
} from '../packages/providers/src/index.js';
import {
  TEST_PNG,
  createProviderContext,
  createTestSchema,
  createTextRequest,
} from './support/provider-test-utils.js';

function mockContext(
  operation: 'IMAGE_GENERATION' | 'STRUCTURED_GENERATION' | 'TEXT_GENERATION' | 'VISION_ANALYSIS',
) {
  return createProviderContext(operation, 'MOCK', {
    capabilities: createMockCapabilities(),
  });
}

describe('Issue 012 scripted mock provider', () => {
  it('covers text, structured, vision, and image success without network', async () => {
    const provider = new ScriptedMockProvider([
      { text: 'mock text', type: 'TEXT_SUCCESS' },
      { type: 'STRUCTURED_SUCCESS', value: { answer: 'mock structured' } },
      { text: 'mock vision', type: 'VISION_SUCCESS' },
      { type: 'IMAGE_SUCCESS' },
    ]);
    const text = await provider.generateText(createTextRequest(), mockContext('TEXT_GENERATION'));
    const structured = await provider.generateStructured(
      createTextRequest(),
      createTestSchema(),
      mockContext('STRUCTURED_GENERATION'),
    );
    const vision = await provider.analyzeVision(
      {
        messages: [
          {
            content: [
              { text: 'analyze', type: 'TEXT' },
              { bytes: TEST_PNG, mimeType: 'image/png', type: 'IMAGE' },
            ],
            role: 'USER',
          },
        ],
      },
      mockContext('VISION_ANALYSIS'),
    );
    const image = await provider.generateImage(
      { count: 1, prompt: 'mock image' },
      mockContext('IMAGE_GENERATION'),
    );
    expect(text.text).toBe('mock text');
    expect(structured.value).toEqual({ answer: 'mock structured' });
    expect(vision.text).toBe('mock vision');
    expect(image.images[0]?.bytes.byteLength).toBeLessThan(100);
    expect(image.images[0]?.mimeType).toBe('image/png');
    expect(provider.getSafeCalls()).toHaveLength(4);
  });

  it('returns structured refusal without vendor content', async () => {
    const provider = new ScriptedMockProvider([{ type: 'REFUSAL' }]);
    const result = await provider.generateText(createTextRequest(), mockContext('TEXT_GENERATION'));
    expect(result.refusal).toEqual({ reason: 'PROVIDER_REFUSAL' });
    expect(result.text).toBe('');
  });

  it.each([
    ['NETWORK_UNREACHABLE', 'PROVIDER_NETWORK_UNREACHABLE', 'NOT_SENT'],
    ['RATE_LIMIT', 'PROVIDER_RATE_LIMITED', 'REJECTED_BEFORE_EXECUTION'],
    ['TIMEOUT', 'PROVIDER_TIMEOUT', 'MAY_HAVE_EXECUTED'],
    ['ABORT', 'PROVIDER_ABORTED', 'NOT_SENT'],
    ['UPSTREAM_4XX', 'PROVIDER_UPSTREAM_4XX', 'REJECTED_BEFORE_EXECUTION'],
    ['UPSTREAM_5XX', 'PROVIDER_UPSTREAM_5XX', 'MAY_HAVE_EXECUTED'],
    ['INVALID_CONTENT_TYPE', 'PROVIDER_INVALID_CONTENT_TYPE', 'COMPLETED_INVALID_OUTPUT'],
    ['INVALID_JSON', 'PROVIDER_INVALID_JSON', 'COMPLETED_INVALID_OUTPUT'],
    ['SCHEMA_MISMATCH', 'PROVIDER_SCHEMA_VALIDATION_FAILED', 'COMPLETED_INVALID_OUTPUT'],
    ['MALFORMED_USAGE', 'PROVIDER_INVALID_USAGE', 'COMPLETED_INVALID_OUTPUT'],
    ['RESPONSE_TOO_LARGE', 'PROVIDER_RESPONSE_TOO_LARGE', 'COMPLETED_INVALID_OUTPUT'],
    ['AMBIGUOUS_DISCONNECT', 'PROVIDER_AMBIGUOUS_OUTCOME', 'MAY_HAVE_EXECUTED'],
    ['CAPABILITY_UNKNOWN', 'PROVIDER_CAPABILITY_UNKNOWN', 'REJECTED_BEFORE_EXECUTION'],
    ['CAPABILITY_UNSUPPORTED', 'PROVIDER_CAPABILITY_UNSUPPORTED', 'REJECTED_BEFORE_EXECUTION'],
  ] as const)('scripts %s as stable %s', async (scenario, code, outcomeCertainty) => {
    const provider = new ScriptedMockProvider([
      { scenario: scenario as MockErrorScenario, type: 'ERROR' },
    ]);
    await expect(
      provider.generateText(createTextRequest(), mockContext('TEXT_GENERATION')),
    ).rejects.toMatchObject({ code, outcomeCertainty });
  });

  it('fails stably when the script is exhausted or the next step has the wrong kind', async () => {
    await expect(
      new ScriptedMockProvider([]).generateText(
        createTextRequest(),
        mockContext('TEXT_GENERATION'),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_MOCK_SCRIPT_EXHAUSTED' });
    await expect(
      new ScriptedMockProvider([{ text: 'vision', type: 'VISION_SUCCESS' }]).generateText(
        createTextRequest(),
        mockContext('TEXT_GENERATION'),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_INTERNAL_ERROR' });
  });

  it('isolates concurrent calls by consuming one deterministic step per call', async () => {
    const provider = new ScriptedMockProvider([
      { delayMs: 10, text: 'first', type: 'TEXT_SUCCESS' },
      { text: 'second', type: 'TEXT_SUCCESS' },
    ]);
    const first = provider.generateText(
      createTextRequest('first input'),
      mockContext('TEXT_GENERATION'),
    );
    const second = provider.generateText(
      createTextRequest('second input'),
      mockContext('TEXT_GENERATION'),
    );
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ text: 'first' }),
      expect.objectContaining({ text: 'second' }),
    ]);
    expect(provider.getSafeCalls()).toHaveLength(2);
  });

  it('supports cancellation during a scripted delay', async () => {
    const controller = new AbortController();
    const provider = new ScriptedMockProvider(
      [{ delayMs: 100, text: 'late', type: 'TEXT_SUCCESS' }],
      {
        nowMilliseconds: () => 0,
        sleep: async (_milliseconds, signal) => {
          controller.abort();
          if (signal?.aborted === true) {
            throw new DOMException('Aborted', 'AbortError');
          }
        },
      },
    );
    await expect(
      provider.generateText(createTextRequest(), {
        ...mockContext('TEXT_GENERATION'),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
  });

  it('enforces the call deadline for a delayed scripted step', async () => {
    const provider = new ScriptedMockProvider([
      { delayMs: 100, text: 'late', type: 'TEXT_SUCCESS' },
    ]);
    await expect(
      provider.generateText(createTextRequest(), {
        ...mockContext('TEXT_GENERATION'),
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      outcomeCertainty: 'NOT_SENT',
    });
  });

  it('rejects non-MOCK protocol and non-MOCK capability source before script use', async () => {
    const provider = new ScriptedMockProvider([{ text: 'must not run', type: 'TEXT_SUCCESS' }]);
    await expect(
      provider.generateText(
        createTextRequest(),
        createProviderContext('TEXT_GENERATION', 'RESPONSES'),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_PROTOCOL_ERROR' });
    expect(provider.getSafeCalls()).toHaveLength(0);
  });

  it('stores only safe call metadata, never input text or full model output', async () => {
    const privateInput = 'private-synthetic-prompt';
    const privateOutput = 'private-synthetic-output';
    const provider = new ScriptedMockProvider([{ text: privateOutput, type: 'TEXT_SUCCESS' }]);
    await provider.generateText(createTextRequest(privateInput), mockContext('TEXT_GENERATION'));
    const calls = JSON.stringify(provider.getSafeCalls());
    expect(calls).not.toContain(privateInput);
    expect(calls).not.toContain(privateOutput);
    expect(calls).not.toContain('model-writing');
  });
});
