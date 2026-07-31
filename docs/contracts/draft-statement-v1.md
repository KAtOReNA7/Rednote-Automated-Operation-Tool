# Draft Statement V1 合同

状态：冻结
适用范围：M3 Issue 026

## 公开文本与定位

`DraftPublicArtifactV1` 只从一个 immutable、结构有效且可检查的 DraftVersion 派生：

- 当前选中标题 `SELECTED_TITLE`；
- 按 order 排序的 `BODY_BLOCK`；
- 按 order 排序的 `TAG`；
- 可空的 `PINNED_COMMENT`。

四类 spoiler warning 与系统冻结公开标签本身不生成事实 Statement；如果 warning/label artifact
含有标签以外的新断言，detector 必须产生待复核 signal。公开文本按 NFC 和 LF 规范化后计算
SHA-256；数据库只保存 artifact identity、hash、code-point 长度和 lineage allowlist，不重复保存
整篇 Draft。

`DraftTextLocatorV1` 使用 Unicode code point 闭开区间，包含 DraftVersion、artifact identity、
artifact text hash、区间、locator version 与 selected-text hash。读取时必须从 immutable Draft
重新规范化、切片并复算；空区间、越界、跨 artifact、hash 不一致或冲突重叠均 fail closed。

## Statement

`DraftStatementV1` 是 immutable 的最小独立语义单元，只属于一个 artifact。它保存 locator、
statement text hash、segmentation version、provenance、revision 和时间，不在队列、日志或 audit
中保存正文。

provenance 仅为：

- `DETERMINISTIC`
- `MODEL_CANDIDATE`
- `USER_DEFINED`
- `USER_CONFIRMED`

多主语、谓词、值或 scope 必须拆分；事实与观点无法无损拆分时为 `MIXED`。模型候选不能自动变为
用户确认，也不能单独产生 PASS。

## 分类与 protected signal

Statement kind 固定为 `FACT / OPINION / ANALYTICAL_JUDGMENT / PERSONAL_EXPERIENCE /
RHETORICAL / LABEL_OR_WARNING / MIXED / AMBIGUOUS`。只有 FACT 使用
`KEY_FACT / SUPPORTING_FACT` 以及有限 FactDomain；其他种类必须为 `NOT_APPLICABLE`，MIXED
仅用于待拆分。

detector 版本化识别数字、中文数字、百分比、货币、单位、日期、排名、奖项、ISBN、书目身份和
引语归属。signal 只要求分类/复核，不证明事实或真实性；列表序号、纯 warning、作品固有数字不
自动成为事实。protected signal 被用户确认为非事实时必须保存有界 reason。MIXED、AMBIGUOUS
或未处理 signal 永远不能 PASS。
