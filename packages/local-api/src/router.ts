import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  BROWSER_CLIP_CONTRACT_VERSION,
  BROWSER_CLIP_MAX_BODY_BYTES,
  BROWSER_CLIP_MAX_SCREENSHOT_BYTES,
} from '@mystery-operations/shared';

import {
  LocalApiAuthenticator,
  digestRuntimeToken,
  parseBearerAuthorization,
} from './authenticator.js';
import {
  type AuthenticatedStatusResponse,
  type BrowserClipBusinessServiceV1,
  type CapabilitiesResponse,
  LOCAL_API_MAX_JSON_BODY_BYTES,
  LOCAL_API_MAX_RESPONSE_BYTES,
  LOCAL_API_VERSION,
  type LocalApiAuthClient,
  type LocalApiClientRepository,
  type LocalApiClock,
  type LocalApiErrorCode,
  LocalApiError,
  type PairingExchangeResponse,
} from './contracts.js';
import { normalizeExtensionOrigin } from './origin-policy.js';
import type { PairingSessionManager } from './pairing-session.js';
import { FixedWindowRateLimiter } from './rate-limiter.js';
import {
  parseAuthenticatedExtensionOrigin,
  parseSingleOrigin,
  rawHeaderValues,
  readPairingJson,
  readBrowserClipJson,
  requestHasBody,
  validateHost,
  validateRemoteAddress,
} from './request-policy.js';

const ROUTES = Object.freeze({
  '/v1/browser-clips': 'POST',
  '/v1/capabilities': 'GET',
  '/v1/pairings/exchange': 'POST',
  '/v1/status': 'GET',
} as const);

const STATUS_BY_ERROR: Readonly<Partial<Record<LocalApiErrorCode, number>>> = Object.freeze({
  CLIPPER_CAPTURE_CONFLICT: 409,
  CLIPPER_RATE_LIMITED: 429,
  CLIPPER_SCREENSHOT_INVALID: 400,
  CLIPPER_STORAGE_FAILED: 500,
  LOCAL_API_AUTH_INVALID: 401,
  LOCAL_API_AUTH_REQUIRED: 401,
  LOCAL_API_BODY_TOO_LARGE: 413,
  LOCAL_API_CLIENT_LIMIT_REACHED: 409,
  LOCAL_API_CORS_REJECTED: 403,
  LOCAL_API_INVALID_HOST: 400,
  LOCAL_API_INVALID_JSON: 400,
  LOCAL_API_INVALID_ORIGIN: 403,
  LOCAL_API_INVALID_REQUEST: 400,
  LOCAL_API_METHOD_NOT_ALLOWED: 405,
  LOCAL_API_NOT_FOUND: 404,
  LOCAL_API_PAIRING_ATTEMPTS_EXCEEDED: 401,
  LOCAL_API_PAIRING_EXPIRED: 401,
  LOCAL_API_PAIRING_INVALID: 401,
  LOCAL_API_PAIRING_NOT_ACTIVE: 401,
  LOCAL_API_RATE_LIMITED: 429,
  LOCAL_API_SHUTTING_DOWN: 503,
});

export interface LocalApiRouterOptions {
  readonly browserClipService?: BrowserClipBusinessServiceV1;
  readonly clock?: LocalApiClock;
  readonly listenerInstanceId: string;
  readonly pairingSessions: PairingSessionManager;
  readonly port: number;
  readonly randomId?: () => string;
  readonly repository: LocalApiClientRepository;
}

function safeHeaders(origin?: string): Readonly<Record<string, string>> {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'Content-Type': 'application/json; charset=utf-8',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    ...(origin === undefined ? {} : { 'Access-Control-Allow-Origin': origin }),
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  options: { readonly origin?: string; readonly retryAfterSeconds?: number } = {},
): void {
  const encoded = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  if (encoded.length > LOCAL_API_MAX_RESPONSE_BYTES) {
    throw new LocalApiError('LOCAL_API_INTERNAL_ERROR');
  }
  response.writeHead(status, {
    ...safeHeaders(options.origin),
    'Content-Length': String(encoded.length),
    ...(options.retryAfterSeconds === undefined
      ? {}
      : { 'Retry-After': String(options.retryAfterSeconds) }),
  });
  response.end(encoded);
}

function sendPreflight(
  response: ServerResponse,
  origin: string,
  method: 'GET' | 'POST',
  allowHeaders: string,
): void {
  response.writeHead(204, {
    ...safeHeaders(origin),
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Methods': method,
    'Access-Control-Max-Age': '300',
  });
  response.end();
}

function errorStatus(error: LocalApiError): number {
  return STATUS_BY_ERROR[error.code] ?? 500;
}

export class LocalApiRouter {
  readonly #browserClipService: BrowserClipBusinessServiceV1 | null;
  readonly #authenticator: LocalApiAuthenticator;
  readonly #clock: LocalApiClock;
  readonly #listenerInstanceId: string;
  readonly #pairingSessions: PairingSessionManager;
  readonly #port: number;
  readonly #randomId: () => string;
  readonly #rateLimiter: FixedWindowRateLimiter;
  readonly #repository: LocalApiClientRepository;
  #stopping = false;

  public constructor(options: LocalApiRouterOptions) {
    this.#browserClipService = options.browserClipService ?? null;
    this.#repository = options.repository;
    this.#authenticator = new LocalApiAuthenticator(options.repository);
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#listenerInstanceId = options.listenerInstanceId;
    this.#pairingSessions = options.pairingSessions;
    this.#port = options.port;
    this.#randomId = options.randomId ?? randomUUID;
    this.#rateLimiter = new FixedWindowRateLimiter(this.#clock);
  }

  public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = this.#randomId();
    let corsOrigin: string | undefined;
    try {
      if (this.#stopping) {
        throw new LocalApiError('LOCAL_API_SHUTTING_DOWN');
      }
      validateRemoteAddress(request.socket.remoteAddress);
      validateHost(request.rawHeaders, this.#port);
      const target = request.url ?? '';
      if (
        target.length === 0 ||
        target.includes('?') ||
        target.includes('#') ||
        /^[a-z][a-z0-9+.-]*:/iu.test(target)
      ) {
        throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
      }
      const receiptMatch = /^\/v1\/browser-clips\/receipts\/([0-9a-f-]{36})$/u.exec(target);
      const expectedMethod =
        receiptMatch === null ? ROUTES[target as keyof typeof ROUTES] : ('GET' as const);
      if (expectedMethod === undefined) {
        throw new LocalApiError('LOCAL_API_NOT_FOUND');
      }
      const requestedOrigin =
        request.method === 'OPTIONS' || target === '/v1/pairings/exchange'
          ? parseSingleOrigin(request.rawHeaders)
          : parseAuthenticatedExtensionOrigin(request.rawHeaders);
      if (request.method === 'OPTIONS') {
        this.#handlePreflight(request, response, target, requestedOrigin, expectedMethod);
        return;
      }
      if (request.method !== expectedMethod) {
        response.setHeader('Allow', `OPTIONS, ${expectedMethod}`);
        throw new LocalApiError('LOCAL_API_METHOD_NOT_ALLOWED');
      }
      if (expectedMethod === 'GET' && requestHasBody(request.headers)) {
        throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
      }
      if (target === '/v1/pairings/exchange') {
        await this.#handlePairing(request, response, requestedOrigin, (verifiedOrigin) => {
          corsOrigin = verifiedOrigin;
        });
        return;
      }
      if (this.#repository.findActiveClientByOrigin(requestedOrigin) !== null) {
        corsOrigin = requestedOrigin;
      }
      await this.#handleAuthenticated(
        request,
        response,
        target,
        requestedOrigin,
        receiptMatch?.[1] ?? null,
      );
    } catch (caught) {
      const error =
        caught instanceof LocalApiError
          ? caught
          : new LocalApiError('LOCAL_API_INTERNAL_ERROR', { cause: caught });
      if (response.headersSent) {
        response.end();
        return;
      }
      const retryAfter =
        error.code === 'LOCAL_API_RATE_LIMITED' &&
        error.context !== undefined &&
        typeof error.context.retryAfterSeconds === 'number'
          ? error.context.retryAfterSeconds
          : undefined;
      sendJson(
        response,
        errorStatus(error),
        { code: error.code, message: error.message, requestId },
        {
          ...(corsOrigin === undefined ? {} : { origin: corsOrigin }),
          ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
        },
      );
    }
  }

  public beginStopping(): void {
    this.#stopping = true;
    this.#pairingSessions.clear();
    this.#rateLimiter.clear();
  }

  #handlePreflight(
    request: IncomingMessage,
    response: ServerResponse,
    target: string,
    origin: string,
    expectedMethod: 'GET' | 'POST',
  ): void {
    if (requestHasBody(request.headers)) {
      throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
    }
    const requestedMethods = rawHeaderValues(request.rawHeaders, 'access-control-request-method');
    const requestedHeaders = rawHeaderValues(request.rawHeaders, 'access-control-request-headers');
    const allowedHeaders =
      expectedMethod === 'POST' && target === '/v1/browser-clips'
        ? ['authorization,content-type', 'authorization,content-type,x-rednote-extension-origin']
        : expectedMethod === 'POST'
          ? ['content-type']
          : ['authorization', 'authorization,x-rednote-extension-origin'];
    const requestedHeader = requestedHeaders[0]?.toLowerCase().replaceAll(' ', '');
    if (
      requestedMethods.length !== 1 ||
      requestedMethods[0] !== expectedMethod ||
      requestedHeaders.length !== 1 ||
      requestedHeader === undefined ||
      !allowedHeaders.includes(requestedHeader)
    ) {
      throw new LocalApiError('LOCAL_API_CORS_REJECTED');
    }
    const allowed =
      target === '/v1/pairings/exchange'
        ? this.#pairingSessions.hasActive(this.#listenerInstanceId, this.#port)
        : this.#repository.findActiveClientByOrigin(origin) !== null;
    if (!allowed) {
      throw new LocalApiError('LOCAL_API_CORS_REJECTED');
    }
    sendPreflight(response, origin, expectedMethod, requestedHeader);
  }

  async #handlePairing(
    request: IncomingMessage,
    response: ServerResponse,
    origin: string,
    markOriginVerified: (origin: string) => void,
  ): Promise<void> {
    this.#takeRateLimit('pairing:global', 10);
    if (!this.#pairingSessions.hasActive(this.#listenerInstanceId, this.#port)) {
      throw new LocalApiError('LOCAL_API_PAIRING_NOT_ACTIVE');
    }
    const input = await readPairingJson(request);
    if (normalizeExtensionOrigin(input.extensionOrigin) !== origin) {
      throw new LocalApiError('LOCAL_API_INVALID_ORIGIN');
    }
    markOriginVerified(origin);
    this.#pairingSessions.consume(input.pairingCode, this.#listenerInstanceId, this.#port);
    const pairedAt = this.#clock.now().toISOString();
    const client = this.#repository.pairClient({
      clientLabel: input.clientLabel,
      extensionOrigin: origin,
      id: this.#randomId(),
      pairedAt,
      tokenDigest: digestRuntimeToken(input.clientToken),
    });
    const body: PairingExchangeResponse = {
      apiVersion: LOCAL_API_VERSION,
      clientId: client.id,
      createdAt: client.createdAt,
      paired: true,
    };
    sendJson(response, 201, body, { origin });
  }

  async #handleAuthenticated(
    request: IncomingMessage,
    response: ServerResponse,
    target: string,
    origin: string,
    receiptCaptureId: string | null,
  ): Promise<void> {
    const authorization = rawHeaderValues(request.rawHeaders, 'authorization');
    let token: string;
    let client: LocalApiAuthClient;
    try {
      token = parseBearerAuthorization(authorization);
      client = this.#authenticator.authenticate(origin, token);
    } catch (error) {
      this.#takeRateLimit('unauthenticated:global', 60);
      throw error;
    }
    this.#takeRateLimit(`authenticated:${client.id}`, 120);
    const now = this.#clock.now();
    const notAfter = new Date(now.getTime() - 60_000).toISOString();
    this.#repository.recordLastUsed(client.id, now.toISOString(), notAfter);
    if (target === '/v1/browser-clips') {
      if (this.#browserClipService === null) throw new LocalApiError('LOCAL_API_DISABLED');
      const input = await readBrowserClipJson(request);
      const body = await this.#browserClipService.create(client, origin, input);
      sendJson(response, 201, body, { origin });
      return;
    }
    if (receiptCaptureId !== null) {
      if (this.#browserClipService === null) throw new LocalApiError('LOCAL_API_DISABLED');
      const receipt = await this.#browserClipService.getReceipt(client, origin, receiptCaptureId);
      sendJson(response, 200, { apiVersion: LOCAL_API_VERSION, receipt }, { origin });
      return;
    }
    if (target === '/v1/status') {
      const body: AuthenticatedStatusResponse = {
        apiVersion: LOCAL_API_VERSION,
        clientId: client.id,
        clientStatus: 'ACTIVE',
        projectReady: true,
        serverTime: now.toISOString(),
        serviceState: 'RUNNING',
      };
      sendJson(response, 200, body, { origin });
      return;
    }
    const body: CapabilitiesResponse = {
      apiVersion: LOCAL_API_VERSION,
      authenticatedStatus: true,
      ...(this.#browserClipService === null
        ? {}
        : {
            browserClipContractVersion: BROWSER_CLIP_CONTRACT_VERSION,
            clipperLimits: {
              maxBodyBytes: BROWSER_CLIP_MAX_BODY_BYTES,
              maxScreenshotBytes: BROWSER_CLIP_MAX_SCREENSHOT_BYTES,
              maxSelectedTextCharacters: 12_000 as const,
              maxTags: 10,
              receiptLookup: true as const,
            },
          }),
      clipperBusinessRoutes: this.#browserClipService !== null,
      clipperIssue: '017',
      maxJsonBodyBytes: LOCAL_API_MAX_JSON_BODY_BYTES,
      pairing: true,
      supportedOriginScheme: 'chrome-extension',
    };
    sendJson(response, 200, body, { origin });
  }

  #takeRateLimit(key: string, limit: number): void {
    const result = this.#rateLimiter.take(key, limit);
    if (!result.allowed) {
      throw new LocalApiError('LOCAL_API_RATE_LIMITED', {
        context: { retryAfterSeconds: result.retryAfterSeconds },
        retryable: true,
      });
    }
  }
}

export const LOCAL_API_ROUTE_REGISTRY = ROUTES;
