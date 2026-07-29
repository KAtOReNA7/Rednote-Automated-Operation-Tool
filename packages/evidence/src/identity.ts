import { createHash } from 'node:crypto';

function canonicalize(value: unknown, depth = 0): unknown {
  if (depth > 16) throw new TypeError('Canonical value exceeds maximum depth.');
  if (Array.isArray(value)) return value.map((child) => canonicalize(child, depth + 1));
  if (typeof value === 'object' && value !== null) {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('Canonical value must use plain objects.');
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child, depth + 1)]),
    );
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError('Canonical value contains an unsupported type.');
}

export function canonicalEvidenceJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function evidenceSemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalEvidenceJson(value), 'utf8').digest('hex');
}

export function textSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
