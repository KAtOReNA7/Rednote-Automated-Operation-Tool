# M3 最小本地垂直切片证据

## 1. 结论与动态起点

- 任务性质：Issue 027 前的恢复性垂直切片，不是 Issue 027。
- 动态仓库根：由 `git rev-parse --show-toplevel` 发现。
- 分支：`main`。
- 任务起点 HEAD：`f45ab44aebfe4a047d794dff2a39e3ec85663639`。
- 起点 `origin/main`：`5959e5b157ac91a6e8773834b48df3367f0fad9c`。
- 起点关系：本地 `main` 合法领先 `origin/main` 2 个既有提交。
- 可行性结论：`VERTICAL_SLICE_FEASIBLE_WITHIN_BUDGET`。
- 验证收口结论：`VERTICAL_SLICE_VALIDATION_COMPLETE`。第一次全量 Vitest 属于不可观测结果；
  经增量授权进行的可观测全量运行定位 2 个失败，采用“全量其余结果 + 失败文件精确复跑 +
  测试期望修复后精确复跑”的组合证据完成验证，Electron source smoke 随后通过。
- 完整静态盘点：
  `docs/reviews/minimal-local-vertical-slice-plan.md`。

精确测试与最终组合门禁为一条使用完全合成内容、人工步骤和既有确定性处理的本地路径提供了
行为证据。本切片达到当前恢复任务的完成定义；它仍不证明真实 Provider、真实搜索、真实网页、
真实内容生产或生产可用性。

## 2. 生产 UI、service 与 repository 路径

| 阶段                      | 用户动作与处理性质                                | 生产边界                                                                | 持久化真相与 lineage                                                |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 合成研究输入              | 用户在资料研究页手工填写空白表单                  | `ResearchPage` → preload → 2 个 evidence IPC → `DesktopEvidenceRuntime` | 表单不是真相源；确认后才写既有 catalog/evidence 真相                |
| Work                      | 确定性规范化合成 Observation                      | `SqliteCatalogRepository.insertSyntheticObservation`                    | 既有 Work、Agent 与 Observation link                                |
| SourceRevision            | 用户预览后显式确认，本地确定性写入                | `LocalFileRepository` + `SqliteEvidenceRepository.registerSource`       | 受控 `SOURCE_SNAPSHOT` 与既有 SourceRevision                        |
| Claim/Evidence/Evaluation | 从用户原文逐字定位标题、作者、日期                | 既有 `createClaim`、`addEvidence`、`reconcileClaim`                     | 3 条 MANUAL Claim、Unicode locator、Evidence、FactEvaluation        |
| Dossier                   | 用户在既有研究档案工作台预览并确认构建            | 既有 Dossier service/repository                                         | Dossier entry 引用 Claim、Evaluation、Evidence、SourceRevision      |
| 阅读真实性                | 用户在书库明确选择 S1 公开资料研究路径            | 既有 Authenticity UI/runtime/repository                                 | S1 permission snapshot；第一人称保持阻断                            |
| Topic                     | 用户在选题池生成后单独 lock                       | 既有 Topic UI/runtime/repository                                        | Topic version 固定 Dossier 与 permission 依赖                       |
| Content Brief             | 用户从 locked Topic 建 scaffold 并手工补全        | 既有 Brief UI/runtime/repository                                        | Brief version、字段 provenance/lock 与既有依赖                      |
| Draft/CopyVersion         | 用户建立 manual scaffold 并手工填写短文案         | 既有 Copy UI/runtime/repository                                         | Draft/CopyVersion 是公开文本 artifact 真相                          |
| Fact Mapping              | 用户选择 `LOCAL_MANUAL`，再人工映射日期 Statement | 既有 Fact Mapping UI/runtime/repository                                 | 新不可变检查版本回溯 Claim → Evaluation → Evidence → SourceRevision |
| 重开读取                  | 关闭 SQLite 连接后重新连接                        | 各既有只读 repository                                                   | Dossier、Topic、Brief、Copy、映射决定与 managed file 均可重新读取   |

页面始终标记：

- 手工输入；
- 完全合成；
- 本地持久化；
- 模型未使用；
- 外部请求 0。

确认只创建上游研究记录。Dossier、S1、Topic、Brief、Draft 和 Fact Mapping 没有一键执行，
仍需用户在各自既有工作台逐步操作。

## 3. 合成内容与测试路径

垂直测试只使用一份不对应真实图书、作者或出版社的中文合成资料：

- 虚构作品：`雾港七号钟楼（合成作品）`；
- 虚构作者：`虚构作者甲`；
- 虚构日期：`2099-04-17`；
- 仅包含一张短资料卡和一段短 Draft；
- 没有复制真实作品正文、个人信息、业务数据或密钥。

测试路径使用：

- 从仓库根动态派生的同卷 `.rednote-temp`；
- 临时 ProjectDataRoot；
- 临时 SQLite；
- 真实 production runtime/service/repository；
- `LOCAL_MANUAL` Fact Mapping；
- 阻断式 `fetch` guard；
- 关闭并重新打开 SQLite 后的读取断言。

测试没有使用 SQL seed 注入生产演示数据。SQL 只用于测试内的 schema 身份快照、计数、
外键检查和读取已由生产 service 写入的受控 managed path。

## 4. 关键行为证据

垂直集成测试证明：

1. 原文缺少所需 locator 时，预览以 `EVIDENCE_INVALID_LOCATOR` 失败，Source 与 Claim 计数仍为
   0。
2. confirmation token 绑定 sender/window；错误 sender 无法确认。
3. 合法预览回显 3 个 Unicode code-point locator、模型请求 0、外部请求 0、费用未发生。
4. 确认后只产生 1 个现有 Work、1 个 SourceRevision、3 个 Claim、3 个 Evidence 与 3 个
   VERIFIED FactEvaluation。
5. Dossier 达到 `READY_FOR_CONTENT_BRIEF`，每个 entry 保留 Claim、Evaluation、Evidence 与
   SourceRevision identity。
6. 未确认 S1 前 Topic 输入为空；用户明确确认 S1 后才产生 eligible Topic。
7. S1 权限为 `RESEARCH_ONLY`，第一人称保持 `BLOCKED`。
8. Topic 由用户单独 lock；Brief 和 Copy 由用户手工补齐。
9. Draft 中的日期 Statement 由用户人工映射到 publication-date Claim。
10. 人工决定发布新的不可变 Fact Mapping 版本与新 Statement identity。
11. 最终 chain 精确回溯到 VERIFIED Evaluation、唯一 Evidence 与 SourceRevision，DTO 不暴露
    URL、managed path 或绝对路径。
12. 关闭并重开数据库后，chain、Dossier、Topic、Brief、Copy 与受控 Source 文件仍可读取。
13. schema 的 table/trigger 身份前后完全一致，`foreign_key_check` 为空。
14. `model_runs` 与 `cost_ledger` 均为 0，`fetch` guard 调用次数为 0。

renderer 专项测试另行证明：

- 表单初始为空，不自动制造样例；
- 五个执行边界标签可见；
- preview 与 confirm 分离；
- preview DTO 和 confirm DTO 均使用有限字段；
- 确认后的稳定结果卡显示 Work、SourceRevision 和 3 条 VERIFIED 状态。

## 5. VS01—VS14 验收映射

| ID   | 结论   | 证据                                                                                                 |
| ---- | ------ | ---------------------------------------------------------------------------------------------------- |
| VS01 | 已证明 | 可行性计划第 3 节逐段记录 Domain、Schema、service、IPC、renderer、真相源、模型要求与缺口             |
| VS02 | 已证明 | 空白生产表单经 preload/IPC/runtime 写入；renderer 与垂直测试覆盖 preview/confirm                     |
| VS03 | 已证明 | 垂直测试查询既有 Work、Source、Claim、Evaluation、Dossier、Topic、Brief、Copy、Fact Mapping identity |
| VS04 | 已证明 | 无新 schema；Draft/Claim/Evidence/Evaluation 正文仍由既有真相表与 managed storage 承载               |
| VS05 | 已证明 | UI 五项标签、preview 计数与合成 origin/provenance                                                    |
| VS06 | 已证明 | 单个垂直测试贯通输入到可审阅 `LOCAL_MANUAL` Fact Mapping                                             |
| VS07 | 已证明 | `getClaimChain` 断言 Draft Statement → Claim → FactEvaluation → Evidence → SourceRevision            |
| VS08 | 已证明 | 测试关闭并重新连接 SQLite 后读取同一 chain 与全部主要阶段                                            |
| VS09 | 已证明 | locator 缺失、错误 sender 与 S1 未确认均保持真实失败或无 eligible Topic                              |
| VS10 | 已证明 | table/trigger 快照一致；package/lockfile diff 为空                                                   |
| VS11 | 已证明 | 仅 2 个新 IPC；exact-object policy、origin 与 sender/window 测试覆盖                                 |
| VS12 | 已证明 | 合成 fixture、fetch guard、0 model run、0 cost ledger；未读取真实密钥                                |
| VS13 | 已证明 | 本文记录预算、命令次数、人工步骤、测试路径与未证明范围                                               |
| VS14 | 已证明 | diff 不含 Issue 027、新质量类型、质量编排、审批、导出、发布或图片能力                                |

## 6. 预算与范围审计

以下口径按 Git diff 计算，文档不计入 production/test LOC：

| 指标                    |  上限 |          当前实际 |
| ----------------------- | ----: | ----------------: |
| production 新增 LOC     | 1,200 |               890 |
| test 新增 LOC           |   900 |               768 |
| 净新增业务表            |     0 |                 0 |
| 新增 trigger            |     0 |                 0 |
| 新增 package/dependency |     0 |                 0 |
| 新增 IPC channel        |     2 |                 2 |
| 变更文件                |    20 |      20（含本文） |
| 核心验收                |    14 | 14 项均有行为证据 |

## 7. 验证命令与次数

| 命令                                                                                                               | 累计次数 | 当前结果                                               |
| ------------------------------------------------------------------------------------------------------------------ | -------: | ------------------------------------------------------ |
| `node scripts/run-portable-vitest.mjs run tests/minimal-local-vertical-slice.test.ts`                              |        5 | 前 4 次逐步修正测试与权威合同不一致；第 5 次 1/1 通过  |
| `npm run test:evidence`                                                                                            |        1 | 243/244 通过；唯一 renderer 稳定 notice 断言已修正     |
| `node scripts/run-portable-vitest.mjs run tests/evidence-renderer.test.tsx`                                        |        1 | 4/4 通过                                               |
| `npm run format-check`                                                                                             |        2 | 第 1 次仅格式失败；格式化后第 2 次通过                 |
| `npm run lint`                                                                                                     |        2 | 第 1 次 3 个 control-regex 错误；精确修复后第 2 次通过 |
| `npm run typecheck`                                                                                                |        1 | 通过                                                   |
| 首次 `npm run test`                                                                                                |        1 | 9 分 57 秒后 exit 1；摘要丢失且缓存未更新，不可观测    |
| 可观测 `npm run test -- --reporter=default --reporter=json --outputFile.json=…`                                    |        1 | exit 1；197/199 文件、1622/1624 测试通过，2 个明确失败 |
| `node scripts/run-portable-vitest.mjs run tests/fact-mapping-capacity.test.ts tests/settings-architecture.test.ts` |        1 | 容量文件通过；settings 固定 channel 数期望仍失败       |
| `node scripts/run-portable-vitest.mjs run tests/settings-architecture.test.ts`                                     |        1 | 单行期望修复后 6/6 通过                                |
| `npm run test:electron-smoke`                                                                                      |        1 | exit 0；37.429 秒，stderr 0，外部连接 0，端口均释放    |

第一次全量运行只证明命令最终为 `exit 1`，没有失败文件身份或本轮结果缓存，因此记录为
`VALIDATION_OBSERVABILITY_FAILURE`，不伪称具体测试失败。增量授权后的可观测运行把 stdout、
stderr、命令、UTC 起止时间、整体时长和结构化 JSON 写入 Git 忽略的临时目录；Vitest 报告耗时
694.43 秒，明确定位：

1. `tests/fact-mapping-capacity.test.ts` 在全量负载下触发默认 5 秒超时；精确复跑该文件通过，
   未修改 Issue 026 代码或测试。
2. `tests/settings-architecture.test.ts` 仍期望 87 个固定 channel，而本任务获准增加 2 个固定
   IPC 后合同总数为 89。仅把该安全计数期望更新为 89，其他唯一性、preload 一一对应和禁止 raw
   IPC 的断言均保持不变；修复后该文件 6/6 通过。

由于唯一 tracked 修复只是测试期望，最终证据按授权由可观测全量中的 197 个通过文件、容量文件
精确复跑通过、settings 文件修复后精确复跑通过共同组成，不再运行第二次全量。Electron source
smoke 在当前现场构建并启动 source 应用，disabled/enabled 两种本地 API 模式的
`externalConnections` 均为 0，进程退出后端口均释放。

未运行且本任务禁止：`npm ci`、desktop/clipper package、packaged smoke、真实浏览器 smoke、
dependency audit、里程碑或 Release 门禁。

## 8. 外部能力与未证明范围

本任务保持：

- 真实密钥读取 0；
- 真实 Provider/API 调用 0；
- 模型调用 0；
- Search、Fetch、Browser Clip、图片调用 0；
- 外部业务连接 0；
- 费用 `NOT_INCURRED`。

尚未证明：

- 任意真实 Provider 或真实 AI 集成；
- 真实 SearchProvider、真实 Fetch 或真实公开页面；
- 真实图书、作者、出版社或真实内容质量；
- 自动编排整条内容链路；
- Issue 027—030；
- 图片、审批、导出、发布或小红书平台自动化；
- 生产部署、安装器或生产可用性。

本任务已完成并在此停止，不进入 Issue 027。未来是否开展 Issue 027 仍需单独、明确且收窄的用户
授权。
