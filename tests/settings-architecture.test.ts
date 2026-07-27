import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESKTOP_BRIDGE_KEY, DESKTOP_IPC_CHANNELS } from '../packages/shared/src/desktop-api.js';

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

describe('Issue 010 architecture boundaries', () => {
  it('keeps settings and storage Electron-independent and safeStorage out of renderer/preload', async () => {
    const settings = await combined(await sourceFiles('packages/settings'));
    const storage = await combined(await sourceFiles('packages/storage'));
    const renderer = await combined(await sourceFiles('apps/web-ui/src'));
    const preload = await readFile(join(projectRoot, 'apps/desktop/src/preload.ts'), 'utf8');

    expect(settings).not.toMatch(/from\s+['"]electron['"]|@mystery-operations\/desktop/u);
    expect(storage).not.toMatch(/from\s+['"]electron['"]/u);
    expect(renderer).not.toMatch(
      /from\s+['"]electron['"]|from\s+['"]node:|@mystery-operations\/(?:db|storage)|safeStorage|\bipcRenderer\b/u,
    );
    expect(preload).not.toMatch(/safeStorage|node:fs|node:path/u);
  });

  it('uses only asynchronous safeStorage APIs after app readiness and has no plaintext fallback', async () => {
    const main = await readFile(join(projectRoot, 'apps/desktop/src/main.ts'), 'utf8');
    const store = await readFile(join(projectRoot, 'apps/desktop/src/credential-store.ts'), 'utf8');
    expect(main).toMatch(/app\s*\.\s*whenReady\(\)/u);
    expect(main).toContain('new DesktopSettingsRuntime');
    expect(store).toContain('isAsyncEncryptionAvailable');
    expect(store).toContain('encryptStringAsync');
    expect(store).toContain('decryptStringAsync');
    expect(`${main}\n${store}`).not.toContain('setUsePlainTextEncryption');
    expect(store).not.toMatch(/writeFileSync\([^)]*plaintext|process\.env\s*\[/u);
  });

  it('exposes one fixed preload method per fixed channel without raw IPC primitives', async () => {
    const preload = await readFile(join(projectRoot, 'apps/desktop/src/preload.ts'), 'utf8');
    const contract = await readFile(
      join(projectRoot, 'packages/shared/src/desktop-api.ts'),
      'utf8',
    );
    const channels = Object.values(DESKTOP_IPC_CHANNELS);

    expect(DESKTOP_BRIDGE_KEY).toBe('rednoteDesktop');
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).toHaveLength(20);
    for (const key of Object.keys(DESKTOP_IPC_CHANNELS)) {
      expect(preload).toContain(`${key}:`);
      expect(preload).toContain(`DESKTOP_IPC_CHANNELS.${key}`);
    }
    expect(preload).not.toMatch(
      /ipcRenderer\.(?:send|sendSync|on|once|postMessage)|exposeInMainWorld\([^,]+,\s*ipcRenderer/u,
    );
    expect(contract).not.toMatch(
      /\b(?:execute|fetch|http|ipc|network|query|queue|readFile|shell|spawn|sql|writeFile)\w*\s*\(/iu,
    );
  });

  it('keeps credential DTOs status-only and avoids identifying metadata', async () => {
    const contracts = await readFile(
      join(projectRoot, 'packages/settings/src/contracts.ts'),
      'utf8',
    );
    const statusStart = contracts.indexOf('export interface CredentialStatusView');
    const statusEnd = contracts.indexOf('export const SETUP_STATES', statusStart);
    const statusContract = contracts.slice(statusStart, statusEnd);

    expect(statusContract).toContain('readonly status: CredentialStatus');
    expect(statusContract).not.toMatch(
      /ciphertext|fingerprint|last.?4|prefix|value|plaintext|secret|path|length/iu,
    );
  });

  it('does not add network/model execution, platform actions, or forbidden policy settings', async () => {
    const issueSource = await combined([
      ...(await sourceFiles('packages/settings')),
      'packages/db/src/settings-repository.ts',
      'packages/storage/src/project-locator.ts',
      'packages/storage/src/diagnostic-report-store.ts',
      'apps/desktop/src/credential-store.ts',
      'apps/desktop/src/data-root-selection.ts',
      'apps/desktop/src/settings-runtime.ts',
      'apps/desktop/src/ipc-policy.ts',
      'apps/desktop/src/ipc.ts',
      'apps/web-ui/src/settings-page.tsx',
      'apps/web-ui/src/use-settings.ts',
    ]);
    const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const dependencyNames = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).join('\n');

    expect(issueSource).not.toMatch(
      /\bfetch\s*\(|axios|node:(?:http|https|net|tls)|from\s+['"](?:openai|anthropic)['"]|model.?run|cost.?ledger/iu,
    );
    expect(issueSource).not.toMatch(
      /xiaohongshu|小红书|自动(?:登录|发布|评论|私信)|风控|验证码|盗版|电子书下载/iu,
    );
    expect(issueSource).not.toMatch(/ai_disclosure|版权|copyright/iu);
    expect(dependencyNames).not.toMatch(/openai|anthropic|axios|playwright|puppeteer/iu);
  });

  it('does not expand BrowserWindow, CSP, navigation, or packaging permissions', async () => {
    const windowFactory = await readFile(
      join(projectRoot, 'apps/desktop/src/window-factory.ts'),
      'utf8',
    );
    const security = await readFile(
      join(projectRoot, 'apps/desktop/src/security-policy.ts'),
      'utf8',
    );
    const html = await readFile(join(projectRoot, 'apps/web-ui/index.html'), 'utf8');
    const packageScript = await readFile(join(projectRoot, 'scripts/package-desktop.mjs'), 'utf8');

    expect(windowFactory).toContain('contextIsolation: true');
    expect(windowFactory).toContain('nodeIntegration: false');
    expect(windowFactory).toContain('sandbox: true');
    expect(windowFactory).toContain('webviewTag: false');
    expect(security).toContain('will-navigate');
    expect(security).toContain('will-attach-webview');
    expect(html).toContain("default-src 'self'");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval|https?:\/\//u);
    expect(packageScript).toContain('[FuseV1Options.RunAsNode]: false');
    expect(packageScript).toContain('[FuseV1Options.OnlyLoadAppFromAsar]: true');
  });
});
