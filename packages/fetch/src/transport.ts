import http, {
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions as HttpRequestOptions,
} from 'node:http';
import https, { type RequestOptions as HttpsRequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import {
  FETCH_CHARSETS,
  FETCH_MIME_TYPES,
  FETCH_USER_AGENT,
  type FetchCharset,
  type FetchMimeType,
  type FetchSendState,
} from './constants.js';
import type { FetchProfileV1 } from './contracts.js';
import { FetchError } from './errors.js';
import type { PinnedNetworkTargetV1 } from './network-policy.js';
import { assertPinnedRemoteAddress } from './network-policy.js';

export interface FetchTransportRequestV1 {
  readonly deadlineAt: number;
  readonly kind: 'PAGE' | 'ROBOTS';
  readonly pinnedTarget: PinnedNetworkTargetV1;
  readonly profile: FetchProfileV1;
  readonly signal?: AbortSignal;
  readonly url: URL;
}

export interface FetchTransportResponseV1 {
  readonly body: Uint8Array;
  readonly contentDisposition: string | null;
  readonly contentType: string | null;
  readonly decodedBytes: number;
  readonly location: string | null;
  readonly rawBytes: number;
  readonly remoteAddress: string;
  readonly retryAfterSeconds: number | null;
  readonly statusCode: number;
}

export interface FetchTransportV1 {
  fetch(request: FetchTransportRequestV1): Promise<FetchTransportResponseV1>;
}

export type FetchConnectorOptionsV1 = HttpRequestOptions & HttpsRequestOptions;

export interface FetchConnectorV1 {
  request(
    url: URL,
    options: FetchConnectorOptionsV1,
    onResponse: (response: IncomingMessage) => void,
  ): ClientRequest;
}

export class NodeFetchConnector implements FetchConnectorV1 {
  public request(
    url: URL,
    options: FetchConnectorOptionsV1,
    onResponse: (response: IncomingMessage) => void,
  ): ClientRequest {
    return url.protocol === 'https:'
      ? https.request(url, options, onResponse)
      : http.request(url, options, onResponse);
  }
}

export interface NodeControlledFetchTransportOptionsV1 {
  readonly connector?: FetchConnectorV1;
  readonly nowMilliseconds?: () => number;
}

export interface ParsedContentTypeV1 {
  readonly charset: FetchCharset | null;
  readonly mimeType: FetchMimeType;
}

function requestSendState(kind: 'PAGE' | 'ROBOTS'): FetchSendState {
  return kind === 'PAGE' ? 'PAGE_SENT' : 'ROBOTS_SENT';
}

function normalizeCharset(value: string): FetchCharset {
  const aliases: Readonly<Record<string, FetchCharset>> = {
    big5: 'big5',
    'cn-big5': 'big5',
    'euc-jp': 'euc-jp',
    gb18030: 'gb18030',
    gb2312: 'gb18030',
    gbk: 'gb18030',
    'iso-2022-jp': 'iso-2022-jp',
    'shift-jis': 'shift_jis',
    shift_jis: 'shift_jis',
    sjis: 'shift_jis',
    'utf-8': 'utf-8',
    utf8: 'utf-8',
  };
  const charset = aliases[value.trim().toLowerCase()];
  if (charset === undefined || !FETCH_CHARSETS.includes(charset)) {
    throw new FetchError('FETCH_CHARSET_UNSUPPORTED', { sendState: 'PAGE_SENT' });
  }
  return charset;
}

export function parseFetchContentType(value: string | null): ParsedContentTypeV1 {
  if (value === null || value.trim() === '') {
    throw new FetchError('FETCH_MIME_MISSING', { sendState: 'PAGE_SENT' });
  }
  const segments = value.split(';').map((segment) => segment.trim());
  const mime = segments.shift()?.toLowerCase();
  if (mime === undefined || !FETCH_MIME_TYPES.includes(mime as FetchMimeType)) {
    throw new FetchError('FETCH_MIME_UNSUPPORTED', { sendState: 'PAGE_SENT' });
  }
  let charset: FetchCharset | null = null;
  const names = new Set<string>();
  for (const parameter of segments) {
    if (parameter === '') continue;
    const separator = parameter.indexOf('=');
    if (separator < 1) throw new FetchError('FETCH_MIME_MISMATCH', { sendState: 'PAGE_SENT' });
    const name = parameter.slice(0, separator).trim().toLowerCase();
    const rawValue = parameter
      .slice(separator + 1)
      .trim()
      .replace(/^"|"$/gu, '');
    if (names.has(name)) throw new FetchError('FETCH_MIME_MISMATCH', { sendState: 'PAGE_SENT' });
    names.add(name);
    if (name !== 'charset') {
      throw new FetchError('FETCH_MIME_MISMATCH', { sendState: 'PAGE_SENT' });
    }
    charset = normalizeCharset(rawValue);
  }
  return Object.freeze({ charset, mimeType: mime as FetchMimeType });
}

function retryAfterSeconds(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,6}$/u.test(value)) return null;
  return Math.min(Number(value), 86_400);
}

function contentEncoding(response: IncomingMessage): 'br' | 'deflate' | 'gzip' | 'identity' {
  const value = response.headers['content-encoding'];
  if (value === undefined || value === 'identity') return 'identity';
  if (value === 'gzip' || value === 'deflate' || value === 'br') return value;
  throw new FetchError('FETCH_MIME_MISMATCH', { sendState: 'PAGE_SENT' });
}

async function collectBody(
  response: IncomingMessage,
  limits: { readonly decodedBytes: number; readonly rawBytes: number },
  sendState: FetchSendState,
): Promise<{
  readonly body: Uint8Array;
  readonly decodedBytes: number;
  readonly rawBytes: number;
}> {
  let rawBytes = 0;
  let decodedBytes = 0;
  const chunks: Buffer[] = [];
  const rawLimiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      rawBytes += chunk.byteLength;
      if (rawBytes > limits.rawBytes) return callback(new Error('RAW_LIMIT'));
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
      decodedBytes += chunk.byteLength;
      if (decodedBytes > limits.decodedBytes) return callback(new Error('DECODED_LIMIT'));
      if (rawBytes > 0 && decodedBytes > rawBytes * 100) {
        return callback(new Error('COMPRESSION_RATIO'));
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
      (cause.message === 'RAW_LIMIT' || cause.message === 'DECODED_LIMIT')
    ) {
      throw new FetchError('FETCH_RESPONSE_TOO_LARGE', { cause, sendState });
    }
    if (cause instanceof Error && cause.message === 'COMPRESSION_RATIO') {
      throw new FetchError('FETCH_COMPRESSION_LIMIT', { cause, sendState });
    }
    if (cause instanceof Error && cause.message === 'BODY_TIMEOUT') {
      throw new FetchError('FETCH_TIMEOUT_AFTER_SEND', { cause, sendState });
    }
    throw new FetchError('FETCH_AMBIGUOUS', { cause, sendState: 'UNKNOWN' });
  }
  return Object.freeze({ body: Buffer.concat(chunks), decodedBytes, rawBytes });
}

function normalizeRemoteAddress(value: string): string {
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) return value.slice(7);
  return value.toLowerCase();
}

export class NodeControlledFetchTransport implements FetchTransportV1 {
  readonly #connector: FetchConnectorV1;
  readonly #nowMilliseconds: () => number;

  public constructor(options: NodeControlledFetchTransportOptionsV1 = {}) {
    this.#connector = options.connector ?? new NodeFetchConnector();
    this.#nowMilliseconds = options.nowMilliseconds ?? Date.now;
  }

  public async fetch(request: FetchTransportRequestV1): Promise<FetchTransportResponseV1> {
    const remaining = request.deadlineAt - this.#nowMilliseconds();
    if (remaining <= 0) throw new FetchError('FETCH_TIMEOUT_BEFORE_SEND');
    if (
      request.url.hostname.toLowerCase() !== request.pinnedTarget.hostname ||
      request.url.username !== '' ||
      request.url.password !== '' ||
      request.url.hash !== '' ||
      (request.url.protocol !== 'http:' && request.url.protocol !== 'https:')
    ) {
      throw new FetchError('FETCH_URL_INVALID');
    }
    const sendState = requestSendState(request.kind);
    return new Promise((resolve, reject) => {
      let sent = false;
      let settled = false;
      let headerTimer: NodeJS.Timeout | null = null;
      const finishReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        if (headerTimer !== null) clearTimeout(headerTimer);
        clearTimeout(totalTimer);
        reject(error);
      };
      const finishResolve = (value: FetchTransportResponseV1): void => {
        if (settled) return;
        settled = true;
        if (headerTimer !== null) clearTimeout(headerTimer);
        clearTimeout(totalTimer);
        resolve(value);
      };
      const outbound = this.#connector.request(
        request.url,
        {
          agent: false,
          headers: {
            accept:
              request.kind === 'ROBOTS'
                ? 'text/plain'
                : 'text/html, application/xhtml+xml;q=0.9, text/plain;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'user-agent': FETCH_USER_AGENT,
          },
          lookup: (_hostname, _options, callback) => {
            if (typeof _options === 'object' && _options.all === true) {
              const allCallback = callback as unknown as (
                error: Error | null,
                addresses: readonly { readonly address: string; readonly family: 4 | 6 }[],
              ) => void;
              allCallback(null, [request.pinnedTarget.selectedAddress]);
            } else {
              callback(
                null,
                request.pinnedTarget.selectedAddress.address,
                request.pinnedTarget.selectedAddress.family,
              );
            }
          },
          method: 'GET',
          ...(request.url.protocol === 'https:'
            ? { rejectUnauthorized: true, servername: request.pinnedTarget.hostname }
            : {}),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
        (response) => {
          sent = true;
          if (headerTimer !== null) {
            clearTimeout(headerTimer);
            headerTimer = null;
          }
          const headerCount = response.rawHeaders.length / 2;
          const headerBytes = Buffer.byteLength(JSON.stringify(response.rawHeaders), 'utf8');
          if (
            headerCount > request.profile.limits.headerCount ||
            headerBytes > request.profile.limits.headerBytes
          ) {
            response.destroy();
            finishReject(new FetchError('FETCH_HEADERS_TOO_LARGE', { sendState }));
            return;
          }
          const declaredLength = response.headers['content-length'];
          if (
            declaredLength !== undefined &&
            (!/^\d+$/u.test(declaredLength) ||
              Number(declaredLength) > request.profile.limits.rawBytes)
          ) {
            response.destroy();
            finishReject(new FetchError('FETCH_RESPONSE_TOO_LARGE', { sendState }));
            return;
          }
          const remoteAddress = response.socket.remoteAddress;
          try {
            assertPinnedRemoteAddress(request.pinnedTarget, remoteAddress);
          } catch (error) {
            response.destroy();
            finishReject(error);
            return;
          }
          response.setTimeout(request.profile.limits.bodyTimeoutMs, () => {
            response.destroy(new Error('BODY_TIMEOUT'));
          });
          collectBody(response, request.profile.limits, sendState).then(
            ({ body, decodedBytes, rawBytes }) => {
              if (this.#nowMilliseconds() > request.deadlineAt) {
                finishReject(new FetchError('FETCH_TIMEOUT_AFTER_SEND', { sendState }));
                return;
              }
              finishResolve(
                Object.freeze({
                  body,
                  contentDisposition:
                    typeof response.headers['content-disposition'] === 'string'
                      ? response.headers['content-disposition']
                      : null,
                  contentType:
                    typeof response.headers['content-type'] === 'string'
                      ? response.headers['content-type']
                      : null,
                  decodedBytes,
                  location:
                    typeof response.headers.location === 'string'
                      ? response.headers.location
                      : null,
                  rawBytes,
                  remoteAddress: normalizeRemoteAddress(remoteAddress),
                  retryAfterSeconds: retryAfterSeconds(response.headers['retry-after']),
                  statusCode: response.statusCode ?? 0,
                }),
              );
            },
            finishReject,
          );
        },
      );
      const totalTimer = setTimeout(() => {
        outbound.destroy(new Error('TOTAL_TIMEOUT'));
        finishReject(
          new FetchError(sent ? 'FETCH_TIMEOUT_AFTER_SEND' : 'FETCH_TIMEOUT_BEFORE_SEND', {
            sendState: sent ? sendState : 'NOT_SENT',
          }),
        );
      }, remaining);
      totalTimer.unref();
      outbound.once('finish', () => {
        sent = true;
        headerTimer = setTimeout(() => {
          outbound.destroy(new Error('HEADER_TIMEOUT'));
          finishReject(new FetchError('FETCH_TIMEOUT_AFTER_SEND', { sendState }));
        }, request.profile.limits.headerTimeoutMs);
        headerTimer.unref();
      });
      outbound.once('error', (cause) => {
        if (cause instanceof FetchError) {
          finishReject(cause);
        } else if (cause instanceof Error && cause.name === 'AbortError') {
          finishReject(
            new FetchError(sent ? 'FETCH_CANCELLED_AFTER_SEND' : 'FETCH_CANCELLED_BEFORE_SEND', {
              cause,
              sendState: sent ? sendState : 'NOT_SENT',
            }),
          );
        } else if (cause instanceof Error && cause.message === 'CONNECT_TIMEOUT') {
          finishReject(new FetchError('FETCH_TIMEOUT_BEFORE_SEND', { cause }));
        } else if (
          request.url.protocol === 'https:' &&
          cause instanceof Error &&
          /certificate|tls|hostname|ssl/iu.test(cause.message)
        ) {
          finishReject(new FetchError('FETCH_TLS_FAILED', { cause, sendState }));
        } else if (sent) {
          finishReject(new FetchError('FETCH_AMBIGUOUS', { cause, sendState: 'UNKNOWN' }));
        } else {
          finishReject(new FetchError('FETCH_FAILED_BEFORE_SEND', { cause }));
        }
      });
      outbound.setTimeout(request.profile.limits.connectTimeoutMs, () => {
        outbound.destroy(new Error('CONNECT_TIMEOUT'));
      });
      outbound.end();
    });
  }
}

export class ScriptedFetchTransport implements FetchTransportV1 {
  public readonly calls: FetchTransportRequestV1[] = [];
  readonly #responses: Array<FetchTransportResponseV1 | FetchError>;

  public constructor(responses: readonly (FetchTransportResponseV1 | FetchError)[]) {
    this.#responses = [...responses];
  }

  public async fetch(request: FetchTransportRequestV1): Promise<FetchTransportResponseV1> {
    this.calls.push(request);
    const response = this.#responses.shift();
    if (response === undefined) throw new FetchError('FETCH_INTERNAL');
    if (response instanceof FetchError) throw response;
    return response;
  }
}
