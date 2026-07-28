# M2 Issue 013 验收映射

本表固定包含 210 条独立验收项。`实现/证据`列在代码完成后指向稳定组件或专用测试；任何单行失败都意味着 Issue 013 未完成。

| ID       | 独立验收项                                                                              | 实现/证据                   |
| -------- | --------------------------------------------------------------------------------------- | --------------------------- |
| I013-001 | 只实现 Issue 013，不进入 Issue 014。                                                    | Git diff 与提交范围         |
| I013-002 | 开工基线从任务开始时的本地 HEAD 动态确认。                                              | 交付记录                    |
| I013-003 | Issue 013 指令文件位于仓库根目录并纳入提交。                                            | 根目录 TXT                  |
| I013-004 | 不因盘符、绝对路径、HEAD、文件哈希或换行差异停止。                                      | portability 测试            |
| I013-005 | 不读取真实密钥。                                                                        | secret-egress 测试          |
| I013-006 | 不调用真实外部 API 或模型。                                                             | loopback fixture            |
| I013-007 | 不产生模型、搜索、图片或 Batch 费用。                                                   | loopback fixture            |
| I013-008 | 测试凭据由运行时随机生成且不可用。                                                      | fixture 工厂                |
| I013-009 | 测试数据库与数据根目录完全隔离。                                                        | 测试支持代码                |
| I013-010 | 工作树中的既有用户修改不被覆盖、stash 或删除。                                          | Git 交付检查                |
| I013-011 | 能力集合包含 text。                                                                     | capability 合同测试         |
| I013-012 | 能力集合包含 structuredJson。                                                           | capability 合同测试         |
| I013-013 | 能力集合包含 toolCalling。                                                              | capability 合同测试         |
| I013-014 | 能力集合包含 webSearch。                                                                | capability 合同测试         |
| I013-015 | 能力集合包含 imageGeneration。                                                          | capability 合同测试         |
| I013-016 | 能力集合包含 vision。                                                                   | capability 合同测试         |
| I013-017 | 能力集合包含 usage。                                                                    | capability 合同测试         |
| I013-018 | 能力集合包含 batch。                                                                    | capability 合同测试         |
| I013-019 | 能力集合包含 streaming。                                                                | capability 合同测试         |
| I013-020 | maxContextTokens 缺失时保持 null。                                                      | metadata 测试               |
| I013-021 | 能力状态只允许 UNKNOWN、SUPPORTED、UNSUPPORTED。                                        | capability 合同测试         |
| I013-022 | 强正向语义证据才可判为 SUPPORTED。                                                      | classifier 测试             |
| I013-023 | 能力特有的明确拒绝才可判为 UNSUPPORTED。                                                | classifier 测试             |
| I013-024 | 网络不可达归类为 UNKNOWN。                                                              | classifier 测试             |
| I013-025 | TLS 失败归类为 UNKNOWN。                                                                | classifier 测试             |
| I013-026 | 超时归类为 UNKNOWN。                                                                    | classifier 测试             |
| I013-027 | 401 认证拒绝归类为 UNKNOWN。                                                            | classifier 测试             |
| I013-028 | 403 权限拒绝归类为 UNKNOWN。                                                            | classifier 测试             |
| I013-029 | 429 限流归类为 UNKNOWN。                                                                | classifier 测试             |
| I013-030 | 5xx 归类为 UNKNOWN。                                                                    | classifier 测试             |
| I013-031 | 通用 404 归类为 UNKNOWN。                                                               | classifier 测试             |
| I013-032 | 无效 content-type 归类为 UNKNOWN。                                                      | classifier 测试             |
| I013-033 | 无效 JSON 归类为 UNKNOWN。                                                              | classifier 测试             |
| I013-034 | schema mismatch 归类为 UNKNOWN。                                                        | classifier 测试             |
| I013-035 | 歧义结果归类为 UNKNOWN。                                                                | classifier 测试             |
| I013-036 | reason code 使用固定有限枚举。                                                          | capability 合同测试         |
| I013-037 | source 只允许 PROBED、METADATA、NOT_PROBED。                                            | capability 合同测试         |
| I013-038 | confidence 只允许 CONFIRMED、INCONCLUSIVE。                                             | capability 合同测试         |
| I013-039 | 未实际探测条目的 observedAt 必须为 null。                                               | repository 测试             |
| I013-040 | safe details 不含原始响应、URL、prompt 或密钥。                                         | egress 测试                 |
| I013-041 | 指纹包含固定协议。                                                                      | fingerprint 测试            |
| I013-042 | 指纹包含规范化 Base URL。                                                               | fingerprint 测试            |
| I013-043 | 指纹包含按槽位排序的模型映射。                                                          | fingerprint 测试            |
| I013-044 | 指纹包含能力合同版本。                                                                  | fingerprint 测试            |
| I013-045 | 指纹不包含凭据。                                                                        | fingerprint 测试            |
| I013-046 | 指纹不包含文件路径。                                                                    | fingerprint 测试            |
| I013-047 | 指纹输出为稳定 SHA-256。                                                                | fingerprint 测试            |
| I013-048 | Base URL 等价尾斜杠得到相同规范化结果。                                                 | fingerprint 测试            |
| I013-049 | 模型映射变化使指纹变化。                                                                | stale 测试                  |
| I013-050 | 协议或合同版本变化使指纹变化。                                                          | stale 测试                  |
| I013-051 | credentialBindingVersion 是非秘密单调整数。                                             | settings/db 测试            |
| I013-052 | 首次设置凭据递增 binding version。                                                      | settings/db 测试            |
| I013-053 | 替换凭据递增 binding version。                                                          | settings/db 测试            |
| I013-054 | 清除凭据递增 binding version。                                                          | settings/db 测试            |
| I013-055 | binding version 不进入 renderer 的可编辑输入。                                          | IPC 测试                    |
| I013-056 | 旧 binding version 的条目变为 stale。                                                   | stale 测试                  |
| I013-057 | Base URL 变化使旧条目 stale。                                                           | stale 测试                  |
| I013-058 | 模型 ID 变化使受影响结果 stale。                                                        | stale 测试                  |
| I013-059 | 只有无关设置 revision 变化时不使结果 stale。                                            | stale 测试                  |
| I013-060 | 恢复相同指纹仍需匹配 credential binding。                                               | stale 测试                  |
| I013-061 | migration v6 名为 provider_capability_probing。                                         | db migration 测试           |
| I013-062 | v1–v5 SQL 与校验和保持不变。                                                            | db migration 测试           |
| I013-063 | v6 连续追加且不重排旧 migration。                                                       | db migration 测试           |
| I013-064 | v6 创建 STRICT probe runs 表。                                                          | db migration 测试           |
| I013-065 | v6 创建 STRICT capability entries 表。                                                  | db migration 测试           |
| I013-066 | runs 状态有 CHECK 约束。                                                                | db hard-constraint 测试     |
| I013-067 | entries 能力有 CHECK 约束。                                                             | db hard-constraint 测试     |
| I013-068 | entries 三态有 CHECK 约束。                                                             | db hard-constraint 测试     |
| I013-069 | entries 通过外键关联 run。                                                              | db migration 测试           |
| I013-070 | 每个 run/slot/mode/capability 唯一。                                                    | db hard-constraint 测试     |
| I013-071 | v6 迁移前创建数据库备份。                                                               | db recovery 测试            |
| I013-072 | v6 失败时整批回滚。                                                                     | db recovery 测试            |
| I013-073 | v6 后 quick_check 通过。                                                                | db migration 测试           |
| I013-074 | v6 后 foreign_key_check 通过。                                                          | db migration 测试           |
| I013-075 | model_runs 表不被修改。                                                                 | db hard-constraint 测试     |
| I013-076 | cost_ledger 表不被修改。                                                                | db hard-constraint 测试     |
| I013-077 | 启动时遗留 RUNNING 变为 INTERRUPTED。                                                   | recovery 测试               |
| I013-078 | INTERRUPTED 运行不自动恢复。                                                            | recovery 测试               |
| I013-079 | partial 运行只保留历史。                                                                | repository 测试             |
| I013-080 | 最新当前 SUCCEEDED 运行才替换矩阵。                                                     | repository 测试             |
| I013-081 | ProbePlan 是深冻结的不可变值。                                                          | planner 测试                |
| I013-082 | profile 只允许 CORE、FULL、CUSTOM。                                                     | planner 测试                |
| I013-083 | 任一计划最多 32 个外部请求。                                                            | planner 测试                |
| I013-084 | runner 并发度固定为 1。                                                                 | runner 测试                 |
| I013-085 | 每个逻辑步骤只发送一次。                                                                | runner 测试                 |
| I013-086 | 探测不执行自动 retry。                                                                  | runner 测试                 |
| I013-087 | 探测不执行 repair。                                                                     | runner 测试                 |
| I013-088 | 探测不执行协议 fallback。                                                               | runner 测试                 |
| I013-089 | 相同 modelId 的网络请求被去重。                                                         | planner/fixture 测试        |
| I013-090 | 去重结果映射回全部模型槽位。                                                            | runner 测试                 |
| I013-091 | CORE 包含 metadata。                                                                    | planner 测试                |
| I013-092 | CORE 包含 Responses text。                                                              | planner 测试                |
| I013-093 | CORE 包含 Chat Completions text。                                                       | planner 测试                |
| I013-094 | CORE 包含 structured JSON。                                                             | planner 测试                |
| I013-095 | CORE 伴随观察 usage。                                                                   | runner 测试                 |
| I013-096 | CORE 包含 vision。                                                                      | planner 测试                |
| I013-097 | CORE 默认不包含 tool calling。                                                          | planner 测试                |
| I013-098 | CORE 显式 opt-in 后包含 tool calling。                                                  | planner 测试                |
| I013-099 | CORE 不包含 web search。                                                                | planner 测试                |
| I013-100 | CORE 不包含 image generation 或 Batch。                                                 | planner 测试                |
| I013-101 | FULL 包含 tool calling。                                                                | planner 测试                |
| I013-102 | FULL 包含 web search。                                                                  | planner 测试                |
| I013-103 | FULL 包含 image generation。                                                            | planner 测试                |
| I013-104 | FULL 包含 Batch metadata。                                                              | planner 测试                |
| I013-105 | FULL 包含 streaming。                                                                   | planner 测试                |
| I013-106 | CUSTOM 至少选择一个能力。                                                               | planner 测试                |
| I013-107 | CUSTOM 只接受有限能力枚举。                                                             | IPC/planner 测试            |
| I013-108 | renderer 不能提交任意 prompt。                                                          | IPC 测试                    |
| I013-109 | renderer 不能提交任意 endpoint 或 header。                                              | IPC 测试                    |
| I013-110 | renderer 不能提交任意 request body。                                                    | IPC 测试                    |
| I013-111 | preview 时 main 从当前设置重建计划。                                                    | runtime 测试                |
| I013-112 | preview token 使用 CSPRNG。                                                             | token broker 测试           |
| I013-113 | preview token 仅保存在内存。                                                            | architecture 测试           |
| I013-114 | preview token 最长有效五分钟。                                                          | token broker 测试           |
| I013-115 | preview token 只能使用一次。                                                            | token broker 测试           |
| I013-116 | token 绑定 sender webContents。                                                         | token broker 测试           |
| I013-117 | token 绑定窗口。                                                                        | token broker 测试           |
| I013-118 | token 绑定 plan hash。                                                                  | token broker 测试           |
| I013-119 | token 绑定 settings revision。                                                          | token broker 测试           |
| I013-120 | token 绑定 credential binding version。                                                 | token broker 测试           |
| I013-121 | start 前 main 再次重建计划并比较。                                                      | runtime 测试                |
| I013-122 | 配置变化会使未使用 token 失效。                                                         | runtime 测试                |
| I013-123 | 窗口关闭会使该窗口 token 失效。                                                         | runtime 测试                |
| I013-124 | shutdown 会清空 token。                                                                 | runtime 测试                |
| I013-125 | cancel 会使关联 token 或运行失效。                                                      | runtime 测试                |
| I013-126 | 用户确认复选框默认未勾选。                                                              | renderer 测试               |
| I013-127 | start 必须携带固定确认常量。                                                            | IPC/runtime 测试            |
| I013-128 | 凭据只在全部 token/plan 校验后解析。                                                    | runtime 测试                |
| I013-129 | 凭据解析失败不发送请求。                                                                | runtime 测试                |
| I013-130 | preview 本身不发送网络请求。                                                            | runtime 测试                |
| I013-131 | 全应用同时最多一个真实探测 run。                                                        | concurrency 测试            |
| I013-132 | runner 严格串行执行计划步骤。                                                           | runner 测试                 |
| I013-133 | 每步有有限 timeout。                                                                    | runner 测试                 |
| I013-134 | 整个 run 有有限 deadline。                                                              | runner 测试                 |
| I013-135 | cancel abort 当前请求。                                                                 | cancel 测试                 |
| I013-136 | cancel 阻止剩余步骤发送。                                                               | cancel 测试                 |
| I013-137 | shutdown abort 当前请求。                                                               | runtime 测试                |
| I013-138 | 配置在发送前 stale 时全局停止。                                                         | runner 测试                 |
| I013-139 | 401/403 触发全局停止。                                                                  | runner 测试                 |
| I013-140 | 429 触发全局停止。                                                                      | runner 测试                 |
| I013-141 | 连续三次网络或 5xx 触发全局停止。                                                       | runner 测试                 |
| I013-142 | 请求计数不匹配触发安全失败。                                                            | runner 测试                 |
| I013-143 | 启动应用不自动探测。                                                                    | smoke 测试                  |
| I013-144 | 保存设置不自动探测。                                                                    | settings/runtime 测试       |
| I013-145 | migration 不自动探测。                                                                  | db/egress 测试              |
| I013-146 | timer 不自动探测。                                                                      | architecture 测试           |
| I013-147 | queue 不自动探测。                                                                      | architecture 测试           |
| I013-148 | 崩溃恢复不重放探测请求。                                                                | recovery 测试               |
| I013-149 | 运行进度只包含安全计数和状态。                                                          | IPC/egress 测试             |
| I013-150 | audit/diagnostic 不包含原始请求或响应。                                                 | diagnostic 测试             |
| I013-151 | 端点 allowlist 包含 `/models`。                                                         | transport 测试              |
| I013-152 | 模型 metadata path segment 严格 percent-encode。                                        | transport 测试              |
| I013-153 | 端点 allowlist 包含 `/responses`。                                                      | transport 测试              |
| I013-154 | 端点 allowlist 包含 `/chat/completions`。                                               | transport 测试              |
| I013-155 | 端点 allowlist 包含 `/images/generations`。                                             | transport 测试              |
| I013-156 | 端点 allowlist 包含 `/batches` metadata。                                               | transport 测试              |
| I013-157 | Base URL 的已有 path 被保留。                                                           | transport 测试              |
| I013-158 | 仅允许 HTTPS 或 loopback HTTP。                                                         | transport 测试              |
| I013-159 | URL 用户信息、query 与 fragment 被拒绝。                                                | transport 测试              |
| I013-160 | redirect 被视为错误且不跟随。                                                           | transport 测试              |
| I013-161 | fetch 使用 credentials omit。                                                           | transport 测试              |
| I013-162 | transport 不发送 cookie。                                                               | transport 测试              |
| I013-163 | Authorization 只由 main 最终 transport 注入。                                           | architecture/transport 测试 |
| I013-164 | metadata 只用 GET/OPTIONS/HEAD。                                                        | transport 测试              |
| I013-165 | Batch 不创建任务。                                                                      | Batch transport 测试        |
| I013-166 | Batch 不列举任务。                                                                      | Batch transport 测试        |
| I013-167 | Batch 不上传文件。                                                                      | Batch transport 测试        |
| I013-168 | Batch 不读取任务或结果。                                                                | Batch transport 测试        |
| I013-169 | Batch 不取消任务。                                                                      | Batch transport 测试        |
| I013-170 | Batch 2xx 无语义证据仍为 UNKNOWN。                                                      | classifier 测试             |
| I013-171 | Responses text 使用固定 marker 且 store=false。                                         | fixture/transport 测试      |
| I013-172 | Chat text 使用固定 marker。                                                             | fixture/transport 测试      |
| I013-173 | structured probe 使用固定微型 strict schema。                                           | fixture/codec 测试          |
| I013-174 | structured 输出通过运行时 schema validator。                                            | codec 测试                  |
| I013-175 | tool probe 只声明固定合成函数。                                                         | fixture/codec 测试          |
| I013-176 | tool call 参数被解析并验证。                                                            | codec 测试                  |
| I013-177 | tool 函数永不执行。                                                                     | runner 测试                 |
| I013-178 | tool result 永不发送第二次。                                                            | fixture 请求计数测试        |
| I013-179 | web search 仅在 FULL/CUSTOM 中允许。                                                    | planner 测试                |
| I013-180 | web search 支持需同时有 tool event 和 citation。                                        | codec 测试                  |
| I013-181 | web search 只持久化计数，不保存 URL 或文本。                                            | repository/egress 测试      |
| I013-182 | vision 使用运行时内存微型合成图片。                                                     | payload 测试                |
| I013-183 | vision 图片不写入文件。                                                                 | filesystem 测试             |
| I013-184 | vision 没有 marker 时为 VISION_INCONCLUSIVE。                                           | classifier 测试             |
| I013-185 | image 请求 count 固定为 1。                                                             | payload 测试                |
| I013-186 | image 使用最低质量/尺寸提示。                                                           | payload 测试                |
| I013-187 | image 只接受有效 inline bytes。                                                         | codec 测试                  |
| I013-188 | URL-only image 不下载且保持 UNKNOWN。                                                   | fixture/codec 测试          |
| I013-189 | usage 只伴随已有请求观察。                                                              | planner/runner 测试         |
| I013-190 | usage 缺失时不增加额外请求。                                                            | fixture 请求计数测试        |
| I013-191 | context/rate metadata 不做压力测试。                                                    | planner 测试                |
| I013-192 | rate metadata 只读取 allowlisted headers。                                              | transport 测试              |
| I013-193 | CapabilityGuard 只允许当前非 stale SUPPORTED。                                          | guard 测试                  |
| I013-194 | guard 对 UNKNOWN 返回稳定错误。                                                         | guard 测试                  |
| I013-195 | guard 对 UNSUPPORTED 返回稳定错误。                                                     | guard 测试                  |
| I013-196 | guard 对 STALE 返回稳定错误。                                                           | guard 测试                  |
| I013-197 | guard 不自动探测、重试或切换模型/协议。                                                 | guard 测试                  |
| I013-198 | preload 只暴露五个固定 capability 方法。                                                | desktop contract 测试       |
| I013-199 | IPC 对 sender、窗口和 DTO 做精确校验。                                                  | IPC 测试                    |
| I013-200 | IPC 不允许 renderer 传 URL、模型、凭据或 prompt。                                       | IPC secret-egress 测试      |
| I013-201 | 设置页显示按槽位/model ID/模式的能力矩阵。                                              | renderer 测试               |
| I013-202 | 设置页显示 profile、请求数和费用未知风险。                                              | renderer 测试               |
| I013-203 | 设置页支持开始、进度、取消和历史终态。                                                  | renderer 测试               |
| I013-204 | 派生 UI 状态覆盖 NOT_PROBED/PROBE_COMPLETE/PARTIAL/STALE/FAILED/CANCELLED/INTERRUPTED。 | renderer/state 测试         |
| I013-205 | 新增 `test:capabilities` 并纳入 Windows CI。                                            | package/CI                  |
| I013-206 | 新增 `test:portability` 并纳入 Windows CI。                                             | package/CI                  |
| I013-207 | source smoke 显式触发 loopback 探测且启动自动请求数为 0。                               | electron smoke              |
| I013-208 | packaged smoke 使用 loopback、合成凭据且外部请求数为 0。                                | packaged smoke              |
| I013-209 | 全部门禁通过且无 skip、todo、残留 listener 或进程。                                     | 最终门禁记录                |
| I013-210 | 只创建指定信息的单一本地提交且不 push/PR。                                              | Git 交付检查                |
