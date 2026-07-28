import { describe, expect, it } from 'vitest';

import {
  CuratedSourceAdapter,
  SEARCH_JOB_TYPE,
  SearchExecutionService,
  SearchPlanner,
  SearchProviderRegistry,
  type SearchBatchV1,
  type SearchRunPersistenceV1,
  validateSearchExecuteJobPayloadV1,
} from '../packages/search/src/index.js';
import {
  createSearchExecutionJobHandler,
  type Job,
  type JsonValue,
} from '../packages/workflows/src/index.js';
import { searchRequest } from './search-fixtures.js';

class MemoryPersistence implements SearchRunPersistenceV1 {
  beginRuns = 0;
  completed: SearchBatchV1 | null = null;
  externalReservations = 0;
  failures: string[] = [];

  async beginRun() {
    this.beginRuns += 1;
    return { searchRunId: 'run-001', state: 'CREATED' as const };
  }
  async findCompletedByExecutionId() {
    return this.completed;
  }
  async markAmbiguous() {}
  async markDispatchStarted() {}
  async reserveRate() {
    this.externalReservations += 1;
    return { providerInstanceId: 'remote', reservationId: 'reservation' };
  }
  async settleFailure(_id: string, input: { readonly stableError: string }) {
    this.failures.push(input.stableError);
  }
  async settleSuccess(batch: SearchBatchV1) {
    this.completed = batch;
  }
}

describe('SearchExecutionService', () => {
  it('validates bindings, persists one run and replays by executionId without a second call', async () => {
    const adapter = new CuratedSourceAdapter([
      {
        entryId: 'catalog',
        intent: 'BOOK_DISCOVERY',
        languageHint: null,
        title: 'Catalog',
        urlTemplate: 'https://example.com/search?q={query}',
      },
    ]);
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    const now = new Date('2026-07-28T00:00:00.000Z');
    const request = searchRequest();
    const planner = new SearchPlanner(registry, {
      idFactory: () => 'plan-001',
      now: () => now,
    });
    const plan = await planner.createPlan(
      request,
      { budgetIdentity: 'none', capabilityIdentity: 'none', settingsRevision: 1 },
      null,
      5_000,
    );
    const persistence = new MemoryPersistence();
    const service = new SearchExecutionService({
      bindingReader: () => ({
        budgetIdentity: 'none',
        capabilityIdentity: 'none',
        settingsRevision: 1,
      }),
      idFactory: () => 'run-001',
      now: () => now,
      persistence,
      registry,
    });
    const first = await service.execute(request, plan);
    const second = await service.execute(request, plan);
    expect(first.searchRunId).toBe('run-001');
    expect(second).toEqual(first);
    await expect(
      service.execute({ ...request, query: 'different request, same execution id' }, plan),
    ).rejects.toMatchObject({ code: 'SEARCH_EXECUTION_CONFLICT' });
    expect(persistence.beginRuns).toBe(1);
    expect(persistence.externalReservations).toBe(0);

    const cancelledPersistence = new MemoryPersistence();
    const cancelledService = new SearchExecutionService({
      bindingReader: () => ({
        budgetIdentity: 'none',
        capabilityIdentity: 'none',
        settingsRevision: 1,
      }),
      idFactory: () => 'cancelled-run',
      now: () => now,
      persistence: cancelledPersistence,
      registry,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(cancelledService.execute(request, plan, controller.signal)).rejects.toMatchObject({
      code: 'SEARCH_CANCELLED_BEFORE_SEND',
    });
    expect(cancelledPersistence.failures).toEqual(['SEARCH_CANCELLED_BEFORE_SEND']);

    const payload = validateSearchExecuteJobPayloadV1({
      contractVersion: 'search-provider-v1',
      jobType: SEARCH_JOB_TYPE,
      plan,
      request,
    });
    const handlerResult = await createSearchExecutionJobHandler(service)(
      payload as unknown as JsonValue,
      {
        heartbeat: async () => 'CONTINUE',
        job: { id: 'queue-search-job' } as Job,
        signal: new AbortController().signal,
      },
    );
    expect(handlerResult).toEqual({
      counts: { accepted: 1, duplicates: 0, rejected: 0 },
      searchRunId: 'run-001',
      stableError: null,
      status: 'SUCCEEDED',
    });
    expect(JSON.stringify(handlerResult)).not.toContain(request.query);
    expect(JSON.stringify(handlerResult)).not.toContain('candidates');
  });

  it('fails closed for stale plans and does not attempt fallback', async () => {
    const adapter = new CuratedSourceAdapter([
      {
        entryId: 'catalog',
        intent: 'BOOK_DISCOVERY',
        languageHint: null,
        title: 'Catalog',
        urlTemplate: 'https://example.com/search?q={query}',
      },
    ]);
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    const now = new Date('2026-07-28T00:00:00.000Z');
    const request = searchRequest();
    const plan = await new SearchPlanner(registry, {
      idFactory: () => 'plan-001',
      now: () => now,
    }).createPlan(
      request,
      { budgetIdentity: 'none', capabilityIdentity: 'none', settingsRevision: 1 },
      null,
      5_000,
    );
    const service = new SearchExecutionService({
      bindingReader: () => ({
        budgetIdentity: 'none',
        capabilityIdentity: 'none',
        settingsRevision: 1,
      }),
      idFactory: () => 'run-001',
      now: () => now,
      persistence: new MemoryPersistence(),
      registry,
    });
    await expect(
      service.execute({ ...request, query: 'changed query' }, plan),
    ).rejects.toMatchObject({ code: 'SEARCH_PLAN_STALE' });
    expect(plan.fallback).toBe('NONE');

    const staleBindingService = new SearchExecutionService({
      bindingReader: () => ({
        budgetIdentity: 'none',
        capabilityIdentity: 'changed-capability',
        settingsRevision: 2,
      }),
      idFactory: () => 'run-002',
      now: () => now,
      persistence: new MemoryPersistence(),
      registry,
    });
    await expect(staleBindingService.execute(request, plan)).rejects.toMatchObject({
      code: 'SEARCH_PLAN_STALE',
    });
  });
});
