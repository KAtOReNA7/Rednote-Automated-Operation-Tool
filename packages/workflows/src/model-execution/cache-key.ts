import { createHash } from 'node:crypto';

import { canonicalJson, canonicalSha256 } from './canonical.js';
import {
  CACHE_KEY_VERSION,
  CANONICALIZATION_VERSION,
  PROVIDER_CONTRACT_VERSION,
  type ModelExecutionRequestV1,
} from './types.js';

function assertHash(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 value.`);
  }
  return value;
}

function sortedIdentities(
  values: ModelExecutionRequestV1['sourceIdentities'],
  expectedKind: 'MEDIA' | 'SOURCE',
): readonly string[] {
  if (values.length > 64) {
    throw new RangeError('Too many content identities.');
  }
  return Object.freeze(
    values
      .map((identity) => {
        if (identity.kind !== expectedKind) {
          throw new TypeError('Content identity kind does not match its request field.');
        }
        return assertHash(identity.contentHash, 'contentHash');
      })
      .sort(),
  );
}

export interface CacheKeyIdentityV1 {
  readonly cacheKeyVersion: typeof CACHE_KEY_VERSION;
  readonly canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  readonly generationOptions: ModelExecutionRequestV1['generationOptions'];
  readonly inputHash: string;
  readonly mediaContentHashes: readonly string[];
  readonly modelId: string;
  readonly modelRole: string;
  readonly modelSlot: string;
  readonly outputSchemaIdentity: ModelExecutionRequestV1['outputSchemaIdentity'] | null;
  readonly parameterVersion: number;
  readonly promptIdentity: ModelExecutionRequestV1['promptIdentity'];
  readonly protocolMode: ModelExecutionRequestV1['protocolMode'];
  readonly providerConfigFingerprint: string;
  readonly providerContractVersion: typeof PROVIDER_CONTRACT_VERSION;
  readonly sourceContentHashes: readonly string[];
  readonly taskKind: string;
}

export function buildCacheKeyIdentity(request: ModelExecutionRequestV1): CacheKeyIdentityV1 {
  assertHash(request.providerConfigFingerprint, 'providerConfigFingerprint');
  assertHash(request.promptIdentity.contentHash, 'promptIdentity.contentHash');
  if (request.outputSchemaIdentity !== undefined) {
    assertHash(request.outputSchemaIdentity.contentHash, 'outputSchemaIdentity.contentHash');
  }
  canonicalJson(request.generationOptions);
  return Object.freeze({
    cacheKeyVersion: CACHE_KEY_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    generationOptions: request.generationOptions,
    inputHash: canonicalSha256(request.input),
    mediaContentHashes: sortedIdentities(request.mediaIdentities, 'MEDIA'),
    modelId: request.modelId,
    modelRole: request.modelRole,
    modelSlot: request.modelSlot,
    outputSchemaIdentity: request.outputSchemaIdentity ?? null,
    parameterVersion: request.parameterVersion,
    promptIdentity: request.promptIdentity,
    protocolMode: request.protocolMode,
    providerConfigFingerprint: request.providerConfigFingerprint,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    sourceContentHashes: sortedIdentities(request.sourceIdentities, 'SOURCE'),
    taskKind: request.taskKind,
  });
}

export function modelCacheKey(request: ModelExecutionRequestV1): string {
  return createHash('sha256')
    .update(CACHE_KEY_VERSION, 'utf8')
    .update('\n', 'utf8')
    .update(canonicalJson(buildCacheKeyIdentity(request)), 'utf8')
    .digest('hex');
}
