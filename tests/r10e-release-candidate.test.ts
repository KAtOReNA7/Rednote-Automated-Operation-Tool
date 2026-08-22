import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface ReleaseCandidateContract {
  readonly R10E_RELEASE_ASSET_NAMES: readonly string[];
  readonly R10E_SCHEMA_VERSION: string;
  readonly R10E_ZIP_NAME: string;
  readonly assembleReleaseCandidate: (options: {
    canonicalBundle: string;
    directory: string;
    fixtureBundle: string;
    forbiddenFragments?: string[];
    provenance: Readonly<Record<string, unknown>>;
    userGuide: string;
    uatGuide: string;
  }) => Promise<{
    files: string[];
    provenance: Readonly<Record<string, unknown>>;
  }>;
  readonly createReleaseAssets: (options: {
    assetsDirectory: string;
    candidateDirectory: string;
    forbiddenFragments: string[];
  }) => Promise<{ name: string; sha256: string; size: number }>;
  readonly validateReleaseAssets: (
    assetsDirectory: string,
    candidateDirectory: string,
  ) => Promise<{ name: string; sha256: string; size: number }>;
  readonly validateReleaseCandidate: (
    directory: string,
    options?: { expectedSourceCommit?: string; forbiddenFragments?: string[] },
  ) => Promise<unknown>;
}

interface DistributionContract {
  readonly WINDOWS_CANONICAL_VERSION: string;
  readonly WINDOWS_CI_FIXTURE_VERSION: string;
  readonly installerArtifactName: (version: string) => string;
  readonly writeReleaseManifest: (
    projectRoot: string,
    directory: string,
    version: string,
  ) => Promise<unknown>;
}

const projectRoot = join(import.meta.dirname, '..');
const releaseCandidate = (await import(
  pathToFileURL(join(projectRoot, 'scripts/package-release-candidate.mjs')).href
)) as ReleaseCandidateContract;
const distribution = (await import(
  pathToFileURL(join(projectRoot, 'scripts/windows-distribution-contract.mjs')).href
)) as DistributionContract;
const {
  assembleReleaseCandidate,
  createReleaseAssets,
  R10E_RELEASE_ASSET_NAMES,
  R10E_SCHEMA_VERSION,
  R10E_ZIP_NAME,
  validateReleaseAssets,
  validateReleaseCandidate,
} = releaseCandidate;
const {
  installerArtifactName,
  WINDOWS_CANONICAL_VERSION,
  WINDOWS_CI_FIXTURE_VERSION,
  writeReleaseManifest,
} = distribution;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: projectRoot,
  encoding: 'utf8',
  windowsHide: true,
}).trim();

function hash(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function provenance() {
  return {
    applicationVersion: WINDOWS_CANONICAL_VERSION,
    lockfile: { sha256: 'a'.repeat(64) },
    runner: { arch: 'X64', os: 'Windows' },
    schemaVersion: R10E_SCHEMA_VERSION,
    sourceCommit,
    sourceTree: 'b'.repeat(40),
    toolchain: { electronBuilder: '26.15.3', node: '24.0.0', npm: '11.13.0' },
    workflow: { attempt: 1, runId: 12345 },
  };
}

async function makeBundle(directory: string, version: string, marker: string) {
  await mkdir(directory, { recursive: true });
  const installer = installerArtifactName(version);
  const installerBytes = Buffer.from(`synthetic-installer:${version}:${marker}`, 'utf8');
  await writeFile(join(directory, installer), installerBytes);
  await writeFile(join(directory, 'INSTALLATION.txt'), `TEST ONLY ${version}\n`, 'utf8');
  await writeReleaseManifest(projectRoot, directory, version);
  await writeFile(
    join(directory, 'SHA256SUMS.txt'),
    `${installer} ${installerBytes.length} ${hash(installerBytes)}\n`,
    'utf8',
  );
  return { installer, installerBytes };
}

describe('R10E release candidate contract', () => {
  let temporaryRoot: string;
  let canonicalBundle: string;
  let fixtureBundle: string;
  let candidateDirectory: string;
  let userGuide: string;
  let uatGuide: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'rednote-r10e-'));
    canonicalBundle = join(temporaryRoot, 'canonical');
    fixtureBundle = join(temporaryRoot, 'fixture');
    candidateDirectory = join(temporaryRoot, 'candidate-output');
    userGuide = join(temporaryRoot, 'USER-GUIDE.source.md');
    uatGuide = join(temporaryRoot, 'WINDOWS-10-11-UAT.source.md');
    await makeBundle(canonicalBundle, WINDOWS_CANONICAL_VERSION, 'canonical');
    await makeBundle(fixtureBundle, WINDOWS_CI_FIXTURE_VERSION, 'fixture');
    await writeFile(userGuide, '# Synthetic user guide\n', 'utf8');
    await writeFile(uatGuide, '# Synthetic UAT\nWindows 10 NOT_RUN\nWindows 11 NOT_RUN\n', 'utf8');
  });

  afterEach(async () => {
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  async function assemble(forbiddenFragments: string[] = []) {
    return assembleReleaseCandidate({
      canonicalBundle,
      directory: candidateDirectory,
      fixtureBundle,
      forbiddenFragments,
      provenance: provenance(),
      userGuide,
      uatGuide,
    });
  }

  it('assembles a closed, sorted, TEST-ONLY-isolated candidate without changing R10D bytes', async () => {
    const originalInstaller = await readFile(
      join(canonicalBundle, installerArtifactName(WINDOWS_CANONICAL_VERSION)),
    );
    const result = await assemble();

    expect(result.files).toHaveLength(12);
    expect(result.files).toContain(
      'upgrade-fixture/TEST-ONLY-beta.0/TEST-ONLY-RednoteStudio-0.1.0-beta.0-win-x64-setup.exe',
    );
    expect(
      await readFile(
        join(candidateDirectory, 'candidate', installerArtifactName(WINDOWS_CANONICAL_VERSION)),
      ),
    ).toEqual(originalInstaller);
    const checksumPaths = (await readFile(join(candidateDirectory, 'SHA256SUMS.txt'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => line.split(' ').slice(2).join(' '));
    expect(checksumPaths).toEqual([...checksumPaths].sort());
    expect(result.provenance.sourceCommit).toBe(sourceCommit);
  });

  it.each([
    ['tamper', async () => appendFile(join(candidateDirectory, 'USER-GUIDE.md'), 'tampered')],
    ['extra file', async () => writeFile(join(candidateDirectory, 'unexpected.txt'), 'extra')],
    [
      'unsafe checksum path',
      async () => {
        const path = join(candidateDirectory, 'SHA256SUMS.txt');
        const value = await readFile(path, 'utf8');
        await writeFile(path, value.replace('candidate/', '../candidate/'), 'utf8');
      },
    ],
  ])('rejects candidate %s', async (_name, corrupt) => {
    await assemble();
    await corrupt();
    await expect(validateReleaseCandidate(candidateDirectory)).rejects.toThrow(/^R10E_/u);
  });

  it('rejects a symlink or junction before accepting the closed set', async () => {
    await assemble();
    await symlink(
      join(candidateDirectory, 'candidate'),
      join(candidateDirectory, 'linked-candidate'),
      'junction',
    );
    await expect(validateReleaseCandidate(candidateDirectory)).rejects.toThrow(
      'R10E_LINK_NOT_ALLOWED',
    );
  });

  it('rejects forbidden private fragments in UTF-8 candidate bytes', async () => {
    await assemble();
    await appendFile(join(candidateDirectory, 'USER-GUIDE.md'), 'PRIVATE-RUNNER-NAME');
    await expect(
      validateReleaseCandidate(candidateDirectory, {
        forbiddenFragments: ['PRIVATE-RUNNER-NAME'],
      }),
    ).rejects.toThrow(/^R10E_/u);
  });

  it('binds validation to the expected exact source commit', async () => {
    await assemble();
    await expect(
      validateReleaseCandidate(candidateDirectory, {
        expectedSourceCommit: 'c'.repeat(40),
      }),
    ).rejects.toThrow('R10E_PROVENANCE_IDENTITY_INVALID');
  });

  it('rejects a fixture built from a different source commit', async () => {
    const manifestPath = join(fixtureBundle, 'release-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      buildCommit: string;
    };
    manifest.buildCommit = 'd'.repeat(40);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await expect(assemble()).rejects.toThrow('R10E_SOURCE_BUNDLE_IDENTITY_INVALID');
  });

  it('creates exactly five release assets and detects ZIP checksum tampering', async () => {
    await assemble();
    const assetsDirectory = join(temporaryRoot, 'release-assets');
    const identity = await createReleaseAssets({
      assetsDirectory,
      candidateDirectory,
      forbiddenFragments: [],
    });

    expect((await readdir(assetsDirectory)).sort()).toEqual([...R10E_RELEASE_ASSET_NAMES].sort());
    expect(identity.name).toBe(R10E_ZIP_NAME);
    expect(identity.size).toBe((await stat(join(assetsDirectory, R10E_ZIP_NAME))).size);
    await expect(validateReleaseAssets(assetsDirectory, candidateDirectory)).resolves.toMatchObject(
      {
        name: R10E_ZIP_NAME,
        sha256: identity.sha256,
      },
    );

    await appendFile(join(assetsDirectory, R10E_ZIP_NAME), 'tampered');
    await expect(validateReleaseAssets(assetsDirectory, candidateDirectory)).rejects.toThrow(
      'R10E_ZIP_CHECKSUM_MISMATCH',
    );
  });

  it('does not permit an open canonical source bundle', async () => {
    await cp(userGuide, join(canonicalBundle, 'unexpected.md'));
    await expect(assemble()).rejects.toThrow('R10E_SOURCE_BUNDLE_OPEN');
  });
});
