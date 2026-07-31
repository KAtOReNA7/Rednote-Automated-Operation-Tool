import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteFactMappingRepository } from '../packages/db/src/index.js';
import {
  FACT_MAPPING_LIMITS,
  buildDeterministicFactMapping,
  createDraftTextLocator,
  materializeDraftPublicArtifacts,
} from '../packages/quality/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { completeCopyPayload } from './support/copy-fixtures.js';
import {
  FACT_MAPPING_NOW,
  candidateRecord,
  candidateSet,
  materializedArtifact,
  textClaim,
} from './support/fact-mapping-fixtures.js';

afterEach(cleanTemporaryDatabases);

function cloneRow(
  database: DatabaseSync,
  table: string,
  whereColumn: string,
  whereValue: string,
  overrides: Readonly<Record<string, string | number | null>>,
): void {
  const columns = (
    database.prepare(`PRAGMA table_info("${table}")`).all() as unknown as readonly {
      readonly name: string;
    }[]
  ).map(({ name }) => name);
  const values: (string | number | null)[] = [];
  const select = columns.map((column) => {
    if (!(column in overrides)) return `"${column}"`;
    values.push(overrides[column] ?? null);
    return '?';
  });
  database
    .prepare(
      `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')})
       SELECT ${select.join(', ')} FROM "${table}" WHERE "${whereColumn}" = ?`,
    )
    .run(...values, whereValue);
}

describe('M3 Issue 026 capacity, pagination and determinism', () => {
  it('paginates 1,000 READY Draft summaries with a bounded stable query', async () => {
    const { database } = await createInitializedDatabase('fact mapping 1000 drafts');
    try {
      const fixture = (await import('./support/copy-fixtures.js')).createReadyCopyRepositoryFixture(
        database,
        'fact-map-capacity',
      );
      const baseDraftId = fixture.created.draftId;
      const baseVersionId = (
        database
          .prepare('SELECT current_version_id FROM content_draft_heads WHERE draft_id = ?')
          .get(baseDraftId) as { readonly current_version_id: string }
      ).current_version_id;
      database.exec('BEGIN IMMEDIATE');
      try {
        for (let index = 1; index < 1_000; index += 1) {
          const suffix = String(index).padStart(4, '0');
          const draftId = `capacity-draft-${suffix}`;
          const versionId = `capacity-version-${suffix}`;
          cloneRow(database, 'drafts', 'id', baseDraftId, {
            id: draftId,
            version: index + 1,
          });
          cloneRow(database, 'content_draft_versions', 'id', baseVersionId, {
            draft_id: draftId,
            id: versionId,
            previous_version_id: null,
            version_number: 1,
          });
          cloneRow(database, 'content_draft_heads', 'draft_id', baseDraftId, {
            current_version_id: versionId,
            draft_id: draftId,
          });
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      const repository = new SqliteFactMappingRepository(database);
      const first = repository.list({ limit: 100, offset: 0, status: 'UNCHECKED' });
      const last = repository.list({ limit: 100, offset: 900, status: 'UNCHECKED' });
      expect(first).toMatchObject({ limit: 100, offset: 0, total: 1_000 });
      expect(last).toMatchObject({ limit: 100, offset: 900, total: 1_000 });
      expect(first.items).toHaveLength(100);
      expect(last.items).toHaveLength(100);
      expect(new Set([...first.items, ...last.items].map(({ draftId }) => draftId)).size).toBe(200);
      expect(() => repository.list({ limit: 101, offset: 0 })).toThrow(
        /FACT_MAPPING_INVALID_CONTRACT/u,
      );
    } finally {
      database.close();
    }
  });

  it('accepts a near-limit artifact and rejects a single-artifact overflow', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const nearLimit = {
      ...payload,
      blocks: payload.blocks.map((block, index) =>
        index === 0
          ? { ...block, text: '测'.repeat(FACT_MAPPING_LIMITS.artifactCodePoints) }
          : block,
      ),
    };
    const artifacts = materializeDraftPublicArtifacts({
      current: true,
      draftId: 'draft-near-limit',
      draftStatus: 'READY_FOR_QUALITY_PIPELINE',
      draftVersionId: 'draft-version-near-limit',
      payload: nearLimit,
      structuralValid: true,
    });
    expect(
      artifacts.some(
        ({ artifact }) => artifact.codePointLength === FACT_MAPPING_LIMITS.artifactCodePoints,
      ),
    ).toBe(true);
    expect(() =>
      materializeDraftPublicArtifacts({
        current: true,
        draftId: 'draft-over-limit',
        draftStatus: 'READY_FOR_QUALITY_PIPELINE',
        draftVersionId: 'draft-version-over-limit',
        payload: {
          ...nearLimit,
          blocks: nearLimit.blocks.map((block, index) =>
            index === 0 ? { ...block, text: `${block.text}超` } : block,
          ),
        },
        structuralValid: true,
      }),
    ).toThrow(/FACT_MAPPING_INVALID_CONTRACT/u);
  });

  it('bounds statements, locators and model candidates at frozen V1 limits', () => {
    expect(FACT_MAPPING_LIMITS).toMatchObject({
      artifacts: 64,
      candidateClaims: 256,
      evidencePerClaim: 64,
      maxPageSize: 100,
      maxRequests: 1,
      modelCandidateStatements: 512,
      sourceRevisions: 512,
      statements: 512,
    });
    const artifact = materializedArtifact('甲'.repeat(100));
    expect(createDraftTextLocator(artifact, 0, 100)).toMatchObject({
      endCodePoint: 100,
      startCodePoint: 0,
    });
    expect(() => createDraftTextLocator(artifact, 0, 101)).toThrow(/FACT_MAPPING_INVALID_LOCATOR/u);
  });

  it('keeps large cross-work ordering and hashes stable across insertion order', () => {
    const claims = Array.from({ length: 40 }, (_, index) =>
      textClaim(
        `large-claim-${String(index).padStart(2, '0')}`,
        'canonical_title',
        `作品${String(index).padStart(2, '0')}`,
        'TEXT',
        `work-${String(index).padStart(2, '0')}`,
      ),
    );
    const records = claims.map((claim) => candidateRecord(claim));
    const workIds = claims.map(({ subject }) => subject.id);
    const forward = candidateSet(records, { workIds });
    const reverse = candidateSet([...records].reverse(), { workIds: [...workIds].reverse() });
    expect(forward).toEqual(reverse);
    const artifacts = claims.map((claim, index) =>
      materializedArtifact(`《${String(claim.value)}》`, {
        artifactId: `large-artifact-${String(index).padStart(2, '0')}`,
        order: index,
        workIds: [claim.subject.id],
      }),
    );
    const first = buildDeterministicFactMapping({
      artifacts,
      candidates: forward,
      createdAt: FACT_MAPPING_NOW,
    });
    const second = buildDeterministicFactMapping({
      artifacts: [...artifacts],
      candidates: reverse,
      createdAt: FACT_MAPPING_NOW,
    });
    expect(first.inputHash).toBe(second.inputHash);
    expect(first.rollup).toEqual(second.rollup);
    expect(first.rollup.status).toBe('PASS');
    expect(first.statements.map(({ result }) => result.mapping?.claimId)).toEqual(
      second.statements.map(({ result }) => result.mapping?.claimId),
    );
  });
});
