# M1 Issue 011 验收映射

状态：完成；180/180 项均保留独立编号并已映射到实际行为证据。

|   # | 验收行为                                    | 计划/实际证据                              |
| --: | ------------------------------------------- | ------------------------------------------ |
| 001 | 起始 HEAD 精确匹配                          | Git 开工核验；最终报告                     |
| 002 | main 且起点工作树干净                       | Git 开工核验；实施计划                     |
| 003 | M0/007/009/006/008/010 祖先顺序正确         | `merge-base --is-ancestor` 开工记录        |
| 004 | 不改写历史                                  | 最终 Git log/diff                          |
| 005 | v1 migration SHA 不变                       | `tests/local-api-schema.test.ts`           |
| 006 | v2 migration SHA 不变                       | `tests/local-api-schema.test.ts`           |
| 007 | v3 migration SHA 不变                       | `tests/local-api-schema.test.ts`           |
| 008 | v4 migration SHA 不变                       | `tests/local-api-schema.test.ts`           |
| 009 | constraints 不削弱且通过                    | `npm run test:constraints`                 |
| 010 | db 不削弱且通过                             | `npm run test:db`                          |
| 011 | queue 不削弱且通过                          | `npm run test:queue`                       |
| 012 | desktop 不削弱且通过                        | `npm run test:desktop`                     |
| 013 | storage 不削弱且通过                        | `npm run test:storage`                     |
| 014 | settings 不削弱且通过                       | `npm run test:settings`                    |
| 015 | Electron 错误探针未提交且旧 smoke 无弹窗    | 开工 rg；source/package smoke              |
| 016 | migration v5 连续且名称稳定                 | `tests/local-api-schema.test.ts`           |
| 017 | v5 重复检查幂等                             | `tests/local-api-schema.test.ts`           |
| 018 | v5 失败完整回滚                             | `tests/local-api-schema.test.ts`           |
| 019 | v5 前备份可独立打开                         | `tests/local-api-schema.test.ts`           |
| 020 | 旧数据、索引、外键、STRICT 保留             | `tests/local-api-schema.test.ts`           |
| 021 | local_api_settings STRICT singleton         | `tests/local-api-schema.test.ts`           |
| 022 | local_api_settings 默认 disabled            | `tests/local-api-schema.test.ts`           |
| 023 | 默认端口 43119                              | `tests/local-api-schema.test.ts`           |
| 024 | 端口只接受 1024—65535 整数                  | `tests/local-api-schema.test.ts`           |
| 025 | settings revision 单调/expected revision    | `tests/local-api-schema.test.ts`           |
| 026 | local_api_clients STRICT                    | `tests/local-api-schema.test.ts`           |
| 027 | client id 不含 token                        | `tests/local-api-schema.test.ts`           |
| 028 | extension origin 规范约束                   | `tests/local-api-schema.test.ts`           |
| 029 | token digest 仅 32-byte BLOB                | `tests/local-api-schema.test.ts`           |
| 030 | DB 不保存明文 token                         | `tests/local-api-secret-egress.test.ts`    |
| 031 | DB 不保存 pairing code                      | `tests/local-api-secret-egress.test.ts`    |
| 032 | 同 origin 最多一个 active client            | `tests/local-api-schema.test.ts`           |
| 033 | active client 上限 8                        | `tests/local-api-pairing-auth.test.ts`     |
| 034 | revoke 状态与时间一致                       | `tests/local-api-schema.test.ts`           |
| 035 | client 查询索引覆盖                         | `tests/local-api-schema.test.ts`           |
| 036 | server 使用原生 node:http                   | `tests/local-api-architecture.test.ts`     |
| 037 | 无 Fastify/Express/Koa/WebSocket runtime    | `tests/local-api-architecture.test.ts`     |
| 038 | listen 显式 127.0.0.1                       | `tests/local-api-binding.test.ts`          |
| 039 | 不监听 localhost                            | `tests/local-api-binding.test.ts`          |
| 040 | 不监听 0.0.0.0                              | `tests/local-api-binding.test.ts`          |
| 041 | 不监听 ::                                   | `tests/local-api-binding.test.ts`          |
| 042 | 不监听 ::1                                  | `tests/local-api-binding.test.ts`          |
| 043 | 不监听 LAN/public IP                        | `tests/local-api-binding.test.ts`          |
| 044 | server.address 精确 IPv4 loopback           | `tests/local-api-binding.test.ts`          |
| 045 | 服务默认关闭                                | `tests/local-api-lifecycle.test.ts`        |
| 046 | 无 ProjectDataRoot 时不监听                 | `tests/local-api-lifecycle.test.ts`        |
| 047 | app.whenReady 后才组装                      | `tests/local-api-architecture.test.ts`     |
| 048 | enabled 后 RUNNING                          | `tests/local-api-lifecycle.test.ts`        |
| 049 | disabled 后端口释放                         | `tests/local-api-lifecycle.test.ts`        |
| 050 | 配置端口重启服务                            | `tests/local-api-lifecycle.test.ts`        |
| 051 | 端口冲突稳定错误                            | `tests/local-api-binding.test.ts`          |
| 052 | 冲突不扫描其他端口                          | `tests/local-api-binding.test.ts`          |
| 053 | bind 失败不伪装运行                         | `tests/local-api-binding.test.ts`          |
| 054 | 端口切换持久化失败恢复                      | `tests/local-api-lifecycle.test.ts`        |
| 055 | shutdown 停止新请求                         | `tests/local-api-lifecycle.test.ts`        |
| 056 | shutdown 取消 pairing                       | `tests/local-api-lifecycle.test.ts`        |
| 057 | shutdown 关闭 idle/active socket            | `tests/local-api-lifecycle.test.ts`        |
| 058 | shutdown 清理 timer/rate limiter            | `tests/local-api-lifecycle.test.ts`        |
| 059 | app 退出无 listener                         | source/package smoke                       |
| 060 | app 退出无 Electron/Node 残留               | source/package smoke                       |
| 061 | route allowlist 仅六项                      | `tests/local-api-architecture.test.ts`     |
| 062 | 无 clips/业务 route                         | `tests/local-api-architecture.test.ts`     |
| 063 | status 必须认证                             | `tests/local-api-pairing-auth.test.ts`     |
| 064 | capabilities 必须认证                       | `tests/local-api-pairing-auth.test.ts`     |
| 065 | capabilities 业务 route=false               | `tests/local-api-pairing-auth.test.ts`     |
| 066 | 未认证 status 为 401                        | `tests/local-api-pairing-auth.test.ts`     |
| 067 | 未认证 capabilities 为 401                  | `tests/local-api-pairing-auth.test.ts`     |
| 068 | 未知 route 有限 404                         | `tests/local-api-request-limits.test.ts`   |
| 069 | 错误 method 405/精确 Allow                  | `tests/local-api-request-limits.test.ts`   |
| 070 | query string 被拒绝                         | `tests/local-api-request-limits.test.ts`   |
| 071 | Host header 必须唯一                        | `tests/local-api-host-origin-cors.test.ts` |
| 072 | Host 精确 127.0.0.1:port                    | `tests/local-api-host-origin-cors.test.ts` |
| 073 | localhost Host 被拒绝                       | `tests/local-api-host-origin-cors.test.ts` |
| 074 | DNS rebinding Host 被拒绝                   | `tests/local-api-host-origin-cors.test.ts` |
| 075 | remoteAddress 仅 127.0.0.1                  | `tests/local-api-host-origin-cors.test.ts` |
| 076 | 不信任 X-Forwarded-For                      | `tests/local-api-host-origin-cors.test.ts` |
| 077 | CONNECT 被拒绝                              | `tests/local-api-request-limits.test.ts`   |
| 078 | Upgrade/WebSocket 被拒绝                    | `tests/local-api-request-limits.test.ts`   |
| 079 | maxHeaderSize 有界                          | `tests/local-api-request-limits.test.ts`   |
| 080 | maxHeadersCount 有界                        | `tests/local-api-request-limits.test.ts`   |
| 081 | headersTimeout=5s                           | `tests/local-api-request-limits.test.ts`   |
| 082 | requestTimeout=10s                          | `tests/local-api-request-limits.test.ts`   |
| 083 | keepAliveTimeout=2s                         | `tests/local-api-request-limits.test.ts`   |
| 084 | maxRequestsPerSocket 有界                   | `tests/local-api-request-limits.test.ts`   |
| 085 | maxConnections/backlog 有界                 | `tests/local-api-request-limits.test.ts`   |
| 086 | pairing body 最大 8 KiB                     | `tests/local-api-request-limits.test.ts`   |
| 087 | body 按流计数                               | `tests/local-api-request-limits.test.ts`   |
| 088 | GET/OPTIONS 拒绝 body                       | `tests/local-api-request-limits.test.ts`   |
| 089 | invalid UTF-8/BOM/JSON 拒绝                 | `tests/local-api-request-limits.test.ts`   |
| 090 | response/header/error 不泄漏                | `tests/local-api-request-limits.test.ts`   |
| 091 | Origin header 必须唯一                      | `tests/local-api-host-origin-cors.test.ts` |
| 092 | 缺失 Origin 被拒绝                          | `tests/local-api-host-origin-cors.test.ts` |
| 093 | null Origin 被拒绝                          | `tests/local-api-host-origin-cors.test.ts` |
| 094 | http/https/file origin 被拒绝               | `tests/local-api-host-origin-cors.test.ts` |
| 095 | moz-extension 被拒绝                        | `tests/local-api-host-origin-cors.test.ts` |
| 096 | 只接受 chrome-extension                     | `tests/local-api-host-origin-cors.test.ts` |
| 097 | extension id 32 位 a—p                      | `tests/local-api-host-origin-cors.test.ts` |
| 098 | origin path/query/fragment 拒绝             | `tests/local-api-host-origin-cors.test.ts` |
| 099 | pairing header/body origin 一致             | `tests/local-api-pairing-auth.test.ts`     |
| 100 | auth origin 匹配 active client              | `tests/local-api-pairing-auth.test.ts`     |
| 101 | ACAO 不为星号                               | `tests/local-api-host-origin-cors.test.ts` |
| 102 | ACAO 只回显已验证 origin                    | `tests/local-api-host-origin-cors.test.ts` |
| 103 | 无 Allow-Credentials=true                   | `tests/local-api-host-origin-cors.test.ts` |
| 104 | Vary: Origin                                | `tests/local-api-host-origin-cors.test.ts` |
| 105 | allow methods 仅实际 method                 | `tests/local-api-host-origin-cors.test.ts` |
| 106 | allow headers 仅 authorization/content-type | `tests/local-api-host-origin-cors.test.ts` |
| 107 | 非法 preflight 无 ACAO                      | `tests/local-api-host-origin-cors.test.ts` |
| 108 | preflight 不产生业务状态                    | `tests/local-api-host-origin-cors.test.ts` |
| 109 | preflight max-age<=300                      | `tests/local-api-host-origin-cors.test.ts` |
| 110 | CORS 与 Bearer auth 分离                    | `tests/local-api-host-origin-cors.test.ts` |
| 111 | pairing 仅显式 IPC 发起                     | `tests/local-api-ipc.test.ts`              |
| 112 | pairing code 32-byte CSPRNG base64url       | `tests/local-api-pairing-auth.test.ts`     |
| 113 | pairing code 只在内存                       | `tests/local-api-secret-egress.test.ts`    |
| 114 | pairing TTL=120s                            | `tests/local-api-pairing-auth.test.ts`     |
| 115 | pairing code 单次使用                       | `tests/local-api-pairing-auth.test.ts`     |
| 116 | pairing 绑定 listener/port/window           | `tests/local-api-pairing-auth.test.ts`     |
| 117 | pairing 最多 5 次失败                       | `tests/local-api-pairing-auth.test.ts`     |
| 118 | cancel 后失效                               | `tests/local-api-pairing-auth.test.ts`     |
| 119 | timeout 后失效                              | `tests/local-api-pairing-auth.test.ts`     |
| 120 | window 销毁后失效                           | `tests/local-api-lifecycle.test.ts`        |
| 121 | 服务停止后失效                              | `tests/local-api-lifecycle.test.ts`        |
| 122 | client token 32-byte CSPRNG base64url       | `tests/local-api-pairing-auth.test.ts`     |
| 123 | token 仅 pairing/Auth 使用                  | `tests/local-api-secret-egress.test.ts`    |
| 124 | pairing response 不回显 token               | `tests/local-api-pairing-auth.test.ts`     |
| 125 | pairing response 不回显 digest/code         | `tests/local-api-pairing-auth.test.ts`     |
| 126 | digest 使用 SHA-256                         | `tests/local-api-pairing-auth.test.ts`     |
| 127 | digest 比较 timingSafeEqual                 | `tests/local-api-architecture.test.ts`     |
| 128 | 无效 token 有限 401                         | `tests/local-api-pairing-auth.test.ts`     |
| 129 | 未知/旧 token 错误无差异                    | `tests/local-api-pairing-auth.test.ts`     |
| 130 | 同 pairing code 并发一个成功                | `tests/local-api-pairing-auth.test.ts`     |
| 131 | 同 origin 重配旧 token 失效                 | `tests/local-api-pairing-auth.test.ts`     |
| 132 | revoke 后 token 失效                        | `tests/local-api-pairing-auth.test.ts`     |
| 133 | client 上限安全拒绝                         | `tests/local-api-pairing-auth.test.ts`     |
| 134 | Bearer parser 拒绝重复 header               | `tests/local-api-pairing-auth.test.ts`     |
| 135 | Bearer parser 拒绝 scheme/长度/字符         | `tests/local-api-pairing-auth.test.ts`     |
| 136 | pairing 全局限流                            | `tests/local-api-rate-limit.test.ts`       |
| 137 | 未认证请求限流                              | `tests/local-api-rate-limit.test.ts`       |
| 138 | 每 client auth 限流                         | `tests/local-api-rate-limit.test.ts`       |
| 139 | 429 有限 Retry-After                        | `tests/local-api-rate-limit.test.ts`       |
| 140 | 限流使用可注入 clock                        | `tests/local-api-rate-limit.test.ts`       |
| 141 | 限流不依赖 Redis/云/队列                    | `tests/local-api-architecture.test.ts`     |
| 142 | last_used 更新节流                          | `tests/local-api-rate-limit.test.ts`       |
| 143 | revoke/request 竞争确定                     | `tests/local-api-pairing-auth.test.ts`     |
| 144 | stopping 拒绝新请求                         | `tests/local-api-lifecycle.test.ts`        |
| 145 | 稳定错误码覆盖失败                          | `tests/local-api-request-limits.test.ts`   |
| 146 | preload 仅窄 local API 方法                 | `tests/local-api-ipc.test.ts`              |
| 147 | 无 raw ipc/http/net/crypto/db               | `tests/local-api-architecture.test.ts`     |
| 148 | senderFrame origin 校验                     | `tests/local-api-ipc.test.ts`              |
| 149 | IPC exact-object/拒绝多余字段               | `tests/local-api-ipc.test.ts`              |
| 150 | renderer 不能传 bind host                   | `tests/local-api-ipc.test.ts`              |
| 151 | renderer 不能传 origin allowlist            | `tests/local-api-ipc.test.ts`              |
| 152 | renderer 不接收长期 token/digest            | `tests/local-api-ipc.test.ts`              |
| 153 | 设置页默认关闭                              | `tests/local-api-renderer.test.tsx`        |
| 154 | 设置页显示真实状态/端口                     | `tests/local-api-renderer.test.tsx`        |
| 155 | 端口冲突/停止状态可见                       | `tests/local-api-renderer.test.tsx`        |
| 156 | pairing code 倒计时/取消                    | `tests/local-api-renderer.test.tsx`        |
| 157 | pairing code 卸载清空                       | `tests/local-api-renderer.test.tsx`        |
| 158 | client 列表无 token/digest                  | `tests/local-api-renderer.test.tsx`        |
| 159 | revoke 明确确认                             | `tests/local-api-renderer.test.tsx`        |
| 160 | UI 标明 Issue 017 才有业务                  | `tests/local-api-renderer.test.tsx`        |
| 161 | 36 项 secret egress 全通过                  | `tests/local-api-secret-egress.test.ts`    |
| 162 | pairing code 不进持久层                     | `tests/local-api-secret-egress.test.ts`    |
| 163 | token 不进日志/audit/诊断/export            | `tests/local-api-secret-egress.test.ts`    |
| 164 | 诊断仅增加有限 local API 状态               | `tests/local-api-secret-egress.test.ts`    |
| 165 | source disabled listener=0                  | `npm run test:electron-smoke`              |
| 166 | source enabled 一个 IPv4 loopback           | `npm run test:electron-smoke`              |
| 167 | packaged disabled listener=0                | `npm run test:packaged-smoke`              |
| 168 | packaged enabled 一个 IPv4 loopback         | `npm run test:packaged-smoke`              |
| 169 | source/package 无 wildcard/LAN/public       | source/package socket 断言                 |
| 170 | source/package 外部连接=0                   | source/package socket 断言                 |
| 171 | source/package pairing/auth/rotate/revoke   | source/package smoke 报告                  |
| 172 | source/package 结束端口/进程清理            | source/package smoke runner                |
| 173 | test:local-api 独立通过                     | `npm run test:local-api`                   |
| 174 | 全量 test 包含 local API                    | `npm run test`                             |
| 175 | build/package/audit 通过且 0 漏洞           | 最终门禁                                   |
| 176 | Windows CI 保留旧门禁并加入 local API       | `.github/workflows/ci.yml`；CI 配置测试    |
| 177 | ai_disclosure=false 保持                    | constraints 回归                           |
| 178 | 版权不参与门禁/评分/审批/排期               | constraints 回归                           |
| 179 | 无真实 API/模型/密钥/费用/云/平台/禁用数据  | architecture 与 runtime 证据               |
| 180 | 严格停止在 Issue 011                        | 最终 Git diff 与报告                       |

## 最终结果

- `test:local-api`：11 个测试文件、126 个测试，失败/skip/todo 为 0。
- 全量 `test`：50 个测试文件、585 个测试，失败/skip/todo 为 0。
- migration v5 SHA-256：
  `88c29c6160122eea91dc8f3b88c0cd0aafc58f91c3cfd6bcfdd2020209f6d808`；v1—v4
  校验和保持。
- source/package 两态 socket 断言均通过：disabled listener 为 0；enabled 精确一个
  `127.0.0.1` IPv4 listener；wildcard/LAN/public 与外部连接均为 0；结束后端口和进程释放。
- 17 项最终门禁、Git 范围检查和唯一 Issue 011 本地提交的完整结果由最终报告记录。
