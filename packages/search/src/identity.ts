import { createHash } from 'node:crypto';

import { SearchError } from './errors.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function canonicalize(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (depth > 20) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { reason: 'DEPTH_EXCEEDED' },
    });
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { reason: 'NON_JSON_VALUE' },
    });
  }
  if (ancestors.has(value)) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { reason: 'CIRCULAR_VALUE' },
    });
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalize(item, depth + 1, ancestors));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new SearchError('SEARCH_INVALID_REQUEST', {
        safeDetails: { reason: 'NON_PLAIN_OBJECT' },
      });
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new SearchError('SEARCH_INVALID_REQUEST', {
          safeDetails: { reason: 'FORBIDDEN_OBJECT_KEY' },
        });
      }
      const nested = (value as Record<string, unknown>)[key];
      if (nested === undefined) {
        throw new SearchError('SEARCH_INVALID_REQUEST', {
          safeDetails: { reason: 'UNDEFINED_VALUE' },
        });
      }
      result[key] = canonicalize(nested, depth + 1, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalSearchJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, 0, new Set()));
}

export function searchSemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalSearchJson(value), 'utf8').digest('hex');
}
