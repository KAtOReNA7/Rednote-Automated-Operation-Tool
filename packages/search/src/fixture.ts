import { SEARCH_FIXTURE_CONTRACT_VERSION, SEARCH_LIMITS } from './constants.js';
import { validateSearchCandidateAppearanceV1 } from './candidates.js';
import { type SearchCandidateAppearanceV1 } from './contracts.js';
import { SearchError } from './errors.js';

export interface SearchFixtureV1 {
  readonly appearances: readonly SearchCandidateAppearanceV1[];
  readonly contractVersion: typeof SEARCH_FIXTURE_CONTRACT_VERSION;
  readonly fixtureId: string;
}

export function validateSearchFixtureV1(value: unknown): SearchFixtureV1 {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'appearances,contractVersion,fixtureId'
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  const fixture = value as unknown as SearchFixtureV1;
  if (
    fixture.contractVersion !== SEARCH_FIXTURE_CONTRACT_VERSION ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(fixture.fixtureId) ||
    !Array.isArray(fixture.appearances) ||
    fixture.appearances.length > SEARCH_LIMITS.maxCandidates
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  return Object.freeze({
    appearances: Object.freeze(fixture.appearances.map(validateSearchCandidateAppearanceV1)),
    contractVersion: SEARCH_FIXTURE_CONTRACT_VERSION,
    fixtureId: fixture.fixtureId,
  });
}
