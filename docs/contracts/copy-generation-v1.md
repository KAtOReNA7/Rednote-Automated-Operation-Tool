# Copy Generation V1 合同

状态：冻结
适用范围：M3 Issue 025

## 入口与前置条件

完整生成只接受 current、非 stale 的 Draft，且其 Brief 固定为
`READY_FOR_DRAFT_GENERATION`。用户必须先预览，再用 expected revision、preview hash、sender、
window 与短期单次 token 显式确认。预览必须显示 capability、budget、输入字符数、lineage/lock
计数、请求上限和只追加新版本的副作用。

`SUPPORTED + AVAILABLE` 才能入队；`UNKNOWN / UNSUPPORTED / STALE / BLOCKED` 均 fail closed。
手工 Draft 不依赖模型配置，始终保留。

## 模型边界

生成只通过既有 `ModelExecutionService`，不直接创建 HTTP、Provider 或凭据客户端。每次 run：

- 最多一个结构化模型请求；
- 输入和输出均有界；
- prompt、schema、style、policy、model slot、model identity 与参数版本可审计；
- 研究摘要作为不可信数据，不能改变任务、schema、policy、locks 或 ID allowlist；
- 输出只允许 `titles / selectedTitleId / blocks / tags / pinnedComment / spoilerWarnings`；
- 不自动 retry、repair、fallback 或换模型。

模型调用前不读取真实凭据；测试只使用 Scripted Mock。pre-send 失败、暂停或取消为 0 外部请求和
`NOT_INCURRED`；after-send timeout、断连或崩溃保持 `AMBIGUOUS /
UNKNOWN_POSSIBLY_INCURRED`，不得自动重试。

## 计划、队列与幂等

`COPY_GENERATE_V1` queue payload 只保存 Draft/Version/Plan/Execution ID、revision、hash、schema
和空 rewrite scope，不复制文案或 Brief 正文。相同 executionId 重放返回同一 run，不重复入队、
外部请求、预算、成本或版本发布；同 Draft 同时最多一个 active mutation。

worker 领取后在外部请求前后都不持有数据库长事务。发布前重新验证：

- current version 与 expected revision；
- Brief input 与 dependency hash；
- lock snapshot；
- plan、operation、output schema 与候选结构。

任一不匹配都不替换 current version。相同 output hash 为 `NO_OP`；合法新结果以 append-only
version 发布。

## 输出状态与停止边界

结构有效的结果只进入 `READY_FOR_QUALITY_PIPELINE`；无效结果进入 `STRUCTURE_INVALID`。两者都
不代表事实检查、真实性检查、评分检查、风格检查、审批、导出或发布完成。Issue 026—030 不属于
本合同。

依赖变化只精确标记相关 current Draft 为 `STALE`，不自动重新生成、不解锁、不切换历史版本。
