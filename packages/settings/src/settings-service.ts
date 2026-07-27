import {
  CREDENTIAL_SLOT,
  type CredentialStatusView,
  type CredentialStore,
  type DiagnosticExport,
  type DiagnosticPreview,
  type DiagnosticReportStore,
  type DiagnosticRuntime,
  PROVIDER_CAPABILITY,
  type NonSecretSettingsDraft,
  type SettingsBundle,
  type SettingsClock,
  SettingsError,
  type SettingsRepository,
} from './contracts.js';
import { buildDiagnosticPreview } from './diagnostics.js';
import { determineSetupState, validateNonSecretDraft } from './validation.js';

const CLEAR_CONFIRMATION = 'DELETE_CONTENT_AI_API_KEY';
const MAX_CREDENTIAL_BYTES = 16 * 1024;

export interface SettingsServiceOptions {
  readonly clock?: SettingsClock;
  readonly diagnosticRuntime: () => DiagnosticRuntime;
  readonly diagnosticStore: DiagnosticReportStore;
}

export class SettingsService {
  readonly #clock: SettingsClock;
  readonly #credentials: CredentialStore;
  readonly #diagnosticRuntime: () => DiagnosticRuntime;
  readonly #diagnosticStore: DiagnosticReportStore;
  readonly #repository: SettingsRepository;
  #latestPreview: DiagnosticPreview | null = null;

  public constructor(
    repository: SettingsRepository,
    credentials: CredentialStore,
    options: SettingsServiceOptions,
  ) {
    this.#repository = repository;
    this.#credentials = credentials;
    this.#diagnosticRuntime = options.diagnosticRuntime;
    this.#diagnosticStore = options.diagnosticStore;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  public async getSettings(): Promise<SettingsBundle> {
    const persisted = this.#repository.getBundle();
    const credential = await this.#credentials.getStatus(CREDENTIAL_SLOT);
    const expectedState = determineSetupState(
      {
        credentialReference: persisted.settings.credentialReference,
        providerBaseUrl: persisted.settings.providerBaseUrl,
        researchModelId: persisted.settings.researchModelId,
        reviewModelId: persisted.settings.reviewModelId,
        writingModelId: persisted.settings.writingModelId,
      },
      credential.status,
    );
    return {
      ...persisted,
      credential,
      providerCapability: PROVIDER_CAPABILITY,
      settings:
        expectedState === persisted.settings.setupState
          ? persisted.settings
          : { ...persisted.settings, setupState: expectedState },
    };
  }

  public async updateNonSecretSettings(input: NonSecretSettingsDraft): Promise<SettingsBundle> {
    const current = await this.getSettings();
    const persist = validateNonSecretDraft(
      input,
      current.credential.status,
      current.settings.credentialReference,
      this.#clock.now().toISOString(),
    );
    this.#repository.update(persist);
    this.#latestPreview = null;
    return this.getSettings();
  }

  public async setCredential(plaintext: string): Promise<CredentialStatusView> {
    if (
      typeof plaintext !== 'string' ||
      plaintext.trim().length === 0 ||
      Buffer.byteLength(plaintext, 'utf8') > MAX_CREDENTIAL_BYTES ||
      plaintext.includes('\u0000') ||
      plaintext.includes('\r') ||
      plaintext.includes('\n')
    ) {
      throw new SettingsError('SETTINGS_INVALID');
    }
    const before = this.#repository.getBundle().settings;
    const status = await this.#credentials.set(CREDENTIAL_SLOT, plaintext);
    try {
      this.#repository.setCredentialReference(
        CREDENTIAL_SLOT,
        before.revision,
        this.#clock.now().toISOString(),
      );
    } catch (error) {
      await this.#credentials.getStatus(CREDENTIAL_SLOT);
      throw error;
    } finally {
      this.#latestPreview = null;
    }
    return status;
  }

  public async clearCredential(confirmation: string): Promise<CredentialStatusView> {
    if (confirmation !== CLEAR_CONFIRMATION) {
      throw new SettingsError('SETTINGS_INVALID');
    }
    const before = this.#repository.getBundle().settings;
    const status = await this.#credentials.clear(CREDENTIAL_SLOT);
    this.#repository.setCredentialReference(null, before.revision, this.#clock.now().toISOString());
    this.#latestPreview = null;
    return status;
  }

  public async getCredentialStatus(): Promise<CredentialStatusView> {
    return this.#credentials.getStatus(CREDENTIAL_SLOT);
  }

  public async buildDiagnosticPreview(): Promise<DiagnosticPreview> {
    const preview = buildDiagnosticPreview(await this.getSettings(), this.#diagnosticRuntime());
    this.#latestPreview = preview;
    return preview;
  }

  public async exportDiagnosticReport(expectedPreviewHash: string): Promise<DiagnosticExport> {
    const current = buildDiagnosticPreview(await this.getSettings(), this.#diagnosticRuntime());
    if (
      this.#latestPreview === null ||
      expectedPreviewHash !== this.#latestPreview.hash ||
      current.hash !== expectedPreviewHash
    ) {
      throw new SettingsError('DIAGNOSTIC_STALE');
    }
    try {
      const managedPath = await this.#diagnosticStore.write(
        current.content,
        current.hash,
        this.#clock.now().toISOString(),
      );
      return { managedPath, previewHash: current.hash };
    } catch (error) {
      throw new SettingsError('DIAGNOSTIC_EXPORT_FAILED', { cause: error, retryable: true });
    }
  }
}

export const CREDENTIAL_CLEAR_CONFIRMATION = CLEAR_CONFIRMATION;
