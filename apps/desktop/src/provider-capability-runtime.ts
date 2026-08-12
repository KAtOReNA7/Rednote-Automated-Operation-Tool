import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type {
  ProviderCapabilityStateRecord,
  SqliteModelAccountingRepository,
  SqliteProviderCapabilityRepository,
} from '@mystery-operations/db';
import {
  CAPABILITY_PROBE_LIMITS,
  CapabilityProbeRunner,
  NodeFetchCapabilityProbeTransport,
  PROBE_CAPABILITIES,
  buildCapabilityProbePlan,
  capabilityConfigFingerprint,
  type CapabilityProbeConfigSnapshot,
  type CapabilityProbeObservation,
  type CapabilityProbePlan,
  type CapabilityProbeProgress,
  type CapabilityProbeSelection,
  type CapabilityProbeTransport,
  type CapabilityProbeStep,
  type ProbeCapability,
  type ProbeModelSlot,
  type ProbeProtocolMode,
} from '@mystery-operations/providers';
import type {
  CancelProviderCapabilityProbeInput,
  ProviderCapabilityProbePreview,
  ProviderCapabilityProbeProgressView,
  ProviderCapabilityStateView,
  StartProviderCapabilityProbeInput,
} from '@mystery-operations/shared';
import type { AppSettings } from '@mystery-operations/settings';

export const PROVIDER_CAPABILITY_CONTROL_ERROR_CODES = Object.freeze([
  'PROBE_INVALID_REQUEST',
  'PROBE_STALE',
  'PROBE_ALREADY_RUNNING',
  'PROBE_NOT_RUNNING',
  'BUDGET_UNPRICED_LIMIT_REQUIRED',
] as const);
export type ProviderCapabilityControlErrorCode =
  (typeof PROVIDER_CAPABILITY_CONTROL_ERROR_CODES)[number];

export class ProviderCapabilityControlError extends Error {
  public readonly code: ProviderCapabilityControlErrorCode;
  public readonly retryable: boolean;

  public constructor(code: ProviderCapabilityControlErrorCode, retryable = false) {
    super(code);
    this.name = 'ProviderCapabilityControlError';
    this.code = code;
    this.retryable = retryable;
  }
}

interface PreviewLease {
  readonly expiresAtMilliseconds: number;
  readonly plan: CapabilityProbePlan;
  readonly selection: CapabilityProbeSelection;
  readonly senderId: number;
  readonly windowId: number;
}

interface ActiveProbe {
  readonly abortController: AbortController;
  readonly plan: CapabilityProbePlan;
  readonly runId: string;
}

export interface ProviderCapabilityRuntimeOptions {
  readonly accountingRepository?: SqliteModelAccountingRepository;
  readonly now?: () => Date;
  readonly randomId?: () => string;
  readonly randomToken?: () => string;
  readonly transport?: CapabilityProbeTransport;
}

export class ProviderCapabilityRuntime {
  readonly #now: () => Date;
  readonly #randomId: () => string;
  readonly #randomToken: () => string;
  readonly #readSettings: () => AppSettings;
  readonly #repository: SqliteProviderCapabilityRepository;
  readonly #resolveCredential: () => Promise<string>;
  readonly #runner: CapabilityProbeRunner;
  readonly #accounting: SqliteModelAccountingRepository | null;
  readonly #leases = new Map<string, PreviewLease>();
  readonly #progress = new Map<string, ProviderCapabilityProbeProgressView>();
  #active: ActiveProbe | null = null;
  #closed = false;

  public constructor(
    repository: SqliteProviderCapabilityRepository,
    readSettings: () => AppSettings,
    resolveCredential: () => Promise<string>,
    options: ProviderCapabilityRuntimeOptions = {},
  ) {
    this.#repository = repository;
    this.#accounting = options.accountingRepository ?? null;
    this.#readSettings = readSettings;
    this.#resolveCredential = resolveCredential;
    this.#now = options.now ?? (() => new Date());
    this.#randomId = options.randomId ?? randomUUID;
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'));
    this.#runner = new CapabilityProbeRunner(
      options.transport ?? new NodeFetchCapabilityProbeTransport(),
    );
  }

  public initialize(): void {
    this.#repository.recoverInterrupted(this.#now().toISOString());
  }

  public preview(
    selection: CapabilityProbeSelection,
    senderId: number,
    windowId: number,
  ): ProviderCapabilityProbePreview {
    this.#assertOpen();
    this.#removeExpiredLeases();
    const plan = buildCapabilityProbePlan(this.#snapshot(), selection);
    const startToken = this.#randomToken();
    const expiresAtMilliseconds = this.#now().getTime() + CAPABILITY_PROBE_LIMITS.startTokenTtlMs;
    this.#leases.set(startToken, {
      expiresAtMilliseconds,
      plan,
      selection: {
        includeToolCalling: selection.includeToolCalling,
        profile: selection.profile,
        selectedCapabilities: Object.freeze([...selection.selectedCapabilities]),
        ...(selection.structuredProtocolModes === undefined
          ? {}
          : {
              structuredProtocolModes: Object.freeze([...selection.structuredProtocolModes]),
            }),
        ...(selection.targetModelSlots === undefined
          ? {}
          : { targetModelSlots: Object.freeze([...selection.targetModelSlots]) }),
      },
      senderId,
      windowId,
    });
    return {
      budgetCheck:
        this.#accounting === null || this.#probeUnitPolicyReady(plan)
          ? 'UNIT_POLICY_READY'
          : 'UNIT_POLICY_REQUIRED',
      credentialBindingVersion: plan.credentialBindingVersion,
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
      feeEstimate: 'UNKNOWN',
      planHash: plan.hash,
      profile: plan.profile,
      requestCount: plan.requestCount,
      settingsRevision: plan.settingsRevision,
      startToken,
    };
  }

  public async start(
    input: StartProviderCapabilityProbeInput,
    senderId: number,
    windowId: number,
    userApprovedUnknownCost = false,
  ): Promise<ProviderCapabilityProbeProgressView> {
    this.#assertOpen();
    if (this.#active !== null) {
      throw new ProviderCapabilityControlError('PROBE_ALREADY_RUNNING', true);
    }
    const lease = this.#leases.get(input.startToken);
    this.#leases.delete(input.startToken);
    if (
      input.confirmation !== 'START_PROVIDER_CAPABILITY_PROBE' ||
      lease === undefined ||
      lease.expiresAtMilliseconds < this.#now().getTime() ||
      lease.senderId !== senderId ||
      lease.windowId !== windowId
    ) {
      throw new ProviderCapabilityControlError('PROBE_INVALID_REQUEST');
    }
    const rebuilt = buildCapabilityProbePlan(this.#snapshot(), lease.selection);
    if (
      rebuilt.hash !== lease.plan.hash ||
      input.planHash !== lease.plan.hash ||
      input.settingsRevision !== lease.plan.settingsRevision ||
      input.credentialBindingVersion !== lease.plan.credentialBindingVersion
    ) {
      throw new ProviderCapabilityControlError('PROBE_STALE');
    }
    if (
      this.#accounting !== null &&
      !this.#probeUnitPolicyReady(rebuilt) &&
      !userApprovedUnknownCost
    ) {
      throw new ProviderCapabilityControlError('BUDGET_UNPRICED_LIMIT_REQUIRED');
    }

    const credential = await this.#resolveCredential();
    const runId = `probe-${this.#randomId()}`;
    const abortController = new AbortController();
    const initial: ProviderCapabilityProbeProgressView = {
      completedRequestCount: 0,
      currentCapability: null,
      plannedRequestCount: rebuilt.requestCount,
      runId,
      sentRequestCount: 0,
      status: 'RUNNING',
    };
    this.#repository.createRun(runId, rebuilt, this.#now().toISOString());
    this.#progress.set(runId, initial);
    this.#active = { abortController, plan: rebuilt, runId };
    void this.#execute(runId, rebuilt, credential, abortController, userApprovedUnknownCost);
    return initial;
  }

  public getProgress(runId: string): ProviderCapabilityProbeProgressView {
    const progress = this.#progress.get(runId);
    if (progress === undefined) {
      throw new ProviderCapabilityControlError('PROBE_NOT_RUNNING');
    }
    return progress;
  }

  public describePlan(selection: CapabilityProbeSelection): CapabilityProbePlan {
    this.#assertOpen();
    return buildCapabilityProbePlan(this.#snapshot(), selection);
  }

  public cancel(input: CancelProviderCapabilityProbeInput): ProviderCapabilityProbeProgressView {
    if (
      input.confirmation !== 'CANCEL_PROVIDER_CAPABILITY_PROBE' ||
      this.#active?.runId !== input.runId
    ) {
      throw new ProviderCapabilityControlError('PROBE_NOT_RUNNING');
    }
    this.#active.abortController.abort();
    return this.getProgress(input.runId);
  }

  public getState(): ProviderCapabilityStateView {
    let state: ProviderCapabilityStateRecord;
    try {
      const snapshot = this.#snapshot();
      state = this.#repository.getState(
        capabilityConfigFingerprint(snapshot),
        snapshot.credentialBindingVersion,
      );
    } catch {
      state = {
        derivedState: 'NOT_PROBED',
        entries: [],
        history: [],
        runId: null,
      };
    }
    return {
      activeRun: this.#active === null ? null : this.getProgress(this.#active.runId),
      derivedState: state.derivedState,
      entries: state.entries.map((entry) => ({
        capability: entry.capability,
        confidence: entry.confidence,
        maxContextTokens: entry.maxContextTokens,
        modelId: entry.modelId,
        modelSlot: entry.modelSlot,
        observedAt: entry.observedAt,
        protocolMode: entry.protocolMode,
        rateLimitRequests: entry.rateLimitRequests,
        rateLimitTokens: entry.rateLimitTokens,
        reasonCode: entry.reasonCode,
        safeDetails: entry.safeDetails,
        source: entry.source,
        stale: entry.stale,
        state: entry.state,
      })),
      history: state.history,
      runId: state.runId,
    };
  }

  public getConfigFingerprint(): string {
    return capabilityConfigFingerprint(this.#snapshot());
  }

  public clearWindow(windowId: number): void {
    for (const [token, lease] of this.#leases) {
      if (lease.windowId === windowId) {
        this.#leases.delete(token);
      }
    }
  }

  public async close(): Promise<void> {
    this.#closed = true;
    this.#leases.clear();
    const active = this.#active;
    active?.abortController.abort();
    if (active !== null) {
      for (let attempt = 0; attempt < 100 && this.#active !== null; attempt += 1) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5);
        });
      }
    }
  }

  async #execute(
    runId: string,
    plan: CapabilityProbePlan,
    credential: string,
    abortController: AbortController,
    userApprovedUnknownCost: boolean,
  ): Promise<void> {
    try {
      const snapshotAtStart = this.#snapshot();
      const result = await this.#runner.run(plan, snapshotAtStart.baseUrl, credential, {
        afterExternalRequest: (step, observations) => {
          if (this.#accounting === null) return;
          const now = this.#now().toISOString();
          const executionId = `${runId}:${step.id}`;
          const ambiguous = observations.some((observation) =>
            ['AMBIGUOUS_OUTCOME', 'TIMEOUT'].includes(observation.reasonCode),
          );
          const first = observations[0];
          this.#accounting.settle({
            cache: null,
            comparisonEstimateMicroUsd: null,
            costAmountMicroUsd: null,
            costSource: 'NO_PRICE',
            costState: ambiguous ? 'UNKNOWN_POSSIBLY_INCURRED' : 'UNPRICED_USAGE',
            executionId,
            now,
            outcomeCertainty: ambiguous ? 'MAY_HAVE_EXECUTED' : 'COMPLETED_INVALID_OUTPUT',
            priceSchedule: null,
            status: ambiguous ? 'AMBIGUOUS' : 'SUCCEEDED',
            usage: {
              cacheWriteTokens: null,
              cachedInputTokens: null,
              imageGenerationCalls: step.kind === 'IMAGE' ? 1 : 0,
              images: first?.safeDetails.imageCount ?? (step.kind === 'IMAGE' ? 1 : 0),
              inputTokens: first?.safeDetails.inputTokens ?? null,
              outputTokens: first?.safeDetails.outputTokens ?? null,
              reasoningTokens: null,
              toolCalls: step.kind === 'TOOL' ? 1 : 0,
              totalTokens: first?.safeDetails.totalTokens ?? null,
              webSearchCalls: step.kind === 'WEB_SEARCH' ? 1 : 0,
            },
          });
        },
        beforeExternalRequest: (step) => {
          if (this.#accounting === null) return;
          const now = this.#now();
          this.#accounting.reserveAndCreateRun({
            billingMonth: now.toISOString().slice(0, 7),
            identity: this.#probeIdentity(runId, plan, step),
            now: now.toISOString(),
            reservedAmountMicroUsd: null,
            ...(userApprovedUnknownCost ? { userApprovedUnknownCost: true } : {}),
            unitDemandJson: JSON.stringify({
              externalCalls: 1,
              imageGenerationCalls: step.kind === 'IMAGE' ? 1 : 0,
              images: step.kind === 'IMAGE' ? 1 : 0,
              inputTokens: null,
              outputTokens: null,
              toolCalls: step.kind === 'TOOL' ? 1 : 0,
              webSearchCalls: step.kind === 'WEB_SEARCH' ? 1 : 0,
            }),
            weekKey: this.#utcWeekKey(now),
          });
        },
        isConfigCurrent: () => {
          try {
            const current = this.#snapshot();
            return (
              capabilityConfigFingerprint(current) === plan.configFingerprint &&
              current.credentialBindingVersion === plan.credentialBindingVersion
            );
          } catch {
            return false;
          }
        },
        now: this.#now,
        onObservation: (observation) => {
          this.#repository.recordObservation(runId, plan, observation, this.#now().toISOString());
        },
        onProgress: (progress) => this.#recordProgress(progress),
        runId,
        signal: abortController.signal,
      });
      if (result.status === 'SUCCEEDED') {
        this.#materializeNotProbed(runId, plan, snapshotAtStart);
      }
      this.#repository.finishRun(runId, result);
      const completed = this.#progress.get(runId);
      if (completed !== undefined) {
        this.#progress.set(runId, { ...completed, status: result.status });
      }
    } catch {
      const completedAt = this.#now().toISOString();
      try {
        this.#repository.finishRun(runId, {
          completedAt,
          reasonCode: 'INTERNAL_ERROR',
          sentRequestCount: this.#progress.get(runId)?.sentRequestCount ?? 0,
          status: 'FAILED',
        });
      } catch {
        // Startup recovery will mark a still-running record as interrupted.
      }
      const progress = this.#progress.get(runId);
      if (progress !== undefined) {
        this.#progress.set(runId, {
          ...progress,
          currentCapability: null,
          status: 'FAILED',
        });
      }
    } finally {
      if (this.#active?.runId === runId) {
        this.#active = null;
      }
    }
  }

  #recordProgress(progress: CapabilityProbeProgress): void {
    this.#progress.set(progress.runId, {
      completedRequestCount: progress.completedRequestCount,
      currentCapability: progress.currentCapability,
      plannedRequestCount: progress.plannedRequestCount,
      runId: progress.runId,
      sentRequestCount: progress.sentRequestCount,
      status: progress.status,
    });
  }

  #materializeNotProbed(
    runId: string,
    plan: CapabilityProbePlan,
    snapshot: CapabilityProbeConfigSnapshot,
  ): void {
    const mappings: readonly {
      readonly modelId: string | null;
      readonly slot: ProbeModelSlot;
    }[] = [
      { modelId: snapshot.models.provider, slot: 'PROVIDER' },
      { modelId: snapshot.models.research, slot: 'RESEARCH' },
      { modelId: snapshot.models.writing, slot: 'WRITING' },
      { modelId: snapshot.models.review, slot: 'REVIEW' },
      { modelId: snapshot.models.image, slot: 'IMAGE' },
    ];
    const plannedStructuredModes = Object.freeze(
      [
        ...new Set(
          plan.steps
            .filter((step) => step.capability === 'structuredJson')
            .map((step) => step.protocolMode),
        ),
      ].filter(
        (mode): mode is 'CHAT_COMPLETIONS' | 'RESPONSES' =>
          mode === 'RESPONSES' || mode === 'CHAT_COMPLETIONS',
      ),
    );
    const modesFor = (capability: ProbeCapability): readonly ProbeProtocolMode[] =>
      capability === 'text' || capability === 'usage'
        ? ['RESPONSES', 'CHAT_COMPLETIONS']
        : capability === 'structuredJson'
          ? plannedStructuredModes.length === 0
            ? ['RESPONSES']
            : plannedStructuredModes
          : capability === 'batch' || capability === 'imageGeneration'
            ? ['NOT_APPLICABLE']
            : ['RESPONSES'];
    for (const mapping of mappings) {
      if (mapping.modelId === null && mapping.slot !== 'PROVIDER') {
        continue;
      }
      for (const capability of PROBE_CAPABILITIES) {
        if (
          (capability === 'imageGeneration' && mapping.slot !== 'IMAGE') ||
          (capability === 'batch' && mapping.slot !== 'PROVIDER') ||
          (mapping.slot === 'IMAGE' && capability !== 'imageGeneration' && capability !== 'usage')
        ) {
          continue;
        }
        for (const protocolMode of modesFor(capability)) {
          const observation: CapabilityProbeObservation = {
            capability,
            confidence: 'INCONCLUSIVE',
            maxContextTokens: null,
            modelId: mapping.modelId,
            modelSlots: [mapping.slot],
            observedAt: null,
            protocolMode,
            rateLimitRequests: null,
            rateLimitTokens: null,
            reasonCode: 'NOT_PROBED',
            safeDetails: {},
            source: 'NOT_PROBED',
            state: 'UNKNOWN',
          };
          this.#repository.recordObservation(runId, plan, observation, this.#now().toISOString());
        }
      }
    }
  }

  #snapshot(): CapabilityProbeConfigSnapshot {
    const settings = this.#readSettings();
    if (
      settings.providerBaseUrl === null ||
      settings.researchModelId === null ||
      settings.writingModelId === null
    ) {
      throw new ProviderCapabilityControlError('PROBE_INVALID_REQUEST');
    }
    return {
      baseUrl: settings.providerBaseUrl,
      credentialBindingVersion: this.#repository.getCredentialBindingVersion(),
      models: {
        image: settings.imageModelId,
        provider: settings.researchModelId,
        research: settings.researchModelId,
        review: settings.reviewModelId,
        writing: settings.writingModelId,
      },
      protocol: settings.providerProtocol,
      settingsRevision: settings.revision,
    };
  }

  #probeUnitPolicyReady(plan: CapabilityProbePlan): boolean {
    return plan.steps.every(
      (step) =>
        this.#accounting?.findApplicableUnitPolicy(
          `CAPABILITY_PROBE_${step.kind}`,
          step.modelSlots[0] ?? 'PROVIDER',
        ) !== null,
    );
  }

  #probeIdentity(runId: string, plan: CapabilityProbePlan, step: CapabilityProbeStep) {
    const hash = (value: string): string =>
      createHash('sha256').update(value, 'utf8').digest('hex');
    return {
      cacheKey: hash(`probe-bypass:${plan.hash}:${step.id}`),
      cachePolicy: 'BYPASS' as const,
      executionId: `${runId}:${step.id}`,
      inputHash: hash(`probe-input:${step.id}`),
      jobId: null,
      modelId: step.modelId ?? 'provider-metadata',
      modelRole: step.modelSlots[0] ?? 'PROVIDER',
      modelSlot: step.modelSlots[0] ?? 'PROVIDER',
      promptContentHash: hash(`probe-prompt:${plan.contractVersion}:${step.kind}`),
      promptTemplateId: 'provider-capability-probe',
      promptVersion: 1,
      protocolMode:
        step.protocolMode === 'CHAT_COMPLETIONS'
          ? ('CHAT_COMPLETIONS' as const)
          : ('RESPONSES' as const),
      providerConfigFingerprint: plan.configFingerprint,
      taskKind: `CAPABILITY_PROBE_${step.kind}`,
    };
  }

  #utcWeekKey(now: Date): string {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  #removeExpiredLeases(): void {
    const now = this.#now().getTime();
    for (const [token, lease] of this.#leases) {
      if (lease.expiresAtMilliseconds < now) {
        this.#leases.delete(token);
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new ProviderCapabilityControlError('PROBE_INVALID_REQUEST');
    }
  }
}
