import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalCatalogJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function catalogSemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalCatalogJson(value), 'utf8').digest('hex');
}
