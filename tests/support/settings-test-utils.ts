import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  type CredentialSlot,
  type CredentialStatusView,
  type CredentialStore,
  SettingsError,
} from '../../packages/settings/src/index.js';
import {
  SqliteSettingsRepository,
  connectDatabase,
  initializeDatabase,
} from '../../packages/db/src/index.js';
import { createTemporaryDatabasePath } from './database-test-utils.js';

export function runtimeUnusableValue(): string {
  return `unusable-local-fixture-${randomBytes(48).toString('base64url')}`;
}

export function sameRuntimeValue(first: string, second: string): boolean {
  const left = createHash('sha256').update(first).digest();
  const right = createHash('sha256').update(second).digest();
  return timingSafeEqual(left, right);
}

export class FakeCredentialStore implements CredentialStore {
  public available = true;
  public corrupt = false;
  public reauth = false;
  #value: string | null = null;

  public async clear(slot: CredentialSlot): Promise<CredentialStatusView> {
    void slot;
    this.#value = null;
    return this.getStatus(slot);
  }

  public async getStatus(slot: CredentialSlot): Promise<CredentialStatusView> {
    void slot;
    if (!this.available) {
      return { available: false, requiresReauth: false, status: 'UNAVAILABLE' };
    }
    if (this.corrupt) {
      return { available: true, requiresReauth: true, status: 'CORRUPT' };
    }
    if (this.reauth) {
      return { available: true, requiresReauth: true, status: 'REAUTH_REQUIRED' };
    }
    return {
      available: true,
      requiresReauth: false,
      status: this.#value === null ? 'NOT_CONFIGURED' : 'CONFIGURED',
    };
  }

  public async resolveForProvider(slot: CredentialSlot): Promise<string> {
    void slot;
    if (this.#value === null) {
      throw new SettingsError('CREDENTIAL_NOT_CONFIGURED');
    }
    return this.#value;
  }

  public async set(slot: CredentialSlot, plaintext: string): Promise<CredentialStatusView> {
    void slot;
    if (!this.available) {
      throw new SettingsError('CREDENTIAL_STORE_UNAVAILABLE');
    }
    this.#value = plaintext;
    return { available: true, requiresReauth: false, status: 'CONFIGURED' };
  }
}

export async function createSettingsDatabase(): Promise<{
  readonly database: DatabaseSync;
  readonly repository: SqliteSettingsRepository;
}> {
  const databasePath = createTemporaryDatabasePath('settings database 中文');
  await initializeDatabase({ databasePath });
  const database = connectDatabase(databasePath);
  return { database, repository: new SqliteSettingsRepository(database) };
}
