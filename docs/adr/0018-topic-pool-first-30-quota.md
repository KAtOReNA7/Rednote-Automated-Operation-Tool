# ADR 0018：Topic Pool、可解释排序与 First-30 配额

状态：已接受
日期：2026-07-30
范围：M3 Issue 022

## 背景

M2 已提供 Catalog、Atomic Fact、Versioned Dossier 与 Reading Authenticity。M3 的第一步需要把这些
current、可追溯的研究状态投影成候选选题，但不能提前创建 Experiment、Brief、正文或质量流程。
旧 schema 已有 `topics` 根表，因此新设计还必须避免第二套 Topic 真相。

## 决策

1. 扩展现有 `topics` 为稳定根身份，追加 append-only candidate version、subject、ranking、
   dependency、transition、generation 与 quota 表。旧行保守标记为 `legacy-topic-v0`。
2. 把内容类型冻结为五类，资格、semantic fingerprint、五项整数 ranking 与状态机均使用版本化纯
   函数。UNKNOWN 保持 `null` 和显式状态。
3. `FIRST_30_V1` 冻结为 10/8/6/3/3。求解器逐类先选合格 LOCKED，再按稳定排名选择；不跨类补位、
   不重复 topic/fingerprint、不放宽资格，并执行 Work exposure 上限。
4. 计划是 immutable version。输入变化只追加 STALE；显式重建产生新版本；相同输入 no-op；失败、
   取消或恢复不替换 current。
5. 纯本地模板是必需路径。可选 provider proposal 仅冻结 strict Scripted Mock 合同，不接真实模型。
6. 所有 renderer 写操作必须先 preview，再用 expected revision 与 sender/window 绑定的一次性 token
   明确确认。generation 与 quota 均由 Desktop 确认作为唯一 producer，通过有界 payload、
   executionId 与稳定 idempotency key 进入本地 JobQueue。

## 被否决方案

- 新建独立 Topic 根表：会形成双重真相并破坏旧引用。
- 用模型直接生成标题或正文：越过 Issue 024/025，也把非确定性输出混入资格与配额。
- 为凑满 30 跨类别补位或放宽 Dossier/Authenticity：会伪造完成状态。
- 把 UNKNOWN cost 当作 0：会把不可证明的候选错误排到前面。
- 用 score penalty 表示 HELD/ARCHIVED：会篡改可解释的原始排名。
- pool 变化后自动重排 current plan：会覆盖用户已确认的审计版本。
- 依据 AI 标识、版权或 publication relationship 做门禁/排序：违反冻结产品约束。

## 后果

- 可在无模型配置、零外部请求、零费用下得到结构化候选与完整或不足的 First-30 计划。
- schema 增加多张 STRICT 历史表和索引，但换取了版本、依赖、失效、审计与跨进程幂等证据。
- 后续 Issue 023 可引用已确认的 Topic/plan identity；本 ADR 不授权实验、Brief、正文或发布能力。
- Issue 022 完成后，下一步仍是 Issue 023。
