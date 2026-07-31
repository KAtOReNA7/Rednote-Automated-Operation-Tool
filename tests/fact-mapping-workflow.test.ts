import { describe, expect, it, vi } from 'vitest';

import {
  CLAIM_CANDIDATE_POLICY_VERSION,
  FACT_MAPPING_ASSIST_SCHEMA_VERSION,
  FACT_MAPPING_CHECKER_VERSION,
  FACT_MAPPING_CLASSIFICATION_VERSION,
  FACT_MAPPING_CONTRACT_VERSION,
  FACT_MAPPING_SEGMENTATION_VERSION,
  KEY_FACT_POLICY_VERSION,
  TYPED_FACT_COMPATIBILITY_VERSION,
  FactMappingError,
  buildFactMappingAssistInput,
  buildDeterministicFactMapping,
  factMappingHash,
  type FactMappingJobPayloadV1,
  type FactMappingPlanV1,
  type FactMappingRunV1,
} from '../packages/quality/src/index.js';
import {
  FACT_MAPPING_MODEL_BOUNDARY,
  FactMappingCheckService,
  emptyUsageObservation,
  type FactMappingWorkflowPersistenceV1,
  type ModelExecutionRequestV1,
  type ModelExecutionResultV1,
  type ModelExecutionService,
} from '../packages/workflows/src/index.js';
import {
  FACT_MAPPING_NOW,
  candidateSet,
  materializedArtifact,
} from './support/fact-mapping-fixtures.js';
import { requiredFixtureValue } from './support/copy-fixtures.js';

function workflowFixture(mode: FactMappingPlanV1['mode']) {
  const artifacts = [materializedArtifact('本书于2024年出版。')];
  const candidates = candidateSet([], { workIds: [] });
  const deterministic = buildDeterministicFactMapping({
    artifacts,
    candidates,
    createdAt: FACT_MAPPING_NOW,
  });
  const planBase = {
    artifactCount: 1,
    briefVersionId: 'brief-version-1',
    budgetState: 'AVAILABLE' as const,
    cacheState: 'MISS' as const,
    candidateClaimCount: 0,
    candidateEvidenceCount: 0,
    candidateSourceRevisionCount: 0,
    capabilityState: 'SUPPORTED' as const,
    checkerVersion: FACT_MAPPING_CHECKER_VERSION,
    classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
    createdAt: FACT_MAPPING_NOW,
    credentialState: mode === 'MODEL_ASSISTED' ? ('AVAILABLE' as const) : ('NOT_REQUIRED' as const),
    dependencyHash: candidates.dependencyHash,
    draftId: 'draft-1',
    draftRevision: 0,
    draftVersionId: 'draft-version-1',
    estimatedLocalWrites: 10,
    expiresAt: '2026-07-31T03:05:00.000Z',
    inputCodePointCount: artifacts[0]?.artifact.codePointLength ?? 0,
    inputHash: deterministic.inputHash,
    mappingPolicyVersion: FACT_MAPPING_CONTRACT_VERSION,
    maximumModelRequests: mode === 'MODEL_ASSISTED' ? (1 as const) : (0 as const),
    mode,
    planId: 'plan-1',
    profileId: 'NON_SPOILER_SINGLE_BOOK_VERDICT' as const,
    protectedSignalCount: 1,
    segmentationVersion: FACT_MAPPING_SEGMENTATION_VERSION,
    statementCount: 1,
    typedCompatibilityVersion: TYPED_FACT_COMPATIBILITY_VERSION,
    workIds: Object.freeze(['work-1']),
  };
  const plan: FactMappingPlanV1 = Object.freeze({
    ...planBase,
    previewHash: factMappingHash(planBase),
  });
  let run: FactMappingRunV1 = Object.freeze({
    createdAt: FACT_MAPPING_NOW,
    draftId: plan.draftId,
    executionId: 'execution-1',
    externalRequestCount: 0,
    finishedAt: null,
    modelExecutionId: null,
    mode,
    planId: plan.planId,
    reasonCode: null,
    revision: 0,
    runId: 'run-1',
    status: 'QUEUED',
  });
  const checkVersion = {
    checkerVersion: FACT_MAPPING_CHECKER_VERSION,
    createdAt: '2026-07-31T03:00:03.000Z',
    decisionRevision: 0,
    dependencyHash: candidates.dependencyHash,
    draftId: plan.draftId,
    draftVersionId: plan.draftVersionId,
    inputHash: deterministic.inputHash,
    rollup: deterministic.rollup,
    runId: run.runId,
    versionId: 'check-version-1',
    versionNumber: 1,
  } as const;
  const execution = () =>
    Object.freeze({
      artifacts,
      assistInput: buildFactMappingAssistInput({
        artifacts,
        candidates,
        profileId: plan.profileId,
      }),
      candidates,
      plan,
      run,
    });
  const persistence: FactMappingWorkflowPersistenceV1 = {
    completeLocalWorkflow: vi.fn(() => {
      run = Object.freeze({
        ...run,
        finishedAt: '2026-07-31T03:00:03.000Z',
        revision: run.revision + 1,
        status: deterministic.rollup.status,
      });
      return { checkVersion, run };
    }),
    completeModelWorkflow: vi.fn(() => {
      run = Object.freeze({
        ...run,
        externalRequestCount: 1,
        finishedAt: '2026-07-31T03:00:03.000Z',
        modelExecutionId: 'execution-1',
        revision: run.revision + 1,
        status: 'AWAITING_REVIEW',
      });
      return {
        checkVersion: {
          ...checkVersion,
          rollup: { ...checkVersion.rollup, status: 'AWAITING_REVIEW' as const },
        },
        run,
      };
    }),
    loadWorkflowExecution: vi.fn(() => execution()),
    markWorkflowRunning: vi.fn(() => {
      run = Object.freeze({
        ...run,
        revision: run.revision + 1,
        status: 'RUNNING',
      });
      return run;
    }),
    stopWorkflowRun: vi.fn((input) => {
      run = Object.freeze({
        ...run,
        externalRequestCount: input.externalRequestCount,
        finishedAt: input.now,
        modelExecutionId: input.modelExecutionId,
        reasonCode: input.reasonCode,
        revision: run.revision + 1,
        status: input.status,
      });
      return run;
    }),
  };
  const payload: FactMappingJobPayloadV1 = Object.freeze({
    candidateHash: candidates.inputHash,
    dependencyHash: plan.dependencyHash,
    draftId: plan.draftId,
    draftRevision: plan.draftRevision,
    draftVersionId: plan.draftVersionId,
    executionId: run.executionId,
    inputHash: plan.inputHash,
    jobType: 'FACT_MAPPING_CHECK_V1',
    mode,
    planId: plan.planId,
    previewHash: plan.previewHash,
  });
  return { artifacts, candidates, payload, persistence };
}

function modelSlot() {
  return {
    modelId: 'scripted-fixture-model',
    modelRole: 'ANALYSIS',
    modelSlot: 'FACT_MAPPING',
    parameterVersion: 1,
    protocolMode: 'MOCK' as const,
    providerConfigFingerprint: 'f'.repeat(64),
  };
}

describe('M3 Issue 026 controlled FACT_MAPPING workflow', () => {
  it('completes the local path with zero model requests', async () => {
    const fixture = workflowFixture('LOCAL_MANUAL');
    const execute = vi.fn();
    const service = new FactMappingCheckService({
      modelExecutionService: { execute } as unknown as ModelExecutionService,
      modelSlot: modelSlot(),
      now: () => '2026-07-31T03:00:03.000Z',
      persistence: fixture.persistence,
    });
    await expect(
      service.execute(fixture.payload, async () => 'CONTINUE', new AbortController().signal),
    ).resolves.toMatchObject({
      externalRequestCount: 0,
      status: 'FACT_BLOCKED',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('sends exactly one bounded structured Scripted Mock request', async () => {
    const fixture = workflowFixture('MODEL_ASSISTED');
    const artifact = requiredFixtureValue(fixture.artifacts.at(0), 'fact mapping artifact');
    const output = {
      candidates: [
        {
          artifactId: artifact.artifact.artifactId,
          artifactKind: artifact.artifact.artifactKind,
          claimIds: [],
          domain: 'DATE_TIME',
          draftVersionId: artifact.artifact.draftVersionId,
          endCodePoint: artifact.artifact.codePointLength,
          kind: 'FACT',
          materiality: 'KEY_FACT',
          protectedSignalAcknowledged: true,
          reasonCode: 'SCRIPTED_FACT',
          relation: 'NO_CLAIM',
          selectedTextHash: factMappingHash(artifact.text),
          startCodePoint: 0,
          textHash: artifact.artifact.textHash,
        },
      ],
      schemaVersion: FACT_MAPPING_ASSIST_SCHEMA_VERSION,
    };
    const requests: ModelExecutionRequestV1[] = [];
    const execute = vi.fn(
      async (request: ModelExecutionRequestV1): Promise<ModelExecutionResultV1> => {
        requests.push(request);
        return {
          costAmountMicroUsd: null,
          costState: 'UNPRICED_USAGE',
          executionId: 'execution-1',
          externalRequestCount: 1,
          localCacheHit: false,
          outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
          output: {
            partial: false,
            refusal: false,
            type: 'STRUCTURED',
            value: output,
          },
          stableErrorCode: null,
          status: 'SUCCEEDED',
          usage: emptyUsageObservation(),
        };
      },
    );
    const service = new FactMappingCheckService({
      modelExecutionService: { execute } as unknown as ModelExecutionService,
      modelSlot: modelSlot(),
      now: () => '2026-07-31T03:00:03.000Z',
      persistence: fixture.persistence,
    });
    await expect(
      service.execute(fixture.payload, async () => 'CONTINUE', new AbortController().signal),
    ).resolves.toMatchObject({
      externalRequestCount: 1,
      status: 'AWAITING_REVIEW',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      budgetClassification: 'NONESSENTIAL',
      cachePolicy: 'READ_WRITE',
      protocolMode: 'MOCK',
      requiredCapabilities: ['structuredJson'],
      taskKind: 'FACT_MAPPING_ASSIST',
      unitDemandUpperBound: {
        externalCalls: 1,
        imageGenerationCalls: 0,
        images: 0,
        toolCalls: 0,
        webSearchCalls: 0,
      },
    });
    expect(JSON.stringify(requests[0]?.input)).not.toMatch(
      /Authorization|api.?key|rawResponse|internalPrediction|https?:\/\//iu,
    );
    expect(FACT_MAPPING_MODEL_BOUNDARY.maximumModelRequests).toBe(1);
  });

  it('fails before send when model execution is not configured', async () => {
    const fixture = workflowFixture('MODEL_ASSISTED');
    const service = new FactMappingCheckService({
      now: () => '2026-07-31T03:00:03.000Z',
      persistence: fixture.persistence,
    });
    await expect(
      service.execute(fixture.payload, async () => 'CONTINUE', new AbortController().signal),
    ).resolves.toMatchObject({
      externalRequestCount: 0,
      reasonCode: 'STRUCTURED_MODEL_UNCONFIGURED',
      status: 'FAILED',
    });
  });

  it('records after-send uncertainty as AMBIGUOUS and never retries or falls back', async () => {
    const fixture = workflowFixture('MODEL_ASSISTED');
    const execute = vi.fn(async (): Promise<ModelExecutionResultV1> => ({
      costAmountMicroUsd: null,
      costState: 'UNKNOWN_POSSIBLY_INCURRED',
      executionId: 'execution-1',
      externalRequestCount: 1,
      localCacheHit: false,
      outcomeCertainty: 'MAY_HAVE_EXECUTED',
      output: null,
      stableErrorCode: 'SCRIPTED_TIMEOUT_AFTER_SEND',
      status: 'AMBIGUOUS',
      usage: emptyUsageObservation(),
    }));
    const service = new FactMappingCheckService({
      modelExecutionService: { execute } as unknown as ModelExecutionService,
      modelSlot: modelSlot(),
      now: () => '2026-07-31T03:00:03.000Z',
      persistence: fixture.persistence,
    });
    await expect(
      service.execute(fixture.payload, async () => 'CONTINUE', new AbortController().signal),
    ).resolves.toMatchObject({
      externalRequestCount: 1,
      reasonCode: 'SCRIPTED_TIMEOUT_AFTER_SEND',
      status: 'AMBIGUOUS',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fixture.persistence.completeModelWorkflow).not.toHaveBeenCalled();
  });

  it('cancels before send and rejects stale payload hashes', async () => {
    const fixture = workflowFixture('MODEL_ASSISTED');
    const execute = vi.fn();
    const service = new FactMappingCheckService({
      modelExecutionService: { execute } as unknown as ModelExecutionService,
      modelSlot: modelSlot(),
      now: () => '2026-07-31T03:00:03.000Z',
      persistence: fixture.persistence,
    });
    await expect(
      service.execute(fixture.payload, async () => 'CANCEL', new AbortController().signal),
    ).resolves.toMatchObject({
      externalRequestCount: 0,
      status: 'CANCELLED',
    });
    expect(execute).not.toHaveBeenCalled();

    const stale = { ...fixture.payload, dependencyHash: '0'.repeat(64) };
    await expect(
      service.execute(stale, async () => 'CONTINUE', new AbortController().signal),
    ).rejects.toBeInstanceOf(FactMappingError);
  });

  it('keeps terminal execution replay idempotent with no duplicate request', async () => {
    const fixture = workflowFixture('MODEL_ASSISTED');
    const terminalRun = fixture.persistence.stopWorkflowRun({
      executionId: 'execution-1',
      externalRequestCount: 0,
      modelExecutionId: null,
      now: '2026-07-31T03:00:02.000Z',
      reasonCode: 'USER_CANCELLED',
      status: 'CANCELLED',
    });
    expect(terminalRun.status).toBe('CANCELLED');
    const execute = vi.fn();
    const service = new FactMappingCheckService({
      modelExecutionService: { execute } as unknown as ModelExecutionService,
      modelSlot: modelSlot(),
      persistence: fixture.persistence,
    });
    await expect(
      service.execute(fixture.payload, async () => 'CONTINUE', new AbortController().signal),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('freezes all policy identities used by workflow input hashing', () => {
    expect({
      candidate: CLAIM_CANDIDATE_POLICY_VERSION,
      checker: FACT_MAPPING_CHECKER_VERSION,
      classification: FACT_MAPPING_CLASSIFICATION_VERSION,
      keyFact: KEY_FACT_POLICY_VERSION,
      mapping: FACT_MAPPING_CONTRACT_VERSION,
      segmentation: FACT_MAPPING_SEGMENTATION_VERSION,
      typed: TYPED_FACT_COMPATIBILITY_VERSION,
    }).toEqual({
      candidate: 'claim-candidate-policy-v1',
      checker: 'fact-mapping-checker-v1',
      classification: 'fact-classification-v1',
      keyFact: 'key-fact-policy-v1',
      mapping: 'fact-mapping-v1',
      segmentation: 'fact-segmentation-v1',
      typed: 'typed-fact-compatibility-v1',
    });
  });
});
