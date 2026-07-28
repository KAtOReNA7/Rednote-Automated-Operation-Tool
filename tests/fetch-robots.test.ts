import { describe, expect, it } from 'vitest';

import {
  FETCH_USER_AGENT,
  assertRobotsDecisionAllows,
  createRobotsStatusDecision,
  evaluateRobotsText,
} from '../packages/fetch/src/index.js';
import { FETCH_EXPIRY, FETCH_NOW } from './fetch-fixtures.js';

const base = {
  checkedAt: FETCH_NOW,
  expiresAt: FETCH_EXPIRY,
  origin: 'https://news.example.test',
  userAgent: FETCH_USER_AGENT,
} as const;

describe('conservative RFC 9309 robots subset', () => {
  it('uses the most specific agent group and longest allow/disallow match', () => {
    const text = `
User-agent: *
Disallow: /

User-agent: RednoteResearchFetcher
Disallow: /private/*
Allow: /private/public$
Crawl-delay: 3
`;
    const allowed = evaluateRobotsText({
      ...base,
      pathAndQuery: '/private/public',
      text,
    });
    const denied = evaluateRobotsText({
      ...base,
      pathAndQuery: '/private/other',
      text,
    });
    expect(allowed).toMatchObject({ crawlDelayMs: 3_000, result: 'ALLOWED' });
    expect(denied.result).toBe('DISALLOWED');
    expect(() => assertRobotsDecisionAllows(denied)).toThrow('FETCH_ROBOTS_DISALLOWED');
  });

  it('fails closed for unknown status and never stores robots source text', () => {
    const unknown = createRobotsStatusDecision({ ...base, result: 'UNKNOWN' });
    expect(unknown.bodyHash).toBeNull();
    expect(unknown.rules).toEqual([]);
    expect(JSON.stringify(unknown)).not.toContain('User-agent');
    expect(() => assertRobotsDecisionAllows(unknown)).toThrow('FETCH_ROBOTS_UNKNOWN');
  });

  it('bounds malformed rules and conflicting crawl delays as unknown', () => {
    expect(() =>
      evaluateRobotsText({
        ...base,
        pathAndQuery: '/article',
        text: `User-agent: RednoteResearchFetcher
Crawl-delay: 1
Crawl-delay: 2
Allow: /
`,
      }),
    ).toThrow('FETCH_ROBOTS_UNKNOWN');
  });
});
