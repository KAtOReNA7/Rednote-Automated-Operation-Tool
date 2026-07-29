import {
  ATOMIC_CLAIM_CONTRACT_VERSION,
  ATOMIC_CLAIM_STATUSES,
  CLAIM_VALUE_TYPES,
  DATE_PRECISIONS,
  EVIDENCE_LIMITS,
  EVIDENCE_LOCATOR_VERSION,
  EVIDENCE_RECORD_CONTRACT_VERSION,
  EVIDENCE_RELATIONS,
  FACT_POLICY_VERSION,
  FACT_SUBJECT_TYPES,
  SOURCE_AUTHORITY_TIERS,
  SOURCE_AVAILABILITY_STATES,
  SOURCE_EVIDENCE_CONTRACT_VERSION,
  SOURCE_INDEPENDENCE_STATES,
  SOURCE_ORIGIN_KINDS,
  SOURCE_PROCESSING_PLAN_VERSION,
  SOURCE_PROCESSING_STEPS,
  SOURCE_USE_CLASSES,
  type AtomicClaimStatus,
  type ClaimValueType,
  type DatePrecision,
  type EvidenceRelation,
  type FactSubjectType,
  type SourceAuthorityTier,
  type SourceAvailabilityState,
  type SourceIndependenceState,
  type SourceOriginKind,
  type SourceProcessingStep,
  type SourceUseClass,
} from './constants.js';
import { EvidenceError } from './errors.js';
import { canonicalEvidenceJson, evidenceSemanticHash, textSha256 } from './identity.js';

export interface FactSubjectRefV1 {
  readonly id: string;
  readonly type: FactSubjectType;
}

export interface EntityRefValueV1 {
  readonly entityId: string;
  readonly entityType: FactSubjectType;
}

export interface DateWithPrecisionValueV1 {
  readonly precision: DatePrecision;
  readonly value: string;
}

export type AtomicClaimValueV1 =
  boolean | DateWithPrecisionValueV1 | EntityRefValueV1 | number | string;

export interface AtomicClaimScopeV1 {
  readonly format: string | null;
  readonly language: string | null;
  readonly territory: string | null;
  readonly validFrom: DateWithPrecisionValueV1 | null;
  readonly validTo: DateWithPrecisionValueV1 | null;
}

export interface AtomicClaimantV1 {
  readonly sourceId: string;
  readonly sourceRevision: number;
}

export interface AtomicClaimProvenanceV1 {
  readonly kind: 'MANUAL' | 'MODEL_CANDIDATE';
  readonly runId: string | null;
}

export interface AtomicClaimV1 {
  readonly claimId: string;
  readonly claimant: AtomicClaimantV1 | null;
  readonly contractVersion: typeof ATOMIC_CLAIM_CONTRACT_VERSION;
  readonly createdAt: string;
  readonly keyFact: boolean;
  readonly predicate: string;
  readonly predicateVersion: number;
  readonly provenance: AtomicClaimProvenanceV1;
  readonly revision: number;
  readonly scope: AtomicClaimScopeV1;
  readonly semanticFingerprint: string;
  readonly status: AtomicClaimStatus;
  readonly subject: FactSubjectRefV1;
  readonly value: AtomicClaimValueV1;
  readonly valueType: ClaimValueType;
}

export interface SourceProvenanceV1 {
  readonly originKind: SourceOriginKind;
  readonly originRecordId: string;
  readonly originRevision: number;
}

export interface SourceV1 {
  readonly authorityKind: SourceAuthorityTier;
  readonly canonicalUrlHash: string;
  readonly contractVersion: typeof SOURCE_EVIDENCE_CONTRACT_VERSION;
  readonly createdAt: string;
  readonly currentRevisionId: string;
  readonly displayHost: string;
  readonly independenceGroup: string | null;
  readonly independenceState: SourceIndependenceState;
  readonly language: string;
  readonly originKind: SourceOriginKind;
  readonly originRecordId: string;
  readonly publishedAt: string | null;
  readonly publishedAtPrecision: DatePrecision | 'UNKNOWN';
  readonly publisherOrSite: string | null;
  readonly provenance: SourceProvenanceV1;
  readonly retrievedAt: string;
  readonly revision: number;
  readonly sourceId: string;
  readonly status: SourceAvailabilityState;
  readonly title: string;
  readonly updatedAt: string;
  readonly usePolicy: SourceUseClass;
  readonly warnings: readonly string[];
}

export interface SourceRevisionV1 {
  readonly availability: SourceAvailabilityState;
  readonly contentHash: string;
  readonly contractVersion: typeof SOURCE_EVIDENCE_CONTRACT_VERSION;
  readonly createdAt: string;
  readonly extractedTextHash: string | null;
  readonly extractedTextPath: string | null;
  readonly language: string;
  readonly originKind: SourceOriginKind;
  readonly originRecordId: string;
  readonly originRevision: number;
  readonly provenance: SourceProvenanceV1;
  readonly publishedAt: string | null;
  readonly publishedAtPrecision: DatePrecision | 'UNKNOWN';
  readonly retrievedAt: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly sourceId: string;
  readonly warnings: readonly string[];
}

export interface EvidenceLocatorV1 {
  readonly endCodePoint: number;
  readonly extractedTextHash: string;
  readonly kind: 'CHAR_RANGE';
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly startCodePoint: number;
  readonly version: typeof EVIDENCE_LOCATOR_VERSION;
}

export interface EvidenceSummaryV1 {
  readonly excerptHash: string;
  readonly locatorHash: string;
  readonly method: 'MANUAL' | 'MODEL_CANDIDATE';
  readonly modelExecutionId: string | null;
  readonly textZh: string;
}

export interface ClaimEvidenceV1 {
  readonly claimId: string;
  readonly contractVersion: typeof EVIDENCE_RECORD_CONTRACT_VERSION;
  readonly createdAt: string;
  readonly evidenceId: string;
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly locator: EvidenceLocatorV1;
  readonly relation: EvidenceRelation;
  readonly revision: number;
  readonly sourceContentHash: string;
  readonly sourceLanguage: string;
  readonly sourceRevisionId: string;
  readonly summary: EvidenceSummaryV1 | null;
  readonly verificationStatus: 'PENDING' | 'REJECTED' | 'STALE' | 'VALIDATED';
}

export interface SourceProcessingLimitsV1 {
  readonly maxClaims: number;
  readonly maxConcurrency: number;
  readonly maxEvidencePerClaim: number;
  readonly maxFragmentBytes: number;
  readonly maxRuntimeMs: number;
}

export interface SourceProcessingPlanV1 {
  readonly contractVersion: typeof SOURCE_PROCESSING_PLAN_VERSION;
  readonly createdAt: string;
  readonly estimatedExternalRequests: number;
  readonly estimatedFee: 'UNKNOWN';
  readonly estimatedLocalWrites: number;
  readonly expiresAt: string;
  readonly limits: SourceProcessingLimitsV1;
  readonly planHash: string;
  readonly planId: string;
  readonly sourceRevisionIds: readonly string[];
  readonly steps: readonly SourceProcessingStep[];
}

export interface SourceProcessingJobPayloadV1 {
  readonly executionId: string;
  readonly planHash: string;
  readonly planId: string;
  readonly runId: string;
  readonly sourceRevisionIds: readonly string[];
  readonly step: SourceProcessingStep;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}

function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= EVIDENCE_LIMITS.identifierCharacters &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  );
}

function iso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
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

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !hasForbiddenControl(value)
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function managedRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 1_024 &&
    value.startsWith('sources/snapshots/') &&
    !value.includes('..') &&
    !value.includes('\\') &&
    !value.includes(':') &&
    !value.startsWith('/')
  );
}

function validWarnings(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every((warning) => boundedString(warning, 500))
  );
}

function depthWithin(value: unknown, depth = 0): boolean {
  if (depth >= EVIDENCE_LIMITS.maximumDepth && (Array.isArray(value) || plainObject(value))) {
    return false;
  }
  if (Array.isArray(value)) return value.every((child) => depthWithin(child, depth + 1));
  if (plainObject(value))
    return Object.values(value).every((child) => depthWithin(child, depth + 1));
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function validDateValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(?<year>\d{4})(?:-(?<month>0[1-9]|1[0-2])(?:-(?<day>0[1-9]|[12]\d|3[01]))?)?$/u.exec(value);
  if (!match?.groups?.month || !match.groups.day) return match !== null;

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysInMonth !== undefined && day <= daysInMonth;
}

function validDateWithPrecision(value: unknown): value is DateWithPrecisionValueV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, ['precision', 'value']) ||
    !DATE_PRECISIONS.includes(value.precision as DatePrecision) ||
    !validDateValue(value.value)
  ) {
    return false;
  }
  const expectedLength = value.precision === 'YEAR' ? 4 : value.precision === 'MONTH' ? 7 : 10;
  return String(value.value).length === expectedLength;
}

function validValue(value: unknown, type: ClaimValueType): boolean {
  if (type === 'TEXT')
    return typeof value === 'string' && value.length >= 1 && value.length <= 8_000;
  if (type === 'DATE') return validDateValue(value);
  if (type === 'DATE_WITH_PRECISION') return validDateWithPrecision(value);
  if (type === 'INTEGER') return Number.isSafeInteger(value);
  if (type === 'DECIMAL_TEXT') {
    return (
      typeof value === 'string' &&
      value.length <= 128 &&
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) &&
      !/[eE]/u.test(value)
    );
  }
  if (type === 'IDENTIFIER') return identifier(value);
  if (type === 'ENUM') {
    return typeof value === 'string' && value.length <= 128 && /^[A-Z][A-Z0-9_]*$/u.test(value);
  }
  if (type === 'BOOLEAN') return typeof value === 'boolean';
  return (
    plainObject(value) &&
    exactKeys(value, ['entityId', 'entityType']) &&
    identifier(value.entityId) &&
    FACT_SUBJECT_TYPES.includes(value.entityType as FactSubjectType)
  );
}

function validAtomicScope(value: unknown): value is AtomicClaimScopeV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, ['format', 'language', 'territory', 'validFrom', 'validTo']) ||
    ![value.format, value.language, value.territory].every(
      (item) => item === null || boundedString(item, 64),
    ) ||
    !(value.validFrom === null || validDateWithPrecision(value.validFrom)) ||
    !(value.validTo === null || validDateWithPrecision(value.validTo))
  ) {
    return false;
  }
  if (value.validFrom !== null && value.validTo !== null) {
    const from = dateIntervalBounds(value.validFrom).start;
    const to = dateIntervalBounds(value.validTo).end;
    if (from > to) return false;
  }
  return true;
}

function dateIntervalBounds(value: DateWithPrecisionValueV1): {
  readonly end: number;
  readonly start: number;
} {
  const [yearText, monthText, dayText] = value.value.split('-');
  const year = Number(yearText);
  const month = monthText === undefined ? 1 : Number(monthText);
  const day = dayText === undefined ? 1 : Number(dayText);
  const start = Date.UTC(year, month - 1, day);
  if (value.precision === 'DAY') return { end: start + 86_400_000 - 1, start };
  if (value.precision === 'MONTH') {
    return { end: Date.UTC(year, month, 1) - 1, start };
  }
  return { end: Date.UTC(year + 1, 0, 1) - 1, start };
}

function validSourceProvenance(value: unknown): value is SourceProvenanceV1 {
  return (
    plainObject(value) &&
    exactKeys(value, ['originKind', 'originRecordId', 'originRevision']) &&
    SOURCE_ORIGIN_KINDS.includes(value.originKind as SourceOriginKind) &&
    identifier(value.originRecordId) &&
    positiveInteger(value.originRevision)
  );
}

function validPublishedAt(value: unknown, precision: unknown): value is string | null {
  if (precision === 'UNKNOWN') return value === null;
  return (
    DATE_PRECISIONS.includes(precision as DatePrecision) &&
    validDateWithPrecision({ precision, value })
  );
}

export function validateSourceV1(value: unknown): SourceV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'authorityKind',
      'canonicalUrlHash',
      'contractVersion',
      'createdAt',
      'currentRevisionId',
      'displayHost',
      'independenceGroup',
      'independenceState',
      'language',
      'originKind',
      'originRecordId',
      'publishedAt',
      'publishedAtPrecision',
      'publisherOrSite',
      'provenance',
      'retrievedAt',
      'revision',
      'sourceId',
      'status',
      'title',
      'updatedAt',
      'usePolicy',
      'warnings',
    ]) ||
    value.contractVersion !== SOURCE_EVIDENCE_CONTRACT_VERSION ||
    !identifier(value.sourceId) ||
    !identifier(value.currentRevisionId) ||
    value.currentRevisionId !== `${String(value.sourceId)}:${String(value.revision)}` ||
    !SOURCE_ORIGIN_KINDS.includes(value.originKind as SourceOriginKind) ||
    !identifier(value.originRecordId) ||
    !hash(value.canonicalUrlHash) ||
    !boundedString(value.displayHost, 253) ||
    !boundedString(value.title, 1_000) ||
    !(value.publisherOrSite === null || boundedString(value.publisherOrSite, 500)) ||
    !boundedString(value.language, 32) ||
    !SOURCE_AUTHORITY_TIERS.includes(value.authorityKind as SourceAuthorityTier) ||
    !SOURCE_USE_CLASSES.includes(value.usePolicy as SourceUseClass) ||
    !SOURCE_INDEPENDENCE_STATES.includes(value.independenceState as SourceIndependenceState) ||
    !(value.independenceGroup === null || identifier(value.independenceGroup)) ||
    !validPublishedAt(value.publishedAt, value.publishedAtPrecision) ||
    !SOURCE_AVAILABILITY_STATES.includes(value.status as SourceAvailabilityState) ||
    !positiveInteger(value.revision) ||
    !iso(value.retrievedAt) ||
    !iso(value.createdAt) ||
    !iso(value.updatedAt) ||
    !validSourceProvenance(value.provenance) ||
    value.provenance.originKind !== value.originKind ||
    value.provenance.originRecordId !== value.originRecordId ||
    !validWarnings(value.warnings)
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_SOURCE');
  }
  return Object.freeze(value) as unknown as SourceV1;
}

export function validateSourceRevisionV1(value: unknown): SourceRevisionV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'availability',
      'contentHash',
      'contractVersion',
      'createdAt',
      'extractedTextHash',
      'extractedTextPath',
      'language',
      'originKind',
      'originRecordId',
      'originRevision',
      'provenance',
      'publishedAt',
      'publishedAtPrecision',
      'retrievedAt',
      'revision',
      'revisionId',
      'sourceId',
      'warnings',
    ]) ||
    value.contractVersion !== SOURCE_EVIDENCE_CONTRACT_VERSION ||
    !identifier(value.sourceId) ||
    !identifier(value.revisionId) ||
    !positiveInteger(value.revision) ||
    value.revisionId !== `${String(value.sourceId)}:${String(value.revision)}` ||
    !SOURCE_ORIGIN_KINDS.includes(value.originKind as SourceOriginKind) ||
    !identifier(value.originRecordId) ||
    !positiveInteger(value.originRevision) ||
    !hash(value.contentHash) ||
    !(
      (value.extractedTextHash === null && value.extractedTextPath === null) ||
      (hash(value.extractedTextHash) && managedRelativePath(value.extractedTextPath))
    ) ||
    (value.originKind !== 'BROWSER_CLIP' && value.extractedTextHash === null) ||
    !boundedString(value.language, 32) ||
    !SOURCE_AVAILABILITY_STATES.includes(value.availability as SourceAvailabilityState) ||
    !validPublishedAt(value.publishedAt, value.publishedAtPrecision) ||
    !iso(value.retrievedAt) ||
    !iso(value.createdAt) ||
    !validSourceProvenance(value.provenance) ||
    value.provenance.originKind !== value.originKind ||
    value.provenance.originRecordId !== value.originRecordId ||
    value.provenance.originRevision !== value.originRevision ||
    !validWarnings(value.warnings)
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_SOURCE');
  }
  return Object.freeze(value) as unknown as SourceRevisionV1;
}

export function atomicClaimSemanticFingerprint(
  value: Pick<
    AtomicClaimV1,
    'predicate' | 'predicateVersion' | 'scope' | 'subject' | 'value' | 'valueType'
  >,
): string {
  return evidenceSemanticHash({
    predicate: value.predicate,
    predicateVersion: value.predicateVersion,
    scope: value.scope,
    subject: value.subject,
    value: value.value,
    valueType: value.valueType,
  });
}

export function validateAtomicClaimV1(value: unknown): AtomicClaimV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'claimId',
      'claimant',
      'contractVersion',
      'createdAt',
      'keyFact',
      'predicate',
      'predicateVersion',
      'provenance',
      'revision',
      'scope',
      'semanticFingerprint',
      'status',
      'subject',
      'value',
      'valueType',
    ]) ||
    value.contractVersion !== ATOMIC_CLAIM_CONTRACT_VERSION ||
    !identifier(value.claimId) ||
    !identifier(value.predicate) ||
    !positiveInteger(value.predicateVersion) ||
    !iso(value.createdAt) ||
    typeof value.keyFact !== 'boolean' ||
    !positiveInteger(value.revision) ||
    !ATOMIC_CLAIM_STATUSES.includes(value.status as AtomicClaimStatus) ||
    !CLAIM_VALUE_TYPES.includes(value.valueType as ClaimValueType) ||
    !plainObject(value.subject) ||
    !exactKeys(value.subject, ['id', 'type']) ||
    !identifier(value.subject.id) ||
    !FACT_SUBJECT_TYPES.includes(value.subject.type as FactSubjectType) ||
    !validAtomicScope(value.scope) ||
    !(
      value.claimant === null ||
      (plainObject(value.claimant) &&
        exactKeys(value.claimant, ['sourceId', 'sourceRevision']) &&
        identifier(value.claimant.sourceId) &&
        positiveInteger(value.claimant.sourceRevision))
    ) ||
    !plainObject(value.provenance) ||
    !exactKeys(value.provenance, ['kind', 'runId']) ||
    !['MANUAL', 'MODEL_CANDIDATE'].includes(String(value.provenance.kind)) ||
    !(
      (value.provenance.kind === 'MANUAL' &&
        (value.provenance.runId === null || identifier(value.provenance.runId))) ||
      (value.provenance.kind === 'MODEL_CANDIDATE' &&
        identifier(value.provenance.runId) &&
        value.claimant !== null &&
        value.status === 'CANDIDATE')
    ) ||
    !hash(value.semanticFingerprint) ||
    !validValue(value.value, value.valueType as ClaimValueType)
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_CLAIM');
  }
  const claim = value as unknown as AtomicClaimV1;
  if (
    Buffer.byteLength(canonicalEvidenceJson(claim), 'utf8') > EVIDENCE_LIMITS.claimBytes ||
    Buffer.byteLength(canonicalEvidenceJson(claim.scope), 'utf8') > EVIDENCE_LIMITS.scopeBytes ||
    atomicClaimSemanticFingerprint(claim) !== claim.semanticFingerprint
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_CLAIM');
  }
  return Object.freeze(claim);
}

export function validateEvidenceLocatorV1(value: unknown): EvidenceLocatorV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'endCodePoint',
      'extractedTextHash',
      'kind',
      'sourceId',
      'sourceRevision',
      'startCodePoint',
      'version',
    ]) ||
    value.version !== EVIDENCE_LOCATOR_VERSION ||
    value.kind !== 'CHAR_RANGE' ||
    !identifier(value.sourceId) ||
    !hash(value.extractedTextHash) ||
    !Number.isSafeInteger(value.sourceRevision) ||
    Number(value.sourceRevision) < 1 ||
    !Number.isSafeInteger(value.startCodePoint) ||
    Number(value.startCodePoint) < 0 ||
    !Number.isSafeInteger(value.endCodePoint) ||
    Number(value.endCodePoint) <= Number(value.startCodePoint) ||
    Number(value.endCodePoint) - Number(value.startCodePoint) > EVIDENCE_LIMITS.locatorCharacters
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
  }
  return Object.freeze(value) as unknown as EvidenceLocatorV1;
}

export function validateEvidenceSummaryV1(
  value: unknown,
  locator: EvidenceLocatorV1,
  excerptHash: string,
): EvidenceSummaryV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, ['excerptHash', 'locatorHash', 'method', 'modelExecutionId', 'textZh']) ||
    value.excerptHash !== excerptHash ||
    value.locatorHash !== evidenceSemanticHash(locator) ||
    !['MANUAL', 'MODEL_CANDIDATE'].includes(String(value.method)) ||
    (value.method === 'MODEL_CANDIDATE'
      ? !identifier(value.modelExecutionId)
      : value.modelExecutionId !== null) ||
    typeof value.textZh !== 'string' ||
    value.textZh.trim().length < 1 ||
    value.textZh.length > EVIDENCE_LIMITS.summaryCharacters
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
  }
  return Object.freeze(value) as unknown as EvidenceSummaryV1;
}

export function validateClaimEvidenceV1(value: unknown): ClaimEvidenceV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'claimId',
      'contractVersion',
      'createdAt',
      'evidenceId',
      'excerpt',
      'excerptHash',
      'locator',
      'relation',
      'revision',
      'sourceContentHash',
      'sourceLanguage',
      'sourceRevisionId',
      'summary',
      'verificationStatus',
    ]) ||
    value.contractVersion !== EVIDENCE_RECORD_CONTRACT_VERSION ||
    !identifier(value.claimId) ||
    !identifier(value.evidenceId) ||
    !iso(value.createdAt) ||
    !EVIDENCE_RELATIONS.includes(value.relation as EvidenceRelation) ||
    !positiveInteger(value.revision) ||
    !hash(value.sourceContentHash) ||
    !boundedString(value.sourceLanguage, 32) ||
    !identifier(value.sourceRevisionId) ||
    typeof value.excerpt !== 'string' ||
    value.excerpt.length < 1 ||
    value.excerpt.length > EVIDENCE_LIMITS.excerptCharacters ||
    textSha256(value.excerpt) !== value.excerptHash ||
    !['PENDING', 'REJECTED', 'STALE', 'VALIDATED'].includes(String(value.verificationStatus))
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
  }
  const locator = validateEvidenceLocatorV1(value.locator);
  if (value.sourceRevisionId !== `${locator.sourceId}:${locator.sourceRevision}`) {
    throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
  }
  if (value.summary !== null) {
    validateEvidenceSummaryV1(value.summary, locator, value.excerptHash as string);
  }
  return Object.freeze(value) as unknown as ClaimEvidenceV1;
}

function validLimits(value: unknown): value is SourceProcessingLimitsV1 {
  return (
    plainObject(value) &&
    exactKeys(value, [
      'maxClaims',
      'maxConcurrency',
      'maxEvidencePerClaim',
      'maxFragmentBytes',
      'maxRuntimeMs',
    ]) &&
    Number.isSafeInteger(value.maxClaims) &&
    Number(value.maxClaims) >= 1 &&
    Number(value.maxClaims) <= EVIDENCE_LIMITS.maximumClaimsPerRun &&
    Number.isSafeInteger(value.maxConcurrency) &&
    Number(value.maxConcurrency) >= 1 &&
    Number(value.maxConcurrency) <= EVIDENCE_LIMITS.maximumConcurrency &&
    Number.isSafeInteger(value.maxEvidencePerClaim) &&
    Number(value.maxEvidencePerClaim) >= 1 &&
    Number(value.maxEvidencePerClaim) <= EVIDENCE_LIMITS.maximumEvidencePerClaim &&
    Number.isSafeInteger(value.maxFragmentBytes) &&
    Number(value.maxFragmentBytes) >= 1 &&
    Number(value.maxFragmentBytes) <= EVIDENCE_LIMITS.maximumFragmentBytes &&
    Number.isSafeInteger(value.maxRuntimeMs) &&
    Number(value.maxRuntimeMs) >= 100 &&
    Number(value.maxRuntimeMs) <= EVIDENCE_LIMITS.maximumRuntimeMs
  );
}

export function sourceProcessingPlanHash(
  value: Omit<SourceProcessingPlanV1, 'planHash'> & { readonly planHash?: string },
): string {
  const withoutHash = { ...value };
  delete withoutHash.planHash;
  return evidenceSemanticHash(withoutHash);
}

export function validateSourceProcessingPlanV1(value: unknown): SourceProcessingPlanV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'contractVersion',
      'createdAt',
      'estimatedExternalRequests',
      'estimatedFee',
      'estimatedLocalWrites',
      'expiresAt',
      'limits',
      'planHash',
      'planId',
      'sourceRevisionIds',
      'steps',
    ]) ||
    value.contractVersion !== SOURCE_PROCESSING_PLAN_VERSION ||
    !identifier(value.planId) ||
    !iso(value.createdAt) ||
    !iso(value.expiresAt) ||
    Date.parse(value.expiresAt as string) <= Date.parse(value.createdAt as string) ||
    value.estimatedFee !== 'UNKNOWN' ||
    !Number.isSafeInteger(value.estimatedExternalRequests) ||
    Number(value.estimatedExternalRequests) < 0 ||
    Number(value.estimatedExternalRequests) > EVIDENCE_LIMITS.maximumSourcesPerPlan * 2 ||
    !Number.isSafeInteger(value.estimatedLocalWrites) ||
    Number(value.estimatedLocalWrites) < 0 ||
    Number(value.estimatedLocalWrites) >
      EVIDENCE_LIMITS.maximumSourcesPerPlan *
        (EVIDENCE_LIMITS.maximumClaimsPerRun * EVIDENCE_LIMITS.maximumEvidencePerClaim + 8) ||
    !validLimits(value.limits) ||
    !Array.isArray(value.sourceRevisionIds) ||
    value.sourceRevisionIds.length < 1 ||
    value.sourceRevisionIds.length > EVIDENCE_LIMITS.maximumSourcesPerPlan ||
    !value.sourceRevisionIds.every(identifier) ||
    new Set(value.sourceRevisionIds).size !== value.sourceRevisionIds.length ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > SOURCE_PROCESSING_STEPS.length ||
    !value.steps.every((step) => SOURCE_PROCESSING_STEPS.includes(step as SourceProcessingStep)) ||
    new Set(value.steps).size !== value.steps.length ||
    !hash(value.planHash)
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_PLAN');
  }
  const plan = value as unknown as SourceProcessingPlanV1;
  const modelSteps = plan.steps.filter((step) => step === 'EXTRACT_CLAIMS' || step === 'SUMMARIZE');
  if (
    plan.estimatedExternalRequests !== modelSteps.length * plan.sourceRevisionIds.length ||
    sourceProcessingPlanHash(plan) !== plan.planHash
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_PLAN');
  }
  return Object.freeze(plan);
}

export function validateSourceProcessingJobPayloadV1(value: unknown): SourceProcessingJobPayloadV1 {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'executionId',
      'planHash',
      'planId',
      'runId',
      'sourceRevisionIds',
      'step',
    ]) ||
    !identifier(value.executionId) ||
    !identifier(value.planId) ||
    !identifier(value.runId) ||
    !hash(value.planHash) ||
    !SOURCE_PROCESSING_STEPS.includes(value.step as SourceProcessingStep) ||
    !Array.isArray(value.sourceRevisionIds) ||
    value.sourceRevisionIds.length < 1 ||
    value.sourceRevisionIds.length > EVIDENCE_LIMITS.maximumSourcesPerPlan ||
    !value.sourceRevisionIds.every(identifier) ||
    new Set(value.sourceRevisionIds).size !== value.sourceRevisionIds.length
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_REQUEST');
  }
  return Object.freeze(value) as unknown as SourceProcessingJobPayloadV1;
}

export function normalizedScopeIdentity(scope: object): {
  readonly json: string;
  readonly hash: string;
} {
  if (!plainObject(scope) || !depthWithin(scope)) {
    throw new EvidenceError('EVIDENCE_INVALID_CLAIM');
  }
  const json = canonicalEvidenceJson(scope);
  if (Buffer.byteLength(json, 'utf8') > EVIDENCE_LIMITS.scopeBytes) {
    throw new EvidenceError('EVIDENCE_INVALID_CLAIM');
  }
  return Object.freeze({ hash: evidenceSemanticHash(scope), json });
}

export function normalizedClaimValue(value: AtomicClaimValueV1, type: ClaimValueType): string {
  if (!validValue(value, type)) throw new EvidenceError('EVIDENCE_INVALID_CLAIM');
  if (type === 'TEXT') return (value as string).normalize('NFKC').trim().toLocaleLowerCase('und');
  if (type === 'ENTITY_REF') {
    const reference = value as EntityRefValueV1;
    return `${reference.entityType}:${reference.entityId}`;
  }
  return canonicalEvidenceJson(value);
}

export function assertFactPolicyVersion(
  value: unknown,
): asserts value is typeof FACT_POLICY_VERSION {
  if (value !== FACT_POLICY_VERSION) throw new EvidenceError('EVIDENCE_POLICY_BLOCKED');
}
