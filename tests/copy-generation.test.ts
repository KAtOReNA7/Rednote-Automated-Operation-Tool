import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COPY_MODEL_BOUNDARY,
  CopyGenerationService,
  emptyUsageObservation,
  type ModelExecutionRequestV1,
  type ModelExecutionResultV1,
  type ModelExecutionService,
} from '../packages/workflows/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  copyCandidate,
  createReadyCopyRepositoryFixture,
  requiredFixtureValue,
} from './support/copy-fixtures.js';

afterEach(cleanTemporaryDatabases);

async function generationFixture() {
  const initialized = await createInitializedDatabase('copy generation');
  const fixture = createReadyCopyRepositoryFixture(initialized.database, 'copy-generation');
  const plan = fixture.copy.previewMutation({
    budgetState: 'AVAILABLE',
    capabilityState: 'SUPPORTED',
    draftId: fixture.created.draftId,
    expectedRevision: fixture.created.revision,
    expiresAt: '2026-07-30T14:10:00.000Z',
    now: '2026-07-30T14:00:01.000Z',
    operation: 'FULL_GENERATION',
  });
  const prepared = fixture.copy.confirmMutation(
    plan.planId,
    plan.previewHash,
    'copy-execution-1',
    '2026-07-30T14:00:02.000Z',
  );
  return { ...initialized, ...fixture, plan, prepared };
}

describe('M3 Issue 025 controlled copy generation', () => {
  it('sends exactly one bounded structured Scripted Mock request and publishes a new version', async () => {
    const fixture = await generationFixture();
    const requests: ModelExecutionRequestV1[] = [];
    try {
      const candidate = copyCandidate({
        ...fixture.created.payload,
        titles: fixture.created.payload.titles.map((title, index) =>
          index === 0 ? { ...title, text: `${title.text} · Scripted Mock` } : title,
        ),
      });
      const result: ModelExecutionResultV1 = {
        costAmountMicroUsd: null,
        costState: 'UNPRICED_USAGE',
        executionId: 'copy-execution-1',
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
      const service = new CopyGenerationService({
        modelExecutionService: fake,
        modelSlot: {
          modelId: 'scripted-fixture-model',
          modelRole: 'WRITING',
          modelSlot: 'WRITING',
          parameterVersion: 1,
          protocolMode: 'MOCK',
          providerConfigFingerprint: 'f'.repeat(64),
        },
        now: () => '2026-07-30T14:00:03.000Z',
        persistence: fixture.copy,
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
        taskKind: 'COPY_GENERATE',
        unitDemandUpperBound: {
          externalCalls: 1,
          imageGenerationCalls: 0,
          images: 0,
          toolCalls: 0,
          webSearchCalls: 0,
        },
      });
      const serialized = JSON.stringify(
        requiredFixtureValue(requests.at(0), 'model request').input,
      );
      for (const forbidden of [
        'imagePrompt',
        'qualityPassed',
        'approval',
        'publish',
        'rawResponse',
        'Authorization',
        'internalPrediction',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(fixture.copy.get(fixture.created.draftId)).toMatchObject({
        status: 'READY_FOR_QUALITY_PIPELINE',
        versionNumber: 2,
      });
    } finally {
      fixture.database.close();
    }
  });

  it('fails before send with zero requests and zero cost when no model is configured', async () => {
    const fixture = await generationFixture();
    try {
      const service = new CopyGenerationService({
        now: () => '2026-07-30T14:00:03.000Z',
        persistence: fixture.copy,
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
        status: 'FAILED',
      });
    } finally {
      fixture.database.close();
    }
  });

  it('records a cache-hit no-op without creating another DraftVersion', async () => {
    const fixture = await generationFixture();
    try {
      const fake = {
        execute: vi.fn(async (): Promise<ModelExecutionResultV1> => ({
          costAmountMicroUsd: null,
          costState: 'NOT_INCURRED',
          executionId: 'copy-execution-1',
          externalRequestCount: 0,
          localCacheHit: true,
          outcomeCertainty: 'NOT_SENT',
          output: {
            partial: false,
            refusal: false,
            type: 'STRUCTURED',
            value: copyCandidate(fixture.created.payload),
          },
          stableErrorCode: null,
          status: 'CACHE_HIT',
          usage: emptyUsageObservation(),
        })),
      } as unknown as ModelExecutionService;
      const service = new CopyGenerationService({
        modelExecutionService: fake,
        modelSlot: {
          modelId: 'scripted-fixture-model',
          modelRole: 'WRITING',
          modelSlot: 'WRITING',
          parameterVersion: 1,
          protocolMode: 'MOCK',
          providerConfigFingerprint: 'f'.repeat(64),
        },
        persistence: fixture.copy,
      });
      await expect(
        service.execute(
          fixture.prepared.payload,
          async () => 'CONTINUE',
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        cacheState: 'HIT',
        externalRequestCount: 0,
        status: 'NO_OP',
      });
      expect(fixture.copy.get(fixture.created.draftId)).toMatchObject({
        revision: fixture.created.revision,
        versionNumber: 1,
      });
    } finally {
      fixture.database.close();
    }
  });

  it('does not auto retry, repair or fallback on after-send ambiguity', async () => {
    const fixture = await generationFixture();
    try {
      const fake = {
        execute: vi.fn(async (): Promise<ModelExecutionResultV1> => ({
          costAmountMicroUsd: null,
          costState: 'UNKNOWN_POSSIBLY_INCURRED',
          executionId: 'copy-execution-1',
          externalRequestCount: 1,
          localCacheHit: false,
          outcomeCertainty: 'MAY_HAVE_EXECUTED',
          output: null,
          stableErrorCode: 'SCRIPTED_TIMEOUT_AFTER_SEND',
          status: 'AMBIGUOUS',
          usage: emptyUsageObservation(),
        })),
      } as unknown as ModelExecutionService;
      const service = new CopyGenerationService({
        modelExecutionService: fake,
        modelSlot: {
          modelId: 'scripted-fixture-model',
          modelRole: 'WRITING',
          modelSlot: 'WRITING',
          parameterVersion: 1,
          protocolMode: 'MOCK',
          providerConfigFingerprint: 'f'.repeat(64),
        },
        persistence: fixture.copy,
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
        status: 'AMBIGUOUS',
      });
      expect(fake.execute).toHaveBeenCalledTimes(1);
      expect(fixture.copy.get(fixture.created.draftId).versionNumber).toBe(1);
      expect(COPY_MODEL_BOUNDARY.maximumModelRequests).toBe(1);
    } finally {
      fixture.database.close();
    }
  });
});
