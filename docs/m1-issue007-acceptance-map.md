# M1 Issue 007 验收映射

| 编号 | 验收行为                     | 自动化证据                             |
| ---- | ---------------------------- | -------------------------------------- |
| 1    | 空目录创建新数据库           | `tests/db-migrations.test.ts`          |
| 2    | 从零执行全部迁移             | `tests/db-migrations.test.ts`          |
| 3    | 重复迁移幂等                 | `tests/db-migrations.test.ts`          |
| 4    | 外键约束生效                 | `tests/db-migrations.test.ts`          |
| 5    | 唯一约束生效                 | `tests/db-migrations.test.ts`          |
| 6    | Check 约束生效               | `tests/db-migrations.test.ts`          |
| 7    | 事务失败回滚                 | `tests/db-migrations.test.ts`          |
| 8    | 迁移前生成备份               | `tests/db-recovery.test.ts`            |
| 9    | 迁移失败后原库可打开         | `tests/db-recovery.test.ts`            |
| 10   | 迁移失败后原数据保持         | `tests/db-recovery.test.ts`            |
| 11   | 失败后 Schema 版本不前移     | `tests/db-recovery.test.ts`            |
| 12   | 中文 Windows 路径            | `tests/db-persistence-windows.test.ts` |
| 13   | 带空格 Windows 路径          | `tests/db-persistence-windows.test.ts` |
| 14   | 关闭重开后数据保持           | `tests/db-persistence-windows.test.ts` |
| 15   | AI 标识默认 false            | `tests/db-hard-constraints.test.ts`    |
| 16   | 写入 true 被拒绝             | `tests/db-hard-constraints.test.ts`    |
| 17   | Schema 无来源风险门禁字段    | `tests/db-hard-constraints.test.ts`    |
| 18   | 质量检查拒绝 AI 标识类型     | `tests/db-hard-constraints.test.ts`    |
| 19   | 质量检查拒绝来源风险类型     | `tests/db-hard-constraints.test.ts`    |
| 20   | 阅读状态与 Core 一致         | `tests/db-hard-constraints.test.ts`    |
| 21   | 剧透等级与 Core 一致         | `tests/db-hard-constraints.test.ts`    |
| 22   | 内容状态与 Core 一致         | `tests/db-hard-constraints.test.ts`    |
| 23   | 级联、置空和限制符合设计     | `tests/db-migrations.test.ts`          |
| 24   | 迁移版本顺序确定且历史不可变 | `tests/db-migrations.test.ts`          |
| 25   | 不保存密钥字段               | `tests/db-hard-constraints.test.ts`    |

补充覆盖包括：25 张业务表字段精确匹配 PRD、所有外键有索引、备份文件不覆盖、未版本化旧库保留、首次迁移失败不留半成品、嵌套事务拒绝、审批等级和评分类型与 Core 一致。

所有测试仅使用合成数据和本地临时 SQLite 文件，不访问真实 API，不产生费用。
