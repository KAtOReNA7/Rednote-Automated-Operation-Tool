import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import { connectDatabase, initializeDatabase, SqliteV2Repository } from '@mystery-operations/db';
import { initializeProjectDataRoot } from '@mystery-operations/storage';
import {
  V2ApplicationFacade,
  V2ContractError,
  V2_IPC_CHANNELS,
  toV2Exception,
  type AccountPersona,
  type PlanReschedulePreview,
  type V2Result,
  type WeeklyPlan,
} from '@mystery-operations/v2';

const V2_DATA_ROOT_DIRECTORY = 'v2-project-data';
const PROJECT_DATABASE_FILE = 'rednote.sqlite';

export class V2DesktopRuntime {
  readonly #database: DatabaseSync;
  readonly #facade: V2ApplicationFacade;
  readonly #repository: SqliteV2Repository;
  #closed = false;

  private constructor(database: DatabaseSync) {
    this.#database = database;
    this.#repository = new SqliteV2Repository(database);
    this.#facade = new V2ApplicationFacade(this.#repository);
  }

  public static async open(userDataPath: string): Promise<V2DesktopRuntime> {
    const root = await initializeProjectDataRoot(join(userDataPath, V2_DATA_ROOT_DIRECTORY));
    const databasePath = join(root.databaseDirectory, PROJECT_DATABASE_FILE);
    await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
    });
    return new V2DesktopRuntime(connectDatabase(databasePath));
  }

  public read(input: unknown): AccountPersona | PlanReschedulePreview | WeeklyPlan {
    this.#assertOpen();
    return this.#facade.read(input);
  }

  public mutate(input: unknown): AccountPersona | WeeklyPlan {
    this.#assertOpen();
    return this.#facade.mutate(input);
  }

  public smokeSummary(): {
    readonly personaRevision: number;
    readonly planRevision: number;
    readonly v2TableCount: number;
  } {
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
  const handle = (
    channel: string,
    action: (input: unknown) => AccountPersona | PlanReschedulePreview | WeeklyPlan,
  ): void => {
    ipcMain.handle(
      channel,
      (
        event,
        ...args: readonly unknown[]
      ): V2Result<AccountPersona | PlanReschedulePreview | WeeklyPlan> => {
        if (
          args.length !== 1 ||
          !isTrustedV2IpcSender(event, options.expectedRendererUrl, options.getWindow())
        ) {
          return { error: toV2Exception(new V2ContractError('INVALID_REQUEST')), ok: false };
        }
        try {
          return { ok: true, value: action(args[0]) };
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
