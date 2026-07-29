import {
  DOSSIER_JOB_TYPE,
  DossierError,
  validateDossierBuildJobPayload,
  type DossierBuildJobPayload,
} from '@mystery-operations/dossier';
import type { DossierBuildExecutionResult, SqliteDossierRepository } from '@mystery-operations/db';

import { JobHandlerExecutionError } from './queue/error-sanitizer.js';
import type { JobHandler, JobHandlerRegistry } from './queue/handler-registry.js';
import type { JsonValue, QueueControlSignal } from './queue/types.js';

export interface DossierBuildPersistence {
  cancelExecution(executionId: string, now: string): unknown;
  executeBuild(
    payload: DossierBuildJobPayload,
    now: string,
    signal?: AbortSignal,
  ): DossierBuildExecutionResult;
  failBuild(executionId: string, errorCode: string, now: string, ambiguous?: boolean): unknown;
}

export interface DossierBuildServiceOptions {
  readonly now?: () => string;
  readonly persistence: DossierBuildPersistence;
}

export interface DossierBuildResultV1 {
  readonly costState: 'NOT_INCURRED';
  readonly externalRequestCount: 0;
  readonly noOp: boolean;
  readonly runId: string;
  readonly status: 'CANCELLED' | 'PAUSED' | 'SUCCEEDED';
  readonly versionId: string | null;
}

function result(
  status: DossierBuildResultV1['status'],
  runId: string,
  versionId: string | null,
  noOp: boolean,
): DossierBuildResultV1 {
  return Object.freeze({
    costState: 'NOT_INCURRED',
    externalRequestCount: 0,
    noOp,
    runId,
    status,
    versionId,
  });
}

export class DossierBuildService {
  readonly #now: () => string;
  readonly #persistence: DossierBuildPersistence;

  public constructor(options: DossierBuildServiceOptions) {
    this.#persistence = options.persistence;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  public async execute(
    payloadValue: unknown,
    heartbeat: () => Promise<QueueControlSignal>,
  ): Promise<DossierBuildResultV1> {
    const payload = validateDossierBuildJobPayload(payloadValue);
    const control = await heartbeat();
    if (control === 'PAUSE') {
      return result('PAUSED', payload.executionId, null, false);
    }
    if (control === 'CANCEL') {
      const cancelled = this.#persistence.cancelExecution(payload.executionId, this.#now()) as {
        readonly runId?: string;
      };
      return result('CANCELLED', cancelled.runId ?? payload.executionId, null, false);
    }
    try {
      const executed = this.#persistence.executeBuild(payload, this.#now());
      return result('SUCCEEDED', executed.run.runId, executed.versionId, executed.noOp);
    } catch (error) {
      if (error instanceof DossierError) {
        this.#persistence.failBuild(payload.executionId, error.code, this.#now(), false);
      }
      throw error;
    }
  }
}

export function createDossierBuildJobHandler(service: DossierBuildService): JobHandler {
  return async (payload, context) => {
    try {
      const buildResult = await service.execute(payload, context.heartbeat);
      return buildResult as unknown as JsonValue;
    } catch (error) {
      if (error instanceof JobHandlerExecutionError) throw error;
      if (error instanceof DossierError) {
        throw new JobHandlerExecutionError(error.code, error.code);
      }
      throw error;
    }
  };
}

export function registerDossierBuildJob(
  registry: JobHandlerRegistry,
  persistence: SqliteDossierRepository,
): DossierBuildService {
  const service = new DossierBuildService({ persistence });
  registry.register(DOSSIER_JOB_TYPE, createDossierBuildJobHandler(service));
  return service;
}
