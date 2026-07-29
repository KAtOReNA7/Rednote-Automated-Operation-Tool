import { describe, expect, it } from 'vitest';

import {
  DOSSIER_BUILD_PLAN_VERSION,
  DOSSIER_COVERAGE_POLICY_VERSION,
  DOSSIER_GAP_REASON_CODES,
  DOSSIER_READINESS_STATES,
  DOSSIER_SECTIONS,
  DossierConfirmationBroker,
  dossierBuildPlanHash,
  validateDossierBuildJobPayload,
  validateDossierBuildPlan,
  validateResearchDossier,
} from '../packages/dossier/src/index.js';

const now = '2026-07-29T04:00:00.000Z';

describe('Research Dossier V1 contracts', () => {
  it('accepts only exact Work, Expression, or Edition aggregate roots', () => {
    const root = {
      contractVersion: 'research-dossier-v1',
      createdAt: now,
      currentVersionId: null,
      currentVersionNumber: null,
      dossierId: 'dossier-contract',
      invalidationReasons: [],
      readiness: 'NOT_BUILT',
      revision: 1,
      state: 'NOT_BUILT',
      subject: { id: 'work-contract', type: 'WORK' },
      updatedAt: now,
    };
    expect(validateResearchDossier(root)).toEqual(root);
    expect(() => validateResearchDossier({ ...root, hidden: true })).toThrow(
      /DOSSIER_INVALID_CONTRACT/u,
    );
    expect(() =>
      validateResearchDossier({ ...root, subject: { id: 'agent', type: 'AGENT' } }),
    ).toThrow(/DOSSIER_INVALID_CONTRACT/u);
    expect(() =>
      validateResearchDossier({
        ...root,
        currentVersionId: 'version-only',
        currentVersionNumber: null,
      }),
    ).toThrow(/DOSSIER_INVALID_CONTRACT/u);
  });

  it('freezes ten section semantics and an ID-only build payload', () => {
    expect(DOSSIER_SECTIONS).toEqual([
      'IDENTITY',
      'BIBLIOGRAPHY',
      'CREATORS',
      'PUBLICATION_HISTORY',
      'AWARDS',
      'SERIES_AND_RELATIONSHIPS',
      'SYNOPSIS_AND_THEMES',
      'RECEPTION_AND_DISCUSSION',
      'OPEN_CONFLICTS',
      'RESEARCH_GAPS',
    ]);
    expect(DOSSIER_GAP_REASON_CODES).toEqual([
      'NO_CLAIM',
      'INSUFFICIENT_EVIDENCE',
      'SOURCE_INDEPENDENCE_UNKNOWN',
      'FACT_CONFLICTED',
      'EVIDENCE_STALE',
      'SOURCE_UNAVAILABLE',
      'SECTION_NOT_RESEARCHED',
      'POLICY_VERSION_STALE',
    ]);
    expect(DOSSIER_READINESS_STATES).toEqual([
      'NOT_BUILT',
      'BUILD_REQUIRED',
      'INSUFFICIENT_COVERAGE',
      'FACT_BLOCKED',
      'STALE',
      'READY_FOR_CONTENT_BRIEF',
    ]);
    const payload = {
      dossierId: 'dossier-contract',
      executionId: 'execution-contract',
      expectedDossierRevision: 2,
      inputHash: 'a'.repeat(64),
      planHash: 'b'.repeat(64),
      planId: 'plan-contract',
      subjectId: 'work-contract',
      subjectType: 'WORK',
    };
    expect(validateDossierBuildJobPayload(payload)).toEqual(payload);
    expect(() =>
      validateDossierBuildJobPayload({ ...payload, excerpt: '正文不得进入 payload' }),
    ).toThrow(/DOSSIER_INVALID_REQUEST/u);
  });

  it('binds plan hash, expiry, expected revision, bounded counts, and zero model work', () => {
    const sectionCoverage = DOSSIER_SECTIONS.map((section) => ({
      basisPoints: 0,
      blockedCount: 0,
      gapCount: 0,
      insufficientCount: 0,
      reasonCodes: ['NOT_BUILT'],
      section,
      staleCount: 0,
      verifiedCount: 0,
    }));
    const withoutHash = {
      buildMode: 'INITIAL' as const,
      budgetConclusion: 'NOT_APPLICABLE' as const,
      contractVersion: DOSSIER_BUILD_PLAN_VERSION,
      counts: {
        claimCount: 0,
        conflictCount: 0,
        dependencyCount: 2,
        evidenceCount: 0,
        gapCount: 3,
      },
      createdAt: now,
      diff: {
        addedSemanticKeys: [],
        removedSemanticKeys: [],
        updatedSemanticKeys: [],
      },
      dossierId: 'dossier-contract',
      estimatedLocalWrites: 42,
      estimatedModelRequests: 0 as const,
      expectedCurrentVersionId: null,
      expectedDossierRevision: 1,
      expiresAt: '2026-07-29T04:05:00.000Z',
      inputHash: 'c'.repeat(64),
      noOp: false,
      planId: 'plan-contract',
      readinessAfter: 'INSUFFICIENT_COVERAGE' as const,
      readinessBefore: 'NOT_BUILT' as const,
      sectionCoverageAfter: sectionCoverage,
      sectionCoverageBefore: sectionCoverage,
      subject: { id: 'work-contract', type: 'WORK' as const },
    };
    const plan = {
      ...withoutHash,
      planHash: dossierBuildPlanHash(withoutHash),
    };
    expect(validateDossierBuildPlan(plan)).toEqual(plan);
    expect(plan.contractVersion).toBe(DOSSIER_BUILD_PLAN_VERSION);
    expect(DOSSIER_COVERAGE_POLICY_VERSION).toBe('dossier-coverage-policy-v1');
    expect(() => validateDossierBuildPlan({ ...plan, estimatedModelRequests: 1 })).toThrow(
      /DOSSIER_INVALID_PLAN/u,
    );
  });

  it('uses a short-lived, one-time sender/window-bound confirmation token', () => {
    let time = Date.parse(now);
    const broker = new DossierConfirmationBroker<{ readonly planId: string }>(
      () => new Date(time),
      5 * 60 * 1_000,
    );
    const issued = broker.issue({ planId: 'plan-contract' }, 17, 23);
    expect(() => broker.consume(issued.token, issued.previewHash, 18, 23)).toThrow(
      /DOSSIER_CONFIRMATION_INVALID/u,
    );
    const valid = broker.issue({ planId: 'plan-contract' }, 17, 23);
    expect(broker.consume(valid.token, valid.previewHash, 17, 23)).toEqual({
      planId: 'plan-contract',
    });
    expect(() => broker.consume(valid.token, valid.previewHash, 17, 23)).toThrow(
      /DOSSIER_CONFIRMATION_INVALID/u,
    );
    const expired = broker.issue({ planId: 'plan-expired' }, 17, 23);
    time += 5 * 60 * 1_000 + 1;
    expect(() => broker.consume(expired.token, expired.previewHash, 17, 23)).toThrow(
      /DOSSIER_CONFIRMATION_INVALID/u,
    );
  });
});
