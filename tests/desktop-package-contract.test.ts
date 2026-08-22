import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

interface PackageContract {
  readonly R08_EXPERIENCE_FILES: Readonly<{
    readonly checklist: string;
    readonly defaultLauncher: string;
    readonly legacyLauncher: string;
  }>;
  readonly assertTrackedWorktreeClean: (statusOutput: string) => void;
  readonly ensureTrackedWorktreeClean: (
    projectRoot: string,
    run: (
      executable: string,
      arguments_: readonly string[],
      options: { readonly cwd: string; readonly windowsHide: boolean },
    ) => Promise<{ readonly stdout: string }>,
  ) => Promise<void>;
  readonly renderWindowsLauncher: (mode: 'default' | 'legacy') => string;
}

async function loadPackageContract(): Promise<PackageContract> {
  const url = pathToFileURL(join(process.cwd(), 'scripts', 'package-contract.mjs')).href;
  return (await import(url)) as PackageContract;
}

describe('R08 exact-head desktop package contract', () => {
  it('creates a no-argument V2 default launcher and one explicit legacy fallback', async () => {
    const { R08_EXPERIENCE_FILES, renderWindowsLauncher } = await loadPackageContract();
    const defaultLauncher = renderWindowsLauncher('default');
    const legacyLauncher = renderWindowsLauncher('legacy');

    expect(R08_EXPERIENCE_FILES).toEqual({
      checklist: 'V2-R08-体验清单.txt',
      defaultLauncher: '启动 Rednote Studio R08.cmd',
      legacyLauncher: '启动旧版回退.cmd',
    });
    expect(defaultLauncher).toContain('%~dp0RednoteMysteryOperations.exe');
    expect(defaultLauncher).not.toMatch(/--(?:legacy|v2)-shell/u);
    expect(legacyLauncher.match(/--legacy-shell/gu)).toHaveLength(1);
    expect(legacyLauncher).not.toContain('--v2-shell');
  });

  it('binds every package consumer to the R08 checklist and artifact identity', () => {
    const root = process.cwd();
    const checklist = readFileSync(
      resolve(root, 'scripts/v2-r08-experience-checklist.txt'),
      'utf8',
    );
    const consumers = [
      readFileSync(resolve(root, 'scripts/package-desktop.mjs'), 'utf8'),
      readFileSync(resolve(root, 'scripts/run-packaged-smoke.mjs'), 'utf8'),
      readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
    ].join('\n');

    for (const required of [
      '{{EXACT_HEAD}}',
      '启动 Rednote Studio R08.cmd',
      'N1—N7',
      '内容版本与状态恢复',
      '互动',
      '官方平台手工完成',
      '没有 RednoteMysteryOperations 或其 Electron 子进程残留',
      '启动旧版回退.cmd',
    ]) {
      expect(checklist).toContain(required);
    }
    expect(consumers).toContain('rednote-r10d-windows-installer-$shortSha');
    expect(consumers).not.toMatch(
      /返回当前绿色版本|V2-R07-体验清单|v2-r03-experience-checklist|rednote-v2-r05-windows/u,
    );
  });

  it('rejects tracked or staged changes before exact-head packaging', async () => {
    const { assertTrackedWorktreeClean, ensureTrackedWorktreeClean } = await loadPackageContract();
    expect(() => assertTrackedWorktreeClean(' M apps/desktop/src/main.ts\n')).toThrow(
      /PACKAGING_REQUIRES_CLEAN_TRACKED_WORKTREE/u,
    );
    expect(() => assertTrackedWorktreeClean('M  README.md\n')).toThrow(
      /PACKAGING_REQUIRES_CLEAN_TRACKED_WORKTREE/u,
    );
    expect(() => assertTrackedWorktreeClean('')).not.toThrow();

    const run = vi.fn().mockResolvedValue({ stdout: '' });
    await ensureTrackedWorktreeClean('X:\\isolated package fixture', run);
    expect(run).toHaveBeenCalledWith('git', ['status', '--porcelain=v1', '--untracked-files=no'], {
      cwd: 'X:\\isolated package fixture',
      windowsHide: true,
    });
  });
});
