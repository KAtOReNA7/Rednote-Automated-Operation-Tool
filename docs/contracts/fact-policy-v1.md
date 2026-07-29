# Fact Policy V1 合同

## 验证规则

`fact-policy-v1` 只根据有效 locator、来源分类、独立性、可用性和未解决实质矛盾判定：

1. 一个 `OFFICIAL_PRIMARY + KEY_FACT_ELIGIBLE` SourceRevision；或
2. 两个不同 lineage group 的
   `INDEPENDENT_SECONDARY + KEY_FACT_ELIGIBLE + CONFIRMED_INDEPENDENT` SourceRevision。

同稿转载、依赖来源、独立性未知、`SUPPORTING_ONLY` 或
`DISCUSSION_CONTEXT / CONTEXT_ONLY` 不满足规则。日文、英文
原始 Evidence 与中文摘要可以并列展示，摘要永不参与计数。

## Evaluation

状态有限为：

- `NOT_EVALUATED`
- `INSUFFICIENT`
- `SUPPORTED_NOT_VERIFIED`
- `VERIFIED`
- `CONFLICTED`
- `FACT_BLOCKED`
- `STALE_REVIEW_REQUIRED`
- `REJECTED`

无 Evidence 为 `NOT_EVALUATED`；只有合法但不足的支持为 `SUPPORTED_NOT_VERIFIED`；只有 context
或无合格支持为 `INSUFFICIENT`。无 locator 的模型记忆为 `REJECTED`。任何 unresolved material
conflict 优先产生 `FACT_BLOCKED`。Evaluation 记录 policy version、SourceRevision digest、
独立性快照和输入 identity hash；相同输入重算返回同一结果，来源 revision、分类、lineage 或冲突
decision revision 改变时追加新结果。

## 冲突规则

冲突键为 subject、predicate、normalized scope、policy version。日期通过精度区间比较：
`2024` 与 `2024-05-01` 兼容，`2024-05` 与 `2024-06` 冲突。不同 scope 不冲突；解析到同一
canonical entity 的别名不冲突；允许多值的 predicate 以集合语义比较。

冲突状态有限为 `OPEN`、`FACT_BLOCKED`、`RESOLVED_ACCEPT`、`RESOLVED_MULTIVALUE`、
`RESOLVED_SCOPE_SPLIT`、`DISMISSED_DEPENDENT_SOURCE`、`SUPERSEDED`、`REOPENED`。

## 人工决策

决策必须经过绑定 sender/window 的短期、单次内存 token，包含 preview hash、expected revision
和非空 reason；确认在单事务内更新冲突并追加 decision/audit。撤销和 reopen 也创建新 decision，
不改写历史。stale revision、过期 token、重复消费和并发竞争均 fail closed。

AI 标识、版权、publication relationship 的业务含义不参与政策、评分、审批、优先级、排期或导出。
