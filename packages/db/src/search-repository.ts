import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  type SearchBatchV1,
  type SearchCandidateV1,
  type SearchPlanV1,
  type SearchProviderDescriptorV1,
  type SearchRatePolicyV1,
  type SearchRequestV1,
  type SearchRunPersistenceV1,
  type SearchRateReservationV1,
  SearchError,
  validateCuratedSourceEntriesV1,
  validateSearchBatchV1,
  validateSearchProviderDescriptorV1,
  validateSearchRatePolicyV1,
} from '@mystery-operations/search';

import { runInTransaction } from './transaction.js';

export interface SearchProviderConfigRecordV1 {
  readonly curatedEntries: readonly unknown[];
  readonly descriptor: SearchProviderDescriptorV1;
  readonly enabled: boolean;
  readonly ratePolicy: SearchRatePolicyV1 | null;
  readonly settingsRevision: number;
  readonly timeoutMs: number;
}

export interface SearchRunSummaryV1 {
  readonly candidateCount: number;
  readonly duplicateCount: number;
  readonly executionId: string;
  readonly finishedAt: string | null;
  readonly providerInstanceId: string;
  readonly rejectedCount: number;
  readonly searchRunId: string;
  readonly stableError: string | null;
  readonly startedAt: string;
  readonly status: string;
}

export interface StoredSearchProviderConfigV1 {
  readonly curatedEntries: readonly unknown[];
  readonly enabled: boolean;
  readonly maxResults: number;
  readonly providerInstanceId: string;
  readonly providerKind: SearchProviderDescriptorV1['kind'];
  readonly providerMode: SearchProviderDescriptorV1['mode'];
  readonly ratePolicy: SearchRatePolicyV1 | null;
  readonly settingsRevision: number;
  readonly timeoutMs: number;
}

type Row = Readonly<Record<string, number | string | null>>;

function booleanValue(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function queryHash(query: string): string {
  return createHash('sha256').update(query, 'utf8').digest('hex');
}

function ratePolicyColumns(policy: SearchRatePolicyV1 | null) {
  return policy === null
    ? [null, null, null, null, null, null]
    : [
        policy.revision,
        policy.maxConcurrent,
        policy.minIntervalMs,
        policy.maxRequestsPerWindow,
        policy.windowMs,
        policy.maxResponseBytes,
      ];
}

function safeJson(value: unknown, maximum: number): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > maximum) {
    throw new RangeError('serialized search metadata is too large');
  }
  return serialized;
}

export class SqliteSearchRepository implements SearchRunPersistenceV1 {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public upsertProviderConfig(config: SearchProviderConfigRecordV1, now: string): void {
    const descriptor = validateSearchProviderDescriptorV1(config.descriptor);
    const policy =
      config.ratePolicy === null ? null : validateSearchRatePolicyV1(config.ratePolicy);
    if (
      !Number.isSafeInteger(config.settingsRevision) ||
      config.settingsRevision < 1 ||
      !Number.isSafeInteger(config.timeoutMs) ||
      config.timeoutMs < 100 ||
      config.timeoutMs > 600_000 ||
      (descriptor.mode === 'ACTIVE_REMOTE') !== (policy !== null)
    ) {
      throw new RangeError('search provider config is invalid');
    }
    const curatedEntries =
      descriptor.kind === 'CURATED_SOURCE'
        ? validateCuratedSourceEntriesV1(config.curatedEntries)
        : config.curatedEntries.length === 0
          ? []
          : null;
    if (curatedEntries === null) throw new RangeError('search provider config is invalid');
    this.#database
      .prepare(
        `INSERT INTO search_provider_configs (
          provider_instance_id, provider_kind, provider_mode, enabled, max_results,
          timeout_ms, rate_policy_version, max_concurrent, min_interval_ms,
          max_requests_per_window, window_ms, max_response_bytes, curated_entries_json,
          settings_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_instance_id) DO UPDATE SET
          provider_kind = excluded.provider_kind,
          provider_mode = excluded.provider_mode,
          enabled = excluded.enabled,
          max_results = excluded.max_results,
          timeout_ms = excluded.timeout_ms,
          rate_policy_version = excluded.rate_policy_version,
          max_concurrent = excluded.max_concurrent,
          min_interval_ms = excluded.min_interval_ms,
          max_requests_per_window = excluded.max_requests_per_window,
          window_ms = excluded.window_ms,
          max_response_bytes = excluded.max_response_bytes,
          curated_entries_json = excluded.curated_entries_json,
          settings_revision = excluded.settings_revision,
          updated_at = excluded.updated_at`,
      )
      .run(
        descriptor.providerInstanceId,
        descriptor.kind,
        descriptor.mode,
        config.enabled ? 1 : 0,
        descriptor.maxResults,
        config.timeoutMs,
        ...ratePolicyColumns(policy),
        safeJson(curatedEntries, 65_536),
        config.settingsRevision,
        now,
        now,
      );
  }

  public listProviderConfigs(): readonly StoredSearchProviderConfigV1[] {
    const rows = this.#database
      .prepare('SELECT * FROM search_provider_configs ORDER BY provider_instance_id')
      .all() as Row[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          curatedEntries: JSON.parse(row.curated_entries_json as string) as readonly unknown[],
          enabled: row.enabled === 1,
          maxResults: row.max_results as number,
          providerInstanceId: row.provider_instance_id as string,
          providerKind: row.provider_kind as SearchProviderDescriptorV1['kind'],
          providerMode: row.provider_mode as SearchProviderDescriptorV1['mode'],
          ratePolicy:
            row.rate_policy_version === null
              ? null
              : {
                  contractVersion: 'search-rate-policy-v1' as const,
                  maxConcurrent: row.max_concurrent as number,
                  maxRequestsPerWindow: row.max_requests_per_window as number,
                  maxResponseBytes: row.max_response_bytes as number,
                  maxResults: row.max_results as number,
                  minIntervalMs: row.min_interval_ms as number,
                  revision: row.rate_policy_version as number,
                  timeoutMs: row.timeout_ms as number,
                  windowMs: row.window_ms as number,
                },
          settingsRevision: row.settings_revision as number,
          timeoutMs: row.timeout_ms as number,
        }),
      ),
    );
  }

  public async beginRun(input: {
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
  }> {
    return runInTransaction(this.#database, () => {
      const existing = this.#database
        .prepare(
          `SELECT id, status, request_semantic_hash, plan_hash
           FROM search_runs WHERE execution_id = ?`,
        )
        .get(input.request.executionId) as Row | undefined;
      if (existing !== undefined) {
        if (
          existing.request_semantic_hash !== input.requestSemanticHash ||
          existing.plan_hash !== input.plan.planHash
        ) {
          throw new SearchError('SEARCH_EXECUTION_CONFLICT');
        }
        if (existing.status === 'RECOVERABLE_PRE_SEND') {
          this.#database
            .prepare(
              `UPDATE search_runs
               SET status = 'IN_FLIGHT', started_at = ?, updated_at = ?,
                   stable_error_code = NULL, revision = revision + 1
               WHERE id = ? AND status = 'RECOVERABLE_PRE_SEND'`,
            )
            .run(input.startedAt, input.startedAt, existing.id as string);
          return Object.freeze({
            searchRunId: existing.id as string,
            state: 'RECOVERED_PRE_SEND' as const,
          });
        }
        return Object.freeze({
          searchRunId: existing.id as string,
          state:
            existing.status === 'AMBIGUOUS'
              ? ('EXISTING_AMBIGUOUS' as const)
              : existing.status === 'IN_FLIGHT'
                ? ('EXISTING_IN_FLIGHT' as const)
                : ('EXISTING_COMPLETED' as const),
        });
      }
      this.#database
        .prepare(
          `INSERT INTO search_runs (
            id, execution_id, job_id, provider_kind, provider_instance_id,
            provider_mode, provider_readiness, request_semantic_hash, plan_hash,
            query_hash, intent, status, certainty, rate_policy_version,
            started_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_FLIGHT', 'NOT_SENT', ?, ?, ?, ?)`,
        )
        .run(
          input.searchRunId,
          input.request.executionId,
          input.request.jobId,
          input.plan.provider.kind,
          input.plan.provider.providerInstanceId,
          input.plan.provider.mode,
          input.plan.provider.readiness,
          input.requestSemanticHash,
          input.plan.planHash,
          queryHash(input.request.query),
          input.request.intent,
          input.plan.ratePolicy?.revision ?? null,
          input.startedAt,
          input.startedAt,
          input.startedAt,
        );
      return Object.freeze({
        searchRunId: input.searchRunId,
        state: 'CREATED' as const,
      });
    });
  }

  public async findCompletedByExecutionId(executionId: string): Promise<SearchBatchV1 | null> {
    const run = this.#database
      .prepare(
        `SELECT * FROM search_runs
         WHERE execution_id = ? AND status NOT IN ('IN_FLIGHT', 'RECOVERABLE_PRE_SEND')`,
      )
      .get(executionId) as Row | undefined;
    if (run === undefined) return null;
    const rows = this.#database
      .prepare(
        `SELECT * FROM search_result_candidates
         WHERE search_run_id = ? ORDER BY upstream_rank, id`,
      )
      .all(run.id as string) as Row[];
    const candidates = rows.map((row): SearchCandidateV1 =>
      Object.freeze({
        candidateId: row.id as string,
        canonicalUrl: row.canonical_url as string,
        citationState: row.citation_state as SearchCandidateV1['citationState'],
        discoveredAt: row.discovered_at as string,
        displayHost: row.display_host as string,
        domain: row.domain as string,
        duplicateOfCandidateId: row.duplicate_of_candidate_id as string | null,
        evidenceEligibility: 'LEAD_ONLY',
        factStatus: 'NOT_A_FACT',
        fetchState: 'NOT_FETCHED',
        languageHint: row.language_hint as string | null,
        originKind: row.origin_kind as SearchCandidateV1['originKind'],
        previewKind: row.preview_kind as SearchCandidateV1['previewKind'],
        previewText: row.preview_text as string | null,
        provenanceAppearances: JSON.parse(
          row.provenance_json as string,
        ) as SearchCandidateV1['provenanceAppearances'],
        providerInstanceId: row.provider_instance_id as string,
        providerKind: row.provider_kind as SearchCandidateV1['providerKind'],
        publishedAt: row.published_at as string | null,
        searchRunId: row.search_run_id as string,
        sourceMetadataKind: row.source_metadata_kind as SearchCandidateV1['sourceMetadataKind'],
        title: row.title as string | null,
        truthStatus: 'UNVERIFIED',
        upstreamIdHash: row.upstream_id_hash as string | null,
        upstreamRank: row.upstream_rank as number | null,
        urlHash: row.url_hash as string,
        userSupplied: row.user_supplied === 1,
        warnings: JSON.parse(row.warnings_json as string) as readonly string[],
        wasCited: row.was_cited === null ? null : row.was_cited === 1,
        wasConsulted: row.was_consulted === null ? null : row.was_consulted === 1,
      }),
    );
    return validateSearchBatchV1({
      candidates,
      certainty: run.certainty,
      contractVersion: 'search-provider-v1',
      costState: run.cost_state,
      counts: {
        accepted: run.candidate_count,
        duplicates: run.duplicate_count,
        rejected: run.rejected_count,
        totalAppearances: run.total_appearance_count,
      },
      cursor: run.cursor,
      executionId: run.execution_id,
      externalRequestCount: run.external_request_count,
      finishedAt: run.finished_at,
      modelRunId: run.model_run_id,
      provider: {
        contractVersion: 'search-provider-v1',
        kind: run.provider_kind,
        mode: run.provider_mode,
        providerInstanceId: run.provider_instance_id,
        readiness: run.provider_readiness,
      },
      requestSemanticHash: run.request_semantic_hash,
      searchRunId: run.id,
      stableError: run.stable_error_code,
      startedAt: run.started_at,
      status: run.status,
      truncated: run.truncated === 1,
      usage: run.usage_json === null ? null : JSON.parse(run.usage_json as string),
      warnings: JSON.parse(run.warnings_json as string),
    });
  }

  public async markAmbiguous(
    searchRunId: string,
    stableError: string,
    finishedAt: string,
  ): Promise<void> {
    await this.settleFailure(searchRunId, {
      certainty: 'MAY_HAVE_EXECUTED',
      externalRequestCount: 1,
      finishedAt,
      releaseRateReservation: true,
      retryAfterSeconds: null,
      stableError,
      status: 'AMBIGUOUS',
    });
  }

  public async markDispatchStarted(searchRunId: string, startedAt: string): Promise<void> {
    const changed = this.#database
      .prepare(
        `UPDATE search_runs
         SET certainty = 'MAY_HAVE_EXECUTED', external_request_count = 1,
             updated_at = ?, revision = revision + 1
         WHERE id = ? AND status = 'IN_FLIGHT' AND certainty = 'NOT_SENT'
           AND provider_mode = 'ACTIVE_REMOTE' AND rate_reserved = 1`,
      )
      .run(startedAt, searchRunId).changes;
    if (changed !== 1) throw new Error('search dispatch state conflict');
  }

  public recoverInterrupted(now: string): {
    readonly ambiguous: number;
    readonly recoverablePreSend: number;
  } {
    return runInTransaction(this.#database, () => {
      const preSendRows = this.#database
        .prepare(
          `SELECT provider_instance_id, provider_mode, rate_reserved
           FROM search_runs
           WHERE status = 'IN_FLIGHT' AND certainty = 'NOT_SENT'`,
        )
        .all() as Row[];
      const ambiguousRows = this.#database
        .prepare(
          `SELECT provider_instance_id, provider_mode, rate_reserved
           FROM search_runs
           WHERE status = 'IN_FLIGHT' AND certainty = 'MAY_HAVE_EXECUTED'`,
        )
        .all() as Row[];
      this.#database
        .prepare(
          `UPDATE search_runs
           SET status = 'RECOVERABLE_PRE_SEND',
               stable_error_code = 'SEARCH_TIMEOUT_BEFORE_SEND',
               rate_reserved = 0,
               updated_at = ?, revision = revision + 1
           WHERE status = 'IN_FLIGHT' AND certainty = 'NOT_SENT'`,
        )
        .run(now);
      this.#database
        .prepare(
          `UPDATE search_runs
           SET status = 'AMBIGUOUS', stable_error_code = 'SEARCH_AMBIGUOUS',
               external_request_count = 1, finished_at = ?, updated_at = ?,
               rate_reserved = 0,
               revision = revision + 1
           WHERE status = 'IN_FLIGHT' AND certainty = 'MAY_HAVE_EXECUTED'`,
        )
        .run(now, now);
      for (const row of [...preSendRows, ...ambiguousRows]) {
        if (row.provider_mode === 'ACTIVE_REMOTE' && row.rate_reserved === 1) {
          this.#database
            .prepare(
              `UPDATE search_rate_limit_states
               SET in_flight = CASE WHEN in_flight > 0 THEN in_flight - 1 ELSE 0 END,
                   revision = revision + 1, updated_at = ?
               WHERE provider_instance_id = ?`,
            )
            .run(now, row.provider_instance_id as string);
        }
      }
      return Object.freeze({
        ambiguous: ambiguousRows.length,
        recoverablePreSend: preSendRows.length,
      });
    });
  }

  public async reserveRate(input: {
    readonly now: string;
    readonly policy: SearchRatePolicyV1;
    readonly providerInstanceId: string;
    readonly searchRunId: string;
  }): Promise<SearchRateReservationV1> {
    const policy = validateSearchRatePolicyV1(input.policy);
    return runInTransaction(this.#database, () => {
      const nowMs = Date.parse(input.now);
      const existing = this.#database
        .prepare('SELECT * FROM search_rate_limit_states WHERE provider_instance_id = ?')
        .get(input.providerInstanceId) as Row | undefined;
      let windowStartedAt = input.now;
      let requestCount = 0;
      let inFlight = 0;
      let nextAllowedAt = input.now;
      let revision = 0;
      if (existing !== undefined) {
        nextAllowedAt = existing.next_allowed_at as string;
        revision = existing.revision as number;
        if (existing.policy_version === policy.revision) {
          windowStartedAt = existing.window_started_at as string;
          requestCount = existing.request_count as number;
          inFlight = existing.in_flight as number;
          if (nowMs - Date.parse(windowStartedAt) >= policy.windowMs) {
            windowStartedAt = input.now;
            requestCount = 0;
          }
        } else if ((existing.in_flight as number) > 0) {
          throw new SearchError('SEARCH_RATE_LIMITED', { retryable: true });
        }
      }
      if (
        inFlight >= policy.maxConcurrent ||
        requestCount >= policy.maxRequestsPerWindow ||
        Date.parse(nextAllowedAt) > nowMs
      ) {
        throw new SearchError('SEARCH_RATE_LIMITED', { retryable: true });
      }
      const reserved = this.#database
        .prepare(
          `UPDATE search_runs SET rate_reserved = 1, updated_at = ?, revision = revision + 1
           WHERE id = ? AND provider_instance_id = ? AND provider_mode = 'ACTIVE_REMOTE'
             AND status = 'IN_FLIGHT' AND certainty = 'NOT_SENT' AND rate_reserved = 0`,
        )
        .run(input.now, input.searchRunId, input.providerInstanceId).changes;
      if (reserved !== 1) throw new SearchError('SEARCH_EXECUTION_CONFLICT');
      const next = new Date(nowMs + policy.minIntervalMs).toISOString();
      this.#database
        .prepare(
          `INSERT INTO search_rate_limit_states (
            provider_instance_id, policy_version, window_started_at, request_count,
            in_flight, last_started_at, next_allowed_at, revision, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider_instance_id) DO UPDATE SET
            policy_version = excluded.policy_version,
            window_started_at = excluded.window_started_at,
            request_count = excluded.request_count,
            in_flight = excluded.in_flight,
            last_started_at = excluded.last_started_at,
            next_allowed_at = excluded.next_allowed_at,
            revision = excluded.revision,
            updated_at = excluded.updated_at`,
        )
        .run(
          input.providerInstanceId,
          policy.revision,
          windowStartedAt,
          requestCount + 1,
          inFlight + 1,
          input.now,
          next,
          revision + 1,
          input.now,
        );
      return Object.freeze({
        providerInstanceId: input.providerInstanceId,
        reservationId: `${input.searchRunId}:${this.#idFactory()}`,
      });
    });
  }

  public async settleFailure(
    searchRunId: string,
    input: {
      readonly certainty: SearchBatchV1['certainty'];
      readonly externalRequestCount: 0 | 1;
      readonly finishedAt: string;
      readonly releaseRateReservation: boolean;
      readonly retryAfterSeconds: number | null;
      readonly stableError: string;
      readonly status: SearchBatchV1['status'];
    },
  ): Promise<void> {
    runInTransaction(this.#database, () => {
      const row = this.#database
        .prepare(
          `SELECT provider_instance_id, provider_mode, rate_reserved, status
           FROM search_runs WHERE id = ?`,
        )
        .get(searchRunId) as Row | undefined;
      if (row === undefined) throw new Error('search run does not exist');
      const changed = this.#database
        .prepare(
          `UPDATE search_runs SET
            status = ?, certainty = ?, external_request_count = ?,
            stable_error_code = ?, finished_at = ?, rate_reserved = 0,
            updated_at = ?, revision = revision + 1
          WHERE id = ? AND status = 'IN_FLIGHT'`,
        )
        .run(
          input.status,
          input.certainty,
          input.externalRequestCount,
          input.stableError,
          input.finishedAt,
          input.finishedAt,
          searchRunId,
        ).changes;
      if (changed !== 1) throw new Error('search run settlement conflict');
      if (
        row.provider_mode === 'ACTIVE_REMOTE' &&
        row.rate_reserved === 1 &&
        input.releaseRateReservation
      ) {
        const retryAt =
          input.retryAfterSeconds === null
            ? input.finishedAt
            : new Date(
                Date.parse(input.finishedAt) + input.retryAfterSeconds * 1_000,
              ).toISOString();
        this.#database
          .prepare(
            `UPDATE search_rate_limit_states
             SET in_flight = CASE WHEN in_flight > 0 THEN in_flight - 1 ELSE 0 END,
                 next_allowed_at = CASE
                   WHEN next_allowed_at < ? THEN ? ELSE next_allowed_at
                 END,
                 revision = revision + 1, updated_at = ?
             WHERE provider_instance_id = ?`,
          )
          .run(retryAt, retryAt, input.finishedAt, row.provider_instance_id as string);
      }
    });
  }

  public async settleSuccess(
    batchValue: SearchBatchV1,
    reservation: SearchRateReservationV1 | null,
  ): Promise<void> {
    const batch = validateSearchBatchV1(batchValue);
    runInTransaction(this.#database, () => {
      const run = this.#database
        .prepare(
          `SELECT provider_instance_id, provider_mode, rate_reserved
           FROM search_runs WHERE id = ? AND status = 'IN_FLIGHT'`,
        )
        .get(batch.searchRunId) as Row | undefined;
      if (run === undefined) throw new Error('search run settlement conflict');
      if (
        (reservation === null && run.rate_reserved !== 0) ||
        (reservation !== null &&
          (run.rate_reserved !== 1 || run.provider_instance_id !== reservation.providerInstanceId))
      ) {
        throw new Error('search rate reservation conflict');
      }
      for (const candidate of batch.candidates) this.#insertCandidate(candidate);
      const changed = this.#database
        .prepare(
          `UPDATE search_runs SET
            status = ?, certainty = ?, external_request_count = ?, model_run_id = ?,
            candidate_count = ?, rejected_count = ?, duplicate_count = ?,
            total_appearance_count = ?, truncated = ?, cursor = ?, cost_state = ?,
            usage_json = ?, warnings_json = ?, stable_error_code = ?,
            finished_at = ?, updated_at = ?,
            started_at = ?, rate_reserved = 0,
            revision = revision + 1
          WHERE id = ? AND status = 'IN_FLIGHT'`,
        )
        .run(
          batch.status,
          batch.certainty,
          batch.externalRequestCount,
          batch.modelRunId,
          batch.counts.accepted,
          batch.counts.rejected,
          batch.counts.duplicates,
          batch.counts.totalAppearances,
          batch.truncated ? 1 : 0,
          batch.cursor,
          batch.costState,
          batch.usage === null ? null : safeJson(batch.usage, 4_096),
          safeJson(batch.warnings, 4_096),
          batch.stableError,
          batch.finishedAt,
          batch.finishedAt,
          batch.startedAt,
          batch.searchRunId,
        ).changes;
      if (changed !== 1) throw new Error('search run settlement conflict');
      if (reservation !== null) {
        this.#database
          .prepare(
            `UPDATE search_rate_limit_states
             SET in_flight = in_flight - 1, revision = revision + 1, updated_at = ?
             WHERE provider_instance_id = ? AND in_flight > 0`,
          )
          .run(batch.finishedAt, run.provider_instance_id as string);
      }
    });
  }

  public listRecentRuns(limit = 20): readonly SearchRunSummaryV1[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit must be between 1 and 100');
    }
    const rows = this.#database
      .prepare(
        `SELECT id, execution_id, provider_instance_id, status, candidate_count,
          rejected_count, duplicate_count, stable_error_code, started_at, finished_at
         FROM search_runs ORDER BY started_at DESC, id DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          candidateCount: row.candidate_count as number,
          duplicateCount: row.duplicate_count as number,
          executionId: row.execution_id as string,
          finishedAt: row.finished_at as string | null,
          providerInstanceId: row.provider_instance_id as string,
          rejectedCount: row.rejected_count as number,
          searchRunId: row.id as string,
          stableError: row.stable_error_code as string | null,
          startedAt: row.started_at as string,
          status: row.status as string,
        }),
      ),
    );
  }

  #insertCandidate(candidate: SearchCandidateV1): void {
    this.#database
      .prepare(
        `INSERT INTO search_result_candidates (
          id, search_run_id, provider_instance_id, provider_kind, origin_kind,
          canonical_url, url_hash, domain, display_host, title, preview_text,
          preview_kind, upstream_rank, upstream_id_hash, published_at, language_hint,
          discovered_at, user_supplied, source_metadata_kind, citation_state,
          was_consulted, was_cited, evidence_eligibility, fetch_state, truth_status,
          fact_status, duplicate_of_candidate_id, provenance_json, warnings_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidate.candidateId,
        candidate.searchRunId,
        candidate.providerInstanceId,
        candidate.providerKind,
        candidate.originKind,
        candidate.canonicalUrl,
        candidate.urlHash,
        candidate.domain,
        candidate.displayHost,
        candidate.title,
        candidate.previewText,
        candidate.previewKind,
        candidate.upstreamRank,
        candidate.upstreamIdHash,
        candidate.publishedAt,
        candidate.languageHint,
        candidate.discoveredAt,
        candidate.userSupplied ? 1 : 0,
        candidate.sourceMetadataKind,
        candidate.citationState,
        booleanValue(candidate.wasConsulted),
        booleanValue(candidate.wasCited),
        candidate.evidenceEligibility,
        candidate.fetchState,
        candidate.truthStatus,
        candidate.factStatus,
        candidate.duplicateOfCandidateId,
        safeJson(candidate.provenanceAppearances, 16_384),
        safeJson(candidate.warnings, 4_096),
        candidate.discoveredAt,
      );
  }
}
