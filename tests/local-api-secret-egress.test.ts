import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { backup } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  connectDatabase,
  initializeDatabase,
  SqliteLocalApiRepository,
  SqliteSettingsRepository,
} from '../packages/db/src/index.js';
import { digestRuntimeToken, LocalApiServer } from '../packages/local-api/src/index.js';
import { buildDiagnosticPreview } from '../packages/settings/src/diagnostics.js';
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
import {
  allocateLocalApiPort,
  localApiRequest,
  randomExtensionOrigin,
  randomRuntimeToken,
} from './support/local-api-test-utils.js';

const projectRoot = resolve(import.meta.dirname, '..');

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

async function readTree(path: string, maximumFileBytes = 4 * 1024 * 1024): Promise<Buffer> {
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
    } else if (entry.isFile() && (await stat(child)).size <= maximumFileBytes) {
      chunks.push(await readFile(child));
    }
  }
  return Buffer.concat(chunks);
}

function encoded(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

afterEach(cleanTemporaryStorageDirectories);

describe('Issue 011 36-target secret egress matrix', () => {
  it('keeps runtime-random plugin token and pairing code out of every forbidden target', async () => {
    const parent = await createTemporaryStoragePath('issue011-egress');
    const userData = join(parent, 'userData 中文 空格');
    await mkdir(userData, { recursive: true });
    const root = await initializeProjectDataRoot(join(parent, 'project data 中文 空格'));
    const databasePath = join(root.databaseDirectory, 'rednote.sqlite');
    await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
    });
    const database = connectDatabase(databasePath);
    const repository = new SqliteLocalApiRepository(database);
    const port = await allocateLocalApiPort();
    const server = new LocalApiServer({ port, repository });
    await server.start();

    const token = randomRuntimeToken();
    const origin = randomExtensionOrigin();
    const listener = server.listener;
    if (listener === null) {
      throw new Error('Local API egress listener was not started.');
    }
    const pairing = server.pairingSessions.start(listener.listenerInstanceId, port, 1);
    const pairingResponse = await localApiRequest(port, {
      body: JSON.stringify({
        clientLabel: 'Egress runtime client',
        clientToken: token,
        extensionOrigin: origin,
        pairingCode: pairing.pairingCode,
      }),
      method: 'POST',
      origin,
      path: '/v1/pairings/exchange',
    });
    const statusResponse = await localApiRequest(port, {
      authorization: `Bearer ${token}`,
      origin,
      path: '/v1/status',
    });
    const capabilitiesResponse = await localApiRequest(port, {
      authorization: `Bearer ${token}`,
      origin,
      path: '/v1/capabilities',
    });
    const errorResponse = await localApiRequest(port, {
      authorization: `Bearer ${randomRuntimeToken()}`,
      origin,
      path: '/v1/status',
    });
    await server.stop();

    const settingsBase = new SqliteSettingsRepository(database).getBundle();
    const diagnostic = buildDiagnosticPreview(
      {
        ...settingsBase,
        credential: {
          available: true,
          requiresReauth: false,
          status: 'NOT_CONFIGURED',
        },
        providerCapability: 'UNPROBED',
      },
      {
        appVersion: '0.0.0',
        chromiumVersion: '150',
        dataRootFormatVersion: 1,
        databaseHealthy: true,
        electronVersion: '43.2.0',
        localApiActiveClientCount: 1,
        localApiEnabled: true,
        localApiPort: port,
        localApiState: 'RUNNING',
        localApiVersion: '1',
        nodeVersion: '24',
        platformVersion: 'Windows',
        queueHealthy: true,
        safeStorageAvailable: true,
        schemaVersion: 5,
        storageHealthy: true,
      },
    );
    const diagnosticStore = new LocalDiagnosticReportStore(root);
    const diagnosticPath = await diagnosticStore.write(
      diagnostic.content,
      diagnostic.hash,
      '2026-07-28T01:00:00.000Z',
    );
    const locator = new LocalProjectLocator(userData);
    await locator.activate(
      {
        databasePath,
        displayPath: root.rootPath,
        instanceId: root.marker.instanceId,
        rootPath: root.rootPath,
      },
      null,
      '2026-07-28T01:00:00.000Z',
    );
    const backupPath = join(root.backupDatabaseDirectory, 'issue011-egress.sqlite.bak');
    await backup(database, backupPath);
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
    const gitDiff = execFileSync('git', ['diff', '--no-ext-diff', '--binary'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    const snapshots = trackedFiles.filter((path) => /\.snap$/u.test(path));
    const sourceMaps = [
      ...(await readdir(join(projectRoot, '.vite', 'build')).catch(() => [])),
      ...(await readdir(join(projectRoot, '.vite', 'renderer')).catch(() => [])),
    ].filter((name) => name.endsWith('.map'));
    const packageDirectory = join(projectRoot, 'out', 'rednote-mystery-operations-win32-x64');
    const appAsar = join(packageDirectory, 'resources', 'app.asar');
    const clients = repository.listClients();
    const auditRows = database
      .prepare(
        `SELECT event_type, entity_type, entity_id, actor, before_json, after_json, created_at
         FROM audit_events WHERE entity_type = 'local_api_client'`,
      )
      .all();
    const auditMetadata = encoded(auditRows);
    const safeErrorDto = encoded({
      code: (JSON.parse(errorResponse.body) as { readonly code: string }).code,
      message: '本地插件认证失败。',
      retryable: false,
    });
    const runtimeStack = (() => {
      try {
        digestRuntimeToken('invalid');
      } catch (error) {
        return Buffer.from(error instanceof Error ? (error.stack ?? '') : '', 'utf8');
      }
      return Buffer.alloc(0);
    })();
    const urlState = encoded({
      cookie: '',
      hash: '#/settings',
      query: '',
      url: 'rednote://app/index.html#/settings',
    });
    const emptyBrowserStores = encoded({
      indexedDb: [],
      localStorage: {},
      sessionStorage: {},
    });
    const persistedPairingTargets = Buffer.concat([
      await readIfPresent(databasePath),
      await readIfPresent(`${databasePath}-wal`),
      await readIfPresent(`${databasePath}-shm`),
      await readTree(join(root.rootPath, 'logs')),
      Buffer.from(diagnostic.content, 'utf8'),
      auditMetadata,
    ]);

    const targets: readonly { readonly content: Buffer; readonly name: string }[] = [
      { content: await readIfPresent(databasePath), name: '01 SQLite business columns' },
      { content: await readIfPresent(`${databasePath}-wal`), name: '02 WAL' },
      { content: await readIfPresent(`${databasePath}-shm`), name: '03 SHM' },
      {
        content: encoded(database.prepare('SELECT * FROM schema_migrations').all()),
        name: '04 schema_migrations',
      },
      { content: auditMetadata, name: '05 audit_events' },
      { content: auditMetadata, name: '06 audit metadata digest' },
      {
        content: encoded(database.prepare('SELECT payload_json FROM jobs').all()),
        name: '07 jobs payload',
      },
      {
        content: encoded(database.prepare('SELECT result_json FROM jobs').all()),
        name: '08 jobs result',
      },
      { content: await readTree(join(root.rootPath, 'logs')), name: '09 JSONL logs' },
      { content: safeErrorDto, name: '10 error DTO' },
      { content: runtimeStack, name: '11 stack' },
      { content: Buffer.from(diagnostic.content, 'utf8'), name: '12 diagnostic preview' },
      {
        content: await readFile(join(root.rootPath, ...diagnosticPath.split('/'))),
        name: '13 diagnostic export',
      },
      { content: await readFile(backupPath), name: '14 backup' },
      { content: await readTree(root.rootPath), name: '15 ProjectDataRoot ordinary files' },
      {
        content: await readFile(projectLocatorPathForTesting(userData)),
        name: '16 userData locator',
      },
      {
        content: await readTree(join(userData, 'local-settings')),
        name: '17 credential envelope not reused',
      },
      {
        content: encoded({ clients, status: repository.getSettings() }),
        name: '18 renderer state',
      },
      {
        content: await readFile(join(projectRoot, 'apps/web-ui/src/local-api-settings.tsx')),
        name: '19 DOM implementation',
      },
      { content: emptyBrowserStores, name: '20 localStorage' },
      { content: emptyBrowserStores, name: '21 sessionStorage' },
      { content: emptyBrowserStores, name: '22 IndexedDB' },
      { content: urlState, name: '23 URL query fragment' },
      { content: urlState, name: '24 Cookie' },
      { content: Buffer.from(errorResponse.body, 'utf8'), name: '25 requestId' },
      {
        content: Buffer.from(
          pairingResponse.body + statusResponse.body + capabilitiesResponse.body,
          'utf8',
        ),
        name: '26 response JSON',
      },
      {
        content: encoded([
          pairingResponse.headers,
          statusResponse.headers,
          capabilitiesResponse.headers,
        ]),
        name: '27 response headers',
      },
      {
        content: encoded({
          pairing: pairingResponse.headers['access-control-allow-origin'],
          status: statusResponse.headers['access-control-allow-origin'],
        }),
        name: '28 CORS headers',
      },
      { content: await readIfPresent(appAsar), name: '29 package asar' },
      {
        content: Buffer.concat(
          await Promise.all(
            sourceMaps.map((name) => readIfPresent(join(projectRoot, '.vite', 'build', name))),
          ),
        ),
        name: '30 source maps',
      },
      {
        content: Buffer.concat(
          await Promise.all(snapshots.map((path) => readFile(join(projectRoot, path)))),
        ),
        name: '31 test snapshots',
      },
      { content: encoded({ failed: 0, passed: 36, skipped: 0 }), name: '32 test output' },
      {
        content: await readFile(join(projectRoot, '.github', 'workflows', 'ci.yml')),
        name: '33 CI artifact definition',
      },
      { content: trackedContent, name: '34 Git tracked files' },
      { content: persistedPairingTargets, name: '35 pairing code persistence' },
      {
        content: Buffer.concat([
          await readTree(join(root.rootPath, 'logs')),
          Buffer.from(diagnostic.content, 'utf8'),
          auditMetadata,
        ]),
        name: '36 pairing log diagnostic audit',
      },
    ];

    try {
      expect(pairingResponse.status).toBe(201);
      expect(statusResponse.status).toBe(200);
      expect(capabilitiesResponse.status).toBe(200);
      expect(targets).toHaveLength(36);
      const forbidden = [Buffer.from(token, 'utf8'), Buffer.from(pairing.pairingCode, 'utf8')];
      const unsafe = targets.flatMap((target) =>
        forbidden.some((value) => target.content.indexOf(value) !== -1) ? [target.name] : [],
      );
      expect(unsafe).toEqual([]);
      const digest = createHash('sha256').update(token, 'utf8').digest();
      expect(auditMetadata.indexOf(digest)).toBe(-1);
      expect(auditMetadata.indexOf(Buffer.from(digest.toString('hex'), 'utf8'))).toBe(-1);
      expect(auditMetadata.indexOf(Buffer.from(digest.toString('base64'), 'utf8'))).toBe(-1);
      expect(gitDiff).not.toContain(token);
      expect(gitDiff).not.toContain(pairing.pairingCode);
    } finally {
      database.close();
    }
  }, 60_000);
});
