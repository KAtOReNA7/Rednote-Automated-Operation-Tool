import type { DatabaseSync } from 'node:sqlite';

import {
  JobQueueRepository,
  connectDatabase,
  initializeDatabase,
} from '../../packages/db/src/index.js';
import {
  ExponentialBackoffPolicy,
  JobHandlerRegistry,
  JobQueueService,
} from '../../packages/workflows/src/index.js';
import type { JobHandler, QueueClock } from '../../packages/workflows/src/index.js';
import { createTemporaryDatabasePath } from './database-test-utils.js';

export class MutableQueueClock implements QueueClock {
  #date: Date;

  public constructor(iso = '2026-07-27T12:00:00.000Z') {
    this.#date = new Date(iso);
  }

  public advance(milliseconds: number): void {
    this.#date = new Date(this.#date.getTime() + milliseconds);
  }

  public now(): Date {
    return new Date(this.#date);
  }

  public set(iso: string): void {
    this.#date = new Date(iso);
  }
}

export interface QueueTestContext {
  readonly clock: MutableQueueClock;
  readonly database: DatabaseSync;
  readonly databasePath: string;
  readonly registry: JobHandlerRegistry;
  readonly repository: JobQueueRepository;
  readonly service: JobQueueService;
}

export async function createQueueTestContext(
  childDirectory = 'queue database',
): Promise<QueueTestContext> {
  const databasePath = createTemporaryDatabasePath(childDirectory);
  await initializeDatabase({ databasePath });
  const database = connectDatabase(databasePath);
  const clock = new MutableQueueClock();
  const registry = new JobHandlerRegistry();
  registry.register('TEST_SUCCESS', async (payload) => payload);
  let identifier = 0;
  const repository = new JobQueueRepository(database);
  const service = new JobQueueService(repository, registry, {
    backoffPolicy: new ExponentialBackoffPolicy({
      baseDelayMilliseconds: 1_000,
      jitterRatio: 0,
      maxDelayMilliseconds: 8_000,
    }),
    clock,
    idFactory: () => `generated-${++identifier}`,
    leaseDurationMilliseconds: 10_000,
  });

  return { clock, database, databasePath, registry, repository, service };
}

export function enqueueTestJob(
  context: QueueTestContext,
  options: {
    readonly availableAt?: Date;
    readonly idempotencyKey?: string;
    readonly jobType?: string;
    readonly maxAttempts?: number;
    readonly payload?: unknown;
    readonly priority?: number;
  } = {},
) {
  return context.service.enqueueJob({
    ...(options.availableAt === undefined ? {} : { availableAt: options.availableAt }),
    idempotencyKey: options.idempotencyKey ?? 'test-job',
    jobType: options.jobType ?? 'TEST_SUCCESS',
    maxAttempts: options.maxAttempts ?? 3,
    payload: options.payload ?? { value: 1 },
    priority: options.priority ?? 0,
  });
}

export function registerHandler(
  context: QueueTestContext,
  jobType: string,
  handler: JobHandler,
): void {
  context.registry.register(jobType, handler);
}
