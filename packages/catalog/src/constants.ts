export const BIBLIOGRAPHIC_OBSERVATION_VERSION = 'bibliographic-observation-v1' as const;
export const BIBLIOGRAPHY_NORMALIZATION_VERSION = 'bibliography-normalization-v1' as const;
export const ENTITY_RESOLUTION_RULE_VERSION = 'entity-resolution-v1' as const;
export const DISCOVERY_PROFILE_VERSION = 'discovery-portfolio-profile-v1' as const;
export const DISCOVERY_PLAN_VERSION = 'discovery-plan-v1' as const;
export const DISCOVERY_RUN_VERSION = 'discovery-run-v1' as const;
export const BIBLIOGRAPHY_JOB_TYPE = 'BIBLIOGRAPHY_DISCOVERY_V1' as const;

export const BIBLIOGRAPHIC_ORIGIN_KINDS = Object.freeze([
  'SEARCH_CANDIDATE',
  'FETCH_DOCUMENT',
  'BROWSER_CLIP_CANDIDATE',
  'SYNTHETIC_FIXTURE',
] as const);
export type BibliographicOriginKind = (typeof BIBLIOGRAPHIC_ORIGIN_KINDS)[number];

export const BIBLIOGRAPHIC_ENTITY_TYPES = Object.freeze([
  'WORK',
  'EXPRESSION',
  'EDITION',
  'AGENT',
] as const);
export type BibliographicEntityType = (typeof BIBLIOGRAPHIC_ENTITY_TYPES)[number];

export const RESOLUTION_OUTCOMES = Object.freeze([
  'EXACT_LINK',
  'PROBABLE_REVIEW',
  'DISTINCT',
  'CONFLICT',
  'INSUFFICIENT',
] as const);
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

export const DISCOVERY_PURPOSES = Object.freeze(['PILOT_CONTENT', 'MARKET_MAP', 'CUSTOM'] as const);
export type DiscoveryPurpose = (typeof DISCOVERY_PURPOSES)[number];

export const DISCOVERY_RUN_STATES = Object.freeze([
  'DRAFT',
  'PREVIEWED',
  'CONFIRMED',
  'RUNNING',
  'AWAITING_REVIEW',
  'COMPLETED',
  'COMPLETED_WITH_GAPS',
  'CANCELLED',
  'FAILED',
  'INTERRUPTED',
] as const);
export type DiscoveryRunState = (typeof DISCOVERY_RUN_STATES)[number];

export const CONTRIBUTOR_ROLES = Object.freeze([
  'AUTHOR',
  'COAUTHOR',
  'ORIGINAL_CREATOR',
  'TRANSLATOR',
  'ADAPTER',
  'EDITOR',
] as const);
export type ContributorRole = (typeof CONTRIBUTOR_ROLES)[number];

export const ORGANIZATION_ROLES = Object.freeze([
  'PUBLISHER',
  'IMPRINT',
  'DISTRIBUTOR',
  'PLATFORM',
] as const);
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const PUBLICATION_RELATIONSHIP_ROLES = Object.freeze([
  'RIGHTS_PARTY',
  'LICENSOR',
  'LICENSEE',
  'AGENCY',
] as const);
export type PublicationRelationshipRole = (typeof PUBLICATION_RELATIONSHIP_ROLES)[number];

export const PUBLICATION_RELATIONSHIP_STATES = Object.freeze([
  'OBSERVED_UNVERIFIED',
  'USER_CONFIRMED',
  'EVIDENCE_PENDING',
] as const);
export type PublicationRelationshipState = (typeof PUBLICATION_RELATIONSHIP_STATES)[number];

export const CATALOG_LIMITS = Object.freeze({
  aliasCount: 64,
  arrayCount: 64,
  identifierCount: 32,
  identifierCharacters: 256,
  maximumDepth: 8,
  observationBytes: 128 * 1024,
  originRecordCharacters: 128,
  provenanceCount: 64,
  shortTextCharacters: 512,
  strataCount: 32,
  warningCharacters: 256,
  warningCount: 32,
});
