import { contextBridge, ipcRenderer } from 'electron';

import {
  V2_IPC_CHANNELS,
  type AccountPersona,
  type ContentExportResult,
  type ContentPackage,
  type ContentWorkspace,
  type PlanReschedulePreview,
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
  generateWeeklyPlan: (input: Parameters<V2Bridge['generateWeeklyPlan']>[0]) =>
    invoke<WeeklyPlan>('mutate', { action: 'GENERATE_WEEKLY_PLAN', ...input }),
  generateContentPackages: (input: Parameters<V2Bridge['generateContentPackages']>[0]) =>
    invoke<ContentWorkspace>('mutate', { action: 'GENERATE_CONTENT_PACKAGES', ...input }),
  lockWeeklyPlan: (input: Parameters<V2Bridge['lockWeeklyPlan']>[0]) =>
    invoke<WeeklyPlan>('mutate', { action: 'LOCK_WEEKLY_PLAN', ...input }),
  previewPlanReschedule: (input: Parameters<V2Bridge['previewPlanReschedule']>[0]) =>
    invoke<PlanReschedulePreview>('read', {
      view: 'PLAN_RESCHEDULE_PREVIEW',
      ...input,
    }),
  exportContentPackages: (input: Parameters<V2Bridge['exportContentPackages']>[0]) =>
    invoke<ContentExportResult>('mutate', { action: 'EXPORT_CONTENT_PACKAGES', ...input }),
  openContentExport: (input: Parameters<V2Bridge['openContentExport']>[0]) =>
    invoke<{ readonly opened: true }>('mutate', { action: 'OPEN_CONTENT_EXPORT', ...input }),
  readContentPackages: (input: Parameters<V2Bridge['readContentPackages']>[0]) =>
    invoke<ContentWorkspace>('read', { view: 'CONTENT_PACKAGES', ...input }),
  readPersona: () => invoke<AccountPersona>('read', { view: 'ACCOUNT_PERSONA' }),
  readWeeklyPlan: (input: Parameters<V2Bridge['readWeeklyPlan']>[0]) =>
    invoke<WeeklyPlan>('read', { view: 'WEEKLY_PLAN', ...input }),
  reschedulePlanCandidates: (input: Parameters<V2Bridge['reschedulePlanCandidates']>[0]) =>
    invoke<WeeklyPlan>('mutate', {
      action: 'RESCHEDULE_PLAN_CANDIDATES',
      ...input,
    }),
  saveContentPackage: (input: Parameters<V2Bridge['saveContentPackage']>[0]) =>
    invoke<ContentPackage>('mutate', { action: 'SAVE_CONTENT_PACKAGE', ...input }),
  skipPlanCandidates: (input: Parameters<V2Bridge['skipPlanCandidates']>[0]) =>
    invoke<WeeklyPlan>('mutate', { action: 'SKIP_PLAN_CANDIDATES', ...input }),
  updatePersona: (input: Parameters<V2Bridge['updatePersona']>[0]) =>
    invoke<AccountPersona>('mutate', { action: 'UPDATE_PERSONA', ...input }),
});

contextBridge.exposeInMainWorld('rednoteV2', bridge);
