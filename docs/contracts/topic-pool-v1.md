# Topic Pool V1 合同

状态：M3 Issue 022 已实现。本文冻结候选选题身份、资格、状态与本地生成边界。

## 1. 定位与非目标

`TopicCandidateV1` 只表示“可进一步开发的研究型选题”。它不是 Experiment、Content Brief、
Draft、标题、正文、标签、图片、质量检查或已批准文章。Issue 022 不创建或写入这些后续对象。

候选不得把 angle、central question 或 candidate judgment 表述成新的公开事实，也不得声称用户
亲自读过。完整 Evidence、Dossier 正文、原始模型响应、凭据和绝对路径不得进入候选、DTO、队列
payload、日志或审计。

## 2. 有限内容类型

`TopicContentTypeV1` 只有五种：

| 类型                              | 语义                                 | FIRST_30_V1 |
| --------------------------------- | ------------------------------------ | ----------: |
| `NON_SPOILER_SINGLE_BOOK_VERDICT` | 不剧透单书判卷                       |          10 |
| `FULL_TRICK_LOGIC_ANALYSIS`       | 完整诡计与逻辑拆解                   |           8 |
| `CROSS_WORK_COMPARISON`           | 两部至六部作品的受控横向比较         |           6 |
| `WEB_VS_PUBLISHED_MYSTERY`        | 至少一种网络表达与一种出版表达的比较 |           3 |
| `MYSTERY_AND_CULTURAL_PHENOMENON` | 作品与可追溯文化现象研究主题         |           3 |

单书类型精确引用一个主要 Work；比较类型主体集合有界并使用 canonical 顺序；文化现象类型必须
同时绑定 ready Dossier 与可追溯 context Claim。

## 3. 身份、版本与依赖

- `topics` 是唯一候选根身份；`topic_candidate_versions` 保存 append-only 版本。
- 根保存 profile、semantic fingerprint、candidate state、current version 与 revision。
- 版本保存有限结构字段、主体、Dossier/Permission/context 依赖、资格快照、五项排序快照、剧透
  元数据、provenance 与时间。
- subject、ranking、dependency、transition、plan member 与 audit 均为受外键约束的历史证据。
- current 指针只允许按连续版本事务化前进；历史版本不可更新或删除。
- 旧 `topics` 保守映射为 `legacy-topic-v0`，不制造第二套 Topic 真相。

`TopicSemanticFingerprintV1` 的输入是：

1. content type；
2. canonical subject set；
3. comparison dimension；
4. spoiler level；
5. analysis mode；
6. 规范化 angle intent；
7. fingerprint policy version。

比较主体顺序和轻微措辞差异不产生新身份；不同且真实可解释的 angle intent 可以共存。指纹冲突
保留 provenance 并关联 canonical candidate。已锁定或已归档候选不会被覆盖或静默新建重复项。

## 4. 确定性资格

资格策略版本为 `topic-eligibility-policy-v1`，状态集合固定为：

- `ELIGIBLE`
- `DOSSIER_NOT_READY`
- `AUTHENTICITY_BLOCKED`
- `FACT_BLOCKED`
- `STALE`
- `INSUFFICIENT_COMPARISON_SET`
- `SPOILER_POLICY_INCOMPLETE`
- `DUPLICATE`
- `ARCHIVED`

通用检查要求 current subject、current 且 non-stale Dossier、FactPolicy、current
ExpressionPermissionSnapshot、获准 analysis mode、完整 spoiler policy 和 current policy
versions。缺失、未知或冲突均 fail closed。

类型附加规则：

- 不剧透单书判卷要求 `READY_FOR_CONTENT_BRIEF` 与 `NO_SPOILER`。
- 完整诡计类型允许 `FULL_TRICK_ANALYSIS`，但必须保留 cover/title/body warning placement 与用户
  显式确认要求；完整剧透本身不是阻断理由。
- 横向比较要求所有主体 ready，且 comparison dimension 来自有限 registry。
- 网文/出版比较要求可核验表达形态；publication relationship 仅可作为受控内容事实，不进入门禁。
- 文化现象要求可追溯 context；context-only 信息不能冒充已验证关键事实。

AI 标识、版权信息、普通负面观点和出版归属不进入资格、排序、审批或配额。

## 5. 候选状态机

候选状态仅有 `PROPOSED / LOCKED / HELD / ARCHIVED`。支持：

- `LOCK`
- `HOLD`
- `RESUME`
- `ARCHIVE`
- `RESTORE`
- `UNDO`

每次变更要求 preview、expected revision、sender/window 绑定的短期一次性 token 和明确确认。
状态变更在短事务中追加 transition/audit；并发 stale fail closed。LOCKED 只影响同类配额优先顺序，
不修改原始排序且不绕过资格；HELD/ARCHIVED 通过状态过滤而不是分数惩罚。

## 6. 生成与执行边界

纯本地生成以 current Catalog、ready Dossier、current Expression Permission 和有限模板为输入，
输出结构化 candidate。它不配置模型也可工作，`estimatedModelRequests=0`、外部请求与费用为 0。

`TopicGenerationPlanV1` 预览包含输入数量、五类预计数量、本地组合上限、去重上限、预计写入量、
plan hash、expiry 与 policy versions。`TOPIC_GENERATE_V1` payload 只含 ID、hash、版本和有限计数；
`executionId` 幂等，结果不含正文、路径、secret 或 raw response。

可选 `TopicProposalV1` 只冻结 strict structured contract；本 Issue 的测试路径仅使用 Scripted Mock。
proposal 仍须重新通过本合同的 validator、资格与去重。prompt injection 字段、citation mismatch、
标题、正文、标签、图片或 Brief 字段一律拒绝。

## 7. UI 与 IPC

renderer 只接收有限分页 DTO；不能导入 Node、Electron、SQLite、文件系统、网络或凭据实现。IPC
执行 exact-object、sender/origin/window、大小、枚举、revision、hash 与 token 校验。

UI 必须明确展示：候选不是 Brief 或已批准文章；排序不是平台爆款预测；资料不足不会为凑满 30
绕过门禁；FULL 类型未来必须带警告；PERSONAL 与 PUBLIC_RESEARCH 及评分来源保持隔离。
