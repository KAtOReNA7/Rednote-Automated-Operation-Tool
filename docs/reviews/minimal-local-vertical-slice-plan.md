# M3 最小本地垂直切片可行性与实施计划

## 1. 审计结论

- 结论：`VERTICAL_SLICE_FEASIBLE_WITHIN_BUDGET`
- 动态起点：本地 `main`，任务开始 HEAD
  `f45ab44aebfe4a047d794dff2a39e3ec85663639`；`origin/main`
  `5959e5b157ac91a6e8773834b48df3367f0fad9c`；本地合法领先 2 个提交。
- 开工工作树：干净。任务指令已从桌面唯一移动到
  `docs/instructions/governance/M3-minimal-local-vertical-slice-Codex-instruction.txt`。
- 本盘点仅静态读取代码、Schema、合同、IPC 和 renderer；编码前没有运行测试、构建、打包或
  smoke。
- 不需要进入 Issue 027，也不需要真实 Provider、Search、Fetch、Browser Clip、模型、密钥、
  业务网络或费用。

现有生产链路已经覆盖 Dossier、阅读真实性权限、Topic、Content Brief、Draft/CopyVersion 和
Fact Mapping。唯一阻断普通用户从空项目开始闭环的缺口，是研究页没有一个受控入口把用户手工输入
的完全合成材料写入既有 Work、SourceRevision、Claim、Evidence 和 FactEvaluation 真相表。
该缺口可由一个窄的“合成本地研究输入”预览/确认桥接补齐，后续每一步仍由用户在既有页面分别操作，
不会出现一键伪造整条链路。

## 2. 范围和停止边界

允许：

- 在既有研究页增加 1 个明确标注“手工输入 / 完全合成 / 本地持久化 / 未使用模型”的小面板。
- 增加严格 DTO、预览与二次确认，共 2 个 IPC channel。
- 复用现有 catalog、storage、evidence repository，把 1 个合成 Work、1 个 SourceRevision、
  3 个原子事实及其 Evidence/FactEvaluation 写入现有真相表。
- 复用既有 UI 完成 S1 权限确认、Dossier 构建、Topic 生成与 lock、Brief scaffold 与手工补全、
  Draft 手工补全、LOCAL_MANUAL Fact Mapping 和人工映射审阅。
- 增加一个小型垂直集成测试与事实证据文档。

禁止：

- Issue 027—030、任何新质量类型、审批、导出、发布或图片能力。
- 新业务表、migration、trigger、package、依赖或通用 orchestrator。
- 新建 Draft/Claim/Evidence/FactEvaluation/body 真相源或复制正文。
- 真实 Provider、Search、Fetch、Clip、网页、模型/API 调用、密钥读取或费用。
- 自动替用户生成 Topic 之后的判断、Brief、标题、正文或事实结论。

停止点：14 项核心验收全部有真实证据后创建唯一一个本地提交；若实施中发现预算超过 150%、
生产 UI 无法到达可审阅 Fact Mapping，或必须突破上述禁止项，则停止且不创建完成提交。

## 3. 逐段静态能力盘点

每一行只使用一个规定状态。

| 链路步骤                          | 状态                    | Domain / 合同                                                                | Schema 真相                                                                             | Repository / service / workflow                                                         | IPC / preload                                          | renderer 入口                                 | 单一真相与 lineage                                                                                           | 模型要求                    | 最小缺口                                                                                        |
| --------------------------------- | ----------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------- |
| 用户输入                          | `NEEDS_THIN_BRIDGE`     | 可沿用 catalog observation 与 evidence 合同；需新增有界 synthetic intake DTO | 不新增表                                                                                | 需在 `DesktopEvidenceRuntime` 增加窄预览/确认服务                                       | 新增 preview + confirm 2 个 channel，exact-object 校验 | 既有研究页增加小表单                          | 表单只承载输入，不成为持久化真相                                                                             | 无                          | 收集合成标题、作者、日期、来源标题与短原文，并要求显式二次确认                                  |
| Work 身份                         | `NEEDS_THIN_BRIDGE`     | `BibliographicObservationV1`、规范化与确定性 observation identity 可复用     | `bibliographic_observations`、`books`、`expressions`、`book_editions`、`catalog_agents` | `SqliteCatalogRepository.insertSyntheticObservation` 可复用；补一个只读 resolution 查询 | 随同同一 confirm，不增加 channel                       | 研究页回显 `workId`，书库页已有 Work 入口     | catalog 实体与 observation link 是唯一身份真相；本地 synthetic platform id 仅防重放                          | 无                          | 将用户字段组装为明确标注 synthetic 的 observation，并取回既有解析出的 Work/author identity      |
| Source / SourceRevision           | `NEEDS_THIN_BRIDGE`     | `RegisterSourceInputV1`、Source classification、managed path 合同可复用      | `sources`、`source_revisions`、`source_classifications`                                 | `LocalFileRepository.putBuffer` 与 `SqliteEvidenceRepository.registerSource` 可复用     | 随同同一 confirm                                       | 研究页现有 Source inbox/list 负责重开后的展示 | 原文只保存于受控 `SOURCE_SNAPSHOT`；DB 只保存 hash 与 managed relative path                                  | 无                          | 把短合成原文作为 content-addressed managed file 写入，并注册 synthetic revision                 |
| Evidence / Claim / FactEvaluation | `NEEDS_THIN_BRIDGE`     | `AtomicClaimV1`、Unicode `EvidenceLocatorV1`、fact-policy-v1 可复用          | `fact_subjects`、`claims`、`claim_evidence`、`fact_evaluations`                         | `registerSubject`、`createClaim`、`addEvidence`、`reconcileClaim` 可复用                | 随同同一 confirm                                       | 研究页现有 Atomic facts 列表                  | Claim 保存结构化值；Evidence 保存精确 excerpt/locator；Evaluation 引用 Claim 和来源 revision；不复制来源正文 | 无                          | 从用户原文中精确定位 title/author/date 三段，创建 3 条 MANUAL 原子事实并确定性评估              |
| Dossier                           | `REUSABLE_AS_IS`        | `DossierBuildPlan` 与 projection/readiness 合同已存在                        | `research_dossiers`、versions、entries、dependencies、coverage                          | `DesktopDossierRuntime` + 本地 queue/worker 已存在                                      | list/get/preview/confirm/cancel/diff 已存在            | 研究页 `DossierWorkspace`                     | Dossier entry 引用 Claim、FactEvaluation、Evidence、SourceRevision，不复制研究真相                           | 无                          | 无代码缺口；用户粘贴回显 `workId`，预览并确认构建                                               |
| 阅读真实性与表达权限              | `MANUAL_INPUT_REQUIRED` | R1/R2/R3/S1/S2、permission snapshot 与 spoiler policy 已存在                 | `reading_states`、permission snapshots 与 invalidations                                 | `DesktopAuthenticityRuntime` 已存在                                                     | get/list/preview/confirm 已存在                        | 书库 `AuthenticityLibrary`                    | 当前 permission snapshot 是 Topic/Brief 的权限真相                                                           | 无                          | 用户应对完全合成作品选择诚实的 S1 公开资料研究路径并确认；不得伪装为亲自阅读                    |
| Topic                             | `REUSABLE_AS_IS`        | 五类 Topic、eligibility、state 与 deterministic generation 已存在            | `topic_candidates`、versions、dependencies、generation runs                             | `DesktopTopicRuntime` + 本地 worker 已存在                                              | list/get/preview/confirm 已存在                        | 选题池页面                                    | Topic version 固定 Dossier version、permission snapshot 和 policy versions                                   | 无                          | 无代码缺口；用户生成后选择 eligible Topic 并单独 lock                                           |
| Content Brief                     | `MANUAL_INPUT_REQUIRED` | 五类 Brief、field provenance/lock、Evidence map、readiness 已存在            | `content_briefs`、versions、dependencies、evidence refs                                 | `DesktopBriefRuntime` 的 local scaffold/save 已存在                                     | list/get/preview/confirm 已存在                        | 内容生产页                                    | Brief 引用 Topic version、Dossier/Evidence 与 permission snapshot；Experiment 可为 null                      | 无                          | 用户从 locked Topic 创建 scaffold，手工补齐受众、判断、论点/反方、Evidence 映射和限制并确认保存 |
| Draft / CopyVersion               | `MANUAL_INPUT_REQUIRED` | `ContentDraftPayloadV1`、结构验证与人工 provenance 已存在                    | `drafts`、`copy_draft_versions` 及 lineage 表                                           | `DesktopCopyRuntime` 的 manual scaffold/save 已存在                                     | list/get/preview/confirm/diff 已存在                   | 文案工作台                                    | Draft version 是公开文本 artifact 真相；lineage 指向 Brief/work/evidence allowlist                           | 无                          | 用户手工填写短标题、正文块、标签和置顶评论；不调用生成或改写                                    |
| Fact Mapping / 本地审阅           | `MANUAL_INPUT_REQUIRED` | Unicode Statement、分类、Claim mapping、decision 与 rollup 已存在            | `fact_mapping_*` 版本、statement、mapping、decision、dependency 表                      | `DesktopFactMappingRuntime` 的 `LOCAL_MANUAL` start 与人工 decision 已存在              | list/get/chain/preview/confirm 已存在                  | 事实映射工作台                                | Statement locator 指向不可变 DraftVersion；Claim chain 回溯 FactEvaluation → Evidence → SourceRevision       | 无；必须选择 `LOCAL_MANUAL` | 用户启动本地检查，逐条确认分类、映射 Claim，并展开证据链审阅                                    |
| 关闭/重开与追溯                   | `REUSABLE_AS_IS`        | 各版本合同均有 stable identity/revision                                      | 全部数据在项目 SQLite 与 managed storage                                                | 各 list/get repository 从持久化真相重建视图                                             | 既有只读 IPC                                           | 各既有工作台重新加载                          | 不依赖 renderer 内存；confirmation token 仅短期驻内存且不作为业务真相                                        | 无                          | 新增集成测试证明关闭 DB、重新打开后仍能沿 lineage 查询                                          |

## 4. 最薄桥接设计

1. `previewSyntheticResearchIntake`
   - exact-object DTO；所有字符串 trim、NFC、长度和日期格式校验。
   - 要求短原文逐字包含标题、作者和日期，预览 3 个 Unicode code-point locator。
   - 回显 0 外部请求、0 模型请求、0 费用、预计本地写入和 synthetic/manual 标签。
   - 生成绑定当前窗口、短期 token、preview hash 与稳定 input hash；预览不写业务数据。
2. `confirmSyntheticResearchIntake`
   - 只接受固定确认字面量和同窗口 token/hash。
   - 先把短原文写入 content-addressed `SOURCE_SNAPSHOT`，再复用 catalog/evidence repository。
   - identity 从规范化输入 hash 派生，重复同一输入可恢复/重放，不另建 truth。
   - 创建 1 个 Work identity、1 个 SourceRevision、3 个 MANUAL Claim、3 个 Unicode Evidence
     locator 和 3 个确定性 FactEvaluation。
   - 返回现有实体 ID 和状态；后续 Dossier、权限、Topic、Brief、Draft、Fact Mapping 必须由用户
     在各自既有 UI 分别操作。
3. 研究页
   - 空白输入而非自动造数据；提供完全合成示例格式提示。
   - 明确标识：`手工输入`、`完全合成`、`本地持久化`、`模型未使用`、`外部请求 0`。
   - 显示 `workId`、`sourceRevisionId`、Claim/FactEvaluation 状态，以及书库、Dossier、选题池、
     内容生产和 Fact Mapping 的现有页面导航提示。

## 5. 编码预算预测

| 指标                   |     硬上限 |       预测 | 结论          |
| ---------------------- | ---------: | ---------: | ------------- |
| production LOC         |       1200 |   900—1050 | 75%—88%，满足 |
| test LOC               |        900 |    450—650 | 50%—72%，满足 |
| net business tables    |          0 |          0 | 满足          |
| triggers               |          0 |          0 | 满足          |
| new IPC channels       |          2 |          2 | 满足          |
| changed/added files    |         20 |      15—18 | 满足          |
| new package/dependency |          0 |          0 | 满足          |
| core acceptance        | exactly 14 | exactly 14 | 满足          |

预计涉及：共享 DTO/API、catalog/evidence repository 的窄复用补口、desktop evidence/settings/IPC/
preload、研究页与样式、1 个垂直集成测试、README、计划与证据文档、已归档指令。不会新增
migration、package 或通用工作流框架。

所有编码许可条件均满足：

1. 无新业务表或 trigger；
2. 无新 package 或 dependency；
3. 新 IPC 精确为 2；
4. 沿用既有 Draft/Claim/Evidence/FactEvaluation/body 真相；
5. 预测未达到任一预算 100%，更未超过 150%；
6. 生产 UI 可通过若干明确的人工步骤到达可审阅 Fact Mapping。

## 6. 14 项核心验收草案

以下仅是实施前映射，不预填 PASS；最终证据必须逐项回填具体代码、测试或命令。

| ID   | 验收目标                                                        | 计划证据                                    |
| ---- | --------------------------------------------------------------- | ------------------------------------------- |
| VS01 | 完整逐段能力盘点                                                | 本文第 3 节                                 |
| VS02 | 普通生产 UI 可录入完全合成材料                                  | 研究页 synthetic intake + renderer/集成证据 |
| VS03 | 复用既有 Work/Source/Claim/Evidence/Evaluation identity         | catalog/evidence repository 查询与垂直测试  |
| VS04 | 不新增或复制业务真相                                            | Schema diff、引用链与 LOC/DDL 审计          |
| VS05 | manual/synthetic/local/model-unused 标签准确                    | UI、preview DTO 与测试断言                  |
| VS06 | 正常生产路径贯通至 Fact Mapping                                 | 垂直集成测试与人工路径记录                  |
| VS07 | Statement 可追溯到 Claim→FactEvaluation→Evidence→SourceRevision | claim-chain 断言                            |
| VS08 | 关闭并重开后数据仍可查询                                        | 临时 SQLite reopen 断言                     |
| VS09 | 缺字段、locator 不匹配或状态不满足时诚实阻塞                    | exact validator 与负向测试                  |
| VS10 | 0 新表、0 trigger、0 package/dependency                         | migration/schema/package diff 审计          |
| VS11 | 新 IPC ≤2 且保持 sender/origin/exact DTO 安全                   | channel diff、IPC policy 测试               |
| VS12 | 外部请求、模型调用、密钥读取、费用均为 0                        | loopback/egress guard 与 runtime 计数断言   |
| VS13 | 最终报告只陈述已证明能力和未证明边界                            | 最终 evidence/report                        |
| VS14 | 未进入 Issue 027 或新增质量框架                                 | Git diff 与引用审计                         |

## 7. 验证顺序与限次

编码完成后才运行：

1. 新增垂直集成测试，最多一次初跑；若为本任务根因，精确修复后最多重跑一次。
2. 直接相邻的 IPC/evidence/fact-mapping 专项各最多一次，只有任务根因才精确重跑。
3. `npm run format-check` 一次；仅格式问题允许一次修复重跑。
4. `npm run lint` 一次。
5. `npm run typecheck` 一次；仅任务根因允许一次修复重跑。
6. 前述全部通过后，完整 Vitest 最多一次。
7. 仅因本任务改变 desktop/preload/IPC，source Electron smoke 最多一次。

不运行 `npm ci`、desktop/clipper 打包、packaged smoke、真实浏览器、dependency audit 或 release
门禁；不通过跳过、弱化或隐藏失败取得绿色结果。
