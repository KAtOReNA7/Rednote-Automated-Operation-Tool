import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { v2MockProvider } from '../apps/web-ui/src/v2/mock-provider.js';
import { V2_ROUTES } from '../apps/web-ui/src/v2/routes.js';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const sources = [
  'app.tsx',
  'components.tsx',
  'main.tsx',
  'mock-provider.ts',
  'routes.ts',
  'pages/content-page.tsx',
  'pages/interaction-page.tsx',
  'pages/library-page.tsx',
  'pages/overview-page.tsx',
  'pages/review-page.tsx',
  'pages/settings-page.tsx',
  'pages/weekly-plan-page.tsx',
]
  .map((path) => read(`apps/web-ui/src/v2/${path}`))
  .join('\n');

describe('V2 renderer architecture', () => {
  it('freezes one deterministic fixture and returns independent deep clones', () => {
    expect(v2MockProvider.mode).toBe('DETERMINISTIC_MOCK');
    expect(v2MockProvider.fixtureIsFrozen()).toBe(true);
    const first = v2MockProvider.loadSession();
    const second = v2MockProvider.loadSession();
    expect(first).not.toBe(second);
    expect(first.plan).not.toBe(second.plan);
    expect(first).toEqual(second);
    expect(first.plan).toHaveLength(21);
    expect(first.plan.filter(({ status }) => status === '待审批')).toHaveLength(3);
    expect(first.plan.filter(({ status }) => status === '时间冲突')).toHaveLength(1);
  });

  it('pins seven routes and a strict, network-closed V2 document', () => {
    expect(V2_ROUTES.map(({ label }) => label)).toEqual([
      '总览',
      '本周计划',
      '内容',
      '互动',
      '书库',
      '数据复盘',
      '设置',
    ]);
    const html = read('apps/web-ui/v2.html');
    expect(html).toContain("connect-src 'self'");
    expect(html).toContain("worker-src 'none'");
    expect(html).toContain("img-src 'self'");
    expect(html).not.toMatch(/unsafe-|https?:\/\//u);
  });

  it('has no legacy bridge, Node, Electron, DB, old domain, randomness, or network client', () => {
    expect(sources).not.toMatch(/from ['"](?:electron|node:)/u);
    expect(sources).not.toMatch(/@mystery-operations|rednoteDesktop|ipcRenderer/u);
    expect(sources).not.toMatch(/Date\.now|Math\.random|randomUUID/u);
    expect(sources).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/u);
    expect(sources).not.toMatch(/https?:\/\//u);
  });

  it('keeps production library rendering off the deterministic book fixture', () => {
    const library = read('apps/web-ui/src/v2/pages/library-page.tsx');
    expect(library).not.toMatch(/session\.books|bookRows|posts|saves/u);
    expect(library).not.toMatch(/rednoteDesktop|readCatalog.*(?:merge|split|undo|create|import)/iu);
  });
});
