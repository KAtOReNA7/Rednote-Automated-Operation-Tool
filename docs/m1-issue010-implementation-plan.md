# M1 Issue 010 文件级实施计划

状态：已完成并按本文件实施；未进入 Issue 011。

固定起点：`a8ba00dc1dd6658984a6803f12fc93733a886bde`

## 范围

只实现设置向导、本地数据根 locator、非秘密设置持久化、本地凭据引用、基础诊断和对应 IPC/UI/测试。不会进入 Issue 011；不会调用真实 API、读取或配置真实密钥、创建模型运行/费用/任务，也不会实现任何小红书平台动作。

## 文件计划

### 文档

- `docs/adr/0006-settings-and-local-credential-reference.md`
  - 冻结分层、safeStorage、locator、事务、失败与诊断语义。
- `docs/m1-issue010-acceptance-map.md`
  - 逐项覆盖 160 条验收行为。
- `docs/m1-issue010-implementation-plan.md`
  - 本文件；完成后回填实际实现。

### Electron 无关设置领域包

- `packages/settings/package.json`
- `packages/settings/tsconfig.json`
- `packages/settings/src/contracts.ts`
  - DTO、有限状态、端口和稳定错误码。
- `packages/settings/src/validation.ts`
  - Base URL、模型 ID、预算、账号策略和 exact-object 输入验证。
- `packages/settings/src/settings-service.ts`
  - 读取、expected revision 更新、凭据编排、诊断预览与 setup state。
- `packages/settings/src/diagnostics.ts`
  - 有限字段预览、规范序列化、稳定 hash 与过期保护。
- `packages/settings/src/index.ts`
  - 显式导出。

### SQLite

- `packages/db/src/migrations.ts`
  - 只追加 immutable v4；v1—v3 不改。
- `packages/db/src/settings-repository.ts`
  - singleton settings、账号策略和同事务 expected-revision 更新。
- `packages/db/src/index.ts`
  - 显式导出。
- `packages/db/package.json`
- `packages/db/tsconfig.json`
  - 声明对 settings package 的依赖和 project reference。

### ProjectDataRoot 与 locator/诊断

- `packages/storage/src/project-locator.ts`
  - 固定 userData 子目录、版本化格式、marker 校验、原子 revision 写入。
- `packages/storage/src/diagnostic-report-store.ts`
  - 只写 `exports/diagnostics`，净化文件名并原子发布。
- `packages/storage/src/index.ts`
  - 显式导出。

### 共享桌面契约

- `packages/shared/src/desktop-api.ts`
  - 固定设置 IPC channels、request/response DTO 和 bridge 方法。

### Electron main/preload

- `apps/desktop/src/credential-store.ts`
  - main-only safeStorage adapter、固定槽位、envelope、原子替换/re-encrypt/clear。
- `apps/desktop/src/data-root-selection.ts`
  - 原生目录选择和绑定窗口/sender 的短期单次 token。
- `apps/desktop/src/settings-runtime.ts`
  - userData 固定路径、locator、数据库/repository/service 生命周期。
- `apps/desktop/src/ipc-policy.ts`
  - per-method strict schema、大小和敏感字段拒绝。
- `apps/desktop/src/ipc.ts`
  - 固定 handlers、稳定错误 DTO 和销毁清理。
- `apps/desktop/src/preload.ts`
  - 一方法一 channel，不暴露 raw IPC。
- `apps/desktop/src/foundation-health.ts`
  - schema v4 期望值，不增加真实外部行为。
- `apps/desktop/src/smoke-report.ts`
  - 只扩展安全布尔/枚举/计数。
- `apps/desktop/src/main.ts`
  - app ready 后组装设置 runtime，source/package smoke 执行临时隔离的 safeStorage 设置生命周期。

### React UI

- `apps/web-ui/src/settings-page.tsx`
  - 六步向导、持久设置页、显式替换/删除、loading/empty/error/conflict/unavailable。
- `apps/web-ui/src/use-settings.ts`
  - bridge 读取和事件驱动的刷新；不保存 secret。
- `apps/web-ui/src/app.tsx`
  - 仅 `/settings` 替换占位；其他九页保持。
- `apps/web-ui/src/styles.css`
  - 可见 focus、表单、步骤、错误和响应式布局。

React 实现遵循本轮已读取的 React best-practices skill：可推导状态在 render 中计算，用户操作放在 event handler，异步更新使用函数式 state，secret 不进入浏览器持久存储。

### 测试与 CI

- `tests/settings-schema.test.ts`
- `tests/settings-service.test.ts`
- `tests/settings-locator-picker.test.ts`
- `tests/settings-credential-store.test.ts`
- `tests/settings-ipc.test.ts`
- `tests/settings-renderer.test.tsx`
- `tests/settings-diagnostics.test.ts`
- `tests/settings-secret-egress.test.ts`
- `tests/settings-architecture.test.ts`
  - 覆盖 Node、SQLite、React、架构与 secret egress。
- 既有 DB/desktop/storage 测试
  - 更新最新 schema 版本和“九个而非设置页”的占位断言，断言不削弱。
- `package.json`
  - 新增独立 `test:settings`，保留全部既有脚本。
- `.github/workflows/ci.yml`
  - Windows required job 新增 settings gate，保留全部旧 gate。
- `scripts/run-electron-smoke.mjs`
- `scripts/run-packaged-smoke.mjs`
  - 验证设置 smoke 的安全结果、外部请求 0、package TCP 0；不输出随机 secret。

## 实现顺序

1. 文档和 160 项映射草案。
2. migration v4、领域契约、验证、repository 和 service。
3. locator、受控诊断写入和 fake-port 单元测试。
4. safeStorage adapter、selection token、IPC/preload。
5. React 六步向导与设置页。
6. Electron source/package smoke 和 secret egress。
7. 回填验收映射实际证据。
8. `npm ci` 后运行全部规定门禁。
9. 仅在全部通过且工作树符合范围时创建本地提交。

## 实际结果

- 新增 migration v4 `local_settings_and_credential_reference`，SHA-256 为 `c84c82c50f2170c20154c754d0604319082c6683737624a9c14d3a508315471c`；v1—v3 校验和不变。
- `LocalProjectLocator` 和 `DesktopSettingsRuntime` 实现目录选择 token、marker 身份核对、expected revision 和两阶段切换；Windows 不支持目录句柄 `fsync` 时保留文件 `sync` 加原子 rename 的平台语义。
- `ElectronCredentialStore` 只在 main process 使用异步 safeStorage；真实 Windows source/package smoke 已完成加密、解密、状态、清除和 egress 检查。
- 设置页实现六个步骤，敏感输入不预填、不显示、不复制、不导出，并在保存、取消和卸载时清理。
- `test:settings` 为 9 个文件、97/97；全量为 39 个文件、447/447，既有 350 项未减少。
- 本地 Windows 等价 CI 全部门禁通过；GitHub 托管 CI 尚未运行，不能声称已通过。

## 不变量

- v1/v2/v3 migration 内容和 SHA-256 不变。
- 不降低任何既有断言，不跳过失败测试。
- 不记录、打印或 fixture 化测试 secret。
- 不读取环境凭据或 `.env`。
- 不发真实网络请求。
- 不添加 Issue 011 或更晚里程碑能力。
