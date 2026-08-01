import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');
const agents = readFileSync(resolve(projectRoot, 'AGENTS.md'), 'utf8');
const roadmap = readFileSync(
  resolve(projectRoot, 'docs/product/xiaohongshu-development-roadmap-v1.md'),
  'utf8',
);

interface ProjectProgress {
  readonly completedThrough: number;
  readonly nextIssue: number;
}

function coversIssue(content: string, issueNumber: number): boolean {
  for (const match of content.matchAll(/\bIssues?\s+0*(\d{1,4})(?:\s*[—–-]\s*0*(\d{1,4}))?\b/giu)) {
    const start = Number.parseInt(match[1] ?? '', 10);
    const end = Number.parseInt(match[2] ?? match[1] ?? '', 10);
    if (start <= issueNumber && issueNumber <= end) return true;
  }
  return false;
}

function projectProgress(content: string): ProjectProgress | null {
  const completedEnds = [
    ...content.matchAll(
      /\bIssues?\s+0*(\d{1,4})(?:\s*[–—-]\s*0*(\d{1,4}))?\b(?=[^\r\n。；;]{0,80}(?:(?<!部分)(?<!未)已?完成|(?<!partially )(?<!not )completed))/giu,
    ),
  ].map((match) => Number.parseInt(match[2] ?? match[1] ?? '', 10));
  const nextIssues = new Set(
    [
      ...content.matchAll(/(?:下一(?:项|步)|Next)[^\r\n。；;]{0,100}?\bIssues?\s+0*(\d{1,4})\b/giu),
    ].map((match) => Number.parseInt(match[1] ?? '', 10)),
  );
  const completedThrough = Math.max(...completedEnds);
  const [nextIssue] = nextIssues;
  if (
    completedEnds.length === 0 ||
    nextIssues.size !== 1 ||
    nextIssue === undefined ||
    nextIssue !== completedThrough + 1
  ) {
    return null;
  }
  return { completedThrough, nextIssue };
}

describe('repository-facing documentation', () => {
  it('keeps README, AGENTS and Roadmap on one continuous current/next Issue state', () => {
    for (const [path, content] of [
      ['README.md', readme],
      ['AGENTS.md', agents],
      ['docs/product/xiaohongshu-development-roadmap-v1.md', roadmap],
    ] as const) {
      expect(projectProgress(content), path).toEqual({ completedThrough: 28, nextIssue: 29 });
    }
    expect(readme).toContain('M1（Issue 006—011）');
    expect(readme).toContain('M2（Issue 012—021）均已完成验收');
    expect(readme).toContain('五类 Topic Pool、可解释排序、状态控制与 First-30 配额');
    expect(readme).toContain('可检验单变量实验、跨作品复现、确定性分配与版本状态');
    expect(readme).toContain(
      '五类 Content Brief、Evidence 映射、真实性/评分/剧透约束、字段锁与就绪门',
    );
    expect(readme).toContain('五类版本化文案、实际剧透警告、局部重写、结构门与工作台');
    expect(readme).toContain(
      'FACT_MAPPING Statement、类型化 Claim 映射、证据链、精确失效与人工复核',
    );
    expect(readme).toContain('剧透声明/警告确定性子集、FULL 放行、窄候选定位与精确 stale');
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

  it('parses only explicit Issue references and rejects gaps or contradictory next states', () => {
    expect(coversIssue('Issue 027 已完成', 27)).toBe(true);
    expect(coversIssue('Issue 022—027 已完成', 27)).toBe(true);
    expect(coversIssue('Issues 022–028 completed', 27)).toBe(true);
    expect(coversIssue('完成范围 022—027', 27)).toBe(false);
    expect(coversIssue('Issue 022—026 已完成', 27)).toBe(false);
    expect(projectProgress('Issue 022—027 已完成；下一项是 Issue 028')).toEqual({
      completedThrough: 27,
      nextIssue: 28,
    });
    expect(projectProgress('Issue 022—026 已完成；下一项是 Issue 028')).toBeNull();
    expect(projectProgress('Issue 022—028 已完成；Next Issue 028')).toBeNull();
    expect(projectProgress('Issue 022—028 已完成；下一项是 Issue 029')).toEqual({
      completedThrough: 28,
      nextIssue: 29,
    });
    expect(
      projectProgress('Issue 028 已完成；Issue 029A 已完成；Issue 029 部分完成；下一项 Issue 029'),
    ).toEqual({ completedThrough: 28, nextIssue: 29 });
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
      'docs/instructions/m3/M3-Issue024-structured-content-brief-generator-Codex-instruction.txt',
      'docs/instructions/m3/M3-Issue025-versioned-copy-generation-Codex-instruction.txt',
      'docs/instructions/m3/M3-Issue026-factual-claim-mapping-Codex-instruction.txt',
      'docs/instructions/m3/M3-Issue029A-deterministic-copy-integrity-Codex-instruction.txt',
      'docs/adr/0025-copy-integrity-deterministic-subset.md',
      'docs/instructions/governance/Project-health-audit-after-Issue026-Codex-instruction.txt',
      'docs/instructions/governance/M3-project-control-recovery-phase1-Codex-instruction.txt',
      'docs/governance/validation-gate-matrix.md',
      'docs/governance/future-issue-instruction-template.md',
      'docs/reviews/issue026-structural-review.md',
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
      'M3-Issue024-structured-content-brief-generator-Codex-instruction.txt',
      'M3-Issue025-versioned-copy-generation-Codex-instruction.txt',
      'M3-Issue026-factual-claim-mapping-Codex-instruction.txt',
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
      '版权风险不得进入字段',
      '默认不得调用真实模型',
      'migration 只能按运行时发现的连续顺序追加',
      '## 9. 三层验证门禁',
      '### A. 开发循环',
      '### B. Issue 完成门禁',
      '### C. 里程碑 / Release 门禁',
      '未获明确授权不得 fetch、pull、push',
    ]) {
      expect(agents).toContain(required);
    }
  });
});
