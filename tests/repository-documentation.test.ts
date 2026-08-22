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
const r10Scope = readFileSync(
  resolve(projectRoot, 'docs/product/v2-r10-release-readiness-scope.md'),
  'utf8',
);
const docsIndex = readFileSync(resolve(projectRoot, 'docs/README.md'), 'utf8');
const productIndex = readFileSync(resolve(projectRoot, 'docs/product/README.md'), 'utf8');
const instructionsIndex = readFileSync(resolve(projectRoot, 'docs/instructions/README.md'), 'utf8');
const r10eImplementation = readFileSync(
  resolve(projectRoot, 'docs/instructions/v2/R10E-release-candidate-implementation.md'),
  'utf8',
);
const r10eUat = readFileSync(
  resolve(projectRoot, 'docs/reviews/R10E-windows-10-11-user-acceptance.md'),
  'utf8',
);
const r10eUserGuide = readFileSync(
  resolve(projectRoot, 'docs/user-guide/windows-beta-user-guide.md'),
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
    expect(readme).toContain('V2-R01—R07 已获用户验收');
    expect(readme).toMatch(
      /V2-D-FINAL、R08 N1—N7[\s\S]{0,80}R09[\s\S]{0,80}均已完成用户验收并合并/u,
    );
    expect(readme).toMatch(/R08、R09 已获用户验收并合并到 `main`/u);
    expect(readme).toMatch(/R09.+既有本地 Catalog.+只读/su);
    expect(readme).not.toMatch(/R09.+等待(?:真实 )?(?:Electron )?视觉验收/su);
    expect(readme).toMatch(/R10A.+R10B1A—R10B1C.+已进入.+main/su);
    expect(readme).toMatch(/受控备份核心已经实现/u);
    expect(readme).toMatch(/R10B.+PR #26.+合并/su);
    expect(instructionsIndex).toMatch(/R10B.+PR #26.+合并.+main/su);
    expect(readme).toMatch(/R10C.+受控本地诊断/su);
    expect(readme).toMatch(
      /R10D.+每用户离线安装.+PR #29.+Windows CI.+R10E.+Draft Release Candidate/su,
    );
    expect(instructionsIndex).toMatch(/R10C.+受控本地.+脱敏诊断/su);
    expect(instructionsIndex).toMatch(/R10D.+Windows.+分发.+安装.+升级.+卸载/su);
    expect(readme).toContain('./docs/product/v2-r10-release-readiness-scope.md');
    expect(docsIndex).toContain('./product/v2-r10-release-readiness-scope.md');
    expect(productIndex).toContain('./v2-r10-release-readiness-scope.md');
    expect(instructionsIndex).toContain(
      './v2/V2-R10A-release-scope-contract-Codex-instruction.txt',
    );
    expect(docsIndex).not.toContain('下一项仅规划\nIssue 027');
    expect(instructionsIndex).not.toContain('下一项仅规划 Issue 027');
    expect(readme).toContain('npm run desktop:dev -- --legacy-shell');
    expect(readme).toMatch(/npm run desktop:dev\r?\n```/u);
    expect(readme).not.toMatch(/R07.+兼容修复与.+复验中/u);
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

  it('keeps the R10E candidate auditable without pre-filling Win10 or Win11 acceptance', () => {
    expect(r10eImplementation).toContain('v0.1.0-beta.1');
    expect(r10eImplementation).toContain('Rednote V2 0.1.0-beta.1 Release Candidate');
    expect(r10eImplementation).toMatch(/Draft \+ prerelease/u);
    expect(r10eImplementation).toMatch(/不创建真实 tag ref/u);
    expect(r10eImplementation).toMatch(/Windows 10\/11.+NOT_RUN/u);
    expect(r10eUserGuide).toContain('RednoteStudio-0.1.0-beta.1-r10e-rc.zip');
    expect(r10eUserGuide).toMatch(/SmartScreen/u);
    expect(r10eUserGuide).toMatch(/beta\.0.+beta\.1/su);
    expect(r10eUserGuide).toMatch(/受控备份与恢复/u);
    expect(r10eUserGuide).toMatch(/本地诊断包/u);
    expect(r10eUat).toMatch(/Windows 10 `NOT_RUN`；Windows 11 `NOT_RUN`/u);
    expect(r10eUat.match(/W10-\d{2}/gu)).toHaveLength(15);
    expect(r10eUat.match(/W11-\d{2}/gu)).toHaveLength(15);
    expect(r10eUat).not.toMatch(/最终结论：`PASS`/u);
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

  it('keeps the R10 release-readiness scope explicit and non-operational', () => {
    expect(r10Scope).toMatch(/首版采用\s+\*{0,2}Windows 每用户离线安装/u);
    expect(r10Scope).toMatch(/手动升级/u);
    expect(r10Scope).toMatch(/(?:内部 beta.{0,30}未签名|未签名.{0,30}内部 beta)/su);
    expect(r10Scope).toMatch(/本地磁盘\s+\*{0,2}受控目录快照/u);
    expect(r10Scope).toMatch(/\*{0,2}同版本或明确声明兼容/u);
    expect(r10Scope).toMatch(/拒绝降级和未知版本/u);
    expect(r10Scope).toMatch(/Windows 10 与 Windows 11.+人工候选验证/su);
    expect(r10Scope).toMatch(/Draft GitHub Release/u);
    expect(r10Scope).toMatch(/R10A[\s\S]*R10B[\s\S]*R10C[\s\S]*R10D[\s\S]*R10E/u);
    expect(r10Scope).toMatch(/R10B.+Figma.+用户确认/su);
    expect(r10Scope).toMatch(/R10C.+Figma.+用户确认/su);
    expect(r10Scope).toMatch(/不实现自动更新/u);
    expect(r10Scope).toMatch(/禁止后台上传/u);
    expect(r10Scope).toMatch(/(?:不引入|不新增)云端运行依赖/u);
  });

  it('keeps product baselines, governance records, and historical instructions out of root', () => {
    for (const path of [
      'docs/README.md',
      'docs/product/README.md',
      'docs/governance/README.md',
      'docs/instructions/README.md',
      'docs/product/xiaohongshu-mystery-account-prd-v1.md',
      'docs/product/xiaohongshu-development-roadmap-v1.md',
      'docs/product/v2-r10-release-readiness-scope.md',
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
      'docs/instructions/v2/V2-R10A-release-scope-contract-Codex-instruction.txt',
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
