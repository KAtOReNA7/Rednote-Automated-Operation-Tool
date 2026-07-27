import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  credentialBlobPathForTesting,
  ElectronCredentialStore,
} from '../apps/desktop/src/credential-store.js';
import type { AsyncSafeStorage } from '../apps/desktop/src/credential-store.js';
import { CREDENTIAL_SLOT } from '../packages/settings/src/index.js';
import { runtimeUnusableValue, sameRuntimeValue } from './support/settings-test-utils.js';

const temporaryDirectories: string[] = [];

class FakeAsyncSafeStorage implements AsyncSafeStorage {
  public available = true;
  public decryptFails = false;
  public shouldReEncrypt = false;
  #key = 40;

  public async isAsyncEncryptionAvailable(): Promise<boolean> {
    return this.available;
  }

  public async encryptStringAsync(plaintext: string): Promise<Buffer> {
    this.#key += 1;
    const bytes = Buffer.from(plaintext, 'utf8');
    return Buffer.concat([
      Buffer.from([this.#key]),
      Buffer.from(bytes.map((value) => value ^ this.#key)),
    ]);
  }

  public async decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }> {
    if (this.decryptFails || encrypted.length < 2 || encrypted[0] === undefined) {
      throw new Error('synthetic decrypt failure');
    }
    const key = encrypted[0];
    return {
      result: Buffer.from(encrypted.subarray(1).map((value) => value ^ key)).toString('utf8'),
      shouldReEncrypt: this.shouldReEncrypt,
    };
  }
}

async function context() {
  const userData = await mkdtemp(join(tmpdir(), 'rednote-settings-credential-'));
  temporaryDirectories.push(userData);
  const safeStorage = new FakeAsyncSafeStorage();
  const store = new ElectronCredentialStore(userData, safeStorage, {
    now: () => new Date('2026-07-27T12:00:00.000Z'),
  });
  return { safeStorage, store, userData };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('main-process local credential store', () => {
  it('reports NOT_CONFIGURED without creating a blob', async () => {
    const test = await context();
    await expect(test.store.getStatus(CREDENTIAL_SLOT)).resolves.toEqual({
      available: true,
      requiresReauth: false,
      status: 'NOT_CONFIGURED',
    });
  });

  it('encrypts, resolves internally, and exposes only status metadata', async () => {
    const test = await context();
    const runtimeValue = runtimeUnusableValue();
    const status = await test.store.set(CREDENTIAL_SLOT, runtimeValue);
    const resolved = await test.store.resolveForProvider(CREDENTIAL_SLOT);
    const blob = await readFile(credentialBlobPathForTesting(test.userData), 'utf8');
    const envelope = JSON.parse(blob) as Record<string, unknown>;

    expect(status).toEqual({
      available: true,
      requiresReauth: false,
      status: 'CONFIGURED',
      updatedAt: '2026-07-27T12:00:00.000Z',
    });
    expect(sameRuntimeValue(resolved, runtimeValue)).toBe(true);
    expect(blob.includes(runtimeValue)).toBe(false);
    expect(Object.keys(envelope).sort()).toEqual([
      'ciphertext',
      'format',
      'slot',
      'updatedAt',
      'version',
    ]);
    expect(JSON.stringify(status)).not.toMatch(
      /cipher|fingerprint|hash|last4|length|path|prefix|value/iu,
    );
  });

  it('rejects unavailable protection without a plaintext fallback', async () => {
    const test = await context();
    test.safeStorage.available = false;
    await expect(test.store.set(CREDENTIAL_SLOT, runtimeUnusableValue())).rejects.toMatchObject({
      code: 'CREDENTIAL_STORE_UNAVAILABLE',
    });
    await expect(test.store.getStatus(CREDENTIAL_SLOT)).resolves.toMatchObject({
      available: false,
      status: 'NOT_CONFIGURED',
    });
  });

  it('preserves the old encrypted value when replacement publication fails', async () => {
    const test = await context();
    const first = runtimeUnusableValue();
    await test.store.set(CREDENTIAL_SLOT, first);
    const beforeHash = createHash('sha256')
      .update(await readFile(credentialBlobPathForTesting(test.userData)))
      .digest('hex');
    const failing = new ElectronCredentialStore(test.userData, test.safeStorage, {
      beforePublish: () => {
        throw new Error('synthetic publish failure');
      },
    });

    await expect(failing.set(CREDENTIAL_SLOT, runtimeUnusableValue())).rejects.toMatchObject({
      code: 'CREDENTIAL_ENCRYPT_FAILED',
    });
    const afterHash = createHash('sha256')
      .update(await readFile(credentialBlobPathForTesting(test.userData)))
      .digest('hex');
    const resolved = await test.store.resolveForProvider(CREDENTIAL_SLOT);
    expect(afterHash).toBe(beforeHash);
    expect(sameRuntimeValue(resolved, first)).toBe(true);
  });

  it('returns CORRUPT for an invalid envelope and REAUTH_REQUIRED for decrypt failure', async () => {
    const test = await context();
    await test.store.set(CREDENTIAL_SLOT, runtimeUnusableValue());
    await writeFile(credentialBlobPathForTesting(test.userData), '{"bad":true}\n', 'utf8');
    await expect(test.store.getStatus(CREDENTIAL_SLOT)).resolves.toMatchObject({
      requiresReauth: true,
      status: 'CORRUPT',
    });

    await test.store.set(CREDENTIAL_SLOT, runtimeUnusableValue());
    test.safeStorage.decryptFails = true;
    await expect(test.store.getStatus(CREDENTIAL_SLOT)).resolves.toMatchObject({
      requiresReauth: true,
      status: 'REAUTH_REQUIRED',
    });
  });

  it('handles shouldReEncrypt and leaves the old blob intact if re-encryption fails', async () => {
    const test = await context();
    const runtimeValue = runtimeUnusableValue();
    await test.store.set(CREDENTIAL_SLOT, runtimeValue);
    test.safeStorage.shouldReEncrypt = true;
    const before = await readFile(credentialBlobPathForTesting(test.userData));
    const failing = new ElectronCredentialStore(test.userData, test.safeStorage, {
      beforePublish: () => {
        throw new Error('synthetic re-encrypt failure');
      },
    });

    const resolved = await failing.resolveForProvider(CREDENTIAL_SLOT);
    const after = await readFile(credentialBlobPathForTesting(test.userData));
    expect(sameRuntimeValue(resolved, runtimeValue)).toBe(true);
    expect(after).toEqual(before);
  });

  it('clears only the fixed slot and requires the fixed slot type at runtime', async () => {
    const test = await context();
    await test.store.set(CREDENTIAL_SLOT, runtimeUnusableValue());
    await expect(test.store.clear(CREDENTIAL_SLOT)).resolves.toMatchObject({
      status: 'NOT_CONFIGURED',
    });
    await expect(
      test.store.set('ARBITRARY' as never, runtimeUnusableValue()),
    ).rejects.toMatchObject({
      code: 'SETTINGS_INVALID',
    });
  });
});
