# Experiment Design V1 合同

状态：M3 Issue 023 已实现。本文冻结可检验、严格单变量且可版本追溯的实验设计边界。

## 1. 定位与非目标

Experiment 只保存未来可执行的比较设计，不执行发布、不回收真实指标，也不计算效果。它不是
Content Brief、标题、正文、图片、质量检查、审批、排期或发布包。`LOCKED` 只表示当前设计与
assignment 已冻结，绝不表示 `RUNNING`、`COMPLETED` 或已有 winner。

## 2. 身份与不可变版本

- 既有 `experiments` 表是唯一稳定根身份；`experiment_current_designs` 保存当前指针。
- `experiment_design_versions` 保存不可变设计 payload、前一版本、schema/policy version、
  dependency/design hash、有限 warning/reason 与创建时状态快照。
- 历史设计、assignment、transition、dependency、invalidation 与 audit 均 append-only。
- current 指针只在短事务和 expected revision 比较成功后切换。
- 已锁定设计不能原地修改；用户必须 clone 为新的 `DRAFT` 版本。相同 assignment 输入是
  deterministic no-op。
- 旧 `experiments` 行保守迁移为 `legacy-experiment-v0 / DRAFT`，必须人工复核，不能伪装成
  已验证设计。

## 3. 可反驳假设

`ExperimentHypothesisV1` 必须同时包含目标读者/情境、intervention、comparator、预期方向、
唯一 primary outcome、rationale、falsification condition、scope 与有限 assumptions。
primary outcome 必须等于唯一 primary metric，方向必须一致；空泛的“更爆”“效果更好”被拒绝。
rationale 只是设计理由，不是事实或实验结果。

## 4. 严格单一变量

变量 registry 固定为：

- `CONTENT_STRUCTURE`
- `TITLE_PATTERN`
- `COVER_INFORMATION_DENSITY`
- `SPOILER_MODE`
- `COMPARISON_FORMAT`
- `PUBLICATION_TIME_WINDOW`

每个设计精确一个 primary variable、2—6 个 arm、精确一个 `CONTROL`，其余为
`TREATMENT`。arm ID 与 value identity 必须唯一，value 必须属于对应版本化 registry，每个
arm 的 `changedDimensions` 只能包含该 primary variable。Work、AI 标识、版权和出版归属不在
registry 中，不能成为变量。

其余维度通过 `controlledConditions` 明确为 `FIXED` 或
`FUTURE_NOT_IMPLEMENTED`。标题、封面信息密度和发布时间窗口只表示 future-bound intent，
不会生成标题、图片或排期。

## 5. 同结构跨作品复现

`ReplicationStructureV1` 保存 structure identity/version、Topic content type、analysis mode、
spoiler level、有限 structural slots、可空 comparison dimension、required labels 与稳定
semantic fingerprint。

assignment 只有在同一 fingerprint 至少覆盖三个不同 canonical Work 时才可
`READY_TO_LOCK`。同一 Work 的多个 Edition、重复 Topic 或复制 fingerprint 都不能凑足三本书。
Topic 必须是 current、`ELIGIBLE` 且非 `HELD/ARCHIVED`，内容类型、分析模式和剧透级别必须与
结构一致。少于三本明确返回 `INSUFFICIENT_REPLICATION`。

## 6. 状态与并发

有限状态为：

`DRAFT / VALIDATED / ASSIGNMENT_READY / LOCKED / HELD / ARCHIVED / SUPERSEDED / STALE`

支持 validate、assignment ready、lock、hold、resume、archive、restore 和 clone。状态以根的
current state 和 append-only transition 历史为准；设计版本中的状态是创建时快照。所有 renderer
写操作必须先 preview，再提交 expected revision、preview hash 和 sender/window 绑定的短期单次
confirmation token。并发变化或 token 重放 fail closed。

## 7. 依赖与失效

设计/assignment 显式记录 Topic version/state/eligibility、FIRST_30 plan、canonical Work、
Dossier version、Expression Permission、热度快照以及 variable/metric/replication/assignment/
popularity policy version。相关依赖变化只追加 invalidation 并把读取状态投影为 `STALE`；不会自动
重排、解锁、修改 Topic 或切换 current。无关 Work/Topic 变化不产生全库 stale。

## 8. 桌面边界

renderer 只接收有限分页 DTO、设计定义、摘要、状态历史和 assignment 摘要；不接收 Node、
SQLite、绝对路径、完整 Dossier/Evidence、credential、raw response、真实指标值或内部预测分。
所有读取分页上限为 100，样本上限为 500。实现不访问业务网络、不读取密钥、不调用模型。
