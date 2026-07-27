import { createReadStream } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  flipFuses,
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from '@electron/fuses';
import { packager } from '@electron/packager';

const projectRoot = resolve(import.meta.dirname, '..');
const buildDirectory = join(projectRoot, '.vite');
const outputDirectory = join(projectRoot, 'out');
const stageDirectory = await mkdtemp(join(tmpdir(), 'rednote-desktop-package-'));
const electronArchiveName = 'electron-v43.2.0-win32-x64.zip';

async function findFile(directory, name) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isFile() && entry.name === name) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, name);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

try {
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(buildDirectory, join(stageDirectory, '.vite'), { recursive: true });
  await writeFile(
    join(stageDirectory, 'package.json'),
    `${JSON.stringify(
      {
        description: 'Windows-local mystery fiction content operations shell',
        main: '.vite/build/main.cjs',
        name: 'rednote-mystery-operations',
        productName: '红笺本地运营台',
        version: '0.0.0',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const cacheRoot =
    process.env.LOCALAPPDATA === undefined
      ? ''
      : join(process.env.LOCALAPPDATA, 'electron', 'Cache');
  const cachedArchive = cacheRoot === '' ? null : await findFile(cacheRoot, electronArchiveName);
  if (cachedArchive !== null) {
    const checksums = JSON.parse(
      await readFile(join(projectRoot, 'node_modules', 'electron', 'checksums.json'), 'utf8'),
    );
    if (checksums[electronArchiveName] !== (await sha256(cachedArchive))) {
      throw new Error('Cached Electron archive did not match the official package checksum.');
    }
  }

  const packagePaths = await packager({
    appCopyright: 'Copyright 2026',
    arch: 'x64',
    asar: true,
    dir: stageDirectory,
    electronVersion: '43.2.0',
    ...(cachedArchive === null ? {} : { electronZipDir: dirname(cachedArchive) }),
    executableName: 'RednoteMysteryOperations',
    name: 'rednote-mystery-operations',
    out: outputDirectory,
    overwrite: true,
    platform: 'win32',
    prune: false,
    quiet: true,
  });

  if (packagePaths.length !== 1) {
    throw new Error('Desktop packager did not produce exactly one Windows directory.');
  }

  const executablePath = join(packagePaths[0], 'RednoteMysteryOperations.exe');
  await flipFuses(executablePath, {
    strictlyRequireAllFuses: true,
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });

  const fuses = await getCurrentFuseWire(executablePath);
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
    [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
  ]);
  for (const [fuse, state] of expected) {
    if (fuses[fuse] !== state) {
      throw new Error(`Packaged Electron fuse ${fuse} did not match the required state.`);
    }
  }

  process.stdout.write('Packaged Windows desktop directory with verified Electron fuses.\n');
} finally {
  await rm(stageDirectory, { force: true, recursive: true });
}
