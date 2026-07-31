# ADR 0022：版本化事实声明映射

状态：Accepted
日期：2026-07-31

## 背景

Issue 025 只保证 Draft 结构有效。公开文案中的事实仍需与 Issue 019 已验证的 AtomicClaim 和
Evidence 链逐条对应，同时不能修改 Draft 或研究真相，也不能提前实现后续质量编排。

## 决策

1. 新增 Electron 无关 `packages/quality`，当前只含 FACT_MAPPING；公开 artifact、Unicode
   locator、Statement、分类、detector、compatibility 与 rollup 都是确定性版本化合同。
2. SQLite 追加连续 migration，以稳定 check identity、immutable version、statement、signal、
   mapping、dependency、decision、run 和质量汇总桥接保存详细真相；不复制 Draft/Source 全文。
3. Claim 候选只能从 Draft/Brief lineage 和 canonical subject 的本地 allowlist 产生。映射只消费
   current AtomicClaim、FactEvaluation、Evidence 与 SourceRevision，不能创建或升级研究事实。
4. 人工路径始终可用；模型仅作为一个可选、单请求、exact-schema 候选器，所有结果由本地规则
   重验。pre-send 与 after-send 恢复语义沿用 ModelExecution/JobQueue 的保守边界。
5. renderer 只经 narrow IPC 得到有界 Draft 片段、Claim 摘要和 Evidence excerpt。预览确认绑定
   sender/window、expected revision、hash 和单次 token。
6. FACT_MAPPING PASS 只写单项 `quality_checks` 汇总，不推进其他质量、审批、导出或发布状态。

## 被否决方案

- 直接检查 Draft 整篇 JSON：无法稳定定位、人工修正或精确失效，并会复制正文。
- 用 lineage 或文本相似度直接 PASS：lineage 不是事实验证，近似措辞不能证明 value/scope。
- 让模型搜索或创建 Claim：越过 Issue 019 真相边界，并引入真实网络、费用和不可审计证据。
- 把详细结果塞入 `quality_checks.details_json`：缺少真实 FK、append-only 历史和反向依赖索引。
- 在 Issue 026 计算总分或推进审批：属于 Issue 030。

## 结果

事实检查可在纯本地、无凭据条件下完成，并能解释每个 statement 的 Claim 与证据链。代价是表和
状态较多，但换取了 immutable 历史、精确失效、并发保护和后续只读编排输入。
