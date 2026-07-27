import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve } from 'node:path';

import {
  CREDENTIAL_SLOT,
  type CredentialSlot,
  type CredentialStatusView,
  type CredentialStore,
  SettingsError,
} from '@mystery-operations/settings';

export const CREDENTIAL_DIRECTORY = 'local-settings/credentials' as const;
export const CREDENTIAL_ENVELOPE_FORMAT = 'rednote-safe-storage-envelope' as const;
export const CREDENTIAL_ENVELOPE_VERSION = 1 as const;

const SLOT_FILES: Readonly<Record<CredentialSlot, string>> = Object.freeze({
  CONTENT_AI_API_KEY: 'content-ai-api-key.v1.json',
});

export interface AsyncSafeStorage {
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }>;
  encryptStringAsync(plaintext: string): Promise<Buffer>;
  isAsyncEncryptionAvailable(): Promise<boolean>;
}

interface CredentialEnvelope {
  readonly ciphertext: string;
  readonly format: typeof CREDENTIAL_ENVELOPE_FORMAT;
  readonly slot: CredentialSlot;
  readonly updatedAt: string;
  readonly version: typeof CREDENTIAL_ENVELOPE_VERSION;
}

export interface ElectronCredentialStoreOptions {
  readonly beforePublish?: () => void;
  readonly now?: () => Date;
  readonly publish?: (temporaryPath: string, targetPath: string) => Promise<void>;
  readonly randomId?: () => string;
}

function assertSlot(slot: string): asserts slot is CredentialSlot {
  if (slot !== CREDENTIAL_SLOT) {
    throw new SettingsError('SETTINGS_INVALID');
  }
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}

function parseEnvelope(value: unknown): CredentialEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SettingsError('CREDENTIAL_CORRUPT');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    !exactKeys(record, ['ciphertext', 'format', 'slot', 'updatedAt', 'version']) ||
    record.format !== CREDENTIAL_ENVELOPE_FORMAT ||
    record.version !== CREDENTIAL_ENVELOPE_VERSION ||
    record.slot !== CREDENTIAL_SLOT ||
    typeof record.ciphertext !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(record.ciphertext) ||
    typeof record.updatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record.updatedAt)
  ) {
    throw new SettingsError('CREDENTIAL_CORRUPT');
  }
  return record as unknown as CredentialEnvelope;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export class ElectronCredentialStore implements CredentialStore {
  readonly #beforePublish?: () => void;
  readonly #directory: string;
  readonly #now: () => Date;
  readonly #publish: (temporaryPath: string, targetPath: string) => Promise<void>;
  readonly #randomId: () => string;
  readonly #safeStorage: AsyncSafeStorage;

  public constructor(
    userDataPath: string,
    safeStorage: AsyncSafeStorage,
    options: ElectronCredentialStoreOptions = {},
  ) {
    const resolved = resolve(userDataPath);
    if (!isAbsolute(userDataPath) || resolved === parse(resolved).root) {
      throw new SettingsError('CREDENTIAL_STORE_UNAVAILABLE');
    }
    this.#directory = join(resolved, ...CREDENTIAL_DIRECTORY.split('/'));
    this.#safeStorage = safeStorage;
    this.#now = options.now ?? (() => new Date());
    this.#randomId = options.randomId ?? randomUUID;
    this.#publish = options.publish ?? rename;
    if (options.beforePublish !== undefined) {
      this.#beforePublish = options.beforePublish;
    }
  }

  public async getStatus(slot: CredentialSlot): Promise<CredentialStatusView> {
    assertSlot(slot);
    let envelope: CredentialEnvelope | null;
    try {
      envelope = await this.#readEnvelope(slot);
    } catch (error) {
      if (error instanceof SettingsError && error.code === 'CREDENTIAL_CORRUPT') {
        return {
          available: await this.#safeStorage.isAsyncEncryptionAvailable(),
          requiresReauth: true,
          status: 'CORRUPT',
        };
      }
      throw error;
    }
    if (envelope === null) {
      return {
        available: await this.#safeStorage.isAsyncEncryptionAvailable(),
        requiresReauth: false,
        status: 'NOT_CONFIGURED',
      };
    }
    if (!(await this.#safeStorage.isAsyncEncryptionAvailable())) {
      return {
        available: false,
        requiresReauth: false,
        status: 'UNAVAILABLE',
        updatedAt: envelope.updatedAt,
      };
    }
    try {
      await this.#safeStorage.decryptStringAsync(Buffer.from(envelope.ciphertext, 'base64'));
      return {
        available: true,
        requiresReauth: false,
        status: 'CONFIGURED',
        updatedAt: envelope.updatedAt,
      };
    } catch {
      return {
        available: true,
        requiresReauth: true,
        status: 'REAUTH_REQUIRED',
        updatedAt: envelope.updatedAt,
      };
    }
  }

  public async set(slot: CredentialSlot, plaintext: string): Promise<CredentialStatusView> {
    assertSlot(slot);
    if (!(await this.#safeStorage.isAsyncEncryptionAvailable())) {
      throw new SettingsError('CREDENTIAL_STORE_UNAVAILABLE');
    }
    let encrypted: Buffer;
    try {
      encrypted = await this.#safeStorage.encryptStringAsync(plaintext);
    } catch (error) {
      throw new SettingsError('CREDENTIAL_ENCRYPT_FAILED', { cause: error, retryable: true });
    }
    const envelope: CredentialEnvelope = {
      ciphertext: encrypted.toString('base64'),
      format: CREDENTIAL_ENVELOPE_FORMAT,
      slot,
      updatedAt: this.#now().toISOString(),
      version: CREDENTIAL_ENVELOPE_VERSION,
    };
    await this.#writeEnvelope(envelope);
    return {
      available: true,
      requiresReauth: false,
      status: 'CONFIGURED',
      updatedAt: envelope.updatedAt,
    };
  }

  public async clear(slot: CredentialSlot): Promise<CredentialStatusView> {
    assertSlot(slot);
    try {
      await unlink(this.#path(slot));
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) {
        throw new SettingsError('CREDENTIAL_STORE_UNAVAILABLE', {
          cause: error,
          retryable: true,
        });
      }
    }
    return {
      available: await this.#safeStorage.isAsyncEncryptionAvailable(),
      requiresReauth: false,
      status: 'NOT_CONFIGURED',
    };
  }

  public async resolveForProvider(slot: CredentialSlot): Promise<string> {
    assertSlot(slot);
    const envelope = await this.#readEnvelope(slot);
    if (envelope === null) {
      throw new SettingsError('CREDENTIAL_NOT_CONFIGURED');
    }
    if (!(await this.#safeStorage.isAsyncEncryptionAvailable())) {
      throw new SettingsError('CREDENTIAL_STORE_UNAVAILABLE');
    }
    let decrypted: { readonly result: string; readonly shouldReEncrypt: boolean };
    try {
      decrypted = await this.#safeStorage.decryptStringAsync(
        Buffer.from(envelope.ciphertext, 'base64'),
      );
    } catch (error) {
      throw new SettingsError('CREDENTIAL_REAUTH_REQUIRED', { cause: error });
    }
    if (decrypted.shouldReEncrypt) {
      try {
        const encrypted = await this.#safeStorage.encryptStringAsync(decrypted.result);
        await this.#writeEnvelope({
          ...envelope,
          ciphertext: encrypted.toString('base64'),
          updatedAt: this.#now().toISOString(),
        });
      } catch {
        // The old, decryptable envelope remains the authoritative record.
      }
    }
    return decrypted.result;
  }

  async #readEnvelope(slot: CredentialSlot): Promise<CredentialEnvelope | null> {
    try {
      return parseEnvelope(JSON.parse(await readFile(this.#path(slot), 'utf8')) as unknown);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return null;
      }
      if (error instanceof SettingsError) {
        throw error;
      }
      throw new SettingsError('CREDENTIAL_CORRUPT', { cause: error });
    }
  }

  async #writeEnvelope(envelope: CredentialEnvelope): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const temporaryPath = join(this.#directory, `.credential-${this.#randomId()}.tmp`);
    const targetPath = this.#path(envelope.slot);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      this.#beforePublish?.();
      await this.#publish(temporaryPath, targetPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      if (error instanceof SettingsError) {
        throw error;
      }
      throw new SettingsError('CREDENTIAL_ENCRYPT_FAILED', { cause: error, retryable: true });
    }
  }

  #path(slot: CredentialSlot): string {
    assertSlot(slot);
    return join(this.#directory, SLOT_FILES[slot]);
  }
}

export function credentialBlobPathForTesting(userDataPath: string): string {
  return join(
    resolve(userDataPath),
    ...CREDENTIAL_DIRECTORY.split('/'),
    SLOT_FILES[CREDENTIAL_SLOT],
  );
}
