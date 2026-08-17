export type DesktopShellMode = 'legacy' | 'v2';

export interface DesktopShellSelection {
  readonly error: 'SHELL_ARGUMENT_CONFLICT' | null;
  readonly mode: DesktopShellMode;
}

export const LEGACY_RENDERER_URL = 'rednote://app/index.html';
export const V2_RENDERER_URL = 'rednote://app/v2.html';

const DEVELOPMENT_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/.*)?$/u;
const LEGACY_SHELL_ARGUMENT = '--legacy-shell';
const V2_SHELL_ARGUMENT = '--v2-shell';

export function resolveDesktopShellSelection(argv: readonly string[]): DesktopShellSelection {
  const legacyRequested = argv.includes(LEGACY_SHELL_ARGUMENT);
  const v2Requested = argv.includes(V2_SHELL_ARGUMENT);

  if (legacyRequested && v2Requested) {
    return Object.freeze({ error: 'SHELL_ARGUMENT_CONFLICT', mode: 'v2' });
  }

  return Object.freeze({
    error: null,
    mode: legacyRequested ? 'legacy' : 'v2',
  });
}

export function resolveDesktopRendererUrl(
  mode: DesktopShellMode,
  developmentUrl: string | undefined,
): string {
  if (developmentUrl !== undefined && DEVELOPMENT_URL_PATTERN.test(developmentUrl)) {
    return mode === 'v2' ? new URL('/v2.html', developmentUrl).toString() : developmentUrl;
  }
  return mode === 'v2' ? V2_RENDERER_URL : LEGACY_RENDERER_URL;
}
