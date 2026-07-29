# ADR 0014：三级书目模型、未验证观察与可逆实体解析

- 状态：Accepted
- 日期：2026-07-29
- Issue：018

## 背景

初始 Schema 将 `books`、`authors` 和 `book_editions.book_id` 作为简化书库，但无法区分抽象作品、
具体译文和某次出版，也无法表达多作者、译者、imprint、平台和待核验授权关系。固定 50 本
无法证明覆盖、关系正确、去重质量或规模能力。

## 决策

1. 沿用 `books` 作为 Work，保留全部既有 ID 与下游引用。
2. 新增 Expression；重建 `book_editions`，使 Edition 只保存 `expression_id`。
3. 为每个既有 Work 建立一个 `LEGACY_UNSPECIFIED` Expression，并原样迁移 Edition ID。
4. 新增不可变 BibliographicObservation 与 field provenance。Search/Fetch/Clip 的冻结状态不变；
   Observation 固定 `UNVERIFIED / NOT_A_FACT`。
5. 新增统一 Agent、alias、分层 contributor/organization relation 与 publication relationship。
   后者只是待核验业务关系，不是版权风险、法律结论或门禁。
6. 实体解析仅用版本化确定性规则。同类型强标识符与兼容上下文才自动关联；其余进入人工复核。
7. merge/split/undo 使用 expected revision、内存确认 token、单事务、append-only decision/audit
   和可逆 redirect/membership。
8. DiscoveryPlan 用 strata coverage、gap 和 provenance 完整度验收，不设置全局固定书数。
   10,000 Work 只用于合成容量测试。
9. Discovery Job 只消费持久化 ID，外部请求恒为 0，按 checkpoint 有界处理。

## 被否决方案

- 保留 `book_editions.book_id` 再增加 `expression_id`：会形成两套可能不一致的真相来源。
- 把 ISBN 放在 Work：ISBN 标识 Edition，不标识抽象作品。
- 按标题/作者模糊分数自动合并：同名作品、译名和笔名会产生不可接受的误合并。
- 覆盖旧实体或删除 duplicate：会破坏 provenance、旧 ID 和撤销能力。
- 用固定 50 条作为 M2 完成标志：不能证明分层覆盖、关系质量或容量。
- 在 Issue 018 创建 Source/Claim/Evidence：越过 Issue 019 的证据边界。

## 结果

migration v11 会安全保留旧 Work、Edition 和引用，同时建立可扩展三级模型。书目发现产生的是
未验证、可追溯的目录候选；任何公开事实仍必须等待 Issue 019 的来源—声明—证据链。
