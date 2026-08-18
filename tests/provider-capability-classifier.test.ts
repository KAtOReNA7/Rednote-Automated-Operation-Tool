import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_PROBE_MARKERS,
  classifyCapabilityProbeFailure,
  classifyCapabilityProbeResponse,
  type CapabilityProbeStep,
} from '../packages/providers/src/index.js';

const STEP: CapabilityProbeStep = {
  capability: 'text',
  id: 'step-01-text',
  kind: 'TEXT',
  modelId: 'fixture-model',
  modelSlots: ['RESEARCH'],
  protocolMode: 'RESPONSES',
};
const NOW = '2026-07-28T00:00:00.000Z';
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function response(status: number, body: unknown, contentType = 'application/json') {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': contentType },
    status,
  };
}

describe('Issue 013 conservative capability classifier', () => {
  it('requires the fixed semantic marker for positive text evidence', () => {
    const supported = classifyCapabilityProbeResponse(
      STEP,
      response(200, {
        output_text: CAPABILITY_PROBE_MARKERS.text,
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      }),
      NOW,
    );
    expect(supported[0]).toMatchObject({
      confidence: 'CONFIRMED',
      state: 'SUPPORTED',
    });
    expect(supported[1]).toMatchObject({
      capability: 'usage',
      safeDetails: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      state: 'SUPPORTED',
    });
    expect(
      classifyCapabilityProbeResponse(STEP, response(200, { output_text: 'other' }), NOW)[0],
    ).toMatchObject({ reasonCode: 'INVALID_RESPONSE', state: 'UNKNOWN' });
  });

  it.each([
    [401, 'AUTHENTICATION_REJECTED'],
    [403, 'PERMISSION_REJECTED'],
    [429, 'RATE_LIMITED'],
    [500, 'AMBIGUOUS_OUTCOME'],
    [404, 'AMBIGUOUS_OUTCOME'],
  ] as const)('keeps HTTP %s as UNKNOWN with %s', (status, reasonCode) => {
    expect(
      classifyCapabilityProbeResponse(
        STEP,
        response(status, { error: { code: 'generic_error' } }),
        NOW,
      )[0],
    ).toMatchObject({ reasonCode, state: 'UNKNOWN' });
  });

  it('preserves a content-type-less image 503 as a sent transient upstream failure', () => {
    const imageStep: CapabilityProbeStep = {
      ...STEP,
      capability: 'imageGeneration',
      kind: 'IMAGE',
      modelSlots: ['IMAGE'],
      protocolMode: 'NOT_APPLICABLE',
    };
    expect(
      classifyCapabilityProbeResponse(
        imageStep,
        {
          body: '',
          headers: {},
          receivedContentType: 'MISSING',
          status: 503,
          transportVariant: 'REJECTED',
        },
        NOW,
      )[0],
    ).toMatchObject({
      reasonCode: 'AMBIGUOUS_OUTCOME',
      safeDetails: {
        receivedContentType: 'MISSING',
        status: 503,
        transportVariant: 'REJECTED',
      },
      state: 'UNKNOWN',
    });
  });

  it('uses UNSUPPORTED only for an explicit finite capability negative', () => {
    expect(
      classifyCapabilityProbeResponse(
        STEP,
        response(400, { error: { code: 'unsupported_feature' } }),
        NOW,
      )[0],
    ).toMatchObject({
      reasonCode: 'ENDPOINT_EXPLICITLY_UNSUPPORTED',
      state: 'UNSUPPORTED',
    });
  });

  it('keeps HTTP 400 parameter rejection unknown with bounded safe diagnostics only', () => {
    const observed = classifyCapabilityProbeResponse(
      STEP,
      {
        body: JSON.stringify({
          error: {
            code: 'invalid_parameter\nignored',
            message: 'raw secret-like response detail',
            param: 'response_format',
            type: 'invalid_request_error',
          },
        }),
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_fixture_123' },
        status: 400,
      },
      NOW,
    )[0];
    expect(observed).toMatchObject({
      reasonCode: 'AMBIGUOUS_OUTCOME',
      safeDetails: {
        errorCode: 'invalid_parameterignored',
        errorParam: 'response_format',
        errorType: 'invalid_request_error',
        requestId: 'req_fixture_123',
        status: 400,
      },
      state: 'UNKNOWN',
    });
    expect(JSON.stringify(observed)).not.toContain('raw secret-like response detail');
  });

  it('classifies model identity, model lookup, and route mismatches without raw payloads', () => {
    expect(
      classifyCapabilityProbeResponse(
        STEP,
        response(200, { model: 'different-model', output_text: CAPABILITY_PROBE_MARKERS.text }),
        NOW,
      )[0],
    ).toMatchObject({
      reasonCode: 'INVALID_RESPONSE',
      safeDetails: { modelIdMismatch: 1 },
      state: 'UNKNOWN',
    });
    expect(
      classifyCapabilityProbeResponse(
        STEP,
        response(404, { error: { code: 'model_not_found', message: 'sensitive detail' } }),
        NOW,
      )[0],
    ).toMatchObject({
      reasonCode: 'AMBIGUOUS_OUTCOME',
      safeDetails: { modelNotFound: 1, status: 404 },
      state: 'UNKNOWN',
    });
    const route = classifyCapabilityProbeResponse(
      STEP,
      response(404, { error: { code: 'not_found', message: 'sensitive detail' } }),
      NOW,
    )[0];
    expect(route).toMatchObject({
      reasonCode: 'AMBIGUOUS_OUTCOME',
      safeDetails: { endpointNotFound: 1, status: 404 },
      state: 'UNKNOWN',
    });
    expect(JSON.stringify([route])).not.toContain('sensitive detail');
  });

  it('keeps malformed JSON, content type, timeout and network failure inconclusive', () => {
    expect(classifyCapabilityProbeResponse(STEP, response(200, '{bad'), NOW)[0]).toMatchObject({
      reasonCode: 'INVALID_JSON',
      state: 'UNKNOWN',
    });
    expect(
      classifyCapabilityProbeResponse(STEP, response(200, '{}', 'text/html'), NOW)[0],
    ).toMatchObject({ reasonCode: 'INVALID_CONTENT_TYPE', state: 'UNKNOWN' });
    expect(
      classifyCapabilityProbeFailure(STEP, new DOMException('timeout', 'TimeoutError'), NOW),
    ).toMatchObject({ reasonCode: 'TIMEOUT', state: 'UNKNOWN' });
    expect(
      classifyCapabilityProbeFailure(STEP, Object.assign(new Error(), { code: 'ENOTFOUND' }), NOW),
    ).toMatchObject({ reasonCode: 'NETWORK_UNREACHABLE', state: 'UNKNOWN' });
  });

  it.each([
    [
      'RESPONSES',
      'text/plain',
      { output_text: JSON.stringify({ marker: CAPABILITY_PROBE_MARKERS.structured }) },
    ],
    [
      'CHAT_COMPLETIONS',
      'application/octet-stream',
      {
        choices: [
          { message: { content: JSON.stringify({ marker: CAPABILITY_PROBE_MARKERS.structured }) } },
        ],
      },
    ],
  ] as const)(
    'accepts strongly verified %s JSON under safe nonstandard MIME',
    (protocolMode, contentType, body) => {
      const observed = classifyCapabilityProbeResponse(
        { ...STEP, capability: 'structuredJson', kind: 'STRUCTURED', protocolMode },
        response(200, body, contentType),
        NOW,
      )[0];
      expect(observed).toMatchObject({
        safeDetails: {
          receivedContentType: contentType,
          transportVariant: 'NONSTANDARD_MIME_JSON',
        },
        state: 'SUPPORTED',
      });
    },
  );

  it('never treats a 2xx error envelope as structured capability evidence', () => {
    expect(
      classifyCapabilityProbeResponse(
        { ...STEP, capability: 'structuredJson', kind: 'STRUCTURED' },
        response(200, { error: { code: 'relay_error' } }, 'text/plain'),
        NOW,
      )[0],
    ).toMatchObject({ state: 'UNKNOWN' });
  });

  it('never downloads URL-only image output', () => {
    const imageStep: CapabilityProbeStep = {
      ...STEP,
      capability: 'imageGeneration',
      kind: 'IMAGE',
      modelSlots: ['IMAGE'],
      protocolMode: 'NOT_APPLICABLE',
    };
    expect(
      classifyCapabilityProbeResponse(
        imageStep,
        response(200, { data: [{ url: 'https://never-fetch.invalid/image.png' }] }),
        NOW,
      )[0],
    ).toMatchObject({
      reasonCode: 'OUTPUT_VARIANT_UNSUPPORTED',
      state: 'UNKNOWN',
    });
    expect(
      classifyCapabilityProbeResponse(
        imageStep,
        response(200, { data: [{ b64_json: 'AQIDBA==' }] }),
        NOW,
      )[0],
    ).toMatchObject({ reasonCode: 'INVALID_RESPONSE', state: 'UNKNOWN' });
    expect(
      classifyCapabilityProbeResponse(
        imageStep,
        response(200, { data: [{ b64_json: TINY_PNG_BASE64 }] }),
        NOW,
      )[0],
    ).toMatchObject({ safeDetails: { imageCount: 1 }, state: 'SUPPORTED' });
  });

  it('requires structured completed search and citation evidence', () => {
    const searchStep: CapabilityProbeStep = {
      ...STEP,
      capability: 'webSearch',
      kind: 'WEB_SEARCH',
    };
    expect(
      classifyCapabilityProbeResponse(
        searchStep,
        response(200, { output_text: 'web_search_call completed with a url_citation' }),
        NOW,
      )[0],
    ).toMatchObject({ reasonCode: 'SEARCH_NOT_OBSERVED', state: 'UNKNOWN' });
    expect(
      classifyCapabilityProbeResponse(
        searchStep,
        response(200, {
          output: [
            { status: 'completed', type: 'web_search_call' },
            { annotations: [{ type: 'url_citation' }], type: 'message' },
          ],
        }),
        NOW,
      )[0],
    ).toMatchObject({
      safeDetails: { citationCount: 1, eventCount: 1 },
      state: 'SUPPORTED',
    });
  });

  it('accepts exact model context metadata and finite allowlisted rate limits only on success', () => {
    const metadataStep: CapabilityProbeStep = {
      ...STEP,
      capability: 'usage',
      kind: 'METADATA',
      modelSlots: ['PROVIDER'],
      protocolMode: 'NOT_APPLICABLE',
    };
    const observed = classifyCapabilityProbeResponse(
      metadataStep,
      {
        body: JSON.stringify({
          data: [
            { context_window: 999_999, id: 'other-model' },
            { context_window: 8192, id: 'fixture-model' },
          ],
        }),
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-limit-requests': '60',
          'x-ratelimit-limit-tokens': '100000',
        },
        status: 200,
      },
      NOW,
    )[0];
    expect(observed).toMatchObject({
      maxContextTokens: 8192,
      rateLimitRequests: 60,
      rateLimitTokens: 100_000,
      state: 'SUPPORTED',
    });
    const rateLimited = classifyCapabilityProbeResponse(
      metadataStep,
      {
        body: JSON.stringify({ error: { code: 'rate_limited' } }),
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-limit-requests': '0',
        },
        status: 429,
      },
      NOW,
    )[0];
    expect(rateLimited).toMatchObject({
      rateLimitRequests: null,
      rateLimitTokens: null,
      reasonCode: 'RATE_LIMITED',
    });
    expect(
      classifyCapabilityProbeResponse(
        metadataStep,
        {
          body: JSON.stringify({ data: [{ context_window: 4096, id: 'other-model' }] }),
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-limit-requests': '-1',
          },
          status: 200,
        },
        NOW,
      )[0],
    ).toMatchObject({
      maxContextTokens: null,
      rateLimitRequests: null,
      reasonCode: 'METADATA_NOT_REPORTED',
      state: 'UNKNOWN',
    });
  });

  it('keeps Batch 2xx without explicit semantics UNKNOWN', () => {
    const batchStep: CapabilityProbeStep = {
      ...STEP,
      capability: 'batch',
      kind: 'BATCH_METADATA',
      modelId: null,
      modelSlots: ['PROVIDER'],
      protocolMode: 'NOT_APPLICABLE',
    };
    expect(
      classifyCapabilityProbeResponse(batchStep, { body: '', headers: {}, status: 204 }, NOW)[0],
    ).toMatchObject({ reasonCode: 'METADATA_NOT_REPORTED', state: 'UNKNOWN' });
  });
});
