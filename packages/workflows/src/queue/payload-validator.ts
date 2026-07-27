import { createHash } from 'node:crypto';

import type { JsonValue } from './types.js';

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  'apikey',
  'authorization',
  'password',
  'secret',
  'accesstoken',
  'refreshtoken',
]);

export type PayloadValidationErrorCode =
  'CREDENTIAL_FIELD_FORBIDDEN' | 'INVALID_JSON_VALUE' | 'JSON_DEPTH_EXCEEDED' | 'JSON_TOO_LARGE';

export class JobPayloadValidationError extends Error {
  public readonly code: PayloadValidationErrorCode;

  public constructor(code: PayloadValidationErrorCode, message: string) {
    super(message);
    this.name = 'JobPayloadValidationError';
    this.code = code;
  }
}

export interface ValidatedJson {
  readonly hash: string;
  readonly json: string;
}

export interface JobPayloadValidatorOptions {
  readonly maxBytes?: number;
  readonly maxDepth?: number;
}

function normalizeCredentialKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
}

function canonicalize(
  value: unknown,
  depth: number,
  maxDepth: number,
  ancestors: Set<object>,
  path: string,
): JsonValue {
  if (depth > maxDepth) {
    throw new JobPayloadValidationError(
      'JSON_DEPTH_EXCEEDED',
      `JSON exceeds the maximum depth at ${path}.`,
    );
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new JobPayloadValidationError(
        'INVALID_JSON_VALUE',
        `Non-finite number at ${path} is not JSON.`,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value !== 'object') {
    throw new JobPayloadValidationError('INVALID_JSON_VALUE', `Unsupported value type at ${path}.`);
  }

  if (ancestors.has(value)) {
    throw new JobPayloadValidationError(
      'INVALID_JSON_VALUE',
      `Circular reference at ${path} is not JSON.`,
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        canonicalize(item, depth + 1, maxDepth, ancestors, `${path}[${index}]`),
      );
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new JobPayloadValidationError(
        'INVALID_JSON_VALUE',
        `Only plain objects are accepted at ${path}.`,
      );
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new JobPayloadValidationError(
        'INVALID_JSON_VALUE',
        `Symbol-keyed properties at ${path} are not JSON.`,
      );
    }

    const object = value as Record<string, unknown>;
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(object).sort()) {
      if (FORBIDDEN_CREDENTIAL_KEYS.has(normalizeCredentialKey(key))) {
        throw new JobPayloadValidationError(
          'CREDENTIAL_FIELD_FORBIDDEN',
          `Credential field ${path}.${key} is not allowed in persisted JSON.`,
        );
      }
      result[key] = canonicalize(object[key], depth + 1, maxDepth, ancestors, `${path}.${key}`);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export class JobPayloadValidator {
  readonly #maxBytes: number;
  readonly #maxDepth: number;

  public constructor(options: JobPayloadValidatorOptions = {}) {
    this.#maxBytes = options.maxBytes ?? 65_536;
    this.#maxDepth = options.maxDepth ?? 20;
  }

  public validate(value: unknown): ValidatedJson {
    const canonical = canonicalize(value, 0, this.#maxDepth, new Set(), '$');
    const json = JSON.stringify(canonical);
    const bytes = Buffer.byteLength(json, 'utf8');

    if (bytes > this.#maxBytes) {
      throw new JobPayloadValidationError(
        'JSON_TOO_LARGE',
        `JSON payload is ${bytes} bytes; limit is ${this.#maxBytes}.`,
      );
    }

    return {
      hash: createHash('sha256').update(json, 'utf8').digest('hex'),
      json,
    };
  }
}

export function assertSafeIdempotencyKey(idempotencyKey: string): void {
  const trimmed = idempotencyKey.trim();
  if (trimmed.length === 0 || trimmed.length > 512) {
    throw new TypeError('idempotencyKey must contain 1 to 512 characters.');
  }
  if (
    /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,}|(?:api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token)\s*[:=])/iu.test(
      trimmed,
    )
  ) {
    throw new JobPayloadValidationError(
      'CREDENTIAL_FIELD_FORBIDDEN',
      'idempotencyKey must not contain credentials or authorization headers.',
    );
  }
}
