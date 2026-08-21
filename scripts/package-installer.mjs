import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  assertInstallerArtifactVersion,
  buildIdentity,
  readReleaseManifest,
  resolveInstallerBuildContract,
  WINDOWS_MANIFEST_NAME,
} from './windows-distribution-contract.mjs';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const {
  applicationVersion,
  builderConfigArguments,
  installersDirectory: installers,
  outputDirectory: output,
} = resolveInstallerBuildContract(root);
const bundle = join(output, 'installer-bundle');

function builderEnvironment() {
  const allowed = [
    'APPDATA',
    'ComSpec',
    'COMMONPROGRAMFILES',
    'COMMONPROGRAMFILES(X86)',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'OS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'PROGRAMDATA',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERDOMAIN',
    'USERNAME',
    'USERPROFILE',
    'WINDIR',
  ];
  return Object.fromEntries(
    allowed.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
  );
}
const packageDirectory = (await readdir(output)).filter((name) => name.endsWith('-win32-x64'));
if (packageDirectory.length !== 1)
  throw new Error('Installer requires exactly one verified prepackaged Windows directory.');
const { commit, sourceDateEpoch } = buildIdentity(root);
const prepackaged = join(output, packageDirectory[0]);
const manifest = await readReleaseManifest(prepackaged, [applicationVersion]);
if (manifest.applicationVersion !== applicationVersion || manifest.buildCommit !== commit)
  throw new Error('Prepackaged manifest does not bind the exact installer head.');
await rm(installers, { force: true, recursive: true });
await rm(bundle, { force: true, recursive: true });
await mkdir(installers, { recursive: true });
await run(
  process.execPath,
  [
    join(root, 'node_modules', 'electron-builder', 'cli.js'),
    '--config',
    'electron-builder.yml',
    ...builderConfigArguments,
    '--prepackaged',
    prepackaged,
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
  ],
  {
    cwd: root,
    env: { ...builderEnvironment(), SOURCE_DATE_EPOCH: sourceDateEpoch },
    windowsHide: true,
    timeout: 900000,
  },
);
const installersFound = (await readdir(installers)).filter((name) => name.endsWith('.exe'));
if (installersFound.length !== 1)
  throw new Error('NSIS build did not produce exactly one installer.');
const installer = installersFound[0];
assertInstallerArtifactVersion(installer, applicationVersion);
const installerPath = join(installers, installer);
const installerSize = (await stat(installerPath)).size;
const installerHash = createHash('sha256')
  .update(await readFile(installerPath))
  .digest('hex');
await mkdir(bundle, { recursive: true });
await Promise.all([
  cp(installerPath, join(bundle, installer)),
  cp(join(prepackaged, WINDOWS_MANIFEST_NAME), join(bundle, WINDOWS_MANIFEST_NAME)),
  cp(join(root, 'scripts', 'windows-installation.txt'), join(bundle, 'INSTALLATION.txt')),
]);
await writeFile(
  join(bundle, 'SHA256SUMS.txt'),
  `${installer} ${installerSize} ${installerHash}\n`,
  'utf8',
);
process.stdout.write(`R10D installer bundle ready: ${installer}\n`);
