import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

interface DistributionContract {
  readonly WINDOWS_CI_FIXTURE_VERSION: string;
  readonly WINDOWS_APPLICATION_ID: string;
  readonly WINDOWS_INSTALLER_GUID: string;
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

interface LifecycleProcessContract {
  readonly assertInvocation: (
    stage: string,
    result:
      | { readonly kind: 'exit'; readonly code: number }
      | { readonly kind: 'timeout' }
      | { readonly kind: 'signal'; readonly signal: string }
      | { readonly kind: 'spawn_error'; readonly code: string },
    expectation: 'success' | 'nonzero',
    code: string,
  ) => number;
  readonly createRunningProcess: (
    child: EventEmitter & { exitCode: number | null; signalCode?: string | null },
    awaitExit?: (
      child: EventEmitter & { exitCode: number | null; signalCode?: string | null },
    ) => Promise<number | null>,
  ) => unknown;
  readonly formatFailureSummary: (error: Error, role?: 'primary' | 'cleanup') => string;
  readonly invokeProcess: (
    executable: string,
    arguments_: readonly string[],
    cwd: string,
    timeout?: number,
  ) => Promise<
    | { readonly kind: 'exit'; readonly code: number }
    | { readonly kind: 'timeout' }
    | { readonly kind: 'signal'; readonly signal: string }
    | { readonly kind: 'spawn_error'; readonly code: string }
  >;
  readonly parseTasklistProcesses: (stdout: string) => readonly {
    readonly image: string;
    readonly inInstall: boolean;
    readonly nsisHelper: boolean;
    readonly pid: number;
  }[];
  readonly retryProbe: <Value>(
    stage: string,
    probe: () => Promise<Value>,
    attempts?: number,
  ) => Promise<Value>;
  readonly selectLifecycleFailure: (
    primaryError: Error | undefined,
    cleanupError: Error | undefined,
  ) => Error | undefined;
  readonly stopRunning: (running: unknown) => Promise<number | null>;
  readonly waitForExit: (
    child: EventEmitter & { exitCode: number | null; signalCode?: string | null },
    timeout?: number,
  ) => Promise<number | null>;
  readonly waitForReport: (outputPath: string, timeout?: number) => Promise<unknown>;
}

const run = promisify(execFile);

async function loadContract(): Promise<DistributionContract> {
  return (await import(
    pathToFileURL(join(process.cwd(), 'scripts/windows-distribution-contract.mjs')).href
  )) as DistributionContract;
}

async function loadLifecycleProcessContract(): Promise<LifecycleProcessContract> {
  return (await import(
    pathToFileURL(join(process.cwd(), 'scripts/run-installer-lifecycle-smoke.mjs')).href
  )) as LifecycleProcessContract;
}

describe('R10D Windows distribution contracts', () => {
  it('only arms the owned running-app exit wait after the harness requests shutdown', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: () => boolean;
    };
    child.exitCode = null;
    let waits = 0;
    let killed = false;
    child.kill = () => {
      expect(waits).toBe(0);
      killed = true;
      child.exitCode = 0;
      return true;
    };
    const running = lifecycle.createRunningProcess(child, async () => {
      waits += 1;
      return 0;
    });

    expect(waits).toBe(0);
    await expect(lifecycle.stopRunning(running)).resolves.toBe(0);
    expect(killed).toBe(true);
    expect(waits).toBe(1);
  });

  it('keeps automatic smoke exit waiting bounded', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    const child = new EventEmitter() as EventEmitter & { exitCode: number | null };
    child.exitCode = null;
    await expect(lifecycle.waitForExit(child, 1)).rejects.toThrow(
      'INSTALLER_LIFECYCLE_SMOKE_EXIT_TIMEOUT',
    );
    expect(child.listenerCount('error')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('settles process exit races once and releases listeners', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: string | null;
    };
    child.exitCode = null;
    child.signalCode = null;
    const exited = lifecycle.waitForExit(child, 500);
    child.emit('exit', null, 'SIGTERM');
    await expect(exited).rejects.toThrow('INSTALLER_LIFECYCLE_SMOKE_EXIT_SIGNAL_SIGTERM');
    expect(child.listenerCount('error')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('handles already-exited children and bounded partial smoke reports', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    const child = new EventEmitter() as EventEmitter & { exitCode: number | null };
    child.exitCode = 0;
    await expect(lifecycle.waitForExit(child, 10)).resolves.toBe(0);
    expect(child.listenerCount('exit')).toBe(0);

    const directory = await mkdtemp(join(tmpdir(), 'r10d-partial-report-'));
    const outputPath = join(directory, 'report.json');
    await writeFile(outputPath, '{');
    const completed = lifecycle.waitForReport(outputPath, 500);
    setTimeout(() => void writeFile(outputPath, '{"ok":true}'), 20);
    await expect(completed).resolves.toEqual({ ok: true });
    await rm(directory, { force: true, recursive: true });
  });

  it('classifies installer child outcomes without collapsing failures into nonzero exits', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    const cwd = process.cwd();
    await expect(
      lifecycle.invokeProcess(process.execPath, ['-e', 'process.exit(0)'], cwd, 2_000),
    ).resolves.toEqual({ code: 0, kind: 'exit' });
    await expect(
      lifecycle.invokeProcess(process.execPath, ['-e', 'process.exit(7)'], cwd, 2_000),
    ).resolves.toEqual({ code: 7, kind: 'exit' });
    await expect(
      lifecycle.invokeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], cwd, 20),
    ).resolves.toEqual({ kind: 'timeout' });
    await expect(
      lifecycle.invokeProcess(join(cwd, 'missing-r10d-installer.exe'), [], cwd, 2_000),
    ).resolves.toMatchObject({ kind: 'spawn_error' });
  });

  it('requires a normal nonzero exit for blocked installer lifecycle stages', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    for (const stage of ['L04-running-upgrade', 'L05-corrupt-installer', 'L07-downgrade']) {
      expect(
        lifecycle.assertInvocation(
          stage,
          { code: 5, kind: 'exit' },
          'nonzero',
          'INSTALLER_EXPECTED_BLOCK',
        ),
      ).toBe(5);
      for (const result of [
        { kind: 'timeout' } as const,
        { kind: 'signal', signal: 'SIGTERM' } as const,
        { code: 'ENOENT', kind: 'spawn_error' } as const,
      ]) {
        expect(() =>
          lifecycle.assertInvocation(stage, result, 'nonzero', 'INSTALLER_EXPECTED_BLOCK'),
        ).toThrow(/INSTALLER_EXPECTED_BLOCK_(?:TIMEOUT|SIGNAL|SPAWN_ERROR)/u);
      }
    }
  });

  it('retries transient directed probes but fails closed after the bound', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    let attempts = 0;
    await expect(
      lifecycle.retryProbe('registry', async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient');
        return 'ready';
      }),
    ).resolves.toBe('ready');
    expect(attempts).toBe(2);
    await expect(
      lifecycle.retryProbe('registry', async () => {
        throw new Error('persistent');
      }),
    ).rejects.toThrow('INSTALLER_LIFECYCLE_REGISTRY_PROBE_FAILED');
  });

  it('parses only the exact application image from the bounded tasklist probe', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    expect(
      lifecycle.parseTasklistProcesses(
        '"RednoteMysteryOperations.exe","4242","Console","1","12,000 K"\r\n' +
          '"RednoteMysteryOperations-helper.exe","4243","Console","1","8,000 K"\r\n',
      ),
    ).toEqual([
      {
        image: 'RednoteMysteryOperations.exe',
        inInstall: true,
        nsisHelper: false,
        pid: 4242,
      },
    ]);
    expect(lifecycle.parseTasklistProcesses('INFO: No tasks match.\r\n')).toEqual([]);
    expect(() =>
      lifecycle.parseTasklistProcesses('RednoteMysteryOperations.exe malformed'),
    ).toThrow('INSTALLER_LIFECYCLE_PROCESS_PROBE_INVALID');
  });

  it('preserves primary failure identity and emits bounded path-free summaries', async () => {
    const lifecycle = await loadLifecycleProcessContract();
    const primary = new Error(`PRIVATE_PATH_${process.cwd()}\nsecret detail`);
    const cleanup = new Error('INSTALLER_LIFECYCLE_CLEANUP_TIMEOUT');
    expect(lifecycle.selectLifecycleFailure(primary, cleanup)).toBe(primary);
    expect(lifecycle.selectLifecycleFailure(undefined, cleanup)).toBe(cleanup);
    const summary = lifecycle.formatFailureSummary(primary);
    expect(summary).toContain('INSTALLER_LIFECYCLE_UNCLASSIFIED_FAILURE');
    expect(summary).not.toContain(process.cwd());
    expect(summary).not.toContain('\n');
    expect(summary.length).toBeLessThanOrEqual(940);
  });

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
    expect(builder).toContain('guid: 93211c80-b79d-59cd-848c-fd9f791d6cc2');
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
    expect(installerInclude).toMatch(/!macro customInit\s+!insertmacro customCheckAppRunning/u);
    expect(installerInclude).toContain('CreateToolhelp32Snapshot');
    expect(installerInclude).toContain('Process32FirstW');
    expect(installerInclude).toContain('Process32NextW');
    expect(installerInclude).toContain('w "RednoteMysteryOperations.exe"');
    expect(installerInclude).toContain('lstrcmpiW');
    expect(installerInclude).toContain('CloseHandle');
    expect(installerInclude).not.toContain('nsProcess::FindProcess');
    expect(installerInclude).not.toContain('USERNAME eq %USERNAME%');
    expect(installerInclude).not.toContain('tasklist');
    expect(installerInclude).not.toContain('!insertmacro IS_POWERSHELL_AVAILABLE');
    expect(installerInclude).not.toContain('!insertmacro FIND_PROCESS');
    expect(installerInclude).toMatch(/SetErrorLevel 1603\s+Quit/u);
    expect(installerInclude).toContain('${VersionCompare}');
    const contract = await loadContract();
    expect(contract.WINDOWS_INSTALLER_GUID).toBe('93211c80-b79d-59cd-848c-fd9f791d6cc2');
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
