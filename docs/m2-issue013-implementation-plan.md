# M2 Issue 013 实现计划：可移植的供应商能力探测

## 1. 边界

本 Issue 只实现用户显式触发的 OpenAI-compatible 供应商能力探测。开发和验收只使用脚本化 mock、随机无效凭据和绑定到 `127.0.0.1` 随机端口的 fixture；不读取真实密钥，不调用真实模型、搜索、图片或 Batch API，不产生费用。Issue 014 及后续能力不在本轮范围内。

## 2. 固定设计

- 能力集合为 `text`、`structuredJson`、`toolCalling`、`webSearch`、`imageGeneration`、`vision`、`usage`、`batch`、`streaming`。
- 状态只允许 `UNKNOWN`、`SUPPORTED`、`UNSUPPORTED`。网络、认证、权限、限流、配额、超时、5xx、通用 404、畸形响应和歧义结果均保持 `UNKNOWN`。
- 配置指纹只包含协议、规范化 Base URL、模型映射和合同版本的哈希；不包含密钥、路径或明文 URL。
- 凭据绑定版本是本地非秘密单调整数；设置、替换、清除凭据都会递增。
- `CORE`、`FULL`、`CUSTOM` 计划由 main 进程根据当前设置重建；最多 32 个外部请求、并发度固定为 1、每步只尝试一次，不重试、不修复、不回退。
- preview 返回短期、单次、仅内存 start token；token 绑定 sender、窗口、plan hash、设置 revision 和凭据绑定版本，最长有效五分钟。
- 同一应用只允许运行一个探测。取消会终止当前步骤并阻止后续步骤；进程重启把遗留 `RUNNING` 标记为 `INTERRUPTED`，不自动恢复。
- 只有最新、当前指纹下完整 `SUCCEEDED` 的探测可成为当前矩阵；部分、失败、取消和中断结果只保留为历史。
- CapabilityGuard 只允许当前、非 stale 的 `SUPPORTED`；其余状态返回稳定错误，不自动探测、切换模型或回退协议。

## 3. 数据与迁移

新增连续 migration v6 `provider_capability_probing`：

- `provider_capability_probe_runs` 保存计划、计数、终态和安全原因；
- `provider_capability_entries` 保存按模型槽位、协议模式和能力拆分的三态结论；
- `app_settings.credential_binding_version` 保存非秘密生命周期版本。

迁移沿用现有预迁移备份、单事务、回滚、外键检查、STRICT 表和 quick check。v1–v5 的 SQL、顺序和 SHA-256 不变。

## 4. 组件

1. `packages/providers`：有限合同、指纹、不可变计划、固定请求编码、无重试 transport、纯分类器、串行 runner、CapabilityGuard。
2. `packages/db`：v6 与 capability repository，负责运行历史、条目、stale 刷新和启动恢复。
3. `packages/shared`：窄 DTO 与五个固定 IPC 方法；矩阵只暴露配置中的有限 model ID，不暴露 URL、凭据、prompt、header、响应正文或路径，诊断与日志仍不记录完整 model ID。
4. `apps/desktop`：token broker、窗口和 sender 绑定、凭据延迟解析、单运行协调、关闭与切换清理。
5. `apps/web-ui`：能力矩阵、profile、请求数、费用风险提示、默认未勾选确认框、开始、进度、取消与历史终态。

## 5. 网络安全

- 端点只允许 `/models`、严格编码的 `/models/{model}`、`/responses`、`/chat/completions`、`/images/generations` 和 `/batches`。
- 只允许 HTTPS 或 loopback HTTP；保留 Base URL path；禁止 URL 用户信息、query、fragment 和 redirect。
- fetch 使用 `credentials: 'omit'`，不使用 cookie；Authorization 只在 main 进程最终 transport 注入。
- Batch 只允许 `OPTIONS`/`HEAD` 或显式 metadata，不创建、列举、上传、读取或取消 Batch。
- 图片只验证内联字节，URL-only 结果不下载并归类为 `OUTPUT_VARIANT_UNSUPPORTED`。
- web search 只保留事件和 citation 数量，不保存文本或 URL。

## 6. 验证顺序

先增加针对计划、分类器、传输、runner、持久化、stale、guard、IPC、renderer、秘密出站、取消、并发、崩溃恢复和 loopback 的专用测试，再运行：

`npm ci` → format → lint → typecheck → constraints → db → queue → desktop → storage → settings → local-api → portability → providers → capabilities → electron-smoke → full test → build → package → dependency audit → packaged smoke。

任何失败都修复根因并从 `npm ci` 重新开始最终验收。本 Issue 只创建一个本地提交，不 push、不创建 PR。
