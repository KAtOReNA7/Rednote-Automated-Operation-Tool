# M2 Issue 020 实施计划：版本化研究档案、覆盖度与增量重建

状态：Issue 020 实现与当前 CI 全部门禁完成，等待创建唯一一个本地提交。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现，开工分支为 `main`。
- 开工 HEAD 为 `041c2a289d408d481212d3d24253d9360dae30ec`；本地合法领先
  `origin/main` 两个已完成 Issue 的提交，不执行 pull、rebase、reset 或 push。
- 工作树开工时干净；唯一新增文件是随后按本 Issue 指令归档的执行指令。
- 当前 migration 尾部由运行时发现为 v12；Issue 019 的 SourceRevision、AtomicClaim、
  EvidenceLocator、FactEvaluation、Conflict 与 `FACT_BLOCKED` 能力存在。
- 指令已从桌面原位置移动到 `docs/instructions/m2/`，内容哈希保持一致，原位置不留副本。

## 目标与完成定义

1. 建立 provider-neutral、严格验证的 Research Dossier V1 合同。
2. 只从当前 Claim、Evidence、FactEvaluation 和 Conflict 构建
   `CONSENSUS / DISPUTED / GAP`。
3. 以整数 basis points 实现固定版本 CoveragePolicy 与只读 readiness。
4. 为每个版本保存精确依赖边，按索引标记受影响档案为 `REBUILD_REQUIRED`。
5. 提供 deterministic preview、短期显式确认、ID-only 队列任务、幂等 publish、
   no-op、取消、失败、竞争和恢复语义。
6. 安全扩展现有 `research_dossiers` 聚合根并保留全部历史版本与旧数据。
7. 在 Research 页面提供分页档案列表、版本、章节、追溯、覆盖度、缺口、历史 diff
   与重建控制。
8. 新增 `test:dossier`，纳入全量测试和 Windows CI；全部门禁通过后只创建一个本地提交。

## 允许修改

- `packages/dossier` 的合同、validator、确定性选择、coverage、readiness 与 hash。
- `packages/db` 的下一条连续 migration、Dossier repository 与受控 Evidence 只读查询。
- `packages/workflows` 的 `DOSSIER_BUILD_V1` 本地 handler。
- `packages/shared`、Electron main/preload/IPC 与 `apps/web-ui` 的窄 DTO 和 Research UI。
- Issue 020 专项测试、CI/package scripts、合同、ADR、计划、验收映射与活跃文档。

## 禁止范围

- 不进入 Issue 021；不新增阅读状态、真实性等级或第一人称授权。
- 不写入选题、实验、brief、草稿、审核、审批、发布包或 publication。
- 不创建或修改 Claim、Evidence、FactEvaluation 或 Conflict。
- 不自动执行 Search、Fetch、Clip、Catalog discovery 或 Source processing。
- 不读取页面、URL、任意文件、完整 snapshot、真实密钥；不调用真实模型或业务网络，
  不产生费用。
- AI、版权和 publication relationship 不进入 coverage/readiness。

## 实施顺序

1. 归档指令，记录动态基线，建立本计划和连续验收映射。
2. 新增 `packages/dossier`，冻结 section、gap、dependency、build、coverage 和 readiness
   合同与 exact-object validator。
3. 实现 deterministic projection、stable semantic key 去重、整数 CoveragePolicy、
   input hash 和 readiness。
4. 追加下一条连续 migration，在现有聚合根上建立版本、章节、条目、依赖、coverage、
   gap、plan、run、invalidation 与 append-only audit。
5. 实现 SQLite repository 的分页读取、preview、confirm、publish、no-op、expected revision、
   精确失效与历史 diff。
6. 注册 `DOSSIER_BUILD_V1` handler，保持 ID-only payload、executionId 幂等、同主体单 active
   build、取消/恢复和有限事务。
7. 接入 desktop runtime、短期 sender/window token、exact-object IPC/preload 与 Research UI。
8. 补齐 gold fixture、合同、policy、migration、repository、capacity、workflow、renderer、
   IPC、egress 和 governance 测试。
9. 同步 README、AGENTS、Roadmap、合同、ADR、文档与 CI，指向 Issue 021。
10. 从最新 `npm ci` 开始按 CI 顺序运行全部适用门禁；修复根因后从该起点重跑。
11. 审计 diff、敏感信息、进程/listener、起点 parent 与远端状态，创建唯一一个本地提交并停止。

## 架构与并发原则

- `packages/dossier` 不依赖 Electron、SQLite、网络或模型。
- Dossier 通过 Issue 019 `fact_subjects` 的真实复合外键绑定 Work、Expression 或 Edition。
- 历史 version/section/entry/dependency/coverage/gap 发布后不可变；聚合根只通过 expected
  revision 原子切换 current pointer。
- preview 读取有限输入并生成 deterministic snapshot；publish 在事务内重新计算输入
  identity，输入变化即 fail closed。
- invalidation 只按依赖索引查找 current version，不执行全库 all-pairs；重复事件以唯一
  event identity 幂等。
- build 失败或取消只结束 run，不替换 current version；相同 input hash 的 rebuild 为 no-op。
- 可选模型摘要本轮不实现，纯本地构建在未配置模型时完整可用。

## 停止点

Issue 020 全部门禁通过并创建唯一一个本地提交后立即停止；不 push、不创建 PR、不进入
Issue 021。
