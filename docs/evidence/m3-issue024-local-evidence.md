# M3 Issue 024 本地验收证据

## 结论与边界

- 动态开工基线为本地 `main` 的 `bc7857a2f529d3f28355d3ca455703dcea82d2a0`；开工时本地
  合法领先 `origin/main` 六个提交。开发阶段未执行 pull、rebase、reset 或 push。
- 执行指令唯一归档于
  `docs/instructions/m3/M3-Issue024-structured-content-brief-generator-Codex-instruction.txt`，
  移动前后 SHA-256 均为
  `6736B879588DAB45EEEC27D77EA49D2AD5A93E92A3742B77C55D6F1DD577984B`。
- 本轮只实现结构化 Content Brief、readiness、字段 lock/provenance、Evidence/Experiment
  绑定、local scaffold、受控 structured generation 与内容生产 UI；未进入 Issue 025。
- fixture 全部为合成数据，数据库为仓库卷临时 SQLite，模型为 Scripted Mock，网络仅允许本机
  loopback。真实密钥读取、真实 API/模型调用、业务网络和费用均为 0。

## 五类金标与权限矩阵

专项 fixture 覆盖五类 Profile，验证其主体、结构槽位、比较维度、表达形态和剧透要求。R1
个人体验金标允许第一人称与个人评分；R2 只允许 current 逐条确认 assertion；S1 资料分析金标
强制“公开资料整理”和“资料分析评分”。R3/S1/S2/UNCLASSIFIED 不得伪造第一人称。

每个事实性核心判断、论点和反方前提映射到 current DossierVersion/Entry、Claim、
FactEvaluation、EvidenceLocator 与 SourceRevision。冲突、stale、无效 locator、context-only
或 allowlist 外引用均 fail closed。

确定性金标的计数为：

- 五类 Profile 各 1 个，共 5 个 fixture，readiness 全部为
  `READY_FOR_DRAFT_GENERATION`；readiness registry 固定为 9 个互斥状态。
- 标准本地 scaffold 首次持久化为 1 个 BriefVersion、0 个未获证据的 EvidenceRef、20 个
  FieldState/Lock 和 7 个精确 Dependency；事实论点与事实反方金标分别用 1 个 exact
  EvidenceRef 验证映射。
- R1、R2、S1 各有独立金标；个人评分与资料分析评分各 1 类，FULL spoiler 与
  Experiment match/mismatch 各有正反例。

## 版本、锁定与生成

- ContentBrief 保持稳定 identity 和唯一 current version；版本、field state、dependency、
  readiness、transition、audit 与 generation history 均不可变。
- USER_LOCKED 与 SYSTEM_LOCKED 字段在模型候选合并后逐值不变；编辑、锁定、解锁、undo、
  clone、archive 与 restore 均要求 preview、expected revision 和一次性确认。
- local scaffold 无 Provider 配置可用，未知 judgment/argument 保持空缺。
- `CONTENT_BRIEF_GENERATE_V1` 只经 ModelExecutionService，单请求、有界输入输出、同 Brief
  单 active，executionId 重放幂等。pre-send pause/cancel 为 0 请求和 0 费用；after-send
  不确定状态为 `AMBIGUOUS`，不自动重试或 fallback。
- 模型候选只含 Brief 结构字段和 Evidence allowlist 引用；不含标题、正文、标签、评论、图片、
  实验结果或内部推理。

## Migration 与数据保留

- 在运行时发现的 v16 后只追加 migration v17 `structured_content_brief_generator`；v1—v16
  身份不变。
- 旧 `content_briefs` 行保留原 identity，保守迁移为
  `legacy-content-brief-v0 / DRAFT_INCOMPLETE`，不会伪装 ready。
- 新库、v16 升级、迁移前备份、事务回滚、STRICT/FK/CHECK/unique、append-only、
  quick_check 与 foreign_key_check 由专项和既有 DB 测试覆盖；Issues 018—023 合成数据保留。

## 内容边界

受保护的 `drafts`、`assets`、`quality_checks`、`approvals`、`post_packages` 和
`publications` 在金标中保持 0 写入。本轮没有生成标题、正文、标签、置顶评论、图片、质量结果、
真实实验指标、effect、显著性或 winner。

## 最终门禁

最后一次代码修正后，从新的 `npm ci` 起按 Windows CI 顺序完成最终门禁：

| 门禁                                                                           | 本地结果                                     |
| ------------------------------------------------------------------------------ | -------------------------------------------- |
| `npm ci` / `npm run audit:dependencies`                                        | 259 packages；0 vulnerabilities              |
| `format-check` / `lint` / `typecheck`                                          | PASS；0 warning                              |
| `test:constraints` / `test:db` / `test:queue`                                  | 49 / 35 / 131 tests PASS                     |
| `test:storage` / `test:desktop` / `test:settings`                              | 75 / 92 / 223 tests PASS                     |
| `test:local-api` / `test:providers` / `test:portability` / `test:capabilities` | 132 / 188 / 4 / 48 tests PASS                |
| `test:model-accounting` / `test:search` / `test:fetch` / `test:clipper`        | 223 / 49 / 55 / 28 tests PASS                |
| `test:bibliography` / `test:evidence` / `test:dossier` / `test:authenticity`   | 187 / 215 / 193 / 228 tests PASS             |
| `test:topics` / `test:experiments` / `test:briefs`                             | 222 / 55 / 226 tests PASS                    |
| `npm run test`                                                                 | 178 files；1496 tests PASS                   |
| `build` / `package:desktop` / `package:clipper`                                | PASS                                         |
| `test:electron-smoke` / `test:packaged-smoke`                                  | PASS；externalConnections=0；端口释放        |
| `test:clipper-real`                                                            | Chrome 与 Edge 隔离 fixture PASS，并完成清理 |

非 CI 的交互式浏览器复核曾因本机 Browser kernel assets 路径缺失而未能启动；按 Issue
指令单独如实记录，不将其写成仓库功能失败或 PASS。renderer 自动化、Electron source smoke、
packaged smoke 和 Chrome/Edge Clipper smoke 均已实际通过。

未执行或未读取托管 CI；不会把本地绿色结果误报为托管 CI PASS。
