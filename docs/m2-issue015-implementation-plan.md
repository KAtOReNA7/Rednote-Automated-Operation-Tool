# M2 Issue 015 实施计划：统一 SearchProvider

状态：实现完成。本文在编码前创建，以下为实际实现和最终验收命令证据。

## 1. 动态基线与停止边界

- 仓库根由 `git rev-parse --show-toplevel` 动态发现。
- 本轮动态基线为开始任务时的本地 `HEAD`；实际值只进入最终报告，不作为未来门禁。
- 开工时 `main` 与 `origin/main` 一致，工作树仅有本轮
  `docs/instructions/m2/Issue015-short-Codex-instruction.txt` 这一项授权输入。
- 当前能力基线为 migration v7、Provider v1、显式 Capability Probe、
  `ModelExecutionService`、本地缓存/预算/成本账本和 at-least-once Job Queue。
- 只实现 Issue 015。禁止结果页抓取、HTML/PDF/图片/RSS/附件解析、插件业务 route、书目发现、
  来源/事实/研究档案、自动 fallback/retry/翻页和任意 HTTP 配置。
- 全部开发与测试仅使用 Scripted fixture、合成值、临时 SQLite、临时 ProjectDataRoot 和
  `127.0.0.1` loopback；真实密钥、模型、搜索服务、页面请求和费用保持为零。
- 完成并创建唯一一个本地提交后停止，不进入 Issue 016。

## 2. 架构与依赖方向

- 新建 Electron 无关的 `packages/search`，承载版本化合同、严格 validator、URL/domain
  规范化、候选去重、五类 adapter、显式 registry、readiness、plan 和执行服务。
- `packages/search` 不依赖 Electron、renderer、SQLite 或凭据实现；远程执行、持久化、能力、
  预算和时钟均通过有限 port 注入。
- `packages/db` 追加 migration v8 和 `SqliteSearchRepository`；数据库可依赖纯合同包，
  Search 合同包不反向依赖数据库，避免循环。
- `packages/workflows` 只增加 `SEARCH_EXECUTE_V1` 的有限 Job handler/validator；不自动入队。
- Electron main/composition root 构造 registry 和桌面状态 runtime。renderer 只接收有限 DTO，
  不能注册 adapter、传 endpoint/header/body/credential 或执行搜索。

## 3. Search/Fetch/Evidence 与 V1 合同

- Search 只发现候选；每个候选固定
  `LEAD_ONLY / NOT_FETCHED / UNVERIFIED / NOT_A_FACT`。
- Issue 016 才允许访问候选 URL；Issue 019 才允许创建事实和证据关系。
- `SearchProviderV1` 固定 `describe/preview/execute`，合同、请求、descriptor、candidate、
  batch、错误和计划均显式版本化。
- 五种 provider kind、三种 mode、有限 readiness、intent、batch status、source metadata、
  citation 和 preview kind 均用 discriminated union/有限枚举。
- 请求、数组、对象深度、URL、标题、预览、cursor 和序列化字节均严格限制；额外字段拒绝。

## 4. URL、Domain 与候选归一化

- 只接受 HTTP/HTTPS，拒绝 userinfo、控制字符、混淆空白、非法 percent encoding、无 host、
  Windows/UNC/device/drive-relative 路径和超长值。
- 使用 WHATWG URL/标准 IDNA；scheme/host 小写，移除默认端口和 fragment，规范 dot segment，
  保留 path/query 语义，不删 tracking、不排序 query、不升级 HTTPS、不请求 canonical link。
- domain 输入只允许 host；小写、IDNA、移除尾点，用 label-boundary 匹配，blocked 优先。
- 同一 batch 以 canonical URL 去重，保留每次 provenance appearance；不做作品级合并。

## 5. Adapter、Registry、Readiness 与 Plan

- `ModelWebSearchAdapter` 通过窄的 ModelExecution port，固定
  `BYPASS / NONESSENTIAL`，每 run 至多一个模型 execution，只解析 completed structured
  search event/source/citation，丢弃模型正文及其中 URL。
- `SearchApiAdapter` 仅有接口、Scripted codec/transport 和测试 loopback codec。
  产品 composition 不安装生产 codec，readiness 保持 `CODEC_UNAVAILABLE/NOT_CONFIGURED`。
- `CuratedSourceAdapter` 只读有限本地 catalog；模板只允许一个 percent-encoded placeholder，
  固定 scheme/host/path，外部请求为零。
- `BrowserClipAdapter` 只冻结有限输入合同/fixture，产品 readiness 为
  `PENDING_LATER_ISSUE`，不增加 Local API route。
- `ManualUrlAdapter` 只校验本地输入，不请求网络或模型。
- registry 只显式注册唯一 instance ID；总体 readiness 不能由 passive/interface-only adapter
  伪装为 active ready。plan 绑定 request/settings/capability/rate/budget 和过期时间；
  fallback 永远为 `NONE`。

## 6. migration v8 与持久化

- 只追加 migration v8 `search_provider_runs_and_rate_limits`；v1—v7 SQL、顺序和身份不变。
- 新增 `search_provider_configs`、`search_rate_limit_states`、`search_runs`、
  `search_result_candidates` 四张 STRICT 表。
- 表和仓储冻结 executionId 唯一、状态机/revision、有限 JSON、四个候选状态、FK/CHECK/UNIQUE、
  provider/status/time/URL hash 索引以及 query/raw response/secret/endpoint 不落库。
- v7→v8 保留全部既有数据；迁移继续使用备份、单事务、回滚、quick/foreign-key check。
- rate state 使用 `BEGIN IMMEDIATE` 原子领取，窗口和 nextAllowedAt 跨重启；429 只更新状态，
  不自动 sleep/retry。

## 7. 执行、Queue 与 Accounting

- `SearchExecutionService` 固定顺序：validate/hash → executionId → registry/readiness →
  plan binding → begin run → remote rate reservation → 单次事务外调用 → normalize →
  短事务保存 batch/candidates/rate settlement。
- 相同 executionId/相同请求返回既有终态；冲突 fail closed；每次远程 execution 至多一次
  attempt。只有可证明 pre-send 才可恢复；post-send 未知为 `AMBIGUOUS` 且不自动恢复。
- `SEARCH_EXECUTE_V1` payload 只保存有限 request/plan/binding identity，result 只保存 run ID、
  status、counts 和 stable error；不自动 enqueue。
- Model Web Search 通过 Issue 014 执行/预算/usage/cost 内核，预留 Web Search/tool 单位，
  Search 层不重复记账。Search API 无生产 codec/accounting 前不 READY；本地 adapter
  `NOT_INCURRED` 且不创建 model run/ledger/reservation。

## 8. UI、IPC、安全与测试

- 设置页显示五类 adapter、mode/readiness、capability/rate/budget/credential/feature 和总体状态；
  只允许 enabled、app-side rate policy、max results/timeout 和有限 Curated entries。
- 任务中心只显示 SearchRun 状态和 counts；不显示 query、preview、完整 URL、endpoint 或 secret。
- IPC 仅新增读取搜索状态和更新有限配置两个窄方法，并执行 exact-object、长度、枚举和 revision 校验。
- 新增 `npm run test:search` 并加入全量与 Windows CI；覆盖合同、URL/domain、候选、
  adapter/codec/transport、readiness/plan、rate/重启/并发、executionId/replay/ambiguous、
  migration v8、accounting、UI/IPC、Windows 路径、70 项 egress 和 smoke。
- 最终从最新 `npm ci` 开始按 CI 顺序执行全部门禁；任何修复后从该起点重跑。

## 9. 交付回填

- 已实现 `packages/search`、migration v8、SQLite 搜索仓储、`SEARCH_EXECUTE_V1`、桌面只读状态/
  有限设置 DTO 与 UI；没有结果抓取、真实 provider codec、插件业务 route 或自动入队。
- `npm run test:search` 最终验收为 8 个测试文件、48 项测试全部通过；全量 `npm test` 为
  90 个测试文件、959 项测试全部通过。
- `npm run test:electron-smoke` 与 `npm run test:packaged-smoke` 均通过；两种 Local API 模式的
  `externalConnections` 均为 0，端口均释放，已打包应用的 Electron fuses 校验通过。
- `npm run package:desktop` 与 `npm run audit:dependencies` 通过，依赖审计为 0 漏洞。
- 已从全新 `npm ci` 重跑全部门禁；提交前继续检查 diff、密钥/绝对路径/真实网络/费用、临时文件、
  进程/listener，随后创建唯一一个本地提交
  `feat(search): add unified search providers`。
- 不 push、不创建 PR、不合并、不进入 Issue 016。
