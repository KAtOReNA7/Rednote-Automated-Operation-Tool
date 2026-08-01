# Spoiler Quality Check V1

## 1. 能力声明

`SPOILER` 检查只证明当前不可变 DraftVersion 的确定性声明与警告子集已通过，并且有限词法规则
没有发现需复核证据。`PASS` 不证明全文无剧透、不表示系统理解剧情真相，也不授予审批、导出或
发布资格。

`FULL_TRICK_ANALYSIS` 是允许的内容模式。只要冻结 Brief 声明、用户确认和四个警告 surface
满足合同，正文直接讨论凶手、结局或核心诡计不会触发泄露 detector。

## 2. 输入资格与事实来源

- 只检查 current、`ACTIVE`、结构有效且状态为 `READY_FOR_QUALITY_PIPELINE` 的 DraftVersion。
- Draft payload 是公开文本、四个警告文本和冻结 Brief snapshot 的唯一来源。
- 当前 Brief root/current version 是 readiness、revision、input/lock/dependency hash、spoiler
  plan 与 invalidation 的事实来源。
- Draft 或 Brief 的 pointer、revision、hash、plan、artifact 或 invalidation 变化都会生成不同
  `inputHash`；既有摘要由查询派生为 `STALE`。
- `STALE`、`NOT_RUN` 不写入数据库枚举。

## 3. 确定性规则

- `NO_SPOILER`：placement 为 `NONE`，reveal/confirmation flags 为 false，四个警告字段为空。
- `LIGHT_SPOILER`：placement 为 `BODY_OPENING`，不得声明核心诡计或结局；正文开头必须是明确
  轻度警告，其他三个警告 surface 不得出现。笼统警告进入 `REVIEW_REQUIRED`。
- `FULL_TRICK_ANALYSIS`：Brief 必须已确认，reveal flags 为 true；封面、标题 marker、正文开头
  与置顶评论警告都必须明确表达完整/核心范围，且 marker 必须实际位于当前所选标题。
- NO/LIGHT 只运行 `spoiler-candidate-detector-v1` 的窄答案式表达候选。候选始终是复核证据，
  不会被称为作品真实答案或事实。
- 问句、否定、引用、反例、元讨论和上下文不完整等歧义只会进入人工复核；扫描或 finding 截断
  时不得 `PASS`。

## 4. 保存合同

复用 `quality_checks.check_type='SPOILER'`，不新增 Schema。保存只使用：

- `draft_id`、`draft_version_id`、`result`、`severity`；
- `details_json`、`checker_version`、`input_hash`；
- `legacy_unresolved=0`。

`summary_status`、`reason_code` 与 Fact Mapping FK 均保持 `NULL`。稳定 ID 覆盖 check type、
DraftVersion、checker version 与 input hash。仓储只执行 `INSERT OR IGNORE`，随后逐字段回读；
重复确认幂等，ID 碰撞或字段不一致 fail closed。

`details_json` 不超过 4096 bytes，只包含状态、计数、有限 reason code 和 finding。finding 仅含
surface/artifact identity、Unicode code-point `[start,end)`、artifact/selection hash、disposition
和规则版本；不保存正文、警告全文、SQL、绝对路径、凭据或原始请求。

## 5. 输入身份

`inputHash` 覆盖 current Draft identity/revision/state/status/结构、Draft input/dependency/lock hash、
Draft invalidation、公开 artifact kind/order/work IDs/code-point length/text hash、四个警告 surface
的 presence/length/text hash、冻结 Brief lineage/input/lock/plan、当前 Brief pointer/readiness/hash/
plan/invalidation，以及 checker、policy、Copy contract、结构校验、NFC/LF normalization、locator、
警告分类器和候选 detector 版本。

时间戳、随机值、AI 标识、版权风险、模型信息、密钥和原文不进入输入身份。

## 6. IPC 与副作用

只暴露：

- `quality:spoiler:preview`
- `quality:spoiler:confirm`

preview 只读。confirm 使用五分钟内存令牌，绑定 sender、BrowserWindow、Draft、DraftVersion、
revision、preview hash 与 input hash，单次消费，并在 main process 内重新读取和重算。两个调用的
外部请求数固定为 0、费用状态为 `NOT_APPLICABLE`。renderer 不接收正文副本、内部 digest、路径、
数据库句柄或长期 token。

## 7. 不变量

AI 标识固定为 false，AI 参与程度和版权风险不参与本检查的输入、finding、状态、保存、评分、
优先级、排期、审批或任何聚合门禁。本合同不实现模型、搜索、抓取、图片、自动改写、审批、导出、
发布或平台自动化。
