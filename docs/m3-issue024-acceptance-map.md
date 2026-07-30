# M3 Issue 024 验收映射

状态：验收完成。80 项均已由独立、可复核的代码、测试、命令或文档证据覆盖；第 80 项由提交前
staged diff 审计和提交后的远端只读 Git 审计共同闭环。

|   # | 验收点                                                                                              | 状态 | 验证证据                                               |
| --: | --------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------ |
|   1 | 动态仓库根、`main`、开工 HEAD 与合法本地领先得到保护                                                | PASS | 实施计划基线与最终只读 Git 审计                        |
|   2 | Issue 024 指令只归档于 `docs/instructions/m3/` 且移动前后字节一致                                   | PASS | 唯一文件搜索、源缺失和 SHA-256 移动证据                |
|   3 | 只实施 Issue 024，不进入 Issue 025—030                                                              | PASS | briefs governance、README/AGENTS/Roadmap 和范围审计    |
|   4 | 开发期不 pull/rebase/reset/push，唯一提交后才按用户覆盖指令 push                                    | PASS | reflog/parent/commit count 与本地远端 SHA 审计         |
|   5 | ContentBrief 是稳定 identity 且同一 Brief 只有一个 current version                                  | PASS | migration unique/current FK 与 repository 事务测试     |
|   6 | ContentBriefVersion immutable、previous 完整且历史不可物理删除                                      | PASS | append-only trigger、clone/edit/undo 和 tamper 测试    |
|   7 | Brief 绑定 current Topic identity/version 和受控主体集合                                            | PASS | strict contract、Topic FK 与 repository round-trip     |
|   8 | 可选 Experiment/Design/Assignment 绑定为空或完整一致                                                | PASS | Experiment-bound 金标与 mismatch 负例                  |
|   9 | targetAudience 含知识、需求且拒绝无来源敏感画像                                                     | PASS | audience validator 和负面参数化测试                    |
|  10 | contentObjective 可验证且不承诺“爆款”等结果                                                         | PASS | objective policy 测试                                  |
|  11 | coreJudgment 精确一个，区分 OPINION/FACTUAL_SYNTHESIS/MIXED 并有限定条件                            | PASS | judgment contract/readiness 金标                       |
|  12 | supportingArguments 有界且事实、观点、limitation 和 Evidence 分离                                   | PASS | argument validator 与 Evidence mapping 测试            |
|  13 | strongestCounterargument 必须真实、最强、非 strawman 且事实前提可追溯                               | PASS | counterargument 语义负例与金标                         |
|  14 | structurePlan 只保存段落功能/槽位，不保存标题或正文                                                 | PASS | schema/DTO/governance 断言                             |
|  15 | openQuestionsAndLimitations 保留 gap，不补写为确定事实                                              | PASS | scaffold/readiness 与 prompt injection 测试            |
|  16 | 五类 BriefProfile 与五类 Topic 一一对应且 registry 有限版本化                                       | PASS | profile registry 精确集合测试                          |
|  17 | 非剧透单书判断精确一个 Work、NO spoiler 和正反购买/阅读判断槽位                                     | PASS | profile 金标与泄露字段负例                             |
|  18 | 完整诡计分析要求 FULL 与 cover/title/body-opening warning 位置                                      | PASS | FULL spoiler 金标与 incomplete 负例                    |
|  19 | 跨作品比较至少两个 Work、同一维度且 Evidence slots 对称                                             | PASS | symmetric comparison 测试                              |
|  20 | 网文/出版比较要求已验证形态且不推断商业优劣                                                         | PASS | expression/publication profile 测试                    |
|  21 | 推理与文化现象绑定 Work 和可追溯主题，不退化为泛热点                                                | PASS | context role/profile 测试                              |
|  22 | 每个事实性字段可追溯 DossierVersion/Entry、Claim、Evaluation、Evidence、SourceRevision              | PASS | EvidenceRef 合同、FK 与追溯查询测试                    |
|  23 | 只有 current VERIFIED evaluation 可支撑关键事实                                                     | PASS | stale/blocked/unsupported evidence 负例                |
|  24 | supporting-only/context-only 保留角色且不能升级关键事实                                             | PASS | evidence role validator                                |
|  25 | 模型输出只能引用输入 allowlist，不能编造 ID/URL/excerpt                                             | PASS | Scripted Mock 引用越界测试                             |
|  26 | Brief 不复制完整 Source、Dossier、Evidence excerpt 或正文                                           | PASS | payload size/schema/egress 测试                        |
|  27 | PERSONAL R1 允许第一人称和 PERSONAL_SCORE                                                           | PASS | R1 金标与 permission snapshot                          |
|  28 | R2 只能使用 current 逐条确认 assertion，revoked/stale 阻止                                          | PASS | R2 current/revoked 金标                                |
|  29 | R3/S1/S2/UNCLASSIFIED 不得伪造具体第一人称体验                                                      | PASS | authenticity policy 状态矩阵                           |
|  30 | PUBLIC_RESEARCH 要求 READY Dossier 和“公开资料整理”标签                                             | PASS | S1 public research 金标                                |
|  31 | PERSONAL_SCORE 与 RESEARCH_ANALYSIS_SCORE 严格隔离                                                  | PASS | score origin validator 与两类金标                      |
|  32 | INTERNAL_PREDICTION 不进入 domain、DB、DTO、renderer 或 generation                                  | PASS | schema inventory 和 governance 断言                    |
|  33 | UNKNOWN score 不伪造为 0，模型不能创建个人评分                                                      | PASS | nullable score 与 candidate 负例                       |
|  34 | spoilerPlan 的 NO/LIGHT/FULL、warning/placement/core trick/ending 语义完整                          | PASS | spoiler contract 和 readiness 矩阵                     |
|  35 | ForbiddenExpressionRegistry 区分六类来源且系统规则不可删除                                          | PASS | registry 集合、lock 与删除负例                         |
|  36 | AI 标识与版权不进入禁用表达、readiness 或锁定                                                       | PASS | hard-constraint/governance 行为测试                    |
|  37 | 账号风格只保存观点、短句、冷幽默和不攻击约束，不生成正文                                            | PASS | expression policy 合同                                 |
|  38 | 每个可编辑字段保存 SYSTEM_DERIVED/MODEL_CANDIDATE/USER_EDITED/USER_CONFIRMED provenance             | PASS | field value schema 与 round-trip                       |
|  39 | 字段锁仅 EDITABLE/USER_LOCKED/SYSTEM_LOCKED                                                         | PASS | finite registry 与 CHECK                               |
|  40 | Topic/Experiment/Evidence/policy/authenticity/score/spoiler/system rules 为 SYSTEM_LOCKED           | PASS | scaffold lock snapshot 金标                            |
|  41 | USER_LOCKED regenerate 后逐值不变，模型不能覆盖或解锁                                               | PASS | lock-preservation Scripted Mock 测试                   |
|  42 | 编辑、锁定、解锁、undo、clone、archive、restore 均版本化且显式确认                                  | PASS | state machine/repository/runtime 交互测试              |
|  43 | expected revision、preview diff/hash、sender/window、短期单次 token 完整                            | PASS | CAS、confirmation broker 与 IPC 负例                   |
|  44 | BriefReadinessPolicy 状态集合有限且纯确定性                                                         | PASS | registry、重复求值和输入乱序测试                       |
|  45 | READY 同时要求 current eligible Topic、ready Dossier、权限、评分、剧透、Profile、Evidence 和 Schema | PASS | ready 金标与逐条件负例                                 |
|  46 | incomplete/blocked/stale 可保存但不能进入未来 Draft 生成                                            | PASS | repository readiness 与 protected-table 测试           |
|  47 | FACT_BLOCKED、DOSSIER_NOT_READY、AUTHENTICITY_BLOCKED、STALE 各自可区分                             | PASS | readiness 金标计数                                     |
|  48 | Experiment 绑定要求 LOCKED/current/non-stale、unit/Work/fingerprint/arm/conditions 一致             | PASS | Experiment match 集成测试                              |
|  49 | Experiment mismatch 不修改 Experiment、Topic 或 assignment                                          | PASS | mismatch 负例与前后快照                                |
|  50 | local scaffold 无模型配置可用且未知 judgment/argument 保持空缺                                      | PASS | deterministic scaffold 金标                            |
|  51 | strict ContentBrief candidate 不含标题、正文、标签、评论或图片 prompt                               | PASS | candidate exact-object 负例                            |
|  52 | structured generation 只通过 ModelExecutionService 且 capability/budget 明示                        | PASS | workflow adapter 与 Scripted Mock 测试                 |
|  53 | generation plan 有界显示 IDs、counts、limits、request cap、budget/capability、hash 与 revisions     | PASS | plan contract/preview 测试                             |
|  54 | `CONTENT_BRIEF_GENERATE_V1` payload/result 只含 ID/hash/count/status                                | PASS | queue payload allowlist 与 size 测试                   |
|  55 | executionId 重放幂等且同 Brief 同时最多一个 active generation                                       | PASS | replay/concurrency repository 测试                     |
|  56 | pause/cancel/shutdown/recovery 沿用 JobQueue 且 pre-send 可安全恢复                                 | PASS | workflow/queue 控制测试                                |
|  57 | after-send ambiguous 不自动重试、repair、fallback 或换模型                                          | PASS | Scripted Mock ambiguous 测试                           |
|  58 | 发布 candidate 前重验依赖/input/locks，失败不替换 current ready version                             | PASS | publish CAS 与 failure preservation 测试               |
|  59 | 相同 input 与 locks 为 deterministic no-op                                                          | PASS | repository/generation no-op 测试                       |
|  60 | 依赖变化只精确失效相关 Brief，不 regenerate、解锁或创建 Draft                                       | PASS | invalidation 集成金标                                  |
|  61 | 无关 Topic/Work/Source 不触发全库 stale                                                             | PASS | scoped invalidation 负例                               |
|  62 | 只追加运行时下一条连续 migration，v1—v16 身份不变                                                   | PASS | migration registry/frozen hash 测试                    |
|  63 | 规范扩展现有 `content_briefs`，旧数据保守迁移 incomplete                                            | PASS | v16 upgrade fixture 与 identity 保留                   |
|  64 | FK、STRICT、CHECK、unique、delete policy、索引和 append-only trigger 完整                           | PASS | schema introspection 与 tamper 测试                    |
|  65 | 新库、升级、备份、失败回滚、quick_check、foreign_key_check 通过                                     | PASS | migration/DB 专项测试                                  |
|  66 | Issues 018—023 合成数据升级后完整保留                                                               | PASS | 跨里程碑升级 fixture                                   |
|  67 | DB/WAL/SHM 不保存完整 Source/Dossier/raw response/secret/绝对路径                                   | PASS | schema、path、secret egress 测试                       |
|  68 | repository 列表、详情、版本、diff、Evidence、generation history 均有界分页                          | PASS | capacity/pagination/EXPLAIN 测试                       |
|  69 | `/production` 激活 Brief 列表、筛选、分页和 scaffold 创建                                           | PASS | ContentProductionPage renderer 测试                    |
|  70 | UI 覆盖五类 Profile、audience/objective/judgment/arguments/counterargument                          | PASS | editor 交互测试                                        |
|  71 | UI 显示 Evidence 追溯、fact/opinion/context、真实性、评分、剧透和禁用表达                           | PASS | renderer 状态矩阵                                      |
|  72 | UI 支持 provenance、lock/unlock、version diff、readiness 与 generation 控制                         | PASS | preview/confirm/progress/cancel/history 测试           |
|  73 | UI 明示 Brief 非正文、模型候选需验证、实验非结果、低覆盖阻止、锁定保留                              | PASS | 固定安全文案断言                                       |
|  74 | preload 只新增固定有限分页 DTO；IPC exact-object 与 sender/origin/window 校验                       | PASS | shared/preload/ipc architecture 测试                   |
|  75 | renderer 不接收 Node/SQLite/路径/完整档案/credential/raw response/内部推理                          | PASS | architecture/egress 测试                               |
|  76 | 五类金标、R1/R2/S1、两类评分、FULL spoiler、match/mismatch、两版本/locks 完整                       | PASS | `tests/briefs-gold.test.ts` 与本地证据                 |
|  77 | `test:briefs` 纳入 full test 和 Windows CI，真实密钥/业务网络/模型/费用为 0                         | PASS | package/CI/governance/egress                           |
|  78 | Draft、标题、正文、标签、图片、质量/审批/发布表保持未实现且 0 写入                                  | PASS | protected tables 金标与 scope test                     |
|  79 | 合同、ADR、README、AGENTS、Roadmap、索引、证据同步且全部适用门禁通过                                | PASS | 文档治理测试与最终门禁矩阵                             |
|  80 | 只创建一个 Issue 024 提交，按用户覆盖指令 push `main`，远端 SHA 一致并停止                          | PASS | staged diff、parent、commit count、push 与远端只读核验 |
