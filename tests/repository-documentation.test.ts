import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');
const agents = readFileSync(resolve(projectRoot, 'AGENTS.md'), 'utf8');

describe('repository-facing documentation', () => {
  it('reports the completed M1 foundation without stale pre-Electron claims', () => {
    expect(readme).toContain('M1（Issue 006—011）');
    expect(readme).toContain('Issue 012：供应商无关的模型接口');
    expect(readme).toContain('M1 本地基础已完成');
    expect(readme).not.toContain('尚未实现桌面 UI');
    expect(readme).not.toContain('M0 仅保留包边界');
  });

  it('keeps every repository-local README link resolvable', () => {
    const localTargets = [...readme.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]*)?\)/gu)].map(
      (match) => match[1],
    );
    expect(localTargets.length).toBeGreaterThan(0);
    for (const target of localTargets) {
      expect(existsSync(resolve(projectRoot, target ?? '')), target).toBe(true);
    }
  });

  it('gives future agents the frozen safety, migration, validation, and Git boundaries', () => {
    for (const required of [
      'aiDisclosure',
      '版权风险完全不进入',
      '不得调用真实模型',
      'migration 只能按连续版本追加',
      'npm run test:constraints',
      '未经用户明确授权，不得 push',
    ]) {
      expect(agents).toContain(required);
    }
  });
});
