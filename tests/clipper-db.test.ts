import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  SqliteBrowserClipRepository,
  SqliteLocalApiRepository,
  migrationChecksum,
} from '../packages/db/src/index.js';
import type { BrowserClipContractError } from '../packages/shared/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { browserClipFixture } from './clipper-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 017 migration v10 and browser clip repository', () => {
  it('appends one frozen migration without changing v1-v9', () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    const migration = MIGRATIONS.at(9);
    expect(migration).toMatchObject({
      name: 'browser_clipper_samples',
      version: 10,
    });
    if (migration === undefined) throw new Error('Migration v10 is required.');
    expect(migrationChecksum(migration)).toMatch(/^[0-9a-f]{64}$/u);
    expect(migration.sql).toContain('CREATE TABLE clip_ingest_receipts');
    expect(migration.sql).toContain('STRICT, WITHOUT ROWID');
  });

  it('persists one idempotent clip and one frozen lead-only candidate with zero external calls', async () => {
    const { database } = await createInitializedDatabase('Issue 017 中文 空格');
    try {
      const clientId = 'clipper-client-1';
      new SqliteLocalApiRepository(database).pairClient({
        clientLabel: 'Chrome 真实侧载',
        extensionOrigin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        id: clientId,
        pairedAt: '2026-07-28T08:00:00.000Z',
        tokenDigest: Buffer.alloc(32, 7),
      });
      const repository = new SqliteBrowserClipRepository(database, () => 'fixed-id');
      const clip = browserClipFixture();
      const payloadHash = createHash('sha256').update(JSON.stringify(clip)).digest('hex');
      const input = {
        clientId,
        clip,
        extensionOrigin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        now: '2026-07-28T08:01:00.000Z',
        payloadHash,
        screenshot: null,
      } as const;

      const first = await repository.ingest(input);
      const replay = await repository.ingest(input);
      expect(replay).toEqual(first);
      expect(first.status).toBe('SUCCEEDED');
      expect(repository.listClips()).toHaveLength(1);

      const run = database
        .prepare(
          `SELECT provider_kind, provider_mode, external_request_count, cost_state
           FROM search_runs WHERE id = ?`,
        )
        .get(`clip-search-${clip.captureId}`);
      expect(run).toEqual({
        cost_state: 'NOT_INCURRED',
        external_request_count: 0,
        provider_kind: 'BROWSER_CLIP',
        provider_mode: 'PASSIVE_LOCAL',
      });
      const candidateId = first.candidateId;
      expect(candidateId).toMatch(/^[0-9a-f]{64}$/u);
      if (candidateId === null) throw new Error('A succeeded clip must create one candidate.');
      const candidate = database
        .prepare(
          `SELECT preview_text, preview_kind, evidence_eligibility, fetch_state,
                  truth_status, fact_status, source_metadata_kind
           FROM search_result_candidates WHERE id = ?`,
        )
        .get(candidateId);
      expect(candidate).toEqual({
        evidence_eligibility: 'LEAD_ONLY',
        fact_status: 'NOT_A_FACT',
        fetch_state: 'NOT_FETCHED',
        preview_kind: 'NONE',
        preview_text: null,
        source_metadata_kind: 'BROWSER_CLIP_INPUT',
        truth_status: 'UNVERIFIED',
      });
      expect(database.prepare('SELECT count(*) AS count FROM jobs').get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('rejects a reused origin/capture identifier with different content', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const origin = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      new SqliteLocalApiRepository(database).pairClient({
        clientLabel: null,
        extensionOrigin: origin,
        id: 'clipper-client-2',
        pairedAt: '2026-07-28T08:00:00.000Z',
        tokenDigest: Buffer.alloc(32, 8),
      });
      const repository = new SqliteBrowserClipRepository(database);
      const clip = browserClipFixture();
      await repository.ingest({
        clientId: 'clipper-client-2',
        clip,
        extensionOrigin: origin,
        now: '2026-07-28T08:01:00.000Z',
        payloadHash: 'a'.repeat(64),
        screenshot: null,
      });
      await expect(
        repository.ingest({
          clientId: 'clipper-client-2',
          clip,
          extensionOrigin: origin,
          now: '2026-07-28T08:02:00.000Z',
          payloadHash: 'b'.repeat(64),
          screenshot: null,
        }),
      ).rejects.toMatchObject({
        code: 'CLIPPER_CAPTURE_CONFLICT',
      } satisfies Partial<BrowserClipContractError>);
    } finally {
      database.close();
    }
  });
});
