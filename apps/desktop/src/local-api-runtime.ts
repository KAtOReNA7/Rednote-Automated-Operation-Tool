import type { DatabaseSync } from 'node:sqlite';

import {
  assertLocalApiPort,
  LOCAL_API_HOST,
  type LocalApiClientView,
  type BrowserClipBusinessServiceV1,
  type LocalApiClock,
  LocalApiError,
  type LocalApiServerOptions,
  type LocalApiServiceState,
  type LocalApiSettings,
  type LocalApiStatusView,
  LocalApiServer,
  PairingSessionManager,
  type PairingView,
} from '@mystery-operations/local-api';
import { SqliteLocalApiRepository } from '@mystery-operations/db';

export interface DesktopLocalApiRuntimeOptions {
  readonly clock?: LocalApiClock;
  readonly serverFactory?: (options: LocalApiServerOptions) => LocalApiServer;
}

export class DesktopLocalApiRuntime {
  readonly #clock: LocalApiClock;
  readonly #pairingSessions: PairingSessionManager;
  readonly #serverFactory: (options: LocalApiServerOptions) => LocalApiServer;
  #errorCode: LocalApiError['code'] | undefined;
  #repository: SqliteLocalApiRepository | null = null;
  #server: LocalApiServer | null = null;
  #browserClipService: BrowserClipBusinessServiceV1 | null = null;
  #state: LocalApiServiceState = 'DISABLED_NO_PROJECT';

  public constructor(options: DesktopLocalApiRuntimeOptions = {}) {
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#pairingSessions = new PairingSessionManager({ clock: this.#clock });
    this.#serverFactory =
      options.serverFactory ?? ((serverOptions) => new LocalApiServer(serverOptions));
  }

  public async attachProject(
    database: DatabaseSync,
    browserClipService?: BrowserClipBusinessServiceV1,
  ): Promise<void> {
    await this.#stopServer();
    this.#repository = new SqliteLocalApiRepository(database);
    this.#browserClipService = browserClipService ?? null;
    this.#errorCode = undefined;
    const settings = this.#repository.getSettings();
    if (!settings.enabled) {
      this.#state = 'DISABLED';
      return;
    }
    try {
      await this.#startServer(settings.port);
    } catch (error) {
      this.#applyStartError(error);
    }
  }

  public async detachProject(): Promise<void> {
    await this.#stopServer();
    this.#repository = null;
    this.#browserClipService = null;
    this.#state = 'DISABLED_NO_PROJECT';
    this.#errorCode = undefined;
  }

  public getStatus(): LocalApiStatusView {
    if (this.#repository === null) {
      return {
        activeClientCount: 0,
        enabled: false,
        endpoint: null,
        port: 43_119,
        projectReady: false,
        revision: 0,
        state: 'DISABLED_NO_PROJECT',
      };
    }
    const settings = this.#repository.getSettings();
    const activeClientCount = this.#repository
      .listClients()
      .filter((client) => client.status === 'ACTIVE').length;
    return {
      activeClientCount,
      enabled: settings.enabled,
      endpoint:
        this.#server?.listener === null || this.#server?.listener === undefined
          ? null
          : `http://${LOCAL_API_HOST}:${this.#server.listener.port}`,
      ...(this.#errorCode === undefined ? {} : { errorCode: this.#errorCode }),
      port: settings.port,
      projectReady: true,
      revision: settings.revision,
      state: this.#state,
    };
  }

  public async updateSettings(input: {
    readonly enabled: boolean;
    readonly expectedRevision: number;
    readonly port: number;
  }): Promise<LocalApiStatusView> {
    const repository = this.#requireRepository();
    const requestedPort = assertLocalApiPort(input.port);
    const before = repository.getSettings();
    if (before.revision !== input.expectedRevision) {
      throw new LocalApiError('LOCAL_API_REVISION_CONFLICT', { retryable: true });
    }
    const requiresListenerChange =
      before.enabled !== input.enabled || (input.enabled && before.port !== requestedPort);
    if (!requiresListenerChange) {
      repository.updateSettings({
        enabled: input.enabled,
        expectedRevision: input.expectedRevision,
        port: requestedPort,
        updatedAt: this.#clock.now().toISOString(),
      });
      return this.getStatus();
    }

    await this.#stopServer();
    if (input.enabled) {
      try {
        await this.#startServer(requestedPort);
      } catch (error) {
        const restored = await this.#restoreBefore(before);
        if (!restored) {
          this.#state = 'ERROR_RESTART_REQUIRED';
          this.#errorCode = error instanceof LocalApiError ? error.code : 'LOCAL_API_BIND_FAILED';
        }
        throw error;
      }
    } else {
      this.#state = 'DISABLED';
    }

    try {
      repository.updateSettings({
        enabled: input.enabled,
        expectedRevision: input.expectedRevision,
        port: requestedPort,
        updatedAt: this.#clock.now().toISOString(),
      });
      this.#errorCode = undefined;
      return this.getStatus();
    } catch (error) {
      await this.#stopServer();
      const restored = await this.#restoreBefore(before);
      if (!restored) {
        this.#state = 'ERROR_RESTART_REQUIRED';
        this.#errorCode = 'LOCAL_API_BIND_FAILED';
      }
      throw error;
    }
  }

  public startPairing(windowId: number): PairingView {
    const listener = this.#server?.listener;
    if (listener === null || listener === undefined || this.#state !== 'RUNNING') {
      throw new LocalApiError('LOCAL_API_DISABLED');
    }
    return this.#pairingSessions.start(listener.listenerInstanceId, listener.port, windowId);
  }

  public cancelPairing(pairingSessionId: string, windowId: number): LocalApiStatusView {
    this.#pairingSessions.cancel(pairingSessionId, windowId);
    return this.getStatus();
  }

  public clearWindowPairings(windowId: number): void {
    this.#pairingSessions.clearForWindow(windowId);
  }

  public listClients(): readonly LocalApiClientView[] {
    return this.#requireRepository().listClients();
  }

  public revokeClient(
    clientId: string,
    expectedRevision: number,
    confirmation: string,
  ): LocalApiClientView {
    if (confirmation !== 'REVOKE_LOCAL_API_CLIENT') {
      throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
    }
    return this.#requireRepository().revokeClient(
      clientId,
      expectedRevision,
      this.#clock.now().toISOString(),
    );
  }

  public async close(): Promise<void> {
    await this.detachProject();
  }

  async #startServer(port: number): Promise<void> {
    const repository = this.#requireRepository();
    this.#state = 'STARTING';
    const server = this.#serverFactory({
      ...(this.#browserClipService === null
        ? {}
        : { browserClipService: this.#browserClipService }),
      clock: this.#clock,
      pairingSessions: this.#pairingSessions,
      port,
      repository,
    });
    await server.start();
    this.#server = server;
    this.#state = 'RUNNING';
    this.#errorCode = undefined;
  }

  async #stopServer(): Promise<void> {
    if (this.#server === null) {
      this.#pairingSessions.clear();
      return;
    }
    this.#state = 'STOPPING';
    const server = this.#server;
    this.#server = null;
    await server.stop();
    this.#pairingSessions.clear();
  }

  async #restoreBefore(settings: LocalApiSettings): Promise<boolean> {
    if (!settings.enabled) {
      this.#state = 'DISABLED';
      this.#errorCode = undefined;
      return true;
    }
    try {
      await this.#startServer(settings.port);
      return true;
    } catch {
      return false;
    }
  }

  #applyStartError(error: unknown): void {
    if (error instanceof LocalApiError && error.code === 'LOCAL_API_PORT_IN_USE') {
      this.#state = 'PORT_IN_USE';
      this.#errorCode = error.code;
      return;
    }
    this.#state = 'ERROR';
    this.#errorCode = error instanceof LocalApiError ? error.code : 'LOCAL_API_BIND_FAILED';
  }

  #requireRepository(): SqliteLocalApiRepository {
    if (this.#repository === null) {
      throw new LocalApiError('LOCAL_API_NO_PROJECT');
    }
    return this.#repository;
  }
}
