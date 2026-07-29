import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  ATOMIC_CLAIM_CONTRACT_VERSION,
  FACT_CONFLICT_STATES,
  FACT_POLICY_VERSION,
  SOURCE_EVIDENCE_CONTRACT_VERSION,
  SOURCE_PROCESSING_PLAN_VERSION,
  type AtomicClaimV1,
  type EvidenceLocatorV1,
  type EvidenceRelation,
  type EvidenceSummaryV1,
  type FactConflictAction,
  type FactConflictState,
  type FactEvaluationStatus,
  type FactPolicyEvidenceV1,
  type FactSubjectType,
  type SourceAuthorityTier,
  type SourceAvailabilityState,
  type SourceIndependenceState,
  type SourceOriginKind,
  type SourceProcessingPlanV1,
  type SourceUseClass,
  EvidenceError,
  canonicalEvidenceJson,
  detectMaterialConflict,
  evaluateFactPolicy,
  evidenceSemanticHash,
  locateEvidenceExcerpt,
  normalizedClaimValue,
  normalizedScopeIdentity,
  validateAtomicClaimV1,
  validateEvidenceSummaryV1,
  validateSourceProcessingPlanV1,
} from '@mystery-operations/evidence';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

export interface SourceClassificationInputV1 {
  readonly authorityTier: SourceAuthorityTier;
  readonly classifiedBy: 'SYNTHETIC_FIXTURE' | 'USER';
  readonly independenceState: SourceIndependenceState;
  readonly lineageGroup: string | null;
  readonly reasonCode: string;
  readonly useClass: SourceUseClass;
}

export interface RegisterSourceInputV1 {
  readonly classification: SourceClassificationInputV1;
  readonly contentHash: string;
  readonly extractedTextHash: string | null;
  readonly extractedTextPath: string | null;
  readonly language: string;
  readonly originKind: SourceOriginKind;
  readonly originRecordId: string;
  readonly originRevision: number;
  readonly publisherOrSite: string | null;
  readonly publishedAt: string | null;
  readonly publishedAtPrecision: 'DAY' | 'MONTH' | 'UNKNOWN' | 'YEAR';
  readonly retrievedAt: string;
  readonly sourceId: string;
  readonly title: string;
  readonly url: string;
  readonly warnings: readonly string[];
}

export interface AddSourceRevisionInputV1 extends Omit<
  RegisterSourceInputV1,
  'publisherOrSite' | 'retrievedAt' | 'title' | 'url'
> {
  readonly availability: SourceAvailabilityState;
  readonly createdAt: string;
  readonly revision: number;
}

export interface AddClaimEvidenceInputV1 {
  readonly claimId: string;
  readonly evidenceId: string;
  readonly extractedText: string;
  readonly language: string;
  readonly locator: EvidenceLocatorV1;
  readonly relation: EvidenceRelation;
  readonly summary: EvidenceSummaryV1 | null;
}

export interface EvidenceEvaluationViewV1 {
  readonly claimId: string;
  readonly evaluationId: string;
  readonly qualifyingSourceIds: readonly string[];
  readonly reasonCode: string;
  readonly status: FactEvaluationStatus;
}

export interface FactConflictViewV1 {
  readonly claimLeftId: string;
  readonly claimRightId: string;
  readonly conflictId: string;
  readonly revision: number;
  readonly state: FactConflictState;
}

export interface FactConflictPreviewV1 extends FactConflictViewV1 {
  readonly action: FactConflictAction;
  readonly acceptedClaimId: string | null;
  readonly affected: {
    readonly claimIds: readonly string[];
    readonly evidenceIds: readonly string[];
    readonly sourceRevisionIds: readonly string[];
    readonly subjects: readonly {
      readonly subjectId: string;
      readonly subjectType: FactSubjectType;
    }[];
  };
  readonly afterEvaluations: readonly {
    readonly claimId: string;
    readonly status: FactEvaluationStatus;
  }[];
  readonly beforeEvaluations: readonly {
    readonly claimId: string;
    readonly status: FactEvaluationStatus;
  }[];
  readonly previewHash: string;
}

export interface EvidenceSourceViewV1 {
  readonly authorityTier: SourceAuthorityTier;
  readonly availability: SourceAvailabilityState;
  readonly independenceState: SourceIndependenceState;
  readonly language: string;
  readonly lineageGroup: string | null;
  readonly originKind: SourceOriginKind;
  readonly revision: number;
  readonly sourceId: string;
  readonly title: string;
  readonly useClass: SourceUseClass;
}

export interface EvidenceClaimViewV1 {
  readonly claimId: string;
  readonly evaluationStatus: FactEvaluationStatus;
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly excerpt: string;
    readonly language: string;
    readonly relation: string;
    readonly sourceId: string;
    readonly sourceRevision: number;
    readonly summaryZh: string | null;
  }[];
  readonly predicate: string;
  readonly subjectId: string;
  readonly subjectType: FactSubjectType;
  readonly value: unknown;
}

export interface EvidenceSummaryViewV1 {
  readonly claims: readonly EvidenceClaimViewV1[];
  readonly conflicts: readonly FactConflictViewV1[];
  readonly counts: {
    readonly claims: number;
    readonly conflicts: number;
    readonly evaluations: number;
    readonly evidence: number;
    readonly sources: number;
  };
  readonly inbox: readonly {
    readonly factStatus: 'NOT_A_FACT';
    readonly originKind: 'BROWSER_CLIP' | 'FETCH_DOCUMENT';
    readonly originRecordId: string;
    readonly suggestedUse: 'CONTEXT_ONLY' | 'NOT_CLASSIFIED';
    readonly title: string;
    readonly truthStatus: 'UNVERIFIED';
  }[];
  readonly processingRuns: readonly {
    readonly costState: string;
    readonly currentStep: string | null;
    readonly externalRequestCount: number;
    readonly revision: number;
    readonly runId: string;
    readonly status: string;
  }[];
  readonly sources: readonly EvidenceSourceViewV1[];
}

const ACTIVE_CONFLICT_STATES = new Set<FactConflictState>(['OPEN', 'FACT_BLOCKED', 'REOPENED']);
const HASH = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function identifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  return value;
}

function hasForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      ((codePoint <= 0x1f && ![0x09, 0x0a, 0x0d].includes(codePoint)) || codePoint === 0x7f)
    );
  });
}

function boundedText(value: string, maximum: number): string {
  if (value.trim().length < 1 || value.length > maximum || hasForbiddenControl(value)) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  return value;
}

function iso(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  return value;
}

function safeJson(value: unknown, maximum = 65_536): string {
  const json = canonicalEvidenceJson(value);
  if (Buffer.byteLength(json, 'utf8') > maximum) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  return json;
}

function canonicalUrlIdentity(value: string): {
  readonly canonicalUrlHash: string;
  readonly displayHost: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new EvidenceError('EVIDENCE_INVALID_SOURCE');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hostname.length < 1 ||
    parsed.hostname.length > 253
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_SOURCE');
  }
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol === 'https:' && parsed.port === '443') ||
    (parsed.protocol === 'http:' && parsed.port === '80')
  ) {
    parsed.port = '';
  }
  return Object.freeze({
    canonicalUrlHash: evidenceSemanticHash(parsed.toString()),
    displayHost: parsed.hostname,
  });
}

function count(database: DatabaseSync, table: string): number {
  const allowed = new Set([
    'sources',
    'claims',
    'claim_evidence',
    'fact_conflicts',
    'fact_evaluations',
  ]);
  if (!allowed.has(table)) throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  return (
    database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
      readonly count: number;
    }
  ).count;
}

function conflictStateForAction(action: FactConflictAction): FactConflictState {
  if (action === 'ACCEPT_CLAIM') return 'RESOLVED_ACCEPT';
  if (action === 'ACCEPT_MULTIVALUE') return 'RESOLVED_MULTIVALUE';
  if (action === 'SPLIT_SCOPE') return 'RESOLVED_SCOPE_SPLIT';
  if (action === 'DISMISS_DEPENDENT_SOURCE') return 'DISMISSED_DEPENDENT_SOURCE';
  if (action === 'UNDO') return 'FACT_BLOCKED';
  return 'REOPENED';
}

function subjectColumn(type: FactSubjectType): string {
  if (type === 'WORK') return 'work_id';
  if (type === 'EXPRESSION') return 'expression_id';
  if (type === 'EDITION') return 'edition_id';
  if (type === 'AGENT') return 'agent_id';
  return 'publication_relationship_id';
}

function subjectTable(type: FactSubjectType): string {
  if (type === 'WORK') return 'books';
  if (type === 'EXPRESSION') return 'expressions';
  if (type === 'EDITION') return 'book_editions';
  if (type === 'AGENT') return 'catalog_agents';
  return 'publication_relationships';
}

export class SqliteEvidenceRepository {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public registerSource(input: RegisterSourceInputV1): EvidenceSourceViewV1 {
    this.#validateSourceInput(input);
    return runInTransaction(this.#database, () => {
      const canonicalUrl = canonicalUrlIdentity(input.url);
      const classification =
        input.originKind === 'BROWSER_CLIP'
          ? {
              authorityTier: 'DISCUSSION_CONTEXT' as const,
              independenceState: 'UNKNOWN' as const,
              lineageGroup: input.sourceId,
              reasonCode: 'BROWSER_CLIP_CONTEXT_ONLY',
              useClass: 'CONTEXT_ONLY' as const,
              classifiedBy: 'USER' as const,
            }
          : input.classification;
      this.#assertContentLineage(input.contentHash, classification.lineageGroup, input.sourceId);
      const controlled = this.#controlledOrigin(input.originKind, input.originRecordId);
      if (controlled !== null) {
        if (
          canonicalUrlIdentity(controlled.url).canonicalUrlHash !== canonicalUrl.canonicalUrlHash ||
          controlled.contentHash !== input.contentHash ||
          controlled.extractedTextHash !== input.extractedTextHash ||
          controlled.extractedTextPath !== input.extractedTextPath
        ) {
          throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
        }
      }
      const existing = this.#database
        .prepare('SELECT id FROM sources WHERE id = ?')
        .get(input.sourceId);
      if (existing !== undefined) {
        return this.#replayedSourceView(input, 1, 'AVAILABLE', classification);
      }
      this.#database
        .prepare(
          `INSERT INTO sources(
             id, url, title, publisher_or_site, source_tier, source_type,
             retrieved_at, content_hash, local_snapshot_path, language, user_supplied
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.sourceId,
          input.url,
          input.title,
          input.publisherOrSite,
          classification.authorityTier,
          input.originKind,
          input.retrievedAt,
          input.contentHash,
          input.extractedTextPath,
          input.language,
          input.originKind === 'SYNTHETIC_FIXTURE' ? 1 : 0,
        );
      this.#insertSourceRevision(
        {
          ...input,
          availability: 'AVAILABLE',
          createdAt: input.retrievedAt,
          revision: 1,
        },
        classification,
        canonicalUrl,
      );
      this.#audit(
        'SOURCE_REGISTERED',
        'SOURCE',
        input.sourceId,
        {
          originKind: input.originKind,
          revision: 1,
        },
        input.retrievedAt,
      );
      return Object.freeze({
        ...classification,
        availability: 'AVAILABLE' as const,
        language: input.language,
        originKind: input.originKind,
        revision: 1,
        sourceId: input.sourceId,
        title: input.title,
      });
    });
  }

  public addSourceRevision(input: AddSourceRevisionInputV1): EvidenceSourceViewV1 {
    this.#validateSourceInput(
      {
        ...input,
        publisherOrSite: null,
        retrievedAt: input.createdAt,
        title: 'revision',
        url: 'revision',
      },
      false,
    );
    return runInTransaction(this.#database, () => {
      const source = this.#database
        .prepare('SELECT title, url FROM sources WHERE id = ?')
        .get(input.sourceId) as { readonly title: string; readonly url: string } | undefined;
      if (source === undefined) throw new EvidenceError('EVIDENCE_NOT_FOUND');
      const latest = this.#database
        .prepare('SELECT max(revision) AS revision FROM source_revisions WHERE source_id = ?')
        .get(input.sourceId) as { readonly revision: number };
      const classification =
        input.originKind === 'BROWSER_CLIP'
          ? {
              authorityTier: 'DISCUSSION_CONTEXT' as const,
              independenceState: 'UNKNOWN' as const,
              lineageGroup: input.sourceId,
              reasonCode: 'BROWSER_CLIP_CONTEXT_ONLY',
              useClass: 'CONTEXT_ONLY' as const,
              classifiedBy: 'USER' as const,
            }
          : input.classification;
      this.#assertContentLineage(input.contentHash, classification.lineageGroup, input.sourceId);
      if (input.revision === latest.revision) {
        return this.#replayedSourceView(input, input.revision, input.availability, classification);
      }
      if (input.revision !== latest.revision + 1) {
        throw new EvidenceError('EVIDENCE_STALE_REVISION', true);
      }
      this.#insertSourceRevision(input, classification, canonicalUrlIdentity(source.url));
      this.#markSourceEvaluationsStale(input.sourceId, input.createdAt);
      this.#audit(
        'SOURCE_REVISION_ADDED',
        'SOURCE',
        input.sourceId,
        {
          availability: input.availability,
          revision: input.revision,
        },
        input.createdAt,
      );
      return Object.freeze({
        ...classification,
        availability: input.availability,
        language: input.language,
        originKind: input.originKind,
        revision: input.revision,
        sourceId: input.sourceId,
        title: source.title,
      });
    });
  }

  public addLineage(
    sourceId: string,
    parentSourceId: string,
    relation: 'DERIVED_FROM' | 'MIRROR_OF' | 'REPRINT_OF' | 'SAME_PRESS_RELEASE',
    reason: string,
    createdAt: string,
  ): void {
    identifier(sourceId);
    identifier(parentSourceId);
    boundedText(reason, 2_000);
    iso(createdAt);
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO source_lineage(
             source_id, parent_source_id, relation, confirmed_by, reason, created_at
           ) VALUES (?, ?, ?, 'USER', ?, ?)`,
        )
        .run(sourceId, parentSourceId, relation, reason, createdAt);
      const child = this.#database
        .prepare(
          `SELECT max(revision) AS revision
           FROM source_revisions
           WHERE source_id = ?`,
        )
        .get(sourceId) as { readonly revision: number | null };
      const parent = this.#database
        .prepare(
          `SELECT classification.lineage_group
           FROM source_revisions AS revision
           JOIN source_classifications AS classification
             ON classification.source_id = revision.source_id
            AND classification.source_revision = revision.revision
           WHERE revision.source_id = ?
             AND revision.revision = (
               SELECT max(current.revision)
               FROM source_revisions AS current
               WHERE current.source_id = revision.source_id
             )
           ORDER BY classification.classification_revision DESC
           LIMIT 1`,
        )
        .get(parentSourceId) as { readonly lineage_group: string | null } | undefined;
      if (child.revision === null || parent?.lineage_group === null || parent === undefined) {
        throw new EvidenceError('EVIDENCE_POLICY_BLOCKED');
      }
      const classificationRevision = (
        this.#database
          .prepare(
            `SELECT max(classification_revision) AS revision
             FROM source_classifications
             WHERE source_id = ? AND source_revision = ?`,
          )
          .get(sourceId, child.revision) as { readonly revision: number }
      ).revision;
      this.#database
        .prepare(
          `INSERT INTO source_classifications(
             source_id, source_revision, classification_revision, authority_tier,
             use_class, independence_state, lineage_group, reason_code,
             classified_by, created_at
           )
           SELECT source_id, source_revision, ?, authority_tier, use_class,
                  'DEPENDENT', ?, 'USER_CONFIRMED_DEPENDENCY', 'USER', ?
           FROM source_classifications
           WHERE source_id = ? AND source_revision = ?
             AND classification_revision = ?`,
        )
        .run(
          classificationRevision + 1,
          parent.lineage_group,
          createdAt,
          sourceId,
          child.revision,
          classificationRevision,
        );
      this.#markSourceEvaluationsStale(sourceId, createdAt);
      this.#audit(
        'SOURCE_LINEAGE_CONFIRMED',
        'SOURCE',
        sourceId,
        { parentSourceId, relation },
        createdAt,
      );
    });
  }

  public registerSubject(type: FactSubjectType, subjectId: string): void {
    identifier(subjectId);
    const table = subjectTable(type);
    const column = subjectColumn(type);
    const exists = this.#database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(subjectId);
    if (exists === undefined) throw new EvidenceError('EVIDENCE_NOT_FOUND');
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO fact_subjects(subject_type, subject_id, ${column})
         VALUES (?, ?, ?)`,
      )
      .run(type, subjectId, subjectId);
  }

  public createClaim(claimValue: AtomicClaimV1): AtomicClaimV1 {
    const claim = validateAtomicClaimV1(claimValue);
    const predicate = this.#database
      .prepare(
        `SELECT value_type, predicate_version, active
         FROM predicate_registry
         WHERE predicate = ?`,
      )
      .get(claim.predicate) as
      | {
          readonly active: number;
          readonly predicate_version: number;
          readonly value_type: string;
        }
      | undefined;
    if (
      predicate === undefined ||
      predicate.active !== 1 ||
      predicate.value_type !== claim.valueType ||
      predicate.predicate_version !== claim.predicateVersion
    ) {
      throw new EvidenceError('EVIDENCE_INVALID_CLAIM');
    }
    const replay = this.#database
      .prepare(
        `SELECT semantic_fingerprint
         FROM claims
         WHERE id = ? AND contract_version = ?`,
      )
      .get(claim.claimId, ATOMIC_CLAIM_CONTRACT_VERSION) as
      { readonly semantic_fingerprint: string } | undefined;
    if (replay !== undefined) {
      if (replay.semantic_fingerprint !== claim.semanticFingerprint) {
        throw new EvidenceError('EVIDENCE_CONFLICT');
      }
      return claim;
    }
    const scope = normalizedScopeIdentity(claim.scope);
    const normalizedValue = normalizedClaimValue(claim.value, claim.valueType);
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO claims(
             id, contract_version, subject_type, subject_id, predicate,
             predicate_version, value_type,
             value_json, normalized_value, scope_json, normalized_scope_hash,
             policy_version, key_fact, claimant_source_id, claimant_source_revision,
             semantic_fingerprint, status, provenance_json, revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          claim.claimId,
          ATOMIC_CLAIM_CONTRACT_VERSION,
          claim.subject.type,
          claim.subject.id,
          claim.predicate,
          claim.predicateVersion,
          claim.valueType,
          safeJson(claim.value, 32_768),
          normalizedValue,
          scope.json,
          scope.hash,
          FACT_POLICY_VERSION,
          claim.keyFact ? 1 : 0,
          claim.claimant?.sourceId ?? null,
          claim.claimant?.sourceRevision ?? null,
          claim.semanticFingerprint,
          claim.status,
          safeJson(claim.provenance, 16_384),
          claim.revision,
          claim.createdAt,
        );
      this.#audit(
        'CLAIM_CREATED',
        'CLAIM',
        claim.claimId,
        {
          predicate: claim.predicate,
          subjectType: claim.subject.type,
        },
        claim.createdAt,
      );
    });
    return claim;
  }

  public addEvidence(input: AddClaimEvidenceInputV1, createdAt: string): void {
    identifier(input.claimId);
    identifier(input.evidenceId);
    iso(createdAt);
    boundedText(input.language, 32);
    const revision = this.#database
      .prepare(
        `SELECT availability, extracted_text_hash
         FROM source_revisions
         WHERE source_id = ? AND revision = ?`,
      )
      .get(input.locator.sourceId, input.locator.sourceRevision) as
      | {
          readonly availability: SourceAvailabilityState;
          readonly extracted_text_hash: string | null;
        }
      | undefined;
    if (
      revision === undefined ||
      revision.extracted_text_hash === null ||
      revision.extracted_text_hash !== input.locator.extractedTextHash
    ) {
      throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
    }
    const located = locateEvidenceExcerpt(
      input.extractedText,
      input.locator,
      revision.availability,
    );
    const summary =
      input.summary === null
        ? null
        : validateEvidenceSummaryV1(input.summary, located.locator, located.excerptHash);
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO claim_evidence(
             id, claim_id, source_id, source_revision, locator_version, locator_kind,
             locator_json, excerpt, excerpt_hash, supports_or_contradicts, language,
             summary_zh, summary_method, model_execution_id, locator_validated, created_at
           ) VALUES (?, ?, ?, ?, ?, 'CHAR_RANGE', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          input.evidenceId,
          input.claimId,
          located.locator.sourceId,
          located.locator.sourceRevision,
          located.locator.version,
          safeJson(located.locator, 16_384),
          located.excerpt,
          located.excerptHash,
          input.relation,
          input.language,
          summary?.textZh ?? null,
          summary?.method ?? null,
          summary?.modelExecutionId ?? null,
          createdAt,
        );
      this.#audit(
        'EVIDENCE_ATTACHED',
        'EVIDENCE',
        input.evidenceId,
        {
          claimId: input.claimId,
          sourceId: located.locator.sourceId,
          sourceRevision: located.locator.sourceRevision,
        },
        createdAt,
      );
    });
  }

  public reconcileClaim(claimId: string, createdAt: string): EvidenceEvaluationViewV1 {
    identifier(claimId);
    iso(createdAt);
    const action = (): EvidenceEvaluationViewV1 => {
      const claim = this.#claimComparable(claimId);
      const peers = this.#database
        .prepare(
          `SELECT claim.id
           FROM claims AS claim
           WHERE claim.subject_type = ? AND claim.subject_id = ?
             AND claim.predicate = ? AND claim.normalized_scope_hash = ?
             AND claim.policy_version = ? AND claim.id <> ?
           ORDER BY claim.id
           LIMIT 256`,
        )
        .all(
          claim.subjectType,
          claim.subjectId,
          claim.predicate,
          claim.normalizedScopeHash,
          claim.policyVersion,
          claim.claimId,
        ) as unknown as readonly { readonly id: string }[];
      for (const peer of peers) {
        const other = this.#claimComparable(peer.id);
        const conflict = detectMaterialConflict(claim, other);
        if (conflict.conflict)
          this.#openConflict(claim.claimId, other.claimId, conflict.key, createdAt);
      }
      const unresolved = this.#hasUnresolvedConflict(claimId);
      const conflictSnapshot = this.#conflictSnapshot(claimId);
      const evidenceRows = this.#evidenceForPolicy(claimId);
      const stale = evidenceRows.some((item) => item.stale);
      const policyEvidence: FactPolicyEvidenceV1[] = evidenceRows.map((item) => ({
        availability: item.availability,
        authorityTier: item.authorityTier,
        independence: item.independence,
        lineageGroup: item.lineageGroup,
        locatorValid: item.locatorValid,
        relation: item.relation,
        sourceId: item.sourceId,
        sourceRevision: item.sourceRevision,
        useClass: item.useClass,
      }));
      let evaluation = evaluateFactPolicy({
        evidence: policyEvidence,
        policyVersion: FACT_POLICY_VERSION,
        stale,
        unresolvedMaterialConflict: unresolved,
      });
      if (
        !unresolved &&
        evaluation.status !== 'REJECTED' &&
        policyEvidence.some((item) => item.relation === 'CONTRADICTS' && item.locatorValid)
      ) {
        evaluation = Object.freeze({
          ...evaluation,
          reason: 'VALID_SUPPORT_INSUFFICIENT',
          status: 'CONFLICTED',
        });
      }
      if (conflictSnapshot.rejectedByAcceptedDecision) {
        evaluation = Object.freeze({
          ...evaluation,
          qualifyingSourceIds: Object.freeze([]),
          reason: 'USER_CONFLICT_DECISION',
          status: 'REJECTED',
        });
      }
      const digest = evidenceSemanticHash(
        evidenceRows.map((item) => [item.sourceId, item.sourceRevision, item.availability]),
      );
      const independenceSnapshot = evidenceRows.map((item) => ({
        authorityTier: item.authorityTier,
        availability: item.availability,
        independence: item.independence,
        lineageGroup: item.lineageGroup,
        locatorValid: item.locatorValid,
        relation: item.relation,
        sourceId: item.sourceId,
        sourceRevision: item.sourceRevision,
        useClass: item.useClass,
      }));
      const inputIdentityHash = evidenceSemanticHash({
        claimId,
        conflictDigest: conflictSnapshot.digest,
        independenceSnapshot,
        policyVersion: FACT_POLICY_VERSION,
        sourceRevisionDigest: digest,
        stale,
        unresolvedMaterialConflict: unresolved,
      });
      const replay = this.#database
        .prepare(
          `SELECT id, status, reason_code, qualifying_source_ids_json
           FROM fact_evaluations
           WHERE input_identity_hash = ?`,
        )
        .get(inputIdentityHash) as Row | undefined;
      if (replay !== undefined) {
        return Object.freeze({
          claimId,
          evaluationId: replay.id as string,
          qualifyingSourceIds: Object.freeze(
            JSON.parse(replay.qualifying_source_ids_json as string) as string[],
          ),
          reasonCode: replay.reason_code as string,
          status: replay.status as FactEvaluationStatus,
        });
      }
      const evaluationId = `evaluation-${this.#idFactory()}`;
      this.#database
        .prepare(
          `INSERT INTO fact_evaluations(
             id, claim_id, status, policy_version, reason_code,
             qualifying_source_ids_json, source_revision_digest,
             independence_snapshot_json, input_identity_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          evaluationId,
          claimId,
          evaluation.status,
          FACT_POLICY_VERSION,
          evaluation.reason,
          safeJson(evaluation.qualifyingSourceIds, 8_192),
          digest,
          safeJson(independenceSnapshot, 32_768),
          inputIdentityHash,
          createdAt,
        );
      this.#audit(
        'FACT_EVALUATED',
        'CLAIM',
        claimId,
        {
          evaluationId,
          status: evaluation.status,
        },
        createdAt,
      );
      return Object.freeze({
        claimId,
        evaluationId,
        qualifyingSourceIds: evaluation.qualifyingSourceIds,
        reasonCode: evaluation.reason,
        status: evaluation.status,
      });
    };
    return this.#database.isTransaction ? action() : runInTransaction(this.#database, action);
  }

  public previewConflictAction(
    conflictId: string,
    action: FactConflictAction,
    acceptedClaimId: string | null,
  ): FactConflictPreviewV1 {
    const conflict = this.#conflict(conflictId);
    if (action === 'ACCEPT_CLAIM') {
      if (
        acceptedClaimId === null ||
        ![conflict.claimLeftId, conflict.claimRightId].includes(acceptedClaimId)
      ) {
        throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
      }
    } else if (acceptedClaimId !== null) {
      throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
    }
    if (action !== 'REOPEN' && action !== 'UNDO' && !ACTIVE_CONFLICT_STATES.has(conflict.state)) {
      throw new EvidenceError('EVIDENCE_CONFLICT');
    }
    if (action === 'REOPEN' && ACTIVE_CONFLICT_STATES.has(conflict.state)) {
      throw new EvidenceError('EVIDENCE_CONFLICT');
    }
    const affected = this.#conflictAffected(conflict);
    const beforeEvaluations = affected.claimIds.map((claimId) => ({
      claimId,
      status: this.#latestEvaluationStatus(claimId),
    }));
    const nextState = conflictStateForAction(action);
    const afterEvaluations = affected.claimIds.map((claimId) => ({
      claimId,
      status: this.#simulatedEvaluationStatus(claimId, nextState, acceptedClaimId),
    }));
    const value = {
      ...conflict,
      acceptedClaimId,
      action,
      affected,
      afterEvaluations,
      beforeEvaluations,
    };
    return Object.freeze({ ...value, previewHash: evidenceSemanticHash(value) });
  }

  public applyConflictAction(
    preview: FactConflictPreviewV1,
    reason: string,
    decisionId: string,
    createdAt: string,
  ): FactConflictViewV1 {
    boundedText(reason, 2_000);
    identifier(decisionId);
    iso(createdAt);
    const previewPayload = {
      acceptedClaimId: preview.acceptedClaimId,
      action: preview.action,
      affected: preview.affected,
      afterEvaluations: preview.afterEvaluations,
      beforeEvaluations: preview.beforeEvaluations,
      claimLeftId: preview.claimLeftId,
      claimRightId: preview.claimRightId,
      conflictId: preview.conflictId,
      revision: preview.revision,
      state: preview.state,
    };
    const expectedHash = evidenceSemanticHash(previewPayload);
    if (expectedHash !== preview.previewHash) {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const applied = runInTransaction(this.#database, () => {
      const current = this.#conflict(preview.conflictId);
      if (current.revision !== preview.revision || current.state !== preview.state) {
        throw new EvidenceError('EVIDENCE_STALE_REVISION', true);
      }
      const nextState = conflictStateForAction(preview.action);
      const nextRevision = current.revision + 1;
      const changed = this.#database
        .prepare(
          `UPDATE fact_conflicts
           SET state = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(nextState, nextRevision, createdAt, current.conflictId, current.revision);
      if (changed.changes !== 1) throw new EvidenceError('EVIDENCE_STALE_REVISION', true);
      const parent = this.#database
        .prepare(
          `SELECT id FROM fact_conflict_decisions
           WHERE conflict_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(current.conflictId) as { readonly id: string } | undefined;
      this.#database
        .prepare(
          `INSERT INTO fact_conflict_decisions(
             id, conflict_id, action, accepted_claim_id, parent_decision_id,
             expected_revision, resulting_revision, reason, preview_hash, actor,
             before_json, after_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USER', ?, ?, ?)`,
        )
        .run(
          decisionId,
          current.conflictId,
          preview.action,
          preview.acceptedClaimId,
          parent?.id ?? null,
          current.revision,
          nextRevision,
          reason,
          preview.previewHash,
          safeJson(current),
          safeJson({ ...current, revision: nextRevision, state: nextState }),
          createdAt,
        );
      const event =
        preview.action === 'UNDO'
          ? 'CONFLICT_UNDONE'
          : preview.action === 'REOPEN'
            ? 'CONFLICT_REOPENED'
            : 'CONFLICT_RESOLVED';
      this.#audit(
        event,
        'CONFLICT',
        current.conflictId,
        {
          action: preview.action,
          decisionId,
          resultingRevision: nextRevision,
        },
        createdAt,
      );
      const result = Object.freeze({
        ...current,
        revision: nextRevision,
        state: nextState,
      });
      this.reconcileClaim(result.claimLeftId, createdAt);
      this.reconcileClaim(result.claimRightId, createdAt);
      return result;
    });
    return applied;
  }

  public saveProcessingPlan(
    planValue: SourceProcessingPlanV1,
    runId: string,
    executionId: string,
  ): void {
    const plan = validateSourceProcessingPlanV1(planValue);
    identifier(runId);
    identifier(executionId);
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO source_processing_plans(
             id, contract_version, plan_hash, plan_json, estimated_external_requests,
             estimated_fee, created_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, 'UNKNOWN', ?, ?)`,
        )
        .run(
          plan.planId,
          SOURCE_PROCESSING_PLAN_VERSION,
          plan.planHash,
          safeJson(plan, 131_072),
          plan.estimatedExternalRequests,
          plan.createdAt,
          plan.expiresAt,
        );
      this.#database
        .prepare(
          `INSERT INTO source_processing_runs(
             id, execution_id, plan_id, status, external_request_count,
             cost_state, revision, created_at, updated_at
           ) VALUES (?, ?, ?, 'PLANNED', 0, 'NOT_INCURRED', 1, ?, ?)`,
        )
        .run(runId, executionId, plan.planId, plan.createdAt, plan.createdAt);
    });
  }

  public confirmProcessingRun(runId: string, expectedRevision: number, createdAt: string): void {
    identifier(runId);
    iso(createdAt);
    const changed = this.#database
      .prepare(
        `UPDATE source_processing_runs
         SET status = 'CONFIRMED', revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'PLANNED' AND revision = ?`,
      )
      .run(createdAt, runId, expectedRevision);
    if (changed.changes !== 1) throw new EvidenceError('EVIDENCE_STALE_REVISION', true);
    this.#audit(
      'PROCESSING_PLAN_CONFIRMED',
      'PROCESSING_RUN',
      runId,
      {
        expectedRevision,
      },
      createdAt,
    );
  }

  public finishProcessingRun(
    runId: string,
    expectedRevision: number,
    status: 'AMBIGUOUS' | 'BUDGET_BLOCKED' | 'CAPABILITY_BLOCKED' | 'FAILED' | 'SUCCEEDED',
    completedSteps: readonly string[],
    externalRequestCount: number,
    costState: 'NOT_INCURRED' | 'UNKNOWN_POSSIBLY_INCURRED' | 'UNPRICED_USAGE',
    stableErrorCode: string | null,
    createdAt: string,
  ): void {
    identifier(runId);
    iso(createdAt);
    if (
      completedSteps.length > 4 ||
      !completedSteps.every((step) =>
        ['CLASSIFY', 'EXTRACT_CLAIMS', 'SUMMARIZE', 'RECONCILE'].includes(step),
      ) ||
      !Number.isSafeInteger(externalRequestCount) ||
      externalRequestCount < 0 ||
      externalRequestCount > 128
    ) {
      throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
    }
    const changed = this.#database
      .prepare(
        `UPDATE source_processing_runs
         SET status = ?, current_step = NULL, completed_steps_json = ?,
             external_request_count = ?, cost_state = ?, stable_error_code = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND status IN ('CONFIRMED', 'RUNNING')
           AND revision = ?`,
      )
      .run(
        status,
        safeJson(completedSteps, 8_192),
        externalRequestCount,
        costState,
        stableErrorCode,
        createdAt,
        runId,
        expectedRevision,
      );
    if (changed.changes !== 1) throw new EvidenceError('EVIDENCE_STALE_REVISION', true);
  }

  public assertSourceRevisionIds(sourceRevisionIds: readonly string[]): void {
    if (sourceRevisionIds.length < 1 || sourceRevisionIds.length > 64) {
      throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
    }
    for (const identity of sourceRevisionIds) {
      identifier(identity);
      const separator = identity.lastIndexOf(':');
      const sourceId = identity.slice(0, separator);
      const revision = Number(identity.slice(separator + 1));
      if (
        separator < 1 ||
        !IDENTIFIER.test(sourceId) ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        this.#database
          .prepare(
            `SELECT 1
             FROM source_revisions
             WHERE source_id = ? AND revision = ?`,
          )
          .get(sourceId, revision) === undefined
      ) {
        throw new EvidenceError('EVIDENCE_NOT_FOUND');
      }
    }
  }

  public listClaimIdsForSourceRevisions(sourceRevisionIds: readonly string[]): readonly string[] {
    this.assertSourceRevisionIds(sourceRevisionIds);
    const identities = sourceRevisionIds.map((identity) => {
      const separator = identity.lastIndexOf(':');
      return {
        revision: Number(identity.slice(separator + 1)),
        sourceId: identity.slice(0, separator),
      };
    });
    const claimIds = new Set<string>();
    const statement = this.#database.prepare(
      `SELECT DISTINCT claim_id
       FROM claim_evidence
       WHERE source_id = ? AND source_revision = ?
       ORDER BY claim_id
       LIMIT 256`,
    );
    for (const identity of identities) {
      for (const row of statement.all(identity.sourceId, identity.revision) as unknown as readonly {
        readonly claim_id: string;
      }[]) {
        claimIds.add(row.claim_id);
      }
    }
    return Object.freeze([...claimIds].sort());
  }

  public requestProcessingCancel(runId: string, expectedRevision: number, createdAt: string): void {
    identifier(runId);
    iso(createdAt);
    const changed = this.#database
      .prepare(
        `UPDATE source_processing_runs
         SET status = 'CANCEL_REQUESTED', revision = revision + 1, updated_at = ?
         WHERE id = ? AND status IN ('CONFIRMED', 'RUNNING', 'PAUSED') AND revision = ?`,
      )
      .run(createdAt, runId, expectedRevision);
    if (changed.changes !== 1) throw new EvidenceError('EVIDENCE_STALE_REVISION', true);
    this.#audit(
      'PROCESSING_CANCELLED',
      'PROCESSING_RUN',
      runId,
      {
        expectedRevision,
      },
      createdAt,
    );
  }

  public getSummary(limit = 50, offset = 0): EvidenceSummaryViewV1 {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 1_000_000
    ) {
      throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
    }
    const sources = this.#database
      .prepare(
        `WITH latest_revision AS (
           SELECT source_id, max(revision) AS revision
           FROM source_revisions GROUP BY source_id
         ), latest_classification AS (
           SELECT classification.source_id, classification.source_revision,
                  max(classification.classification_revision) AS classification_revision
           FROM source_classifications AS classification
           GROUP BY classification.source_id, classification.source_revision
         )
         SELECT source.id AS source_id, source.title, revision.revision,
                revision.origin_kind, revision.language, revision.availability,
                classification.authority_tier, classification.use_class,
                classification.independence_state, classification.lineage_group
         FROM latest_revision AS latest
         JOIN source_revisions AS revision
           ON revision.source_id = latest.source_id AND revision.revision = latest.revision
         JOIN sources AS source ON source.id = revision.source_id
         JOIN latest_classification AS latest_class
           ON latest_class.source_id = revision.source_id
          AND latest_class.source_revision = revision.revision
         JOIN source_classifications AS classification
           ON classification.source_id = latest_class.source_id
          AND classification.source_revision = latest_class.source_revision
          AND classification.classification_revision = latest_class.classification_revision
         ORDER BY revision.created_at DESC, source.id
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as readonly Row[];
    const inbox = this.#database
      .prepare(
        `SELECT 'FETCH_DOCUMENT' AS origin_kind, document.id AS origin_record_id,
                'FetchDocument ' || document.id AS title,
                'NOT_CLASSIFIED' AS suggested_use
         FROM fetched_documents AS document
         WHERE NOT EXISTS (
           SELECT 1 FROM source_revisions AS revision
           WHERE revision.origin_kind = 'FETCH_DOCUMENT'
             AND revision.origin_record_id = document.id
         )
         UNION ALL
         SELECT 'BROWSER_CLIP', clip.id,
                COALESCE(NULLIF(trim(clip.page_title), ''), 'BrowserClip ' || clip.id),
                'CONTEXT_ONLY'
         FROM clips AS clip
         WHERE clip.capture_source = 'BROWSER_EXTENSION'
           AND NOT EXISTS (
             SELECT 1 FROM source_revisions AS revision
             WHERE revision.origin_kind = 'BROWSER_CLIP'
               AND revision.origin_record_id = clip.id
           )
         ORDER BY origin_kind, origin_record_id
         LIMIT 100`,
      )
      .all() as readonly Row[];
    const claimRows = this.#database
      .prepare(
        `SELECT claim.id AS claim_id, claim.subject_type, claim.subject_id,
                claim.predicate, claim.value_json,
                COALESCE((
                  SELECT evaluation.status
                  FROM fact_evaluations AS evaluation
                  WHERE evaluation.claim_id = claim.id
                  ORDER BY evaluation.created_at DESC, evaluation.id DESC
                  LIMIT 1
                ), 'NOT_EVALUATED') AS evaluation_status
         FROM claims AS claim
         WHERE claim.contract_version = 'atomic-claim-v1'
         ORDER BY claim.created_at DESC, claim.id
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as readonly Row[];
    const claims = claimRows.map((row) => {
      const evidence = this.#database
        .prepare(
          `SELECT id, source_id, source_revision, excerpt, language,
                  supports_or_contradicts, summary_zh
           FROM claim_evidence
           WHERE claim_id = ? AND locator_validated = 1
           ORDER BY created_at, id
           LIMIT 64`,
        )
        .all(row.claim_id as string) as readonly Row[];
      return Object.freeze({
        claimId: row.claim_id as string,
        evaluationStatus: row.evaluation_status as FactEvaluationStatus,
        evidence: Object.freeze(
          evidence.map((item) =>
            Object.freeze({
              evidenceId: item.id as string,
              excerpt: item.excerpt as string,
              language: item.language as string,
              relation: item.supports_or_contradicts as string,
              sourceId: item.source_id as string,
              sourceRevision: item.source_revision as number,
              summaryZh: item.summary_zh as string | null,
            }),
          ),
        ),
        predicate: row.predicate as string,
        subjectId: row.subject_id as string,
        subjectType: row.subject_type as FactSubjectType,
        value: JSON.parse(row.value_json as string) as unknown,
      });
    });
    const conflicts = this.#database
      .prepare(
        `SELECT id, claim_left_id, claim_right_id, state, revision
         FROM fact_conflicts
         ORDER BY updated_at DESC, id
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as readonly Row[];
    const runs = this.#database
      .prepare(
        `SELECT id, status, current_step, external_request_count, cost_state, revision
         FROM source_processing_runs
         ORDER BY updated_at DESC, id
         LIMIT 20`,
      )
      .all() as readonly Row[];
    return Object.freeze({
      claims: Object.freeze(claims),
      conflicts: Object.freeze(conflicts.map((row) => this.#conflictFromRow(row))),
      counts: Object.freeze({
        claims: count(this.#database, 'claims'),
        conflicts: count(this.#database, 'fact_conflicts'),
        evaluations: count(this.#database, 'fact_evaluations'),
        evidence: count(this.#database, 'claim_evidence'),
        sources: count(this.#database, 'sources'),
      }),
      inbox: Object.freeze(
        inbox.map((row) =>
          Object.freeze({
            factStatus: 'NOT_A_FACT' as const,
            originKind: row.origin_kind as 'BROWSER_CLIP' | 'FETCH_DOCUMENT',
            originRecordId: row.origin_record_id as string,
            suggestedUse: row.suggested_use as 'CONTEXT_ONLY' | 'NOT_CLASSIFIED',
            title: row.title as string,
            truthStatus: 'UNVERIFIED' as const,
          }),
        ),
      ),
      processingRuns: Object.freeze(
        runs.map((row) =>
          Object.freeze({
            costState: row.cost_state as string,
            currentStep: row.current_step as string | null,
            externalRequestCount: row.external_request_count as number,
            revision: row.revision as number,
            runId: row.id as string,
            status: row.status as string,
          }),
        ),
      ),
      sources: Object.freeze(
        sources.map((row) =>
          Object.freeze({
            authorityTier: row.authority_tier as SourceAuthorityTier,
            availability: row.availability as SourceAvailabilityState,
            independenceState: row.independence_state as SourceIndependenceState,
            language: row.language as string,
            lineageGroup: row.lineage_group as string | null,
            originKind: row.origin_kind as SourceOriginKind,
            revision: row.revision as number,
            sourceId: row.source_id as string,
            title: row.title as string,
            useClass: row.use_class as SourceUseClass,
          }),
        ),
      ),
    });
  }

  #replayedSourceView(
    input: AddSourceRevisionInputV1 | RegisterSourceInputV1,
    revision: number,
    availability: SourceAvailabilityState,
    classification: SourceClassificationInputV1,
  ): EvidenceSourceViewV1 {
    const row = this.#database
      .prepare(
        `SELECT source.title, revision.origin_kind, revision.origin_record_id,
                revision.origin_revision, revision.content_hash,
                revision.extracted_text_hash, revision.extracted_text_path,
                revision.language, revision.availability, revision.published_at,
                revision.published_at_precision, revision.warnings_json,
                classification.authority_tier, classification.use_class,
                classification.independence_state, classification.lineage_group,
                classification.reason_code, classification.classified_by
         FROM source_revisions AS revision
         JOIN sources AS source ON source.id = revision.source_id
         JOIN source_classifications AS classification
           ON classification.source_id = revision.source_id
          AND classification.source_revision = revision.revision
          AND classification.classification_revision = (
            SELECT max(current.classification_revision)
            FROM source_classifications AS current
            WHERE current.source_id = revision.source_id
              AND current.source_revision = revision.revision
          )
         WHERE revision.source_id = ? AND revision.revision = ?`,
      )
      .get(input.sourceId, revision) as Row | undefined;
    if (
      row === undefined ||
      row.origin_kind !== input.originKind ||
      row.origin_record_id !== input.originRecordId ||
      row.origin_revision !== input.originRevision ||
      row.content_hash !== input.contentHash ||
      row.extracted_text_hash !== input.extractedTextHash ||
      row.extracted_text_path !== input.extractedTextPath ||
      row.language !== input.language ||
      row.availability !== availability ||
      row.published_at !== input.publishedAt ||
      row.published_at_precision !== input.publishedAtPrecision ||
      row.warnings_json !== safeJson(input.warnings, 16_384) ||
      row.authority_tier !== classification.authorityTier ||
      row.use_class !== classification.useClass ||
      row.independence_state !== classification.independenceState ||
      row.lineage_group !== classification.lineageGroup ||
      row.reason_code !== classification.reasonCode ||
      row.classified_by !== classification.classifiedBy
    ) {
      throw new EvidenceError('EVIDENCE_CONFLICT');
    }
    return Object.freeze({
      ...classification,
      availability,
      language: input.language,
      originKind: input.originKind,
      revision,
      sourceId: input.sourceId,
      title: row.title as string,
    });
  }

  #assertContentLineage(contentHash: string, lineageGroup: string | null, sourceId: string): void {
    const row = this.#database
      .prepare(
        `SELECT classification.lineage_group
         FROM source_revisions AS revision
         JOIN source_classifications AS classification
           ON classification.source_id = revision.source_id
          AND classification.source_revision = revision.revision
          AND classification.classification_revision = (
            SELECT max(current.classification_revision)
            FROM source_classifications AS current
            WHERE current.source_id = revision.source_id
              AND current.source_revision = revision.revision
          )
         WHERE revision.content_hash = ? AND revision.source_id <> ?
         ORDER BY revision.source_id, revision.revision
         LIMIT 1`,
      )
      .get(contentHash, sourceId) as { readonly lineage_group: string | null } | undefined;
    if (row !== undefined && row.lineage_group !== lineageGroup) {
      throw new EvidenceError('EVIDENCE_POLICY_BLOCKED');
    }
  }

  #validateSourceInput(input: Omit<RegisterSourceInputV1, never>, validateUrl = true): void {
    identifier(input.sourceId);
    identifier(input.originRecordId);
    boundedText(input.title, 512);
    if (validateUrl) {
      boundedText(input.url, 4_096);
      canonicalUrlIdentity(input.url);
    }
    boundedText(input.language, 32);
    if (input.classification.lineageGroup !== null) {
      boundedText(input.classification.lineageGroup, 128);
    }
    boundedText(input.classification.reasonCode, 128);
    iso(input.retrievedAt);
    if (
      input.publishedAtPrecision === 'UNKNOWN'
        ? input.publishedAt !== null
        : input.publishedAt === null
    ) {
      throw new EvidenceError('EVIDENCE_INVALID_SOURCE');
    }
    if (input.publishedAt !== null) {
      const expectedLength =
        input.publishedAtPrecision === 'YEAR' ? 4 : input.publishedAtPrecision === 'MONTH' ? 7 : 10;
      if (
        input.publishedAt.length !== expectedLength ||
        !/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/u.test(input.publishedAt)
      ) {
        throw new EvidenceError('EVIDENCE_INVALID_SOURCE');
      }
    }
    if (
      input.warnings.length > 32 ||
      input.warnings.some((warning) => warning.trim().length < 1 || warning.length > 500) ||
      (input.classification.independenceState === 'CONFIRMED_INDEPENDENT' &&
        input.classification.lineageGroup === null) ||
      (input.originKind === 'SYNTHETIC_FIXTURE'
        ? input.classification.classifiedBy !== 'SYNTHETIC_FIXTURE'
        : input.classification.classifiedBy !== 'USER')
    ) {
      throw new EvidenceError('EVIDENCE_INVALID_SOURCE');
    }
    if (
      !HASH.test(input.contentHash) ||
      (input.extractedTextHash !== null && !HASH.test(input.extractedTextHash)) ||
      !Number.isSafeInteger(input.originRevision) ||
      input.originRevision < 1 ||
      (input.extractedTextHash === null) !== (input.extractedTextPath === null) ||
      (input.originKind !== 'BROWSER_CLIP' && input.extractedTextHash === null)
    ) {
      throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
    }
    if (
      input.originKind === 'BROWSER_CLIP' &&
      (input.classification.authorityTier !== 'DISCUSSION_CONTEXT' ||
        input.classification.useClass !== 'CONTEXT_ONLY')
    ) {
      throw new EvidenceError('EVIDENCE_POLICY_BLOCKED');
    }
  }

  #controlledOrigin(
    kind: SourceOriginKind,
    originRecordId: string,
  ): {
    readonly contentHash: string;
    readonly extractedTextHash: string | null;
    readonly extractedTextPath: string | null;
    readonly url: string;
  } | null {
    if (kind === 'SYNTHETIC_FIXTURE') return null;
    if (kind === 'FETCH_DOCUMENT') {
      const row = this.#database
        .prepare(
          `SELECT document.final_canonical_url, document.normalized_content_hash,
                  document.extracted_text_hash, document.extracted_text_path
           FROM fetched_documents AS document
           WHERE document.id = ?
             AND EXISTS (
               SELECT 1
               FROM fetch_runs AS run
               WHERE run.document_id = document.id AND run.status = 'SUCCEEDED'
             )`,
        )
        .get(originRecordId) as Row | undefined;
      if (row === undefined) throw new EvidenceError('EVIDENCE_NOT_FOUND');
      return {
        contentHash: row.normalized_content_hash as string,
        extractedTextHash: row.extracted_text_hash as string,
        extractedTextPath: row.extracted_text_path as string,
        url: row.final_canonical_url as string,
      };
    }
    const row = this.#database
      .prepare(
        `SELECT normalized_url, selected_text_hash, screenshot_hash
         FROM clips
         WHERE id = ? AND capture_source = 'BROWSER_EXTENSION'`,
      )
      .get(originRecordId) as Row | undefined;
    if (row === undefined) throw new EvidenceError('EVIDENCE_NOT_FOUND');
    return {
      contentHash: (() => {
        const selectedTextHash = row.selected_text_hash as string | null;
        const screenshotHash = row.screenshot_hash as string | null;
        if (selectedTextHash !== null && screenshotHash !== null) {
          return evidenceSemanticHash({ screenshotHash, selectedTextHash });
        }
        return selectedTextHash ?? screenshotHash ?? evidenceSemanticHash({ originRecordId });
      })(),
      extractedTextHash: null,
      extractedTextPath: null,
      url: row.normalized_url as string,
    };
  }

  #insertSourceRevision(
    input: AddSourceRevisionInputV1,
    classification: SourceClassificationInputV1,
    canonicalUrl: {
      readonly canonicalUrlHash: string;
      readonly displayHost: string;
    },
  ): void {
    this.#database
      .prepare(
        `INSERT INTO source_revisions(
           source_id, revision, contract_version, origin_kind, origin_record_id,
           origin_revision, content_hash, canonical_url_hash, display_host,
           extracted_text_hash, extracted_text_path, language, availability,
           retrieved_at, published_at, published_at_precision, warnings_json,
           provenance_json, synthetic, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sourceId,
        input.revision,
        SOURCE_EVIDENCE_CONTRACT_VERSION,
        input.originKind,
        input.originRecordId,
        input.originRevision,
        input.contentHash,
        canonicalUrl.canonicalUrlHash,
        canonicalUrl.displayHost,
        input.extractedTextHash,
        input.extractedTextPath,
        input.language,
        input.availability,
        input.createdAt,
        input.publishedAt,
        input.publishedAtPrecision,
        safeJson(input.warnings, 16_384),
        safeJson(
          {
            originKind: input.originKind,
            originRecordId: input.originRecordId,
            originRevision: input.originRevision,
          },
          16_384,
        ),
        input.originKind === 'SYNTHETIC_FIXTURE' ? 1 : 0,
        input.createdAt,
        input.createdAt,
      );
    this.#database
      .prepare(
        `INSERT INTO source_classifications(
           source_id, source_revision, classification_revision, authority_tier,
           use_class, independence_state, lineage_group, reason_code,
           classified_by, created_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sourceId,
        input.revision,
        classification.authorityTier,
        classification.useClass,
        classification.independenceState,
        classification.lineageGroup,
        classification.reasonCode,
        classification.classifiedBy,
        input.createdAt,
      );
  }

  #markSourceEvaluationsStale(sourceId: string, createdAt: string): void {
    const claims = this.#database
      .prepare(
        `SELECT DISTINCT claim_id
         FROM claim_evidence
         WHERE source_id = ? AND locator_validated = 1
         ORDER BY claim_id`,
      )
      .all(sourceId) as unknown as readonly { readonly claim_id: string }[];
    for (const claim of claims) {
      const id = `evaluation-${this.#idFactory()}`;
      this.#database
        .prepare(
          `INSERT INTO fact_evaluations(
             id, claim_id, status, policy_version, reason_code,
             qualifying_source_ids_json, source_revision_digest,
             independence_snapshot_json, input_identity_hash, created_at
           ) VALUES (?, ?, 'STALE_REVIEW_REQUIRED', ?, 'STALE_REVISION',
                     '[]', ?, '[]', ?, ?)`,
        )
        .run(
          id,
          claim.claim_id,
          FACT_POLICY_VERSION,
          evidenceSemanticHash([sourceId]),
          evidenceSemanticHash({
            claimId: claim.claim_id,
            createdAt,
            reason: 'STALE_REVISION',
            sourceId,
          }),
          createdAt,
        );
    }
  }

  #claimComparable(claimId: string) {
    const row = this.#database
      .prepare(
        `SELECT claim.id, claim.subject_type, claim.subject_id, claim.predicate,
                claim.value_type, claim.value_json, claim.normalized_scope_hash,
                claim.policy_version, registry.multiple_allowed
         FROM claims AS claim
         JOIN predicate_registry AS registry ON registry.predicate = claim.predicate
         WHERE claim.id = ? AND claim.contract_version = 'atomic-claim-v1'`,
      )
      .get(claimId) as Row | undefined;
    if (row === undefined) throw new EvidenceError('EVIDENCE_NOT_FOUND');
    return {
      claimId: row.id as string,
      multipleAllowed: row.multiple_allowed === 1,
      normalizedScopeHash: row.normalized_scope_hash as string,
      policyVersion: row.policy_version as typeof FACT_POLICY_VERSION,
      predicate: row.predicate as string,
      subjectId: row.subject_id as string,
      subjectType: row.subject_type as string,
      value: JSON.parse(row.value_json as string) as AtomicClaimV1['value'],
      valueType: row.value_type as AtomicClaimV1['valueType'],
    };
  }

  #conflictAffected(conflict: FactConflictViewV1): FactConflictPreviewV1['affected'] {
    const claimIds = Object.freeze([conflict.claimLeftId, conflict.claimRightId].sort());
    const subjects = this.#database
      .prepare(
        `SELECT subject_type, subject_id
         FROM claims
         WHERE id IN (?, ?)
         ORDER BY subject_type, subject_id`,
      )
      .all(conflict.claimLeftId, conflict.claimRightId) as readonly Row[];
    const evidence = this.#database
      .prepare(
        `SELECT id, source_id, source_revision
         FROM claim_evidence
         WHERE claim_id IN (?, ?)
         ORDER BY id`,
      )
      .all(conflict.claimLeftId, conflict.claimRightId) as readonly Row[];
    return Object.freeze({
      claimIds,
      evidenceIds: Object.freeze(evidence.map((row) => row.id as string)),
      sourceRevisionIds: Object.freeze(
        [
          ...new Set(
            evidence.map((row) => `${String(row.source_id)}:${String(row.source_revision)}`),
          ),
        ].sort(),
      ),
      subjects: Object.freeze(
        subjects.map((row) =>
          Object.freeze({
            subjectId: row.subject_id as string,
            subjectType: row.subject_type as FactSubjectType,
          }),
        ),
      ),
    });
  }

  #latestEvaluationStatus(claimId: string): FactEvaluationStatus {
    const row = this.#database
      .prepare(
        `SELECT status
         FROM fact_evaluations
         WHERE claim_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(claimId) as { readonly status: FactEvaluationStatus } | undefined;
    return row?.status ?? 'NOT_EVALUATED';
  }

  #simulatedEvaluationStatus(
    claimId: string,
    nextState: FactConflictState,
    acceptedClaimId: string | null,
  ): FactEvaluationStatus {
    if (ACTIVE_CONFLICT_STATES.has(nextState)) return 'FACT_BLOCKED';
    if (
      nextState === 'RESOLVED_ACCEPT' &&
      acceptedClaimId !== null &&
      acceptedClaimId !== claimId
    ) {
      return 'REJECTED';
    }
    const evidenceRows = this.#evidenceForPolicy(claimId);
    const evaluation = evaluateFactPolicy({
      evidence: evidenceRows.map((item) => ({
        availability: item.availability,
        authorityTier: item.authorityTier,
        independence: item.independence,
        lineageGroup: item.lineageGroup,
        locatorValid: item.locatorValid,
        relation: item.relation,
        sourceId: item.sourceId,
        sourceRevision: item.sourceRevision,
        useClass: item.useClass,
      })),
      policyVersion: FACT_POLICY_VERSION,
      stale: evidenceRows.some((item) => item.stale),
      unresolvedMaterialConflict: false,
    });
    if (
      evaluation.status !== 'REJECTED' &&
      evidenceRows.some((item) => item.relation === 'CONTRADICTS' && item.locatorValid)
    ) {
      return 'CONFLICTED';
    }
    return evaluation.status;
  }

  #openConflict(leftId: string, rightId: string, baseKey: string, createdAt: string): void {
    const ordered = [leftId, rightId].sort();
    const claimLeftId = ordered[0];
    const claimRightId = ordered[1];
    if (claimLeftId === undefined || claimRightId === undefined) {
      throw new EvidenceError('EVIDENCE_CONFLICT');
    }
    const conflictKey = evidenceSemanticHash({ baseKey, claimLeftId, claimRightId });
    const existing = this.#database
      .prepare('SELECT id, state FROM fact_conflicts WHERE conflict_key = ?')
      .get(conflictKey) as { readonly id: string; readonly state: FactConflictState } | undefined;
    if (existing !== undefined) return;
    const conflictId = `conflict-${this.#idFactory()}`;
    this.#database
      .prepare(
        `INSERT INTO fact_conflicts(
           id, conflict_key, claim_left_id, claim_right_id, state,
           material, policy_version, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'FACT_BLOCKED', 1, ?, 1, ?, ?)`,
      )
      .run(
        conflictId,
        conflictKey,
        claimLeftId,
        claimRightId,
        FACT_POLICY_VERSION,
        createdAt,
        createdAt,
      );
    this.#audit(
      'CONFLICT_OPENED',
      'CONFLICT',
      conflictId,
      {
        claimLeftId,
        claimRightId,
      },
      createdAt,
    );
  }

  #hasUnresolvedConflict(claimId: string): boolean {
    const row = this.#database
      .prepare(
        `SELECT count(*) AS count
         FROM fact_conflicts
         WHERE (claim_left_id = ? OR claim_right_id = ?)
           AND state IN ('OPEN', 'FACT_BLOCKED', 'REOPENED')`,
      )
      .get(claimId, claimId) as { readonly count: number };
    return row.count > 0;
  }

  #conflictSnapshot(claimId: string): {
    readonly digest: string;
    readonly rejectedByAcceptedDecision: boolean;
  } {
    const rows = this.#database
      .prepare(
        `SELECT conflict.id, conflict.state, conflict.revision,
                decision.action, decision.accepted_claim_id
         FROM fact_conflicts AS conflict
         LEFT JOIN fact_conflict_decisions AS decision
           ON decision.id = (
             SELECT latest.id
             FROM fact_conflict_decisions AS latest
             WHERE latest.conflict_id = conflict.id
             ORDER BY latest.created_at DESC, latest.id DESC
             LIMIT 1
           )
         WHERE conflict.claim_left_id = ? OR conflict.claim_right_id = ?
         ORDER BY conflict.id`,
      )
      .all(claimId, claimId) as readonly Row[];
    return Object.freeze({
      digest: evidenceSemanticHash(
        rows.map((row) => ({
          acceptedClaimId: row.accepted_claim_id,
          action: row.action,
          conflictId: row.id,
          revision: row.revision,
          state: row.state,
        })),
      ),
      rejectedByAcceptedDecision: rows.some(
        (row) =>
          row.state === 'RESOLVED_ACCEPT' &&
          row.action === 'ACCEPT_CLAIM' &&
          row.accepted_claim_id !== claimId,
      ),
    });
  }

  #evidenceForPolicy(claimId: string): readonly {
    readonly authorityTier: SourceAuthorityTier;
    readonly availability: SourceAvailabilityState;
    readonly independence: SourceIndependenceState;
    readonly lineageGroup: string | null;
    readonly locatorValid: boolean;
    readonly relation: EvidenceRelation;
    readonly sourceId: string;
    readonly sourceRevision: number;
    readonly stale: boolean;
    readonly useClass: SourceUseClass;
  }[] {
    const rows = this.#database
      .prepare(
        `WITH latest_source AS (
           SELECT source_id, max(revision) AS revision
           FROM source_revisions GROUP BY source_id
         ), latest_classification AS (
           SELECT source_id, source_revision, max(classification_revision) AS revision
           FROM source_classifications
           GROUP BY source_id, source_revision
         )
         SELECT evidence.source_id, evidence.source_revision,
                evidence.supports_or_contradicts, evidence.locator_validated,
                revision.availability,
                classification.authority_tier, classification.use_class,
                classification.independence_state, classification.lineage_group,
                CASE WHEN evidence.source_revision = latest_source.revision
                     THEN 0 ELSE 1 END AS stale
         FROM claim_evidence AS evidence
         JOIN source_revisions AS revision
           ON revision.source_id = evidence.source_id
          AND revision.revision = evidence.source_revision
         JOIN latest_source ON latest_source.source_id = evidence.source_id
         JOIN latest_classification
           ON latest_classification.source_id = evidence.source_id
          AND latest_classification.source_revision = evidence.source_revision
         JOIN source_classifications AS classification
           ON classification.source_id = latest_classification.source_id
          AND classification.source_revision = latest_classification.source_revision
          AND classification.classification_revision = latest_classification.revision
         WHERE evidence.claim_id = ?
         ORDER BY evidence.source_id, evidence.source_revision, evidence.id
         LIMIT 64`,
      )
      .all(claimId) as readonly Row[];
    return rows.map((row) => ({
      authorityTier: row.authority_tier as SourceAuthorityTier,
      availability: row.availability as SourceAvailabilityState,
      independence: row.independence_state as SourceIndependenceState,
      lineageGroup: row.lineage_group as string | null,
      locatorValid: row.locator_validated === 1,
      relation: row.supports_or_contradicts as EvidenceRelation,
      sourceId: row.source_id as string,
      sourceRevision: row.source_revision as number,
      stale: row.stale === 1 || row.availability !== 'AVAILABLE',
      useClass: row.use_class as SourceUseClass,
    }));
  }

  #conflict(conflictId: string): FactConflictViewV1 {
    identifier(conflictId);
    const row = this.#database
      .prepare(
        `SELECT id, claim_left_id, claim_right_id, state, revision
         FROM fact_conflicts WHERE id = ?`,
      )
      .get(conflictId) as Row | undefined;
    if (row === undefined) throw new EvidenceError('EVIDENCE_NOT_FOUND');
    return this.#conflictFromRow(row);
  }

  #conflictFromRow(row: Row): FactConflictViewV1 {
    if (!FACT_CONFLICT_STATES.includes(row.state as FactConflictState)) {
      throw new EvidenceError('EVIDENCE_CONFLICT');
    }
    return Object.freeze({
      claimLeftId: row.claim_left_id as string,
      claimRightId: row.claim_right_id as string,
      conflictId: row.id as string,
      revision: row.revision as number,
      state: row.state as FactConflictState,
    });
  }

  #audit(
    eventType: string,
    entityType: string,
    entityId: string,
    details: Readonly<Record<string, unknown>>,
    createdAt: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO fact_audit_events(
           id, event_type, entity_type, entity_id, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `audit-${this.#idFactory()}`,
        eventType,
        entityType,
        entityId,
        safeJson(details),
        createdAt,
      );
  }
}
