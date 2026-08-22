import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('Web production and CI contracts W2-18/W2-24/W2-30', () => {
  it('uses one static Web entry with an explicit HTTPS Provider boundary and no desktop bridge', () => {
    const html = read('apps/web-ui/web.html');
    const config = read('vite.web.config.ts');
    const webSources = [
      'contracts.ts',
      'browser-provider.ts',
      'folder-port.ts',
      'handle-store.ts',
      'repository.ts',
      'runtime.ts',
      'ui.tsx',
      'w2-pages.tsx',
      'web-app.tsx',
      'web-main.tsx',
    ]
      .map((file) => read(`apps/web-ui/src/v2/web/${file}`))
      .join('\n');
    expect(html).toContain("connect-src 'self' https:");
    expect(html).not.toMatch(/unsafe-|https?:\/\//u);
    expect(config).toContain("outDir: fileURLToPath(new URL('./.vite/web'");
    expect(webSources).not.toMatch(/rednoteV2|rednoteDesktop|ipcRenderer|from ['"]electron/u);
    const provider = read('apps/web-ui/src/v2/web/browser-provider.ts');
    expect(provider.match(/this\.#fetch\(/gu) ?? []).toHaveLength(1);
    expect(webSources.replace(provider, '')).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|EventSource|sendBeacon/u,
    );
    expect(webSources).not.toMatch(/DETERMINISTIC_MOCK|r07-packaged-blackbox/u);
    const inspector = read('scripts/inspect-web-artifact.mjs');
    expect(inspector).toMatch(/__vite-browser-external/);
    expect(inspector).toMatch(/node:\(\?:fs\|path\|crypto/);
  });

  it('keeps Web required fast and moves installer lifecycle to manual history validation', () => {
    const workflow = read('.github/workflows/ci.yml');
    const webJob = workflow.slice(
      workflow.indexOf('  web-required:'),
      workflow.indexOf('  windows-required:'),
    );
    expect(webJob).toContain('--suite=normal');
    expect(webJob).toContain('npm run build:web');
    expect(webJob).toContain('npm run build:clipper');
    expect(webJob).toContain('npm run smoke:web-e2e');
    expect(webJob).toContain('npm run audit:dependencies');
    expect(webJob).not.toMatch(/electron|installer|package:desktop|capacity/iu);
    expect(webJob).not.toContain('npm run test:web');
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch'");
  });

  it('pins responsive real-browser checks without hiding overflow', () => {
    const harness = read('scripts/run-web-e2e.mjs');
    expect(harness).toContain('[1280, 800]');
    expect(harness).toContain('[1440, 900]');
    expect(harness).toContain('document.documentElement.scrollWidth');
    expect(harness).toContain("['edge'");
    expect(read('apps/web-ui/src/v2/styles.css')).not.toMatch(
      /\.web-[^{]*\{[^}]*overflow-x:\s*hidden/su,
    );
  });
});
