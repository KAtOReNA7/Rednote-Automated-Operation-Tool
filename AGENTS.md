# AGENTS.md

本文件适用于整个仓库。任何自动化代理或贡献者在修改代码前都必须先阅读本文件。

## 1. 项目定位与当前状态

- 这是面向 Windows 10/11 的本地优先、单用户推理小说内容运营工作台。
- M0（Issue 001—005）与 M1（Issue 006—011）已经完成。
- 下一项规划是 Issue 012：供应商无关的模型接口；不得在未收到明确任务时自动开始。
- 当前版本是开发中的本地基础设施，不是生产可用的内容运营成品。

事实来源按优先级为：

1. 用户当前明确指令；
2. 对应 Issue 的根目录执行指令；
3. `codex-master-development-instruction-v1.md`；
4. `xiaohongshu-development-roadmap-v1.md`；
5. `xiaohongshu-mystery-account-prd-v1.md`；
6. 已提交的 ADR、合同、验收映射和测试。

历史 Issue 指令、ADR、验收映射是审计证据。除非任务明确要求修正文档事实，否则不要为
“统一措辞”改写这些历史文件。

## 2. 开工检查

每次任务开始时：

1. 执行 `git status --short --branch`，保护所有既有用户修改。
2. 检查当前分支、HEAD、远端与适用的 Issue 指令。
3. 使用 `rg --files` 和 `rg` 了解现有实现，不凭文件名猜测。
4. 先确定任务边界和禁止范围，再修改代码。
5. 不因仓库为空、远端为空或某个预留包尚无业务实现而停止合理初始化工作。

如果发现与当前任务无关的未提交修改，不得擅自覆盖、删除、stash 或提交。

## 3. 永久硬约束

- `aiDisclosure` 默认且保持为 `false`。
- AI 标识不参与门禁、评分、审批、优先级、排期或导出决策。
- 版权风险完全不进入字段、检查类型、门禁、评分、审批、优先级、排期或导出。
- 不实现小红书自动登录、发布、评论、私信、验证码或风控处理。
- 不使用小红书非公开 API，不绕过登录、验证码、付费墙或访问控制。
- 不使用开卷数据，不读取、上传、解析或索引盗版电子书。
- 不使用磨铁内部经营、采买或历史项目数据。
- 不引入云数据库、云对象存储、Redis、远程任务队列或服务器作为必需运行依赖。
- 最终发布动作必须由用户在平台上手动完成。

相关回归测试不得删除、skip、todo、弱化断言或改成仅检查源码字符串的脆弱替代品。

## 4. 密钥、网络与费用

- 不读取、打印、复制或提交真实密钥。
- 密钥不得进入 Git、SQLite、WAL/SHM、日志、audit、诊断、导出、fixture、截图或错误消息。
- 测试使用运行时随机值、mock、fixture、临时数据库和本机 loopback。
- 除非当前任务明确授权且安全凭据流程已经完成，否则不得调用真实模型、搜索、图片或业务
  API，不得产生费用。
- `packages/providers` 在 Issue 012 前保持无真实客户端；`apps/clipper` 在 Issue 017 前保持
  无插件业务。

## 5. 架构边界

- `apps/web-ui` 是不可信 renderer：不得直接导入 Node、Electron、SQLite、文件系统、
  `net`、`http`、`crypto` 或凭据实现。
- preload 只暴露窄、稳定、按字段精确校验的 DTO 与 IPC 方法。
- Electron main 负责窗口、安全策略、本地资源和进程生命周期。
- `packages/core`、`db`、`storage`、`workflows`、`settings`、`local-api` 保持 Electron
  无关。
- 本地 API 默认关闭，只允许显式绑定 `127.0.0.1`；不得退化到 `localhost`、
  `0.0.0.0`、`::`、LAN 或公网地址，也不得自动扫描端口。
- renderer 不接收长期插件 token 或 digest，配对码只能短期存在于内存。

## 6. SQLite 与数据规则

- migration 只能按连续版本追加，已发布 migration 不得修改、重排、合并或删除。
- 当前 migration v1—v5 的 SHA-256 由测试冻结；任何不匹配都应视为阻塞，而不是更新预期值。
- 迁移前备份、事务回滚、外键、STRICT 表和 Windows 路径行为必须保持。
- 数据库只保存受控路径或相对路径；不得把任意外部绝对路径当作托管文件。
- 队列采用至少一次交付。未来真实 handler 必须保证外部副作用幂等。

## 7. 实现与清理原则

- 优先修复根因，保持改动在当前任务范围内。
- 只删除经引用搜索、类型检查和测试证明无消费者的代码；不要把未来 Issue 的预留包误删。
- 不用大规模重写替代小而明确的修改。
- 不新增依赖，除非现有标准库和仓库能力确实无法满足需求，并记录理由。
- Windows 文件操作使用显式、已解析的目标路径；删除或递归移动前确认目标位于预期目录。
- 保持中文路径、空格路径和 Windows 原生运行兼容。
- README 的开发状态、命令、包结构和下一里程碑必须随已完成工作同步更新。

## 8. 必需验证

常规改动至少运行：

```powershell
npm run format-check
npm run lint
npm run typecheck
npm run test
npm run build
```

涉及桌面、SQLite、存储、设置、本地 API、依赖或发布配置时，还应按风险运行：

```powershell
npm run test:constraints
npm run test:db
npm run test:queue
npm run test:desktop
npm run test:storage
npm run test:settings
npm run test:local-api
npm run test:electron-smoke
npm run package:desktop
npm run audit:dependencies
npm run test:packaged-smoke
```

门禁失败必须修复根因后重跑；不得通过降低断言、跳过测试或隐藏 warning 取得绿色结果。

## 9. Git 与交付

- 未经用户明确授权，不得 push、创建 PR、合并、改写历史或配置新的远端。
- 提交前检查 `git diff --check`、变更范围、敏感值、测试结果和工作树。
- 不使用 `git reset --hard`、`git checkout --` 或其他可能覆盖用户工作的命令。
- 提交只包含当前任务；提交信息应简洁描述实际变化。
- 推送后核验本地 HEAD、远端目标 SHA 和工作树状态，不把“已 push”误报为“托管 CI 已通过”。

## 10. 完成定义

任务只有在以下条件全部满足时才算完成：

- 需求和边界均已实现；
- 相关文档与代码事实一致；
- 格式、lint、类型、测试和构建通过；
- 无失败、skip、todo、漏洞、真实密钥、意外网络请求或残留进程/listener；
- Git diff 仅包含获准范围；
- 已明确说明未实现的后续能力和下一步。
