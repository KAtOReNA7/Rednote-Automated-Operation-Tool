# Local API v1 合同

## Endpoint

服务默认关闭。启用后只监听：

```text
http://127.0.0.1:<configured-port>
```

默认端口 `43119`，合法范围 `1024..65535`。不得使用 localhost、IPv6、wildcard、LAN、
公网、named pipe、代理、端口扫描或自动回退。

## Origin

唯一允许的形式：

```text
chrome-extension://<32 位 a-p 小写 Chromium extension id>
```

Origin 不含尾随 `/`、path、query、fragment、userinfo。所有 route 都要求唯一 Origin。

## Route allowlist

| Method  | Path                    | 认证            | 作用                    |
| ------- | ----------------------- | --------------- | ----------------------- |
| OPTIONS | `/v1/pairings/exchange` | pairing session | 严格预检                |
| POST    | `/v1/pairings/exchange` | pairing code    | 交换并保存 token digest |
| OPTIONS | `/v1/status`            | active origin   | 严格预检                |
| GET     | `/v1/status`            | Bearer + origin | 有限服务状态            |
| OPTIONS | `/v1/capabilities`      | active origin   | 严格预检                |
| GET     | `/v1/capabilities`      | Bearer + origin | 有限能力合同            |

未知 route 为 404；已知 route 错误 method 为 405 并返回精确 `Allow`；query string、
CONNECT、upgrade 和 request body（除 pairing POST）均拒绝。

## Pairing request

`POST /v1/pairings/exchange`

```json
{
  "pairingCode": "<runtime-only 32-byte base64url>",
  "extensionOrigin": "chrome-extension://<id>",
  "clientToken": "<plugin-owned runtime-only 32-byte base64url>",
  "clientLabel": "可选有限标签"
}
```

`Origin` 必须与 `extensionOrigin` 精确一致。Content-Type 必须是
`application/json`；body 最大 8192 bytes。响应仅为：

```json
{
  "paired": true,
  "clientId": "<stable random id>",
  "apiVersion": "1",
  "createdAt": "<UTC ISO-8601>"
}
```

响应不返回 token、digest 或 pairing code。

## Authentication

认证 route 使用唯一 `Authorization: Bearer <43-char-base64url-token>`。服务计算
SHA-256 digest，以 `timingSafeEqual` 与 active client digest 比较，并要求请求 Origin
与 client origin 精确一致。未知、错误、轮换后旧 token 和已撤销 token均返回有限 401，
不泄漏 digest 是否存在。

## Status response

```json
{
  "apiVersion": "1",
  "serviceState": "RUNNING",
  "projectReady": true,
  "serverTime": "<UTC ISO-8601>",
  "clientId": "<authenticated-client-id>",
  "clientStatus": "ACTIVE"
}
```

## Capabilities response

```json
{
  "apiVersion": "1",
  "pairing": true,
  "authenticatedStatus": true,
  "clipperBusinessRoutes": false,
  "clipperIssue": "017",
  "maxJsonBodyBytes": 8192,
  "supportedOriginScheme": "chrome-extension"
}
```

Issue 011 不提供 `/clips`、`/sources`、`/books`、`/jobs`、模型、生成、上传或平台 route。

## CORS

- 只为已验证的精确 Origin 设置 `Access-Control-Allow-Origin`；
- `Vary: Origin`；
- 不设置 `Access-Control-Allow-Credentials`；
- methods 只列当前 route method；
- headers 只允许 route 实际需要的 `authorization`/`content-type`；
- max age 为 300 秒；
- 非法 preflight 不返回 ACAO，也不产生 pairing/auth/DB 状态。

## 响应与错误

所有响应为有界 UTF-8 JSON，带：

- `Cache-Control: no-store`
- `Pragma: no-cache`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy: default-src 'none'`

错误只返回稳定 `code`、有限 `message` 和运行时随机 `requestId`；429 可额外返回有限
`Retry-After`。不返回 Server、X-Powered-By、stack、SQL、绝对路径、header、raw body、
token、digest、pairing code 或内部类名。
