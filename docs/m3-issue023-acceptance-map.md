# M3 Issue 023 验收映射

状态：验收完成。76 项均已由独立、可复核的代码、测试、命令或文档证据覆盖；第 76 项由提交前
staged diff 审计及提交后的只读 Git 审计共同闭环。

|   # | 验收点                                                                 | 状态 | 验证证据                                              |
| --: | ---------------------------------------------------------------------- | ---- | ----------------------------------------------------- |
|   1 | 动态基线、`main` 与合法本地领先得到保护                                | PASS | 实施计划的 Git 基线与最终只读 Git 审计。              |
|   2 | 指令只归档于 `docs/instructions/m3/`                                   | PASS | 唯一文件搜索、源位置缺失和历史指令索引。              |
|   3 | 只实施 Issue 023，不进入 Issue 024/042/043                             | PASS | experiments governance 测试和进度文档。               |
|   4 | Experiment 是稳定 identity 且只有一个 current design                   | PASS | 领域合同、migration 唯一约束和 repository 事务测试。  |
|   5 | DesignVersion immutable、保留 previous 与完整历史                      | PASS | append-only trigger、clone 测试和版本历史读取。       |
|   6 | Hypothesis 包含受众、干预、比较、方向、outcome、理由与反驳条件         | PASS | hypothesis validator 与合同金标。                     |
|   7 | 空泛“更爆/更好”或缺少 comparator/direction/metric/falsification 被拒绝 | PASS | 非法 hypothesis 参数化测试。                          |
|   8 | rationale 不替代事实，且 UI 不声称实验已执行                           | PASS | 合同边界和 renderer 文案断言。                        |
|   9 | Variable registry 有限、版本化并覆盖六类设计意图                       | PASS | constants registry 精确集合测试。                     |
|  10 | 每个设计精确一个 primary variable                                      | PASS | exact-object validator、schema cardinality 和金标。   |
|  11 | arms 数量有界、value 唯一且精确一个 control                            | PASS | arm validator、CHECK/unique 与合同测试。              |
|  12 | 多变量、无 control、重复 arm 或越界 value 被拒绝                       | PASS | 单变量差异 validator 的负面矩阵。                     |
|  13 | Work、AI 标识、版权与出版归属不能成为变量                              | PASS | registry 拒绝测试和 governance 回归。                 |
|  14 | controlled-condition diff 可证明只改变一个主要维度                     | PASS | diff evaluator 与 control/treatment 金标。            |
|  15 | future-bound 标题/图片/发布时间 intent 不伪装为已生成                  | PASS | availability 合同和 UI 状态断言。                     |
|  16 | ReplicationStructure 具有版本、slots、模式、剧透和 fingerprint         | PASS | structure 合同与稳定 fingerprint 测试。               |
|  17 | 同一 structure 至少跨三个不同 canonical Work 才就绪                    | PASS | 三作品 replication 金标。                             |
|  18 | 不同 Edition、重复 Topic 或 fingerprint 不能冒充三本书                 | PASS | canonical Work 去重负面测试。                         |
|  19 | 样本 Topic 必须 current、eligible 且非 HELD/ARCHIVED                   | PASS | repository eligibility 查询与状态过滤测试。           |
|  20 | Topic type、analysis mode、spoiler 与 structure 必须兼容               | PASS | compatibility validator 矩阵。                        |
|  21 | 少于三个 Work 返回 `INSUFFICIENT_REPLICATION`                          | PASS | replication shortfall 金标。                          |
|  22 | 热度分层精确为 HOT/WARM/COLD/UNKNOWN                                   | PASS | popularity registry 精确集合测试。                    |
|  23 | 默认 UNKNOWN，不依据模型记忆、书名或出版社自动推断                     | PASS | popularity policy 与 synthetic fixture 测试。         |
|  24 | 非 UNKNOWN 分层保存来源、窗口、reference、provenance 与 policy         | PASS | popularity snapshot validator 与 schema 约束。        |
|  25 | UNKNOWN 与 COLD 严格不同，分层变化只使相关 assignment stale            | PASS | assignment snapshot 与精确 invalidation 测试。        |
|  26 | primary metric 精确一个且 MetricRegistry 有限、版本化                  | PASS | metric registry、schema cardinality 与合同测试。      |
|  27 | metric availability 仅为三种有限状态                                   | PASS | availability registry 精确断言。                      |
|  28 | 当前不保存真实值、baseline、effect 或结果                              | PASS | DTO/schema/egress 与受保护字段测试。                  |
|  29 | guardrails 有界、不得重复 primary metric 且具方向/违反条件             | PASS | guardrail validator 与 unique 约束测试。              |
|  30 | missing、0 与 zero-denominator policy 语义严格区分                     | PASS | metric policy 单元测试。                              |
|  31 | SamplePlan 保存 unit、目标、规则、arm count、seed 与 blocking keys     | PASS | sample contract 和 repository round-trip。            |
|  32 | 样本计划六态有限且 replication/unbalanced/shortfall 可区分             | PASS | plan status registry 与金标。                         |
|  33 | assignment unit 基于 TopicCandidate 并保留 canonical Work              | PASS | Topic/version/Work FK 与 assignment unit 测试。       |
|  34 | FIRST_30 membership 只能作为只读 inclusion，不得被实验修改             | PASS | quota dependency 查询和 protected write 回归。        |
|  35 | 样本不足返回逐 arm shortfall，不复制 Topic 或放宽规则                  | PASS | assignment shortage 金标。                            |
|  36 | 无历史 effect 时不伪造 power、MDE 或统计功效                           | PASS | 合同/DTO 禁止字段和 UI 边界测试。                     |
|  37 | 相同输入、seed、policy 的 assignment 完全确定                          | PASS | 重复求解金标。                                        |
|  38 | 输入与 Topic 顺序变化不改变 assignment                                 | PASS | 乱序 property 测试。                                  |
|  39 | arms 与 popularity strata 尽可能平衡并输出 reason                      | PASS | balance/imbalance 金标与解释字段。                    |
|  40 | UNKNOWN 不静默并入 HOT/COLD，分层不足显式失败                          | PASS | stratum partition 负面测试。                          |
|  41 | assignment 算法、分页与 dependency 查询有界并使用索引                  | PASS | capacity 测试和 `EXPLAIN QUERY PLAN`。                |
|  42 | Design 状态有限且不存在 RUNNING/COMPLETED/WINNER                       | PASS | 状态 registry 与 schema CHECK 精确断言。              |
|  43 | 支持 create/validate/preview/lock/hold/resume/clone/archive/restore    | PASS | 状态机、repository 与 runtime 交互测试。              |
|  44 | LOCKED 只冻结设计；修改必须 clone 新版本                               | PASS | immutable lock trigger 和 clone version 金标。        |
|  45 | 写入要求 expected revision、preview hash、显式确认与单次 token         | PASS | repository CAS、confirmation broker 与 IPC 测试。     |
|  46 | transition/audit append-only，历史不可覆盖或物理删除                   | PASS | migration trigger 与 tamper 测试。                    |
|  47 | Topic/Quota/Work/Dossier/权限/stratum/policy 变化精确标记 stale        | PASS | dependency/invalidation 集成测试。                    |
|  48 | 无关 Topic/Work 变化不触发全库 stale                                   | PASS | scoped invalidation 金标。                            |
|  49 | stale 不自动重排、解锁或切换 current                                   | PASS | repository current pointer 与 recovery 测试。         |
|  50 | 相同 design/assignment 输入 deterministic no-op                        | PASS | identity hash 与 repository no-op 测试。              |
|  51 | 只追加运行时发现的下一条 migration，v1—v15 身份不变                    | PASS | migration registry 与冻结 hash 测试。                 |
|  52 | 规范扩展同一 `experiments` identity，旧行保守迁移为 draft              | PASS | v15 升级 fixture 与 identity 保留断言。               |
|  53 | FK、STRICT、CHECK、unique、delete policy 与前导索引完整                | PASS | migration schema/introspection 测试。                 |
|  54 | 新库、升级、备份、回滚、quick_check、foreign_key_check 通过            | PASS | DB 专项与 experiments migration 测试。                |
|  55 | Issues 018—022 合成数据升级后完整保留                                  | PASS | 跨里程碑升级 fixture。                                |
|  56 | DB/DTO 不保存正文、完整档案、secret、raw response 或绝对路径           | PASS | schema inventory、secret egress 与 portability 测试。 |
|  57 | Experiment repository 列表、详情、历史和样本读取均有界分页             | PASS | repository pagination/capacity 测试。                 |
|  58 | UI 提供 Experiment 列表、筛选、分页与 hypothesis builder               | PASS | 实验管理页面和 renderer 测试。                        |
|  59 | UI 提供单变量/arm editor 与 controlled-condition diff                  | PASS | editor 交互和单变量可见状态测试。                     |
|  60 | UI 提供 primary metric、guardrail 与 availability 提示                 | PASS | metric editor renderer 测试。                         |
|  61 | UI 提供 Topic/Work 样本选择与三作品 replication 视图                   | PASS | sample selector 与 replication renderer 测试。        |
|  62 | UI 提供 popularity strata，明确 UNKNOWN 不等于冷门                     | PASS | strata UI 和固定边界文案测试。                        |
|  63 | UI 提供 assignment preview、arm/strata balance、shortfall              | PASS | assignment preview 交互测试。                         |
|  64 | UI 提供 validate/lock/hold/clone/archive 与 version history/diff       | PASS | action preview/confirm 与历史状态测试。               |
|  65 | UI 覆盖 loading/empty/error/draft/invalid/insufficient/unbalanced 等   | PASS | renderer 状态矩阵。                                   |
|  66 | UI 明示锁定非执行、无真实指标、单变量和三作品边界                      | PASS | 固定安全文案精确断言。                                |
|  67 | preload 只增加固定、有限、分页 Experiment DTO 与方法                   | PASS | shared contract、preload 与 architecture 测试。       |
|  68 | IPC exact-object、sender/origin/window/revision/hash/token 校验        | PASS | IPC policy 正反例测试。                               |
|  69 | renderer 不接收 Node/SQLite/路径/档案正文/credential/真实指标值        | PASS | architecture、DTO 与 secret-egress 测试。             |
|  70 | 金标覆盖合法单变量、非法多变量、三作品、四分层和两个版本               | PASS | experiments gold suite 与脱敏证据。                   |
|  71 | `test:experiments` 纳入 full test 与 Windows CI                        | PASS | package script、CI step 与治理测试。                  |
|  72 | protected 内容/质量/发布表保持 0 行，Issue 024/042/043 不存在          | PASS | migration/governance 行为测试。                       |
|  73 | 真实指标、密钥、业务网络、模型调用和费用均为 0                         | PASS | synthetic fixture、loopback、egress 与模型调用计数。  |
|  74 | 合同、ADR、README、AGENTS、Roadmap、索引和脱敏证据同步                 | PASS | 文档治理测试与最终链接审计。                          |
|  75 | 从最新 `npm ci` 开始全部适用门禁通过                                   | PASS | 最终本地证据矩阵。                                    |
|  76 | 只创建一个本地提交且不 push                                            | PASS | staged diff、parent、提交数、工作树和远端只读审计。   |
