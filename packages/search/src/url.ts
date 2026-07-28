import { createHash } from 'node:crypto';

import { SEARCH_LIMITS, SEARCH_URL_NORMALIZATION_VERSION } from './constants.js';
import { SearchError } from './errors.js';

export interface CanonicalSearchUrlV1 {
  readonly canonicalUrl: string;
  readonly displayHost: string;
  readonly domain: string;
  readonly normalizationVersion: typeof SEARCH_URL_NORMALIZATION_VERSION;
  readonly urlHash: string;
}

const INVALID_PERCENT = /%(?![0-9A-Fa-f]{2})/u;
const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/[?.]\/|[\\/]{1,2}(?:[?.][\\/]))/u;

function hasControlOrWhitespace(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 0x20 ||
      (code >= 0x7f && code <= 0xa0) ||
      code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200a) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0x202f ||
      code === 0x205f ||
      code === 0x3000
    );
  });
}

export function canonicalizeSearchUrl(value: string): CanonicalSearchUrlV1 {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > SEARCH_LIMITS.urlCharacters ||
    value !== value.trim() ||
    hasControlOrWhitespace(value) ||
    INVALID_PERCENT.test(value) ||
    WINDOWS_PATH.test(value)
  ) {
    throw new SearchError('SEARCH_URL_INVALID');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new SearchError('SEARCH_URL_INVALID', { cause: error });
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hostname.length === 0
  ) {
    throw new SearchError('SEARCH_URL_INVALID');
  }
  parsed.hash = '';
  const canonicalUrl = parsed.href;
  if (canonicalUrl.length > SEARCH_LIMITS.urlCharacters || hasControlOrWhitespace(canonicalUrl)) {
    throw new SearchError('SEARCH_URL_INVALID');
  }
  const domain = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (domain.length < 1 || domain.length > 253) {
    throw new SearchError('SEARCH_URL_INVALID');
  }
  return Object.freeze({
    canonicalUrl,
    displayHost: domain,
    domain,
    normalizationVersion: SEARCH_URL_NORMALIZATION_VERSION,
    urlHash: createHash('sha256').update(canonicalUrl, 'utf8').digest('hex'),
  });
}

export function normalizeSearchDomain(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 253 ||
    value !== value.trim() ||
    hasControlOrWhitespace(value) ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('@') ||
    value.includes(':') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new SearchError('SEARCH_DOMAIN_INVALID');
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${value.replace(/\.$/u, '')}/`);
  } catch (error) {
    throw new SearchError('SEARCH_DOMAIN_INVALID', { cause: error });
  }
  if (
    parsed.hostname.length === 0 ||
    parsed.port.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new SearchError('SEARCH_DOMAIN_INVALID');
  }
  const domain = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (
    domain.length < 1 ||
    domain.length > 253 ||
    domain.split('.').some((label) => label.length < 1 || label.length > 63)
  ) {
    throw new SearchError('SEARCH_DOMAIN_INVALID');
  }
  return domain;
}

export function domainMatchesBoundary(host: string, rule: string): boolean {
  const normalizedHost = normalizeSearchDomain(host);
  const normalizedRule = normalizeSearchDomain(rule);
  return normalizedHost === normalizedRule || normalizedHost.endsWith(`.${normalizedRule}`);
}

export function domainAllowed(
  host: string,
  allowedDomains: readonly string[],
  blockedDomains: readonly string[],
): boolean {
  const normalizedHost = normalizeSearchDomain(host);
  const normalizedBlocked = blockedDomains.map(normalizeSearchDomain);
  if (normalizedBlocked.some((rule) => domainMatchesBoundary(normalizedHost, rule))) {
    return false;
  }
  const normalizedAllowed = allowedDomains.map(normalizeSearchDomain);
  return (
    normalizedAllowed.length === 0 ||
    normalizedAllowed.some((rule) => domainMatchesBoundary(normalizedHost, rule))
  );
}
