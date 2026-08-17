import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const R08_EXPERIENCE_FILES = Object.freeze({
  checklist: 'V2-R08-体验清单.txt',
  defaultLauncher: '启动 Rednote Studio R08.cmd',
  legacyLauncher: '启动旧版回退.cmd',
});

export function assertTrackedWorktreeClean(statusOutput) {
  if (statusOutput.trim().length !== 0) {
    throw new Error(
      'PACKAGING_REQUIRES_CLEAN_TRACKED_WORKTREE: commit tracked and staged changes before creating an exact-head package.',
    );
  }
}

export async function ensureTrackedWorktreeClean(projectRoot, run = execFileAsync) {
  const { stdout } = await run('git', ['status', '--porcelain=v1', '--untracked-files=no'], {
    cwd: projectRoot,
    windowsHide: true,
  });
  assertTrackedWorktreeClean(stdout);
}

export function renderWindowsLauncher(mode) {
  if (mode !== 'default' && mode !== 'legacy') {
    throw new Error('INVALID_DESKTOP_LAUNCHER_MODE');
  }
  const argument = mode === 'legacy' ? ' --legacy-shell' : '';
  return `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nstart "" "%~dp0RednoteMysteryOperations.exe"${argument}\r\n`;
}
