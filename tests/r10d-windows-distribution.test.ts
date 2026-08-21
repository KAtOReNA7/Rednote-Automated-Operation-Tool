import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

interface DistributionContract {
  readonly WINDOWS_CI_FIXTURE_VERSION: string;
  readonly WINDOWS_APPLICATION_ID: string;
  readonly WINDOWS_MANIFEST_NAME: string;
  readonly isCiFixtureVersionEnvironment: (
    environment: Record<string, string>,
    platform: string,
  ) => boolean;
  readonly readApplicationVersion: (
    root: string,
    environment: Record<string, string>,
    platform: string,
  ) => string;
  readonly assertInstallerArtifactVersion: (installerName: string, version: string) => void;
  readonly installerArtifactName: (version: string) => string;
  readonly resolveInstallerBuildContract: (
    root: string,
    environment: Record<string, string>,
    platform: string,
  ) => {
    readonly applicationVersion: string;
    readonly outputDirectory: string;
    readonly installersDirectory: string;
    readonly builderConfigArguments: readonly string[];
  };
  readonly readReleaseManifest: (
    directory: string,
    versions?: readonly string[],
  ) => Promise<unknown>;
  readonly writeReleaseManifest: (
    root: string,
    directory: string,
    version?: string,
  ) => Promise<{ readonly files: readonly { readonly path: string }[] }>;
}

const run = promisify(execFile);

async function loadContract(): Promise<DistributionContract> {
  return (await import(
    pathToFileURL(join(process.cwd(), 'scripts/windows-distribution-contract.mjs')).href
  )) as DistributionContract;
}

describe('R10D Windows distribution contracts', () => {
  it('uses one beta version, fixed app identity, per-user NSIS and no publish/update configuration', async () => {
    const root = process.cwd();
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      version: string;
      devDependencies: Record<string, string>;
    };
    const builder = await readFile(join(root, 'electron-builder.yml'), 'utf8');
    expect(packageJson.version).toBe('0.1.0-beta.1');
    expect(packageJson.devDependencies['electron-builder']).toBe('26.15.3');
    expect(builder).toContain('appId: io.github.katorena7.rednote-mystery-operations');
    expect(builder).toContain('perMachine: false');
    expect(builder).toContain('allowElevation: false');
    expect(builder).toContain('deleteAppDataOnUninstall: false');
    expect(builder).toContain('runAfterFinish: false');
    expect(builder).toContain('differentialPackage: false');
    expect(builder).toContain('packElevateHelper: false');
    expect(builder).not.toMatch(
      /electron-updater|autoUpdater|latest\.yml|blockmap|publish provider/iu,
    );
    expect(await readFile(join(root, 'scripts', 'package-installer.mjs'), 'utf8')).toContain(
      "'never'",
    );
    expect(await readFile(join(root, 'scripts', 'package-installer.mjs'), 'utf8')).not.toContain(
      '...process.env',
    );
    expect(
      await readFile(join(root, 'scripts', 'run-installer-lifecycle-smoke.mjs'), 'utf8'),
    ).toContain("'xiaohongshu-mystery-operations'");
    const installerInclude = await readFile(join(root, 'build', 'installer.nsh'), 'utf8');
    expect(installerInclude).toContain('!include "WordFunc.nsh"');
    expect(installerInclude).toContain('!insertmacro VersionCompare');
    expect(installerInclude).toContain('!insertmacro un.VersionCompare');
    expect(installerInclude).toContain('!macro customCheckAppRunning');
    expect(installerInclude).toContain('${VersionCompare}');
  });

  it('opens the beta.0 fixture seam only for the exact GitHub Windows tuple', async () => {
    const contract = await loadContract();
    const fixture = {
      GITHUB_ACTIONS: 'true',
      REDNOTE_R10D_CI_FIXTURE: '1',
      REDNOTE_R10D_CI_FIXTURE_VERSION: '0.1.0-beta.0',
    };
    expect(contract.isCiFixtureVersionEnvironment(fixture, 'win32')).toBe(true);
    expect(contract.readApplicationVersion(process.cwd(), fixture, 'win32')).toBe('0.1.0-beta.0');
    expect(() => contract.readApplicationVersion(process.cwd(), fixture, 'linux')).toThrow(
      'R10D_VERSION_OVERRIDE_CI_ONLY',
    );
  });

  it('derives locked electron-builder version and output overrides for canonical and fixture builds', async () => {
    const contract = await loadContract();
    const canonical = contract.resolveInstallerBuildContract(process.cwd(), {}, 'win32');
    const fixture = contract.resolveInstallerBuildContract(
      process.cwd(),
      {
        GITHUB_ACTIONS: 'true',
        REDNOTE_PACKAGE_OUTPUT_VARIANT: 'r10d-beta0-fixture',
        REDNOTE_R10D_CI_FIXTURE: '1',
        REDNOTE_R10D_CI_FIXTURE_VERSION: '0.1.0-beta.0',
      },
      'win32',
    );
    expect(canonical.applicationVersion).toBe('0.1.0-beta.1');
    expect(canonical.builderConfigArguments).toEqual([
      '--config.extraMetadata.version=0.1.0-beta.1',
      '--config.directories.output=out/installer',
    ]);
    expect(fixture.applicationVersion).toBe('0.1.0-beta.0');
    expect(fixture.builderConfigArguments).toEqual([
      '--config.extraMetadata.version=0.1.0-beta.0',
      '--config.directories.output=out/r10d-beta0-fixture/installer',
    ]);
    expect(contract.installerArtifactName(canonical.applicationVersion)).toBe(
      'RednoteStudio-0.1.0-beta.1-win-x64-setup.exe',
    );
    expect(contract.installerArtifactName(fixture.applicationVersion)).toBe(
      'RednoteStudio-0.1.0-beta.0-win-x64-setup.exe',
    );
    expect(() =>
      contract.assertInstallerArtifactVersion(
        'RednoteStudio-0.1.0-beta.1-win-x64-setup.exe',
        fixture.applicationVersion,
      ),
    ).toThrow('NSIS installer artifact version does not match the verified manifest version.');
    expect(() =>
      contract.resolveInstallerBuildContract(
        process.cwd(),
        { REDNOTE_PACKAGE_OUTPUT_VARIANT: '../../escape' },
        'win32',
      ),
    ).toThrow('Package output variant must be a finite safe directory name.');
  });

  it('writes and validates a closed sorted manifest without absolute paths', async () => {
    const contract = await loadContract();
    const root = resolve(process.cwd());
    const directory = await mkdtemp(join(tmpdir(), 'r10d-manifest-'));
    await mkdir(join(directory, 'resources'), { recursive: true });
    await writeFile(join(directory, 'RednoteMysteryOperations.exe'), 'synthetic executable');
    await writeFile(join(directory, '启动 Rednote Studio.cmd'), 'synthetic launcher');
    await writeFile(join(directory, 'resources', 'app.asar'), 'synthetic asar');
    const manifest = await contract.writeReleaseManifest(root, directory);
    expect(manifest.files.map((file) => file.path)).toEqual(
      ['RednoteMysteryOperations.exe', 'resources/app.asar', '启动 Rednote Studio.cmd'].sort(
        (left, right) => left.localeCompare(right),
      ),
    );
    await expect(contract.readReleaseManifest(directory)).resolves.toMatchObject({
      appId: contract.WINDOWS_APPLICATION_ID,
      applicationVersion: '0.1.0-beta.1',
    });
    const path = join(directory, contract.WINDOWS_MANIFEST_NAME);
    const invalid = JSON.parse(await readFile(path, 'utf8')) as { files: { path: string }[] };
    const firstFile = invalid.files[0];
    if (firstFile === undefined) throw new Error('Synthetic manifest unexpectedly has no files.');
    firstFile.path = '../outside';
    await writeFile(path, JSON.stringify(invalid));
    await expect(contract.readReleaseManifest(directory)).rejects.toThrow(
      'Invalid release manifest file entry.',
    );
  });

  it('accepts the CI-only beta.0 manifest only when the caller explicitly permits it', async () => {
    const contract = await loadContract();
    const directory = await mkdtemp(join(tmpdir(), 'r10d-beta0-manifest-'));
    await writeFile(join(directory, 'RednoteMysteryOperations.exe'), 'synthetic executable');
    await contract.writeReleaseManifest(
      process.cwd(),
      directory,
      contract.WINDOWS_CI_FIXTURE_VERSION,
    );
    await expect(contract.readReleaseManifest(directory)).rejects.toThrow(
      'Invalid release manifest schema.',
    );
    await expect(
      contract.readReleaseManifest(directory, [contract.WINDOWS_CI_FIXTURE_VERSION]),
    ).resolves.toMatchObject({ applicationVersion: contract.WINDOWS_CI_FIXTURE_VERSION });
  });

  it('rejects a prepackaged manifest whose exact head does not match the installer build', async () => {
    const contract = await loadContract();
    const variant = 'r10d-manifest-mismatch';
    const output = join(process.cwd(), 'out', variant);
    const packageDirectory = join(output, 'synthetic-win32-x64');
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, 'RednoteMysteryOperations.exe'), 'synthetic executable');
    await contract.writeReleaseManifest(process.cwd(), packageDirectory);
    const manifestPath = join(packageDirectory, contract.WINDOWS_MANIFEST_NAME);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { buildCommit: string };
    manifest.buildCommit = 'a'.repeat(40);
    await writeFile(manifestPath, JSON.stringify(manifest));
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      REDNOTE_PACKAGE_OUTPUT_VARIANT: variant,
    };
    delete environment.REDNOTE_R10D_CI_FIXTURE;
    delete environment.REDNOTE_R10D_CI_FIXTURE_VERSION;
    try {
      await expect(
        run(process.execPath, ['scripts/package-installer.mjs'], {
          cwd: process.cwd(),
          env: environment,
          windowsHide: true,
        }),
      ).rejects.toMatchObject({ stderr: expect.stringContaining('Prepackaged manifest') });
    } finally {
      await rm(output, { force: true, recursive: true });
    }
  });
});
