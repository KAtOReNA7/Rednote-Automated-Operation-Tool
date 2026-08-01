# M3 真实内容本地录入与垂直切片事实证据

日期：2026-08-02

## 1. 结论

- 实现结论：`REAL_CONTENT_INTAKE_FIX_PASS`
- 试运行结论：`TRIAL_BLOCKED_BY_EVIDENCE_GAP`

真实桌面 UI 已建立与合成 fixture 明确分离的《莫格街凶杀案》本地来源链。该来源保持
`USER_LOCAL_INPUT / USER_LOCAL_NOTE`、`S1_RESEARCH_ONLY` 与“非官方认证”语义，没有被写成
`SYNTHETIC_FIXTURE`。用户确认的三条书目信息均有本地摘录，但权威等级只能产生“有支持，未
验证”；完整诡计分析只作为 `SOURCE_ONLY_NON_FACT` 保存。既有 Dossier 构建据此得到
`Claim 3 / Evidence 3 / Gap 9` 和“覆盖不足”，没有生成可用 DossierVersion，因此没有继续伪造
READY Brief、DraftVersion、质量聚合或 freshness。

## 2. 动态基线

| 项目                     | 已验证事实                                  |
| ------------------------ | ------------------------------------------- |
| 仓库                     | 运行时发现的 `<repository-root>`            |
| 分支                     | `main`                                      |
| 开工 HEAD / origin       | `07558c8bced76375a38c29acd364100787d6ae4a`  |
| ahead / behind           | `0 / 0`                                     |
| 开工 tracked / staged    | `0 / 0`                                     |
| 开工 Windows required CI | run `30704222114`，精确基线 HEAD，`success` |
| 试运行实现 HEAD          | `10ebe43b62d8bcc63703c7fe647ba61e9df7af82`  |
| 实现 HEAD required CI    | run `30708433114`，精确实现 HEAD，`success` |

任务指令由用户作为会话附件提供，仓库根目录没有该 TXT 副本，因此没有制造或保留第二份指令文件。
开工没有 pull、rebase、reset、stash 或覆盖用户修改。

## 3. 复用路径与实际语义

- 复用既有 Work、Agent、SourceRevision、Claim、Evidence、FactEvaluation 与 Dossier 领域对象，
  没有建立平行的 `real_*` 领域模型。
- 复用现有 entity resolution、preview → confirm、事务、repository 和渲染页布局；renderer 只经
  preload 的窄 DTO/IPC 调用 main process。
- 新入口与既有“完全合成测试材料”入口视觉、标签和语义分离；合成入口原有的真实作者拒绝规则
  保持不变。
- 用户本地来源固定为 `USER_LOCAL_INPUT / USER_LOCAL_NOTE`，真实性为 `UNKNOWN`，证据资格为
  `SUPPORTING_ONLY`，独立性为 `UNKNOWN`；录入不等于官方认证或事实验证。
- R1/R2/S1、第一人称权限、三类评分来源隔离、剧透政策、AI 标识和版权排除规则均未改变。

## 4. 实际实现

- 真实录入表单包含作品、作者、可选出版/版本信息、来源名称/类型/定位、R1/R2/S1、剧透级别、
  用户授权，以及 1—5 条需逐条确认的 Statement/Evidence。
- preview 在写入前显示实体解析和每条分类；实体歧义 fail closed。token 短期、单次、绑定窗口与
  输入摘要，confirm 重放保持幂等。
- 三类书目信息可沿既有合同映射为 Claim/Evidence；分析性陈述只能保存为来源内容，不能伪装为
  事实或第一人称体验。
- confirm 通过一个协调事务写入来源链；异常、冲突或故障会整体回滚，不留下半成品。
- renderer 仍不直接访问 SQLite、Node、Electron、文件系统、网络实现或 secret。

## 5. Migration 与架构边界

- 追加连续 migration v20，仅为既有 `source_revisions.source_type` STRICT CHECK 增加
  `USER_LOCAL_INPUT`；采用既有表重建/复制/校验模式。
- 新表 0、trigger 0、route 0、package 0、dependency 0、queue 0、worker 0。
- 新 IPC 2 条，且仅为严格的 real-intake preview / confirm；没有第三条 IPC 或数据库旁路。
- 已发布 migration 未修改、重排、合并或删除；旧库迁移与失败回滚由精确测试覆盖。

## 6. 预算

统计基线为 `07558c8...`，实现与 CI 修复终点为 `10ebe43...`；生成构建产物不计入。产品代码
同时报告 gross 与 net，任务预算按净新增口径核对。

| 预算项                               | 实际值                     | 上限 / 结论                      |
| ------------------------------------ | -------------------------- | -------------------------------- |
| 产品代码 LOC                         | `+1434 / -36`，net `+1398` | 1,400；net 余量 2                |
| 测试 LOC                             | gross `+505`，net `+489`   | 900；通过                        |
| 核心实现/测试/合同文件               | 21                         | 24；通过                         |
| CI migration 尾部期望修复文件        | 10                         | 明确 CI 修复条款下的分布式旧测试 |
| 最终唯一变更文件（含本证据）         | 32                         | 24；超 8，未扩大产品能力         |
| IPC / migration                      | `2 / 1`                    | `2 / 最多 1`；通过               |
| table / trigger / dependency / route | `0 / 0 / 0 / 0`            | 均为 0                           |
| package / queue / worker             | `0 / 0 / 0`                | 均为 0                           |

文件数超额来自托管 CI 才暴露的 10 个历史 migration-tail 测试，它们把 v19 硬编码为永久尾部。修复只
保留原断言并把合法尾部更新到 v20；这是任务第 10 节允许的确定性 CI 最小修复，不包含产品或未来
Issue 能力。本证据为试运行后必须归档的第 32 个文件。

## 7. 本地精确验证

| 验证                                                 | 结果                             |
| ---------------------------------------------------- | -------------------------------- |
| real intake / migration / IPC / renderer 精确 4 文件 | 4/4 files，219/219 tests，exit 0 |
| CI 暴露的 migration-tail 精确 10 文件                | 10/10 files，60/60 tests，exit 0 |
| 变更文件 Prettier                                    | 通过                             |
| 变更 TypeScript/TSX ESLint                           | 通过，0 warning                  |
| `npm run typecheck`                                  | 通过                             |
| `npm run build`                                      | 通过                             |
| `git diff --check`                                   | 通过                             |

四个核心文件为 `minimal-local-vertical-slice`、`evidence-migration`、`settings-ipc` 与
`evidence-renderer`。测试覆盖真实/合成模式隔离、授权、R1/R2/S1、逐条确认、空证据、歧义、token
绑定/过期/重放、事务回滚、无 fetch、无评分与 renderer 边界。按任务要求，本地没有运行 `npm ci`、
全量 normal/capacity、package 或 audit；真实 UI 复验不冒充 Electron smoke。

## 8. 托管 Windows CI

- 实现提交 `deba969db06c7293447a16e9337a8bc5a86a8667` 的首次 run `30708053749` 暴露 10 个
  分布式旧 migration-tail 文件，共 13 个确定性失败；产品精确测试没有失败。
- 仅更新这 10 个旧测试后形成 `10ebe43b62d8bcc63703c7fe647ba61e9df7af82`。
- 精确实现 HEAD 的 run `30708433114`：`success`。
- 已实际读取的绿色步骤包括 install、format、lint、typecheck、normal、capacity、Electron smoke、
  build、Windows package、Chrome/Edge packages、packaged smoke、audit 和清理。

## 9. 真实 UI 录入事实

1. 使用既有独立试运行数据根，证据中统一脱敏为 `<dedicated-trial-root>`；未直接读取或修改
   SQLite，也未调用 fixture 或旁路 API。
2. 用户已授权公版作品《莫格街凶杀案》，并在持久化前再次确认完整预览。
3. 实体解析显示“未发现候选，将新建实体”；没有发生自动歧义合并。
4. 真实 UI 创建非 synthetic 的 Work/Author、`USER_LOCAL_INPUT` SourceRevision 与三条
   Claim/Evidence：作品名、作者、1841 年出版信息。
5. 三条书目信息分类为 `FACT → CLAIM_WITH_EVIDENCE`，最终均为“有支持，未验证”。
6. 完整诡计陈述分类为 `ANALYTICAL_JUDGMENT → SOURCE_ONLY_NON_FACT`，未创建事实 Claim。
7. 使用 `S1_RESEARCH_ONLY / FULL_TRICK_ANALYSIS`；用户已勾选正文前醒目剧透警告。
8. UI 明确显示评分 0、模型 0、外部请求 0、费用未发生。

没有把 Codex 记忆当 Evidence，没有记录第一人称阅读经历或个人评分，也没有将“用户确认”提升为
官方认证。

## 10. Dossier、Brief 与 DraftVersion

- 通过真实 UI 对新 Work 执行 Dossier preview：`INITIAL · Claim 3 · Evidence 3 · Gap 9`，
  新增 3、更新 0、移除 0；预计本地写入 60、模型请求 0、费用 `NOT_APPLICABLE`。
- preview 明确给出“覆盖不足”。用户已授权的本地构建确认执行后，版本索引显示《莫格街凶杀案》
  `WORK · v— · 需要重建`，没有可进入内容简报的 DossierVersion。
- 根因是三个 key fact 只有 `SUPPORTING_ONLY / UNKNOWN` 来源，不能满足既有 verified/consensus
  门槛；这是证据等级的诚实阻塞，不是缺失 UI、事务失败或新产品缺陷。
- DossierVersion：未创建；Brief：未创建；DraftVersion：未创建。
- 因 Dossier 不合法可用，按任务第 11 节停止，没有进入 Topic、内容生产、审批、导出或发布。

## 11. 七类质量输入、聚合与 freshness

| 质量输入                 | 状态                      |
| ------------------------ | ------------------------- |
| `STRUCTURED_OUTPUT`      | `NOT_RUN_NO_REAL_DRAFT`   |
| `FACT_MAPPING`           | `NOT_RUN_NO_REAL_DRAFT`   |
| `READING_AUTHENTICITY`   | `NOT_RUN_NO_REAL_DRAFT`   |
| `SPOILER_WARNING`        | `NOT_RUN_NO_REAL_DRAFT`   |
| `DUPLICATION`            | `NOT_RUN_NO_REAL_DRAFT`   |
| `TITLE_BODY_CONSISTENCY` | `NOT_RUN_NO_REAL_DRAFT`   |
| `INTERNAL_CONSISTENCY`   | `NOT_RUN / DEFERRED_029B` |

- Issue 030 聚合：`NOT_AVAILABLE / NOT_RUN`，没有 Draft 版本绑定。
- freshness：没有真实 DraftVersion 或获准的正文修改，因此没有失效传播或合法重跑项。
- 没有为追求 READY 伪造 PASS、降低证据规则或进入 029B。

## 12. 外部副作用与停止点

| 类别                           | 结果                                               |
| ------------------------------ | -------------------------------------------------- |
| 真实密钥                       | 读取、显示、复制、保存、探测均为 0                 |
| 模型 / Provider                | 真实调用 0，费用 0                                 |
| 真实网页、搜索、图片、业务 API | 调用 0                                             |
| Local API                      | 未启用、未调用、未扫描端口                         |
| 小红书平台                     | 登录、发布、评论、私信、验证码、风控和自动化均为 0 |
| AI 标识                        | `aiDisclosure=false`，未参与门禁、评分或排期       |
| 版权规则                       | 未进入字段、评分、门禁、审批或排期                 |

仅按任务授权使用 GitHub 远端与 Actions；业务网络和平台副作用为 0。受控 Electron 窗口已关闭，试运行
进程为 0。证据归档提交与推送后核验：`main` 与 `origin/main` 分叉 `0 / 0`、tracked/staged clean。
本轮固定停止于证据缺口，不进入 029B、Issue 031、M4、审批、导出、发布包或平台操作。
