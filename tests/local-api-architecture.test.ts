import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOCAL_API_ROUTE_REGISTRY, LOCAL_API_HOST } from '../packages/local-api/src/index.js';

const projectRoot = resolve(import.meta.dirname, '..');

function source(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function interfaceBody(sourceText: string, interfaceName: string): string {
  const match = new RegExp(
    `export interface ${interfaceName} \\{(?<body>[\\s\\S]*?)\\n\\}`,
    'u',
  ).exec(sourceText);
  expect(match, `${interfaceName} must remain an explicit interface`).not.toBeNull();
  return match?.groups?.body ?? '';
}

describe('Issue 011 architecture and forbidden scope', () => {
  it('uses only native node:http for the listener with no web framework or WebSocket runtime', () => {
    const server = source('packages/local-api/src/server.ts');
    const lock = source('package-lock.json');
    expect(server).toMatch(/from ['"]node:http['"]/u);
    expect(server).not.toMatch(/fastify|express|koa|socket\.io|node:http2/iu);
    for (const dependency of ['fastify', 'express', 'koa', 'ws', 'socket.io']) {
      expect(JSON.parse(lock).packages).not.toHaveProperty(`node_modules/${dependency}`);
    }
  });

  it('hard-codes IPv4 loopback authority and never exposes bind authority through settings', () => {
    expect(LOCAL_API_HOST).toBe('127.0.0.1');
    const server = source('packages/local-api/src/server.ts');
    const runtime = source('apps/desktop/src/local-api-runtime.ts');
    const contracts = source('packages/shared/src/local-api-contracts.ts');
    expect(server).toContain('host: LOCAL_API_HOST');
    expect(runtime).toContain('http://${LOCAL_API_HOST}');
    const rendererControlledRequests = [
      'UpdateLocalApiSettingsRequest',
      'CancelLocalApiPairingRequest',
      'RevokeLocalApiClientRequest',
    ]
      .map((interfaceName) => interfaceBody(contracts, interfaceName))
      .join('\n');
    expect(rendererControlledRequests).not.toMatch(
      /\bhost\b|bindAddress|listenAddress|allowlist|\burl\b/iu,
    );
  });

  it('keeps the application route allowlist to status, capabilities, and pairing exchange', () => {
    expect(LOCAL_API_ROUTE_REGISTRY).toEqual({
      '/v1/capabilities': 'GET',
      '/v1/pairings/exchange': 'POST',
      '/v1/status': 'GET',
    });
    const localApiSources = [
      'packages/local-api/src/contracts.ts',
      'packages/local-api/src/router.ts',
      'packages/local-api/src/server.ts',
    ]
      .map(source)
      .join('\n');
    expect(localApiSources).not.toMatch(
      /\/(?:v1\/)?(?:clips|clip|save|generate|publish|comment|message|login|search)\b/iu,
    );
  });

  it('does not call external APIs, models, provider interfaces, or paid services', () => {
    const sources = [
      'packages/local-api/src/router.ts',
      'packages/local-api/src/server.ts',
      'apps/desktop/src/local-api-runtime.ts',
      'apps/desktop/src/local-api-smoke.ts',
    ]
      .map(source)
      .join('\n');
    expect(sources).not.toMatch(
      /\bfetch\s*\(|https:\/\/|OPENAI_API_KEY|sk-[a-z0-9]|model_runs|cost_ledger/iu,
    );
  });

  it('keeps pairing codes in memory and persists only a SHA-256 digest for client tokens', () => {
    const pairing = source('packages/local-api/src/pairing-session.ts');
    const migration = source('packages/db/src/migrations.ts');
    const repository = source('packages/db/src/local-api-repository.ts');
    expect(pairing).toContain('new Map<string, PairingRecord>()');
    expect(pairing).not.toMatch(/sqlite|database|writeFile|localStorage/iu);
    expect(migration).toContain('token_digest BLOB');
    expect(migration).not.toMatch(/pairing_code|client_token|authorization/iu);
    expect(repository).not.toMatch(/pairingCode|clientToken|authorization/iu);
  });

  it('keeps Electron authority in main and exposes only a context-isolated narrow bridge', () => {
    const preload = source('apps/desktop/src/preload.ts');
    const windowFactory = source('apps/desktop/src/window-factory.ts');
    expect(preload).toContain('contextBridge.exposeInMainWorld');
    expect(preload).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer/iu);
    expect(windowFactory).toMatch(/contextIsolation:\s*true/u);
    expect(windowFactory).toMatch(/nodeIntegration:\s*false/u);
    expect(windowFactory).toMatch(/sandbox:\s*true/u);
  });

  it('adds a dedicated Windows CI gate without removing any prior required gate', () => {
    const workflow = source('.github/workflows/ci.yml');
    for (const command of [
      'npm ci',
      'npm run format-check',
      'npm run lint',
      'npm run typecheck',
      'npm run test:constraints',
      'npm run test:db',
      'npm run test:queue',
      'npm run test:desktop',
      'npm run test:storage',
      'npm run test:settings',
      'npm run test:local-api',
      'npm run test:electron-smoke',
      'npm run test',
      'npm run build',
      'npm run package:desktop',
      'npm run test:packaged-smoke',
      'npm run audit:dependencies',
    ]) {
      expect(workflow).toContain(command);
    }
    expect(workflow).toContain('runs-on: windows-latest');
  });

  it('preserves the two hard constraints and does not introduce copyright gates', () => {
    const migration = source('packages/db/src/migrations.ts');
    const hardConstraints = source('tests/hard-constraints.test.ts');
    expect(migration).toMatch(/ai_disclosure\s+INTEGER\s+NOT NULL\s+DEFAULT 0/iu);
    expect(hardConstraints).toContain('COPYRIGHT');
    expect(hardConstraints).toContain('aiDisclosure');
  });

  it('contains Issue 011 documentation and stops before Issue 012 and Issue 017 business work', () => {
    expect(source('docs/adr/0007-local-loopback-api-and-plugin-authentication.md')).toContain(
      'Issue 011',
    );
    expect(source('docs/contracts/local-api-v1.md')).toContain('clipperBusinessRoutes');
    expect(source('docs/m1-issue011-implementation-plan.md')).toContain('不实现');
    expect(source('apps/web-ui/src/local-api-settings.tsx')).toContain('Issue 017');
    expect(source('apps/web-ui/src/local-api-settings.tsx')).toContain('没有样本保存功能');
  });
});
