import {
  BIBLIOGRAPHY_JOB_TYPE,
  type BibliographyDiscoveryService,
  isCatalogError,
  validateBibliographyJobPayloadV1,
} from '@mystery-operations/catalog';

import { JobHandlerExecutionError } from './queue/error-sanitizer.js';
import type { JobHandler, JobHandlerRegistry } from './queue/handler-registry.js';
import type { JsonValue } from './queue/types.js';

export function createBibliographyDiscoveryJobHandler(
  service: BibliographyDiscoveryService,
): JobHandler {
  return async (payload, context) => {
    try {
      const validated = validateBibliographyJobPayloadV1(payload);
      const result = await service.execute(
        validated.runId,
        validated.executionId,
        validated.planHash,
        {
          heartbeat: context.heartbeat,
          now: () => new Date(),
          signal: context.signal,
        },
      );
      return result as unknown as JsonValue;
    } catch (error) {
      if (error instanceof JobHandlerExecutionError) throw error;
      if (isCatalogError(error)) {
        throw new JobHandlerExecutionError(error.code, error.code);
      }
      throw error;
    }
  };
}

export function registerBibliographyDiscoveryJob(
  registry: JobHandlerRegistry,
  service: BibliographyDiscoveryService,
): void {
  registry.register(BIBLIOGRAPHY_JOB_TYPE, createBibliographyDiscoveryJobHandler(service));
}
