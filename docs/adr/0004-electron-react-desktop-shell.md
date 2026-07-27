# ADR-0004：安全 Electron React 桌面壳

- 状态：接受
- 日期：2026-07-27
- 范围：M1 Issue 006

## 背景

Issue 007 已建立 `node:sqlite` 迁移基础，Issue 009 已建立持久化本地任务队列。本 Issue 只把这些基础接入一个 Windows 本地桌面运行时，并提供十个导航入口的 React 占位壳；它不实现书库、研究、内容、审批、发布、设置、本地 API、模型、搜索、图片、OCR 或平台操作。

## 版本与支持周期

采用精确版本 `electron@43.2.0`，内置 Chromium `150.0.7871.129`、Node.js `24.18.0`、V8 `15.0.1240245`。Electron 43 是实施日的稳定、受支持发布线，官方计划于 2027-01-05 结束支持。未固定旧提案中的 Electron 36/37，也未选择 38—40，因为这些发布线已结束支持；未使用 beta、nightly 或 canary。

所有 npm 依赖均在 `package-lock.json` 中精确解析。Windows 目录打包采用 Electron 官方维护的 `@electron/packager@20.0.4`，fuse 写入采用 `@electron/fuses@2.1.3`。没有采用当前稳定 Forge，是因为其构建期传递依赖在实施日无法通过仓库要求的零漏洞审计；替代方案只生成目录，不生成安装器、签名、更新或发布。

## 进程边界

- `main`：唯一可信桌面进程。创建窗口、限制会话、注册本地 `rednote://app` 协议、保存非敏感窗口状态，并运行短时临时基础自检。
- `preload`：在 sandbox 和 context isolation 下只暴露 `getAppInfo`、`getRuntimeCapabilities`、`getFoundationHealth`、`getWindowState` 四个无参数只读方法。
- `renderer`：React 页面，只依赖浏览器能力和共享 DTO；不导入 Electron、Node、数据库或队列实现。
- `packages/core`、`packages/db`、`packages/workflows`：继续保持 Electron 无关。Issue 007/009 的迁移、仓储和状态机没有为桌面层重写。

IPC 使用固定 channel 常量；每个 handler 拒绝参数，核验 `senderFrame` 的协议、主机和端口，并只返回有限 DTO。错误只返回稳定代码和用户可读摘要，不返回 stack、环境变量、完整路径、SQL、payload 或密钥。renderer 无法取得原始 `ipcRenderer`。

## 窗口和页面安全

`BrowserWindow` 显式设置：

- `nodeIntegration: false`
- `nodeIntegrationInWorker: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`
- `webviewTag: false`
- packaged production 中 `devTools: false`

应用使用单实例锁和 `ready-to-show`。第二实例只恢复并聚焦已有窗口。窗口 bounds 和 maximized 状态以最小 JSON 原子写入 `userData`；损坏状态回退，屏幕外坐标被校正，中文和空格路径有回归测试。状态文件不含业务数据、路径、凭据或队列内容。

production 只从打包进 `app.asar` 的 `rednote://app` 资源读取页面。development 可显式使用同端口的 `127.0.0.1` Vite URL。所有新窗口、外部导航、重定向、webview、设备权限、普通权限和非同端资源请求默认拒绝；没有 `shell.openExternal`。CSP 仅允许 self 脚本和样式，并禁用 object、frame、base、form、worker、manifest 和 media；没有 `unsafe-eval`、`unsafe-inline`、CDN 或远程字体。

## Electron fuses

打包后严格写入并回读全部 V1 fuses。关键策略为：

- `RunAsNode`：关闭；
- `EnableNodeOptionsEnvironmentVariable`：关闭；
- `EnableNodeCliInspectArguments`：关闭；
- `EnableEmbeddedAsarIntegrityValidation`：开启；
- `OnlyLoadAppFromAsar`：开启；
- `GrantFileProtocolExtraPrivileges`：关闭。

同时开启 cookie encryption 和 Wasm trap handlers。标准发行包不含 browser-process 专用 V8 snapshot，因此显式关闭该可选 fuse；真实 packaged executable smoke 验证启动成功和关键 fuse 状态。

## 基础设施自检与 utility process

启动自检只在系统临时目录（含中文和空格的测试路径）创建数据库，验证 Electron main 中的 `DatabaseSync`、`backup`、timeout、foreign keys、WAL、现有迁移，以及一次入队、领取、完成、关闭和重开。完成后递归清理临时目录。它不打开正式 data root、不接触用户业务数据库、不注册真实 handler，也不启动 `JobWorker`。

短小、一次性的启动自检保留在 main，以避免为毫秒级检查引入额外进程协议。未来任何长任务、模型调用、搜索、图片/OCR 或持续 JobWorker 应在其各自 Issue 中优先使用 Electron `utilityProcess`，并继续让数据库/工作流代码保持 Electron 无关。本 Issue 不确定正式 data root，因为其归属 Issue 008；提前确定会越过依赖顺序并形成未经授权的数据迁移承诺。

## 打包与验收

Vite 分别构建 main、preload 和 renderer；packager 的临时 stage 只包含这些构建物和最小 package manifest，最终只产生 Windows x64 目录。源码 Electron smoke 和 packaged executable smoke 均启动真实 Electron，经过四项 preload API 驱动 renderer 回报，并验证临时 SQLite/队列流程。smoke 只写安全 JSON，以 0/非 0 表示成功/失败并清理临时报告。

## 影响

- 桌面进程具备最小、可审计、默认拒绝的边界。
- 十个页面都是明确占位，不展示伪数据或越权入口。
- runtime 不监听 TCP，不发出外网请求，不需要密钥，不产生模型费用。
- `ai_disclosure` 继续默认关闭且不参与门禁；版权继续不参与门禁、评分、审批、优先级或排期。
