# Model Execution v1 合同

## 请求

`ModelExecutionRequestV1` 是唯一业务入口。对象拒绝额外字段并具有有限长度、深度、数组和
数值范围。调用方必须提供：

- `executionId`、`taskKind`、`modelRole`、`modelSlot`；
- 64 位小写十六进制 Provider 配置指纹；
- 模型、协议、prompt 内容身份、精确输入和生成参数；
- 输出 schema、来源与媒体内容身份（适用时）；
- `NONESSENTIAL` 预算分类和一次外部请求的最大单位需求；
- `READ_WRITE`、`READ_ONLY`、`BYPASS` 或 `REFRESH` 缓存政策。

调用方不能提交 endpoint、header、credential、成本、usage、本地命中值或 essential 标记。
probe/search/tool 类型只能使用 `BYPASS`。

## 语义身份

`cache-key-v1` 对 `canonical-json-v1` 身份取 SHA-256。对象键排序、数组保持顺序；
`undefined`、循环、非有限数、`-0`、非普通对象和 prototype 相关键均被拒绝。不同 Unicode
code point 或字节不会被隐式归一化。

运行时间、`executionId`、deadline、AbortSignal、路径、盘符、用户名、Git HEAD、凭据、
AI 标识和版权不进入缓存键。

## 顺序与结果

服务严格按以下顺序执行：

1. 校验请求并生成身份；
2. 查询 `executionId` 幂等结果；
3. 对允许读取的政策验证并读取本地缓存；
4. 执行当前能力门禁；
5. 相同缓存键 singleflight/lease；
6. 原子预算 preflight 和 reservation；
7. 建立 IN_FLIGHT run；
8. 晚解析凭据；
9. 最多一次 Provider 调用；
10. 验证 provider-neutral 输出和 usage；
11. 可缓存时先写不可变受控文件；
12. 短事务结算 run、reservation、cache 引用和 ledger。

终态为 `CACHE_HIT`、`SUCCEEDED`、发送前/后失败、发送前/后取消、`AMBIGUOUS`、
`BUDGET_BLOCKED`、`CAPABILITY_BLOCKED` 或 `CACHE_CORRUPT`。每个结果明确
`externalRequestCount`（0/1）、`localCacheHit`、outcome certainty、usage、cost state 和
可空 micro-USD。

## 缓存资格

只有完整、无 refusal、无 partial、通过 runtime/schema 校验且无外部副作用的 TEXT、
STRUCTURED、VISION、IMAGE 可写。缓存 envelope 仅包含格式/版本、时间、输出类型、
provider-neutral 输出、输出内容 hash 和可选 schema 身份。

失败、拒答、取消、截断、ambiguous、能力探测、搜索、工具、流式片段和原始 Provider
envelope 永不缓存。缓存写失败不能掩盖已经产生的 usage/cost。

## 幂等与失败

相同 `executionId` + 相同缓存键返回既有终态；相同 `executionId` + 不同键是冲突。
可能已执行的调用不自动重试。只有 `NOT_SENT`/`REJECTED_BEFORE_EXECUTION` 可释放预留；
发送状态不确定时成本金额保持 `NULL`，状态为 `UNKNOWN_POSSIBLY_INCURRED`。
