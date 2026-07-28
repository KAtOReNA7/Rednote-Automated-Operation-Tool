import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { SqliteFetchRepository } from '@mystery-operations/db';
import {
  FetchExecutionService,
  NodeControlledFetchTransport,
  SystemDnsResolver,
  createDefaultFetchProfileV1,
} from '@mystery-operations/fetch';
import type { FetchStateView, UpdateFetchPolicyInput } from '@mystery-operations/shared';
import { LocalFileRepository, type ProjectDataRoot } from '@mystery-operations/storage';

export class DesktopFetchRuntime {
  readonly #files: LocalFileRepository;
  readonly #repository: SqliteFetchRepository;

  public constructor(database: DatabaseSync, root: ProjectDataRoot) {
    this.#repository = new SqliteFetchRepository(database);
    this.#files = new LocalFileRepository(root);
    this.#seedDefault();
    this.#repository.recoverInterrupted(new Date().toISOString());
  }

  public getState(): FetchStateView {
    const profile = this.#getProfile();
    return Object.freeze({
      policy: Object.freeze({
        charset: 'ALLOWLIST',
        maxDecodedBytes: profile.limits.decodedBytes,
        maxRawBytes: profile.limits.rawBytes,
        maxRedirects: profile.limits.redirectCount,
        mime: 'HTML_XHTML_TEXT_ONLY',
        rate: 'PERSISTENT_PER_ORIGIN',
        robots: 'RFC9309_FAIL_CLOSED',
      }),
      profile: Object.freeze({
        enabled: profile.enabled,
        globalMaxConcurrent: profile.globalMaxConcurrent,
        id: profile.id,
        maxRequestsPerWindow: profile.ratePolicy.maxRequestsPerWindow,
        minIntervalMs: profile.ratePolicy.minIntervalMs,
        perOriginMaxConcurrent: 1,
        revision: profile.revision,
        windowMs: profile.ratePolicy.windowMs,
      }),
      ready: profile.enabled,
      recentRuns: this.#repository.listRecentRuns(20),
      storageReady: true,
    });
  }

  public update(input: UpdateFetchPolicyInput): FetchStateView {
    const current = this.#getProfile();
    if (
      current.revision !== input.expectedRevision ||
      !Number.isSafeInteger(input.globalMaxConcurrent) ||
      input.globalMaxConcurrent < 1 ||
      input.globalMaxConcurrent > 8 ||
      !Number.isSafeInteger(input.minIntervalMs) ||
      input.minIntervalMs < 0 ||
      input.minIntervalMs > 86_400_000 ||
      !Number.isSafeInteger(input.maxRequestsPerWindow) ||
      input.maxRequestsPerWindow < 1 ||
      input.maxRequestsPerWindow > 10_000 ||
      !Number.isSafeInteger(input.windowMs) ||
      input.windowMs < 1_000 ||
      input.windowMs > 86_400_000
    ) {
      throw new TypeError('FETCH_INVALID_REQUEST');
    }
    this.#repository.upsertProfile(
      {
        ...current,
        enabled: input.enabled,
        globalMaxConcurrent: input.globalMaxConcurrent,
        ratePolicy: {
          ...current.ratePolicy,
          maxRequestsPerWindow: input.maxRequestsPerWindow,
          minIntervalMs: input.minIntervalMs,
          revision: current.ratePolicy.revision + 1,
          windowMs: input.windowMs,
        },
        revision: current.revision + 1,
      },
      current.revision,
    );
    return this.getState();
  }

  public createStrictExecutionService(): FetchExecutionService {
    return new FetchExecutionService({
      candidateReader: this.#repository,
      dnsResolver: new SystemDnsResolver(),
      idFactory: randomUUID,
      persistence: this.#repository,
      profileReader: this.#repository,
      snapshotStore: {
        put: async (content, input) => {
          const descriptor = await this.#files.putBuffer(content, {
            category: 'SOURCE_SNAPSHOT',
            displayName: input.displayName,
            maxBytes: input.maxBytes,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
          return {
            managedPath: descriptor.managedPath,
            sha256: descriptor.sha256,
            sizeBytes: descriptor.sizeBytes,
          };
        },
      },
      transport: new NodeControlledFetchTransport(),
    });
  }

  #getProfile() {
    const profile = this.#repository.getProfileSync('controlled-public-page-v1');
    if (profile === null) throw new TypeError('FETCH_PROFILE_NOT_INITIALIZED');
    return profile;
  }

  #seedDefault(): void {
    const existing = this.#repository.getProfileSync('controlled-public-page-v1');
    if (existing === null) this.#repository.upsertProfile(createDefaultFetchProfileV1());
  }
}
