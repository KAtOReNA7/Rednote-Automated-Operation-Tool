import { useEffect, useState } from 'react';

import type {
  AppInfo,
  FoundationHealth,
  RuntimeCapabilities,
  WindowState,
} from '@mystery-operations/shared';

interface ReadyDesktopStatus {
  readonly appInfo: AppInfo;
  readonly foundation: FoundationHealth;
  readonly phase: 'ready';
  readonly runtime: RuntimeCapabilities;
  readonly windowState: WindowState;
}

interface NonReadyDesktopStatus {
  readonly phase: 'error' | 'loading';
}

export type DesktopStatus = NonReadyDesktopStatus | ReadyDesktopStatus;

export function useDesktopStatus(): DesktopStatus {
  const [status, setStatus] = useState<DesktopStatus>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    const bridge = window.rednoteDesktop;

    if (bridge === undefined) {
      setStatus({ phase: 'error' });
      return () => {
        active = false;
      };
    }

    Promise.all([
      bridge.getAppInfo(),
      bridge.getFoundationHealth(),
      bridge.getRuntimeCapabilities(),
      bridge.getWindowState(),
    ])
      .then(([appInfo, foundation, runtime, windowState]) => {
        if (active && appInfo.ok && foundation.ok && runtime.ok && windowState.ok) {
          setStatus({
            appInfo: appInfo.value,
            foundation: foundation.value,
            phase: 'ready',
            runtime: runtime.value,
            windowState: windowState.value,
          });
        } else if (active) {
          setStatus({ phase: 'error' });
        }
      })
      .catch(() => {
        if (active) {
          setStatus({ phase: 'error' });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return status;
}
