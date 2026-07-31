import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function canonicalFactMappingJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function factMappingHash(value: unknown): string {
  return createHash('sha256').update(canonicalFactMappingJson(value), 'utf8').digest('hex');
}

export function normalizeDraftText(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/gu, '\n');
}
