# Model Accounting v1 合同

## 金额与来源

- 持久化单位为整数 micro-USD；UI 输入和价格版本使用有限 ASCII 十进制字符串。
- 金额解析和费率计算使用 `bigint`；保护预算的估算向上取整到 1 micro-USD。
- `PROVIDER_REPORTED_USD` 只接受 allowlisted 响应字段、USD 和最多六位小数。
- `USER_PRICE_TABLE_ESTIMATE` 引用执行时的不可变价格表版本。
- 缺少必要价格/usage 时为 `UNPRICED_USAGE`，可能已执行但未知时为
  `UNKNOWN_POSSIBLY_INCURRED`；两者金额必须为 `NULL`。
- `NOT_INCURRED` 只用于未发送或本地缓存命中，不进入追加式成本账本。
- UI 格式化不反向参与任何账本或预算计算。

Provider cached-input、cache-write、input/output/reasoning token、图片、图片生成调用、
Web Search 调用、tool unit 和固定调用费为独立维度。Provider cached-input 不等于本地命中。

## 账本

`cost_ledger` 每个 settlement identity 最多一行，禁止 UPDATE/DELETE。更正只能在未来以
允许的追加 adjustment 表达；V1 UI 不开放任意 adjustment。账本记录 UTC 计费月、执行、
模型、操作、成本状态/来源、可空金额、比较估算、价格版本和安全 usage 摘要。

## 预算

- 计费周期为 UTC `YYYY-MM`，周键为 ISO UTC week。
- 默认 warning 为 $80，达到即显示预警；hard limit 为 $100，达到或新预留将达到时阻止
  新 `NONESSENTIAL` 外部请求。
- 已知 ledger、ACTIVE reservation 和 UNCERTAIN reservation 分开聚合；unknown 调用单列。
- 发送前以 SQLite 短事务原子预留；发送前失败释放，发送后不确定保留。
- 无完整价格时必须命中最具体的 TASK_KIND、MODEL_ROLE 或 GLOBAL 单位政策；否则返回
  `BUDGET_UNPRICED_LIMIT_REQUIRED`。
- 单位政策版本化，至少限制周/月外部调用，并在适用操作中限制 token、图片、图片生成、
  Web Search 或 tool unit。
- 调用方不能自报 essential。本地缓存命中、查看账本、修改预算/政策和清理缓存不受硬停止
  阻断。

## UI 与 IPC 摘要

任务中心显示 UTC 月、供应商报告、本地估算、unknown、预留/不确定预留、warning/hard、
本地缓存条目/字节/命中和最近运行。unknown 不显示为 `$0`；本地命中标为“未发起外部
请求”；Provider cached-input 标为“供应商缓存输入”且不计入本地命中率。

价格与单位政策创建要求 app settings revision。缓存清理必须先预览，再使用短期、单次、
sender/window 绑定令牌确认；返回数量摘要，不返回路径或内容。
