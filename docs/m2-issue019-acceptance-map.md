# M2 Issue 019 增量验收映射

状态：完成。全部证据来自本轮本地实现、合成 fixture、临时 SQLite、Scripted Mock、本机
loopback、隔离浏览器 smoke 与提交前门禁。

|   # | 验收点                                                        | 状态 | 证据                                                                                             |
| --: | ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
|   1 | 动态基线与合法本地领先得到保护                                | PASS | 开工记录为 `main@60a922e`，本地仅合法领先 Issue 018；未 pull、rebase、reset 或 push              |
|   2 | 指令只归档于 `docs/instructions/m2/`                          | PASS | `tests/evidence-governance.test.ts` 验证归档文件唯一且根目录、外部原位置均无副本                 |
|   3 | 只实施 Issue 019，不进入 Issue 020                            | PASS | `git diff` 仅覆盖 Source/Evidence/FactPolicy/冲突、Research UI、v12 和兼容门禁                   |
|   4 | Source identity 与不可变 revision                             | PASS | `tests/evidence-contracts.test.ts` 与 repository 重放/新 revision 专项                           |
|   5 | FetchDocument 受控转换为 Source                               | PASS | repository 专项以成功 Scripted Fetch 验证 run、URL、hash、路径绑定及冻结状态保留                 |
|   6 | BrowserClip 固定 `CONTEXT_ONLY`                               | PASS | repository 专项用本地 clip ingest 验证强制 context，错误升级在 policy boundary 拒绝              |
|   7 | Synthetic fixture 醒目标记且只用于测试                        | PASS | `syntheticSource` 写入 synthetic/provenance/warning，正式 origin validator 不接受 fixture 分类者 |
|   8 | Source authority/use/availability 分类有限且可解释            | PASS | Source V1 validator、v12 CHECK 与 `source_classifications.reason_code`                           |
|   9 | lineage 和确认独立性不重复计数                                | PASS | `tests/evidence-policy.test.ts` 覆盖同稿 lineage 去重、UNKNOWN/DEPENDENT 不计数                  |
|  10 | 五类 subject 由真实 FK 注册表约束                             | PASS | v12 `fact_subjects` 对 Work/Expression/Edition/Agent/PublicationRelationship 使用真实 FK         |
|  11 | Predicate Registry 固定值类型和冲突语义                       | PASS | v12 `predicate_registry`、Atomic Claim 合同与 migration 列/约束测试                              |
|  12 | AtomicClaim exact-object、类型、scope 与大小边界              | PASS | contracts 专项拒绝额外字段、错误类型、非法 scope、过长值及不精确 decimal                         |
|  13 | EvidenceLocator 绑定 revision/text hash/区间                  | PASS | 日文 Unicode code point locator 行为测试绑定 source revision、全文 hash 与区间                   |
|  14 | excerpt/hash/locator 不匹配 fail closed                       | PASS | locator 专项逐一拒绝全文 hash、范围、excerpt hash 和摘要绑定错误                                 |
|  15 | 原文和中文摘要分离，摘要不替代证据                            | PASS | Evidence 合同保存独立 excerpt/summary 字段；renderer 明示摘要仅供阅读                            |
|  16 | 日文 Evidence 与中文摘要                                      | PASS | contracts/repository gold fixture 保留 `ja-JP` 原文并列中文摘要                                  |
|  17 | 英文 Evidence 与中文摘要                                      | PASS | contracts gold fixture 验证 `en-US` 原文 locator 与中文摘要相互独立                              |
|  18 | 官方一手来源验证关键事实                                      | PASS | policy 与 SQLite repository gold fixture 均得到 `OFFICIAL_PRIMARY / VERIFIED`                    |
|  19 | 两个确认独立二级来源验证关键事实                              | PASS | 两个不同 confirmed lineage group 得到 `TWO_INDEPENDENT_SECONDARY`                                |
|  20 | 同稿转载不能算两个来源                                        | PASS | policy gold fixture 对同 lineage 的两个 reprint 返回证据不足                                     |
|  21 | UNKNOWN independence 不满足两来源规则                         | PASS | policy 专项覆盖 UNKNOWN 与 DEPENDENT 均不能成为第二独立来源                                      |
|  22 | discussion/social clip 只提供 context                         | PASS | policy 专项和 BrowserClip repository 集成测试均不能以 clip 验证关键事实                          |
|  23 | 冲突键包含主体、谓词、scope、policy version                   | PASS | `detectMaterialConflict` 和 v12 `fact_conflicts.conflict_key` 使用完整事实槽                     |
|  24 | 出版日期实质冲突产生 `FACT_BLOCKED`                           | PASS | repository gold fixture 的两个不可兼容日期创建冲突并评估为 `FACT_BLOCKED`                        |
|  25 | 日期精度兼容、不同 scope 和 alias 不误报                      | PASS | conflict 专项覆盖 year/day 相容、scope 分离及 canonical entity alias                             |
|  26 | 多值 predicate 使用确定性集合语义                             | PASS | policy 专项验证允许多值集合不误报，规范值排序保持确定性                                          |
|  27 | resolve preview/confirm/reason/expected revision              | PASS | runtime confirmation broker + repository preview hash/reason/revision 专项                       |
|  28 | 冲突 decision/audit append-only 且事务化                      | PASS | v12 append-only triggers；repository 将 conflict、decision、audit、双方 evaluation 同事务        |
|  29 | undo、reopen 和并发 stale fail closed                         | PASS | repository 专项验证 ACCEPT→UNDO→ACCEPT→REOPEN 及旧 preview revision 拒绝                         |
|  30 | Source 新 revision 令 evaluation stale                        | PASS | 新 revision 专项将旧结论改为 `STALE_REVIEW_REQUIRED` 且保留旧 Evidence 绑定                      |
|  31 | unavailable/retracted 触发重算                                | PASS | policy/repository 专项覆盖 AVAILABLE 变化、UNAVAILABLE 与 RETRACTED                              |
|  32 | 模型记忆无 Evidence 被拒绝                                    | PASS | policy 专项以 `modelMemoryOnly` 返回 `MODEL_MEMORY_REJECTED / REJECTED`                          |
|  33 | prompt injection 不能修改 schema 或 policy                    | PASS | structured output validator 拒绝注入字段、未知 predicate 与 policy mutation                      |
|  34 | 无模型配置的纯手工路径可用                                    | PASS | workflow/repository 专项完成 local classify/reconcile，external request 为 0                     |
|  35 | structured capability unknown/unsupported/stale 被阻止        | PASS | workflow parameterized fixtures 对三类 capability 状态均在发送前阻止                             |
|  36 | 预算阻止、UNKNOWN 费用和缓存命中保持既有语义                  | PASS | workflow 专项覆盖 budget block、缓存命中与 `UNKNOWN` fee，不猜测零费用                           |
|  37 | SourceProcessingPlan 有界、ID-only、显式确认                  | PASS | contracts 验证 ID-only/limits/hash/expiry；runtime 使用 sender-window 一次性 token               |
|  38 | executionId 重放幂等                                          | PASS | workflow/repository replay 专项证明同 executionId 不重复评估、外发或本地结果                     |
|  39 | 崩溃恢复、暂停、取消和 ambiguous 保守处理                     | PASS | workflow parameterized 专项覆盖 pre-send 恢复与 after-send ambiguous/cancel                      |
|  40 | migration v12 新库、v11 升级与数据保留                        | PASS | `tests/evidence-migration.test.ts` 覆盖新库和 v11→v12 保留 Source/Claim/Evidence/catalog         |
|  41 | migration 备份、失败回滚、FK 与 quick_check                   | PASS | migration 专项验证独立备份、不可证明 legacy 回滚、FK/quick_check                                 |
|  42 | v1–v11 migration 身份和 Issue 018 catalog 行保持              | PASS | v12 专项冻结全部历史 checksum，并核对 Work/Expression/Edition/relationship ID                    |
|  43 | 关键查询分页且使用预期索引                                    | PASS | `tests/evidence-capacity.test.ts` 验证稳定分页和事实键 query plan                                |
|  44 | 事实调和无 O(n²) 全库比较                                     | PASS | reconcile 按 subject/predicate/scope/policy 索引槽查询，容量测试禁止全表 all-pairs               |
|  45 | Research UI 展示 inbox/source/revision/分类/lineage           | PASS | `apps/web-ui/src/research-page.tsx` 与 renderer 专项展示来源、revision 和分类状态                |
|  46 | Research UI 并列原文、中文摘要、Claim 和 evaluation           | PASS | renderer gold fixture 同卡展示原文、语言、中文摘要、原子值和评估                                 |
|  47 | Research UI 展示冲突、`FACT_BLOCKED`、resolve/undo/reopen     | PASS | renderer 专项要求 preview、reason、确认；repository 专项验证 undo/reopen 写入语义                |
|  48 | Research UI 展示 plan preview/progress/cancel/history         | PASS | Research 页面 processing controls/history 与 IPC runtime 的 plan/cancel DTO                      |
|  49 | UI 覆盖 loading/empty/error/stale/unconfigured/budget-blocked | PASS | renderer 专项覆盖 stale/budget/conflict 与 model-unconfigured；组件显式 loading/error/empty      |
|  50 | IPC exact-object、sender/window token 和安全错误              | PASS | `tests/settings-ipc.test.ts` 覆盖 6 个 evidence channel、额外字段和错误脱敏                      |
|  51 | renderer 无 Node/SQLite/路径/secret/raw HTML                  | PASS | evidence governance 与 desktop architecture 扫描 renderer import/egress/HTML 边界                |
|  52 | Search/Fetch/Catalog 冻结状态不被提升                         | PASS | governance 与受控转换集成测试核对候选、FetchDocument、Catalog 原状态                             |
|  53 | dossier/topic/draft/approval/post package 不被写入            | PASS | confirmed local plan 前后五类保护表计数完全一致                                                  |
|  54 | AI、版权、publication relationship 不参与 FactPolicy          | PASS | policy 输入形状及 governance 测试排除三类非事实政策元数据                                        |
|  55 | 真实密钥、网络、模型调用和费用均为 0                          | PASS | egress/governance/workflow 使用合成 fixture、Scripted Mock 与本机临时库，无真实调用              |
|  56 | `test:evidence` 纳入 full test 与 Windows CI                  | PASS | `package.json`、Vitest config 与 `.github/workflows/ci.yml` 均显式登记专项                       |
|  57 | README、AGENTS、合同、ADR 和索引同步到 Issue 020              | PASS | repository-documentation 87 项回归通过，README/AGENTS/指令索引均指向 Issue 020                   |
|  58 | 全部适用门禁无失败、skip、todo、warning 或漏洞                | PASS | 最新 `npm ci` 起按 Windows CI 顺序通过；123 文件、1172 tests、构建/打包/smoke/audit 全绿         |
|  59 | 只创建一个本地提交且不 push                                   | PASS | 交付流程只暂存本轮范围并创建指定提交；提交后核验 parent、HEAD、工作树和远端未变                  |
