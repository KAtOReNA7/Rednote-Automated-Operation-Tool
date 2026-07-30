# Content Brief Readiness V1 合同

状态：M3 Issue 024 已实现。本文冻结确定性的 Brief 就绪状态和进入未来 Draft 生成前的门禁。

## 1. 有限状态

Readiness policy 版本为 `brief-readiness-policy-v1`，状态精确为：

`DRAFT_INCOMPLETE / DOSSIER_NOT_READY / FACT_BLOCKED / AUTHENTICITY_BLOCKED /
SPOILER_POLICY_INCOMPLETE / EXPERIMENT_MISMATCH / EVIDENCE_MAPPING_INCOMPLETE /
STALE / READY_FOR_DRAFT_GENERATION`

计算是纯函数；相同 draft、依赖快照和 policy 必须得到相同状态与排序后的 reason codes。状态
只描述结构化 Brief 是否可供未来 Draft 生成使用，不表示正文已生成、质量已通过或内容已批准。

## 2. READY 条件

`READY_FOR_DRAFT_GENERATION` 必须同时满足：

1. Topic 是 current、`ELIGIBLE`、`LOCKED` 且非 held/archived；
2. 所有依赖 current，Dossier current 且 READY；
3. schema 和 Profile 合法，目标读者、目标、核心判断、论点和最强反方完整；
4. 每个关键事实由 current、`VERIFIED`、locator-valid 的 `FACT` EvidenceRef 支撑；
5. current Expression Permission 允许所选表达方式与评分来源；
6. 剧透级别、警告位置和必要用户确认完整；
7. 可选 Experiment binding 为 locked、current、non-stale 且 Topic/Work/arm/structure/condition
   完整匹配；
8. 没有 unresolved fact conflict、stale evidence、被撤销 R2 assertion 或未知强行确定化。

## 3. 阻塞优先级

- Topic/依赖过期首先投影为 `STALE`。
- Experiment 非 current、未锁定或不匹配投影为 `EXPERIMENT_MISMATCH`。
- Dossier 未就绪投影为 `DOSSIER_NOT_READY`。
- 阅读权限、第一人称、R2 assertion、公开资料标签或评分来源不合法投影为
  `AUTHENTICITY_BLOCKED`。
- 剧透计划或 Profile 剧透要求不完整投影为 `SPOILER_POLICY_INCOMPLETE`。
- 冲突、无效 locator 或关键事实阻塞投影为 `FACT_BLOCKED`。
- 事实性字段缺少合法映射投影为 `EVIDENCE_MAPPING_INCOMPLETE`。
- 其余结构缺失或 schema 问题投影为 `DRAFT_INCOMPLETE`。

Incomplete、blocked 和 stale 版本可以保存并保留历史，但不能被宣称 ready，也不能进入未来
Draft 生成。readiness 不读取 AI 标识、版权判断、模型内部推理或内部预测分。

## 4. 保存与重验

每个 immutable version 保存 readiness snapshot、policy version、reason codes、input hash 和
dependency hash。模型候选发布前必须在短事务外完成生成，并在发布事务内重新核验 expected
revision、current version、input/dependency hash、lock snapshot 与 readiness；失败不替换原
current version。相同输入与 lock snapshot 是 deterministic no-op。
