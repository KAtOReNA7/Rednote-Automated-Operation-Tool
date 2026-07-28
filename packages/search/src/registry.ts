import { randomUUID } from 'node:crypto';

import {
  SEARCH_FEATURES,
  SEARCH_LIMITS,
  SEARCH_OVERALL_READINESS,
  SEARCH_PLAN_CONTRACT_VERSION,
  type SearchOverallReadiness,
} from './constants.js';
import {
  type SearchPlanBindingV1,
  type SearchPlanV1,
  type SearchProviderDescriptorV1,
  type SearchProviderV1,
  type SearchRatePolicyV1,
  type SearchRequestV1,
  searchRequestSemanticHash,
  validateSearchProviderDescriptorV1,
  validateSearchRatePolicyV1,
  validateSearchRequestV1,
} from './contracts.js';
import { SearchError } from './errors.js';
import { searchSemanticHash } from './identity.js';

export class SearchProviderRegistry {
  readonly #providers = new Map<string, SearchProviderV1>();

  public register(provider: SearchProviderV1): void {
    const descriptor = validateSearchProviderDescriptorV1(provider.describe());
    if (this.#providers.has(descriptor.providerInstanceId)) {
      throw new SearchError('SEARCH_EXECUTION_CONFLICT', {
        safeDetails: { reason: 'DUPLICATE_PROVIDER_INSTANCE' },
      });
    }
    this.#providers.set(descriptor.providerInstanceId, provider);
  }

  public get(providerInstanceId: string): SearchProviderV1 {
    const provider = this.#providers.get(providerInstanceId);
    if (provider === undefined) throw new SearchError('SEARCH_PROVIDER_NOT_FOUND');
    return provider;
  }

  public list(): readonly SearchProviderDescriptorV1[] {
    return Object.freeze(
      [...this.#providers.values()]
        .map((provider) => validateSearchProviderDescriptorV1(provider.describe()))
        .sort((left, right) => left.providerInstanceId.localeCompare(right.providerInstanceId)),
    );
  }

  public overallReadiness(): SearchOverallReadiness {
    const descriptors = this.list();
    const activeReady = descriptors.filter(
      (item) => item.mode === 'ACTIVE_REMOTE' && item.readiness === 'READY',
    );
    const activeProblems = descriptors.filter(
      (item) =>
        item.mode === 'ACTIVE_REMOTE' &&
        !['READY', 'DISABLED', 'NOT_CONFIGURED', 'CODEC_UNAVAILABLE'].includes(item.readiness),
    );
    if (activeReady.length > 0) {
      return activeProblems.length > 0 ? 'DEGRADED' : 'ACTIVE_SEARCH_READY';
    }
    if (descriptors.some((item) => item.mode === 'PASSIVE_LOCAL' && item.readiness === 'READY')) {
      return 'PASSIVE_ONLY';
    }
    return SEARCH_OVERALL_READINESS[2];
  }
}

export interface SearchPlannerOptions {
  readonly idFactory?: () => string;
  readonly now?: () => Date;
  readonly planLifetimeMs?: number;
}

function validateBinding(binding: SearchPlanBindingV1): SearchPlanBindingV1 {
  if (
    Object.keys(binding).sort().join(',') !==
      'budgetIdentity,capabilityIdentity,settingsRevision' ||
    binding.budgetIdentity.length < 1 ||
    binding.budgetIdentity.length > 128 ||
    binding.capabilityIdentity.length < 1 ||
    binding.capabilityIdentity.length > 256 ||
    !Number.isSafeInteger(binding.settingsRevision) ||
    binding.settingsRevision < 0
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  return Object.freeze({ ...binding });
}

function planIdentity(plan: Omit<SearchPlanV1, 'planHash'>): string {
  return searchSemanticHash(plan);
}

export class SearchPlanner {
  readonly #idFactory: () => string;
  readonly #now: () => Date;
  readonly #planLifetimeMs: number;
  readonly #registry: SearchProviderRegistry;

  public constructor(registry: SearchProviderRegistry, options: SearchPlannerOptions = {}) {
    this.#registry = registry;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
    this.#planLifetimeMs = options.planLifetimeMs ?? 5 * 60_000;
    if (
      !Number.isSafeInteger(this.#planLifetimeMs) ||
      this.#planLifetimeMs < 1_000 ||
      this.#planLifetimeMs > 30 * 60_000
    ) {
      throw new RangeError('planLifetimeMs is outside the supported range.');
    }
  }

  public async createPlan(
    requestValue: SearchRequestV1,
    bindingValue: SearchPlanBindingV1,
    ratePolicyValue: SearchRatePolicyV1 | null,
    timeoutMs: number,
  ): Promise<SearchPlanV1> {
    const request = validateSearchRequestV1(requestValue);
    const binding = validateBinding(bindingValue);
    const provider = this.#registry.get(request.providerInstanceId);
    const descriptor = validateSearchProviderDescriptorV1(provider.describe());
    const preview = await provider.preview(request);
    if (descriptor.readiness !== 'READY' || preview.readiness !== 'READY') {
      throw new SearchError('SEARCH_PROVIDER_NOT_READY');
    }
    let ratePolicy: SearchRatePolicyV1 | null = null;
    if (descriptor.mode === 'ACTIVE_REMOTE') {
      if (ratePolicyValue === null || request.ratePolicyRef === null) {
        throw new SearchError('SEARCH_RATE_POLICY_REQUIRED');
      }
      ratePolicy = validateSearchRatePolicyV1(ratePolicyValue);
      if (
        ratePolicy.maxResults < request.maxResults ||
        ratePolicy.maxResponseBytes > descriptor.maxResponseBytes
      ) {
        throw new SearchError('SEARCH_INVALID_REQUEST');
      }
    } else if (ratePolicyValue !== null || request.ratePolicyRef !== null) {
      throw new SearchError('SEARCH_INVALID_REQUEST');
    }
    if (
      preview.contractVersion !== descriptor.contractVersion ||
      preview.providerInstanceId !== descriptor.providerInstanceId ||
      preview.requestSemanticHash !== searchRequestSemanticHash(request) ||
      preview.maxResults < 1 ||
      preview.maxResults > Math.min(request.maxResults, descriptor.maxResults) ||
      preview.estimatedExternalRequests !== (descriptor.mode === 'ACTIVE_REMOTE' ? 1 : 0) ||
      !Number.isSafeInteger(preview.estimatedInternalSearchCalls) ||
      preview.estimatedInternalSearchCalls < 0 ||
      preview.featureApplications.length !== SEARCH_FEATURES.length ||
      preview.warnings.length > 16
    ) {
      throw new SearchError('SEARCH_INVALID_REQUEST');
    }
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 600_000 ||
      (ratePolicy !== null && timeoutMs > ratePolicy.timeoutMs)
    ) {
      throw new SearchError('SEARCH_INVALID_REQUEST');
    }
    const now = this.#now();
    const withoutHash: Omit<SearchPlanV1, 'planHash'> = {
      binding,
      contractVersion: SEARCH_PLAN_CONTRACT_VERSION,
      estimatedExternalRequests: preview.estimatedExternalRequests,
      estimatedInternalSearchCalls: preview.estimatedInternalSearchCalls,
      expiresAt: new Date(now.getTime() + this.#planLifetimeMs).toISOString(),
      fallback: 'NONE',
      featureApplications: preview.featureApplications,
      maxResults: preview.maxResults,
      planId: this.#idFactory(),
      provider: descriptor,
      ratePolicy,
      requestSemanticHash: searchRequestSemanticHash(request),
      timeoutMs,
    };
    return validateSearchPlanV1({
      ...withoutHash,
      planHash: planIdentity(withoutHash),
    });
  }
}

export function validateSearchPlanForExecution(
  plan: SearchPlanV1,
  request: SearchRequestV1,
  binding: SearchPlanBindingV1,
  currentDescriptor: SearchProviderDescriptorV1,
  now: Date,
): void {
  const { planHash, ...withoutHash } = plan;
  if (
    plan.contractVersion !== SEARCH_PLAN_CONTRACT_VERSION ||
    planHash !== planIdentity(withoutHash) ||
    plan.requestSemanticHash !== searchRequestSemanticHash(request) ||
    plan.provider.providerInstanceId !== request.providerInstanceId ||
    searchSemanticHash(plan.provider) !== searchSemanticHash(currentDescriptor) ||
    searchSemanticHash(plan.binding) !== searchSemanticHash(validateBinding(binding)) ||
    !Number.isFinite(now.getTime()) ||
    Date.parse(plan.expiresAt) <= now.getTime() ||
    plan.fallback !== 'NONE'
  ) {
    throw new SearchError('SEARCH_PLAN_STALE');
  }
}

export function validateSearchPlanV1(value: unknown): SearchPlanV1 {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      [
        'binding',
        'contractVersion',
        'estimatedExternalRequests',
        'estimatedInternalSearchCalls',
        'expiresAt',
        'fallback',
        'featureApplications',
        'maxResults',
        'planHash',
        'planId',
        'provider',
        'ratePolicy',
        'requestSemanticHash',
        'timeoutMs',
      ]
        .sort()
        .join(',')
  ) {
    throw new SearchError('SEARCH_PLAN_STALE');
  }
  const plan = value as SearchPlanV1;
  const { planHash, ...withoutHash } = plan;
  const expiresAt = Date.parse(plan.expiresAt);
  if (
    plan.contractVersion !== SEARCH_PLAN_CONTRACT_VERSION ||
    plan.fallback !== 'NONE' ||
    !/^[0-9a-f]{64}$/u.test(planHash) ||
    planHash !== planIdentity(withoutHash) ||
    typeof plan.planId !== 'string' ||
    plan.planId.length < 1 ||
    plan.planId.length > SEARCH_LIMITS.identifierCharacters ||
    !/^[0-9a-f]{64}$/u.test(plan.requestSemanticHash) ||
    !Number.isFinite(expiresAt) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(plan.expiresAt) ||
    !Number.isSafeInteger(plan.timeoutMs) ||
    plan.timeoutMs < 100 ||
    plan.timeoutMs > 600_000 ||
    (plan.estimatedExternalRequests !== 0 && plan.estimatedExternalRequests !== 1) ||
    !Number.isSafeInteger(plan.estimatedInternalSearchCalls) ||
    plan.estimatedInternalSearchCalls < 0 ||
    !Number.isSafeInteger(plan.maxResults) ||
    plan.maxResults < 1 ||
    plan.maxResults > SEARCH_LIMITS.maxCandidates ||
    !Array.isArray(plan.featureApplications) ||
    plan.featureApplications.length !== SEARCH_FEATURES.length
  ) {
    throw new SearchError('SEARCH_PLAN_STALE');
  }
  const descriptor = validateSearchProviderDescriptorV1(plan.provider);
  validateBinding(plan.binding);
  const applications = plan.featureApplications;
  if (
    applications.some(
      (application, index) =>
        typeof application !== 'object' ||
        application === null ||
        Array.isArray(application) ||
        Object.keys(application).sort().join(',') !==
          'feature,hardFilterApplied,requested,supported' ||
        application.feature !== SEARCH_FEATURES[index] ||
        typeof application.hardFilterApplied !== 'boolean' ||
        typeof application.requested !== 'boolean' ||
        typeof application.supported !== 'boolean' ||
        application.supported !== descriptor.features[SEARCH_FEATURES[index] ?? 'query'] ||
        (application.hardFilterApplied &&
          (!application.requested ||
            !application.supported ||
            (application.feature !== 'allowedDomains' &&
              application.feature !== 'blockedDomains') ||
            !descriptor.features.hardDomainFilter)),
    ) ||
    descriptor.readiness !== 'READY' ||
    plan.maxResults > descriptor.maxResults ||
    (descriptor.mode === 'ACTIVE_REMOTE' &&
      (plan.ratePolicy === null || plan.estimatedExternalRequests !== 1)) ||
    (descriptor.mode !== 'ACTIVE_REMOTE' &&
      (plan.ratePolicy !== null || plan.estimatedExternalRequests !== 0))
  ) {
    throw new SearchError('SEARCH_PLAN_STALE');
  }
  if (plan.ratePolicy !== null) {
    const policy = validateSearchRatePolicyV1(plan.ratePolicy);
    if (
      plan.timeoutMs > policy.timeoutMs ||
      plan.maxResults > policy.maxResults ||
      policy.maxResponseBytes > descriptor.maxResponseBytes
    ) {
      throw new SearchError('SEARCH_PLAN_STALE');
    }
  }
  return Object.freeze(plan);
}
