# M2 Issue 012 文件级实施计划

状态：实施中；严格停留在 Issue 012。

原指令固定起点：`7bc921fb805ef42b8ae5a71184dd94e4b5ac920d`

实际能力基线：`66d0681d5652a7cd203ce9e37507eb133b655e83`

## 起点核验

- 仓库根目录为 `E:\project\rednote`，分支为 `main`，`origin/main` 与实际 HEAD 均为
  `66d0681`；它是固定起点 `7bc921f` 的直接后继，只包含项目状态和指导文档更新。
- 用户明确要求以实际代码能力确认基线，不因盘符、绝对路径、HEAD、文件摘要或换行差异
  停止，因此本轮保留实际基线，不改写历史。
- 开工时存在上一轮已验证但尚未提交的维护修改：`.gitattributes`、README、桌面打包脚本和
  一项与日期无关的本地 API 测试修复；本轮不会覆盖、回滚或隐藏这些修改。
- `packages/providers` 只有预留入口，不含客户端、transport、codec、模型调用或真实 wiring。
- migration v1—v5 保持连续且冻结；本轮不新增 migration。
- 开工前既有全量门禁、source smoke、package smoke 和依赖审计已在同一工作树通过；最终仍
  将从 `npm ci` 开始按 Issue 指令完整重跑。

## 范围

只实现：

- 文本、结构化输出、视觉和图片生成四类供应商无关接口；
- 三态能力快照和显式协议模式；
- 从 Issue 010 非秘密设置装配的、深冻结且可检测过期的 runtime config；
- 固定 `CONTENT_AI_API_KEY` 的 main-only credential resolver 端口；
- 有界输入、运行时 schema、统一 usage、稳定错误、结果确定性和有限安全重试；
- 可注入 HTTP transport，独立 Responses、Chat Completions、Images codecs；
- 未接入生产启动流程的 OpenAI-compatible provider；
- 确定性的 ScriptedMockProvider；
- 只绑定 `127.0.0.1` 的测试 fixture、40 项 egress、专项测试、CI、ADR、合同和验收映射。

明确不实现 Issue 013 的能力探测、Issue 014 的缓存/运行记录/费用账本、Issue 015 的搜索、
Issue 017 的插件业务，也不实现 embedding、OCR、Batch、工具执行、真实 JobHandler、UI
调用入口或 local API provider route。

## 依赖决策

不新增第三方依赖。结构化输出使用调用方提供的版本化 `RuntimeSchema<T>` 和确定性 validator，
并在 validator 前执行通用 JSON 深度、数组、字符串和节点数限制。协议仅依赖 Node.js 24
内置 `fetch`、`AbortController`、`crypto` 和标准 Web API；不引入 OpenAI SDK。

## 文件计划

### 文档

- `docs/adr/0008-provider-neutral-model-interfaces.md`
- `docs/contracts/provider-v1.md`
- `docs/m2-issue012-acceptance-map.md`
- `docs/m2-issue012-implementation-plan.md`

### Provider 包

- `packages/providers/src/contracts.ts`
- `packages/providers/src/capabilities.ts`
- `packages/providers/src/configuration.ts`
- `packages/providers/src/content.ts`
- `packages/providers/src/usage.ts`
- `packages/providers/src/errors.ts`
- `packages/providers/src/retry-policy.ts`
- `packages/providers/src/response-limits.ts`
- `packages/providers/src/transport.ts`
- `packages/providers/src/codecs/responses-codec.ts`
- `packages/providers/src/codecs/chat-completions-codec.ts`
- `packages/providers/src/codecs/images-codec.ts`
- `packages/providers/src/openai-compatible-provider.ts`
- `packages/providers/src/mock-provider.ts`
- `packages/providers/src/redaction.ts`
- `packages/providers/src/index.ts`

### 测试与工程配置

- `tests/providers-contracts.test.ts`
- `tests/providers-configuration.test.ts`
- `tests/providers-capabilities.test.ts`
- `tests/providers-text.test.ts`
- `tests/providers-structured.test.ts`
- `tests/providers-vision.test.ts`
- `tests/providers-image.test.ts`
- `tests/providers-usage.test.ts`
- `tests/providers-errors-retry.test.ts`
- `tests/providers-http-transport.test.ts`
- `tests/providers-mock.test.ts`
- `tests/providers-egress.test.ts`
- `tests/providers-architecture.test.ts`
- `tests/support/provider-test-utils.ts`
- `package.json`、`tsconfig.typecheck.json`、`vitest.config.ts`
- `.github/workflows/ci.yml`
- `README.md`

## 错误与重试语义

- `ProviderError` 只含稳定 code、有限详情、cause category、retry disposition、outcome
  certainty 和有界 Retry-After；不含 vendor message、header、raw body、prompt、output、
  binary、credential 或 stack。
- 只有明确 `NOT_SENT` 且标记 `RETRY_AUTOMATIC_SAFE` 的失败可自动重试；总尝试默认最多 2。
- 发送后断连、读取超时和未知 5xx 视为 `MAY_HAVE_EXECUTED`，不自动重发。
- invalid JSON/schema 是 `COMPLETED_INVALID_OUTPUT`，不自动执行付费 JSON repair。
- 429/503 的有限 Retry-After 只作为未来队列元数据，不直接调用 JobQueue。

## 测试计划

- 类型和 table-driven 输入合同；
- config 来源、深冻结、revision stale 和固定 credential reference；
- 三态能力和 protocol mode；
- 三个 codec 的 encode/decode、404 无 fallback；
- runtime schema、拒绝、JSON limits；
- vision/image MIME、magic bytes、base64 预检和 output limits；
- usage 缺失、异常和冲突；
- fake clock/random、AbortSignal、deadline 和安全重试；
- scripted mock 的四接口、失败场景、并发隔离与脚本耗尽；
- 真实 Node fetch 到随机端口 `127.0.0.1` fixture，验证超时、429、5xx、断连、MIME、
  JSON、大小限制和清理；
- 40 项 credential/content egress、DB 行数不变、架构和硬约束回归。

## 最终验证

从 `npm ci` 开始按 Issue 指令依次运行 18 项门禁。任何失败修复根因后从 `npm ci` 重新开始。
最终只创建一个本地提交：

`feat(providers): add provider-neutral model interfaces`

不 push、不创建 PR、不合并，完成后停止，不进入 Issue 013。

## 实际结果

- 四类 provider 合同、三态能力、显式协议模式、Issue 010 配置加载、固定凭据引用、统一
  usage、稳定错误、有限安全重试、三个独立 codec、可注入 transport 和确定性 scripted
  mock 均已实现。
- `test:providers`：13 个测试文件、188 项测试全部通过；40 项 egress matrix 为 40/40，
  真实 API/模型调用与付费请求计数为 0。
- 全量 `test`：64 个测试文件、776 项测试全部通过，失败、skip、todo 为 0。Vitest 固定
  最多 1 个 worker，避免共享 Windows 环境下 SQLite/文件系统并发争用，不更改测试超时、
  断言或覆盖范围。
- migration 仍只有 v1—v5，冻结 SHA-256 全部匹配；未新增或修改 migration。
- 18 项本地门禁均通过，包括 source/package 两项 Electron smoke、依赖审计 0 漏洞和
  打包验证。GitHub 托管 CI 尚未运行，不能声称已通过。
- 所有 HTTP 集成测试只访问随机端口的 `127.0.0.1` fixture；没有读取真实密钥，没有调用
  真实 API/模型，没有产生费用，没有遗留 listener 或子进程。
- Issue 013 的能力探测、生产接线和后续里程碑均未实现；本轮在 Issue 012 停止。
