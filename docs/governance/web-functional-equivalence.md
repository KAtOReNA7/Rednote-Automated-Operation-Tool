# WebUI W2 功能等价实施与证据

## 动态起点与范围

- START base：`bd048ad5770c20614439a7792de418a40bc48812`（PR #31 普通合并提交）。
- 分支：`codex/v3-webui-functional-equivalence`。
- W2 只扩展同一个用户授权目录中的 Web workspace；不迁移 SQLite、不部署网站、不退休桌面端，
  不进入 W3。

## 实施映射

| 领域       | 复用                                                               | 改造                                                            | 明确不使用                                                       |
| ---------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Workspace  | W1 manifest、不可变 snapshot、双 index、SHA-256、单写者与 FSA port | 追加 W2 schema、v1 内存迁移和互动/书库/指标/Provider 非秘密状态 | SQLite、IndexedDB 业务副本、云端存储                             |
| 页面       | W1 `#/web/` shell、真实路由、计划与内容队列                        | 接通总览、互动、书库、复盘、设置；补充内容 AI 预览/保存         | 依赖 `window.rednoteV2` 的 Electron renderer 页面、mock 页面状态 |
| 内容与互动 | `packages/v2` 的内容 wire DTO、严格解码、互动文本限制与状态语义    | Web snapshot 内的追加版本、人工确认/发送记录和受控删除          | 自动发送、平台登录、Scripted 生产 fallback                       |
| 指标       | `parseMetricSnapshot` 与 `deterministicReview` 的确定性规则        | Web revision 化快照和接受/拒绝决定                              | 平台抓取、模拟 KPI、模型建议                                     |
| Provider   | 既有 Chat Completions codec、错误码、usage、大小限制和脱敏原则     | 浏览器 `fetch` port、会话 key、preview/confirm、无重试单请求    | Node transport、CredentialStore、Search/Fetch/图片、启动时外连   |
| Clipper    | 用户点击读取当前公开页、有限字段与可选可见截图                     | 版本化 `.rednote-clip.json` 下载及 Web 预览/确认导入            | loopback、本地 API、pairing code、固定端口、后台遍历             |
| 验证       | W1 Web 测试、Chrome/Edge artifact smoke                            | `test:web-w2`、七页行为、Provider 失败矩阵、Clipper 产物检查    | 真实用户目录、真实 Provider、真实页面样本和费用                  |

## 威胁边界与 UNKNOWN

- Web 会话 API key 只驻留当前页面内存，刷新或关闭即消失；它不是操作系统凭据保险箱。
- Provider 是否允许浏览器跨域请求取决于对方 CORS；静态 CSP 只允许 HTTPS 与开发 loopback，
  不能替 Provider 授权跨域。
- 费用估算未知时保持 `UNKNOWN` 并阻断确认；不把未知费用记为零。
- FSA 的物理介质级删除和断电持久性不作保证。

## W2-01—W2-30 验收证据

下表中的 PASS 均来自本分支实际执行的行为测试或真实构建产物检查；源码定位仅用于说明实现
边界，不替代行为证据。

| ID    | 结果 | 行为与证据定位                                                                                                           |
| ----- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| W2-01 | PASS | `tests/web-w2-migration.test.ts`：v1 最后 snapshot 保留、生成 v2 并重载一致。                                            |
| W2-02 | PASS | `tests/web-w2-migration.test.ts`：中断的 index 切换恢复、损坏最新代回退、未来版本阻断。                                  |
| W2-03 | PASS | `tests/web-w2-renderer.test.tsx` 与 `scripts/run-web-e2e.mjs`：七路由、hash/history 与活动状态。                         |
| W2-04 | PASS | `tests/web-w2-domain.test.ts` 的单一 generation chain；`WebWorkspaceRuntime.getOverview()` 只聚合 snapshot。             |
| W2-05 | PASS | `npm run test:web` 覆盖既有 W1 C01—C14、跨周、preview 和内容版本链。                                                     |
| W2-06 | PASS | `tests/web-w2-domain.test.ts`：计划、内容及选择在同一活动周串行持久化；renderer 队列可见。                               |
| W2-07 | PASS | `tests/web-w2-domain.test.ts`：互动幂等创建及 NEW→SUGGESTED→CONFIRMED→MANUAL_SENT。                                      |
| W2-08 | PASS | 同一互动行为测试覆盖追加回复版本与绑定 expected revision 的批量确认。                                                    |
| W2-09 | PASS | 同一互动行为测试覆盖跳过、重开、撤销手工发送和删除 preview/confirm，关闭重载一致。                                       |
| W2-10 | PASS | `tests/web-w2-domain.test.ts`、`tests/web-w2-renderer.test.tsx`：只记录人工发送；无平台写入。                            |
| W2-11 | PASS | `tests/web-w2-renderer.test.tsx`：书库 loading/empty/error/search/detail；`w2-pages.tsx` 有界分页。                      |
| W2-12 | PASS | `tests/web-w2-domain.test.ts`：Catalog 严格 preview/confirm；未来版本、超限、引用冲突零写入。                            |
| W2-13 | PASS | 同一测试使用严格 Clipper 文件完成 preview→confirm→library，重复导入幂等。                                                |
| W2-14 | PASS | `tests/web-w2-domain.test.ts`、`tests/clipper-architecture.test.ts`：exact keys、UTF-8/截图上限及敏感字段拒绝。          |
| W2-15 | PASS | `npm run build:clipper` 的 artifact inspector 与 `tests/clipper-egress.test.ts`：无 loopback/local API/启动外连。        |
| W2-16 | PASS | `tests/web-w2-domain.test.ts`：已批准 package 的 24H/72H/7D revision 快照及重载汇总。                                    |
| W2-17 | PASS | 同一指标测试覆盖建议接受/拒绝；无样本返回明确空状态而非虚构趋势。                                                        |
| W2-18 | PASS | `tests/web-w2-domain.test.ts`、`tests/web-w2-renderer.test.tsx`：非秘密设置落盘，key 在 snapshot/DOM/diagnostic 零命中。 |
| W2-19 | PASS | `tests/web-w2-domain.test.ts`：缺少会话 key 时阻断；runtime 关闭后新会话必须重新输入。                                   |
| W2-20 | PASS | 同一测试：preview token 绑定 workspace/revision/input/config hash，陈旧确认零调用。                                      |
| W2-21 | PASS | 同一测试以注入 Provider port 分别完成内容/回复单请求、预览与显式保存。                                                   |
| W2-22 | PASS | `tests/web-provider-browser.test.ts`：offline、timeout、401/403/429/5xx、非 JSON、超限脱敏且 fail-closed。               |
| W2-23 | PASS | `browser-provider.ts` 与对应测试：并发 1、单请求、有界 timeout/body/header、Abort、无 retry；未知费用阻断。              |
| W2-24 | PASS | `npm run build:web` artifact inspector 与 `tests/web-artifact.test.ts`：无 Node/Electron/SQLite/bridge/test adapter。    |
| W2-25 | PASS | `tests/web-w2-domain.test.ts`：计划/内容/Provider/Clipper/指标都经 repository 单写者及 revision 提交。                   |
| W2-26 | PASS | `npm run smoke:web-e2e`：Chrome/Edge 在 1280×800、1440×900 遍历七页且无水平溢出。                                        |
| W2-27 | PASS | `tests/web-w2-renderer.test.tsx` 与真实构建 smoke：可见 focus、label、disabled、alert/aria-live 状态。                   |
| W2-28 | PASS | `tests/web-w2-domain.test.ts`、`tests/web-w2-renderer.test.tsx`：诊断 allowlist，不含正文、key、raw payload、URL/path。  |
| W2-29 | PASS | `tests/web-w2-domain.test.ts`：空 workspace 连续写入计划→内容→互动→指标并关闭重载。                                      |
| W2-30 | PASS | Web/Clipper artifact 检查及 Chrome/Edge smoke 报告：测试真实外部连接 0；仅合成 Provider port，费用 0。                   |

## 本地门禁记录

最终候选在首次 push 前执行：`test:web`、`test:web-w2`、Provider/Clipper 及相邻 V2 聚焦测试、
format、lint、typecheck、Web/Clipper build 与 artifact inspection、Chrome/Edge Web smoke、一次
single-worker normal、dependency audit 和 `git diff --check`。精确数量和结论记录在 Draft PR；
此处不复制易漂移的运行日志。

W1 的 `BrowserLocalFolderPort` 选择、权限请求和 create/write/readback/hash 顺序没有修改，因此
继承 W1 已由用户完成的 Chrome/Edge 原生 FSA 七项 PASS；W2 smoke 的 synthetic handle 只用于
自动遍历七页，不冒充 native picker 验收。
