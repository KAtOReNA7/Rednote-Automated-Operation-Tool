# ADR 0007：本地 Loopback API 与插件认证

- 状态：接受
- 日期：2026-07-28
- 范围：M1 Issue 011
- 固定起点：`aab11d793021ac4f97dcf134d325be4576b5e9da`

## 背景

桌面应用已具备安全 Electron 壳、ProjectDataRoot、SQLite 和设置能力，但未来
Chrome/Edge 收藏插件尚无本机通信与认证边界。Issue 011 只建立 loopback API、
配对和认证基础，不实现 Manifest V3 插件或样本保存业务。

## 决策

### 原生 HTTP 与监听

服务位于 Electron main，使用 Node 原生 `node:http`，不新增 Express、Fastify、Koa、
WebSocket、代理或 HTTP/2 runtime。listener 仅允许显式
`listen({ host: '127.0.0.1', port, backlog: 32 })`，启动后必须从
`server.address()` 再次确认 `127.0.0.1`、`IPv4` 和配置端口。

默认端口为 43119，合法范围 1024—65535；服务默认关闭，不扫描或回退端口。没有
ProjectDataRoot 时不监听。端口切换先关闭旧 listener、绑定新 listener、再持久化；持久化
失败关闭新 listener并尽力恢复旧状态，无法恢复时进入 `ERROR_RESTART_REQUIRED`。

### 包与进程边界

`@mystery-operations/local-api` 保存 Electron 无关合同、Origin/Host/request policy、
pairing session、token digest、rate limiter、router 和原生 HTTP server。

`packages/db` 负责 local API settings/client repository；Electron main 负责 active project、
生命周期和 IPC。preload 只暴露固定管理方法。renderer 不直接发 loopback HTTP、不传 bind
host 或 origin allowlist，也不接收长期 token/digest。

### SQLite 与 token

migration v5 `local_loopback_api_and_plugin_clients` 只追加：

- STRICT singleton `local_api_settings`：enabled、port、revision、UTC 时间；
- STRICT `local_api_clients`：规范 origin、有限 label、32-byte SHA-256 digest、UTC
  创建/更新/使用/撤销时间和 revision。

插件长期 token 由未来插件或运行时测试客户端自行生成，为 32-byte CSPRNG base64url。
桌面应用只接收 token 一次并保存 SHA-256 digest；验证使用定长解析和
`crypto.timingSafeEqual`。SQLite、日志、audit、诊断、renderer、package 和 Git 不保存
明文 token。配对码为 main 生成的 32-byte CSPRNG base64url，只在内存存在 120 秒，
单次使用、最多 5 次失败，并绑定 listener instance、端口和发起窗口。

同 origin 重新配对在事务中撤销旧 active client 并创建新 client；旧 token 立即失效。
最多 8 个 active client。撤销仅接受 client id 和 expected revision。

### HTTP 安全

route allowlist 固定为：

- `OPTIONS|POST /v1/pairings/exchange`
- `OPTIONS|GET /v1/status`
- `OPTIONS|GET /v1/capabilities`

所有应用请求要求唯一、精确 `Host: 127.0.0.1:<port>`，socket remote address 必须是
`127.0.0.1`；代理 header 不参与信任。Origin 必须是唯一、规范的
`chrome-extension://<32 位 a-p 小写 id>`。认证 route 同时绑定 Bearer token 和 origin。
CORS 只回显已验证 origin，不使用星号或 credentials。

server 显式限制 header、timeout、连接数、socket 请求数和 backlog；pairing JSON body
最大 8 KiB，按流计数，exact-object，并拒绝 BOM、无效 UTF-8、无效 JSON、重复
Content-Length、GET/OPTIONS body、CONNECT、upgrade、query string 和未知 route。
响应最大 16 KiB并包含 no-store、nosniff、no-referrer 和 `default-src 'none'`。

### 限流和关闭

限流为使用可注入 clock 的内存 fixed-window：

- pairing 全局每分钟 10 次；
- 未认证请求全局每分钟 60 次；
- 每个 client 认证 route 每分钟 120 次。

关闭先拒绝新请求、取消 pairing、调用 `server.close()`，在上限后
`closeAllConnections()`，然后清空 socket、timer 和 limiter。应用退出后不保留 listener、
Electron/Node 进程或计时器。

### Electron smoke

source 和 packaged smoke 均验证两态：

- disabled：进程树 listener 为 0；
- enabled：恰好一个属于目标进程树的 `127.0.0.1`/IPv4/配置端口 listener。

两态外部连接均为 0；wildcard、IPv6、LAN/public listener 均为 0。smoke 使用运行时随机
pairing code/token完成未认证拒绝、配对、认证、能力合同、轮换、撤销、body 上限和
graceful shutdown，报告只含布尔、枚举、版本和安全计数。

## 明确不做

不实现 Issue 012/013/014/017；不实现插件、clips 或其他业务 route；不读取真实密钥、
不调用真实 API、不产生费用；不加入云、小红书平台动作、开卷或盗版电子书处理。
`ai_disclosure` 继续固定为 false 且不参与门禁，版权不参与门禁、评分、审批或排期。
