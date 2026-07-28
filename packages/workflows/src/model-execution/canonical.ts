import { createHash } from 'node:crypto';

import { CANONICALIZATION_VERSION } from './types.js';

export const CANONICAL_LIMITS = Object.freeze({
  maxArrayItems: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxNodes: 50_000,
  maxObjectKeys: 10_000,
  maxStringBytes: 1024 * 1024,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class CanonicalizationError extends TypeError {
  public readonly code:
    'CANONICAL_CYCLE' | 'CANONICAL_LIMIT' | 'CANONICAL_UNSAFE_KEY' | 'CANONICAL_UNSUPPORTED';

  public constructor(code: CanonicalizationError['code']) {
    super(code);
    this.name = 'CanonicalizationError';
    this.code = code;
  }
}

interface WalkState {
  readonly ancestors: Set<object>;
  nodes: number;
}

function checkedString(value: string): string {
  if (Buffer.byteLength(value, 'utf8') > CANONICAL_LIMITS.maxStringBytes) {
    throw new CanonicalizationError('CANONICAL_LIMIT');
  }
  return JSON.stringify(value);
}

function walk(value: unknown, depth: number, state: WalkState): string {
  state.nodes += 1;
  if (depth > CANONICAL_LIMITS.maxDepth || state.nodes > CANONICAL_LIMITS.maxNodes) {
    throw new CanonicalizationError('CANONICAL_LIMIT');
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return checkedString(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new CanonicalizationError('CANONICAL_UNSUPPORTED');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new CanonicalizationError('CANONICAL_UNSUPPORTED');
  }
  if (state.ancestors.has(value)) {
    throw new CanonicalizationError('CANONICAL_CYCLE');
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > CANONICAL_LIMITS.maxArrayItems) {
        throw new CanonicalizationError('CANONICAL_LIMIT');
      }
      return `[${value.map((item) => walk(item, depth + 1, state)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalizationError('CANONICAL_UNSUPPORTED');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length > CANONICAL_LIMITS.maxObjectKeys) {
      throw new CanonicalizationError('CANONICAL_LIMIT');
    }
    return `{${keys
      .map((key) => {
        if (FORBIDDEN_KEYS.has(key)) {
          throw new CanonicalizationError('CANONICAL_UNSAFE_KEY');
        }
        return `${checkedString(key)}:${walk(record[key], depth + 1, state)}`;
      })
      .join(',')}}`;
  } finally {
    state.ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  const json = walk(value, 0, { ancestors: new Set(), nodes: 0 });
  if (Buffer.byteLength(json, 'utf8') > CANONICAL_LIMITS.maxBytes) {
    throw new CanonicalizationError('CANONICAL_LIMIT');
  }
  return json;
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalBytes(value)).digest('hex');
}

export function versionedCanonicalSha256(value: unknown): string {
  return createHash('sha256')
    .update(CANONICALIZATION_VERSION, 'utf8')
    .update('\n', 'utf8')
    .update(canonicalBytes(value))
    .digest('hex');
}
