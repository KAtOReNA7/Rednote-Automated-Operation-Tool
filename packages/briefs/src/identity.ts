import { createHash } from 'node:crypto';

import { BriefError } from './errors.js';

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new BriefError('BRIEF_INVALID_CONTRACT');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BriefError('BRIEF_INVALID_CONTRACT');
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  throw new BriefError('BRIEF_INVALID_CONTRACT');
}

export function canonicalBriefJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function briefSemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalBriefJson(value), 'utf8').digest('hex');
}
