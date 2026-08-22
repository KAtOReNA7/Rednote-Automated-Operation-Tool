import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const WINDOWS_APPLICATION_ID = 'io.github.katorena7.rednote-mystery-operations';
export const WINDOWS_APPLICATION_NAME = 'rednote-mystery-operations';
export const WINDOWS_PRODUCT_NAME = '红笺本地运营台';
export const WINDOWS_INSTALLER_GUID = '93211c80-b79d-59cd-848c-fd9f791d6cc2';
export const WINDOWS_MANIFEST_NAME = 'release-manifest.json';
export const WINDOWS_MANIFEST_FORMAT = 'rednote-windows-internal-beta';
export const WINDOWS_CANONICAL_VERSION = '0.1.0-beta.1';
export const WINDOWS_CI_FIXTURE_VERSION = '0.1.0-beta.0';
const SAFE_PACKAGE_OUTPUT_VARIANT = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function isCiFixtureVersionEnvironment(
  environment = process.env,
  platform = process.platform,
) {
  return (
    platform === 'win32' &&
    environment.GITHUB_ACTIONS === 'true' &&
    environment.REDNOTE_R10D_CI_FIXTURE === '1' &&
    environment.REDNOTE_R10D_CI_FIXTURE_VERSION === WINDOWS_CI_FIXTURE_VERSION
  );
}

export function readApplicationVersion(
  projectRoot,
  environment = process.env,
  platform = process.platform,
) {
  const version = execFileSync('node', ['-p', "require('./package.json').version"], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  if (version !== WINDOWS_CANONICAL_VERSION)
    throw new Error('R10D application version must be 0.1.0-beta.1.');
  if (
    environment.REDNOTE_R10D_CI_FIXTURE !== undefined &&
    !isCiFixtureVersionEnvironment(environment, platform)
  )
    throw new Error('R10D_VERSION_OVERRIDE_CI_ONLY');
  return isCiFixtureVersionEnvironment(environment, platform)
    ? WINDOWS_CI_FIXTURE_VERSION
    : version;
}

export function installerArtifactName(applicationVersion) {
  if (
    applicationVersion !== WINDOWS_CANONICAL_VERSION &&
    applicationVersion !== WINDOWS_CI_FIXTURE_VERSION
  )
    throw new Error('R10D installer version is not permitted.');
  return `RednoteStudio-${applicationVersion}-win-x64-setup.exe`;
}

export function assertInstallerArtifactVersion(installerName, applicationVersion) {
  if (installerName !== installerArtifactName(applicationVersion))
    throw new Error(
      'NSIS installer artifact version does not match the verified manifest version.',
    );
}

export function resolveInstallerBuildContract(
  projectRoot,
  environment = process.env,
  platform = process.platform,
) {
  const applicationVersion = readApplicationVersion(projectRoot, environment, platform);
  const outputVariant = environment.REDNOTE_PACKAGE_OUTPUT_VARIANT;
  if (outputVariant !== undefined && !SAFE_PACKAGE_OUTPUT_VARIANT.test(outputVariant))
    throw new Error('Package output variant must be a finite safe directory name.');

  const root = resolve(projectRoot);
  const outputDirectory = resolve(
    root,
    'out',
    ...(outputVariant === undefined ? [] : [outputVariant]),
  );
  const installersDirectory = join(outputDirectory, 'installer');
  const configuredOutput = relative(root, installersDirectory).split(sep).join('/');
  if (!/^out(?:\/[a-z0-9][a-z0-9-]{0,63})?\/installer$/u.test(configuredOutput))
    throw new Error('Installer output directory escapes the controlled output root.');

  return Object.freeze({
    applicationVersion,
    installersDirectory,
    outputDirectory,
    builderConfigArguments: Object.freeze([
      `--config.extraMetadata.version=${applicationVersion}`,
      `--config.directories.output=${configuredOutput}`,
    ]),
  });
}

export function buildIdentity(projectRoot) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  const sourceDateEpoch = execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  if (!/^[a-f0-9]{40}$/u.test(commit) || !/^\d{10,}$/u.test(sourceDateEpoch))
    throw new Error('Invalid exact build identity.');
  if (
    process.env.REDNOTE_EXACT_HEAD_SHA !== undefined &&
    process.env.REDNOTE_EXACT_HEAD_SHA !== commit
  )
    throw new Error('Exact build head mismatch.');
  return Object.freeze({ commit, sourceDateEpoch });
}

function toManifestPath(root, path) {
  const value = relative(root, path).split(sep).join('/');
  if (
    !value ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
    throw new Error('Unsafe release manifest path.');
  return value;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function enumeratePayload(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    const details = await lstat(path);
    if (details.isSymbolicLink())
      throw new Error('Release payload must not contain a symlink or junction.');
    if (details.isDirectory()) files.push(...(await enumeratePayload(root, path)));
    else if (details.isFile() && entry.name !== WINDOWS_MANIFEST_NAME)
      files.push({
        path: toManifestPath(root, path),
        size: details.size,
        sha256: await sha256(path),
      });
    else if (!details.isFile())
      throw new Error('Release payload contains an unsupported filesystem entry.');
  }
  return files;
}

export async function writeReleaseManifest(
  projectRoot,
  packageDirectory,
  applicationVersion = readApplicationVersion(projectRoot),
) {
  const { commit, sourceDateEpoch } = buildIdentity(projectRoot);
  const files = await enumeratePayload(packageDirectory);
  const paths = files.map((file) => file.path);
  if (new Set(paths).size !== paths.length)
    throw new Error('Release manifest contains duplicate payload paths.');
  const manifest = {
    appId: WINDOWS_APPLICATION_ID,
    applicationVersion,
    arch: 'x64',
    buildCommit: commit,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    format: WINDOWS_MANIFEST_FORMAT,
    manifestVersion: 1,
    platform: 'win32',
    sourceDateEpoch,
    unsigned: true,
  };
  await writeFile(
    join(packageDirectory, WINDOWS_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

export async function readReleaseManifest(
  packageDirectory,
  permittedVersions = [WINDOWS_CANONICAL_VERSION],
) {
  const text = await readFile(join(resolve(packageDirectory), WINDOWS_MANIFEST_NAME), 'utf8');
  const manifest = JSON.parse(text);
  const allowed = new Set([
    'appId',
    'applicationVersion',
    'arch',
    'buildCommit',
    'files',
    'format',
    'manifestVersion',
    'platform',
    'sourceDateEpoch',
    'unsigned',
  ]);
  if (
    Object.keys(manifest).some((key) => !allowed.has(key)) ||
    manifest.format !== WINDOWS_MANIFEST_FORMAT ||
    manifest.manifestVersion !== 1 ||
    manifest.platform !== 'win32' ||
    manifest.arch !== 'x64' ||
    manifest.appId !== WINDOWS_APPLICATION_ID ||
    manifest.unsigned !== true ||
    !Array.isArray(permittedVersions) ||
    !permittedVersions.includes(manifest.applicationVersion) ||
    !/^[a-f0-9]{40}$/u.test(manifest.buildCommit) ||
    !/^\d{10,}$/u.test(manifest.sourceDateEpoch) ||
    !Array.isArray(manifest.files)
  )
    throw new Error('Invalid release manifest schema.');
  const paths = new Set();
  for (const file of manifest.files) {
    if (
      Object.keys(file).sort().join(',') !== 'path,sha256,size' ||
      typeof file.path !== 'string' ||
      typeof file.size !== 'number' ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      paths.has(file.path) ||
      file.path.includes('..') ||
      file.path.includes('\\') ||
      isAbsolute(file.path)
    )
      throw new Error('Invalid release manifest file entry.');
    paths.add(file.path);
  }
  return manifest;
}
