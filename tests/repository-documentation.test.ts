import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');
const agents = readFileSync(resolve(projectRoot, 'AGENTS.md'), 'utf8');

describe('repository-facing documentation', () => {
  it('reports completed Issue 018 and keeps Issue 019 as the bounded next milestone', () => {
    expect(readme).toContain('M1（Issue 006—011）');
    expect(readme).toContain('M2 Issue 012—018 均已完成验收');
    expect(readme).toContain('Issue 019（仅规划；本轮未开始）');
    expect(readme).toContain('Work / Expression / Edition');
    expect(readme).toContain('LEAD_ONLY / NOT_FETCHED / UNVERIFIED / NOT_A_FACT');
    expect(readme).toContain('FETCHED_NOT_EVIDENCE / UNVERIFIED / NOT_A_FACT');
    expect(readme).toContain('外部请求恒为 0');
    expect(readme).not.toContain('下一步仅规划 Issue 018');
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

  it('keeps product baselines, governance records, and historical instructions out of root', () => {
    for (const path of [
      'docs/README.md',
      'docs/product/README.md',
      'docs/governance/README.md',
      'docs/instructions/README.md',
      'docs/product/xiaohongshu-mystery-account-prd-v1.md',
      'docs/product/xiaohongshu-development-roadmap-v1.md',
      'docs/governance/codex-master-development-instruction-v1.md',
      'docs/instructions/m1/M1-Issue008-local-file-repository-Codex-instruction.txt',
      'docs/instructions/m2/M2-Issue017-Chrome-Edge-browser-clipper-Codex-instruction.txt',
      'docs/instructions/m2/M2-Issue018-bibliographic-discovery-entity-resolution-Codex-instruction.txt',
    ]) {
      expect(existsSync(resolve(projectRoot, path)), path).toBe(true);
    }
    for (const obsoleteRootPath of [
      'codex-master-development-instruction-v1.md',
      'xiaohongshu-mystery-account-prd-v1.md',
      'xiaohongshu-development-roadmap-v1.md',
      'M1-Issue008-local-file-repository-Codex-instruction.txt',
      'M2-Issue017-Chrome-Edge-browser-clipper-Codex-instruction.txt',
      'M2-Issue018-bibliographic-discovery-entity-resolution-Codex-instruction.txt',
      'M2-Issue018-bibliographic-discovery-entity-resolution-repository-governance-v2-Codex-instruction.txt',
    ]) {
      expect(existsSync(resolve(projectRoot, obsoleteRootPath)), obsoleteRootPath).toBe(false);
    }
    expect(
      readdirSync(projectRoot)
        .filter((name) =>
          /(?:Issue\d+.*instruction|codex-master-development|xiaohongshu-.*-v1)/iu.test(name),
        )
        .sort(),
    ).toEqual([]);
  });

  it('keeps every documentation index link resolvable from its own directory', () => {
    for (const indexPath of [
      'docs/README.md',
      'docs/product/README.md',
      'docs/governance/README.md',
      'docs/instructions/README.md',
    ]) {
      const absoluteIndexPath = resolve(projectRoot, indexPath);
      const index = readFileSync(absoluteIndexPath, 'utf8');
      const localTargets = [...index.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]*)?\)/gu)].map(
        (match) => match[1],
      );
      expect(localTargets.length, indexPath).toBeGreaterThan(0);
      for (const target of localTargets) {
        expect(existsSync(resolve(dirname(absoluteIndexPath), target ?? '')), target).toBe(true);
      }
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
      'Issue 012—018 已经完成',
      '下一项规划是 Issue 019',
      'migration v1—v11 已发布',
    ]) {
      expect(agents).toContain(required);
    }
  });
});
