import {
  BIBLIOGRAPHIC_OBSERVATION_VERSION,
  BIBLIOGRAPHIC_ORIGIN_KINDS,
  BIBLIOGRAPHY_NORMALIZATION_VERSION,
  CATALOG_LIMITS,
  CONTRIBUTOR_ROLES,
  DISCOVERY_PLAN_VERSION,
  DISCOVERY_PROFILE_VERSION,
  DISCOVERY_PURPOSES,
  ENTITY_RESOLUTION_RULE_VERSION,
  ORGANIZATION_ROLES,
  type BibliographicOriginKind,
  type ContributorRole,
  type DiscoveryPurpose,
  type OrganizationRole,
} from './constants.js';
import { CatalogError } from './errors.js';
import { canonicalCatalogJson, catalogSemanticHash } from './identity.js';

export interface BibliographicTextHintV1 {
  readonly normalized: string;
  readonly raw: string;
}

export interface BibliographicContributorHintV1 {
  readonly name: BibliographicTextHintV1;
  readonly roles: readonly ContributorRole[];
}

export interface BibliographicOrganizationHintV1 {
  readonly name: BibliographicTextHintV1;
  readonly roles: readonly OrganizationRole[];
}

export interface BibliographicIdentifierHintV1 {
  readonly errorCode: 'INVALID_CHECK_DIGIT' | 'INVALID_FORMAT' | null;
  readonly namespace: string;
  readonly normalizedValue: string | null;
  readonly rawValue: string;
  readonly valid: boolean;
}

export interface BibliographicFieldProvenanceV1 {
  readonly algorithmVersion: string;
  readonly field: string;
  readonly inputObservationIds: readonly string[];
  readonly originKind: BibliographicOriginKind;
  readonly originRecordId: string;
}

export interface BibliographicSourceIdentityV1 {
  readonly candidateId: string | null;
  readonly clipId: string | null;
  readonly documentId: string | null;
}

export interface BibliographicObservationV1 {
  readonly contractVersion: typeof BIBLIOGRAPHIC_OBSERVATION_VERSION;
  readonly contributorHints: readonly BibliographicContributorHintV1[];
  readonly displayTitle: BibliographicTextHintV1 | null;
  readonly factStatus: 'NOT_A_FACT';
  readonly fieldProvenance: readonly BibliographicFieldProvenanceV1[];
  readonly formatHint: string | null;
  readonly identifierHints: readonly BibliographicIdentifierHintV1[];
  readonly languageHints: readonly string[];
  readonly normalizationVersion: typeof BIBLIOGRAPHY_NORMALIZATION_VERSION;
  readonly observationId: string;
  readonly observedAt: string;
  readonly organizationHints: readonly BibliographicOrganizationHintV1[];
  readonly originKind: BibliographicOriginKind;
  readonly originRecordId: string;
  readonly originRevision: number;
  readonly originalTitleHint: BibliographicTextHintV1 | null;
  readonly publicationDateHint: string | null;
  readonly publicationYearHint: number | null;
  readonly scriptHints: readonly string[];
  readonly seriesHint: BibliographicTextHintV1 | null;
  readonly sourceIdentity: BibliographicSourceIdentityV1;
  readonly strata: readonly string[];
  readonly truthStatus: 'UNVERIFIED';
  readonly warnings: readonly string[];
  readonly workTypeHint: string | null;
}

export interface DiscoveryStratumV1 {
  readonly allowedOriginKinds: readonly BibliographicOriginKind[];
  readonly gapPolicy: 'ALLOW_EXPLAINED' | 'REQUIRE_PROCESSED';
  readonly label: string;
  readonly priority: number;
  readonly required: boolean;
  readonly stratumId: string;
  readonly targetObservations: number;
}

export interface DiscoveryPortfolioProfileV1 {
  readonly contractVersion: typeof DISCOVERY_PROFILE_VERSION;
  readonly normalizationVersion: typeof BIBLIOGRAPHY_NORMALIZATION_VERSION;
  readonly profileId: string;
  readonly purpose: DiscoveryPurpose;
  readonly resolutionRuleVersion: typeof ENTITY_RESOLUTION_RULE_VERSION;
  readonly revision: number;
  readonly strata: readonly DiscoveryStratumV1[];
  readonly synthetic: boolean;
}

export interface DiscoveryLimitsV1 {
  readonly batchSize: number;
  readonly maxCandidateComparisons: number;
  readonly maxConcurrency: number;
  readonly maxDatabaseWrites: number;
  readonly maxObservations: number;
  readonly maxRuntimeMs: number;
}

export interface DiscoveryInputScopeV1 {
  readonly originKinds: readonly BibliographicOriginKind[];
  readonly originRecordIds: readonly string[];
}

export interface DiscoveryPlanV1 {
  readonly contractVersion: typeof DISCOVERY_PLAN_VERSION;
  readonly createdAt: string;
  readonly estimatedExternalRequests: 0;
  readonly estimatedLocalOperations: number;
  readonly expiresAt: string;
  readonly inputScope: DiscoveryInputScopeV1;
  readonly limits: DiscoveryLimitsV1;
  readonly planHash: string;
  readonly planId: string;
  readonly profile: DiscoveryPortfolioProfileV1;
}

export interface BibliographyJobPayloadV1 {
  readonly executionId: string;
  readonly planHash: string;
  readonly planId: string;
  readonly runId: string;
  readonly versions: {
    readonly normalization: typeof BIBLIOGRAPHY_NORMALIZATION_VERSION;
    readonly resolution: typeof ENTITY_RESOLUTION_RULE_VERSION;
  };
}

export interface BibliographyJobResultV1 {
  readonly counts: {
    readonly editions: number;
    readonly expressions: number;
    readonly observations: number;
    readonly reviewCases: number;
    readonly works: number;
  };
  readonly runId: string;
  readonly stableError: string | null;
  readonly status:
    | 'AWAITING_REVIEW'
    | 'CANCELLED'
    | 'COMPLETED'
    | 'COMPLETED_WITH_GAPS'
    | 'FAILED'
    | 'INTERRUPTED';
}

function isObject(value: unknown): value is Record<string, unknown> {
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

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function boundedString(value: unknown, maximum: number, nullable = false): boolean {
  if (nullable && value === null) return true;
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !containsControlCharacter(value)
  );
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function iso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function uniqueStrings(value: unknown, maximum: number): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => boundedString(item, CATALOG_LIMITS.shortTextCharacters)) &&
    new Set(value).size === value.length
  );
}

function validTextHint(value: unknown, nullable = false): boolean {
  if (nullable && value === null) return true;
  return (
    isObject(value) &&
    exactKeys(value, ['normalized', 'raw']) &&
    boundedString(value.raw, 2_000) &&
    boundedString(value.normalized, 2_000)
  );
}

function validSourceIdentity(value: unknown): boolean {
  return (
    isObject(value) &&
    exactKeys(value, ['candidateId', 'clipId', 'documentId']) &&
    [value.candidateId, value.clipId, value.documentId].every(
      (item) => item === null || identifier(item),
    )
  );
}

function validContributor(value: unknown): boolean {
  return (
    isObject(value) &&
    exactKeys(value, ['name', 'roles']) &&
    validTextHint(value.name) &&
    Array.isArray(value.roles) &&
    value.roles.length >= 1 &&
    value.roles.length <= CONTRIBUTOR_ROLES.length &&
    value.roles.every((role) => CONTRIBUTOR_ROLES.includes(role as ContributorRole)) &&
    new Set(value.roles).size === value.roles.length
  );
}

function validOrganization(value: unknown): boolean {
  return (
    isObject(value) &&
    exactKeys(value, ['name', 'roles']) &&
    validTextHint(value.name) &&
    Array.isArray(value.roles) &&
    value.roles.length >= 1 &&
    value.roles.length <= ORGANIZATION_ROLES.length &&
    value.roles.every((role) => ORGANIZATION_ROLES.includes(role as OrganizationRole)) &&
    new Set(value.roles).size === value.roles.length
  );
}

function validIdentifierHint(value: unknown): boolean {
  if (
    !isObject(value) ||
    !exactKeys(value, ['errorCode', 'namespace', 'normalizedValue', 'rawValue', 'valid']) ||
    !boundedString(value.namespace, 128) ||
    !boundedString(value.rawValue, CATALOG_LIMITS.identifierCharacters) ||
    !['boolean'].includes(typeof value.valid) ||
    ![null, 'INVALID_CHECK_DIGIT', 'INVALID_FORMAT'].includes(value.errorCode as null | string) ||
    !(
      value.normalizedValue === null ||
      boundedString(value.normalizedValue, CATALOG_LIMITS.identifierCharacters)
    )
  ) {
    return false;
  }
  return value.valid === true
    ? value.normalizedValue !== null && value.errorCode === null
    : value.normalizedValue === null && value.errorCode !== null;
}

function validProvenance(value: unknown): boolean {
  return (
    isObject(value) &&
    exactKeys(value, [
      'algorithmVersion',
      'field',
      'inputObservationIds',
      'originKind',
      'originRecordId',
    ]) &&
    boundedString(value.algorithmVersion, 128) &&
    boundedString(value.field, 128) &&
    uniqueStrings(value.inputObservationIds, 32) &&
    BIBLIOGRAPHIC_ORIGIN_KINDS.includes(value.originKind as BibliographicOriginKind) &&
    identifier(value.originRecordId)
  );
}

function depthWithin(value: unknown, depth = 0): boolean {
  if (depth > CATALOG_LIMITS.maximumDepth) return false;
  if (Array.isArray(value)) return value.every((item) => depthWithin(item, depth + 1));
  if (isObject(value)) return Object.values(value).every((item) => depthWithin(item, depth + 1));
  return true;
}

export function validateBibliographicObservationV1(value: unknown): BibliographicObservationV1 {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      'contractVersion',
      'contributorHints',
      'displayTitle',
      'factStatus',
      'fieldProvenance',
      'formatHint',
      'identifierHints',
      'languageHints',
      'normalizationVersion',
      'observationId',
      'observedAt',
      'organizationHints',
      'originKind',
      'originRecordId',
      'originRevision',
      'originalTitleHint',
      'publicationDateHint',
      'publicationYearHint',
      'scriptHints',
      'seriesHint',
      'sourceIdentity',
      'strata',
      'truthStatus',
      'warnings',
      'workTypeHint',
    ]) ||
    value.contractVersion !== BIBLIOGRAPHIC_OBSERVATION_VERSION ||
    value.normalizationVersion !== BIBLIOGRAPHY_NORMALIZATION_VERSION ||
    value.truthStatus !== 'UNVERIFIED' ||
    value.factStatus !== 'NOT_A_FACT' ||
    !identifier(value.observationId) ||
    !identifier(value.originRecordId) ||
    !BIBLIOGRAPHIC_ORIGIN_KINDS.includes(value.originKind as BibliographicOriginKind) ||
    !Number.isSafeInteger(value.originRevision) ||
    Number(value.originRevision) < 1 ||
    !iso(value.observedAt) ||
    !validTextHint(value.displayTitle, true) ||
    !validTextHint(value.originalTitleHint, true) ||
    !validTextHint(value.seriesHint, true) ||
    !boundedString(value.formatHint, 128, true) ||
    !boundedString(value.workTypeHint, 128, true) ||
    !boundedString(value.publicationDateHint, 64, true) ||
    !(
      value.publicationYearHint === null ||
      (Number.isSafeInteger(value.publicationYearHint) &&
        Number(value.publicationYearHint) >= 1 &&
        Number(value.publicationYearHint) <= 9999)
    ) ||
    !uniqueStrings(value.languageHints, 8) ||
    !uniqueStrings(value.scriptHints, 8) ||
    !uniqueStrings(value.strata, CATALOG_LIMITS.strataCount) ||
    !uniqueStrings(value.warnings, CATALOG_LIMITS.warningCount) ||
    !(value.warnings as readonly string[]).every(
      (warning) => warning.length <= CATALOG_LIMITS.warningCharacters,
    ) ||
    !Array.isArray(value.contributorHints) ||
    value.contributorHints.length > 32 ||
    !value.contributorHints.every(validContributor) ||
    !Array.isArray(value.organizationHints) ||
    value.organizationHints.length > 32 ||
    !value.organizationHints.every(validOrganization) ||
    !Array.isArray(value.identifierHints) ||
    value.identifierHints.length > CATALOG_LIMITS.identifierCount ||
    !value.identifierHints.every(validIdentifierHint) ||
    !Array.isArray(value.fieldProvenance) ||
    value.fieldProvenance.length > CATALOG_LIMITS.provenanceCount ||
    !value.fieldProvenance.every(validProvenance) ||
    !validSourceIdentity(value.sourceIdentity) ||
    !depthWithin(value)
  ) {
    throw new CatalogError('CATALOG_INVALID_OBSERVATION');
  }
  const json = canonicalCatalogJson(value);
  if (Buffer.byteLength(json, 'utf8') > CATALOG_LIMITS.observationBytes) {
    throw new CatalogError('CATALOG_INVALID_OBSERVATION');
  }
  return Object.freeze(value) as unknown as BibliographicObservationV1;
}

function validStratum(value: unknown): boolean {
  return (
    isObject(value) &&
    exactKeys(value, [
      'allowedOriginKinds',
      'gapPolicy',
      'label',
      'priority',
      'required',
      'stratumId',
      'targetObservations',
    ]) &&
    identifier(value.stratumId) &&
    boundedString(value.label, 128) &&
    typeof value.required === 'boolean' &&
    Number.isSafeInteger(value.priority) &&
    Number(value.priority) >= 0 &&
    Number(value.priority) <= 1_000 &&
    Number.isSafeInteger(value.targetObservations) &&
    Number(value.targetObservations) >= 0 &&
    Number(value.targetObservations) <= 1_000_000 &&
    ['ALLOW_EXPLAINED', 'REQUIRE_PROCESSED'].includes(String(value.gapPolicy)) &&
    Array.isArray(value.allowedOriginKinds) &&
    value.allowedOriginKinds.length >= 1 &&
    value.allowedOriginKinds.length <= BIBLIOGRAPHIC_ORIGIN_KINDS.length &&
    value.allowedOriginKinds.every((kind) =>
      BIBLIOGRAPHIC_ORIGIN_KINDS.includes(kind as BibliographicOriginKind),
    ) &&
    new Set(value.allowedOriginKinds).size === value.allowedOriginKinds.length
  );
}

export function validateDiscoveryProfileV1(value: unknown): DiscoveryPortfolioProfileV1 {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      'contractVersion',
      'normalizationVersion',
      'profileId',
      'purpose',
      'resolutionRuleVersion',
      'revision',
      'strata',
      'synthetic',
    ]) ||
    value.contractVersion !== DISCOVERY_PROFILE_VERSION ||
    value.normalizationVersion !== BIBLIOGRAPHY_NORMALIZATION_VERSION ||
    value.resolutionRuleVersion !== ENTITY_RESOLUTION_RULE_VERSION ||
    !identifier(value.profileId) ||
    !DISCOVERY_PURPOSES.includes(value.purpose as DiscoveryPurpose) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    typeof value.synthetic !== 'boolean' ||
    !Array.isArray(value.strata) ||
    value.strata.length < 1 ||
    value.strata.length > CATALOG_LIMITS.strataCount ||
    !value.strata.every(validStratum) ||
    new Set(value.strata.map((stratum) => (stratum as DiscoveryStratumV1).stratumId)).size !==
      value.strata.length
  ) {
    throw new CatalogError('CATALOG_INVALID_PLAN');
  }
  return Object.freeze(value) as unknown as DiscoveryPortfolioProfileV1;
}

function validLimits(value: unknown): boolean {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      'batchSize',
      'maxCandidateComparisons',
      'maxConcurrency',
      'maxDatabaseWrites',
      'maxObservations',
      'maxRuntimeMs',
    ])
  ) {
    return false;
  }
  return (
    Number.isSafeInteger(value.batchSize) &&
    Number(value.batchSize) >= 1 &&
    Number(value.batchSize) <= 1_000 &&
    Number.isSafeInteger(value.maxCandidateComparisons) &&
    Number(value.maxCandidateComparisons) >= 0 &&
    Number(value.maxCandidateComparisons) <= 10_000_000 &&
    Number.isSafeInteger(value.maxConcurrency) &&
    Number(value.maxConcurrency) >= 1 &&
    Number(value.maxConcurrency) <= 8 &&
    Number.isSafeInteger(value.maxDatabaseWrites) &&
    Number(value.maxDatabaseWrites) >= 1 &&
    Number(value.maxDatabaseWrites) <= 10_000_000 &&
    Number.isSafeInteger(value.maxObservations) &&
    Number(value.maxObservations) >= 1 &&
    Number(value.maxObservations) <= 1_000_000 &&
    Number.isSafeInteger(value.maxRuntimeMs) &&
    Number(value.maxRuntimeMs) >= 100 &&
    Number(value.maxRuntimeMs) <= 86_400_000
  );
}

export function discoveryPlanHash(
  value: Omit<DiscoveryPlanV1, 'planHash'> & { readonly planHash?: string },
): string {
  const withoutHash = { ...value };
  delete withoutHash.planHash;
  return catalogSemanticHash(withoutHash);
}

export function validateDiscoveryPlanV1(value: unknown): DiscoveryPlanV1 {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      'contractVersion',
      'createdAt',
      'estimatedExternalRequests',
      'estimatedLocalOperations',
      'expiresAt',
      'inputScope',
      'limits',
      'planHash',
      'planId',
      'profile',
    ]) ||
    value.contractVersion !== DISCOVERY_PLAN_VERSION ||
    !identifier(value.planId) ||
    !iso(value.createdAt) ||
    !iso(value.expiresAt) ||
    Date.parse(value.expiresAt as string) <= Date.parse(value.createdAt as string) ||
    value.estimatedExternalRequests !== 0 ||
    !Number.isSafeInteger(value.estimatedLocalOperations) ||
    Number(value.estimatedLocalOperations) < 0 ||
    !validLimits(value.limits) ||
    !isObject(value.inputScope) ||
    !exactKeys(value.inputScope, ['originKinds', 'originRecordIds']) ||
    !Array.isArray(value.inputScope.originKinds) ||
    value.inputScope.originKinds.length < 1 ||
    !value.inputScope.originKinds.every((kind) =>
      BIBLIOGRAPHIC_ORIGIN_KINDS.includes(kind as BibliographicOriginKind),
    ) ||
    new Set(value.inputScope.originKinds).size !== value.inputScope.originKinds.length ||
    !uniqueStrings(value.inputScope.originRecordIds, 10_000) ||
    typeof value.planHash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.planHash)
  ) {
    throw new CatalogError('CATALOG_INVALID_PLAN');
  }
  validateDiscoveryProfileV1(value.profile);
  const validated = value as unknown as DiscoveryPlanV1;
  if (discoveryPlanHash(validated) !== validated.planHash) {
    throw new CatalogError('CATALOG_INVALID_PLAN');
  }
  return Object.freeze(validated);
}

export function validateBibliographyJobPayloadV1(value: unknown): BibliographyJobPayloadV1 {
  if (
    !isObject(value) ||
    !exactKeys(value, ['executionId', 'planHash', 'planId', 'runId', 'versions']) ||
    !identifier(value.executionId) ||
    !identifier(value.planId) ||
    !identifier(value.runId) ||
    typeof value.planHash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.planHash) ||
    !isObject(value.versions) ||
    !exactKeys(value.versions, ['normalization', 'resolution']) ||
    value.versions.normalization !== BIBLIOGRAPHY_NORMALIZATION_VERSION ||
    value.versions.resolution !== ENTITY_RESOLUTION_RULE_VERSION
  ) {
    throw new CatalogError('CATALOG_INVALID_REQUEST');
  }
  return Object.freeze(value) as unknown as BibliographyJobPayloadV1;
}
