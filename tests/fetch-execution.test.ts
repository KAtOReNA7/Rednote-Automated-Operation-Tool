import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteFetchRepository } from '../packages/db/src/index.js';
import {
  FetchExecutionService,
  ScriptedFetchTransport,
  fetchRequestSemanticHash,
  type FetchTransportResponseV1,
  type FetchTransportV1,
  type FetchError,
} from '../packages/fetch/src/index.js';
import { parseManagedRelativePath } from '../packages/shared/src/storage-contracts.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  FETCH_NOW,
  enabledFetchProfile,
  fetchPlan,
  fetchRequest,
  insertFetchCandidate,
} from './fetch-fixtures.js';

afterEach(cleanTemporaryDatabases);

function response(
  statusCode: number,
  body: string,
  overrides: Partial<FetchTransportResponseV1> = {},
): FetchTransportResponseV1 {
  const bytes = Buffer.from(body, 'utf8');
  return Object.freeze({
    body: bytes,
    contentDisposition: null,
    contentType: 'text/html; charset=utf-8',
    decodedBytes: bytes.byteLength,
    location: null,
    rawBytes: bytes.byteLength,
    remoteAddress: '127.0.0.1',
    retryAfterSeconds: null,
    statusCode,
    ...overrides,
  });
}

function successfulResponses(): readonly FetchTransportResponseV1[] {
  return [
    response(404, '', { contentType: null }),
    response(
      200,
      `<main><h1>公开页面研究记录</h1><p>
      这是完全离线的受控 fixture 正文，用于验证抓取、净化、确定性抽取、内容寻址存储和数据库关联。
      它不会访问真实站点，也不会调用模型、搜索服务或任何平台接口。
      </p></main>`,
    ),
  ];
}

async function setup(transport: FetchTransportV1, controller?: AbortController) {
  const { database } = await createInitializedDatabase();
  const candidate = insertFetchCandidate(database);
  const profile = enabledFetchProfile({
    ratePolicy: {
      ...enabledFetchProfile().ratePolicy,
      minIntervalMs: 0,
    },
  });
  const repository = new SqliteFetchRepository(database, {
    idFactory: () => 'rate-reservation',
  });
  repository.upsertProfile(profile);
  const request = fetchRequest(candidate, profile);
  const plan = fetchPlan(candidate, profile, request);
  let id = 0;
  const writes: string[] = [];
  const service = new FetchExecutionService({
    allowNonPublicForTests: true,
    candidateReader: repository,
    delay: async () => undefined,
    dnsResolver: {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    },
    idFactory: () => `fetch-id-${++id}`,
    now: () => new Date(FETCH_NOW),
    persistence: repository,
    profileReader: repository,
    snapshotStore: {
      put: async (content, input) => {
        const hash = createHash('sha256').update(content).digest('hex');
        writes.push(hash);
        return {
          managedPath: parseManagedRelativePath(
            `sources/snapshots/${hash.slice(0, 2)}/${hash}-${input.displayName.endsWith('.html') ? 'page.html' : 'page.txt'}`,
            'SOURCE_SNAPSHOT',
          ),
          sha256: hash,
          sizeBytes: content.byteLength,
        };
      },
    },
    transport,
  });
  return { candidate, controller, database, plan, profile, repository, request, service, writes };
}

describe('FetchExecutionService', () => {
  it('runs robots then one page, saves only sanitized artifacts and replays idempotently', async () => {
    const transport = new ScriptedFetchTransport(successfulResponses());
    const context = await setup(transport);
    const outcome = await context.service.execute(context.request, context.plan);
    expect(outcome).toMatchObject({
      externalRequestCount: 2,
      redirectCount: 0,
      status: 'SUCCEEDED',
    });
    expect(outcome.document).toMatchObject({
      evidenceEligibility: 'FETCHED_NOT_EVIDENCE',
      factStatus: 'NOT_A_FACT',
      truthStatus: 'UNVERIFIED',
    });
    expect(context.writes).toHaveLength(2);
    expect(transport.calls.map(({ kind }) => kind)).toEqual(['ROBOTS', 'PAGE']);
    const replay = await context.service.execute(context.request, context.plan);
    expect(replay).toEqual(outcome);
    expect(transport.calls).toHaveLength(2);
    expect(context.writes).toHaveLength(2);
    const frozenCandidate = context.database
      .prepare(
        `SELECT evidence_eligibility, fetch_state, truth_status, fact_status
         FROM search_result_candidates WHERE id = ?`,
      )
      .get(context.candidate.candidateId);
    expect(frozenCandidate).toEqual({
      evidence_eligibility: 'LEAD_ONLY',
      fact_status: 'NOT_A_FACT',
      fetch_state: 'NOT_FETCHED',
      truth_status: 'UNVERIFIED',
    });
    context.database.close();
  });

  it('deduplicates a document while retaining two independent FetchRun rows', async () => {
    const secondPage = successfulResponses()[1];
    if (secondPage === undefined) throw new Error('Page fixture is missing.');
    const transport = new ScriptedFetchTransport([...successfulResponses(), secondPage]);
    const context = await setup(transport);
    await context.service.execute(context.request, context.plan);
    const secondRequest = fetchRequest(context.candidate, context.profile, {
      executionId: 'fetch-execution-002',
      jobId: 'fetch-job-002',
    });
    const secondPlan = fetchPlan(context.candidate, context.profile, secondRequest);
    await context.service.execute(secondRequest, secondPlan);
    expect(
      context.database.prepare('SELECT COUNT(*) AS count FROM fetched_documents').get(),
    ).toEqual({ count: 1 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM fetch_runs').get()).toEqual({
      count: 2,
    });
    expect(transport.calls).toHaveLength(3);
    context.database.close();
  });

  it('rejects cross-host redirects and never follows or retries them', async () => {
    const transport = new ScriptedFetchTransport([
      response(404, '', { contentType: null }),
      response(302, '', { location: 'https://other.example.test/article' }),
    ]);
    const context = await setup(transport);
    await expect(context.service.execute(context.request, context.plan)).rejects.toMatchObject({
      code: 'FETCH_REDIRECT_CROSS_HOST',
      outcome: { status: 'REJECTED' },
    });
    expect(transport.calls).toHaveLength(2);
    expect(context.writes).toHaveLength(0);
    context.database.close();
  });

  it('distinguishes before-send cancellation and after-send ambiguity/cancellation', async () => {
    const beforeController = new AbortController();
    beforeController.abort();
    const before = await setup(new ScriptedFetchTransport(successfulResponses()));
    await expect(
      before.service.execute(before.request, before.plan, beforeController.signal),
    ).rejects.toMatchObject({ code: 'FETCH_CANCELLED_BEFORE_SEND' });
    expect(before.database.prepare('SELECT COUNT(*) AS count FROM fetch_runs').get()).toEqual({
      count: 0,
    });
    before.database.close();

    const afterController = new AbortController();
    let call = 0;
    const afterTransport: FetchTransportV1 = {
      fetch: async () => {
        const item = successfulResponses()[call++];
        if (item === undefined) throw new Error('Scripted response is missing.');
        if (call === 2) afterController.abort();
        return item;
      },
    };
    const after = await setup(afterTransport, afterController);
    await expect(
      after.service.execute(after.request, after.plan, afterController.signal),
    ).rejects.toMatchObject({
      code: 'FETCH_CANCELLED_AFTER_SEND',
      outcome: { status: 'CANCELLED_AFTER_SEND' },
    });
    after.database.close();
  });

  it('rejects execution identity conflicts and recovers only proven pre-send runs', async () => {
    const context = await setup(new ScriptedFetchTransport(successfulResponses()));
    await context.repository.beginRun({
      fetchRunId: 'manual-pre-send',
      plan: context.plan,
      request: context.request,
      requestSemanticHash: fetchRequestSemanticHash(context.request),
      startedAt: FETCH_NOW,
    });
    expect(context.repository.recoverInterrupted(FETCH_NOW)).toEqual({
      ambiguous: 0,
      recoverablePreSend: 1,
    });
    context.database
      .prepare(
        `UPDATE fetch_runs SET status = 'FETCHING', external_request_count = 1,
         page_dispatch_count = 1,
         send_state = 'PAGE_SENT' WHERE id = 'manual-pre-send'`,
      )
      .run();
    expect(context.repository.recoverInterrupted(FETCH_NOW)).toEqual({
      ambiguous: 1,
      recoverablePreSend: 0,
    });
    const conflicting = fetchRequest(context.candidate, context.profile, {
      selectionReasonCode: 'DIFFERENT_REASON',
    });
    const conflictingPlan = fetchPlan(context.candidate, context.profile, conflicting);
    await expect(context.service.execute(conflicting, conflictingPlan)).rejects.toEqual(
      expect.objectContaining<Partial<FetchError>>({ code: 'FETCH_EXECUTION_CONFLICT' }),
    );
    context.database.close();
  });
});
