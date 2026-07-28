# M2 Issue 016 验收映射

状态：实现完成，100/100 已映射真实证据；最终门禁结果和唯一一个本地提交 SHA
以本轮验收报告为准。

|   # | 增量验收点                                            | 实际证据                                                                                 |
| --: | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
|   1 | 只实现 Issue 016                                      | `docs/m2-issue016-implementation-plan.md` 固定本轮目标和停止点；最终以 `git diff` 审计。 |
|   2 | 依赖能力由当前代码动态确认                            | 实施计划记录 Issue 015、SOURCE_SNAPSHOT、Queue 与 migration v8 的代码基线。              |
|   3 | SearchCandidate 四项冻结状态未改                      | `fetch-execution.test.ts` 成功后查询候选仍为四项冻结值。                                 |
|   4 | 未修改历史 migration                                  | `fetch-db.test.ts` 与既有 migration checksum 测试冻结 v1—v8，v9 只追加。                 |
|   5 | 未进入 Issue 017/018/019                              | `fetch-architecture.test.ts` 检查无后续实体写入或插件业务。                              |
|   6 | `packages/fetch` 不依赖 Electron renderer             | `fetch-architecture.test.ts` 检查依赖表和全部 Fetch 源码导入。                           |
|   7 | Search/Fetch/Evidence 分层有合同和架构测试            | ADR 0012、Controlled Fetch V1 合同与 `fetch-architecture.test.ts` 固定分层。             |
|   8 | Fetch 不写 sources/claims/books/clips                 | `fetch-db.test.ts` 对四张业务表执行前后计数比较。                                        |
|   9 | Fetch 输出固定 FETCHED_NOT_EVIDENCE                   | `contracts.ts`、migration v9 CHECK 与成功执行测试三层约束。                              |
|  10 | Fetch 输出 truth/fact 仍 UNVERIFIED/NOT_A_FACT        | `fetch-execution.test.ts` 同时验证文档输出和候选状态。                                   |
|  11 | ControlledFetch V1 全部显式版本化                     | `constants.ts` 定义合同、计划、profile 及各策略版本。                                    |
|  12 | 所有请求/计划/结果 exact-object 校验                  | `fetch-contracts.test.ts` 对 request/plan/job payload/result 注入额外字段。              |
|  13 | raw URL 不能绕过 candidate 输入                       | `FetchRequestV1` 无 URL；合同测试确认带 `url` 字段被拒绝。                               |
|  14 | candidate ID、URL hash 和 plan 精确绑定               | `createFetchPlanV1` 与 `validateFetchPlanForExecution` 绑定全部 identity。               |
|  15 | stale plan 在发送前阻断                               | `fetch-contracts.test.ts` 用 profile 漂移验证 `FETCH_PLAN_STALE`。                       |
|  16 | request/plan/profile 大小和深度有界                   | `contracts.ts` 对序列化大小、嵌套 exact object、字符串和数组设上限。                     |
|  17 | executionId 唯一且可重放                              | v9 UNIQUE 与 `fetch-execution.test.ts` 重放调用计数为零增量。                            |
|  18 | executionId 冲突 fail closed                          | repository identity 查询与冲突 request 测试返回 `FETCH_EXECUTION_CONFLICT`。             |
|  19 | 每 execution 最多一次页面 attempt                     | dispatch CHECK、handler 无 retry 及执行测试的 PAGE 调用计数固定。                        |
|  20 | after-send 未知进入 AMBIGUOUS                         | `recoverInterrupted` 测试把已 dispatch 未完成运行恢复为 AMBIGUOUS。                      |
|  21 | URL 仅接受 HTTP/HTTPS                                 | `fetch-network-policy.test.ts` 用 `file:` 恶意输入验证拒绝。                             |
|  22 | userinfo/control/invalid encoding/凭据型 query 被拒绝 | URL 恶意矩阵覆盖 userinfo、fragment、非法 percent 与 token query。                       |
|  23 | localhost/.local/single-label 被拒绝                  | host 测试覆盖 localhost、`.local` 与单标签 intranet。                                    |
|  24 | 非公网 IPv4 全部拒绝                                  | IP 表驱动测试覆盖 unspecified/private/shared/link-local/documentation/benchmark 等。     |
|  25 | 非公网 IPv6 与 IPv4-mapped 全部拒绝                   | IP 表驱动测试覆盖 loopback、ULA、link-local、multicast、documentation 和 mapped。        |
|  26 | 任一 DNS 答案非公网即 fail closed                     | mixed public/private resolver 测试返回 `FETCH_DNS_NON_PUBLIC`。                          |
|  27 | DNS 结果固定到 socket                                 | loopback transport 测试以目标 host + 注入 pinned address 完成请求。                      |
|  28 | remote address 与固定地址不符被拒绝                   | `assertPinnedRemoteAddress` 单元测试验证 mismatch 稳定错误。                             |
|  29 | redirect 每跳重新执行 SSRF 检查                       | `#fetchPage` 每个 next URL 都重新进入 `#reserveAndFetch`/DNS session。                   |
|  30 | 产品 composition 不包含 loopback 放宽                 | 架构测试验证 desktop strict runtime 没有 `allowNonPublicForTests`。                      |
|  31 | HTTPS 证书和主机名验证不可关闭                        | Node transport 固定 `rejectUnauthorized: true` 并使用原 hostname 作 SNI。                |
|  32 | proxy/PAC/Alt-Svc 不参与 Fetch                        | transport 使用 `agent:false` 和 pinned lookup；egress IPC 拒绝 proxy。                   |
|  33 | 页面请求只使用 GET                                    | transport 固定 `method: 'GET'`，没有 HEAD 分支。                                         |
|  34 | 不发送 Cookie/Auth/Referer/Origin                     | loopback server 断言四类 header 均不存在。                                               |
|  35 | User-Agent 固定诚实且不可配置                         | loopback 测试读取固定 `RednoteResearchFetcher/1.0` header。                              |
|  36 | 不读取或持久化 Set-Cookie                             | response DTO 不含 Set-Cookie，migration 与 repository 无 cookie 字段。                   |
|  37 | redirect 最多 3 跳                                    | profile validator、执行循环和 v9 hop CHECK 三层限制。                                    |
|  38 | HTTPS downgrade 被拒绝                                | redirect 单元测试返回 `FETCH_HTTPS_DOWNGRADE`。                                          |
|  39 | 跨 host redirect 被拒绝                               | 执行测试确认返回 REJECTED 且无第三次网络调用。                                           |
|  40 | redirect hop 只保存有限元数据                         | `RedirectHopV1` 与 `fetch_redirect_hops` 只含 status/host/hash/result。                  |
|  41 | robots 按 RFC 9309 有限子集解析                       | robots 测试覆盖 agent specificity、Allow/Disallow、通配符和最长匹配。                    |
|  42 | robots 只请求同 origin 固定路径                       | execution service 用 `new URL('/robots.txt', candidate.origin)`。                        |
|  43 | robots 401/403 明确禁止                               | `#robotsDecision` 将两类状态映射为 DISALLOWED。                                          |
|  44 | robots unknown fail closed                            | robots 测试确认 UNKNOWN 由 `assertRobotsDecisionAllows` 阻断。                           |
|  45 | robots 缓存绑定 origin/agent/version/expiry           | v9 复合主键与 repository lookup 同时校验四项绑定。                                       |
|  46 | robots 原文不落库                                     | robots cache 仅保存 body hash、有限 rules JSON 与时间。                                  |
|  47 | Crawl-delay 进入 rate policy                          | robots parser 产出毫秒值，执行服务将其传给 origin reservation。                          |
|  48 | 页面 401/403/407/429 不绕过                           | page status classifier 直接产生 access/rate 错误且没有 fallback。                        |
|  49 | challenge/paywall/login 命中后停止                    | HTML 流程以有限 challenge fixture 返回 `FETCH_CHALLENGE_DETECTED`。                      |
|  50 | 不切换代理、UA、IP 或 Provider                        | transport 与 execution service 均无替代 Provider/UA/proxy 分支。                         |
|  51 | rate state 跨重启持久                                 | `fetch-db.test.ts` 验证 request_count/next_allowed_at 落入 SQLite。                      |
|  52 | per-origin 并发默认 1                                 | profile 合同、validator 与 v9 in_flight CHECK 固定为 1。                                 |
|  53 | robots 和页面请求都计入限速                           | 成功执行 outcome 的 externalRequestCount 为 2。                                          |
|  54 | Retry-After 只更新状态不重试                          | DB 测试验证 next_allowed_at 更新，执行代码没有 retry 循环。                              |
|  55 | 网络期间不持有数据库长事务                            | reservation/dispatch/settlement 分属短事务，transport 在事务外 await。                   |
|  56 | 只接受 HTML/XHTML/plain text                          | MIME allowlist 和 parse content-type 测试固定三类。                                      |
|  57 | 缺失/冲突 MIME fail closed                            | network 测试覆盖 null 与重复 charset 参数。                                              |
|  58 | PDF/图片/附件/档案被拒绝                              | HTML MIME sniff fixture 拒绝 PDF；执行服务拒绝 attachment。                              |
|  59 | header 与 Content-Length 有界                         | loopback transport 测试覆盖 header count 与超大 Content-Length。                         |
|  60 | raw/decoded/ratio/total time 均有界                   | transport limiter 与压缩比 loopback 测试覆盖相应稳定错误。                               |
|  61 | chunked 超限及时取消                                  | 流式 raw/decoded Transform 在越界 chunk 当场中止 pipeline。                              |
|  62 | DOM nodes/depth 有界                                  | HTML 深层 fixture 返回 `FETCH_HTML_LIMIT`。                                              |
|  63 | sanitized HTML/text bytes 有界                        | 二次 validator 与 profile limits 在哈希前检查两种输出。                                  |
|  64 | charset allowlist 与优先级确定                        | decoder 合同固定 BOM/HTTP/meta 一致性和 charset allowlist。                              |
|  65 | UTF-8、中文、日文 fixture 正确                        | HTML 测试验证 UTF-8、GB18030 中文及 Shift_JIS 日文。                                     |
|  66 | 编码冲突或 fatal decode 不猜测                        | UTF-8 HTTP 与 GB18030 meta 冲突 fixture 返回 decode error。                              |
|  67 | HTML parser 永不执行脚本                              | ADR 0012 选择 parse5 纯 parser；恶意脚本 fixture 无执行环境。                            |
|  68 | active tags 全部删除                                  | sanitizer drop set 与 XSS fixture覆盖 script/iframe。                                    |
|  69 | event/style/resource/navigation attrs 全部删除        | 净化重建无属性树；测试断言 onclick/style/href 均不存在。                                 |
|  70 | 净化 HTML 不含远程加载能力                            | `validateSanitizedHtml` 拒绝 URL、resource attrs 和 active tags。                        |
|  71 | 序列化确定且 UTF-8                                    | 同一 fixture 两次处理结果、哈希和 bytes 完全相等。                                       |
|  72 | 正文抽取不调用模型                                    | `packages/fetch` 依赖中没有 providers/workflows/model 客户端。                           |
|  73 | 导航/广告/评论/登录区被排除                           | HTML fixture 验证 nav 与 comments 不进入 extractedText。                                 |
|  74 | 抽取不足不以整页 DOM 兜底                             | 无 main/article fixture 返回 extraction/privacy 状态。                                   |
|  75 | 不生成摘要、翻译或事实                                | extractor 只做结构文本渲染；合同固定 UNVERIFIED/NOT_A_FACT。                             |
|  76 | 二次 validator 拒绝残留 active content                | 直接传入带远程 img 的 sanitized HTML 被拒绝。                                            |
|  77 | 不保存完整 DOM/header/cookie/form                     | document DTO/schema/存储 adapter 只接收净化 HTML 与文本。                                |
|  78 | 联系方式型个人信息按版本化规则替换                    | fixture 将邮箱和电话替换为固定中文占位符。                                               |
|  79 | redaction 只保存计数                                  | outcome、job result 和 v9 仅保存三类整数计数。                                           |
|  80 | UGC/正文边界不明进入 privacy review                   | comments-only fixture 返回 `FETCH_PRIVACY_REVIEW_REQUIRED`。                             |
|  81 | 原始 response body 不持久化                           | `FetchedDocumentV1` 只含 raw hash；snapshot store 未接收 raw body。                      |
|  82 | 只保存净化 HTML 和纯文本                              | 成功执行测试的 snapshot write 数精确为 2。                                               |
|  83 | 两个文件均为受控 ManagedRelativePath                  | validator 要求两条路径属于 `SOURCE_SNAPSHOT`。                                           |
|  84 | 最终规范 URL 与 raw/sanitized/text/document hash 准确 | execution service 逐项比对文件 SHA/bytes 后才结算。                                      |
|  85 | 相同内容与处理版本复用 FetchedDocument                | 两 execution 相同内容测试查询 document 数为 1。                                          |
|  86 | 多 FetchRun provenance 独立保留                       | 同一去重测试查询 run 数为 2。                                                            |
|  87 | DB 失败只留下可检测 orphan                            | ADR 0012 与执行顺序固定文件先发布、短事务后关联且不删共享文件。                          |
|  88 | 不写 sources.local_snapshot_path                      | 架构测试扫描 repository 无 sources 写语句。                                              |
|  89 | migration v9 只增加 Fetch 语义                        | migration 名称、版本及六表清单由 `fetch-db.test.ts` 验证。                               |
|  90 | Fetch 表均 STRICT 且约束/索引完整                     | DB 测试读取 `pragma_table_list` 和 fetch indexes。                                       |
|  91 | v8→v9 数据保留、备份和回滚通过                        | DB 升级测试确认 backup 非空并保留候选四项。                                              |
|  92 | `FETCH_PUBLIC_PAGE_V1` payload/result 有界            | job payload/result exact validator 测试拒绝正文额外字段。                                |
|  93 | Job replay 不产生第二次请求或文档                     | execution 重放测试验证 transport/writes 数不增加。                                       |
|  94 | cancel before/after-send 语义正确                     | execution 测试分别得到 BEFORE_SEND 与 AFTER_SEND 终态。                                  |
|  95 | crash 只恢复可证明 pre-send                           | recovery 测试分别产生 RECOVERABLE_PRE_SEND 与 AMBIGUOUS。                                |
|  96 | 本轮没有自动入队来源                                  | handler registry 测试只证明显式注册；egress 扫描无 producer。                            |
|  97 | UI/IPC 只暴露有限状态和 policy                        | renderer 测试验证无 URL textbox/执行按钮且 DTO exact。                                   |
|  98 | `test:fetch` 独立并纳入全量/Windows CI                | `package.json` 与 `.github/workflows/ci.yml` 均包含专项命令。                            |
|  99 | Fetch egress、smoke、恶意 fixture 全部通过            | `fetch-egress`、network/html 恶意矩阵及既有 Electron smoke 为门禁证据。                  |
| 100 | 创建唯一一个本地提交并停止                            | 本轮只执行一次本地提交；SHA 由最终报告给出，不 push、不创建 PR、不进入 Issue 017。       |
