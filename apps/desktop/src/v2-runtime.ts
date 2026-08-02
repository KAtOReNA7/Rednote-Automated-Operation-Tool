import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';

import { connectDatabase, initializeDatabase, SqliteV2Repository } from '@mystery-operations/db';
import { initializeProjectDataRoot } from '@mystery-operations/storage';
import {
  V2ApplicationFacade,
  V2ContentApplication,
  V2ContractError,
  V2_IPC_CHANNELS,
  parseV2MutationRequest,
  parseV2ReadRequest,
  toV2Exception,
  type AccountPersona,
  type V2Result,
  type WeeklyPlan,
} from '@mystery-operations/v2';

import { discoverApprovedV2Covers, V2LocalContentFiles } from './v2-content-files.js';

const V2_DATA_ROOT_DIRECTORY = 'v2-project-data';
const PROJECT_DATABASE_FILE = 'rednote.sqlite';

export class V2DesktopRuntime {
  readonly #database: DatabaseSync;
  readonly #content: V2ContentApplication;
  readonly #facade: V2ApplicationFacade;
  readonly #repository: SqliteV2Repository;
  #closed = false;

  private constructor(database: DatabaseSync, contentFiles: V2LocalContentFiles) {
    this.#database = database;
    this.#repository = new SqliteV2Repository(database);
    this.#facade = new V2ApplicationFacade(this.#repository);
    this.#content = new V2ContentApplication(this.#repository, contentFiles);
  }

  public static async open(
    userDataPath: string,
    options: {
      readonly assetsDirectory?: string;
      readonly openDirectory?: (path: string) => Promise<string>;
    } = {},
  ): Promise<V2DesktopRuntime> {
    const root = await initializeProjectDataRoot(join(userDataPath, V2_DATA_ROOT_DIRECTORY));
    const databasePath = join(root.databaseDirectory, PROJECT_DATABASE_FILE);
    await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
    });
    const assetsDirectory =
      options.assetsDirectory ?? join(app.getAppPath(), '.vite', 'renderer', 'assets');
    const contentFiles = new V2LocalContentFiles(
      root,
      await discoverApprovedV2Covers(assetsDirectory),
      { openDirectory: options.openDirectory ?? ((path) => shell.openPath(path)) },
    );
    return new V2DesktopRuntime(connectDatabase(databasePath), contentFiles);
  }

  public async read(input: unknown) {
    this.#assertOpen();
    const request = parseV2ReadRequest(input);
    return request.view === 'CONTENT_PACKAGES'
      ? this.#content.read(request.weekKey)
      : this.#facade.read(request);
  }

  public async mutate(input: unknown) {
    this.#assertOpen();
    const request = parseV2MutationRequest(input);
    if (request.action === 'GENERATE_CONTENT_PACKAGES') {
      const persona = this.#facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: request.weekKey,
      }) as WeeklyPlan;
      return this.#content.generate(request, persona, plan);
    }
    if (request.action === 'SAVE_CONTENT_PACKAGE') return this.#content.save(request);
    if (request.action === 'APPROVE_CONTENT_PACKAGES') return this.#content.approve(request.items);
    if (request.action === 'EXPORT_CONTENT_PACKAGES')
      return this.#content.export(request.items, request.idempotencyKey);
    if (request.action === 'OPEN_CONTENT_EXPORT') {
      await this.#content.openExport(request.exportId);
      return { opened: true };
    }
    return this.#facade.mutate(request);
  }

  public smokeSummary() {
    this.#assertOpen();
    return this.#repository.summary();
  }

  public close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('V2_RUNTIME_CLOSED');
  }
}

export function isTrustedV2IpcSender(
  event: IpcMainInvokeEvent,
  expectedRendererUrl: string,
  expectedWindow: BrowserWindow | null,
): boolean {
  const senderFrame = event.senderFrame;
  const owningWindow = BrowserWindow.fromWebContents(event.sender);
  if (
    senderFrame === null ||
    senderFrame !== event.sender.mainFrame ||
    expectedWindow === null ||
    owningWindow !== expectedWindow
  ) {
    return false;
  }
  try {
    const actual = new URL(senderFrame.url);
    const expected = new URL(expectedRendererUrl);
    return (
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      (actual.search === '' || actual.search === '?smoke=1') &&
      actual.username === '' &&
      actual.password === ''
    );
  } catch {
    return false;
  }
}

export function registerV2Ipc(options: {
  readonly expectedRendererUrl: string;
  readonly getWindow: () => BrowserWindow | null;
  readonly runtime: V2DesktopRuntime;
}): () => void {
  const handle = (channel: string, action: (input: unknown) => Promise<unknown>): void => {
    ipcMain.handle(
      channel,
      async (event, ...args: readonly unknown[]): Promise<V2Result<unknown>> => {
        if (
          args.length !== 1 ||
          !isTrustedV2IpcSender(event, options.expectedRendererUrl, options.getWindow())
        ) {
          return { error: toV2Exception(new V2ContractError('INVALID_REQUEST')), ok: false };
        }
        try {
          return { ok: true, value: await action(args[0]) };
        } catch (error) {
          return { error: toV2Exception(error), ok: false };
        }
      },
    );
  };

  handle(V2_IPC_CHANNELS.read, (input) => options.runtime.read(input));
  handle(V2_IPC_CHANNELS.mutate, (input) => options.runtime.mutate(input));
  return () => {
    ipcMain.removeHandler(V2_IPC_CHANNELS.read);
    ipcMain.removeHandler(V2_IPC_CHANNELS.mutate);
  };
}
