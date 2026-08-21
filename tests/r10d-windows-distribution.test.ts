import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

interface DistributionContract {
  readonly WINDOWS_APPLICATION_ID: string;
  readonly WINDOWS_MANIFEST_NAME: string;
  readonly readReleaseManifest: (directory: string) => Promise<unknown>;
  readonly writeReleaseManifest: (
    root: string,
    directory: string,
  ) => Promise<{ readonly files: readonly { readonly path: string }[] }>;
}

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
});
