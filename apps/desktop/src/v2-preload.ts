import { contextBridge, ipcRenderer } from 'electron';

import {
  V2_IPC_CHANNELS,
  type AccountPersona,
  type V2Bridge,
  type V2Result,
  type WeeklyPlan,
} from '@mystery-operations/v2';

const bridge: V2Bridge = Object.freeze({
  confirmPlanCandidates: (input: Parameters<V2Bridge['confirmPlanCandidates']>[0]) =>
    ipcRenderer.invoke(V2_IPC_CHANNELS.mutate, {
      action: 'CONFIRM_PLAN_CANDIDATES',
      ...input,
    }) as Promise<V2Result<WeeklyPlan>>,
  readPersona: () =>
    ipcRenderer.invoke(V2_IPC_CHANNELS.read, {
      view: 'ACCOUNT_PERSONA',
    }) as Promise<V2Result<AccountPersona>>,
  readWeeklyPlan: (input: Parameters<V2Bridge['readWeeklyPlan']>[0]) =>
    ipcRenderer.invoke(V2_IPC_CHANNELS.read, {
      view: 'WEEKLY_PLAN',
      ...input,
    }) as Promise<V2Result<WeeklyPlan>>,
  reschedulePlanCandidates: (input: Parameters<V2Bridge['reschedulePlanCandidates']>[0]) =>
    ipcRenderer.invoke(V2_IPC_CHANNELS.mutate, {
      action: 'RESCHEDULE_PLAN_CANDIDATES',
      ...input,
    }) as Promise<V2Result<WeeklyPlan>>,
  updatePersona: (input: Parameters<V2Bridge['updatePersona']>[0]) =>
    ipcRenderer.invoke(V2_IPC_CHANNELS.mutate, {
      action: 'UPDATE_PERSONA',
      ...input,
    }) as Promise<V2Result<AccountPersona>>,
});

contextBridge.exposeInMainWorld('rednoteV2', bridge);
