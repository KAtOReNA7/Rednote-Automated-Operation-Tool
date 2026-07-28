import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  CONTROLLED_FETCH_CONTRACT_VERSION,
  FETCH_ERROR_CODES,
  FETCH_EXTRACTOR_VERSION,
  FETCH_PRIVACY_POLICY_VERSION,
  FETCH_ROBOTS_POLICY_VERSION,
  FETCH_SANITIZER_VERSION,
  FETCH_TERMINAL_STATUSES,
  type FetchedDocumentV1,
  type FetchErrorCode,
  type FetchOriginRateReservationV1,
  type FetchOutcomeV1,
  type FetchPersistenceV1,
  type FetchPlanV1,
  type FetchProfileV1,
  type FetchRequestV1,
  type FetchRunStatus,
  type FetchTerminalStatus,
  type RedirectHopV1,
  type RobotsDecisionV1,
  FetchError,
  validateFetchOutcomeV1,
  validateFetchPlanV1,
  validateFetchProfileV1,
  validateFetchRequestV1,
  validateFetchedDocumentV1,
} from '@mystery-operations/fetch';
import type { SearchCandidateV1 } from '@mystery-operations/search';
import { parseManagedRelativePath } from '@mystery-operations/shared/storage';

import { SqliteSearchRepository } from './search-repository.js';
import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

export interface FetchRunSummaryRecordV1 {
  readonly candidateId: string;
  readonly charset: string | null;
  readonly displayHost: string;
  readonly documentSaved: boolean;
  readonly externalRequestCount: number;
  readonly fetchRunId: string;
  readonly mimeType: string | null;
  readonly receivedBytes: number;
  readonly redactionCount: number;
  readonly redirectCount: number;
  readonly stableError: string | null;
  readonly stage: string;
}

function safeJson(value: unknown, maximumBytes: number): string {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return encoded;
}

function profileFromRow(row: Row): FetchProfileV1 {
  return validateFetchProfileV1({
    contractVersion: row.contract_version,
    enabled: row.enabled === 1,
    globalMaxConcurrent: row.global_max_concurrent,
    id: row.id,
    limits: {
      connectTimeoutMs: row.connect_timeout_ms,
      bodyTimeoutMs: row.body_timeout_ms,
      decodedBytes: row.decoded_bytes,
      domDepth: row.dom_depth,
      domNodes: row.dom_nodes,
      headerBytes: row.header_bytes,
      headerCount: row.header_count,
      headerTimeoutMs: row.header_timeout_ms,
      maxExternalRequests: row.max_external_requests,
      rawBytes: row.raw_bytes,
      redirectCount: row.redirect_count,
      sanitizedBytes: row.sanitized_bytes,
      textBytes: row.text_bytes,
      totalTimeoutMs: row.total_timeout_ms,
    },
    ratePolicy: {
      maxRequestsPerWindow: row.max_requests_per_window,
      minIntervalMs: row.min_interval_ms,
      perOriginMaxConcurrent: 1,
      revision: row.rate_policy_revision,
      windowMs: row.window_ms,
    },
    revision: row.revision,
  });
}

function terminalStatus(value: unknown): value is FetchTerminalStatus {
  return FETCH_TERMINAL_STATUSES.includes(value as FetchTerminalStatus);
}

function errorCode(value: unknown): FetchErrorCode {
  return FETCH_ERROR_CODES.includes(value as FetchErrorCode)
    ? (value as FetchErrorCode)
    : 'FETCH_INTERNAL';
}

export class SqliteFetchRepository implements FetchPersistenceV1 {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;
  readonly #search: SqliteSearchRepository;

  public constructor(database: DatabaseSync, options: { readonly idFactory?: () => string } = {}) {
    this.#database = database;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#search = new SqliteSearchRepository(database);
  }

  public async findCandidate(candidateId: string): Promise<SearchCandidateV1 | null> {
    return this.#search.findCandidate(candidateId);
  }

  public upsertProfile(profileValue: FetchProfileV1, expectedRevision?: number): FetchProfileV1 {
    const profile = validateFetchProfileV1(profileValue);
    return runInTransaction(this.#database, () => {
      const existing = this.#database
        .prepare('SELECT revision FROM fetch_profiles WHERE id = ?')
        .get(profile.id) as { readonly revision: number } | undefined;
      if (
        existing !== undefined &&
        (expectedRevision === undefined ||
          existing.revision !== expectedRevision ||
          profile.revision !== existing.revision + 1)
      ) {
        throw new FetchError('FETCH_EXECUTION_CONFLICT');
      }
      if (existing === undefined && (expectedRevision !== undefined || profile.revision !== 1)) {
        throw new FetchError('FETCH_EXECUTION_CONFLICT');
      }
      if (existing === undefined) {
        const now = new Date().toISOString();
        this.#database
          .prepare(
            `INSERT INTO fetch_profiles (
              id, contract_version, enabled, revision, global_max_concurrent,
              connect_timeout_ms, body_timeout_ms, header_timeout_ms, total_timeout_ms, header_bytes,
              header_count, raw_bytes, decoded_bytes, dom_nodes, dom_depth,
              sanitized_bytes, text_bytes, redirect_count, max_external_requests,
              min_interval_ms, max_requests_per_window, window_ms, rate_policy_revision,
              created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )`,
          )
          .run(
            profile.id,
            profile.contractVersion,
            profile.enabled ? 1 : 0,
            profile.revision,
            profile.globalMaxConcurrent,
            profile.limits.connectTimeoutMs,
            profile.limits.bodyTimeoutMs,
            profile.limits.headerTimeoutMs,
            profile.limits.totalTimeoutMs,
            profile.limits.headerBytes,
            profile.limits.headerCount,
            profile.limits.rawBytes,
            profile.limits.decodedBytes,
            profile.limits.domNodes,
            profile.limits.domDepth,
            profile.limits.sanitizedBytes,
            profile.limits.textBytes,
            profile.limits.redirectCount,
            profile.limits.maxExternalRequests,
            profile.ratePolicy.minIntervalMs,
            profile.ratePolicy.maxRequestsPerWindow,
            profile.ratePolicy.windowMs,
            profile.ratePolicy.revision,
            now,
            now,
          );
      } else {
        const changed = this.#database
          .prepare(
            `UPDATE fetch_profiles SET
              enabled = ?, revision = ?, global_max_concurrent = ?,
              connect_timeout_ms = ?, body_timeout_ms = ?, header_timeout_ms = ?, total_timeout_ms = ?,
              header_bytes = ?, header_count = ?, raw_bytes = ?, decoded_bytes = ?,
              dom_nodes = ?, dom_depth = ?, sanitized_bytes = ?, text_bytes = ?,
              redirect_count = ?, max_external_requests = ?, min_interval_ms = ?,
              max_requests_per_window = ?, window_ms = ?, rate_policy_revision = ?,
              updated_at = ?
             WHERE id = ? AND revision = ?`,
          )
          .run(
            profile.enabled ? 1 : 0,
            profile.revision,
            profile.globalMaxConcurrent,
            profile.limits.connectTimeoutMs,
            profile.limits.bodyTimeoutMs,
            profile.limits.headerTimeoutMs,
            profile.limits.totalTimeoutMs,
            profile.limits.headerBytes,
            profile.limits.headerCount,
            profile.limits.rawBytes,
            profile.limits.decodedBytes,
            profile.limits.domNodes,
            profile.limits.domDepth,
            profile.limits.sanitizedBytes,
            profile.limits.textBytes,
            profile.limits.redirectCount,
            profile.limits.maxExternalRequests,
            profile.ratePolicy.minIntervalMs,
            profile.ratePolicy.maxRequestsPerWindow,
            profile.ratePolicy.windowMs,
            profile.ratePolicy.revision,
            new Date().toISOString(),
            profile.id,
            existing.revision,
          ).changes;
        if (changed !== 1) throw new FetchError('FETCH_EXECUTION_CONFLICT');
      }
      return profile;
    });
  }

  public async getProfile(profileId: string): Promise<FetchProfileV1 | null> {
    return this.getProfileSync(profileId);
  }

  public getProfileSync(profileId: string): FetchProfileV1 | null {
    const row = this.#database
      .prepare('SELECT * FROM fetch_profiles WHERE id = ?')
      .get(profileId) as Row | undefined;
    return row === undefined ? null : profileFromRow(row);
  }

  public async beginRun(input: {
    readonly fetchRunId: string;
    readonly plan: FetchPlanV1;
    readonly request: FetchRequestV1;
    readonly requestSemanticHash: string;
    readonly startedAt: string;
  }): Promise<{
    readonly fetchRunId: string;
    readonly state:
      | 'CREATED'
      | 'EXISTING_AMBIGUOUS'
      | 'EXISTING_IN_FLIGHT'
      | 'EXISTING_TERMINAL'
      | 'RECOVERED_PRE_SEND';
  }> {
    const request = validateFetchRequestV1(input.request);
    const plan = validateFetchPlanV1(input.plan);
    return runInTransaction(this.#database, () => {
      const existing = this.#database
        .prepare('SELECT * FROM fetch_runs WHERE execution_id = ?')
        .get(request.executionId) as Row | undefined;
      if (existing !== undefined) {
        if (
          existing.request_semantic_hash !== input.requestSemanticHash ||
          existing.search_candidate_id !== request.searchCandidateId ||
          existing.expected_canonical_url_hash !== request.expectedCanonicalUrlHash ||
          existing.plan_hash !== plan.planHash
        ) {
          throw new FetchError('FETCH_EXECUTION_CONFLICT');
        }
        const status = existing.status;
        return Object.freeze({
          fetchRunId: existing.id as string,
          state:
            status === 'AMBIGUOUS'
              ? ('EXISTING_AMBIGUOUS' as const)
              : status === 'RECOVERABLE_PRE_SEND'
                ? ('RECOVERED_PRE_SEND' as const)
                : terminalStatus(status)
                  ? ('EXISTING_TERMINAL' as const)
                  : ('EXISTING_IN_FLIGHT' as const),
        });
      }
      const candidate = this.#search.findCandidate(request.searchCandidateId);
      if (
        candidate === null ||
        candidate.urlHash !== request.expectedCanonicalUrlHash ||
        plan.candidate.canonicalUrlHash !== candidate.urlHash
      ) {
        throw new FetchError(
          candidate === null ? 'FETCH_CANDIDATE_NOT_FOUND' : 'FETCH_CANDIDATE_BINDING_MISMATCH',
        );
      }
      this.#database
        .prepare(
          `INSERT INTO fetch_runs (
            id, execution_id, job_id, search_candidate_id, expected_canonical_url_hash,
            candidate_url_hash, request_semantic_hash, plan_hash, selection_kind,
            selection_reason_code, fetch_profile_id, profile_revision, origin,
            status, send_state, started_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', 'NOT_SENT', ?, ?, ?)`,
        )
        .run(
          input.fetchRunId,
          request.executionId,
          request.jobId,
          request.searchCandidateId,
          request.expectedCanonicalUrlHash,
          candidate.urlHash,
          input.requestSemanticHash,
          plan.planHash,
          request.selectionKind,
          request.selectionReasonCode,
          request.fetchProfileId,
          request.profileRevision,
          plan.candidate.origin,
          input.startedAt,
          input.startedAt,
          input.startedAt,
        );
      return Object.freeze({ fetchRunId: input.fetchRunId, state: 'CREATED' as const });
    });
  }

  public async findTerminalByExecutionId(executionId: string): Promise<FetchOutcomeV1 | null> {
    const row = this.#database
      .prepare('SELECT * FROM fetch_runs WHERE execution_id = ?')
      .get(executionId) as Row | undefined;
    if (row === undefined || !terminalStatus(row.status)) return null;
    const document =
      row.document_id === null ? null : this.#documentById(row.document_id as string);
    const code = row.stable_error_code === null ? null : errorCode(row.stable_error_code);
    return validateFetchOutcomeV1({
      charset: row.response_charset,
      contractVersion: CONTROLLED_FETCH_CONTRACT_VERSION,
      document,
      executionId: row.execution_id,
      externalRequestCount: row.external_request_count,
      fetchRunId: row.id,
      finishedAt: row.finished_at,
      mimeType: row.response_mime,
      receivedBytes: row.received_bytes,
      redactionCounts: {
        addresses: row.redacted_address_count,
        emails: row.redacted_email_count,
        phones: row.redacted_phone_count,
      },
      redirectCount: row.redirect_count,
      stableError: code === null ? null : { code, retryable: new FetchError(code).retryable },
      status: row.status,
    });
  }

  public async findExecutionIdentity(executionId: string): Promise<{
    readonly planHash: string;
    readonly requestSemanticHash: string;
  } | null> {
    const row = this.#database
      .prepare(
        `SELECT plan_hash, request_semantic_hash
         FROM fetch_runs WHERE execution_id = ?`,
      )
      .get(executionId) as
      { readonly plan_hash: string; readonly request_semantic_hash: string } | undefined;
    return row === undefined
      ? null
      : Object.freeze({
          planHash: row.plan_hash,
          requestSemanticHash: row.request_semantic_hash,
        });
  }

  public async transition(fetchRunId: string, stage: FetchRunStatus, now: string): Promise<void> {
    const row = this.#database
      .prepare('SELECT status FROM fetch_runs WHERE id = ?')
      .get(fetchRunId) as { readonly status: FetchRunStatus } | undefined;
    if (row === undefined) throw new FetchError('FETCH_EXECUTION_CONFLICT');
    const allowed: Readonly<Record<string, readonly FetchRunStatus[]>> = {
      EXTRACTING: ['PERSISTING'],
      FETCHING: ['FETCHING', 'RECEIVED'],
      PLANNED: ['ROBOTS_CHECKING', 'FETCHING'],
      RECEIVED: ['SANITIZING'],
      RECOVERABLE_PRE_SEND: ['ROBOTS_CHECKING'],
      ROBOTS_CHECKING: ['ROBOTS_CHECKING', 'FETCHING'],
      SANITIZING: ['EXTRACTING'],
    };
    if (!(allowed[row.status] ?? []).includes(stage)) {
      throw new FetchError('FETCH_EXECUTION_CONFLICT');
    }
    const changed = this.#database
      .prepare(
        `UPDATE fetch_runs SET status = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND status = ? AND finished_at IS NULL`,
      )
      .run(stage, now, fetchRunId, row.status).changes;
    if (changed !== 1) throw new FetchError('FETCH_EXECUTION_CONFLICT');
  }

  public async markNetworkDispatch(
    fetchRunId: string,
    input: { readonly kind: 'PAGE' | 'ROBOTS'; readonly now: string },
  ): Promise<void> {
    const column = input.kind === 'PAGE' ? 'page_dispatch_count' : 'robots_dispatch_count';
    const maximum = input.kind === 'PAGE' ? 4 : 2;
    const sendState = input.kind === 'PAGE' ? 'PAGE_SENT' : 'ROBOTS_SENT';
    const changed = this.#database
      .prepare(
        `UPDATE fetch_runs SET
          ${column} = ${column} + 1,
          external_request_count = external_request_count + 1,
          send_state = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND finished_at IS NULL AND rate_reserved = 1
           AND ${column} < ?
           AND external_request_count < (
             SELECT max_external_requests FROM fetch_profiles
             WHERE id = fetch_runs.fetch_profile_id
           )`,
      )
      .run(sendState, input.now, fetchRunId, maximum).changes;
    if (changed !== 1) throw new FetchError('FETCH_EXECUTION_CONFLICT');
  }

  public async findRobotsDecision(input: {
    readonly now: string;
    readonly origin: string;
    readonly policyVersion: string;
    readonly userAgent: string;
  }): Promise<RobotsDecisionV1 | null> {
    const userAgentHash = createHash('sha256').update(input.userAgent, 'utf8').digest('hex');
    const row = this.#database
      .prepare(
        `SELECT * FROM fetch_robots_cache
         WHERE origin = ? AND user_agent_hash = ? AND policy_version = ? AND expires_at > ?`,
      )
      .get(input.origin, userAgentHash, input.policyVersion, input.now) as Row | undefined;
    if (row === undefined) return null;
    return Object.freeze({
      bodyHash: row.body_hash as string | null,
      checkedAt: row.checked_at as string,
      crawlDelayMs: row.crawl_delay_ms as number,
      expiresAt: row.expires_at as string,
      origin: row.origin as string,
      policyVersion: FETCH_ROBOTS_POLICY_VERSION,
      result: row.result as RobotsDecisionV1['result'],
      rules: Object.freeze(
        JSON.parse(row.parsed_rules_json as string) as RobotsDecisionV1['rules'],
      ),
      userAgent: input.userAgent,
    });
  }

  public async saveRobotsDecision(decision: RobotsDecisionV1): Promise<void> {
    const userAgentHash = createHash('sha256').update(decision.userAgent, 'utf8').digest('hex');
    this.#database
      .prepare(
        `INSERT INTO fetch_robots_cache (
          origin, user_agent_hash, policy_version, result, body_hash, parsed_rules_json,
          crawl_delay_ms, checked_at, expires_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(origin, user_agent_hash, policy_version) DO UPDATE SET
          result = excluded.result, body_hash = excluded.body_hash,
          parsed_rules_json = excluded.parsed_rules_json,
          crawl_delay_ms = excluded.crawl_delay_ms, checked_at = excluded.checked_at,
          expires_at = excluded.expires_at, revision = fetch_robots_cache.revision + 1`,
      )
      .run(
        decision.origin,
        userAgentHash,
        decision.policyVersion,
        decision.result,
        decision.bodyHash,
        safeJson(decision.rules, 128 * 1024),
        decision.crawlDelayMs,
        decision.checkedAt,
        decision.expiresAt,
      );
  }

  public async reserveOriginRate(input: {
    readonly crawlDelayMs: number;
    readonly fetchRunId: string;
    readonly now: string;
    readonly origin: string;
    readonly profile: FetchProfileV1;
  }): Promise<FetchOriginRateReservationV1> {
    const profile = validateFetchProfileV1(input.profile);
    return runInTransaction(this.#database, () => {
      const run = this.#database
        .prepare('SELECT status, rate_reserved FROM fetch_runs WHERE id = ?')
        .get(input.fetchRunId) as Row | undefined;
      if (run === undefined || run.rate_reserved !== 0 || terminalStatus(run.status)) {
        throw new FetchError('FETCH_EXECUTION_CONFLICT');
      }
      const existing = this.#database
        .prepare('SELECT * FROM fetch_origin_rate_states WHERE origin = ?')
        .get(input.origin) as Row | undefined;
      const nowMs = Date.parse(input.now);
      const globalInFlight = this.#database
        .prepare(
          `SELECT COALESCE(SUM(in_flight), 0) AS count
           FROM fetch_origin_rate_states`,
        )
        .get() as { readonly count: number };
      if (globalInFlight.count >= profile.globalMaxConcurrent) {
        throw new FetchError('FETCH_RATE_LIMITED');
      }
      let windowStartedAt = input.now;
      let requestCount = 0;
      let inFlight = 0;
      let nextAllowedAt = input.now;
      let revision = 0;
      if (existing !== undefined) {
        nextAllowedAt = existing.next_allowed_at as string;
        revision = existing.revision as number;
        if (existing.policy_revision === profile.ratePolicy.revision) {
          windowStartedAt = existing.window_started_at as string;
          requestCount = existing.request_count as number;
          inFlight = existing.in_flight as number;
          if (nowMs - Date.parse(windowStartedAt) >= profile.ratePolicy.windowMs) {
            windowStartedAt = input.now;
            requestCount = 0;
          }
        } else if ((existing.in_flight as number) > 0) {
          throw new FetchError('FETCH_RATE_LIMITED');
        }
      }
      if (
        inFlight >= 1 ||
        requestCount >= profile.ratePolicy.maxRequestsPerWindow ||
        Date.parse(nextAllowedAt) > nowMs
      ) {
        throw new FetchError('FETCH_RATE_LIMITED');
      }
      const interval = Math.max(profile.ratePolicy.minIntervalMs, input.crawlDelayMs);
      const next = new Date(nowMs + interval).toISOString();
      const reserved = this.#database
        .prepare(
          `UPDATE fetch_runs SET rate_reserved = 1, active_rate_origin = ?,
            updated_at = ?, revision = revision + 1
           WHERE id = ? AND finished_at IS NULL AND rate_reserved = 0`,
        )
        .run(input.origin, input.now, input.fetchRunId).changes;
      if (reserved !== 1) throw new FetchError('FETCH_EXECUTION_CONFLICT');
      this.#database
        .prepare(
          `INSERT INTO fetch_origin_rate_states (
            origin, policy_revision, window_started_at, request_count, in_flight,
            last_started_at, next_allowed_at, revision, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
          ON CONFLICT(origin) DO UPDATE SET
            policy_revision = excluded.policy_revision,
            window_started_at = excluded.window_started_at,
            request_count = excluded.request_count,
            in_flight = excluded.in_flight,
            last_started_at = excluded.last_started_at,
            next_allowed_at = excluded.next_allowed_at,
            revision = excluded.revision,
            updated_at = excluded.updated_at`,
        )
        .run(
          input.origin,
          profile.ratePolicy.revision,
          windowStartedAt,
          requestCount + 1,
          input.now,
          next,
          revision + 1,
          input.now,
        );
      return Object.freeze({
        origin: input.origin,
        reservationId: `${input.fetchRunId}:${this.#idFactory()}`,
      });
    });
  }

  public async settleOriginRate(
    reservation: FetchOriginRateReservationV1,
    input: { readonly finishedAt: string; readonly retryAfterSeconds: number | null },
  ): Promise<void> {
    const fetchRunId = reservation.reservationId.split(':', 1)[0];
    if (fetchRunId === undefined) throw new FetchError('FETCH_EXECUTION_CONFLICT');
    runInTransaction(this.#database, () => {
      const changed = this.#database
        .prepare(
          `UPDATE fetch_runs SET rate_reserved = 0, active_rate_origin = NULL,
            updated_at = ?, revision = revision + 1
           WHERE id = ? AND rate_reserved = 1 AND active_rate_origin = ?`,
        )
        .run(input.finishedAt, fetchRunId, reservation.origin).changes;
      if (changed !== 1) throw new FetchError('FETCH_EXECUTION_CONFLICT');
      const retryAt =
        input.retryAfterSeconds === null
          ? input.finishedAt
          : new Date(Date.parse(input.finishedAt) + input.retryAfterSeconds * 1_000).toISOString();
      this.#database
        .prepare(
          `UPDATE fetch_origin_rate_states SET
            in_flight = CASE WHEN in_flight > 0 THEN in_flight - 1 ELSE 0 END,
            next_allowed_at = CASE WHEN next_allowed_at < ? THEN ? ELSE next_allowed_at END,
            revision = revision + 1, updated_at = ?
           WHERE origin = ?`,
        )
        .run(retryAt, retryAt, input.finishedAt, reservation.origin);
    });
  }

  public async settleSuccess(input: {
    readonly document: FetchedDocumentV1;
    readonly fetchRunId: string;
    readonly finishedAt: string;
    readonly hops: readonly RedirectHopV1[];
    readonly receivedBytes: number;
  }): Promise<FetchOutcomeV1> {
    const document = validateFetchedDocumentV1(input.document);
    runInTransaction(this.#database, () => {
      const run = this.#database
        .prepare(
          `SELECT execution_id, status, rate_reserved FROM fetch_runs
           WHERE id = ? AND finished_at IS NULL`,
        )
        .get(input.fetchRunId) as Row | undefined;
      if (run === undefined || run.status !== 'PERSISTING' || run.rate_reserved !== 0) {
        throw new FetchError('FETCH_EXECUTION_CONFLICT');
      }
      this.#database
        .prepare(
          `INSERT INTO fetched_documents (
            id, final_canonical_url, final_canonical_url_hash, raw_body_hash,
            mime_type, charset, language_hint, sanitizer_version, extractor_version,
            privacy_policy_version, sanitized_html_hash, sanitized_html_bytes,
            sanitized_html_path, extracted_text_hash, extracted_text_bytes,
            extracted_text_path, normalized_content_hash, redacted_email_count,
            redacted_phone_count, redacted_address_count, evidence_eligibility,
            truth_status, fact_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (
            normalized_content_hash, sanitizer_version, extractor_version, privacy_policy_version
          ) DO NOTHING`,
        )
        .run(
          document.documentId,
          document.finalCanonicalUrl,
          document.finalCanonicalUrlHash,
          document.rawBodyHash,
          document.mimeType,
          document.charset,
          document.languageHint,
          document.sanitizerVersion,
          document.extractorVersion,
          document.privacyPolicyVersion,
          document.sanitizedHtmlHash,
          document.sanitizedHtmlBytes,
          document.sanitizedHtmlPath,
          document.extractedTextHash,
          document.extractedTextBytes,
          document.extractedTextPath,
          document.normalizedDocumentContentHash,
          document.redactionCounts.emails,
          document.redactionCounts.phones,
          document.redactionCounts.addresses,
          document.evidenceEligibility,
          document.truthStatus,
          document.factStatus,
          document.createdAt,
        );
      const stored = this.#database
        .prepare(
          `SELECT id FROM fetched_documents
           WHERE normalized_content_hash = ? AND sanitizer_version = ?
             AND extractor_version = ? AND privacy_policy_version = ?`,
        )
        .get(
          document.normalizedDocumentContentHash,
          document.sanitizerVersion,
          document.extractorVersion,
          document.privacyPolicyVersion,
        ) as { readonly id: string } | undefined;
      if (stored === undefined) throw new FetchError('FETCH_STORAGE_FAILED');
      for (const hop of input.hops) {
        this.#database
          .prepare(
            `INSERT INTO fetch_redirect_hops (
              fetch_run_id, hop, status_code, from_host, from_url_hash,
              to_host, to_url_hash, policy_result, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.fetchRunId,
            hop.hop,
            hop.statusCode,
            hop.fromHost,
            hop.fromUrlHash,
            hop.toHost,
            hop.toUrlHash,
            hop.policyResult,
            input.finishedAt,
          );
      }
      const changed = this.#database
        .prepare(
          `UPDATE fetch_runs SET
            status = 'SUCCEEDED', send_state = 'PAGE_SENT',
            final_canonical_url = ?, final_canonical_url_hash = ?,
            response_mime = ?, response_charset = ?, received_bytes = ?,
            redirect_count = ?, redacted_email_count = ?, redacted_phone_count = ?,
            redacted_address_count = ?, document_id = ?, stable_error_code = NULL,
            finished_at = ?, updated_at = ?, revision = revision + 1
           WHERE id = ? AND status = 'PERSISTING' AND finished_at IS NULL`,
        )
        .run(
          document.finalCanonicalUrl,
          document.finalCanonicalUrlHash,
          document.mimeType,
          document.charset,
          input.receivedBytes,
          input.hops.length,
          document.redactionCounts.emails,
          document.redactionCounts.phones,
          document.redactionCounts.addresses,
          stored.id,
          input.finishedAt,
          input.finishedAt,
          input.fetchRunId,
        ).changes;
      if (changed !== 1) throw new FetchError('FETCH_EXECUTION_CONFLICT');
    });
    return this.#outcomeForRun(input.fetchRunId);
  }

  public async settleFailure(
    fetchRunId: string,
    input: {
      readonly error: FetchError;
      readonly finishedAt: string;
      readonly status: FetchTerminalStatus;
    },
  ): Promise<FetchOutcomeV1> {
    runInTransaction(this.#database, () => {
      const run = this.#database
        .prepare('SELECT * FROM fetch_runs WHERE id = ?')
        .get(fetchRunId) as Row | undefined;
      if (run === undefined) throw new FetchError('FETCH_EXECUTION_CONFLICT');
      if (terminalStatus(run.status)) return;
      if (run.rate_reserved === 1 && typeof run.active_rate_origin === 'string') {
        this.#database
          .prepare(
            `UPDATE fetch_origin_rate_states SET
              in_flight = CASE WHEN in_flight > 0 THEN in_flight - 1 ELSE 0 END,
              revision = revision + 1, updated_at = ?
             WHERE origin = ?`,
          )
          .run(input.finishedAt, run.active_rate_origin);
      }
      const sendState = input.status === 'AMBIGUOUS' ? 'UNKNOWN' : input.error.sendState;
      const changed = this.#database
        .prepare(
          `UPDATE fetch_runs SET status = ?, send_state = ?, rate_reserved = 0,
            active_rate_origin = NULL, stable_error_code = ?, finished_at = ?,
            updated_at = ?, revision = revision + 1
           WHERE id = ? AND finished_at IS NULL`,
        )
        .run(
          input.status,
          sendState,
          input.error.code,
          input.finishedAt,
          input.finishedAt,
          fetchRunId,
        ).changes;
      if (changed !== 1) throw new FetchError('FETCH_EXECUTION_CONFLICT');
    });
    return this.#outcomeForRun(fetchRunId);
  }

  public recoverInterrupted(now: string): {
    readonly ambiguous: number;
    readonly recoverablePreSend: number;
  } {
    return runInTransaction(this.#database, () => {
      const rows = this.#database
        .prepare(
          `SELECT * FROM fetch_runs WHERE finished_at IS NULL AND status IN (
            'PLANNED', 'RECOVERABLE_PRE_SEND', 'ROBOTS_CHECKING', 'FETCHING',
            'RECEIVED', 'SANITIZING', 'EXTRACTING', 'PERSISTING'
          )`,
        )
        .all() as Row[];
      let ambiguous = 0;
      let recoverablePreSend = 0;
      for (const row of rows) {
        if (row.rate_reserved === 1 && typeof row.active_rate_origin === 'string') {
          this.#database
            .prepare(
              `UPDATE fetch_origin_rate_states SET
                in_flight = CASE WHEN in_flight > 0 THEN in_flight - 1 ELSE 0 END,
                revision = revision + 1, updated_at = ?
               WHERE origin = ?`,
            )
            .run(now, row.active_rate_origin as string);
        }
        if (row.external_request_count === 0) {
          this.#database
            .prepare(
              `UPDATE fetch_runs SET status = 'RECOVERABLE_PRE_SEND',
                rate_reserved = 0, active_rate_origin = NULL, updated_at = ?,
                revision = revision + 1 WHERE id = ?`,
            )
            .run(now, row.id as string);
          recoverablePreSend += 1;
        } else {
          this.#database
            .prepare(
              `UPDATE fetch_runs SET status = 'AMBIGUOUS', send_state = 'UNKNOWN',
                rate_reserved = 0, active_rate_origin = NULL,
                stable_error_code = 'FETCH_AMBIGUOUS', finished_at = ?, updated_at = ?,
                revision = revision + 1 WHERE id = ?`,
            )
            .run(now, now, row.id as string);
          ambiguous += 1;
        }
      }
      return Object.freeze({ ambiguous, recoverablePreSend });
    });
  }

  public listRecentRuns(limit = 20): readonly FetchRunSummaryRecordV1[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit must be between 1 and 100');
    }
    const rows = this.#database
      .prepare(
        `SELECT id, search_candidate_id, origin, status, response_mime, response_charset,
          received_bytes, redirect_count, redacted_email_count, redacted_phone_count,
          redacted_address_count, external_request_count, document_id, stable_error_code
         FROM fetch_runs ORDER BY started_at DESC, id DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          candidateId: row.search_candidate_id as string,
          charset: row.response_charset as string | null,
          displayHost: new URL(row.origin as string).hostname,
          documentSaved: row.document_id !== null,
          externalRequestCount: row.external_request_count as number,
          fetchRunId: row.id as string,
          mimeType: row.response_mime as string | null,
          receivedBytes: row.received_bytes as number,
          redactionCount:
            (row.redacted_email_count as number) +
            (row.redacted_phone_count as number) +
            (row.redacted_address_count as number),
          redirectCount: row.redirect_count as number,
          stableError: row.stable_error_code as string | null,
          stage: row.status as string,
        }),
      ),
    );
  }

  #outcomeForRun(fetchRunId: string): FetchOutcomeV1 {
    const row = this.#database
      .prepare('SELECT execution_id FROM fetch_runs WHERE id = ?')
      .get(fetchRunId) as { readonly execution_id: string } | undefined;
    if (row === undefined) throw new FetchError('FETCH_INTERNAL');
    const run = this.#database
      .prepare('SELECT * FROM fetch_runs WHERE execution_id = ?')
      .get(row.execution_id) as Row;
    if (!terminalStatus(run.status)) throw new FetchError('FETCH_INTERNAL');
    const document =
      run.document_id === null ? null : this.#documentById(run.document_id as string);
    const code = run.stable_error_code === null ? null : errorCode(run.stable_error_code);
    return validateFetchOutcomeV1({
      charset: run.response_charset,
      contractVersion: CONTROLLED_FETCH_CONTRACT_VERSION,
      document,
      executionId: run.execution_id,
      externalRequestCount: run.external_request_count,
      fetchRunId: run.id,
      finishedAt: run.finished_at,
      mimeType: run.response_mime,
      receivedBytes: run.received_bytes,
      redactionCounts: {
        addresses: run.redacted_address_count,
        emails: run.redacted_email_count,
        phones: run.redacted_phone_count,
      },
      redirectCount: run.redirect_count,
      stableError: code === null ? null : { code, retryable: new FetchError(code).retryable },
      status: run.status,
    });
  }

  #documentById(documentId: string): FetchedDocumentV1 {
    const row = this.#database
      .prepare('SELECT * FROM fetched_documents WHERE id = ?')
      .get(documentId) as Row | undefined;
    if (row === undefined) throw new FetchError('FETCH_INTERNAL');
    return validateFetchedDocumentV1({
      charset: row.charset,
      contractVersion: CONTROLLED_FETCH_CONTRACT_VERSION,
      createdAt: row.created_at,
      documentId: row.id,
      evidenceEligibility: row.evidence_eligibility,
      extractedTextBytes: row.extracted_text_bytes,
      extractedTextHash: row.extracted_text_hash,
      extractedTextPath: parseManagedRelativePath(
        row.extracted_text_path as string,
        'SOURCE_SNAPSHOT',
      ),
      extractorVersion: FETCH_EXTRACTOR_VERSION,
      factStatus: row.fact_status,
      finalCanonicalUrl: row.final_canonical_url,
      finalCanonicalUrlHash: row.final_canonical_url_hash,
      languageHint: row.language_hint,
      mimeType: row.mime_type,
      normalizedDocumentContentHash: row.normalized_content_hash,
      privacyPolicyVersion: FETCH_PRIVACY_POLICY_VERSION,
      rawBodyHash: row.raw_body_hash,
      redactionCounts: {
        addresses: row.redacted_address_count,
        emails: row.redacted_email_count,
        phones: row.redacted_phone_count,
      },
      sanitizedHtmlBytes: row.sanitized_html_bytes,
      sanitizedHtmlHash: row.sanitized_html_hash,
      sanitizedHtmlPath: parseManagedRelativePath(
        row.sanitized_html_path as string,
        'SOURCE_SNAPSHOT',
      ),
      sanitizerVersion: FETCH_SANITIZER_VERSION,
      truthStatus: row.truth_status,
    });
  }
}
