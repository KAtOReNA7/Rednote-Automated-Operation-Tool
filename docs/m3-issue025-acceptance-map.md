# M3 Issue 025 验收映射

状态：PASS。31 项增量验收与最终 `npm ci` 起的全量门禁均有独立证据；本文件随唯一本地提交
固化，Git 与远端只报告实际核验结果。

|   # | 验收点                                                                | 当前状态 | 独立验证证据                                             |
| --: | --------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
|   1 | 标题、正文、标签、置顶评论结构完整                                    | PASS     | copy contracts、五类 fixture、structural validation 测试 |
|   2 | Draft 与 Brief、Quality、Approval、Publish 严格分离                   | PASS     | v18 FK、状态合同、protected-table repository 测试        |
|   3 | 五类 profile 的结构和主体规则完整                                     | PASS     | profile registry 与 `copy-contracts` 参数化金标          |
|   4 | NON_SPOILER 不生成答案性显式槽位                                      | PASS     | non-spoiler artifact 行为测试                            |
|   5 | FULL 允许且四类 warning artifacts 齐全                                | PASS     | full-spoiler contract/validation 金标                    |
|   6 | Cross-work comparison slots 与 lineage 对称                           | PASS     | comparison structure/lineage 金标                        |
|   7 | 账号 style required/forbidden traits 冻结                             | PASS     | account voice registry 测试                              |
|   8 | 不讨论 AI 运营实验，不攻击作者或读者                                  | PASS     | voice forbidden-expression 行为测试                      |
|   9 | R1、R2、S1 权限和公开 labels 从 Brief 继承                            | PASS     | copy policy 金标与 Brief snapshot 校验                   |
|  10 | 未授权第一人称、错误评分来源和内部预测产物被拒绝                      | PASS     | authenticity/score/schema 负例与 governance              |
|  11 | lineage 只能引用 Brief allowlist                                      | PASS     | structural lineage validator 负例                        |
|  12 | 编造 ID、prompt injection 与越界字段被拒绝                            | PASS     | exact candidate、allowlist 和 Scripted Mock 测试         |
|  13 | Experiment arm 与 controlled conditions 保持                          | PASS     | system-locked Brief snapshot 与 lock-preservation 测试   |
|  14 | 无模型配置时手工 scaffold 可用                                        | PASS     | desktop runtime manual preview/confirm 测试              |
|  15 | capability unknown/unsupported/stale 与 budget blocked 均 fail closed | PASS     | mutation plan/repository/runtime 状态矩阵                |
|  16 | Scripted Mock 完整生成且请求数与 preview 一致                         | PASS     | generation handler 单请求集成测试                        |
|  17 | 不自动 retry、repair、fallback 或换模型                               | PASS     | after-send ambiguous Scripted Mock 测试                  |
|  18 | 局部重写后 scope 外字段逐值不变                                       | PASS     | copy rewrite scope-preservation 参数化测试               |
|  19 | locked fields 不被完整生成或重写覆盖                                  | PASS     | USER_LOCKED/SYSTEM_LOCKED merge 负例                     |
|  20 | 非法 rewrite scope、跨 block 与改政策被拒绝                           | PASS     | rewrite exact scope/policy 负例                          |
|  21 | edit、lock、unlock、reorder、undo、diff 与 stale revision 完整        | PASS     | repository append-only/CAS 测试                          |
|  22 | 结构验证与 Issues 026—030 质量检查边界独立                            | PASS     | status contract、governance 与 protected tables          |
|  23 | `READY_FOR_QUALITY_PIPELINE` 不等于质量通过                           | PASS     | finite status registry、UI 固定边界文案                  |
|  24 | executionId 重放、no-op、失败、取消、恢复、ambiguous 保守             | PASS     | mutation repository/workflow/queue 集成测试              |
|  25 | 依赖变化只精确 stale 相关 Draft，无关实体不失效                       | PASS     | dependency invalidation 正反例与索引计划                 |
|  26 | migration 新库、v17 升级、备份、回滚、FK、quick check                 | PASS     | `copy-migration` 与完整 DB 套件                          |
|  27 | 列表/历史分页、容量与关键 query plan 有界                             | PASS     | repository pagination/EXPLAIN 与 contract limits         |
|  28 | UI、IPC、egress 状态矩阵完整                                          | PASS     | copy renderer、runtime IPC、settings IPC、governance     |
|  29 | assets、quality_checks、approvals、post_packages、publications 零写入 | PASS     | `COPY_PROTECTED_TABLES` 集成断言                         |
|  30 | 真实密钥、业务网络、模型调用和费用均为 0                              | PASS     | Scripted Mock、direct-egress governance、运行边界审计    |
|  31 | Issue 026—030 功能不存在                                              | PASS     | governance、状态/DTO/DB inventory 与范围审计             |

## 最终闭环证据

- 最新 `npm ci` 开始的 Windows CI 顺序门禁、本轮风险追加门禁与 1553 项全量测试全部通过；
- instruction 只有 `docs/instructions/m3/` 一份，原 Desktop 路径不存在且字节 hash 不变；
- staged diff 只包含 Issue 025；本文件所在提交的 parent 必须为动态开工 HEAD；
- 本地 `origin/main` 与只读远端在提交前后保持开工基线；
- 不 push、不进入 Issue 026；提交身份与上述 Git 事实由最终交付报告提供。
