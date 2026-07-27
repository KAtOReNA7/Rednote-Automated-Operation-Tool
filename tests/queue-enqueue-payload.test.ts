import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { JobQueueRepository, connectDatabase } from '../packages/db/src/index.js';
import {
  JobHandlerRegistry,
  JobPayloadValidationError,
  JobPayloadValidator,
  JobQueueService,
  JobQueueServiceError,
} from '../packages/workflows/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import {
  createQueueTestContext,
  enqueueTestJob,
  type QueueTestContext,
} from './support/queue-test-utils.js';

const openDatabases: DatabaseSync[] = [];

async function context(): Promise<QueueTestContext> {
  const created = await createQueueTestContext();
  openDatabases.push(created.database);
  return created;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('queue enqueue and payload contracts', () => {
  it('enqueues a durable job with normalized defaults', async () => {
    const test = await context();
    const job = enqueueTestJob(test);

    expect(job).toMatchObject({
      attemptCount: 0,
      idempotencyKey: 'test-job',
      jobType: 'TEST_SUCCESS',
      maxAttempts: 3,
      payload: { value: 1 },
      priority: 0,
      status: 'QUEUED',
    });
    expect(test.service.getJob(job.id)).toEqual(job);
  });

  it('persists delayed availability and does not claim early', async () => {
    const test = await context();
    const availableAt = new Date(test.clock.now().getTime() + 60_000);
    const job = enqueueTestJob(test, { availableAt });

    expect(job.nextRunAt).toBe(availableAt.toISOString());
    expect(test.service.claimNextJob('worker-1')).toBeNull();
  });

  it('returns the same job for the same key, type, and semantic payload', async () => {
    const test = await context();
    const first = enqueueTestJob(test, {
      idempotencyKey: 'same',
      payload: { a: 1, b: 2 },
    });
    const second = enqueueTestJob(test, {
      idempotencyKey: 'same',
      payload: { b: 2, a: 1 },
    });

    expect(second.id).toBe(first.id);
    expect(second.payloadHash).toBe(first.payloadHash);
    expect(test.service.getQueueStats().total).toBe(1);
  });

  it('rejects an idempotency key reused for another registered type', async () => {
    const test = await context();
    test.registry.register('TEST_OTHER', async () => null);
    enqueueTestJob(test, { idempotencyKey: 'type-conflict' });

    expect(() =>
      enqueueTestJob(test, {
        idempotencyKey: 'type-conflict',
        jobType: 'TEST_OTHER',
      }),
    ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('rejects an idempotency key reused for different payload content', async () => {
    const test = await context();
    enqueueTestJob(test, {
      idempotencyKey: 'payload-conflict',
      payload: { value: 1 },
    });

    expect(() =>
      enqueueTestJob(test, {
        idempotencyKey: 'payload-conflict',
        payload: { value: 2 },
      }),
    ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('creates only one row when independent connections use the same idempotency key', async () => {
    const test = await context();
    const secondDatabase = connectDatabase(test.databasePath);
    openDatabases.push(secondDatabase);
    const secondRegistry = new JobHandlerRegistry();
    secondRegistry.register('TEST_SUCCESS', async (payload) => payload);
    const secondService = new JobQueueService(
      new JobQueueRepository(secondDatabase),
      secondRegistry,
      {
        clock: test.clock,
        idFactory: () => 'second-generated-id',
      },
    );

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => enqueueTestJob(test, { idempotencyKey: 'connection-race' })),
      Promise.resolve().then(() =>
        secondService.enqueueJob({
          idempotencyKey: 'connection-race',
          jobType: 'TEST_SUCCESS',
          maxAttempts: 3,
          payload: { value: 1 },
          priority: 0,
        }),
      ),
    ]);

    expect(second.id).toBe(first.id);
    expect(
      test.database
        .prepare("SELECT count(*) AS count FROM jobs WHERE idempotency_key = 'connection-race'")
        .get(),
    ).toEqual({ count: 1 });
  });

  it('canonicalizes object keys recursively before hashing', () => {
    const validator = new JobPayloadValidator();
    const first = validator.validate({ z: [{ b: 2, a: 1 }], a: true });
    const second = validator.validate({ a: true, z: [{ a: 1, b: 2 }] });

    expect(second).toEqual(first);
    expect(first.json).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
  });

  it.each([
    ['undefined', undefined],
    ['function', () => undefined],
    ['symbol', Symbol('invalid')],
    ['date', new Date()],
    ['non-finite number', Number.POSITIVE_INFINITY],
  ])('rejects invalid JSON value: %s', (_label, value) => {
    expect(() => new JobPayloadValidator().validate(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_JSON_VALUE' }),
    );
  });

  it('rejects circular JSON input', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => new JobPayloadValidator().validate(circular)).toThrow(
      expect.objectContaining({ code: 'INVALID_JSON_VALUE' }),
    );
  });

  it('rejects symbol-keyed object properties instead of silently dropping them', () => {
    const payload = { visible: true, [Symbol('hidden')]: 'not-json' };
    expect(() => new JobPayloadValidator().validate(payload)).toThrow(
      expect.objectContaining({ code: 'INVALID_JSON_VALUE' }),
    );
  });

  it('rejects payloads larger than the configured byte boundary', () => {
    const validator = new JobPayloadValidator({ maxBytes: 16 });
    expect(() => validator.validate({ text: 'x'.repeat(100) })).toThrow(
      expect.objectContaining({ code: 'JSON_TOO_LARGE' }),
    );
  });

  it.each([
    { password: 'do-not-store' },
    { nested: { api_key: 'do-not-store' } },
    { authorization: 'Bearer do-not-store' },
    { accessToken: 'do-not-store' },
  ])('rejects obvious credential fields in persisted payloads', (payload) => {
    expect(() => new JobPayloadValidator().validate(payload)).toThrow(JobPayloadValidationError);
  });

  it('rejects credentials embedded in idempotency keys', async () => {
    const test = await context();
    expect(() =>
      enqueueTestJob(test, { idempotencyKey: 'authorization=Bearer secret-value' }),
    ).toThrow(expect.objectContaining({ code: 'CREDENTIAL_FIELD_FORBIDDEN' }));
  });

  it('requires a locally registered handler before enqueue', async () => {
    const test = await context();
    expect(() => enqueueTestJob(test, { jobType: 'NOT_REGISTERED' })).toThrow(JobQueueServiceError);
  });
});
