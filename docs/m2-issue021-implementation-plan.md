# M2 Issue 021 实施计划：阅读真实性、表达权限与 M2 收口

状态：已完成。69 项验收均已回填实际代码、测试、命令或文档证据。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现，开工分支为 `main`。
- 开工 HEAD 为 `85b396fd6d685146a36e400281d264d7255d2163`；本地合法领先
  `origin/main` 三个已完成 Issue 的提交，不执行 pull、rebase、reset 或 push。
- 工作树开工时干净；唯一新增文件是随后按本 Issue 指令归档的执行指令。
- migration 尾部由运行时发现为 v13；Issue 018 Catalog、Issue 019 Evidence 和 Issue 020
  Versioned Dossier 能力存在。
- 指令已从原位置唯一移动到 `docs/instructions/m2/`，内容保持不变，原位置不留副本。

## 目标与完成定义

1. 建立严格、版本化的 Reading Authenticity Policy V1。
2. 在同一 `reading_states` 真相源上实现 R1/R2/R3/S1/S2/UNCLASSIFIED 历史状态。
3. 保存有限 Memory Confidence、明确用户确认、撤销与 append-only audit。
4. 为 R2 提供逐条 Experience Assertion 确认、失效和撤销。
5. 确定性计算第一人称、资料分析、两类公开评分、内部预测分隔离和 content-brief 前置权限。
6. 实现三档 Spoiler Policy，允许完整核心诡计分析但强制警告条件。
7. 保存有界 Expression Permission Snapshot 与精确依赖，相关变化 fail closed。
8. 提供单本 preview/confirm/undo、有界批量分类、expected revision 与逐项结果。
9. 激活书库真实性管理 UI，并保持 renderer、preload、IPC 安全边界。
10. 新增 `test:authenticity`，纳入全量测试和 Windows CI。
11. 同步 README、AGENTS、Roadmap、合同、ADR 和索引，准确完成 M2 收口。
12. 从最新 `npm ci` 开始通过全部适用门禁后，只创建一个本地提交并停止。

## 允许修改

- `packages/authenticity` 的合同、validator、policy evaluator、hash 与确认 broker。
- `packages/db` 的下一条连续 migration 与 Authenticity repository。
- `packages/shared` 的窄分页 DTO 和 desktop bridge。
- Electron main/preload/IPC runtime 与 `apps/web-ui` 的书库真实性 UI。
- Issue 021 专项测试、CI/package scripts、合同、ADR、计划、验收映射与活跃文档。
- 为兼容新有限状态而对旧 `packages/core` 类型和回归测试进行最小更新。

## 禁止范围

- 不进入 Issue 022，不生成 topic、brief、标题、正文、评分文案、图片或发布包。
- 不写入 drafts、approvals、post_packages、publications 或运营复盘数据。
- 不从购买、持有、文件、ISBN、Dossier、Clip、搜索或模型推断用户读过。
- 不读取电子书、浏览器历史、平台账户、个人云数据、任意外部路径或完整阅读笔记。
- 不让模型创建、确认、提升状态或补写个人体验。
- 不让 R1 绕过事实政策，不让 Dossier ready 证明用户已读。
- 不读取真实密钥，不调用真实模型、搜索、页面、图片或业务 API，不产生费用。
- AI、版权与 publication relationship 不参与真实性、权限、评分或剧透政策。

## 实施顺序

1. 归档指令，记录动态基线，建立本计划和连续验收映射。
2. 审计现有 `reading_states`、Catalog、Dossier、书库 UI、IPC 和迁移测试。
3. 新增 `packages/authenticity`，冻结状态、confidence、assertion、score、spoiler 和 permission
   合同。
4. 实现纯确定性 evaluator、严格 exact-object validator、stable hash 与短期确认 broker。
5. 追加下一条连续 migration，安全迁移旧五态数据并建立历史、assertion、score、snapshot、
   dependency、preview、batch 和 audit 表。
6. 实现 SQLite repository 的列表/详情、preview/confirm/undo、assertion、score、snapshot
   evaluator、精确失效与批量部分失败。
7. 接入 Electron runtime、sender/window 绑定 token、exact-object IPC/preload 和书库 UI。
8. 补齐合同、policy、migration、repository、capacity、renderer、IPC、egress 和 governance
   测试及六 Work 金标。
9. 同步合同、ADR、README、AGENTS、Roadmap、文档索引和 M2 收口事实。
10. 从最新 `npm ci` 开始按 CI 顺序运行门禁，修复根因后从该起点重跑。
11. 审计 diff、敏感信息、进程/listener、parent 与远端状态，创建唯一一个本地提交并停止。

## 状态与数据原则

- 一个 profile + Work 只有一个 current state；历史 revision append-only。
- 旧 `UNKNOWN` 保守迁移为 `UNCLASSIFIED/UNKNOWN`；其他旧状态只映射到不高于原语义的有限状态，
  无法证明的值 fail closed，绝不自动升级为 R1。
- Reading State、Memory Confidence 与 Assertion 是独立有限合同，不以自由文本或浮点分数混存。
- R2 权限只引用当前 reading revision 下未撤销、未失效的逐条 assertion。
- 个人分、资料分析分和内部预测分使用不同记录类型与整数值；UNKNOWN 保持 `NULL`。
- Expression Permission Snapshot 是可重算、可失效的派生结果，不反向修改用户状态。
- Dossier readiness 与个人体验权限保持正交；未来 content brief 必须显式选择模式。
- Catalog、Dossier、state、assertion 和 policy 变化只通过索引失效相关 Work。
- stale snapshot、并发 revision、未知状态和缺失依赖均 fail closed。

## UI 与安全原则

- 书库同时展示书目、阅读状态、memory confidence、历史、assertion、评分来源、Dossier readiness、
  权限矩阵与 spoiler requirement。
- 所有状态写入都经过 preview 和用户显式确认；批量默认空选择，每项独立 expected revision。
- renderer 只接收有限摘要，不接收 Node、SQLite、路径、Dossier/Evidence 正文、credential、
  raw model response 或内部预测分。
- 未分类、stale、conflicted、insufficient 和 ready 均显示真实状态，不伪装为可生产。

## 停止点

Issue 021 全部适用门禁通过并创建唯一一个本地提交后立即停止；不 push、不创建 PR、不进入
M3 Issue 022。

## 完成证据

- v14 连续追加，v1—v13 身份保持不变；新库、升级、备份、回滚、FK 与 quick check 通过。
- `test:authenticity` 10 个文件、204 项测试通过；六 Work 金标覆盖全部状态和权限矩阵。
- 最新 `npm ci` 起按 Windows CI 顺序执行完成；全量 141 个文件、1291 项测试通过。
- build、Electron source smoke、desktop/Clipper package、packaged smoke 与 dependency audit
  通过；smoke 外部连接为 0，dependency vulnerability 为 0。
- 非 CI 的交互式 `test:clipper-real` 因隔离 Chrome 窗口无法取得前台焦点而未形成验收结果，
  已与通过的 CI 门禁分开记录。
