import { randomBytes, randomUUID } from 'node:crypto';

import {
  CONTENT_AI_CREDENTIAL_REFERENCE,
  createMockCapabilities,
  type CredentialResolver,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
  type ProviderCallContext,
  type ProviderOperation,
  type ProviderRuntimeConfig,
  type ProtocolMode,
  type RuntimeSchema,
  type TextGenerationRequest,
} from '../../packages/providers/src/index.js';

export const TEST_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=',
    'base64',
  ),
);

export const TEST_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

export function createProviderConfig(
  overrides: Partial<ProviderRuntimeConfig> = {},
): ProviderRuntimeConfig {
  const modelIds = Object.freeze({
    embedding: 'model-embedding',
    image: 'model-image',
    research: 'model-research',
    review: 'model-review',
    writing: 'model-writing',
    ...overrides.modelIds,
  });
  return Object.freeze({
    baseUrl: 'https://provider.invalid/v1',
    credentialReference: CONTENT_AI_CREDENTIAL_REFERENCE,
    protocol: 'OPENAI_COMPATIBLE',
    providerId: 'configured-provider',
    revision: 7,
    verificationState: 'CONFIGURED_UNVERIFIED',
    ...overrides,
    modelIds,
  });
}

export function createProviderContext(
  operation: ProviderOperation,
  protocolMode: ProtocolMode,
  overrides: Partial<ProviderCallContext> = {},
): ProviderCallContext {
  const modelId =
    operation === 'IMAGE_GENERATION'
      ? 'model-image'
      : operation === 'VISION_ANALYSIS'
        ? 'model-research'
        : 'model-writing';
  return {
    capabilities: createMockCapabilities(),
    configRevision: 7,
    modelId,
    operation,
    protocolMode,
    providerId: 'configured-provider',
    requestId: `request-${randomUUID()}`,
    timeoutMs: 5_000,
    traceMetadata: Object.freeze({ jobType: 'test', sequence: 1 }),
    ...overrides,
  };
}

export function createTextRequest(text = '合成测试输入'): TextGenerationRequest {
  return {
    messages: [
      {
        content: [{ text, type: 'TEXT' }],
        role: 'USER',
      },
    ],
  };
}

export interface TestStructuredValue {
  readonly answer: string;
}

export function createTestSchema(): RuntimeSchema<TestStructuredValue> {
  return {
    id: 'test_answer',
    jsonSchema: {
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
      type: 'object',
    },
    strictObject: true,
    validate: (value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1 &&
        typeof (value as { readonly answer?: unknown }).answer === 'string'
      ) {
        return { ok: true, value: value as TestStructuredValue };
      }
      return {
        issues: [{ code: 'INVALID_ANSWER', path: ['answer'] }],
        ok: false,
      };
    },
    version: 1,
  };
}

export class FakeCredentialResolver implements CredentialResolver {
  public calls = 0;
  readonly #credential: string;

  public constructor(credential = randomBytes(48).toString('base64url')) {
    this.#credential = credential;
  }

  public async resolve(reference: typeof CONTENT_AI_CREDENTIAL_REFERENCE): Promise<string> {
    if (reference !== CONTENT_AI_CREDENTIAL_REFERENCE) {
      throw new TypeError('Unexpected credential reference.');
    }
    this.calls += 1;
    return this.#credential;
  }
}

export type TransportScriptStep =
  { readonly response: HttpTransportResponse } | { readonly error: Error };

export class ScriptedTransport implements HttpTransport {
  public credentialUseCount = 0;
  public readonly requests: Array<
    Omit<HttpTransportRequest, 'credential' | 'signal'> & { readonly signalPresent: boolean }
  > = [];
  readonly #script: TransportScriptStep[];

  public constructor(script: readonly TransportScriptStep[]) {
    this.#script = [...script];
  }

  public async request(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    this.credentialUseCount += 1;
    this.requests.push({
      baseUrl: request.baseUrl,
      body: request.body,
      endpoint: request.endpoint,
      modelId: request.modelId,
      operation: request.operation,
      providerId: request.providerId,
      requestId: request.requestId,
      signalPresent: request.signal !== undefined,
      timeoutMs: request.timeoutMs,
    });
    const step = this.#script.shift();
    if (step === undefined) {
      throw new TypeError('Transport script exhausted.');
    }
    if ('error' in step) {
      throw step.error;
    }
    return step.response;
  }
}

export function jsonResponse(
  value: unknown,
  status = 200,
  headers: Partial<HttpTransportResponse['headers']> = {},
): HttpTransportResponse {
  return {
    body: JSON.stringify(value),
    headers: {
      contentType: 'application/json',
      providerRequestId: null,
      retryAfter: null,
      ...headers,
    },
    status,
  };
}
