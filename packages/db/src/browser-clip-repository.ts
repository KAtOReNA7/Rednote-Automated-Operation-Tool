import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  BROWSER_CLIP_CONTRACT_VERSION,
  BrowserClipContractError,
  type BrowserClipCreateV1,
  type BrowserClipReceiptV1,
  validateBrowserClipCreateV1,
} from '@mystery-operations/shared';
import {
  BrowserClipAdapter,
  canonicalizeSearchUrl,
  SEARCH_PROVIDER_CONTRACT_VERSION,
  type SearchBatchV1,
  type SearchCandidateV1,
  type SearchPlanV1,
  type SearchRequestV1,
} from '@mystery-operations/search';

import { SqliteSearchRepository } from './search-repository.js';
import { runInTransaction } from './transaction.js';

export interface BrowserClipScreenshotRecordV1 {
  readonly bytes: number;
  readonly height: number;
  readonly managedPath: string;
  readonly mime: 'image/jpeg' | 'image/png';
  readonly sha256: string;
  readonly width: number;
}

export interface BrowserClipViewV1 {
  readonly accountName: string | null;
  readonly candidateId: string;
  readonly capturedAt: string;
  readonly clientLabel: string | null;
  readonly clipId: string;
  readonly displayHost: string;
  readonly hasScreenshot: boolean;
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly platform: string;
  readonly publishedAt: string | null;
  readonly selectedText: string | null;
  readonly tags: readonly string[];
  readonly userNote: string | null;
  readonly visibleMetrics: Readonly<Record<string, number | null>>;
}

type Row = Readonly<Record<string, number | string | Uint8Array | null>>;

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function booleanValue(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

export class SqliteBrowserClipRepository {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
    const descriptor = new BrowserClipAdapter().describe();
    new SqliteSearchRepository(database).upsertProviderConfig(
      {
        curatedEntries: [],
        descriptor,
        enabled: true,
        ratePolicy: null,
        settingsRevision: 1,
        timeoutMs: 5_000,
      },
      new Date().toISOString(),
    );
  }

  public async ingest(input: {
    readonly clientId: string;
    readonly clip: BrowserClipCreateV1;
    readonly extensionOrigin: string;
    readonly now: string;
    readonly payloadHash: string;
    readonly screenshot: BrowserClipScreenshotRecordV1 | null;
  }): Promise<BrowserClipReceiptV1> {
    const clip = validateBrowserClipCreateV1(input.clip);
    const existing = this.#receipt(input.extensionOrigin, clip.captureId);
    if (existing !== null) {
      const row = this.#database
        .prepare(
          `SELECT payload_hash FROM clip_ingest_receipts
           WHERE extension_origin = ? AND capture_id = ?`,
        )
        .get(input.extensionOrigin, clip.captureId) as Row;
      if (row.payload_hash !== input.payloadHash) {
        throw new BrowserClipContractError('CLIPPER_CAPTURE_CONFLICT');
      }
      return existing;
    }

    const searchRunId = `clip-search-${clip.captureId}`;
    const request = this.#searchRequest(clip);
    const adapter = new BrowserClipAdapter();
    const batch = await adapter.execute(request, {
      now: () => new Date(input.now),
      plan: {} as SearchPlanV1,
      searchRunId,
    });
    const candidate = batch.candidates[0];
    if (candidate === undefined) throw new BrowserClipContractError('CLIPPER_INTERNAL');
    const clipId = `clip-${this.#idFactory()}`;

    return runInTransaction(this.#database, () => {
      this.#takeRate(input.clientId, input.now, input.screenshot?.bytes ?? 0);
      this.#insertSearchRun(batch, request);
      this.#insertCandidate(candidate);
      const normalized = canonicalizeSearchUrl(clip.pageUrl);
      this.#database
        .prepare(
          `INSERT INTO clips (
            id, url, normalized_url, url_hash, platform, account_name, page_title,
            published_at, selected_text, selected_text_hash, user_note, visible_metrics_json,
            screenshot_path, screenshot_mime, screenshot_hash, screenshot_bytes,
            screenshot_width, screenshot_height, tags_json, capture_id, local_api_client_id,
            extension_origin, capture_source, browser_family, contract_version,
            extension_build_version, public_page_confirmed, status, revision, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'BROWSER_EXTENSION', ?, ?, ?, 1, 'STORED', 1, ?, ?
          )`,
        )
        .run(
          clipId,
          clip.pageUrl,
          normalized.canonicalUrl,
          normalized.urlHash,
          clip.platform,
          clip.accountName,
          clip.pageTitle,
          clip.publishedAt,
          clip.selectedText,
          clip.selectedText === null ? null : hash(clip.selectedText),
          clip.userNote,
          json(clip.visibleMetrics),
          input.screenshot?.managedPath ?? null,
          input.screenshot?.mime ?? null,
          input.screenshot?.sha256 ?? null,
          input.screenshot?.bytes ?? null,
          input.screenshot?.width ?? null,
          input.screenshot?.height ?? null,
          json(clip.contentTags),
          clip.captureId,
          input.clientId,
          input.extensionOrigin,
          clip.browserFamily,
          BROWSER_CLIP_CONTRACT_VERSION,
          clip.extensionBuildVersion,
          clip.capturedAt,
          input.now,
        );
      this.#database
        .prepare(
          `INSERT INTO clip_search_candidate_links(clip_id, candidate_id, created_at)
           VALUES (?, ?, ?)`,
        )
        .run(clipId, candidate.candidateId, input.now);
      this.#database
        .prepare(
          `INSERT INTO clip_ingest_receipts (
            extension_origin, capture_id, payload_hash, client_id, status,
            clip_id, candidate_id, created_at, updated_at, stable_error
          ) VALUES (?, ?, ?, ?, 'SUCCEEDED', ?, ?, ?, ?, NULL)`,
        )
        .run(
          input.extensionOrigin,
          clip.captureId,
          input.payloadHash,
          input.clientId,
          clipId,
          candidate.candidateId,
          input.now,
          input.now,
        );
      this.#settleRate(input.clientId, input.now);
      return {
        candidateId: candidate.candidateId,
        captureId: clip.captureId,
        clipId,
        createdAt: input.now,
        status: 'SUCCEEDED',
        updatedAt: input.now,
      };
    });
  }

  public getReceipt(
    clientId: string,
    extensionOrigin: string,
    captureId: string,
  ): BrowserClipReceiptV1 {
    const row = this.#database
      .prepare(
        `SELECT capture_id, clip_id, candidate_id, status, created_at, updated_at
         FROM clip_ingest_receipts
         WHERE extension_origin = ? AND capture_id = ? AND client_id = ?`,
      )
      .get(extensionOrigin, captureId, clientId) as Row | undefined;
    if (row === undefined) {
      const now = new Date().toISOString();
      return {
        candidateId: null,
        captureId,
        clipId: null,
        createdAt: now,
        status: 'UNKNOWN',
        updatedAt: now,
      };
    }
    return {
      candidateId: row.candidate_id as string | null,
      captureId: row.capture_id as string,
      clipId: row.clip_id as string | null,
      createdAt: row.created_at as string,
      status: row.status as BrowserClipReceiptV1['status'],
      updatedAt: row.updated_at as string,
    };
  }

  public listClips(limit = 50): readonly BrowserClipViewV1[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('limit');
    return Object.freeze(
      (
        this.#database
          .prepare(
            `SELECT c.*, l.candidate_id, a.client_label
             FROM clips c JOIN clip_search_candidate_links l ON l.clip_id = c.id
             JOIN local_api_clients a ON a.id = c.local_api_client_id
             WHERE c.capture_source = 'BROWSER_EXTENSION'
             ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
          )
          .all(limit) as Row[]
      ).map((row) => this.#mapClip(row)),
    );
  }

  public getClip(clipId: string): BrowserClipViewV1 | null {
    const row = this.#database
      .prepare(
        `SELECT c.*, l.candidate_id, a.client_label
         FROM clips c JOIN clip_search_candidate_links l ON l.clip_id = c.id
         JOIN local_api_clients a ON a.id = c.local_api_client_id
         WHERE c.id = ? AND c.capture_source = 'BROWSER_EXTENSION'`,
      )
      .get(clipId) as Row | undefined;
    return row === undefined ? null : this.#mapClip(row);
  }

  public getScreenshot(clipId: string): BrowserClipScreenshotRecordV1 | null {
    const row = this.#database
      .prepare(
        `SELECT screenshot_path, screenshot_mime, screenshot_hash, screenshot_bytes,
                screenshot_width, screenshot_height
         FROM clips WHERE id = ? AND capture_source = 'BROWSER_EXTENSION'`,
      )
      .get(clipId) as Row | undefined;
    if (row === undefined || row.screenshot_path === null) return null;
    return {
      bytes: row.screenshot_bytes as number,
      height: row.screenshot_height as number,
      managedPath: row.screenshot_path as string,
      mime: row.screenshot_mime as BrowserClipScreenshotRecordV1['mime'],
      sha256: row.screenshot_hash as string,
      width: row.screenshot_width as number,
    };
  }

  #receipt(origin: string, captureId: string): BrowserClipReceiptV1 | null {
    const row = this.#database
      .prepare(
        `SELECT capture_id, clip_id, candidate_id, status, created_at, updated_at
         FROM clip_ingest_receipts WHERE extension_origin = ? AND capture_id = ?`,
      )
      .get(origin, captureId) as Row | undefined;
    return row === undefined
      ? null
      : {
          candidateId: row.candidate_id as string | null,
          captureId: row.capture_id as string,
          clipId: row.clip_id as string | null,
          createdAt: row.created_at as string,
          status: row.status as BrowserClipReceiptV1['status'],
          updatedAt: row.updated_at as string,
        };
  }

  #searchRequest(clip: BrowserClipCreateV1): SearchRequestV1 {
    return {
      allowedDomains: [],
      blockedDomains: [],
      contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
      countryHint: null,
      cursor: null,
      executionId: `browser-clip:${clip.captureId}`,
      intent: 'USER_PROVIDED_CLIP',
      jobId: null,
      liveAccess: 'UNSPECIFIED',
      localeHints: [],
      localInput: {
        capturedAt: clip.capturedAt,
        kind: 'BROWSER_CLIP',
        note: null,
        title: clip.pageTitle,
        url: clip.pageUrl,
      },
      maxResults: 1,
      providerInstanceId: 'browser-clip-v1',
      publishedAfter: null,
      publishedBefore: null,
      query: '',
      ratePolicyRef: null,
    };
  }

  #insertSearchRun(batch: SearchBatchV1, request: SearchRequestV1): void {
    this.#database
      .prepare(
        `INSERT INTO search_runs (
          id, execution_id, job_id, provider_kind, provider_instance_id, provider_mode,
          provider_readiness, request_semantic_hash, plan_hash, query_hash, intent,
          status, certainty, external_request_count, rate_reserved, candidate_count,
          rejected_count, duplicate_count, total_appearance_count, truncated, cursor,
          rate_policy_version, cost_state, usage_json, warnings_json, stable_error_code,
          started_at, finished_at, revision, created_at, updated_at
        ) VALUES (
          ?, ?, NULL, 'BROWSER_CLIP', 'browser-clip-v1', 'PASSIVE_LOCAL', 'READY',
          ?, ?, ?, 'USER_PROVIDED_CLIP', ?, ?, 0, 0, ?, ?, ?, ?, 0, NULL, NULL,
          'NOT_INCURRED', NULL, ?, NULL, ?, ?, 1, ?, ?
        )`,
      )
      .run(
        batch.searchRunId,
        request.executionId,
        batch.requestSemanticHash,
        hash(`browser-clip-plan:${request.executionId}`),
        hash(''),
        batch.status,
        batch.certainty,
        batch.counts.accepted,
        batch.counts.rejected,
        batch.counts.duplicates,
        batch.counts.totalAppearances,
        json(batch.warnings),
        batch.startedAt,
        batch.finishedAt,
        batch.startedAt,
        batch.finishedAt,
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
        null,
        'NONE',
        candidate.upstreamRank,
        candidate.upstreamIdHash,
        candidate.publishedAt,
        candidate.languageHint,
        candidate.discoveredAt,
        1,
        'BROWSER_CLIP_INPUT',
        'NOT_APPLICABLE',
        booleanValue(candidate.wasConsulted),
        booleanValue(candidate.wasCited),
        'LEAD_ONLY',
        'NOT_FETCHED',
        'UNVERIFIED',
        'NOT_A_FACT',
        null,
        json(candidate.provenanceAppearances),
        '[]',
        candidate.discoveredAt,
      );
  }

  #takeRate(clientId: string, now: string, screenshotBytes: number): void {
    const existing = this.#database
      .prepare('SELECT * FROM clip_ingest_rate_states WHERE client_id = ?')
      .get(clientId) as Row | undefined;
    const nowMs = Date.parse(now);
    let minuteStartedAt = now;
    let minuteCount = 0;
    let dayStartedAt = now;
    let dayCount = 0;
    let dayScreenshotBytes = 0;
    let failedCount = 0;
    if (existing !== undefined) {
      if (existing.in_flight === 1) throw new BrowserClipContractError('CLIPPER_RATE_LIMITED');
      minuteStartedAt = existing.minute_started_at as string;
      minuteCount = existing.minute_count as number;
      dayStartedAt = existing.day_started_at as string;
      dayCount = existing.day_count as number;
      dayScreenshotBytes = existing.day_screenshot_bytes as number;
      failedCount = existing.failed_count as number;
      if (nowMs - Date.parse(minuteStartedAt) >= 60_000) {
        minuteStartedAt = now;
        minuteCount = 0;
      }
      if (nowMs - Date.parse(dayStartedAt) >= 86_400_000) {
        dayStartedAt = now;
        dayCount = 0;
        dayScreenshotBytes = 0;
        failedCount = 0;
      }
    }
    if (
      minuteCount >= 30 ||
      dayCount >= 500 ||
      dayScreenshotBytes + screenshotBytes > 100 * 1024 * 1024 ||
      failedCount >= 100
    ) {
      throw new BrowserClipContractError('CLIPPER_RATE_LIMITED');
    }
    this.#database
      .prepare(
        `INSERT INTO clip_ingest_rate_states (
          client_id, minute_started_at, minute_count, day_started_at, day_count,
          day_screenshot_bytes, failed_count, in_flight, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(client_id) DO UPDATE SET
          minute_started_at=excluded.minute_started_at, minute_count=excluded.minute_count,
          day_started_at=excluded.day_started_at, day_count=excluded.day_count,
          day_screenshot_bytes=excluded.day_screenshot_bytes, failed_count=excluded.failed_count,
          in_flight=1, updated_at=excluded.updated_at`,
      )
      .run(
        clientId,
        minuteStartedAt,
        minuteCount + 1,
        dayStartedAt,
        dayCount + 1,
        dayScreenshotBytes + screenshotBytes,
        failedCount,
        now,
      );
  }

  #settleRate(clientId: string, now: string): void {
    this.#database
      .prepare(
        `UPDATE clip_ingest_rate_states SET in_flight = 0, updated_at = ?
         WHERE client_id = ? AND in_flight = 1`,
      )
      .run(now, clientId);
  }

  #mapClip(row: Row): BrowserClipViewV1 {
    const normalized = canonicalizeSearchUrl(row.normalized_url as string);
    return Object.freeze({
      accountName: row.account_name as string | null,
      candidateId: row.candidate_id as string,
      capturedAt: row.created_at as string,
      clientLabel: row.client_label as string | null,
      clipId: row.id as string,
      displayHost: normalized.displayHost,
      hasScreenshot: row.screenshot_path !== null,
      pageTitle: row.page_title as string,
      pageUrl: row.normalized_url as string,
      platform: row.platform as string,
      publishedAt: row.published_at as string | null,
      selectedText: row.selected_text as string | null,
      tags: Object.freeze(JSON.parse(row.tags_json as string) as string[]),
      userNote: row.user_note as string | null,
      visibleMetrics: Object.freeze(
        JSON.parse(row.visible_metrics_json as string) as Record<string, number | null>,
      ),
    });
  }
}
