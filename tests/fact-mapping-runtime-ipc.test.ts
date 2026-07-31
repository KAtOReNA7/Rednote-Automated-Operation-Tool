import { afterEach, describe, expect, it } from 'vitest';

import { DesktopFactMappingRuntime } from '../apps/desktop/src/fact-mapping-runtime.js';
import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import { SqliteFactMappingRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { createReadyCopyRepositoryFixture } from './support/copy-fixtures.js';

const RENDERER = 'rednote://app/index.html';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 026 desktop runtime and exact IPC', () => {
  it('binds a one-use start confirmation to sender and window before enqueue', async () => {
    const { database } = await createInitializedDatabase('fact mapping runtime start');
    const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-runtime-start');
    const runtime = new DesktopFactMappingRuntime(database, {
      clock: () => new Date('2026-07-31T03:20:00.000Z'),
    });
    try {
      const wrong = runtime.preview(
        {
          draftId: fixture.created.draftId,
          kind: 'START',
          mode: 'LOCAL_MANUAL',
        },
        10,
        20,
      );
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_FACT_MAPPING_ACTION',
            executionId: 'runtime-start-wrong',
            kind: 'START',
            previewHash: wrong.previewHash,
            token: wrong.token,
          },
          11,
          20,
        ),
      ).toThrow(/FACT_MAPPING_CONFIRMATION_INVALID/u);

      const preview = runtime.preview(
        {
          draftId: fixture.created.draftId,
          kind: 'START',
          mode: 'LOCAL_MANUAL',
        },
        10,
        20,
      );
      expect(preview.preview).toMatchObject({
        kind: 'START',
        plan: {
          maximumModelRequests: 0,
          mode: 'LOCAL_MANUAL',
        },
      });
      const result = runtime.confirm(
        {
          confirmation: 'APPLY_FACT_MAPPING_ACTION',
          executionId: 'runtime-start',
          kind: 'START',
          previewHash: preview.previewHash,
          token: preview.token,
        },
        10,
        20,
      );
      expect(result).toMatchObject({
        enqueueRequired: true,
        kind: 'START',
        run: { status: 'QUEUED' },
      });
      expect(database.prepare('SELECT count(*) AS count FROM jobs').get()).toEqual({
        count: 1,
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_FACT_MAPPING_ACTION',
            executionId: 'runtime-start',
            kind: 'START',
            previewHash: preview.previewHash,
            token: preview.token,
          },
          10,
          20,
        ),
      ).toThrow(/FACT_MAPPING_CONFIRMATION_INVALID/u);
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('shows model readiness and blocks UNKNOWN before any request or model run', async () => {
    const { database } = await createInitializedDatabase('fact mapping runtime readiness');
    const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-runtime-readiness');
    const runtime = new DesktopFactMappingRuntime(database, {
      budgetState: () => 'AVAILABLE',
      cacheState: () => 'MISS',
      capabilityState: () => 'UNKNOWN',
      clock: () => new Date('2026-07-31T03:21:00.000Z'),
      credentialState: () => 'MISSING',
    });
    try {
      const preview = runtime.preview(
        {
          draftId: fixture.created.draftId,
          kind: 'START',
          mode: 'MODEL_ASSISTED',
        },
        1,
        2,
      );
      expect(preview.preview).toMatchObject({
        plan: {
          budgetState: 'AVAILABLE',
          cacheState: 'MISS',
          capabilityState: 'UNKNOWN',
          credentialState: 'MISSING',
          maximumModelRequests: 1,
        },
      });
      expect(() =>
        runtime.confirm(
          {
            confirmation: 'APPLY_FACT_MAPPING_ACTION',
            executionId: 'must-not-send',
            kind: 'START',
            previewHash: preview.previewHash,
            token: preview.token,
          },
          1,
          2,
        ),
      ).toThrow(/FACT_MAPPING_MODEL_BLOCKED/u);
      expect(database.prepare('SELECT count(*) AS count FROM model_runs').get()).toEqual({
        count: 0,
      });
      expect(database.prepare('SELECT count(*) AS count FROM jobs').get()).toEqual({
        count: 0,
      });
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('binds manual decision preview to revision, sender, window and one-use token', async () => {
    const { database } = await createInitializedDatabase('fact mapping runtime decision');
    const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-runtime-decision');
    const repository = new SqliteFactMappingRepository(database);
    const start = repository.previewStart({
      draftId: fixture.created.draftId,
      mode: 'LOCAL_MANUAL',
      now: '2026-07-31T03:22:00.000Z',
    });
    repository.confirmLocalStart({
      executionId: 'decision-base',
      now: '2026-07-31T03:22:01.000Z',
      planId: start.plan.planId,
      previewHash: start.plan.previewHash,
    });
    const runtime = new DesktopFactMappingRuntime(database, {
      clock: () => new Date('2026-07-31T03:22:02.000Z'),
    });
    try {
      const detail = runtime.get({ draftId: fixture.created.draftId });
      const statement = detail.statements.find(
        (item) => item.kind !== 'FACT' && item.protectedSignals.length === 0,
      );
      if (statement === undefined || detail.checkVersion === null) {
        throw new Error('missing decision fixture');
      }
      const decision = {
        draftId: fixture.created.draftId,
        expectedRevision: detail.checkVersion.decisionRevision,
        kind: 'CONFIRM_CLASSIFICATION' as const,
        reason: null,
        statementId: statement.statementId,
      };
      const wrong = runtime.previewDecision(decision, 3, 4);
      expect(() =>
        runtime.confirmDecision(
          {
            confirmation: 'APPLY_FACT_MAPPING_ACTION',
            executionId: 'decision-wrong-window',
            kind: decision.kind,
            previewHash: wrong.previewHash,
            token: wrong.token,
          },
          3,
          5,
        ),
      ).toThrow(/FACT_MAPPING_CONFIRMATION_INVALID/u);

      const preview = runtime.previewDecision(decision, 3, 4);
      const result = runtime.confirmDecision(
        {
          confirmation: 'APPLY_FACT_MAPPING_ACTION',
          executionId: 'decision-apply',
          kind: decision.kind,
          previewHash: preview.previewHash,
          token: preview.token,
        },
        3,
        4,
      );
      expect(result.detail.checkVersion?.decisionRevision).toBe(decision.expectedRevision + 1);
      expect(() =>
        runtime.confirmDecision(
          {
            confirmation: 'APPLY_FACT_MAPPING_ACTION',
            executionId: 'decision-replay',
            kind: decision.kind,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          3,
          4,
        ),
      ).toThrow(/FACT_MAPPING_CONFIRMATION_INVALID/u);
      expect(() => runtime.previewDecision(decision, 3, 4)).toThrow(/FACT_MAPPING_STALE_REVISION/u);
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('validates all seven exact-object DTO operations and rejects hostile origins', () => {
    const valid = [
      ['getFactMappingChecks', { limit: 25, offset: 0, status: null }],
      ['getFactMappingCheck', { draftId: 'draft-1' }],
      ['getFactMappingClaimChain', { statementId: 'statement-1' }],
      ['previewFactMappingAction', { draftId: 'draft-1', kind: 'START', mode: 'LOCAL_MANUAL' }],
      [
        'confirmFactMappingAction',
        {
          confirmation: 'APPLY_FACT_MAPPING_ACTION',
          executionId: 'execution-1',
          kind: 'START',
          previewHash: 'a'.repeat(64),
          token: 'a'.repeat(43),
        },
      ],
      [
        'previewFactMappingDecision',
        {
          draftId: 'draft-1',
          expectedRevision: 0,
          kind: 'MAP_CLAIM',
          claimId: 'claim-1',
          reason: '人工确认',
          relation: 'EXACT',
          statementId: 'statement-1',
        },
      ],
      [
        'confirmFactMappingDecision',
        {
          confirmation: 'APPLY_FACT_MAPPING_ACTION',
          executionId: 'decision-1',
          kind: 'MAP_CLAIM',
          previewHash: 'a'.repeat(64),
          token: 'a'.repeat(43),
        },
      ],
    ] as const;
    for (const [operation, value] of valid) {
      expect(
        validateDesktopIpcRequest(RENDERER, [value], RENDERER, operation),
        operation,
      ).toBeNull();
    }
    expect(
      validateDesktopIpcRequest(
        RENDERER,
        [{ ...valid[0][1], secret: 'forbidden' }],
        RENDERER,
        valid[0][0],
      ),
    ).not.toBeNull();
    expect(
      validateDesktopIpcRequest('https://attacker.invalid', [valid[0][1]], RENDERER, valid[0][0]),
    ).not.toBeNull();
  });
});
