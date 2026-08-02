import {
  V2ApplicationFacade,
  V2ContractError,
  V2ContentError,
  V2InteractionError,
  V2_SCHEMA_VERSION,
  parseAccountPersona,
  parseWeeklyPlan,
  toV2Exception,
  type AccountPersona,
  type AccountPersonaFields,
  type PlanReschedulePreview,
  type V2Bridge,
  type V2RepositoryPort,
  type V2Result,
  type WeeklyPlan,
} from '../../packages/v2/src/index.js';

export class MemoryV2Repository implements V2RepositoryPort {
  #persona: AccountPersona | undefined;
  readonly #plans = new Map<string, WeeklyPlan>();

  public getOrCreatePersona(seed: AccountPersona): AccountPersona {
    this.#persona ??= parseAccountPersona(seed);
    return this.#persona;
  }

  public getOrCreateWeeklyPlan(seed: WeeklyPlan, personaSeed: AccountPersona): WeeklyPlan {
    this.getOrCreatePersona(personaSeed);
    const existing = this.#plans.get(seed.weekKey);
    if (existing !== undefined) return existing;
    const created = parseWeeklyPlan(seed);
    this.#plans.set(created.weekKey, created);
    return created;
  }

  public savePersona(persona: AccountPersonaFields, expectedRevision: number): AccountPersona {
    const current = this.#persona;
    if (current === undefined) throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    if (current.revision !== expectedRevision)
      throw new V2ContractError('REVISION_CONFLICT', ['persona']);
    const parsed = parseAccountPersona({
      ...persona,
      revision: expectedRevision,
      schemaVersion: V2_SCHEMA_VERSION,
    });
    if (
      current.name === parsed.name &&
      current.audience === parsed.audience &&
      current.tone === parsed.tone &&
      current.boundary === parsed.boundary
    )
      return current;
    this.#persona = parseAccountPersona({ ...parsed, revision: expectedRevision + 1 });
    return this.#persona;
  }

  public saveWeeklyPlan(plan: WeeklyPlan, expectedRevision: number): WeeklyPlan {
    const parsed = parseWeeklyPlan(plan);
    const current = this.#plans.get(parsed.weekKey);
    if (current === undefined) throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    if (current.revision !== expectedRevision)
      throw new V2ContractError('REVISION_CONFLICT', ['weeklyPlan']);
    if (
      current.status === parsed.status &&
      JSON.stringify(current.candidates) === JSON.stringify(parsed.candidates)
    )
      return current;
    const saved = parseWeeklyPlan({ ...parsed, revision: expectedRevision + 1 });
    this.#plans.set(saved.weekKey, saved);
    return saved;
  }
}

export function createMemoryV2Bridge(): V2Bridge {
  const facade = new V2ApplicationFacade(new MemoryV2Repository());
  const run = async <T>(operation: () => T): Promise<V2Result<T>> => {
    try {
      return { ok: true, value: operation() };
    } catch (error) {
      return { error: toV2Exception(error), ok: false };
    }
  };
  return {
    approveContentPackages: async () => ({
      error: toV2Exception(new V2ContentError('CONTENT_NOT_READY')),
      ok: false,
    }),
    confirmPlanCandidates: (input) =>
      run(() => facade.mutate({ action: 'CONFIRM_PLAN_CANDIDATES', ...input }) as WeeklyPlan),
    confirmReplySuggestions: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    createInteraction: async () => ({
      error: toV2Exception(new V2InteractionError('INVALID_REQUEST')),
      ok: false,
    }),
    deleteInteraction: async () => ({
      error: toV2Exception(new V2InteractionError('INVALID_REQUEST')),
      ok: false,
    }),
    generateWeeklyPlan: (input) =>
      run(() => facade.mutate({ action: 'GENERATE_WEEKLY_PLAN', ...input }) as WeeklyPlan),
    generateContentPackages: async () => ({
      error: toV2Exception(new V2ContentError('CONTENT_NOT_READY')),
      ok: false,
    }),
    generateReplySuggestion: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    lockWeeklyPlan: (input) =>
      run(() => facade.mutate({ action: 'LOCK_WEEKLY_PLAN', ...input }) as WeeklyPlan),
    previewPlanReschedule: (input) =>
      run(
        () => facade.read({ view: 'PLAN_RESCHEDULE_PREVIEW', ...input }) as PlanReschedulePreview,
      ),
    exportContentPackages: async () => ({
      error: toV2Exception(new V2ContentError('CONTENT_NOT_APPROVED')),
      ok: false,
    }),
    openContentExport: async () => ({
      error: toV2Exception(new V2ContentError('EXPORT_FAILED')),
      ok: false,
    }),
    markInteractionManualSent: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    previewInteractionDelete: async () => ({
      error: toV2Exception(new V2InteractionError('INVALID_REQUEST')),
      ok: false,
    }),
    readContentPackages: async (input) => ({
      ok: true,
      value: { packages: [], schemaVersion: 1, weekKey: input.weekKey },
    }),
    readInteractions: async () => ({ ok: true, value: { items: [], schemaVersion: 1 } }),
    readPersona: () => run(() => facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona),
    readWeeklyPlan: (input) =>
      run(() => facade.read({ view: 'WEEKLY_PLAN', ...input }) as WeeklyPlan),
    reschedulePlanCandidates: (input) =>
      run(() => facade.mutate({ action: 'RESCHEDULE_PLAN_CANDIDATES', ...input }) as WeeklyPlan),
    reopenInteraction: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    saveReplySuggestion: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    saveContentPackage: async () => ({
      error: toV2Exception(new V2ContentError('CONTENT_NOT_READY')),
      ok: false,
    }),
    skipPlanCandidates: (input) =>
      run(() => facade.mutate({ action: 'SKIP_PLAN_CANDIDATES', ...input }) as WeeklyPlan),
    skipInteraction: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    undoInteractionManualSent: async () => ({
      error: toV2Exception(new V2InteractionError('INTERACTION_STATE_INVALID')),
      ok: false,
    }),
    updatePersona: (input) =>
      run(() => facade.mutate({ action: 'UPDATE_PERSONA', ...input }) as AccountPersona),
  };
}
