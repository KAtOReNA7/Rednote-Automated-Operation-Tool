# AGENTS.md

本文件适用于整个仓库。任何自动化代理或贡献者在修改代码前都必须先阅读本文件。

## 1. 项目定位与当前状态

- 这是面向 Windows 10/11 的本地优先、单用户推理小说内容运营工作台。
- M0（Issue 001—005）、M1（Issue 006—011）、M2（Issue 012—021）以及 M3 Issue 022、
  Issue 023、Issue 024、Issue 025、Issue 026 已经完成。
- 下一项规划是 M3 Issue 027；不得在未收到明确任务时自动开始。
- 当前版本是开发中的本地基础设施，不是生产可用的内容运营成品。

事实来源按优先级为：

1. 用户当前明确指令；
2. 对应 Issue 的当前执行指令；已完成 Issue 的历史指令位于 `docs/instructions/`；
3. `docs/governance/codex-master-development-instruction-v1.md`；
4. `docs/product/xiaohongshu-development-roadmap-v1.md`；
5. `docs/product/xiaohongshu-mystery-account-prd-v1.md`；
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
- Issue 013 只允许用户在设置页显式确认后执行有限能力探测；不得把 provider 接入启动、
  保存设置、定时器、队列或内容工作流。
- `apps/clipper` 只允许 Issue 017 已冻结的用户点击式公开页面样本收藏；不得扩展为后台采集、
  页面遍历、平台自动化或任意公网客户端。

## 5. 架构边界

- `apps/web-ui` 是不可信 renderer：不得直接导入 Node、Electron、SQLite、文件系统、
  `net`、`http`、`crypto` 或凭据实现。
- preload 只暴露窄、稳定、按字段精确校验的 DTO 与 IPC 方法。
- Electron main 负责窗口、安全策略、本地资源和进程生命周期。
- `packages/core`、`copy`、`db`、`storage`、`workflows`、`settings`、`local-api`
  保持 Electron 无关。
- 本地 API 默认关闭，只允许显式绑定 `127.0.0.1`；不得退化到 `localhost`、
  `0.0.0.0`、`::`、LAN 或公网地址，也不得自动扫描端口。
- renderer 不接收长期插件 token 或 digest，配对码只能短期存在于内存。

## 6. SQLite 与数据规则

- migration 只能按连续版本追加，已发布 migration 不得修改、重排、合并或删除。
- 当前 migration v1—v19 已发布；历史 SHA-256 与 v8 搜索、v9 Fetch、v10 Browser Clip、
  v11 书目目录、v12 来源证据、v13 版本化研究档案、v14 阅读真实性、v15 Topic Pool 与
  v16 版本化实验、v17 结构化 Content Brief、v18 版本化 Copy 与 v19 事实映射 schema
  均由测试冻结。
  任何不匹配都应视为阻塞，而不是更新预期值。
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
- 开发、测试、构建和打包的临时目录与缓存必须从当前仓库根目录动态派生到同一卷；不得写死
  盘符、用户目录或跨卷临时路径。
- 每次运行只清理本次创建且已验证位于仓库 `.rednote-temp` 或明确输出目录内的精确目标；
  不得清理全局 TEMP、npm cache、用户目录或模糊匹配目录。
- 仓库根目录只保留贡献入口和工具必须从根目录发现的配置。产品基线放在 `docs/product/`，
  治理合同放在 `docs/governance/`，已完成 Issue 的执行指令放在 `docs/instructions/<milestone>/`。
- 新 Issue 指令可在执行期间临时放入根目录；完成并通过引用审计后应归档到对应
  `docs/instructions/` 目录。移动历史文件时保持内容不变，并同步活跃链接和测试。
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
npm run test:portability
npm run test:providers
npm run test:capabilities
npm run test:model-accounting
npm run test:search
npm run test:fetch
npm run test:clipper
npm run test:clipper-real
npm run test:electron-smoke
npm run package:desktop
npm run package:clipper
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

<!-- CODEX_COMMON_RULES: v1 -->

## Codex common development rules

以下规则是跨里程碑长期生效的公共约束。具体任务只应补充本轮增量，不应复制或弱化本块。

### 1. 适用范围与优先级

- 本块适用于整个仓库；子目录中的 `AGENTS.md` 只为其目录树补充更具体的规则。
- 指令冲突时，依次服从当前用户明确指令、冻结 PRD/Roadmap 的硬约束和禁止事项、根级及
  作用域内嵌套 `AGENTS.md`、当前 Issue 指令、ADR 和其他文档。
- 高优先级指令可以收窄任务范围，但不得静默弱化安全、隐私、合规或数据完整性约束。
- 修改代码前必须完整读取适用指令和规则，以实际代码、测试与 Git 事实确认能力，不能凭文件名、
  旧报告或计划状态猜测。
- 如冲突无法通过“更严格规则优先”解决，停止并报告，不自行猜测。

### 2. 冻结的产品与合规约束

- 产品保持 Windows 本地优先、单用户、用户掌控最终外部操作；云服务不得成为必需运行依赖。
- `ai_disclosure=false` 是默认且冻结的产品约束。AI 标识不得参与门禁、评分、审批、优先级、
  排期、缓存、成本、预算或导出决策。
- 版权风险不得进入字段、检查类型、门禁、评分、审批、优先级、排期或导出决策。
- 不新增版权风险字段、状态、分数、提醒或审批层级；素材来源只用于资料管理和追溯，不转化为版权判断。
- 不实现小红书自动登录、发布、评论、私信、验证码或风控处理；最终发布必须由用户手动完成。
- 不使用小红书非公开 API，不绕过登录、验证码、付费墙或访问控制。
- 不读取、上传、解析、索引或传播盗版电子书、开卷数据、内部经营数据或其他未获授权内容。
- 新增 Domain、Schema、UI、IPC、算法和测试时必须回归本节约束。
- 不得删除、skip、todo 或弱化保护上述边界的回归测试，也不得用源码字符串检查替代行为证据。

### 3. 可移植路径与动态基线

- 仓库根必须通过 `git rev-parse --show-toplevel` 动态发现；任务基线通过
  `git rev-parse HEAD` 在运行时记录。
- 源码、测试、fixture、文档和报告使用仓库相对路径；运行时数据使用项目数据根下的受控相对路径。
- 动态基线只用于本轮审计和差异范围，不得把固定 HEAD、文件 SHA、迁移 hash、盘符、用户名、
  绝对路径或旧工作区路径作为跨电脑开工门禁。
- 开工按依赖能力、文档、Schema 语义和既有门禁确认语义基线，不以对象 ID 是否相等代替。
- LF、CRLF 和 lone CR 不得改变规范化迁移身份，实质内容变化仍须 fail closed。
- 路径从动态仓库根、项目数据根或受控运行时目录派生，支持中文、空格、emoji 和 Windows 长路径。
- 实际绝对路径不得写入日志、诊断、快照、fixture、文档或提交。
- 不得因为合法的本地领先、换行差异、安装位置变化或预留包暂时为空而拒绝确认实际代码能力。

### 4. Git 与工作树保护

- 开工先运行 `git status --short --branch` 并动态记录当前分支、HEAD、log、远端和适用任务指令。
- 远端可以不存在，本地可以合法领先远端；任务要求特定分支而当前不符时不得擅自切换。
- 既有或未知未提交修改属于用户；发现时停止，不得擅自覆盖、删除、stash、reset 或纳入当前提交。
- 不使用会覆盖用户工作的 `git reset --hard`、`git checkout --` 或等价命令。
- 未获明确授权不得 fetch、pull、push、创建 PR、合并、rebase、amend、squash、改写历史或配置远端。
- 每个 Issue 默认只创建一个本地提交；任务指令 TXT 保留在仓库根并纳入该提交，除非用户另有要求。
- 每个任务提交只包含获准范围；提交前检查 diff、敏感信息、门禁结果，提交后核验 parent、范围、
  工作树和未执行的远端操作。
- 远端托管 CI 只有在实际触发并读取结果后才能报告，不得由本地绿色推断。

### 5. 磁盘、临时目录与清理

- 临时目录、npm cache、构建 staging 和打包空间必须从仓库所在卷动态派生，并在执行前检查该卷空间。
- 系统盘空间不足但项目卷空间充足时不得误停；项目卷空间不足时应安全停止并报告。
- 不修改用户全局 npm 配置，不执行全局磁盘清理，不删除用户缓存、下载、其他项目、正式项目数据根
  或未知目录，也不通过删除用户数据换取空间。
- 每轮使用唯一、明确、可验证的临时目录；清理前解析绝对目标并确认它位于本轮受控目录内。
- 只清理本轮精确目标，不执行全局缓存清理、宽泛递归删除或依赖未解析变量和 glob 的删除。
- 临时文件、缓存、构建产物和打包产物不得误入 Git。
- 结束时验证受控临时目录、进程、listener、socket 和 timer 无残留。

### 6. 任务范围与停止边界

- 开工先列出目标、允许修改、禁止范围、完成定义和停止点；只实现当前任务明确要求的能力。
- 不顺手实现下一任务、未来接口或邻近业务，不以“大规模重构”替代小而明确的根因修复。
- 未授权的 UI、Schema、API、后台 handler、网络能力和平台动作不得预留隐藏入口。
- 发现范围外缺陷时记录证据并报告；除非它阻塞当前门禁且修复已获授权，否则不扩张范围。
- 遇到扩大范围、真实凭据、真实费用、外部协调、破坏性操作或未决产品选择时停止并报告。
- 达到当前任务完成定义、完成获准提交并报告后立即停止，不自动进入下一任务。
- 停止时保留证据，不 reset、不删除用户数据、不伪造 PASS。

### 7. 密钥、网络、费用与外部副作用

- 不要求用户在聊天、指令、代码、fixture 或截图中粘贴密钥。默认不得读取、打印、复制、
  提交或探测真实密钥；密钥不得进入 Git、数据库、WAL/SHM、日志、
  audit、诊断、导出、fixture、截图、错误消息、IPC、缓存或测试输出。
- 数据库只保存非秘密引用；secret 只由 main-process CredentialStore/safeStorage 处理，
  renderer/preload 不接收 secret、raw request、raw response 或内部 endpoint。
- 测试使用运行时随机合成值、mock、fixture、临时数据库、临时项目数据根和本机 loopback。
- 测试不得读取环境中偶然存在的真实 key。
- 默认不得调用真实模型、搜索、图片、页面或业务 API，不得访问真实业务服务、产生费用或制造外部副作用。
- 真实网络或付费调用必须同时具备当前任务的明确授权、安全凭据流程、费用边界和可审计的用户确认；
  缺少任一条件即保持 mock 或 loopback。
- 费用未知时保持 `UNKNOWN/NULL`，不得写成零或猜测价格；不得硬编码模型名、Base URL、供应商价格或速率。
- 外部调用必须具有有限 timeout、size、concurrency、rate、idempotency 和取消边界，且调用期间
  不得持有数据库长事务。
- 任何可能已发送的外部请求都不得伪装成未发送、成功或零成本；恢复策略必须保守并可审计。

### 8. 数据库与迁移

- 数据库迁移只能按仓库运行时发现的连续顺序追加；已发布迁移不得修改、重排、合并或删除。
- 已冻结的迁移完整性由仓库现有测试和运行时计算验证；不得把某次机器上的具体迁移 hash
  复制进公共规则或用它替代实际校验。
- 迁移身份使用换行规范化内容校验，任何非换行语义变化都 fail closed；任务指令不得预置未来校验值。
- 迁移前生成可独立打开的本地备份，备份失败则不迁移；迁移在单事务中执行，失败完整回滚，
  不通过删除或重建用户数据库解决。
- 迁移后运行 quick_check、foreign_key_check 和必要业务不变量。
- 新表优先 STRICT，并明确主键、外键、唯一约束、CHECK、索引和删除策略；外键查询路径应有合适索引。
- schema 变化必须有新库与升级路径、数据保留、失败恢复、并发和可移植性证据。
- 数据库只保存合同允许的有限数据和受控相对路径；正文、密钥、原始响应和任意外部绝对路径不得落库。
- 用户数据与 fixture 必须隔离。

### 9. Queue、幂等与恢复

- 队列采用至少一次交付；有外部副作用的 handler 必须有稳定 executionId/idempotency key，
  状态机、lease、heartbeat、revision 和重放语义必须显式。
- 相同 executionId 重放不得重复外部请求、预算预留、成本结算、业务结果或不可逆操作。
- 外部调用期间不得持有数据库长事务；领取、续租、结算和恢复使用有界短事务。
- 只有可证明 pre-send 的失败才能安全释放或自动恢复；after-send、timeout-after-send、
  连接中断或崩溃后的不确定状态必须标记 `AMBIGUOUS`，不得自动重试、takeover 或 fallback。
- 长任务支持协作暂停、取消、lease、heartbeat 和受控 shutdown。
- Job payload/result 必须有界，且不得包含 secret、raw headers、完整正文或绝对路径。
- 崩溃恢复、取消、超时、租约过期和并发竞争都必须有确定测试，不能宣称无法证明的 exactly-once。

### 10. 本地文件与内容安全

- 托管文件只存在于显式项目数据根的受控类别中，数据库和 DTO 只保存 ManagedRelativePath；
  拒绝 traversal、absolute、UNC、device、drive-relative、file URL、symlink 和 junction。
- 文件写入采用有界流式 hash、内容校验、独占临时文件、sync、close 和原子发布；不先删除旧目标，
  不覆盖共享内容寻址文件。
- 大小、深度、数量和并发必须有限；失败、取消和超限不产生正式文件，只清理本操作精确临时文件。
- 删除和清理采用预览、确认、精确目标、引用检查和可恢复状态，不扫描或删除受控目录之外的内容。
- 日志、诊断、普通导出和包产物只包含 allowlist 摘要，不包含正文、原始响应、凭据或用户可识别文件名。
- 不宣称所有断电场景绝对没有 orphan；orphan 必须可检测并可安全处理。
- 测试内容必须是合成或明确授权的 fixture，不得打开正式用户数据根或真实业务素材。

### 11. Electron、IPC 与 UI 边界

- renderer 是不可信边界，不得直接导入 Node、Electron、SQLite、文件系统、网络、crypto 或凭据实现。
- 窗口保持 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`、`webSecurity=true`；
  不放宽 CSP、navigation、new window、webview、permission 或 Electron fuses。
- preload 只暴露固定、窄、版本化的 DTO 与 IPC 方法；所有输入执行 exact-object、类型、长度、
  大小和枚举校验。
- Electron main 负责窗口安全策略、本地资源、凭据、数据库、受控文件、网络和进程生命周期。
- IPC 必须校验 channel allowlist、senderFrame/origin/window、大小限制、expected revision 与
  短期令牌绑定；错误 DTO 不返回 stack、secret、raw request/response、完整内部路径或 SQL。
- 本地 API 默认关闭，只能显式绑定 `127.0.0.1`，不得自动扫描端口或退化到 LAN、公网或其他主机表示。
- renderer 不接收长期 token、digest、绝对路径、原始 payload 或内部租约；配对码和确认令牌短期、单次、仅驻内存。
- UI 只显示真实状态，未实现、未配置、未知、stale 和 unsupported 不伪装为 ready；不得提供
  未授权的隐藏按钮、登录/发布入口、任意请求编辑器或绕过开关。
- UI 不能绕过能力、预算、审批或用户手动完成最终平台动作的要求。
- Source 和 packaged smoke 必须验证安全设置、外部连接、进程退出与资源释放，且不得出现未处理的
  系统 Error launching app 弹窗。

### 12. 测试、CI 与依赖

- 开工前和最终提交前都运行从 `package.json`、workspace scripts 与 CI 工作流动态发现的适用门禁；
  不在本块固定会随任务增长的完整脚本清单或测试数量。
- 常规变更必须通过格式、lint、类型、约束、全量测试和构建；按风险追加数据库、队列、存储、桌面、
  设置、本地 API、Provider、能力、accounting、smoke、打包和依赖审计。
- 保留全部既有门禁；新能力必须有独立专项测试并纳入全量测试和 Windows CI，覆盖正常、失败、
  边界、并发、恢复、硬约束、Windows 路径和 egress。
- 完整测试必须自动发现治理测试；约束脚本和 CI 必须显式运行治理测试及既有硬约束。
- 门禁要求失败、skip、todo、lint warning、漏洞、意外外部连接和残留 listener 为零。
- 最终门禁从一次最新 `npm ci` 开始按 CI 顺序执行；失败时修复根因并从该起点重跑，
  不得删除、跳过、放宽或改写测试，不得隐藏 warning 或降低断言。
- 不新增依赖，除非标准库与仓库现有能力确实不足；新增时记录理由、锁定版本并通过许可、漏洞和打包审计。
- 测试不得依赖真实密钥、真实付费服务、固定端口、固定盘符、机器用户名或执行顺序。

### 13. 文档、验收与报告

- README 的开发状态、命令、包结构和下一里程碑必须与代码事实同步。
- 历史任务指令、ADR、合同和验收映射是审计证据；除非明确要求修正文档事实，不为统一措辞改写历史。
- 编码前为当前 Issue 建立 implementation plan 和逐项 acceptance map 草案；验收编号必须连续、
  唯一、不可合并、不可预填 PASS，每项回填真实代码、测试、命令或文档证据，不写“同上”。
- 架构选择、被否决方案、状态机、安全边界和迁移写入 ADR 或合同。
- 最终报告记录结论、动态基线与 Git、实现、迁移、测试、Windows/Electron/CI、硬约束、范围和下一步；
  实际 commit ID、测试数量和迁移校验值只作本次结果。
- 不得报告未执行的测试、未触发的托管 CI、未核验的远端状态或无法证明的外部系统结果。

### 14. 未来任务只写增量

- 未来 Issue 指令只描述相对本块的增量，默认包含：目标和提交信息、必须交付、明确不做、
  特有事实来源和语义依赖、特有合同/状态机/数据模型、特有安全边界、特有迁移、特有 UI/IPC、
  特有测试和验收矩阵、特有实施顺序、特有停止条件、启动指令。
- 未来指令引用本块，不复制整套公共规则；若重复内容冲突，以本块和更高优先级当前指令为准。
- 推荐引用语为：“完整遵守根级及作用域内 `AGENTS.md`；本指令仅定义当前 Issue 的增量规则。”
- 若确需改变公共规则，必须作为明确、可审计、版本化的治理任务处理，并同步治理测试。
- 临时任务数据不得写回本块，包括当前 Issue 编号、schema 版本、测试计数、HEAD、文件校验值、
  迁移 hash、机器路径或具体工具与模型版本。

<!-- END_CODEX_COMMON_RULES -->
