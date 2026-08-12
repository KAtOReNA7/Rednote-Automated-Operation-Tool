import { ProviderError } from './errors.js';
import { PROVIDER_LIMITS } from './response-limits.js';
import {
  normalizeOpenAICompatibleResponse,
  OpenAIResponseNormalizationError,
  type OpenAIResponseTransportVariant,
} from './openai-response-normalizer.js';

export const PROVIDER_ENDPOINTS = Object.freeze({
  CHAT_COMPLETIONS: '/chat/completions',
  IMAGES_GENERATIONS: '/images/generations',
  RESPONSES: '/responses',
} as const);
export type ProviderEndpoint = keyof typeof PROVIDER_ENDPOINTS;

export interface HttpTransportRequest {
  readonly baseUrl: string;
  readonly body: string;
  readonly credential: string;
  readonly endpoint: ProviderEndpoint;
  readonly modelId: string;
  readonly operation: string;
  readonly providerId: string;
  readonly requestId: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

export interface HttpTransportResponse {
  readonly body: string;
  readonly headers: Readonly<{
    contentType: string | null;
    providerRequestId: string | null;
    receivedContentType?: string;
    retryAfter: string | null;
    transportVariant?: OpenAIResponseTransportVariant;
  }>;
  readonly status: number;
}

export interface HttpTransport {
  request(request: HttpTransportRequest): Promise<HttpTransportResponse>;
}

export type FetchImplementation = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

function buildProviderUrl(baseUrl: string, endpoint: ProviderEndpoint): string {
  const parsed = new URL(baseUrl);
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
  ) {
    throw new TypeError('Provider URL is outside the allowed transport policy.');
  }
  const path = parsed.pathname.replace(/\/+$/u, '');
  parsed.pathname = `${path}${PROVIDER_ENDPOINTS[endpoint]}`;
  return parsed.toString();
}

function causeCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return null;
    }
    if ('code' in current && typeof current.code === 'string') {
      return current.code;
    }
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

function transportError(
  code: 'PROVIDER_AMBIGUOUS_OUTCOME' | 'PROVIDER_NETWORK_UNREACHABLE' | 'PROVIDER_TLS_ERROR',
  request: HttpTransportRequest,
  category: 'NETWORK' | 'TLS' | 'UNKNOWN',
  notSent: boolean,
): ProviderError {
  return new ProviderError(code, {
    causeCategory: category,
    modelId: request.modelId,
    operation: request.operation,
    outcomeCertainty: notSent ? 'NOT_SENT' : 'MAY_HAVE_EXECUTED',
    providerId: request.providerId,
    requestId: request.requestId,
    retryDisposition: notSent ? 'RETRY_AUTOMATIC_SAFE' : 'RETRY_MANUAL',
  });
}

export class NodeFetchHttpTransport implements HttpTransport {
  readonly #fetch: FetchImplementation;

  public constructor(fetchImplementation: FetchImplementation = globalThis.fetch) {
    this.#fetch = fetchImplementation;
  }

  public async request(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    const bodyBytes = Buffer.byteLength(request.body, 'utf8');
    if (bodyBytes > PROVIDER_LIMITS.maxRequestBodyBytes) {
      throw new ProviderError('PROVIDER_REQUEST_TOO_LARGE', {
        causeCategory: 'VALIDATION',
        details: { bodyBytes, limitBytes: PROVIDER_LIMITS.maxRequestBodyBytes },
        modelId: request.modelId,
        operation: request.operation,
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
        providerId: request.providerId,
        requestId: request.requestId,
        retryDisposition: 'DO_NOT_RETRY',
      });
    }

    let url: string;
    try {
      url = buildProviderUrl(request.baseUrl, request.endpoint);
    } catch {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', {
        causeCategory: 'CONFIGURATION',
        modelId: request.modelId,
        operation: request.operation,
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
        providerId: request.providerId,
        requestId: request.requestId,
        retryDisposition: 'DO_NOT_RETRY',
      });
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortedBeforeSend = request.signal?.aborted === true;
    if (abortedBeforeSend) {
      controller.abort();
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs);
    const abort = (): void => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.#fetch(url, {
        body: request.body,
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${request.credential}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type');
      const retryAfter = response.headers.get('retry-after');
      const providerRequestId =
        response.headers.get('x-request-id') ?? response.headers.get('request-id');
      let headerBytes = 0;
      response.headers.forEach((value, key) => {
        headerBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
      });
      if (headerBytes > PROVIDER_LIMITS.maxResponseHeaderBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
          causeCategory: 'PROTOCOL',
          details: { headerBytes, limitBytes: PROVIDER_LIMITS.maxResponseHeaderBytes },
          modelId: request.modelId,
          operation: request.operation,
          outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
          providerId: request.providerId,
          requestId: request.requestId,
          retryDisposition: 'RETRY_MANUAL',
        });
      }
      let body = await this.#readBody(response, request);
      let receivedContentType = contentType ?? 'MISSING';
      let transportVariant: OpenAIResponseTransportVariant = 'REJECTED';
      if (
        response.status >= 200 &&
        response.status < 300 &&
        request.endpoint !== 'IMAGES_GENERATIONS'
      ) {
        try {
          const normalized = normalizeOpenAICompatibleResponse({
            body,
            contentType,
            maxBodyBytes: PROVIDER_LIMITS.maxResponseBodyBytes,
            protocol: request.endpoint === 'CHAT_COMPLETIONS' ? 'CHAT_COMPLETIONS' : 'RESPONSES',
          });
          body = normalized.body;
          receivedContentType = normalized.receivedContentType;
          transportVariant = normalized.transportVariant;
        } catch (error) {
          if (error instanceof OpenAIResponseNormalizationError) {
            throw new ProviderError(
              error.reason === 'RESPONSE_TOO_LARGE'
                ? 'PROVIDER_RESPONSE_TOO_LARGE'
                : error.reason === 'INVALID_JSON' || error.reason === 'INVALID_SSE'
                  ? 'PROVIDER_INVALID_JSON'
                  : 'PROVIDER_INVALID_CONTENT_TYPE',
              {
                causeCategory: 'CONTENT_TYPE',
                details: { receivedContentType: error.receivedContentType, transportVariant },
                modelId: request.modelId,
                operation: request.operation,
                outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
                providerId: request.providerId,
                requestId: request.requestId,
                retryDisposition: 'RETRY_MANUAL',
              },
            );
          }
          throw error;
        }
      } else if (response.status >= 200 && response.status < 300) {
        transportVariant = 'STANDARD_JSON';
      }
      return {
        body,
        headers: Object.freeze({
          contentType,
          providerRequestId:
            providerRequestId !== null && /^[A-Za-z0-9._:-]{1,128}$/u.test(providerRequestId)
              ? providerRequestId
              : null,
          receivedContentType,
          retryAfter: retryAfter !== null && retryAfter.length <= 128 ? retryAfter : null,
          transportVariant,
        }),
        status: response.status,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new ProviderError(timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ABORTED', {
          causeCategory: timedOut ? 'TIMEOUT' : 'ABORT',
          modelId: request.modelId,
          operation: request.operation,
          outcomeCertainty: abortedBeforeSend ? 'NOT_SENT' : 'MAY_HAVE_EXECUTED',
          providerId: request.providerId,
          requestId: request.requestId,
          retryDisposition: timedOut ? 'RETRY_MANUAL' : 'DO_NOT_RETRY',
        });
      }
      const code = causeCode(error);
      if (
        code !== null &&
        [
          'CERT_HAS_EXPIRED',
          'DEPTH_ZERO_SELF_SIGNED_CERT',
          'ERR_TLS_CERT_ALTNAME_INVALID',
        ].includes(code)
      ) {
        throw transportError('PROVIDER_TLS_ERROR', request, 'TLS', true);
      }
      if (
        code !== null &&
        ['ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'ENOTFOUND'].includes(code)
      ) {
        throw transportError('PROVIDER_NETWORK_UNREACHABLE', request, 'NETWORK', true);
      }
      throw transportError('PROVIDER_AMBIGUOUS_OUTCOME', request, 'UNKNOWN', false);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
    }
  }

  async #readBody(response: Response, request: HttpTransportRequest): Promise<string> {
    if (response.body === null) {
      return '';
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        total += next.value.byteLength;
        if (total > PROVIDER_LIMITS.maxResponseBodyBytes) {
          await reader.cancel().catch(() => undefined);
          throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
            causeCategory: 'PROTOCOL',
            details: { limitBytes: PROVIDER_LIMITS.maxResponseBodyBytes },
            modelId: request.modelId,
            operation: request.operation,
            outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
            providerId: request.providerId,
            requestId: request.requestId,
            retryDisposition: 'RETRY_MANUAL',
          });
        }
        chunks.push(next.value);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(merged);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw transportError('PROVIDER_AMBIGUOUS_OUTCOME', request, 'UNKNOWN', false);
    } finally {
      reader.releaseLock();
    }
  }
}

export function providerEndpointUrlForTesting(baseUrl: string, endpoint: ProviderEndpoint): string {
  return buildProviderUrl(baseUrl, endpoint);
}
