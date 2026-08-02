# V2-R05 本地互动与回复工作流证据

## 动态基线与范围

- 已验收 PR #6 的 head 为 `9a5b7f4dd52807de95d39d34e302949f0dbbb6a3`；无未解决 review、requested changes 或失败检查。
- PR #6 通过普通 merge 形成 `11f2a0f1a0a806808007300a14cb81c759694498`。合并提交的 Windows required CI run `30749815992` / job `91501733026` 为 success。
- R05 从上述提交创建 `codex/v2-r05-interaction-replies`；开工时本地 `main`、`origin/main` 与实际远端 main 一致，ahead/behind 为 `0/0`，tracked/staged clean。
- 只实施本地 COMMENT / DIRECT_MESSAGE 主动粘贴、确定性 Scripted 建议、版本编辑、确认/跳过/重开、手动发送事实记录与撤销、精确 tombstone 删除。未实施平台连接、真实模型、自动发送、R06 或视觉改版。

## 数据、边界与删除语义

- migration 23 `v2_interactions_and_reply_versions` 追加 2 张 `STRICT, WITHOUT ROWID` 表：`v2_interaction_items` 与 `v2_reply_suggestion_versions`；新增 trigger 为 0。
- SQLite 只保存类型、稳定关联 ID、状态、revision、受控 `ManagedRelativePath`、SHA-256、有限字节数和 UTC 时间；用户文本与回复正文只进入项目数据根的 `IMPORT` 内容寻址文件。
- 完全相同的规范化输入先检查 SHA-256 dedup key，再写文件；重复导入返回既有稳定 item。
- 所有 mutation 使用 `expectedRevision`；建议确认和手动发送事实还绑定精确当前 `versionId`。批量确认在单事务内验证全部引用后才更新。
- 删除流程为预览、明确确认、精确 tombstone。普通 repository/application/IPC/UI 均排除已删除项；R04 内容包与其他互动不受影响。
- 当前文件仓库没有能证明共享内容寻址文件无其他引用的即时物理删除 API，因此相关字节诚实保留为产品不可访问的 cleanup-pending orphan；不宣称磁盘字节已经删除。
- V2 IPC 仍只有 `v2:workspace:read` 与 `v2:workspace:mutate` 两条；renderer 不接触 Node、Electron、SQLite、文件系统或网络实现。

## 核心验收映射

| ID     | 已验证事实                                                                                                     | 证据                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| R05-01 | COMMENT、DIRECT_MESSAGE 可创建并经新 application 实例恢复                                                      | `tests/v2-interaction.test.tsx`，专项 8/8                                 |
| R05-02 | exact-object、类型、空值、NUL、枚举和 8,000/4,000 字节上限 fail closed；错误 DTO 不含正文                      | `tests/v2-interaction.test.tsx`                                           |
| R05-03 | 重放返回相同 item，且数据库行与 managed file 数不增加                                                          | `tests/v2-interaction.test.tsx`                                           |
| R05-04 | 可选关联只接受当前 workspace 的 R04 package ID                                                                 | `tests/v2-interaction.test.tsx`                                           |
| R05-05 | Scripted 建议确定、幂等，UI 明示“非模型、未发送”                                                               | `tests/v2-interaction.test.tsx`、互动页                                   |
| R05-06 | 实质编辑升版、no-op 不升版，确认绑定当前版本                                                                   | `tests/v2-interaction.test.tsx`                                           |
| R05-07 | 已确认建议再编辑回到 SUGGESTED；旧确认不能标记 MANUAL_SENT                                                     | `tests/v2-interaction.test.tsx`                                           |
| R05-08 | SKIPPED 可重开，非法状态转换被拒绝                                                                             | `tests/v2-interaction.test.tsx`                                           |
| R05-09 | 只有 CONFIRMED 当前版本可记录 MANUAL_SENT；可受控撤销且无平台动作                                              | `tests/v2-interaction.test.tsx`                                           |
| R05-10 | 混入 stale revision 时批量确认整批回滚                                                                         | `tests/v2-interaction.test.tsx`                                           |
| R05-11 | 正文引用、建议版本、状态、关联与 revision 重启一致                                                             | `tests/v2-interaction.test.tsx`、`tests/v2-persistence.test.tsx`          |
| R05-12 | 删除预览/确认/tombstone、产品不可再读、保留字节与 R04 隔离均有行为证据                                         | `tests/v2-interaction.test.tsx`                                           |
| R05-13 | 错误/测试证据只含稳定码和去标识化字段，不含正文或绝对路径                                                      | `tests/v2-interaction.test.tsx`                                           |
| R05-14 | renderer 架构边界保持，V2 IPC 总数为 2                                                                         | `tests/v2-renderer-architecture.test.ts`、`tests/v2-interaction.test.tsx` |
| R05-15 | tab、添加、筛选、列表、详情、批量确认和删除确认均键盘可达；无发送动作                                          | `tests/v2-interaction.test.tsx`                                           |
| R05-16 | R03/R04 持久化、内容和 frozen shell 邻接回归本地通过；完整 Electron/package 信号由精确 PR HEAD Windows CI 验证 | 聚焦测试 42/42；托管 required check 不预填结果                            |
| R05-17 | 真实密钥、模型/API、业务网络、费用与平台操作均为 0                                                             | Scripted provider、loopback/临时数据测试、边界扫描与托管 smoke            |

## 本地验证与预算

- 基线聚焦集合：6 个文件、29 项测试通过。
- 最终互动/持久化/R04 内容/renderer 集合：4 个文件、23 项测试通过；结构化结果位于受控 ignored validation 目录。
- migration/存储架构集合：2 个静态 normal 文件、19 项测试通过。请求的 `storage-repository` 属于 capacity 静态集合，依指令交给托管 CI，未在本地重复运行。
- `npm run format-check`、`npm run lint`、`npm run typecheck`、`npm run build` 与 `git diff --check` 通过；变更增量 secret/egress、skip/todo/only、V2 IPC 数和依赖文件检查均通过。UTF-8 package build 修正后的互动专项再次 8/8 通过。
- 产品源码净新增 `1,400 LOC`（新增 1,537、删除 137）；测试净新增 `675 LOC`（新增 678、删除 3）。
- 主体文件为 25 个，包含本文件与归档指令；migration-tail 例外仅 `tests/db-migrations.test.ts` 1 个文件，其强断言只从 4 张 V2 表扩展为 6 张，不删除或弱化既有项；总文件仍为 25。
- 1 个 migration、2 张新表、0 trigger、0 新 IPC、0 新 package/dependency/route/queue/worker/top-level navigation。

## 托管门禁与体验包停止点

- R05 Draft PR 创建后，以精确 PR HEAD 的 GitHub Windows required check 为托管事实来源；只有实际 success 才下载同一 SHA 的 `rednote-v2-r05-windows-<shortSha>` artifact。
- 托管 packaged smoke 必须在隔离 ProjectDataRoot 完成评论与私信导入、去重、建议、编辑、确认/跳过、MANUAL_SENT、重启恢复和精确删除，并证明外部业务连接为 0。
- artifact 只做静态核验，不由代理启动：必须包含 Windows EXE、V2/legacy 两个启动器、`V2-R05-体验清单.txt` 和精确 commit 标识，且不含固定电脑路径。
- 成功停止状态为 `R05_AWAITING_USER_ACCEPTANCE`；等待用户本人体验并回复“接受 V2-R05”。R05 不合并，也不进入 R06—R08、V2-D-FINAL、029B、Issue 031 或 M4。
