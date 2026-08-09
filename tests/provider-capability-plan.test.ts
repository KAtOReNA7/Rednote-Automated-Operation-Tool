import { describe, expect, it } from 'vitest';

import {
  buildCapabilityProbePlan,
  capabilityConfigFingerprint,
  capabilityProbeRequestBody,
  normalizeCapabilityProbeBaseUrl,
  type CapabilityProbeConfigSnapshot,
} from '../packages/providers/src/index.js';

function snapshot(): CapabilityProbeConfigSnapshot {
  return {
    baseUrl: 'https://Gateway.Example.test/v1/',
    credentialBindingVersion: 7,
    models: {
      image: 'image-model',
      provider: 'shared-model',
      research: 'shared-model',
      review: 'review-model',
      writing: 'writing-model',
    },
    protocol: 'OPENAI_COMPATIBLE',
    settingsRevision: 12,
  };
}

describe('Issue 013 immutable capability probe plans', () => {
  it('builds a bounded, serializable CORE plan and deduplicates shared model IDs', () => {
    const plan = buildCapabilityProbePlan(snapshot(), {
      includeToolCalling: false,
      profile: 'CORE',
      selectedCapabilities: [],
    });

    expect(plan.requestCount).toBe(plan.steps.length);
    expect(plan.requestCount).toBeLessThanOrEqual(32);
    expect(
      plan.steps.filter((step) => step.modelId === 'shared-model' && step.kind === 'TEXT'),
    ).toHaveLength(2);
    expect(
      plan.steps.find((step) => step.modelId === 'shared-model' && step.kind === 'TEXT')
        ?.modelSlots,
    ).toEqual(['PROVIDER', 'RESEARCH']);
    expect(plan.steps.some((step) => step.kind === 'WEB_SEARCH')).toBe(false);
    expect(plan.steps.some((step) => step.kind === 'IMAGE')).toBe(false);
    expect(plan.steps.some((step) => step.kind === 'BATCH_METADATA')).toBe(false);
    expect(plan.steps.find((step) => step.kind === 'METADATA')).toMatchObject({
      modelId: 'shared-model',
      modelSlots: ['PROVIDER'],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.steps)).toBe(true);
    expect(Object.isFrozen(plan.steps[0])).toBe(true);
  });

  it('keeps a shared text and image model available to both capability families', () => {
    const shared = 'shared-multimodal-model';
    const base = snapshot();
    const plan = buildCapabilityProbePlan(
      {
        ...base,
        models: {
          image: shared,
          provider: shared,
          research: shared,
          review: shared,
          writing: shared,
        },
      },
      {
        includeToolCalling: false,
        profile: 'FULL',
        selectedCapabilities: [],
      },
    );

    expect(plan.steps.find((candidate) => candidate.kind === 'TEXT')).toMatchObject({
      modelId: shared,
      modelSlots: ['PROVIDER', 'RESEARCH', 'WRITING', 'REVIEW'],
    });
    expect(plan.steps.find((candidate) => candidate.kind === 'IMAGE')).toMatchObject({
      modelId: shared,
      modelSlots: ['IMAGE'],
    });
  });

  it('builds the R07 CUSTOM bootstrap plan without an extra metadata request', () => {
    const distinct = buildCapabilityProbePlan(snapshot(), {
      includeToolCalling: false,
      profile: 'CUSTOM',
      selectedCapabilities: ['structuredJson', 'imageGeneration'],
      targetModelSlots: ['RESEARCH', 'WRITING', 'IMAGE'],
    });
    expect(distinct.steps.map((candidate) => candidate.kind)).toEqual([
      'STRUCTURED',
      'STRUCTURED',
      'IMAGE',
    ]);
    expect(distinct.steps.some((candidate) => candidate.kind === 'METADATA')).toBe(false);

    const base = snapshot();
    const deduplicated = buildCapabilityProbePlan(
      {
        ...base,
        models: {
          image: base.models.image,
          provider: base.models.research,
          research: base.models.research,
          review: null,
          writing: base.models.research,
        },
      },
      {
        includeToolCalling: false,
        profile: 'CUSTOM',
        selectedCapabilities: ['structuredJson', 'imageGeneration'],
        targetModelSlots: ['RESEARCH', 'WRITING', 'IMAGE'],
      },
    );
    expect(deduplicated.requestCount).toBe(2);
    expect(deduplicated.steps[0]).toMatchObject({
      kind: 'STRUCTURED',
      modelSlots: ['RESEARCH', 'WRITING'],
    });
    expect(deduplicated.steps[1]).toMatchObject({ kind: 'IMAGE', modelSlots: ['IMAGE'] });
  });

  it('rejects an image capability selection without an image model', () => {
    expect(() =>
      buildCapabilityProbePlan(
        { ...snapshot(), models: { ...snapshot().models, image: null } },
        {
          includeToolCalling: false,
          profile: 'CUSTOM',
          selectedCapabilities: ['structuredJson', 'imageGeneration'],
          targetModelSlots: ['RESEARCH', 'WRITING', 'IMAGE'],
        },
      ),
    ).toThrow(/image model slot/iu);
  });

  it('keeps FULL under 32 requests and includes every explicit capability mode', () => {
    const plan = buildCapabilityProbePlan(snapshot(), {
      includeToolCalling: false,
      profile: 'FULL',
      selectedCapabilities: [],
    });

    expect(plan.requestCount).toBe(24);
    expect(new Set(plan.steps.map((step) => step.kind))).toEqual(
      new Set([
        'BATCH_METADATA',
        'IMAGE',
        'METADATA',
        'STREAMING',
        'STRUCTURED',
        'TEXT',
        'TOOL',
        'VISION',
        'WEB_SEARCH',
      ]),
    );
  });

  it('rejects empty CUSTOM plans and arbitrary model path material', () => {
    expect(() =>
      buildCapabilityProbePlan(snapshot(), {
        includeToolCalling: false,
        profile: 'CUSTOM',
        selectedCapabilities: [],
      }),
    ).toThrow(/at least one/iu);
    expect(() =>
      buildCapabilityProbePlan(
        {
          ...snapshot(),
          models: { ...snapshot().models, writing: 'bad/model' },
        },
        {
          includeToolCalling: false,
          profile: 'CORE',
          selectedCapabilities: [],
        },
      ),
    ).toThrow(/model ID/iu);
  });

  it('normalizes equivalent URLs and fingerprints only non-secret configuration', () => {
    expect(normalizeCapabilityProbeBaseUrl('https://EXAMPLE.test/v1/')).toBe(
      'https://example.test/v1',
    );
    const first = capabilityConfigFingerprint(snapshot());
    const second = capabilityConfigFingerprint({
      ...snapshot(),
      baseUrl: 'https://gateway.example.test/v1',
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toContain('Gateway');
  });

  it('uses fixed, bounded payloads with store=false and no caller-provided text', () => {
    const plan = buildCapabilityProbePlan(snapshot(), {
      includeToolCalling: true,
      profile: 'CORE',
      selectedCapabilities: [],
    });
    for (const step of plan.steps.filter((item) => item.modelId !== null)) {
      const payload = capabilityProbeRequestBody(step);
      expect(JSON.stringify(payload).length).toBeLessThan(4096);
      if (step.protocolMode === 'RESPONSES') {
        expect(payload).toMatchObject({ store: false });
      }
    }
  });
});
