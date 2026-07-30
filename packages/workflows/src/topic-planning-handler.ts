import {
  TOPIC_GENERATE_JOB_TYPE,
  TOPIC_GENERATION_JOB_CONTRACT_VERSION,
  TOPIC_QUOTA_JOB_CONTRACT_VERSION,
  TOPIC_QUOTA_PLAN_JOB_TYPE,
  TopicError,
  assertTopicGenerationJobPayload,
  assertTopicQuotaPlanJobPayload,
  type TopicGenerationJobPayloadV1,
  type TopicQuotaPlanJobPayloadV1,
} from '@mystery-operations/topics';

import { JobHandlerExecutionError } from './queue/error-sanitizer.js';
import type { JobHandler, JobHandlerRegistry } from './queue/handler-registry.js';
import type { JsonValue, QueueControlSignal } from './queue/types.js';

export interface TopicPlanningPersistence {
  cancelGenerationExecution(executionId: string, now: string): unknown;
  cancelQuotaPlanExecution(executionId: string, now: string): unknown;
  executeGenerationJob(
    payload: TopicGenerationJobPayloadV1,
    now: string,
    signal?: AbortSignal,
  ): Readonly<{
    createdCount: number;
    duplicateCount: number;
    externalRequestCount: 0;
    noOp: boolean;
    runId: string;
    status: 'SUCCEEDED' | 'NO_OP';
  }>;
  executeQuotaPlanJob(
    payload: TopicQuotaPlanJobPayloadV1,
    now: string,
    signal?: AbortSignal,
  ): Readonly<{
    planVersionId: string;
    status: 'COMPLETE' | 'INCOMPLETE' | 'STALE' | 'SUPERSEDED';
    totalSelected: number;
  }>;
  failGenerationExecution(executionId: string, errorCode: string, now: string): unknown;
  failQuotaPlanExecution(executionId: string, errorCode: string, now: string): unknown;
}

export type TopicPlanningJobResultV1 =
  | Readonly<{
      contractVersion: typeof TOPIC_GENERATION_JOB_CONTRACT_VERSION;
      createdCount: number;
      duplicateCount: number;
      executionId: string;
      externalRequestCount: 0;
      noOp: boolean;
      runId: string;
      status: 'CANCELLED' | 'PAUSED' | 'SUCCEEDED' | 'NO_OP';
    }>
  | Readonly<{
      contractVersion: typeof TOPIC_QUOTA_JOB_CONTRACT_VERSION;
      executionId: string;
      externalRequestCount: 0;
      planVersionId: string | null;
      status: 'CANCELLED' | 'PAUSED' | 'COMPLETE' | 'INCOMPLETE' | 'STALE' | 'SUPERSEDED';
      totalSelected: number;
    }>;

export interface TopicPlanningServiceOptions {
  readonly now?: () => string;
  readonly persistence: TopicPlanningPersistence;
}

export class TopicPlanningService {
  readonly #now: () => string;
  readonly #persistence: TopicPlanningPersistence;

  public constructor(options: TopicPlanningServiceOptions) {
    this.#persistence = options.persistence;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  public async executeGeneration(
    payloadValue: unknown,
    heartbeat: () => Promise<QueueControlSignal>,
    signal?: AbortSignal,
  ): Promise<TopicPlanningJobResultV1> {
    const payload = assertTopicGenerationJobPayload(payloadValue);
    const control = await heartbeat();
    if (control === 'PAUSE') {
      return Object.freeze({
        contractVersion: TOPIC_GENERATION_JOB_CONTRACT_VERSION,
        createdCount: 0,
        duplicateCount: 0,
        executionId: payload.executionId,
        externalRequestCount: 0,
        noOp: false,
        runId: payload.executionId,
        status: 'PAUSED',
      });
    }
    if (control === 'CANCEL' || signal?.aborted === true) {
      this.#persistence.cancelGenerationExecution(payload.executionId, this.#now());
      return Object.freeze({
        contractVersion: TOPIC_GENERATION_JOB_CONTRACT_VERSION,
        createdCount: 0,
        duplicateCount: 0,
        executionId: payload.executionId,
        externalRequestCount: 0,
        noOp: false,
        runId: payload.executionId,
        status: 'CANCELLED',
      });
    }
    try {
      const result = this.#persistence.executeGenerationJob(payload, this.#now(), signal);
      return Object.freeze({
        contractVersion: TOPIC_GENERATION_JOB_CONTRACT_VERSION,
        createdCount: result.createdCount,
        duplicateCount: result.duplicateCount,
        executionId: payload.executionId,
        externalRequestCount: 0,
        noOp: result.noOp,
        runId: result.runId,
        status: result.status,
      });
    } catch (error) {
      if (error instanceof TopicError) {
        this.#persistence.failGenerationExecution(payload.executionId, error.code, this.#now());
      }
      throw error;
    }
  }

  public async executeQuotaPlan(
    payloadValue: unknown,
    heartbeat: () => Promise<QueueControlSignal>,
    signal?: AbortSignal,
  ): Promise<TopicPlanningJobResultV1> {
    const payload = assertTopicQuotaPlanJobPayload(payloadValue);
    const control = await heartbeat();
    if (control === 'PAUSE' || control === 'CANCEL' || signal?.aborted === true) {
      if (control !== 'PAUSE') {
        this.#persistence.cancelQuotaPlanExecution(payload.executionId, this.#now());
      }
      return Object.freeze({
        contractVersion: TOPIC_QUOTA_JOB_CONTRACT_VERSION,
        executionId: payload.executionId,
        externalRequestCount: 0,
        planVersionId: null,
        status: control === 'PAUSE' ? 'PAUSED' : 'CANCELLED',
        totalSelected: 0,
      });
    }
    try {
      const result = this.#persistence.executeQuotaPlanJob(payload, this.#now(), signal);
      return Object.freeze({
        contractVersion: TOPIC_QUOTA_JOB_CONTRACT_VERSION,
        executionId: payload.executionId,
        externalRequestCount: 0,
        planVersionId: result.planVersionId,
        status: result.status,
        totalSelected: result.totalSelected,
      });
    } catch (error) {
      if (error instanceof TopicError) {
        this.#persistence.failQuotaPlanExecution(payload.executionId, error.code, this.#now());
      }
      throw error;
    }
  }
}

function safeHandler(action: () => Promise<TopicPlanningJobResultV1>): Promise<JsonValue> {
  return action()
    .then((result) => result as unknown as JsonValue)
    .catch((error: unknown) => {
      if (error instanceof JobHandlerExecutionError) throw error;
      if (error instanceof TopicError) {
        throw new JobHandlerExecutionError(error.code, error.code);
      }
      throw error;
    });
}

export function createTopicGenerationJobHandler(service: TopicPlanningService): JobHandler {
  return (payload, context) =>
    safeHandler(() => service.executeGeneration(payload, context.heartbeat, context.signal));
}

export function createTopicQuotaPlanJobHandler(service: TopicPlanningService): JobHandler {
  return (payload, context) =>
    safeHandler(() => service.executeQuotaPlan(payload, context.heartbeat, context.signal));
}

export function registerTopicPlanningJobs(
  registry: JobHandlerRegistry,
  persistence: TopicPlanningPersistence,
): TopicPlanningService {
  const service = new TopicPlanningService({ persistence });
  registry.register(TOPIC_GENERATE_JOB_TYPE, createTopicGenerationJobHandler(service));
  registry.register(TOPIC_QUOTA_PLAN_JOB_TYPE, createTopicQuotaPlanJobHandler(service));
  return service;
}
