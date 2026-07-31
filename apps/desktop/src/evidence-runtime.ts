import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  BIBLIOGRAPHIC_OBSERVATION_VERSION,
  BIBLIOGRAPHY_NORMALIZATION_VERSION,
  detectScriptHints,
  normalizeBibliographicText,
  type BibliographicObservationV1,
} from '@mystery-operations/catalog';
import {
  ATOMIC_CLAIM_CONTRACT_VERSION,
  SOURCE_PROCESSING_PLAN_VERSION,
  EvidenceConfirmationBroker,
  EvidenceError,
  atomicClaimSemanticFingerprint,
  createEvidenceLocator,
  evidenceSemanticHash,
  sourceProcessingPlanHash,
  textSha256,
  type AtomicClaimV1,
  type FactConflictAction,
  type SourceProcessingPlanV1,
} from '@mystery-operations/evidence';
import {
  SqliteEvidenceRepository,
  SqliteCatalogRepository,
  type EvidenceSummaryViewV1,
  type FactConflictPreviewV1,
  type FactConflictViewV1,
} from '@mystery-operations/db';
import type {
  CancelSourceProcessingInput,
  ConfirmSyntheticResearchIntakeInput,
  ConfirmEvidenceConflictInput,
  ConfirmSourceProcessingInput,
  EvidenceConflictActionPreview,
  GetEvidenceStateInput,
  PreviewSyntheticResearchIntakeInput,
  PreviewEvidenceConflictInput,
  PreviewSourceProcessingInput,
  SourceProcessingPreview,
  SyntheticResearchIntakeDraft,
  SyntheticResearchIntakePreview,
  SyntheticResearchIntakeResult,
} from '@mystery-operations/shared';
import { LocalFileRepository, type ProjectDataRoot } from '@mystery-operations/storage';

interface ProcessingConfirmation {
  readonly executionId: string;
  readonly plan: SourceProcessingPlanV1;
  readonly runId: string;
}

interface SyntheticLocator {
  readonly endCodePoint: number;
  readonly excerpt: string;
  readonly predicate: 'author' | 'canonical_title' | 'publication_date';
  readonly startCodePoint: number;
}

interface SyntheticIntakeConfirmation {
  readonly draft: SyntheticResearchIntakeDraft;
  readonly inputHash: string;
  readonly locators: readonly SyntheticLocator[];
}

const SYNTHETIC_LABELS = Object.freeze([
  'MANUAL_INPUT',
  'SYNTHETIC_ONLY',
  'LOCAL_PERSISTED',
  'MODEL_UNUSED',
] as const);

function containsAsciiControl(value: string, allowed: readonly number[] = []): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint <= 31 || codePoint === 127) && !allowed.includes(codePoint);
  });
}

function boundedText(value: string, maximum: number): string {
  const normalized = value.normalize('NFC').trim();
  if (normalized.length < 1 || normalized.length > maximum || containsAsciiControl(normalized)) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  return normalized;
}

function normalizeSyntheticDraft(
  value: SyntheticResearchIntakeDraft,
): SyntheticResearchIntakeDraft {
  const publicationDate = value.publicationDate.trim();
  const parsedDate = new Date(`${publicationDate}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(publicationDate) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== publicationDate
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  const sourceText = value.sourceText.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  if (
    sourceText.length < 1 ||
    sourceText.length > 2_000 ||
    Buffer.byteLength(sourceText, 'utf8') > 8_192 ||
    containsAsciiControl(sourceText, [9, 10])
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  const draft = Object.freeze({
    authorName: boundedText(value.authorName, 120),
    publicationDate,
    sourceText,
    sourceTitle: boundedText(value.sourceTitle, 200),
    workTitle: boundedText(value.workTitle, 200),
  });
  if (new Set([draft.authorName, draft.publicationDate, draft.workTitle]).size !== 3) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  return draft;
}

function locateSyntheticFacts(draft: SyntheticResearchIntakeDraft): readonly SyntheticLocator[] {
  const facts = [
    ['canonical_title', draft.workTitle],
    ['author', draft.authorName],
    ['publication_date', draft.publicationDate],
  ] as const;
  return Object.freeze(
    facts.map(([predicate, excerpt]) => {
      const codeUnitStart = draft.sourceText.indexOf(excerpt);
      if (codeUnitStart < 0) throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
      const startCodePoint = Array.from(draft.sourceText.slice(0, codeUnitStart)).length;
      return Object.freeze({
        endCodePoint: startCodePoint + Array.from(excerpt).length,
        excerpt,
        predicate,
        startCodePoint,
      });
    }),
  );
}

function syntheticObservation(
  draft: SyntheticResearchIntakeDraft,
  key: string,
  now: string,
): BibliographicObservationV1 {
  const title = normalizeBibliographicText(draft.workTitle);
  const author = normalizeBibliographicText(draft.authorName);
  const originRecordId = `local-slice-${key}`;
  return Object.freeze({
    contractVersion: BIBLIOGRAPHIC_OBSERVATION_VERSION,
    contributorHints: Object.freeze([
      Object.freeze({
        name: Object.freeze({ normalized: author.normalized, raw: author.raw }),
        roles: Object.freeze(['AUTHOR'] as const),
      }),
    ]),
    displayTitle: Object.freeze({ normalized: title.normalized, raw: title.raw }),
    factStatus: 'NOT_A_FACT',
    fieldProvenance: Object.freeze([
      Object.freeze({
        algorithmVersion: BIBLIOGRAPHY_NORMALIZATION_VERSION,
        field: 'displayTitle',
        inputObservationIds: Object.freeze([]),
        originKind: 'SYNTHETIC_FIXTURE',
        originRecordId,
      }),
    ]),
    formatHint: 'LOCAL_SYNTHETIC',
    identifierHints: Object.freeze([
      Object.freeze({
        errorCode: null,
        namespace: 'PLATFORM:LOCAL_SYNTHETIC',
        normalizedValue: key,
        rawValue: key,
        valid: true,
      }),
    ]),
    languageHints: Object.freeze(['zh-CN']),
    normalizationVersion: BIBLIOGRAPHY_NORMALIZATION_VERSION,
    observationId: `local-slice-observation-${key}`,
    observedAt: now,
    organizationHints: Object.freeze([]),
    originKind: 'SYNTHETIC_FIXTURE',
    originRecordId,
    originRevision: 1,
    originalTitleHint: null,
    publicationDateHint: draft.publicationDate,
    publicationYearHint: Number(draft.publicationDate.slice(0, 4)),
    scriptHints: Object.freeze(detectScriptHints(draft.workTitle)),
    seriesHint: null,
    sourceIdentity: Object.freeze({ candidateId: null, clipId: null, documentId: null }),
    strata: Object.freeze(['local-synthetic']),
    truthStatus: 'UNVERIFIED',
    warnings: Object.freeze(['SYNTHETIC_LOCAL_VERTICAL_SLICE', 'MANUAL_INPUT']),
    workTypeHint: 'MYSTERY',
  });
}

function syntheticClaim(input: {
  readonly authorAgentId: string;
  readonly createdAt: string;
  readonly draft: SyntheticResearchIntakeDraft;
  readonly key: string;
  readonly predicate: SyntheticLocator['predicate'];
  readonly sourceId: string;
  readonly workId: string;
}): AtomicClaimV1 {
  const descriptor =
    input.predicate === 'canonical_title'
      ? ({ value: input.draft.workTitle, valueType: 'TEXT' } as const)
      : input.predicate === 'author'
        ? ({
            value: { entityId: input.authorAgentId, entityType: 'AGENT' },
            valueType: 'ENTITY_REF',
          } as const)
        : ({
            value: { precision: 'DAY', value: input.draft.publicationDate },
            valueType: 'DATE_WITH_PRECISION',
          } as const);
  const base = {
    claimId: `local-slice-claim-${input.predicate}-${input.key}`,
    claimant: Object.freeze({ sourceId: input.sourceId, sourceRevision: 1 }),
    contractVersion: ATOMIC_CLAIM_CONTRACT_VERSION,
    createdAt: input.createdAt,
    keyFact: true,
    predicate: input.predicate,
    predicateVersion: 1,
    provenance: Object.freeze({ kind: 'MANUAL' as const, runId: null }),
    revision: 1,
    scope: Object.freeze({
      format: null,
      language: null,
      territory: null,
      validFrom: null,
      validTo: null,
    }),
    status: 'ACTIVE' as const,
    subject: Object.freeze({ id: input.workId, type: 'WORK' as const }),
    value: descriptor.value,
    valueType: descriptor.valueType,
  };
  return Object.freeze({
    ...base,
    semanticFingerprint: atomicClaimSemanticFingerprint(base),
  });
}

export class DesktopEvidenceRuntime {
  readonly #catalog: SqliteCatalogRepository;
  readonly #clock: () => Date;
  readonly #conflicts = new EvidenceConfirmationBroker<FactConflictPreviewV1>();
  readonly #files: LocalFileRepository;
  readonly #processing = new EvidenceConfirmationBroker<ProcessingConfirmation>();
  readonly #repository: SqliteEvidenceRepository;
  readonly #synthetic = new EvidenceConfirmationBroker<SyntheticIntakeConfirmation>();

  public constructor(
    database: DatabaseSync,
    root: ProjectDataRoot,
    clock: () => Date = () => new Date(),
  ) {
    this.#catalog = new SqliteCatalogRepository(database);
    this.#clock = clock;
    this.#files = new LocalFileRepository(root);
    this.#repository = new SqliteEvidenceRepository(database);
  }

  public getState(input: GetEvidenceStateInput): EvidenceSummaryViewV1 {
    return this.#repository.getSummary(input.limit, input.offset);
  }

  public previewConflict(
    input: PreviewEvidenceConflictInput,
    senderId: number,
    windowId: number,
  ): EvidenceConflictActionPreview {
    const preview = this.#repository.previewConflictAction(
      input.conflictId,
      input.action as FactConflictAction,
      input.acceptedClaimId,
    );
    const issued = this.#conflicts.issue(preview, senderId, windowId);
    return Object.freeze({
      acceptedClaimId: preview.acceptedClaimId,
      action: preview.action,
      affected: preview.affected,
      afterEvaluations: preview.afterEvaluations,
      beforeEvaluations: preview.beforeEvaluations,
      claimLeftId: preview.claimLeftId,
      claimRightId: preview.claimRightId,
      conflictId: preview.conflictId,
      expiresAt: issued.expiresAt,
      previewHash: issued.previewHash,
      revision: preview.revision,
      state: preview.state,
      token: issued.token,
    });
  }

  public confirmConflict(
    input: ConfirmEvidenceConflictInput,
    senderId: number,
    windowId: number,
  ): FactConflictViewV1 {
    if (input.confirmation !== 'APPLY_FACT_CONFLICT_DECISION') {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const preview = this.#conflicts.consume(input.token, input.previewHash, senderId, windowId);
    return this.#repository.applyConflictAction(
      preview,
      input.reason,
      `fact-decision-${randomUUID()}`,
      new Date().toISOString(),
    );
  }

  public previewProcessing(
    input: PreviewSourceProcessingInput,
    senderId: number,
    windowId: number,
  ): SourceProcessingPreview {
    this.#repository.assertSourceRevisionIds(input.sourceRevisionIds);
    const now = new Date();
    const modelSteps = input.includeModelSteps
      ? (['EXTRACT_CLAIMS', 'SUMMARIZE'] as const)
      : ([] as const);
    const steps = Object.freeze(['CLASSIFY', ...modelSteps, 'RECONCILE'] as const);
    const withoutHash = {
      contractVersion: SOURCE_PROCESSING_PLAN_VERSION,
      createdAt: now.toISOString(),
      estimatedExternalRequests: modelSteps.length * input.sourceRevisionIds.length,
      estimatedFee: 'UNKNOWN' as const,
      estimatedLocalWrites: input.sourceRevisionIds.length * 4,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      limits: Object.freeze({
        maxClaims: 256,
        maxConcurrency: 1,
        maxEvidencePerClaim: 64,
        maxFragmentBytes: 256 * 1024,
        maxRuntimeMs: 60 * 60_000,
      }),
      planId: `evidence-plan-${randomUUID()}`,
      sourceRevisionIds: Object.freeze([...input.sourceRevisionIds]),
      steps,
    };
    const plan: SourceProcessingPlanV1 = Object.freeze({
      ...withoutHash,
      planHash: sourceProcessingPlanHash(withoutHash),
    });
    const runId = `evidence-run-${randomUUID()}`;
    const issued = this.#processing.issue(
      { executionId: `evidence-execution-${randomUUID()}`, plan, runId },
      senderId,
      windowId,
    );
    return Object.freeze({
      estimatedExternalRequests: plan.estimatedExternalRequests,
      estimatedFee: 'UNKNOWN',
      estimatedLocalWrites: plan.estimatedLocalWrites,
      expiresAt: issued.expiresAt,
      planHash: plan.planHash,
      previewHash: issued.previewHash,
      readiness: input.includeModelSteps ? 'MODEL_UNCONFIGURED' : 'LOCAL_READY',
      runId,
      sourceRevisionIds: plan.sourceRevisionIds,
      steps: plan.steps,
      token: issued.token,
    });
  }

  public confirmProcessing(
    input: ConfirmSourceProcessingInput,
    senderId: number,
    windowId: number,
  ): EvidenceSummaryViewV1 {
    if (input.confirmation !== 'START_SOURCE_PROCESSING') {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const confirmation = this.#processing.consume(
      input.token,
      input.previewHash,
      senderId,
      windowId,
    );
    if (confirmation.plan.planHash !== input.planHash) {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    if (
      confirmation.plan.steps.includes('EXTRACT_CLAIMS') ||
      confirmation.plan.steps.includes('SUMMARIZE')
    ) {
      throw new EvidenceError('EVIDENCE_POLICY_BLOCKED');
    }
    this.#repository.saveProcessingPlan(
      confirmation.plan,
      confirmation.runId,
      confirmation.executionId,
    );
    const now = new Date().toISOString();
    this.#repository.confirmProcessingRun(confirmation.runId, 1, now);
    const claimIds = this.#repository.listClaimIdsForSourceRevisions(
      confirmation.plan.sourceRevisionIds,
    );
    for (const claimId of claimIds) {
      this.#repository.reconcileClaim(claimId, now);
    }
    this.#repository.finishProcessingRun(
      confirmation.runId,
      2,
      'SUCCEEDED',
      ['CLASSIFY', 'RECONCILE'],
      0,
      'NOT_INCURRED',
      null,
      now,
    );
    return this.#repository.getSummary();
  }

  public cancelProcessing(input: CancelSourceProcessingInput): EvidenceSummaryViewV1 {
    if (input.confirmation !== 'CANCEL_SOURCE_PROCESSING') {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    this.#repository.requestProcessingCancel(
      input.runId,
      input.expectedRevision,
      new Date().toISOString(),
    );
    return this.#repository.getSummary();
  }

  public previewSyntheticIntake(
    input: PreviewSyntheticResearchIntakeInput,
    senderId: number,
    windowId: number,
  ): SyntheticResearchIntakePreview {
    const draft = normalizeSyntheticDraft(input.draft);
    const locators = locateSyntheticFacts(draft);
    const inputHash = evidenceSemanticHash({
      contractVersion: 'synthetic-research-intake-v1',
      draft,
    });
    const issued = this.#synthetic.issue({ draft, inputHash, locators }, senderId, windowId);
    return Object.freeze({
      claimLocators: locators,
      estimatedExternalRequests: 0,
      estimatedLocalWrites: 24,
      estimatedModelRequests: 0,
      expiresAt: issued.expiresAt,
      feeState: 'NOT_INCURRED',
      inputHash,
      labels: SYNTHETIC_LABELS,
      previewHash: issued.previewHash,
      token: issued.token,
    });
  }

  public async confirmSyntheticIntake(
    input: ConfirmSyntheticResearchIntakeInput,
    senderId: number,
    windowId: number,
  ): Promise<SyntheticResearchIntakeResult> {
    if (input.confirmation !== 'CREATE_SYNTHETIC_LOCAL_RESEARCH') {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const confirmation = this.#synthetic.consume(
      input.token,
      input.previewHash,
      senderId,
      windowId,
    );
    if (confirmation.inputHash !== input.inputHash) {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const now = this.#clock().toISOString();
    const key = confirmation.inputHash.slice(0, 32);
    const sourceId = `local-slice-source-${key}`;
    const textHash = textSha256(confirmation.draft.sourceText);
    const file = await this.#files.putBuffer(Buffer.from(confirmation.draft.sourceText, 'utf8'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'synthetic-local-research.txt',
      maxBytes: 8_192,
    });
    this.#catalog.insertSyntheticObservation(
      syntheticObservation(confirmation.draft, key, now),
      null,
      now,
    );
    const resolution = this.#catalog.getSyntheticObservationResolution(
      `local-slice-observation-${key}`,
    );
    if (resolution === null) throw new EvidenceError('EVIDENCE_NOT_FOUND');
    this.#repository.registerSource({
      classification: Object.freeze({
        authorityTier: 'OFFICIAL_PRIMARY',
        classifiedBy: 'SYNTHETIC_FIXTURE',
        independenceState: 'CONFIRMED_INDEPENDENT',
        lineageGroup: sourceId,
        reasonCode: 'SYNTHETIC_USER_CONFIRMED_PRIMARY',
        useClass: 'KEY_FACT_ELIGIBLE',
      }),
      contentHash: textHash,
      extractedTextHash: textHash,
      extractedTextPath: file.managedPath,
      language: 'zh-CN',
      originKind: 'SYNTHETIC_FIXTURE',
      originRecordId: `local-slice-${key}`,
      originRevision: 1,
      publisherOrSite: '本地合成材料',
      publishedAt: null,
      publishedAtPrecision: 'UNKNOWN',
      retrievedAt: now,
      sourceId,
      title: confirmation.draft.sourceTitle,
      url: `https://local-synthetic.invalid/${key}`,
      warnings: Object.freeze(['SYNTHETIC_LOCAL_VERTICAL_SLICE', 'MANUAL_INPUT']),
    });
    this.#repository.registerSubject('WORK', resolution.workId);
    const results = confirmation.locators.map((located) => {
      const claim = syntheticClaim({
        authorAgentId: resolution.authorAgentId,
        createdAt: now,
        draft: confirmation.draft,
        key,
        predicate: located.predicate,
        sourceId,
        workId: resolution.workId,
      });
      this.#repository.createClaim(claim);
      this.#repository.addEvidence(
        {
          claimId: claim.claimId,
          evidenceId: `local-slice-evidence-${located.predicate}-${key}`,
          extractedText: confirmation.draft.sourceText,
          language: 'zh-CN',
          locator: createEvidenceLocator(
            sourceId,
            1,
            confirmation.draft.sourceText,
            located.startCodePoint,
            located.endCodePoint,
          ),
          relation: 'SUPPORTS',
          summary: null,
        },
        now,
      );
      const evaluation = this.#repository.reconcileClaim(claim.claimId, now);
      return Object.freeze({
        claimId: claim.claimId,
        evaluationId: evaluation.evaluationId,
        predicate: located.predicate,
        status: evaluation.status,
      });
    });
    return Object.freeze({
      claims: Object.freeze(results),
      externalRequestCount: 0,
      feeState: 'NOT_INCURRED',
      labels: SYNTHETIC_LABELS,
      modelRequestCount: 0,
      sourceRevisionId: `${sourceId}:1`,
      workId: resolution.workId,
    });
  }

  public clearWindow(windowId: number): void {
    this.#conflicts.clearWindow(windowId);
    this.#processing.clearWindow(windowId);
    this.#synthetic.clearWindow(windowId);
  }
}
