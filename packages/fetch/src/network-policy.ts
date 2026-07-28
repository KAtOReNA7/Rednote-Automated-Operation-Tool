import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { canonicalizeSearchUrl } from '@mystery-operations/search';

import { FETCH_DNS_POLICY_VERSION, FETCH_LIMITS } from './constants.js';
import { FetchError } from './errors.js';

export interface DnsAddressV1 {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface DnsResolverV1 {
  resolve(hostname: string, signal?: AbortSignal): Promise<readonly DnsAddressV1[]>;
}

export class SystemDnsResolver implements DnsResolverV1 {
  public async resolve(hostname: string, signal?: AbortSignal): Promise<readonly DnsAddressV1[]> {
    if (signal?.aborted) {
      throw new FetchError('FETCH_CANCELLED_BEFORE_SEND');
    }
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (signal?.aborted) {
      throw new FetchError('FETCH_CANCELLED_BEFORE_SEND');
    }
    return Object.freeze(
      addresses.map((entry) => {
        if (entry.family !== 4 && entry.family !== 6) {
          throw new FetchError('FETCH_DNS_FAILED');
        }
        return Object.freeze({
          address: entry.address,
          family: entry.family,
        });
      }),
    );
  }
}

export interface PinnedNetworkTargetV1 {
  readonly addresses: readonly DnsAddressV1[];
  readonly dnsPolicyVersion: typeof FETCH_DNS_POLICY_VERSION;
  readonly hostname: string;
  readonly selectedAddress: DnsAddressV1;
}

const BLOCKED_IPV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4');
}

const BLOCKED_IPV6 = new BlockList();
for (const [network, prefix] of [
  ['::', 8],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6');
}

const CREDENTIAL_QUERY_NAMES = new Set([
  'access_token',
  'apikey',
  'api_key',
  'auth',
  'authorization',
  'credential',
  'email',
  'key',
  'passwd',
  'password',
  'secret',
  'session',
  'sessionid',
  'sig',
  'signature',
  'token',
]);

function hasConfusingCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 0x20 ||
      (code >= 0x7f && code <= 0xa0) ||
      code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200a) ||
      [0x2028, 0x2029, 0x202f, 0x205f, 0x3000].includes(code)
    );
  });
}

function queryNameIsCredentialLike(name: string): boolean {
  const normalized = name.normalize('NFKC').toLowerCase();
  const collapsed = normalized.replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
  const segments = collapsed.split('_');
  return (
    CREDENTIAL_QUERY_NAMES.has(normalized) ||
    CREDENTIAL_QUERY_NAMES.has(collapsed) ||
    segments.some((segment) => CREDENTIAL_QUERY_NAMES.has(segment))
  );
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED_IPV4.check(address, 'ipv4');
  if (family === 6) return !BLOCKED_IPV6.check(address, 'ipv6');
  return false;
}

export interface ValidatedFetchUrlV1 {
  readonly canonicalUrl: string;
  readonly hostname: string;
  readonly origin: string;
  readonly protocol: 'http:' | 'https:';
  readonly urlHash: string;
}

export function validateFetchUrl(value: string): ValidatedFetchUrlV1 {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > FETCH_LIMITS.urlCharacters ||
    value !== value.trim() ||
    hasConfusingCharacter(value) ||
    /%(?![0-9A-Fa-f]{2})/u.test(value)
  ) {
    throw new FetchError('FETCH_URL_INVALID');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new FetchError('FETCH_URL_INVALID', { cause });
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    throw new FetchError('FETCH_URL_INVALID');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.includes('%') ||
    (!hostname.includes('.') && isIP(hostname) === 0)
  ) {
    throw new FetchError('FETCH_HOST_DISALLOWED');
  }
  if (isIP(hostname) !== 0 && !isPublicIpAddress(hostname)) {
    throw new FetchError('FETCH_HOST_DISALLOWED');
  }
  for (const [name] of parsed.searchParams) {
    if (queryNameIsCredentialLike(name)) {
      throw new FetchError('FETCH_URL_INVALID');
    }
  }
  const normalized = canonicalizeSearchUrl(parsed.href);
  if (normalized.canonicalUrl !== parsed.href) {
    throw new FetchError('FETCH_URL_INVALID');
  }
  return Object.freeze({
    canonicalUrl: normalized.canonicalUrl,
    hostname,
    origin: parsed.origin,
    protocol: parsed.protocol,
    urlHash: normalized.urlHash,
  });
}

export function validateRedirectTarget(
  currentValue: string,
  location: string,
): ValidatedFetchUrlV1 {
  if (
    typeof location !== 'string' ||
    location.length < 1 ||
    location.length > FETCH_LIMITS.urlCharacters ||
    hasConfusingCharacter(location)
  ) {
    throw new FetchError('FETCH_REDIRECT_INVALID', { sendState: 'PAGE_SENT' });
  }
  let current: URL;
  let target: URL;
  try {
    current = new URL(currentValue);
    target = new URL(location, current);
  } catch (cause) {
    throw new FetchError('FETCH_REDIRECT_INVALID', { cause, sendState: 'PAGE_SENT' });
  }
  if (target.hash !== '' || target.username !== '' || target.password !== '') {
    throw new FetchError('FETCH_REDIRECT_INVALID', { sendState: 'PAGE_SENT' });
  }
  const validated = validateFetchUrl(target.href);
  if (current.protocol === 'https:' && validated.protocol === 'http:') {
    throw new FetchError('FETCH_HTTPS_DOWNGRADE', { sendState: 'PAGE_SENT' });
  }
  if (current.hostname.toLowerCase() !== validated.hostname) {
    throw new FetchError('FETCH_REDIRECT_CROSS_HOST', { sendState: 'PAGE_SENT' });
  }
  return validated;
}

function normalizedAddress(address: DnsAddressV1): DnsAddressV1 {
  const family = isIP(address.address);
  if (family !== address.family) throw new FetchError('FETCH_DNS_FAILED');
  return Object.freeze({ address: address.address.toLowerCase(), family: address.family });
}

export class DnsPinningSession {
  readonly #allowNonPublicForTests: boolean;
  readonly #fingerprints = new Map<string, string>();
  readonly #resolver: DnsResolverV1;

  public constructor(
    resolver: DnsResolverV1,
    options: { readonly allowNonPublicForTests?: boolean } = {},
  ) {
    this.#resolver = resolver;
    this.#allowNonPublicForTests = options.allowNonPublicForTests ?? false;
  }

  public async resolve(urlValue: string, signal?: AbortSignal): Promise<PinnedNetworkTargetV1> {
    const target = validateFetchUrl(urlValue);
    const literalFamily = isIP(target.hostname);
    let addresses: readonly DnsAddressV1[];
    try {
      addresses =
        literalFamily === 0
          ? await this.#resolver.resolve(target.hostname, signal)
          : [{ address: target.hostname, family: literalFamily as 4 | 6 }];
    } catch (cause) {
      if (cause instanceof FetchError) throw cause;
      throw new FetchError('FETCH_DNS_FAILED', { cause });
    }
    if (addresses.length < 1 || addresses.length > 16) {
      throw new FetchError('FETCH_DNS_FAILED');
    }
    const normalized = [...addresses]
      .map(normalizedAddress)
      .sort((left, right) =>
        left.family === right.family
          ? left.address.localeCompare(right.address)
          : left.family - right.family,
      );
    if (
      new Set(normalized.map(({ address, family }) => `${family}:${address}`)).size !==
      normalized.length
    ) {
      throw new FetchError('FETCH_DNS_FAILED');
    }
    if (
      !this.#allowNonPublicForTests &&
      normalized.some(({ address }) => !isPublicIpAddress(address))
    ) {
      throw new FetchError('FETCH_DNS_NON_PUBLIC');
    }
    const fingerprint = normalized.map(({ address, family }) => `${family}:${address}`).join(',');
    const prior = this.#fingerprints.get(target.hostname);
    if (prior !== undefined && prior !== fingerprint) {
      throw new FetchError('FETCH_DNS_REBINDING');
    }
    this.#fingerprints.set(target.hostname, fingerprint);
    const selectedAddress = normalized[0];
    if (selectedAddress === undefined) throw new FetchError('FETCH_DNS_FAILED');
    return Object.freeze({
      addresses: Object.freeze(normalized),
      dnsPolicyVersion: FETCH_DNS_POLICY_VERSION,
      hostname: target.hostname,
      selectedAddress,
    });
  }
}

export function assertPinnedRemoteAddress(
  target: PinnedNetworkTargetV1,
  remoteAddress: string | undefined,
): asserts remoteAddress is string {
  const normalize = (value: string): string =>
    value.startsWith('::ffff:') && isIP(value.slice(7)) === 4
      ? value.slice(7)
      : value.toLowerCase();
  if (
    remoteAddress === undefined ||
    normalize(remoteAddress) !== normalize(target.selectedAddress.address)
  ) {
    throw new FetchError('FETCH_REMOTE_ADDRESS_MISMATCH', {
      sendState: 'PAGE_SENT',
    });
  }
}
