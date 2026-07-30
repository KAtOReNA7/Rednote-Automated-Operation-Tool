# Copy Rewrite V1 合同

状态：冻结
适用范围：M3 Issue 025

## 支持的 scope

局部重写只允许下列有限 scope：

- `SELECTED_TITLE`；
- `TITLE_VARIANTS`；
- `BODY_BLOCK`；
- `BODY_BLOCK_RANGE`；
- `TAG_SET`；
- `PINNED_COMMENT`；
- `SPOILER_WARNING_ARTIFACT`。

block scope 只能引用 current Draft 的稳定 `blockId`，warning scope 只能选择四种既有 warning
字段。instruction 为有限长度纯文本，不能修改 Brief、Profile、真实性、评分、实验、剧透策略、
schema、prompt、模型、lineage allowlist 或锁。

## Scope preservation

重写合并器按 scope 精确替换。所有 scope 外字段必须逐值相等，包括顺序、provenance、lineage、
字段锁、Brief 快照和版本政策。`BODY_BLOCK_RANGE` 只能替换给定 block 集合，不得顺带重排或
修改相邻 block；`TAG_SET` 是唯一允许整体替换标签集合的 scope。

所有 `USER_LOCKED` 与 `SYSTEM_LOCKED` 字段无论是否落入请求 scope 都不能被模型覆盖或解锁。
需要修改用户锁定字段时，用户必须先单独解锁并创建一个新 DraftVersion。

## 执行与恢复

rewrite 使用 `COPY_REWRITE_V1`，与完整生成共享 preview/confirm、capability/budget、单请求、
executionId 幂等、同 Draft 单 active、pause/cancel/shutdown/recovery 和 conservative
after-send ambiguous 语义。模型仍只能返回完整精确候选 schema，main process 再执行确定性
scope merge 与结构验证。

发布前校验 current revision、version、dependency/input/lock hash 和 scope。非法 scope、
越界 block、政策变化、lineage 越界、锁覆盖或 scope 外变化均 fail closed，不创建 current
替换版本。

## 版本与 Diff

每次有效 rewrite 都追加一个 source=`REWRITE` 的不可变 DraftVersion，保存 scope、instruction、
prompt/model/policy 版本、input/output hash 和 run。版本 diff 只返回有界字段变化摘要；undo
同样追加版本，不修改历史。结构有效结果只进入待质量检查状态。
