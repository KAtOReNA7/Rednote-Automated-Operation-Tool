import { LocalApiError } from './contracts.js';

const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/([a-p]{32})$/u;

export function normalizeExtensionOrigin(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length !== 51 ||
    value.trim() !== value ||
    !EXTENSION_ORIGIN_PATTERN.test(value)
  ) {
    throw new LocalApiError('LOCAL_API_INVALID_ORIGIN');
  }
  return value;
}

export function isExtensionOrigin(value: string): boolean {
  try {
    normalizeExtensionOrigin(value);
    return true;
  } catch {
    return false;
  }
}

export function extensionOriginId(value: string): string {
  const normalized = normalizeExtensionOrigin(value);
  return normalized.slice('chrome-extension://'.length);
}
