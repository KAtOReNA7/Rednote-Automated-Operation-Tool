# M2 Issue 019 实施计划：来源证据、原子事实与冲突处理

状态：已完成。验收证据已由本地实现、合成 fixture、临时 SQLite、Scripted Mock、本机
loopback、隔离浏览器 smoke 与提交前门禁回填。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现，开工分支为 `main`。
- 开工 HEAD 为 `60a922e5750781d8d34410bc6329eab488dd2edb`；本地合法领先
  `origin/main` 一个 Issue 018 提交，不执行 pull、rebase 或 push。
- migration 尾部为 v11；Search、Fetch、Clip、Catalog 分别保持候选、未验证文档、
  `CONTEXT_ONLY` 样本和未验证书目观察的既有边界。
- 指令已从桌面原位置移动到 `docs/instructions/m2/`，根目录和原位置不留副本。

## 目标

1. 将用户明确选择的 FetchDocument、BrowserClip 或合成 fixture 转换为版本化 Source。
2. 建立受控主体注册表、Predicate Registry、严格类型 AtomicClaim 和精确 EvidenceLocator。
3. 以可解释的 FactPolicy 判定官方一手来源或两个已确认独立二级来源。
4. 确定性检测实质矛盾；未解决矛盾产生 `FACT_BLOCKED`，并支持人工预览、确认、
   撤销和重新打开。
5. 追加 migration v12，保留 Issue 018 目录实体、ID、关系和历史 migration。
6. 提供纯本地手工路径和显式确认的 SourceProcessingPlan；可选结构化模型步骤只能复用
   `ModelExecutionService`。
7. 激活 Research 页面和窄 IPC，保持 renderer 不可信边界。
8. 新增 `test:evidence`，纳入全量测试和 Windows CI。

## 实施顺序

1. 冻结本计划、三份合同、ADR 和连续验收草案。
2. 新增 provider-neutral `packages/evidence`：合同、规范化、locator、政策、冲突和计划。
3. 追加 v12 和 `SqliteEvidenceRepository`，覆盖升级、事务、索引、审计和幂等。
4. 新增本地 ingest/reconcile 与可选 structured extraction workflow handler。
5. 新增 main runtime、preload/IPC DTO 和 Research renderer。
6. 补齐专项、迁移、恢复、性能、UI、架构、egress 和治理测试。
7. 同步 README、AGENTS、文档索引和 CI。
8. 从最新 `npm ci` 开始按 CI 顺序执行全部适用门禁。
9. 审计后创建唯一一个本地提交并停止。

## 安全与范围

- 不读取真实密钥，不调用真实模型、搜索、网页、图片或业务 API，不产生费用。
- 测试只使用运行时合成 fixture、临时 SQLite、Scripted Mock 和本机无网络执行。
- 数据库不保存完整页面正文、原始响应或任意绝对路径；Evidence 只保存有界精确摘录。
- BrowserClip 永远是 `DISCUSSION_CONTEXT / CONTEXT_ONLY`，不能单独或组合验证事实。
- AI 标识、版权、publication relationship 不进入 FactPolicy。
- 不创建或更新 `research_dossiers`、topics、drafts、approvals 或 post_packages。

## 停止点

Issue 019 全部门禁通过并创建唯一一个本地提交后立即停止；不 push、不创建 PR、不进入
Issue 020。
