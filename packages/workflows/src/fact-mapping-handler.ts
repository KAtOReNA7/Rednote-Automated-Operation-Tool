import type {
  FactMappingStartExecution,
  FactMappingWorkflowExecution,
} from '@mystery-operations/db';
import type { ProtocolMode } from '@mystery-operations/providers';
import {
  FACT_MAPPING_ASSIST_BOUNDARY,
  FACT_MAPPING_ASSIST_SCHEMA_VERSION,
  FACT_MAPPING_JOB_TYPE,
  FACT_MAPPING_PROMPT_VERSION,
  FactMappingError,
  assertFactMappingJobPayload,
  factMappingHash,
  type FactMappingJobPayloadV1,
  type FactMappingRunV1,
} from '@mystery-operations/quality';

import type { ModelExecutionService } from './model-execution/service.js';
import type { ModelExecutionRequestV1, ModelExecutionResultV1 } from './model-execution/types.js';
import { JobHandlerExecutionError } from './queue/error-sanitizer.js';
import type { JobHandler, JobHandlerRegistry } from './queue/handler-registry.js';
import type { JsonValue, QueueControlSignal } from './queue/types.js';

const PROMPT_HASH = factMappingHash(FACT_MAPPING_ASSIST_BOUNDARY.promptBoundary);
const OUTPUT_SCHEMA_HASH = factMappingHash({
  exactCandidateFields: [
    'artifactId',
    'artifactKind',
    'claimIds',
    'domain',
    'draftVersionId',
    'endCodePoint',
    'kind',
    'materiality',
    'protectedSignalAcknowledged',
    'reasonCode',
    'relation',
    'selectedTextHash',
    'startCodePoint',
    'textHash',
  ],
  rootFields: ['candidates', 'schemaVersion'],
  schemaVersion: FACT_MAPPING_ASSIST_SCHEMA_VERSION,
});

export interface FactMappingModelSlotV1 {
  readonly modelId: string;
  readonly modelRole: string;
  readonly modelSlot: string;
  readonly parameterVersion: number;
  readonly protocolMode: ProtocolMode;
  readonly providerConfigFingerprint: string;
}

export interface FactMappingWorkflowPersistenceV1 {
  readonly completeLocalWorkflow: (executionId: string, now: string) => FactMappingStartExecution;
  readonly completeModelWorkflow: (input: {
    readonly executionId: string;
    readonly externalRequestCount: 0 | 1;
    readonly modelExecutionId: string | null;
    readonly now: string;
    readonly output: unknown;
  }) => FactMappingStartExecution;
  readonly loadWorkflowExecution: (executionId: string) => FactMappingWorkflowExecution;
  readonly markWorkflowRunning: (executionId: string, now: string) => FactMappingRunV1;
  readonly stopWorkflowRun: (input: {
    readonly executionId: string;
    readonly externalRequestCount: 0 | 1;
    readonly modelExecutionId: string | null;
    readonly now: string;
    readonly reasonCode: string;
    readonly status: 'AMBIGUOUS' | 'CANCELLED' | 'FAILED';
  }) => FactMappingRunV1;
}

export interface FactMappingCheckServiceOptions {
  readonly modelExecutionService?: ModelExecutionService;
  readonly modelSlot?: FactMappingModelSlotV1;
  readonly now?: () => string;
  readonly persistence: FactMappingWorkflowPersistenceV1;
}

export interface FactMappingJobResultV1 {
  readonly checkVersionId: string | null;
  readonly executionId: string;
  readonly externalRequestCount: 0 | 1;
  readonly reasonCode: string | null;
  readonly runId: string;
  readonly status: FactMappingRunV1['status'];
}

function terminal(status: FactMappingRunV1['status']): boolean {
  return [
    'AMBIGUOUS',
    'AWAITING_REVIEW',
    'CANCELLED',
    'FACT_BLOCKED',
    'FAILED',
    'PASS',
    'STALE',
    'SUPERSEDED',
  ].includes(status);
}

function publicResult(
  run: FactMappingRunV1,
  checkVersionId: string | null,
): FactMappingJobResultV1 {
  return Object.freeze({
    checkVersionId,
    executionId: run.executionId,
    externalRequestCount: run.externalRequestCount,
    reasonCode: run.reasonCode,
    runId: run.runId,
    status: run.status,
  });
}

function failureStatus(result: ModelExecutionResultV1): 'AMBIGUOUS' | 'CANCELLED' | 'FAILED' {
  if (result.status === 'CANCELLED_BEFORE_SEND') return 'CANCELLED';
  if (
    result.status === 'FAILED_AFTER_SEND' ||
    result.status === 'CANCELLED_AFTER_SEND' ||
    result.status === 'AMBIGUOUS'
  ) {
    return 'AMBIGUOUS';
  }
  return 'FAILED';
}

export class FactMappingCheckService {
  readonly #modelExecutionService: ModelExecutionService | undefined;
  readonly #modelSlot: FactMappingModelSlotV1 | undefined;
  readonly #now: () => string;
  readonly #persistence: FactMappingWorkflowPersistenceV1;

  public constructor(options: FactMappingCheckServiceOptions) {
    this.#modelExecutionService = options.modelExecutionService;
    this.#modelSlot = options.modelSlot;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#persistence = options.persistence;
  }

  public async execute(
    value: unknown,
    heartbeat: () => Promise<QueueControlSignal>,
    signal: AbortSignal,
  ): Promise<FactMappingJobResultV1> {
    const payload = assertFactMappingJobPayload(value);
    const execution = this.#persistence.loadWorkflowExecution(payload.executionId);
    this.#validatePayload(payload, execution);
    if (terminal(execution.run.status)) return publicResult(execution.run, null);
    const before = await heartbeat();
    if (before === 'PAUSE') return publicResult(execution.run, null);
    if (before === 'CANCEL' || signal.aborted) {
      return publicResult(
        this.#persistence.stopWorkflowRun({
          executionId: payload.executionId,
          externalRequestCount: 0,
          modelExecutionId: null,
          now: this.#now(),
          reasonCode: 'QUEUE_CANCELLED_BEFORE_SEND',
          status: 'CANCELLED',
        }),
        null,
      );
    }
    if (payload.mode === 'LOCAL_MANUAL') {
      this.#persistence.markWorkflowRunning(payload.executionId, this.#now());
      const completed = this.#persistence.completeLocalWorkflow(payload.executionId, this.#now());
      return publicResult(completed.run, completed.checkVersion.versionId);
    }
    if (this.#modelExecutionService === undefined || this.#modelSlot === undefined) {
      return publicResult(
        this.#persistence.stopWorkflowRun({
          executionId: payload.executionId,
          externalRequestCount: 0,
          modelExecutionId: null,
          now: this.#now(),
          reasonCode: 'STRUCTURED_MODEL_UNCONFIGURED',
          status: 'FAILED',
        }),
        null,
      );
    }
    this.#persistence.markWorkflowRunning(payload.executionId, this.#now());
    const modelResult = await this.#modelExecutionService.execute(
      this.#request(payload, execution, signal),
    );
    if (
      (modelResult.status === 'SUCCEEDED' || modelResult.status === 'CACHE_HIT') &&
      modelResult.output?.type === 'STRUCTURED'
    ) {
      const after = await heartbeat();
      if (after !== 'CONTINUE' || signal.aborted) {
        return publicResult(
          this.#persistence.stopWorkflowRun({
            executionId: payload.executionId,
            externalRequestCount: modelResult.externalRequestCount,
            modelExecutionId: modelResult.executionId,
            now: this.#now(),
            reasonCode:
              after === 'CANCEL' ? 'QUEUE_CANCELLED_AFTER_SEND' : 'QUEUE_PAUSED_AFTER_SEND',
            status: after === 'CANCEL' ? 'CANCELLED' : 'AMBIGUOUS',
          }),
          null,
        );
      }
      try {
        const completed = this.#persistence.completeModelWorkflow({
          executionId: payload.executionId,
          externalRequestCount: modelResult.externalRequestCount,
          modelExecutionId: modelResult.executionId,
          now: this.#now(),
          output: modelResult.output.value,
        });
        return publicResult(completed.run, completed.checkVersion.versionId);
      } catch (error) {
        if (!(error instanceof FactMappingError)) throw error;
        return publicResult(
          this.#persistence.stopWorkflowRun({
            executionId: payload.executionId,
            externalRequestCount: modelResult.externalRequestCount,
            modelExecutionId: modelResult.executionId,
            now: this.#now(),
            reasonCode: error.code,
            status: 'FAILED',
          }),
          null,
        );
      }
    }
    return publicResult(
      this.#persistence.stopWorkflowRun({
        executionId: payload.executionId,
        externalRequestCount: modelResult.externalRequestCount,
        modelExecutionId: modelResult.externalRequestCount === 1 ? modelResult.executionId : null,
        now: this.#now(),
        reasonCode: modelResult.stableErrorCode ?? 'FACT_MAPPING_MODEL_OUTPUT_INVALID',
        status: failureStatus(modelResult),
      }),
      null,
    );
  }

  #request(
    payload: FactMappingJobPayloadV1,
    execution: FactMappingWorkflowExecution,
    signal: AbortSignal,
  ): ModelExecutionRequestV1 {
    const slot = this.#modelSlot;
    if (slot === undefined) throw new FactMappingError('FACT_MAPPING_MODEL_BLOCKED');
    return Object.freeze({
      budgetClassification: 'NONESSENTIAL',
      cachePolicy: 'READ_WRITE',
      deadlineMs: 60_000,
      executionId: payload.executionId,
      generationOptions: Object.freeze({}),
      input: execution.assistInput,
      mediaIdentities: Object.freeze([]),
      modelId: slot.modelId,
      modelRole: slot.modelRole,
      modelSlot: slot.modelSlot,
      outputSchemaIdentity: Object.freeze({
        contentHash: OUTPUT_SCHEMA_HASH,
        id: FACT_MAPPING_ASSIST_SCHEMA_VERSION,
        version: 1,
      }),
      parameterVersion: slot.parameterVersion,
      promptIdentity: Object.freeze({
        contentHash: PROMPT_HASH,
        id: FACT_MAPPING_PROMPT_VERSION,
        version: 1,
      }),
      protocolMode: slot.protocolMode,
      providerConfigFingerprint: slot.providerConfigFingerprint,
      requiredCapabilities: Object.freeze(['structuredJson'] as const),
      signal,
      sourceIdentities: Object.freeze(
        execution.candidates.candidates
          .flatMap(({ evidence }) =>
            evidence.map(({ sourceContentHash }) =>
              Object.freeze({
                contentHash: sourceContentHash,
                kind: 'SOURCE' as const,
              }),
            ),
          )
          .slice(0, 512),
      ),
      taskKind: 'FACT_MAPPING_ASSIST',
      unitDemandUpperBound: Object.freeze({
        externalCalls: 1,
        imageGenerationCalls: 0,
        images: 0,
        inputTokens: null,
        outputTokens: 16_384,
        toolCalls: 0,
        webSearchCalls: 0,
      }),
    });
  }

  #validatePayload(
    payload: FactMappingJobPayloadV1,
    execution: FactMappingWorkflowExecution,
  ): void {
    if (
      execution.run.executionId !== payload.executionId ||
      execution.run.draftId !== payload.draftId ||
      execution.run.planId !== payload.planId ||
      execution.run.mode !== payload.mode ||
      execution.plan.draftVersionId !== payload.draftVersionId ||
      execution.plan.draftRevision !== payload.draftRevision ||
      execution.plan.inputHash !== payload.inputHash ||
      execution.plan.previewHash !== payload.previewHash ||
      execution.plan.dependencyHash !== payload.dependencyHash ||
      execution.candidates.inputHash !== payload.candidateHash ||
      execution.plan.maximumModelRequests !== (payload.mode === 'MODEL_ASSISTED' ? 1 : 0)
    ) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
  }
}

export function createFactMappingCheckJobHandler(service: FactMappingCheckService): JobHandler {
  return async (value, context) => {
    try {
      return (await service.execute(
        value,
        context.heartbeat,
        context.signal,
      )) as unknown as JsonValue;
    } catch (error) {
      if (error instanceof JobHandlerExecutionError) throw error;
      if (error instanceof FactMappingError) {
        throw new JobHandlerExecutionError(error.code, error.code);
      }
      throw error;
    }
  };
}

export function registerFactMappingCheckJob(
  registry: JobHandlerRegistry,
  service: FactMappingCheckService,
): void {
  registry.register(FACT_MAPPING_JOB_TYPE, createFactMappingCheckJobHandler(service));
}

export const FACT_MAPPING_MODEL_BOUNDARY = Object.freeze({
  allowedOutputFields: Object.freeze(['candidates', 'schemaVersion']),
  maximumModelRequests: 1,
  maximumOutputBytes: FACT_MAPPING_ASSIST_BOUNDARY.maximumOutputBytes,
  promptHash: PROMPT_HASH,
  promptVersion: FACT_MAPPING_PROMPT_VERSION,
  schemaHash: OUTPUT_SCHEMA_HASH,
  schemaVersion: FACT_MAPPING_ASSIST_SCHEMA_VERSION,
});
