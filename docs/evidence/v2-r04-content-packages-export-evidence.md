# V2-R04 内容包、批量批准与本地导出证据

状态：`LOCAL_IMPLEMENTATION_VERIFIED`（托管 CI 与用户体验验收分别由 Draft PR 和体验包完成）
动态 main 基线：`c4937e0ef648879cfb8b70183e2a6c233ec508f7`
实现分支：`codex/v2-r04-content-package-export`

## 边界与结果

- 已锁定周计划可明确选择 3 项，经本地 `ScriptedContentProvider` 生成 3 个确定性内容包。
- 六个用户字段固定为封面、标题、正文、标签、建议日期时间、素材说明；不存在置顶评论。
- 标题、正文、标签、建议日期时间和素材说明可编辑；实质编辑创建版本，no-op 不创建版本。
- 单篇/批量批准绑定精确当前版本；已批准内容再编辑进入 `REVIEW_REQUIRED`。
- 仅当前已批准版本可导出到 ProjectDataRoot 下的 `exports/v2/`；导出不是发布。
- 真实密钥读取、模型/API、业务网络、费用和平台操作均为 0。

## 核心验收映射

| ID     | 已验证行为                                      | 行为证据                                                |
| ------ | ----------------------------------------------- | ------------------------------------------------------- |
| R04-01 | 非锁定计划拒绝生成                              | `tests/v2-content.test.ts` 锁定门测试                   |
| R04-02 | 锁定计划选择 3 项得到稳定三包                   | 同上，校验 candidate 绑定与日期时间                     |
| R04-03 | 相同幂等命令不重复包、版本或文件写入            | 同上，重放结果相等且写入次数保持 3                      |
| R04-04 | 六字段完整且无置顶评论                          | content DTO、renderer 与导出文件集合断言                |
| R04-05 | 实质编辑升版、no-op 不升版                      | 版本测试得到 `1 → 2`，no-op 保持 `1`                    |
| R04-06 | 批准后编辑失效                                  | `APPROVED → REVIEW_REQUIRED`，旧批准不可导出            |
| R04-07 | 批量批准原子且 revision fail closed             | 混入 stale revision 后三包均保持 `DRAFT`                |
| R04-08 | 新 application/repository 实例恢复内容与状态    | 临时 SQLite 重开读取等于原 workspace                    |
| R04-09 | 仅已批准当前版本可导出，一个根目录承载多包      | application 拒绝未批准版本；两包导出集成测试            |
| R04-10 | 每包六文件，根 manifest/START-HERE 有界且无泄漏 | 真实受控临时 ProjectDataRoot 文件断言                   |
| R04-11 | hash 校验、Windows 安全路径、原子失败和幂等重放 | 损坏 hash 失败后无临时/成功目录；重放仅一个目录         |
| R04-12 | 只打开本进程刚生成的 opaque export ID           | in-memory generated set 与不存在 ID 拒绝测试            |
| R04-13 | renderer 无 Node/DB/FS，V2 IPC 仍恰好两条       | renderer architecture 与 Electron boundary 测试         |
| R04-14 | 内容页三包切换、字段、选择与批量动作可键盘到达  | `tests/v2-renderer.test.tsx`                            |
| R04-15 | 外部连接、真实密钥、模型、费用和平台动作 0      | Scripted/file-only 实现、禁止范围测试与 CI socket smoke |
| R04-16 | legacy、七页导航与 R03 人设/计划行为保持        | V2 persistence、renderer、desktop architecture 测试     |

## 本地聚焦验证

- R04、V2 persistence、renderer 与 renderer architecture：4 files，18/18 通过。
- migration、永久硬约束、forbidden scope、desktop/storage architecture：5 files，42/42 通过。
- 最后一次内容安全增量复验：1 file，5/5 通过。
- 受影响的 V2/DB/desktop/web TypeScript 项目编译通过；变更文件定向 ESLint 与 smoke 脚本语法检查通过。
- 最终候选门禁依次通过：`format-check`、`lint`、`typecheck`、`build` 均为 `exit 0`；持久日志位于本轮受控验证目录。
- 本地未运行 normal 全量、capacity、Electron smoke、packaged smoke、package 或 audit；按任务要求交由精确 PR HEAD 的 Windows required CI。

## 数据、预算与副作用

- migration：1；新增 STRICT 表：2；trigger：0。
- V2 IPC channel：仍为 2；新增 dependency/package/route/queue/worker：0。
- 产品源码净新增 1,473 LOC（上限 1,500）；测试净新增 456 LOC（上限 1,100）。
- 主体文件：25；migration-tail 机械例外：`tests/db-migrations.test.ts` 1 个；总文件：26。
- SQLite 只保存状态、revision、关联和六个内容寻址文件的 ManagedRelativePath/hash/size metadata；不保存正文或绝对路径。
- manifest 固定 `aiDisclosure:false`，且该值不参与生成、门禁、评分、批准或导出选择。

## 托管与体验证据定位

- 精确 HEAD 的托管事实以 Draft PR 上的 `Windows required` check 为权威；该 check 覆盖 full normal、capacity、Electron/source-packaged smoke、build、desktop/clipper package、audit 与 cleanup。
- packaged smoke 使用隔离 ProjectDataRoot 完成锁定计划、三包生成、编辑、批量批准、导出、hash/manifest/六文件校验和第二次启动恢复。
- CI artifact 名称为 `rednote-v2-r04-windows-<short-head>`，内含两个启动脚本、`V2-R04-体验清单.txt` 和精确 commit。
- PR 保持 Draft；用户明确回复“接受 V2-R04”前不得合并或进入 R05。
