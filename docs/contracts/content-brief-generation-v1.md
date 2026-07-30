# Content Brief Generation V1 合同

状态：M3 Issue 024 已实现。本文冻结受控 structured generation、JobQueue 和保守恢复边界。

## 1. 本地 scaffold 与模型边界

本地 scaffold 不需要 Provider、密钥或网络。它从 current Topic、主体、Evidence、真实性、
评分、剧透、Experiment 与系统规则确定性建立结构骨架；未知 core judgment、argument 和反方
保持 `null` 或空列表，不用模板伪造观点。

模型候选只能通过既有 `ModelExecutionService` 的 structured output 能力产生。模型输出合同只
允许：

`targetAudience / contentObjective / coreJudgment / supportingArguments /
strongestCounterargument / structurePlan / openQuestionsAndLimitations /
citedEvidenceRefIds`

候选不得包含或生成标题、正文、标签、置顶评论、图片 prompt、图片、政策变化、标识符、
Experiment 结果、effect、winner 或模型内部推理。引用只能来自输入 Evidence allowlist；
未知 ID、URL 或 excerpt fail closed。

## 2. Preview 与用户确认

generation plan 在执行前有界显示 Brief/Topic/version 身份、Profile、subject/evidence 数量、
editable/locked 字段数量、input/dependency hash、expected revision、write set、capability
状态、单次请求上限、输入字符和输出字节上限。`SUPPORTED` 之外不得伪装为可执行。

所有写操作使用 preview hash、expected revision 和 sender/window 绑定的短期单次确认 token。
过期、重放、跨窗口、并发 revision 变化或 payload 不一致均 fail closed。

## 3. Queue、幂等和费用

Job type 固定为 `CONTENT_BRIEF_GENERATE_V1`。payload/result 只保存 Brief/plan/execution ID、
expected version/revision、hash、有限 status/count/error，不保存完整 Brief、证据摘录、secret、
raw response 或绝对路径。

- 同一 Brief 同时最多一个 active generation；`executionId` 重放返回同一 run，不重复请求。
- 单次执行最多一个外部模型请求、0 web search、0 image call、0 tool call。
- capability、budget、pause 或 cancel 在发送前阻塞时，request count 为 0、费用为
  `NOT_INCURRED`。
- 发送后的 timeout、连接中断或无法证明结果的失败为 `AMBIGUOUS` 和
  `UNKNOWN_POSSIBLY_INCURRED`；不得自动 retry、repair、fallback 或换模型。
- 未配置模型时显式 `STRUCTURED_MODEL_UNCONFIGURED`，不读取环境中的偶然密钥，也不发出请求。

## 4. 发布与锁定

模型只能更新七个允许字段中的 `EDITABLE` 值；`USER_LOCKED` 和 `SYSTEM_LOCKED` 字段逐值
保持。发布前重新验证 strict candidate、Evidence allowlist、Profile、依赖、input、lock 与
readiness。成功后创建 immutable `MODEL_CANDIDATE` version；no-op 不重复写版本。失败、取消或
ambiguous 均不替换 current ready version。

生成期间不持有数据库长事务。pause/cancel/shutdown/recovery 沿用本地至少一次 JobQueue；
只有可证明 pre-send 的状态可以安全恢复，after-send ambiguous 需要用户人工判断。
