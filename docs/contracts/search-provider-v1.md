# SearchProvider V1 稳定合同

## 1. 版本与职责

`contractVersion = search-provider-v1`。Provider 只实现：

```ts
interface SearchProviderV1 {
  describe(): SearchProviderDescriptorV1;
  preview(request: SearchRequestV1): Promise<SearchPreviewV1>;
  execute(request: SearchRequestV1, context: SearchExecutionContextV1): Promise<SearchBatchV1>;
}
```

Search 只发现候选，不连接结果 URL。候选固定
`evidenceEligibility=LEAD_ONLY`、`fetchState=NOT_FETCHED`、
`truthStatus=UNVERIFIED`、`factStatus=NOT_A_FACT`。

## 2. 有限枚举

- Kind：`MODEL_WEB_SEARCH / SEARCH_API / CURATED_SOURCE / BROWSER_CLIP / MANUAL_URL`
- Mode：`ACTIVE_REMOTE / PASSIVE_LOCAL / FIXTURE_ONLY`
- Overall readiness：
  `ACTIVE_SEARCH_READY / PASSIVE_ONLY / NOT_READY / DEGRADED`
- Batch status：
  `SUCCEEDED / PARTIAL / EMPTY / RATE_LIMITED_BEFORE_SEND / BUDGET_BLOCKED /
CAPABILITY_BLOCKED / CANCELLED_BEFORE_SEND / CANCELLED_AFTER_SEND /
FAILED_BEFORE_SEND / FAILED_AFTER_SEND / AMBIGUOUS`
- Fallback：只能为 `NONE`

完整枚举和稳定错误码以 `packages/search/src/constants.ts` 与 `errors.ts` 为机器事实来源。

## 3. 请求边界

- query 512 字符；maxResults 1—20；
- locale 最多 4 个；allowed/blocked domain 各最多 100 个；
- cursor 最多 2 KiB UTF-8；URL 4,096 字符；
- title 512；preview/note 2,000；
- request canonical JSON 最多 128 KiB；
- exact-object validation，额外字段拒绝。

Descriptor 必须逐项声明 intent、feature、最大结果/响应字节和 capability/rate/budget/
credential/codec readiness。调用方请求未支持功能时返回 `SEARCH_FEATURE_UNSUPPORTED`；domain
filter 只有协议真实支持时才可标 `hardFilterApplied=true`。

## 4. URL、域名与候选

只接受 HTTP/HTTPS，拒绝 userinfo、控制/混淆空白、非法 percent encoding、Windows/UNC/device
路径、缺失 host 和超长值。WHATWG URL 负责 IDNA、默认端口、dot segment；实现移除 fragment，
但不删除 tracking、不排序 query、不升级 HTTPS、不读取 canonical link。

域名规则只接受 host，使用 IDNA、小写、尾点移除和 label-boundary；blocked 优先。同一 batch
只按 canonical URL 去重，所有 appearance 保存在 `provenanceAppearances`，不按标题、ISBN 或模型
判断合并作品。

`PARTIAL` 只表示响应已确定完整、但个别 item 因字段非法被拒绝。连接截断或终态未知必须是
FAILED/AMBIGUOUS。

## 5. 远程执行

每个远程 Provider 必须有 `search-rate-policy-v1`：maxConcurrent、minIntervalMs、
maxRequestsPerWindow/windowMs、timeoutMs、maxResponseBytes/maxResults 和 revision。缺失即不 READY。
一次 execution 至多一次外部 attempt；无自动 retry、fallback、并行聚合或翻页。

Model Web Search 固定 `BYPASS / NONESSENTIAL`，只接受 completed structured tool event 中的 source
list/citation。Search API 产品无生产 codec；测试 HTTP 只允许 loopback。Transport 对 HTTPS、
header、connect/header/body/total timeout、raw/decompressed bytes、MIME/schema 和 redirect
fail closed，且永不访问结果 URL。

## 6. 持久化与 Queue

`SEARCH_EXECUTE_V1` payload 只能保存有限 request/plan/settings/capability identity；result 只能
保存 searchRunId、终态、counts 和 stable error。本 Issue 不自动 enqueue。

Search 专用 SQLite 表只保存 hash、枚举、计数、有限候选元数据和 rate state。不得保存 query、模型正文、
raw response/header、页面正文、selected text、screenshot、credential 或内部 endpoint。
executionId 唯一；完成运行可重放；after-send 未知为 AMBIGUOUS 且不自动恢复。

## 7. 禁止兼容扩展

V1 不接受任意 method/path/header/body/JSONPath/script/curl、真实 Search API credential、插件 route、
页面抓取/解析、RSS/sitemap/附件、来源/事实/书目业务、搜索执行 IPC 或预算绕过。上述能力必须通过
后续 Issue 和新版本合同显式设计，不能用 V1 的“可选字段”暗中加入。
