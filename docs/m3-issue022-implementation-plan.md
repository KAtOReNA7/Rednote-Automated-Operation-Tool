# M3 Issue 022 实施计划：Topic Pool 与 First-30 配额

状态：已完成。代码、测试、迁移、文档、打包与本地门禁证据均已逐项回填；Issue 023 未开始。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现，开工分支为 `main`。
- 开工 HEAD 为 `6fcbb427b12834a0b4a2cf8994682fa353c797d3`；本地合法领先
  `origin/main` 四个已完成 Issue 的提交，不执行 pull、rebase、reset 或 push。
- 工作树开工时干净；唯一新增文件是随后按本 Issue 指令归档的执行指令。
- M2 Issues 012—021、`docs/m2-closeout.md`、Catalog、Evidence、Versioned Dossier 与
  Reading Authenticity 能力存在。
- migration 尾部由运行时发现为 v14；Issue 022 只追加下一条连续 migration。
- 指令已从原位置唯一移动到 `docs/instructions/m3/`，内容保持不变，原位置不留副本。

## 目标与完成定义

1. 建立五类有限、版本化 Topic Content Type 与不可变 `FIRST_30_V1` 配额。
2. 从 current Catalog、ready Dossier 和 current Expression Permission 生成纯本地结构化候选。
3. 实现确定性 eligibility、五项整数 ranking、稳定 tie-break 与可解释 reason codes。
4. 实现 `TopicSemanticFingerprintV1`、canonical duplicate 与历史关联。
5. 实现 PROPOSED/LOCKED/HELD/ARCHIVED 状态和 preview/confirm/undo/restore/batch。
6. 实现 First-30 preview、10/8/6/3/3 求解、shortfall、锁定冲突、版本、stale 与 no-op。
7. 追加下一条连续 migration，并保守迁移旧 `topics` 数据。
8. 提供有限分页 Desktop IPC/preload 与“选题池”UI。
9. 新增 `test:topics`，纳入全量测试和 Windows CI。
10. 同步 README、AGENTS、Roadmap、合同、ADR、索引和 M3 进度。
11. 从最新 `npm ci` 开始通过全部适用门禁后，只创建一个本地提交并停止。

## 允许修改

- 新增 `packages/topics` 的常量、合同、validator、policy、fingerprint、ranking、quota solver
  与确认 broker。
- `packages/db` 的下一条连续 migration 与 Topic repository。
- `packages/shared` 的有限 Topic DTO 和 desktop bridge。
- Electron main/preload/IPC runtime 与 `apps/web-ui` 的 Topic Pool 页面。
- Issue 022 专项 fixture、测试、CI/package scripts、合同、ADR、计划和验收映射。
- 为反映 M3 进行状态而对 README、AGENTS、Roadmap、文档索引进行最小事实更新。

## 禁止范围

- 不实现 Experiment、实验变量、指标、分组或实验写入。
- 不实现 Content Brief、标题、正文、标签、置顶评论、封面、图片或 Draft。
- 不实现质量检查、审批、排期、发布包、发布登记或自动平台动作。
- 不自动触发 Search、Fetch、Clip、Catalog、Evidence 或 Dossier rebuild。
- 不让模型、AI 标识、版权、出版归属、虚构热度或平台预测决定资格或排序。
- 不把候选写回 Claim、Evidence、Dossier 或 Reading State。
- 不读取真实密钥，不访问真实业务网络，不调用真实模型或 API，不产生费用。
- 不进入 Issue 023、024、025 或后续任务。

## 实施顺序

1. 归档指令，记录动态基线，建立本计划和连续验收映射。
2. 审计旧 `topics`、Catalog、Dossier、Authenticity、Desktop IPC、UI 与迁移冻结测试。
3. 新增 `packages/topics`，冻结内容类型、资格、score、fingerprint、状态与 quota 合同。
4. 实现纯确定性 eligibility evaluator、整数 ranking、stable hash、去重和 quota solver。
5. 追加下一条连续 migration，扩展同一 `topics` 身份并建立 version、subject、score、
   transition、quota、plan、dependency、invalidation 与 audit 表。
6. 实现 SQLite repository 的分页列表/详情、generation preview/confirm、状态变更、
   batch、plan preview/confirm/history、stale/no-op 与幂等执行。
7. 接入 Electron runtime、sender/window 绑定单次 token、exact-object IPC/preload。
8. 激活 Topic Pool UI，展示五类、资格、排名、去重、状态控制、配额与全部真实状态。
9. 补齐合同、policy、migration、repository、gold、capacity、runtime、IPC、renderer、
   egress 和 governance 测试。
10. 同步合同、ADR、README、AGENTS、Roadmap、文档索引和 M3 当前进度。
11. 从最新 `npm ci` 开始按 CI 顺序运行门禁；失败时修复根因并从该起点重跑。
12. 审计 diff、敏感信息、进程/listener、parent 与远端状态，创建唯一提交并停止。

## 数据与求解原则

- `topics` 保持稳定身份/current 指针，历史 revision、score snapshot 和 plan version
  append-only；旧兼容列不得成为新的排序真相。
- eligibility 只消费 current、非 stale Dossier/Expression Permission/Fact/Spoiler 依赖，
  缺失或未知时 fail closed。
- ranking 五项使用整数和独立 known/unknown 状态；UNKNOWN 不等于 0 或最佳。
- fingerprint 使用 canonical subject set，比较主体顺序不改变身份；不同真实 angle intent
  可以并存。
- LOCKED 只改变同类 quota 选择顺序，不改写分数、不绕过 eligibility。
- HELD/ARCHIVED 通过状态过滤；恢复保留历史，archive 后重新发现关联原身份。
- First-30 不跨类补位、不重复 topic/fingerprint、不为凑满 30 放宽门禁。
- pool 或依赖变化只使相关 current plan stale，不自动重排；显式重建创建新版本。
- 相同 snapshot/hash 执行为 no-op；失败或取消不替换 current plan。

## UI 与安全原则

- UI 明确“候选选题不是内容简报或已批准文章”，排序不是爆款预测。
- FULL 类型保留完整剧透允许与未来醒目警告要求。
- PUBLIC_RESEARCH、PERSONAL 与评分来源保持清晰隔离。
- 列表、筛选、分页、详情、批量、计划历史和运行历史均有界。
- 所有写入经过 preview、expected revision、显式确认和短期单次 token。
- renderer 不接收 Node、SQLite、路径、完整 Dossier/Evidence、credential、raw response、
  lease 或内部预测分。

## 停止点

Issue 022 全部适用门禁通过并创建唯一一个本地提交后立即停止；不 push、不创建 PR、不进入
Issue 023。
