# Content Brief V1 合同

状态：M3 Issue 024 已实现。本文冻结写作前结构化简报、证据映射、真实性权限和字段锁定边界。

## 1. 定位与非目标

Content Brief 是 Topic 与未来 Draft 之间的版本化结构计划。它保存目标读者、可验证目标、核心
判断、支持论点、最强反方、结构槽位、证据映射、真实性、评分、剧透与禁用表达约束。它不是标题、
正文、标签、置顶评论、图片、质量检查、审批、发布包或实验结果。

`content_briefs` 是稳定 identity；`content_brief_versions` 是 immutable version，根表只保存
唯一 current pointer 与 revision。编辑、模型候选、锁定、解锁、undo、clone、归档和恢复都创建
新版本或追加 transition/audit，不原地覆盖历史。

## 2. 五类 Profile

Profile registry 版本固定为 `brief-profile-registry-v1`，与 Topic content type 一一对应：

- `NON_SPOILER_SINGLE_BOOK_VERDICT`：精确一个主要 Work、`NO_SPOILER`，包含适读对象、主要
  优缺点、反方和有限定的阅读判断。
- `FULL_TRICK_LOGIC_ANALYSIS`：`FULL_TRICK_ANALYSIS`，封面、标题与正文开头均规划警告位置，
  包含诡计还原、公平性、逻辑、误导缺口和反方。
- `CROSS_WORK_COMPARISON`：至少两个主要 Work，明确唯一比较维度，并为两侧保存对称证据槽位。
- `WEB_VS_PUBLISHED_MYSTERY`：同时绑定已验证的 `WEB_SERIALIZED` 与
  `PUBLISHED_EDITION` 表达形态；比较创作、结构和阅读体验，不推断商业优劣。
- `MYSTERY_AND_CULTURAL_PHENOMENON`：至少一个 Work 锚点和可追溯 `CONTEXT` 主体，不能退化为
  无作品依据的泛热点。

结构槽位只保存段落功能、是否必需和主体 ID，不保存未来标题或正文。

## 3. 结构化字段

- `targetAudience` 只保存阅读熟悉度、读者描述与选择需求；不得从无来源敏感画像推断受众。
- `contentObjective` 保存可验证的读者结果与范围边界；不得承诺爆款、涨粉或平台结果。
- `coreJudgment` 精确一个，类型为 `OPINION / FACTUAL_SYNTHESIS / MIXED`，并保存限定条件。
- `supportingArguments` 有界保存事实/观点类型、主体、证据引用与 limitation。
- `strongestCounterargument` 必须保存真实的最强反方及回应或限定，不能制造稻草人。
- `openQuestionsAndLimitations` 明确保留资料缺口，未知不得补写为确定事实。

所有 exact-object validator 都拒绝未知字段。单个 Brief、字段文本、列表、分页和 IPC payload
均受版本化上限约束。

## 4. Evidence 映射

事实性核心判断、论点和反方前提必须引用当前 allowlist 中的 `BriefEvidenceRef`。每条引用保存
Dossier、DossierVersion、DossierEntry、Claim、FactEvaluation、EvidenceLocator 与
SourceRevision 身份以及 dependency hash；只有 current、`VERIFIED` 且 locator 有效的
`FACT` 引用可以支撑关键事实。

`CONTEXT` 与 `SUPPORTING_ONLY` 保留原角色，不能升级为关键事实。Brief 只保存有限 display
summary 和 ID，不复制完整 Source、Dossier、原文 excerpt、raw response 或正文。

## 5. 真实性、评分与剧透

- `PERSONAL_EXPERIENCE` 只消费 current Expression Permission。R1 可允许第一人称和
  `PERSONAL_SCORE`；R2 只能使用 current、逐条确认的 assertion；R3/S1/S2/UNCLASSIFIED
  不得伪造具体第一人称体验。
- `PUBLIC_RESEARCH_ANALYSIS` 要求 current READY Dossier、禁止第一人称，并强制公开显示
  “公开资料整理”；`RESEARCH_ANALYSIS_SCORE` 还必须显示“资料分析评分”。
- 评分集合精确为 `NONE / PERSONAL_SCORE / RESEARCH_ANALYSIS_SCORE`。未知值保持 `null`，
  不伪装为 0；模型候选不能创建个人评分。内部预测不属于本合同、数据库、DTO、renderer 或
  模型输入输出。
- 剧透计划为 `NO_SPOILER / LIGHT_SPOILER / FULL_TRICK_ANALYSIS`。FULL 必须要求用户确认，
  并规划封面、标题与正文开头警告；本 Issue 只保存位置计划，不生成警告文案。

## 6. 禁用表达、provenance 与 lock

禁用表达来源固定为 `GLOBAL_ACCOUNT / AUTHENTICITY / FACT_POLICY / SPOILER /
CONTENT_TYPE / USER_CUSTOM`。系统规则不可删除，且不包含 AI 标识或版权判断。

每个可编辑字段保存 `SYSTEM_DERIVED / MODEL_CANDIDATE / USER_EDITED / USER_CONFIRMED`
provenance 和 `EDITABLE / USER_LOCKED / SYSTEM_LOCKED` lock。Topic、Experiment、Evidence、
policy、真实性、评分、剧透和系统规则由系统锁定；模型重生成必须逐值保留所有非
`EDITABLE` 字段，不能解锁。

## 7. Experiment 与失效

Experiment binding 为空或完整保存 locked/current/non-stale design、assignment、arm、Work、
Topic、structure fingerprint、popularity stratum 与 controlled conditions。任一不一致产生
`EXPERIMENT_MISMATCH`，不会修改 Experiment、Topic 或 assignment。

依赖变化只向相关 Brief 追加 invalidation 并投影为 `STALE`；不会自动 regenerate、解锁、
切换 current 或创建 Draft。无关 Topic、Work、Source 或 policy 变化不应全库失效。
