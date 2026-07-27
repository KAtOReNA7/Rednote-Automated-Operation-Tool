# ADR 0006：设置向导与本地凭据引用

- 状态：接受
- 日期：2026-07-27
- 范围：M1 Issue 010
- 固定起点：`a8ba00dc1dd6658984a6803f12fc93733a886bde`

## 背景

桌面壳层、SQLite、持久任务队列和项目数据根已经存在，但应用尚无首次设置流程，也没有安全保存内容 AI 凭据的边界。Issue 010 只建立本地设置基础设施；不验证服务能力，不调用模型或真实 API，不创建任务、模型运行或费用记录。

两项冻结约束继续保持：

1. `ai_disclosure` 默认且只能为 `false`，并且不参与门禁。
2. 版权风险完全不参与门禁、评分、审批和排期。

禁止范围继续包括小红书自动登录、发布、评论、私信、验证码或风控处理，以及开卷数据和盗版电子书处理。

## 决策

### 1. 分层

新增 Electron 无关的 `@mystery-operations/settings` 包，保存领域类型、输入验证、`SettingsService` 和端口：

- 组合提交设置与账号策略的 `SettingsRepository`
- `ProjectLocatorStore`
- `ProjectDataRootService`
- `CredentialStore`
- `DiagnosticReportStore`
- `Clock`

SQLite repository 位于 `packages/db`；ProjectDataRoot locator、诊断写入和 Electron `safeStorage` 适配器位于主进程边界。renderer 只依赖共享 DTO 和固定 preload 方法。

### 2. SQLite 设置记录

追加不可变 migration v4 `local_settings_and_credential_reference`，不修改 v1—v3。

`app_settings` 是 STRICT singleton 表，保存：

- 固定协议 `OPENAI_COMPATIBLE`
- 可空、规范化后的 provider base URL
- 固定非秘密引用 `CONTENT_AI_API_KEY`
- research、writing、review、embedding、image 五个可空模型 ID
- 预警和硬上限整数美分，默认 8000/10000，满足 `warning < hard <= 10000`
- 有限 `setup_state`
- 单调 `revision`
- UTC 时间

表中不保存密钥、ciphertext、环境变量值或数据根绝对路径。设置与 `account_profiles` 在同一 SQLite 事务中提交。账号 ownership 固定为 `PERSONAL`，occupation disclosure 默认 `DEFERRED`，口吻和内容范围采用固定结构。

### 3. 数据根 locator

locator 只位于 Electron `userData` 的应用固定子目录，包含固定 format/version、`activeDataRoot`、`projectInstanceId`、revision 和 `updatedAt`。它是唯一允许保存的数据根绝对路径引用。

启动时总是重新打开 ProjectDataRoot 并核对 marker instance。缺失 locator 进入首次设置；损坏、高版本、目录缺失或 marker 不匹配进入恢复状态，绝不自动覆盖或重建。

目录选择由 main process 的异步原生 dialog 完成，属性固定为 Windows 的 `openDirectory` 和 `dontAddToRecent`。renderer 只获得 displayPath 和短期、单次、绑定 sender/window 的 token。确认数据根采用两阶段流程：先完整准备新根和数据库，再以 expected revision 原子更新 locator；失败时旧根继续 active，不复制、移动、合并或删除旧根。

### 4. 凭据

`CredentialStore` 只有 allowlist 槽位 `CONTENT_AI_API_KEY`，公开状态限定为：

- `NOT_CONFIGURED`
- `CONFIGURED`
- `UNAVAILABLE`
- `CORRUPT`
- `REAUTH_REQUIRED`

Electron 适配器只在 app ready 后、只在 main process 使用 `safeStorage.isAsyncEncryptionAvailable()`、`encryptStringAsync()` 和 `decryptStringAsync()`。不调用 `setUsePlainTextEncryption()`，也不降级为明文。

加密 envelope 位于 `userData` 固定子目录，固定文件名，包含 format、version、slot、ciphertext 和时间。写入经临时文件、文件 sync 和原子替换；locator 在平台支持时再同步目录句柄，Windows 对目录 `fsync` 返回不支持错误时保留文件 sync 加原子 rename 的语义。替换或 re-encrypt 失败时保留旧 blob。数据库只保存固定 credential reference。

`resolveForProvider` 仅为 provider 内部端口，绝不进入 preload、renderer、日志、诊断、任务或错误 DTO。renderer 只能看到状态、可用性、是否需要重新输入和可选更新时间；不显示前缀、后四位、长度、hash、fingerprint、ciphertext、路径或 credential id。

本 Issue 的测试凭据运行时随机生成、明确不可用，不使用常见真实密钥前缀，不打印，不写入仓库或报告。本实现不读取 `.env` 或环境变量中的凭据，不写 `process.env`，不调用真实 API。

### 5. Provider 与预算验证

Base URL 可空；非空时必须是绝对 URL。默认只允许 HTTPS，HTTP 仅允许 `localhost`、`127.0.0.1` 和 `[::1]`。拒绝 user info、query、fragment、控制字符、超长值和非 loopback HTTP；scheme/host 规范化并确定性处理尾随 `/`，允许 base path。不进行 DNS、HTTP、`/models` 或密钥验证。

模型 ID 可空，非空时 trim 并限制长度和控制字符；不硬编码模型、不推断能力。预算从严格美元字符串转换为整数美分，拒绝浮点误差、科学计数、NaN 和 Infinity。

配置完整且有 credential reference 时状态只能是 `PROVIDER_CONFIGURED_UNVERIFIED`，不会产生 `PROVIDER_VERIFIED`。未配置 provider 不妨碍打开和使用本地应用。

### 6. IPC 与 UI

每个能力使用固定 channel 和固定 preload 方法。sender origin 校验保持，输入执行 exact-object、类型、字段、深度和字节限制，多余字段拒绝。只有 `setCredential` 的一次请求可携带 secret；通用日志和错误包装不得观察它。

设置页提供六步中文向导：

1. 数据目录
2. 中转站与模型
3. 密钥状态
4. 预算
5. 账号策略
6. 确认

只完成本地目录也可以退出首次向导。密钥输入是未预填且关闭自动填充的 password input，没有显示、复制、下载或导出功能；保存成功、取消和卸载时清空组件状态与 DOM value。替换和删除需要明确操作，未保存离开需要提示，成功后从持久层重新读取。

其他九个导航页面继续保持既有占位边界。

### 7. 基础诊断

基础诊断仅由用户显式生成。预览采用稳定规范 JSON 和 SHA-256；导出必须提交 expected preview hash，设置变化会使旧预览失效。报告只含有限版本、健康状态、configured 布尔值、预算和设置状态。

导出只写 ProjectDataRoot 的 `exports/diagnostics` 受控目录，不接受任意路径，不生成 ZIP，不上传，不附加日志、数据库或任务。报告排除密钥、ciphertext、credential id、完整 Base URL、绝对路径、用户名、环境变量、请求头、正文、数据库内容和 stack。

## 一致性与失败语义

- 设置和账号资料：单一 SQLite 事务，expected revision 冲突返回 `SETTINGS_REVISION_CONFLICT`。
- 数据根：单独两阶段提交，locator 更新前新根必须完整可用。
- 凭据和 SQLite：无法跨系统原子提交。先验证、加密并安全发布 blob，再写固定引用；数据库失败时新 blob 可成为可检测 orphan，不删除无法确认状态的 blob，也不覆盖旧有效引用。
- 凭据替换后状态刷新失败时重新读取 CredentialStore 状态。
- 诊断：预览 hash 与当前 revision/状态绑定，过期预览拒绝导出。

## 安全与范围后果

- safeStorage 不可用时凭据保存被拒绝，但本地项目仍可用。
- 不新增云服务、远程 vault、keytar、注册表或管理员权限。
- 不引入真实网络请求、模型调用、任务、成本账本或平台动作。
- BrowserWindow、CSP、导航限制和 Electron fuses 不放宽。
- JavaScript 字符串无法保证物理内存清零；本决策只保证不持久化、不回显并及时解除 UI 引用。

## 验证

新增独立 `npm run test:settings`，覆盖 migration v4、repository/service、locator、选择 token、凭据适配器 contract、严格 IPC、React UI、诊断和 30 个 secret egress 目标。Windows Electron source/package smoke 使用临时 `userData` 和 ProjectDataRoot，验证真实 safeStorage roundtrip、状态与清除，同时验证外部请求和进程树 TCP 连接均为 0。

既有 `test:constraints`、`test:db`、`test:queue`、`test:desktop`、`test:storage`、全量测试、build、package 和 audit 门禁全部保留。
