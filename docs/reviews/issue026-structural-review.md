# Issue 026 仓库内结构复核

## 范围与方法

本文件是 Project Control Recovery Phase 1 的仓库内结构复核，不是外部独立审计，也不重新执行
此前的只读项目健康审计。结论来自当前 Git 基线、Issue 026 指令与验收证据、v19 migration、
实际实现、测试脚本/CI 静态选择，以及既有四份审计输出的交叉核对。

本轮没有修改 Issue 026 产品代码、Schema、migration、IPC、preload、renderer 或运行时行为。

## 已验证事实

### Schema 与接口增量

- v19 创建 15 张表，同时重建既有 `quality_checks`，因此最终净新增 14 张业务表。
- v19 创建 50 个 index；扣除随 `quality_checks` 重建替换的既有 index，最终净新增 49 个。
- v19 新增 40 个 trigger。
- Issue 026 新增 7 个 IPC channel：列表、详情、Claim 链、检查预览/确认、人工 decision
  预览/确认。
- 这些数字来自 v19 SQL 与 Issue 026 parent/current diff 的静态重放口径，不把换行或本机路径
  当作身份依据。

### 单一事实来源

- 公开文本的权威输入仍是不可变 `DraftVersion`；事实语义的权威来源仍是 `Claim`，
  校验状态来自 `FactEvaluation`，可追溯材料来自 `Evidence` 与 `SourceRevision`。
- Fact Mapping 保存 locator、hash、分类、映射、依赖快照、版本与 decision；它没有保存第二份
  Draft 正文，也没有修改 Claim、Evidence、FactEvaluation 或研究事实。
- `quality_checks` 是面向质量流程的汇总桥接，不是新的事实正文或研究事实来源。

### Repository 职责

`packages/db/src/fact-mapping-repository.ts` 当前为 3,211 行，主要职责可静态分为：

1. DTO、分页、输入与状态校验；
2. Draft artifact 物化、候选 Claim/Evidence 上下文与 canonical entity 解析；
3. start plan、确认、队列 run 生命周期与崩溃恢复；
4. 不可变 check version、Statement、mapping、Evidence trace 与 dependency 发布；
5. 人工 decision 的预览、确认、撤销与 history；
6. list/detail/Claim chain 查询、精确失效与 query-plan 证据。

这些职责已有可识别边界，但 Phase 1 不拆文件、不改变事务边界或运行时行为。

### 测试选择

- `test:fact-mapping` 选择 12 个测试文件，其中 11 个是
  `tests/fact-mapping-*.test.*` 专属文件；另一个是共享 `tests/settings-ipc.test.ts`。
- 既有 Issue 026 本地证据报告 253 个测试用例。按测试文件静态分解，约 67 个来自 11 个
  Fact Mapping 专属文件，186 个来自共享 `settings-ipc`；后者约占该命令用例数的 73.5%。
- `settings-ipc.test.ts` 同时被 10 个专项脚本选择，因此在旧 CI 的“全部专项 + 全量 Vitest”
  编排中被重复执行多次。专项脚本本身仍有开发定位价值，不应删除。

## 静态推断

- Issue 026 没有建立第二套事实真相，但为 locator、候选集、版本、依赖、确认、队列与人工修订
  增加了较厚的外围 overlay；其主要风险是后续 Issue 复制相同结构，而不是当前事实来源漂移。
- 3,211 行 repository 可以在未来按“查询/上下文、plan/run、发布/依赖、人工 decision/read
  model”边界拆分，但只有在独立行为测试与事务不变量先固定后才适合实施。
- v19 的 14 张净新增表、40 个 trigger 与 7 个 IPC channel 显著超过 Phase 1 为未来 Issue
  建立的默认预算。该预算用于阻止继续复制此规模，不追溯否定已完成的 Issue 026。
- 单次全量 Vitest已覆盖所有 Vitest 专项文件；CI 继续先逐个运行全部专项，再运行全量，不增加
  独立环境信号，只增加调度与故障反馈成本。

## 未知

- 未使用真实用户内容或生产规模数据，因此不知道大型 Draft、长期 history 与高候选密度下的
  实际交互延迟和数据库增长曲线。
- 本复核没有运行性能基准、Electron/packaged/真实浏览器 smoke，也没有读取托管 CI 结果；
  这些结果不能由静态证据推断。
- 未进行外部独立代码复核；本文件不能替代该信号。
- Issue 027 的最终最小切片在获授权并完成需求/复用设计前未知，不能预先宣称会落在预算内。

## MUST_FIX_BEFORE_ISSUE_027

1. 根级 `AGENTS.md` 必须只有一套公共过程规则，并以开发、Issue、里程碑/Release 三层门禁为
   唯一权威验证模型。
2. CI 必须停止“全部重叠专项 Vitest + 全量 Vitest”的静态重复调度；专项脚本继续保留供按需
   定位，Electron 与 packaged smoke 保留为独立环境信号。
3. 后续 Issue 的生产 LOC、测试 LOC、净新增表、trigger、IPC、文件数、指令长度和核心验收
   必须受默认预算及 100%/150%/200% 暂停阈值约束。
4. Issue 027 开工前必须先定义“最小本地垂直切片”，证明复用 Draft/Claim/Evidence/
   FactEvaluation 与现有确认、队列、IPC 模式，不新增平行事实来源。
5. 对任何预计突破 200% 的范围，必须先拆分，或取得外部复核及用户重新授权；本次仓库内复核
   不冒充该外部复核。

## DEFERRED_WITH_REASON

- **物理拆分 `fact-mapping-repository.ts`**：可分组但不阻塞当前正确性；现在拆分会触及事务、
  recovery 与 read model，超出纯治理范围。
- **合并历史 migrations 或压平 v19 表结构**：已发布 migration 不可变；只能在单独获授权的
  新 migration/架构任务中演进。
- **抽取跨领域 confirmation broker、validator 或 read-model 基类**：存在相似形态，但尚未
  证明抽象能减少整体复杂度且不弱化边界校验。
- **性能压测与真实内容旅程**：需要明确的合成规模模型或获授权数据策略；Phase 1 禁止读取
  真实用户内容，也不修改产品运行时。
- **Fact Mapping UI 的视觉与文案整理**：不是 Issue 027 前的结构阻塞项，且 Phase 1 明确禁止
  修改 renderer 业务页面。

## 结论

Issue 026 的核心事实源保持正确，主要治理风险是外围结构规模与重复验证编排。Phase 1 的适当
处置是冻结扩张方式、建立预算和三层门禁、去除 CI 的可证明重复；不回写 Issue 026、不进入
Issue 027。下一步仍应是经用户单独授权的最小本地垂直切片。
