import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import { extract } from '@electron-internal/extract-zip';

const projectRoot = resolve(import.meta.dirname, '..');
const electronDirectory = join(projectRoot, 'node_modules', 'electron');
const electronDistribution = join(electronDirectory, 'dist');
const electronExecutable = join(electronDistribution, 'electron.exe');
const electronPathFile = join(electronDirectory, 'path.txt');
const archiveName = 'electron-v43.2.0-win32-x64.zip';

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
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

async function runOfficialInstaller() {
  const installer = join(electronDirectory, 'install.js');
  const child = spawn(process.execPath, [installer], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  if (exitCode !== 0) {
    throw new Error('Official Electron binary installation failed.');
  }
}

if (await exists(electronExecutable)) {
  await writeFile(electronPathFile, 'electron.exe', 'utf8');
  process.stdout.write('Electron 43.2.0 binary is ready.\n');
} else {
  const cacheRoot =
    process.env.LOCALAPPDATA === undefined
      ? ''
      : join(process.env.LOCALAPPDATA, 'electron', 'Cache');
  const cachedArchive = cacheRoot === '' ? null : await findFile(cacheRoot, archiveName);

  if (cachedArchive === null) {
    await runOfficialInstaller();
  } else {
    const checksums = JSON.parse(await readFile(join(electronDirectory, 'checksums.json'), 'utf8'));
    if (checksums[archiveName] !== (await sha256(cachedArchive))) {
      throw new Error('Cached Electron archive did not match the official package checksum.');
    }

    const stagingDirectory = await mkdtemp(join(electronDirectory, '.dist-'));
    try {
      await extract(cachedArchive, { dir: stagingDirectory });
      if (!(await exists(join(stagingDirectory, 'electron.exe')))) {
        throw new Error('Verified Electron archive did not contain electron.exe.');
      }
      await rm(electronDistribution, { force: true, recursive: true });
      await rename(stagingDirectory, electronDistribution);
      await writeFile(electronPathFile, 'electron.exe', 'utf8');
    } catch (error) {
      await rm(stagingDirectory, { force: true, recursive: true });
      throw error;
    }
  }

  if (!(await exists(electronExecutable))) {
    throw new Error('Electron 43.2.0 binary is unavailable after preparation.');
  }
  process.stdout.write('Electron 43.2.0 binary was prepared from a verified archive.\n');
}
