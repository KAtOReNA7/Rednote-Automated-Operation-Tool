# M2 Issue 020 增量验收映射

状态：Issue 020 实现与当前 CI 全部门禁完成。表中 `PASS` 均由真实代码、测试、命令或文档
证据支持；Git 提交项由提交后审计在最终报告中闭环。

|   # | 验收点                                                                    | 状态 | 真实证据                                |
| --: | ------------------------------------------------------------------------- | ---- | --------------------------------------- |
|   1 | 动态基线、`main` 与合法本地领先得到保护                                   | PASS | Git 开工/提交后审计                     |
|   2 | 指令只归档于 `docs/instructions/m2/`                                      | PASS | governance test 与文件审计              |
|   3 | 只实施 Issue 020，不进入 Issue 021                                        | PASS | diff、governance test 与最终审计        |
|   4 | ResearchDossier 聚合根严格绑定 Work/Expression/Edition                    | PASS | contracts、migration、repository test   |
|   5 | 同一 subject 只有一个 current dossier                                     | PASS | unique/FK 与并发 repository test        |
|   6 | ResearchDossierVersion append-only 且保留 previous identity               | PASS | migration trigger 与版本历史 test       |
|   7 | 十类有限 Section Registry 拒绝任意语义                                    | PASS | contract validator test                 |
|   8 | DossierEntry 使用 stable semantic key 和有界 value                        | PASS | contract/capacity test                  |
|   9 | entry 精确引用 Claim 与 FactEvaluation                                    | PASS | projection/repository traceability test |
|  10 | entry 精确引用 Evidence 与 SourceRevision                                 | PASS | gold fixture dependency test            |
|  11 | current non-stale VERIFIED 才进入 consensus                               | PASS | policy/repository gold fixture          |
|  12 | insufficient、supporting-only、context-only 不进入 consensus              | PASS | policy boundary test                    |
|  13 | FACT_BLOCKED 只进入 disputed                                              | PASS | conflict projection test                |
|  14 | disputed 显示冲突 identity、有限值、计数、状态与 stale                    | PASS | repository DTO 与 renderer test         |
|  15 | 八种有限 Gap reason code 全部可验证                                       | PASS | contract/coverage parameterized test    |
|  16 | 缺失事实不被补成零、空值或否定                                            | PASS | projection contract test                |
|  17 | coverage 使用 0—10000 整数 basis points                                   | PASS | exact gold policy test                  |
|  18 | overall、section、required、optional coverage 精确输出                    | PASS | coverage fixture test                   |
|  19 | verified/blocked/stale/insufficient/gap counts 精确输出                   | PASS | coverage fixture test                   |
|  20 | duplicate semantic key/Claim 不重复计分                                   | PASS | coverage dedup test                     |
|  21 | required、optional、NOT_APPLICABLE 语义受控                               | PASS | policy/audit test                       |
|  22 | 缺少 section 不能自动满分                                                 | PASS | empty section test                      |
|  23 | coverage input hash 和 reason codes 确定                                  | PASS | repeated/shuffled input test            |
|  24 | readiness 覆盖六种有限状态                                                | PASS | readiness contract test                 |
|  25 | 低 required coverage 不能 READY_FOR_CONTENT_BRIEF                         | PASS | readiness policy test                   |
|  26 | blocking gap/conflict/stale/current-policy 条件均 fail closed             | PASS | readiness parameterized test            |
|  27 | AI、版权与 publication relationship 不参与 coverage/readiness             | PASS | contract shape/governance test          |
|  28 | dependency 保存 Claim revision                                            | PASS | version dependency rows                 |
|  29 | dependency 保存 FactEvaluation identity/version                           | PASS | version dependency rows                 |
|  30 | dependency 保存 Evidence identity/revision                                | PASS | version dependency rows                 |
|  31 | dependency 保存 SourceRevision、Conflict 与 policy versions               | PASS | version dependency rows                 |
|  32 | Source 新 revision 只精确失效相关档案                                     | PASS | invalidation integration test           |
|  33 | Evidence/locator、Claim、evaluation 变化精确失效                          | PASS | invalidation parameterized test         |
|  34 | conflict open/resolve/undo/reopen 精确失效                                | PASS | conflict invalidation test              |
|  35 | classification/independence/policy/subject 事件精确失效                   | PASS | invalidation parameterized test         |
|  36 | 失效事件幂等且不自动执行 rebuild                                          | PASS | repository idempotence test             |
|  37 | 依赖查询使用索引且无 O(n²) 全库扫描                                       | PASS | capacity query-plan test                |
|  38 | build preview 有 bounded counts、diff、coverage/readiness 与 hash         | PASS | plan contract/repository test           |
|  39 | build 确认使用短期、单次 sender/window token                              | PASS | desktop runtime/IPC test                |
|  40 | DOSSIER_BUILD_V1 payload 仅含 ID、版本、hash、有限计数                    | PASS | queue payload/egress test               |
|  41 | executionId 重放幂等                                                      | PASS | workflow replay test                    |
|  42 | 同 subject 跨进程竞争最多一个 active build                                | PASS | repository concurrency test             |
|  43 | 输入未变 rebuild 为 no-op 且无空洞 version                                | PASS | repository/workflow no-op test          |
|  44 | build 期间输入变化拒绝发布旧结果                                          | PASS | stale publish race test                 |
|  45 | 失败/取消不替换 current version                                           | PASS | workflow failure/cancel test            |
|  46 | 重启恢复沿用至少一次队列语义                                              | PASS | recovery/workflow test                  |
|  47 | migration 连续追加且历史 v1—v12 identity 不变                             | PASS | migration identity test                 |
|  48 | 旧 research_dossiers 数据安全迁移                                         | PASS | upgrade fixture test                    |
|  49 | 新库/升级/备份/失败回滚/FK/quick_check 通过                               | PASS | migration/recovery test                 |
|  50 | Issue 018 Catalog 与 Issue 019 Evidence 数据完整保留                      | PASS | migration retention test                |
|  51 | 历史 version/section/entry/dependency/coverage/gap append-only            | PASS | SQL trigger test                        |
|  52 | current pointer 发布使用 expected revision 和事务审计                     | PASS | repository concurrency/audit test       |
|  53 | 档案列表、详情、历史和 diff 均有限分页                                    | PASS | repository capacity/IPC test            |
|  54 | Research UI 展示 current version、section 与三类条目                      | PASS | renderer gold fixture test              |
|  55 | UI 展示追溯、coverage、readiness blocker、stale 与 history diff           | PASS | renderer state test                     |
|  56 | UI 提供 preview/confirm/progress/cancel 且复用冲突跳转                    | PASS | renderer interaction test               |
|  57 | UI 覆盖 loading/empty/error/not-built/stale/conflicted/insufficient/ready | PASS | renderer state matrix                   |
|  58 | IPC exact-object、sender/origin/window/revision/大小校验                  | PASS | settings IPC test                       |
|  59 | renderer 不接收 Node、SQLite、路径、正文、secret 或 raw response          | PASS | architecture/egress test                |
|  60 | Dossier 不写入 facts 或内容生产表                                         | PASS | before/after protected-table test       |
|  61 | gold fixture 包含规定实体、来源、语言、冲突、stale、gap 与两版档案        | PASS | dossier fixture/repository test         |
|  62 | `test:dossier` 纳入 full test 与 Windows CI                               | PASS | package scripts、Vitest、CI             |
|  63 | README、AGENTS、Roadmap、合同、ADR 和索引同步到 Issue 021                 | PASS | governance/documentation test           |
|  64 | 全部适用门禁无失败、skip、todo、warning 或漏洞                            | PASS | 最新 `npm ci` 起完整 CI 顺序            |
|  65 | 真实密钥、业务网络、模型调用和费用均为 0                                  | PASS | egress tests 与最终审计                 |
|  66 | 只创建一个本地提交且不 push                                               | PASS | Git parent/range/remote/worktree 审计   |
