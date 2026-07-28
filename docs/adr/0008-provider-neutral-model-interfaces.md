# ADR 0008：供应商无关的模型接口

- 状态：接受
- 日期：2026-07-28
- 范围：M2 Issue 012
- 原指令固定起点：`7bc921fb805ef42b8ae5a71184dd94e4b5ac920d`
- 实际能力基线：`66d0681d5652a7cd203ce9e37507eb133b655e83`

## 背景

Issue 010 已保存 OpenAI-compatible Base URL、五个可空模型 ID 和固定非秘密凭据引用，
Issue 009 已提供至少一次交付的本地队列，但仓库尚无模型接口。中转站的具体协议和能力未知，
不能从模型名、URL 或历史经验推断，也不能在本轮读取真实凭据或发起探测。

## 决策

### 包和 wiring

`@mystery-operations/providers` 是 Electron 无关的 Node/main/worker 包。renderer、preload、
local API 和应用启动流程均不导入或调用它。包定义四个独立接口：
`TextGenerationProvider`、`StructuredGenerationProvider`、`VisionProvider` 和
`ImageGenerationProvider`。Search、Embedding、OCR、Batch 和工具执行不在本 Issue。

OpenAI-compatible 实现只在调用方显式传入 `RESPONSES`、`CHAT_COMPLETIONS` 或
`IMAGES_GENERATIONS` 时使用对应 codec，不猜测、不 fallback、不探测。`MOCK` 只属于
ScriptedMockProvider，不能自动进入生产。

### 配置和凭据

`ProviderConfigLoader` 只接受 Issue 010 设置的结构化只读端口，装配规范 Base URL、模型角色、
revision、`OPENAI_COMPATIBLE` 和固定 `CONTENT_AI_API_KEY` 引用。返回值递归冻结；
`PROVIDER_CONFIGURED_UNVERIFIED` 仍明确是未验证状态。调用必须携带 config revision，旧
revision 返回稳定 stale 错误。

`CredentialResolver` 只在实际调用边界解析固定引用。它不属于 request DTO，不可由 renderer、
job payload 或调用方覆盖。Issue 012 没有生产 wiring；测试只注入运行时 fake resolver。

### 能力

所有能力采用 `UNKNOWN | SUPPORTED | UNSUPPORTED`。实际 provider 默认全部 `UNKNOWN`；
Mock 可显式声明。`maxContextTokens` 和 `observedAt` 默认为 null，source 为
`CONFIGURED_UNKNOWN`、`MOCK` 或未来的 `PROBED`。UNKNOWN 和 UNSUPPORTED 都不会被调用。
本轮不持久化、不探测，也不把 UNKNOWN 永久改为 UNSUPPORTED。

### 内容、结构化输出和二进制

文本只接受有限 `SYSTEM | USER | ASSISTANT` 消息和文本 part。视觉额外接受内存
`Uint8Array`，MIME 仅 PNG/JPEG/WebP/GIF，并校验数量、单图/总字节和基础 magic bytes；
路径、URL 和文件读取不进入接口。

结构化输出由调用方提供带 id/version、严格对象 JSON Schema 和确定性 runtime validator 的
`RuntimeSchema<T>`。先做通用 JSON size/depth/array/string/node 限制，再运行 validator。
invalid JSON、schema mismatch 和 refusal 均为单次已完成结果，不自动发送修复请求。

图片输出只接受有限 base64 inline bytes；解码前先检查长度，解码后校验 MIME、magic、
单张/总字节。URL-only 响应拒绝，不自动下载、不写文件仓库、不创建 asset。

### Transport、usage 和错误

`HttpTransport` 可注入；默认实现使用 Node.js 24 `fetch`，只允许 HTTPS 或 Issue 010 允许的
loopback HTTP，只 POST，固定 JSON headers，`redirect=error`、`credentials=omit`，有请求、
响应 header/body、deadline 和 AbortSignal 限制。响应按流计数，不记录原始数据。

usage 统一为可空非负安全整数，不估算、不补 0、不虚构 total、不读取价格、不计算美元。
冲突分项保留并给稳定 warning，未知字段丢弃。model_runs、cost_ledger 和 jobs 均不写入。

稳定错误同时携带四态 retry disposition 与四态 outcome certainty。只有明确未发送的安全失败
最多自动尝试两次；`MAY_HAVE_EXECUTED` 永不自动重发。Retry-After 最多 60 秒，deadline
覆盖全部尝试，Provider 层不调用 JobQueue。

### 敏感数据

完整 model ID 默认不进入 trace；公开 metadata 使用不可逆短 hash。错误、日志、诊断和测试
证据不含 Base URL、credential、Authorization、prompt、raw output、structured business
value、image bytes、header、vendor body、stack 或绝对路径。ProviderError 主动移除 stack。

## 后果

- 后续 Issue 013 可以在不改四接口的前提下提供已探测能力和明确 protocol mode。
- 后续 Issue 014 可以消费统一 usage、稳定错误和 retry metadata，但缓存和费用仍未实现。
- 当前应用没有任何真实模型入口，启动和测试均不会产生模型请求或费用。
- migration v1—v5、Electron 安全边界、本地 API、AI 标识和版权硬约束均保持不变。
