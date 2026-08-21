# R10C 本地诊断包：实施与验收映射

状态：本地实现与最终门禁已完成，等待本分支的远端 PR、合并与托管 CI 证据。本文只记录当前代码分支可验证的证据，不代表物理介质级保证。

## 实施计划

1. 以闭合 allowlist 构建不含业务正文、凭据、路径或网络配置的诊断摘要。
2. 复用 V2 维护租约、目录 identity 与主进程选择器，在既有 `read` / `mutate` bridge 内完成预览、选择、确认、执行与结果。
3. 在 storage 中创建并重开验证固定两文件、store-only 的 ZIP；失败只清理本次独占创建的文件。
4. 将冻结 Figma 的诊断状态映射到“数据与维护”页，并用聚焦、全量、Electron 响应式与安全回归收口。

## A01—A18 验收映射

| 项                       | 状态 | 证据                                                                                                           |
| ------------------------ | ---- | -------------------------------------------------------------------------------------------------------------- |
| A01 预览零写入           | PASS | `V2DesktopRuntime.#mutateDiagnostics` 与 `r10b-controlled-restore.test.ts` 在确认前断言目录为空。              |
| A02 严格 allowlist       | PASS | `LocalDiagnosticPayload` 的闭合字段、受控类别摘要与 `r10c-local-diagnostics.test.ts`。                         |
| A03 Renderer 只得摘要    | PASS | `V2DiagnosticPreview/View` 仅传类别计数、大小、短摘要与不透明令牌；`v2-persistence.test.tsx`。                 |
| A04 精确 Schema          | PASS | `validateLocalDiagnosticPayload`、`verifyLocalDiagnosticZip` 与固定 `manifest.json` / `diagnostic.json` 测试。 |
| A05 敏感内容 fail-closed | PASS | 未知字段、credential 键、绝对路径及超限值均由 `r10c-local-diagnostics.test.ts` 拒绝。                          |
| A06 固定容量             | PASS | JSON、manifest、ZIP、类别与字符串上限常量及超限回归。                                                          |
| A07 短期一次性调用者绑定 | PASS | 主进程 caller 绑定的 preview、目录、确认、结果令牌；跨调用者与 result replay 回归。                            |
| A08 原生目录选择         | PASS | `V2MaintenanceDirectoryPicker` 的 `DIAGNOSTICS` 分支和 `main.ts` 原生目录对话框。                              |
| A09 维护互斥             | PASS | `#diagnosticRunning` 与既有维护锁的双向阻止分支。                                                              |
| A10 版本化可验证 ZIP     | PASS | store-only ZIP、CRC、SHA-256、中心目录和固定条目独立重开验证。                                                 |
| A11 确认后安全写入       | PASS | exclusive 临时写入、file sync、原子 rename、尽力目录 sync 与 identity 复核。                                   |
| A12 发布后重开验证       | PASS | 发布后重新打开 ZIP 并由 `verifyLocalDiagnosticZip` 校验。                                                      |
| A13 失败结果与清理       | PASS | `FAILED_CLEAN` / `CLEANUP_UNPROVEN` 互斥结果与仅删除本次拥有文件的 identity 检查。                             |
| A14 本地手动导出边界     | PASS | 无上传 transport；选择目录、确认和 `shell.openPath` 均在 Electron main。                                       |
| A15 冻结 UI 状态机       | PASS | `LocalDiagnosticsSettings` 的首页、允许/排除预览、确认、阶段、成功和失败状态；renderer 回归。                  |
| A16 成功操作边界         | PASS | 成功态只提供“复制文件名”和“在资源管理器中显示”，结果令牌单次有效。                                             |
| A17 可访问性与响应式     | PASS | 语义标题、列表、live region、焦点恢复对话框与 V2 renderer / responsive smoke。                                 |
| A18 文档与阶段边界       | PASS | `README.md`、指令索引、本文件和 R10 范围合同；R10D/R10E 未实施。                                               |
