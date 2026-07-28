# Browser Clip V1 合同

## 输入

`BrowserClipCreateV1` 是 exact-object 合同，`contractVersion` 固定为
`browser-clip-v1`。未知字段、缺失字段、非 NFC 文本、控制字符和越界值均拒绝。

| 字段                  | 规则                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `captureId`           | UUID；同一扩展来源下作为幂等键                                               |
| `pageUrl`             | 仅 `http:` / `https:`；无凭据、fragment、凭据样式 query 参数；最多 4096 字符 |
| `pageTitle`           | 必填 NFC 文本，1—512 字符                                                    |
| `selectedText`        | 可空，最多 12,000 字符                                                       |
| `accountName`         | 用户手工输入，可空，最多 200 字符                                            |
| `userNote`            | 用户手工输入，可空，最多 2,000 字符                                          |
| `visibleMetrics`      | 五个精确字段；可空或非负安全整数                                             |
| `contentTags`         | 固定枚举，去重，最多 10 项                                                   |
| `publicPageConfirmed` | 必须为 `true`                                                                |
| `screenshot`          | 可空；只接受 PNG/JPEG data URL，解码后最多 6 MiB / 20M 像素                  |

`capturedAt`、`publishedAt` 使用带毫秒的 UTC ISO 8601。截图不是默认证据，也不改变候选
状态。

## 输出与语义

保存返回 `BrowserClipResponseV1`，内含 `SUCCEEDED` 收据以及 `clipId`、`candidateId`。
收据查询未知键返回 `UNKNOWN`，不会推测保存结果。相同幂等键和相同 payload hash 返回原
收据；相同幂等键不同内容返回 `CLIPPER_CAPTURE_CONFLICT`。

稳定错误定义在 `BROWSER_CLIP_STABLE_ERRORS`，UI 和 API 只依赖错误码，不依赖错误文案。
