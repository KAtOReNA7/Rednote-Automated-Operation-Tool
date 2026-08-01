import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  BIBLIOGRAPHIC_OBSERVATION_VERSION,
  BIBLIOGRAPHY_NORMALIZATION_VERSION,
  CatalogError,
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
import { AuthenticityError } from '@mystery-operations/authenticity';
import { classifyStatement, type StatementKind } from '@mystery-operations/quality';
import {
  runInCoordinatedTransaction,
  SqliteAuthenticityRepository,
  SqliteEvidenceRepository,
  SqliteCatalogRepository,
  type EvidenceSummaryViewV1,
  type FactConflictPreviewV1,
  type FactConflictViewV1,
} from '@mystery-operations/db';
import { normalizeRealResearchIntakeDraft } from '@mystery-operations/shared';
import type {
  CancelSourceProcessingInput,
  ConfirmSyntheticResearchIntakeInput,
  ConfirmRealResearchIntakeInput,
  ConfirmEvidenceConflictInput,
  ConfirmSourceProcessingInput,
  EvidenceConflictActionPreview,
  GetEvidenceStateInput,
  PreviewSyntheticResearchIntakeInput,
  PreviewRealResearchIntakeInput,
  PreviewEvidenceConflictInput,
  PreviewSourceProcessingInput,
  SourceProcessingPreview,
  SyntheticResearchIntakeDraft,
  SyntheticResearchIntakePreview,
  SyntheticResearchIntakeResult,
  RealResearchClaimTarget,
  RealResearchIntakeDraft,
  RealResearchIntakePreview,
  RealResearchIntakeResult,
  RealResearchStatementDraft,
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

// prettier-ignore
type RealPreparedStatement = Readonly<{ claimTarget: RealResearchClaimTarget; classification: StatementKind; disposition: RealResearchIntakePreview['statements'][number]['disposition']; evidenceEndCodePoint: number | null; evidenceStartCodePoint: number | null; input: RealResearchStatementDraft }>;
// prettier-ignore
type RealIntakeConfirmation = Readonly<{ draft: RealResearchIntakeDraft; entityResolution: RealResearchIntakePreview['entityResolution']; inputHash: string; preparedStatements: readonly RealPreparedStatement[]; profileId: string; sourceText: string }>;
// prettier-ignore
type RealIntakeReplay = Readonly<{ inputHash: string; previewHash: string; result: RealResearchIntakeResult; senderId: number; windowId: number }>;

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

function prepareRealStatements(draft: RealResearchIntakeDraft): {
  readonly sourceText: string;
  readonly statements: readonly RealPreparedStatement[];
} {
  let sourceText = [
    `资料名称：${draft.sourceTitle}`,
    `来源类型：${draft.sourceType}`,
    `作品：${draft.workTitle}`,
    `作者：${draft.authorName}`,
    draft.sourceLocator.length === 0 ? null : `资料定位：${draft.sourceLocator}`,
  ]
    .filter((item): item is string => item !== null)
    .join('\n');
  const prepared = draft.statements.map((input, index) => {
    const classification = classifyStatement(input.statement).kind;
    sourceText += `\n\n陈述 ${index + 1}：${input.statement}`;
    let evidenceStartCodePoint: number | null = null;
    let evidenceEndCodePoint: number | null = null;
    if (input.evidenceExcerpt.length > 0) {
      const prefix = `\n本地证据 ${index + 1}：`;
      sourceText += prefix;
      evidenceStartCodePoint = Array.from(sourceText).length;
      sourceText += input.evidenceExcerpt;
      evidenceEndCodePoint = Array.from(sourceText).length;
    }
    if (input.evidenceLocator.length > 0) {
      sourceText += `\n定位说明 ${index + 1}：${input.evidenceLocator}`;
    }
    const claimEligible = classification === 'FACT' && input.claimTarget !== 'NONE';
    return Object.freeze({
      claimTarget: input.claimTarget,
      classification,
      disposition: claimEligible
        ? input.evidenceExcerpt.length > 0
          ? ('CLAIM_WITH_EVIDENCE' as const)
          : ('CLAIM_WITHOUT_EVIDENCE' as const)
        : ('SOURCE_ONLY_NON_FACT' as const),
      evidenceEndCodePoint,
      evidenceStartCodePoint,
      input,
    });
  });
  if (Buffer.byteLength(sourceText, 'utf8') > 32_768) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  return Object.freeze({ sourceText, statements: Object.freeze(prepared) });
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

function workClaim(input: {
  readonly claimId: string;
  readonly createdAt: string;
  readonly descriptor: Pick<AtomicClaimV1, 'predicate' | 'value' | 'valueType'>;
  readonly sourceId: string;
  readonly workId: string;
}): AtomicClaimV1 {
  const base = {
    claimId: input.claimId,
    claimant: Object.freeze({ sourceId: input.sourceId, sourceRevision: 1 }),
    contractVersion: ATOMIC_CLAIM_CONTRACT_VERSION,
    createdAt: input.createdAt,
    keyFact: true,
    predicate: input.descriptor.predicate,
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
    value: input.descriptor.value,
    valueType: input.descriptor.valueType,
  };
  return Object.freeze({
    ...base,
    semanticFingerprint: atomicClaimSemanticFingerprint(base),
  });
}

function realClaimDescriptor(input: {
  readonly authorAgentId: string;
  readonly draft: RealResearchIntakeDraft;
  readonly target: Exclude<RealResearchClaimTarget, 'NONE'>;
}): Pick<AtomicClaimV1, 'predicate' | 'value' | 'valueType'> {
  const predicate =
    input.target === 'WORK_TITLE'
      ? ('canonical_title' as const)
      : input.target === 'AUTHORSHIP'
        ? ('author' as const)
        : ('publication_date' as const);
  const descriptor =
    input.target === 'WORK_TITLE'
      ? ({ value: input.draft.workTitle, valueType: 'TEXT' } as const)
      : input.target === 'AUTHORSHIP'
        ? ({
            value: { entityId: input.authorAgentId, entityType: 'AGENT' },
            valueType: 'ENTITY_REF',
          } as const)
        : ({
            value: {
              precision:
                input.draft.publicationDate.length === 4
                  ? ('YEAR' as const)
                  : input.draft.publicationDate.length === 7
                    ? ('MONTH' as const)
                    : ('DAY' as const),
              value: input.draft.publicationDate,
            },
            valueType: 'DATE_WITH_PRECISION',
          } as const);
  return Object.freeze({ predicate, value: descriptor.value, valueType: descriptor.valueType });
}

export class DesktopEvidenceRuntime {
  readonly #authenticity: SqliteAuthenticityRepository;
  readonly #catalog: SqliteCatalogRepository;
  readonly #clock: () => Date;
  readonly #conflicts = new EvidenceConfirmationBroker<FactConflictPreviewV1>();
  readonly #database: DatabaseSync;
  readonly #files: LocalFileRepository;
  readonly #processing = new EvidenceConfirmationBroker<ProcessingConfirmation>();
  readonly #real: EvidenceConfirmationBroker<RealIntakeConfirmation>;
  readonly #realReplays = new Map<string, RealIntakeReplay>();
  readonly #repository: SqliteEvidenceRepository;
  readonly #synthetic = new EvidenceConfirmationBroker<SyntheticIntakeConfirmation>();

  public constructor(
    database: DatabaseSync,
    root: ProjectDataRoot,
    clock: () => Date = () => new Date(),
  ) {
    this.#authenticity = new SqliteAuthenticityRepository(database);
    this.#catalog = new SqliteCatalogRepository(database);
    this.#clock = clock;
    this.#database = database;
    this.#files = new LocalFileRepository(root);
    this.#real = new EvidenceConfirmationBroker(clock);
    this.#repository = new SqliteEvidenceRepository(database);
  }

  #profileId(): string {
    const profile = this.#database
      .prepare("SELECT id FROM account_profiles WHERE id = 'primary'")
      .get() as { readonly id: string } | undefined;
    if (profile === undefined) throw new EvidenceError('EVIDENCE_POLICY_BLOCKED');
    return profile.id;
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

  public previewRealIntake(
    input: PreviewRealResearchIntakeInput,
    senderId: number,
    windowId: number,
  ): RealResearchIntakePreview {
    const draft = normalizeRealResearchIntakeDraft(input.draft);
    if (draft === null) throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
    const prepared = prepareRealStatements(draft);
    const entityResolution = this.#catalog.previewUserLocalEntityResolution(
      draft.workTitle,
      draft.authorName,
    );
    const profileId = this.#profileId();
    const inputHash = evidenceSemanticHash({
      contractVersion: 'authorized-real-research-intake-v1',
      draft,
      profileId,
    });
    const issued = this.#real.issue(
      {
        draft,
        entityResolution,
        inputHash,
        preparedStatements: prepared.statements,
        profileId,
        sourceText: prepared.sourceText,
      },
      senderId,
      windowId,
    );
    return Object.freeze({
      canConfirm: entityResolution.outcome === 'CREATE_NEW',
      entityResolution,
      estimatedExternalRequests: 0,
      estimatedModelRequests: 0,
      expiresAt: issued.expiresAt,
      feeState: 'NOT_INCURRED',
      inputHash,
      previewHash: issued.previewHash,
      readingState: draft.readingState,
      source: Object.freeze({
        originKind: 'USER_LOCAL_INPUT' as const,
        sourceLocator: draft.sourceLocator.length === 0 ? null : draft.sourceLocator,
        sourceTitle: draft.sourceTitle,
        sourceType: draft.sourceType,
      }),
      spoilerLevel: draft.spoilerLevel,
      statements: Object.freeze(
        prepared.statements.map((statement) =>
          Object.freeze({
            claimTarget: statement.claimTarget,
            classification: statement.classification,
            disposition: statement.disposition,
            evidenceExcerpt:
              statement.input.evidenceExcerpt.length === 0 ? null : statement.input.evidenceExcerpt,
            evidenceLocator:
              statement.input.evidenceLocator.length === 0 ? null : statement.input.evidenceLocator,
            statement: statement.input.statement,
          }),
        ),
      ),
      token: issued.token,
    });
  }

  public async confirmRealIntake(
    input: ConfirmRealResearchIntakeInput,
    senderId: number,
    windowId: number,
  ): Promise<RealResearchIntakeResult> {
    if (input.confirmation !== 'CREATE_AUTHORIZED_REAL_RESEARCH') {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const replay = this.#realReplays.get(input.token);
    if (replay !== undefined) {
      if (
        replay.inputHash !== input.inputHash ||
        replay.previewHash !== input.previewHash ||
        replay.senderId !== senderId ||
        replay.windowId !== windowId
      ) {
        throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
      }
      return replay.result;
    }
    const confirmation = this.#real.consume(input.token, input.previewHash, senderId, windowId);
    if (
      confirmation.inputHash !== input.inputHash ||
      confirmation.entityResolution.outcome !== 'CREATE_NEW'
    ) {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const now = this.#clock().toISOString();
    const key = confirmation.inputHash.slice(0, 32);
    const workId = `user-local-work-${key}`;
    const expressionId = `user-local-expression-${key}`;
    const editionId = `user-local-edition-${key}`;
    const authorAgentId = `user-local-author-${key}`;
    const sourceId = `user-local-source-${key}`;
    const textHash = textSha256(confirmation.sourceText);
    const file = await this.#files.putBuffer(Buffer.from(confirmation.sourceText, 'utf8'), {
      category: 'SOURCE_SNAPSHOT',
      displayName: 'authorized-user-local-research.txt',
      maxBytes: 32_768,
    });
    let result: RealResearchIntakeResult;
    try {
      result = runInCoordinatedTransaction(this.#database, () => {
        this.#catalog.createUserLocalWork(
          {
            authorAgentId,
            authorName: confirmation.draft.authorName,
            editionId,
            editionNote:
              confirmation.draft.editionNote.length === 0 ? null : confirmation.draft.editionNote,
            expressionId,
            language: 'zh-CN',
            publicationDate:
              confirmation.draft.publicationDate.length === 0
                ? null
                : confirmation.draft.publicationDate,
            workId,
            workTitle: confirmation.draft.workTitle,
          },
          now,
        );
        this.#repository.registerSource({
          classification: Object.freeze({
            authorityTier: 'UNKNOWN' as const,
            classifiedBy: 'USER' as const,
            independenceState: 'UNKNOWN' as const,
            lineageGroup: null,
            reasonCode: 'AUTHORIZED_USER_LOCAL_INPUT_UNVERIFIED',
            useClass: 'SUPPORTING_ONLY' as const,
          }),
          contentHash: textHash,
          extractedTextHash: textHash,
          extractedTextPath: file.managedPath,
          language: 'zh-CN',
          localSourceType: confirmation.draft.sourceType,
          originKind: 'USER_LOCAL_INPUT',
          originRecordId: `authorized-user-local-${key}`,
          originRevision: 1,
          publisherOrSite: '用户授权的本地资料',
          publishedAt: null,
          publishedAtPrecision: 'UNKNOWN',
          retrievedAt: now,
          sourceId,
          title: confirmation.draft.sourceTitle,
          url: `https://user-local-input.invalid/${key}`,
          warnings: Object.freeze([
            'AUTHORIZED_USER_LOCAL_INPUT',
            'STATEMENTS_NOT_AUTOMATIC_FACT',
            confirmation.draft.sourceType,
          ]),
        });
        this.#repository.registerSubject('WORK', workId);
        const statements = confirmation.preparedStatements.map((statement, index) => {
          if (
            statement.disposition === 'SOURCE_ONLY_NON_FACT' ||
            statement.claimTarget === 'NONE'
          ) {
            return Object.freeze({
              claimId: null,
              classification: statement.classification,
              evaluationId: null,
              evidenceId: null,
              status: 'SOURCE_ONLY_NON_FACT' as const,
            });
          }
          const claimId = `user-local-claim-${index + 1}-${key}`;
          const claim = workClaim({
            claimId,
            createdAt: now,
            descriptor: realClaimDescriptor({
              authorAgentId,
              draft: confirmation.draft,
              target: statement.claimTarget,
            }),
            sourceId,
            workId,
          });
          this.#repository.createClaim(claim);
          let evidenceId: string | null = null;
          if (
            statement.evidenceStartCodePoint !== null &&
            statement.evidenceEndCodePoint !== null
          ) {
            evidenceId = `user-local-evidence-${index + 1}-${key}`;
            this.#repository.addEvidence(
              {
                claimId,
                evidenceId,
                extractedText: confirmation.sourceText,
                language: 'zh-CN',
                locator: createEvidenceLocator(
                  sourceId,
                  1,
                  confirmation.sourceText,
                  statement.evidenceStartCodePoint,
                  statement.evidenceEndCodePoint,
                ),
                relation: 'SUPPORTS',
                summary: null,
              },
              now,
            );
          }
          const evaluation = this.#repository.reconcileClaim(claimId, now);
          return Object.freeze({
            claimId,
            classification: statement.classification,
            evaluationId: evaluation.evaluationId,
            evidenceId,
            status: evaluation.status,
          });
        });
        const memoryConfidence =
          confirmation.draft.readingState === 'R1_READ_CLEAR'
            ? ('CLEAR' as const)
            : confirmation.draft.readingState === 'R2_READ_FUZZY'
              ? ('PARTIAL' as const)
              : ('NOT_APPLICABLE' as const);
        this.#authenticity.applyStateChange(
          {
            confirmationKind: 'USER_EXPLICIT',
            expectedRevision: 0,
            finishedAt: null,
            finishedAtPrecision: 'UNKNOWN',
            lastReadAt: null,
            lastReadAtPrecision: 'UNKNOWN',
            memoryConfidence,
            nextState: confirmation.draft.readingState,
            profileId: confirmation.profileId,
            provenance: 'USER_UI',
            subject: { editionId, expressionId, workId },
            userNote: null,
          },
          now,
        );
        if (confirmation.draft.spoilerLevel !== 'NO_SPOILER') {
          this.#authenticity.applySpoiler(
            {
              expectedRevision: 1,
              level: confirmation.draft.spoilerLevel,
              profileId: confirmation.profileId,
              userConfirmed: confirmation.draft.spoilerConfirmed,
              warningIncluded: true,
              workId,
            },
            now,
          );
        }
        return Object.freeze({
          externalRequestCount: 0 as const,
          feeState: 'NOT_INCURRED' as const,
          modelRequestCount: 0 as const,
          readingState: confirmation.draft.readingState,
          scoreRecordsCreated: 0 as const,
          sourceOriginKind: 'USER_LOCAL_INPUT' as const,
          sourceRevisionId: `${sourceId}:1`,
          spoilerLevel: confirmation.draft.spoilerLevel,
          statements: Object.freeze(statements),
          workId,
        });
      });
    } catch (error) {
      if (error instanceof CatalogError) throw new EvidenceError('EVIDENCE_CONFLICT');
      if (error instanceof AuthenticityError) {
        throw new EvidenceError(
          error.code === 'AUTHENTICITY_POLICY_BLOCKED'
            ? 'EVIDENCE_POLICY_BLOCKED'
            : 'EVIDENCE_INVALID_REQUEST',
        );
      }
      throw error;
    }
    this.#realReplays.set(input.token, {
      inputHash: input.inputHash,
      previewHash: input.previewHash,
      result,
      senderId,
      windowId,
    });
    return result;
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
      const descriptor =
        located.predicate === 'canonical_title'
          ? ({
              predicate: located.predicate,
              value: confirmation.draft.workTitle,
              valueType: 'TEXT',
            } as const)
          : located.predicate === 'author'
            ? ({
                predicate: located.predicate,
                value: { entityId: resolution.authorAgentId, entityType: 'AGENT' },
                valueType: 'ENTITY_REF',
              } as const)
            : ({
                predicate: located.predicate,
                value: { precision: 'DAY', value: confirmation.draft.publicationDate },
                valueType: 'DATE_WITH_PRECISION',
              } as const);
      const claim = workClaim({
        claimId: `local-slice-claim-${located.predicate}-${key}`,
        createdAt: now,
        descriptor,
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
    this.#real.clearWindow(windowId);
    for (const [token, replay] of this.#realReplays) {
      if (replay.windowId === windowId) this.#realReplays.delete(token);
    }
    this.#synthetic.clearWindow(windowId);
  }
}
