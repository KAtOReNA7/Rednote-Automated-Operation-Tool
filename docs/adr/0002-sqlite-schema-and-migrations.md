# ADR-0002：SQLite 驱动、Schema 与迁移策略

- 状态：接受
- 日期：2026-07-27
- 范围：M1 Issue 007

## 背景

Issue 007 只建立 Windows 本地 SQLite 持久化基础，不实现 UI、设置、任务执行器、模型、搜索、图片、发布或数据导入业务。数据库必须覆盖 PRD 冻结的 25 张业务表，并确保迁移可追踪、已有数据库迁移前自动备份、失败后不留下半迁移状态。

项目还需要避开两类不可变业务错误：

1. `post_packages.ai_disclosure` 默认且始终为 `false`，不参与门禁；
2. 来源信息只用于事实回溯与内容管理，不形成风险字段、评分、审批或排期门禁。

## 决策

### 驱动

使用 Node.js 内置 `node:sqlite` 的同步 `DatabaseSync` API：

- 项目最低 Node.js 版本提升为 `22.16.0`，以便使用该版本已提供的 SQLite backup API；
- Windows CI 固定使用 Node.js 24；
- 数据库操作位于本地进程，不接入云数据库或远程服务；
- 每个连接显式启用外键、5 秒 busy timeout、WAL 和 `synchronous=NORMAL`；
- 不加载 SQLite 扩展。

后续 Issue 006 如果接入 Electron，必须使用已经修复内置 `node:sqlite` 加载问题的 Electron 版本（至少 `36.7.3` 或 `37.2.3`），并继续把数据库留在主进程边界。本 Issue 不实现 Electron 集成。

### Schema

- 业务表严格对应 PRD 的 25 张表和字段，不增加预留业务字段；
- 另有技术表 `schema_migrations`，记录版本、名称、SHA-256 校验和与 UTC 应用时间；
- 表使用 SQLite `STRICT` 模式；
- 已知领域枚举通过 `CHECK` 约束与 `packages/core` 保持一致；
- JSON 文本使用 `json_valid`，布尔值使用受约束的 `0/1`；
- 统一持久化毫秒精度的 UTC ISO 8601 文本时间；
- 所有外键均有以外键列为首列的索引或唯一索引；
- 删除策略按关系分别使用 `CASCADE`、`SET NULL` 和 `RESTRICT`。

### 迁移

- 迁移是从 1 开始、连续递增且名称唯一的不可变 SQL；
- 已应用迁移以版本、名称和 SHA-256 校验和共同校验，历史被改写时拒绝继续；
- 迁移器统一拥有事务边界，迁移 SQL 不允许自行提交或回滚；
- 所有待执行迁移和迁移记录在同一个 `BEGIN IMMEDIATE` 事务内执行；
- 提交前执行 `quick_check` 与 `foreign_key_check`；
- 重复执行没有副作用。

### 备份与恢复

- 仅在已有数据库存在待执行迁移时创建迁移前备份；
- 先以只读方式检查历史并创建备份，再打开写连接；
- 备份位于数据库同级 `backups` 目录，文件名包含 UTC 时间；
- 如果目标备份文件已存在，使用递增后缀，绝不覆盖；
- 失败时回滚全部待执行迁移，不删除、不重建原数据库；
- 错误包含失败版本与备份路径，便于人工恢复。

## 被否决的方案

- `better-sqlite3`：本机 Node.js 24 / Windows 安装时没有可用预构建产物，回退编译要求额外 Windows SDK；Electron 还需要原生模块重建与打包处理。
- `node-sqlite3`：同样引入原生模块安装、ABI 与打包复杂度。
- Drizzle、Knex 或其他 ORM/迁移框架：不能替代底层驱动，并会为当前单一、本地、冻结 Schema 增加不必要抽象。
- libSQL 或云数据库：违反纯本地、无服务器、无云数据库边界。

## 影响

- 当前驱动没有第三方运行时依赖，也不需要 C++ 工具链。
- 同步 API 适合后续放在 Electron 主进程或工作线程；UI 不应直接访问数据库。
- `node:sqlite` 在当前 Node.js 文档中仍标为 Release Candidate，因此以 Node 版本下限、Windows CI 和数据库行为回归测试共同锁定兼容性。变更驱动或迁移策略必须另立 ADR。
