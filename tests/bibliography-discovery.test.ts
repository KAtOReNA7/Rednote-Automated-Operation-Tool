import { afterEach, describe, expect, it } from 'vitest';

import {
  BIBLIOGRAPHY_JOB_TYPE,
  BIBLIOGRAPHY_NORMALIZATION_VERSION,
  BibliographyDiscoveryService,
  DISCOVERY_PLAN_VERSION,
  DISCOVERY_PROFILE_VERSION,
  ENTITY_RESOLUTION_RULE_VERSION,
  discoveryPlanHash,
  type BibliographyDiscoveryPersistenceV1,
  type DiscoveryPlanV1,
  type DiscoveryProcessCountsV1,
  validateDiscoveryPlanV1,
} from '../packages/catalog/src/index.js';
import { JobQueueRepository, SqliteCatalogRepository } from '../packages/db/src/index.js';
import {
  JobHandlerRegistry,
  JobQueueService,
  JobWorker,
  registerBibliographyDiscoveryJob,
} from '../packages/workflows/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

const ZERO: DiscoveryProcessCountsV1 = {
  editions: 0,
  expressions: 0,
  observations: 0,
  reviewCases: 0,
  works: 0,
};

function plan(id = 'plan-fixture', target = 1): DiscoveryPlanV1 {
  const withoutHash = {
    contractVersion: DISCOVERY_PLAN_VERSION,
    createdAt: '2026-07-29T00:00:00.000Z',
    estimatedExternalRequests: 0 as const,
    estimatedLocalOperations: 0,
    expiresAt: '2026-07-29T00:05:00.000Z',
    inputScope: {
      originKinds: ['SEARCH_CANDIDATE' as const],
      originRecordIds: [],
    },
    limits: {
      batchSize: 2,
      maxCandidateComparisons: 20,
      maxConcurrency: 1,
      maxDatabaseWrites: 100,
      maxObservations: 10,
      maxRuntimeMs: 60_000,
    },
    planId: id,
    profile: {
      contractVersion: DISCOVERY_PROFILE_VERSION,
      normalizationVersion: BIBLIOGRAPHY_NORMALIZATION_VERSION,
      profileId: `profile-${id}`,
      purpose: 'PILOT_CONTENT' as const,
      resolutionRuleVersion: ENTITY_RESOLUTION_RULE_VERSION,
      revision: 1,
      strata: [
        {
          allowedOriginKinds: ['SEARCH_CANDIDATE' as const],
          gapPolicy: 'REQUIRE_PROCESSED' as const,
          label: '时间未知',
          priority: 1,
          required: true,
          stratumId: 'time-unknown',
          targetObservations: target,
        },
      ],
      synthetic: true,
    },
  };
  return {
    ...withoutHash,
    planHash: discoveryPlanHash(withoutHash),
  };
}

describe('Issue 018 discovery plan and queue lifecycle', () => {
  it('validates versioned bounded plans and rejects changed preview hashes', () => {
    const valid = plan();
    expect(validateDiscoveryPlanV1(valid)).toBe(valid);
    expect(() => validateDiscoveryPlanV1({ ...valid, estimatedExternalRequests: 1 })).toThrow();
    expect(() =>
      validateDiscoveryPlanV1({
        ...valid,
        limits: { ...valid.limits, maxObservations: 11 },
      }),
    ).toThrow();
  });

  it('previews, confirms and completes a zero-egress run with explicit gaps', async () => {
    const { database } = await createInitializedDatabase();
    try {
      const catalog = new SqliteCatalogRepository(database);
      const discoveryPlan = plan('plan-queue');
      const preview = catalog.createDiscoveryPreview(discoveryPlan, 'run-queue', []);
      expect(preview).toMatchObject({
        externalRequestCount: 0,
        revision: 1,
        status: 'PREVIEWED',
        synthetic: true,
      });
      catalog.confirmDiscoveryRun('run-queue', preview.revision, '2026-07-29T00:00:01.000Z');

      const registry = new JobHandlerRegistry();
      registerBibliographyDiscoveryJob(registry, new BibliographyDiscoveryService(catalog));
      const queue = new JobQueueService(new JobQueueRepository(database), registry, {
        idFactory: (() => {
          let next = 0;
          return () => `queue-id-${++next}`;
        })(),
      });
      const job = queue.enqueueJob({
        idempotencyKey: 'bibliography:run-queue',
        jobType: BIBLIOGRAPHY_JOB_TYPE,
        maxAttempts: 3,
        payload: {
          executionId: 'execution-queue',
          planHash: discoveryPlan.planHash,
          planId: discoveryPlan.planId,
          runId: 'run-queue',
          versions: {
            normalization: BIBLIOGRAPHY_NORMALIZATION_VERSION,
            resolution: ENTITY_RESOLUTION_RULE_VERSION,
          },
        },
        priority: 0,
      });
      catalog.attachDiscoveryJob('run-queue', job.id, '2026-07-29T00:00:01.000Z');
      const worker = new JobWorker('bibliography-test-worker', queue, registry, {
        heartbeatIntervalMilliseconds: 100,
        leaseDurationMilliseconds: 1_000,
        pollingIntervalMilliseconds: 10,
      });
      expect(await worker.runOnce()).toBe(true);
      expect(queue.getJob(job.id)).toMatchObject({ status: 'SUCCEEDED' });
      expect(catalog.getDiscoveryRun('run-queue')).toMatchObject({
        executionId: 'execution-queue',
        externalRequestCount: 0,
        status: 'COMPLETED_WITH_GAPS',
      });
      expect(catalog.getSummary().coverage).toEqual([
        expect.objectContaining({
          gapReason: 'NO_ELIGIBLE_PERSISTED_INPUT',
          observationCount: 0,
          plannedObservations: 1,
          synthetic: true,
        }),
      ]);
      const replay = queue.enqueueJob({
        idempotencyKey: 'bibliography:run-queue',
        jobType: BIBLIOGRAPHY_JOB_TYPE,
        maxAttempts: 3,
        payload: {
          executionId: 'execution-queue',
          planHash: discoveryPlan.planHash,
          planId: discoveryPlan.planId,
          runId: 'run-queue',
          versions: {
            normalization: BIBLIOGRAPHY_NORMALIZATION_VERSION,
            resolution: ENTITY_RESOLUTION_RULE_VERSION,
          },
        },
        priority: 0,
      });
      expect(replay.id).toBe(job.id);
      expect(
        (
          database
            .prepare('SELECT count(*) AS count FROM discovery_runs WHERE id = ?')
            .get('run-queue') as { readonly count: number }
        ).count,
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it('consumes only a persisted SearchCandidate ID without promoting frozen truth or evidence', async () => {
    const { database } = await createInitializedDatabase();
    try {
      database
        .prepare(
          `INSERT INTO search_provider_configs(
            provider_instance_id, provider_kind, provider_mode, enabled,
            max_results, timeout_ms, settings_revision, created_at, updated_at
          ) VALUES (
            'manual-url-v1', 'MANUAL_URL', 'PASSIVE_LOCAL', 1,
            1, 5000, 1, ?, ?
          )`,
        )
        .run('2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z');
      database
        .prepare(
          `INSERT INTO search_runs(
            id, execution_id, provider_kind, provider_instance_id, provider_mode,
            provider_readiness, request_semantic_hash, plan_hash, query_hash, intent,
            status, certainty, external_request_count, candidate_count,
            started_at, finished_at, created_at, updated_at
          ) VALUES (
            'search-run-catalog', 'search-execution-catalog', 'MANUAL_URL',
            'manual-url-v1', 'PASSIVE_LOCAL', 'READY', ?, ?, ?,
            'USER_PROVIDED_URL', 'SUCCEEDED', 'NOT_SENT', 0, 1, ?, ?, ?, ?
          )`,
        )
        .run(
          'a'.repeat(64),
          'b'.repeat(64),
          'c'.repeat(64),
          '2026-07-29T00:00:00.000Z',
          '2026-07-29T00:00:00.000Z',
          '2026-07-29T00:00:00.000Z',
          '2026-07-29T00:00:00.000Z',
        );
      database
        .prepare(
          `INSERT INTO search_result_candidates(
            id, search_run_id, provider_instance_id, provider_kind, origin_kind,
            canonical_url, url_hash, domain, display_host, title, preview_text,
            preview_kind, upstream_rank, published_at, language_hint, discovered_at,
            user_supplied, source_metadata_kind, citation_state, was_consulted,
            was_cited, provenance_json, warnings_json, created_at
          ) VALUES (
            'candidate-catalog', 'search-run-catalog', 'manual-url-v1',
            'MANUAL_URL', 'MANUAL_URL', 'https://example.invalid/synthetic',
            ?, 'example.invalid', 'example.invalid', '无标识的合成候选',
            NULL, 'NONE', NULL, NULL, NULL, ?, 1, 'MANUAL_URL_INPUT',
            'NOT_APPLICABLE', NULL, NULL, '[]', '[]', ?
          )`,
        )
        .run('d'.repeat(64), '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z');

      const unchangedBefore = database
        .prepare(
          `SELECT
             (SELECT count(*) FROM sources) AS sources,
             (SELECT count(*) FROM claims) AS claims,
             (SELECT count(*) FROM claim_evidence) AS evidence,
             (SELECT count(*) FROM research_dossiers) AS dossiers`,
        )
        .get();
      const catalog = new SqliteCatalogRepository(database);
      const origins = catalog.listAvailableOrigins(
        { originKinds: ['SEARCH_CANDIDATE'], originRecordIds: ['candidate-catalog'] },
        10,
      );
      expect(origins).toEqual([
        {
          originKind: 'SEARCH_CANDIDATE',
          originRecordId: 'candidate-catalog',
          originRevision: 1,
          sequence: 1,
        },
      ]);
      const discoveryPlan = plan('plan-persisted');
      catalog.createDiscoveryPreview(discoveryPlan, 'run-persisted', origins);
      catalog.confirmDiscoveryRun('run-persisted', 1, '2026-07-29T00:00:01.000Z');
      const result = await new BibliographyDiscoveryService(catalog).execute(
        'run-persisted',
        'execution-persisted',
        discoveryPlan.planHash,
        {
          heartbeat: () => Promise.resolve('CONTINUE'),
          now: () => new Date('2026-07-29T00:00:02.000Z'),
          signal: new AbortController().signal,
        },
      );
      expect(result).toMatchObject({
        counts: { observations: 1, reviewCases: 1, works: 0 },
        status: 'AWAITING_REVIEW',
      });
      expect(
        database
          .prepare(
            `SELECT evidence_eligibility, fetch_state, truth_status, fact_status
             FROM search_result_candidates WHERE id = 'candidate-catalog'`,
          )
          .get(),
      ).toEqual({
        evidence_eligibility: 'LEAD_ONLY',
        fact_status: 'NOT_A_FACT',
        fetch_state: 'NOT_FETCHED',
        truth_status: 'UNVERIFIED',
      });
      expect(
        database
          .prepare(
            `SELECT truth_status, fact_status, candidate_id
             FROM bibliographic_observations`,
          )
          .get(),
      ).toEqual({
        candidate_id: 'candidate-catalog',
        fact_status: 'NOT_A_FACT',
        truth_status: 'UNVERIFIED',
      });
      expect(
        database
          .prepare(
            `SELECT
               (SELECT count(*) FROM sources) AS sources,
               (SELECT count(*) FROM claims) AS claims,
               (SELECT count(*) FROM claim_evidence) AS evidence,
               (SELECT count(*) FROM research_dossiers) AS dossiers`,
          )
          .get(),
      ).toEqual(unchangedBefore);
    } finally {
      database.close();
    }
  });

  it('resumes from checkpoint and preserves bounded batch processing', async () => {
    const processed: number[] = [];
    let savedCheckpoint = -1;
    const persistence: BibliographyDiscoveryPersistenceV1 = {
      beginExecution: () => ({
        checkpoint: 2,
        counts: { ...ZERO, observations: 2 },
        plan: plan('plan-resume', 0),
        state: 'RESUMED',
      }),
      finishExecution: (runId, counts) => ({
        counts,
        runId,
        stableError: null,
        status: 'COMPLETED',
      }),
      getOriginBatch: (_runId, afterSequence, limit) => {
        expect(limit).toBe(2);
        return afterSequence < 3
          ? [
              {
                originKind: 'SEARCH_CANDIDATE',
                originRecordId: 'candidate-3',
                originRevision: 1,
                sequence: 3,
              },
            ]
          : [];
      },
      interruptExecution: (runId, state, stableError) => ({
        counts: ZERO,
        runId,
        stableError,
        status: state,
      }),
      processOrigin: (_runId, input) => {
        processed.push(input.sequence);
        return { ...ZERO, observations: 1 };
      },
      saveCheckpoint: (_runId, checkpoint) => {
        savedCheckpoint = checkpoint;
      },
    };
    const service = new BibliographyDiscoveryService(persistence);
    const result = await service.execute('run-resume', 'execution-resume', 'a'.repeat(64), {
      heartbeat: () => Promise.resolve('CONTINUE'),
      now: () => new Date('2026-07-29T00:00:02.000Z'),
      signal: new AbortController().signal,
    });
    expect(processed).toEqual([3]);
    expect(savedCheckpoint).toBe(3);
    expect(result).toMatchObject({ counts: { observations: 3 }, status: 'COMPLETED' });
  });

  it.each([
    ['PAUSE', 'INTERRUPTED'],
    ['CANCEL', 'CANCELLED'],
  ] as const)('honors cooperative %s before consuming another batch', async (control, status) => {
    let batchRead = false;
    const persistence: BibliographyDiscoveryPersistenceV1 = {
      beginExecution: () => ({
        checkpoint: 0,
        counts: ZERO,
        plan: plan(`plan-${control.toLowerCase()}`, 0),
        state: 'CREATED',
      }),
      finishExecution: (runId, counts) => ({
        counts,
        runId,
        stableError: null,
        status: 'COMPLETED',
      }),
      getOriginBatch: () => {
        batchRead = true;
        return [];
      },
      interruptExecution: (runId, state, stableError) => ({
        counts: ZERO,
        runId,
        stableError,
        status: state,
      }),
      processOrigin: () => ZERO,
      saveCheckpoint: () => undefined,
    };
    const result = await new BibliographyDiscoveryService(persistence).execute(
      `run-${control.toLowerCase()}`,
      `execution-${control.toLowerCase()}`,
      'b'.repeat(64),
      {
        heartbeat: () => Promise.resolve(control),
        now: () => new Date('2026-07-29T00:00:02.000Z'),
        signal: new AbortController().signal,
      },
    );
    expect(result.status).toBe(status);
    expect(batchRead).toBe(false);
  });
});
