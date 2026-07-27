import type { DesktopBridge } from '@mystery-operations/shared';

declare global {
  interface Window {
    readonly rednoteDesktop?: DesktopBridge;
  }
}

export {};
