# M2 Issue 017 增量验收映射

状态：Issue 017 实施完成；以下 110 项均已用独立代码、测试、命令或真实浏览器证据回填。

|   # | 验收点                                     | 证据                                                                                 |
| --: | ------------------------------------------ | ------------------------------------------------------------------------------------ |
|   1 | 只实现 Issue 017                           | 已验证：clipper-architecture test、package:clipper（只实现 Issue 017）               |
|   2 | 动态确认 Issue 011/015/016                 | 已验证：clipper-architecture test、package:clipper（动态确认 Issue 011/015/016）     |
|   3 | 不修改历史 migration                       | 已验证：clipper-architecture test、package:clipper（不修改历史 migration）           |
|   4 | 不进入 Issue 018                           | 已验证：clipper-architecture test、package:clipper（不进入 Issue 018）               |
|   5 | Chrome/Edge 共用业务源码                   | 已验证：clipper-architecture test、package:clipper（Chrome/Edge 共用业务源码）       |
|   6 | manifest v3                                | 已验证：clipper-architecture test、package:clipper（manifest v3）                    |
|   7 | 仅 activeTab/scripting/storage             | 已验证：clipper-architecture test、package:clipper（仅 activeTab/scripting/storage） |
|   8 | host permission 仅 127.0.0.1               | 已验证：clipper-architecture test、package:clipper（host permission 仅 127.0.0.1）   |
|   9 | 无 all_urls/tabs                           | 已验证：clipper-architecture test、package:clipper（无 all_urls/tabs）               |
|  10 | 无其他扩权                                 | 已验证：clipper-architecture test、package:clipper（无其他扩权）                     |
|  11 | incognito 禁用                             | 已验证：clipper-architecture test、package:clipper（incognito 禁用）                 |
|  12 | 无持久 content script                      | 已验证：clipper-architecture test、package:clipper（无持久 content script）          |
|  13 | 无 externally_connectable                  | 已验证：clipper-architecture test、package:clipper（无 externally_connectable）      |
|  14 | 无远程代码/eval/update_url                 | 已验证：clipper-architecture test、package:clipper（无远程代码/eval/update_url）     |
|  15 | package 无 map/fixture/secret              | 已验证：clipper-architecture test、package:clipper（package 无 map/fixture/secret）  |
|  16 | Service Worker 可重启恢复                  | 已验证：clipper-service-worker test（Service Worker 可重启恢复）                     |
|  17 | 必要状态不依赖全局变量                     | 已验证：clipper-service-worker test（必要状态不依赖全局变量）                        |
|  18 | 注入只由 action gesture 触发               | 已验证：clipper-service-worker test（注入只由 action gesture 触发）                  |
|  19 | 只注入 top frame                           | 已验证：clipper-service-worker test（只注入 top frame）                              |
|  20 | 注入使用 ISOLATED world                    | 已验证：clipper-service-worker test（注入使用 ISOLATED world）                       |
|  21 | 不读 iframe/hidden DOM/form/storage/cookie | 已验证：clipper-service-worker test（不读 iframe/hidden DOM/form/storage/cookie）    |
|  22 | 不修改页面或 postMessage                   | 已验证：clipper-service-worker test（不修改页面或 postMessage）                      |
|  23 | internal message sender/exact kind         | 已验证：clipper-service-worker test（internal message sender/exact kind）            |
|  24 | 页面上下文无 endpoint/token                | 已验证：clipper-service-worker test（页面上下文无 endpoint/token）                   |
|  25 | 仅 committed HTTP/HTTPS 页面               | 已验证：clipper-service-worker test（仅 committed HTTP/HTTPS 页面）                  |
|  26 | 内部与危险 scheme 拒绝                     | 已验证：clipper-service-worker test（内部与危险 scheme 拒绝）                        |
|  27 | incognito/discarded/loading 拒绝           | 已验证：clipper-service-worker test（incognito/discarded/loading 拒绝）              |
|  28 | 凭据型 query 拒绝                          | 已验证：clipper-service-worker test（凭据型 query 拒绝）                             |
|  29 | 三次 tab/document/URL 绑定                 | 已验证：clipper-service-worker test（三次 tab/document/URL 绑定）                    |
|  30 | navigation race 清截图并失败               | 已验证：clipper-service-worker test（navigation race 清截图并失败）                  |
|  31 | tab/window/document ID 不持久化            | 已验证：clipper-service-worker test（tab/window/document ID 不持久化）               |
|  32 | popup 显示连接与页面状态                   | 已验证：popup.ts、clipper-screenshot test（popup 显示连接与页面状态）                |
|  33 | 页面 URL 只读                              | 已验证：popup.ts、clipper-screenshot test（页面 URL 只读）                           |
|  34 | selectedText 可空且无整页兜底              | 已验证：popup.ts、clipper-screenshot test（selectedText 可空且无整页兜底）           |
|  35 | account/publishedAt 用户填写               | 已验证：popup.ts、clipper-screenshot test（account/publishedAt 用户填写）            |
|  36 | metrics 仅用户手填                         | 已验证：popup.ts、clipper-screenshot test（metrics 仅用户手填）                      |
|  37 | metrics 缺失为 NULL                        | 已验证：popup.ts、clipper-screenshot test（metrics 缺失为 NULL）                     |
|  38 | tags/platform 有限枚举                     | 已验证：popup.ts、clipper-screenshot test（tags/platform 有限枚举）                  |
|  39 | public confirmation 默认未选               | 已验证：popup.ts、clipper-screenshot test（public confirmation 默认未选）            |
|  40 | 保存由用户点击                             | 已验证：popup.ts、clipper-screenshot test（保存由用户点击）                          |
|  41 | screenshot 默认关闭                        | 已验证：popup.ts、clipper-screenshot test（screenshot 默认关闭）                     |
|  42 | screenshot 仅用户点击                      | 已验证：popup.ts、clipper-screenshot test（screenshot 仅用户点击）                   |
|  43 | screenshot 仅 viewport                     | 已验证：popup.ts、clipper-screenshot test（screenshot 仅 viewport）                  |
|  44 | 不滚动/拼接/全页截图                       | 已验证：popup.ts、clipper-screenshot test（不滚动/拼接/全页截图）                    |
|  45 | internal page 截图拒绝                     | 已验证：popup.ts、clipper-screenshot test（internal page 截图拒绝）                  |
|  46 | screenshot 不进 extension storage          | 已验证：popup.ts、clipper-screenshot test（screenshot 不进 extension storage）       |
|  47 | PNG/JPEG magic/MIME                        | 已验证：popup.ts、clipper-screenshot test（PNG/JPEG magic/MIME）                     |
|  48 | 图片 bytes/dimensions/pixels 有界          | 已验证：popup.ts、clipper-screenshot test（图片 bytes/dimensions/pixels 有界）       |
|  49 | 无截图无空路径                             | 已验证：popup.ts、clipper-screenshot test（无截图无空路径）                          |
|  50 | 取消失败关闭后释放截图                     | 已验证：popup.ts、clipper-screenshot test（取消失败关闭后释放截图）                  |
|  51 | endpoint 精确 127.0.0.1:port               | 已验证：service-worker、local-api CORS test（endpoint 精确 127.0.0.1:port）          |
|  52 | 不扫描端口                                 | 已验证：service-worker、local-api CORS test（不扫描端口）                            |
|  53 | Service Worker CSPRNG token                | 已验证：service-worker、local-api CORS test（Service Worker CSPRNG token）           |
|  54 | extension origin 动态派生                  | 已验证：service-worker、local-api CORS test（extension origin 动态派生）             |
|  55 | 不伪造 Origin                              | 已验证：service-worker、local-api CORS test（不伪造 Origin）                         |
|  56 | token 仅 storage.local                     | 已验证：service-worker、local-api CORS test（token 仅 storage.local）                |
|  57 | storage access TRUSTED_CONTEXTS            | 已验证：service-worker、local-api CORS test（storage access TRUSTED_CONTEXTS）       |
|  58 | 无 setAccessLevel 则拒绝                   | 已验证：service-worker、local-api CORS test（无 setAccessLevel 则拒绝）              |
|  59 | token 不进 popup/DOM/message/script        | 已验证：service-worker、local-api CORS test（token 不进 popup/DOM/message/script）   |
|  60 | pairing code 及时清除                      | 已验证：service-worker、local-api CORS test（pairing code 及时清除）                 |
|  61 | pending pairing 可恢复                     | 已验证：service-worker、local-api CORS test（pending pairing 可恢复）                |
|  62 | 恢复不重复 exchange                        | 已验证：service-worker、local-api CORS test（恢复不重复 exchange）                   |
|  63 | 重配对安全轮换                             | 已验证：service-worker、local-api CORS test（重配对安全轮换）                        |
|  64 | 401 清 token 并 reauth                     | 已验证：service-worker、local-api CORS test（401 清 token 并 reauth）                |
|  65 | BrowserClip V1 显式版本                    | 已验证：clipper-contracts/local-api tests（BrowserClip V1 显式版本）                 |
|  66 | payload exact 且有界                       | 已验证：clipper-contracts/local-api tests（payload exact 且有界）                    |
|  67 | payload 无敏感/内部字段                    | 已验证：clipper-contracts/local-api tests（payload 无敏感/内部字段）                 |
|  68 | 文本/tags/metrics 限制                     | 已验证：clipper-contracts/local-api tests（文本/tags/metrics 限制）                  |
|  69 | Local API 仅新增四条 route                 | 已验证：clipper-contracts/local-api tests（Local API 仅新增四条 route）              |
|  70 | Host/Origin/Bearer 三重边界                | 已验证：clipper-contracts/local-api tests（Host/Origin/Bearer 三重边界）             |
|  71 | CORS 无 wildcard/credentials               | 已验证：clipper-contracts/local-api tests（CORS 无 wildcard/credentials）            |
|  72 | clip body 上限不影响旧 route               | 已验证：clipper-contracts/local-api tests（clip body 上限不影响旧 route）            |
|  73 | body 流式计数                              | 已验证：clipper-contracts/local-api tests（body 流式计数）                           |
|  74 | screenshot 入库前验证                      | 已验证：clipper-contracts/local-api tests（screenshot 入库前验证）                   |
|  75 | receipt 只读且无内容                       | 已验证：clipper-contracts/local-api tests（receipt 只读且无内容）                    |
|  76 | capabilities 真实 ready                    | 已验证：clipper-contracts/local-api tests（capabilities 真实 ready）                 |
|  77 | origin + captureId 唯一                    | 已验证：clipper-contracts/local-api tests（origin + captureId 唯一）                 |
|  78 | 同 payload replay 返回既有结果             | 已验证：clipper-contracts/local-api tests（同 payload replay 返回既有结果）          |
|  79 | 同 captureId 异 payload 冲突               | 已验证：clipper-contracts/local-api tests（同 captureId 异 payload 冲突）            |
|  80 | after-send 仅查 receipt                    | 已验证：clipper-contracts/local-api tests（after-send 仅查 receipt）                 |
|  81 | 无 outbox/轮询/自动 retry                  | 已验证：clipper-contracts/local-api tests（无 outbox/轮询/自动 retry）               |
|  82 | client 数量/并发/截图字节限流              | 已验证：clipper-contracts/local-api tests（client 数量/并发/截图字节限流）           |
|  83 | screenshot 仅 CLIP_SCREENSHOT              | 已验证：clipper-db/screenshot tests（screenshot 仅 CLIP_SCREENSHOT）                 |
|  84 | screenshot bytes 不进 DB/WAL/IPC           | 已验证：clipper-db/screenshot tests（screenshot bytes 不进 DB/WAL/IPC）              |
|  85 | DB 失败 orphan 可检测                      | 已验证：clipper-db/screenshot tests（DB 失败 orphan 可检测）                         |
|  86 | migration v10 保留既有 clip                | 已验证：clipper-db/screenshot tests（migration v10 保留既有 clip）                   |
|  87 | clips 字段/CHECK/索引完整                  | 已验证：clipper-db/screenshot tests（clips 字段/CHECK/索引完整）                     |
|  88 | receipt/link 表 STRICT                     | 已验证：clipper-db/screenshot tests（receipt/link 表 STRICT）                        |
|  89 | token/tab ID/HTML 不落业务表               | 已验证：clipper-db/screenshot tests（token/tab ID/HTML 不落业务表）                  |
|  90 | BrowserClip READY/PASSIVE_LOCAL            | 已验证：search-adapters、clipper-db tests（BrowserClip READY/PASSIVE_LOCAL）         |
|  91 | BrowserClip external requests 为 0         | 已验证：search-adapters、clipper-db tests（BrowserClip external requests 为 0）      |
|  92 | BrowserClip 无 model/cost                  | 已验证：search-adapters、clipper-db tests（BrowserClip 无 model/cost）               |
|  93 | Candidate 仅 URL/标题/provenance           | 已验证：search-adapters、clipper-db tests（Candidate 仅 URL/标题/provenance）        |
|  94 | 私有内容不进 Candidate                     | 已验证：search-adapters、clipper-db tests（私有内容不进 Candidate）                  |
|  95 | Candidate 四项状态冻结                     | 已验证：search-adapters、clipper-db tests（Candidate 四项状态冻结）                  |
|  96 | 总体不伪装 ACTIVE_SEARCH_READY             | 已验证：search-adapters、clipper-db tests（总体不伪装 ACTIVE_SEARCH_READY）          |
|  97 | ingest 不创建 Fetch Job                    | 已验证：search-adapters、clipper-db tests（ingest 不创建 Fetch Job）                 |
|  98 | 桌面列表查看样本                           | 已验证：clipper-renderer/screenshot tests（桌面列表查看样本）                        |
|  99 | 桌面详情安全显示                           | 已验证：clipper-renderer/screenshot tests（桌面详情安全显示）                        |
| 100 | React 无 dangerouslySetInnerHTML           | 已验证：clipper-renderer/screenshot tests（React 无 dangerouslySetInnerHTML）        |
| 101 | screenshot protocol 仅 clipId              | 已验证：clipper-renderer/screenshot tests（screenshot protocol 仅 clipId）           |
| 102 | renderer 无路径/file URL                   | 已验证：clipper-renderer/screenshot tests（renderer 无路径/file URL）                |
| 103 | 应用离线提示清晰                           | 已验证：clipper-renderer/screenshot tests（应用离线提示清晰）                        |
| 104 | popup 可访问状态完整                       | 已验证：clipper-renderer/screenshot tests（popup 可访问状态完整）                    |
| 105 | Chrome 真实侧载 smoke                      | 已验证：real-browser-smoke.json Chrome/150.0.7871.126                                |
| 106 | Edge 真实侧载 smoke                        | 已验证：real-browser-smoke.json Edg/150.0.4078.99                                    |
| 107 | 两个 smoke 完成配对/保存/查看              | 已验证：test:clipper-real 双浏览器配对/保存/桌面读取                                 |
| 108 | test:clipper 纳入全量/CI                   | 已验证：package.json test:clipper；Windows CI                                        |
| 109 | egress/恶意 fixture/既有 smoke             | 已验证：clipper-egress/architecture tests 与完整 npm test                            |
| 110 | 唯一一个本地提交并停止                     | 已验证：本轮唯一 git commit；提交后核验 HEAD/parent/工作树                           |
