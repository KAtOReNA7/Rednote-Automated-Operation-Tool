import { randomUUID } from 'node:crypto';

import type { BrowserWindow } from 'electron';

import type { DataRootSelection } from '@mystery-operations/shared';
import { SettingsError } from '@mystery-operations/settings';

const DEFAULT_TOKEN_TTL_MILLISECONDS = 2 * 60 * 1_000;

export interface DirectoryDialog {
  showOpenDialog(
    window: BrowserWindow,
    options: {
      readonly properties: readonly ['openDirectory', 'dontAddToRecent'];
    },
  ): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
}

interface SelectionRecord {
  readonly expiresAt: number;
  readonly path: string;
  readonly senderId: number;
  readonly windowId: number;
}

export interface DataRootSelectionBrokerOptions {
  readonly now?: () => Date;
  readonly randomId?: () => string;
  readonly tokenTtlMilliseconds?: number;
}

export class DataRootSelectionBroker {
  readonly #dialog: DirectoryDialog;
  readonly #now: () => Date;
  readonly #randomId: () => string;
  readonly #selections = new Map<string, SelectionRecord>();
  readonly #tokenTtlMilliseconds: number;

  public constructor(dialog: DirectoryDialog, options: DataRootSelectionBrokerOptions = {}) {
    this.#dialog = dialog;
    this.#now = options.now ?? (() => new Date());
    this.#randomId = options.randomId ?? randomUUID;
    this.#tokenTtlMilliseconds = options.tokenTtlMilliseconds ?? DEFAULT_TOKEN_TTL_MILLISECONDS;
  }

  public async select(window: BrowserWindow, senderId: number): Promise<DataRootSelection | null> {
    const result = await this.#dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    if (result.canceled) {
      return null;
    }
    if (result.filePaths.length !== 1 || result.filePaths[0] === undefined) {
      throw new SettingsError('DATA_ROOT_SELECTION_INVALID');
    }
    const token = this.#randomId();
    const expiresAt = this.#now().getTime() + this.#tokenTtlMilliseconds;
    this.#purgeExpired();
    this.#selections.set(token, {
      expiresAt,
      path: result.filePaths[0],
      senderId,
      windowId: window.id,
    });
    return {
      displayPath: result.filePaths[0],
      expiresAt: new Date(expiresAt).toISOString(),
      token,
    };
  }

  public consume(token: string, senderId: number, windowId: number): string {
    const record = this.#selections.get(token);
    this.#selections.delete(token);
    if (record === undefined || record.expiresAt < this.#now().getTime()) {
      throw new SettingsError('DATA_ROOT_SELECTION_EXPIRED');
    }
    if (record.senderId !== senderId || record.windowId !== windowId) {
      throw new SettingsError('DATA_ROOT_SELECTION_INVALID');
    }
    return record.path;
  }

  public clearForWindow(windowId: number): void {
    for (const [token, record] of this.#selections) {
      if (record.windowId === windowId) {
        this.#selections.delete(token);
      }
    }
  }

  #purgeExpired(): void {
    const now = this.#now().getTime();
    for (const [token, record] of this.#selections) {
      if (record.expiresAt < now) {
        this.#selections.delete(token);
      }
    }
  }
}
