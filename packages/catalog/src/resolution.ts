import {
  BIBLIOGRAPHIC_ENTITY_TYPES,
  ENTITY_RESOLUTION_RULE_VERSION,
  type BibliographicEntityType,
  type ResolutionOutcome,
} from './constants.js';

export interface ResolutionComparableV1 {
  readonly contributorAliases: readonly string[];
  readonly entityId: string;
  readonly entityType: BibliographicEntityType;
  readonly identifiers: readonly {
    readonly namespace: string;
    readonly normalizedValue: string;
  }[];
  readonly language: string | null;
  readonly normalizedTitle: string | null;
}

export interface ResolutionFeatureVectorV1 {
  readonly contributorOverlap: number;
  readonly entityTypeCompatible: boolean;
  readonly languageCompatible: boolean;
  readonly strongIdentifierConflicts: number;
  readonly strongIdentifierMatches: number;
  readonly titleEqual: boolean;
}

export interface ResolutionComparisonV1 {
  readonly features: ResolutionFeatureVectorV1;
  readonly leftEntityId: string;
  readonly outcome: ResolutionOutcome;
  readonly rightEntityId: string;
  readonly ruleVersion: typeof ENTITY_RESOLUTION_RULE_VERSION;
}

function identifierMap(
  values: ResolutionComparableV1['identifiers'],
): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  for (const value of values) {
    const entries = map.get(value.namespace) ?? new Set<string>();
    entries.add(value.normalizedValue);
    map.set(value.namespace, entries);
  }
  return map;
}

export function compareBibliographicEntities(
  left: ResolutionComparableV1,
  right: ResolutionComparableV1,
): ResolutionComparisonV1 {
  if (
    !BIBLIOGRAPHIC_ENTITY_TYPES.includes(left.entityType) ||
    !BIBLIOGRAPHIC_ENTITY_TYPES.includes(right.entityType)
  ) {
    throw new TypeError('entity type is invalid');
  }
  const leftIdentifiers = identifierMap(left.identifiers);
  const rightIdentifiers = identifierMap(right.identifiers);
  let strongIdentifierMatches = 0;
  let strongIdentifierConflicts = 0;
  for (const [namespace, values] of leftIdentifiers) {
    const other = rightIdentifiers.get(namespace);
    if (other === undefined) continue;
    const overlap = [...values].filter((value) => other.has(value)).length;
    strongIdentifierMatches += overlap;
    if (overlap === 0) strongIdentifierConflicts += 1;
  }
  const contributorOverlap = new Set(
    left.contributorAliases.filter((alias) => right.contributorAliases.includes(alias)),
  ).size;
  const entityTypeCompatible = left.entityType === right.entityType;
  const languageCompatible =
    left.language === null || right.language === null || left.language === right.language;
  const titleEqual =
    left.normalizedTitle !== null &&
    right.normalizedTitle !== null &&
    left.normalizedTitle === right.normalizedTitle;
  const titleConflict =
    left.normalizedTitle !== null &&
    right.normalizedTitle !== null &&
    left.normalizedTitle !== right.normalizedTitle;

  let outcome: ResolutionOutcome;
  if (!entityTypeCompatible || strongIdentifierConflicts > 0) {
    outcome = 'CONFLICT';
  } else if (
    strongIdentifierMatches > 0 &&
    languageCompatible &&
    !titleConflict &&
    left.entityType === 'EDITION'
  ) {
    outcome = 'EXACT_LINK';
  } else if (strongIdentifierMatches > 0 && (!languageCompatible || titleConflict)) {
    outcome = 'CONFLICT';
  } else if (titleEqual || contributorOverlap > 0) {
    outcome = 'PROBABLE_REVIEW';
  } else if (left.normalizedTitle !== null && right.normalizedTitle !== null && !titleEqual) {
    outcome = 'DISTINCT';
  } else {
    outcome = 'INSUFFICIENT';
  }

  return Object.freeze({
    features: Object.freeze({
      contributorOverlap,
      entityTypeCompatible,
      languageCompatible,
      strongIdentifierConflicts,
      strongIdentifierMatches,
      titleEqual,
    }),
    leftEntityId: left.entityId,
    outcome,
    rightEntityId: right.entityId,
    ruleVersion: ENTITY_RESOLUTION_RULE_VERSION,
  });
}
