import { createHash } from 'node:crypto';

import { ExperimentError } from './errors.js';

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
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
  throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
}

export function canonicalExperimentJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function experimentSemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalExperimentJson(value)).digest('hex');
}

export function normalizeExperimentText(value: string): string {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0) throw new ExperimentError('EXPERIMENT_INVALID_CONTRACT');
  return normalized;
}
