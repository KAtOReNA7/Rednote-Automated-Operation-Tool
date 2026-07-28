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

  it('limits product network calls to the fixed loopback endpoint and four routes', () => {
    const worker = source('apps/clipper/src/service-worker.ts');
    const fetchTargets = [...worker.matchAll(/fetch\(`\$\{[^}]+\}(?<path>\/v1\/[^`]+)`/gu)].map(
      (match) => match.groups?.path,
    );
    expect(fetchTargets).toEqual(['/v1/pairings/exchange', '/v1/browser-clips', '/v1/status']);
    expect(worker).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/iu);
    expect(worker).not.toMatch(/WebSocket|EventSource|sendBeacon|XMLHttpRequest/iu);
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
