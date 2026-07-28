# M2 Issue 012 验收映射

状态：完成；190/190 项均已按独立编号核验。

|   # | 验收行为                                    | 计划/实际证据                                   |
| --: | ------------------------------------------- | ----------------------------------------------- |
| 001 | 原指令起点记录为 7bc921f                    | 实施计划与最终 Git 报告                         |
| 002 | main 与实际起点工作树事实记录               | Git 开工核验、用户基线覆盖指令                  |
| 003 | M0—Issue 011 祖先顺序正确                   | `git log`、`merge-base` 最终核验                |
| 004 | Issue 011 父提交与单提交事实核验            | Git log 与实施计划                              |
| 005 | 不改写历史提交                              | 最终 Git log/parent                             |
| 006 | v1 migration 内容/hash 不变                 | `tests/providers-architecture.test.ts`          |
| 007 | v2 migration 内容/hash 不变                 | `tests/providers-architecture.test.ts`          |
| 008 | v3 migration 内容/hash 不变                 | `tests/providers-architecture.test.ts`          |
| 009 | v4 migration 内容/hash 不变                 | `tests/providers-architecture.test.ts`          |
| 010 | v5 migration 内容/hash 不变                 | `tests/providers-architecture.test.ts`          |
| 011 | 不新增 migration v6                         | `tests/providers-architecture.test.ts`          |
| 012 | constraints 不削弱                          | `npm run test:constraints`                      |
| 013 | settings 不削弱                             | `npm run test:settings`                         |
| 014 | local API 不削弱                            | `npm run test:local-api`                        |
| 015 | 旧 Electron/package smoke 通过              | 开工证据与最终两项 smoke                        |
| 016 | 使用既有 packages/providers                 | 包源码与 `tests/providers-architecture.test.ts` |
| 017 | Provider 包不被 renderer import             | `tests/providers-architecture.test.ts`          |
| 018 | shared 不导出 credential/request binary     | `tests/providers-architecture.test.ts`          |
| 019 | 不新增 OpenAI SDK                           | package-lock 与架构测试                         |
| 020 | 不新增 Batch 依赖                           | package manifests 与架构测试                    |
| 021 | 不注册真实 JobHandler                       | `tests/providers-architecture.test.ts`          |
| 022 | app startup 不发 provider 请求              | source/package smoke、架构测试                  |
| 023 | 不新增 UI 调用入口                          | renderer 搜索与架构测试                         |
| 024 | 不新增 local API provider route             | local API 回归与架构测试                        |
| 025 | 不创建 model_runs/cost_ledger/jobs 数据     | `tests/providers-egress.test.ts`                |
| 026 | TextGenerationProvider 存在                 | `tests/providers-contracts.test.ts`             |
| 027 | StructuredGenerationProvider 存在           | `tests/providers-contracts.test.ts`             |
| 028 | VisionProvider 存在                         | `tests/providers-contracts.test.ts`             |
| 029 | ImageGenerationProvider 存在                | `tests/providers-contracts.test.ts`             |
| 030 | 四接口返回供应商无关结果                    | contracts 与四接口行为测试                      |
| 031 | 四接口支持 AbortSignal                      | contracts、mock 与 transport 测试               |
| 032 | 四接口具有总 deadline                       | context 校验与 retry 测试                       |
| 033 | requestId 必填且验证                        | `tests/providers-contracts.test.ts`             |
| 034 | providerId 必填且验证                       | `tests/providers-contracts.test.ts`             |
| 035 | modelId 无默认值                            | configuration/contracts 测试                    |
| 036 | operation 为有限枚举                        | `tests/providers-contracts.test.ts`             |
| 037 | generation options 严格范围                 | text/image 合同测试                             |
| 038 | input 数量/字符/字节有界                    | text/vision/image 测试                          |
| 039 | raw provider JSON 不进入 workflow           | codec 结果与 egress 测试                        |
| 040 | Search/Embedding/OCR/Batch/tool 未实现      | exports 与架构测试                              |
| 041 | Base URL 只来自 Issue 010 设置              | `tests/providers-configuration.test.ts`         |
| 042 | model ID 只来自 Issue 010 设置              | `tests/providers-configuration.test.ts`         |
| 043 | credential reference 固定                   | configuration 与 resolver 测试                  |
| 044 | renderer/job 不能覆盖 Base URL              | contracts 与架构测试                            |
| 045 | renderer/job 不能覆盖 credential reference  | contracts 与架构测试                            |
| 046 | runtime config deep-frozen                  | `tests/providers-configuration.test.ts`         |
| 047 | runtime config 携带 revision                | `tests/providers-configuration.test.ts`         |
| 048 | stale revision 可检测                       | `tests/providers-configuration.test.ts`         |
| 049 | configured-unverified 不伪装 verified       | config 类型与测试                               |
| 050 | 缺失 Base URL 稳定失败                      | `tests/providers-configuration.test.ts`         |
| 051 | 缺失 model ID 稳定失败                      | `tests/providers-configuration.test.ts`         |
| 052 | 不读取环境变量 credential                   | source scan 与 egress 测试                      |
| 053 | 不读取 .env                                 | source scan 与架构测试                          |
| 054 | 不调用真实 CredentialStore                  | fake resolver 计数与架构测试                    |
| 055 | 不硬编码模型/价格/速率/域名                 | source scan 与配置测试                          |
| 056 | CapabilityState 三态                        | `tests/providers-capabilities.test.ts`          |
| 057 | text capability 存在                        | capability shape 测试                           |
| 058 | structuredJson capability 存在              | capability shape 测试                           |
| 059 | toolCalling capability 存在                 | capability shape 测试                           |
| 060 | webSearch capability 存在                   | capability shape 测试                           |
| 061 | imageGeneration capability 存在             | capability shape 测试                           |
| 062 | vision capability 存在                      | capability shape 测试                           |
| 063 | batch capability 存在                       | capability shape 测试                           |
| 064 | usage capability 存在                       | capability shape 测试                           |
| 065 | streaming capability 存在                   | capability shape 测试                           |
| 066 | maxContextTokens 可空                       | capability shape 测试                           |
| 067 | 生产默认能力全部 UNKNOWN                    | unknown snapshot 测试                           |
| 068 | 不按 model 名推断能力                       | model table capability 测试                     |
| 069 | 不执行 capability probe                     | transport 调用计数与架构测试                    |
| 070 | UNKNOWN 不当作 SUPPORTED                    | capability guard 测试                           |
| 071 | RESPONSES mode 存在                         | protocol enum 测试                              |
| 072 | CHAT_COMPLETIONS mode 存在                  | protocol enum 测试                              |
| 073 | IMAGES_GENERATIONS mode 存在                | protocol enum 测试                              |
| 074 | MOCK mode 存在                              | protocol enum 测试                              |
| 075 | mode 不按模型名猜测                         | protocol mismatch table 测试                    |
| 076 | codecs 相互独立                             | 三 codec table 测试与架构测试                   |
| 077 | 404 不触发 endpoint fallback                | transport request-count 测试                    |
| 078 | 不自动遍历 endpoint                         | fake transport request-count 测试               |
| 079 | endpoint path 使用 allowlist                | `tests/providers-http-transport.test.ts`        |
| 080 | Base URL 合并保留 base path                 | URL table 测试                                  |
| 081 | userinfo/query/fragment 拒绝                | config/URL table 测试                           |
| 082 | redirect 被拒绝                             | loopback redirect 测试                          |
| 083 | 不允许任意 request path                     | endpoint contract 测试                          |
| 084 | Responses codec table 通过                  | `tests/providers-text.test.ts`                  |
| 085 | Chat codec table 通过                       | `tests/providers-text.test.ts`                  |
| 086 | Images codec table 通过                     | `tests/providers-image.test.ts`                 |
| 087 | message role 仅三种                         | `tests/providers-contracts.test.ts`             |
| 088 | 文本消息数量有界                            | `tests/providers-text.test.ts`                  |
| 089 | 单 part 与总字符有界                        | `tests/providers-text.test.ts`                  |
| 090 | 空白-only 输入拒绝                          | `tests/providers-text.test.ts`                  |
| 091 | 调用方不能注入 header/Auth                  | contract shape 与 architecture 测试             |
| 092 | finishReason 规范化                         | Responses/Chat decode table                     |
| 093 | refusal 结构化                              | text/structured refusal 测试                    |
| 094 | providerRequestId 可空且安全                | codec decode 测试                               |
| 095 | schema 有 id/version                        | `tests/providers-structured.test.ts`            |
| 096 | schema 使用 runtime validator               | validator 调用计数测试                          |
| 097 | strict object 生效                          | schema helper 行为测试                          |
| 098 | valid JSON+schema 返回 typed T              | structured 成功测试                             |
| 099 | invalid JSON 稳定错误                       | structured invalid JSON 测试                    |
| 100 | schema mismatch 稳定错误                    | structured mismatch 测试                        |
| 101 | validation error 不含业务值                 | egress 与 structured 测试                       |
| 102 | raw JSON 不进入错误                         | structured egress 测试                          |
| 103 | refusal 不误当 JSON 错误                    | structured refusal 测试                         |
| 104 | output size/depth/array/string 有界         | JSON limits table 测试                          |
| 105 | 不自动 JSON repair                          | transport request-count 测试                    |
| 106 | Vision 只接受 Uint8Array                    | `tests/providers-vision.test.ts`                |
| 107 | Vision MIME allowlist                       | vision MIME table 测试                          |
| 108 | Vision magic bytes 校验                     | vision signature table 测试                     |
| 109 | Vision 单图大小有界                         | vision bytes 边界测试                           |
| 110 | Vision 总大小/数量有界                      | vision aggregate 测试                           |
| 111 | Vision 不接受路径/URL                       | contract shape 与 runtime 测试                  |
| 112 | Vision bytes 不持久化                       | egress 与 DB 测试                               |
| 113 | Image prompt/count 有界                     | `tests/providers-image.test.ts`                 |
| 114 | Image hints 使用受控枚举                    | image hint table 测试                           |
| 115 | base64 解码前检查长度                       | image oversized-base64 测试                     |
| 116 | Image 单张/总 output 有界                   | image output limit 测试                         |
| 117 | Image MIME/magic 校验                       | image signature table 测试                      |
| 118 | URL-only image 安全拒绝                     | image variant 测试                              |
| 119 | Image 不写 storage/assets                   | egress 与 DB 行数测试                           |
| 120 | Mock image 为极小合成 bytes                 | mock image fixture 测试                         |
| 121 | inputTokens 可空                            | `tests/providers-usage.test.ts`                 |
| 122 | outputTokens 可空                           | `tests/providers-usage.test.ts`                 |
| 123 | totalTokens 可空                            | `tests/providers-usage.test.ts`                 |
| 124 | cachedInputTokens 可空                      | `tests/providers-usage.test.ts`                 |
| 125 | reasoningTokens 可空                        | `tests/providers-usage.test.ts`                 |
| 126 | image counts 可空                           | `tests/providers-usage.test.ts`                 |
| 127 | usage 仅非负安全整数                        | invalid usage table 测试                        |
| 128 | 缺失 usage 保持 null                        | missing usage 测试                              |
| 129 | 不估算 token                                | missing usage 与 source scan                    |
| 130 | 不虚构 total                                | partial usage 测试                              |
| 131 | 冲突 usage 有稳定 warning                   | usage conflict 测试                             |
| 132 | unknown usage 字段不透传                    | extra field 测试                                |
| 133 | reported/complete 语义准确                  | usage table 测试                                |
| 134 | 不计算美元成本                              | exports/source scan                             |
| 135 | 不写 model_runs/cost_ledger                 | egress DB 测试                                  |
| 136 | HttpTransport 可注入                        | fake transport provider 测试                    |
| 137 | production transport 无启动请求             | constructor request-count 测试                  |
| 138 | URL 仅 config+allowlist endpoint            | transport URL 测试                              |
| 139 | 只允许 HTTPS/loopback HTTP                  | URL policy table 测试                           |
| 140 | transport 只 POST                           | loopback fixture method 断言                    |
| 141 | redirect=error                              | loopback redirect 测试                          |
| 142 | 不使用 Cookie                               | fixture header 断言                             |
| 143 | 不读取代理环境配置                          | source scan                                     |
| 144 | header allowlist                            | fixture header 断言                             |
| 145 | request body 有界                           | request size 测试                               |
| 146 | response 流式计数有界                       | chunked oversized response 测试                 |
| 147 | invalid Content-Type 拒绝                   | MIME response 测试                              |
| 148 | timeout/Abort 释放资源                      | abort/deadline fixture 测试                     |
| 149 | loopback fixture 外部连接为 0               | fixture destination 记录                        |
| 150 | fixture listener/socket/timer 清理          | fixture teardown 与端口复用                     |
| 151 | ProviderError code 完整                     | `tests/providers-errors-retry.test.ts`          |
| 152 | retryDisposition 四态完整                   | errors enum 测试                                |
| 153 | outcomeCertainty 四态完整                   | errors enum 测试                                |
| 154 | 建连前失败可安全重试                        | fake transport attempts 测试                    |
| 155 | 429 解析 Retry-After                        | retry parser table 测试                         |
| 156 | Retry-After 上限 60 秒                      | retry cap 测试                                  |
| 157 | 401/403/普通 4xx 不重试                     | HTTP classification table                       |
| 158 | 发送后 timeout 为 MAY_HAVE_EXECUTED         | timeout classification 测试                     |
| 159 | ambiguous disconnect 不自动重发             | attempts 计数测试                               |
| 160 | invalid JSON 为 COMPLETED_INVALID_OUTPUT    | structured error 测试                           |
| 161 | 自动尝试最多 2                              | retry attempts 测试                             |
| 162 | backoff/jitter 有界可注入                   | fake clock/random 测试                          |
| 163 | Abort 可中断 backoff                        | AbortController retry 测试                      |
| 164 | deadline 覆盖全部尝试                       | fake clock deadline 测试                        |
| 165 | Provider 不调用 JobQueue                    | dependency/source architecture 测试             |
| 166 | Mock 覆盖四接口成功                         | `tests/providers-mock.test.ts`                  |
| 167 | Mock 覆盖 refusal/network/429/timeout/abort | mock scenario table                             |
| 168 | Mock 覆盖 4xx/5xx/MIME/JSON/schema/usage    | mock scenario table                             |
| 169 | Mock 覆盖 too-large/ambiguous               | mock scenario table                             |
| 170 | Mock 脚本耗尽稳定失败                       | mock exhausted 测试                             |
| 171 | Mock 并发隔离                               | concurrent scripted call 测试                   |
| 172 | Mock 不自动进入 production                  | config/protocol guard 测试                      |
| 173 | 40 项 egress 全部通过                       | `tests/providers-egress.test.ts`                |
| 174 | runtime synthetic credential 不固定/打印    | random fake resolver 测试                       |
| 175 | 真实 API 请求计数为 0                       | egress/architecture/smoke 证据                  |
| 176 | test:providers 独立通过                     | `npm run test:providers`                        |
| 177 | npm test 包含 providers                     | `npm run test`                                  |
| 178 | format/lint/typecheck/build 通过            | 最终门禁                                        |
| 179 | desktop package 与两项 smoke 通过           | 最终门禁                                        |
| 180 | audit 0 vulnerabilities                     | `npm run audit:dependencies`                    |
| 181 | Windows CI 加入 test:providers              | `.github/workflows/ci.yml`                      |
| 182 | 失败/skip/todo 为 0                         | Vitest 最终汇总                                 |
| 183 | 三张运行表行数不变                          | `tests/providers-egress.test.ts`                |
| 184 | local API listener 两态不回归               | source/package smoke                            |
| 185 | ai_disclosure=false 保持                    | `npm run test:constraints`                      |
| 186 | 版权不参与门禁等                            | `npm run test:constraints`                      |
| 187 | 无平台动作/开卷/盗版处理                    | constraints 与 architecture                     |
| 188 | 无真实 key/API/model/费用/云                | egress、network count、audit                    |
| 189 | 未进入 Issue 013/014/015/017                | 最终 diff 与 exports                            |
| 190 | 严格停止在 Issue 012                        | 最终报告与 Git 状态                             |

## 最终结果

- `test:providers`：13 个测试文件、188 项测试全部通过；egress matrix 40/40；失败、
  skip、todo 为 0。
- 全量 `test`：64 个测试文件、776 项测试全部通过；失败、skip、todo 为 0。
- migration v1—v5 SHA-256 依次为：
  `8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907`、
  `ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce`、
  `11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed`、
  `c84c82c50f2170c20154c754d0604319082c6683737624a9c14d3a508315471c`、
  `88c29c6160122eea91dc8f3b88c0cd0aafc58f91c3cfd6bcfdd2020209f6d808`。
- 18 项本地门禁全部通过；依赖审计 0 漏洞；source/package smoke 的外部连接均为 0，
  结束后 listener、端口和子进程均释放。
- 真实密钥读取、真实 API/模型调用和费用均为 0；HTTP 测试仅访问随机端口
  `127.0.0.1` fixture。
- GitHub 托管 CI 尚未运行，不能声称已通过；本地提交事实和 SHA 由最终报告记录。
