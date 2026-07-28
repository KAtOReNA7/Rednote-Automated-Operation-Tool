import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(join(projectRoot, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(child)));
    } else if (/\.(?:c?js|mjs|tsx?)$/u.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

async function combined(files: readonly string[]): Promise<string> {
  return (await Promise.all(files.map((file) => readFile(join(projectRoot, file), 'utf8')))).join(
    '\n',
  );
}

describe('Issue 008 package and process boundaries', () => {
  it('keeps storage Electron-independent and Core dependency-free', async () => {
    const storageFiles = await sourceFiles('packages/storage');
    const coreFiles = await sourceFiles('packages/core');
    const storageSource = await combined(storageFiles);
    const coreSource = await combined(coreFiles);

    expect(storageSource).not.toMatch(/from\s+['"]electron['"]/u);
    expect(storageSource).not.toMatch(/node:(?:http|https|net|tls)/u);
    expect(coreSource).not.toMatch(/@mystery-operations\/(?:db|storage|workflows)/u);
    expect(coreSource).not.toMatch(/from\s+['"]electron['"]/u);
  });

  it('keeps renderer and preload away from storage, node:fs and arbitrary path APIs', async () => {
    const rendererSource = await combined(await sourceFiles('apps/web-ui'));
    const preloadSource = await readFile(join(projectRoot, 'apps/desktop/src/preload.ts'), 'utf8');
    const desktopApi = await readFile(
      join(projectRoot, 'packages/shared/src/desktop-api.ts'),
      'utf8',
    );

    expect(rendererSource).not.toMatch(/@mystery-operations\/storage|node:fs|node:path/u);
    expect(preloadSource).not.toMatch(/@mystery-operations\/storage|node:fs/u);
    expect(preloadSource).not.toMatch(/readFile|writeFile|readdir|openPath|absolutePath/iu);
    expect(desktopApi).not.toMatch(/readFile|writeFile|readdir|openPath|absolutePath/iu);
  });

  it('exports no arbitrary delete, recursive scan, shell-open or production-root API', async () => {
    const storageIndex = await readFile(join(projectRoot, 'packages/storage/src/index.ts'), 'utf8');
    const storageSource = await combined(await sourceFiles('packages/storage'));

    expect(storageIndex).not.toMatch(/delete|remove|recursive|scan/iu);
    expect(storageSource).not.toMatch(/shell\.open(?:Path|External)/u);
    expect(storageSource).not.toMatch(/app\.getPath|process\.cwd\(\)|homedir\(\)/u);
    expect(storageSource).not.toMatch(/LongPathsEnabled|reg(?:\.exe|\s+add)|group policy/iu);
  });

  it('adds no cloud, telemetry, API, model, OCR, image or platform-action dependency', async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const packages = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    const names = Object.keys(packages).join('\n');
    const issue008Source = await combined([
      ...(await sourceFiles('packages/storage')),
      'packages/shared/src/storage-contracts.ts',
    ]);

    expect(names).not.toMatch(/s3|oss|cos|dropbox|onedrive|icloud|webdav|sentry|openai|ocr/iu);
    expect(issue008Source).not.toMatch(
      /login|captcha|comment|direct.?message|risk.?control|openai|ocr|cloud.?storage/iu,
    );
  });

  it('retains frozen AI disclosure and excludes copyright from storage gates', async () => {
    const migrations = await readFile(join(projectRoot, 'packages/db/src/migrations.ts'), 'utf8');
    const storageSource = await combined(await sourceFiles('packages/storage'));

    expect(migrations).toContain(
      'ai_disclosure INTEGER NOT NULL DEFAULT 0 CHECK (ai_disclosure = 0)',
    );
    expect(storageSource).not.toMatch(/ai_disclosure|copyright|版权/iu);
  });

  it('keeps the Issue 008 instruction in the historical archive and does not create Issue 010 artifacts', async () => {
    const instruction = join(
      projectRoot,
      'docs/instructions/m1/M1-Issue008-local-file-repository-Codex-instruction.txt',
    );
    expect(await readFile(instruction, 'utf8')).toContain('M1 Issue 008：本地文件仓库');

    const changedScope = [
      ...(await sourceFiles('packages/storage')),
      'packages/shared/src/storage-contracts.ts',
      'docs/adr/0005-local-file-repository.md',
    ]
      .map((file) => relative(projectRoot, join(projectRoot, file)))
      .join('\n');
    expect(changedScope).not.toMatch(/issue010|settings-wizard|key-reference/iu);
  });

  it('registers an independent Windows storage gate without removing prior CI gates', async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const ci = await readFile(join(projectRoot, '.github/workflows/ci.yml'), 'utf8');
    const required = [
      'npm ci',
      'npm run format-check',
      'npm run lint',
      'npm run typecheck',
      'npm run test:constraints',
      'npm run test:db',
      'npm run test:queue',
      'npm run test:desktop',
      'npm run test:storage',
      'npm run test:electron-smoke',
      'npm run test',
      'npm run build',
      'npm run package:desktop',
      'npm run test:packaged-smoke',
      'npm run audit:dependencies',
    ];

    expect(packageJson.scripts['test:storage']).toBeDefined();
    for (const command of required) {
      expect(ci).toContain(command);
    }
    expect(ci).toContain('runs-on: windows-latest');
  });
});
