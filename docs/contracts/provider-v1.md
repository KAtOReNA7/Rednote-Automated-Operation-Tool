# Provider v1 合同

## 范围

本合同定义 Issue 012 的文本、结构化输出、视觉和图片生成接口。它不是能力探测、搜索、
Embedding、OCR、Batch、工具执行、缓存、费用账本或 UI 调用合同。

## 调用上下文

每次调用必须显式提供：

- `requestId`、`providerId`、`modelId`；
- 与方法一致的有限 `operation`；
- `protocolMode`；
- `configRevision`；
- `timeoutMs` 和可选 `AbortSignal`；
- 完整的三态 capability snapshot；
- 只含有限标量的 secret-free trace metadata。

model ID、Base URL、endpoint、header 和 credential 都没有调用方 fallback。Base URL 和模型
只来自 Issue 010 设置，credential reference 固定为 `CONTENT_AI_API_KEY`。

## 能力和协议

`CapabilityState` 为 `UNKNOWN | SUPPORTED | UNSUPPORTED`。生产默认全 UNKNOWN；只有明确
SUPPORTED 才可调用。协议模式为：

- `RESPONSES` → 受控 `/responses`
- `CHAT_COMPLETIONS` → 受控 `/chat/completions`
- `IMAGES_GENERATIONS` → 受控 `/images/generations`
- `MOCK` → 只用于 ScriptedMockProvider

codec 不 fallback、不遍历 endpoint、不处理 404 探测。

## 输入

- Text：最多 64 条消息；role 仅 SYSTEM/USER/ASSISTANT；每 part 和总字符有界。
- Structured：Text 规则加版本化 strict-object schema 与 runtime validator。
- Vision：Text 规则加最多 8 张内存图片；只允许 PNG/JPEG/WebP/GIF，校验 magic 和字节上限。
- Image：prompt、count、size/quality/background hint 均有界；hint 不代表供应商必然支持。

所有输入拒绝任意 provider JSON、header、Authorization、endpoint、remote URL、file URL、
绝对路径和工具定义。

## 输出

文本/视觉结果包含规范 text、finish reason、结构化 refusal、可空 usage、可空安全 request id、
model ID、protocol mode、latency、truncated 和稳定 warnings。结构化结果只返回通过 runtime
validator 的 T。图片只返回受验证 inline bytes 和有限 metadata。

workflow 永远不接收完整 provider envelope。

## Usage

所有数字为 `integer | null`：

`inputTokens`、`outputTokens`、`totalTokens`、`cachedInputTokens`、`reasoningTokens`、
`imageInputCount`、`imageOutputCount`。

另含 `providerReported`、`complete` 和稳定 warnings。缺失保持 null；不估算、不推导 total、
不计算价格或美元。

## 错误和重试

`ProviderError` 只公开稳定 code、retry disposition、outcome certainty、有限 Retry-After、
调用标识和安全详情。

- `NOT_SENT + RETRY_AUTOMATIC_SAFE`：最多两次总尝试；
- `REJECTED_BEFORE_EXECUTION`：可由未来队列按 metadata 处理；
- `MAY_HAVE_EXECUTED`：不自动重发；
- `COMPLETED_INVALID_OUTPUT`：不自动修复或二次调用。

错误不得包含 credential、URL、headers、prompt、output、JSON business value、binary、
vendor message、stack 或绝对路径。

## 当前运行状态

- `providerContractsAvailable=true`
- `mockProviderAvailable=true`
- `liveProviderWired=false`
- `capabilityProbeAvailable=false`

应用启动、renderer、preload、本地 API 和 JobQueue 均不调用 provider。真实能力探测必须等到
Issue 013 获得单独授权。
