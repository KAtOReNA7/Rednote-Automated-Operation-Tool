# M2 Issue 014 实施计划：模型执行缓存与成本账本

状态：已完成。本文在编码前创建，并在完成时回填实际实现与门禁证据。

## 1. 动态基线与停止边界

- 仓库根由 `git rev-parse --show-toplevel` 动态发现。
- 本轮动态 `BASELINE_HEAD` 为 `f92d9846f4a66b078f0b90961e71bd3479cfcb64`，只作本次记录，
  不作为未来门禁。
- 起点是完成的 SQLite v6、Provider v1 与显式 Capability Probe；工作树除根目录
  `Issue014-Codex-instruction.txt` 外无未知修改。
- 临时目录、npm cache 与 packager staging 从仓库所在卷动态派生；不依赖系统盘余量。
- 只实现 Issue 014。不得实现 SearchProvider、页面抓取、插件业务或 Issue 015 以后功能。
- 开发、测试、source/package smoke 仅使用 Scripted Mock、`127.0.0.1` loopback、合成凭据、
  fake clock、临时 userData 与临时 ProjectDataRoot；不读取真实凭据，不访问真实服务，不产生费用。

## 2. 合同与纯函数

- 在 `packages/workflows/src/model-execution/` 建立 provider-neutral
  `ModelExecutionRequestV1`、有限结果、状态机、严格 runtime validator 和执行服务。
- `canonical.ts` 实现版本化、确定性的 UTF-8 canonical JSON；对象键排序、数组保序，并显式
  区分 missing/null/empty/false/0，拒绝循环、prototype key、undefined、非有限数与不支持对象。
- `cache-key.ts` 实现 `cache-key-v1`，只包含任务、槽位、非秘密配置指纹、模型、协议、
  Provider 合同、prompt、精确输入、参数、schema、来源与媒体内容身份；排除运行 ID、时间、
  路径、用户名、Git、凭据、AI 标识和版权。
- `money.ts` 只用字符串、`bigint` 和受验证的 SQLite safe integer，实现 micro-USD、
  美分换算、十进制解析、向上取整费率计算和 UI 格式化；金额决策不使用浮点。
- `accounting.ts` 实现 Usage observation、合法 Provider USD 费用观察、用户价格版本、partial/
  unpriced/unknown 计算、UTC 月/周键、80/100 美元边界和无价格单位政策。

## 3. migration v7 与仓储

- 只追加 migration v7 `model_execution_cache_and_cost_ledger`；v1—v6 的 version/name/SQL
  保持不变。
- 受控重建 `model_runs` 与 `cost_ledger`，保留旧行并移除新 schema 中的金额 `REAL`。
- 新增 `model_cache_entries`、`model_budget_reservations`、`model_price_schedules`、
  `model_unit_budget_policies`，全部为 STRICT 表，带有限枚举、外键、唯一约束和查询索引。
- `packages/db/src/model-accounting-repository.ts` 提供 executionId 幂等、有限状态机、cache
  lease/heartbeat、原子 reservation、短事务 settlement、append-only ledger、价格版本、
  单位政策、分页统计和恢复。
- migration checksum 对 LF/CRLF/lone CR 规范化，但任何非换行 SQL 变化仍 fail closed；v1—v6
  当前规范值保持不变。

## 4. ProjectDataRoot 缓存

- 在共享存储合同中增加唯一受控类别 `MODEL_RESULT_CACHE`，固定前缀
  `cache/model-results/`；ProjectDataRoot 打开时创建该布局。
- `packages/storage/src/model-result-cache-store.ts` 复用既有流式 hash、独占临时文件、sync、
  关闭和原子发布语义，保存有界、版本化、provider-neutral envelope。
- 读取验证路径、链接边界、字节数、内容 hash、format 和 runtime schema；缺失或损坏不返回。
- 清理采用 preview/confirm 两阶段、短期单次绑定 token、先 tombstone 后精确删除；GC 只处理
  EVICTED/CORRUPT/orphan，批次有界，不扫描受控目录以外路径。
- 默认单 payload、条目数与总配额在 ADR 中明确；cache payload 不进入日志、诊断、普通导出、
  package 或 Git。

## 5. ModelExecutionService、singleflight 与恢复

- 固定执行顺序为：校验 → identity/key → executionId → local cache → CapabilityGuard →
  lease/recheck → budget/reservation → run → late credential → 单次 Provider 调用 → provider-neutral
  验证 → immutable cache file → 短事务 finalize。
- `READ_WRITE`、`READ_ONLY`、`BYPASS`、`REFRESH` 行为分离。仅完整、验证通过、无 refusal、
  无 partial/truncated、无 side effect 的 text/structured/vision/image 结果可缓存。
- probe/search/tool/debug/streaming、error、cancel、refusal、partial、ambiguous 和 raw envelope
  永不缓存。
- 同 cache key 使用 SQLite lease、owner token、expiresAt、heartbeat 和 revision；waiter 有界。
  可证明发送前失败才回收；发送后失联保持 `AMBIGUOUS`，不自动 takeover/retry。
- executionId 是业务幂等键；重放不重复请求、reservation 或 ledger。服务不宣称 exactly-once。

## 6. 成本、预算与 Probe 集成

- 每次确定外部 execution 最多一个 settlement identity；ledger 追加式，unknown amount 为 NULL。
- Provider 合法报告 USD 优先；否则以执行时不可变用户价格版本精确估算；缺失组成部分保持
  partial/unpriced，不猜价格、不联网抓取、不按模型名推断。
- 预算聚合使用 UTC `YYYY-MM`，known ledger、ACTIVE/UNCERTAIN reservation、unknown calls
  和单位分别显示。80 美元等于即预警，100 美元等于即阻止新 NONESSENTIAL 外部请求。
- 发送前用 SQLite `BEGIN IMMEDIATE` 原子预留；pre-send 可释放，post-send uncertain 保留。
  cache hit 不解析凭据、不预留、不记 ledger，硬上限不阻止本地命中或其他本地功能。
- 无完整价格时必须命中适用的月/周/task/operation 单位政策，否则返回
  `BUDGET_UNPRICED_LIMIT_REQUIRED`。
- Capability Probe 每一步接入同一运行/预算内核，固定 `BYPASS` 与 `NONESSENTIAL`，保持一次、
  串行、无重试、无 fallback；能力证据合同不变。

## 7. IPC、UI 与 egress

- `packages/shared/src/desktop-api.ts` 增加只读成本摘要、最近 runs、价格版本、单位政策、
  cache clear preview/confirm 的有限 DTO 和固定 channel。
- `apps/desktop` 只在 main 持有数据库、缓存 store、token broker 与 accounting runtime；
  每方法 exact-object、senderFrame/window、大小与 expected revision 校验。
- `apps/web-ui` 激活任务中心的成本与缓存区域，显示 UTC 月、reported/estimated/unknown、
  reservation、80/100 状态、单位用量、本地 cache 与 Provider Prompt Cache 区分、最近运行、
  价格版本、单位政策及两阶段清理状态。
- renderer/preload 不接收 credential、prompt、input/output、raw response、cache payload、
  absolute path 或 reservation/lease token。
- 建立至少 60 项 egress/accounting matrix，覆盖 SQLite/WAL/SHM、文件、日志、audit、诊断、
  导出、备份、temp、package、Git、DTO、IPC error、smoke、snapshot 与 CI 输出。

## 8. 测试与交付

- 新增 `npm run test:model-accounting`，覆盖合同、canonicalization、cache key/storage/policy、
  singleflight/recovery、状态机、money、价格/账本、reservation、单位政策、Probe、IPC/UI、
  portability、egress 与 Electron smoke。
- 重点并发证据：20 路相同 key 只有一次 loopback 请求；20 路不同 key 受全局并发和预算；
  并发 reservation 不越硬上限；Provider 调用期间无 SQLite 长事务。
- migration 证据覆盖新库直达 v7、v6→v7、备份可打开、失败回滚、外键/quick check、换行
  规范化、中文/空格/emoji/长路径和数据保留。
- 完成后从最新 `npm ci` 开始按 Issue 指令顺序运行 21 道门禁及 CI 的全部额外门禁；任何修复
  后从 `npm ci` 重跑。
- 最终检查 `git diff --check`、secret/绝对路径/范围/进程/端口/temp，创建且只创建一个本地
  提交 `feat(models): add execution cache and cost ledger`；不 push、不建 PR、不进入 Issue 015。

## 9. 实施回填

- 实际实现集中在 `packages/workflows/src/model-execution/`、SQLite migration v7 与
  `model-accounting-repository.ts`、受控 `model-result-cache-store.ts`、桌面 accounting runtime/
  strict IPC/preload 和任务中心 UI。
- 与计划相比，进程内 promise singleflight 已用于当前单进程桌面运行；SQLite 另持久化
  owner lease/heartbeat/revision，供未来多 worker 队列接入。Issue 013 probe 每步直接使用
  同一 SQLite 预算/运行内核并固定 BYPASS；未实现 Issue 015 SearchProvider。
- 金额只用十进制字符串、`bigint` 和整数 micro-USD；migration v7 的实际规范化 checksum
  在最终报告记录，但不作为未来起点。
- `docs/m2-issue014-egress-matrix.md` 完成 60/60 项；验收映射完成 240/240 项。
- `npm run test:model-accounting` 已建立并加入 Windows CI；最终 21 道门禁、额外 CI 门禁、
  smoke、打包、审计和测试总计数在最终报告记录。
- Git 只创建一个 Issue 014 本地提交，不 push、不建 PR，并在提交后停止。
