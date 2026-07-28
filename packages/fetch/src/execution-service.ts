import type { SearchCandidateV1 } from '@mystery-operations/search';
import type { ManagedRelativePath } from '@mystery-operations/shared/storage';

import {
  CONTROLLED_FETCH_CONTRACT_VERSION,
  FETCH_EVIDENCE_ELIGIBILITY,
  FETCH_EXTRACTOR_VERSION,
  FETCH_FACT_STATUS,
  FETCH_JOB_TYPE,
  FETCH_LIMITS,
  FETCH_TERMINAL_STATUSES,
  FETCH_PRIVACY_POLICY_VERSION,
  FETCH_ROBOTS_POLICY_VERSION,
  FETCH_SANITIZER_VERSION,
  FETCH_TRUTH_STATUS,
  FETCH_USER_AGENT,
  type FetchRunStatus,
  type FetchSendState,
  type FetchTerminalStatus,
} from './constants.js';
import {
  type FetchedDocumentV1,
  type FetchOutcomeV1,
  type FetchPlanV1,
  type FetchProfileV1,
  type FetchRequestV1,
  type RedirectHopV1,
  type RobotsDecisionV1,
  fetchRequestSemanticHash,
  validateFetchOutcomeV1,
  validateFetchPlanForExecution,
  validateFetchPlanV1,
  validateFetchRequestV1,
} from './contracts.js';
import { FetchError, isFetchError } from './errors.js';
import { processFetchedContent } from './html.js';
import {
  DnsPinningSession,
  type DnsResolverV1,
  validateFetchUrl,
  validateRedirectTarget,
} from './network-policy.js';
import {
  assertRobotsDecisionAllows,
  createRobotsStatusDecision,
  evaluateRobotsText,
} from './robots.js';
import {
  parseFetchContentType,
  type FetchTransportResponseV1,
  type FetchTransportV1,
} from './transport.js';

export interface FetchCandidateReaderV1 {
  findCandidate(candidateId: string): Promise<SearchCandidateV1 | null>;
}

export interface FetchProfileReaderV1 {
  getProfile(profileId: string): Promise<FetchProfileV1 | null>;
}

export interface FetchSnapshotStoreV1 {
  put(
    content: Uint8Array,
    input: {
      readonly displayName: string;
      readonly maxBytes: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<{
    readonly managedPath: ManagedRelativePath;
    readonly sha256: string;
    readonly sizeBytes: number;
  }>;
}

export interface FetchOriginRateReservationV1 {
  readonly origin: string;
  readonly reservationId: string;
}

export interface FetchPersistenceV1 {
  beginRun(input: {
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
  }>;
  findRobotsDecision(input: {
    readonly now: string;
    readonly origin: string;
    readonly policyVersion: string;
    readonly userAgent: string;
  }): Promise<RobotsDecisionV1 | null>;
  findExecutionIdentity(executionId: string): Promise<{
    readonly planHash: string;
    readonly requestSemanticHash: string;
  } | null>;
  findTerminalByExecutionId(executionId: string): Promise<FetchOutcomeV1 | null>;
  markNetworkDispatch(
    fetchRunId: string,
    input: {
      readonly kind: 'PAGE' | 'ROBOTS';
      readonly now: string;
    },
  ): Promise<void>;
  reserveOriginRate(input: {
    readonly crawlDelayMs: number;
    readonly fetchRunId: string;
    readonly now: string;
    readonly origin: string;
    readonly profile: FetchProfileV1;
  }): Promise<FetchOriginRateReservationV1>;
  saveRobotsDecision(decision: RobotsDecisionV1): Promise<void>;
  settleFailure(
    fetchRunId: string,
    input: {
      readonly error: FetchError;
      readonly finishedAt: string;
      readonly status: FetchTerminalStatus;
    },
  ): Promise<FetchOutcomeV1>;
  settleOriginRate(
    reservation: FetchOriginRateReservationV1,
    input: {
      readonly finishedAt: string;
      readonly retryAfterSeconds: number | null;
    },
  ): Promise<void>;
  settleSuccess(input: {
    readonly document: FetchedDocumentV1;
    readonly fetchRunId: string;
    readonly finishedAt: string;
    readonly hops: readonly RedirectHopV1[];
    readonly receivedBytes: number;
  }): Promise<FetchOutcomeV1>;
  transition(fetchRunId: string, stage: FetchRunStatus, now: string): Promise<void>;
}

export interface FetchExecutionServiceOptions {
  readonly allowNonPublicForTests?: boolean;
  readonly candidateReader: FetchCandidateReaderV1;
  readonly dnsResolver: DnsResolverV1;
  readonly delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly idFactory: () => string;
  readonly now?: () => Date;
  readonly persistence: FetchPersistenceV1;
  readonly profileReader: FetchProfileReaderV1;
  readonly snapshotStore: FetchSnapshotStoreV1;
  readonly transport: FetchTransportV1;
}

function cancellationError(signal: AbortSignal | undefined, sent: boolean): FetchError | null {
  if (signal?.aborted !== true) return null;
  return new FetchError(sent ? 'FETCH_CANCELLED_AFTER_SEND' : 'FETCH_CANCELLED_BEFORE_SEND', {
    sendState: sent ? 'PAGE_SENT' : 'NOT_SENT',
  });
}

function terminalStatus(error: FetchError): FetchTerminalStatus {
  if (error.code === 'FETCH_ROBOTS_DISALLOWED') return 'ROBOTS_BLOCKED';
  if (error.code === 'FETCH_RATE_LIMITED' && error.sendState === 'NOT_SENT') {
    return 'RATE_LIMITED_BEFORE_SEND';
  }
  if (error.code === 'FETCH_CANCELLED_BEFORE_SEND') return 'CANCELLED_BEFORE_SEND';
  if (error.code === 'FETCH_CANCELLED_AFTER_SEND') return 'CANCELLED_AFTER_SEND';
  if (error.code === 'FETCH_AMBIGUOUS' || error.sendState === 'UNKNOWN') return 'AMBIGUOUS';
  if (
    [
      'FETCH_ACCESS_CONTROLLED',
      'FETCH_CHALLENGE_DETECTED',
      'FETCH_EXTRACTION_EMPTY',
      'FETCH_HOST_DISALLOWED',
      'FETCH_MIME_MISSING',
      'FETCH_MIME_UNSUPPORTED',
      'FETCH_MIME_MISMATCH',
      'FETCH_PRIVACY_REVIEW_REQUIRED',
      'FETCH_REDIRECT_CROSS_HOST',
      'FETCH_REDIRECT_INVALID',
      'FETCH_REDIRECT_LIMIT',
      'FETCH_ROBOTS_UNKNOWN',
      'FETCH_URL_INVALID',
    ].includes(error.code)
  ) {
    return 'REJECTED';
  }
  return error.sendState === 'NOT_SENT' ? 'FAILED_BEFORE_SEND' : 'FAILED_AFTER_SEND';
}

function redirectStatus(value: number): boolean {
  return [301, 302, 303, 307, 308].includes(value);
}

function accessControlledStatus(value: number): boolean {
  return [401, 403, 407, 429].includes(value);
}

function requireRobotsContentType(response: FetchTransportResponseV1): string | null {
  if (response.contentType === null)
    throw new FetchError('FETCH_ROBOTS_UNKNOWN', { sendState: 'ROBOTS_SENT' });
  const [mime, ...parameters] = response.contentType.split(';');
  if (mime?.trim().toLowerCase() !== 'text/plain') {
    throw new FetchError('FETCH_ROBOTS_UNKNOWN', { sendState: 'ROBOTS_SENT' });
  }
  const charsetParameter = parameters
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('charset='));
  if (charsetParameter === undefined) return null;
  return charsetParameter.slice(charsetParameter.indexOf('=') + 1).replace(/^"|"$/gu, '');
}

function decodeRobotsBody(response: FetchTransportResponseV1): string {
  const declared = requireRobotsContentType(response);
  if (declared !== null && !/^utf-?8$/iu.test(declared)) {
    throw new FetchError('FETCH_ROBOTS_UNKNOWN', { sendState: 'ROBOTS_SENT' });
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(response.body);
  } catch (cause) {
    throw new FetchError('FETCH_ROBOTS_UNKNOWN', { cause, sendState: 'ROBOTS_SENT' });
  }
}

export class FetchExecutionService {
  readonly #allowNonPublicForTests: boolean;
  readonly #candidateReader: FetchCandidateReaderV1;
  readonly #dnsResolver: DnsResolverV1;
  readonly #delay: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #idFactory: () => string;
  readonly #now: () => Date;
  readonly #persistence: FetchPersistenceV1;
  readonly #profileReader: FetchProfileReaderV1;
  readonly #snapshotStore: FetchSnapshotStoreV1;
  readonly #transport: FetchTransportV1;

  public constructor(options: FetchExecutionServiceOptions) {
    this.#allowNonPublicForTests = options.allowNonPublicForTests ?? false;
    this.#candidateReader = options.candidateReader;
    this.#dnsResolver = options.dnsResolver;
    this.#delay =
      options.delay ??
      (async (milliseconds, signal) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, milliseconds);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new FetchError('FETCH_CANCELLED_BEFORE_SEND'));
            },
            { once: true },
          );
        });
      });
    this.#idFactory = options.idFactory;
    this.#now = options.now ?? (() => new Date());
    this.#persistence = options.persistence;
    this.#profileReader = options.profileReader;
    this.#snapshotStore = options.snapshotStore;
    this.#transport = options.transport;
  }

  public async execute(
    requestValue: FetchRequestV1,
    planValue: FetchPlanV1,
    signal?: AbortSignal,
  ): Promise<FetchOutcomeV1> {
    const request = validateFetchRequestV1(requestValue);
    const plan = validateFetchPlanV1(planValue);
    const requestHash = fetchRequestSemanticHash(request);
    const existingIdentity = await this.#persistence.findExecutionIdentity(request.executionId);
    if (existingIdentity !== null) {
      if (
        existingIdentity.requestSemanticHash !== requestHash ||
        existingIdentity.planHash !== plan.planHash
      ) {
        throw new FetchError('FETCH_EXECUTION_CONFLICT');
      }
      const existing = await this.#persistence.findTerminalByExecutionId(request.executionId);
      if (existing !== null) return validateFetchOutcomeV1(existing);
    }
    const candidate = await this.#candidateReader.findCandidate(request.searchCandidateId);
    if (candidate === null) throw new FetchError('FETCH_CANDIDATE_NOT_FOUND');
    const profile = await this.#profileReader.getProfile(request.fetchProfileId);
    if (profile === null || !profile.enabled) throw new FetchError('FETCH_PLAN_STALE');
    validateFetchPlanForExecution(plan, request, candidate, profile, this.#now());
    const startCancellation = cancellationError(signal, false);
    if (startCancellation !== null) throw startCancellation;
    const begin = await this.#persistence.beginRun({
      fetchRunId: this.#idFactory(),
      plan,
      request,
      requestSemanticHash: requestHash,
      startedAt: this.#now().toISOString(),
    });
    if (begin.state === 'EXISTING_TERMINAL') {
      const completed = await this.#persistence.findTerminalByExecutionId(request.executionId);
      if (completed === null) throw new FetchError('FETCH_EXECUTION_CONFLICT');
      return completed;
    }
    if (begin.state === 'EXISTING_AMBIGUOUS') {
      throw new FetchError('FETCH_AMBIGUOUS', { sendState: 'UNKNOWN' });
    }
    if (begin.state === 'EXISTING_IN_FLIGHT') {
      throw new FetchError('FETCH_EXECUTION_CONFLICT');
    }
    const fetchRunId = begin.fetchRunId;
    const dnsSession = new DnsPinningSession(this.#dnsResolver, {
      allowNonPublicForTests: this.#allowNonPublicForTests,
    });
    const deadlineAt = this.#now().getTime() + profile.limits.totalTimeoutMs;
    try {
      const candidateUrl = validateFetchUrl(candidate.canonicalUrl);
      if (
        candidate.candidateId !== request.searchCandidateId ||
        candidate.urlHash !== request.expectedCanonicalUrlHash ||
        candidateUrl.urlHash !== request.expectedCanonicalUrlHash
      ) {
        throw new FetchError('FETCH_CANDIDATE_BINDING_MISMATCH');
      }
      const robotsDecision = await this.#robotsDecision({
        candidateUrl: new URL(candidateUrl.canonicalUrl),
        deadlineAt,
        dnsSession,
        fetchRunId,
        profile,
        ...(signal === undefined ? {} : { signal }),
      });
      assertRobotsDecisionAllows(robotsDecision);
      const policyDelay = Math.max(robotsDecision.crawlDelayMs, profile.ratePolicy.minIntervalMs);
      if (policyDelay > 0) {
        if (this.#now().getTime() + policyDelay > deadlineAt) {
          throw new FetchError('FETCH_TIMEOUT_BEFORE_SEND');
        }
        await this.#delay(policyDelay, signal);
      }
      const result = await this.#fetchPage({
        crawlDelayMs: robotsDecision.crawlDelayMs,
        deadlineAt,
        dnsSession,
        fetchRunId,
        initialUrl: new URL(candidateUrl.canonicalUrl),
        profile,
        ...(signal === undefined ? {} : { signal }),
      });
      await this.#persistence.transition(fetchRunId, 'RECEIVED', this.#now().toISOString());
      const afterSendCancellation = cancellationError(signal, true);
      if (afterSendCancellation !== null) throw afterSendCancellation;
      if (result.response.contentDisposition?.toLowerCase().includes('attachment') === true) {
        throw new FetchError('FETCH_MIME_UNSUPPORTED', { sendState: 'PAGE_SENT' });
      }
      const contentType = parseFetchContentType(result.response.contentType);
      await this.#persistence.transition(fetchRunId, 'SANITIZING', this.#now().toISOString());
      const processed = processFetchedContent({
        body: result.response.body,
        declaredCharset: contentType.charset,
        limits: profile.limits,
        mimeType: contentType.mimeType,
      });
      await this.#persistence.transition(fetchRunId, 'EXTRACTING', this.#now().toISOString());
      const processingCancellation = cancellationError(signal, true);
      if (processingCancellation !== null) throw processingCancellation;
      await this.#persistence.transition(fetchRunId, 'PERSISTING', this.#now().toISOString());
      let htmlFile;
      let textFile;
      try {
        htmlFile = await this.#snapshotStore.put(Buffer.from(processed.sanitizedHtml, 'utf8'), {
          displayName: `${processed.sanitizedHtmlHash}.html`,
          maxBytes: profile.limits.sanitizedBytes,
          ...(signal === undefined ? {} : { signal }),
        });
        textFile = await this.#snapshotStore.put(Buffer.from(processed.extractedText, 'utf8'), {
          displayName: `${processed.extractedTextHash}.txt`,
          maxBytes: profile.limits.textBytes,
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (cause) {
        throw new FetchError('FETCH_STORAGE_FAILED', { cause, sendState: 'PAGE_SENT' });
      }
      if (
        htmlFile.sha256 !== processed.sanitizedHtmlHash ||
        htmlFile.sizeBytes !== processed.sanitizedHtmlBytes ||
        textFile.sha256 !== processed.extractedTextHash ||
        textFile.sizeBytes !== processed.extractedTextBytes
      ) {
        throw new FetchError('FETCH_STORAGE_FAILED', { sendState: 'PAGE_SENT' });
      }
      const document: FetchedDocumentV1 = Object.freeze({
        charset: processed.charset,
        contractVersion: CONTROLLED_FETCH_CONTRACT_VERSION,
        createdAt: this.#now().toISOString(),
        documentId: this.#idFactory(),
        evidenceEligibility: FETCH_EVIDENCE_ELIGIBILITY,
        extractedTextBytes: processed.extractedTextBytes,
        extractedTextHash: processed.extractedTextHash,
        extractedTextPath: textFile.managedPath,
        extractorVersion: FETCH_EXTRACTOR_VERSION,
        factStatus: FETCH_FACT_STATUS,
        finalCanonicalUrl: result.finalUrl.href,
        finalCanonicalUrlHash: validateFetchUrl(result.finalUrl.href).urlHash,
        languageHint: processed.languageHint,
        mimeType: contentType.mimeType,
        normalizedDocumentContentHash: processed.normalizedDocumentContentHash,
        privacyPolicyVersion: FETCH_PRIVACY_POLICY_VERSION,
        rawBodyHash: processed.rawBodyHash,
        redactionCounts: processed.redactionCounts,
        sanitizedHtmlBytes: processed.sanitizedHtmlBytes,
        sanitizedHtmlHash: processed.sanitizedHtmlHash,
        sanitizedHtmlPath: htmlFile.managedPath,
        sanitizerVersion: FETCH_SANITIZER_VERSION,
        truthStatus: FETCH_TRUTH_STATUS,
      });
      return validateFetchOutcomeV1(
        await this.#persistence.settleSuccess({
          document,
          fetchRunId,
          finishedAt: this.#now().toISOString(),
          hops: result.hops,
          receivedBytes: result.response.decodedBytes,
        }),
      );
    } catch (cause) {
      const error = isFetchError(cause)
        ? cause
        : new FetchError('FETCH_INTERNAL', { cause, sendState: 'UNKNOWN' });
      const outcome = await this.#persistence.settleFailure(fetchRunId, {
        error,
        finishedAt: this.#now().toISOString(),
        status: terminalStatus(error),
      });
      throw Object.assign(error, { outcome: validateFetchOutcomeV1(outcome) });
    }
  }

  async #reserveAndFetch(input: {
    readonly crawlDelayMs: number;
    readonly deadlineAt: number;
    readonly dnsSession: DnsPinningSession;
    readonly fetchRunId: string;
    readonly kind: 'PAGE' | 'ROBOTS';
    readonly profile: FetchProfileV1;
    readonly signal?: AbortSignal;
    readonly url: URL;
  }): Promise<FetchTransportResponseV1> {
    const before = cancellationError(input.signal, false);
    if (before !== null) throw before;
    const target = await input.dnsSession.resolve(input.url.href, input.signal);
    const reservation = await this.#persistence.reserveOriginRate({
      crawlDelayMs: input.crawlDelayMs,
      fetchRunId: input.fetchRunId,
      now: this.#now().toISOString(),
      origin: input.url.origin,
      profile: input.profile,
    });
    try {
      await this.#persistence.markNetworkDispatch(input.fetchRunId, {
        kind: input.kind,
        now: this.#now().toISOString(),
      });
      const response = await this.#transport.fetch({
        deadlineAt: input.deadlineAt,
        kind: input.kind,
        pinnedTarget: target,
        profile: input.profile,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        url: input.url,
      });
      await this.#persistence.settleOriginRate(reservation, {
        finishedAt: this.#now().toISOString(),
        retryAfterSeconds: response.retryAfterSeconds,
      });
      return response;
    } catch (cause) {
      await this.#persistence.settleOriginRate(reservation, {
        finishedAt: this.#now().toISOString(),
        retryAfterSeconds:
          cause instanceof FetchError && typeof cause.safeDetails.retryAfterSeconds === 'number'
            ? cause.safeDetails.retryAfterSeconds
            : null,
      });
      throw cause;
    }
  }

  async #robotsDecision(input: {
    readonly candidateUrl: URL;
    readonly deadlineAt: number;
    readonly dnsSession: DnsPinningSession;
    readonly fetchRunId: string;
    readonly profile: FetchProfileV1;
    readonly signal?: AbortSignal;
  }): Promise<RobotsDecisionV1> {
    const now = this.#now().toISOString();
    const cached = await this.#persistence.findRobotsDecision({
      now,
      origin: input.candidateUrl.origin,
      policyVersion: FETCH_ROBOTS_POLICY_VERSION,
      userAgent: FETCH_USER_AGENT,
    });
    if (cached !== null) return cached;
    await this.#persistence.transition(input.fetchRunId, 'ROBOTS_CHECKING', now);
    let robotsUrl = new URL('/robots.txt', input.candidateUrl.origin);
    let redirects = 0;
    while (true) {
      const response = await this.#reserveAndFetch({
        crawlDelayMs: 0,
        deadlineAt: input.deadlineAt,
        dnsSession: input.dnsSession,
        fetchRunId: input.fetchRunId,
        kind: 'ROBOTS',
        profile: input.profile,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        url: robotsUrl,
      });
      if (redirectStatus(response.statusCode)) {
        if (redirects >= 1 || response.location === null) {
          throw new FetchError('FETCH_ROBOTS_UNKNOWN', { sendState: 'ROBOTS_SENT' });
        }
        robotsUrl = new URL(validateRedirectTarget(robotsUrl.href, response.location).canonicalUrl);
        redirects += 1;
        if (input.profile.ratePolicy.minIntervalMs > 0) {
          await this.#delay(input.profile.ratePolicy.minIntervalMs, input.signal);
        }
        continue;
      }
      const checkedAt = this.#now().toISOString();
      const expiresAt = new Date(Date.parse(checkedAt) + 60 * 60 * 1_000).toISOString();
      let decision: RobotsDecisionV1;
      if (response.statusCode === 404 || response.statusCode === 410) {
        decision = createRobotsStatusDecision({
          checkedAt,
          expiresAt,
          origin: input.candidateUrl.origin,
          result: 'ALLOWED',
          userAgent: FETCH_USER_AGENT,
        });
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        decision = createRobotsStatusDecision({
          checkedAt,
          expiresAt,
          origin: input.candidateUrl.origin,
          result: 'DISALLOWED',
          userAgent: FETCH_USER_AGENT,
        });
      } else if (response.statusCode === 200) {
        decision = evaluateRobotsText({
          checkedAt,
          expiresAt,
          origin: input.candidateUrl.origin,
          pathAndQuery: `${input.candidateUrl.pathname}${input.candidateUrl.search}`,
          text: decodeRobotsBody(response),
          userAgent: FETCH_USER_AGENT,
        });
      } else {
        decision = createRobotsStatusDecision({
          checkedAt,
          expiresAt,
          origin: input.candidateUrl.origin,
          result: 'UNKNOWN',
          userAgent: FETCH_USER_AGENT,
        });
      }
      await this.#persistence.saveRobotsDecision(decision);
      return decision;
    }
  }

  async #fetchPage(input: {
    readonly crawlDelayMs: number;
    readonly deadlineAt: number;
    readonly dnsSession: DnsPinningSession;
    readonly fetchRunId: string;
    readonly initialUrl: URL;
    readonly profile: FetchProfileV1;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly finalUrl: URL;
    readonly hops: readonly RedirectHopV1[];
    readonly response: FetchTransportResponseV1;
  }> {
    let current = input.initialUrl;
    const hops: RedirectHopV1[] = [];
    while (true) {
      await this.#persistence.transition(input.fetchRunId, 'FETCHING', this.#now().toISOString());
      const response = await this.#reserveAndFetch({
        crawlDelayMs: input.crawlDelayMs,
        deadlineAt: input.deadlineAt,
        dnsSession: input.dnsSession,
        fetchRunId: input.fetchRunId,
        kind: 'PAGE',
        profile: input.profile,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        url: current,
      });
      if (redirectStatus(response.statusCode)) {
        if (response.location === null) {
          throw new FetchError('FETCH_REDIRECT_INVALID', { sendState: 'PAGE_SENT' });
        }
        if (hops.length >= input.profile.limits.redirectCount) {
          throw new FetchError('FETCH_REDIRECT_LIMIT', { sendState: 'PAGE_SENT' });
        }
        const next = validateRedirectTarget(current.href, response.location);
        const currentValidated = validateFetchUrl(current.href);
        hops.push(
          Object.freeze({
            fromHost: currentValidated.hostname,
            fromUrlHash: currentValidated.urlHash,
            hop: hops.length + 1,
            policyResult: 'FOLLOWED',
            statusCode: response.statusCode,
            toHost: next.hostname,
            toUrlHash: next.urlHash,
          }),
        );
        current = new URL(next.canonicalUrl);
        const policyDelay = Math.max(input.crawlDelayMs, input.profile.ratePolicy.minIntervalMs);
        if (policyDelay > 0) {
          await this.#delay(policyDelay, input.signal);
        }
        continue;
      }
      if (accessControlledStatus(response.statusCode)) {
        throw new FetchError(
          response.statusCode === 429 ? 'FETCH_RATE_LIMITED' : 'FETCH_ACCESS_CONTROLLED',
          {
            retryable: response.statusCode === 429,
            safeDetails:
              response.retryAfterSeconds === null
                ? {}
                : { retryAfterSeconds: response.retryAfterSeconds },
            sendState: 'PAGE_SENT',
          },
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new FetchError('FETCH_FAILED_AFTER_SEND', { sendState: 'PAGE_SENT' });
      }
      return Object.freeze({ finalUrl: current, hops: Object.freeze(hops), response });
    }
  }
}

export interface FetchExecuteJobPayloadV1 {
  readonly contractVersion: typeof CONTROLLED_FETCH_CONTRACT_VERSION;
  readonly jobType: typeof FETCH_JOB_TYPE;
  readonly planHash: string;
  readonly request: FetchRequestV1;
}

export interface FetchExecuteJobResultV1 {
  readonly documentId: string | null;
  readonly externalRequestCount: number;
  readonly fetchRunId: string;
  readonly receivedBytes: number;
  readonly redactionCounts: {
    readonly addresses: number;
    readonly emails: number;
    readonly phones: number;
  };
  readonly redirectCount: number;
  readonly stableError: string | null;
  readonly status: FetchTerminalStatus;
}

export function validateFetchExecuteJobPayloadV1(value: unknown): FetchExecuteJobPayloadV1 {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'contractVersion,jobType,planHash,request'
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  const payload = value as Record<string, unknown>;
  if (
    payload.contractVersion !== CONTROLLED_FETCH_CONTRACT_VERSION ||
    payload.jobType !== FETCH_JOB_TYPE ||
    typeof payload.planHash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(payload.planHash)
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return Object.freeze({
    contractVersion: CONTROLLED_FETCH_CONTRACT_VERSION,
    jobType: FETCH_JOB_TYPE,
    planHash: payload.planHash,
    request: validateFetchRequestV1(payload.request),
  });
}

export function validateFetchExecuteJobResultV1(value: unknown): FetchExecuteJobResultV1 {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'documentId,externalRequestCount,fetchRunId,receivedBytes,redactionCounts,redirectCount,stableError,status'
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  const result = value as Record<string, unknown>;
  const counts = result.redactionCounts;
  if (
    typeof result.fetchRunId !== 'string' ||
    result.fetchRunId.length < 1 ||
    result.fetchRunId.length > 128 ||
    (result.documentId !== null &&
      (typeof result.documentId !== 'string' ||
        result.documentId.length < 1 ||
        result.documentId.length > 128)) ||
    !Number.isSafeInteger(result.externalRequestCount) ||
    Number(result.externalRequestCount) < 0 ||
    Number(result.externalRequestCount) > FETCH_LIMITS.maxExternalRequests ||
    !Number.isSafeInteger(result.receivedBytes) ||
    Number(result.receivedBytes) < 0 ||
    Number(result.receivedBytes) > FETCH_LIMITS.decodedBytes ||
    !Number.isSafeInteger(result.redirectCount) ||
    Number(result.redirectCount) < 0 ||
    Number(result.redirectCount) > FETCH_LIMITS.redirectCount ||
    (result.stableError !== null &&
      (typeof result.stableError !== 'string' ||
        result.stableError.length < 1 ||
        result.stableError.length > FETCH_LIMITS.stableErrorCharacters)) ||
    !FETCH_TERMINAL_STATUSES.includes(result.status as FetchTerminalStatus) ||
    typeof counts !== 'object' ||
    counts === null ||
    Array.isArray(counts) ||
    Object.keys(counts).sort().join(',') !== 'addresses,emails,phones' ||
    !Object.values(counts).every(
      (count) => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 100_000,
    )
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return Object.freeze(value as FetchExecuteJobResultV1);
}

export function fetchSendStateForError(error: FetchError): FetchSendState {
  return error.sendState;
}
