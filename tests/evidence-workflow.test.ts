import { describe, expect, it, vi } from 'vitest';

import { textSha256, type SourceProcessingJobPayloadV1 } from '../packages/evidence/src/index.js';
import {
  EvidenceProcessingService,
  type EvidenceProcessingCountsV1,
  type EvidenceProcessingOutputV1,
  type EvidenceProcessingPersistenceV1,
  type EvidenceProcessingResultV1,
  type EvidenceSnapshotV1,
  emptyUsageObservation,
  type ModelExecutionResultV1,
  type ModelExecutionService,
} from '../packages/workflows/src/index.js';
import { dateClaim, fullTextEvidence, processingPlan } from './support/evidence-fixtures.js';

const SOURCE_REVISION_ID = 'source-workflow:1';
const TEXT = 'Official publication date: 2026-07-29.';

function payload(
  step: SourceProcessingJobPayloadV1['step'],
  executionId = `execution-${step.toLowerCase()}`,
): SourceProcessingJobPayloadV1 {
  const plan = processingPlan(`plan-${step.toLowerCase()}`, [SOURCE_REVISION_ID], [step]);
  return {
    executionId,
    planHash: plan.planHash,
    planId: plan.planId,
    runId: `run-${step.toLowerCase()}`,
    sourceRevisionIds: plan.sourceRevisionIds,
    step,
  };
}

function persistence(
  step: SourceProcessingJobPayloadV1['step'],
  snapshotText = TEXT,
): {
  readonly applied: EvidenceProcessingOutputV1[];
  readonly persistence: EvidenceProcessingPersistenceV1;
  readonly processLocal: ReturnType<typeof vi.fn>;
  readonly saved: Map<string, EvidenceProcessingResultV1>;
} {
  const plan = processingPlan(`plan-${step.toLowerCase()}`, [SOURCE_REVISION_ID], [step]);
  const saved = new Map<string, EvidenceProcessingResultV1>();
  const applied: EvidenceProcessingOutputV1[] = [];
  const processLocal = vi.fn(async (): Promise<EvidenceProcessingCountsV1> => ({
    claims: 0,
    conflicts: 0,
    evaluations: 1,
    evidence: 0,
  }));
  return {
    applied,
    persistence: {
      applyStructuredOutput: async (_executionId, output) => {
        applied.push(output);
        return { claims: output.items.length, conflicts: 0, evaluations: 0, evidence: 0 };
      },
      findExecution: (executionId) => saved.get(executionId) ?? null,
      processLocal,
      readPlan: (planId) => (planId === plan.planId ? plan : null),
      readSnapshot: async (): Promise<EvidenceSnapshotV1> => ({
        contentHash: textSha256(snapshotText),
        sourceId: 'source-workflow',
        sourceRevision: 1,
        sourceRevisionId: SOURCE_REVISION_ID,
        text: snapshotText,
      }),
      saveExecution: (result) => saved.set(result.executionId, result),
    },
    processLocal,
    saved,
  };
}

function modelResult(
  status: ModelExecutionResultV1['status'],
  output: ModelExecutionResultV1['output'] = null,
): ModelExecutionResultV1 {
  const sent = ![
    'BUDGET_BLOCKED',
    'CACHE_HIT',
    'CACHE_CORRUPT',
    'CAPABILITY_BLOCKED',
    'CANCELLED_BEFORE_SEND',
    'FAILED_BEFORE_SEND',
  ].includes(status);
  return {
    costAmountMicroUsd: null,
    costState: sent ? 'UNKNOWN_POSSIBLY_INCURRED' : 'NOT_INCURRED',
    executionId: 'model-execution',
    externalRequestCount: sent ? 1 : 0,
    localCacheHit: status === 'CACHE_HIT',
    outcomeCertainty: sent ? 'MAY_HAVE_EXECUTED' : 'NOT_SENT',
    output,
    stableErrorCode: status === 'SUCCEEDED' || status === 'CACHE_HIT' ? null : status,
    status,
    usage: emptyUsageObservation(),
  };
}

function modelService(result: ModelExecutionResultV1): {
  readonly execute: ReturnType<typeof vi.fn>;
  readonly service: ModelExecutionService;
} {
  const execute = vi.fn(async () => result);
  return {
    execute,
    service: { execute } as unknown as ModelExecutionService,
  };
}

const slot = {
  modelId: 'scripted-model',
  modelRole: 'evidence-extractor',
  modelSlot: 'evidence',
  parameterVersion: 1,
  protocolMode: 'RESPONSES',
  providerConfigFingerprint: 'f'.repeat(64),
} as const;

describe('Issue 019 bounded evidence processing workflow', () => {
  it('runs local reconciliation without a model and replays one execution idempotently', async () => {
    const state = persistence('RECONCILE');
    const service = new EvidenceProcessingService({ persistence: state.persistence });
    const input = payload('RECONCILE');
    const first = await service.execute(
      input,
      async () => 'CONTINUE',
      new AbortController().signal,
    );
    const replay = await service.execute(
      input,
      async () => 'CONTINUE',
      new AbortController().signal,
    );
    expect(first).toMatchObject({
      externalRequestCount: 0,
      status: 'SUCCEEDED',
      costState: 'NOT_INCURRED',
    });
    expect(replay).toBe(first);
    expect(state.processLocal).toHaveBeenCalledTimes(1);
  });

  it('keeps an unconfigured model step truthfully capability-blocked with zero requests', async () => {
    const state = persistence('EXTRACT_CLAIMS');
    const service = new EvidenceProcessingService({ persistence: state.persistence });
    await expect(
      service.execute(
        payload('EXTRACT_CLAIMS'),
        async () => 'CONTINUE',
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      costState: 'NOT_INCURRED',
      externalRequestCount: 0,
      stableErrorCode: 'STRUCTURED_MODEL_UNCONFIGURED',
      status: 'CAPABILITY_BLOCKED',
    });
  });

  it.each([
    ['PAUSE', 'PAUSED'],
    ['CANCEL', 'CANCELLED'],
  ] as const)('honors cooperative %s before any work', async (control, status) => {
    const state = persistence('RECONCILE');
    const service = new EvidenceProcessingService({ persistence: state.persistence });
    const result = await service.execute(
      payload('RECONCILE', `execution-${control.toLowerCase()}`),
      async () => control,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ externalRequestCount: 0, status });
    expect(state.processLocal).not.toHaveBeenCalled();
  });

  it('accepts a scripted structured cache hit and never treats model output as verified', async () => {
    const state = persistence('EXTRACT_CLAIMS');
    const located = fullTextEvidence('source-workflow', 1, TEXT);
    const claim = {
      ...dateClaim('claim-workflow', 'work-1', '2026-07-29'),
      claimant: { sourceId: 'source-workflow', sourceRevision: 1 },
      provenance: { kind: 'MODEL_CANDIDATE', runId: 'execution-extract_claims' },
      status: 'CANDIDATE',
    } as const;
    const output = {
      partial: false,
      refusal: false,
      type: 'STRUCTURED',
      value: {
        contractVersion: 'evidence-processing-output-v1',
        items: [
          {
            claim,
            excerptHash: located.excerptHash,
            locator: located.locator,
            summary: null,
          },
        ],
        policyVersion: 'fact-policy-v1',
        sourceRevisionId: SOURCE_REVISION_ID,
      },
    } as const;
    const scripted = modelService(modelResult('CACHE_HIT', output));
    const service = new EvidenceProcessingService({
      modelExecutionService: scripted.service,
      modelSlot: slot,
      persistence: state.persistence,
    });
    const result = await service.execute(
      payload('EXTRACT_CLAIMS'),
      async () => 'CONTINUE',
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      externalRequestCount: 0,
      status: 'SUCCEEDED',
      costState: 'NOT_INCURRED',
    });
    expect(state.applied[0]?.items[0]?.claim.status).toBe('CANDIDATE');
    expect(scripted.execute).toHaveBeenCalledTimes(1);
    expect(scripted.execute.mock.calls[0]?.[0]).toMatchObject({
      cachePolicy: 'READ_WRITE',
      requiredCapabilities: ['structuredJson'],
    });
  });

  it.each([
    ['CAPABILITY_BLOCKED', 'CAPABILITY_BLOCKED', 'NOT_INCURRED'],
    ['BUDGET_BLOCKED', 'BUDGET_BLOCKED', 'NOT_INCURRED'],
    ['FAILED_BEFORE_SEND', 'FAILED', 'NOT_INCURRED'],
    ['FAILED_AFTER_SEND', 'AMBIGUOUS', 'UNKNOWN_POSSIBLY_INCURRED'],
  ] as const)(
    'preserves conservative %s handling without fallback',
    async (modelStatus, expectedStatus, expectedCost) => {
      const state = persistence('SUMMARIZE');
      const scripted = modelService(modelResult(modelStatus));
      const service = new EvidenceProcessingService({
        modelExecutionService: scripted.service,
        modelSlot: slot,
        persistence: state.persistence,
      });
      const result = await service.execute(
        payload('SUMMARIZE', `execution-${modelStatus.toLowerCase()}`),
        async () => 'CONTINUE',
        new AbortController().signal,
      );
      expect(result).toMatchObject({ costState: expectedCost, status: expectedStatus });
      expect(scripted.execute).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a fragment above the confirmed byte limit before model execution', async () => {
    const state = persistence('SUMMARIZE', 'x'.repeat(256 * 1024 + 1));
    const scripted = modelService(modelResult('SUCCEEDED'));
    const service = new EvidenceProcessingService({
      modelExecutionService: scripted.service,
      modelSlot: slot,
      persistence: state.persistence,
    });
    await expect(
      service.execute(
        payload('SUMMARIZE', 'execution-oversize'),
        async () => 'CONTINUE',
        new AbortController().signal,
      ),
    ).rejects.toThrow(/EVIDENCE_INVALID_LOCATOR/u);
    expect(scripted.execute).not.toHaveBeenCalled();
  });
});
