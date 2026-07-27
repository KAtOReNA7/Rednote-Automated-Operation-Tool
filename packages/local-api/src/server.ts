import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerOptions } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import {
  assertLocalApiPort,
  LOCAL_API_HOST,
  type LocalApiClientRepository,
  type LocalApiClock,
  LocalApiError,
} from './contracts.js';
import { PairingSessionManager } from './pairing-session.js';
import { LocalApiRouter } from './router.js';

export const LOCAL_API_SERVER_LIMITS = Object.freeze({
  backlog: 32,
  headersTimeout: 5_000,
  keepAliveTimeout: 2_000,
  maxConnections: 32,
  maxHeaderSize: 16 * 1024,
  maxHeadersCount: 32,
  maxRequestsPerSocket: 100,
  requestTimeout: 10_000,
  socketTimeout: 10_000,
} as const);

export interface LocalApiListenerInfo {
  readonly address: typeof LOCAL_API_HOST;
  readonly family: 'IPv4';
  readonly listenerInstanceId: string;
  readonly port: number;
}

export interface LocalApiServerOptions {
  readonly clock?: LocalApiClock;
  readonly pairingSessions?: PairingSessionManager;
  readonly port: number;
  readonly randomId?: () => string;
  readonly repository: LocalApiClientRepository;
  readonly shutdownTimeoutMilliseconds?: number;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export class LocalApiServer {
  readonly #listenerInstanceId: string;
  readonly #pairingSessions: PairingSessionManager;
  readonly #port: number;
  readonly #router: LocalApiRouter;
  readonly #server: Server;
  readonly #shutdownTimeoutMilliseconds: number;
  readonly #sockets = new Set<Socket>();
  #listener: LocalApiListenerInfo | null = null;

  public constructor(options: LocalApiServerOptions) {
    this.#port = assertLocalApiPort(options.port);
    this.#listenerInstanceId = (options.randomId ?? randomUUID)();
    this.#pairingSessions =
      options.pairingSessions ??
      new PairingSessionManager(options.clock === undefined ? {} : { clock: options.clock });
    this.#shutdownTimeoutMilliseconds = options.shutdownTimeoutMilliseconds ?? 2_000;
    this.#router = new LocalApiRouter({
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      listenerInstanceId: this.#listenerInstanceId,
      pairingSessions: this.#pairingSessions,
      port: this.#port,
      ...(options.randomId === undefined ? {} : { randomId: options.randomId }),
      repository: options.repository,
    });
    const serverOptions: ServerOptions = {
      headersTimeout: LOCAL_API_SERVER_LIMITS.headersTimeout,
      insecureHTTPParser: false,
      keepAliveTimeout: LOCAL_API_SERVER_LIMITS.keepAliveTimeout,
      maxHeaderSize: LOCAL_API_SERVER_LIMITS.maxHeaderSize,
      requestTimeout: LOCAL_API_SERVER_LIMITS.requestTimeout,
    };
    this.#server = createServer(serverOptions, (request, response) => {
      void this.#router.handle(request, response);
    });
    this.#server.maxHeadersCount = LOCAL_API_SERVER_LIMITS.maxHeadersCount;
    this.#server.maxConnections = LOCAL_API_SERVER_LIMITS.maxConnections;
    this.#server.maxRequestsPerSocket = LOCAL_API_SERVER_LIMITS.maxRequestsPerSocket;
    this.#server.timeout = LOCAL_API_SERVER_LIMITS.socketTimeout;
    this.#server.on('connection', (socket) => {
      this.#sockets.add(socket);
      socket.once('close', () => this.#sockets.delete(socket));
    });
    this.#server.on('upgrade', (_request, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
    this.#server.on('connect', (_request, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
    this.#server.on('clientError', (error, socket) => {
      if (socket.writable) {
        const status =
          'code' in error && error.code === 'HPE_HEADER_OVERFLOW'
            ? '431 Request Header Fields Too Large'
            : '400 Bad Request';
        socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      }
    });
  }

  public get pairingSessions(): PairingSessionManager {
    return this.#pairingSessions;
  }

  public get listener(): LocalApiListenerInfo | null {
    return this.#listener;
  }

  public async start(): Promise<LocalApiListenerInfo> {
    if (this.#listener !== null) {
      return this.#listener;
    }
    try {
      await new Promise<void>((resolveStart, rejectStart) => {
        const onError = (error: Error): void => {
          this.#server.off('listening', onListening);
          rejectStart(error);
        };
        const onListening = (): void => {
          this.#server.off('error', onError);
          resolveStart();
        };
        this.#server.once('error', onError);
        this.#server.once('listening', onListening);
        this.#server.listen({
          backlog: LOCAL_API_SERVER_LIMITS.backlog,
          host: LOCAL_API_HOST,
          port: this.#port,
        });
      });
    } catch (error) {
      throw new LocalApiError(
        isErrno(error, 'EADDRINUSE') ? 'LOCAL_API_PORT_IN_USE' : 'LOCAL_API_BIND_FAILED',
        { cause: error, retryable: true },
      );
    }
    const address = this.#server.address() as AddressInfo | null;
    if (
      address === null ||
      address.address !== LOCAL_API_HOST ||
      address.family !== 'IPv4' ||
      address.port !== this.#port
    ) {
      await this.stop();
      throw new LocalApiError('LOCAL_API_BIND_FAILED');
    }
    this.#listener = {
      address: LOCAL_API_HOST,
      family: 'IPv4',
      listenerInstanceId: this.#listenerInstanceId,
      port: this.#port,
    };
    return this.#listener;
  }

  public async stop(): Promise<void> {
    this.#router.beginStopping();
    this.#pairingSessions.clear();
    if (!this.#server.listening) {
      this.#listener = null;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      new Promise<void>((resolveClose) => {
        this.#server.close(() => resolveClose());
        this.#server.closeIdleConnections();
      }),
      new Promise<void>((resolveTimeout) => {
        timer = setTimeout(() => {
          this.#server.closeAllConnections();
          for (const socket of this.#sockets) {
            socket.destroy();
          }
          resolveTimeout();
        }, this.#shutdownTimeoutMilliseconds);
      }),
    ]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    this.#sockets.clear();
    this.#listener = null;
  }
}
