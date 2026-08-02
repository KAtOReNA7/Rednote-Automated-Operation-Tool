import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  connectDatabase,
  initializeDatabase,
  MIGRATIONS,
  migrationChecksum,
  SqliteLocalApiRepository,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';
import { randomExtensionOrigin, randomRuntimeToken } from './support/local-api-test-utils.js';

const opened: DatabaseSync[] = [];
const KNOWN_MIGRATION_HASHES = [
  '8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907',
  'ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce',
  '11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed',
  'c84c82c50f2170c20154c754d0604319082c6683737624a9c14d3a508315471c',
] as const;

function digest(value = randomRuntimeToken()): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function pair(
  repository: SqliteLocalApiRepository,
  origin = randomExtensionOrigin(),
  id = `client-${randomUUID()}`,
  pairedAt = '2026-07-28T01:00:00.000Z',
) {
  return repository.pairClient({
    clientLabel: '测试客户端',
    extensionOrigin: origin,
    id,
    pairedAt,
    tokenDigest: digest(),
  });
}

afterEach(() => {
  for (const database of opened.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('Issue 011 migration v5', () => {
  it('is consecutive, stable-named, and preserves the frozen v1-v4 checksums', () => {
    const migrationV5 = MIGRATIONS[4];
    if (migrationV5 === undefined) {
      throw new Error('Migration v5 is missing.');
    }
    expect(MIGRATIONS.map(({ version }) => version)).toEqual(
      Array.from({ length: MIGRATIONS.at(-1)?.version ?? 0 }, (_, index) => index + 1),
    );
    expect(migrationV5.name).toBe('local_loopback_api_and_plugin_clients');
    expect(MIGRATIONS.slice(0, 4).map(migrationChecksum)).toEqual(KNOWN_MIGRATION_HASHES);
    expect(migrationChecksum(migrationV5)).toBe(
      '88c29c6160122eea91dc8f3b88c0cd0aafc58f91c3cfd6bcfdd2020209f6d808',
    );
  });

  it('creates strict singleton settings and strict client tables with safe defaults', async () => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    const tables = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'table' AND name IN ('local_api_settings', 'local_api_clients')
         ORDER BY name`,
      )
      .all() as unknown as readonly { readonly name: string; readonly sql: string }[];

    expect(tables).toHaveLength(2);
    expect(tables.every(({ sql }) => /\)\s+STRICT$/u.test(sql))).toBe(true);
    expect(
      database.prepare('SELECT id, enabled, port, revision FROM local_api_settings').get(),
    ).toEqual({ enabled: 0, id: 1, port: 43_119, revision: 0 });
  });

  it.each([0, 1_023, 65_536, 1.5])('rejects invalid persisted port %s', async (port) => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    expect(() =>
      database
        .prepare(
          `UPDATE local_api_settings
             SET port = ?, revision = revision + 1,
                 updated_at = '2026-07-28T01:00:00.000Z'
             WHERE id = 1`,
        )
        .run(port),
    ).toThrow();
  });

  it('enforces expected revision and monotonic settings updates', async () => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    const repository = new SqliteLocalApiRepository(database);
    expect(
      repository.updateSettings({
        enabled: true,
        expectedRevision: 0,
        port: 43_120,
        updatedAt: '2026-07-28T01:00:00.000Z',
      }),
    ).toMatchObject({ enabled: true, port: 43_120, revision: 1 });
    expect(() =>
      repository.updateSettings({
        enabled: false,
        expectedRevision: 0,
        port: 43_120,
        updatedAt: '2026-07-28T01:00:01.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'LOCAL_API_REVISION_CONFLICT' }));
    expect(() =>
      database.prepare('UPDATE local_api_settings SET revision = 8 WHERE id = 1').run(),
    ).toThrow();
  });

  it('accepts only canonical origins and 32-byte BLOB token digests', async () => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    const insert = database.prepare(
      `INSERT INTO local_api_clients(
         id, extension_origin, token_digest, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
    );
    const now = '2026-07-28T01:00:00.000Z';
    expect(() =>
      insert.run('bad-origin-client', 'https://example.test', randomBytes(32), now, now),
    ).toThrow();
    expect(() =>
      insert.run('bad-digest-client', randomExtensionOrigin(), randomBytes(31), now, now),
    ).toThrow();
    expect(() =>
      insert.run('text-digest-client', randomExtensionOrigin(), 'x'.repeat(32), now, now),
    ).toThrow();
  });

  it('rotates one origin atomically and never exposes a digest through client views', async () => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    const repository = new SqliteLocalApiRepository(database);
    const origin = randomExtensionOrigin();
    const first = pair(repository, origin);
    const second = pair(repository, origin, `client-${randomUUID()}`, '2026-07-28T01:00:01.000Z');
    const rows = repository.listClients().filter((client) => client.extensionOrigin === origin);

    expect(first.id).not.toBe(second.id);
    expect(rows.filter(({ status }) => status === 'ACTIVE')).toHaveLength(1);
    expect(rows.filter(({ status }) => status === 'REVOKED')).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/token|digest|authorization/iu);
  });

  it('enforces the eight-active-client limit but permits same-origin rotation', async () => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    const repository = new SqliteLocalApiRepository(database);
    const origins = Array.from({ length: 8 }, () => randomExtensionOrigin());
    origins.forEach((origin) => pair(repository, origin));

    expect(() => pair(repository)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_CLIENT_LIMIT_REACHED' }),
    );
    expect(() =>
      pair(repository, origins[0], `client-${randomUUID()}`, '2026-07-28T01:00:02.000Z'),
    ).not.toThrow();
    expect(repository.listClients().filter(({ status }) => status === 'ACTIVE')).toHaveLength(8);
  });

  it('revokes with optimistic concurrency and cannot un-revoke a client', async () => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    const repository = new SqliteLocalApiRepository(database);
    const client = pair(repository);
    const revoked = repository.revokeClient(client.id, client.revision, '2026-07-28T01:00:01.000Z');
    expect(revoked).toMatchObject({ revision: 1, status: 'REVOKED' });
    expect(() =>
      repository.revokeClient(client.id, client.revision, '2026-07-28T01:00:02.000Z'),
    ).toThrow(expect.objectContaining({ code: 'LOCAL_API_REVISION_CONFLICT' }));
    expect(() =>
      database
        .prepare(
          `UPDATE local_api_clients
           SET revoked_at = NULL, revision = revision + 1,
               updated_at = '2026-07-28T01:00:03.000Z'
           WHERE id = ?`,
        )
        .run(client.id),
    ).toThrow();
  });

  it('throttles last-used writes to at most once per supplied window', async () => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    const repository = new SqliteLocalApiRepository(database);
    const client = pair(repository);
    repository.recordLastUsed(client.id, '2026-07-28T01:01:00.000Z', '2026-07-28T01:00:00.000Z');
    repository.recordLastUsed(client.id, '2026-07-28T01:01:30.000Z', '2026-07-28T01:00:30.000Z');
    expect(repository.listClients().find(({ id }) => id === client.id)).toMatchObject({
      lastUsedAt: '2026-07-28T01:01:00.000Z',
      revision: 1,
    });
  });

  it('writes limited audit records without tokens, digests, origins, bodies, or paths', async () => {
    const { database } = await createInitializedDatabase();
    opened.push(database);
    const repository = new SqliteLocalApiRepository(database);
    const token = randomRuntimeToken();
    const origin = randomExtensionOrigin();
    const client = repository.pairClient({
      clientLabel: '审计测试',
      extensionOrigin: origin,
      id: `client-${randomUUID()}`,
      pairedAt: '2026-07-28T01:00:00.000Z',
      tokenDigest: digest(token),
    });
    repository.revokeClient(client.id, client.revision, '2026-07-28T01:00:01.000Z');
    const audit = JSON.stringify(
      database
        .prepare(
          `SELECT event_type, entity_type, entity_id, actor, before_json, after_json, created_at
           FROM audit_events
           WHERE entity_type = 'local_api_client'
           ORDER BY created_at`,
        )
        .all(),
    );
    expect(audit).toContain('LOCAL_API_CLIENT_PAIRED');
    expect(audit).toContain('LOCAL_API_CLIENT_REVOKED');
    expect(audit).not.toContain(token);
    expect(audit).not.toContain(digest(token).toString('hex'));
    expect(audit).not.toContain(origin);
    expect(audit).not.toMatch(/authorization|header|body|stack|[A-Z]:\\\\/iu);
  });

  it('backs up v4 before v5 and leaves the backup independently readable', async () => {
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 4) });
    const result = await initializeDatabase({
      backupDirectory: databasePath.replace(/content\.sqlite$/u, 'migration backups'),
      databasePath,
    });
    expect(result.appliedVersions).toEqual(MIGRATIONS.slice(4).map(({ version }) => version));
    expect(result.backupPath).not.toBeNull();
    if (result.backupPath === null) {
      throw new Error('Migration backup is missing.');
    }
    expect(existsSync(result.backupPath)).toBe(true);
    const backup = new DatabaseSync(result.backupPath, { readOnly: true });
    opened.push(backup);
    expect(backup.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual({
      version: 4,
    });
    expect(
      backup
        .prepare(
          `SELECT count(*) AS count FROM sqlite_schema
           WHERE name IN ('local_api_settings', 'local_api_clients')`,
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it('rolls a failing v5 back completely without losing v4 data', async () => {
    const migrationV5 = MIGRATIONS[4];
    if (migrationV5 === undefined) {
      throw new Error('Migration v5 is missing.');
    }
    const databasePath = createTemporaryDatabasePath();
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 4) });
    const before = connectDatabase(databasePath);
    before
      .prepare('UPDATE account_profiles SET working_name = ? WHERE id = ?')
      .run('迁移前数据', 'primary');
    before.close();
    const failing = [
      ...MIGRATIONS.slice(0, 4),
      {
        name: 'local_loopback_api_and_plugin_clients',
        sql: `${migrationV5.sql}\nINSERT INTO missing_issue011_table(value) VALUES (1);`,
        version: 5,
      },
    ];
    await expect(initializeDatabase({ databasePath, migrations: failing })).rejects.toMatchObject({
      migrationVersion: 5,
    });
    const after = connectDatabase(databasePath);
    opened.push(after);
    expect(
      after.prepare('SELECT working_name FROM account_profiles WHERE id = ?').get('primary'),
    ).toEqual({ working_name: '迁移前数据' });
    expect(
      after
        .prepare(
          `SELECT count(*) AS count FROM sqlite_schema
           WHERE name IN ('local_api_settings', 'local_api_clients')`,
        )
        .get(),
    ).toEqual({ count: 0 });
  });
});
