# ADR 0015：不可变来源版本、严格原子事实与可逆冲突门禁

- 状态：Accepted
- 日期：2026-07-29
- Issue：019

## 背景

Issue 018 只把 Search、Fetch 和 Clip 产物转为未验证书目观察。早期 `sources`、`claims` 和
`claim_evidence` 结构缺少不可变 revision、受控主体外键、严格值类型、精确 locator、独立性和
可审计冲突决策，不能安全支撑事实验证。

## 决策

1. 保留 Source 身份，同时以 append-only `source_revisions` 绑定受控原点、内容哈希和托管文本。
2. Source 分类和 lineage 显式存储；Clip 固定为 context，未知或依赖 lineage 不算独立。
3. 用带实际外键列和 exactly-one CHECK 的 `fact_subjects` 约束五种主体；Claim 通过组合外键引用。
4. Predicate Registry 决定固定 predicate/version、完整值类型、日期精度与多值语义；scope 和值
   都确定性规范化，精确小数不用 SQLite REAL。
5. Evidence 只接受经受控 revision 文本验证的 code-point char range，并保存短摘录与哈希。
6. FactPolicy 是纯本地、版本化、可解释规则；官方一手或两个确认独立二级来源才能验证。
7. 实质冲突优先产生 `FACT_BLOCKED`；解决、撤销和 reopen 使用 expected revision、短期单次
   token、单事务以及 append-only decision/audit。
8. 模型提取/摘要是可选步骤，只经 `ModelExecutionService`，要求当前 structured capability、
   显式预算预览和确认；手工路径始终可用。
9. Queue 只携带有限 ID，Source ingest/reconcile 为本地步骤，外部请求为零；可能已发送的模型步骤
   遵循既有 `AMBIGUOUS` 保守恢复规则。

## 被否决方案

- 直接把 Search snippet 或模型记忆当 Evidence：没有不可变、可复核 locator。
- 以两个 URL 判断独立：镜像、转载和同稿发布会被重复计数。
- 在 `claims.subject_type/subject_id` 上只做字符串 CHECK：不能证明主体存在。
- 把中文摘要当证据：翻译或概括可能丢失限定条件。
- 自动选择冲突赢家：会把不确定事实伪装为确定事实。
- 修改 v1 migration 或删除旧行：破坏升级、审计和既有 ID。

## 结果

v12 兼容保留旧数据并将新写入收紧到可追溯合同。事实状态可由原始 Evidence 重算；冲突未解决时
明确阻断事实使用，但不触碰 Issue 020 dossier、写作、审批、排期、导出或发布能力。
