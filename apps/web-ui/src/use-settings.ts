import { useCallback, useEffect, useState } from 'react';

import type {
  DesktopError,
  NonSecretSettingsDraft,
  SettingsBundle,
  SetupStateView,
} from '@mystery-operations/shared';

type SettingsPageState =
  | { readonly phase: 'loading' }
  | { readonly error: DesktopError; readonly phase: 'error' }
  | { readonly phase: 'empty'; readonly setup: SetupStateView }
  | { readonly phase: 'recovery'; readonly setup: SetupStateView }
  | {
      readonly bundle: SettingsBundle;
      readonly phase: 'ready';
      readonly setup: SetupStateView;
    };

export interface SettingsController {
  readonly refresh: () => Promise<void>;
  readonly state: SettingsPageState;
  readonly update: (draft: NonSecretSettingsDraft) => Promise<SettingsBundle>;
}

const BRIDGE_ERROR: DesktopError = {
  code: 'INTERNAL_ERROR',
  message: '桌面设置接口不可用。',
  retryable: false,
};

export function useSettings(): SettingsController {
  const [state, setState] = useState<SettingsPageState>({ phase: 'loading' });

  const refresh = useCallback(async (): Promise<void> => {
    const bridge = window.rednoteDesktop;
    if (bridge === undefined) {
      setState({ error: BRIDGE_ERROR, phase: 'error' });
      return;
    }
    const setup = await bridge.getSetupState();
    if (!setup.ok) {
      setState({ error: setup.error, phase: 'error' });
      return;
    }
    if (setup.value.project.status === 'RECOVERY_REQUIRED') {
      setState({ phase: 'recovery', setup: setup.value });
      return;
    }
    if (setup.value.project.status === 'NOT_CONFIGURED') {
      setState({ phase: 'empty', setup: setup.value });
      return;
    }
    const settings = await bridge.getSettings();
    if (!settings.ok) {
      setState({ error: settings.error, phase: 'error' });
      return;
    }
    setState({ bundle: settings.value, phase: 'ready', setup: setup.value });
  }, []);

  useEffect(() => {
    let active = true;
    void refresh().catch(() => {
      if (active) {
        setState({ error: BRIDGE_ERROR, phase: 'error' });
      }
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const update = useCallback(
    async (draft: NonSecretSettingsDraft): Promise<SettingsBundle> => {
      const result = await window.rednoteDesktop?.updateNonSecretSettings(draft);
      if (result === undefined) {
        throw BRIDGE_ERROR;
      }
      if (!result.ok) {
        throw result.error;
      }
      await refresh();
      return result.value;
    },
    [refresh],
  );

  return { refresh, state, update };
}
