# ADR 0024：确定性剧透声明与警告检查

- 状态：Accepted
- 日期：2026-08-01
- 范围：M3 Issue 028

## 背景

Issue 025 已保存冻结 Brief spoiler plan 与四个实际警告文本，Issue 026 提供公开 artifact locator，
Issue 027 已证明 `quality_checks`、current-only 查询和短期单次确认形状可复用。Issue 028 需要检查
声明与警告，但不能把有限词法规则包装成完整剧情理解。

## 决策

1. 新增独立、纯确定性的 spoiler evaluator；FULL 分支不运行答案式候选 detector。
2. 复用 `quality_checks.check_type='SPOILER'`，不新增 migration、表、trigger 或专用数据库枚举。
3. main process 在每次 preview/confirm 时同时读取 current Draft 与 current Brief；保存身份包含其
   pointers、revision、hash、plan、invalidation 和公开 artifact/warning hashes。
4. 保存采用 content-addressed `INSERT OR IGNORE` 和逐字段回读，历史不更新、不删除。
5. renderer 仅增加 Copy 工作台内的一张卡片；只暴露 preview/confirm 两个窄 IPC。
6. 有限候选统一表达为 `REVIEW_REQUIRED` 证据，不宣称候选是真实凶手、谜底或结局。

## 被否决方案

- 使用模型或剧情真相库判断全文：超出确定性子集，且需要网络、费用和新的真实性来源。
- 扩大关键词表来宣称语义理解：会制造静默误判，无法处理同义、代词、隐喻和跨段推理。
- FULL 正文出现凶手/结局即失败：与已确认的允许政策冲突。
- 新建 spoiler 表、状态枚举或通用质量平台：现有 `quality_checks` 足够，且会扩大 Schema 与范围。
- preview 后直接保存：无法防止 Draft/Brief 在确认前变化；必须消费绑定令牌并重新计算。
- 在 renderer 计算或读取 SQLite：违反不可信 renderer 边界。

## 结果

优势是边界诚实、零网络费用、版本 freshness 精确且保存数据有界。代价是不能发现隐喻、指代、
身份反转或完整语义等价；这些情况只能显示为未知或复核，不能静默升级为 PASS。
