# Rednote V2 D01 设计冻结基线

## 已批准来源

- Figma：https://www.figma.com/design/ZHNeFF0kn9F5ZTdqc96voy
- 产品画面页：`02 Product Screens`
- 页面 node：`1:89`
- 节点定位：https://www.figma.com/design/ZHNeFF0kn9F5ZTdqc96voy?node-id=1-89
- 用户验收事实：用户已于 2026-08-02 将 D01 画面导入 Figma，并确认“显示正常”。

## 冻结画面

1. 01 总览
2. 02 周计划默认态
3. 03 批量选择态
4. 04 任意日期时间
5. 05 冲突复核
6. 06 应用成功反馈

## 视觉真相优先级

1. 上述 Figma 文件中已经用户验收的六个画面。
2. Figma 工具不可用时，用户提供的 `Rednote-V2-D01-Figma-manual-import-v1.zip` 内六个 SVG 及其 QA 报告。
3. 现有 R01/R02 组件和样式只用于 D01 未改动的页面与基础控件。

本基线不授权重新设计信息架构、颜色、导航、卡片、图标或日期组件，也不授权把 SVG/PNG 作为整页图片嵌入生产应用。

## V2-R03 实现范围

- 保存完整账号人设后生成确定性周计划。
- 在七日周历中进行单选、批量选择和 Shift 连续选择。
- 使用日期和时间、仅日期、仅时间三种模式改期，支持跨周和 30 分钟依次排开。
- 应用前预览影响并复核冲突；系统不自动解决冲突。
- 确认、跳过、锁定、重启恢复，以及总览事实同步。
- 所有行为复用现有 V2 repository、两个底层 IPC channel 和本地 SQLite 表。

## 明确延期

- R04 内容包、批量审批、导出与发布。
- 029B、旧 Dossier/Brief/Topic/Experiment/Quality 主流程。
- 真实 Provider、Search、Fetch、OCR、图片生成与业务网络。
- 平台登录、自动发布、评论发送、私信发送、验证码与风控处理。
- 置顶评论。

后续任何总览或周计划 UI 修改都必须先通过新的 Figma 设计关卡和用户验收，不得直接在生产代码中自行改版。
