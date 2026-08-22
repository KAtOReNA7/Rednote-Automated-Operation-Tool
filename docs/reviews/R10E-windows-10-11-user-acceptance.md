# R10E Windows 10 / Windows 11 人工候选验收

状态：Windows 10 `NOT_RUN`；Windows 11 `NOT_RUN`。本文件不得由 CI 或 Codex 预填 PASS。

候选版本：`0.1.0-beta.1`  
候选 ZIP：`RednoteStudio-0.1.0-beta.1-r10e-rc.zip`

## 填写规则

- 两个平台必须使用不同的干净快照或新测试用户，证据彼此独立。
- 每项填写实际结果、失败码及截图/日志引用；未执行保持 `NOT_RUN`。
- 任一必需项失败时，该平台最终结论为 `FAIL`，停止后续破坏性步骤并保留数据。
- Windows Server runner、兼容模式、容器或 CI 结果不能代替本表。
- 只使用合成数据；不提供真实密钥，不调用真实模型或小红书平台。

## Windows 10

### 环境与候选身份

- 平台状态：`NOT_RUN`
- OS edition：`NOT_RUN`
- OS build：`NOT_RUN`
- 架构 x64：`NOT_RUN`
- 机器 / VM：`NOT_RUN`
- 干净快照或新测试用户：`NOT_RUN`
- 测试时间与时区：`NOT_RUN`
- 候选 ZIP SHA-256：`NOT_RUN`
- beta.1 安装器 SHA-256：`NOT_RUN`
- beta.0 TEST-ONLY 安装器 SHA-256：`NOT_RUN`

### 同构验收项

- [ ] `NOT_RUN` W10-01 外层 ZIP checksum 与 Draft Release 一致；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-02 包内闭集及逐文件 checksum 完整，无增项/漏项；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-03 全程离线，无自动更新或后台下载；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-04 以普通用户完成每用户干净安装，无管理员权限；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-05 首次启动成功，V2 与本地数据根初始化正常；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-06 合成账号、计划、内容、互动、指标与只读书库工作流完成；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-07 TEST-ONLY beta.0 创建合成数据后手动升级 beta.1，数据保留；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-08 应用运行时升级被确定性阻断，关闭后可升级；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-09 应用运行时卸载被确定性阻断，关闭后可卸载；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-10 损坏的安装器副本安全失败，旧版本和数据保持；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-11 卸载移除应用/快捷方式并默认保留数据；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-12 重装同一 beta.1 后读取保留的合成数据；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-13 受控备份成功，同版本恢复成功，降级/未知恢复拒绝；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-14 诊断预览后手动导出脱敏两文件 ZIP，未自动上传；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W10-15 最终卸载、应用残留检查与保留数据记录完成；实际：`NOT_RUN`；证据：`NOT_RUN`

### Windows 10 最终结论

- 最终结论：`NOT_RUN`（只允许改为 `PASS` 或 `FAIL`）
- 失败码：`NOT_RUN`
- 截图/日志引用：`NOT_RUN`
- 数据保护与回滚记录：`NOT_RUN`
- 测试人：`NOT_RUN`

## Windows 11

### 环境与候选身份

- 平台状态：`NOT_RUN`
- OS edition：`NOT_RUN`
- OS build：`NOT_RUN`
- 架构 x64：`NOT_RUN`
- 机器 / VM：`NOT_RUN`
- 干净快照或新测试用户：`NOT_RUN`
- 测试时间与时区：`NOT_RUN`
- 候选 ZIP SHA-256：`NOT_RUN`
- beta.1 安装器 SHA-256：`NOT_RUN`
- beta.0 TEST-ONLY 安装器 SHA-256：`NOT_RUN`

### 同构验收项

- [ ] `NOT_RUN` W11-01 外层 ZIP checksum 与 Draft Release 一致；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-02 包内闭集及逐文件 checksum 完整，无增项/漏项；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-03 全程离线，无自动更新或后台下载；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-04 以普通用户完成每用户干净安装，无管理员权限；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-05 首次启动成功，V2 与本地数据根初始化正常；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-06 合成账号、计划、内容、互动、指标与只读书库工作流完成；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-07 TEST-ONLY beta.0 创建合成数据后手动升级 beta.1，数据保留；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-08 应用运行时升级被确定性阻断，关闭后可升级；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-09 应用运行时卸载被确定性阻断，关闭后可卸载；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-10 损坏的安装器副本安全失败，旧版本和数据保持；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-11 卸载移除应用/快捷方式并默认保留数据；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-12 重装同一 beta.1 后读取保留的合成数据；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-13 受控备份成功，同版本恢复成功，降级/未知恢复拒绝；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-14 诊断预览后手动导出脱敏两文件 ZIP，未自动上传；实际：`NOT_RUN`；证据：`NOT_RUN`
- [ ] `NOT_RUN` W11-15 最终卸载、应用残留检查与保留数据记录完成；实际：`NOT_RUN`；证据：`NOT_RUN`

### Windows 11 最终结论

- 最终结论：`NOT_RUN`（只允许改为 `PASS` 或 `FAIL`）
- 失败码：`NOT_RUN`
- 截图/日志引用：`NOT_RUN`
- 数据保护与回滚记录：`NOT_RUN`
- 测试人：`NOT_RUN`

## 交回结果

保留已填写副本及截图/日志，不修改 Draft Release 中的原始 `NOT_RUN` 模板。将两个平台的实际结果
交回后，下一条最终命令才可处理失败纠正，或在双 PASS 时决定 R10E 合并与正式 Release。
