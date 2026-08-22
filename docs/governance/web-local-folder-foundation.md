# Web 本地文件基础合同

状态：WebUI 转型第 1 条实现合同。适用于 `apps/web-ui/src/v2/web` 与静态 Web 构建；不替代仍保留的
桌面历史合同。

## 目标与边界

Rednote Studio 的 Web 入口以用户明确选择的本地文件夹为业务数据唯一权威来源。浏览器
IndexedDB 只保存可丢失的目录句柄、目录显示名和 workspace ID；清除站点数据后，重新选择同一
目录必须恢复全部已提交的人设、活动周、计划、内容和版本。

本阶段只迁移“连接目录 → 人设 → 周计划 → 内容”纵切和本地运行状态。互动、书库、复盘、正式
Provider、Clipper、旧 SQLite 数据迁移和公开静态部署留待后续独立授权。Web 生产路径不依赖
Electron、preload、IPC、SQLite、系统凭据库或本地 HTTP daemon。

## 实施映射

| 关注点        | 决策与实现                                                                             |
| ------------- | -------------------------------------------------------------------------------------- |
| 纯领域复用    | `packages/v2` 的 persona、weekly plan、content fields parser 与 ISO 周日期逻辑直接复用 |
| Renderer 端口 | `WebWorkspaceRuntime` 是独立浏览器端口；Web 入口不读取 `window.rednoteV2`              |
| 文件访问      | `BrowserLocalFolderPort` 是 File System Access API 的唯一生产 adapter                  |
| 句柄缓存      | `handle-store.ts` 只保存 handle、显示名、workspace ID，不保存业务状态                  |
| 权威仓库      | `BrowserWorkspaceRepository` 实现严格 JSON、SHA-256、双 index、不可变 snapshot 与恢复  |
| 并发          | `navigator.locks` 串行化写入；`BroadcastChannel` 通知其他标签页只读刷新                |
| Web 构建      | `vite.web.config.ts` 使用相对 base，关闭 source map，并嵌入精确 Git commit/构建时间    |
| 网络边界      | CSP `connect-src 'self'`；生产源码不含 fetch/XHR/WebSocket/Provider 路径               |
| CI 分流       | `Web required` 自动执行；旧 Windows installer/package/lifecycle 仅 `workflow_dispatch` |
| 新依赖        | 0；真实浏览器验证复用本机 Chrome/Edge 与现有 CDP harness                               |

## 磁盘格式

```text
RednoteData/
├─ rednote-workspace.json
└─ state/
   ├─ index-a.json
   ├─ index-b.json
   └─ snapshots/
      ├─ 00000001.json
      └─ 00000002.json
```

- `rednote-workspace.json`：`format`、`schemaVersion`、`workspaceId`、`createdAt`。
- snapshot：`schemaVersion`、`workspaceId`、`generation`、`savedAt` 和完整业务 `state`。
- index：`schemaVersion`、`workspaceId`、`generation`、snapshot 相对路径、字节数和 SHA-256。
- 所有对象使用 exact-object parser；未知字段、未知版本、非法 ISO 周、身份不一致或版本链不连续
  均 fail closed。
- 写 allowlist 只允许创建 manifest/新 snapshot，以及替换两个 index slot。拒绝绝对路径、URL、
  反斜杠、`..` 和未知目标。

## 写入、恢复与并发

1. mutation 先通过领域 parser、活动周 invariant 和 revision 校验。
2. 在 workspace 独占锁内重新读取当前 generation；不一致即拒绝。
3. 创建下一份不可变 snapshot；关闭后 readback，校验字节数、SHA-256 与 schema。
4. 只有新 snapshot 完整有效后才替换 generation 对应的备用 index。
5. 读取时校验两个 index，从最高 generation 开始验证 snapshot。最新损坏时回退上一有效状态并
   显示警告；两份都无效时不写磁盘并返回 `RECOVERY_FAILED`。
6. 其他标签页只收到 generation 提醒，随后从权威目录重新读取；活动周或 epoch 已变化时丢弃旧
   async 结果。

目录权限只在用户点击后请求。页面只显示目录名称与 workspace 短 ID，不显示绝对路径。Chrome/
Edge 不支持 FSA 或权限被拒绝时显示可恢复阻断，不回退内存 mock。

## 活动周合同

`activeWeekKey` 是唯一活动周。页面标题、日期范围、Brief、plan revision、候选、内容 workspace、
preview token 与执行输入都绑定该值。切周原子提交并使旧 preview 失效。内容队列始终从活动周的
21 个候选做 left join：已有内容显示版本，其余仍显示待生成；其他周内容不可见。

本地生成一次只接受 1—3 个不同、同周、已锁定且尚无内容包的候选。preview 绑定 week、plan
revision、candidate IDs、repository generation 和 input hash；执行后 token 立即失效。该生成器是
明确的零请求本地结构化草稿路径，不调用 Provider、Search、Fetch、图片或平台。

## W01—W24 证据映射

| 验收    | 自动证据                                                                         |
| ------- | -------------------------------------------------------------------------------- |
| W01—W03 | `tests/web-local-folder.test.ts`：严格首次创建、重选恢复、readback/hash          |
| W04—W06 | 同文件：index 中断、snapshot 损坏回退、双份损坏只读失败                          |
| W07     | 同文件：workspace 身份、路径、写 allowlist、未知 schema                          |
| W08     | 同文件：互斥写锁与上一 generation 保持                                           |
| W09—W12 | `tests/web-workflow.test.tsx`：W34/W35 隔离、21 项队列、切换与重载               |
| W13     | 同文件：上海周日/周一和 ISO 年边界                                               |
| W14     | 同文件：受控延迟旧读取不得覆盖已切换活动周                                       |
| W15—W18 | 同文件：候选/内容选择分离、1—3 分批、token/revision/跨周拒绝、版本恢复           |
| W19—W20 | 同文件：权限拒绝可恢复、不支持 FSA 明确阻断、无 mock fallback                    |
| W21—W22 | 同文件：三项 week identity、invariant 层与诊断敏感信息 allowlist                 |
| W23     | `scripts/run-web-e2e.mjs`：Chrome/Edge、1280/1440、焦点、live region、无溢出     |
| W24     | `tests/web-artifact.test.ts` 与 `scripts/inspect-web-artifact.mjs`：静态闭集检查 |

真实浏览器 CDP smoke 不代替系统目录选择器验证。自动化无法可靠操作原生 picker 时，使用仓库卷
内的隔离临时空目录分别执行一次 Chrome 与 Edge 人工连接 smoke，并在交付报告中明确标记。

## 脱敏诊断

状态中心只导出 app/build identity、浏览器支持、目录显示名、workspace ID 前缀、schema、
generation、snapshot hash 前缀、活动周/plan/content identity、数量、revision、锁状态、pending
writes、最后保存时间和稳定错误摘要。不导出绝对路径、正文、标题、用户字段、凭据、Provider
配置、原始请求/响应或目录文件内容。
