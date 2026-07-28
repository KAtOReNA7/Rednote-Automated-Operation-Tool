# ADR 0011：SearchProvider 与发现边界

- 状态：Accepted
- 日期：2026-07-28
- 范围：M2 Issue 015

## 背景

项目需要从模型联网搜索、未来独立 Search API、定向来源、浏览器收藏和手工 URL 获得候选
入口。但“发现一个 URL”不等于已经读取页面，更不等于该页面证明了某个事实。若把搜索摘要、
模型正文或上游排名直接写入证据系统，会绕过后续抓取、来源审查和事实核验。

## 决策

采用三层不可跨越的边界：

1. **Search（Issue 015）**只产生候选 URL 和有限上游元数据；
2. **Fetch（Issue 016）**才可能连接候选 URL 并获取受控内容；
3. **Evidence（Issue 019）**才可能创建来源、事实、主张和证据关系。

所有 `SearchCandidateV1` 固定为
`LEAD_ONLY / NOT_FETCHED / UNVERIFIED / NOT_A_FACT`。snippet、标题、日期、语言、排名和模型
source/citation 都只是未验证元数据。

### 五类适配器

- `MODEL_WEB_SEARCH`：通过 Issue 014 的 `ModelExecutionService` port，以
  `BYPASS / NONESSENTIAL` 单次执行；只接受 completed 结构化 source list 和 URL citation，
  丢弃 narrative 及其中 URL。
- `SEARCH_API`：本轮只有版本化 codec/transport/credential-resolver 接口、Scripted codec 和
  loopback 测试 codec。产品没有具体生产 codec，状态为 `CODEC_UNAVAILABLE`，也没有 Search API
  credential slot 或真实费用。
- `CURATED_SOURCE`：纯本地、审查过的固定模板，只替换一个 percent-encoded `{query}`。
- `BROWSER_CLIP`：只冻结输入合同和 fixture，产品固定 `PENDING_LATER_ISSUE`；Issue 017 前不增加
  Local API route，不接收 selectedText、metrics 或 screenshot。
- `MANUAL_URL`：本地校验有限 URL/title/note，不访问网络、不调用模型、不产生费用。

### 无任意 HTTP

不允许用户配置 HTTP method、path、header、body、JSONPath、JavaScript、curl 模板、endpoint 或
credential 注入。未来生产 Search API codec 必须是代码 allowlist 并单独审查。Transport 只允许
生产 HTTPS；HTTP 仅限显式 `127.0.0.1` 测试 codec。请求、header、连接/响应时间、
raw/decompressed bytes 和 redirect 都有硬上限；最多一个 codec 明确许可的 same-origin redirect，
拒绝 cross-origin 和 HTTPS downgrade。Transport 从不连接搜索结果 URL。

### Readiness、计划与无 fallback

Registry 只在 Electron main/composition root 显式构造，instance ID 唯一，不加载动态 JS。
总体状态只有 `ACTIVE_SEARCH_READY / PASSIVE_ONLY / NOT_READY / DEGRADED`。被动本地适配器、
interface-only Search API 和 pending BrowserClip 不能证明 active search ready。

`SearchPlanV1` 绑定 request hash、provider snapshot、settings/capability/budget identity、rate policy、
限制与 expiry；fallback 固定 `NONE`。empty、429、5xx、invalid response、ambiguous、预算阻断、
能力过期和 unsupported filter 都不会自动改用其他 Provider、重试或翻页。

### 持久限速、幂等与不确定终态

远程执行必须携带版本化 `SearchRatePolicyV1`。SQLite 在 `BEGIN IMMEDIATE` 短事务内原子检查
并发、最小间隔和窗口计数，状态跨重启保留。一次 SearchRun 最多一次外部 attempt；429 的
allowlisted `Retry-After` 只更新状态，不 sleep/retry。

`executionId` 全局唯一。已完成运行可安全重放；可证明 pre-send 的失败才可恢复。after-send
连接截断、超时或未知结果进入 `AMBIGUOUS / MAY_HAVE_EXECUTED`，不自动恢复。

### migration v8 与 accounting

migration v8 只新增 `search_provider_configs`、`search_rate_limit_states`、`search_runs` 和
`search_result_candidates` 四张 STRICT 表。search 专用表不保存 query 正文、模型正文、raw response、
header、页面正文、selected text、screenshot、credential 或内部 endpoint。候选四个状态由
CHECK 冻结。

Model Web Search 复用 Issue 014 的预算预留、usage、cost 和 ambiguous 语义；Search 层只关联
`modelRunId`，不重复写成本账本。Search API 在没有生产 codec 和可审计 accounting 前不 READY。
本地适配器为 `NOT_INCURRED`，不创建 model run、ledger 或 reservation。

## 被否决方案

- 从模型 narrative 或普通文本正则提取 URL：来源不可审计，且会把提示注入内容当结构化来源。
- 通用 HTTP/JSONPath/script 配置器：等价于在产品中加入任意网络和代码执行面。
- 自动 fallback、并行聚合、重试或翻页：破坏费用、限速、幂等和不确定终态的可审计性。
- 搜索即抓取、摘要即证据：跨越 Issue 016/019 的安全与数据质量门槛。
- 本轮实现浏览器插件 route 或生产 Search API vendor：扩大到 Issue 017 或未审查供应商集成。

## 结果

Issue 015 获得统一、可持久化、可测试的发现层，但不会抓取页面、构建书库、创建来源/事实或运行
真实搜索服务。Issue 016 若获明确授权，可在保持本 ADR 边界的前提下设计受控 Fetch 层。
