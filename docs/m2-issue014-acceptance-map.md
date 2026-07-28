# M2 Issue 014 验收映射

状态：已完成，240/240。以下每项均独立映射到真实代码、测试、文档或最终命令证据；
不以预填 PASS 或“同上”代替证据。

|   # | 验收点                                                | 实际证据                     |
| --: | ----------------------------------------------------- | ---------------------------- |
|   1 | 动态发现仓库根                                        | Git 交付检查                 |
|   2 | 无硬编码盘符、用户名或旧路径                          | portability/architecture     |
|   3 | BASELINE_HEAD 仅动态记录                              | 实施计划、Git 检查           |
|   4 | 不比较预置 commit                                     | Git/architecture             |
|   5 | instruction SHA 不作门禁                              | implementation plan          |
|   6 | migration 实际 hash 不作未来门禁                      | migration docs/tests         |
|   7 | 允许 main 合法领先远端                                | Git 检查                     |
|   8 | 起点仅有本指令未跟踪                                  | 开工 status                  |
|   9 | Issue 013 文档完整                                    | repository documentation     |
|  10 | Issue 013 matrix/runner/guard 完整                    | capability regression        |
|  11 | schema 起点为 v6                                      | migration test               |
|  12 | 起点无已完成 Issue 014                                | source/schema inspection     |
|  13 | 起点无 Issue 015 业务                                 | forbidden-scope              |
|  14 | 全部旧门禁开工前通过                                  | baseline command record      |
|  15 | portable development 规则保持                         | AGENTS/portability           |
|  16 | temp 从项目卷动态派生                                 | portable-temp tests          |
|  17 | npm cache 不固定系统盘                                | scripts/CI tests             |
|  18 | packager temp 不固定盘符                              | package script tests         |
|  19 | 系统盘不足但项目卷可用可继续                          | portability                  |
|  20 | 项目卷不足安全停止                                    | portability                  |
|  21 | 不执行全局清理                                        | source scan                  |
|  22 | 只清理精确本轮 temp                                   | scripts tests                |
|  23 | temp 不进入 Git                                       | gitignore/egress             |
|  24 | 中文空格 emoji 长路径                                 | portability/storage tests    |
|  25 | 新文件无机器绝对路径                                  | architecture scan            |
|  26 | 只实现 Issue 014                                      | diff review                  |
|  27 | 不实现 SearchProvider                                 | forbidden-scope              |
|  28 | 不实现网页抓取                                        | forbidden-scope              |
|  29 | 不实现插件业务                                        | clipper architecture         |
|  30 | 不读取真实 credential                                 | egress/smoke                 |
|  31 | 不连接真实中转站                                      | loopback network evidence    |
|  32 | 不调用真实模型/search/image/Batch                     | mock/loopback evidence       |
|  33 | 真实费用为 0                                          | test evidence                |
|  34 | ai_disclosure 固定 false                              | constraints                  |
|  35 | copyright 不参与决策                                  | constraints                  |
|  36 | AI/copyright 不进入 cache key                         | cache-key tests              |
|  37 | 无小红书自动动作                                      | forbidden-scope              |
|  38 | 无云必需依赖                                          | dependency architecture      |
|  39 | 无开卷/盗版/内部数据                                  | constraints                  |
|  40 | 不打开正式 ProjectDataRoot                            | smoke/runtime tests          |
|  41 | 本地结果缓存定义明确                                  | model-execution contract/ADR |
|  42 | Provider Prompt Cache 定义明确                        | accounting contract/ADR      |
|  43 | 两种缓存字段与指标分离                                | usage/UI tests               |
|  44 | local hit 外部请求数为 0                              | service tests                |
|  45 | provider cached tokens 不标 local hit                 | usage tests                  |
|  46 | request runtime 校验                                  | contract tests               |
|  47 | result 终态有限                                       | contract/state tests         |
|  48 | executionId 稳定幂等                                  | service/repository tests     |
|  49 | 调用方不能伪造 cost/usage/hit                         | validator tests              |
|  50 | 调用方不能自报 essential                              | contract/budget tests        |
|  51 | DTO 大小深度数组有界                                  | validator/IPC tests          |
|  52 | 不允许任意 endpoint/header/credential                 | contract architecture        |
|  53 | absolute path 不进入 identity                         | cache-key tests              |
|  54 | Git HEAD 不进入 identity                              | cache-key tests              |
|  55 | Provider 合同版本显式                                 | contract/cache-key           |
|  56 | cache key version 显式                                | cache-key tests              |
|  57 | taskKind 进入 key                                     | cache-key table tests        |
|  58 | model role/slot 进入 key                              | cache-key table tests        |
|  59 | config fingerprint 进入 key                           | cache-key table tests        |
|  60 | model ID 进入 key                                     | cache-key table tests        |
|  61 | protocol mode 进入 key                                | cache-key table tests        |
|  62 | prompt template ID 进入 key                           | cache-key table tests        |
|  63 | prompt version 进入 key                               | cache-key table tests        |
|  64 | prompt content hash 进入 key                          | cache-key table tests        |
|  65 | exact input hash 进入 key                             | cache-key table tests        |
|  66 | parameter version/options 进入 key                    | cache-key table tests        |
|  67 | schema identity 进入 key                              | cache-key table tests        |
|  68 | source hashes 进入 key                                | cache-key table tests        |
|  69 | media hashes 进入 key                                 | cache-key table tests        |
|  70 | execution/job/request ID 不进入 key                   | exclusion tests              |
|  71 | time/retry/trace 不进入 key                           | exclusion tests              |
|  72 | path/username/HEAD 不进入 key                         | exclusion tests              |
|  73 | credential 不进入 key                                 | exclusion tests              |
|  74 | AI/copyright 不进入 key                               | exclusion tests              |
|  75 | 每种语义变化都有 miss                                 | cache invalidation table     |
|  76 | object key 确定排序                                   | canonical tests              |
|  77 | array 顺序保持                                        | canonical tests              |
|  78 | null/empty/missing/0/false 区分                       | canonical tests              |
|  79 | undefined 显式处理                                    | canonical tests              |
|  80 | 拒绝 NaN/Infinity                                     | canonical tests              |
|  81 | 拒绝循环和不支持对象                                  | canonical tests              |
|  82 | 拒绝 prototype 污染键                                 | canonical tests              |
|  83 | UTF-8 编码确定                                        | canonical tests              |
|  84 | 不 trim 正文                                          | canonical tests              |
|  85 | 不 Unicode normalize 正文                             | canonical tests              |
|  86 | CRLF/CR/LF 正文可区分                                 | canonical tests              |
|  87 | canonicalization 版本化                               | contract/tests               |
|  88 | hash 来自 runtime canonical bytes                     | cache-key tests              |
|  89 | 内容 hash 不作跨电脑门禁                              | docs/architecture            |
|  90 | property/table 覆盖碰撞边界                           | canonical tests              |
|  91 | READ_WRITE 实现                                       | cache-policy tests           |
|  92 | READ_ONLY 实现                                        | cache-policy tests           |
|  93 | BYPASS 实现                                           | cache-policy tests           |
|  94 | REFRESH 实现                                          | cache-policy tests           |
|  95 | text 成功可缓存                                       | service tests                |
|  96 | structured schema-valid 可缓存                        | service tests                |
|  97 | vision 成功可缓存                                     | service tests                |
|  98 | image inline 有效可缓存                               | service tests                |
|  99 | refusal 不缓存                                        | eligibility tests            |
| 100 | error 不缓存                                          | eligibility tests            |
| 101 | cancelled 不缓存                                      | eligibility tests            |
| 102 | partial/truncated 不缓存                              | eligibility tests            |
| 103 | ambiguous 不缓存                                      | eligibility tests            |
| 104 | probe 固定 BYPASS                                     | probe accounting tests       |
| 105 | search/tool 固定 BYPASS                               | contract tests               |
| 106 | raw Provider envelope 不缓存                          | egress tests                 |
| 107 | cache hit 不读 credential                             | service tests                |
| 108 | cache hit 不做 reservation                            | service tests                |
| 109 | cache hit 不写 ledger                                 | service tests                |
| 110 | cache hit 仍创建有限 run                              | repository/service tests     |
| 111 | cache 文件位于受控目录                                | storage tests                |
| 112 | SQLite 只存 ManagedRelativePath                       | schema/storage tests         |
| 113 | 拒绝 absolute/UNC/device/drive/file URL               | path tests                   |
| 114 | 拒绝 traversal/link/junction                          | path tests                   |
| 115 | 内容寻址和流式 hash                                   | storage tests                |
| 116 | temp/sync/close/atomic publish                        | storage fault tests          |
| 117 | 单文件与总配额有限                                    | quota tests/ADR              |
| 118 | 读取校验 hash/bytes/version/schema                    | cache-store tests            |
| 119 | 缺失损坏标 CORRUPT 不返回                             | recovery tests               |
| 120 | payload 不进日志诊断导出package/Git                   | egress matrix                |
| 121 | clear preview 仅 count/bytes                          | IPC/cache tests              |
| 122 | confirm token 短期单次绑定                            | token/IPC tests              |
| 123 | tombstone 后精确删除无引用文件                        | clear tests                  |
| 124 | 删除失败留可检测 orphan                               | fault tests                  |
| 125 | 清理不删业务数据/账本/DB                              | clear isolation tests        |
| 126 | GC 有界可取消无启动扫描                               | GC tests/architecture        |
| 127 | 不宣称断电无 orphan                                   | ADR/docs                     |
| 128 | 共享内容寻址文件不误删                                | reference tests              |
| 129 | cache 中文空格 emoji 长路径                           | portability tests            |
| 130 | cache 文件无用户可识别名                              | storage tests                |
| 131 | cache 状态有限                                        | schema/contracts             |
| 132 | lease owner/expiry/heartbeat/revision                 | schema/repository tests      |
| 133 | lease 原子 acquire                                    | concurrency tests            |
| 134 | Provider 调用期间不持事务                             | service tests                |
| 135 | waiter 有界                                           | singleflight tests           |
| 136 | owner 活跃时 waiter 不二次发送                        | singleflight tests           |
| 137 | 20 路同 key 仅一次 loopback                           | concurrency test             |
| 138 | 仅 pre-send crash 可回收                              | recovery tests               |
| 139 | post-send 失联为 AMBIGUOUS                            | recovery tests               |
| 140 | AMBIGUOUS 不 retry/takeover                           | recovery tests               |
| 141 | 相同 executionId 返回已有 run                         | idempotency tests            |
| 142 | executionId/key 冲突 fail closed                      | idempotency tests            |
| 143 | replay 不重复 ledger                                  | idempotency tests            |
| 144 | replay 不重复 reservation                             | idempotency tests            |
| 145 | 不宣称 exactly-once                                   | ADR/contracts                |
| 146 | request 校验先于 hash                                 | ordering tests               |
| 147 | executionId 检查先于外部动作                          | ordering tests               |
| 148 | cache lookup 先于 capability/budget                   | ordering tests               |
| 149 | miss 后执行 CapabilityGuard                           | ordering tests               |
| 150 | lease 后再次查 READY                                  | concurrency tests            |
| 151 | budget/reservation 在 send 前                         | ordering tests               |
| 152 | credential 仅 main 最后解析                           | runtime/service tests        |
| 153 | Provider 调用事务外且最多一次                         | service tests                |
| 154 | provider-neutral result runtime 验证                  | result validator tests       |
| 155 | cache file 先发布后 DB finalize                       | fault tests                  |
| 156 | run/cache/ledger/reservation 短事务结算               | repository tests             |
| 157 | execution_id 唯一                                     | schema tests                 |
| 158 | 状态转换有限且 CAS revision                           | state tests                  |
| 159 | local_cache_hit 严格布尔                              | schema/tests                 |
| 160 | usage 可空且不补 0                                    | usage tests                  |
| 161 | external_request_count 准确                           | service tests                |
| 162 | invalid result 仍记 usage/cost                        | failure tests                |
| 163 | model_runs 无正文/secret/envelope                     | egress tests                 |
| 164 | 旧 IN_FLIGHT 不自动重发                               | recovery tests               |
| 165 | run 查询索引与分页                                    | query-plan tests             |
| 166 | UsageObservation 字段有限                             | contract tests               |
| 167 | cached/cache-write/reasoning 独立                     | usage tests                  |
| 168 | 缺失 usage 保持 NULL                                  | repository tests             |
| 169 | 不自行估算 token                                      | accounting tests             |
| 170 | 不假设 total=input+output                             | usage tests                  |
| 171 | cached input 不重复计费                               | price tests                  |
| 172 | Prompt Cache 不计本地命中                             | metrics/UI tests             |
| 173 | DecimalMoney 严格拒绝非法形式                         | money tests                  |
| 174 | 金额为 micro-USD/精确十进制                           | money/schema tests           |
| 175 | 新金额字段无 SQLite REAL                              | schema constraints           |
| 176 | 金额决策无 JS 浮点                                    | architecture/money tests     |
| 177 | 估算向上取整 micro-USD                                | money tests                  |
| 178 | 8000/10000 cents 精确换算                             | money tests                  |
| 179 | 非 USD 不换汇                                         | cost observation tests       |
| 180 | 金额边界与溢出完整                                    | money tests                  |
| 181 | 价格按 provider/model/operation/version               | price repository tests       |
| 182 | 价格币种仅 USD                                        | schema/validator             |
| 183 | token 各费率独立                                      | pricing tests                |
| 184 | image/search/tool/call 费率可配                       | pricing tests                |
| 185 | usage semantics 显式                                  | contracts/schema             |
| 186 | 不硬编码官方价格                                      | source scan                  |
| 187 | 不联网抓取价格                                        | architecture/network tests   |
| 188 | 不按模型名猜价格                                      | pricing tests                |
| 189 | 编辑创建新版本                                        | price repository tests       |
| 190 | 历史 ledger 固定旧版本                                | price/ledger tests           |
| 191 | Provider USD 强证据校验                               | observation tests            |
| 192 | 自然语言金额不作 cost                                 | observation tests            |
| 193 | PROVIDER_REPORTED_USD 正确                            | accounting tests             |
| 194 | USER_PRICE_TABLE_ESTIMATE 正确                        | accounting tests             |
| 195 | UNPRICED_USAGE amount NULL                            | accounting/schema tests      |
| 196 | UNKNOWN_POSSIBLY_INCURRED amount NULL                 | failure/ledger tests         |
| 197 | local hit/pre-send failure 无 ledger                  | service tests                |
| 198 | cost_ledger append-only                               | schema/repository tests      |
| 199 | settlement identity 唯一幂等                          | schema/ledger tests          |
| 200 | provider amount/comparison 不重复聚合                 | summary tests                |
| 201 | billing month 为 UTC YYYY-MM                          | clock tests                  |
| 202 | known committed >=80 预警                             | boundary tests               |
| 203 | 100 阻止新 NONESSENTIAL                               | budget tests                 |
| 204 | 79.999/80/99.999/100 边界                             | budget tests                 |
| 205 | 并发 reservation 原子不越限                           | concurrency tests            |
| 206 | reservation 用 conservative max                       | budget tests                 |
| 207 | actual settlement 释放差额                            | reservation tests            |
| 208 | actual 超 reserve 仍完整记录                          | reservation tests            |
| 209 | pre-send reservation 可释放                           | recovery tests               |
| 210 | post-send ambiguous 为 UNCERTAIN                      | recovery tests               |
| 211 | uncertain 重启不释放                                  | recovery tests               |
| 212 | 当前 Provider 调用均 NONESSENTIAL                     | contracts/tests              |
| 213 | 调用方不能选择 essential                              | validator tests              |
| 214 | hard limit 不阻止 cache hit                           | service tests                |
| 215 | hard limit 不阻止本地功能                             | UI/runtime tests             |
| 216 | 无价格不显示伪造美元                                  | UI/accounting tests          |
| 217 | 无价格无单位政策 pre-send block                       | budget tests                 |
| 218 | 月/周/task 调用次数政策                               | unit-policy tests            |
| 219 | image/search/tool 单位政策                            | unit-policy tests            |
| 220 | MAY_HAVE_EXECUTED 只计一次单位                        | idempotency tests            |
| 221 | probe 走统一运行/预算内核                             | integration tests            |
| 222 | probe cachePolicy 固定 BYPASS                         | integration tests            |
| 223 | probe budget 固定 NONESSENTIAL                        | integration tests            |
| 224 | probe 保持一次串行无重试                              | capability regression        |
| 225 | probe usage/cost/unknown 正确记录                     | integration tests            |
| 226 | probe 保守证据合同不变                                | capability regression        |
| 227 | 任务中心显示 UTC/known/unknown/reservation            | renderer tests               |
| 228 | UI 区分两种缓存                                       | renderer tests               |
| 229 | UI unknown 不显示 $0                                  | renderer tests               |
| 230 | UI 价格输入是十进制字符串                             | renderer tests               |
| 231 | UI 有 warning/hard/cache/ledger 状态                  | renderer tests               |
| 232 | clear UI 两阶段                                       | renderer/IPC tests           |
| 233 | IPC allowlist/exact/sender/revision                   | IPC tests                    |
| 234 | renderer/preload 无 secret/content/path               | egress tests                 |
| 235 | UI 无任意调用或预算绕过                               | architecture/renderer        |
| 236 | v7 备份回滚完整性数据保留                             | migration tests              |
| 237 | 60 项 egress/accounting 全有证据                      | egress matrix test/doc       |
| 238 | model-accounting/full/smoke/CI/audit 门禁             | final command record         |
| 239 | 失败/skip/todo/warning/vulnerability/network/fee 为 0 | final verification           |
| 240 | 只创建一个本地提交并停止                              | Git final check              |
