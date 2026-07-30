# Experiment Assignment V1 合同

状态：M3 Issue 023 已实现。本文冻结跨作品复现、热度分层和确定性 arm assignment。

## 1. 输入与边界

assignment unit 固定为 `TOPIC_CANDIDATE`。输入只包含显式选择且有界的 current Topic、对应
Topic version、canonical Work、结构 fingerprint、有限 blocking values、热度快照和可选
FIRST_30 plan membership。求解器最多处理 500 个 Topic，不扫描或加载整个 Topic Pool。

输入必须满足：

- Topic current、`ELIGIBLE` 且不为 `HELD/ARCHIVED`；
- content type、analysis mode、spoiler level 和 structure fingerprint 与设计一致；
- 同一 Topic 只出现一次，同一 Work 使用次数不超过版本化上限；
- 若绑定 FIRST_30 plan，所有样本必须是该 immutable plan 的成员；
- 同一结构至少覆盖三个 canonical Work。

任何缺失、stale、Edition 冒充 Work、结构不匹配或静默放宽 inclusion 都 fail closed。

## 2. 热度分层

`WorkPopularityStratumV1` 精确为 `HOT / WARM / COLD / UNKNOWN`。热度只用于 blocking，不替代
Topic eligibility、ranking、事实门禁或真实性权限。

非 UNKNOWN 必须由用户确认有限来源、观察时间、窗口、metric/category reference、provenance、
confidence 和 policy version。无依据时固定为 UNKNOWN；UNKNOWN 不等于 COLD，也不能根据书名、
模型记忆或出版社自动推断。热度快照变化只使相关旧 assignment stale。

## 3. 确定性算法

1. 校验设计、Topic、Work、结构、quota 和快照依赖。
2. 以 content type、热度和有限 blocking keys 形成 strata。
3. 用保存的 seed、assignment policy version、Topic/Work identity 和稳定 hash 排序。
4. 在每个 stratum 内优先选择当前计数更少的 arm，再以总 arm 计数和 arm ID 稳定打破平局。
5. 输出 unit、arm/strata counts、imbalance、每 arm shortfall、reason codes、input hash 与
   assignment hash。

相同输入、seed 和 policy 得到完全相同结果；输入顺序不改变输出。不使用“随机重试直到平衡”，
也不做全库 O(n²) 比较。

## 4. 状态与不足

计划状态只有：

`DRAFT / INSUFFICIENT_SAMPLE / INSUFFICIENT_REPLICATION / UNBALANCED / READY_TO_LOCK / STALE`

- canonical Work 少于最低值：`INSUFFICIENT_REPLICATION`。
- arm 目标未满足：`INSUFFICIENT_SAMPLE`，保留逐 arm shortfall。
- strata 差异超过有限阈值：`UNBALANCED`，保留逐 stratum reason。
- 全部满足：`READY_TO_LOCK`。
- 依赖变化：读取投影为 `STALE`。

不足时不复制 Topic、不把 UNKNOWN 合并进 HOT/COLD、不放宽资格、不宣称样本具有统计功效。
`READY_TO_LOCK` 也只说明分配设计可冻结，不代表实验已执行。

## 5. 持久化与恢复

assignment plan 和 unit 均 append-only，保存 input/assignment hash、policy version、前一版本和
有限解释字段。相同 input hash 不重复写入；current assignment 指针事务化更新。任何 Topic、
Quota、Work、Dossier、权限、stratum 或 policy 变化只追加精确 invalidation，不自动 rebuild。

数据库使用真实 FK、STRICT/CHECK/unique 约束及 status、Topic、Work/stratum、dependency 和
invalidation 索引。assignment DTO 不含正文、路径、凭据、真实指标或统计结果。
