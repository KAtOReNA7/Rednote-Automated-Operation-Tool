# M3 Issue 026 实施计划：事实声明映射与证据回溯

状态：已完成；60 项验收和全部正式门禁均已通过，本文件随本轮唯一提交交付。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现，当前分支为 `main`。
- 开工 HEAD、本地 `origin/main` 与只读远端 `main` 均为
  `5959e5b157ac91a6e8773834b48df3367f0fad9c`，开工工作树干净。
- Issue 026 指令从 Desktop 字节不变地唯一移动到 `docs/instructions/m3/`，原位置已不存在。
- migration 尾部由运行时发现为 v18；本 Issue 只追加下一条连续 migration，不修改历史版本。
- Issue 019 的 SourceRevision、AtomicClaim、Evidence、FactEvaluation，Issue 024 的 current
  ContentBrief/EvidenceRef，以及 Issue 025 的 immutable DraftVersion、artifact、lineage、lock
  和 `READY_FOR_QUALITY_PIPELINE` 均由代码、合同和专项测试证明可用。
- Core 已冻结 `QualityCheckType.FACT_MAPPING`，仓库尚无 Issue 026 业务实现。
- 开发期间不执行 pull、rebase、reset、merge、push、PR 或分支切换。

## 目标与完成定义

1. 从可检查 DraftVersion 派生只读公开 artifact、Unicode code-point locator 与原子 Statement。
2. 实现有限事实分类、关键事实、protected signal、候选 Claim allowlist 与类型化 compatibility。
3. 建立 Statement—Claim—FactEvaluation—Evidence—SourceRevision 的完整只读回溯。
4. 形成版本化 `PASS / FACT_BLOCKED / AWAITING_REVIEW`，并保守处理 stale、失败、取消和 ambiguous。
5. 提供无模型可用的人工复核；可选辅助只经既有 ModelExecutionService 和 Scripted Mock。
6. 追加连续 migration，保存 append-only check/version/statement/link/dependency/decision/run 与
   FACT_MAPPING 汇总桥接，并精确失效。
7. 接入有界 JobQueue handler、main/preload/IPC/shared DTO 和内容生产页事实映射工作台。
8. 新增 `test:fact-mapping`，纳入全量测试与 Windows CI，完成 60 项独立验收证据。
9. 从最新 `npm ci` 起通过全部适用门禁，创建恰好一个本地提交并停止。

## 允许修改

- 新增 Electron 无关的 `packages/quality`，本轮只实现 FACT_MAPPING 子域。
- `packages/db` 的下一条 migration、Fact Mapping repository、精确失效与质量汇总桥接。
- `packages/workflows` 的 `FACT_MAPPING_CHECK_V1` 有界 handler。
- `packages/shared`、Electron main/preload/IPC/runtime 与 `apps/web-ui` 事实映射工作台。
- Issue 026 的合成 fixture、专项/治理/UI/迁移/恢复测试、合同、ADR、验收和状态文档。

## 禁止范围

- 不创建、修改或补写 Draft、Brief、Claim、Evidence、Source、FactEvaluation 或研究事实。
- 不启动 Search、Fetch、Browser Clip、研究、Dossier rebuild 或后续质量检查。
- 不实现 Issue 027—030、图片、审批、排期、导出、发布包或发布。
- 不把 FACT_MAPPING PASS 表示为整体质量、审批或可发布。
- 不新增 AI 标识或版权检查，不读取真实密钥，不接业务网络，不调用真实模型/API，不产生费用。

## 架构与数据边界

- `packages/quality` 负责 strict contracts、detector、locator、candidate、compatibility、rollup 与
  assistant output validation，不依赖 Electron、SQLite 或网络。
- repository 只保存 locator/hash、有限分类、稳定 ID、revision 与依赖；Draft/Source 全文不复制
  到业务 JSON、job、audit、日志或错误 DTO。
- renderer 只接收当前 Draft 派生的有界片段、Claim 安全摘要与有限 Evidence excerpt。
- 人工 decision 使用 expected revision、preview hash、窗口绑定短期单次 token；历史 append-only。
- queue payload 仅含 ID、版本、hash、mode 与有限计数；模型最多一次，after-send 不确定保持
  `AMBIGUOUS`，不得重试、repair、fallback 或换模型。
- 受保护的 Source、Claim、Evidence、FactEvaluation、Catalog、Dossier、Authenticity、Topic、
  Experiment、Brief、Draft、asset、approval、package、publication、metric 和 strategy 表零写入。

## 实施顺序

1. 完成动态基线、指令归档、schema/package/test/CI inventory。
2. 建立本计划与 60 项未预填 PASS 的验收映射，冻结三份合同和下一号 ADR。
3. 实现 quality domain：artifact/locator/statement/classification/signal/candidate/compatibility/rollup。
4. 追加下一条 migration，实现 repository、history、人工 decision、质量桥接与精确失效。
5. 实现 plan、confirmation、JobQueue handler 和 Scripted Mock assistant 校验。
6. 接入 shared DTO、main/preload/IPC/runtime 与事实映射工作台。
7. 完成 gold fixture、migration、repository、capacity/query plan、egress、UI 与治理测试。
8. 同步 README、AGENTS、Roadmap、文档中心、索引和本地证据。
9. 从最新 `npm ci` 按 CI 顺序执行正式门禁，审计 diff、敏感值、路径、资源和远端。
10. 创建唯一 `feat(quality): add factual claim mapping checks` 本地提交并立即停止。

## 停止点

全部验收与正式门禁通过、唯一 Issue 026 本地提交完成后立即停止；不 push，不进入 Issue 027，
不报告未触发的托管 CI。
