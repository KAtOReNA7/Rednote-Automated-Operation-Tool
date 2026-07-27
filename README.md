# 小红书推理小说内容运营系统

这是一个面向 Windows 10/11 的本地优先、单用户推理小说内容运营生产与决策系统。

当前仓库已完成 M0（Issue 001—005）以及 M1 的 Issue 007：TypeScript 单仓库、领域规则
与状态机、两项不可变约束回归测试、禁止范围架构测试、Windows 必过 CI，以及本地
SQLite Schema 和迁移基础。尚未实现桌面 UI、设置、任务执行器、供应商接入、搜索、图片
或任何业务工作流。

## 产品边界

- 最终发布动作始终由用户手动完成。
- 不包含小红书自动登录、发布、评论、私信、验证码或风控处理。
- 不使用开卷数据，不读取、上传、解析或索引盗版电子书。
- 不使用磨铁内部经营、采买或历史项目数据。
- 不把云数据库、云对象存储、远程任务队列或服务器作为运行依赖。
- 新发布包的 `aiDisclosure` 固定为 `false`，且不参与门禁。
- 版权风险不参与门禁、评分、审批、优先级、排期或导出。

冻结需求以以下文件为准：

- [产品 PRD](./xiaohongshu-mystery-account-prd-v1.md)
- [开发路线图](./xiaohongshu-development-roadmap-v1.md)
- [Codex 总开发指令](./codex-master-development-instruction-v1.md)

## 单仓库结构

```text
apps/
  desktop/       M0 仅保留包边界
  web-ui/        M0 仅保留包边界
  clipper/       M0 仅保留包边界
packages/
  core/          领域枚举、规则、状态机和发布包不变量
  db/            SQLite 连接、25 张业务表、迁移、事务和迁移前备份
  providers/     M0 仅保留包边界
  workflows/     M0 仅保留包边界
  shared/        M0 仅保留包边界
tests/           领域、硬约束、架构、Windows 路径和 CI 配置测试
```

## Windows PowerShell

先安装 Node.js 24（最低支持 Node.js 22.16），再在 PowerShell 中执行：

```powershell
Set-Location 'D:\你的路径\小红书 推理项目'
npm install
npm run check
```

已有 `package-lock.json` 的干净检出应使用可重复安装：

```powershell
npm ci
npm run format-check
npm run lint
npm run typecheck
npm run test
npm run build
```

两项硬约束与禁止范围可以单独运行：

```powershell
npm run test:constraints
```

SQLite 迁移、持久化、失败恢复、Windows 路径和数据库硬约束可以单独运行：

```powershell
npm run test:db
```

依赖审计：

```powershell
npm run audit:dependencies
```

所有命令均为本地构建与测试，不需要密钥，不会调用模型、搜索、图片或其他付费 API。

## 领域规则

- 内容沿 `IDEA` 到 `MEASURED` 的显式状态机前进，非法跳转会抛出错误。
- `FACT_BLOCKED`、`GENERATION_FAILED`、`VISUAL_FAILED`、`USER_REJECTED` 有显式恢复路径；
  `ARCHIVED` 是终态。
- 阅读状态默认 `UNKNOWN`，只有用户明确确认才能设置为 `READ_CLEAR`。
- `PERSONAL` 评分要求 `READ_CLEAR` 且分数由用户确认；`INTERNAL_PREDICTION` 不公开。
- `FULL` 剧透要求封面、标题和正文开头三处警告；警告齐全后允许继续导出。

## CI

`.github/workflows/ci.yml` 将 `windows-latest` 作为唯一必过作业，依次执行锁定安装、格式
检查、Lint、类型检查、两项约束套件、SQLite 专项测试、完整测试、构建和依赖审计。CI
不读取或打印业务环境变量。

架构与 M0 取舍见 [ADR-0001](./docs/adr/0001-m0-foundation.md)，逐 Issue 验收映射见
[M0 验收映射](./docs/m0-acceptance-map.md)。SQLite 选型与迁移策略见
[ADR-0002](./docs/adr/0002-sqlite-schema-and-migrations.md)，Issue 007 的逐项证据见
[M1 Issue 007 验收映射](./docs/m1-issue007-acceptance-map.md)。
