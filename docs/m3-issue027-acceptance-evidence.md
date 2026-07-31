# M3 Issue 027 实施计划与验收证据

状态：PASS；实现、增量验收、最终候选门禁与源码 Electron smoke 均已完成。

## 动态基线与冻结边界

- 开工分支：`main`。
- 开工 HEAD、本地 `origin/main` 与只读远端 `main`：
  `4ad4f31cc8c97db465e3363e726c853997f921c8`。
- 开工工作树干净；执行指令内容不变且唯一归档到 `docs/instructions/m3/`。
- 冻结预算：0 package、0 表、0 trigger、0 migration、恰好 2 个 IPC、最多 25 个变更文件。
- 禁止 queue、worker、模型、网络、人工 decision overlay、修文或流程推进；不进入 Issue 028。

## 简短实施计划

1. 在现有 `packages/quality` 增加纯本地 evaluator，复用 public artifact、Unicode segmenter、locator
   与 hash，不改变 Fact Mapping 语义。
2. 增加只读/append-only repository，读取 current Draft 与 Issue 021 权威记录，把
   content-addressed 摘要写入现有 `quality_checks`。
3. 通过恰好两个 preview/confirm IPC 接入 Electron main/preload，在现有文案工作台增加紧凑区块；
   renderer 只接收有界 locator/hash/reason DTO。
4. 用 5 份测试文件覆盖 policy/gold、repository、runtime/IPC、renderer 与治理，完成合同、ADR、
   README/AGENTS 和本文件证据后执行非重复最终门禁。

## 风险与控制

| 风险                     | 控制                                                                            |
| ------------------------ | ------------------------------------------------------------------------------- |
| 元数据允许但正文伪造亲历 | 对 current DraftVersion 的实际公开 artifact 逐句检查                            |
| R2 泛化为“我读过”        | 只接受 current assertion、lineage 与片段 hash 精确匹配的观点                    |
| 评分来源混用             | 由 current score record、Dossier、`valueSourceId` 和公开值共同判定              |
| internal prediction 泄露 | repository 不查询该表，input/details/DTO/UI 均不含该类型                        |
| 复制 Issue 026 overlay   | 只复用 `quality_checks`，不建 plan/run/version/dependency 表                    |
| stale 或确认重放         | preview/confirm 绑定 sender/window/hash/TTL/revision，confirm 重算 input        |
| details/IPC 复制正文     | 只保存/返回 artifact identity、code-point locator、selected/text hash 和 reason |
| 自然语言歧义             | 保守进入 `REVIEW_REQUIRED`，不扩展为通用 NLP                                    |

## 16 项核心验收

| ID   | 用户结果或不变量                                                   | 状态 | 证据                                                                            |
| ---- | ------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------- |
| RA01 | 只检查 current immutable DraftVersion，旧版本不能冒充当前          | PASS | `reading-authenticity-repository.test.ts` 的 current-version stale-confirm 用例 |
| RA02 | 复用 Issue 021 六态，不新增 reading state                          | PASS | `ReadingAuthenticityWorkTruth` 映射现有六态；0 migration/Schema diff            |
| RA03 | 标题、正文、标签、置顶评论问题都有精确 code-point locator/hash     | PASS | policy/gold 四类 artifact 与 `resolveDraftTextLocator` 行为测试                 |
| RA04 | R1 + current permission 可通过；R3/S1/S2/UNCLASSIFIED 具体亲历阻断 | PASS | policy/gold R1/R3 与表驱动 truth 规则                                           |
| RA05 | R2 只允许 current 精确 assertion；泛化亲历阻断                     | PASS | policy/gold 精确 assertion、文本 hash mismatch 与“重读”用例                     |
| RA06 | 歧义或截断为 REVIEW_REQUIRED，不得 PASS                            | PASS | policy/gold 多评分与 24 段 finding 截断用例                                     |
| RA07 | 公开个人评分匹配 R1、current user record、source 和 value          | PASS | policy/gold personal score 8.5/10 与 repository latest-active 查询              |
| RA08 | R2 personal score 不得通过公开 Draft 检查                          | PASS | policy/gold 将同一有效记录切到 R2 后得到 BLOCKED                                |
| RA09 | 资料分析评分匹配 current score/Dossier/value 并显示公开标签        | PASS | policy/gold research score 正常与 value mismatch 用例                           |
| RA10 | NONE 下明确评分、类型冲突和无法归属多值不能 PASS                   | PASS | policy/gold `SCORE_PLAN_CONFLICT` 与 `MULTIPLE_SCORE_EXPRESSIONS`               |
| RA11 | internal prediction 不被查询或外泄                                 | PASS | repository 插入内部记录仍无输出；源码与 DTO 边界复核                            |
| RA12 | 相同 current input 幂等；其他 input 的旧结果显示 STALE             | PASS | repository 重复 confirm 仍 1 行，以及 prior-input STALE 用例                    |
| RA13 | details/DTO 有界且不保存全文、assertion 原文、内部评分或路径       | PASS | repository 4096-byte/敏感字段断言与 runtime DTO 断言                            |
| RA14 | preview 无写入；confirm 拒绝 stale、重放、额外字段和错误窗口       | PASS | repository、runtime/IPC 及现有 `settings-ipc.test.ts` exact-object 测试         |
| RA15 | 现有工作台显示结果，不提供修文、审批、导出、发布或后续入口         | PASS | renderer 区块预览、有限片段、确认摘要与按钮边界测试                             |
| RA16 | 无真实密钥、业务网络、模型、外部请求或费用；硬约束不变             | PASS | runtime 断言 request=0、cost=N/A、model/job=0；最终 hard-constraints 门禁       |

## 预算实测

- 变更文件：24 / 25。
- 生产源码新增：约 1,350 LOC / 1,500（新生产文件物理行 + 已跟踪生产文件新增行）。
- 测试新增：约 801 LOC / 1,200（4 个新测试文件 + 现有 IPC 安全文件新增行）。
- 新增测试文件：4；连同必要更新的现有 IPC 安全文件，共 5 份。
- package / table / trigger / migration：`0 / 0 / 0 / 0`。
- 新增 IPC：恰好 2 个：`quality:reading-authenticity:preview`、
  `quality:reading-authenticity:confirm`。

## 增量验证记录

- policy/gold：5/5 PASS。
- repository：4/4 PASS。
- runtime+IPC：2/2 PASS；现有 IPC security 同次 194/194 PASS。
- renderer：1/1 PASS。
- 开发期 TypeScript 全仓检查与变更范围 ESLint：PASS。
- 最终 `npm run format-check`、`npm run lint`、`npm run typecheck`：PASS，warning 为 0。
- 唯一一轮 observable normal：8 个文件、227 项测试全部 PASS；持久证据位于
  `.rednote-temp/validation/vitest-2t2FC9/results.json`。
- capacity：N/A；本轮缩减范围指令明确不要求 capacity 门禁。
- 首轮 build 暴露本机缺少锁文件已登记的 `quality` workspace junction，以及新增 repository
  的严格空值收窄错误；恢复该精确本地链接、修复源码并重跑受影响门禁后，最终
  `npm run build` PASS。`package.json` 与 `package-lock.json` 均未修改，也未执行 `npm ci`。
- 复用最终 build 产物执行 `npm run prepare:electron` 与
  `node scripts/run-electron-smoke.mjs`：PASS；`packaged=false`、`externalConnections=0`，
  disabled/enabled 两种模式均释放端口，进程正常退出。
