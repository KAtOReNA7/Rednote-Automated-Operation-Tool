import { createHash } from 'node:crypto';

import { AuthenticityError } from './errors.js';

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new AuthenticityError('AUTHENTICITY_INVALID_CONTRACT');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new AuthenticityError('AUTHENTICITY_INVALID_CONTRACT');
}

export function canonicalAuthenticityJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function authenticitySemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalAuthenticityJson(value)).digest('hex');
}
