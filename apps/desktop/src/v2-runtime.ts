import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';

import { connectDatabase, initializeDatabase, SqliteV2Repository } from '@mystery-operations/db';
import { initializeProjectDataRoot } from '@mystery-operations/storage';
import {
  V2ApplicationFacade,
  V2ContentApplication,
  V2ContractError,
  V2InteractionApplication,
  V2_IPC_CHANNELS,
  isInteractionMutationRequest,
  parseV2MutationRequest,
  parseV2ReadRequest,
  toV2Exception,
  type AccountPersona,
  deterministicReview,
  type MetricWindow,
  type MetricsReview,
  V2_PROVIDER_ACTION_LIMITS,
  V2ProviderActionError,
  parseContentPackageFields,
  providerActionModelSlot,
  providerActionSummary,
  type V2ProviderActionExecutionRequest,
  type V2ProviderActionExecutionResult,
  type V2ProviderActionIntent,
  type V2ProviderActionPreview,
  type V2ProviderActionReadiness,
  type V2ProviderActionResult,
  type V2CapabilityProbePreview,
  type V2CapabilityProbeProgress,
  type V2ProviderSettingsDraft,
  type V2ProviderSettingsView,
  type V2Result,
  type WeeklyPlan,
} from '@mystery-operations/v2';

import { discoverApprovedV2Covers, V2LocalContentFiles } from './v2-content-files.js';
import { V2LocalInteractionFiles } from './v2-interaction-files.js';

const V2_DATA_ROOT_DIRECTORY = 'v2-project-data';
const PROJECT_DATABASE_FILE = 'rednote.sqlite';

export interface V2ActionCaller {
  readonly senderId: number;
  readonly windowId: number;
}

export interface V2ProviderExecutionPort {
  execute(request: V2ProviderActionExecutionRequest): Promise<V2ProviderActionExecutionResult>;
  inspect(
    request: Omit<V2ProviderActionExecutionRequest, 'executionId'>,
  ): Promise<V2ProviderActionReadiness>;
}

export interface V2SettingsControlPort {
  clearCredential(): Promise<V2ProviderSettingsView>;
  getCapabilityProgress(runId: string): V2CapabilityProbeProgress;
  getSettings(): Promise<V2ProviderSettingsView>;
  previewCapabilityProbe(caller: V2ActionCaller): V2CapabilityProbePreview;
  setCredential(plaintext: string): Promise<V2ProviderSettingsView>;
  startCapabilityProbe(
    input: {
      readonly confirmation: 'START_PROVIDER_CAPABILITY_PROBE';
      readonly credentialBindingVersion: number;
      readonly planHash: string;
      readonly settingsRevision: number;
      readonly startToken: string;
      readonly userApprovedUnknownCost: boolean;
    },
    caller: V2ActionCaller,
  ): Promise<V2CapabilityProbeProgress>;
  updateSettings(input: V2ProviderSettingsDraft): Promise<V2ProviderSettingsView>;
}

interface ProviderPreviewLease {
  readonly caller: V2ActionCaller;
  readonly expiresAtMs: number;
  readonly intent: V2ProviderActionIntent;
  readonly inputHash: string;
  readonly readinessBinding: string;
}

function providerInputHash(input: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

const unavailableProviderExecution: V2ProviderExecutionPort = {
  execute: async () => ({
    costAmountMicroUsd: null,
    costState: 'NOT_INCURRED',
    externalRequestCount: 0,
    outcomeCertainty: 'NOT_SENT',
    output: null,
    stableErrorCode: 'PROVIDER_NOT_CONFIGURED',
    status: 'BLOCKED',
    modelRunId: null,
  }),
  inspect: async (request) => ({
    blockReasons: ['本机 Provider runtime 不可用。'],
    budgetState: 'UNKNOWN',
    canConfirm: false,
    capabilityState: 'UNKNOWN',
    credentialState: 'NOT_CONFIGURED',
    feeEstimateMicroUsd: null,
    modelId: null,
    modelSlot: request.modelSlot,
    providerConfigured: false,
    unknownCostApproved: request.userApprovedUnknownCost === true,
  }),
};

const unavailableSettingsControl: V2SettingsControlPort = {
  clearCredential: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  getCapabilityProgress: () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  getSettings: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  previewCapabilityProbe: () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  setCredential: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  startCapabilityProbe: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
  updateSettings: async () => {
    throw new V2ContractError('SETTINGS_NOT_READY');
  },
};

export class V2DesktopRuntime {
  readonly #database: DatabaseSync;
  readonly #content: V2ContentApplication;
  readonly #facade: V2ApplicationFacade;
  readonly #interaction: V2InteractionApplication;
  readonly #repository: SqliteV2Repository;
  readonly #providerExecution: V2ProviderExecutionPort;
  readonly #settingsControl: V2SettingsControlPort;
  readonly #providerPreviews = new Map<string, ProviderPreviewLease>();
  #closed = false;

  private constructor(
    database: DatabaseSync,
    contentFiles: V2LocalContentFiles,
    interactionFiles: V2LocalInteractionFiles,
    providerExecution: V2ProviderExecutionPort,
    settingsControl: V2SettingsControlPort,
  ) {
    this.#database = database;
    this.#repository = new SqliteV2Repository(database);
    this.#facade = new V2ApplicationFacade(this.#repository);
    this.#content = new V2ContentApplication(this.#repository, contentFiles);
    this.#interaction = new V2InteractionApplication(this.#repository, interactionFiles);
    this.#providerExecution = providerExecution;
    this.#settingsControl = settingsControl;
  }

  public static async open(
    userDataPath: string,
    options: {
      readonly assetsDirectory?: string;
      readonly openDirectory?: (path: string) => Promise<string>;
      readonly providerExecution?: V2ProviderExecutionPort;
      readonly settingsControl?: V2SettingsControlPort;
    } = {},
  ): Promise<V2DesktopRuntime> {
    const root = await initializeProjectDataRoot(join(userDataPath, V2_DATA_ROOT_DIRECTORY));
    const databasePath = join(root.databaseDirectory, PROJECT_DATABASE_FILE);
    await initializeDatabase({
      backupDirectory: root.backupDatabaseDirectory,
      databasePath,
    });
    const assetsDirectory =
      options.assetsDirectory ?? join(app.getAppPath(), '.vite', 'renderer', 'assets');
    const contentFiles = new V2LocalContentFiles(
      root,
      await discoverApprovedV2Covers(assetsDirectory),
      { openDirectory: options.openDirectory ?? ((path) => shell.openPath(path)) },
    );
    return new V2DesktopRuntime(
      connectDatabase(databasePath),
      contentFiles,
      new V2LocalInteractionFiles(root),
      options.providerExecution ?? unavailableProviderExecution,
      options.settingsControl ?? unavailableSettingsControl,
    );
  }

  public async read(input: unknown, caller?: V2ActionCaller) {
    this.#assertOpen();
    const request = parseV2ReadRequest(input);
    if (request.view === 'PROVIDER_ACTION_PREVIEW') {
      if (caller === undefined) throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
      return this.#previewProviderAction(request.intent, caller);
    }
    if (request.view === 'PROVIDER_SETTINGS') {
      return this.#settingsOperation(() => this.#settingsControl.getSettings());
    }
    if (request.view === 'PROVIDER_CAPABILITY_PROBE_PREVIEW') {
      if (caller === undefined) throw new V2ContractError('CAPABILITY_PROBE_BLOCKED');
      return this.#settingsOperation(() => this.#settingsControl.previewCapabilityProbe(caller));
    }
    if (request.view === 'PROVIDER_CAPABILITY_PROBE_PROGRESS') {
      return this.#settingsOperation(() =>
        this.#settingsControl.getCapabilityProgress(request.runId),
      );
    }
    if (request.view === 'CONTENT_PACKAGES') return this.#content.read(request.weekKey);
    if (request.view === 'INTERACTIONS') return this.#interaction.read();
    if (request.view === 'INTERACTION_DELETE_PREVIEW')
      return this.#interaction.previewDelete(request.itemId);
    if (request.view === 'METRICS_REVIEW') return this.#metricsReview(request.snapshotWindow);
    return this.#facade.read(request);
  }

  public async mutate(input: unknown, caller?: V2ActionCaller) {
    this.#assertOpen();
    const request = parseV2MutationRequest(input);
    if (request.action === 'CONFIRM_PROVIDER_ACTION') {
      if (caller === undefined) throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
      return this.#confirmProviderAction(request.previewToken, caller);
    }
    if (request.action === 'UPDATE_PROVIDER_SETTINGS') {
      return this.#settingsOperation(() => this.#settingsControl.updateSettings(request));
    }
    if (request.action === 'SET_PROVIDER_CREDENTIAL') {
      return this.#settingsOperation(() => this.#settingsControl.setCredential(request.plaintext));
    }
    if (request.action === 'CLEAR_PROVIDER_CREDENTIAL') {
      return this.#settingsOperation(() => this.#settingsControl.clearCredential());
    }
    if (request.action === 'START_PROVIDER_CAPABILITY_PROBE') {
      if (caller === undefined) throw new V2ContractError('CAPABILITY_PROBE_BLOCKED');
      return this.#settingsOperation(() =>
        this.#settingsControl.startCapabilityProbe(request, caller),
      );
    }
    if (isInteractionMutationRequest(request)) {
      const persona = this.#facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
      return this.#interaction.mutate(request, persona);
    }
    if (request.action === 'GENERATE_CONTENT_PACKAGES') {
      const persona = this.#facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: request.weekKey,
      }) as WeeklyPlan;
      return this.#content.generate(request, persona, plan);
    }
    if (request.action === 'SAVE_CONTENT_PACKAGE') return this.#content.save(request);
    if (request.action === 'APPROVE_CONTENT_PACKAGES') return this.#content.approve(request.items);
    if (request.action === 'EXPORT_CONTENT_PACKAGES')
      return this.#content.export(request.items, request.idempotencyKey);
    if (request.action === 'OPEN_CONTENT_EXPORT') {
      await this.#content.openExport(request.exportId);
      return { opened: true };
    }
    if (request.action === 'SAVE_METRIC_SNAPSHOTS') {
      this.#repository.saveMetricSnapshots(request.snapshots);
      const firstSnapshot = request.snapshots.at(0);
      if (firstSnapshot === undefined) throw new V2ContractError('INVALID_REQUEST');
      return this.#metricsReview(firstSnapshot.snapshotWindow);
    }
    if (request.action === 'DECIDE_STRATEGY_RECOMMENDATION') {
      if (request.status === 'PENDING') throw new V2ContractError('INVALID_REQUEST');
      this.#repository.decision(request.id, request.status, request.expectedRevision);
      return this.#metricsReview('7D');
    }
    return this.#facade.mutate(request);
  }

  async #settingsOperation<T>(operation: () => Promise<T> | T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof V2ContractError) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { readonly code: unknown }).code)
          : '';
      if (code.includes('CREDENTIAL') || code.includes('ENCRYPTION')) {
        throw new V2ContractError('CREDENTIAL_ERROR');
      }
      if (code.includes('PROBE') || code.includes('CAPABILITY') || code.includes('BUDGET')) {
        throw new V2ContractError('CAPABILITY_PROBE_BLOCKED');
      }
      if (code.includes('SETUP') || code.includes('PROJECT') || code.includes('DATA_ROOT')) {
        throw new V2ContractError('SETTINGS_NOT_READY');
      }
      throw new V2ContractError('SETTINGS_INVALID');
    }
  }

  public smokeSummary() {
    this.#assertOpen();
    return this.#repository.summary();
  }

  public readGeneratedCover(packageId: string, version: number): Promise<Uint8Array | null> {
    this.#assertOpen();
    return this.#content.readGeneratedCover(packageId, version);
  }

  public close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#providerPreviews.clear();
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('V2_RUNTIME_CLOSED');
  }

  async #metricsReview(snapshotWindow: MetricWindow): Promise<MetricsReview> {
    const workspace = await this.#content.read('2026-W01');
    const titles = new Map(workspace.packages.map((item) => [item.id, item.fields.title]));
    const review = deterministicReview(
      this.#repository.listMetricSnapshots(),
      titles,
      snapshotWindow,
    );
    const decisions = this.#repository.syncStrategyRecommendations(review.recommendations);
    return {
      ...review,
      recommendations: review.recommendations.map((item) => {
        const decision = decisions.get(item.id);
        return decision === undefined ? item : { ...item, status: decision.status };
      }),
    } as MetricsReview;
  }

  async #previewProviderAction(
    intent: V2ProviderActionIntent,
    caller: V2ActionCaller,
  ): Promise<V2ProviderActionPreview> {
    this.#removeExpiredProviderPreviews();
    let input: Readonly<Record<string, unknown>> = Object.freeze({});
    let businessBlock: string | null = null;
    try {
      input = await this.#providerInput(intent);
    } catch (error) {
      if (!(error instanceof V2ProviderActionError)) throw error;
      businessBlock =
        intent.kind === 'CONTENT_PACKAGES'
          ? '请先锁定计划并选择 3 个尚未生成内容包的候选。'
          : intent.kind === 'REPLY_SUGGESTION'
            ? '当前互动状态不能生成回复建议。'
            : '目标周计划已变化，请重新载入后再预览。';
    }
    const readiness = await this.#providerExecution.inspect({
      input,
      kind: intent.kind,
      modelSlot: providerActionModelSlot(intent.kind),
      userApprovedUnknownCost: intent.userApprovedUnknownCost === true,
    });
    const canConfirm = businessBlock === null && readiness.canConfirm;
    const previewToken = canConfirm ? randomBytes(32).toString('base64url') : null;
    const expiresAtMs = Date.now() + V2_PROVIDER_ACTION_LIMITS.tokenTtlMs;
    if (previewToken !== null) {
      this.#providerPreviews.set(previewToken, {
        caller,
        expiresAtMs,
        intent,
        inputHash: providerInputHash(input),
        readinessBinding: JSON.stringify({
          capabilityState: readiness.capabilityState,
          credentialState: readiness.credentialState,
          feeEstimateMicroUsd: readiness.feeEstimateMicroUsd,
          modelId: readiness.modelId,
          providerConfigured: readiness.providerConfigured,
        }),
      });
    }
    return Object.freeze({
      ...readiness,
      blockReasons:
        businessBlock === null
          ? readiness.blockReasons
          : [businessBlock, ...readiness.blockReasons],
      canConfirm,
      expiresAt: new Date(expiresAtMs).toISOString(),
      fetchEnabled: false,
      kind: intent.kind,
      previewToken,
      requestCount: 1,
      searchEnabled: false,
      summary: providerActionSummary(intent.kind),
    });
  }

  async #confirmProviderAction(
    previewToken: string,
    caller: V2ActionCaller,
  ): Promise<V2ProviderActionResult> {
    const lease = this.#providerPreviews.get(previewToken);
    this.#providerPreviews.delete(previewToken);
    if (
      lease === undefined ||
      lease.expiresAtMs < Date.now() ||
      lease.caller.senderId !== caller.senderId ||
      lease.caller.windowId !== caller.windowId
    ) {
      throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
    }
    const input = await this.#providerInput(lease.intent);
    const currentReadiness = await this.#providerExecution.inspect({
      input,
      kind: lease.intent.kind,
      modelSlot: providerActionModelSlot(lease.intent.kind),
      userApprovedUnknownCost: lease.intent.userApprovedUnknownCost === true,
    });
    const currentBinding = JSON.stringify({
      capabilityState: currentReadiness.capabilityState,
      credentialState: currentReadiness.credentialState,
      feeEstimateMicroUsd: currentReadiness.feeEstimateMicroUsd,
      modelId: currentReadiness.modelId,
      providerConfigured: currentReadiness.providerConfigured,
    });
    if (
      !currentReadiness.canConfirm ||
      providerInputHash(input) !== lease.inputHash ||
      currentBinding !== lease.readinessBinding
    )
      throw new V2ProviderActionError('PROVIDER_ACTION_STALE');
    const executed = await this.#providerExecution.execute({
      executionId: `v2-r07-${randomUUID()}`,
      input,
      kind: lease.intent.kind,
      modelSlot: providerActionModelSlot(lease.intent.kind),
      userApprovedUnknownCost: lease.intent.userApprovedUnknownCost === true,
    });
    if (executed.externalRequestCount > 1) {
      throw new V2ProviderActionError('PROVIDER_ACTION_UNCERTAIN');
    }
    if (executed.status === 'OUTCOME_UNCERTAIN') {
      throw new V2ProviderActionError('PROVIDER_ACTION_UNCERTAIN');
    }
    if (executed.status === 'CANCELLED') {
      throw new V2ProviderActionError('PROVIDER_ACTION_CANCELLED');
    }
    if (executed.status !== 'SUCCEEDED') {
      throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED');
    }
    await this.#persistProviderOutput(lease.intent, executed.output, executed.modelRunId ?? null);
    return Object.freeze({
      costAmountMicroUsd: executed.costAmountMicroUsd,
      costState: executed.costState,
      externalRequestCount: executed.externalRequestCount,
      kind: lease.intent.kind,
      status: 'SUCCEEDED',
    });
  }

  async #providerInput(intent: V2ProviderActionIntent): Promise<Readonly<Record<string, unknown>>> {
    const persona = this.#facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
    if (intent.kind === 'WEEKLY_PLAN') {
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: intent.weekKey,
      }) as WeeklyPlan;
      if (plan.revision !== intent.expectedRevision || plan.status !== 'DRAFT') {
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['weeklyPlan']);
      }
      return Object.freeze({ persona, plan, weekKey: intent.weekKey });
    }
    if (intent.kind === 'CONTENT_PACKAGES') {
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: intent.weekKey,
      }) as WeeklyPlan;
      const existing = await this.#content.read(intent.weekKey);
      if (
        plan.revision !== intent.expectedPlanRevision ||
        plan.status !== 'CONFIRMED' ||
        intent.candidateIds.some((id) => !plan.candidates.some((item) => item.id === id)) ||
        existing.packages.some((item) => intent.candidateIds.includes(item.candidateId))
      ) {
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['weeklyPlan']);
      }
      return Object.freeze({
        candidates: plan.candidates.filter((item) => intent.candidateIds.includes(item.id)),
        persona,
        weekKey: intent.weekKey,
      });
    }
    if (intent.kind === 'CONTENT_COPY_VERSION') {
      const workspace = await this.#content.read(intent.weekKey);
      const contentPackages = intent.items.map((ref) => {
        const current = workspace.packages.find((item) => item.id === ref.packageId);
        if (
          current === undefined ||
          current.revision !== ref.expectedRevision ||
          current.versionId !== ref.expectedVersionId
        )
          throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['contentPackage']);
        return current;
      });
      return Object.freeze({ contentPackages: Object.freeze(contentPackages), persona });
    }
    if (intent.kind === 'CONTENT_COVER') {
      const workspace = await this.#content.read(intent.weekKey);
      const current = workspace.packages.find((item) => item.id === intent.packageId);
      if (
        current === undefined ||
        current.revision !== intent.expectedRevision ||
        current.versionId !== intent.expectedVersionId
      )
        throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['contentPackage']);
      return Object.freeze({ contentPackage: current, persona });
    }
    if (intent.kind !== 'REPLY_SUGGESTION')
      throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED');
    const workspace = await this.#interaction.read();
    const item = workspace.items.find((candidate) => candidate.itemId === intent.itemId);
    if (item === undefined || item.revision !== intent.expectedRevision || item.status !== 'NEW') {
      throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['interaction']);
    }
    return Object.freeze({ interaction: item, persona });
  }

  async #persistProviderOutput(
    intent: V2ProviderActionIntent,
    output: unknown,
    modelRunId: string | null,
  ): Promise<void> {
    if (typeof output !== 'object' || output === null || Array.isArray(output)) {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID');
    }
    const value = output as Readonly<Record<string, unknown>>;
    if (intent.kind === 'WEEKLY_PLAN') {
      if (Object.keys(value).length !== 1 || !('candidates' in value))
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidates']);
      this.#facade.applyGeneratedWeeklyPlan(
        intent.weekKey,
        intent.expectedRevision,
        value.candidates,
      );
      return;
    }
    if (intent.kind === 'CONTENT_COPY_VERSION') {
      if (modelRunId === null)
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['modelRunId']);
      if (
        Object.keys(value).length !== 1 ||
        !Array.isArray(value.packages) ||
        value.packages.length !== intent.items.length
      )
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
      for (const [index, ref] of intent.items.entries()) {
        await this.#content.appendModelCopy(
          ref.packageId,
          ref.expectedRevision,
          ref.expectedVersionId,
          value.packages[index],
          modelRunId,
        );
      }
      return;
    }
    if (intent.kind === 'CONTENT_COVER') {
      if (modelRunId === null)
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['modelRunId']);
      if (typeof value.base64 !== 'string' || value.mimeType !== 'image/png')
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['cover']);
      await this.#content.appendGeneratedCover(
        intent.packageId,
        intent.expectedRevision,
        intent.expectedVersionId,
        Buffer.from(value.base64, 'base64'),
        modelRunId,
      );
      return;
    }
    if (intent.kind === 'CONTENT_PACKAGES') {
      if (
        Object.keys(value).length !== 1 ||
        !Array.isArray(value.packages) ||
        value.packages.length !== 3
      ) {
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
      }
      let fields;
      try {
        fields = value.packages.map(parseContentPackageFields);
      } catch {
        throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
      }
      const plan = this.#facade.read({
        view: 'WEEKLY_PLAN',
        weekKey: intent.weekKey,
      }) as WeeklyPlan;
      await this.#content.generateFromFields(
        {
          action: 'GENERATE_CONTENT_PACKAGES',
          candidateIds: intent.candidateIds,
          expectedPlanRevision: intent.expectedPlanRevision,
          idempotencyKey: intent.idempotencyKey,
          weekKey: intent.weekKey,
        },
        plan,
        fields,
      );
      return;
    }
    if (
      intent.kind !== 'REPLY_SUGGESTION' ||
      Object.keys(value).length !== 1 ||
      typeof value.replyText !== 'string'
    ) {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['replyText']);
    }
    await this.#interaction.generateFromReply(
      {
        action: 'GENERATE_REPLY_SUGGESTION',
        expectedRevision: intent.expectedRevision,
        idempotencyKey: intent.idempotencyKey,
        itemId: intent.itemId,
      },
      value.replyText,
      modelRunId,
    );
  }

  #removeExpiredProviderPreviews(): void {
    const now = Date.now();
    for (const [token, lease] of this.#providerPreviews) {
      if (lease.expiresAtMs < now) this.#providerPreviews.delete(token);
    }
  }
}

export function isTrustedV2IpcSender(
  event: IpcMainInvokeEvent,
  expectedRendererUrl: string,
  expectedWindow: BrowserWindow | null,
): boolean {
  const senderFrame = event.senderFrame;
  const owningWindow = BrowserWindow.fromWebContents(event.sender);
  if (
    senderFrame === null ||
    senderFrame !== event.sender.mainFrame ||
    expectedWindow === null ||
    owningWindow !== expectedWindow
  ) {
    return false;
  }
  try {
    const actual = new URL(senderFrame.url);
    const expected = new URL(expectedRendererUrl);
    return (
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      (actual.search === '' || actual.search === '?smoke=1') &&
      actual.username === '' &&
      actual.password === ''
    );
  } catch {
    return false;
  }
}

export function registerV2Ipc(options: {
  readonly expectedRendererUrl: string;
  readonly getWindow: () => BrowserWindow | null;
  readonly runtime: V2DesktopRuntime;
}): () => void {
  const caller = (event: IpcMainInvokeEvent): V2ActionCaller => ({
    senderId: event.sender.id,
    windowId: options.getWindow()?.id ?? -1,
  });
  ipcMain.removeHandler(V2_IPC_CHANNELS.read);
  ipcMain.removeHandler(V2_IPC_CHANNELS.mutate);
  const register = (
    channel: string,
    action: (input: unknown, caller: V2ActionCaller) => Promise<unknown>,
  ): void => {
    ipcMain.handle(
      channel,
      async (event, ...args: readonly unknown[]): Promise<V2Result<unknown>> => {
        if (
          args.length !== 1 ||
          !isTrustedV2IpcSender(event, options.expectedRendererUrl, options.getWindow())
        ) {
          return { error: toV2Exception(new V2ContractError('INVALID_REQUEST')), ok: false };
        }
        try {
          return { ok: true, value: await action(args[0], caller(event)) };
        } catch (error) {
          return { error: toV2Exception(error), ok: false };
        }
      },
    );
  };
  register(V2_IPC_CHANNELS.read, (input, requestCaller) =>
    options.runtime.read(input, requestCaller),
  );
  register(V2_IPC_CHANNELS.mutate, (input, requestCaller) =>
    options.runtime.mutate(input, requestCaller),
  );
  return () => {
    ipcMain.removeHandler(V2_IPC_CHANNELS.read);
    ipcMain.removeHandler(V2_IPC_CHANNELS.mutate);
  };
}
