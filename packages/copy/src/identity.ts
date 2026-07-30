import { createHash } from 'node:crypto';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

export function canonicalCopyJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function copySemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalCopyJson(value), 'utf8').digest('hex');
}
