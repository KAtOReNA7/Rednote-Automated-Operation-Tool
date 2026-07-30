# M3 Issue 025 实施计划：版本化文案生成与局部重写

状态：实现与最终全量门禁已完成；本文件随唯一本地提交固化。Issue 026 未开始。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现，分支为 `main`。
- 开工 HEAD、本地 `origin/main` 与只读远端 `main` 均为
  `e23f9b9df46be5e14a8d6e06c20b63a14ba6668e`，开工工作树干净。
- Issue 025 指令从 Desktop 字节不变地唯一移动到 `docs/instructions/m3/`；SHA-256 为
  `1DE1E439D27E144F03398FF33F0297AD505D18D2611DCE6C6CE2769B7A911B0A`，源位置已不存在。
- migration 尾部由运行时发现为 v17；本 Issue 只追加 v18，不改变已发布 migration。
- 开发期间不执行 pull、rebase、reset、push、PR 或合并。

## 目标与完成定义

1. 在既有 Draft identity 上建立不可变 DraftVersion 与唯一 current head。
2. 生成并保存五类 profile 的标题、正文 block、标签、置顶评论与实际 spoiler warnings。
3. 继承账号文风、Brief lineage、R1/R2/S1、评分来源、公开标签、实验与受控条件。
4. 保留手工 Draft，并实现单请求完整生成、有限 scope 局部重写、lock 与 scope preservation。
5. 保存 contract/prompt/model/style/policy 版本、executionId、hash、run、transition 与 audit。
6. 实现确定性结构验证；合法产物只进入 `READY_FOR_QUALITY_PIPELINE`。
7. 追加连续 migration v18，保守升级旧 Draft，提供分页 repository、diff 与精确失效。
8. 接入固定 DTO、exact IPC、sender/window confirmation 与文案工作台。
9. 新增 `test:copy`，纳入 full test 和 Windows CI；同步合同、ADR、验收和状态文档。
10. 从最新 `npm ci` 起通过全部适用门禁，创建恰好一个本地提交并停止。

## 允许修改

- 新增 `packages/copy` 的 profile、strict contract、structure validator、scaffold、rewrite/lock、
  plan 和 confirmation。
- `packages/db` 的 v18 migration 与 Copy repository。
- `packages/workflows` 的 `COPY_GENERATE_V1 / COPY_REWRITE_V1` 受控 handler。
- `packages/shared`、Electron main/preload/IPC runtime 与 `apps/web-ui` 文案工作台。
- Issue 025 的合成 fixture、专项/治理/UI/迁移/恢复测试、合同、ADR、验收与进度文档。

## 禁止范围

- 不实现事实映射、真实性评分检查、风格质量检查、综合门禁或 Issue 026—027。
- 不实现图片、封面、信息卡、图片 prompt、审批、导出、排期、发布或 Issue 028—030。
- 不写入 `assets / quality_checks / approvals / post_packages / publications`。
- 不修改上游 Brief、Topic、Experiment、Dossier、Evidence 或真实性事实。
- 不读取真实密钥，不接真实业务网络，不调用真实模型/搜索/图片 API，不产生费用。

## 实施顺序

1. 核验动态基线、完整读取规则与指令、唯一归档。
2. 建立实施计划、31 项验收映射、三份合同和 ADR。
3. 实现 Copy domain、五类 profile、voice、lineage、locks、validation 与 rewrite merge。
4. 追加 v18 migration，实现 repository、版本、diff、plan/run、恢复和精确失效。
5. 接入 ModelExecutionService/JobQueue、shared DTO、IPC/preload/runtime 与文案工作台。
6. 补齐 Scripted Mock、migration、repository、runtime、renderer、egress 和 governance 测试。
7. 同步 package/CI、README、AGENTS、Roadmap、索引和本地证据。
8. 从最新 `npm ci` 按 CI 顺序跑完整门禁，审计 diff/敏感值/资源/Git。
9. 创建唯一 `feat(content): add versioned copy generation` 本地提交，核验远端未变并停止。

## 安全、数据与恢复

- renderer 是 DTO-only；凭据、路径、raw response、完整 Dossier/Evidence 和内部模型信息不出 main。
- queue payload 仅含 ID/revision/hash/scope；模型请求只有一次，外部调用期间无 DB 长事务。
- pre-send 才能安全恢复；after-send 不确定保持 AMBIGUOUS。相同 executionId 不重复副作用。
- locked/scope 外字段逐值保持；发布前重验 current revision、input、dependencies 与 lock snapshot。
- 临时数据只使用仓库卷派生目录、临时 SQLite、合成 fixture、Scripted Mock 和 loopback。

## 停止点

全部门禁通过且唯一 Issue 025 本地提交完成后立即停止；不 push，不进入 Issue 026，不报告未触发的
托管 CI。
