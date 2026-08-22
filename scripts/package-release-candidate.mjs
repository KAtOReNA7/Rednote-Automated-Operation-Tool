import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  readReleaseManifest,
  WINDOWS_CANONICAL_VERSION,
  WINDOWS_CI_FIXTURE_VERSION,
  WINDOWS_MANIFEST_NAME,
} from './windows-distribution-contract.mjs';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

export const R10E_SCHEMA_VERSION = 'rednote-r10e-provenance-v1';
export const R10E_ZIP_NAME = 'RednoteStudio-0.1.0-beta.1-r10e-rc.zip';
export const R10E_RELEASE_ASSET_NAMES = Object.freeze([
  R10E_ZIP_NAME,
  `${R10E_ZIP_NAME}.sha256`,
  'PROVENANCE.json',
  'USER-GUIDE.md',
  'WINDOWS-10-11-UAT.md',
]);

const CANONICAL_INSTALLER = 'RednoteStudio-0.1.0-beta.1-win-x64-setup.exe';
const FIXTURE_INSTALLER = 'RednoteStudio-0.1.0-beta.0-win-x64-setup.exe';
const FIXTURE_DIRECTORY = 'upgrade-fixture/TEST-ONLY-beta.0';
const SOURCE_BUNDLE_FILES = Object.freeze([
  'INSTALLATION.txt',
  'SHA256SUMS.txt',
  WINDOWS_MANIFEST_NAME,
]);
const TOP_LEVEL_FILES = Object.freeze([
  'PROVENANCE.json',
  'SHA256SUMS.txt',
  'USER-GUIDE.md',
  'WINDOWS-10-11-UAT.md',
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function controlled(rootDirectory, candidate) {
  const absoluteRoot = resolve(rootDirectory);
  const absoluteCandidate = resolve(candidate);
  const value = relative(absoluteRoot, absoluteCandidate);
  if (!value || value.startsWith('..') || value.includes(':'))
    throw new Error('R10E_CONTROLLED_PATH_REQUIRED');
  return absoluteCandidate;
}

function manifestPath(rootDirectory, path) {
  const value = relative(resolve(rootDirectory), resolve(path)).split(sep).join('/');
  if (
    !value ||
    value.includes('\\') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
    throw new Error('R10E_UNSAFE_RELATIVE_PATH');
  return value;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function enumerateFiles(rootDirectory, directory = rootDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = join(directory, entry.name);
    const details = await lstat(path);
    if (details.isSymbolicLink()) throw new Error('R10E_LINK_NOT_ALLOWED');
    if (details.isDirectory()) files.push(...(await enumerateFiles(rootDirectory, path)));
    else if (details.isFile())
      files.push({ path: manifestPath(rootDirectory, path), size: details.size, absolute: path });
    else throw new Error('R10E_UNSUPPORTED_ENTRY');
  }
  return files.sort((left, right) => compareText(left.path, right.path));
}

function exactNames(actual, expected, code) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort()))
    throw new Error(code);
}

async function readInstallerChecksum(path, expectedInstaller) {
  const match = /^([^\s]+) ([0-9]+) ([a-f0-9]{64})\n$/u.exec(await readFile(path, 'utf8'));
  if (match === null || match[1] !== expectedInstaller)
    throw new Error('R10E_INNER_CHECKSUM_INVALID');
  return { name: match[1], size: Number(match[2]), sha256: match[3] };
}

async function validateSourceBundle(directory, version, installer, sourceCommit) {
  exactNames(
    await readdir(directory),
    [...SOURCE_BUNDLE_FILES, installer],
    'R10E_SOURCE_BUNDLE_OPEN',
  );
  const manifest = await readReleaseManifest(directory, [version]);
  const checksum = await readInstallerChecksum(join(directory, 'SHA256SUMS.txt'), installer);
  const installerPath = join(directory, installer);
  const details = await stat(installerPath);
  if (
    manifest.applicationVersion !== version ||
    manifest.buildCommit !== sourceCommit ||
    !details.isFile() ||
    details.size !== checksum.size ||
    (await sha256(installerPath)) !== checksum.sha256
  )
    throw new Error('R10E_SOURCE_BUNDLE_IDENTITY_INVALID');
  return {
    installer: checksum,
    manifest: {
      format: manifest.format,
      sha256: await sha256(join(directory, WINDOWS_MANIFEST_NAME)),
      size: (await stat(join(directory, WINDOWS_MANIFEST_NAME))).size,
    },
  };
}

function gitValue(repositoryRoot, arguments_) {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

export async function createCiProvenance(repositoryRoot, environment = process.env) {
  if (
    process.platform !== 'win32' ||
    environment.GITHUB_ACTIONS !== 'true' ||
    environment.RUNNER_OS !== 'Windows' ||
    environment.RUNNER_ARCH !== 'X64' ||
    !/^\d+$/u.test(environment.GITHUB_RUN_ID ?? '') ||
    !/^\d+$/u.test(environment.GITHUB_RUN_ATTEMPT ?? '')
  )
    throw new Error('R10E_GITHUB_WINDOWS_METADATA_REQUIRED');
  const sourceCommit = gitValue(repositoryRoot, ['rev-parse', 'HEAD']);
  const sourceTree = gitValue(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);
  if (
    sourceCommit !== environment.REDNOTE_EXACT_HEAD_SHA ||
    !/^[a-f0-9]{40}$/u.test(sourceCommit) ||
    !/^[a-f0-9]{40}$/u.test(sourceTree)
  )
    throw new Error('R10E_EXACT_HEAD_IDENTITY_INVALID');
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  const lockPath = join(repositoryRoot, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  const npm = /^npm@(.+)$/u.exec(packageJson.packageManager)?.[1];
  const electronBuilder = lock.packages?.['node_modules/electron-builder']?.version;
  if (
    packageJson.version !== WINDOWS_CANONICAL_VERSION ||
    npm === undefined ||
    typeof electronBuilder !== 'string'
  )
    throw new Error('R10E_LOCKED_TOOLCHAIN_INVALID');
  return {
    applicationVersion: WINDOWS_CANONICAL_VERSION,
    lockfile: { sha256: await sha256(lockPath) },
    runner: { arch: environment.RUNNER_ARCH, os: environment.RUNNER_OS },
    schemaVersion: R10E_SCHEMA_VERSION,
    sourceCommit,
    sourceTree,
    toolchain: { electronBuilder, node: process.versions.node, npm },
    workflow: {
      attempt: Number(environment.GITHUB_RUN_ATTEMPT),
      runId: Number(environment.GITHUB_RUN_ID),
    },
  };
}

function fixtureNames() {
  return Object.freeze({
    installer: `TEST-ONLY-${FIXTURE_INSTALLER}`,
    installation: 'TEST-ONLY-INSTALLATION.txt',
    manifest: 'TEST-ONLY-release-manifest.json',
    sums: 'TEST-ONLY-SHA256SUMS.txt',
  });
}

async function writeOuterChecksums(directory) {
  const files = (await enumerateFiles(directory)).filter((file) => file.path !== 'SHA256SUMS.txt');
  const lines = [];
  for (const file of files) lines.push(`${await sha256(file.absolute)} ${file.size} ${file.path}`);
  await writeFile(join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
}

async function readOuterChecksums(path) {
  const text = await readFile(path, 'utf8');
  if (!text.endsWith('\n')) throw new Error('R10E_OUTER_CHECKSUM_INVALID');
  return text
    .trimEnd()
    .split('\n')
    .map((line) => {
      const match = /^([a-f0-9]{64}) ([0-9]+) (.+)$/u.exec(line);
      if (match === null) throw new Error('R10E_OUTER_CHECKSUM_INVALID');
      return { sha256: match[1], size: Number(match[2]), path: match[3] };
    });
}

async function assertNoPrivateFragments(directory, forbiddenFragments = []) {
  const fragments = forbiddenFragments
    .filter((value) => typeof value === 'string' && value.length >= 4)
    .flatMap((value) => [value, value.replaceAll('\\', '/'), value.replaceAll('/', '\\')]);
  for (const file of await enumerateFiles(directory)) {
    const bytes = await readFile(file.absolute);
    for (const fragment of fragments) {
      if (
        bytes.includes(Buffer.from(fragment, 'utf8')) ||
        bytes.includes(Buffer.from(fragment, 'utf16le'))
      )
        throw new Error(`R10E_PRIVATE_FRAGMENT_FOUND:${file.path}`);
    }
    if (/\.(?:json|md|txt)$/iu.test(file.path)) {
      const text = bytes.toString('utf8');
      if (/[A-Za-z]:[\\/]|\\\\[^\\]|file:\/\//u.test(text))
        throw new Error(`R10E_ABSOLUTE_PATH_FOUND:${file.path}`);
    }
  }
}

function expectedCandidateFiles() {
  const fixture = fixtureNames();
  return [
    `candidate/${CANONICAL_INSTALLER}`,
    ...SOURCE_BUNDLE_FILES.map((name) => `candidate/${name}`),
    `${FIXTURE_DIRECTORY}/${fixture.installer}`,
    `${FIXTURE_DIRECTORY}/${fixture.installation}`,
    `${FIXTURE_DIRECTORY}/${fixture.manifest}`,
    `${FIXTURE_DIRECTORY}/${fixture.sums}`,
    ...TOP_LEVEL_FILES,
  ].sort();
}

export async function validateReleaseCandidate(
  directory,
  { expectedSourceCommit, forbiddenFragments = [] } = {},
) {
  const files = await enumerateFiles(directory);
  exactNames(
    files.map((file) => file.path),
    expectedCandidateFiles(),
    'R10E_CANDIDATE_CLOSED_SET_INVALID',
  );
  const sums = await readOuterChecksums(join(directory, 'SHA256SUMS.txt'));
  const checksumTargets = files.filter((file) => file.path !== 'SHA256SUMS.txt');
  exactNames(
    sums.map((entry) => entry.path),
    checksumTargets.map((file) => file.path),
    'R10E_CHECKSUM_CLOSED_SET_INVALID',
  );
  if (
    JSON.stringify(sums.map((entry) => entry.path)) !==
    JSON.stringify(sums.map((entry) => entry.path).sort())
  )
    throw new Error('R10E_CHECKSUM_ORDER_INVALID');
  for (const entry of sums) {
    const file = checksumTargets.find((candidate) => candidate.path === entry.path);
    if (
      file === undefined ||
      file.size !== entry.size ||
      (await sha256(file.absolute)) !== entry.sha256
    )
      throw new Error(`R10E_CHECKSUM_MISMATCH:${entry.path}`);
  }
  const provenance = JSON.parse(await readFile(join(directory, 'PROVENANCE.json'), 'utf8'));
  exactNames(
    Object.keys(provenance),
    [
      'applicationVersion',
      'candidateInstaller',
      'fixture',
      'lockfile',
      'manifestIdentity',
      'runner',
      'schemaVersion',
      'sourceCommit',
      'sourceTree',
      'toolchain',
      'workflow',
    ],
    'R10E_PROVENANCE_FIELDS_INVALID',
  );
  const candidateInstaller = join(directory, 'candidate', CANONICAL_INSTALLER);
  const candidateManifest = join(directory, 'candidate', WINDOWS_MANIFEST_NAME);
  const fixture = fixtureNames();
  const fixtureInstaller = join(directory, ...FIXTURE_DIRECTORY.split('/'), fixture.installer);
  if (
    provenance.schemaVersion !== R10E_SCHEMA_VERSION ||
    provenance.applicationVersion !== WINDOWS_CANONICAL_VERSION ||
    !/^[a-f0-9]{40}$/u.test(provenance.sourceCommit) ||
    !/^[a-f0-9]{40}$/u.test(provenance.sourceTree) ||
    (expectedSourceCommit !== undefined && provenance.sourceCommit !== expectedSourceCommit) ||
    provenance.candidateInstaller.name !== CANONICAL_INSTALLER ||
    provenance.candidateInstaller.size !== (await stat(candidateInstaller)).size ||
    provenance.candidateInstaller.sha256 !== (await sha256(candidateInstaller)) ||
    provenance.manifestIdentity.sha256 !== (await sha256(candidateManifest)) ||
    provenance.fixture.applicationVersion !== WINDOWS_CI_FIXTURE_VERSION ||
    provenance.fixture.testOnly !== true ||
    provenance.fixture.installer.name !== fixture.installer ||
    provenance.fixture.installer.sha256 !== (await sha256(fixtureInstaller)) ||
    !Number.isSafeInteger(provenance.workflow.runId) ||
    !Number.isSafeInteger(provenance.workflow.attempt)
  )
    throw new Error('R10E_PROVENANCE_IDENTITY_INVALID');
  await assertNoPrivateFragments(directory, forbiddenFragments);
  return { files: files.map((file) => file.path), provenance };
}

export async function assembleReleaseCandidate({
  canonicalBundle,
  directory,
  fixtureBundle,
  provenance,
  userGuide,
  uatGuide,
  forbiddenFragments = [],
}) {
  const candidateDirectory = controlled(directory, join(directory, 'candidate'));
  const fixtureDirectory = controlled(directory, join(directory, ...FIXTURE_DIRECTORY.split('/')));
  await rm(directory, { force: true, recursive: true });
  await mkdir(candidateDirectory, { recursive: true });
  await mkdir(fixtureDirectory, { recursive: true });
  const canonical = await validateSourceBundle(
    canonicalBundle,
    WINDOWS_CANONICAL_VERSION,
    CANONICAL_INSTALLER,
    provenance.sourceCommit,
  );
  const beta0 = await validateSourceBundle(
    fixtureBundle,
    WINDOWS_CI_FIXTURE_VERSION,
    FIXTURE_INSTALLER,
    provenance.sourceCommit,
  );
  await Promise.all(
    [...SOURCE_BUNDLE_FILES, CANONICAL_INSTALLER].map((name) =>
      copyFile(join(canonicalBundle, name), join(candidateDirectory, name)),
    ),
  );
  const fixture = fixtureNames();
  await Promise.all([
    copyFile(join(fixtureBundle, FIXTURE_INSTALLER), join(fixtureDirectory, fixture.installer)),
    copyFile(join(fixtureBundle, 'INSTALLATION.txt'), join(fixtureDirectory, fixture.installation)),
    copyFile(join(fixtureBundle, WINDOWS_MANIFEST_NAME), join(fixtureDirectory, fixture.manifest)),
    copyFile(userGuide, join(directory, 'USER-GUIDE.md')),
    copyFile(uatGuide, join(directory, 'WINDOWS-10-11-UAT.md')),
  ]);
  await writeFile(
    join(fixtureDirectory, fixture.sums),
    `${fixture.installer} ${beta0.installer.size} ${beta0.installer.sha256}\n`,
    'utf8',
  );
  await writeFile(
    join(directory, 'PROVENANCE.json'),
    `${JSON.stringify(
      {
        ...provenance,
        candidateInstaller: canonical.installer,
        fixture: {
          applicationVersion: WINDOWS_CI_FIXTURE_VERSION,
          installer: { ...beta0.installer, name: fixture.installer },
          testOnly: true,
        },
        manifestIdentity: canonical.manifest,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeOuterChecksums(directory);
  return validateReleaseCandidate(directory, {
    expectedSourceCommit: provenance.sourceCommit,
    forbiddenFragments,
  });
}

async function powershellArchive(operation, source, destination) {
  const sourceVariable = 'REDNOTE_R10E_ARCHIVE_SOURCE';
  const destinationVariable = 'REDNOTE_R10E_ARCHIVE_DESTINATION';
  const arguments_ =
    "[Environment]::GetEnvironmentVariable('REDNOTE_R10E_ARCHIVE_SOURCE'), [Environment]::GetEnvironmentVariable('REDNOTE_R10E_ARCHIVE_DESTINATION')";
  const command =
    operation === 'create'
      ? `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${arguments_}, [IO.Compression.CompressionLevel]::Optimal, $false)`
      : `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(${arguments_})`;
  await run('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, [sourceVariable]: source, [destinationVariable]: destination },
    maxBuffer: 8_192,
    timeout: 300_000,
    windowsHide: true,
  });
}

export async function createReleaseAssets({
  assetsDirectory,
  candidateDirectory,
  forbiddenFragments,
}) {
  const verifyDirectory = controlled(assetsDirectory, join(assetsDirectory, '.verify'));
  await rm(assetsDirectory, { force: true, recursive: true });
  await mkdir(assetsDirectory, { recursive: true });
  const zip = join(assetsDirectory, R10E_ZIP_NAME);
  await powershellArchive('create', candidateDirectory, zip);
  const zipSize = (await stat(zip)).size;
  const zipHash = await sha256(zip);
  await writeFile(
    join(assetsDirectory, `${R10E_ZIP_NAME}.sha256`),
    `${R10E_ZIP_NAME} ${zipSize} ${zipHash}\n`,
    'utf8',
  );
  await Promise.all(
    ['PROVENANCE.json', 'USER-GUIDE.md', 'WINDOWS-10-11-UAT.md'].map((name) =>
      copyFile(join(candidateDirectory, name), join(assetsDirectory, name)),
    ),
  );
  await validateReleaseAssets(assetsDirectory, candidateDirectory);
  await mkdir(verifyDirectory, { recursive: true });
  try {
    await powershellArchive('extract', zip, verifyDirectory);
    await validateReleaseCandidate(verifyDirectory, { forbiddenFragments });
  } finally {
    await rm(verifyDirectory, { force: true, recursive: true });
  }
  return { name: R10E_ZIP_NAME, sha256: zipHash, size: zipSize };
}

export async function validateReleaseAssets(assetsDirectory, candidateDirectory) {
  exactNames(await readdir(assetsDirectory), R10E_RELEASE_ASSET_NAMES, 'R10E_ASSET_SET_INVALID');
  const zip = join(assetsDirectory, R10E_ZIP_NAME);
  const checksum = await readInstallerChecksum(
    join(assetsDirectory, `${R10E_ZIP_NAME}.sha256`),
    R10E_ZIP_NAME,
  );
  if ((await stat(zip)).size !== checksum.size || (await sha256(zip)) !== checksum.sha256)
    throw new Error('R10E_ZIP_CHECKSUM_MISMATCH');
  for (const name of ['PROVENANCE.json', 'USER-GUIDE.md', 'WINDOWS-10-11-UAT.md']) {
    if (
      (await sha256(join(assetsDirectory, name))) !== (await sha256(join(candidateDirectory, name)))
    )
      throw new Error(`R10E_RELEASE_ASSET_MISMATCH:${name}`);
  }
  return checksum;
}

async function main() {
  const provenance = await createCiProvenance(root);
  const output = controlled(root, join(root, 'out'));
  const candidateDirectory = controlled(output, join(output, 'r10e-release-candidate'));
  const assetsDirectory = controlled(output, join(output, 'r10e-release-assets'));
  const forbiddenFragments = [
    root,
    process.env.GITHUB_WORKSPACE,
    process.env.RUNNER_TEMP,
    process.env.USERPROFILE,
    process.env.USERNAME,
  ];
  await assembleReleaseCandidate({
    canonicalBundle: join(output, 'installer-bundle'),
    directory: candidateDirectory,
    fixtureBundle: join(output, 'r10d-beta0-fixture', 'installer-bundle'),
    provenance,
    userGuide: join(root, 'docs', 'user-guide', 'windows-beta-user-guide.md'),
    uatGuide: join(root, 'docs', 'reviews', 'R10E-windows-10-11-user-acceptance.md'),
    forbiddenFragments,
  });
  const asset = await createReleaseAssets({
    assetsDirectory,
    candidateDirectory,
    forbiddenFragments,
  });
  process.stdout.write(
    `${JSON.stringify({ artifactFiles: R10E_RELEASE_ASSET_NAMES, candidateFiles: 12, ...asset })}\n`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
