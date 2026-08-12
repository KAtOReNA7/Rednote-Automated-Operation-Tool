import {
  CAPABILITY_PROBE_LIMITS,
  type CapabilityProbeRequest,
  type CapabilityProbeResponse,
  type CapabilityProbeTransport,
} from './capability-probe-contracts.js';
import { normalizeCapabilityProbeBaseUrl } from './capability-probe-plan.js';
import {
  normalizeOpenAICompatibleResponse,
  OpenAIResponseNormalizationError,
  safeReceivedContentType,
  type OpenAIResponseTransportVariant,
} from './openai-response-normalizer.js';

export type CapabilityProbeFetch = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

const ALLOWED_PATHS = new Set([
  '/batches',
  '/chat/completions',
  '/images/generations',
  '/models',
  '/responses',
]);
const ALLOWED_RESPONSE_HEADERS = Object.freeze([
  'allow',
  'content-type',
  'request-id',
  'x-request-id',
  'x-batch-capabilities',
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit-tokens',
] as const);

export function capabilityProbeUrl(baseUrl: string, path: CapabilityProbeRequest['path']): string {
  if (!ALLOWED_PATHS.has(path)) {
    throw new TypeError('Capability probe endpoint is not allowed.');
  }
  const normalized = normalizeCapabilityProbeBaseUrl(baseUrl);
  const parsed = new URL(normalized);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, '')}${path}`;
  return parsed.toString();
}

export function capabilityProbeModelMetadataUrl(baseUrl: string, modelId: string): string {
  if (
    modelId.length === 0 ||
    modelId.length > 256 ||
    [...modelId].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 || '/?#\\'.includes(character);
    })
  ) {
    throw new TypeError('Model ID cannot be used as a metadata path segment.');
  }
  return `${capabilityProbeUrl(baseUrl, '/models')}/${encodeURIComponent(modelId)}`;
}

function errorWithCode(message: string, code: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code });
}

export class NodeFetchCapabilityProbeTransport implements CapabilityProbeTransport {
  readonly #fetch: CapabilityProbeFetch;

  public constructor(fetchImplementation: CapabilityProbeFetch = globalThis.fetch) {
    this.#fetch = fetchImplementation;
  }

  public async request(request: CapabilityProbeRequest): Promise<CapabilityProbeResponse> {
    if (
      request.credential.length === 0 ||
      request.credential.length > 16 * 1024 ||
      request.timeoutMs < 1 ||
      request.timeoutMs > CAPABILITY_PROBE_LIMITS.runDeadlineMs ||
      (request.method === 'POST' && request.body === null) ||
      (request.method !== 'POST' && request.body !== null) ||
      (request.path === '/batches' && !['HEAD', 'OPTIONS'].includes(request.method))
    ) {
      throw new TypeError('Capability probe transport request is invalid.');
    }
    const body = request.body === null ? undefined : JSON.stringify(request.body);
    if (
      body !== undefined &&
      Buffer.byteLength(body, 'utf8') > CAPABILITY_PROBE_LIMITS.maxResponseBodyBytes
    ) {
      throw new TypeError('Capability probe request body is too large.');
    }
    const controller = new AbortController();
    let timedOut = false;
    const abort = (): void => controller.abort();
    if (request.signal.aborted) {
      controller.abort();
    }
    request.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs);
    try {
      const response = await this.#fetch(capabilityProbeUrl(request.baseUrl, request.path), {
        ...(body === undefined ? {} : { body }),
        credentials: 'omit',
        headers: {
          Accept:
            request.body !== null &&
            typeof request.body === 'object' &&
            !Array.isArray(request.body) &&
            'stream' in request.body &&
            request.body.stream === true
              ? 'text/event-stream'
              : 'application/json',
          Authorization: `Bearer ${request.credential}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        method: request.method,
        redirect: 'error',
        signal: controller.signal,
      });
      let headerBytes = 0;
      response.headers.forEach((value, key) => {
        headerBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
      });
      if (headerBytes > CAPABILITY_PROBE_LIMITS.maxResponseHeaderBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw errorWithCode('Capability probe response headers are too large.', 'EHEADERSIZE');
      }
      const headers = Object.fromEntries(
        ALLOWED_RESPONSE_HEADERS.flatMap((name) => {
          const value = response.headers.get(name);
          return value === null ? [] : [[name, value.slice(0, 256)]];
        }),
      );
      if (request.method === 'HEAD') {
        await response.body?.cancel().catch(() => undefined);
        return { body: '', headers, status: response.status };
      }
      const reader = response.body?.getReader();
      if (reader === undefined) {
        return { body: '', headers, status: response.status };
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const maxResponseBodyBytes =
        request.path === '/images/generations'
          ? CAPABILITY_PROBE_LIMITS.maxImageResponseBodyBytes
          : CAPABILITY_PROBE_LIMITS.maxResponseBodyBytes;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) {
            break;
          }
          total += next.value.byteLength;
          if (total > maxResponseBodyBytes) {
            await reader.cancel().catch(() => undefined);
            throw errorWithCode('Capability probe response body is too large.', 'EBODYSIZE');
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let decodedBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let receivedContentType = safeReceivedContentType(headers['content-type']);
      let transportVariant: OpenAIResponseTransportVariant = 'REJECTED';
      if (
        response.status >= 200 &&
        response.status < 300 &&
        (request.path === '/responses' || request.path === '/chat/completions')
      ) {
        try {
          const normalized = normalizeOpenAICompatibleResponse({
            body: decodedBody,
            contentType: headers['content-type'],
            maxBodyBytes: CAPABILITY_PROBE_LIMITS.maxResponseBodyBytes,
            protocol: request.path === '/chat/completions' ? 'CHAT_COMPLETIONS' : 'RESPONSES',
          });
          decodedBody = normalized.body;
          receivedContentType = normalized.receivedContentType;
          transportVariant = normalized.transportVariant;
        } catch (error) {
          if (error instanceof OpenAIResponseNormalizationError) {
            receivedContentType = error.receivedContentType;
          } else {
            throw error;
          }
        }
      }
      return {
        body: decodedBody,
        headers,
        receivedContentType,
        status: response.status,
        transportVariant,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        if (timedOut) {
          throw new DOMException('Capability probe timed out.', 'TimeoutError');
        }
        throw new DOMException('Capability probe aborted.', 'AbortError');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abort);
    }
  }
}
