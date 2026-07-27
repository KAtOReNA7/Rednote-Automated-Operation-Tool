# Issue 008 文件级实施计划

固定起点：`eb9ac8a600caa05c764eb3f2e62e535efa509069`

本计划只覆盖本地文件仓库，不进入 Issue 010 或任何后续业务 Issue。

## 文件与职责

| 路径                                                                                  | 计划                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/shared/src/storage-contracts.ts`                                            | 定义文件类别、`ManagedRelativePath`、路径语料、文件名净化、稳定错误码和有限 DTO。    |
| `packages/shared/package.json`                                                        | 通过独立 `./storage` 子路径导出共享契约，避免 renderer/preload 根入口加载 storage。  |
| `packages/storage/package.json`                                                       | 建立无第三方运行时依赖、无 Electron 依赖的 workspace。                               |
| `packages/storage/tsconfig.json`                                                      | 接入现有 TypeScript project references。                                             |
| `packages/storage/src/project-data-root.ts`                                           | 显式打开/初始化数据根、根标记、固定布局、链接拒绝和长路径能力探测。                  |
| `packages/storage/src/local-file-repository.ts`                                       | 实现流式暂存、SHA-256、内容寻址、独占发布、导入复制、读取、stat 和 verify。          |
| `packages/storage/src/structured-log.ts`                                              | 实现串行 JSONL sink、大小/深度/字段限制和递归脱敏。                                  |
| `packages/storage/src/index.ts`                                                       | 导出有限 storage API，不导出任意删除或任意绝对路径操作。                             |
| `packages/db/src/migrations.ts`                                                       | 追加且只追加版本 3 `managed_local_file_paths`；版本 1、2 保持逐字不变。              |
| `packages/db/src/migration-runner.ts`                                                 | 增加显式 `backupDirectory` 注入，同时保持默认备份语义不变。                          |
| `apps/desktop/src/foundation-health.ts`                                               | 在系统临时目录内增加 storage/数据库/受控备份 smoke，继续关闭全部句柄并精确清理。     |
| `apps/desktop/src/smoke-report.ts`                                                    | 给内部 smoke 报告增加不含路径的 storage 布尔结果。                                   |
| `apps/desktop/src/main.ts`                                                            | 只把内部 storage smoke 结果计入现有 smoke 成功条件；不新增 preload 或 renderer API。 |
| `scripts/run-electron-smoke.mjs`                                                      | 保留原断言并验证 storage 子结果。                                                    |
| `scripts/run-packaged-smoke.mjs`                                                      | 保留 fuses、网络和 TCP 断言并验证 storage 子结果。                                   |
| `tests/storage-root-paths.test.ts`                                                    | 数据根、根标记、目录布局、路径、净化、链接和 Windows 长路径行为。                    |
| `tests/storage-repository.test.ts`                                                    | buffer/stream/导入、读取、stat、verify、大小、取消和失败清理。                       |
| `tests/storage-concurrency.test.ts`                                                   | 幂等、同名异内容、20 路并发、独占临时文件和有限发布重试。                            |
| `tests/storage-logging.test.ts`                                                       | JSONL、串行 append、凭据/路径脱敏及资源限制。                                        |
| `tests/storage-db-paths.test.ts`                                                      | 六个 Schema 路径字段、迁移 3、共享语料、回滚、备份和 orphan 语义。                   |
| `tests/storage-architecture.test.ts`                                                  | 包/renderer/preload/网络/云/平台动作/冻结约束和无生产删除 API。                      |
| `package.json`                                                                        | 新增 `test:storage`，确保全量 `test` 自动包含 storage 测试。                         |
| `tsconfig.json`、`tsconfig.typecheck.json`、`vitest.config.ts`、`vite.main.config.ts` | 注册 storage workspace 与源码别名。                                                  |
| `.github/workflows/ci.yml`                                                            | 在 Windows required job 中新增独立 `test:storage` 门禁。                             |
| `docs/adr/0005-local-file-repository.md`                                              | 记录安全语义、限制、迁移和明确未实现范围。                                           |
| `docs/m1-issue008-acceptance-map.md`                                                  | 将 130 项行为与附加冻结约束逐项映射到自动化证据。                                    |

## 实施顺序

1. 先完成共享契约和纯函数测试。
2. 再完成数据根、仓库和日志实现。
3. 根据已枚举的六个真实路径列追加迁移 3，并接入受控备份目录。
4. 最后扩展临时 Electron smoke；不改变 renderer、preload、CSP、fuses 或网络策略。
5. 全部门禁通过后才创建指定本地提交。
