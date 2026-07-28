import { createHash } from 'node:crypto';

export function safeIdentifierReference(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

export function containsSensitiveKey(value: string): boolean {
  return /authorization|credential|password|prompt|raw|secret|token/iu.test(value);
}

export function assertSecretFreeMetadata(
  metadata: Readonly<Record<string, boolean | number | string>>,
): void {
  const entries = Object.entries(metadata);
  if (entries.length > 16) {
    throw new TypeError('Trace metadata contains too many fields.');
  }
  for (const [key, value] of entries) {
    if (
      (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') ||
      !/^[a-z][a-zA-Z0-9]{0,63}$/u.test(key) ||
      containsSensitiveKey(key) ||
      (typeof value === 'string' &&
        (value.length > 160 || /bearer\s|https?:\/\/|file:\/\//iu.test(value))) ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new TypeError('Trace metadata is not secret-free.');
    }
  }
}
