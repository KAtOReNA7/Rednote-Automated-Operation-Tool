import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';

import {
  SEARCH_INTENTS,
  SEARCH_LIMITS,
  SEARCH_PROVIDER_CONTRACT_VERSION,
  type SearchIntent,
} from './constants.js';
import {
  type SearchCandidateAppearanceV1,
  type SearchExecutionContextV1,
  type SearchPreviewV1,
  type SearchProviderDescriptorV1,
  type SearchProviderV1,
  type SearchRequestV1,
  validateSearchProviderDescriptorV1,
  validateSearchRequestV1,
} from './contracts.js';
import { SearchError } from './errors.js';
import { createSearchBatch, createSearchPreview } from './provider-utils.js';

export interface SearchApiEncodedRequestV1 {
  readonly body: Uint8Array;
  readonly contentType: 'application/json';
  readonly headers: Readonly<Record<string, string>>;
  readonly method: 'POST';
  readonly url: URL;
}

export interface SearchApiTransportResponseV1 {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly retryAfterSeconds: number | null;
  readonly status: number;
}

export interface SearchApiTransportLimitsV1 {
  readonly bodyTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly headerBytes: number;
  readonly headerTimeoutMs: number;
  readonly maxDecompressedBytes: number;
  readonly maxRawBytes: number;
  readonly totalTimeoutMs: number;
}

export interface SearchApiTransportContextV1 {
  readonly allowLoopbackHttpForTests: boolean;
  readonly allowSameOriginRedirect: boolean;
  readonly limits: SearchApiTransportLimitsV1;
  readonly signal?: AbortSignal;
}

export interface SearchApiTransportV1 {
  send(
    request: SearchApiEncodedRequestV1,
    context: SearchApiTransportContextV1,
  ): Promise<SearchApiTransportResponseV1>;
}

export interface SearchApiDecodedResponseV1 {
  readonly appearances: readonly SearchCandidateAppearanceV1[];
  readonly complete: true;
  readonly cursor: string | null;
  readonly truncated: boolean;
}

export interface SearchApiCodecV1 {
  readonly allowSameOriginRedirect: boolean;
  readonly codecId: string;
  readonly endpoint: URL;
  readonly supportedIntents: readonly SearchIntent[];
  decode(response: SearchApiTransportResponseV1): SearchApiDecodedResponseV1;
  encode(request: SearchRequestV1, credential: string): SearchApiEncodedRequestV1;
}

export interface SearchApiCredentialResolverV1 {
  resolveCredential(reference: string): Promise<string>;
}

interface ScriptedResult {
  readonly languageHint: string | null;
  readonly previewText: string | null;
  readonly publishedAt: string | null;
  readonly title: string | null;
  readonly upstreamId: string | null;
  readonly url: string;
}

interface ScriptedEnvelope {
  readonly complete: true;
  readonly cursor: string | null;
  readonly results: readonly ScriptedResult[];
  readonly truncated: boolean;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function decodeScriptedEnvelope(body: Uint8Array): SearchApiDecodedResponseV1 {
  if (body.byteLength > SEARCH_LIMITS.responseBytes) {
    throw new SearchError('SEARCH_RESPONSE_TOO_LARGE', { sendState: 'SENT' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch (cause) {
    throw new SearchError('SEARCH_RESPONSE_INVALID', { cause, sendState: 'SENT' });
  }
  if (
    !exactObject(parsed, ['complete', 'cursor', 'results', 'truncated']) ||
    parsed.complete !== true ||
    typeof parsed.truncated !== 'boolean' ||
    (parsed.cursor !== null && typeof parsed.cursor !== 'string') ||
    !Array.isArray(parsed.results) ||
    parsed.results.length > SEARCH_LIMITS.maxCandidates
  ) {
    throw new SearchError('SEARCH_RESPONSE_INVALID', { sendState: 'SENT' });
  }
  const envelope = parsed as unknown as ScriptedEnvelope;
  const appearances = envelope.results.map((item, index): SearchCandidateAppearanceV1 => {
    if (
      !exactObject(item, [
        'languageHint',
        'previewText',
        'publishedAt',
        'title',
        'upstreamId',
        'url',
      ]) ||
      typeof item.url !== 'string'
    ) {
      throw new SearchError('SEARCH_RESULT_INVALID', { sendState: 'SENT' });
    }
    return Object.freeze({
      citationState: 'NOT_APPLICABLE',
      languageHint: item.languageHint,
      previewKind: item.previewText === null ? 'NONE' : 'UPSTREAM_SNIPPET',
      previewText: item.previewText,
      publishedAt: item.publishedAt,
      sourceMetadataKind: 'SEARCH_API_RESULT',
      title: item.title,
      upstreamId: item.upstreamId,
      upstreamRank: index,
      url: item.url,
      userSupplied: false,
      wasCited: null,
      wasConsulted: null,
    });
  });
  return Object.freeze({
    appearances: Object.freeze(appearances),
    complete: true,
    cursor: envelope.cursor,
    truncated: envelope.truncated,
  });
}

/**
 * Test-only fixed codec. It deliberately has no configurable method, path, headers,
 * JSONPath, script, or response mapping.
 */
export class ScriptedSearchApiCodec implements SearchApiCodecV1 {
  public readonly allowSameOriginRedirect = false;
  public readonly codecId: string = 'scripted-search-api-v1';
  public readonly endpoint: URL;
  public readonly supportedIntents: readonly SearchIntent[];

  public constructor(
    endpoint = new URL('https://search.invalid/v1/search'),
    intents: readonly SearchIntent[] = ['BOOK_DISCOVERY'],
  ) {
    this.endpoint = new URL(endpoint);
    if (
      intents.length < 1 ||
      intents.some((intent) => !SEARCH_INTENTS.includes(intent)) ||
      new Set(intents).size !== intents.length
    ) {
      throw new SearchError('SEARCH_INVALID_REQUEST');
    }
    this.supportedIntents = Object.freeze([...intents]);
  }

  public encode(request: SearchRequestV1, credential: string): SearchApiEncodedRequestV1 {
    if (credential.length < 1 || credential.length > 8_192) {
      throw new SearchError('SEARCH_PROVIDER_NOT_READY');
    }
    const body = new TextEncoder().encode(
      JSON.stringify({
        allowedDomains: request.allowedDomains,
        blockedDomains: request.blockedDomains,
        countryHint: request.countryHint,
        cursor: request.cursor,
        intent: request.intent,
        localeHints: request.localeHints,
        maxResults: request.maxResults,
        publishedAfter: request.publishedAfter,
        publishedBefore: request.publishedBefore,
        query: request.query,
      }),
    );
    return Object.freeze({
      body,
      contentType: 'application/json',
      headers: Object.freeze({
        accept: 'application/json',
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
      }),
      method: 'POST',
      url: new URL(this.endpoint),
    });
  }

  public decode(response: SearchApiTransportResponseV1): SearchApiDecodedResponseV1 {
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !/^application\/json(?:\s*;|$)/iu.test(response.contentType)
    ) {
      throw new SearchError('SEARCH_RESPONSE_INVALID', { sendState: 'SENT' });
    }
    return decodeScriptedEnvelope(response.body);
  }
}

/** Test-only loopback codec; production composition must never register it. */
export class LoopbackSearchApiCodec extends ScriptedSearchApiCodec {
  public override readonly codecId = 'loopback-search-api-fixture-v1';

  public constructor(endpoint: URL, intents?: readonly SearchIntent[]) {
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
      throw new SearchError('SEARCH_INVALID_REQUEST');
    }
    super(endpoint, intents);
  }
}

function validateLimits(value: SearchApiTransportLimitsV1): void {
  const bounded = (item: number, maximum: number): boolean =>
    Number.isSafeInteger(item) && item > 0 && item <= maximum;
  if (
    !bounded(value.connectTimeoutMs, 600_000) ||
    !bounded(value.headerTimeoutMs, 600_000) ||
    !bounded(value.bodyTimeoutMs, 600_000) ||
    !bounded(value.totalTimeoutMs, 600_000) ||
    !bounded(value.headerBytes, 64 * 1024) ||
    !bounded(value.maxRawBytes, SEARCH_LIMITS.responseBytes) ||
    !bounded(value.maxDecompressedBytes, SEARCH_LIMITS.responseBytes)
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
}

function isLoopback(url: URL): boolean {
  return url.hostname === '127.0.0.1';
}

function validateTransportUrl(url: URL, allowLoopbackHttpForTests: boolean): void {
  if (
    url.username !== '' ||
    url.password !== '' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && allowLoopbackHttpForTests && isLoopback(url)))
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
}

export function validateSearchApiRedirect(
  source: URL,
  location: string,
  allowLoopbackHttpForTests: boolean,
  allowSameOriginRedirect: boolean,
  redirectCount: number,
): URL {
  let redirected: URL;
  try {
    redirected = new URL(location, source);
    validateTransportUrl(redirected, allowLoopbackHttpForTests);
  } catch (cause) {
    throw new SearchError('SEARCH_RESPONSE_INVALID', { cause, sendState: 'SENT' });
  }
  if (
    !allowSameOriginRedirect ||
    redirectCount !== 0 ||
    redirected.origin !== source.origin ||
    (source.protocol === 'https:' && redirected.protocol !== 'https:')
  ) {
    throw new SearchError('SEARCH_RESPONSE_INVALID', { sendState: 'SENT' });
  }
  return redirected;
}

function retryAfterSeconds(header: string | undefined): number | null {
  if (header === undefined || !/^\d{1,6}$/u.test(header)) return null;
  return Math.min(Number(header), 86_400);
}

function contentEncoding(response: IncomingMessage): 'br' | 'deflate' | 'gzip' | 'identity' {
  const value = response.headers['content-encoding'];
  if (value === undefined || value === 'identity') return 'identity';
  if (value === 'gzip' || value === 'deflate' || value === 'br') return value;
  throw new SearchError('SEARCH_RESPONSE_INVALID', { sendState: 'SENT' });
}

async function collectResponseBody(
  response: IncomingMessage,
  limits: SearchApiTransportLimitsV1,
): Promise<Uint8Array> {
  let rawBytes = 0;
  let decompressedBytes = 0;
  const chunks: Buffer[] = [];
  const rawLimiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      rawBytes += chunk.byteLength;
      if (rawBytes > limits.maxRawBytes) {
        callback(new Error('RAW_LIMIT'));
        return;
      }
      callback(null, chunk);
    },
  });
  const encoding = contentEncoding(response);
  const decompressor =
    encoding === 'gzip'
      ? createGunzip()
      : encoding === 'deflate'
        ? createInflate()
        : encoding === 'br'
          ? createBrotliDecompress()
          : null;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      decompressedBytes += chunk.byteLength;
      if (decompressedBytes > limits.maxDecompressedBytes) {
        callback(new Error('DECOMPRESSED_LIMIT'));
        return;
      }
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  try {
    await pipeline([response, rawLimiter, ...(decompressor === null ? [] : [decompressor]), sink]);
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause.message === 'RAW_LIMIT' || cause.message === 'DECOMPRESSED_LIMIT')
    ) {
      throw new SearchError('SEARCH_RESPONSE_TOO_LARGE', { cause, sendState: 'SENT' });
    }
    if (cause instanceof Error && cause.message === 'BODY_TIMEOUT') {
      throw new SearchError('SEARCH_TIMEOUT_AFTER_SEND', { cause, sendState: 'SENT' });
    }
    throw new SearchError('SEARCH_AMBIGUOUS', { cause, sendState: 'UNKNOWN' });
  }
  return Buffer.concat(chunks);
}

export class NodeSearchApiTransport implements SearchApiTransportV1 {
  public async send(
    request: SearchApiEncodedRequestV1,
    context: SearchApiTransportContextV1,
  ): Promise<SearchApiTransportResponseV1> {
    validateLimits(context.limits);
    validateTransportUrl(request.url, context.allowLoopbackHttpForTests);
    const headerEntries = Object.entries(request.headers);
    const allowedHeaders = new Set([
      'accept',
      'authorization',
      'content-type',
      'user-agent',
      'x-api-key',
    ]);
    if (
      request.method !== 'POST' ||
      request.contentType !== 'application/json' ||
      request.body.byteLength > SEARCH_LIMITS.requestBytes ||
      headerEntries.length > 8 ||
      headerEntries.some(
        ([key, value]) =>
          key !== key.toLowerCase() ||
          !allowedHeaders.has(key) ||
          key.length > 128 ||
          value.length > 8_192 ||
          containsAsciiControl(value),
      ) ||
      request.headers['content-type'] !== request.contentType ||
      request.url.hash !== ''
    ) {
      throw new SearchError('SEARCH_INVALID_REQUEST');
    }
    return this.#sendOnce(request, context, 0, Date.now() + context.limits.totalTimeoutMs);
  }

  async #sendOnce(
    request: SearchApiEncodedRequestV1,
    context: SearchApiTransportContextV1,
    redirectCount: number,
    deadlineAt: number,
  ): Promise<SearchApiTransportResponseV1> {
    const remainingTotalMs = deadlineAt - Date.now();
    if (remainingTotalMs <= 0) {
      throw new SearchError('SEARCH_TIMEOUT_BEFORE_SEND', { sendState: 'NOT_SENT' });
    }
    const client = request.url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      let sent = false;
      let settled = false;
      let headerTimer: NodeJS.Timeout | null = null;
      const finishReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        if (headerTimer !== null) clearTimeout(headerTimer);
        clearTimeout(totalTimer);
        reject(error);
      };
      const finishResolve = (response: SearchApiTransportResponseV1) => {
        if (settled) return;
        settled = true;
        if (headerTimer !== null) clearTimeout(headerTimer);
        clearTimeout(totalTimer);
        resolve(response);
      };
      const fail = (
        code: 'SEARCH_AMBIGUOUS' | 'SEARCH_TIMEOUT_AFTER_SEND' | 'SEARCH_TIMEOUT_BEFORE_SEND',
        cause?: unknown,
      ) => {
        finishReject(new SearchError(code, { cause, sendState: sent ? 'SENT' : 'NOT_SENT' }));
      };
      const outbound = client.request(
        request.url,
        {
          headers: { ...request.headers, 'content-length': String(request.body.byteLength) },
          method: request.method,
          signal: context.signal,
        },
        (response) => {
          sent = true;
          if (headerTimer !== null) {
            clearTimeout(headerTimer);
            headerTimer = null;
          }
          const headerBytes = Buffer.byteLength(JSON.stringify(response.rawHeaders), 'utf8');
          if (headerBytes > context.limits.headerBytes) {
            response.destroy();
            finishReject(new SearchError('SEARCH_RESPONSE_TOO_LARGE', { sendState: 'SENT' }));
            return;
          }
          const declaredLength = response.headers['content-length'];
          if (
            declaredLength !== undefined &&
            /^\d+$/u.test(declaredLength) &&
            Number(declaredLength) > context.limits.maxRawBytes
          ) {
            response.destroy();
            finishReject(new SearchError('SEARCH_RESPONSE_TOO_LARGE', { sendState: 'SENT' }));
            return;
          }
          response.setTimeout(context.limits.bodyTimeoutMs, () => {
            response.destroy(new Error('BODY_TIMEOUT'));
          });
          const location = response.headers.location;
          if (
            location !== undefined &&
            response.statusCode !== undefined &&
            [301, 302, 303, 307, 308].includes(response.statusCode)
          ) {
            response.resume();
            try {
              const redirected = validateSearchApiRedirect(
                request.url,
                location,
                context.allowLoopbackHttpForTests,
                context.allowSameOriginRedirect,
                redirectCount,
              );
              this.#sendOnce({ ...request, url: redirected }, context, 1, deadlineAt).then(
                finishResolve,
                finishReject,
              );
            } catch (cause) {
              finishReject(cause);
              return;
            }
            return;
          }
          collectResponseBody(response, context.limits).then((body) => {
            if (Date.now() > deadlineAt) {
              finishReject(new SearchError('SEARCH_TIMEOUT_AFTER_SEND', { sendState: 'SENT' }));
              return;
            }
            finishResolve(
              Object.freeze({
                body,
                contentType: response.headers['content-type'] ?? '',
                retryAfterSeconds: retryAfterSeconds(response.headers['retry-after']),
                status: response.statusCode ?? 0,
              }),
            );
          }, finishReject);
        },
      );
      const totalTimer = setTimeout(() => {
        outbound.destroy(new Error('TOTAL_TIMEOUT'));
        fail(sent ? 'SEARCH_TIMEOUT_AFTER_SEND' : 'SEARCH_TIMEOUT_BEFORE_SEND');
      }, remainingTotalMs);
      totalTimer.unref();
      outbound.once('finish', () => {
        sent = true;
        headerTimer = setTimeout(() => {
          outbound.destroy(new Error('HEADER_TIMEOUT'));
          fail('SEARCH_TIMEOUT_AFTER_SEND');
        }, context.limits.headerTimeoutMs);
        headerTimer.unref();
      });
      outbound.once('error', (cause) => {
        if (cause instanceof SearchError) finishReject(cause);
        else if (cause instanceof Error && cause.name === 'AbortError') {
          finishReject(
            new SearchError(sent ? 'SEARCH_CANCELLED_AFTER_SEND' : 'SEARCH_CANCELLED_BEFORE_SEND', {
              cause,
              sendState: sent ? 'SENT' : 'NOT_SENT',
            }),
          );
        } else if (cause instanceof Error && cause.message === 'TOTAL_TIMEOUT') {
          fail(sent ? 'SEARCH_TIMEOUT_AFTER_SEND' : 'SEARCH_TIMEOUT_BEFORE_SEND', cause);
        } else if (cause instanceof Error && cause.message === 'HEADER_TIMEOUT') {
          fail('SEARCH_TIMEOUT_AFTER_SEND', cause);
        } else if (sent) {
          finishReject(new SearchError('SEARCH_AMBIGUOUS', { cause, sendState: 'UNKNOWN' }));
        } else {
          fail('SEARCH_TIMEOUT_BEFORE_SEND', cause);
        }
      });
      outbound.setTimeout(context.limits.connectTimeoutMs, () => {
        outbound.destroy(new Error('CONNECT_TIMEOUT'));
        fail(sent ? 'SEARCH_TIMEOUT_AFTER_SEND' : 'SEARCH_TIMEOUT_BEFORE_SEND');
      });
      outbound.once('socket', (socket) => {
        if (!socket.connecting) {
          outbound.setTimeout(0);
          return;
        }
        socket.once(request.url.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
          outbound.setTimeout(0);
        });
      });
      outbound.end(request.body);
    });
  }
}

export interface SearchApiAdapterOptions {
  readonly accountingReady: boolean;
  readonly codec: SearchApiCodecV1 | null;
  readonly credentialReference: string | null;
  readonly credentialResolver: SearchApiCredentialResolverV1 | null;
  readonly enabled: boolean;
  readonly providerInstanceId?: string;
  readonly rateReady: boolean;
  readonly transport: SearchApiTransportV1;
  readonly transportLimits: SearchApiTransportLimitsV1;
}

function searchApiReadiness(options: SearchApiAdapterOptions) {
  if (!options.enabled) return 'DISABLED' as const;
  if (options.codec === null) return 'CODEC_UNAVAILABLE' as const;
  if (options.credentialReference === null || options.credentialResolver === null) {
    return 'NOT_CONFIGURED' as const;
  }
  if (!options.accountingReady) return 'BUDGET_POLICY_REQUIRED' as const;
  if (!options.rateReady) return 'RATE_POLICY_REQUIRED' as const;
  return 'READY' as const;
}

export class SearchApiAdapter implements SearchProviderV1 {
  readonly #descriptor: SearchProviderDescriptorV1;
  readonly #options: SearchApiAdapterOptions;

  public constructor(options: SearchApiAdapterOptions) {
    this.#options = options;
    const codecAvailable = options.codec !== null;
    this.#descriptor = validateSearchProviderDescriptorV1({
      budgetState: codecAvailable
        ? options.accountingReady
          ? 'READY'
          : 'REQUIRED'
        : 'UNAVAILABLE',
      capabilityState: 'NOT_APPLICABLE',
      codecState: codecAvailable ? 'READY' : 'UNAVAILABLE',
      contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
      credentialState:
        options.credentialReference !== null && options.credentialResolver !== null
          ? 'READY'
          : 'REQUIRED',
      displayName: '独立 Search API（接口预留）',
      features: {
        allowedDomains: codecAvailable,
        blockedDomains: codecAvailable,
        countryHint: codecAvailable,
        cursor: codecAvailable,
        hardDomainFilter: codecAvailable,
        liveAccess: codecAvailable,
        localeHints: codecAvailable,
        manualUrl: false,
        publishedDateRange: codecAvailable,
        query: true,
        structuredSources: true,
      },
      kind: 'SEARCH_API',
      maxResponseBytes: SEARCH_LIMITS.responseBytes,
      maxResults: SEARCH_LIMITS.maxCandidates,
      mode: 'ACTIVE_REMOTE',
      providerInstanceId: options.providerInstanceId ?? 'search-api-v1',
      rateState: options.rateReady ? 'READY' : 'REQUIRED',
      readiness: searchApiReadiness(options),
      supportedIntents: options.codec?.supportedIntents ?? ['BOOK_DISCOVERY'],
    });
  }

  public describe(): SearchProviderDescriptorV1 {
    return this.#descriptor;
  }

  public async preview(requestValue: SearchRequestV1): Promise<SearchPreviewV1> {
    return createSearchPreview(this.#descriptor, validateSearchRequestV1(requestValue), 1);
  }

  public async execute(requestValue: SearchRequestV1, context: SearchExecutionContextV1) {
    const request = validateSearchRequestV1(requestValue);
    const codec = this.#options.codec;
    const resolver = this.#options.credentialResolver;
    const reference = this.#options.credentialReference;
    if (
      this.#descriptor.readiness !== 'READY' ||
      codec === null ||
      resolver === null ||
      reference === null
    ) {
      throw new SearchError(
        this.#descriptor.readiness === 'CODEC_UNAVAILABLE'
          ? 'SEARCH_CODEC_UNAVAILABLE'
          : 'SEARCH_PROVIDER_NOT_READY',
      );
    }
    const startedAt = context.now().toISOString();
    const credential = await resolver.resolveCredential(reference);
    const encoded = codec.encode(request, credential);
    const response = await this.#options.transport.send(encoded, {
      allowLoopbackHttpForTests: codec instanceof LoopbackSearchApiCodec,
      allowSameOriginRedirect: codec.allowSameOriginRedirect,
      limits: this.#options.transportLimits,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    if (
      credential.length >= 8 &&
      Buffer.from(response.body).includes(Buffer.from(credential, 'utf8'))
    ) {
      throw new SearchError('SEARCH_RESPONSE_INVALID', { sendState: 'SENT' });
    }
    if (response.status === 429) {
      throw new SearchError('SEARCH_RATE_LIMITED', {
        retryable: true,
        safeDetails:
          response.retryAfterSeconds === null
            ? {}
            : { retryAfterSeconds: response.retryAfterSeconds },
        sendState: 'SENT',
      });
    }
    const decoded = codec.decode(response);
    if (decoded.complete !== true) {
      throw new SearchError('SEARCH_AMBIGUOUS', { sendState: 'UNKNOWN' });
    }
    return createSearchBatch({
      appearances: decoded.appearances,
      cursor: decoded.cursor,
      descriptor: this.#descriptor,
      executionContext: context,
      externalRequestCount: 1,
      request,
      startedAt,
      truncated: decoded.truncated,
    });
  }
}

export class ScriptedSearchApiTransport implements SearchApiTransportV1 {
  readonly #response: SearchApiTransportResponseV1;
  public calls = 0;

  public constructor(response: SearchApiTransportResponseV1) {
    this.#response = response;
  }

  public async send(): Promise<SearchApiTransportResponseV1> {
    this.calls += 1;
    return this.#response;
  }
}
