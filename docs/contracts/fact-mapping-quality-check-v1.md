# FACT_MAPPING Quality Check V1 合同

状态：冻结
适用范围：M3 Issue 026

## Identity、版本与状态

`FactMappingCheckV1` 绑定稳定 Draft identity；immutable check version 绑定一个明确 DraftVersion
及其 artifact、candidate、dependency 与 policy snapshot。current pointer 只在完整事务最后按
expected revision 切换，失败、取消、ambiguous 或 stale 不替换现有 current。

run status 固定为：

`PLANNED / QUEUED / RUNNING / AWAITING_REVIEW / PASS / FACT_BLOCKED / FAILED /
CANCELLED / AMBIGUOUS / STALE / SUPERSEDED`。

Statement disposition 固定为：

`SATISFIED / NOT_APPLICABLE / NEEDS_REVIEW / BLOCKING_KEY_FACT /
UNMAPPED_SUPPORTING_FACT / CONFLICTED / STALE`。

## 聚合

- PASS：全部公开 artifact 已覆盖；所有 FACT 都映射到 current VERIFIED Claim；非事实分类已确定；
  不存在 MIXED、AMBIGUOUS、conflict、stale 或未处理 protected signal。
- FACT_BLOCKED：至少一个 KEY_FACT 无 Claim、映射无效、非 VERIFIED、冲突、不可用、stale 或
  value/scope 不兼容。
- AWAITING_REVIEW：存在 MIXED、AMBIGUOUS、multiple candidates、待拆分或未解决 supporting fact。
- technical FAILED、CANCELLED、AMBIGUOUS、STALE 不得伪装为质量 PASS/FAIL。

`quality_checks` 只保存 FACT_MAPPING 汇总桥接：PASS 对应 PASS；完成后的 FACT_BLOCKED 与
AWAITING_REVIEW 对应 FAIL 和有限 reason registry。相同 DraftVersion、checker version、input hash
幂等；新 DraftVersion 不继承旧 PASS；单项 PASS 不推进 Draft、整体质量、审批、导出或发布。

## 队列、恢复与失效

唯一 job type 为 `FACT_MAPPING_CHECK_V1`。payload 仅含 ID、版本、hash、mode 和有限计数。同
Draft 同时最多一个 active mutation；外部调用期间不持有 DB 长事务。pre-send 可恢复；
after-send 不确定不得自动重发或 takeover。结果 payload 不含正文、excerpt、URL、路径、secret
或 raw response。

check version 保存 Draft、Brief、Work、Claim、FactEvaluation、Evidence、SourceRevision、
conflict、canonical identity 与 policy 依赖。变化只精确失效引用者；无关实体不全库 stale。
失效幂等，不自动重跑、不改 Draft、不启动研究或 Issue 027—030。
