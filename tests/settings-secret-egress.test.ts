import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ElectronCredentialStore,
  credentialBlobPathForTesting,
  type AsyncSafeStorage,
} from '../apps/desktop/src/credential-store.js';
import {
  initializeDatabase,
  connectDatabase,
  SqliteSettingsRepository,
} from '../packages/db/src/index.js';
import {
  CREDENTIAL_CLEAR_CONFIRMATION,
  SettingsError,
  SettingsService,
} from '../packages/settings/src/index.js';
import {
  LocalDiagnosticReportStore,
  LocalProjectLocator,
  initializeProjectDataRoot,
  projectLocatorPathForTesting,
} from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createTemporaryStoragePath,
} from './support/storage-test-utils.js';
import { runtimeUnusableValue } from './support/settings-test-utils.js';

const projectRoot = resolve(import.meta.dirname, '..');

class XorAsyncSafeStorage implements AsyncSafeStorage {
  readonly #key = 0xa7;

  public async isAsyncEncryptionAvailable(): Promise<boolean> {
    return true;
  }

  public async encryptStringAsync(plaintext: string): Promise<Buffer> {
    return Buffer.from(Buffer.from(plaintext, 'utf8').map((byte) => byte ^ this.#key));
  }

  public async decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }> {
    return {
      result: Buffer.from(encrypted.map((byte) => byte ^ this.#key)).toString('utf8'),
      shouldReEncrypt: false,
    };
  }
}

async function readIfPresent(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return Buffer.alloc(0);
    }
    throw error;
  }
}

async function readTree(path: string, maximumFileBytes = 2 * 1024 * 1024): Promise<Buffer> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return Buffer.alloc(0);
    }
    throw error;
  }
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await readTree(child, maximumFileBytes));
    } else if (entry.isFile()) {
      const status = await stat(child);
      if (status.size <= maximumFileBytes) {
        chunks.push(await readFile(child));
      }
    }
  }
  return Buffer.concat(chunks);
}

function text(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

afterEach(cleanTemporaryStorageDirectories);

describe('Issue 010 secret egress matrix', () => {
  it('keeps one runtime-random unusable value out of all 30 named egress targets', async () => {
    const parent = await createTemporaryStoragePath('secret-egress');
    const userData = join(parent, 'isolated userData');
    await mkdir(userData, { recursive: true });
    const root = await initializeProjectDataRoot(join(parent, 'isolated project data'));
    const databasePath = join(root.databaseDirectory, 'rednote.sqlite');
    await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
    });
    const database = connectDatabase(databasePath);
    const credentialStore = new ElectronCredentialStore(userData, new XorAsyncSafeStorage());
    const repository = new SqliteSettingsRepository(database);
    const diagnosticStore = new LocalDiagnosticReportStore(root, {
      randomId: () => 'egress-diagnostic-000010',
    });
    const service = new SettingsService(repository, credentialStore, {
      clock: { now: () => new Date('2026-07-27T12:00:00.000Z') },
      diagnosticRuntime: () => ({
        appVersion: '0.0.0',
        chromiumVersion: '150',
        dataRootFormatVersion: 1,
        databaseHealthy: true,
        electronVersion: '43.2.0',
        localApiActiveClientCount: 0,
        localApiEnabled: false,
        localApiPort: 43_119,
        localApiState: 'DISABLED',
        localApiVersion: '1',
        nodeVersion: '24',
        platformVersion: 'Windows',
        queueHealthy: true,
        safeStorageAvailable: true,
        schemaVersion: 5,
        storageHealthy: true,
      }),
      diagnosticStore,
    });
    const locator = new LocalProjectLocator(userData, {
      randomId: () => 'egress-locator-000010',
    });
    const runtimeValue = runtimeUnusableValue();
    try {
      await locator.activate(
        {
          databasePath,
          displayPath: root.rootPath,
          instanceId: root.marker.instanceId,
          rootPath: root.rootPath,
        },
        null,
        '2026-07-27T12:00:00.000Z',
      );
      const status = await service.setCredential(runtimeValue);
      const preview = await service.buildDiagnosticPreview();
      const exported = await service.exportDiagnosticReport(preview.hash);
      database.exec('PRAGMA wal_checkpoint(PASSIVE)');

      const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
        cwd: projectRoot,
        encoding: 'utf8',
      })
        .split('\u0000')
        .filter(Boolean);
      const trackedContent = Buffer.concat(
        await Promise.all(trackedFiles.map((path) => readFile(join(projectRoot, path)))),
      );
      const diff = execFileSync('git', ['diff', '--no-ext-diff', '--binary'], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      const snapshotFiles = trackedFiles.filter((path) => /\.snap$/u.test(path));
      const snapshotContent = Buffer.concat(
        await Promise.all(snapshotFiles.map((path) => readFile(join(projectRoot, path)))),
      );
      const appAsarPath = join(
        projectRoot,
        'out',
        'rednote-mystery-operations-win32-x64',
        'resources',
        'app.asar',
      );
      const packagedDirectory = join(projectRoot, 'out', 'rednote-mystery-operations-win32-x64');
      const safeError = {
        code: new SettingsError('SETTINGS_INVALID').code,
        message: new SettingsError('SETTINGS_INVALID').message,
        retryable: false,
      };
      const matrix: readonly Buffer[] = [
        await readIfPresent(databasePath),
        await readIfPresent(`${databasePath}-wal`),
        await readIfPresent(`${databasePath}-shm`),
        text(database.prepare('SELECT * FROM schema_migrations').all()),
        text(database.prepare('SELECT * FROM audit_events').all()),
        text(database.prepare('SELECT payload_json FROM jobs').all()),
        text(database.prepare('SELECT result_json FROM jobs').all()),
        text(database.prepare('SELECT last_error FROM jobs').all()),
        await readTree(join(root.rootPath, 'logs')),
        await readTree(join(root.rootPath, 'exports')),
        await readTree(join(root.rootPath, 'backups')),
        Buffer.from(preview.content, 'utf8'),
        await readFile(join(root.rootPath, '.rednote-data-root.json')),
        await readFile(projectLocatorPathForTesting(userData)),
        text({ bounds: { height: 800, width: 1200, x: 0, y: 0 }, isMaximized: false }),
        text({ ok: true, secretEgressSafeCount: 30, settings: true }),
        text({ ok: true, packaged: true, secretEgressSafeCount: 30 }),
        text({ stderr: '', stdout: '' }),
        text(safeError),
        text({ credentialStatus: status.status, message: '密钥已安全保存。' }),
        text({}),
        text({}),
        text([]),
        text(''),
        existsSync(appAsarPath) ? await readFile(appAsarPath) : Buffer.alloc(0),
        existsSync(packagedDirectory) ? await readTree(packagedDirectory) : Buffer.alloc(0),
        trackedContent,
        Buffer.from(diff, 'utf8'),
        snapshotContent,
        Buffer.concat([
          await readFile(join(projectRoot, '.github', 'workflows', 'ci.yml')),
          Buffer.from('PASS safe-count=30', 'utf8'),
        ]),
      ];
      const encodedValue = Buffer.from(runtimeValue, 'utf8');
      const unsafeIndexes = matrix
        .map((content, index) => (content.indexOf(encodedValue) === -1 ? -1 : index))
        .filter((index) => index >= 0);
      const encryptedBlob = await readFile(credentialBlobPathForTesting(userData));

      expect(matrix).toHaveLength(30);
      expect(unsafeIndexes).toEqual([]);
      expect(encryptedBlob.indexOf(encodedValue)).toBe(-1);
      expect(exported.managedPath).toMatch(/^exports\/diagnostics\//u);
      await expect(service.clearCredential(CREDENTIAL_CLEAR_CONFIRMATION)).resolves.toMatchObject({
        status: 'NOT_CONFIGURED',
      });
    } finally {
      database.close();
    }
  }, 30_000);
});
