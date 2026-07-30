import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('Issue 006 architecture boundaries', () => {
  it('keeps renderer code free of Electron, Node, database, and workflow imports', () => {
    const renderer = [
      'apps/web-ui/src/app.tsx',
      'apps/web-ui/src/error-boundary.tsx',
      'apps/web-ui/src/main.tsx',
      'apps/web-ui/src/routes.ts',
      'apps/web-ui/src/settings-page.tsx',
      'apps/web-ui/src/use-desktop-status.ts',
      'apps/web-ui/src/use-hash-route.ts',
      'apps/web-ui/src/use-settings.ts',
    ]
      .map(read)
      .join('\n');
    expect(renderer).not.toMatch(/from ['"]electron['"]/u);
    expect(renderer).not.toMatch(/node:/u);
    expect(renderer).not.toMatch(/@mystery-operations\/(?:db|workflows)/u);
    expect(renderer).not.toMatch(/\bipcRenderer\b/u);
  });

  it('keeps preload limited to contextBridge, ipcRenderer, and shared contracts', () => {
    const preload = read('apps/desktop/src/preload.ts');
    expect(preload).toContain("import { contextBridge, ipcRenderer } from 'electron'");
    expect(preload).not.toMatch(/ipcRenderer\.(?:send|sendSync|on|once|postMessage)/u);
    expect(preload).not.toMatch(/node:/u);
    expect(preload).not.toMatch(/@mystery-operations\/(?:core|db|workflows)/u);
    expect(preload).not.toMatch(/\b(?:process|Buffer)\b/u);
  });

  it('does not expose raw IPC or arbitrary file, command, network, SQL, or queue methods', () => {
    const contract = read('packages/shared/src/desktop-api.ts');
    expect(contract).not.toMatch(
      /\b(?:execute|file|fetch|http|ipc|network|query|queue|read|shell|spawn|sql|write)\w*\s*\(/iu,
    );
  });

  it('uses a strict CSP without unsafe script or style escapes', () => {
    const html = read('apps/web-ui/index.html');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).not.toContain("'unsafe-eval'");
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toMatch(/https?:\/\//u);
  });

  it('does not contain eval, Function construction, external opening, or webview markup', () => {
    const production = [
      read('apps/desktop/src/main.ts'),
      read('apps/desktop/src/preload.ts'),
      read('apps/web-ui/src/app.tsx'),
      read('apps/web-ui/index.html'),
    ].join('\n');
    expect(production).not.toMatch(/\beval\s*\(/u);
    expect(production).not.toMatch(/\bnew\s+Function\b/u);
    expect(production).not.toContain('openExternal');
    expect(production).not.toMatch(/<webview\b/iu);
  });

  it('pins Electron and packaging dependencies exactly', () => {
    const manifest = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies.electron).toBe('43.2.0');
    expect(manifest.devDependencies['@electron/packager']).toBe('20.0.4');
    expect(manifest.devDependencies['@electron/fuses']).toBe('2.1.3');
  });

  it('packages a directory only and configures no installer, release, signing, or updater', () => {
    const packageScript = read('scripts/package-desktop.mjs');
    expect(packageScript).toContain("platform: 'win32'");
    expect(packageScript).toContain("arch: 'x64'");
    expect(packageScript).toContain('asar: true');
    expect(packageScript).not.toMatch(
      /@electron-forge\/maker|electron-builder|electron-updater|publishConfig|osxSign|windowsSign|certificateFile|githubRelease|squirrel|wix|msi/iu,
    );
  });

  it('flips every required Electron fuse explicitly', () => {
    const packageScript = read('scripts/package-desktop.mjs');
    for (const fuse of [
      'RunAsNode',
      'EnableNodeOptionsEnvironmentVariable',
      'EnableNodeCliInspectArguments',
      'EnableEmbeddedAsarIntegrityValidation',
      'OnlyLoadAppFromAsar',
    ]) {
      expect(packageScript).toContain(`FuseV1Options.${fuse}`);
    }
    expect(packageScript).toContain('strictlyRequireAllFuses: true');
  });

  it('uses a temporary database only for foundation health', () => {
    const health = read('apps/desktop/src/foundation-health.ts');
    expect(health).toContain('mkdtemp');
    expect(health).toContain("'红笺 基础自检-'");
    expect(health).toContain('await rm(directory, { force: true, recursive: true })');
    expect(health).not.toContain("app.getPath('userData')");
    expect(health).not.toContain('new JobWorker');
  });

  it('contains no production TCP server or external URL implementation', () => {
    const production = [
      read('apps/desktop/src/main.ts'),
      read('apps/desktop/src/preload.ts'),
      read('apps/desktop/src/security-policy.ts'),
      read('apps/web-ui/src/app.tsx'),
    ].join('\n');
    expect(production).not.toMatch(/\bcreateServer\s*\(|\.listen\s*\(/u);
    expect(production).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/u);
  });

  it('activates the library, research, and Issue 022 Topic pages while retaining five placeholders', () => {
    const routes = read('apps/web-ui/src/routes.ts');
    expect(routes.match(/尚未在当前里程碑实现。/gu)).toHaveLength(5);
    expect(routes).toContain('管理本地书目实体、来源观察、发现覆盖与待确认消歧。');
    expect(routes).toContain('管理版本化来源、精确证据、原子事实、事实评估与可逆冲突决定。');
    expect(routes).toContain('管理五类候选、确定性资格与排序、语义去重及 FIRST_30_V1 配额计划。');
  });
});
