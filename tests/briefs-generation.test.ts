import { afterEach, describe, expect, it, vi } from 'vitest';

import { briefSemanticHash } from '../packages/briefs/src/index.js';
import {
  CONTENT_BRIEF_MODEL_BOUNDARY,
  ContentBriefGenerationService,
  emptyUsageObservation,
  type ModelExecutionRequestV1,
  type ModelExecutionResultV1,
  type ModelExecutionService,
} from '../packages/workflows/src/index.js';
import { SqliteBriefRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  BRIEF_NOW,
  completeBriefDraft,
  createRepositoryScaffoldFixture,
  modelCandidate,
} from './support/brief-fixtures.js';

afterEach(cleanTemporaryDatabases);

async function readyExecutionFixture() {
  const initialized = await createInitializedDatabase('brief generation');
  let sequence = 0;
  const repository = new SqliteBriefRepository(
    initialized.database,
    () => `generation-${++sequence}`,
  );
  const fixture = createRepositoryScaffoldFixture(initialized.database);
  const created = repository.createScaffold(
    fixture.input,
    fixture.context,
    fixture.dependencies,
    BRIEF_NOW,
  );
  const ready = repository.saveDraft(
    created.briefId,
    created.revision,
    completeBriefDraft(created.draft),
    fixture.context,
    '2026-07-30T12:20:00.000Z',
  );
  const plan = repository.previewGeneration(
    ready.briefId,
    ready.revision,
    'SUPPORTED',
    'AVAILABLE',
    '2026-07-30T12:20:01.000Z',
  );
  const prepared = repository.confirmGeneration(
    plan.planId,
    plan.previewHash,
    'brief-execution-1',
    '2026-07-30T12:20:02.000Z',
  );
  return { ...initialized, fixture, plan, prepared, ready, repository };
}

describe('M3 Issue 024 controlled structured generation', () => {
  it('sends one bounded structured request through ModelExecutionService and publishes a candidate', async () => {
    const fixture = await readyExecutionFixture();
    const requests: ModelExecutionRequestV1[] = [];
    try {
      const candidate = {
        ...modelCandidate(fixture.ready.draft),
        targetAudience: {
          ...fixture.ready.draft.targetAudience,
          readerDescription: '经 Scripted Mock 提议、仍待用户确认的读者描述',
        },
      };
      const result: ModelExecutionResultV1 = {
        costAmountMicroUsd: null,
        costState: 'UNPRICED_USAGE',
        executionId: 'brief-execution-1',
        externalRequestCount: 1,
        localCacheHit: false,
        outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
        output: { partial: false, refusal: false, type: 'STRUCTURED', value: candidate },
        stableErrorCode: null,
        status: 'SUCCEEDED',
        usage: emptyUsageObservation(),
      };
      const fake = {
        execute: vi.fn(async (request: ModelExecutionRequestV1) => {
          requests.push(request);
          return result;
        }),
      } as unknown as ModelExecutionService;
      const service = new ContentBriefGenerationService({
        modelExecutionService: fake,
        modelSlot: {
          modelId: 'scripted-fixture-model',
          modelRole: 'WRITING',
          modelSlot: 'WRITING',
          parameterVersion: 1,
          protocolMode: 'MOCK',
          providerConfigFingerprint: 'f'.repeat(64),
        },
        now: () => '2026-07-30T12:20:03.000Z',
        persistence: fixture.repository,
        readinessContext: () => fixture.fixture.context,
      });
      const loaded = fixture.repository.loadGenerationExecution('brief-execution-1');
      expect({
        briefId: loaded.run.briefId,
        expectedBriefRevision: loaded.plan.expectedBriefRevision,
        expectedVersionId: loaded.plan.expectedVersionId,
        inputHash: loaded.plan.inputHash,
        lockSnapshotHash: briefSemanticHash(loaded.draft.fieldStates),
        planId: loaded.run.planId,
        previewHash: loaded.plan.previewHash,
      }).toEqual({
        briefId: fixture.prepared.payload.briefId,
        expectedBriefRevision: fixture.prepared.payload.expectedBriefRevision,
        expectedVersionId: fixture.prepared.payload.expectedVersionId,
        inputHash: fixture.prepared.payload.inputHash,
        lockSnapshotHash: fixture.prepared.payload.lockSnapshotHash,
        planId: fixture.prepared.payload.planId,
        previewHash: fixture.prepared.payload.previewHash,
      });
      const run = await service.execute(
        fixture.prepared.payload,
        async () => 'CONTINUE',
        new AbortController().signal,
      );
      expect(run).toMatchObject({
        externalRequestCount: 1,
        status: 'SUCCEEDED',
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        cachePolicy: 'READ_WRITE',
        protocolMode: 'MOCK',
        requiredCapabilities: ['structuredJson'],
        taskKind: 'CONTENT_BRIEF',
        unitDemandUpperBound: {
          externalCalls: 1,
          imageGenerationCalls: 0,
          images: 0,
          toolCalls: 0,
          webSearchCalls: 0,
        },
      });
      const request = requests.at(0);
      expect(request).toBeDefined();
      if (request === undefined) throw new Error('expected one model request');
      const serialized = JSON.stringify(request.input);
      for (const forbidden of ['"title"', '"body"', '"tags"', '"imagePrompt"', '"winner"']) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(
        fixture.repository.get(fixture.ready.briefId).draft.targetAudience.readerDescription,
      ).toBe('经 Scripted Mock 提议、仍待用户确认的读者描述');
    } finally {
      fixture.database.close();
    }
  });

  it('fails before send with zero cost when no model slot is configured', async () => {
    const fixture = await readyExecutionFixture();
    try {
      const service = new ContentBriefGenerationService({
        now: () => '2026-07-30T12:21:00.000Z',
        persistence: fixture.repository,
        readinessContext: () => fixture.fixture.context,
      });
      await expect(
        service.execute(
          fixture.prepared.payload,
          async () => 'CONTINUE',
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        costState: 'NOT_INCURRED',
        externalRequestCount: 0,
        stableErrorCode: 'STRUCTURED_MODEL_UNCONFIGURED',
        status: 'FAILED',
      });
    } finally {
      fixture.database.close();
    }
  });

  it.each([
    ['UNKNOWN', 'AVAILABLE'],
    ['UNSUPPORTED', 'AVAILABLE'],
    ['STALE', 'AVAILABLE'],
    ['SUPPORTED', 'UNKNOWN'],
    ['SUPPORTED', 'BLOCKED'],
  ] as const)(
    'blocks confirmation when capability is %s and budget is %s',
    async (capabilityState, budgetState) => {
      const initialized = await createInitializedDatabase(
        `brief boundary ${capabilityState} ${budgetState}`,
      );
      let sequence = 0;
      const repository = new SqliteBriefRepository(
        initialized.database,
        () => `boundary-${++sequence}`,
      );
      try {
        const scaffold = createRepositoryScaffoldFixture(initialized.database);
        const created = repository.createScaffold(
          scaffold.input,
          scaffold.context,
          scaffold.dependencies,
          BRIEF_NOW,
        );
        const ready = repository.saveDraft(
          created.briefId,
          created.revision,
          completeBriefDraft(created.draft),
          scaffold.context,
          '2026-07-30T12:21:00.000Z',
        );
        const plan = repository.previewGeneration(
          ready.briefId,
          ready.revision,
          capabilityState,
          budgetState,
          '2026-07-30T12:21:01.000Z',
        );
        expect(() =>
          repository.confirmGeneration(
            plan.planId,
            plan.previewHash,
            `boundary-execution-${capabilityState}-${budgetState}`,
            '2026-07-30T12:21:02.000Z',
          ),
        ).toThrow(/BRIEF_INVALID_GENERATION/iu);
      } finally {
        initialized.database.close();
      }
    },
  );

  it('treats an identical Scripted Mock candidate as a deterministic no-op', async () => {
    const fixture = await readyExecutionFixture();
    try {
      const result: ModelExecutionResultV1 = {
        costAmountMicroUsd: null,
        costState: 'UNPRICED_USAGE',
        executionId: 'brief-execution-1',
        externalRequestCount: 1,
        localCacheHit: false,
        outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
        output: {
          partial: false,
          refusal: false,
          type: 'STRUCTURED',
          value: modelCandidate(fixture.ready.draft),
        },
        stableErrorCode: null,
        status: 'SUCCEEDED',
        usage: emptyUsageObservation(),
      };
      const service = new ContentBriefGenerationService({
        modelExecutionService: {
          execute: async () => result,
        } as unknown as ModelExecutionService,
        modelSlot: {
          modelId: 'scripted-no-op',
          modelRole: 'WRITING',
          modelSlot: 'WRITING',
          parameterVersion: 1,
          protocolMode: 'MOCK',
          providerConfigFingerprint: 'f'.repeat(64),
        },
        persistence: fixture.repository,
        readinessContext: () => fixture.fixture.context,
      });
      const originalVersion = fixture.ready.versionHistory.items.at(0);
      expect(originalVersion).toBeDefined();
      if (originalVersion === undefined) throw new Error('expected current version history');
      await expect(
        service.execute(
          fixture.prepared.payload,
          async () => 'CONTINUE',
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        resultVersionId: originalVersion.versionId,
        status: 'NO_OP',
      });
      expect(fixture.repository.get(fixture.ready.briefId).versionNumber).toBe(
        fixture.ready.versionNumber,
      );
    } finally {
      fixture.database.close();
    }
  });

  it('recovers a crash after the send boundary as ambiguous without retry', async () => {
    const fixture = await readyExecutionFixture();
    try {
      expect(
        fixture.repository.markGenerationRunning('brief-execution-1', '2026-07-30T12:29:00.000Z'),
      ).toMatchObject({
        costState: 'UNKNOWN_POSSIBLY_INCURRED',
        externalRequestCount: 1,
        status: 'RUNNING',
      });
      expect(fixture.repository.recoverInterrupted('2026-07-30T12:30:00.000Z')).toEqual({
        ambiguous: 1,
        preSendRecoverable: 0,
      });
      expect(fixture.repository.loadGenerationExecution('brief-execution-1').run).toMatchObject({
        stableErrorCode: 'INTERRUPTED_AFTER_SEND',
        status: 'AMBIGUOUS',
      });
    } finally {
      fixture.database.close();
    }
  });

  it('makes confirmation idempotent and rejects replay against another plan', async () => {
    const fixture = await readyExecutionFixture();
    try {
      expect(
        fixture.repository.confirmGeneration(
          fixture.plan.planId,
          fixture.plan.previewHash,
          'brief-execution-1',
          '2026-07-30T12:20:04.000Z',
        ).run.runId,
      ).toBe(fixture.prepared.run.runId);
      expect(() =>
        fixture.repository.confirmGeneration(
          'another-plan',
          fixture.plan.previewHash,
          'brief-execution-1',
          '2026-07-30T12:20:05.000Z',
        ),
      ).toThrow(/BRIEF_CONFIRMATION_INVALID/iu);
    } finally {
      fixture.database.close();
    }
  });

  it.each([
    ['PAUSE', 'PAUSED', 'QUEUE_PAUSED_BEFORE_SEND'],
    ['CANCEL', 'CANCELLED', 'QUEUE_CANCELLED_BEFORE_SEND'],
  ] as const)('honors %s before send with no request or cost', async (signal, status, code) => {
    const fixture = await readyExecutionFixture();
    try {
      const execute = vi.fn();
      const service = new ContentBriefGenerationService({
        modelExecutionService: { execute } as unknown as ModelExecutionService,
        modelSlot: {
          modelId: 'never-called',
          modelRole: 'WRITING',
          modelSlot: 'WRITING',
          parameterVersion: 1,
          protocolMode: 'MOCK',
          providerConfigFingerprint: 'f'.repeat(64),
        },
        persistence: fixture.repository,
        readinessContext: () => fixture.fixture.context,
      });
      await expect(
        service.execute(fixture.prepared.payload, async () => signal, new AbortController().signal),
      ).resolves.toMatchObject({
        costState: 'NOT_INCURRED',
        externalRequestCount: 0,
        stableErrorCode: code,
        status,
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      fixture.database.close();
    }
  });

  it('records after-send failure as ambiguous and never retries it automatically', async () => {
    const fixture = await readyExecutionFixture();
    try {
      const result: ModelExecutionResultV1 = {
        costAmountMicroUsd: null,
        costState: 'UNKNOWN_POSSIBLY_INCURRED',
        executionId: 'brief-execution-1',
        externalRequestCount: 1,
        localCacheHit: false,
        outcomeCertainty: 'MAY_HAVE_EXECUTED',
        output: null,
        stableErrorCode: 'LOOPBACK_DROPPED_AFTER_SEND',
        status: 'FAILED_AFTER_SEND',
        usage: emptyUsageObservation(),
      };
      const service = new ContentBriefGenerationService({
        modelExecutionService: {
          execute: async () => result,
        } as unknown as ModelExecutionService,
        modelSlot: {
          modelId: 'scripted-ambiguous',
          modelRole: 'WRITING',
          modelSlot: 'WRITING',
          parameterVersion: 1,
          protocolMode: 'MOCK',
          providerConfigFingerprint: 'f'.repeat(64),
        },
        persistence: fixture.repository,
        readinessContext: () => fixture.fixture.context,
      });
      await expect(
        service.execute(
          fixture.prepared.payload,
          async () => 'CONTINUE',
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        costState: 'UNKNOWN_POSSIBLY_INCURRED',
        externalRequestCount: 1,
        stableErrorCode: 'LOOPBACK_DROPPED_AFTER_SEND',
        status: 'AMBIGUOUS',
      });
      expect(fixture.repository.recoverInterrupted('2026-07-30T12:30:00.000Z')).toEqual({
        ambiguous: 0,
        preSendRecoverable: 0,
      });
    } finally {
      fixture.database.close();
    }
  });

  it('publishes a narrow boundary with no downstream content or quality fields', () => {
    expect(CONTENT_BRIEF_MODEL_BOUNDARY.maximumModelRequests).toBe(1);
    expect(CONTENT_BRIEF_MODEL_BOUNDARY.prohibitedOutputFields).toEqual(
      expect.arrayContaining([
        'title',
        'body',
        'tags',
        'pinnedComment',
        'imagePrompt',
        'experimentResult',
        'winner',
        'effect',
      ]),
    );
  });
});
