# M1 Issue 011 文件级实施计划

状态：实现与验收映射已完成；严格停留在 Issue 011。

固定起点：`aab11d793021ac4f97dcf134d325be4576b5e9da`

## 开工核验

- 开始时目录为 `D:\porject\rednote`，分支为 `main`，HEAD 精确匹配固定起点，工作树干净且无远端。
- `b01785f → 891f680 → 4438f23 → eb9ac8a → a8ba00d → aab11d7` 的祖先顺序逐项通过。
- 仓库没有 `AGENTS.md`。
- 已在移动本指令之外的任何修改前，搜索完整错误探针
  `console.log(JSON.stringify(process.versions)); process.exit(0)`、有意义片段、
  `electron(.cmd/.exe) -e` 和 `Unable to find Electron app`。
- 已提交历史中不存在把裸 JavaScript 字符串作为 Electron app 路径的调用；
  `process.versions` 只用于 Electron main 中正常读取运行时版本。
- 修改前 `npm run test:electron-smoke` 与 `npm run test:packaged-smoke` 均正常退出且通过，
  没有再次出现 “Unable to find Electron app”；结束后无 Electron/Rednote 进程或 listener。
- 结论：Issue 010 弹窗来自未提交的临时错误命令，不修改或改写 Issue 010 历史。

## 范围

只实现：

- Electron main 内部、显式绑定 `127.0.0.1` 的原生 `node:http` 服务；
- 默认关闭、用户可配置的固定端口；
- 仅内存 pairing session、插件自行生成的长期 token、SQLite SHA-256 digest；
- 严格 Host、remote address、Origin、CORS、请求体、header、timeout、连接和限流策略；
- migration v5、设置与客户端 repository；
- Electron main 生命周期、窄 IPC/preload 和设置页管理区；
- source/packaged Windows 真实 loopback smoke、专项测试、CI、ADR、合同和验收映射。

明确不实现 Issue 012、013、014、017，不实现 Manifest V3 插件、样本保存、任何业务路由、
模型/搜索/图片/OCR/生成、云服务或小红书平台动作；不读取真实密钥，不调用真实 API，
不产生费用。

## 文件计划

### 文档

- `docs/adr/0007-local-loopback-api-and-plugin-authentication.md`
  - 冻结 listener、认证、生命周期、SQLite 和进程边界。
- `docs/contracts/local-api-v1.md`
  - 固定六条 method/route、DTO、CORS 和错误合同。
- `docs/m1-issue011-acceptance-map.md`
  - 逐项保留并映射 180 项验收。
- `docs/m1-issue011-implementation-plan.md`
  - 本文件；完成后回填实际门禁与提交结果。

### Electron 无关 local API 包

- `packages/local-api/package.json`
- `packages/local-api/tsconfig.json`
- `packages/local-api/src/contracts.ts`
- `packages/local-api/src/origin-policy.ts`
- `packages/local-api/src/request-policy.ts`
- `packages/local-api/src/pairing-session.ts`
- `packages/local-api/src/authenticator.ts`
- `packages/local-api/src/rate-limiter.ts`
- `packages/local-api/src/router.ts`
- `packages/local-api/src/server.ts`
- `packages/local-api/src/index.ts`

只使用 Node 内置 `http`、`net` 和 `crypto`，不新增 HTTP/WebSocket runtime 依赖。

### SQLite

- `packages/db/src/migrations.ts`
  - 只追加 immutable v5 `local_loopback_api_and_plugin_clients`；v1—v4 不改。
- `packages/db/src/local-api-repository.ts`
  - settings expected revision、active-client 上限、origin 轮换、digest 认证、撤销和节流。
- `packages/db/src/index.ts`
- `packages/db/package.json`
- `packages/db/tsconfig.json`

### 共享桌面合同

- `packages/shared/src/local-api-contracts.ts`
- `packages/shared/src/desktop-api.ts`
- `packages/shared/src/index.ts`

只公开有限状态、短期 pairing code、client 公共字段和稳定错误 DTO；不公开长期 token/digest。

### Electron main/preload

- `apps/desktop/src/local-api-runtime.ts`
  - ProjectDataRoot 就绪检查、listener 组装、两阶段端口切换、配对和客户端撤销。
- `apps/desktop/src/settings-runtime.ts`
  - 暴露当前 active project 所需的受控 DB/repository 生命周期。
- `apps/desktop/src/ipc-policy.ts`
- `apps/desktop/src/ipc.ts`
- `apps/desktop/src/preload.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/foundation-health.ts`
- `apps/desktop/src/smoke-report.ts`

### React 设置页

- `apps/web-ui/src/settings-page.tsx`
- `apps/web-ui/src/local-api-settings.tsx`
- `apps/web-ui/src/styles.css`
- `apps/web-ui/src/app.tsx`

采用派生状态、事件处理器和函数式更新；pairing code 只保存在组件内存，取消、超时、
卸载或服务停止时清空，不进入 browser storage、URL、日志或诊断。

### 测试、smoke 与 CI

- `tests/local-api-schema.test.ts`
- `tests/local-api-binding.test.ts`
- `tests/local-api-host-origin-cors.test.ts`
- `tests/local-api-request-limits.test.ts`
- `tests/local-api-pairing-auth.test.ts`
- `tests/local-api-rate-limit.test.ts`
- `tests/local-api-lifecycle.test.ts`
- `tests/local-api-ipc.test.ts`
- `tests/local-api-renderer.test.tsx`
- `tests/local-api-secret-egress.test.ts`
- `tests/local-api-architecture.test.ts`
- `tests/support/local-api-test-utils.ts`
- `scripts/run-electron-smoke.mjs`
- `scripts/run-packaged-smoke.mjs`
- `package.json`
- `.github/workflows/ci.yml`
- TypeScript/Vite/Vitest workspace配置

测试使用真实临时 SQLite 和真实 `node:http` loopback listener；token/pairing code 只在运行时
由 `crypto.randomBytes` 生成，不打印、不 fixture 化。

## 实现顺序

1. 开工核验、计划和 180 项映射草案。
2. ADR、HTTP v1 合同、migration v5 与 repository。
3. local-api 合同、策略、pairing、auth、限流、router 和 server。
4. Electron runtime、生命周期、IPC 与 preload。
5. 设置页管理区、诊断有限状态和敏感短期状态清理。
6. 专项测试和 source/packaged smoke 两态 TCP 断言。
7. 回填 ADR、合同、计划和验收映射。
8. 从 `npm ci` 开始执行全部 17 项最终门禁。
9. 仅在失败/skip/todo/漏洞均为 0 且范围检查通过后创建一个本地提交。

## 冻结不变量

- `ai_disclosure` 默认且只能为 `false`，不参与本地 API、认证或任何门禁。
- 版权不进入字段、route、header、错误、评分、审批、优先级或排期。
- v1—v4 migration 原文、名称和 SHA-256 不变。
- renderer 不直接使用 HTTP，不接收长期 token/digest，不传 bind host 或 origin allowlist。
- listener 只能显式绑定 `127.0.0.1`/IPv4，不能扫描端口或退化到其他地址。
- 不降低 BrowserWindow、CSP、导航或 fuses。
- 不删除、skip、todo 或削弱既有测试。
- 不配置远端，不 push，不创建 PR，不合并，不进入 Issue 012。

## 最终结果

- migration v5 名称为 `local_loopback_api_and_plugin_clients`，SHA-256 为
  `88c29c6160122eea91dc8f3b88c0cd0aafc58f91c3cfd6bcfdd2020209f6d808`；v1—v4
  校验和保持不变。
- `test:local-api` 覆盖 11 个测试文件、126 个测试；全量 `test` 覆盖 50 个测试文件、
  585 个测试；失败、skip、todo 均为 0。
- source 与 packaged smoke 均验证 disabled listener 为 0、enabled listener 精确为一个
  `127.0.0.1` IPv4 listener、外部连接为 0，并在退出后释放端口和进程。
- 未新增 HTTP/WebSocket runtime 依赖；依赖审计漏洞为 0。
- 180/180 项验收均保留独立编号并有行为证据；最终门禁记录和本地提交 SHA 由最终报告提供。
