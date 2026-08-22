import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Issue 017 outbound and data egress evidence', () => {
  it('documents at least 90 field-level egress decisions with no unresolved rows', () => {
    const matrix = source('docs/m2-issue017-egress-matrix.md');
    const rows = matrix.split(/\r?\n/gu).filter((line) => /^\|\s*E-\d{3}\s*\|/u.test(line));
    expect(rows.length).toBeGreaterThanOrEqual(90);
    expect(
      rows.every((row) => /\|\s*(?:LOCAL_ONLY|LOOPBACK_ONLY|NEVER_COLLECT)\s*\|/u.test(row)),
    ).toBe(true);
    expect(matrix).not.toMatch(/\b(?:TBD|TODO|待定|待回填)\b/iu);
  });

  it('keeps the W2 production extension network-free and removes loopback permission', () => {
    const implementation = [
      source('apps/clipper/src/web-export-service-worker.ts'),
      source('apps/clipper/src/web-export-popup.ts'),
    ].join('\n');
    const manifest = source('apps/clipper/static/manifest.json');
    expect(implementation).not.toMatch(
      /\bfetch\s*\(|WebSocket|EventSource|sendBeacon|XMLHttpRequest|127\.0\.0\.1|localhost|\/v1\/pairings|\/v1\/browser-clips/iu,
    );
    expect(manifest).not.toMatch(/host_permissions|127\.0\.0\.1|localhost|storage/iu);
  });

  it('never puts the runtime token into clip payloads, logs, URLs, or renderer DTOs', () => {
    const worker = source('apps/clipper/src/service-worker.ts');
    const desktopDto = source('packages/shared/src/desktop-api.ts');
    const repository = source('packages/db/src/browser-clip-repository.ts');
    const clipView =
      /export interface BrowserClipView \{(?<body>[\s\S]*?)\n\}/u.exec(desktopDto)?.groups?.body ??
      '';
    expect(worker).toContain('authorization: `Bearer ${stored.active.token}`');
    expect(worker).not.toMatch(/pageUrl.*token|userNote.*token|console\.(?:log|error|warn)/iu);
    expect(clipView).not.toMatch(/token|digest|managedPath/iu);
    expect(repository).not.toMatch(/INSERT INTO clips[\s\S]{0,2000}token_digest/iu);
  });
});
