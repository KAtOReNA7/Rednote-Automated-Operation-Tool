import { writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export const SMOKE_TITLE_PREFIX = '__ISSUE006_SMOKE__:';
export const V2_SMOKE_TITLE_PREFIX = '__V2_R01_SMOKE__:';

export interface RendererSmokeReport {
  readonly appInfo: boolean;
  readonly foundation: boolean;
  readonly localApiBridge: boolean;
  readonly navigationCount: number;
  readonly preload: boolean;
  readonly renderer: boolean;
  readonly runtimeCapabilities: boolean;
  readonly settings: boolean;
  readonly setupState: boolean;
  readonly credentialStatus: boolean;
  readonly windowState: boolean;
}

export interface V2RendererSmokeReport {
  readonly marker: boolean;
  readonly mockMode: boolean;
  readonly navigationCount: number;
  readonly preload: boolean;
}

export function parseV2RendererSmokeTitle(title: string): V2RendererSmokeReport | null {
  if (!title.startsWith(V2_SMOKE_TITLE_PREFIX)) return null;
  try {
    const value = JSON.parse(
      decodeURIComponent(title.slice(V2_SMOKE_TITLE_PREFIX.length)),
    ) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const report = value as Record<string, unknown>;
    return typeof report.marker === 'boolean' &&
      typeof report.mockMode === 'boolean' &&
      typeof report.navigationCount === 'number' &&
      typeof report.preload === 'boolean'
      ? (report as unknown as V2RendererSmokeReport)
      : null;
  } catch {
    return null;
  }
}

export function parseRendererSmokeTitle(title: string): RendererSmokeReport | null {
  if (!title.startsWith(SMOKE_TITLE_PREFIX)) {
    return null;
  }
  try {
    const value = JSON.parse(decodeURIComponent(title.slice(SMOKE_TITLE_PREFIX.length))) as unknown;
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const report = value as Record<string, unknown>;
    if (
      typeof report.appInfo !== 'boolean' ||
      typeof report.foundation !== 'boolean' ||
      typeof report.localApiBridge !== 'boolean' ||
      typeof report.navigationCount !== 'number' ||
      typeof report.preload !== 'boolean' ||
      typeof report.renderer !== 'boolean' ||
      typeof report.runtimeCapabilities !== 'boolean' ||
      typeof report.settings !== 'boolean' ||
      typeof report.setupState !== 'boolean' ||
      typeof report.credentialStatus !== 'boolean' ||
      typeof report.windowState !== 'boolean'
    ) {
      return null;
    }
    return report as unknown as RendererSmokeReport;
  } catch {
    return null;
  }
}

export function resolveSmokeOutputPath(argv: readonly string[]): string | null {
  const prefix = '--issue006-smoke-output=';
  const argument = argv.find((value) => value.startsWith(prefix));
  if (argument === undefined) {
    return null;
  }

  const candidate = resolve(argument.slice(prefix.length));
  const temporaryRoot = resolve(tmpdir());
  const relativePath = relative(temporaryRoot, candidate);
  const fileName = candidate.split(/[\\/]/u).at(-1) ?? '';

  if (
    !isAbsolute(candidate) ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    !/^issue006-smoke-[a-f0-9-]+\.json$/u.test(fileName)
  ) {
    return null;
  }
  return candidate;
}

export function writeSmokeReport(outputPath: string, report: object): void {
  writeFileSync(outputPath, `${JSON.stringify(report)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}
