import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const agentsPath = resolve(projectRoot, 'AGENTS.md');
const packagePath = resolve(projectRoot, 'package.json');
const ciPath = resolve(projectRoot, '.github', 'workflows', 'ci.yml');
const startMarker = '<!-- CODEX_COMMON_RULES: v1 -->';
const endMarker = '<!-- END_CODEX_COMMON_RULES -->';

function countOccurrences(content: string, value: string): number {
  return content.split(value).length - 1;
}

function extractCommonRules(content: string): string {
  if (countOccurrences(content, startMarker) !== 1 || countOccurrences(content, endMarker) !== 1) {
    throw new Error('AGENTS common rules markers must each occur exactly once.');
  }
  const start = content.indexOf(startMarker) + startMarker.length;
  const end = content.indexOf(endMarker);
  if (end <= start) {
    throw new Error('AGENTS common rules markers are out of order.');
  }
  return content.slice(start, end).replace(/\r\n?/gu, '\n');
}

const agents = readFileSync(agentsPath, 'utf8');
const commonRules = extractCommonRules(agents);
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const ci = readFileSync(ciPath, 'utf8');

describe('repository AGENTS governance', () => {
  it('keeps the root AGENTS file present', () => {
    expect(statSync(agentsPath).isFile()).toBe(true);
  });

  it('keeps one ordered pair of idempotent common-rule markers', () => {
    expect(countOccurrences(agents, startMarker)).toBe(1);
    expect(countOccurrences(agents, endMarker)).toBe(1);
    expect(agents.indexOf(startMarker)).toBeLessThan(agents.indexOf(endMarker));
  });

  it('keeps the common block compact', () => {
    expect(commonRules.split('\n').length).toBeLessThanOrEqual(300);
  });

  it('defines repository applicability and instruction priority', () => {
    expect(commonRules).toMatch(/整个仓库/u);
    expect(commonRules).toMatch(/优先级|指令冲突/u);
    expect(commonRules).toMatch(/当前用户明确指令/u);
  });

  it('freezes the local-first single-user product boundary', () => {
    expect(commonRules).toMatch(/Windows 本地优先/u);
    expect(commonRules).toMatch(/单用户/u);
    expect(commonRules).toMatch(/云服务不得成为必需运行依赖/u);
  });

  it('freezes ai_disclosure as false and decision-neutral', () => {
    expect(commonRules).toContain('ai_disclosure=false');
    expect(commonRules).toMatch(/AI 标识不得参与门禁、评分、审批、优先级、\s*排期/u);
  });

  it('keeps copyright out of gates, scores, approval and scheduling', () => {
    expect(commonRules).toMatch(
      /版权风险不得进入字段、检查类型、门禁、评分、审批、优先级、排期或导出决策/u,
    );
  });

  it('forbids automated Xiaohongshu actions and keeps final publishing manual', () => {
    expect(commonRules).toMatch(/不实现小红书自动登录、发布、评论、私信/u);
    expect(commonRules).toMatch(/最终发布必须由用户手动完成/u);
  });

  it('requires a dynamically discovered repository and baseline', () => {
    expect(commonRules).toContain('git rev-parse --show-toplevel');
    expect(commonRules).toContain('git rev-parse HEAD');
  });

  it('rejects fixed HEAD, file checksum and migration hash gates', () => {
    expect(commonRules).toMatch(/不得把固定 HEAD、文件 SHA、迁移 hash/u);
    expect(commonRules).toMatch(/不得把某次机器上的具体迁移 hash/u);
  });

  it('derives temporary storage and caches from the repository volume', () => {
    expect(commonRules).toMatch(
      /临时目录、npm cache、构建 staging 和打包空间必须从仓库所在卷动态派生/u,
    );
    expect(commonRules).toMatch(/只清理本轮精确目标/u);
  });

  it('protects the user worktree and forbids unauthorized remote mutations', () => {
    expect(commonRules).toContain('git status --short --branch');
    expect(commonRules).toMatch(/不得擅自覆盖、删除、stash/u);
    expect(commonRules).toMatch(/未获明确授权不得 .*push、创建 PR、合并、rebase、amend、squash/u);
  });

  it('requires explicit scope and a stop boundary', () => {
    expect(commonRules).toMatch(/只实现当前任务明确要求的能力/u);
    expect(commonRules).toMatch(/完成获准提交并报告后立即停止/u);
  });

  it('defaults to no real secrets, network calls, fees or external side effects', () => {
    expect(commonRules).toMatch(/默认不得读取、打印、复制、\s*提交或探测真实密钥/u);
    expect(commonRules).toMatch(/默认不得调用真实模型、搜索、图片、页面或业务 API/u);
    expect(commonRules).toMatch(/不得访问真实业务服务、产生费用或制造外部副作用/u);
  });

  it('keeps database migrations append-only and evidence-backed', () => {
    expect(commonRules).toMatch(/数据库迁移只能按仓库运行时发现的连续顺序追加/u);
    expect(commonRules).toMatch(/已发布迁移不得修改、重排、合并或删除/u);
    expect(commonRules).toMatch(/迁移前生成可独立打开的本地备份/u);
    expect(commonRules).toMatch(/迁移后运行 quick_check、foreign_key_check/u);
  });

  it('defines at-least-once queue idempotency and conservative recovery', () => {
    expect(commonRules).toMatch(/队列采用至少一次交付/u);
    expect(commonRules).toMatch(/重放不得重复外部请求、预算预留、成本结算/u);
    expect(commonRules).toMatch(/不确定状态必须标记 `AMBIGUOUS`/u);
  });

  it('confines local files and content to controlled storage', () => {
    expect(commonRules).toMatch(/项目数据根的受控类别/u);
    expect(commonRules).toMatch(/数据库和 DTO 只保存 ManagedRelativePath/u);
    expect(commonRules).toMatch(/不得打开正式用户数据根或真实业务素材/u);
  });

  it('preserves Electron renderer, preload and IPC trust boundaries', () => {
    expect(commonRules).toMatch(/renderer 是不可信边界/u);
    expect(commonRules).toMatch(/preload 只暴露固定、窄、版本化的 DTO 与 IPC 方法/u);
    expect(commonRules).toMatch(/IPC 必须校验 channel allowlist、senderFrame\/origin\/window/u);
  });

  it('keeps the local API disabled and loopback-only by default', () => {
    expect(commonRules).toMatch(/本地 API 默认关闭/u);
    expect(commonRules).toContain('127.0.0.1');
    expect(commonRules).toMatch(/不得自动扫描端口/u);
  });

  it('requires zero-warning, zero-skip and zero-vulnerability gates', () => {
    expect(commonRules).toMatch(
      /失败、skip、todo、lint warning、漏洞、意外外部连接和残留 listener 为零/u,
    );
    expect(commonRules).toMatch(/不得隐藏 warning 或降低断言/u);
  });

  it('controls dependencies and forbids real-service test dependencies', () => {
    expect(commonRules).toMatch(/不新增依赖/u);
    expect(commonRules).toMatch(/测试不得依赖真实密钥、真实付费服务/u);
  });

  it('requires factual documentation, acceptance evidence and reporting', () => {
    expect(commonRules).toMatch(/README 的开发状态、命令、包结构和下一里程碑/u);
    expect(commonRules).toMatch(/验收编号必须连续、\s*唯一、不可合并、不可预填 PASS/u);
    expect(commonRules).toMatch(/每项回填真实代码、测试、命令或文档证据/u);
    expect(commonRules).toMatch(/不得报告未执行的测试、未触发的托管 CI/u);
  });

  it('requires future Issue instructions to contain deltas only', () => {
    expect(commonRules).toMatch(/未来 Issue 指令只描述相对本块的增量/u);
    expect(commonRules).toMatch(/未来指令引用本块，不复制整套公共规则/u);
  });

  it('contains no Windows drive absolute path', () => {
    expect(commonRules).not.toMatch(/(?:^|[\s"'`(])[a-z]:[\\/]/imu);
  });

  it('contains no machine-specific Unix home or old workspace path', () => {
    expect(commonRules).not.toMatch(/(?:\/Users\/|\/home\/|\/workspace\/)/u);
  });

  it('contains no standalone commit or checksum-sized hexadecimal value', () => {
    expect(commonRules).not.toMatch(/\b(?:[0-9a-f]{40}|[0-9a-f]{64})\b/iu);
  });

  it('does not contain the current dynamic HEAD', () => {
    const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    expect(commonRules).not.toContain(currentHead);
  });

  it('contains no concrete Issue number, schema version or tool version', () => {
    expect(commonRules).not.toMatch(/\bIssue\s*0*\d+\b/iu);
    expect(commonRules).not.toMatch(/(?:schema|migration|迁移)\s*(?:version|版本|v)?\s*\d+/iu);
    expect(commonRules).not.toMatch(/\b(?:Node|Electron)\s*v?\d+/iu);
  });

  it('contains no concrete Issue commit identifier', () => {
    expect(commonRules).not.toMatch(/\bIssue\s*\d+.*\b[0-9a-f]{7,64}\b/iu);
  });

  it('fails closed when either marker is duplicated', () => {
    expect(() => extractCommonRules(`${agents}\n${startMarker}`)).toThrow(/exactly once/u);
    expect(() => extractCommonRules(`${agents}\n${endMarker}`)).toThrow(/exactly once/u);
  });

  it('keeps governance and existing hard constraints in test:constraints', () => {
    const constraints = packageJson.scripts['test:constraints'];
    expect(constraints).toContain('tests/agents-governance.test.ts');
    expect(constraints).toContain('tests/hard-constraints.test.ts');
    expect(constraints).toContain('tests/db-hard-constraints.test.ts');
    expect(constraints).toContain('tests/forbidden-scope.architecture.test.ts');
  });

  it('keeps governance auto-discovered by the full test and explicit in CI constraints', () => {
    expect(packageJson.scripts.test).toMatch(/run-portable-vitest\.mjs run$/u);
    expect(ci).toContain('npm run test:constraints');
    expect(ci).toContain('npm run test');
  });
});
