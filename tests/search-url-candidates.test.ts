import { describe, expect, it } from 'vitest';

import {
  ManualUrlAdapter,
  canonicalizeSearchUrl,
  domainAllowed,
  domainMatchesBoundary,
  normalizeSearchCandidates,
  normalizeSearchDomain,
} from '../packages/search/src/index.js';
import { appearance, searchRequest } from './search-fixtures.js';

describe('search URL and candidate normalization', () => {
  it('canonicalizes scheme, IDNA, default ports, dot segments and fragments', () => {
    const result = canonicalizeSearchUrl('HTTPS://例子.测试:443/a/../b?z=2&a=1#fragment');
    expect(result.canonicalUrl).toBe('https://xn--fsqu00a.xn--0zwm56d/b?z=2&a=1');
    expect(result.domain).toBe('xn--fsqu00a.xn--0zwm56d');
    expect(result.urlHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    'file:///C:/secret.txt',
    'javascript:alert(1)',
    'https://user:pass@example.com/',
    'https://example.com/%zz',
    ' C:\\windows\\system32 ',
    '\\\\server\\share',
    'https://example.com/a b',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => canonicalizeSearchUrl(url)).toThrowError('SEARCH_URL_INVALID');
  });

  it('keeps query order/tracking parameters and does not upgrade HTTP', () => {
    expect(canonicalizeSearchUrl('http://example.com/?utm_source=x&b=2&a=1').canonicalUrl).toBe(
      'http://example.com/?utm_source=x&b=2&a=1',
    );
  });

  it('normalizes host-only domain rules with label boundaries and blocked priority', () => {
    expect(normalizeSearchDomain('例子.测试.')).toBe('xn--fsqu00a.xn--0zwm56d');
    expect(domainMatchesBoundary('news.example.com', 'example.com')).toBe(true);
    expect(domainMatchesBoundary('badexample.com', 'example.com')).toBe(false);
    expect(domainAllowed('news.example.com', ['example.com'], ['news.example.com'])).toBe(false);
  });

  it('deduplicates only canonical URLs and preserves all provenance appearances', () => {
    const descriptor = new ManualUrlAdapter().describe();
    const result = normalizeSearchCandidates(
      [
        appearance('https://example.com/a#one'),
        appearance('https://example.com/a#two', {
          citationState: 'CITED',
          sourceMetadataKind: 'URL_CITATION',
          upstreamId: 'fixture-2',
          wasCited: true,
        }),
        appearance('https://example.com/b'),
      ],
      {
        descriptor,
        discoveredAt: '2026-07-28T00:00:00.000Z',
        request: searchRequest({ maxResults: 20 }),
        searchRunId: 'search-run-001',
      },
    );
    expect(result.counts).toEqual({
      accepted: 2,
      duplicates: 1,
      rejected: 0,
      totalAppearances: 3,
    });
    expect(result.candidates[0]?.provenanceAppearances).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      evidenceEligibility: 'LEAD_ONLY',
      factStatus: 'NOT_A_FACT',
      fetchState: 'NOT_FETCHED',
      truthStatus: 'UNVERIFIED',
    });
  });

  it('keeps hostile-looking upstream text as bounded unverified data only', () => {
    const descriptor = new ManualUrlAdapter().describe();
    const result = normalizeSearchCandidates(
      [
        appearance('https://example.com/untrusted', {
          previewKind: 'UPSTREAM_SNIPPET',
          previewText: '=HYPERLINK("javascript:alert(1)")',
          title: '<script>not executable</script>',
        }),
      ],
      {
        descriptor,
        discoveredAt: '2026-07-28T00:00:00.000Z',
        request: searchRequest({ maxResults: 1 }),
        searchRunId: 'hostile-text-run',
      },
    );
    expect(result.candidates[0]).toMatchObject({
      evidenceEligibility: 'LEAD_ONLY',
      previewText: '=HYPERLINK("javascript:alert(1)")',
      title: '<script>not executable</script>',
      truthStatus: 'UNVERIFIED',
    });
  });
});
