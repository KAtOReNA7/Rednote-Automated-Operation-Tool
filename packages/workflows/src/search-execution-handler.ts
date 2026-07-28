import {
  SEARCH_JOB_TYPE,
  isSearchError,
  type SearchExecuteJobResultV1,
  type SearchExecutionService,
  validateSearchExecuteJobPayloadV1,
} from '@mystery-operations/search';

import type { JobHandler } from './queue/handler-registry.js';
import type { JobHandlerRegistry } from './queue/handler-registry.js';
import { JobHandlerExecutionError } from './queue/error-sanitizer.js';
import type { JsonValue } from './queue/types.js';

export function createSearchExecutionJobHandler(service: SearchExecutionService): JobHandler {
  return async (payload, context) => {
    try {
      const validated = validateSearchExecuteJobPayloadV1(payload);
      if (validated.request.jobId !== null && validated.request.jobId !== context.job.id) {
        throw new JobHandlerExecutionError('SEARCH_INVALID_REQUEST', 'SEARCH_INVALID_REQUEST');
      }
      const control = await context.heartbeat();
      if (control !== 'CONTINUE') {
        throw new JobHandlerExecutionError(
          'SEARCH_CANCELLED_BEFORE_SEND',
          'SEARCH_CANCELLED_BEFORE_SEND',
        );
      }
      const batch = await service.execute(validated.request, validated.plan, context.signal);
      const result: SearchExecuteJobResultV1 = Object.freeze({
        counts: Object.freeze({
          accepted: batch.counts.accepted,
          duplicates: batch.counts.duplicates,
          rejected: batch.counts.rejected,
        }),
        searchRunId: batch.searchRunId,
        stableError: batch.stableError,
        status: batch.status,
      });
      return result as unknown as JsonValue;
    } catch (error) {
      if (error instanceof JobHandlerExecutionError) throw error;
      if (isSearchError(error)) {
        throw new JobHandlerExecutionError(error.code, error.code);
      }
      throw error;
    }
  };
}

export function registerSearchExecutionJob(
  registry: JobHandlerRegistry,
  service: SearchExecutionService,
): void {
  registry.register(SEARCH_JOB_TYPE, createSearchExecutionJobHandler(service));
}
