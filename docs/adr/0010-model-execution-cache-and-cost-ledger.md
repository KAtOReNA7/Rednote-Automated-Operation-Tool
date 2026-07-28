# ADR 0010：模型执行、本地结果缓存与精确成本账本

- 状态：已接受
- 日期：2026-07-28
- 范围：M2 Issue 014

## 背景

Provider v1 和显式能力探测已经存在，但业务尚无统一的运行幂等、结果复用、成本来源、
并发预算预留与恢复语义。Issue 014 必须在不接入真实模型业务、不读取真实凭据的前提下
建立这些基础能力。

## 决策

1. `packages/workflows` 提供 `ModelExecutionService`。固定顺序为：严格校验、语义身份、
   `executionId` 幂等、本地缓存读取、能力门禁、singleflight、原子预算预留、晚解析凭据、
   单次 Provider 调用、输出校验、不可变缓存写入、短事务结算。
2. 缓存键使用 `cache-key-v1` 和 `canonical-json-v1`。键包含任务、角色/槽位、非密配置
   指纹、模型、协议、Provider 合同、prompt、输入、参数、schema、来源与媒体内容身份；
   排除路径、时间、执行 ID、凭据、Git 信息、AI 标识和版权。
3. 本地结果缓存与 Provider Prompt Cache 是两个概念。本地命中不发外部请求、不预留、
   不写成本账本；供应商 cached-input token 仅属于 usage 和价格计算。
4. 缓存只接受完整且验证通过的 TEXT、STRUCTURED、VISION、IMAGE 结果。
   probe、search、tool、streaming、refusal、partial、cancelled、error 和 ambiguous 永不缓存。
5. ProjectDataRoot 新增唯一受控类别 `MODEL_RESULT_CACHE`，目录为
   `cache/model-results/`。文件内容寻址、原子发布、读取时验证路径/类型/大小/文件 hash/
   输出 hash/格式版本。默认单条 16 MiB、总量 512 MiB、最多 10,000 条。
6. migration v7 受控重建 `model_runs` 和 `cost_ledger` 并保留旧数据，新增缓存条目、价格版本、
   单位政策和预算预留表。v1—v6 SQL 不变；校验值只规范化换行。
7. 所有美元金额使用十进制字符串、`bigint` 中间值和 SQLite safe integer micro-USD。
   未知或不可完整定价的金额为 `NULL` 并带明确状态，绝不伪装为 0。
8. 成本账本只追加。供应商报告的 allowlisted USD 证据优先；否则使用执行时选定的不可变
   用户价格版本；缺少必要组成部分时为 unpriced/partial。
9. 预算按 UTC 月统计。默认 $80 预警、$100 硬停止；外部请求发送前使用 SQLite 短事务
   原子预留。未定价请求必须命中版本化单位政策。硬停止不影响缓存命中或本地管理功能。
10. Issue 013 的每个 probe step 固定为 `BYPASS`、`NONESSENTIAL`，进入同一运行/预算内核；
    保持用户显式预览/确认、串行、一次、无重试、无 fallback。
11. 任务中心只经严格 preload/IPC 接收摘要 DTO。缓存清理使用五分钟、单次、绑定 sender/
    window 的预览令牌；renderer 不接收 prompt、输入、输出、凭据、缓存路径或 payload。

## 并发与恢复

- 进程内相同键使用 promise singleflight；SQLite 缓存条目同时提供 owner lease、heartbeat、
  revision 和过期状态，供跨 worker/未来队列集成。
- `executionId` 是业务幂等键，结算身份唯一。至少一次队列重放不重复外部调用、预留或账本。
- 仅可证明未发送的失败释放预留；可能已发送的中断转为 `AMBIGUOUS` 和
  `UNKNOWN_POSSIBLY_INCURRED`，不自动重试或 takeover。
- Provider 调用期间不持有 SQLite 长事务。缓存文件先不可变写入，再用短事务发布引用。
- 缓存清理先 tombstone，确认没有 READY 引用后只删除精确受控文件；账本和运行记录保留。

## 安全与产品边界

- 不新增云依赖、真实模型调用、自动发布、SearchProvider 或 Issue 015 能力。
- `aiDisclosure=false` 保持不变；AI 标识和版权不参与缓存、预算、成本或执行状态。
- 凭据、prompt、输入/输出、原始响应和缓存 payload 不进入 SQLite、日志、诊断、普通导出、
  IPC error、Git、测试快照或 CI 输出。
- 所有测试使用 mock、合成值、临时数据库/ProjectDataRoot 和本机 loopback。

## 后果

后续模型业务必须通过 `ModelExecutionService`，不能直接调用 Provider 或自行绕过预算。
价格和单位政策需要由用户配置并版本化；本 Issue 不联网抓价、不猜价格、不开放任意
adjustment，也不实现 Issue 015 的 SearchProvider。
