import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  readReleaseManifest,
  WINDOWS_APPLICATION_ID,
  WINDOWS_MANIFEST_NAME,
} from './windows-distribution-contract.mjs';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
if (
  process.platform !== 'win32' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.RUNNER_TEMP === undefined ||
  process.env.GITHUB_WORKSPACE === undefined
) {
  throw new Error('INSTALLER_LIFECYCLE_CI_ONLY');
}
const localAppData = process.env.LOCALAPPDATA;
if (
  localAppData === undefined ||
  !resolve(process.env.GITHUB_WORKSPACE).startsWith(
    resolve(process.env.RUNNER_WORKSPACE ?? process.env.GITHUB_WORKSPACE),
  )
)
  throw new Error('INSTALLER_LIFECYCLE_REQUIRES_GITHUB_HOSTED_RUNNER');
const bundle = join(root, 'out', 'installer-bundle');
const installers = (await readdir(bundle)).filter((name) => name.endsWith('.exe'));
if (installers.length !== 1) throw new Error('INSTALLER_LIFECYCLE_EXPECTS_ONE_INSTALLER');
const installPath = join(localAppData, 'Programs', '红笺本地运营台');
if (existsSync(installPath)) throw new Error('INSTALLER_LIFECYCLE_REFUSES_EXISTING_INSTALL');
const installer = join(bundle, installers[0]);
const install = await run(installer, ['/S'], { cwd: bundle, windowsHide: true, timeout: 180_000 });
if (install.stderr.trim() !== '' || !existsSync(installPath))
  throw new Error('INSTALLER_CLEAN_INSTALL_FAILED');
const manifest = await readReleaseManifest(installPath);
if (
  manifest.appId !== WINDOWS_APPLICATION_ID ||
  !(await stat(join(installPath, 'RednoteMysteryOperations.exe'))).isFile()
)
  throw new Error('INSTALLER_INSTALLED_PAYLOAD_INVALID');
const installedManifest = await readFile(join(installPath, WINDOWS_MANIFEST_NAME), 'utf8');
if (
  installedManifest.includes(resolve(root)) ||
  !existsSync(join(installPath, 'Uninstall 红笺本地运营台.exe'))
)
  throw new Error('INSTALLER_DATA_OR_UNINSTALL_CONTRACT_INVALID');
await run(join(installPath, 'Uninstall 红笺本地运营台.exe'), ['/S'], {
  cwd: installPath,
  windowsHide: true,
  timeout: 180_000,
});
if (existsSync(installPath)) throw new Error('INSTALLER_UNINSTALL_FAILED');
process.stdout.write(
  'R10D CI-only clean installer lifecycle completed without application launch.\n',
);
