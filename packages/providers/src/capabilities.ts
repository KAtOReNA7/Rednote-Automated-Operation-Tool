import { ProviderError } from './errors.js';

export const CAPABILITY_STATES = Object.freeze(['UNKNOWN', 'SUPPORTED', 'UNSUPPORTED'] as const);
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const CAPABILITY_SOURCES = Object.freeze(['CONFIGURED_UNKNOWN', 'MOCK', 'PROBED'] as const);
export type CapabilitySource = (typeof CAPABILITY_SOURCES)[number];

export interface ProviderCapabilities {
  readonly batch: CapabilityState;
  readonly imageGeneration: CapabilityState;
  readonly maxContextTokens: number | null;
  readonly observedAt: string | null;
  readonly source: CapabilitySource;
  readonly streaming: CapabilityState;
  readonly structuredJson: CapabilityState;
  readonly text: CapabilityState;
  readonly toolCalling: CapabilityState;
  readonly usage: CapabilityState;
  readonly vision: CapabilityState;
  readonly webSearch: CapabilityState;
}

export type ProviderCapabilityName = Exclude<
  keyof ProviderCapabilities,
  'maxContextTokens' | 'observedAt' | 'source'
>;

const CAPABILITY_NAMES: readonly ProviderCapabilityName[] = Object.freeze([
  'batch',
  'imageGeneration',
  'streaming',
  'structuredJson',
  'text',
  'toolCalling',
  'usage',
  'vision',
  'webSearch',
]);

export function createUnknownCapabilities(): ProviderCapabilities {
  return Object.freeze({
    batch: 'UNKNOWN',
    imageGeneration: 'UNKNOWN',
    maxContextTokens: null,
    observedAt: null,
    source: 'CONFIGURED_UNKNOWN',
    streaming: 'UNKNOWN',
    structuredJson: 'UNKNOWN',
    text: 'UNKNOWN',
    toolCalling: 'UNKNOWN',
    usage: 'UNKNOWN',
    vision: 'UNKNOWN',
    webSearch: 'UNKNOWN',
  });
}

export function createMockCapabilities(
  overrides: Partial<Record<ProviderCapabilityName, CapabilityState>> = {},
): ProviderCapabilities {
  const states = Object.fromEntries(
    CAPABILITY_NAMES.map((name) => [name, overrides[name] ?? 'UNSUPPORTED']),
  ) as Record<ProviderCapabilityName, CapabilityState>;
  return Object.freeze({
    ...states,
    imageGeneration: overrides.imageGeneration ?? 'SUPPORTED',
    maxContextTokens: null,
    observedAt: null,
    source: 'MOCK',
    structuredJson: overrides.structuredJson ?? 'SUPPORTED',
    text: overrides.text ?? 'SUPPORTED',
    usage: overrides.usage ?? 'SUPPORTED',
    vision: overrides.vision ?? 'SUPPORTED',
  });
}

export function assertCapability(
  capabilities: ProviderCapabilities,
  name: ProviderCapabilityName,
  identity: {
    readonly modelId: string;
    readonly operation: string;
    readonly providerId: string;
    readonly requestId: string;
  },
): void {
  const state = capabilities[name];
  if (state === 'SUPPORTED') {
    return;
  }
  throw new ProviderError(
    state === 'UNKNOWN' ? 'PROVIDER_CAPABILITY_UNKNOWN' : 'PROVIDER_CAPABILITY_UNSUPPORTED',
    {
      details: { capability: name, state },
      modelId: identity.modelId,
      operation: identity.operation,
      outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
      providerId: identity.providerId,
      requestId: identity.requestId,
      retryDisposition: 'DO_NOT_RETRY',
    },
  );
}
