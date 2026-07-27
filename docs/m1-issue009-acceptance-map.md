# M1 Issue 009 验收映射

以下 80 项与 Issue 009 最低测试矩阵逐项对应。所有证据均使用合成数据和本地临时
SQLite 文件，不访问真实 API，不产生费用。

| 编号 | 验收行为                                     | 自动化证据                                                                           |
| ---: | -------------------------------------------- | ------------------------------------------------------------------------------------ |
|    1 | Issue 007 历史迁移校验和不变                 | `tests/queue-migration.test.ts`                                                      |
|    2 | 新迁移版本连续                               | `tests/queue-migration.test.ts`                                                      |
|    3 | 新迁移重复运行幂等                           | `tests/queue-migration.test.ts`                                                      |
|    4 | 现有 jobs 数据在迁移后保留                   | `tests/queue-migration.test.ts`                                                      |
|    5 | 新迁移失败时完整回滚                         | `tests/queue-migration.test.ts`                                                      |
|    6 | 迁移前备份仍生效                             | `tests/queue-migration.test.ts`                                                      |
|    7 | 其他业务表未发生无关改变                     | `tests/queue-migration.test.ts`                                                      |
|    8 | 正常入队                                     | `tests/queue-enqueue-payload.test.ts`                                                |
|    9 | 延迟入队                                     | `tests/queue-enqueue-payload.test.ts`                                                |
|   10 | 同键、同类型、同 payload 返回同一任务        | `tests/queue-enqueue-payload.test.ts`                                                |
|   11 | 同键、不同类型冲突                           | `tests/queue-enqueue-payload.test.ts`                                                |
|   12 | 同键、不同 payload 冲突                      | `tests/queue-enqueue-payload.test.ts`                                                |
|   13 | 两连接并发同键只创建一条                     | `tests/queue-enqueue-payload.test.ts`                                                |
|   14 | payload 键顺序不改变 hash                    | `tests/queue-enqueue-payload.test.ts`                                                |
|   15 | 无效 JSON 类型被拒绝                         | `tests/queue-enqueue-payload.test.ts`                                                |
|   16 | 超大 payload 被拒绝                          | `tests/queue-enqueue-payload.test.ts`                                                |
|   17 | 明显凭据字段被拒绝                           | `tests/queue-enqueue-payload.test.ts`                                                |
|   18 | 领取最高优先级且已到期任务                   | `tests/queue-lease-lifecycle.test.ts`                                                |
|   19 | 未到 next_run_at 的任务不领取                | `tests/queue-lease-lifecycle.test.ts`                                                |
|   20 | PAUSED、CANCELLED 和终态不领取               | `tests/queue-lease-lifecycle.test.ts`                                                |
|   21 | 两个 worker 不能领取同一任务                 | `tests/queue-lease-lifecycle.test.ts`                                                |
|   22 | 两个独立连接竞争仍只有一个成功               | `tests/queue-lease-lifecycle.test.ts`                                                |
|   23 | 领取增加 attempt_count                       | `tests/queue-lease-lifecycle.test.ts`                                                |
|   24 | 领取生成新 lease_token                       | `tests/queue-lease-lifecycle.test.ts`                                                |
|   25 | 非所有者不能心跳                             | `tests/queue-lease-lifecycle.test.ts`                                                |
|   26 | 旧 lease_token 不能操作新租约                | `tests/queue-lease-lifecycle.test.ts`                                                |
|   27 | 心跳延长租约                                 | `tests/queue-lease-lifecycle.test.ts`                                                |
|   28 | 过期租约不能由旧 worker 完成                 | `tests/queue-lease-lifecycle.test.ts`                                                |
|   29 | 正常完成                                     | `tests/queue-lease-lifecycle.test.ts`                                                |
|   30 | 重复完成有明确冲突语义                       | `tests/queue-lease-lifecycle.test.ts`                                                |
|   31 | 失败后进入 RETRY_WAIT                        | `tests/queue-lease-lifecycle.test.ts`                                                |
|   32 | next_run_at 持久化                           | `tests/queue-lease-lifecycle.test.ts`                                                |
|   33 | 达到 max_attempts 后 FAILED                  | `tests/queue-lease-lifecycle.test.ts`                                                |
|   34 | 终态设置 finished_at                         | `tests/queue-lease-lifecycle.test.ts`                                                |
|   35 | 租约字段被清理                               | `tests/queue-lease-lifecycle.test.ts`                                                |
|   36 | result_json 大小和 JSON 约束                 | `tests/queue-lease-lifecycle.test.ts`                                                |
|   37 | 错误摘要截断并清理凭据                       | `tests/queue-lease-lifecycle.test.ts`                                                |
|   38 | QUEUED 直接暂停                              | `tests/queue-control-recovery.test.ts`                                               |
|   39 | RETRY_WAIT 直接暂停                          | `tests/queue-control-recovery.test.ts`                                               |
|   40 | RUNNING 请求暂停                             | `tests/queue-control-recovery.test.ts`                                               |
|   41 | worker 确认暂停                              | `tests/queue-control-recovery.test.ts`                                               |
|   42 | PAUSED 恢复为 QUEUED                         | `tests/queue-control-recovery.test.ts`                                               |
|   43 | resume 不重置 attempt_count                  | `tests/queue-control-recovery.test.ts`                                               |
|   44 | QUEUED、RETRY_WAIT、PAUSED 直接取消          | `tests/queue-control-recovery.test.ts`                                               |
|   45 | RUNNING 请求取消                             | `tests/queue-control-recovery.test.ts`                                               |
|   46 | worker 确认取消                              | `tests/queue-control-recovery.test.ts`                                               |
|   47 | CANCELLED 不再领取                           | `tests/queue-control-recovery.test.ts`                                               |
|   48 | 终态非法转换被拒绝                           | `tests/queue-state-machine.test.ts`、`tests/queue-control-recovery.test.ts`          |
|   49 | FAILED 显式人工重试                          | `tests/queue-control-recovery.test.ts`                                               |
|   50 | 人工重试保留历史 attempt_count               | `tests/queue-control-recovery.test.ts`                                               |
|   51 | 人工重试增加可用 attempts                    | `tests/queue-control-recovery.test.ts`                                               |
|   52 | SUCCEEDED、CANCELLED 不能人工重试            | `tests/queue-control-recovery.test.ts`                                               |
|   53 | 过期 RUNNING 恢复为 RETRY_WAIT               | `tests/queue-control-recovery.test.ts`                                               |
|   54 | 重试耗尽的过期 RUNNING 恢复为 FAILED         | `tests/queue-control-recovery.test.ts`                                               |
|   55 | 过期 PAUSE_REQUESTED 恢复为 PAUSED           | `tests/queue-control-recovery.test.ts`                                               |
|   56 | 过期 CANCEL_REQUESTED 恢复为 CANCELLED       | `tests/queue-control-recovery.test.ts`                                               |
|   57 | 未过期任务不恢复                             | `tests/queue-control-recovery.test.ts`                                               |
|   58 | 多恢复器竞争只转换一次                       | `tests/queue-control-recovery.test.ts`                                               |
|   59 | 数据库关闭重开后恢复一致                     | `tests/queue-control-recovery.test.ts`                                               |
|   60 | success handler                              | `tests/queue-worker.test.ts`                                                         |
|   61 | fail-once handler 自动重试后成功             | `tests/queue-worker.test.ts`                                                         |
|   62 | always-fail handler 最终失败                 | `tests/queue-worker.test.ts`                                                         |
|   63 | 未注册 handler 不导致 Worker 崩溃            | `tests/queue-worker.test.ts`                                                         |
|   64 | pause-aware handler                          | `tests/queue-worker.test.ts`                                                         |
|   65 | cancel-aware handler                         | `tests/queue-worker.test.ts`                                                         |
|   66 | Worker 停止后不领取新任务                    | `tests/queue-worker.test.ts`                                                         |
|   67 | 崩溃模拟后租约恢复                           | `tests/queue-worker.test.ts`                                                         |
|   68 | 并发上限生效                                 | `tests/queue-worker.test.ts`                                                         |
|   69 | 关键领取查询使用预期索引                     | `tests/queue-performance-platform.test.ts`                                           |
|   70 | 过期租约查询使用预期索引                     | `tests/queue-performance-platform.test.ts`                                           |
|   71 | 中文和空格 Windows 路径                      | `tests/queue-performance-platform.test.ts`                                           |
|   72 | 多个 DatabaseSync 连接                       | `tests/queue-performance-platform.test.ts`                                           |
|   73 | WAL 模式下状态一致                           | `tests/queue-performance-platform.test.ts`                                           |
|   74 | 1,000 个待处理任务下领取顺序正确             | `tests/queue-performance-platform.test.ts`                                           |
|   75 | ai_disclosure 仍固定 false                   | `tests/queue-hard-constraints.test.ts`                                               |
|   76 | 不存在版权检查或版权队列状态                 | `tests/queue-hard-constraints.test.ts`                                               |
|   77 | AI 参与程度不影响优先级、领取和状态          | `tests/queue-hard-constraints.test.ts`                                               |
|   78 | 来源字段变化不影响队列调度                   | `tests/queue-hard-constraints.test.ts`                                               |
|   79 | 不存在小红书平台动作                         | `tests/queue-hard-constraints.test.ts`、`tests/forbidden-scope.architecture.test.ts` |
|   80 | 不存在真实 API、云服务、开卷或盗版电子书处理 | `tests/queue-hard-constraints.test.ts`、`tests/forbidden-scope.architecture.test.ts` |

补充证据：

- `tests/queue-state-machine.test.ts` 覆盖完整状态枚举和允许转换。
- `tests/queue-contracts.test.ts` 覆盖退避、只读查询、分页上限、统计、审计原子性和心跳容量策略。
- `tests/queue-performance-platform.test.ts` 运行时验证 `node:sqlite` 所需能力，并证明 handler
  运行期间不持有数据库事务。
- `npm run test:queue` 只运行 Issue 009 队列专项测试，可独立失败。
