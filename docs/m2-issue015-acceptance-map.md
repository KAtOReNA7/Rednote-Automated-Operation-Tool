# M2 Issue 015 验收映射

状态：通过，120/120。证据均指向实际代码、测试、文档或最终交付核验。

|   # | 增量验收点                                           | 实际证据                                                                         |
| --: | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
|   1 | 只实现 Issue 015                                     | `git diff` 范围审计；`tests/search-architecture.test.ts`                         |
|   2 | 未抓取任何结果 URL                                   | `tests/search-egress.test.ts` 的 loopback 请求计数为 1，仅请求 provider endpoint |
|   3 | 未实现 HTML/PDF/正文抽取                             | `tests/search-architecture.test.ts` 禁止 fetch/parser 实体                       |
|   4 | 未实现插件或 Local API 业务 route                    | `tests/search-architecture.test.ts`、既有 `test:local-api`                       |
|   5 | 未实现书目发现、事实或研究业务                       | `tests/search-architecture.test.ts` 禁止对应实体和 route                         |
|   6 | SearchCandidate 固定 LEAD_ONLY                       | `tests/search-contracts.test.ts`、`tests/search-db.test.ts`                      |
|   7 | fetchState 固定 NOT_FETCHED                          | `tests/search-contracts.test.ts`、migration v8 CHECK                             |
|   8 | truthStatus 固定 UNVERIFIED                          | `tests/search-contracts.test.ts`、migration v8 CHECK                             |
|   9 | factStatus 固定 NOT_A_FACT                           | `tests/search-contracts.test.ts`、migration v8 CHECK                             |
|  10 | 未写 sources/claims/clips/books                      | migration v8 仅四张 search 表；`tests/search-db.test.ts`                         |
|  11 | SearchProvider V1 版本化且严格校验                   | `packages/search/src/contracts.ts`；`tests/search-contracts.test.ts`             |
|  12 | 五种 ProviderKind 有限                               | `packages/search/src/constants.ts` 的五值冻结测试                                |
|  13 | Mode/Readiness 有限且派生真实                        | `tests/search-contracts.test.ts` 的 registry/readiness 测试                      |
|  14 | SearchIntent 有限                                    | `tests/search-contracts.test.ts` 的 exact enum validator                         |
|  15 | query/maxResults/locale/domain/cursor 有界           | `tests/search-contracts.test.ts` 的长度/字节/深度边界                            |
|  16 | query 不能控制 endpoint/header/tool/budget           | exact-object validator 与 `tests/search-contracts.test.ts` 恶意字段测试          |
|  17 | Descriptor 逐项声明 features                         | `assertSearchProviderDescriptorV1` 与 descriptor 测试                            |
|  18 | unsupported feature fail closed                      | `tests/search-contracts.test.ts` 的 planner fail-closed 测试                     |
|  19 | hard filter 与 query hint 分开                       | request feature matrix 与 domain application 测试                                |
|  20 | NOT_CONFIGURED 不伪装 READY                          | `tests/search-adapters.test.ts` 的 Search API readiness                          |
|  21 | Candidate provenance 完整                            | `tests/search-url-candidates.test.ts` 的 appearances 测试                        |
|  22 | URL/title/preview 字段有界                           | `assertSearchCandidateV1` 的边界与 UTF-8 测试                                    |
|  23 | consulted 与 cited 分开                              | `tests/search-adapters.test.ts` 的 source/citation fixture                       |
|  24 | upstream metadata 标未验证                           | candidate source metadata 固定 `UNVERIFIED` 测试                                 |
|  25 | userSupplied 明确                                    | Manual/Curated adapter provenance 测试                                           |
|  26 | Batch counts 自洽                                    | `assertSearchBatchV1` 的状态、计数和候选一致性测试                               |
|  27 | externalRequestCount 准确                            | 五类 adapter 与 execution 测试逐一断言                                           |
|  28 | EMPTY 与 FAILED 分开                                 | batch validator 拒绝状态/计数矛盾                                                |
|  29 | PARTIAL 只用于确定完整响应中的无效 item              | Search API codec 的逐 item decode 测试                                           |
|  30 | raw/model narrative 不进入 Candidate                 | `tests/search-adapters.test.ts` 忽略 narrative；仓储 egress 断言                 |
|  31 | 只接受 HTTP/HTTPS                                    | `tests/search-url-candidates.test.ts`                                            |
|  32 | 非法 scheme/userinfo/control/path 被拒绝             | 恶意 scheme、userinfo、控制字符、Windows/UNC 路径测试                            |
|  33 | IDNA/默认端口/fragment/dot segment 正确              | WHATWG/IDNA canonicalization 表驱动测试                                          |
|  34 | path/query 语义保持                                  | encoded path 与 query 保真测试                                                   |
|  35 | 不删除 tracking、不排序 query                        | tracking 参数与 query 顺序回归测试                                               |
|  36 | 不自动 HTTP→HTTPS                                    | scheme 保持测试                                                                  |
|  37 | 不访问 result/canonical link                         | `tests/search-egress.test.ts` 仅记录 provider endpoint                           |
|  38 | canonical URL 去重且保留 provenance                  | `tests/search-url-candidates.test.ts`                                            |
|  39 | label-boundary domain 正确                           | IDNA、尾点、子域和混淆域名测试                                                   |
|  40 | hard domain filter 必须由协议证明                    | descriptor feature 与 planner 应用测试                                           |
|  41 | 精确 capability SUPPORTED 且非 stale 才执行          | Model adapter capability/binding guard 测试                                      |
|  42 | 固定 prompt 且 query 作为数据                        | `tests/search-adapters.test.ts` 检查固定 instruction 和独立 input                |
|  43 | 只允许 Web Search tool                               | Model request exact-object/tool allowlist 测试                                   |
|  44 | 必须搜索时 tool choice required/specific             | Model adapter tool-choice 测试                                                   |
|  45 | completed structured event 必需                      | 缺失/incomplete event fail-closed 测试                                           |
|  46 | source list/citation 分开解析                        | structured fixture 的 consulted/cited 独立断言                                   |
|  47 | 模型正文 URL 被忽略                                  | narrative 内诱导 URL 不进入候选测试                                              |
|  48 | 不启用 unlimited/deep/background                     | Model request 有限字段断言                                                       |
|  49 | 每 Run 最多一个 model execution                      | adapter 调用计数严格等于 1                                                       |
|  50 | BYPASS/NONESSENTIAL/accounting 正确                  | `tests/search-adapters.test.ts` 的 Issue 014 port 参数/usage 审计                |
|  51 | codec/encoder/decoder/transport 接口存在             | `packages/search/src/search-api.ts` 合同与 codec 测试                            |
|  52 | Scripted/loopback codec 完整                         | `tests/search-adapters.test.ts`、`tests/search-egress.test.ts`                   |
|  53 | 产品无生产 codec 且不伪装 READY                      | `apps/desktop/src/search-runtime.ts` 与架构测试                                  |
|  54 | 无真实 Search API credential slot                    | shared DTO、IPC、renderer 与架构扫描                                             |
|  55 | 无任意 HTTP/JSON/script 配置                         | exact IPC DTO 和 `tests/search-architecture.test.ts`                             |
|  56 | 生产 HTTPS、loopback 仅测试                          | transport 拒绝生产 HTTP；codec 品牌仅允许 `127.0.0.1`                            |
|  57 | headers/timeouts/raw/decompressed size 有界          | `tests/search-egress.test.ts` 的 header/body/timeout/压缩边界                    |
|  58 | redirects 默认 0                                     | 默认重定向拒绝测试                                                               |
|  59 | cross-origin/downgrade/MIME/schema 被拒绝            | `tests/search-egress.test.ts` 的恶意 transport 测试                              |
|  60 | Transport 不连接 result URL                          | loopback 记录的连接目标仅为 provider endpoint                                    |
|  61 | Curated 纯本地且不读 RSS/HTML                        | `tests/search-adapters.test.ts` 外部请求数为 0                                   |
|  62 | Curated template host/path 固定                      | host/path/placeholder 恶意模板拒绝测试                                           |
|  63 | Curated 仍 LEAD_ONLY                                 | Curated 输出四冻结状态断言                                                       |
|  64 | BrowserClip 合同/fixture 存在                        | `packages/search/src/local-adapters.ts`、fixture validator                       |
|  65 | BrowserClip runtime 保持 pending                     | desktop registry readiness 为 `PENDING_LATER_ISSUE`                              |
|  66 | 未保存 selectedText/metrics/screenshot               | fixture exact validator 与 migration/仓储列审计                                  |
|  67 | ManualUrl 可用                                       | Manual adapter 有效 URL 测试                                                     |
|  68 | ManualUrl 不访问网络/模型                            | Manual adapter 请求计数为 0                                                      |
|  69 | Local adapters externalRequestCount=0                | Manual、Curated、BrowserClip batch 断言                                          |
|  70 | Local adapters 不写 model ledger                     | execution/accounting port 调用计数为 0                                           |
|  71 | providerInstanceId 唯一                              | `SearchProviderRegistry.register` 重复值拒绝测试                                 |
|  72 | renderer 不能注册动态 adapter                        | `tests/search-architecture.test.ts` renderer import/接口扫描                     |
|  73 | 总体 active/passive/degraded 正确                    | registry aggregate readiness 测试                                                |
|  74 | passive/interface-only 不证明 active ready           | Search API/BrowserClip 产品 readiness 测试                                       |
|  75 | SearchPlan 绑定 request/settings/capability          | semantic hash 与 plan binding 测试                                               |
|  76 | stale plan 外部请求 0                                | `tests/search-execution.test.ts` 的 pre-dispatch binding 校验                    |
|  77 | fallback 固定 NONE                                   | plan validator 与 descriptor 测试                                                |
|  78 | empty/429/5xx/ambiguous 不 fallback                  | 单 provider、单 attempt 与错误映射测试                                           |
|  79 | rate policy 缺失不 READY                             | planner/readiness 的 rate guard 测试                                             |
|  80 | rate state 跨重启持久                                | `tests/search-db.test.ts` 关闭并重开 SQLite                                      |
|  81 | 多 worker 原子限速                                   | `BEGIN IMMEDIATE` 并发 reservation 测试                                          |
|  82 | Retry-After 只更新 nextAllowedAt                     | 429 settlement/reopen 测试                                                       |
|  83 | 每次远程 execution 最多一次 attempt                  | Search API/Model/execution 调用计数测试                                          |
|  84 | after-send 不自动 retry                              | partial socket 映射与 `AMBIGUOUS` 测试                                           |
|  85 | network call 不持长事务                              | reservation 后独立调用及并发 SQLite 测试                                         |
|  86 | SEARCH_EXECUTE_V1 payload/result 有界                | `tests/search-execution.test.ts` 的 job validator                                |
|  87 | Job result 不重复 candidates                         | handler 结果只含 run/status/counts/stable error                                  |
|  88 | executionId 唯一幂等                                 | repository UNIQUE 与 service replay 测试                                         |
|  89 | replay 不产生第二请求                                | queue replay 调用计数保持 1                                                      |
|  90 | executionId/request 冲突 fail closed                 | request/plan hash conflict 测试                                                  |
|  91 | pre-send 可安全恢复                                  | `recoverInterruptedRuns` 的 `RECOVERABLE_PRE_SEND` 测试                          |
|  92 | post-send 未知标 AMBIGUOUS                           | `MAY_HAVE_EXECUTED` 恢复测试                                                     |
|  93 | AMBIGUOUS 不自动恢复                                 | terminal replay 不再 dispatch 测试                                               |
|  94 | 不自动 enqueue 搜索任务                              | composition/源码架构测试                                                         |
|  95 | SearchRun 状态机/revision 完整                       | `tests/search-db.test.ts` 的状态迁移和 revision 断言                             |
|  96 | migration v8 只增加 search config/rate/run/candidate | schema 表集合与 SQL 快照测试                                                     |
|  97 | v7→v8 数据保留和失败回滚通过                         | 既有 migration 备份/回滚套件与 v8 升级测试                                       |
|  98 | 四个候选冻结状态有 DB CHECK                          | invalid INSERT 四项逐一失败                                                      |
|  99 | provider/status/time/URL hash 索引有效               | `EXPLAIN QUERY PLAN` 索引命中测试                                                |
| 100 | 未新增 v9                                            | `MIGRATIONS` 版本列表严格为 1—8                                                  |
| 101 | ModelWebSearch 复用 Issue 014 预算和账本             | Model execution port 与 reservation/usage 参数集成测试                           |
| 102 | SearchProvider 不重复记账                            | Search 层无 ledger 写端口；调用次数测试                                          |
| 103 | 未知成本保持 UNKNOWN/NULL                            | structured usage/accounting 边界测试                                             |
| 104 | SearchApi accounting 未完成前不 READY                | accounting readiness guard 测试                                                  |
| 105 | 设置页真实显示五类 readiness                         | `tests/search-renderer.test.tsx`                                                 |
| 106 | UI 明确 Issue 016/017 边界                           | renderer 文案断言                                                                |
| 107 | UI 无搜索执行、抓取、key、raw JSON、fallback 按钮    | renderer/architecture 负向断言                                                   |
| 108 | 任务中心不显示 query/preview/完整 URL/secret         | DTO exact validator 与 renderer egress 测试                                      |
| 109 | IPC 只增加有限状态/配置方法                          | desktop contract、preload 与 IPC allowlist 测试                                  |
| 110 | 70 项 egress 全部通过                                | `docs/m2-issue015-egress-matrix.md`、`tests/search-egress.test.ts`               |
| 111 | test:search 独立通过并纳入全量/CI                    | `npm run test:search` 8 文件/48 测试；Windows CI step                            |
| 112 | structured source/citation fixture 完整              | `tests/search-fixtures.ts`、model adapter fixture 测试                           |
| 113 | malicious URL/domain/content fixture 完整            | URL/domain/script/formula hostile fixture 测试                                   |
| 114 | rate/concurrency/restart fixture 完整                | `tests/search-db.test.ts` 的持久化/并发 fixture                                  |
| 115 | job replay/crash/ambiguous fixture 完整              | `tests/search-execution.test.ts`、`tests/search-db.test.ts`                      |
| 116 | migration/accounting/UI/IPC fixture 完整             | search-db/adapters/renderer/architecture 四层测试                                |
| 117 | source/packaged smoke 通过                           | `npm run test:electron-smoke`、`npm run test:packaged-smoke`                     |
| 118 | 真实搜索、页面连接和费用为 0                         | smoke `externalConnections: 0`；仅 scripted/loopback/合成值                      |
| 119 | 未进入 Issue 016/017/018                             | 最终 `git diff --name-status` 范围审计                                           |
| 120 | 创建一个本地提交并停止                               | 唯一提交消息固定；最终 `git show`/工作树/远端 SHA 核验                           |
