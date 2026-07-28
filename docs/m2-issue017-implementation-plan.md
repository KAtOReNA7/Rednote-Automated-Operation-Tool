# M2 Issue 017 实施计划：Chrome / Edge 浏览器收藏插件

状态：Issue 017 已实施并通过 Chrome/Edge 真实浏览器恢复验收；未进入 Issue 018。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态得到，起始分支为 `main`。
- 起始 HEAD 为 `dcb684aa51195a912382c9d31162c3c8e58f6281`，工作树干净，本地相对
  `origin/main` 领先两个既有提交。
- migration v1—v9、Local API v1、BrowserClipAdapter 预留合同、`clips` 与
  `CLIP_SCREENSHOT` 均由当前代码确认。
- Chrome `150.0.7871.126` 与 Edge `150.0.4078.99` 已在当前 Windows 机器发现。
- 项目卷剩余空间约 193 GiB；临时 profile、fixture 和 ProjectDataRoot 只放在仓库派生的
  `.rednote-temp` 下。

## 本轮目标

1. 在 `apps/clipper` 建立单一源码的 MV3 Chrome/Edge 可侧载包。
2. 仅在用户 action 后采集当前主框架 URL、标题和选中文本；可选 viewport 截图。
3. 复用 Local API 配对和认证，新增四条 BrowserClip/receipt 路由。
4. 追加 migration v10、Clip/receipt/candidate link repository 与截图内容寻址存储。
5. 激活 BrowserClipAdapter 为 `READY / PASSIVE_LOCAL`，候选四项冻结且不创建 Fetch Job。
6. 在桌面应用提供样本列表、详情和按 clipId 的受控截图读取。
7. 通过自动化门禁和 Chrome/Edge 隔离 profile 真实侧载 smoke。

## 固定权限与数据边界

- manifest 权限只有 `activeTab`、`scripting`、`storage`；host permission 只有
  `http://127.0.0.1/*`。
- 无 content script、external messaging、远程代码、`<all_urls>`、`tabs`、Cookie、
  history、webRequest、nativeMessaging、自动滚动或后台采集。
- token 只在 Service Worker 的 `storage.local` 且 access level 为 `TRUSTED_CONTEXTS`。
- screenshot 默认关闭，只在用户点击后调用 `captureVisibleTab`，不进入 SQLite/IPC。
- Local API payload 不含 tab/window/document ID、HTML、header、Cookie、token、路径、
  Fetch、模型、Source 或 Claim。
- Candidate 只复制 URL、有限标题和 provenance，保持
  `LEAD_ONLY / NOT_FETCHED / UNVERIFIED / NOT_A_FACT`。

## 实施与验证顺序

1. 冻结 BrowserClip V1、消息、状态、页面绑定、manifest 和错误合同。
2. 实现 popup、Service Worker、trusted storage、配对恢复、截图和构建/打包。
3. 实现 Local API route、migration v10、repository、存储和 BrowserClipAdapter。
4. 实现桌面只读列表/详情/受控图片协议。
5. 完成 `test:clipper`、90 项 egress、CI、ADR、合同和安装说明。
6. 在真实 Chrome 与 Edge 的隔离 profile 中侧载并完成合成 fixture 流程。
7. 从最新 `npm ci` 开始运行全部门禁，审计后只创建一个本地提交。

## 停止点

- 不访问真实用户页面，不调用真实模型、搜索、Fetch、图片或业务 API，不产生费用。
- 不修改浏览器正式 profile、注册表、策略，不发布商店。
- 不进入 Issue 018，不 push、不创建 PR、不合并。

## 完成回填

- Chrome `150.0.7871.126` 与 Edge `150.0.4078.99` 均使用随机隔离 profile、
  `--remote-debugging-port=0` 和 `Extensions.loadUnpacked` 完成真实侧载。
- fixture 使用 `issue017-fixture.localhost` 回环主机，不匹配扩展唯一的
  `http://127.0.0.1/*` host permission；Chrome 工具栏 action 与 Edge
  `Alt+Shift+Y` 均被真实 activeTab 读取和 viewport 截图证明。
- Chrome 对已认证 GET 省略 `Origin` 的真实行为通过
  `X-Rednote-Extension-Origin` 精确绑定头兼容；存在 Origin 时两者必须一致。
- 两款浏览器分别验证配对、页面字段、nullable metrics、公开确认、可选截图、Clip/receipt、
  被动 Candidate、桌面列表/详情/受控截图、同 capture replay、离线提示与零 Fetch/模型/费用。
- 脱敏机器证据见 `docs/evidence/m2-issue017-real-browser-smoke.json`；恢复 28 项见
  `docs/m2-issue017-recovery-acceptance.md`。
