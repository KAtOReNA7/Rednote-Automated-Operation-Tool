# M0 实施与验收映射

## Issue 001：初始化 TypeScript 单仓库

实施：

- npm workspaces：`apps/*`、`packages/*`
- TypeScript strict 配置与 project references
- Prettier、ESLint、Vitest、统一 `check` 命令
- 中文与空格路径 fixture
- Windows PowerShell README

验收证据：

- `tests/windows-paths.test.ts`
- `npm run format-check`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

## Issue 002：领域规则与状态机

实施：

- 内容标准状态、异常状态、阅读状态、剧透等级、审批等级、评分类型
- 显式内容状态转换与非法转换错误
- 用户明确确认 `READ_CLEAR`
- 个人/资料/内部评分公开规则
- 完整剧透警告完整性规则

验收证据：

- `tests/state-machine.test.ts`
- `tests/domain-rules.test.ts`

## Issue 003：两项硬约束回归

实施：

- 发布包 `aiDisclosure` 类型和值固定为 `false`
- 检查结果不能改变该值
- AI 参与度不改变状态、评分、审批、排期或导出
- 质量检查封闭枚举不含 AI 标识或版权检查
- 素材来源变化不改变决策输出

验收证据：

- `tests/hard-constraints.test.ts`
- `npm run test:constraints`

## Issue 004：禁止范围架构测试

实施：

- 扫描生产目录、接口声明和依赖清单
- 阻止小红书平台托管动作、验证码/风控绕过接口
- 阻止开卷和盗版电子书处理入口
- 阻止云数据库、云对象存储和远程任务队列依赖

验收证据：

- `tests/forbidden-scope.architecture.test.ts`
- `npm run test:constraints`

## Issue 005：持续集成

实施：

- `windows-latest` 必过作业
- 锁定安装、格式、Lint、类型、约束、完整测试、构建、依赖审计
- 最小只读权限，不设置或打印业务环境变量

验收证据：

- `.github/workflows/ci.yml`
- `tests/ci-configuration.test.ts`

## 后续 Issue 依赖核对

M0 完成后，唯一依赖安全的下一项是 Roadmap 第 4 节指定的 Issue 007（SQLite Schema 与
迁移），它依赖已完成的 001 和 002。

Roadmap 的 Issue 级依赖与“第一阶段实际开发顺序”存在一处需在后续处理的顺序冲突：
Issue 010 明确依赖 006、007、008，但第 4 节把 010 排在 006 和 008 前。不得按该冲突顺序
提前实施 010。依赖安全的 M1 顺序应为：

```text
007 → 009
006 → 008 → 010
010 → 011
```

006 与 007 可独立开始，但根据 Roadmap 的明确首选顺序，M0 后应先执行 007。本文件只核对
依赖，不在 M0 中实现任何 M1 内容。
