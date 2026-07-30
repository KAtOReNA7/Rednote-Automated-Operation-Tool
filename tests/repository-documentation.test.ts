import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');
const agents = readFileSync(resolve(projectRoot, 'AGENTS.md'), 'utf8');

describe('repository-facing documentation', () => {
  it('reports completed M2 and Issue 022–023 while keeping Issue 024 bounded', () => {
    expect(readme).toContain('M1（Issue 006—011）');
    expect(readme).toContain('M2（Issue 012—021）均已完成验收');
    expect(readme).toContain('M3 Issue 024（Content Brief，仅规划，尚未授权或开始）');
    expect(readme).toContain('五类 Topic Pool、可解释排序、状态控制与 First-30 配额');
    expect(readme).toContain('可检验单变量实验、跨作品复现、确定性分配与版本状态');
    expect(readme).toContain('Work / Expression / Edition');
    expect(readme).toContain('Source revision、AtomicClaim、精确 EvidenceLocator');
    expect(readme).toContain('版本化 Dossier、共识/争议/缺口');
    expect(readme).toContain('六态阅读真实性、R2 逐条观点、三类评分隔离');
    expect(readme).toContain('LEAD_ONLY / NOT_FETCHED / UNVERIFIED / NOT_A_FACT');
    expect(readme).toContain('FETCHED_NOT_EVIDENCE / UNVERIFIED / NOT_A_FACT');
    expect(readme).toContain('外部请求恒为 0');
    expect(readme).not.toContain('下一步仅规划 Issue 018');
    expect(readme).not.toContain('Issue 021（阅读状态与真实性规则，仅规划）');
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
      'docs/instructions/m2/M2-Issue019-source-atomic-facts-conflict-handling-Codex-instruction.txt',
      'docs/instructions/m2/M2-Issue020-versioned-research-dossier-Codex-instruction.txt',
      'docs/instructions/m2/M2-Issue021-reading-authenticity-policy-Codex-instruction.txt',
      'docs/instructions/m3/M3-Issue022-topic-pool-first-30-quota-Codex-instruction.txt',
      'docs/instructions/m3/M3-Issue023-versioned-experiment-management-Codex-instruction.txt',
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
      'M2-Issue019-source-atomic-facts-conflict-handling-Codex-instruction.txt',
      'M2-Issue020-versioned-research-dossier-Codex-instruction.txt',
      'M2-Issue021-reading-authenticity-policy-Codex-instruction.txt',
      'M3-Issue022-topic-pool-first-30-quota-Codex-instruction.txt',
      'M3-Issue023-versioned-experiment-management-Codex-instruction.txt',
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
      'M2（Issue 012—021）、M3 Issue 022 与',
      'Issue 023 已经完成',
      '下一项规划是 M3 Issue 024',
      'migration v1—v16 已发布',
    ]) {
      expect(agents).toContain(required);
    }
  });
});
