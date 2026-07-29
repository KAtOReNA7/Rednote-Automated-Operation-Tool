import { createHash } from 'node:crypto';

import { DossierError } from './errors.js';

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new DossierError('DOSSIER_INVALID_CONTRACT');
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
  throw new DossierError('DOSSIER_INVALID_CONTRACT');
}

export function canonicalDossierJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function dossierSemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalDossierJson(value)).digest('hex');
}
