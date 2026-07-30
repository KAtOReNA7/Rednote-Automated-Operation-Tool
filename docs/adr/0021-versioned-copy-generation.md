# ADR 0021：版本化文案、结构门与受控局部重写

状态：已接受
日期：2026-07-30
范围：M3 Issue 025

## 背景

Issue 024 已提供五类 current Content Brief、Evidence/真实性/评分/剧透约束、字段锁和
`READY_FOR_DRAFT_GENERATION` 门。下一步需要生成标题、正文、标签与置顶评论，同时必须保留
Brief lineage、用户锁、单请求模型边界和可审计历史，并明确不提前实现质量、审批或发布流程。
既有 `drafts` 表已被早期 schema 引用，不能建立第二套 Draft identity。

## 决策

1. 保留 `drafts` 作为稳定 identity，追加 append-only `content_draft_versions`、唯一 current
   head、规范化产物、lineage、field state、dependency、plan/run、transition 与 audit。
2. 冻结五类 Copy Profile；标题、正文 block、标签、置顶评论与四类实际剧透警告使用 strict
   exact-object 合同和确定性结构校验。
3. 每个产物保存 provenance 与 Brief allowlist lineage。R1/R2/S1、个人分、资料分析分、公开标签、
   实验 arm 与 controlled conditions 只从 current Brief 继承，不能由模型创造或互换。
4. 账号文风冻结为观点鲜明、短句、少量冷幽默；只批评作品，不攻击作者或读者，也不模仿在世
   作者。风格规则不替代真实性或事实边界。
5. 手工 scaffold 为必需的零模型路径。完整生成和局部重写只经 ModelExecutionService 与本地
   JobQueue，单请求、有界、executionId 幂等、同 Draft 单 active。
6. 局部重写使用有限 scope。scope 外字段和全部锁定字段逐值保持；解锁、编辑、重排、undo、
   archive/restore 都是显式确认且追加版本。
7. pre-send 失败为零请求零费用；after-send 不确定状态保守保留 AMBIGUOUS，不自动 retry、
   repair、fallback 或换模型。
8. 结构有效的 Draft 只标记 `READY_FOR_QUALITY_PIPELINE`。它不表示质量、审批、导出或发布通过；
   Issues 026—030 的表保持零写入。
9. migration v18 保守迁移旧 Draft 为 `STRUCTURE_INVALID`。依赖变化只精确 stale，不自动生成、
   解锁或切换 current。

## 被否决方案

- 新建独立 Copy 根表：会形成第二套 Draft identity 并破坏既有引用。
- 把正文整体存成一个不可追溯字符串：无法支持 block scope、lineage、锁和稳定 diff。
- 允许模型在 rewrite 时只返回任意 patch：会扩大 schema、越过 scope 并使恢复难以验证。
- 自动修复无效结构或切换 Provider：会产生未预览请求并掩盖真实失败。
- 把结构有效写成质量通过：会越过 Issue 026—030 的独立检查与人工决策。
- 原地更新历史版本或自动解锁：破坏审计和用户明确控制。
