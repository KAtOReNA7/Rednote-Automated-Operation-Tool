# Provider Capabilities Contract v1

## Identity

合同版本为 `provider-capabilities-v1`。能力记录的身份由以下字段共同确定：

`configFingerprint + settingsRevision + credentialBindingVersion + modelSlot + modelId + protocolMode + capability + contractVersion`

`configFingerprint` 是协议、规范化 Base URL、按槽位排序的模型映射及合同版本的 SHA-256。它不得包含凭据、文件路径或明文 URL。

## Capabilities and state

能力枚举：

`text | structuredJson | toolCalling | webSearch | imageGeneration | vision | usage | batch | streaming`

状态枚举：

`UNKNOWN | SUPPORTED | UNSUPPORTED`

每个条目还包含 `source`（`PROBED | METADATA | NOT_PROBED`）、`confidence`（`CONFIRMED | INCONCLUSIVE`）、`reasonCode`、`runId`、`stale`、安全计数/数字详情和 `observedAt`。未实际发送请求的条目必须 `observedAt = null`。

## Conservative classification

只有解析并验证了能力特有的正向信号，才能得到 `SUPPORTED`。只有供应商返回能力、模型或协议的明确拒绝，才能得到 `UNSUPPORTED`。

认证或权限拒绝、429、配额、网络、TLS、超时、取消、5xx、通用 404、内容类型错误、畸形 JSON、schema mismatch、未观察到 tool/search、URL-only 图片、未报告 usage/metadata 和其他歧义结果均为 `UNKNOWN`。

固定 reason code：

`NOT_PROBED | USER_SKIPPED | CONFIG_STALE | AUTHENTICATION_REJECTED | PERMISSION_REJECTED | RATE_LIMITED | QUOTA_UNAVAILABLE | NETWORK_UNREACHABLE | TLS_FAILURE | TIMEOUT | ABORTED | ENDPOINT_EXPLICITLY_UNSUPPORTED | MODEL_EXPLICITLY_UNSUPPORTED | PROTOCOL_EXPLICITLY_UNSUPPORTED | INVALID_CONTENT_TYPE | INVALID_RESPONSE | INVALID_JSON | SCHEMA_MISMATCH | TOOL_NOT_OBSERVED | SEARCH_NOT_OBSERVED | VISION_INCONCLUSIVE | OUTPUT_VARIANT_UNSUPPORTED | USAGE_NOT_REPORTED | METADATA_NOT_REPORTED | AMBIGUOUS_OUTCOME | INTERNAL_ERROR`

## Plans

- `CORE`：metadata、Responses/Chat text、structured JSON、usage（伴随观察）和 vision；tool calling 只有显式 opt-in 才加入。
- `FULL`：CORE 加 tool calling、web search、image generation、Batch metadata 和 streaming。
- `CUSTOM`：至少选择一个有限能力。

计划最多 32 个外部请求，严格串行，每个逻辑步骤只尝试一次。禁止自动重试、repair、fallback、任意 prompt、任意 endpoint、任意 header 或任意 body。

## Probe evidence

- text：固定 marker 必须从对应协议输出中解析出来。
- structured JSON：固定微型 strict schema 必须通过运行时验证器。
- tool calling：必须解析并验证合成函数调用；不得执行函数或发送 tool result。
- web search：必须同时观察到工具事件和 citation；只持久化计数。
- vision：使用运行时内存中的微型合成图片；只有正确 marker 才支持。
- image generation：只接受可验证的内联字节；URL-only 不下载。
- usage：只伴随其他请求观察，不增加请求；缺失保持未知。
- max context/rate：只读取显式 metadata 或 allowlisted headers，缺失为 null。
- Batch：只允许 metadata/`OPTIONS`/`HEAD`；不得创建、列举、上传、读取或取消任务。

## Runtime lifecycle

preview token 使用 CSPRNG，单次、仅内存、最长五分钟，并绑定 sender frame、窗口、plan hash、settings revision 和 credential binding version。start 时 main 进程重新构建计划并逐项比较，之后才允许解析凭据。

同一应用同时最多一个运行。取消会 abort 当前步骤并阻止后续步骤。启动时把遗留 `RUNNING` 更新为 `INTERRUPTED`，且不自动恢复。只有当前指纹和凭据绑定下最新 `SUCCEEDED` 运行替换当前矩阵。

## Guard

CapabilityGuard 只允许当前、非 stale 的 `SUPPORTED`。`UNKNOWN`、`UNSUPPORTED` 和 `STALE` 分别返回稳定错误；guard 不触发探测、不重试、不切换模型、不切换协议。
