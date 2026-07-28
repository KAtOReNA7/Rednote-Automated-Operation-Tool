import {
  FETCH_JOB_TYPE,
  type FetchExecuteJobResultV1,
  type FetchExecutionService,
  type FetchPlanV1,
  isFetchError,
  validateFetchExecuteJobPayloadV1,
  validateFetchExecuteJobResultV1,
  validateFetchPlanV1,
} from '@mystery-operations/fetch';

import { JobHandlerExecutionError } from './queue/error-sanitizer.js';
import type { JobHandler, JobHandlerRegistry } from './queue/handler-registry.js';
import type { JsonValue } from './queue/types.js';

export interface FetchPlanReaderV1 {
  getPlan(planHash: string): Promise<FetchPlanV1 | null>;
}

export function createFetchExecutionJobHandler(
  service: FetchExecutionService,
  plans: FetchPlanReaderV1,
): JobHandler {
  return async (payload, context) => {
    try {
      const validated = validateFetchExecuteJobPayloadV1(payload);
      if (validated.request.jobId !== context.job.id) {
        throw new JobHandlerExecutionError('FETCH_INVALID_REQUEST', 'FETCH_INVALID_REQUEST');
      }
      const plan = await plans.getPlan(validated.planHash);
      if (plan === null || validateFetchPlanV1(plan).planHash !== validated.planHash) {
        throw new JobHandlerExecutionError('FETCH_PLAN_STALE', 'FETCH_PLAN_STALE');
      }
      const control = await context.heartbeat();
      if (control !== 'CONTINUE') {
        throw new JobHandlerExecutionError(
          'FETCH_CANCELLED_BEFORE_SEND',
          'FETCH_CANCELLED_BEFORE_SEND',
        );
      }
      const outcome = await service.execute(validated.request, plan, context.signal);
      const result: FetchExecuteJobResultV1 = Object.freeze({
        documentId: outcome.document?.documentId ?? null,
        externalRequestCount: outcome.externalRequestCount,
        fetchRunId: outcome.fetchRunId,
        receivedBytes: outcome.receivedBytes,
        redactionCounts: outcome.redactionCounts,
        redirectCount: outcome.redirectCount,
        stableError: outcome.stableError?.code ?? null,
        status: outcome.status,
      });
      return validateFetchExecuteJobResultV1(result) as unknown as JsonValue;
    } catch (error) {
      if (error instanceof JobHandlerExecutionError) throw error;
      if (isFetchError(error)) {
        throw new JobHandlerExecutionError(error.code, error.code);
      }
      throw error;
    }
  };
}

export function registerFetchExecutionJob(
  registry: JobHandlerRegistry,
  service: FetchExecutionService,
  plans: FetchPlanReaderV1,
): void {
  registry.register(FETCH_JOB_TYPE, createFetchExecutionJobHandler(service, plans));
}
