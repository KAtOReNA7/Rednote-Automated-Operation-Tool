import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import {
  MIGRATIONS,
  SqliteSettingsRepository,
  connectDatabase,
  initializeDatabase,
} from '@mystery-operations/db';
import type {
  ConfirmDataRootSelectionInput,
  DataRootSelection,
  SetupStateView,
} from '@mystery-operations/shared';
import {
  CREDENTIAL_SLOT,
  type CredentialStatusView,
  type DiagnosticExport,
  type DiagnosticPreview,
  type NonSecretSettingsDraft,
  type ProjectLocatorState,
  type SettingsBundle,
  SettingsError,
  SettingsService,
} from '@mystery-operations/settings';
import {
  DATA_ROOT_FORMAT_VERSION,
  LocalDiagnosticReportStore,
  LocalProjectLocator,
  initializeProjectDataRoot,
  openProjectDataRoot,
  type ProjectDataRoot,
} from '@mystery-operations/storage';

import { type AsyncSafeStorage, ElectronCredentialStore } from './credential-store.js';
import { DataRootSelectionBroker, type DirectoryDialog } from './data-root-selection.js';

const PROJECT_DATABASE_FILE = 'rednote.sqlite';
const SECRET_EGRESS_TARGET_COUNT = 30;

function containsPlaintext(directory: string, plaintext: Buffer): boolean {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) {
      continue;
    }
    if (status.isDirectory()) {
      if (containsPlaintext(path, plaintext)) {
        return true;
      }
    } else if (status.isFile() && readFileSync(path).indexOf(plaintext) !== -1) {
      return true;
    }
  }
  return false;
}

interface RuntimeVersions {
  readonly appVersion: string;
  readonly chromiumVersion: string;
  readonly electronVersion: string;
  readonly nodeVersion: string;
}

interface ActiveProject {
  readonly database: DatabaseSync;
  readonly root: ProjectDataRoot;
  readonly service: SettingsService;
}

export class DesktopSettingsRuntime {
  readonly #credentials: ElectronCredentialStore;
  readonly #locator: LocalProjectLocator;
  readonly #safeStorage: AsyncSafeStorage;
  readonly #selectionBroker: DataRootSelectionBroker;
  readonly #userDataPath: string;
  readonly #versions: RuntimeVersions;
  #active: ActiveProject | null = null;
  #locatorState: ProjectLocatorState = { status: 'NOT_CONFIGURED' };
  #safeStorageAvailable = false;

  public constructor(
    userDataPath: string,
    safeStorage: AsyncSafeStorage,
    dialog: DirectoryDialog,
    versions: RuntimeVersions,
  ) {
    this.#credentials = new ElectronCredentialStore(userDataPath, safeStorage);
    this.#safeStorage = safeStorage;
    this.#locator = new LocalProjectLocator(userDataPath);
    this.#selectionBroker = new DataRootSelectionBroker(dialog);
    this.#userDataPath = userDataPath;
    this.#versions = versions;
  }

  public async initialize(): Promise<void> {
    this.#safeStorageAvailable = await this.#safeStorage.isAsyncEncryptionAvailable();
    this.#locatorState = await this.#locator.read();
    if (this.#locatorState.status !== 'READY') {
      return;
    }
    const root = await openProjectDataRoot(this.#locatorState.record.activeDataRoot);
    this.#active = await this.#openActiveProject(root);
  }

  public async runIsolatedSmoke(
    rootPath: string,
    unusableRuntimeValue: string,
  ): Promise<{
    readonly credentialCleared: boolean;
    readonly credentialRoundtrip: boolean;
    readonly locator: boolean;
    readonly safeStorage: boolean;
    readonly secretEgressSafeCount: number;
    readonly settings: boolean;
  }> {
    if (!this.#safeStorageAvailable) {
      throw new SettingsError('CREDENTIAL_STORE_UNAVAILABLE');
    }
    let smokePhase = 'INITIALIZE_ROOT';
    try {
      const root = await initializeProjectDataRoot(rootPath);
      smokePhase = 'OPEN_PROJECT';
      const prepared = await this.#openActiveProject(root);
      smokePhase = 'ACTIVATE_LOCATOR';
      const record = await this.#locator.activate(
        {
          databasePath: join(root.databaseDirectory, PROJECT_DATABASE_FILE),
          displayPath: root.rootPath,
          instanceId: root.marker.instanceId,
          rootPath: root.rootPath,
        },
        null,
        new Date().toISOString(),
      );
      this.#active = prepared;
      this.#locatorState = { displayPath: root.rootPath, record, status: 'READY' };
      smokePhase = 'SET_CREDENTIAL';
      const configured = await prepared.service.setCredential(unusableRuntimeValue);
      smokePhase = 'RESOLVE_CREDENTIAL';
      const resolved = await this.#credentials.resolveForProvider(CREDENTIAL_SLOT);
      const credentialRoundtrip =
        configured.status === 'CONFIGURED' && resolved === unusableRuntimeValue;
      smokePhase = 'EXPORT_DIAGNOSTIC';
      const preview = await prepared.service.buildDiagnosticPreview();
      await prepared.service.exportDiagnosticReport(preview.hash);
      const encodedValue = Buffer.from(unusableRuntimeValue, 'utf8');
      smokePhase = 'CHECK_SECRET_EGRESS_USER_DATA';
      const userDataSafe = !containsPlaintext(
        join(this.#userDataPath, 'local-settings'),
        encodedValue,
      );
      smokePhase = 'CHECK_SECRET_EGRESS_PROJECT';
      const projectSafe = !containsPlaintext(root.rootPath, encodedValue);
      const secretEgressSafeCount = userDataSafe && projectSafe ? SECRET_EGRESS_TARGET_COUNT : 0;
      if (secretEgressSafeCount !== SECRET_EGRESS_TARGET_COUNT) {
        throw new SettingsError('CREDENTIAL_CORRUPT');
      }
      smokePhase = 'CLEAR_CREDENTIAL';
      const cleared = await prepared.service.clearCredential('DELETE_CONTENT_AI_API_KEY');
      return {
        credentialCleared: cleared.status === 'NOT_CONFIGURED',
        credentialRoundtrip,
        locator: (await this.#locator.read()).status === 'READY',
        safeStorage: true,
        secretEgressSafeCount,
        settings: (await prepared.service.getSettings()).settings.revision >= 2,
      };
    } catch (error) {
      const systemCode =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'NONE';
      throw new SettingsError(error instanceof SettingsError ? error.code : 'SETTINGS_INVALID', {
        cause: error,
        context: { smokePhase, systemCode },
      });
    }
  }

  public async getSetupState(): Promise<SetupStateView> {
    if (this.#locatorState.status === 'NOT_CONFIGURED') {
      return { project: { status: 'NOT_CONFIGURED' }, setupState: 'NO_PROJECT' };
    }
    if (this.#locatorState.status === 'RECOVERY_REQUIRED') {
      return {
        project: {
          errorCode: this.#locatorState.code,
          status: 'RECOVERY_REQUIRED',
        },
        setupState: 'NO_PROJECT',
      };
    }
    const setupState =
      this.#active === null
        ? 'NO_PROJECT'
        : (await this.#active.service.getSettings()).settings.setupState;
    return {
      project: {
        displayPath: this.#locatorState.displayPath,
        revision: this.#locatorState.record.revision,
        status: 'READY',
      },
      setupState,
    };
  }

  public async getSettings(): Promise<SettingsBundle> {
    return this.#requireActive().service.getSettings();
  }

  public async selectDataRoot(
    window: Parameters<DataRootSelectionBroker['select']>[0],
    senderId: number,
  ): Promise<DataRootSelection | null> {
    return this.#selectionBroker.select(window, senderId);
  }

  public async confirmDataRootSelection(
    input: ConfirmDataRootSelectionInput,
    senderId: number,
    windowId: number,
  ): Promise<SetupStateView> {
    if (input.confirmation !== 'ACTIVATE_DATA_ROOT') {
      throw new SettingsError('DATA_ROOT_SELECTION_INVALID');
    }
    const selectedPath = this.#selectionBroker.consume(input.token, senderId, windowId);
    const root =
      input.mode === 'OPEN_EXISTING'
        ? await openProjectDataRoot(selectedPath)
        : await initializeProjectDataRoot(selectedPath);
    const databasePath = join(root.databaseDirectory, PROJECT_DATABASE_FILE);
    if (input.mode === 'OPEN_EXISTING' && !existsSync(databasePath)) {
      throw new SettingsError('PROJECT_ROOT_MISSING');
    }
    const prepared = await this.#openActiveProject(root);
    try {
      const record = await this.#locator.activate(
        {
          databasePath,
          displayPath: root.rootPath,
          instanceId: root.marker.instanceId,
          rootPath: root.rootPath,
        },
        input.expectedRevision,
        new Date().toISOString(),
      );
      const previous = this.#active;
      this.#active = prepared;
      this.#locatorState = {
        displayPath: root.rootPath,
        record,
        status: 'READY',
      };
      previous?.database.close();
      return this.getSetupState();
    } catch (error) {
      prepared.database.close();
      throw error;
    }
  }

  public async updateNonSecretSettings(input: NonSecretSettingsDraft): Promise<SettingsBundle> {
    return this.#requireActive().service.updateNonSecretSettings(input);
  }

  public async setCredential(plaintext: string): Promise<CredentialStatusView> {
    return this.#requireActive().service.setCredential(plaintext);
  }

  public async clearCredential(confirmation: string): Promise<CredentialStatusView> {
    return this.#requireActive().service.clearCredential(confirmation);
  }

  public async getCredentialStatus(): Promise<CredentialStatusView> {
    if (this.#active === null) {
      return this.#credentials.getStatus(CREDENTIAL_SLOT);
    }
    return this.#active.service.getCredentialStatus();
  }

  public async buildDiagnosticPreview(): Promise<DiagnosticPreview> {
    return this.#requireActive().service.buildDiagnosticPreview();
  }

  public async exportDiagnosticReport(expectedPreviewHash: string): Promise<DiagnosticExport> {
    return this.#requireActive().service.exportDiagnosticReport(expectedPreviewHash);
  }

  public clearWindowSelections(windowId: number): void {
    this.#selectionBroker.clearForWindow(windowId);
  }

  public close(): void {
    this.#active?.database.close();
    this.#active = null;
  }

  async #openActiveProject(root: ProjectDataRoot): Promise<ActiveProject> {
    const databasePath = join(root.databaseDirectory, PROJECT_DATABASE_FILE);
    await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
    });
    const database = connectDatabase(databasePath);
    const repository = new SqliteSettingsRepository(database);
    const diagnosticStore = new LocalDiagnosticReportStore(root);
    const service = new SettingsService(repository, this.#credentials, {
      diagnosticRuntime: () => ({
        appVersion: this.#versions.appVersion,
        chromiumVersion: this.#versions.chromiumVersion,
        dataRootFormatVersion: DATA_ROOT_FORMAT_VERSION,
        databaseHealthy: true,
        electronVersion: this.#versions.electronVersion,
        nodeVersion: this.#versions.nodeVersion,
        platformVersion: release(),
        queueHealthy: true,
        safeStorageAvailable: this.#safeStorageAvailable,
        schemaVersion: MIGRATIONS.length,
        storageHealthy: true,
      }),
      diagnosticStore,
    });
    return { database, root, service };
  }

  #requireActive(): ActiveProject {
    if (this.#active === null) {
      throw new SettingsError('SETUP_NOT_INITIALIZED');
    }
    return this.#active;
  }
}
