import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Issue 017 extension architecture and forbidden scope', () => {
  it('ships one MV3 source for Chrome and Edge with the minimum exact permissions', () => {
    const manifest = JSON.parse(source('apps/clipper/static/manifest.json')) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({
      commands: {
        _execute_action: {
          suggested_key: { default: 'Alt+Shift+Y' },
        },
      },
      host_permissions: ['http://127.0.0.1/*'],
      incognito: 'not_allowed',
      manifest_version: 3,
      permissions: ['activeTab', 'scripting', 'storage'],
    });
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('externally_connectable');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    expect(manifest.permissions).not.toContain('commands');
  });

  it('uses an isolated top-frame action flow and restricts extension storage to trusted contexts', () => {
    const worker = source('apps/clipper/src/service-worker.ts');
    expect(worker).toContain("accessLevel: 'TRUSTED_CONTEXTS'");
    expect(worker).toContain("world: 'ISOLATED'");
    expect(worker).toContain('allFrames: false');
    expect(worker).toContain('captureVisibleTab');
    expect(worker).toContain('before.documentIdentity !== after.documentIdentity');
    expect(worker).toContain('sender.id !== this.#api.runtime.id');
    expect(worker).not.toMatch(
      /chrome\.(?:cookies|webRequest|declarativeNetRequest|history|bookmarks)|MutationObserver|setInterval/iu,
    );
  });

  it('contains no automation, private API, whole-page scraping, model, or Issue 018 behavior', () => {
    const implementation = [
      'apps/clipper/src/service-worker.ts',
      'apps/clipper/src/popup.ts',
      'packages/db/src/browser-clip-repository.ts',
      'apps/desktop/src/browser-clip-runtime.ts',
    ]
      .map(source)
      .join('\n');
    expect(implementation).not.toMatch(
      /(?:auto(?:matic)?[-_ ]?(?:login|publish|comment|message)|验证码|风控|openai|anthropic|generateContent|innerHTML|outerHTML|documentElement|querySelectorAll\(.*(?:input|form)|Issue\s*018)/iu,
    );
    expect(implementation).not.toMatch(/xhsapi|edith\.xiaohongshu|creator\.xiaohongshu/iu);
  });

  it('keeps screenshot opt-in and packaging deterministic for both browsers', () => {
    const popup = source('apps/clipper/static/popup.html');
    const packager = source('scripts/package-clipper.mjs');
    expect(popup).toContain('<button id="capture" type="button">');
    expect(popup).toMatch(/<img id="screenshot-preview"[^>]*hidden/u);
    expect(popup).toMatch(/<button id="remove-screenshot"[^>]*hidden/u);
    expect(packager).toContain("['chrome', 'edge']");
    expect(packager).toContain('`${family}-unpacked`');
    expect(packager).toContain('SHA256SUMS');
    expect(packager).toMatch(/u16\(0\),\s*u16\(0\)/u);
  });
});
