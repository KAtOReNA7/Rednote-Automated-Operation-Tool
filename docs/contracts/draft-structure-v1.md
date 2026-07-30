# Draft Structure V1 合同

状态：冻结
适用范围：M3 Issue 025

## 聚合与版本

`Draft` 是稳定身份，`ContentDraftVersion` 是 append-only 快照。一个 Draft 只有一个 current
version；每次编辑、锁定、解锁、重排、撤销、完整生成或局部重写都追加版本，不能原地修改历史。
current pointer 只在同一短事务的最后以 expected revision 切换。

每个版本保存：

- `draftId / versionId / versionNumber / previousVersionId`；
- `briefVersionId / profileId` 和 Brief 输入、依赖、锁快照 hash；
- contract、schema、format、profile、voice、generation、rewrite、prompt 和 model execution 版本；
- source、status、结构校验结果、change kinds 与时间；
- 规范化的标题、正文 block、标签、置顶评论、剧透警告、lineage 和 field state。

历史版本、标题、block、标签、评论、警告、lineage、field state、transition 与 audit 均不可覆盖。

## 精确产物

V1 文案候选只包含：

1. 一个已选标题与最多五个备选标题；
2. 有序、带稳定 `blockId` 的正文 block；
3. 最多十个规范化去重标签，存储时不带 `#`；
4. 一个可空置顶评论；
5. `coverWarningText / titleWarningMarker / bodyOpeningWarningText /
pinnedCommentWarningText` 四种实际剧透警告文本；
6. 每个产物的 Brief lineage 与 provenance。

`ContentDraftPayloadV1` 还保存只读 Brief 快照、字段锁和版本号，但模型候选只能返回上述六个精确
字段：`titles / selectedTitleId / blocks / tags / pinnedComment / spoilerWarnings`。额外字段
一律 fail closed。

## 状态

有限状态为：

- `MANUAL_DRAFT`：本地手工 scaffold；
- `MODEL_CANDIDATE`：已解析但尚未完成结构验证的模型候选；
- `STRUCTURE_INVALID`：结构不完整或违反 profile/policy；
- `READY_FOR_QUALITY_PIPELINE`：结构有效，只能等待后续质量检查；
- `STALE`：上游 current 依赖已变化；
- `SUPERSEDED`：历史 current 已被新版本替代；
- `ARCHIVED`：用户归档。

`READY_FOR_QUALITY_PIPELINE` 不是质量通过、审批通过、可导出或可发布。Issue 025 不创建任何质量、
审批、图片、导出或发布产物。

## Profile 与结构

五类 Profile 使用 `copy-profile-registry-v1`：

| Profile                           | 核心结构要求                                                |
| --------------------------------- | ----------------------------------------------------------- |
| `NON_SPOILER_SINGLE_BOOK_VERDICT` | 判断、支撑、限定、结论；禁止 warning block 和答案性槽位     |
| `FULL_TRICK_LOGIC_ANALYSIS`       | warning、判断、事实综合、反方、限定、结论；四类警告文本齐全 |
| `CROSS_WORK_COMPARISON`           | 至少两部 Work；比较 block 对各 Work 的 lineage 对称         |
| `WEB_VS_PUBLISHED_MYSTERY`        | 判断、比较、限定、结论；不把表达形态推断为商业优劣          |
| `MYSTERY_AND_CULTURAL_PHENOMENON` | 判断、事实综合、限定、结论；绑定 Work 与可追溯现象          |

结构校验还要求唯一 selected title、连续 block order、标签去重、必需公开标签/评分来源、Brief
allowlist lineage、真实性权限、系统禁用表达和锁快照一致。校验纯本地、确定性、版本化。

## Lineage、真实性与锁

每个标题、block、tag、comment lineage 只引用当前 Brief 允许的 field path、argument、structure
slot、Work、EvidenceRef 和 current experience assertion。模型不得创建新的业务 ID。

R1 可继承个人第一人称权限和个人评分；R2 只能引用 current 逐条确认 assertion；S1 只能使用公开
资料分析表达和资料分析评分。公开资料标签和评分来源必须以实际文案 artifact 呈现。不同来源不能
互换，未知值不能伪装为零。

字段 provenance 为 `SYSTEM_DERIVED / MODEL_GENERATED / USER_EDITED / USER_CONFIRMED`；锁为
`EDITABLE / USER_LOCKED / SYSTEM_LOCKED`。完整生成与局部重写必须逐值保留所有锁定字段；
解锁是独立、显式、版本化操作。

## 容量与持久化

标题、block、标签、lineage、输入、输出、评论和 warning 均有固定上限。SQLite migration v18
使用 STRICT 表、显式 FK/CHECK/unique/index、append-only trigger 和同 Draft current-pointer
guard。旧 Draft 保留身份并保守迁移为 `STRUCTURE_INVALID`，不能被假定为符合 V1。
