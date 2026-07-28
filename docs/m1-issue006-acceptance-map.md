# M1 Issue 006 验收映射

本表逐项对应 Issue 006 的 105 项最低测试矩阵。证据只使用仓库检查、合成数据、临时 SQLite 文件和真实本地 Electron 进程，不访问真实 API，不产生费用。路线图改动只是把剩余依赖顺序修正为 `006 → 008 → 010 → 011`；它不改变 PRD、Issue 内容、依赖或验收标准。

| 编号 | 验收行为                                 | 自动化或检查证据                                                                                              |
| ---: | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
|    1 | 固定起点 HEAD 正确                       | 开工检查：`4438f237729ee68a4631d5068fcbc3ec1a8f200c`                                                          |
|    2 | 历史迁移 SHA-256 不变                    | `tests/db-migrations.test.ts`；完工 Git diff/hash复核                                                         |
|    3 | `test:constraints` 通过                  | `npm run test:constraints`                                                                                    |
|    4 | `test:db` 通过                           | `npm run test:db`                                                                                             |
|    5 | `test:queue` 通过                        | `npm run test:queue`                                                                                          |
|    6 | 路线图顺序修正仅改变对应文档段落         | `git diff -- docs/product/xiaohongshu-development-roadmap-v1.md`                                              |
|    7 | 选择受支持的稳定 Electron                | `docs/adr/0004-electron-react-desktop-shell.md`；Electron 官方发布与支持周期                                  |
|    8 | Electron 版本精确锁定                    | `package.json`、`package-lock.json`、`tests/desktop-architecture.test.ts`                                     |
|    9 | 不使用 beta/nightly/canary               | `tests/desktop-architecture.test.ts`；锁定 `43.2.0`                                                           |
|   10 | 不使用 EOL 36—40                         | `docs/adr/0004-electron-react-desktop-shell.md`                                                               |
|   11 | 记录内置 Node/Chromium/V8                | `docs/adr/0004-electron-react-desktop-shell.md`                                                               |
|   12 | 实际 Electron runtime 版本等于锁定版本   | `npm run test:electron-smoke`、`npm run test:packaged-smoke`                                                  |
|   13 | `nodeIntegration=false`                  | `tests/desktop-security.test.ts`                                                                              |
|   14 | `nodeIntegrationInWorker=false`          | `tests/desktop-security.test.ts`                                                                              |
|   15 | `contextIsolation=true`                  | `tests/desktop-security.test.ts`                                                                              |
|   16 | `sandbox=true`                           | `tests/desktop-security.test.ts`                                                                              |
|   17 | `webSecurity=true`                       | `tests/desktop-security.test.ts`                                                                              |
|   18 | `allowRunningInsecureContent=false`      | `tests/desktop-security.test.ts`                                                                              |
|   19 | `webviewTag=false`                       | `tests/desktop-security.test.ts`                                                                              |
|   20 | Production devTools 默认关闭             | `tests/desktop-security.test.ts`、packaged smoke                                                              |
|   21 | Renderer 无 `require`                    | `tests/desktop-architecture.test.ts`                                                                          |
|   22 | Renderer 无直接 `ipcRenderer`            | `tests/desktop-architecture.test.ts`                                                                          |
|   23 | Renderer 无 Node fs                      | `tests/desktop-architecture.test.ts`                                                                          |
|   24 | Renderer 无 `process.env`                | `tests/desktop-architecture.test.ts`                                                                          |
|   25 | Renderer 无数据库访问                    | `tests/desktop-architecture.test.ts`                                                                          |
|   26 | Renderer 无 `JobQueueRepository`         | `tests/desktop-architecture.test.ts`                                                                          |
|   27 | contextBridge API 存在                   | `apps/desktop/src/preload.ts`、Electron smoke                                                                 |
|   28 | 只暴露允许的只读 API                     | `tests/desktop-contracts.test.ts`、`tests/desktop-architecture.test.ts`                                       |
|   29 | 不暴露任意 channel                       | `tests/desktop-contracts.test.ts`                                                                             |
|   30 | `senderFrame` 来源验证                   | `apps/desktop/src/ipc.ts`、`tests/desktop-contracts.test.ts`                                                  |
|   31 | 非法 origin 被拒绝                       | `tests/desktop-contracts.test.ts`、`tests/desktop-security.test.ts`                                           |
|   32 | 非法参数被拒绝                           | `tests/desktop-contracts.test.ts`                                                                             |
|   33 | 错误不泄露 stack                         | `tests/desktop-contracts.test.ts`                                                                             |
|   34 | 返回值不泄露完整路径                     | `tests/desktop-contracts.test.ts`；两项 smoke 的安全 JSON                                                     |
|   35 | Production 只加载本地应用                | `apps/desktop/src/main.ts`；packaged smoke                                                                    |
|   36 | `will-navigate` 拒绝外部导航             | `apps/desktop/src/security-policy.ts`、`tests/desktop-security.test.ts`                                       |
|   37 | `window.open` 默认拒绝                   | `apps/desktop/src/security-policy.ts`、`tests/desktop-architecture.test.ts`                                   |
|   38 | permission request 默认拒绝              | `apps/desktop/src/security-policy.ts`                                                                         |
|   39 | permission check 默认拒绝                | `apps/desktop/src/security-policy.ts`                                                                         |
|   40 | webview 不可用                           | `apps/desktop/src/security-policy.ts`、`tests/desktop-architecture.test.ts`                                   |
|   41 | 拖放 URL 不触发导航                      | 所有导航统一经过 `will-navigate` 默认拒绝策略                                                                 |
|   42 | Production 有 CSP                        | `apps/web-ui/index.html`、`tests/desktop-architecture.test.ts`                                                |
|   43 | `script-src` 不含 `unsafe-eval`          | `tests/desktop-architecture.test.ts`                                                                          |
|   44 | `object-src none`                        | `tests/desktop-architecture.test.ts`                                                                          |
|   45 | `frame-src none`                         | `tests/desktop-architecture.test.ts`                                                                          |
|   46 | `base-uri none`                          | `tests/desktop-architecture.test.ts`                                                                          |
|   47 | 不加载 CDN                               | `tests/desktop-architecture.test.ts`                                                                          |
|   48 | 不加载远程字体                           | CSP、系统字体栈、`tests/desktop-architecture.test.ts`                                                         |
|   49 | 单实例锁生效                             | `apps/desktop/src/main.ts`：`requestSingleInstanceLock`                                                       |
|   50 | 第二实例不创建第二窗口                   | `apps/desktop/src/main.ts` 的锁失败分支                                                                       |
|   51 | 第二实例激活已有窗口                     | `apps/desktop/src/main.ts` 的 `second-instance` 处理                                                          |
|   52 | `ready-to-show` 后显示                   | `apps/desktop/src/main.ts`                                                                                    |
|   53 | 主窗口关闭后正常退出                     | `window-all-closed` 处理；Electron smoke 正常退出                                                             |
|   54 | 退出时连接关闭                           | 临时数据库在 `finally` 关闭；没有常驻数据库连接                                                               |
|   55 | 不自动启动 `JobWorker`                   | `tests/desktop-architecture.test.ts`                                                                          |
|   56 | 默认窗口尺寸正确                         | `tests/desktop-window-state.test.ts`                                                                          |
|   57 | bounds 保存与恢复                        | `tests/desktop-window-state.test.ts`                                                                          |
|   58 | maximized 保存与恢复                     | `tests/desktop-window-state.test.ts`                                                                          |
|   59 | 损坏文件回退                             | `tests/desktop-window-state.test.ts`                                                                          |
|   60 | 屏幕外坐标被纠正                         | `tests/desktop-window-state.test.ts`                                                                          |
|   61 | 最小尺寸约束                             | `apps/desktop/src/main.ts`、`tests/desktop-window-state.test.ts`                                              |
|   62 | 中文/空格 userData 路径                  | `tests/desktop-window-state.test.ts`                                                                          |
|   63 | 原子写入                                 | `renameSync` 实现及 `tests/desktop-window-state.test.ts`                                                      |
|   64 | 窗口状态不含敏感数据                     | 最小 schema 及 `tests/desktop-window-state.test.ts`                                                           |
|   65 | 十个中文导航入口存在                     | `tests/desktop-renderer.test.tsx`                                                                             |
|   66 | 各占位页面可到达                         | `tests/desktop-renderer.test.tsx` 的十路由矩阵                                                                |
|   67 | 当前路由高亮                             | `tests/desktop-renderer.test.tsx`                                                                             |
|   68 | 404 页面                                 | `tests/desktop-renderer.test.tsx`                                                                             |
|   69 | Error Boundary                           | `tests/desktop-renderer.test.tsx`                                                                             |
|   70 | Foundation health 状态                   | renderer 测试、Electron smoke                                                                                 |
|   71 | 键盘导航                                 | `tests/desktop-renderer.test.tsx`                                                                             |
|   72 | 可见焦点                                 | `styles.css` 的 `:focus-visible` 及 renderer 测试                                                             |
|   73 | 不展示伪造业务数据                       | 明确空状态；`tests/desktop-architecture.test.ts`                                                              |
|   74 | 不提供发布按钮                           | `tests/desktop-renderer.test.tsx`、架构检查                                                                   |
|   75 | 不提供密钥输入                           | renderer DOM/源码检查                                                                                         |
|   76 | 不提供平台登录                           | renderer DOM/源码检查、禁止范围测试                                                                           |
|   77 | 实际 Electron main 可加载 `node:sqlite`  | 两项真实 Electron smoke                                                                                       |
|   78 | `DatabaseSync` 可用                      | `runFoundationHealthCheck`、两项 smoke                                                                        |
|   79 | `backup` API 可用                        | `runFoundationHealthCheck`、两项 smoke                                                                        |
|   80 | timeout 可用                             | `assertSqliteRuntimeCapabilities`、两项 smoke                                                                 |
|   81 | `foreign_keys` 可用                      | `runFoundationHealthCheck`、两项 smoke                                                                        |
|   82 | WAL 可用                                 | `runFoundationHealthCheck`、两项 smoke                                                                        |
|   83 | 临时数据库迁移通过                       | `runFoundationHealthCheck`、两项 smoke                                                                        |
|   84 | 临时队列入队/领取/完成通过               | `runFoundationHealthCheck`、两项 smoke                                                                        |
|   85 | 数据库关闭重开通过                       | `runFoundationHealthCheck`、两项 smoke                                                                        |
|   86 | smoke 临时文件清理                       | `finally` 清理、smoke runner 清理                                                                             |
|   87 | production renderer build 通过           | `npm run build:desktop`、`npm run build`                                                                      |
|   88 | Electron package 通过                    | `npm run package:desktop`                                                                                     |
|   89 | packaged app 启动通过                    | `npm run test:packaged-smoke`                                                                                 |
|   90 | packaged app `node:sqlite` smoke 通过    | `npm run test:packaged-smoke`                                                                                 |
|   91 | package 不含 `.env`                      | package stage 只复制 `.vite` 和最小 manifest                                                                  |
|   92 | package 不含测试 fixture                 | package stage 只复制 `.vite` 和最小 manifest                                                                  |
|   93 | package 不含用户数据库                   | package stage 只复制 `.vite` 和最小 manifest                                                                  |
|   94 | package 不含密钥                         | package stage 只复制 `.vite` 和最小 manifest                                                                  |
|   95 | Fuses 状态正确                           | 打包后回读断言、`npm run test:packaged-smoke`                                                                 |
|   96 | Production 不监听 TCP 端口               | packaged smoke 检查整个进程树的 Windows TCP 连接表为 0                                                        |
|   97 | Production 不发出 runtime 网络请求       | session 运行时审计 `externalRequestAttempts=0`；本地协议直接读取 asar 资源                                    |
|   98 | 无自动更新                               | `tests/desktop-architecture.test.ts`、依赖清单                                                                |
|   99 | 无云服务                                 | `tests/forbidden-scope.architecture.test.ts`                                                                  |
|  100 | 无真实模型/API 调用                      | 依赖/源码审查、真实 smoke                                                                                     |
|  101 | 无小红书平台动作                         | `tests/forbidden-scope.architecture.test.ts`                                                                  |
|  102 | 无开卷                                   | `tests/forbidden-scope.architecture.test.ts`                                                                  |
|  103 | 无盗版电子书处理                         | `tests/forbidden-scope.architecture.test.ts`                                                                  |
|  104 | `ai_disclosure` 规则不变                 | `tests/hard-constraints.test.ts`、`tests/db-hard-constraints.test.ts`                                         |
|  105 | 版权不参与门禁、评分、审批、优先级或排期 | `tests/hard-constraints.test.ts`、`tests/db-hard-constraints.test.ts`、`tests/queue-hard-constraints.test.ts` |

补充运行时证据：

- `npm run test:electron-smoke` 启动源码构建的真实 Electron 主进程和隐藏 BrowserWindow。
- `npm run test:packaged-smoke` 直接启动打包后的 `RednoteMysteryOperations.exe`，不是用 Node 替代应用运行。
- 两项 smoke 的报告只包含布尔状态、固定版本与计数，不包含完整路径、环境变量、stack、SQL、payload 或密钥。
