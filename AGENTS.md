# AGENTS.md

本文件适用于整个仓库。任何自动化代理或贡献者在修改代码前都必须完整读取根级及作用域内
`AGENTS.md`。

## 1. 项目定位、状态与事实优先级

- 项目是面向 Windows 10/11 的本地优先、单用户推理小说内容运营工作台；云服务不得成为必需
  运行依赖，当前版本仍是开发中的本地基础设施。
- M0、M1、M2 与 M3 Issue 022—028 已完成；Issue 029A 确定性 Copy Integrity 子集与 Minimal
  Issue 030 只读质量聚合器已完成，M3 按缩减范围收口。原 Issue 029 仍为部分完成，029B 保持
  deferred，M4 未开始；下一步仅允许另行授权一次零模型、零平台动作的受控本地内容试运行。
- 事实来源依次为：当前用户明确指令；当前任务指令；冻结 PRD/Roadmap；根级及作用域内
  `AGENTS.md`；已提交 ADR、合同、验收映射与测试。冲突无法按更严格规则消解时停止并报告。
- 历史 Issue 指令、ADR 和验收映射是审计证据；除非任务明确要求修正文档事实，不为统一措辞
  改写它们。

## 2. 开工、动态基线与任务边界

- 用 `git rev-parse --show-toplevel` 动态发现仓库根，用 `git rev-parse HEAD` 记录本轮基线；
  执行 `git status --short --branch`，核对当前分支、log、远端与适用任务指令。
- 使用 `rg --files` 和 `rg` 根据实际代码、Schema、合同与测试确认能力，不凭文件名、旧报告、
  计划状态或对象 ID 猜测。
- 既有或未知未提交修改属于用户；发现时停止，不覆盖、删除、stash、reset 或纳入当前提交。
- 开工先明确目标、允许修改、禁止范围、完成定义和停止点。只实施获授权范围，不顺手进入下一
  Issue，不用大规模重写替代小而明确的根因修复。
- 远端可以不存在，本地可以合法领先；不得因盘符、用户名、安装位置、LF/CRLF/lone CR、
  固定 HEAD、文件 SHA、migration hash、预留包为空或合法本地领先而拒绝语义基线。
- 若需要扩大范围、真实凭据或费用、外部协调、破坏性操作或未决产品选择，停止并请求授权。

## 3. 产品、合规与来源硬约束

- 字段 `aiDisclosure`（持久化表示 `ai_disclosure`）默认且固定为 `false`。AI 标识不得参与
  门禁、评分、审批、优先级、排期、缓存、成本、预算或导出决策。
- 版权风险不得进入字段、检查类型、门禁、评分、审批、优先级、排期或导出决策；素材来源只
  用于资料管理与追溯，不转化为版权判断。
- 不实现小红书自动登录、发布、评论、私信、验证码或风控处理，不使用非公开 API，不绕过
  登录、验证码、付费墙或访问控制。最终发布必须由用户在平台上手动完成。
- 不使用开卷数据，不读取、上传、解析、索引或传播盗版电子书，不使用磨铁内部经营、采买或
  历史项目数据，也不处理其他未获授权内容。
- 新增 Domain、Schema、UI、IPC、算法与测试必须回归本节；不得删除、skip、todo、弱化相关
  保护断言，或用源码字符串检查替代行为证据。

## 4. 密钥、网络、费用与外部副作用

- 默认不得读取、打印、复制、提交或探测真实密钥，也不要求用户在聊天、指令、fixture 或截图
  中粘贴密钥。
- W2 纯 Web 工作台只有一项窄例外：用户可以在设置页把 Provider API key 输入当前页面会话内存，
  并在逐次预览后明确确认一次文本请求。该 key 不得进入 workspace snapshot、IndexedDB、
  local/session storage、URL、DOM attribute、日志、诊断、导出、测试输出或 Git；刷新、关闭、
  断开工作区后必须清除。此例外不适用于 Electron renderer/preload、Clipper、Search、Fetch、图片
  或平台操作，也不得削弱 main-process `CredentialStore`/`safeStorage` 规则。
- 密钥不得进入 Git、SQLite/WAL/SHM、日志、audit、诊断、导出、fixture、截图、错误消息、
  IPC、缓存或测试输出。数据库只保存非秘密引用；secret 只由 main-process
  `CredentialStore`/`safeStorage` 处理，renderer/preload 不接收 secret、raw request、
  raw response 或内部 endpoint。
- 测试只使用运行时随机合成值、mock、fixture、临时数据库、临时项目数据根与本机 loopback，
  且不得读取环境中偶然存在的真实 key。
- 默认不得调用真实模型、搜索、图片、页面或业务 API，不得访问真实业务服务、产生费用或制造
  外部副作用。真实调用必须同时获得当前任务授权、安全凭据流程、费用边界和可审计用户确认。
- 费用未知保持 `UNKNOWN`/`NULL`；不猜测或硬编码模型名、Base URL、供应商价格或速率。
- 外部调用必须有有限 timeout、size、concurrency、rate、idempotency 与取消边界，且调用期间
  不持有数据库长事务。可能已发送的请求不得伪装成未发送、成功或零成本。
- `apps/clipper` 只保持用户点击式公开页面样本收藏边界，不扩展为后台采集、页面遍历、平台
  自动化或任意公网客户端。

## 5. 可移植路径、磁盘与本地内容

- 源码、测试、fixture、文档和报告使用仓库相对路径；运行时数据只使用项目数据根下的受控
  相对路径。实际绝对路径不得进入日志、诊断、快照、fixture、文档或提交。
- 临时目录、npm cache、构建 staging 与打包空间从仓库所在卷动态派生；执行前检查该卷空间，
  不修改全局 npm 配置，也不清理全局 TEMP、用户目录、其他项目或正式项目数据。
- 每轮使用唯一、可验证的受控临时目录；只清理本轮创建的精确目标，且删除前确认目标位于
  `.rednote-temp` 或明确输出目录内。临时文件、缓存与构建产物不得误入 Git。
- 托管文件只存在于项目数据根的受控类别；数据库与 DTO 只保存 `ManagedRelativePath`，拒绝
  traversal、absolute、UNC、device、drive-relative、file URL、symlink 与 junction。
- 文件写入采用有界流式 hash、内容校验、独占临时文件、sync/close 与原子发布；不先删除旧
  目标，不覆盖共享内容寻址文件。失败、取消或超限不产生正式文件。
- 删除与清理使用预览、确认、精确目标、引用检查和可恢复状态，不扫描受控目录之外的内容。
  日志、诊断与普通导出仅含 allowlist 摘要，不含正文、原始响应、凭据或用户可识别文件名。
- 测试不得打开正式用户数据根或真实业务素材；fixture 与用户数据必须隔离。
- Windows 文件操作使用已解析的明确目标，并保持中文、空格、emoji 与长路径兼容。

## 6. 架构、Electron、IPC 与本地 API

- `apps/web-ui` renderer 是不可信边界，不得直接导入 Node、Electron、SQLite、文件系统、
  `net`、`http`、`crypto` 或凭据实现。
- 窗口保持 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`、
  `webSecurity=true`，不得放宽 CSP、navigation、new window、webview、permission 或
  Electron fuses。
- preload 只暴露固定、窄、版本化的 DTO 与 IPC 方法；Electron main 负责窗口安全策略、本地
  资源、凭据、数据库、受控文件、网络和进程生命周期。
- IPC 必须校验 channel allowlist、senderFrame/origin/window、exact-object、类型、长度、
  大小、枚举、expected revision 与短期令牌绑定。错误 DTO 不返回 stack、secret、raw
  request/response、完整内部路径或 SQL。
- renderer 不接收长期 token、digest、绝对路径、原始 payload 或内部租约；配对码与确认令牌
  短期、单次且仅驻内存。
- 本地 API 默认关闭，只能显式绑定 `127.0.0.1`；不得自动扫描端口或退化到 `localhost`、
  `0.0.0.0`、`::`、LAN 或公网地址。
- UI 只显示真实状态；未实现、未配置、未知、stale 与 unsupported 不伪装为 ready，不提供
  未授权入口、任意请求编辑器或绕过开关。

## 7. SQLite、来源链、队列与恢复

- migration 只能按运行时发现的连续顺序追加；已发布 migration 不得修改、重排、合并或删除。
  迁移身份按换行规范化内容校验，任何非换行语义变化都 fail closed；不得把某台机器的具体
  migration hash 复制成公共门禁。
- migration 前生成可独立打开的本地备份，备份失败则不迁移；迁移在单事务中执行，失败完整
  回滚，不通过删除或重建用户数据库解决。迁移后运行 `quick_check`、`foreign_key_check`
  与必要业务不变量。
- 新表优先 `STRICT`，明确主键、外键、唯一约束、`CHECK`、索引与删除策略；外键查询路径应有
  合适索引。正文、密钥、原始响应和任意外部绝对路径不得落库。
- Draft、Claim、FactEvaluation、Evidence、SourceRevision 等来源链必须保持单一事实来源与
  可追溯版本；不得为方便工作流复制可漂移的正文或研究事实，也不得静默改写用户数据。
- 队列采用至少一次交付。外部副作用使用稳定 executionId/idempotency key；状态机、lease、
  heartbeat、revision 与重放语义必须明确，重放不得重复外部请求、预算预留、成本结算、
  业务结果或不可逆操作。
- 只有可证明 pre-send 的失败可安全释放或自动恢复；after-send、timeout-after-send、连接
  中断或崩溃后的不确定状态必须标记 `AMBIGUOUS`，不得自动重试、takeover 或 fallback。
- 长任务支持协作暂停、取消、lease、heartbeat 与受控 shutdown；payload/result 有界且不含
  secret、raw headers、完整正文或绝对路径。崩溃、取消、超时、租约过期与并发竞争需有确定
  测试，不宣称无法证明的 exactly-once。

## 8. 实现原则、依赖与 Issue 预算

- UI 设计治理只有本段为公共权威：Codex 不得在生产代码中自行发明、重做或边编码边设计 UI。
  新页面、布局、导航、组件体系、视觉改版或交互模型变化必须先进入独立设计阶段并调用 Figma；
  不得以代码原型、ImageGen、HTML mock 或自行想象替代 Figma 设计稿。
- 设计前至少核验 3 个与目标流程对应的成熟商业产品，优先使用官方页面、官方帮助中心或可核验
  真实界面，并记录产品、页面/流程、借鉴点与不采用点。排程可参考 Buffer、Later、Hootsuite、
  Sprout Social、Meta Business Suite；审批/互动可参考 Front、Intercom、Zendesk；高密度工作台可
  参考 Linear、Notion、Airtable，但不得机械拼贴或复制品牌视觉，实施时必须重新核验当前产品。
- Figma 稿至少包含目标流程、桌面主视图、关键空/加载/错误/异常状态、必要响应式状态，以及复用的
  components、variables 与 styles。向用户提供可核验的 Figma 文件、页面和 Frame 定位并等待明确
  接受；编码只能引用已接受的 fileKey/nodeId 或等价稳定定位实现，不得重新设计。
- Figma 工具、目标文件或用户确认不可用时状态为 `FIGMA_DESIGN_BLOCKED`，不得退回直接编码。
  仅把现有界面接到数据、修复与已批准 Figma 不一致的缺陷，或不改变布局、视觉与交互的技术修复
  可以不新增设计稿。
- 优先修复根因并保持改动最小；只删除经引用搜索、类型检查与测试证明无消费者的代码，不把
  未来 Issue 的预留包误删，也不预留未授权 Schema、API、后台 handler 或隐藏入口。
- 不新增依赖，除非标准库与仓库现有能力确实不足；新增时记录理由、锁定版本并通过许可、漏洞
  与打包审计。
- 以下是后续 Issue 默认预算，只有用户在任务开始前明确批准才可覆盖：
  - 生产源码新增不超过 1,500 行；
  - 测试新增不超过 1,200 行；
  - 净新增业务表不超过 2；
  - 新增 trigger 不超过 6；
  - 新增 IPC channel 不超过 2；
  - 变更文件不超过 25；
  - Issue 指令建议不超过 300 行；
  - 核心验收保持 10—20 项。
- 达到任一预算 100% 时停止扩展，先报告实际值和剩余工作；超过 150% 时自动暂停，不继续编码
  或运行全量门禁；预计超过 200% 时必须拆分任务，或取得外部复核及用户重新授权。
- 安全修复和不可分割 migration 只能申请例外，不得自行豁免。行数不是质量目标，允许用更少
  代码完成；预算统计应说明基线、口径和生成文件是否排除。

## 9. 三层验证门禁

测试选择以 `package.json`、workspace scripts、CI 与变更风险动态确定。保留既有门禁；新增
能力应进入全量自动发现和 Windows CI。失败、skip、todo、`only`、lint warning、漏洞、意外
外部连接与残留 listener 必须为零，不得隐藏 warning、降低断言或把行为测试改成源码字符串检查。

### 验证失败分类与可观测执行（唯一权威定义）

- `PRODUCT_OR_TEST_FAILURE`：存在明确失败文件或用例；定位并精确修复后重跑失败项。
- `INFRASTRUCTURE_FAILURE`：进程、磁盘、权限或测试运行器异常；先修复环境，不修改产品迎合。
- `OBSERVABILITY_FAILURE`：exit code 异常但摘要、失败身份或结果文件缺失；增强持久日志后只允许
  诊断重跑一次。
- 精确测试采用进展式重试：每次失败后必须产生新定位或对应修改；禁止无修改、无新信息盲跑，
  不设置机械的重试次数上限。
- 长任务启动前必须持久保存 stdout/stderr，在工具支持时保存 JSON/JUnit 等结构化结果，并记录
  真实 exit code 与起止时间。工具提前返回时持续等待同一进程，不得另启第二个运行。

### A. 开发循环

- 只运行受影响 package/文件的测试，必要时运行增量 format、lint 或 typecheck。
- 修复失败后先重跑精确失败项，不从 `npm ci` 或全量门禁重新开始。

### B. Issue 完成门禁

- 运行受影响领域专项测试，以及直接相邻的集成、约束或 migration 测试。
- 全量 Vitest 最多一次；普通与容量/性能入口必须使用静态非重叠文件集合，最终候选各最多
  运行一次。专项脚本已选择相同文件后，不再通过固定门禁无差别重复这些文件。
- 每个最终验证序列最多运行一次 `npm ci`；依赖与 lockfile 未变时，本地治理任务可不运行。
- 按风险补充数据库、队列、存储、桌面、设置、本地 API、Provider、能力与 accounting 等
  独立环境信号；记录未运行项及理由。

### C. 里程碑 / Release 门禁

- 才运行完整 `npm ci`、全量测试、build、desktop/clipper package、Electron smoke、
  packaged smoke、真实浏览器 smoke 与依赖审计的适用集合。
- 真实浏览器 smoke 仅在 Clipper、Local API 或浏览器集成变化，或里程碑/Release 时运行。
- CI 可选择单次全量 Vitest或互不重叠的稳定分片；分片时分别运行普通与容量集合，不得先串行
  运行所有重叠专项子集再运行全量。
  Electron、packaged、浏览器与安全进程边界测试具有独立环境信号，不因名称相似而删除。
- 不适用的门禁必须记录理由，不为凑数量执行。打包与 smoke 需验证安全设置、外部连接、进程
  退出与资源释放，不得出现未处理的系统启动错误弹窗。

## 10. Git、提交与远端

- 不使用 `git reset --hard`、`git checkout --` 或等价覆盖操作。
- 未获明确授权不得 fetch、pull、push、创建 PR、合并、rebase、amend、squash、改写历史或
  配置远端。任务要求特定分支而当前不符时不得擅自切换。
- 每个 Issue 默认只创建一个本地提交；提交只包含当前获准范围。提交前检查
  `git diff --check`、变更范围、敏感值、验证结果和工作树。
- 推送后必须核验本地 HEAD、远端目标 SHA 与工作树；只有实际触发并读取结果后才可报告托管
  CI，不能由本地绿色推断。

## 11. 文档、验收与未来指令

- README 的开发状态、命令、包结构和下一里程碑必须与代码事实同步。产品基线放
  `docs/product/`，治理合同放 `docs/governance/`，已完成任务指令归档到对应
  `docs/instructions/`。
- 编码前建立简短 implementation plan 与风险导向 acceptance map；核心验收保持 10—20 项，
  不把每个参数排列拆成证明样板。参数组合优先表驱动，选择代表性的正常、失败、边界、安全、
  迁移与恢复证据。
- 验收不得预填 PASS；每项回填真实代码、测试、命令或文档证据。架构选择、否决方案、状态机、
  安全边界与 migration 写入 ADR 或合同。
- 未来 Issue 指令只描述相对本文件的增量，明确引用根级及作用域内 `AGENTS.md`，不得复制整套
  公共规则或三层门禁；公共规则变更应作为版本化治理任务处理。
- 最终报告只陈述已验证事实，不得报告未执行测试、未触发托管 CI、未核验远端或无法证明的
  外部结果。

## 12. 完成与停止

任务仅在需求与边界完成、代码文档一致、适用验证通过、无真实密钥/费用/意外网络、无残留
进程或受控临时文件、Git diff 仅含获准范围时完成。达到停止点、完成获准提交并报告后立即停止；
未实现的后续能力和下一步必须明确说明。

## 13. 模型与推理强度治理

- 默认模型为 `gpt-5.6-terra`，默认推理强度为 `medium`。不得仅因提示词长、文件多、测试多、截图多或执行耗时长而升档。
- 每个阶段先按“风险 × 不确定性”重新判定，不继承上一阶段的高档位。

风险信号包括：Schema、migration、持久化、数据兼容或数据丢失风险；IPC、API、Provider、能力状态机、协议或真实费用边界；应用入口、打包、发布、合并或回滚；鉴权、安全、凭据或隐私。

不确定性信号包括：根因跨多个子系统且尚未定位；存在两个以上合理但不兼容的实现合同；变更难回滚或可能造成不可逆结果；同类缺陷反复回归；已有一次 `terra + medium` 的实施证据，但关键问题仍未解决。

选择规则如下：

1. 局部、可逆、根因明确的任务使用 `gpt-5.6-terra + medium`。
2. 至少一个风险信号和一个不确定性信号同时存在，或存在两个相互独立的高风险信号时，使用 `gpt-5.6-terra + high`。
3. `gpt-5.6-sol + high` 仅限重大架构、安全或数据事故；一次有完整记录的 `terra + high` 尝试后关键架构歧义仍未解决；或高风险合并、发布存在多个不兼容方案且无法以现有证据安全裁决。使用前必须取得用户明确批准。
4. 未经用户明确批准，禁止使用 `xhigh`、`max` 或 `ultra`。
5. 普通 CI 环境、网络、代理、截图时序或第三方缓存导致的偶发失败，不计为模型推理失败，也不能据此自动升档。

阶段校准：视觉验收、指令整理、局部 CSS/UI 修复通常使用 `terra + medium`；代码完整验证后的 commit、push、PR 更新、CI 或打包使用 `terra + medium`。只有遇到语义冲突、发布阻断或高风险回滚问题时，才重新评估是否升至 `terra + high`。

本项目校准样例：R08 Stage A/B 页面视觉实现、响应式 CSS、导航截图时序、封面预览布局与点击问题使用 `terra + medium`；默认 V2 入口、打包合同和真实进程 smoke 的跨层集成，Provider 能力降级状态、503 证据持久化及功能隔离，以及跨 desktop/web/db/v2 且包含 migration 的工作流闭环，使用 `terra + high`。已完成验证后的提交、推送、更新 PR、运行 CI、生成体验包使用 `terra + medium`。现有执行结果没有证明任何任务必须使用 `sol + high` 才能完成。

以后每条开发指令必须在最前面包含：

```text
模型：gpt-5.6-terra
推理强度：medium
选择依据：一句话说明风险与不确定性。
升级条件：无；或写明唯一、可验证的升级触发条件。
```

不得使用“尽可能高”“最高推理”或仅凭任务规模升档等模糊表述。
