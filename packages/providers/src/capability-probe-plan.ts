import { createHash } from 'node:crypto';

import {
  CAPABILITY_PROBE_LIMITS,
  type CapabilityProbeConfigSnapshot,
  type CapabilityProbePlan,
  type CapabilityProbeSelection,
  type CapabilityProbeStep,
  type CapabilityProbeStepKind,
  type ProbeCapability,
  type ProbeModelSlot,
  type ProbeProtocolMode,
  PROVIDER_CAPABILITY_CONTRACT_VERSION,
  PROBE_CAPABILITIES,
  PROBE_PROFILES,
} from './capability-probe-contracts.js';

function validModelId(modelId: string): boolean {
  return (
    modelId.length >= 1 &&
    modelId.length <= 256 &&
    ![...modelId].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 || '/?#\\'.includes(character);
    })
  );
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function normalizeCapabilityProbeBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
  ) {
    throw new TypeError('Provider URL is outside the capability probe policy.');
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
  return parsed.toString().replace(/\/$/u, '');
}

export function capabilityConfigFingerprint(snapshot: CapabilityProbeConfigSnapshot): string {
  const normalizedBaseUrl = normalizeCapabilityProbeBaseUrl(snapshot.baseUrl);
  return stableHash({
    baseUrl: normalizedBaseUrl,
    contractVersion: PROVIDER_CAPABILITY_CONTRACT_VERSION,
    models: {
      image: snapshot.models.image,
      provider: snapshot.models.provider,
      research: snapshot.models.research,
      review: snapshot.models.review,
      writing: snapshot.models.writing,
    },
    protocol: snapshot.protocol,
  });
}

function assertSelection(selection: CapabilityProbeSelection): readonly ProbeCapability[] {
  if (!PROBE_PROFILES.includes(selection.profile)) {
    throw new TypeError('Unsupported capability probe profile.');
  }
  const unique = [...new Set(selection.selectedCapabilities)];
  if (unique.some((capability) => !PROBE_CAPABILITIES.includes(capability))) {
    throw new TypeError('Unsupported capability selection.');
  }
  if (selection.profile === 'CUSTOM' && unique.length === 0) {
    throw new TypeError('CUSTOM capability probes require at least one capability.');
  }
  return unique;
}

function configuredModels(
  snapshot: CapabilityProbeConfigSnapshot,
): readonly { readonly id: string; readonly slots: readonly ProbeModelSlot[] }[] {
  const pairs: readonly (readonly [ProbeModelSlot, string | null])[] = [
    ['PROVIDER', snapshot.models.provider],
    ['RESEARCH', snapshot.models.research],
    ['WRITING', snapshot.models.writing],
    ['REVIEW', snapshot.models.review],
    ['IMAGE', snapshot.models.image],
  ];
  const byId = new Map<string, ProbeModelSlot[]>();
  for (const [slot, modelId] of pairs) {
    if (modelId === null) {
      continue;
    }
    if (!validModelId(modelId)) {
      throw new TypeError('Configured model ID is outside the capability probe policy.');
    }
    const slots = byId.get(modelId) ?? [];
    slots.push(slot);
    byId.set(modelId, slots);
  }
  return [...byId.entries()].map(([id, slots]) => ({
    id,
    slots: Object.freeze([...slots]),
  }));
}

function step(
  kind: CapabilityProbeStepKind,
  capability: ProbeCapability,
  protocolMode: ProbeProtocolMode,
  modelId: string | null,
  modelSlots: readonly ProbeModelSlot[],
  ordinal: number,
): CapabilityProbeStep {
  return Object.freeze({
    capability,
    id: `step-${String(ordinal).padStart(2, '0')}-${kind.toLowerCase()}`,
    kind,
    modelId,
    modelSlots: Object.freeze([...modelSlots]),
    protocolMode,
  });
}

function selectedForProfile(
  selection: CapabilityProbeSelection,
  selected: readonly ProbeCapability[],
): ReadonlySet<ProbeCapability> {
  if (selection.profile === 'CUSTOM') {
    return new Set(selected);
  }
  const core: ProbeCapability[] = ['text', 'structuredJson', 'usage', 'vision'];
  if (selection.includeToolCalling) {
    core.push('toolCalling');
  }
  if (selection.profile === 'FULL') {
    core.push('toolCalling', 'webSearch', 'imageGeneration', 'batch', 'streaming');
  }
  return new Set(core);
}

export function buildCapabilityProbePlan(
  snapshot: CapabilityProbeConfigSnapshot,
  selection: CapabilityProbeSelection,
): CapabilityProbePlan {
  if (
    snapshot.protocol !== 'OPENAI_COMPATIBLE' ||
    !Number.isSafeInteger(snapshot.settingsRevision) ||
    snapshot.settingsRevision < 0 ||
    !Number.isSafeInteger(snapshot.credentialBindingVersion) ||
    snapshot.credentialBindingVersion < 0
  ) {
    throw new TypeError('Capability probe snapshot is invalid.');
  }
  const selected = assertSelection(selection);
  const enabled = selectedForProfile(selection, selected);
  const models = configuredModels(snapshot);
  const nonImageModels = models.flatMap((model) => {
    const slots = model.slots.filter((slot) => slot !== 'IMAGE');
    return slots.length === 0 ? [] : [{ id: model.id, slots }];
  });
  if (nonImageModels.length === 0) {
    throw new TypeError('At least one text-capable model slot must be configured.');
  }

  const steps: CapabilityProbeStep[] = [];
  const append = (
    kind: CapabilityProbeStepKind,
    capability: ProbeCapability,
    mode: ProbeProtocolMode,
    modelId: string | null,
    slots: readonly ProbeModelSlot[],
  ): void => {
    steps.push(step(kind, capability, mode, modelId, slots, steps.length + 1));
  };

  const providerModel = models.find((model) => model.slots.includes('PROVIDER'));
  append('METADATA', 'usage', 'NOT_APPLICABLE', providerModel?.id ?? null, ['PROVIDER']);
  for (const model of nonImageModels) {
    if (enabled.has('text')) {
      append('TEXT', 'text', 'RESPONSES', model.id, model.slots);
      append('TEXT', 'text', 'CHAT_COMPLETIONS', model.id, model.slots);
    }
    if (enabled.has('structuredJson')) {
      append('STRUCTURED', 'structuredJson', 'RESPONSES', model.id, model.slots);
    }
    if (enabled.has('vision')) {
      append('VISION', 'vision', 'RESPONSES', model.id, model.slots);
    }
    if (enabled.has('toolCalling')) {
      append('TOOL', 'toolCalling', 'RESPONSES', model.id, model.slots);
    }
    if (enabled.has('webSearch')) {
      append('WEB_SEARCH', 'webSearch', 'RESPONSES', model.id, model.slots);
    }
    if (enabled.has('streaming')) {
      append('STREAMING', 'streaming', 'RESPONSES', model.id, model.slots);
    }
  }
  if (enabled.has('imageGeneration')) {
    const image = models.find((model) => model.slots.includes('IMAGE'));
    if (image !== undefined) {
      append('IMAGE', 'imageGeneration', 'NOT_APPLICABLE', image.id, ['IMAGE']);
    }
  }
  if (enabled.has('batch')) {
    append('BATCH_METADATA', 'batch', 'NOT_APPLICABLE', null, ['PROVIDER']);
  }
  if (steps.length > CAPABILITY_PROBE_LIMITS.maxExternalRequests) {
    throw new TypeError('Capability probe plan exceeds the external request limit.');
  }

  const configFingerprint = capabilityConfigFingerprint(snapshot);
  const hash = stableHash({
    configFingerprint,
    contractVersion: PROVIDER_CAPABILITY_CONTRACT_VERSION,
    credentialBindingVersion: snapshot.credentialBindingVersion,
    profile: selection.profile,
    settingsRevision: snapshot.settingsRevision,
    steps,
  });
  return Object.freeze({
    configFingerprint,
    contractVersion: PROVIDER_CAPABILITY_CONTRACT_VERSION,
    credentialBindingVersion: snapshot.credentialBindingVersion,
    hash,
    profile: selection.profile,
    requestCount: steps.length,
    settingsRevision: snapshot.settingsRevision,
    steps: Object.freeze(steps),
  });
}
