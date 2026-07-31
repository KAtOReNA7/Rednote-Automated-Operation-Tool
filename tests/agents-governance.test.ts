import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const agentsPath = resolve(projectRoot, 'AGENTS.md');
const packagePath = resolve(projectRoot, 'package.json');
const ciPath = resolve(projectRoot, '.github', 'workflows', 'ci.yml');
const futureIssueTemplatePath = resolve(
  projectRoot,
  'docs',
  'governance',
  'future-issue-instruction-template.md',
);

function normalized(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n?/gu, '\n');
}

function countOccurrences(content: string, value: string): number {
  return content.split(value).length - 1;
}

function extractHeadingSection(content: string, heading: string): string {
  if (countOccurrences(content, heading) !== 1) {
    throw new Error(`Expected exactly one heading: ${heading}`);
  }
  const start = content.indexOf(heading);
  const next = content.indexOf('\n## ', start + heading.length);
  return content.slice(start, next === -1 ? content.length : next);
}

const agents = normalized(agentsPath);
const permanentRules = agents.slice(agents.indexOf('## 2. '));
const gates = extractHeadingSection(agents, '## 9. 三层验证门禁');
const packageJson = JSON.parse(normalized(packagePath)) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const ci = normalized(ciPath);
const futureIssueTemplate = normalized(futureIssueTemplatePath);

describe('repository AGENTS governance', () => {
  it('keeps one compact root authority without duplicate legacy blocks', () => {
    expect(statSync(agentsPath).isFile()).toBe(true);
    expect(agents.split('\n').length).toBeLessThanOrEqual(300);
    expect(countOccurrences(agents, '<!-- CODEX_COMMON_RULES:')).toBe(0);
    expect(countOccurrences(agents, '<!-- END_CODEX_COMMON_RULES')).toBe(0);
    expect(countOccurrences(agents, '# AGENTS.md')).toBe(1);
  });

  it('defines repository applicability, dynamic baselines, scope and worktree protection', () => {
    expect(agents).toMatch(/适用于整个仓库/u);
    expect(permanentRules).toContain('git rev-parse --show-toplevel');
    expect(permanentRules).toContain('git rev-parse HEAD');
    expect(permanentRules).toContain('git status --short --branch');
    expect(permanentRules).toMatch(/未知未提交修改属于用户/u);
    expect(permanentRules).toMatch(/不覆盖、删除、stash、reset/u);
    expect(permanentRules).toMatch(/只实施获授权范围/u);
    expect(permanentRules).toMatch(/不顺手进入下一\s*Issue/u);
  });

  it('keeps the local-first product, disclosure, copyright and platform boundaries', () => {
    expect(agents).toMatch(/Windows 10\/11 的本地优先、单用户/u);
    expect(agents).toMatch(/云服务不得成为必需\s*运行依赖/u);
    expect(permanentRules).toMatch(/aiDisclosure.*ai_disclosure.*false/su);
    expect(permanentRules).toMatch(
      /AI 标识不得参与\s*门禁、评分、审批、优先级、排期、缓存、成本、预算或导出决策/u,
    );
    expect(permanentRules).toMatch(
      /版权风险不得进入字段、检查类型、门禁、评分、审批、优先级、排期或导出决策/u,
    );
    expect(permanentRules).toMatch(/不实现小红书自动登录、发布、评论、私信、验证码或风控处理/u);
    expect(permanentRules).toMatch(/最终发布必须由用户在平台上手动完成/u);
    expect(permanentRules).toMatch(/不使用开卷数据/u);
    expect(permanentRules).toMatch(/盗版电子书/u);
    expect(permanentRules).toMatch(/磨铁内部经营、采买或\s*历史项目数据/u);
  });

  it('keeps secrets, real services, costs and test data isolated', () => {
    expect(permanentRules).toMatch(/默认不得读取、打印、复制、提交或探测真实密钥/u);
    expect(permanentRules).toMatch(/数据库只保存非秘密引用/u);
    expect(permanentRules).toMatch(/不得读取环境中偶然存在的真实 key/u);
    expect(permanentRules).toMatch(
      /默认不得调用真实模型、搜索、图片、页面或业务 API[\s\S]*不得访问真实业务服务、产生费用或制造\s*外部副作用/u,
    );
    expect(permanentRules).toMatch(/费用未知保持 `UNKNOWN`\/`NULL`/u);
    expect(permanentRules).toMatch(/测试不得打开正式用户数据根或真实业务素材/u);
  });

  it('preserves storage, Electron, IPC and loopback-only boundaries', () => {
    expect(permanentRules).toMatch(/数据库与 DTO 只保存 `ManagedRelativePath`/u);
    expect(permanentRules).toMatch(/renderer 是不可信边界/u);
    expect(permanentRules).toMatch(/preload 只暴露固定、窄、版本化的 DTO 与 IPC 方法/u);
    expect(permanentRules).toMatch(/channel allowlist、senderFrame\/origin\/window/u);
    expect(permanentRules).toMatch(/本地 API 默认关闭/u);
    expect(permanentRules).toContain('127.0.0.1');
    expect(permanentRules).toMatch(/不得自动扫描端口/u);
  });

  it('preserves immutable migrations, lineage, idempotency and conservative recovery', () => {
    expect(permanentRules).toMatch(/migration 只能按运行时发现的连续顺序追加/u);
    expect(permanentRules).toMatch(/已发布 migration 不得修改、重排、合并或删除/u);
    expect(permanentRules).toMatch(/migration 前生成可独立打开的本地备份/u);
    expect(permanentRules).toMatch(/失败完整\s*回滚/u);
    expect(permanentRules).toMatch(/`quick_check`、`foreign_key_check`/u);
    expect(permanentRules).toMatch(
      /Draft、Claim、FactEvaluation、Evidence、SourceRevision[\s\S]*单一事实来源/u,
    );
    expect(permanentRules).toMatch(/队列采用至少一次交付/u);
    expect(permanentRules).toMatch(/重放不得重复外部请求、预算预留、成本结算/u);
    expect(permanentRules).toMatch(/不确定状态必须标记 `AMBIGUOUS`/u);
  });

  it('defines exactly one authoritative three-tier validation model', () => {
    expect(countOccurrences(agents, '## 9. 三层验证门禁')).toBe(1);
    expect(countOccurrences(agents, '### A. 开发循环')).toBe(1);
    expect(countOccurrences(agents, '### B. Issue 完成门禁')).toBe(1);
    expect(countOccurrences(agents, '### C. 里程碑 / Release 门禁')).toBe(1);
    expect(gates).toMatch(/只运行受影响 package\/文件的测试/u);
    expect(gates).toMatch(/全量 Vitest 最多一次/u);
    expect(gates).toMatch(/每个最终验证序列最多运行一次 `npm ci`/u);
    expect(gates).toMatch(/单次全量 Vitest或互不重叠的稳定分片/u);
    expect(gates).toMatch(/真实浏览器 smoke 仅在 Clipper、Local API 或浏览器集成变化/u);
  });

  it('defines all default budgets and automatic pause thresholds', () => {
    const budget = extractHeadingSection(agents, '## 8. 实现原则、依赖与 Issue 预算');
    for (const expected of [
      '生产源码新增不超过 1,500 行',
      '测试新增不超过 1,200 行',
      '净新增业务表不超过 2',
      '新增 trigger 不超过 6',
      '新增 IPC channel 不超过 2',
      '变更文件不超过 25',
      'Issue 指令建议不超过 300 行',
      '核心验收保持 10—20 项',
    ]) {
      expect(budget).toContain(expected);
    }
    expect(budget).toMatch(/预算 100% 时停止扩展/u);
    expect(budget).toMatch(/超过 150% 时自动暂停/u);
    expect(budget).toMatch(/超过 200% 时必须拆分任务/u);
    expect(budget).toMatch(/外部复核及用户重新授权/u);
  });

  it('uses risk-oriented, table-driven and representative acceptance evidence', () => {
    expect(permanentRules).toMatch(/风险导向 acceptance map/u);
    expect(permanentRules).toMatch(/参数组合优先表驱动/u);
    expect(permanentRules).toMatch(/代表性的正常、失败、边界、安全、\s*迁移与恢复证据/u);
    expect(permanentRules).not.toMatch(/验收编号必须连续、\s*唯一、不可合并/u);
  });

  it('keeps future Issue instructions incremental instead of copying the gates', () => {
    expect(statSync(futureIssueTemplatePath).isFile()).toBe(true);
    expect(futureIssueTemplate).toMatch(/根级及作用域内 `AGENTS\.md`/u);
    expect(futureIssueTemplate).toMatch(/只定义当前 Issue 的增量/u);
    expect(futureIssueTemplate).not.toContain('### A. 开发循环');
    expect(futureIssueTemplate).not.toContain('### B. Issue 完成门禁');
    expect(futureIssueTemplate).not.toContain('### C. 里程碑 / Release 门禁');
  });

  it('keeps specialized scripts but schedules only one Vitest selector in CI', () => {
    const vitestScripts = new Set(
      Object.entries(packageJson.scripts)
        .filter(([, command]) => command.includes('run-portable-vitest.mjs'))
        .map(([name]) => name),
    );
    const scheduledScripts = [...ci.matchAll(/^\s*run:\s+npm run ([\w:-]+)\s*$/gmu)].flatMap(
      (match) => (match[1] === undefined ? [] : [match[1]]),
    );
    expect(vitestScripts.has('test:constraints')).toBe(true);
    expect(vitestScripts.has('test:fact-mapping')).toBe(true);
    expect(scheduledScripts.filter((name) => vitestScripts.has(name))).toEqual(['test']);
    expect(scheduledScripts).toContain('test:electron-smoke');
    expect(scheduledScripts).toContain('test:packaged-smoke');
  });

  it('keeps governance explicitly selectable and auto-discovered by the full suite', () => {
    expect(packageJson.scripts['test:constraints']).toContain('tests/agents-governance.test.ts');
    expect(packageJson.scripts['test:constraints']).toContain('tests/hard-constraints.test.ts');
    expect(packageJson.scripts.test).toMatch(/run-portable-vitest\.mjs run$/u);
  });

  it('keeps permanent rules portable and free of frozen machine identities', () => {
    expect(permanentRules).not.toMatch(/(?:^|[\s"'`(])[a-z]:[\\/]/imu);
    expect(permanentRules).not.toMatch(/(?:\/Users\/|\/home\/|\/workspace\/)/u);
    expect(permanentRules).not.toMatch(/\b(?:[0-9a-f]{40}|[0-9a-f]{64})\b/iu);
    expect(permanentRules).not.toMatch(/\bIssue\s*0*\d+\b/iu);
    expect(permanentRules).not.toMatch(/(?:schema|migration)\s*(?:version|版本|v)?\s*\d+/iu);
    expect(permanentRules).not.toMatch(/\b(?:Node|Electron)\s*v?\d+/iu);
  });

  it('forbids unauthorized Git mutation and unverified reporting', () => {
    expect(permanentRules).toMatch(/不使用 `git reset --hard`、`git checkout --`/u);
    expect(permanentRules).toMatch(
      /未获明确授权不得 fetch、pull、push、创建 PR、合并、rebase、amend、squash/u,
    );
    expect(permanentRules).toMatch(/不得报告未执行测试、未触发托管 CI、未核验远端/u);
    expect(permanentRules).toMatch(/完成获准提交并报告后立即停止/u);
  });
});
