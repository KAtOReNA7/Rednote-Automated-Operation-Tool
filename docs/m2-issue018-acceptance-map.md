# M2 Issue 018 增量验收映射

状态：完成。全部证据均来自本轮本地实现、合成 fixture、临时 SQLite、本机 loopback 与提交前门禁。

|   # | 验收点                                              | 状态 | 证据                                                                                   |
| --: | --------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
|   1 | 动态核对并安全同步 origin/main                      | PASS | 开工基线 `main@1432221`，本地与 `origin/main` ahead/behind 为 `0/0`，无需快进变更      |
|   2 | 指令只归档于 docs/instructions/m2                   | PASS | `tests/bibliography-governance.test.ts` 验证根目录与外部原位置均无副本                 |
|   3 | 只实施 Issue 018，不进入 Issue 019                  | PASS | `git diff` 范围为书目发现、实体解析、治理和对应兼容测试；Issue 019 未实现              |
|   4 | PRD/Roadmap 固定 50 口径定向修订                    | PASS | `tests/bibliography-governance.test.ts` 验证修订通知和非固定规模口径                   |
|   5 | Observation V1 exact-object 与大小边界              | PASS | `tests/bibliography-contracts.test.ts` 覆盖额外字段、深度、数组与 128 KiB 拒绝         |
|   6 | Observation 原值/规范值和 field provenance 分离     | PASS | `packages/catalog/src/contracts.ts` 与 observation provenance 表合同                   |
|   7 | Observation revision append-only 与 origin 重放幂等 | PASS | `tests/bibliography-discovery.test.ts` 覆盖三元 origin identity 与重复执行             |
|   8 | Search/Fetch/Clip 冻结状态不提升                    | PASS | `tests/bibliography-discovery.test.ts` 验证 persisted input 状态和事实表均不被修改     |
|   9 | Work/Expression/Edition 三级模型                    | PASS | migration v11 与 `tests/bibliography-repository.test.ts` 的实体树断言                  |
|  10 | 旧 Work/Edition ID 与下游引用保留                   | PASS | v10→v11 升级测试保留长 Work/Author、Edition 与 reading state ID                        |
|  11 | Edition 只保存 expression_id                        | PASS | 升级测试断言 `book_editions` 有 `expression_id` 且无 `book_id`                         |
|  12 | Agent 与 Person/Organization alias                  | PASS | v11 的 `catalog_agents`、`catalog_agent_aliases` 与角色关系 STRICT 表                  |
|  13 | Work/Expression/Edition 分层关系                    | PASS | v11 FK 链与 `getWorkDetail` 分层 DTO                                                   |
|  14 | publication relationship 方向/范围/UNKNOWN          | PASS | repository 测试覆盖方向、有限状态与未知能力                                            |
|  15 | publication relationship 永不参与门禁               | PASS | publication 写入前后 topics/briefs/approvals/packages 计数不变                         |
|  16 | Unicode NFKC 与中日英规范化                         | PASS | contracts 专项覆盖全角、中文、日文和英文确定性规范化                                   |
|  17 | ISBN-10/13 校验、转换、无效和冲突                   | PASS | `canonicalizeIsbn` 专项覆盖校验位、双向转换、无效值与强标识冲突                        |
|  18 | platform/publisher scoped identifier                | PASS | scoped ID 专项验证 namespace/value 作用域与非法格式拒绝                                |
|  19 | ISBN 仅关联 Edition                                 | PASS | v11 CHECK 及 repository identifier 查询限定 `entity_type='EDITION'`                    |
|  20 | 保守 feature vector 与五类 outcome                  | PASS | `packages/catalog/src/resolution.ts` 的确定性 feature vector/outcome 测试              |
|  21 | 自动 EXACT_LINK 仅强标识符+兼容上下文               | PASS | gold fixture 中同 ISBN/兼容上下文 exact link，冲突上下文不链接                         |
|  22 | 标题/作者相似只进入人工复核                         | PASS | title-only fixture 只生成 `PROBABLE_REVIEW`，Work 数不增加                             |
|  23 | gold fixture cluster 完全一致                       | PASS | gold fixture 结果为 2 Work、2 Expression、2 Edition                                    |
|  24 | gold fixture 自动误合并为 0                         | PASS | 冲突、仅题名与缺失标题观察均无自动链接或新增伪事实                                     |
|  25 | merge preview/confirm 与 expected revision          | PASS | repository 测试验证 hash/token、双 Work revision 与单事务 merge                        |
|  26 | split preview/confirm                               | PASS | repository 测试验证 Expression 子集预览、确认和新 Work                                 |
|  27 | undo 与旧 ID redirect                               | PASS | merge/split/undo 测试验证 redirect 解析与 lineage 回退                                 |
|  28 | decision/audit append-only                          | PASS | v11 append-only trigger 与 decision/audit 记录断言                                     |
|  29 | 并发冲突与事务回滚                                  | PASS | stale revision 测试返回稳定冲突且实体/决策计数不变                                     |
|  30 | Discovery Profile/Plan/Run 版本化                   | PASS | `bibliography-discovery-v1` 合同与计划 round-trip 测试                                 |
|  31 | required/optional strata 与 gap reason              | PASS | discovery 测试覆盖必选/可选分层及 `NO_ELIGIBLE_PERSISTED_INPUT`                        |
|  32 | Coverage 计数/provenance/去重前后基数               | PASS | repository coverage DTO 映射并由 queue discovery 测试核对                              |
|  33 | synthetic/fixture 醒目标记                          | PASS | profile、run 和 observation 均保存 synthetic 标志/警告                                 |
|  34 | 计划 preview hash、过期和明确确认                   | PASS | confirmation broker 专项覆盖 sender/window、过期、单次消费和 hash                      |
|  35 | BIBLIOGRAPHY_DISCOVERY_V1 持久队列                  | PASS | handler 注册、jobs 持久化及目录 Worker 类型过滤测试                                    |
|  36 | 有界批次/checkpoint/heartbeat/暂停/取消             | PASS | discovery 专项覆盖 batch checkpoint、heartbeat、PAUSED 与 CANCELLED                    |
|  37 | executionId 重放和崩溃恢复幂等                      | PASS | 相同 executionId 重跑 observation/work 计数不增加                                      |
|  38 | 外部请求、模型、费用、密钥读取均为 0                | PASS | egress 治理测试及 source/packaged smoke 均报告 `externalConnections: 0`                |
|  39 | migration v11 新库/升级/备份/失败回滚               | PASS | DB、settings、repository 测试覆盖新库、v10 升级、独立备份和后续失败回滚                |
|  40 | STRICT/FK/CHECK/索引/quick_check                    | PASS | migration 测试执行 `quick_check`、`foreign_key_check` 并冻结 v11 SHA-256               |
|  41 | 10,000 Work 合成容量                                | PASS | `tests/bibliography-capacity.test.ts` 插入 10k Work/20k Expression/Edition/Observation |
|  42 | 关键查询使用预期索引且分页                          | PASS | capacity 测试核对稳定分页及 `idx_books_catalog_title` query plan                       |
|  43 | 无 O(n²) 全库比较                                   | PASS | 解析只按强标识符/规范 alias 索引查找；容量专项在 10k 规模通过                          |
|  44 | 书库 UI 计数、coverage、列表、详情                  | PASS | `tests/bibliography-renderer.test.tsx` 验证计数、搜索、分页和详情                      |
|  45 | UI 三级关系、alias、identifier、provenance          | PASS | renderer 专项验证实体树、别名、标识符、观察和 provenance                               |
|  46 | UI review queue 与 merge/split/undo                 | PASS | Library UI 暴露显式人工预览/确认动作，repository 专项验证写入语义                      |
|  47 | IPC exact-object、window token 与安全错误           | PASS | `tests/settings-ipc.test.ts` 覆盖 11 个 catalog channel 与恶意额外字段                 |
|  48 | renderer 无 Node/SQL/路径/secret/HTML 注入          | PASS | governance/renderer 测试及架构扫描验证不可信 renderer 边界                             |
|  49 | 不创建或修改 Source/Claim/Evidence/Dossier          | PASS | discovery 专项断言 `sources`、`claims`、`claim_evidence`、`research_dossiers` 为 0     |
|  50 | test:bibliography 纳入全量与 Windows CI             | PASS | `package.json`、`.github/workflows/ci.yml` 与 CI 配置测试                              |
|  51 | README/文档索引/下一步 Issue 019 同步               | PASS | README、`docs/instructions/README.md`、AGENTS 状态均指向 Issue 019                     |
|  52 | repository-documentation 治理与链接全部通过         | PASS | `tests/repository-documentation.test.ts` 在 1106 项全量测试中通过                      |
|  53 | 全部适用本地门禁无失败/skip/todo/warning            | PASS | 最新 `npm ci` 起按 CI 顺序执行；115 文件、1106 tests，构建/打包/smoke/audit 均通过     |
|  54 | 唯一一个本地提交且未 push                           | PASS | 交付流程只暂存本轮范围并创建指定提交；提交后本地/远端 SHA 与工作树另行核验             |
