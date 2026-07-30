# M3 Issue 023 实施计划：版本化实验设计与确定性分配

状态：实现、增量验收与最终全量门禁已完成，等待唯一本地提交；Issue 024 未开始。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现，开工分支为 `main`。
- 开工 HEAD 为 `7ff02b5d9dcb4143eae879d7407650e0bf76a0cc`；本地合法领先
  `origin/main` 五个已完成 Issue 的提交，不执行 pull、rebase、reset 或 push。
- 工作树开工时干净；随后唯一新增的是按当前授权归档的 Issue 023 指令。
- Issue 022 的 Topic Pool、FIRST_30_V1、ranking、状态与 quota plan 已存在。
- migration 尾部由运行时发现为 v15；本 Issue 只能追加下一条连续 migration。
- 指令已从原位置唯一移动至 `docs/instructions/m3/`，移动前后内容哈希一致。

## 目标与完成定义

1. 建立稳定 Experiment identity 与不可变 ExperimentDesignVersion。
2. 保存可反驳假设、严格单一 primary variable、control/treatment arms 与控制条件。
3. 保存唯一 primary metric、有限 guardrails 和明确的未来数据 availability。
4. 建立 ReplicationStructure，同一结构至少跨三个 canonical Work 才可就绪。
5. 建立 HOT/WARM/COLD/UNKNOWN 热度分层，UNKNOWN 不自动推断也不等于 COLD。
6. 从 current、eligible、非 held/archived Topic 和可选 FIRST_30 计划显式选择样本。
7. 实现确定性、输入乱序不变、可解释且有界的分层 assignment。
8. 实现 draft、validate、assignment ready、lock、hold、resume、clone、archive、restore、
   stale 与 immutable history。
9. 追加连续 migration，保守升级旧 `experiments`，完整保留 Issues 018—022 数据。
10. 接入窄 Desktop IPC/preload 与实验管理 UI，覆盖完整状态矩阵。
11. 新增 `test:experiments` 并纳入全量测试和 Windows CI。
12. 同步合同、ADR、README、AGENTS、Roadmap、索引和脱敏证据。
13. 从一次最新 `npm ci` 开始通过全部适用门禁，只创建一个本地提交并停止。

## 允许修改

- 新增 `packages/experiments` 的有限 registry、合同、validator、状态机、fingerprint、
  replication 与 assignment solver。
- `packages/db` 的下一条连续 migration 和 Experiment repository。
- `packages/shared` 的分页 Experiment DTO 与 desktop bridge。
- Electron main/preload/IPC runtime 与 `apps/web-ui` 的实验管理页面。
- Issue 023 专项 fixture、金标、迁移、容量、runtime、IPC、renderer、egress、governance 测试。
- 本 Issue 的合同、ADR、实施计划、验收映射、脱敏证据和事实性进度文档。

## 禁止范围

- 不创建 Content Brief、Draft、标题、正文、标签、评论、图片、封面或内容产物。
- 不实现质量检查、审批、排期、发布包、平台发布或真实指标回收。
- 不写入真实 numerator、denominator、baseline、effect size、显著性、置信区间、p 值、
  power、uplift 或 winner。
- 不自动修改 Topic、FIRST_30、ReadingState、Dossier 或真实性权限。
- 不自动触发模型、Search、Fetch、Clip、图片或任何业务网络调用。
- 不让 AI 标识、版权、出版归属或模型记忆成为变量、分层或门禁。
- 不进入 Issue 024、042、043 或后续任务。

## 实施顺序

1. 归档指令，记录动态基线，建立本计划和连续验收映射。
2. 审计旧 `experiments`、Topic/Quota、Dossier/权限、迁移、Desktop IPC 与 UI。
3. 实现领域 registry、严格合同、单变量 validator、replication 和 deterministic assignment。
4. 追加下一条连续 migration，规范扩展同一 `experiments` identity。
5. 实现分页 repository、版本/状态/失效/no-op/并发语义。
6. 接入 sender/window 绑定确认 token、exact-object IPC/preload。
7. 激活实验管理 UI，覆盖 builder、样本、分层、分配、版本和状态矩阵。
8. 补齐专项测试、Windows CI、合同、ADR、索引与进度文档。
9. 从最新 `npm ci` 开始按当前 CI 顺序运行全部适用门禁。
10. 审计 diff、敏感信息、范围、临时资源和 Git，创建唯一提交并停止。

## 数据与算法原则

- `experiments` 保持稳定 identity/current pointer；设计、assignment、transition 与 audit
  历史 append-only。
- 设计精确一个 primary variable 和 primary metric；arms 的差异只能落在该 variable。
- 热度快照只用于分层；缺少明确来源时为 UNKNOWN，不自动推断。
- replication 使用 canonical Work identity，同一 Edition 或重复 Topic 不得凑足三个 Work。
- assignment 先按有限 blocking keys 分层，再用保存的 seed 与稳定 hash/tie-break 分配。
- 同输入、seed 和 policy 得到同结果；输入乱序不改变结果，不随机试到平衡。
- 样本不足显式返回 shortfall/imbalance，不复制 Topic、不放宽 inclusion。
- dependency 变化只标记相关设计或 assignment stale，不自动重排、解锁或切换 current。
- LOCKED 仅表示设计与分配冻结，不代表实验已执行、发布或产生结果。

## UI 与安全原则

- UI 固定显示“实验尚未执行，无效果结论”和单变量/三作品/UNKNOWN 边界。
- 未来标题、图片或发布时间变量只显示为 future-bound intent，不显示为已生成。
- 列表、样本选择、版本历史、diff 与 assignment preview 全部有界分页。
- 所有写操作经过 preview、expected revision、显式确认和短期单次 token。
- renderer 不接收 Node、SQLite、路径、完整 Dossier/Evidence、credential、raw response、
  未来指标原始值或内部预测分。

## 停止点

Issue 023 全部适用门禁通过并创建唯一一个本地提交后立即停止；不 push、不创建 PR、不进入
Issue 024。

## 实现结果

- 新增 `packages/experiments`，冻结六类变量、七类未来指标、四类热度、严格设计合同、结构
  fingerprint、单变量验证、状态机、确认 broker 与确定性 assignment。
- 追加 migration v16，在同一 `experiments` 根上增加 immutable design/assignment、arm、
  metric、guardrail、replication、sample、popularity、dependency/invalidation、transition、
  audit 和 policy schema；旧行保守迁移为待复核 DRAFT。
- `SqliteExperimentRepository` 提供有界列表、详情、版本 diff/状态历史分页、assignment
  preview/save、状态动作与 clone；相同 input no-op，相关依赖精确 stale。
- Desktop main/preload 只增加四个固定 Experiment channel，写操作使用 expected revision、
  preview hash 和 sender/window 绑定的一次性确认。
- 实验管理 UI 覆盖列表、筛选、分页、hypothesis、arm、controlled diff、metric/guardrail、
  Topic/Work、四类 strata、assignment、shortfall/imbalance、版本 diff 与状态历史。
- `test:experiments` 包含合同、策略、金标、500 Topic 容量、migration、repository、六类失效、
  runtime、IPC、renderer 与治理测试，并已纳入 Windows CI 和全量发现。
- 合同、ADR、README、AGENTS、Roadmap、指令索引与脱敏证据均已同步；下一步只记录为
  Issue 024，未实现其能力。
