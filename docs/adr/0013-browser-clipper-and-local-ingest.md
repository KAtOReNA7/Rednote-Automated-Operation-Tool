# ADR 0013：Chrome / Edge 公开页面样本收藏

- 状态：Accepted
- 日期：2026-07-28
- Issue：017

## 决策

`apps/clipper` 提供一套同时供 Chrome 与 Edge 使用的 Manifest V3 源码。扩展只有
`activeTab`、`scripting`、`storage` 权限和 `http://127.0.0.1/*` 主机权限。用户点击扩展后，
service worker 才在当前活动标签页的顶层 `ISOLATED` world 中读取 URL、标题和选中文本。
可见区域截图默认关闭，只能由用户在弹窗中显式勾选。

扩展复用 Issue 011 的短期配对码和每客户端随机 bearer token；token 只存于扩展的
`storage.local`，并把存储访问级别限制为 `TRUSTED_CONTEXTS`。业务请求只发往用户输入并经
严格校验的 `http://127.0.0.1:<port>`。本地 API 增加且仅增加：

- `OPTIONS/POST /v1/browser-clips`
- `OPTIONS/GET /v1/browser-clips/receipts/<captureId>`

已认证请求额外携带动态派生的 `X-Rednote-Extension-Origin`。浏览器同时提供 `Origin`
时两者必须精确一致；Chrome/Edge 对 GET 省略 `Origin` 时，服务端以该显式头恢复
origin-token 绑定。该兼容不接受任意 Origin、重复值或冲突值。

SQLite migration v10 保存样本、幂等收据、持久限额和样本到候选的单一关系。截图经过
MIME、magic bytes、尺寸、像素数和字节数检查后进入 `ProjectDataRoot` 内容寻址文件仓库；
数据库只保存受控相对路径。

每个样本产生一个 `BrowserClipAdapter` 本地被动候选。该候选固定为
`LEAD_ONLY / NOT_FETCHED / UNVERIFIED / NOT_A_FACT`，`externalRequestCount=0`，
`costState=NOT_INCURRED`，不自动进入 Fetch、Source、Claim、Book、模型或任务队列。

## 取舍

- 不使用 content script、后台页面监听或站点遍历，降低权限和意外采集面。
- 不提供任意 host、端口扫描或 `localhost` 回退，牺牲便利性以保持 loopback 边界可审计。
- 不保存页面 HTML、表单、cookie、storage 或网络响应，样本信息量有限但边界明确。
- 同一 `extensionOrigin + captureId` 只允许同一语义载荷重放，避免双写和不确定结果。
- 真实浏览器 smoke 使用非默认随机 profile、动态 CDP endpoint 和官方
  `Extensions.loadUnpacked`；URL 与 nonce 只由 CDP 判断，Windows 工具只触发 action。

## 明确不做

不自动登录、发布、评论、私信，不处理验证码或风控，不使用小红书非公开 API；不调用真实
模型、搜索、图片或付费 API；不实现 Issue 018。
