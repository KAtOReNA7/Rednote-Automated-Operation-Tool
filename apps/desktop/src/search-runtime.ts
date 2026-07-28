import type { DatabaseSync } from 'node:sqlite';

import { SqliteSearchRepository } from '@mystery-operations/db';
import type {
  SearchAdapterView,
  SearchStateView,
  UpdateSearchProviderConfigInput,
} from '@mystery-operations/shared';
import {
  BrowserClipAdapter,
  CuratedSourceAdapter,
  ManualUrlAdapter,
  SEARCH_LIMITS,
  SEARCH_PROVIDER_CONTRACT_VERSION,
  SearchApiAdapter,
  SearchProviderRegistry,
  validateSearchRatePolicyV1,
  type CuratedSourceEntryV1,
  type SearchProviderDescriptorV1,
  type SearchRatePolicyV1,
} from '@mystery-operations/search';

const DEFAULT_RATE_POLICY: SearchRatePolicyV1 = Object.freeze({
  contractVersion: 'search-rate-policy-v1',
  maxConcurrent: 1,
  maxRequestsPerWindow: 30,
  maxResponseBytes: SEARCH_LIMITS.responseBytes,
  maxResults: SEARCH_LIMITS.maxCandidates,
  minIntervalMs: 1_000,
  revision: 1,
  timeoutMs: 30_000,
  windowMs: 60_000,
});

const MODEL_DESCRIPTOR: SearchProviderDescriptorV1 = Object.freeze({
  budgetState: 'REQUIRED',
  capabilityState: 'UNKNOWN',
  codecState: 'READY',
  contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
  credentialState: 'UNKNOWN',
  displayName: '模型联网搜索',
  features: Object.freeze({
    allowedDomains: false,
    blockedDomains: false,
    countryHint: false,
    cursor: false,
    hardDomainFilter: false,
    liveAccess: false,
    localeHints: false,
    manualUrl: false,
    publishedDateRange: false,
    query: true,
    structuredSources: true,
  }),
  kind: 'MODEL_WEB_SEARCH',
  maxResponseBytes: SEARCH_LIMITS.responseBytes,
  maxResults: SEARCH_LIMITS.maxCandidates,
  mode: 'ACTIVE_REMOTE',
  providerInstanceId: 'model-web-search-v1',
  rateState: 'READY',
  readiness: 'DISABLED',
  supportedIntents: Object.freeze(['BOOK_DISCOVERY'] as const),
});

const INERT_TRANSPORT = Object.freeze({
  send: () => Promise.reject(new Error('No production Search API codec is installed.')),
});

const TRANSPORT_LIMITS = Object.freeze({
  bodyTimeoutMs: 30_000,
  connectTimeoutMs: 10_000,
  headerBytes: 16_384,
  headerTimeoutMs: 10_000,
  maxDecompressedBytes: SEARCH_LIMITS.responseBytes,
  maxRawBytes: SEARCH_LIMITS.responseBytes,
  totalTimeoutMs: 30_000,
});

function adapterView(
  descriptor: SearchProviderDescriptorV1,
  config: {
    readonly curatedEntries: readonly unknown[];
    readonly enabled: boolean;
    readonly ratePolicy: SearchRatePolicyV1 | null;
    readonly settingsRevision: number;
    readonly timeoutMs: number;
  },
): SearchAdapterView {
  return Object.freeze({
    budgetState: descriptor.budgetState,
    capabilityState: descriptor.capabilityState,
    codecState: descriptor.codecState,
    credentialState: descriptor.credentialState,
    curatedEntries: config.curatedEntries as SearchAdapterView['curatedEntries'],
    displayName: descriptor.displayName,
    enabled: config.enabled,
    features: Object.freeze(
      Object.entries(descriptor.features)
        .filter((entry) => entry[1])
        .map((entry) => entry[0])
        .sort(),
    ),
    kind: descriptor.kind,
    maxResults: descriptor.maxResults,
    mode: descriptor.mode,
    providerInstanceId: descriptor.providerInstanceId as SearchAdapterView['providerInstanceId'],
    ratePolicy: config.ratePolicy,
    rateState: descriptor.rateState,
    readiness: descriptor.readiness,
    settingsRevision: config.settingsRevision,
    timeoutMs: config.timeoutMs,
  });
}

export class DesktopSearchRuntime {
  readonly #repository: SqliteSearchRepository;

  public constructor(database: DatabaseSync) {
    this.#repository = new SqliteSearchRepository(database);
    if (this.#repository.listProviderConfigs().length === 0) this.#seedDefaults();
    this.#repository.recoverInterrupted(new Date().toISOString());
  }

  public getState(): SearchStateView {
    const registry = this.#registry();
    const configs = this.#repository.listProviderConfigs();
    return Object.freeze({
      adapters: Object.freeze(
        registry.list().map((descriptor) => {
          const config = configs.find(
            (item) => item.providerInstanceId === descriptor.providerInstanceId,
          );
          if (config === undefined) throw new Error('Search provider config is missing.');
          return adapterView(descriptor, config);
        }),
      ),
      boundaries: Object.freeze({
        browserClip: 'Issue 017 才接收插件收藏；本轮无插件路由。',
        discovery: '所有结果仅是 LEAD_ONLY 线索，不是事实或证据。',
        fetching: 'Issue 016 才抓取网页；本轮不会连接候选 URL。',
      }),
      overallReadiness: registry.overallReadiness(),
      recentRuns: this.#repository.listRecentRuns(20),
    });
  }

  public update(input: UpdateSearchProviderConfigInput): SearchStateView {
    const current = this.#repository
      .listProviderConfigs()
      .find((item) => item.providerInstanceId === input.providerInstanceId);
    if (
      current === undefined ||
      current.settingsRevision !== input.expectedRevision ||
      !Number.isSafeInteger(input.maxResults) ||
      input.maxResults < 1 ||
      input.maxResults > SEARCH_LIMITS.maxCandidates ||
      !Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 100 ||
      input.timeoutMs > 600_000 ||
      (current.providerKind !== 'CURATED_SOURCE' && input.curatedEntries.length !== 0) ||
      (current.providerMode === 'ACTIVE_REMOTE') !== (input.ratePolicy !== null)
    ) {
      throw new TypeError('SEARCH_INVALID_REQUEST');
    }
    const ratePolicy =
      input.ratePolicy === null ? null : validateSearchRatePolicyV1(input.ratePolicy);
    const curatedEntries = input.curatedEntries as readonly CuratedSourceEntryV1[];
    const next = {
      ...current,
      curatedEntries,
      enabled: input.enabled,
      maxResults: input.maxResults,
    };
    const descriptor = this.#descriptor(next, ratePolicy);
    if (
      ratePolicy !== null &&
      (ratePolicy.maxResults < input.maxResults ||
        ratePolicy.timeoutMs < input.timeoutMs ||
        ratePolicy.maxResponseBytes > descriptor.maxResponseBytes)
    ) {
      throw new TypeError('SEARCH_INVALID_REQUEST');
    }
    this.#repository.upsertProviderConfig(
      {
        curatedEntries,
        descriptor,
        enabled: input.enabled,
        ratePolicy,
        settingsRevision: current.settingsRevision + 1,
        timeoutMs: input.timeoutMs,
      },
      new Date().toISOString(),
    );
    return this.getState();
  }

  #seedDefaults(): void {
    const now = new Date().toISOString();
    const defaults = [
      {
        descriptor: MODEL_DESCRIPTOR,
        enabled: false,
        ratePolicy: DEFAULT_RATE_POLICY,
        timeoutMs: 30_000,
      },
      {
        descriptor: this.#searchApiDescriptor(false),
        enabled: false,
        ratePolicy: DEFAULT_RATE_POLICY,
        timeoutMs: 30_000,
      },
      {
        descriptor: new CuratedSourceAdapter([]).describe(),
        enabled: true,
        ratePolicy: null,
        timeoutMs: 5_000,
      },
      {
        descriptor: new BrowserClipAdapter().describe(),
        enabled: true,
        ratePolicy: null,
        timeoutMs: 5_000,
      },
      {
        descriptor: new ManualUrlAdapter().describe(),
        enabled: true,
        ratePolicy: null,
        timeoutMs: 5_000,
      },
    ] as const;
    for (const config of defaults) {
      this.#repository.upsertProviderConfig(
        {
          curatedEntries: [],
          settingsRevision: 1,
          ...config,
        },
        now,
      );
    }
  }

  #registry(): SearchProviderRegistry {
    const registry = new SearchProviderRegistry();
    for (const config of this.#repository.listProviderConfigs()) {
      const descriptor = this.#descriptor(config, config.ratePolicy);
      registry.register({
        describe: () => descriptor,
        execute: () => Promise.reject(new TypeError('Search execution is not an IPC operation.')),
        preview: () => Promise.reject(new TypeError('Search execution is not an IPC operation.')),
      });
    }
    return registry;
  }

  #searchApiDescriptor(enabled: boolean): SearchProviderDescriptorV1 {
    return new SearchApiAdapter({
      accountingReady: false,
      codec: null,
      credentialReference: null,
      credentialResolver: null,
      enabled,
      rateReady: true,
      transport: INERT_TRANSPORT,
      transportLimits: TRANSPORT_LIMITS,
    }).describe();
  }

  #descriptor(
    config: {
      readonly curatedEntries: readonly unknown[];
      readonly enabled: boolean;
      readonly maxResults: number;
      readonly providerInstanceId: string;
      readonly providerKind: SearchProviderDescriptorV1['kind'];
    },
    ratePolicy: SearchRatePolicyV1 | null,
  ): SearchProviderDescriptorV1 {
    let base: SearchProviderDescriptorV1;
    switch (config.providerKind) {
      case 'MANUAL_URL':
        base = new ManualUrlAdapter(config.providerInstanceId, config.enabled).describe();
        break;
      case 'CURATED_SOURCE':
        base = new CuratedSourceAdapter(
          config.curatedEntries as readonly CuratedSourceEntryV1[],
          config.providerInstanceId,
          config.enabled,
        ).describe();
        break;
      case 'BROWSER_CLIP':
        base = new BrowserClipAdapter(config.providerInstanceId).describe();
        break;
      case 'SEARCH_API':
        base = {
          ...this.#searchApiDescriptor(config.enabled),
          providerInstanceId: config.providerInstanceId,
          rateState: ratePolicy === null ? 'REQUIRED' : 'READY',
        };
        break;
      case 'MODEL_WEB_SEARCH':
        base = {
          ...MODEL_DESCRIPTOR,
          providerInstanceId: config.providerInstanceId,
          readiness: config.enabled ? 'CAPABILITY_UNKNOWN' : 'DISABLED',
        };
        break;
    }
    return Object.freeze({ ...base, maxResults: config.maxResults });
  }
}
