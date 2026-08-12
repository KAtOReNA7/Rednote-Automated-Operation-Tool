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
  it('keeps the README focused on the current V2 path and links legacy details instead', () => {
    expect(readme).toContain('V2-R01—R06 已验收');
    expect(readme).toMatch(/R07.+兼容修复与.+复验中/u);
    expect(readme).toMatch(/R07.+验收后.+V2-D-FINAL/su);
    expect(readme).not.toMatch(/R07.{0,12}已验收/u);
    expect(readme).toContain('V2-D-FINAL');
    expect(readme).toContain('R07');
    expect(readme).toContain('R08');
    expect(readme).toContain('Issue 022—028');
    expect(readme).toContain('Issue 029A');
    expect(readme).toContain('Minimal Issue 030');
    expect(readme).toMatch(/029B[\s\S]{0,100}?deferred/iu);
    expect(readme).toMatch(/M4[\s\S]{0,100}?未开始/u);
    expect(readme).not.toContain('### 最近完成');
    expect(readme).not.toContain('Issue 012 验收映射');
    expect(readme.split(/\r?\n/u).length).toBeLessThanOrEqual(220);

    for (const [path, content] of [
      ['AGENTS.md', agents],
      ['docs/product/xiaohongshu-development-roadmap-v1.md', roadmap],
    ] as const) {
      expect(content, path).toMatch(/Issue 022[—–-]028/u);
      expect(content, path).toMatch(/Issue 029A/u);
      expect(content, path).toMatch(/Minimal\s+Issue 030/u);
      expect(content, path).toMatch(/029B[\s\S]{0,100}?deferred/iu);
      expect(content, path).toMatch(/M4[\s\S]{0,100}?未开始/u);
      expect(content, path).toMatch(/下一步[\s\S]{0,120}?受控本地(?:内容)?试运行/u);
    }
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
      'docs/instructions/m3/M3-Issue030-minimal-quality-aggregator-Codex-instruction.txt',
      'docs/adr/0025-copy-integrity-deterministic-subset.md',
      'docs/adr/0026-quality-readiness-aggregator.md',
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
