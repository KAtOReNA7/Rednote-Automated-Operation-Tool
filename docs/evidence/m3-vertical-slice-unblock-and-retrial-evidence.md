# M3 垂直切片解阻与复验事实证据

日期：2026-08-01

## 1. 结论

- 实现结论：`UI_FIX_PASS`
- 试运行结论：`TRIAL_BLOCKED_BY_MISSING_USER_FLOW`

“读者知识水平”缺口已修复，并在既有独立 ProjectDataRoot 中通过真实桌面 UI 把 Brief v5
保存为 READY 的 Brief v6，随后创建了手工 DraftVersion v1。用户选择真实内容路径 A，并明确
授权使用《莫格街凶杀案》及生成、输入、修改对应 Draft；但当前真实 UI 唯一的上游手工录入
入口明确限定为“完全合成”，并要求不得使用真实作者。为避免伪造来源链，本轮没有把真实作品
写入合成入口，也没有绕过 UI，真实内容质量闭环因此停止。

## 2. 动态基线

| 项目                     | 已验证事实                                      |
| ------------------------ | ----------------------------------------------- |
| 仓库                     | 运行时发现的 `<repository-root>`                |
| 分支                     | `main`                                          |
| 开工 HEAD                | `db8ceb9c7089586e54d54c5fc661bfd6b77abbc5`      |
| 开工 `origin/main`       | `db8ceb9c7089586e54d54c5fc661bfd6b77abbc5`      |
| ahead / behind           | `0 / 0`                                         |
| 开工 tracked / staged    | `0 / 0`                                         |
| 开工 Windows required CI | run `30698693442`、job `91365787355`，`success` |
| 实现 HEAD                | `1b60323c0bf45e208130f75dfafe39d3b34c100f`      |

任务指令由用户在会话中完整提供，仓库根目录没有该 TXT 的副本，因此没有制造或保留第二份
指令文件。开工没有 pull、rebase、reset、stash 或覆盖用户修改。

## 3. 实际实现

- `packages/briefs` 提供唯一权威的 `BRIEF_AUDIENCE_KNOWLEDGE_LEVELS` 常量与派生类型；合同解析
  仍执行同一合法值集合，validator 的业务含义没有改变。
- renderer 通过类型穷尽映射提供中文选项说明，没有维护可独立漂移的运行时枚举。
- 新建 Brief 保持“请选择（不会自动设置）”；已有合法值通过既有 DTO、IPC 与 service 链路回显。
- 缺失时显示精确提示“读者知识水平未填写”；该提示是可键盘到达的按钮，触发后滚动并聚焦
  对应选择控件。
- 合法值使既有 readiness 进入 READY，并启用既有手工 Draft 入口；没有增加 IPC 或数据库旁路。
- renderer 仍不接触 Node、Electron、SQLite、文件系统或凭据实现。

## 4. 预算

| 预算项                            |                           实际值 |          上限 |
| --------------------------------- | -------------------------------: | ------------: |
| 产品源码 gross added LOC          |                              110 |           500 |
| 测试 gross added LOC              |                              158 |           400 |
| 变更文件                          | 10（9 个实现/测试文件 + 本证据） |            12 |
| package / dependency / route      |                        0 / 0 / 0 |     0 / 0 / 0 |
| IPC / table / trigger / migration |                    0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| queue / worker                    |                            0 / 0 |         0 / 0 |

LOC 取自实现提交的 `git show --numstat`；本证据不计入产品或测试 LOC。

## 5. 本地精确验证

| 验证                                                      | 结果                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Brief contracts / policy / renderer / governance 精确集合 | 初次暴露 3 个确定性测试问题；对应修复后失败文件 11/11 通过，contracts 与 policy 在初次运行已通过；托管 normal suite 再确认全绿 |
| 变更文件 Prettier check                                   | 通过                                                                                                                           |
| 变更 TypeScript/TSX ESLint                                | 通过，0 warning                                                                                                                |
| `npm run typecheck`                                       | 通过                                                                                                                           |
| `npm run build`                                           | 通过，最终运行 0 warning                                                                                                       |
| `git diff --check`                                        | 通过                                                                                                                           |
| 敏感值 diff 扫描                                          | 未发现真实密钥或 secret                                                                                                        |

依照任务门禁，本地没有运行 `npm ci`、全量 normal/capacity、Electron smoke、package 或 audit；
这些独立信号由精确实现 HEAD 的托管 Windows CI 执行。

## 6. 托管 Windows CI

- 精确实现 HEAD：`1b60323c0bf45e208130f75dfafe39d3b34c100f`
- workflow run：`30702538688`
- Windows required job：`91375946545`
- 结论：`success`
- 已实际读取的绿色步骤包括 install、format、lint、typecheck、normal、capacity、Electron smoke、
  build、Windows package、Chrome/Edge package、packaged smoke、audit 与精确临时目录清理。

## 7. Brief v5 到 DraftVersion 的真实 UI 技术回归

1. 使用第一次试运行的独立 ProjectDataRoot；证据中脱敏为 `<dedicated-trial-root>`。
2. Brief v5 保持 `TARGET_AUDIENCE_INCOMPLETE`，没有直接修改 SQLite。
3. 通过桌面 UI 选择 `FAMILIAR_WITH_WORK`（“熟悉作品：已了解主要内容”）。
4. 经既有预览与二次确认保存 Brief v6；UI 显示“可生成结构候选”，即 READY。
5. 页面重新载入后，“预览手工 Draft”由禁用变为启用。
6. 经既有预览与二次确认创建手工 DraftVersion v1（revision 0）。
7. 新建的手工 scaffold 保持结构待填写，没有被伪装为质量通过或可发布。

此过程仅使用真实 Electron UI、preload、既有 IPC 与 service；没有 fixture、直接 SQL 或旁路 API。

## 8. 用户真实内容选择与新阻塞

- 用户选择：A（真实内容闭环）。
- 用户明确授权：本次试运行使用《莫格街凶杀案》，并允许生成、输入及修改对应 Draft。
- 表达边界：公开资料分析、非个人阅读体验、无个人评分；完整剧透与醒目警告沿用用户已确认设置。
- 真实 UI 观察：资料研究页唯一的上游手工入口名为“手工录入完全合成的最小研究材料”，执行
  标签包含“完全合成”，字段为“虚构作品名”“虚构作者名”，作者字段明确提示“不得使用真实作者”。
- 当前独立数据根只有透明标注为 `SYNTHETIC_FIXTURE` 的《雾钟公寓》来源链，没有可承载该
  授权真实作品的 Work / SourceRevision。

把《莫格街凶杀案》填入上述入口会把真实作品伪装为合成数据；复用《雾钟公寓》的 Brief 则会
制造错误 lineage。两者均被拒绝。直接写 SQLite、调用 fixture、启用真实网页抓取或扩建产品
入口也都超出本任务，因此没有创建该真实作品的 Work、Dossier、Topic、Brief 或 DraftVersion。

## 9. 七类质量输入

| 质量输入                 | 授权真实内容状态          |
| ------------------------ | ------------------------- |
| `STRUCTURED_OUTPUT`      | `NOT_RUN_NO_REAL_DRAFT`   |
| `FACT_MAPPING`           | `NOT_RUN_NO_REAL_DRAFT`   |
| `READING_AUTHENTICITY`   | `NOT_RUN_NO_REAL_DRAFT`   |
| `SPOILER_WARNING`        | `NOT_RUN_NO_REAL_DRAFT`   |
| `DUPLICATION`            | `NOT_RUN_NO_REAL_DRAFT`   |
| `TITLE_BODY_CONSISTENCY` | `NOT_RUN_NO_REAL_DRAFT`   |
| `INTERNAL_CONSISTENCY`   | `NOT_RUN / DEFERRED_029B` |

技术回归创建的合成 scaffold 仅证明 DraftVersion 入口已解锁；用户选择 A 后没有把它冒充为真实
内容，也没有在其上运行质量闭环。

## 10. 聚合与 freshness

- 授权真实内容没有 DraftVersion，Issue 030 聚合为 `NOT_AVAILABLE / NOT_RUN`，没有 Draft 版本绑定。
- 没有执行非关键正文修改，因而没有可观察的真实内容 freshness 传播或合法重跑项。
- 没有伪造 PASS、降低规则、代替用户确认真实性，或进入快速/重点审批候选。

## 11. 外部副作用与停止点

| 类别                           | 结果                                               |
| ------------------------------ | -------------------------------------------------- |
| 真实密钥                       | 读取、显示、复制、保存、探测均为 0                 |
| 模型 / Provider                | 真实调用 0，费用 0                                 |
| 真实网页、搜索、图片、业务 API | 调用 0                                             |
| Local API                      | 未启用、未调用、未扫描端口                         |
| 小红书平台                     | 登录、发布、评论、私信、验证码、风控与自动化均为 0 |
| AI 标识                        | `aiDisclosure=false`，未参与任何门禁或判断         |
| 版权规则                       | 未进入字段、评分、门禁、审批或排期                 |

本轮没有进入 029B、Issue 031、M4、审批、导出、发布包或平台操作。试运行在已实证的新用户
流程缺口处停止；这不降低“读者知识水平”修复的实现结论。
