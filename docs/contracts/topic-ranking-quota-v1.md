# Topic Ranking 与 First-30 Quota V1 合同

状态：M3 Issue 022 已实现。本文冻结可解释整数排序和 `FIRST_30_V1` 配额求解语义。

## 1. 五项可解释排序

排序策略版本为 `topic-ranking-policy-v1`。只有 `ELIGIBLE` 候选计算排序，且每个分量分别保存：

- `knowledgeState: KNOWN | UNKNOWN`
- `valueBasisPoints: 0..10000 | null`
- reason codes
- dependency keys
- policy version

| 分量                   | 权重（基点） | 允许输入                                          |
| ---------------------- | -----------: | ------------------------------------------------- |
| `EVIDENCE_SUFFICIENCY` |         3000 | Dossier coverage、gap、blocked/conflict、stale    |
| `CONTENT_FIT`          |         2500 | content type、主体数量、表达模式、栏目约束        |
| `DIFFERENTIATION`      |         2000 | 当前/历史 Topic semantic fingerprint 与同主体数量 |
| `ESTIMATED_COST`       |         1000 | 可审计的本地/模型请求与已知费用状态               |
| `APPROVAL_WORKLOAD`    |         1500 | 版本化工作量单位，不伪造精确人工耗时              |

总分使用整数截断的加权和，不使用 SQLite REAL。UNKNOWN 保存 `null`，不会显示或持久化为零成本；
结果同时保存完整性与 known component 数量。比较顺序依次为总分、known 数量、五个固定顺序分量、
稳定 tie-break key、topic ID。因此 UNKNOWN 不会在同分时被当成最佳。

锁定不改分；搁置和归档通过状态过滤；AI 标识、版权、出版归属、虚构热度、平台推荐信号及普通
负面观点不进入任何分量。

## 2. 冻结配额

`FIRST_30_V1` 是不可原地修改的版本化 QuotaProfile：

```text
NON_SPOILER_SINGLE_BOOK_VERDICT  10
FULL_TRICK_LOGIC_ANALYSIS         8
CROSS_WORK_COMPARISON             6
WEB_VS_PUBLISHED_MYSTERY          3
MYSTERY_AND_CULTURAL_PHENOMENON   3
TOTAL                             30
```

未来规则只能新增 profile/version，不能改写本 profile。

## 3. 确定性求解

`topic-quota-solver-v1` 对最多 10,000 个有界候选执行：

1. 读取 current eligibility、state、revision、version、fingerprint 与 score snapshot；
2. 按固定内容类型顺序分组；
3. 每类先选择合格 LOCKED；
4. 再按排序与稳定 tie-break 选择普通候选；
5. 拒绝重复 topic 或 fingerprint；
6. 执行版本化 `maxWorkExposure`；
7. 不跨类补位；
8. 输出逐类 selected/required/shortfall、冲突和 reason。

过量合格 LOCKED 返回 `OVER_LOCKED`，计划保持 `INCOMPLETE`，系统不得静默解锁、丢弃或跨类移动。
HELD、ARCHIVED、非 ELIGIBLE、重复指纹或超过 Work exposure 的候选不入选。

`COMPLETE` 必须恰好 30 项且逐类为 10/8/6/3/3；否则为 `INCOMPLETE` 并保留真实 shortfall。

## 4. 计划身份、版本与失效

pool snapshot hash 覆盖候选的 topic/version/revision、content type、eligibility、state、fingerprint、
score、maxWorkExposure、quota profile 与 solver version。计划版本保存：

- quota profile/version、pool hash、ranking/solver versions；
- immutable member 与五项 score snapshot；
- 逐类 selected/required/shortfall、locked/held/archived counts；
- cost/workload state 与值；
- reason/warnings、previous version、createdAt。

相同输入是 deterministic no-op，不新增计划版本。pool、candidate state/version 或依赖变化只追加
STALE 事件，不自动重排；用户明确重建才创建新版本并把旧版标记 SUPERSEDED。失败、取消、重启
恢复或 stale execution 不替换 current plan。

## 5. 队列与恢复

`TOPIC_QUOTA_PLAN_V1` payload 只含 contract version、executionId、profile/quota profile ID、
pool hash、候选数量与 exposure 上限。executionId 唯一，跨进程竞争只有一个持久运行身份。

Desktop 的 preview + 单次确认是唯一 producer；确认先持久化 quota run，再以稳定 idempotency key
进入本地 JobQueue。handler 在发布前重验 snapshot，沿用 pause/cancel/shutdown/lease/recovery
语义；取消或失败只更新 run，不替换 current plan，也不持有数据库长事务执行外部工作。本实现的
求解为纯本地，external request 与费用恒为 0。

计划不生成实验、日历、发布排期、Brief、标题、正文、图片或质量流程。
