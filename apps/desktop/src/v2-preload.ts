import { contextBridge, ipcRenderer } from 'electron';

import {
  V2_IPC_CHANNELS,
  type AccountPersona,
  type ContentExportResult,
  type ContentPackage,
  type ContentWorkspace,
  type V2ContentCopyGenerationPreview,
  type V2ContentCopyGenerationResult,
  type InteractionCreateResult,
  type InteractionDeletePreview,
  type InteractionItem,
  type InteractionWorkspace,
  type MetricSnapshot,
  type MetricsReview,
  type PlanReschedulePreview,
  type V2ProviderActionPreview,
  type V2ProviderActionResult,
  type V2CapabilityProbePreview,
  type V2CapabilityProbeProgress,
  type V2ProviderSettingsView,
  type V2Bridge,
  type V2Result,
  type WeeklyPlan,
} from '@mystery-operations/v2';

function invoke<T>(channel: keyof typeof V2_IPC_CHANNELS, request: object): Promise<V2Result<T>> {
  return ipcRenderer.invoke(V2_IPC_CHANNELS[channel], request) as Promise<V2Result<T>>;
}

const bridge: V2Bridge = Object.freeze({
  approveContentPackages: (input: Parameters<V2Bridge['approveContentPackages']>[0]) =>
    invoke<ContentWorkspace>('mutate', { action: 'APPROVE_CONTENT_PACKAGES', ...input }),
  confirmPlanCandidates: (input: Parameters<V2Bridge['confirmPlanCandidates']>[0]) =>
    invoke<WeeklyPlan>('mutate', {
      action: 'CONFIRM_PLAN_CANDIDATES',
      ...input,
    }),
  confirmProviderAction: (input: Parameters<NonNullable<V2Bridge['confirmProviderAction']>>[0]) =>
    invoke<V2ProviderActionResult>('mutate', { action: 'CONFIRM_PROVIDER_ACTION', ...input }),
  executeContentCopyGeneration: (
    input: Parameters<NonNullable<V2Bridge['executeContentCopyGeneration']>>[0],
  ) =>
    invoke<V2ContentCopyGenerationResult>('mutate', {
      action: 'EXECUTE_CONTENT_COPY_GENERATION',
      ...input,
    }),
  clearProviderCredential: (
    input: Parameters<NonNullable<V2Bridge['clearProviderCredential']>>[0],
  ) => invoke<V2ProviderSettingsView>('mutate', { action: 'CLEAR_PROVIDER_CREDENTIAL', ...input }),
  confirmReplySuggestions: (input: Parameters<V2Bridge['confirmReplySuggestions']>[0]) =>
    invoke<InteractionWorkspace>('mutate', { action: 'CONFIRM_REPLY_SUGGESTIONS', ...input }),
  createInteraction: (input: Parameters<V2Bridge['createInteraction']>[0]) =>
    invoke<InteractionCreateResult>('mutate', { action: 'CREATE_INTERACTION', ...input }),
  decideStrategyRecommendation: (input: {
    readonly expectedRevision: number;
    readonly id: string;
    readonly status: 'ACCEPTED' | 'REJECTED';
  }) => invoke<MetricsReview>('mutate', { action: 'DECIDE_STRATEGY_RECOMMENDATION', ...input }),
  deleteInteraction: (input: Parameters<V2Bridge['deleteInteraction']>[0]) =>
    invoke<InteractionWorkspace>('mutate', { action: 'DELETE_INTERACTION', ...input }),
  generateWeeklyPlan: (input: Parameters<V2Bridge['generateWeeklyPlan']>[0]) =>
    invoke<WeeklyPlan>('mutate', { action: 'GENERATE_WEEKLY_PLAN', ...input }),
  generateContentPackages: (input: Parameters<V2Bridge['generateContentPackages']>[0]) =>
    invoke<ContentWorkspace>('mutate', { action: 'GENERATE_CONTENT_PACKAGES', ...input }),
  generateReplySuggestion: (input: Parameters<V2Bridge['generateReplySuggestion']>[0]) =>
    invoke<InteractionItem>('mutate', { action: 'GENERATE_REPLY_SUGGESTION', ...input }),
  lockWeeklyPlan: (input: Parameters<V2Bridge['lockWeeklyPlan']>[0]) =>
    invoke<WeeklyPlan>('mutate', { action: 'LOCK_WEEKLY_PLAN', ...input }),
  unlockWeeklyPlan: (input: Parameters<V2Bridge['unlockWeeklyPlan']>[0]) =>
    invoke<WeeklyPlan>('mutate', { action: 'UNLOCK_WEEKLY_PLAN', ...input }),
  previewPlanReschedule: (input: Parameters<V2Bridge['previewPlanReschedule']>[0]) =>
    invoke<PlanReschedulePreview>('read', {
      view: 'PLAN_RESCHEDULE_PREVIEW',
      ...input,
    }),
  previewProviderAction: (input: Parameters<NonNullable<V2Bridge['previewProviderAction']>>[0]) =>
    invoke<V2ProviderActionPreview>('read', { intent: input, view: 'PROVIDER_ACTION_PREVIEW' }),
  previewContentCopyGeneration: (
    input: Parameters<NonNullable<V2Bridge['previewContentCopyGeneration']>>[0],
  ) =>
    invoke<V2ContentCopyGenerationPreview>('read', {
      ...input,
      view: 'CONTENT_COPY_GENERATION_PREVIEW',
    }),
  previewProviderCapabilityProbe: () =>
    invoke<V2CapabilityProbePreview>('read', { view: 'PROVIDER_CAPABILITY_PROBE_PREVIEW' }),
  exportContentPackages: (input: Parameters<V2Bridge['exportContentPackages']>[0]) =>
    invoke<ContentExportResult>('mutate', { action: 'EXPORT_CONTENT_PACKAGES', ...input }),
  openContentExport: (input: Parameters<V2Bridge['openContentExport']>[0]) =>
    invoke<{ readonly opened: true }>('mutate', { action: 'OPEN_CONTENT_EXPORT', ...input }),
  markInteractionManualSent: (input: Parameters<V2Bridge['markInteractionManualSent']>[0]) =>
    invoke<InteractionItem>('mutate', { action: 'MARK_INTERACTION_MANUAL_SENT', ...input }),
  previewInteractionDelete: (input: Parameters<V2Bridge['previewInteractionDelete']>[0]) =>
    invoke<InteractionDeletePreview>('read', { view: 'INTERACTION_DELETE_PREVIEW', ...input }),
  readContentPackages: (input: Parameters<V2Bridge['readContentPackages']>[0]) =>
    invoke<ContentWorkspace>('read', { view: 'CONTENT_PACKAGES', ...input }),
  readInteractions: () => invoke<InteractionWorkspace>('read', { view: 'INTERACTIONS' }),
  readMetricsReview: (input: { readonly snapshotWindow: '24H' | '72H' | '7D' }) =>
    invoke<MetricsReview>('read', { view: 'METRICS_REVIEW', ...input }),
  readPersona: () => invoke<AccountPersona>('read', { view: 'ACCOUNT_PERSONA' }),
  readProviderCapabilityProbeProgress: (
    input: Parameters<NonNullable<V2Bridge['readProviderCapabilityProbeProgress']>>[0],
  ) =>
    invoke<V2CapabilityProbeProgress>('read', {
      runId: input.runId,
      view: 'PROVIDER_CAPABILITY_PROBE_PROGRESS',
    }),
  readProviderSettings: () => invoke<V2ProviderSettingsView>('read', { view: 'PROVIDER_SETTINGS' }),
  readWeeklyPlan: (input: Parameters<V2Bridge['readWeeklyPlan']>[0]) =>
    invoke<WeeklyPlan>('read', { view: 'WEEKLY_PLAN', ...input }),
  reschedulePlanCandidates: (input: Parameters<V2Bridge['reschedulePlanCandidates']>[0]) =>
    invoke<WeeklyPlan>('mutate', {
      action: 'RESCHEDULE_PLAN_CANDIDATES',
      ...input,
    }),
  reopenInteraction: (input: Parameters<V2Bridge['reopenInteraction']>[0]) =>
    invoke<InteractionItem>('mutate', { action: 'REOPEN_INTERACTION', ...input }),
  saveReplySuggestion: (input: Parameters<V2Bridge['saveReplySuggestion']>[0]) =>
    invoke<InteractionItem>('mutate', { action: 'SAVE_REPLY_SUGGESTION', ...input }),
  saveContentPackage: (input: Parameters<V2Bridge['saveContentPackage']>[0]) =>
    invoke<ContentPackage>('mutate', { action: 'SAVE_CONTENT_PACKAGE', ...input }),
  saveMetricSnapshots: (input: {
    readonly snapshots: readonly Omit<MetricSnapshot, 'revision'>[];
  }) => invoke<MetricsReview>('mutate', { action: 'SAVE_METRIC_SNAPSHOTS', ...input }),
  skipPlanCandidates: (input: Parameters<V2Bridge['skipPlanCandidates']>[0]) =>
    invoke<WeeklyPlan>('mutate', { action: 'SKIP_PLAN_CANDIDATES', ...input }),
  skipInteraction: (input: Parameters<V2Bridge['skipInteraction']>[0]) =>
    invoke<InteractionItem>('mutate', { action: 'SKIP_INTERACTION', ...input }),
  setProviderCredential: (input: Parameters<NonNullable<V2Bridge['setProviderCredential']>>[0]) =>
    invoke<V2ProviderSettingsView>('mutate', { action: 'SET_PROVIDER_CREDENTIAL', ...input }),
  startProviderCapabilityProbe: (
    input: Parameters<NonNullable<V2Bridge['startProviderCapabilityProbe']>>[0],
  ) =>
    invoke<V2CapabilityProbeProgress>('mutate', {
      action: 'START_PROVIDER_CAPABILITY_PROBE',
      ...input,
    }),
  undoInteractionManualSent: (input: Parameters<V2Bridge['undoInteractionManualSent']>[0]) =>
    invoke<InteractionItem>('mutate', { action: 'UNDO_INTERACTION_MANUAL_SENT', ...input }),
  updatePersona: (input: Parameters<V2Bridge['updatePersona']>[0]) =>
    invoke<AccountPersona>('mutate', { action: 'UPDATE_PERSONA', ...input }),
  updateProviderSettings: (input: Parameters<NonNullable<V2Bridge['updateProviderSettings']>>[0]) =>
    invoke<V2ProviderSettingsView>('mutate', { action: 'UPDATE_PROVIDER_SETTINGS', ...input }),
});

contextBridge.exposeInMainWorld('rednoteV2', bridge);
