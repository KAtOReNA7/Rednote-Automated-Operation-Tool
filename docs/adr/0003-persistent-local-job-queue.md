# ADR-0003：持久化本地任务队列

- 状态：接受
- 日期：2026-07-27
- 范围：M1 Issue 009

## 背景

后续本地工作流需要跨进程重启保留任务、限制并发，并能在 Worker 异常退出后安全恢复。
本 Issue 只建立通用队列基础，不实现 Electron 接入，也不实现研究、模型、搜索、图片、
OCR、发布或其他真实业务处理器。

队列必须延续 Issue 007 的 `node:sqlite`、同步 `DatabaseSync`、WAL、短事务、迁移前备份
和不可变迁移历史。第 1 版迁移保持原文和校验和不变；第 2 版迁移重建 `jobs` 表并保留
既有数据。

## 决策

### 交付语义

队列提供 **at-least-once（至少一次）** 交付，不是 exactly-once（恰好一次）交付。

原因是 Worker 可能已经完成外部副作用，却在写入 `SUCCEEDED` 前崩溃。租约过期后该任务
会被再次执行。队列通过持久化幂等入队键和租约令牌缩小重复范围，但不能替代业务侧的
副作用幂等。

未来每个真实 handler 必须：

1. 以任务的稳定业务键保护外部写操作；
2. 能安全处理重复调用，或在调用目标提供幂等键；
3. 在安全检查点调用 `heartbeat()`；
4. 响应 `AbortSignal` 和 `PAUSE` / `CANCEL` 控制信号；
5. 只返回受大小限制的 JSON；
6. 不在 payload、result 或错误中保存凭据、完整请求头或巨大响应；
7. 不自行修改 `jobs` 表或伪造完成状态。

本轮 registry 中只有测试 handler，没有任何真实 API、云服务、研究、模型、图片、OCR 或
平台动作 handler。

### 组件边界

- `JobQueueRepository`：唯一直接写入队列表和队列审计记录的组件。
- `JobQueueService`：验证参数、payload、幂等键、租约参数和退避时间。
- `JobWorker`：领取任务、在事务外调用 handler、心跳并提交结果。
- `JobHandlerRegistry`：进程内显式注册 handler，不做动态插件发现。
- `JobRecoveryService`：提供应用启动时可调用的过期租约恢复入口。
- `QueueClock` / `QueueScheduler`：隔离时间和等待，支持确定性测试。
- `BackoffPolicy`：计算有上限的重试延迟。
- `JobPayloadValidator`：规范化 JSON、限制深度和大小、拒绝明显凭据。

长任务始终在数据库事务之外运行。领取、心跳、完成、失败、控制确认和恢复各自只使用
短事务。

### 状态转换

| 当前状态           | 允许的下一状态                                                             | 触发方式              |
| ------------------ | -------------------------------------------------------------------------- | --------------------- |
| `QUEUED`           | `RUNNING`、`PAUSED`、`CANCELLED`                                           | 领取、直接暂停/取消   |
| `RUNNING`          | `SUCCEEDED`、`RETRY_WAIT`、`FAILED`、`PAUSE_REQUESTED`、`CANCEL_REQUESTED` | Worker 或控制请求     |
| `PAUSE_REQUESTED`  | `PAUSED`                                                                   | Worker 确认或租约恢复 |
| `PAUSED`           | `QUEUED`、`CANCELLED`                                                      | 恢复或直接取消        |
| `CANCEL_REQUESTED` | `CANCELLED`                                                                | Worker 确认或租约恢复 |
| `RETRY_WAIT`       | `RUNNING`、`PAUSED`、`CANCELLED`                                           | 到期领取、暂停或取消  |
| `FAILED`           | `QUEUED`                                                                   | 显式人工重试          |
| `SUCCEEDED`        | 无                                                                         | 终态                  |
| `CANCELLED`        | 无                                                                         | 终态                  |

`SUCCEEDED`、`FAILED` 和 `CANCELLED` 必须设置 `finished_at`。其中只有 `FAILED` 可以通过
显式 `retryFailedJob` 增加尝试预算后重新排队；历史 `attempt_count` 和原幂等键不重置。

### 幂等入队

调用方必须提供稳定 `idempotency_key`：

- 同键、同 `job_type`、同规范化 payload hash：返回原任务；
- 同键但类型或 payload 不同：返回明确冲突；
- 两个数据库连接竞争同一键：唯一约束和短写事务保证只保留一条；
- 对象键在递归排序后序列化，因此键顺序不改变 hash；
- 随机键不能被用来掩盖重复业务请求；
- 键和 payload 都拒绝明显凭据。

幂等入队不意味着 handler 的外部副作用恰好一次。未来 handler 仍需业务幂等。

### 领取与租约

可领取范围仅为到达 `next_run_at` 的 `QUEUED` 或 `RETRY_WAIT`。排序依次为：

1. `priority` 降序；
2. `next_run_at` 升序；
3. `created_at` 升序；
4. `id` 升序。

领取在 `BEGIN IMMEDIATE` 短事务中完成，并原子写入 `RUNNING`、增加
`attempt_count`、设置 `lock_owner`、新的 `lease_token`、`lease_expires_at`、
`last_heartbeat_at` 和首次 `started_at`。只有 worker id 与当前 lease token 同时匹配且
租约未过期，才能心跳、完成、失败或确认控制。仅凭 worker id 不构成所有权。

心跳更新 `last_heartbeat_at` 和租约期限，并返回 `CONTINUE`、`PAUSE` 或 `CANCEL`。
为避免高频、无界审计增长，不为每次心跳写 `audit_events`；其他重要状态转换仍与状态写入
处于同一事务。

### 失败、退避与恢复

失败摘要采用稳定错误码、1000 字符上限和凭据遮盖，不保存 stack。尚有尝试预算时进入
`RETRY_WAIT`，并在同一事务持久化已经计算好的 `next_run_at`；应用重启后不会重算。
默认退避为可配置的指数退避，可配置上限和 jitter，极大尝试次数不会溢出。

恢复服务只处理已经过期的活动租约：

- `RUNNING` 且尚有预算 → `RETRY_WAIT`；
- `RUNNING` 且预算耗尽 → `FAILED`；
- `PAUSE_REQUESTED` → `PAUSED`；
- `CANCEL_REQUESTED` → `CANCELLED`。

恢复会清除旧所有者、令牌、期限和心跳，并写入 `LEASE_RECOVERED`。条件更新和写事务确保
多个恢复器只能转换一次。旧 Worker 即使稍后醒来，也不能用旧令牌提交结果。

### Worker 与受控关闭

Worker 默认并发为 1，配置上限为 32。无任务时按可配置间隔轮询；执行期间定期心跳。
未注册类型以稳定错误码失败，不终止整个 Worker。

关闭先停止领取新任务，并等待执行中 handler。在等待超时后，Worker 中止协作信号并放弃
结果提交，不伪造成功；该任务随后依赖租约过期恢复。强杀线程不作为暂停或取消机制。

### 查询、安全和审计

只读接口为 `getJob`、`listJobs` 和 `getQueueStats`。列表支持状态、类型、创建时间范围和
下次运行时间范围过滤，单页最多 100 条，并使用确定排序。

重要事件写入 `audit_events`，只包含实体、actor 和前后状态，不包含完整 payload 或
result。第 2 版迁移提供幂等唯一索引、领取局部索引、过期租约局部索引、worker 状态索引
以及类型状态索引；查询计划测试验证关键索引确实被选择。

### 运行时与 Electron

最低声明 Node.js 版本仍为 22.16.0，本地运行时能力探针验证 `DatabaseSync`、`backup`
和连接超时选项。当前实际本地测试使用 Node.js 24。最低版本尚未经 GitHub 托管 CI 证明。

本轮没有 Electron 接入，也不将 Electron 36/37 固定为目标。未来 Issue 006 必须在实施时
重新选择仍受支持的 Electron 版本，并用运行时测试验证 `node:sqlite`、进程隔离和消息
通道能力。

## 影响

- 本地任务可跨关闭重开保存，并可从 Worker 崩溃中恢复。
- 任何未来外部副作用都必须按至少一次执行设计。
- 队列没有网络、云队列或服务器依赖，不需要密钥，也不产生模型费用。
- AI 参与信息和来源字段只是普通 payload 数据，不改变优先级、状态或领取资格。
- `ai_disclosure` 继续固定为 false；版权风险不进入队列状态、评分、审批、排期或门禁。
