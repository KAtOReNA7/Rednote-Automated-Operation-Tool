import { TextDecoder } from 'node:util';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

import {
  BROWSER_CLIP_MAX_BODY_BYTES,
  type BrowserClipCreateV1,
  validateBrowserClipCreateV1,
} from '@mystery-operations/shared';

import {
  LOCAL_API_HOST,
  LOCAL_API_MAX_JSON_BODY_BYTES,
  LocalApiError,
  type PairingExchangeInput,
} from './contracts.js';
import { isRuntimeToken } from './authenticator.js';
import { normalizeExtensionOrigin } from './origin-policy.js';

const CLIENT_LABEL_MAX_LENGTH = 120;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function rawHeaderValues(rawHeaders: readonly string[], name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
      values.push(rawHeaders[index + 1] ?? '');
    }
  }
  return values;
}

export function validateHost(rawHeaders: readonly string[], actualPort: number): void {
  const hosts = rawHeaderValues(rawHeaders, 'host');
  if (hosts.length !== 1 || hosts[0] !== `${LOCAL_API_HOST}:${actualPort}`) {
    throw new LocalApiError('LOCAL_API_INVALID_HOST');
  }
}

export function validateRemoteAddress(remoteAddress: string | undefined): void {
  if (remoteAddress !== LOCAL_API_HOST) {
    throw new LocalApiError('LOCAL_API_INVALID_HOST');
  }
}

export function parseSingleOrigin(rawHeaders: readonly string[]): string {
  const origins = rawHeaderValues(rawHeaders, 'origin');
  if (origins.length !== 1) {
    throw new LocalApiError('LOCAL_API_INVALID_ORIGIN');
  }
  return normalizeExtensionOrigin(origins[0] ?? '');
}

export function parseAuthenticatedExtensionOrigin(rawHeaders: readonly string[]): string {
  const origins = rawHeaderValues(rawHeaders, 'origin');
  const claimedOrigins = rawHeaderValues(rawHeaders, 'x-rednote-extension-origin');
  if (origins.length > 1 || claimedOrigins.length > 1) {
    throw new LocalApiError('LOCAL_API_INVALID_ORIGIN');
  }
  if (origins.length === 0 && claimedOrigins.length === 0) {
    throw new LocalApiError('LOCAL_API_INVALID_ORIGIN');
  }
  const origin = origins.length === 1 ? normalizeExtensionOrigin(origins[0] ?? '') : null;
  const claimed =
    claimedOrigins.length === 1 ? normalizeExtensionOrigin(claimedOrigins[0] ?? '') : null;
  if (origin !== null && claimed !== null && origin !== claimed) {
    throw new LocalApiError('LOCAL_API_INVALID_ORIGIN');
  }
  return origin ?? (claimed as string);
}

export function requestHasBody(headers: IncomingHttpHeaders): boolean {
  const length = headers['content-length'];
  return headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}

function parsePairingObject(value: unknown): PairingExchangeInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LocalApiError('LOCAL_API_INVALID_JSON');
  }
  const record = value as Readonly<Record<string, unknown>>;
  const required = ['clientToken', 'extensionOrigin', 'pairingCode'];
  const allowed = 'clientLabel' in record ? [...required, 'clientLabel'] : required;
  if (
    !exactKeys(record, allowed) ||
    typeof record.pairingCode !== 'string' ||
    !isRuntimeToken(record.pairingCode) ||
    typeof record.extensionOrigin !== 'string' ||
    typeof record.clientToken !== 'string' ||
    !isRuntimeToken(record.clientToken) ||
    !(
      record.clientLabel === undefined ||
      (typeof record.clientLabel === 'string' &&
        record.clientLabel === record.clientLabel.trim() &&
        record.clientLabel.length > 0 &&
        record.clientLabel.length <= CLIENT_LABEL_MAX_LENGTH &&
        !hasControlCharacter(record.clientLabel))
    )
  ) {
    throw new LocalApiError('LOCAL_API_INVALID_JSON');
  }
  return {
    clientLabel: typeof record.clientLabel === 'string' ? record.clientLabel : null,
    clientToken: record.clientToken,
    extensionOrigin: normalizeExtensionOrigin(record.extensionOrigin),
    pairingCode: record.pairingCode,
  };
}

export async function readPairingJson(request: IncomingMessage): Promise<PairingExchangeInput> {
  const contentTypes = rawHeaderValues(request.rawHeaders, 'content-type');
  const contentLengths = rawHeaderValues(request.rawHeaders, 'content-length');
  if (
    contentTypes.length !== 1 ||
    contentTypes[0]?.toLowerCase() !== 'application/json' ||
    contentLengths.length > 1
  ) {
    throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > LOCAL_API_MAX_JSON_BODY_BYTES) {
      request.resume();
      throw new LocalApiError('LOCAL_API_BODY_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    throw new LocalApiError('LOCAL_API_INVALID_JSON');
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    throw new LocalApiError('LOCAL_API_INVALID_JSON');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new LocalApiError('LOCAL_API_INVALID_JSON', { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new LocalApiError('LOCAL_API_INVALID_JSON', { cause: error });
  }
  return parsePairingObject(value);
}

export async function readBrowserClipJson(request: IncomingMessage): Promise<BrowserClipCreateV1> {
  const contentTypes = rawHeaderValues(request.rawHeaders, 'content-type');
  const contentLengths = rawHeaderValues(request.rawHeaders, 'content-length');
  if (
    contentTypes.length !== 1 ||
    contentTypes[0]?.toLowerCase() !== 'application/json; charset=utf-8' ||
    contentLengths.length > 1
  ) {
    throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > BROWSER_CLIP_MAX_BODY_BYTES) {
      request.resume();
      throw new LocalApiError('LOCAL_API_BODY_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  if (total === 0) throw new LocalApiError('LOCAL_API_INVALID_JSON');
  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new LocalApiError('LOCAL_API_INVALID_JSON', { cause: error });
  }
  try {
    return validateBrowserClipCreateV1(value);
  } catch (error) {
    throw new LocalApiError('LOCAL_API_INVALID_JSON', { cause: error });
  }
}
