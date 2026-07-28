# Controlled Fetch V1 合同

## 输入与计划

`FetchRequestV1` 是 exact object，只包含 execution、候选 ID/预期 URL 哈希、选择来源、
profile/revision、时间和可空 job ID。它不接受 URL、header、Cookie、credential、proxy、
method 或脚本。

`FetchPlanV1` 绑定 request semantic hash、候选 ID/规范 URL 哈希/origin、完整 profile
快照、rate identity、robots/DNS/redirect/MIME/charset/privacy 版本、资源上限、存储估算和
过期时间。计划的 `planHash` 是剔除自身字段后的规范 JSON SHA-256。

候选必须存在并保持：

- `evidenceEligibility = LEAD_ONLY`
- `fetchState = NOT_FETCHED`
- `truthStatus = UNVERIFIED`
- `factStatus = NOT_A_FACT`

## 请求策略

- 页面和 robots 仅 GET；robots 固定为同 origin `/robots.txt`。
- 固定 User-Agent：`RednoteResearchFetcher/1.0 (+local-user-controlled)`。
- 页面重定向最多 3 跳；robots 最多 1 跳；仅同 host，禁止 HTTPS 降级。
- 每跳重新做 URL、凭据型 query、DNS、SSRF、固定地址和 remote peer 校验。
- robots unknown、访问控制、challenge、MIME/charset/大小冲突均停止，不重试或 fallback。
- robots 与页面请求都占用持久化 origin rate reservation。

## 输出

`FetchOutcomeV1` 只含终态、有限计数/MIME/charset、稳定错误和可空文档。文档固定：

- `evidenceEligibility = FETCHED_NOT_EVIDENCE`
- `truthStatus = UNVERIFIED`
- `factStatus = NOT_A_FACT`

稳定错误不包含 URL/query、IP、路径、正文、header、Cookie、robots 规则或 stack。

## 队列

`FETCH_PUBLIC_PAGE_V1` payload 只保存 request 和 plan identity；result 只保存 run/document
标识、终态、bytes/counts 与稳定错误。handler 被注册但 Issue 016 不提供自动入队来源。
