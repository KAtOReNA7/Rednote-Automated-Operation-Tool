import {
  SEARCH_JOB_TYPE,
  SEARCH_PROVIDER_CONTRACT_VERSION,
  type SearchBatchStatus,
  type SearchOutcomeCertainty,
} from './constants.js';
import {
  type SearchBatchV1,
  type SearchPlanBindingV1,
  type SearchPlanV1,
  type SearchRatePolicyV1,
  type SearchRequestV1,
  searchRequestSemanticHash,
  validateSearchBatchV1,
  validateSearchProviderDescriptorV1,
  validateSearchRequestV1,
} from './contracts.js';
import { SearchError, isSearchError } from './errors.js';
import { validateSearchPlanForExecution, validateSearchPlanV1 } from './registry.js';
import type { SearchProviderRegistry } from './registry.js';

export interface SearchRateReservationV1 {
  readonly providerInstanceId: string;
  readonly reservationId: string;
}

export interface SearchRunPersistenceV1 {
  beginRun(input: {
    readonly plan: SearchPlanV1;
    readonly request: SearchRequestV1;
    readonly requestSemanticHash: string;
    readonly searchRunId: string;
    readonly startedAt: string;
  }): Promise<{
    readonly searchRunId: string;
    readonly state:
      | 'CREATED'
      | 'EXISTING_AMBIGUOUS'
      | 'EXISTING_COMPLETED'
      | 'EXISTING_IN_FLIGHT'
      | 'RECOVERED_PRE_SEND';
  }>;
  findCompletedByExecutionId(executionId: string): Promise<SearchBatchV1 | null>;
  markDispatchStarted(searchRunId: string, startedAt: string): Promise<void>;
  markAmbiguous(searchRunId: string, stableError: string, finishedAt: string): Promise<void>;
  reserveRate(input: {
    readonly now: string;
    readonly policy: SearchRatePolicyV1;
    readonly providerInstanceId: string;
    readonly searchRunId: string;
  }): Promise<SearchRateReservationV1>;
  settleFailure(
    searchRunId: string,
    input: {
      readonly certainty: SearchOutcomeCertainty;
      readonly externalRequestCount: 0 | 1;
      readonly finishedAt: string;
      readonly releaseRateReservation: boolean;
      readonly retryAfterSeconds: number | null;
      readonly stableError: string;
      readonly status: SearchBatchStatus;
    },
  ): Promise<void>;
  settleSuccess(batch: SearchBatchV1, reservation: SearchRateReservationV1 | null): Promise<void>;
}

export interface SearchExecutionServiceOptions {
  readonly bindingReader: () => SearchPlanBindingV1;
  readonly idFactory: () => string;
  readonly now?: () => Date;
  readonly persistence: SearchRunPersistenceV1;
  readonly registry: SearchProviderRegistry;
}

function errorTerminal(error: SearchError): {
  readonly certainty: SearchOutcomeCertainty;
  readonly externalRequestCount: 0 | 1;
  readonly status: SearchBatchStatus;
} {
  if (error.code === 'SEARCH_RATE_LIMITED' && error.sendState === 'NOT_SENT') {
    return { certainty: 'NOT_SENT', externalRequestCount: 0, status: 'RATE_LIMITED_BEFORE_SEND' };
  }
  if (error.code === 'SEARCH_BUDGET_BLOCKED') {
    return {
      certainty: 'REJECTED_BEFORE_EXECUTION',
      externalRequestCount: 0,
      status: 'BUDGET_BLOCKED',
    };
  }
  if (
    error.code === 'SEARCH_CAPABILITY_UNKNOWN' ||
    error.code === 'SEARCH_CAPABILITY_STALE' ||
    error.code === 'SEARCH_CAPABILITY_UNSUPPORTED'
  ) {
    return {
      certainty: 'REJECTED_BEFORE_EXECUTION',
      externalRequestCount: 0,
      status: 'CAPABILITY_BLOCKED',
    };
  }
  if (error.code === 'SEARCH_CANCELLED_BEFORE_SEND') {
    return { certainty: 'NOT_SENT', externalRequestCount: 0, status: 'CANCELLED_BEFORE_SEND' };
  }
  if (error.code === 'SEARCH_CANCELLED_AFTER_SEND') {
    return {
      certainty: 'MAY_HAVE_EXECUTED',
      externalRequestCount: 1,
      status: 'CANCELLED_AFTER_SEND',
    };
  }
  if (error.code === 'SEARCH_AMBIGUOUS' || error.sendState === 'UNKNOWN') {
    return { certainty: 'MAY_HAVE_EXECUTED', externalRequestCount: 1, status: 'AMBIGUOUS' };
  }
  if (error.sendState === 'SENT') {
    return {
      certainty: 'COMPLETED_INVALID_OUTPUT',
      externalRequestCount: 1,
      status: 'FAILED_AFTER_SEND',
    };
  }
  return { certainty: 'NOT_SENT', externalRequestCount: 0, status: 'FAILED_BEFORE_SEND' };
}

function cancellationRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export class SearchExecutionService {
  readonly #idFactory: () => string;
  readonly #bindingReader: () => SearchPlanBindingV1;
  readonly #now: () => Date;
  readonly #persistence: SearchRunPersistenceV1;
  readonly #registry: SearchProviderRegistry;

  public constructor(options: SearchExecutionServiceOptions) {
    this.#idFactory = options.idFactory;
    this.#bindingReader = options.bindingReader;
    this.#now = options.now ?? (() => new Date());
    this.#persistence = options.persistence;
    this.#registry = options.registry;
  }

  public async execute(
    requestValue: SearchRequestV1,
    planValue: SearchPlanV1,
    signal?: AbortSignal,
  ): Promise<SearchBatchV1> {
    const request = validateSearchRequestV1(requestValue);
    const plan = validateSearchPlanV1(planValue);
    const requestHash = searchRequestSemanticHash(request);
    const existing = await this.#persistence.findCompletedByExecutionId(request.executionId);
    if (existing !== null) {
      const validated = validateSearchBatchV1(existing);
      if (validated.requestSemanticHash !== requestHash) {
        throw new SearchError('SEARCH_EXECUTION_CONFLICT');
      }
      return validated;
    }
    const provider = this.#registry.get(request.providerInstanceId);
    const currentDescriptor = validateSearchProviderDescriptorV1(provider.describe());
    validateSearchPlanForExecution(
      plan,
      request,
      this.#bindingReader(),
      currentDescriptor,
      this.#now(),
    );
    if (currentDescriptor.readiness !== 'READY') {
      throw new SearchError('SEARCH_PROVIDER_NOT_READY');
    }
    const proposedSearchRunId = this.#idFactory();
    const startedAt = this.#now().toISOString();
    const begin = await this.#persistence.beginRun({
      plan,
      request,
      requestSemanticHash: requestHash,
      searchRunId: proposedSearchRunId,
      startedAt,
    });
    if (begin.state === 'EXISTING_AMBIGUOUS') {
      throw new SearchError('SEARCH_AMBIGUOUS', { sendState: 'UNKNOWN' });
    }
    if (begin.state === 'EXISTING_COMPLETED') {
      const completed = await this.#persistence.findCompletedByExecutionId(request.executionId);
      if (completed === null) throw new SearchError('SEARCH_EXECUTION_CONFLICT');
      if (completed.requestSemanticHash !== requestHash) {
        throw new SearchError('SEARCH_EXECUTION_CONFLICT');
      }
      return validateSearchBatchV1(completed);
    }
    if (begin.state === 'EXISTING_IN_FLIGHT') {
      throw new SearchError('SEARCH_EXECUTION_CONFLICT');
    }
    const searchRunId = begin.searchRunId;
    let reservation: SearchRateReservationV1 | null = null;
    try {
      if (cancellationRequested(signal)) {
        throw new SearchError('SEARCH_CANCELLED_BEFORE_SEND');
      }
      if (plan.provider.mode === 'ACTIVE_REMOTE') {
        if (plan.ratePolicy === null) throw new SearchError('SEARCH_RATE_POLICY_REQUIRED');
        reservation = await this.#persistence.reserveRate({
          now: this.#now().toISOString(),
          policy: plan.ratePolicy,
          providerInstanceId: plan.provider.providerInstanceId,
          searchRunId,
        });
        if (cancellationRequested(signal)) {
          throw new SearchError('SEARCH_CANCELLED_BEFORE_SEND');
        }
        await this.#persistence.markDispatchStarted(searchRunId, this.#now().toISOString());
      }
      const batch = validateSearchBatchV1(
        await provider.execute(request, {
          now: this.#now,
          plan,
          searchRunId,
          ...(signal === undefined ? {} : { signal }),
        }),
      );
      await this.#persistence.settleSuccess(batch, reservation);
      return batch;
    } catch (cause) {
      const error = isSearchError(cause)
        ? cause
        : new SearchError('SEARCH_INTERNAL', { cause, sendState: 'UNKNOWN' });
      const terminal = errorTerminal(error);
      await this.#persistence.settleFailure(searchRunId, {
        ...terminal,
        finishedAt: this.#now().toISOString(),
        releaseRateReservation: reservation !== null,
        retryAfterSeconds:
          typeof error.safeDetails.retryAfterSeconds === 'number'
            ? error.safeDetails.retryAfterSeconds
            : null,
        stableError: error.code,
      });
      throw error;
    }
  }
}

export interface SearchExecuteJobPayloadV1 {
  readonly contractVersion: typeof SEARCH_PROVIDER_CONTRACT_VERSION;
  readonly jobType: typeof SEARCH_JOB_TYPE;
  readonly plan: SearchPlanV1;
  readonly request: SearchRequestV1;
}

export interface SearchExecuteJobResultV1 {
  readonly counts: {
    readonly accepted: number;
    readonly duplicates: number;
    readonly rejected: number;
  };
  readonly searchRunId: string;
  readonly stableError: string | null;
  readonly status: SearchBatchStatus;
}

export function validateSearchExecuteJobPayloadV1(value: unknown): SearchExecuteJobPayloadV1 {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'contractVersion,jobType,plan,request'
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  const payload = value as Record<string, unknown>;
  if (
    payload.contractVersion !== SEARCH_PROVIDER_CONTRACT_VERSION ||
    payload.jobType !== SEARCH_JOB_TYPE
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  return Object.freeze({
    contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
    jobType: SEARCH_JOB_TYPE,
    plan: validateSearchPlanV1(payload.plan),
    request: validateSearchRequestV1(payload.request),
  });
}
