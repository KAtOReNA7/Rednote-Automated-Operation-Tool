import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SqliteBrowserClipRepository,
  SqliteEvidenceRepository,
  SqliteFetchRepository,
  SqliteLocalApiRepository,
  type SourceClassificationInputV1,
} from '../packages/db/src/index.js';
import { evidenceSemanticHash, textSha256 } from '../packages/evidence/src/index.js';
import {
  FetchExecutionService,
  ScriptedFetchTransport,
  type FetchTransportResponseV1,
} from '../packages/fetch/src/index.js';
import { parseManagedRelativePath } from '../packages/shared/src/storage-contracts.js';
import { browserClipFixture } from './clipper-fixtures.js';
import {
  FETCH_NOW,
  enabledFetchProfile,
  fetchPlan,
  fetchRequest,
  insertFetchCandidate,
} from './fetch-fixtures.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  EVIDENCE_NOW,
  dateClaim,
  fullTextEvidence,
  officialClassification,
  processingPlan,
  secondaryClassification,
  syntheticSource,
} from './support/evidence-fixtures.js';

afterEach(cleanTemporaryDatabases);

function fetchResponse(
  statusCode: number,
  body: string,
  contentType: string | null,
): FetchTransportResponseV1 {
  const bytes = Buffer.from(body, 'utf8');
  return Object.freeze({
    body: bytes,
    contentDisposition: null,
    contentType,
    decodedBytes: bytes.byteLength,
    location: null,
    rawBytes: bytes.byteLength,
    remoteAddress: '127.0.0.1',
    retryAfterSeconds: null,
    statusCode,
  });
}

const userUnclassifiedSource: SourceClassificationInputV1 = Object.freeze({
  authorityTier: 'UNKNOWN',
  classifiedBy: 'USER',
  independenceState: 'UNKNOWN',
  lineageGroup: null,
  reasonCode: 'USER_LEFT_UNCLASSIFIED',
  useClass: 'NOT_CLASSIFIED',
});

const browserContextSource: SourceClassificationInputV1 = Object.freeze({
  authorityTier: 'DISCUSSION_CONTEXT',
  classifiedBy: 'USER',
  independenceState: 'UNKNOWN',
  lineageGroup: null,
  reasonCode: 'BROWSER_CLIP_CONTEXT_ONLY',
  useClass: 'CONTEXT_ONLY',
});

function insertWork(database: DatabaseSync, workId = 'work-evidence'): void {
  database
    .prepare(
      `INSERT INTO books(
         id, canonical_title, work_type, discovery_status
       ) VALUES (?, '证据测试作品', 'MYSTERY', 'DISCOVERED')`,
    )
    .run(workId);
}

function attachFullEvidence(
  repository: SqliteEvidenceRepository,
  claimId: string,
  evidenceId: string,
  sourceId: string,
  text: string,
  language = 'zh-CN',
): void {
  const located = fullTextEvidence(sourceId, 1, text);
  repository.addEvidence(
    {
      claimId,
      evidenceId,
      extractedText: text,
      language,
      locator: located.locator,
      relation: 'SUPPORTS',
      summary: {
        excerptHash: located.excerptHash,
        locatorHash: evidenceSemanticHash(located.locator),
        method: 'MANUAL',
        modelExecutionId: null,
        textZh: `中文摘要：${text}`,
      },
    },
    EVIDENCE_NOW,
  );
}

describe('Issue 019 SQLite evidence repository', () => {
  it('verifies an atomic claim from one official immutable source revision', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertWork(database);
      const repository = new SqliteEvidenceRepository(database);
      repository.registerSubject('WORK', 'work-evidence');
      const text = '公式資料：本作は2026年7月29日に刊行された。';
      const official = syntheticSource('source-official', text, officialClassification(), 'ja-JP');
      repository.registerSource(official);
      expect(repository.registerSource(official)).toMatchObject({
        revision: 1,
        sourceId: 'source-official',
      });
      repository.createClaim(dateClaim('claim-official', 'work-evidence', '2026-07-29'));
      attachFullEvidence(
        repository,
        'claim-official',
        'evidence-official',
        'source-official',
        text,
        'ja-JP',
      );

      const firstEvaluation = repository.reconcileClaim('claim-official', EVIDENCE_NOW);
      expect(firstEvaluation).toMatchObject({
        qualifyingSourceIds: ['source-official'],
        reasonCode: 'OFFICIAL_PRIMARY',
        status: 'VERIFIED',
      });
      expect(repository.reconcileClaim('claim-official', EVIDENCE_NOW)).toEqual(firstEvaluation);
      expect(database.prepare('SELECT count(*) AS count FROM fact_evaluations').get()).toEqual({
        count: 1,
      });
      const summary = repository.getSummary();
      expect(summary.counts).toMatchObject({
        claims: 1,
        conflicts: 0,
        evaluations: 1,
        evidence: 1,
        sources: 1,
      });
      expect(summary.claims[0]?.evidence[0]).toMatchObject({
        excerpt: text,
        language: 'ja-JP',
        summaryZh: `中文摘要：${text}`,
      });
    } finally {
      database.close();
    }
  });

  it('requires two distinct confirmed secondary lineage groups', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertWork(database);
      const repository = new SqliteEvidenceRepository(database);
      repository.registerSubject('WORK', 'work-evidence');
      repository.createClaim(dateClaim('claim-secondary', 'work-evidence', '2026'));
      for (const [sourceId, group] of [
        ['source-secondary-a', 'group-a'],
        ['source-secondary-b', 'group-b'],
      ] as const) {
        const text = `${sourceId} reports publication during 2026.`;
        repository.registerSource(
          syntheticSource(sourceId, text, secondaryClassification(group), 'en-US'),
        );
        attachFullEvidence(
          repository,
          'claim-secondary',
          `evidence-${sourceId}`,
          sourceId,
          text,
          'en-US',
        );
      }
      expect(repository.reconcileClaim('claim-secondary', EVIDENCE_NOW)).toMatchObject({
        qualifyingSourceIds: ['source-secondary-a', 'source-secondary-b'],
        reasonCode: 'TWO_INDEPENDENT_SECONDARY',
        status: 'VERIFIED',
      });
    } finally {
      database.close();
    }
  });

  it('creates FACT_BLOCKED, resolves with reason, rejects stale concurrency, undoes and reopens', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertWork(database);
      let sequence = 0;
      const repository = new SqliteEvidenceRepository(database, () => `id-${++sequence}`);
      repository.registerSubject('WORK', 'work-evidence');
      repository.createClaim(dateClaim('claim-date-a', 'work-evidence', '2026-07-29'));
      repository.createClaim(dateClaim('claim-date-b', 'work-evidence', '2026-08-01'));
      expect(repository.reconcileClaim('claim-date-a', EVIDENCE_NOW).status).toBe('FACT_BLOCKED');
      const conflict = repository.getSummary().conflicts[0];
      expect(conflict).toMatchObject({ state: 'FACT_BLOCKED', revision: 1 });
      if (conflict === undefined) throw new Error('conflict fixture missing');

      const accepted = repository.previewConflictAction(
        conflict.conflictId,
        'ACCEPT_CLAIM',
        'claim-date-a',
      );
      expect(accepted.beforeEvaluations).toEqual([
        { claimId: 'claim-date-a', status: 'FACT_BLOCKED' },
        { claimId: 'claim-date-b', status: 'NOT_EVALUATED' },
      ]);
      expect(accepted.afterEvaluations).toEqual([
        { claimId: 'claim-date-a', status: 'NOT_EVALUATED' },
        { claimId: 'claim-date-b', status: 'REJECTED' },
      ]);
      expect(
        repository.applyConflictAction(
          accepted,
          '官方版本明确采用 7 月 29 日。',
          'decision-accept',
          '2026-07-29T02:01:00.000Z',
        ),
      ).toMatchObject({ revision: 2, state: 'RESOLVED_ACCEPT' });
      expect(
        repository
          .getSummary()
          .claims.map(({ claimId, evaluationStatus }) => ({ claimId, evaluationStatus }))
          .sort((left, right) => left.claimId.localeCompare(right.claimId)),
      ).toEqual([
        { claimId: 'claim-date-a', evaluationStatus: 'NOT_EVALUATED' },
        { claimId: 'claim-date-b', evaluationStatus: 'REJECTED' },
      ]);
      expect(() =>
        repository.applyConflictAction(
          accepted,
          '并发旧预览',
          'decision-stale',
          '2026-07-29T02:02:00.000Z',
        ),
      ).toThrow(/EVIDENCE_STALE_REVISION/u);

      const undo = repository.previewConflictAction(conflict.conflictId, 'UNDO', null);
      expect(
        repository.applyConflictAction(
          undo,
          '撤销后重新核对来源。',
          'decision-undo',
          '2026-07-29T02:03:00.000Z',
        ),
      ).toMatchObject({ revision: 3, state: 'FACT_BLOCKED' });
      expect(
        repository
          .getSummary()
          .claims.every(({ evaluationStatus }) => evaluationStatus === 'FACT_BLOCKED'),
      ).toBe(true);

      const acceptedAgain = repository.previewConflictAction(
        conflict.conflictId,
        'ACCEPT_CLAIM',
        'claim-date-a',
      );
      repository.applyConflictAction(
        acceptedAgain,
        '再次接受后测试 reopen。',
        'decision-accept-again',
        '2026-07-29T02:04:00.000Z',
      );
      const reopen = repository.previewConflictAction(conflict.conflictId, 'REOPEN', null);
      expect(
        repository.applyConflictAction(
          reopen,
          '新证据要求重新打开。',
          'decision-reopen',
          '2026-07-29T02:05:00.000Z',
        ),
      ).toMatchObject({ revision: 5, state: 'REOPENED' });

      const decisions = (
        database.prepare('SELECT count(*) AS count FROM fact_conflict_decisions').get() as {
          readonly count: number;
        }
      ).count;
      expect(decisions).toBe(4);
      expect(() =>
        database.prepare("UPDATE fact_conflict_decisions SET reason = 'tamper'").run(),
      ).toThrow(/append-only/u);
    } finally {
      database.close();
    }
  });

  it('marks old evaluations stale after a new, unavailable, or retracted source revision', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertWork(database);
      const repository = new SqliteEvidenceRepository(database);
      repository.registerSubject('WORK', 'work-evidence');
      const text = 'Official publication date: 2026-07-29.';
      const source = syntheticSource('source-changing', text, officialClassification(), 'en-US');
      repository.registerSource(source);
      repository.createClaim(dateClaim('claim-changing', 'work-evidence', '2026-07-29'));
      attachFullEvidence(
        repository,
        'claim-changing',
        'evidence-changing',
        'source-changing',
        text,
        'en-US',
      );
      expect(repository.reconcileClaim('claim-changing', EVIDENCE_NOW).status).toBe('VERIFIED');
      const replacement = 'The official record is temporarily unavailable.';
      const hash = textSha256(replacement);
      const revision = {
        availability: 'UNAVAILABLE',
        classification: officialClassification(),
        contentHash: hash,
        createdAt: '2026-07-29T03:00:00.000Z',
        extractedTextHash: hash,
        extractedTextPath: `sources/snapshots/${hash.slice(0, 2)}/${hash}.txt`,
        language: 'en-US',
        originKind: 'SYNTHETIC_FIXTURE',
        originRecordId: 'fixture-source-changing-r2',
        originRevision: 2,
        publishedAt: null,
        publishedAtPrecision: 'UNKNOWN',
        revision: 2,
        sourceId: 'source-changing',
        warnings: Object.freeze(['SYNTHETIC_TEST_FIXTURE']),
      } as const;
      repository.addSourceRevision(revision);
      expect(repository.addSourceRevision(revision)).toMatchObject({
        availability: 'UNAVAILABLE',
        revision: 2,
      });
      expect(repository.getSummary().claims[0]?.evaluationStatus).toBe('STALE_REVIEW_REQUIRED');
      expect(repository.reconcileClaim('claim-changing', '2026-07-29T03:01:00.000Z').status).toBe(
        'STALE_REVIEW_REQUIRED',
      );
    } finally {
      database.close();
    }
  });

  it('executes a confirmed local processing plan without model, network, or protected table writes', async () => {
    const { database } = await createInitializedDatabase();
    try {
      insertWork(database);
      const repository = new SqliteEvidenceRepository(database);
      const text = 'Local-only source.';
      repository.registerSource(
        syntheticSource('source-local-plan', text, officialClassification(), 'en-US'),
      );
      const protectedBefore = database
        .prepare(
          `SELECT
             (SELECT count(*) FROM research_dossiers) AS dossiers,
             (SELECT count(*) FROM topics) AS topics,
             (SELECT count(*) FROM drafts) AS drafts,
             (SELECT count(*) FROM approvals) AS approvals,
             (SELECT count(*) FROM post_packages) AS packages`,
        )
        .get();
      const plan = processingPlan('plan-local', ['source-local-plan:1'], ['CLASSIFY', 'RECONCILE']);
      repository.saveProcessingPlan(plan, 'run-local', 'execution-local');
      repository.confirmProcessingRun('run-local', 1, EVIDENCE_NOW);
      repository.finishProcessingRun(
        'run-local',
        2,
        'SUCCEEDED',
        ['CLASSIFY', 'RECONCILE'],
        0,
        'NOT_INCURRED',
        null,
        '2026-07-29T02:01:00.000Z',
      );
      expect(repository.getSummary().processingRuns[0]).toMatchObject({
        costState: 'NOT_INCURRED',
        externalRequestCount: 0,
        status: 'SUCCEEDED',
      });
      expect(
        database
          .prepare(
            `SELECT
               (SELECT count(*) FROM research_dossiers) AS dossiers,
               (SELECT count(*) FROM topics) AS topics,
               (SELECT count(*) FROM drafts) AS drafts,
               (SELECT count(*) FROM approvals) AS approvals,
               (SELECT count(*) FROM post_packages) AS packages`,
          )
          .get(),
      ).toEqual(protectedBefore);
    } finally {
      database.close();
    }
  });

  it('converts only successful FetchDocuments and stored BrowserClips while preserving frozen states', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const candidate = insertFetchCandidate(database);
      const profile = enabledFetchProfile({
        ratePolicy: {
          ...enabledFetchProfile().ratePolicy,
          minIntervalMs: 0,
        },
      });
      const fetchRepository = new SqliteFetchRepository(database, {
        idFactory: () => 'evidence-rate-reservation',
      });
      fetchRepository.upsertProfile(profile);
      const request = fetchRequest(candidate, profile);
      const plan = fetchPlan(candidate, profile, request);
      let fetchId = 0;
      const fetchService = new FetchExecutionService({
        allowNonPublicForTests: true,
        candidateReader: fetchRepository,
        delay: async () => undefined,
        dnsResolver: {
          resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        },
        idFactory: () => `evidence-fetch-${++fetchId}`,
        now: () => new Date(FETCH_NOW),
        persistence: fetchRepository,
        profileReader: fetchRepository,
        snapshotStore: {
          put: async (content, input) => {
            const hash = createHash('sha256').update(content).digest('hex');
            return {
              managedPath: parseManagedRelativePath(
                `sources/snapshots/${hash.slice(0, 2)}/${hash}-${
                  input.displayName.endsWith('.html') ? 'page.html' : 'page.txt'
                }`,
                'SOURCE_SNAPSHOT',
              ),
              sha256: hash,
              sizeBytes: content.byteLength,
            };
          },
        },
        transport: new ScriptedFetchTransport([
          fetchResponse(404, '', null),
          fetchResponse(
            200,
            `<main><h1>离线来源</h1><p>
              这是完全离线的受控合成正文，用来验证成功完成的 FetchDocument 可以在用户分类后
              转换为来源记录。传输由 ScriptedFetchTransport 提供，不访问任何真实站点，也不调用
              模型、搜索服务、图片服务或业务接口。
            </p></main>`,
            'text/html; charset=utf-8',
          ),
        ]),
      });
      const fetchOutcome = await fetchService.execute(request, plan);
      const document = fetchOutcome.document;
      if (document === null) throw new Error('successful fetch fixture must persist a document');

      const clientId = 'evidence-clip-client';
      const extensionOrigin = 'chrome-extension://cccccccccccccccccccccccccccccccc';
      new SqliteLocalApiRepository(database).pairClient({
        clientLabel: 'Issue 019 离线 fixture',
        extensionOrigin,
        id: clientId,
        pairedAt: EVIDENCE_NOW,
        tokenDigest: Buffer.alloc(32, 19),
      });
      const clip = browserClipFixture({
        captureId: '22222222-2222-4222-8222-222222222222',
      });
      const clipRepository = new SqliteBrowserClipRepository(database, () => 'evidence-clip');
      const clipOutcome = await clipRepository.ingest({
        clientId,
        clip,
        extensionOrigin,
        now: EVIDENCE_NOW,
        payloadHash: textSha256(JSON.stringify(clip)),
        screenshot: null,
      });
      if (clipOutcome.clipId === null)
        throw new Error('successful clip fixture must persist a clip');
      const storedClip = clipRepository.getClip(clipOutcome.clipId);
      if (storedClip === null) throw new Error('successful clip fixture must be readable');

      const repository = new SqliteEvidenceRepository(database);
      expect(repository.getSummary().inbox).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            factStatus: 'NOT_A_FACT',
            originKind: 'FETCH_DOCUMENT',
            originRecordId: document.documentId,
            suggestedUse: 'NOT_CLASSIFIED',
            truthStatus: 'UNVERIFIED',
          }),
          expect.objectContaining({
            factStatus: 'NOT_A_FACT',
            originKind: 'BROWSER_CLIP',
            originRecordId: clipOutcome.clipId,
            suggestedUse: 'CONTEXT_ONLY',
            truthStatus: 'UNVERIFIED',
          }),
        ]),
      );

      expect(
        repository.registerSource({
          classification: userUnclassifiedSource,
          contentHash: document.normalizedDocumentContentHash,
          extractedTextHash: document.extractedTextHash,
          extractedTextPath: document.extractedTextPath,
          language: document.languageHint ?? 'zh-CN',
          originKind: 'FETCH_DOCUMENT',
          originRecordId: document.documentId,
          originRevision: 1,
          publisherOrSite: candidate.displayHost,
          publishedAt: null,
          publishedAtPrecision: 'UNKNOWN',
          retrievedAt: EVIDENCE_NOW,
          sourceId: 'source-from-fetch',
          title: candidate.title ?? 'FetchDocument',
          url: document.finalCanonicalUrl,
          warnings: Object.freeze([]),
        }),
      ).toMatchObject({
        originKind: 'FETCH_DOCUMENT',
        useClass: 'NOT_CLASSIFIED',
      });

      const clipHash = textSha256(clip.selectedText ?? '');
      expect(
        repository.registerSource({
          classification: browserContextSource,
          contentHash: clipHash,
          extractedTextHash: null,
          extractedTextPath: null,
          language: 'zh-CN',
          originKind: 'BROWSER_CLIP',
          originRecordId: clipOutcome.clipId,
          originRevision: 1,
          publisherOrSite: clip.platform,
          publishedAt: clip.publishedAt?.slice(0, 10) ?? null,
          publishedAtPrecision: 'DAY',
          retrievedAt: EVIDENCE_NOW,
          sourceId: 'source-from-clip',
          title: storedClip.pageTitle,
          url: storedClip.pageUrl,
          warnings: Object.freeze([]),
        }),
      ).toMatchObject({
        authorityTier: 'DISCUSSION_CONTEXT',
        originKind: 'BROWSER_CLIP',
        useClass: 'CONTEXT_ONLY',
      });

      expect(repository.getSummary().inbox).toHaveLength(0);
      expect(
        database
          .prepare(
            `SELECT evidence_eligibility, truth_status, fact_status
             FROM fetched_documents WHERE id = ?`,
          )
          .get(document.documentId),
      ).toEqual({
        evidence_eligibility: 'FETCHED_NOT_EVIDENCE',
        fact_status: 'NOT_A_FACT',
        truth_status: 'UNVERIFIED',
      });
      expect(
        database
          .prepare(
            `SELECT evidence_eligibility, fetch_state, truth_status, fact_status
             FROM search_result_candidates WHERE id = ?`,
          )
          .get(candidate.candidateId),
      ).toEqual({
        evidence_eligibility: 'LEAD_ONLY',
        fact_status: 'NOT_A_FACT',
        fetch_state: 'NOT_FETCHED',
        truth_status: 'UNVERIFIED',
      });
    } finally {
      database.close();
    }
  });

  it('forces BrowserClip classifications to context-only at the policy boundary', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const repository = new SqliteEvidenceRepository(database);
      const invalid: SourceClassificationInputV1 = {
        authorityTier: 'OFFICIAL_PRIMARY',
        classifiedBy: 'USER',
        independenceState: 'CONFIRMED_INDEPENDENT',
        lineageGroup: 'clip',
        reasonCode: 'INVALID_PROMOTION',
        useClass: 'KEY_FACT_ELIGIBLE',
      };
      const input = syntheticSource('source-clip-policy', 'clip', invalid);
      expect(() =>
        repository.registerSource({
          ...input,
          extractedTextHash: null,
          extractedTextPath: null,
          originKind: 'BROWSER_CLIP',
        }),
      ).toThrow(/EVIDENCE_POLICY_BLOCKED/u);
    } finally {
      database.close();
    }
  });
});
