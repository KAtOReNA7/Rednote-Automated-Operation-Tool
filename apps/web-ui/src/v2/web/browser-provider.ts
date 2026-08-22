import { createUnknownCapabilities } from '../../../../../packages/providers/src/capabilities.js';
import type {
  ProviderCallContext,
  RuntimeSchema,
  TextGenerationResult,
} from '../../../../../packages/providers/src/contracts.js';
import {
  decodeChatCompletionsText,
  encodeChatCompletionsText,
} from '../../../../../packages/providers/src/codecs/chat-completions-codec.js';
import { ProviderError } from '../../../../../packages/providers/src/errors.js';
import { PROVIDER_LIMITS } from '../../../../../packages/providers/src/response-limits.js';

export type WebProviderPurpose = 'CAPABILITY_PROBE' | 'CONTENT_COPY' | 'REPLY_SUGGESTION';

export interface BrowserTextRequest {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly purpose: WebProviderPurpose;
  readonly schema?: RuntimeSchema<unknown>;
  readonly signal?: AbortSignal;
  readonly system: string;
  readonly user: string;
}

export interface WebTextProviderPort {
  generate(request: BrowserTextRequest): Promise<TextGenerationResult>;
}

export interface BrowserChatCompletionsProviderOptions {
  readonly createRequestId?: () => string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;

function providerError(
  code: ConstructorParameters<typeof ProviderError>[0],
  context: ProviderCallContext,
  outcomeCertainty: ConstructorParameters<typeof ProviderError>[1]['outcomeCertainty'],
  details: Readonly<Record<string, boolean | null | number | string>> = {},
): ProviderError {
  return new ProviderError(code, {
    causeCategory:
      code === 'PROVIDER_ABORTED'
        ? 'ABORT'
        : code === 'PROVIDER_TIMEOUT'
          ? 'TIMEOUT'
          : code === 'PROVIDER_RATE_LIMITED'
            ? 'RATE_LIMIT'
            : code === 'PROVIDER_INVALID_CONTENT_TYPE'
              ? 'CONTENT_TYPE'
              : code.startsWith('PROVIDER_UPSTREAM')
                ? 'UPSTREAM'
                : 'NETWORK',
    details,
    modelId: context.modelId,
    operation: context.operation,
    outcomeCertainty,
    providerId: context.providerId,
    requestId: context.requestId,
    retryDisposition: 'DO_NOT_RETRY',
  });
}

async function boundedBody(response: Response, context: ProviderCallContext): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > PROVIDER_LIMITS.maxResponseBodyBytes) {
        await reader.cancel();
        throw providerError('PROVIDER_RESPONSE_TOO_LARGE', context, 'COMPLETED_INVALID_OUTPUT', {
          responseBytesAtLeast: bytes,
        });
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

function endpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new TypeError('WEB_PROVIDER_BASE_URL_INVALID');
  }
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/chat/completions`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export class BrowserChatCompletionsProvider implements WebTextProviderPort {
  readonly #createRequestId: () => string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;

  public constructor(options: BrowserChatCompletionsProviderOptions = {}) {
    this.#createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async generate(request: BrowserTextRequest): Promise<TextGenerationResult> {
    const requestId = this.#createRequestId();
    const capabilities = {
      ...createUnknownCapabilities(),
      observedAt: new Date(this.#now()).toISOString(),
      source: 'PROBED' as const,
      structuredJson: request.schema === undefined ? ('UNKNOWN' as const) : ('SUPPORTED' as const),
      text: 'SUPPORTED' as const,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), this.#timeoutMs);
    const abort = (): void => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', abort, { once: true });
    const context: ProviderCallContext = {
      capabilities,
      configRevision: 0,
      modelId: request.modelId,
      operation: request.schema === undefined ? 'TEXT_GENERATION' : 'STRUCTURED_GENERATION',
      protocolMode: 'CHAT_COMPLETIONS',
      providerId: 'web-session-provider',
      requestId,
      signal: controller.signal,
      timeoutMs: this.#timeoutMs,
      traceMetadata: { purpose: request.purpose },
    };
    const body = JSON.stringify(
      encodeChatCompletionsText(
        {
          messages: [
            { content: [{ text: request.system, type: 'TEXT' }], role: 'SYSTEM' },
            { content: [{ text: request.user, type: 'TEXT' }], role: 'USER' },
          ],
          options: { maxOutputTokens: 4_000, temperature: 0.2 },
        },
        context,
        request.schema,
      ),
    );
    if (new TextEncoder().encode(body).byteLength > PROVIDER_LIMITS.maxRequestBodyBytes) {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
      throw providerError('PROVIDER_REQUEST_TOO_LARGE', context, 'NOT_SENT');
    }
    const startedAt = this.#now();
    try {
      const response = await this.#fetch(endpoint(request.baseUrl), {
        body,
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${request.apiKey}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      let responseHeaderBytes = 0;
      response.headers.forEach((value, name) => {
        responseHeaderBytes += new TextEncoder().encode(`${name}:${value}\r\n`).byteLength;
      });
      if (responseHeaderBytes > PROVIDER_LIMITS.maxResponseHeaderBytes)
        throw providerError('PROVIDER_RESPONSE_TOO_LARGE', context, 'COMPLETED_INVALID_OUTPUT', {
          responseHeaderBytesAtLeast: responseHeaderBytes,
        });
      const responseBody = await boundedBody(response, context);
      if (!response.ok) {
        const code =
          response.status === 429
            ? 'PROVIDER_RATE_LIMITED'
            : response.status >= 500
              ? 'PROVIDER_UPSTREAM_5XX'
              : 'PROVIDER_UPSTREAM_4XX';
        throw providerError(
          code,
          context,
          response.status >= 500 ? 'MAY_HAVE_EXECUTED' : 'REJECTED_BEFORE_EXECUTION',
          {
            httpStatus: response.status,
          },
        );
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
      if (contentType !== 'application/json') {
        throw providerError('PROVIDER_INVALID_CONTENT_TYPE', context, 'COMPLETED_INVALID_OUTPUT', {
          contentType: contentType.slice(0, 80),
        });
      }
      return decodeChatCompletionsText(
        responseBody,
        context,
        Math.max(0, this.#now() - startedAt),
        response.headers.get('x-request-id'),
      );
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (controller.signal.aborted) {
        throw providerError(
          request.signal?.aborted ? 'PROVIDER_ABORTED' : 'PROVIDER_TIMEOUT',
          context,
          'MAY_HAVE_EXECUTED',
        );
      }
      throw providerError('PROVIDER_NETWORK_UNREACHABLE', context, 'MAY_HAVE_EXECUTED');
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
    }
  }
}
