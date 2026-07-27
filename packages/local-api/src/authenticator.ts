import { createHash, timingSafeEqual } from 'node:crypto';

import {
  type LocalApiAuthClient,
  type LocalApiClientRepository,
  LocalApiError,
} from './contracts.js';

const BASE64URL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function isRuntimeToken(value: string): boolean {
  if (!BASE64URL_32_BYTE_PATTERN.test(value)) {
    return false;
  }
  try {
    return Buffer.from(value, 'base64url').length === 32;
  } catch {
    return false;
  }
}

export function digestRuntimeToken(value: string): Buffer {
  if (!isRuntimeToken(value)) {
    throw new LocalApiError('LOCAL_API_AUTH_INVALID');
  }
  return createHash('sha256').update(value, 'utf8').digest();
}

export function parseBearerAuthorization(values: readonly string[]): string {
  if (values.length === 0) {
    throw new LocalApiError('LOCAL_API_AUTH_REQUIRED');
  }
  if (values.length !== 1) {
    throw new LocalApiError('LOCAL_API_AUTH_INVALID');
  }
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(values[0] ?? '');
  if (match?.[1] === undefined || !isRuntimeToken(match[1])) {
    throw new LocalApiError('LOCAL_API_AUTH_INVALID');
  }
  return match[1];
}

export class LocalApiAuthenticator {
  readonly #repository: LocalApiClientRepository;

  public constructor(repository: LocalApiClientRepository) {
    this.#repository = repository;
  }

  public authenticate(origin: string, token: string): LocalApiAuthClient {
    const candidate = this.#repository.findActiveClientByOrigin(origin);
    const suppliedDigest = digestRuntimeToken(token);
    const storedDigest = candidate?.tokenDigest ?? Buffer.alloc(32);
    const matched = timingSafeEqual(suppliedDigest, storedDigest);
    if (!matched || candidate === null) {
      throw new LocalApiError('LOCAL_API_AUTH_INVALID');
    }
    return candidate;
  }
}
