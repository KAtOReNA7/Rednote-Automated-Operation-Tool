# M3 Issue 024 实施计划：结构化 Content Brief、字段锁定与受控生成

状态：实现与增量验收已完成，最终全量门禁、唯一提交和获准的远端同步待执行；Issue 025 未开始。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现，分支为 `main`。
- 开工 HEAD 为 `bc7857a2f529d3f28355d3ca455703dcea82d2a0`；本地合法领先
  `origin/main` 六个已完成 Issue 的提交。
- 开工工作树干净；唯一新增文件是字节不变地移动至 `docs/instructions/m3/` 的 Issue 024 指令。
- migration 尾部由运行时发现为 v16；本 Issue 只追加下一条连续 migration，不写死机器路径或
  migration checksum。
- TopicCandidate/QuotaPlan、Experiment Design/Assignment、Evidence/Dossier/Authenticity、
  ModelExecutionService 和 JobQueue 均以实际代码与测试存在。
- 开发期间不 pull、rebase、reset 或 push。用户当前消息末尾明确覆盖了指令中的最终“不得 push”：
  全部门禁和唯一 Issue 024 提交完成后，直接推送当前 `main` 并核验远端 SHA；不创建额外分支或 PR。

## 目标与完成定义

1. 在现有 `content_briefs` identity 上建立不可变 ContentBriefVersion 聚合根。
2. 建立五类 Topic 一一对应的有限 Brief Profile、必需槽位与 spoiler 规则。
3. 保存目标读者、目标、核心判断、支持论点、最强反方、结构、评分、表达和禁用表达计划。
4. 将每个事实性支撑点追溯至 current DossierEntry、Claim、FactEvaluation、Evidence 与 SourceRevision。
5. 消费 current ExpressionPermission，严格隔离 R1、R2、S1、个人分与资料分析分。
6. 保存逐字段 provenance、USER_LOCKED/SYSTEM_LOCKED，编辑、锁定、解锁和 regenerate 均创建新版本。
7. 实现纯确定性的 readiness，阻止 stale、FACT_BLOCKED、真实性、剧透、Evidence 或 Experiment 不匹配。
8. 支持无模型配置的纯本地 scaffold，不使用模板伪造 judgment 或 argument。
9. 实现 provider-neutral strict structured candidate 验证与 ModelExecutionService/JobQueue 接口，
   测试仅用 Scripted Mock。
10. 实现有界 generation plan/run、executionId 幂等、cancel/recovery 和 after-send ambiguous 保守语义。
11. 追加连续 migration，保守迁移旧 Brief 为 incomplete，完整保留 Issues 018—023 数据。
12. 接入固定分页 DTO、exact-object IPC、sender/window 绑定确认和内容生产 Brief UI。
13. 新增 `test:briefs`，纳入全量测试和 Windows CI；同步合同、ADR、README、AGENTS、Roadmap 与证据。
14. 从最新 `npm ci` 开始通过全部适用门禁，创建唯一 Issue 024 提交，推送 `main` 后停止。

## 允许修改

- 新增 `packages/briefs` 的版本化合同、registry、validator、readiness、scaffold、lock/diff、
  generation plan/candidate 与确认 broker。
- `packages/db` 的下一条连续 migration 和 ContentBrief repository。
- `packages/workflows` 的 `CONTENT_BRIEF_GENERATE_V1` handler 与受控结构化生成服务。
- `packages/shared` 的分页 ContentBrief DTO 和 desktop bridge。
- Electron main/preload/IPC runtime 与 `apps/web-ui` 的内容生产 Brief 工作区。
- Issue 024 专项 fixture、金标、迁移、容量、失效、队列、runtime、IPC、renderer、egress 和治理测试。
- 本 Issue 的合同、ADR、实施计划、验收映射、脱敏证据与事实性进度文档。

## 禁止范围

- 不生成或保存标题、正文、标签、置顶评论、图片 prompt、图片、封面或信息卡。
- 不实现 Draft、质量检查、审批、排期、导出、发布、指标回收或 Issue 025—030 能力。
- 不自动修改 Topic、Experiment、Dossier、Claim、ReadingState、ExpressionPermission 或 Evidence。
- 不保存 effect、winner、p value、真实 metric value、INTERNAL_PREDICTION 或模型内部推理。
- 不新增真实业务网络客户端，不读取真实密钥，不调用真实模型/搜索/页面/图片 API，不产生费用。
- AI 标识和版权不进入字段、禁用表达、readiness、锁定、评分、审批或导出。

## 实施顺序

1. 完成动态基线、能力审计、归档、计划和连续验收映射。
2. 运行格式、lint、类型、约束、DB、队列、模型、Topic、Experiment 的基线门禁。
3. 实现 `packages/briefs` 的有限 registry、strict contract、五类 profile 与 deterministic policies。
4. 实现 Evidence/Auth/Score/Spoiler/Experiment 校验、field locks、readiness 与 local scaffold。
5. 追加下一条 migration，规范扩展 `content_briefs` 并实现 repository、版本、diff 和失效。
6. 实现有界 generation plan/run、Scripted Mock candidate 验证和 JobQueue handler。
7. 接入 sender/window 确认、exact IPC/preload 与内容生产 UI。
8. 补齐金标、容量、迁移、并发、恢复、egress、UI 和治理测试。
9. 同步合同、ADR、README、AGENTS、Roadmap、索引和本地证据。
10. 从最新 `npm ci` 开始按 CI 顺序运行全部适用门禁并完成浏览器复核。
11. 审计 diff、敏感信息、临时资源与 Git，创建唯一提交，推送 `main`，核验远端并停止。

## 数据与安全原则

- `content_briefs` 保持稳定 identity/current pointer；版本、field values、locks、dependencies、
  readiness、transitions、audit 和 generation history 均有界且不可覆盖。
- ContentBrief payload 只保存结构化 Brief 字段，不复制完整 Source、Dossier、Evidence excerpt 或正文。
- `INTERNAL_PREDICTION` 不进入 Brief domain、DB、DTO、renderer 或模型输入输出。
- 每个事实性 argument 和反方的事实前提必须绑定 allowlist 中 current、VERIFIED 的追溯链。
- context/supporting-only 保留角色，不能升级为关键事实；gap、UNKNOWN、stale 和 blocked 不伪装确定结论。
- SYSTEM_LOCKED 依赖不可编辑；USER_LOCKED regenerate 后逐值不变，解锁独立确认并审计。
- 相同 input 与 lock snapshot 是 deterministic no-op；依赖变化只追加精确 invalidation，不自动生成。
- 模型执行期间不持有 DB 长事务；after-send ambiguous 不自动重试、repair、fallback 或换模型。
- queue payload/result 不包含 Brief payload、正文、Evidence excerpt、secret、raw response 或绝对路径。

## UI 与 React 原则

- `/production` 激活为真实 Brief 工作区，保留加载、空、错误、incomplete、blocked、stale、ready、
  generating 与 history 状态。
- 列表、详情、版本、diff、Evidence、generation history 均有界分页；重复查找使用 Map/Set，
  派生状态在 render 中计算，事件逻辑留在 handler，避免 effect 驱动写操作。
- UI 明示 Brief 不是标题/正文/已批准文章，实验绑定不是实验结果，资料分析不等于个人体验，
  低覆盖或冲突不能进入未来正文生成，锁定字段不会被 regenerate 覆盖。
- renderer 不导入 Node、Electron、SQLite、网络、crypto、凭据或内部路径实现。

## 停止点

Issue 024 全部门禁通过、唯一提交完成并按用户最终覆盖指令推送当前 `main` 后立即停止。不得进入
Issue 025，不创建 PR，不声称未读取的托管 CI 结果。
