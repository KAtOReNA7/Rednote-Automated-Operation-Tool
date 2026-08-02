import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  flipFuses,
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from '@electron/fuses';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, '..');
const buildDirectory = join(projectRoot, '.vite');
const outputDirectory = join(projectRoot, 'out');
const packagingScratchDirectory = await mkdtemp(join(projectRoot, '.rednote-package-'));
process.env.TEMP = packagingScratchDirectory;
process.env.TMP = packagingScratchDirectory;
const { packager } = await import('@electron/packager');
const temporaryDirectory = await mkdtemp(
  join(packagingScratchDirectory, 'rednote-desktop-package-'),
);
const stageDirectory = join(temporaryDirectory, 'app');
const generatedElectronArchiveDirectory = join(temporaryDirectory, 'electron-archive');
const electronDirectory = join(projectRoot, 'node_modules', 'electron');
const electronDistDirectory = join(electronDirectory, 'dist');
const electronVersion = '43.2.0';
const electronArchiveName = `electron-v${electronVersion}-win32-x64.zip`;

async function writeExperienceFiles(packageDirectory) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    windowsHide: true,
  });
  const commit = stdout.trim();
  if (
    !/^[a-f0-9]{40}$/u.test(commit) ||
    (process.env.REDNOTE_EXACT_HEAD_SHA !== undefined &&
      process.env.REDNOTE_EXACT_HEAD_SHA !== commit)
  ) {
    throw new Error('Experience checklist commit does not match the exact build HEAD.');
  }
  const command = (args) =>
    `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nstart "" "%~dp0RednoteMysteryOperations.exe"${args}\r\n`;
  await Promise.all([
    writeFile(join(packageDirectory, '启动 Rednote V2 体验.cmd'), command(' --v2-shell'), 'utf8'),
    writeFile(join(packageDirectory, '返回当前绿色版本.cmd'), command(''), 'utf8'),
    writeFile(
      join(packageDirectory, 'V2-R02-体验清单.txt'),
      [
        'Rednote V2-R02 用户体验清单',
        `精确提交：${commit}`,
        '',
        '边界：仅账号人设和确定性周计划保存到本机；其他页面仍为模拟数据。',
        '1. 启动 V2。',
        '2. 修改设置页现有 4 个人设字段并保存。',
        '3. 在周历选择待确认项、改期并确认。',
        '4. 记录当前 persona 与 plan revision。',
        '5. 完全关闭 V2。',
        '6. 重新启动 V2。',
        '7. 确认 4 个字段、计划动作和 revision 正确恢复。',
        '8. 确认内容、互动、书库和数据复盘仍清楚标识为模拟。',
        '9. 启动 legacy，确认旧 UI 正常且忽略 v2_ 表。',
        '10. 反馈“接受 V2-R02”或列出阻塞问题。',
        '',
        '等待用户本人验收，禁止合并。',
        '',
      ].join('\r\n'),
      'utf8',
    ),
  ]);
}

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

async function createInstalledElectronArchive() {
  const packageMetadata = JSON.parse(
    await readFile(join(electronDirectory, 'package.json'), 'utf8'),
  );
  const runtimeVersion = (await readFile(join(electronDistDirectory, 'version'), 'utf8')).trim();
  if (packageMetadata.version !== electronVersion || runtimeVersion !== electronVersion) {
    throw new Error('Installed Electron runtime does not match the locked package version.');
  }

  const executablePath = join(electronDistDirectory, 'electron.exe');
  const executable = await stat(executablePath);
  if (!executable.isFile() || executable.size === 0) {
    throw new Error('Installed Electron runtime is incomplete.');
  }

  await mkdir(generatedElectronArchiveDirectory, { recursive: true });
  const archivePath = join(generatedElectronArchiveDirectory, electronArchiveName);
  await execFileAsync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference = 'Stop'; Compress-Archive -Path (Join-Path -Path $env:REDNOTE_ELECTRON_DIST -ChildPath '*') -DestinationPath $env:REDNOTE_ELECTRON_ARCHIVE -CompressionLevel Optimal -Force",
    ],
    {
      env: {
        ...process.env,
        REDNOTE_ELECTRON_ARCHIVE: archivePath,
        REDNOTE_ELECTRON_DIST: electronDistDirectory,
      },
      timeout: 300_000,
      windowsHide: true,
    },
  );
  return archivePath;
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
  let electronArchive = cachedArchive;
  if (cachedArchive !== null) {
    const checksums = JSON.parse(await readFile(join(electronDirectory, 'checksums.json'), 'utf8'));
    if (checksums[electronArchiveName] !== (await sha256(cachedArchive))) {
      throw new Error('Cached Electron archive did not match the official package checksum.');
    }
  } else {
    process.stdout.write(
      'Electron archive cache unavailable; packaging the locked local runtime.\n',
    );
    electronArchive = await createInstalledElectronArchive();
  }
  if (electronArchive === null) {
    throw new Error('Electron archive preparation failed.');
  }

  const packagePaths = await packager({
    appCopyright: 'Copyright 2026',
    arch: 'x64',
    asar: true,
    dir: stageDirectory,
    electronVersion,
    electronZipDir: dirname(electronArchive),
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

  await writeExperienceFiles(packagePaths[0]);

  process.stdout.write(
    'Packaged Windows desktop directory, V2-R02 launchers, checklist, and verified Electron fuses.\n',
  );
} finally {
  await rm(packagingScratchDirectory, { force: true, recursive: true });
}
