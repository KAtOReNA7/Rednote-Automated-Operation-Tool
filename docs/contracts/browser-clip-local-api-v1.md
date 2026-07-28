# Browser Clip Local API V1

## 共同约束

- authority 只能是显式的 `127.0.0.1:<port>`，端口 1024—65535。
- 必须有一个精确的 `chrome-extension://<32 个小写字母>` Origin。
- 除配对交换外，必须提供 `Authorization: Bearer <运行时随机 token>`。
- 已认证请求同时发送
  `X-Rednote-Extension-Origin: chrome-extension://<extension-id>`。若浏览器也提供
  `Origin`，两者必须精确一致；Chrome/Edge 对 GET 省略 `Origin` 时，服务端仅用该显式
  绑定头恢复 origin-token 绑定。缺失、重复或冲突值均拒绝。
- 响应含 `Cache-Control: no-store`、`Vary: Origin`、`nosniff`；不回显 token。
- POST Content-Type 固定 `application/json; charset=utf-8`。
- clip body 上限 8,500,000 字节；流式计数，超限立即拒绝。

## 路由

| 方法      | 路径                                     | 成功                                |
| --------- | ---------------------------------------- | ----------------------------------- |
| `OPTIONS` | `/v1/browser-clips`                      | `204`，只允许 POST 和三项精确请求头 |
| `POST`    | `/v1/browser-clips`                      | `201 BrowserClipResponseV1`         |
| `OPTIONS` | `/v1/browser-clips/receipts/<captureId>` | `204`，只允许 GET 和两项精确请求头  |
| `GET`     | `/v1/browser-clips/receipts/<captureId>` | `200`，返回版本化收据               |

路径不接受 query、fragment、绝对 URI、额外斜杠或非 UUID captureId。未挂载项目业务服务
时，capabilities 明确报告 `clipperBusinessRoutes=false`，业务路由不可用。

## 状态映射

| 错误                       | HTTP |
| -------------------------- | ---: |
| 未认证、token 无效或已撤销 |  401 |
| Origin/CORS 拒绝           |  403 |
| 无效合同或截图             |  400 |
| body 超限                  |  413 |
| capture 冲突               |  409 |
| 限额                       |  429 |
| 本地存储失败               |  500 |
