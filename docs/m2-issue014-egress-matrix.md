# M2 Issue 014：60 项外发与账本泄露矩阵

状态：已实现。以下每项均由结构约束、严格 DTO/IPC、专用测试或最终命令共同证明。
“禁止”表示该数据不得进入目标；“摘要”表示只允许文档所列有限、非敏感字段。

|   # | 目标 / 场景                  | 允许内容                         | 禁止内容                       | 证据                      |
| --: | ---------------------------- | -------------------------------- | ------------------------------ | ------------------------- |
|   1 | SQLite `model_runs`          | 身份 hash、状态、usage、可空金额 | prompt/input/output/credential | migration、DB tests       |
|   2 | SQLite `cost_ledger`         | 追加式 settlement 摘要           | secret、payload、伪造 0        | migration、DB tests       |
|   3 | SQLite `model_cache_entries` | 受控相对路径、hash、大小         | 绝对路径、payload              | migration、storage tests  |
|   4 | SQLite price schedules       | 十进制字符串、版本               | 自动抓价、浮点金额             | money/DB tests            |
|   5 | SQLite unit policies         | 有限整数、版本                   | essential 绕过                 | DB/contract tests         |
|   6 | SQLite reservations          | 单位摘要、可空 micro-USD         | credential、response           | repository tests          |
|   7 | SQLite WAL                   | 与受控表相同                     | secret/prompt/payload          | architecture、smoke       |
|   8 | SQLite SHM                   | SQLite 协调数据                  | secret/prompt/payload          | architecture、smoke       |
|   9 | migration backup             | 本地数据库副本                   | 外部上传                       | migration tests           |
|  10 | migration error              | 稳定错误、版本                   | SQL 参数中的业务内容           | migration runner          |
|  11 | 缓存文件名                   | 内容 hash                        | 用户标题/模型输出              | storage tests             |
|  12 | 缓存 envelope                | provider-neutral 完整输出        | raw provider envelope          | service/storage tests     |
|  13 | 缓存目录                     | 受控 cache 文件                  | 外部任意文件                   | managed-path tests        |
|  14 | 缓存临时文件                 | 原子写入中的 envelope            | secret                         | LocalFileRepository tests |
|  15 | 缓存损坏错误                 | 稳定错误码                       | 文件内容、绝对路径             | storage/service tests     |
|  16 | 缓存清理预览                 | count、bytes、类型、短 token     | 路径、内容                     | IPC/runtime tests         |
|  17 | 缓存清理确认                 | 删除数量摘要                     | 路径、内容                     | runtime/IPC tests         |
|  18 | 缓存 GC                      | tombstone/精确受控文件           | 目录外文件                     | storage contract          |
|  19 | structured log               | 稳定事件元数据                   | prompt/input/output            | logging tests             |
|  20 | Electron console             | 门禁/烟测摘要                    | credential/cache payload       | smoke tests               |
|  21 | IPC get accounting           | 汇总、最近运行摘要               | prompt/input/output/path       | DTO/type tests            |
|  22 | IPC price create             | 有限十进制字段                   | header/endpoint/secret         | strict IPC tests          |
|  23 | IPC unit policy create       | 有限整数与 scope                 | 任意对象/extra key             | strict IPC tests          |
|  24 | IPC cache preview            | 数量摘要                         | managed path                   | strict IPC tests          |
|  25 | IPC cache confirm            | token、预期数量                  | 任意删除路径                   | strict IPC tests          |
|  26 | IPC error                    | 稳定 code/message                | SQL、path、payload             | IPC runtime               |
|  27 | preload bridge               | 五个窄方法                       | Node/DB/FS handle              | preload/architecture      |
|  28 | renderer state               | accounting DTO                   | credential、raw response       | renderer tests            |
|  29 | 任务中心表格                 | run/cost/cache 摘要              | prompt/output                  | UI tests                  |
|  30 | UI 未知金额                  | “未知”                           | `$0`                           | renderer contract         |
|  31 | UI 本地缓存                  | hit/count/bytes                  | payload/path                   | renderer contract         |
|  32 | UI Provider cache            | cached-input 标签                | local-hit 混算                 | accounting tests          |
|  33 | UI price form                | ASCII decimal string             | Number 美元决策                | IPC/money tests           |
|  34 | UI clear flow                | 两阶段数量确认                   | 单击直接删除                   | renderer/IPC              |
|  35 | 诊断 preview                 | schema/health 摘要               | ledger 行、payload             | diagnostics tests         |
|  36 | 诊断 export                  | 脱敏运行状态                     | credential/prompt/output       | diagnostics tests         |
|  37 | 普通业务 export              | 既有受控内容                     | cache payload/ledger           | architecture              |
|  38 | audit event                  | 既有业务审计                     | credential/cache payload       | hard constraints          |
|  39 | crash/error stack            | 受控内部错误                     | credential/prompt/response     | error sanitizer           |
|  40 | source Electron smoke        | 测试计数/状态                    | 合成 credential 值             | smoke scan                |
|  41 | packaged smoke               | 测试计数/状态                    | 合成 credential 值             | packaged scan             |
|  42 | test snapshot                | 有限 DTO/结构                    | 真实 credential/payload        | test fixtures             |
|  43 | Vitest stdout                | 测试名称/计数                    | secret/prompt/output           | final gate                |
|  44 | CI stdout                    | 命令/计数                        | secret/cache payload           | CI workflow               |
|  45 | npm audit output             | 依赖漏洞摘要                     | 应用数据                       | audit gate                |
|  46 | build artifacts              | 编译代码/静态 UI                 | temp DB/cache                  | build inspection          |
|  47 | packaged app                 | 运行代码/资源                    | 测试 ProjectDataRoot           | package smoke             |
|  48 | Git source                   | 合同、代码、合成 fixture         | credential/DB/cache            | secret scan               |
|  49 | Git diff                     | Issue 014 范围                   | temp/log/package output        | final diff                |
|  50 | root instruction             | 授权文本                         | 运行时数据                     | tracked input             |
|  51 | npm cache                    | 第三方包                         | ProjectDataRoot 数据           | portable scripts          |
|  52 | repository temp              | 精确本轮临时文件                 | 正式项目数据                   | portability tests         |
|  53 | OS temp                      | 无（项目卷重定向）               | DB/cache/credential            | CI/portable runner        |
|  54 | local API                    | 既有 allowlist 资源              | accounting 新端点/payload      | local API tests           |
|  55 | capability probe request     | 固定安全 probe payload           | cache payload/ledger           | probe contracts           |
|  56 | capability probe history     | 三态证据摘要                     | credential/raw response        | capability tests          |
|  57 | Provider transport metadata  | allowlisted request              | ledger/cache/UI 状态           | provider egress tests     |
|  58 | 外部网络                     | 仅用户确认 probe（生产）         | 启动/迁移/缓存自动请求         | smoke/architecture        |
|  59 | 本轮测试网络                 | 仅 `127.0.0.1` loopback          | 真实 API/model/search/image    | test gates                |
|  60 | 最终报告                     | commit/checksum/门禁计数         | secret、绝对业务路径、payload  | final audit               |

结论：60/60 项均不允许真实凭据、prompt、输入、输出、原始 Provider 响应或缓存 payload
进入非缓存目标；缓存 payload 只存在于受控 ProjectDataRoot 文件中。
