import { createHash } from 'node:crypto';

import {
  FETCH_ROBOTS_POLICY_VERSION,
  FETCH_ROBOTS_RESULTS,
  type FetchRobotsResult,
} from './constants.js';
import type { RobotsDecisionV1 } from './contracts.js';
import { FetchError } from './errors.js';

interface RobotsRule {
  readonly allow: boolean;
  readonly pattern: string;
}

interface RobotsGroup {
  readonly agents: string[];
  readonly crawlDelays: number[];
  readonly rules: RobotsRule[];
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}

function patternMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = body
    .split('*')
    .map((part) => escapeRegex(part))
    .join('.*');
  try {
    return new RegExp(`^${expression}${anchored ? '$' : '.*'}`, 'u').test(path);
  } catch {
    throw new FetchError('FETCH_ROBOTS_UNKNOWN');
  }
}

function ruleLength(pattern: string): number {
  return Buffer.byteLength(pattern.replace(/\$$/u, '').replace(/\*/gu, ''), 'utf8');
}

function parseGroups(text: string): RobotsGroup[] {
  if (text.includes('\u0000') || Buffer.byteLength(text, 'utf8') > 256 * 1024) {
    throw new FetchError('FETCH_ROBOTS_UNKNOWN');
  }
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.length > 10_000) throw new FetchError('FETCH_ROBOTS_UNKNOWN');
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const rawLine of lines) {
    const withoutComment = (rawLine.split('#', 1)[0] ?? '').trim();
    if (withoutComment === '') continue;
    const separator = withoutComment.indexOf(':');
    if (separator < 1) throw new FetchError('FETCH_ROBOTS_UNKNOWN');
    const name = withoutComment.slice(0, separator).trim().toLowerCase();
    const value = withoutComment.slice(separator + 1).trim();
    if (name === 'user-agent') {
      if (value.length < 1 || value.length > 128) throw new FetchError('FETCH_ROBOTS_UNKNOWN');
      if (current === null || current.rules.length > 0 || current.crawlDelays.length > 0) {
        current = { agents: [], crawlDelays: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (current === null || current.agents.length === 0) continue;
    if (name === 'allow' || name === 'disallow') {
      if (value.length > 2_048) throw new FetchError('FETCH_ROBOTS_UNKNOWN');
      current.rules.push(Object.freeze({ allow: name === 'allow', pattern: value }));
      if (current.rules.length > 2_000) throw new FetchError('FETCH_ROBOTS_UNKNOWN');
    } else if (name === 'crawl-delay') {
      if (!/^\d+(?:\.\d{1,3})?$/u.test(value)) throw new FetchError('FETCH_ROBOTS_UNKNOWN');
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3_600) {
        throw new FetchError('FETCH_ROBOTS_UNKNOWN');
      }
      current.crawlDelays.push(Math.ceil(seconds * 1_000));
    }
  }
  return groups;
}

function selectGroups(groups: readonly RobotsGroup[], userAgent: string): RobotsGroup[] {
  const product = (userAgent.split(/[\s/]/u, 1)[0] ?? '').toLowerCase();
  let bestLength = -1;
  const selected: RobotsGroup[] = [];
  for (const group of groups) {
    const matching = group.agents.filter(
      (agent) => agent === '*' || (agent.length > 0 && product.includes(agent)),
    );
    if (matching.length === 0) continue;
    const specificity = Math.max(...matching.map((agent) => (agent === '*' ? 0 : agent.length)));
    if (specificity > bestLength) {
      selected.length = 0;
      bestLength = specificity;
    }
    if (specificity === bestLength) selected.push(group);
  }
  return selected;
}

export function evaluateRobotsText(input: {
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly origin: string;
  readonly pathAndQuery: string;
  readonly text: string;
  readonly userAgent: string;
}): RobotsDecisionV1 {
  const groups = parseGroups(input.text);
  const selected = selectGroups(groups, input.userAgent);
  const rules = selected.flatMap((group) => group.rules);
  const delays = [...new Set(selected.flatMap((group) => group.crawlDelays))];
  if (delays.length > 1) throw new FetchError('FETCH_ROBOTS_UNKNOWN');
  const matching = rules.filter((rule) => patternMatches(rule.pattern, input.pathAndQuery));
  matching.sort((left, right) => {
    const lengthDifference = ruleLength(right.pattern) - ruleLength(left.pattern);
    return lengthDifference === 0 ? Number(right.allow) - Number(left.allow) : lengthDifference;
  });
  const firstMatch = matching[0];
  const result: FetchRobotsResult =
    firstMatch === undefined || firstMatch.allow ? 'ALLOWED' : 'DISALLOWED';
  return Object.freeze({
    bodyHash: createHash('sha256').update(input.text, 'utf8').digest('hex'),
    checkedAt: input.checkedAt,
    crawlDelayMs: delays[0] ?? 0,
    expiresAt: input.expiresAt,
    origin: input.origin,
    policyVersion: FETCH_ROBOTS_POLICY_VERSION,
    result,
    rules: Object.freeze(rules.slice(0, 2_000).map((rule) => Object.freeze({ ...rule }))),
    userAgent: input.userAgent,
  });
}

export function createRobotsStatusDecision(input: {
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly origin: string;
  readonly result: FetchRobotsResult;
  readonly userAgent: string;
}): RobotsDecisionV1 {
  if (!FETCH_ROBOTS_RESULTS.includes(input.result)) {
    throw new FetchError('FETCH_ROBOTS_UNKNOWN');
  }
  return Object.freeze({
    bodyHash: null,
    checkedAt: input.checkedAt,
    crawlDelayMs: 0,
    expiresAt: input.expiresAt,
    origin: input.origin,
    policyVersion: FETCH_ROBOTS_POLICY_VERSION,
    result: input.result,
    rules: Object.freeze([]),
    userAgent: input.userAgent,
  });
}

export function assertRobotsDecisionAllows(decision: RobotsDecisionV1): void {
  if (decision.result === 'DISALLOWED') throw new FetchError('FETCH_ROBOTS_DISALLOWED');
  if (decision.result !== 'ALLOWED') throw new FetchError('FETCH_ROBOTS_UNKNOWN');
}
