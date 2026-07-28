import { describe, expect, it } from 'vitest';

import {
  OpenAICompatibleProvider,
  PROVIDER_LIMITS,
  decodeImagesGeneration,
  encodeImagesGeneration,
  validateImageGenerationRequest,
} from '../packages/providers/src/index.js';
import {
  FakeCredentialResolver,
  ScriptedTransport,
  TEST_PNG,
  createProviderConfig,
  createProviderContext,
  jsonResponse,
} from './support/provider-test-utils.js';

const imageRequest = {
  count: 1,
  prompt: '合成测试图',
  qualityHint: 'HIGH' as const,
  sizeHint: 'SQUARE' as const,
  transparentBackground: 'ENABLED' as const,
};

describe('Issue 012 image generation', () => {
  it('encodes only controlled image hints', () => {
    const body = encodeImagesGeneration(
      imageRequest,
      createProviderContext('IMAGE_GENERATION', 'IMAGES_GENERATIONS'),
    );
    expect(body).toEqual({
      background: 'transparent',
      model: 'model-image',
      n: 1,
      prompt: '合成测试图',
      quality: 'high',
      response_format: 'b64_json',
      size: '1024x1024',
    });
  });

  it.each([
    { ...imageRequest, count: 0 },
    { ...imageRequest, count: 5 },
    { ...imageRequest, prompt: '   ' },
    { ...imageRequest, qualityHint: 'ULTRA' as 'HIGH' },
    { ...imageRequest, sizeHint: 'CUSTOM' as 'SQUARE' },
  ])('rejects invalid prompt, count, or hints %#', (request) => {
    expect(() =>
      validateImageGenerationRequest(
        request,
        createProviderContext('IMAGE_GENERATION', 'IMAGES_GENERATIONS'),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_INVALID_REQUEST' }));
  });

  it('decodes bounded inline bytes and keeps revised prompt private by default', () => {
    const context = createProviderContext('IMAGE_GENERATION', 'IMAGES_GENERATIONS');
    const result = decodeImagesGeneration(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from(TEST_PNG).toString('base64'),
            revised_prompt: 'provider rewrite',
          },
        ],
      }),
      imageRequest,
      context,
      9,
      null,
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe('image/png');
    expect(result.images[0]?.bytes).toEqual(TEST_PNG);
    expect(result.images[0]?.revisedPrompt).toBeNull();
  });

  it('allows revised prompt only when the caller explicitly requests it', () => {
    const result = decodeImagesGeneration(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from(TEST_PNG).toString('base64'),
            revised_prompt: 'provider rewrite',
          },
        ],
      }),
      { ...imageRequest, exposeRevisedPrompt: true },
      createProviderContext('IMAGE_GENERATION', 'IMAGES_GENERATIONS'),
      1,
      null,
    );
    expect(result.images[0]?.revisedPrompt).toBe('provider rewrite');
  });

  it('rejects URL-only output without fetching it', () => {
    expect(() =>
      decodeImagesGeneration(
        JSON.stringify({ data: [{ url: 'https://untrusted.invalid/image.png' }] }),
        imageRequest,
        createProviderContext('IMAGE_GENERATION', 'IMAGES_GENERATIONS'),
        1,
        null,
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_UNSUPPORTED_OUTPUT_VARIANT' }));
  });

  it('checks estimated base64 size before decoding and validates magic bytes', () => {
    const context = createProviderContext('IMAGE_GENERATION', 'IMAGES_GENERATIONS');
    expect(() =>
      decodeImagesGeneration(
        JSON.stringify({
          data: [{ b64_json: 'A'.repeat(PROVIDER_LIMITS.maxImageOutputBytes * 2) }],
        }),
        imageRequest,
        context,
        1,
        null,
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_RESPONSE_TOO_LARGE' }));
    expect(() =>
      decodeImagesGeneration(
        JSON.stringify({ data: [{ b64_json: Buffer.from('not-image').toString('base64') }] }),
        imageRequest,
        context,
        1,
        null,
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }));
  });

  it('executes one Images endpoint call and does not write storage', async () => {
    const transport = new ScriptedTransport([
      {
        response: jsonResponse({
          data: [{ b64_json: Buffer.from(TEST_PNG).toString('base64') }],
        }),
      },
    ]);
    const provider = new OpenAICompatibleProvider(
      createProviderConfig(),
      new FakeCredentialResolver(),
      { transport },
    );
    const result = await provider.generateImage(
      imageRequest,
      createProviderContext('IMAGE_GENERATION', 'IMAGES_GENERATIONS'),
    );
    expect(result.images[0]?.bytes).toEqual(TEST_PNG);
    expect(transport.requests.map((request) => request.endpoint)).toEqual(['IMAGES_GENERATIONS']);
  });
});
