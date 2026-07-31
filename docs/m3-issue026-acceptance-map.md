# M3 Issue 026 验收映射

状态：完成，60/60 `PASS`。本表先以 `PENDING` 建立，以下结论均在实现与正式门禁完成后按
独立代码、测试、命令或文档证据回填。

|   # | 验收点                                                   | 当前状态 | 独立验证证据                                                                                  |
| --: | -------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
|   1 | 只接受可检查的 immutable DraftVersion                    | PASS     | `fact-mapping-repository` 的 local immutable check 用例验证 current、结构有效与输入 hash 门   |
|   2 | selected title/body/tag/pinned comment artifact 覆盖完整 | PASS     | `fact-mapping-contracts` 的 public surfaces 用例逐类断言四种 artifact                         |
|   3 | warning/固定标签不会被误当事实                           | PASS     | `fact-mapping-gold` 的 full-analysis 用例把纯 warning 保持为 `LABEL_OR_WARNING`               |
|   4 | 警告夹带新事实不能逃逸                                   | PASS     | `fact-mapping-contracts` 的 warning boundary escape 用例进入复核                              |
|   5 | Unicode code point locator 正确                          | PASS     | `fact-mapping-contracts` 以中文、emoji、组合字符验证 code-point 区间                          |
|   6 | locator hash/currentness fail closed                     | PASS     | `resolveDraftTextLocator` 与 assist output 负例拒绝变更 hash、越界和非 current artifact       |
|   7 | Statement 原子化和稳定排序                               | PASS     | `fact-mapping-contracts` 验证两次分段得到相同 locator 顺序                                    |
|   8 | 多事实句正确拆分                                         | PASS     | 多事实金标把“获奖并于 2024 年出版”拆成两个原子片段                                            |
|   9 | FACT/OPINION 正确区分                                    | PASS     | contracts 分类表与单书金标分别验证事实和两条观点                                              |
|  10 | ANALYTICAL_JUDGMENT 与事实分离                           | PASS     | full-analysis 金标保留两个分析判断，仅映射 plot FACT                                          |
|  11 | PERSONAL_EXPERIENCE 留给 Issue 027                       | PASS     | 分类合同只标记体验类别；governance 证明没有 Issue 027 handler 或检查                          |
|  12 | RHETORICAL/LABEL 边界                                    | PASS     | contracts 分类矩阵验证修辞、固定标签和警告的 `NOT_APPLICABLE` 域                              |
|  13 | MIXED/AMBIGUOUS 不能 PASS                                | PASS     | `rollupFactMapping` 与 policy 聚合用例将二者计入 `NEEDS_REVIEW`                               |
|  14 | protected signal detector 覆盖数字/日期/奖项/排名        | PASS     | contracts signal 金标覆盖 NUMBER/DATE/AWARD/RANKING 及 ISBN、百分比、引语                     |
|  15 | 列表序号和作品固有数字负例                               | PASS     | `listOrdinal` 过滤序号；嵌套去重只保留书名 identity、不把书名内数字重复算数值                 |
|  16 | protected signal 不被模型静默降级                        | PASS     | assist exact-output 用例冻结 `protectedSignalsCannotBeDowngraded` 并校验确认位                |
|  17 | Claim candidate 只来自本地有界 allowlist                 | PASS     | policy allowlist 与 deterministic truncation 用例验证 ID 集合和 V1 上限                       |
|  18 | cross-work Claim 不交叉借用                              | PASS     | cross-work gold 与 policy 用例均拒绝另一 Work 的 Claim                                        |
|  19 | alias/redirect 解析 current canonical identity           | PASS     | repository `#resolveEntity` 跟随 active redirect、检测环，并保存 canonical subject 依赖       |
|  20 | 不创建 Claim、Evidence、Source 或研究任务                | PASS     | NO_CLAIM 金标与 repository 受保护表前后计数证明零业务写入                                     |
|  21 | EXACT mapping                                            | PASS     | typed compatibility 的 exact 数字、日期与 award 正例通过                                      |
|  22 | SUPPORTED_PARAPHRASE 本地约束                            | PASS     | `checkTypedFactCompatibility` 仅在本地 typed value/scope 相容时接受该关系                     |
|  23 | NARROWER/BROADER 区分                                    | PASS     | compatibility 对附加数值、比较符和精度变化返回 `BROADER_THAN_CLAIM`/不相容                    |
|  24 | subject/predicate/value/scope mismatch                   | PASS     | policy mismatch 用例分别断言 SUBJECT、PREDICATE、VALUE 与 SCOPE reason                        |
|  25 | multiple candidates/no claim                             | PASS     | engine 只在唯一候选映射；NO_CLAIM 金标与 assist claimIds cardinality 校验覆盖两态             |
|  26 | integer/decimal/percent/currency/unit compatibility      | PASS     | policy typed matrix 覆盖整数、小数、百分比、币种和单位正负例                                  |
|  27 | 日期精度和区间 compatibility                             | PASS     | policy 拒绝 YEAR Claim 被扩写为 MONTH，并校验受控日期精度                                     |
|  28 | 获奖/入围/提名/排名 predicate 不互换                     | PASS     | award policy 用例明确拒绝 nomination 与 TOP ranking 替代 win                                  |
|  29 | KEY_FACT 只接受 current VERIFIED                         | PASS     | `evaluateCandidateFactPolicy` 和 rollup 同时检查 current、evaluation 与 policy                |
|  30 | official primary 路径                                    | PASS     | policy 官方一手来源用例返回 `OFFICIAL_PRIMARY_VERIFIED`                                       |
|  31 | 两个独立 secondary lineage 路径                          | PASS     | policy 两个不同 lineage group 用例返回 `TWO_INDEPENDENT_SECONDARIES_VERIFIED`                 |
|  32 | dependent/context-only/BrowserClip 不能满足              | PASS     | policy 以 dependent BrowserClip/context-only trace 返回不满足                                 |
|  33 | unresolved conflict 产生 FACT_BLOCKED                    | PASS     | conflict gold 保留冲突 trace 并汇总为 `FACT_BLOCKED`                                          |
|  34 | stale/retracted/unavailable SourceRevision 不能满足      | PASS     | blocked-policy 用例拒绝 stale evaluation 与 unavailable evidence；FactPolicy 同拒绝 retracted |
|  35 | Claim—Evaluation—Evidence—SourceRevision 链完整可见      | PASS     | repository trace-chain 用例从真实临时 SQLite 读取完整有界链                                   |
|  36 | contradicts/qualifies 不被隐藏                           | PASS     | conflict gold 保留 `SUPPORTS / CONTRADICTS / QUALIFIES`；UI 链用例逐项显示                    |
|  37 | 中文摘要明确非证据                                       | PASS     | chain DTO 固定 `summaryZhIsEvidence=false`，renderer 显示“非证据中文摘要”                     |
|  38 | PASS 聚合正确                                            | PASS     | policy 三态聚合与单书/完整分析 gold 均得到 `PASS`                                             |
|  39 | FACT_BLOCKED 聚合正确                                    | PASS     | 无来源关键事实和 unresolved conflict 两个 gold 均得到 `FACT_BLOCKED`                          |
|  40 | AWAITING_REVIEW 聚合正确且非 PASS                        | PASS     | supporting fact gold 明确断言 `AWAITING_REVIEW`                                               |
|  41 | `quality_checks` FACT_MAPPING 汇总桥接正确               | PASS     | repository 用例核验 draft/version 关联和 `legacy_unresolved=0`                                |
|  42 | 单项 PASS 不推进整体质量/审批/导出                       | PASS     | `FACT_MAPPING_QUALITY_SUMMARY.passDoesNotAdvanceOverallQuality` 与 governance 断言            |
|  43 | 手工路径无模型配置可用                                   | PASS     | workflow local path 用例以 0 model request 完成；repository local start 可直接发布            |
|  44 | 人工 split/reclassify/map/unmap/undo/reopen              | PASS     | `fact-mapping-manual` 三个用例覆盖六类动作与 immutable 版本                                   |
|  45 | 短期 token、preview hash、expected revision 和窗口绑定   | PASS     | runtime IPC start/decision 用例验证单次 token、sender/window/hash/revision                    |
|  46 | 模型 exact schema、allowlist、locator/hash 校验          | PASS     | contracts assist 负例和 Scripted Mock workflow 校验额外字段、越界与 allowlist                 |
|  47 | 无自动 retry/repair/fallback/换模型                      | PASS     | after-send workflow 用例断言一次请求、`AMBIGUOUS` 且无 retry/fallback                         |
|  48 | executionId 幂等、取消、恢复和 after-send ambiguous      | PASS     | workflow replay/cancel/ambiguous 与 repository `recoverInterrupted` 用例覆盖                  |
|  49 | Draft/Claim/Evidence/Source/FactPolicy 精确失效          | PASS     | migration triggers 与专项用例覆盖新 Draft、相关 Claim、Evidence、SourceRevision 和 policy     |
|  50 | 无关实体不失效                                           | PASS     | precise invalidation 用例修改无关 Work/Claim 后 invalidation 仍为 0                           |
|  51 | migration 新库/升级/备份/回滚/FK/quick check             | PASS     | migration 三个用例验证 v19 新库、v18 升级备份、失败全回滚、FK 与 quick_check                  |
|  52 | 历史 v1—当前 migration 与 Issues 018—025 数据保留        | PASS     | `test:db` 35/35、全量 1,634/1,634 与 upgrade fixture 证明历史数据保留                         |
|  53 | append-only/current pointer/并发约束                     | PASS     | v19 immutable/head revision triggers 与 repository stale decision 用例                        |
|  54 | 分页、容量、确定性和 query plan                          | PASS     | capacity 4 项覆盖 1,000 Draft、上限、插入顺序；repository EXPLAIN 使用索引                    |
|  55 | UI 状态、映射链、人工复核和错误态                        | PASS     | renderer 3 项验证空态、三态、history、chain、preview、blocked readiness                       |
|  56 | IPC exact-object、egress 与 renderer 边界                | PASS     | runtime IPC 7 操作/敌意 origin 用例与 governance DTO-only/egress 断言                         |
|  57 | quality 之外受保护表零写入                               | PASS     | repository 在执行前后逐表计数相等；governance 扫描 SQL 写集合                                 |
|  58 | 真实密钥、业务网络、模型调用和费用为 0                   | PASS     | mock/loopback 正式门禁、source/packaged smoke `externalConnections=0`                         |
|  59 | AI 标识和版权仍不参与检查                                | PASS     | fact-mapping governance 与 `test:constraints` 49/49 保持两项冻结边界                          |
|  60 | Issue 027—030、图片、审批、导出和发布功能不存在          | PASS     | governance、renderer 无下游动作断言与 README 能力边界共同证明                                 |

## 最终闭环

- 已从同一次最新 `npm ci` 起按 Windows CI 顺序完成全部正式门禁；
- 专项、全量、构建、打包、source/packaged Electron smoke 与依赖审计均已如实记录；
- 指令唯一归档，受保护表零写入，外部请求、真实密钥、真实模型调用与真实费用为 0；
- 本表随唯一 Issue 026 本地提交交付；提交后只读核验 parent、范围、工作树和远端，不 push；
- 停止点保持为 Issue 026，不进入 Issue 027。
