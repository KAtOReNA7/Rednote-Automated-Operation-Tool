# M2 Issue 021 增量验收映射

状态：完成。以下 `PASS` 均由本轮实际代码、测试、命令或文档证据支持；没有预填，也没有用
概括性引用替代独立证据。

|   # | 验收点                                                                       | 状态 | 实际证据                                                                      |
| --: | ---------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------- |
|   1 | 动态基线、`main` 与合法本地领先得到保护                                      | PASS | 开工与交付前 `git status/log/rev-list` 核对 `main`、动态 HEAD 和 ahead 3      |
|   2 | 指令只归档于 `docs/instructions/m2/`                                         | PASS | `tests/authenticity-governance.test.ts` 唯一文件与原位置不存在断言            |
|   3 | 只实施 Issue 021，不进入 Issue 022                                           | PASS | Git diff、治理测试及 M2 收口文档均只声明 M3 Issue 022 为下一步                |
|   4 | Reading State 只含 R1/R2/R3/S1/S2/UNCLASSIFIED                               | PASS | `authenticity-contracts` 枚举断言与 v14 `reading_state_revisions` CHECK       |
|   5 | Memory Confidence 只含五种有限值                                             | PASS | `authenticity-contracts` 五值断言与 v14 CHECK                                 |
|   6 | 状态与 confidence 合法组合 fail closed                                       | PASS | `authenticity-contracts` 合法/非法组合参数化测试                              |
|   7 | profile + Work 只有一个 current state                                        | PASS | v14 `UNIQUE(profile_id, book_id)`、真实 FK 与 repository 并发断言             |
|   8 | Reading State revision 历史 append-only                                      | PASS | v14 append-only trigger 与 repository history/undo 测试                       |
|   9 | 状态只能由显式用户操作改变                                                   | PASS | exact contract 只接受 `USER_UI`/显式确认；gold/governance 验证无推断路径      |
|  10 | 状态变化使用 preview、expected revision 与单次 token                         | PASS | repository、runtime、IPC 的 preview/stale/sender/window/consume 测试          |
|  11 | undo 事务化恢复前一状态并保留历史                                            | PASS | `authenticity-repository` 验证 rev 1→2→undo rev 3 与 append-only audit        |
|  12 | 购买、持有、Clip、搜索、Dossier、模型不能推断已读                            | PASS | exact-object negative test、gold fixture 与 zero-egress governance            |
|  13 | 旧 reading_states 数据保守迁移且不自动升级 R1                                | PASS | `authenticity-migration` legacy READ/UNKNOWN/NOT_READ 升级 fixture            |
|  14 | R2 assertion 绑定 profile、Work 与 reading revision                          | PASS | v14 FK 链与 repository current-reading-revision 集成测试                      |
|  15 | R2 assertion kind、scope 与陈述大小有限                                      | PASS | contract exact-object/2,000-byte 测试及 v14 enum/length CHECK                 |
|  16 | R2 只允许 current、逐条确认、未撤销 assertion                                | PASS | policy test 与六 Work gold fixture                                            |
|  17 | reading revision 改变使旧 assertion stale                                    | PASS | repository revision-change 集成测试                                           |
|  18 | assertion 撤销立即失去对应权限                                               | PASS | repository revoke 后 first-person permission 立即 `BLOCKED`                   |
|  19 | R3 不可创建公开第一人称 assertion                                            | PASS | repository R3 negative test 保持 assertion 表计数为 0                         |
|  20 | R1 允许第一人称和个人评分                                                    | PASS | policy 与 gold R1 permission matrix                                           |
|  21 | R1 仍受 Dossier/FactPolicy 正交约束                                          | PASS | gold R1 + `FACT_BLOCKED`：个人权限允许但 brief/research 阻止                  |
|  22 | R2 只允许 confirmed-assertions-only                                          | PASS | policy 与 gold R2 `ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY`                    |
|  23 | R2 个人评分要求 current PERSONAL_SCORE assertion                             | PASS | policy/repository score guard 与 gold PERSONAL_SCORE assertion                |
|  24 | R3 阻止具体第一人称和个人评分                                                | PASS | policy 参数化测试与 gold R3 matrix                                            |
|  25 | R3 + READY Dossier 只允许公开资料分析                                        | PASS | gold R3 + READY 输出 `RESEARCH_ONLY`                                          |
|  26 | S1 + READY Dossier 允许资料分析与资料分析评分                                | PASS | gold S1 matrix 与 research score repository 测试                              |
|  27 | S1 缺少 READY Dossier 时阻止资料分析                                         | PASS | policy missing-Dossier negative test                                          |
|  28 | S2 阻止全部未来内容模式                                                      | PASS | gold S2 matrix                                                                |
|  29 | UNCLASSIFIED 不自动降级为 S1                                                 | PASS | library default与 gold unclassified fail-closed 断言                          |
|  30 | Snapshot 输出有限权限状态和可解释 reason codes                               | PASS | `ExpressionPermissionSnapshotV1` 合同与 policy snapshot 断言                  |
|  31 | Dossier readiness 与个人体验权限保持正交                                     | PASS | policy/gold 的 R1 conflict、R3/S1 READY 组合                                  |
|  32 | stale snapshot fail closed                                                   | PASS | Dossier/Catalog invalidation与旧 policy version 列表/详情测试                 |
|  33 | evaluator 相同或乱序输入结果确定                                             | PASS | policy assertion-order 与 dependency-hash replay 测试                         |
|  34 | personal、research-analysis、internal score 三类隔离                         | PASS | 三张 STRICT 表、repository 与 gold score isolation                            |
|  35 | 所有评分使用整数有限量表，UNKNOWN 保持 NULL                                  | PASS | contract safe-integer/范围测试与 v14 INTEGER CHECK                            |
|  36 | internal prediction 不进入公开 renderer DTO                                  | PASS | shared DTO absence、repository JSON egress 与 governance 测试                 |
|  37 | 资料评分强制“资料分析评分”标签要求                                           | PASS | v14 CHECK、repository publicLabel 与 renderer 断言                            |
|  38 | 三类 score 不自动复制、转换或混存                                            | PASS | 独立表/独立写入路径及 repository table-count 测试                             |
|  39 | NO/LIGHT/FULL_TRICK 三档 spoiler policy 完整                                 | PASS | policy 参数化测试与 gold 三档 fixture                                         |
|  40 | FULL_TRICK 允许但强制醒目 warning                                            | PASS | spoiler policy/gold 验证双位置警告与显式确认                                  |
|  41 | 缺失 spoiler warning 时 content-brief readiness blocked                      | PASS | policy 独立 incomplete FULL_TRICK 断言                                        |
|  42 | spoiler warning 不提升事实或个人体验权限                                     | PASS | policy/repository S1 full-trick 正交测试                                      |
|  43 | Snapshot 保存 state/assertion/Dossier/policy 精确依赖                        | PASS | repository dependency rows 与 v14 dependency enum/FK                          |
|  44 | state/assertion/Dossier/policy/Catalog 变化精确失效相关 Work                 | PASS | repository state/assertion/Dossier/Catalog 与旧 policy version 测试           |
|  45 | 无关 Work 变化不触发全库失效                                                 | PASS | repository related/unrelated Work invalidation 断言                           |
|  46 | 失效幂等且不自动改状态、确认 assertion 或创建内容任务                        | PASS | event identity UNIQUE、append-only invalidation 与 protected-table gold       |
|  47 | 关键 lookup 使用索引且无 O(n²) 全库扫描                                      | PASS | repository `EXPLAIN QUERY PLAN` 命中 dependency lookup index                  |
|  48 | 单本列表/详情/历史/assertion 均有限分页                                      | PASS | repository/IPC 100 上限、history offset 与 assertion 100 上限                 |
|  49 | 批量分类默认空选择、批次有界、逐项 revision                                  | PASS | contract 50 上限、renderer disabled-default 与 batch preview 测试             |
|  50 | 批量并发冲突逐项报告且不静默覆盖                                             | PASS | repository 1 success/1 stale partial-result 测试                              |
|  51 | migration 连续追加且历史 v1—v13 identity 不变                                | PASS | `authenticity-migration` checksum 与 version 1—14 断言                        |
|  52 | 新库/升级/备份/失败回滚/FK/quick_check 通过                                  | PASS | migration 专项及最终 `test:db` 35 项                                          |
|  53 | Issue 018 Catalog、019 Evidence、020 Dossier 完整保留                        | PASS | bibliography/evidence/dossier migration 与最终全量回归                        |
|  54 | 历史 state/assertion/snapshot/audit append-only                              | PASS | v14 update/delete trigger negative tests                                      |
|  55 | UI 展示六态、confidence、历史、undo 与 R2 assertion                          | PASS | `authenticity-library.tsx` 与 renderer interaction test                       |
|  56 | UI 并列显示 Dossier readiness、体验权限和评分隔离                            | PASS | renderer permission matrix、score labels 与 Dossier 文案断言                  |
|  57 | UI 展示 spoiler 要求及五条真实性警示                                         | PASS | renderer semantic 文案与 spoiler controls 测试                                |
|  58 | UI 覆盖 loading/empty/error/unclassified/stale/conflicted/insufficient/ready | PASS | component state classifier 与 renderer empty/error/ready/insufficient 测试    |
|  59 | IPC exact-object、sender/origin/window/profile/revision/大小/token 校验      | PASS | `authenticity-ipc`、runtime 与 `settings-ipc` negative tests                  |
|  60 | renderer 不接收 Node、SQLite、路径、正文、secret、raw response 或内部预测分  | PASS | governance/desktop architecture/egress 扫描                                   |
|  61 | content_briefs/drafts/approvals/post_packages/publications 不被写入          | PASS | six-Work gold 前后五张保护表均为 0                                            |
|  62 | 盗版电子书无入口、无解析、无保存、无索引                                     | PASS | governance implementation/schema absence 测试                                 |
|  63 | 六 Work 金标覆盖所有状态、Dossier 与 assertion/score/spoiler 组合            | PASS | `tests/authenticity-gold.test.ts`                                             |
|  64 | `test:authenticity` 纳入 full test 与 Windows CI                             | PASS | `package.json`、141-file full test 与 `.github/workflows/ci.yml`              |
|  65 | README、AGENTS、Roadmap、合同、ADR 和索引完成 M2 收口                        | PASS | authenticity/repository documentation governance tests                        |
|  66 | READY 只表示前置就绪，M3 内容生产能力仍不存在                                | PASS | README、M2 closeout、Roadmap 与 absence/protected-table tests                 |
|  67 | 全部适用门禁无失败、skip、todo、warning 或漏洞                               | PASS | 最新 `npm ci` 起 CI 顺序全绿；141 文件、1291 tests、build/package/smoke/audit |
|  68 | 真实密钥、业务网络、模型调用和费用均为 0                                     | PASS | egress/governance、Electron 与 packaged smoke 均为 externalConnections 0      |
|  69 | 只创建一个本地提交且不 push                                                  | PASS | 指定提交前范围审计；交付后核验 parent、HEAD、工作树与远端未改变               |

## 最终命令证据

- 最新 `npm ci`：274 个 package audit，0 vulnerability。
- Windows CI 顺序的全部专项、Electron smoke、全量测试、构建、桌面/Clipper 打包、
  packaged smoke 与 dependency audit 均通过。
- 全量 Vitest：141 个测试文件、1291 项测试通过，0 failure、0 skip、0 todo。
- Electron source smoke 与 packaged smoke：`externalConnections=0`、端口均释放；
  packaged fuses 已验证。
- 非 CI 的交互式 `test:clipper-real` 另行尝试；隔离 Chrome 窗口未取得前台焦点，快捷键未触发，
  因而没有形成浏览器验收结果。该环境事件不替代也不削弱当前 CI 中已通过的 Clipper suite、
  打包和 smoke。
