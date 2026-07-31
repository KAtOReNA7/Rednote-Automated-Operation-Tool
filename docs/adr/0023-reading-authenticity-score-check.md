# ADR 0023：缩减范围的阅读真实性与评分检查

状态：Accepted
日期：2026-07-31

## 背景

Issue 026 已能判断公开事实是否映射到 current Claim/Evidence，但不回答 Draft 中第一人称阅读亲历和
公开评分是否符合 Issue 021 的阅读状态与评分来源。Issue 027 需要补齐这一项检查，同时不得复制
事实系统、扩大 Schema、引入模型/网络，或提前实现质量编排。

## 决策

1. 在 Electron 无关的 `packages/quality` 增加确定性 evaluator，复用 public artifact materializer、
   Unicode segmenter、locator 和 semantic hash；事实真伪仍完全由 Fact Mapping 负责。
2. 数据库只读取 current Draft、阅读状态、实际引用的 assertion、公开评分与 Dossier。内部预测表不在
   查询、输入、DTO、details 或 UI 中出现。
3. 复用现有 `quality_checks`，以稳定 content-addressed ID 和 `INSERT OR IGNORE` 追加有界摘要；
   不新增 table、trigger 或 migration，也不更新或删除旧摘要。
4. renderer 仅通过 preview/confirm 两个窄 IPC 使用本项能力。preview 只读；confirm 绑定 sender、window、
   TTL、expected revision、preview/input hash，并在写入前重算 current identity。
5. UI 只在现有文案工作台显示五态、reason 与本地 Draft 解析出的有限片段，明确检查不修改文案。
6. `PASS` 只代表本项检查通过，不推进 Draft、审批、导出、发布或 Issue 028。

## 否决方案

- 新增专用检查表或大型人工 decision overlay：超出缩减范围，也会增加 migration 与状态同步成本。
- 把检查放入 Queue/Worker 或模型分类：规则可本地确定，异步执行会引入恢复、费用和外部副作用。
- 增加 get/list 第三个 IPC：preview 已能同时返回 current saved status 与本次确定性结果。
- 从内部预测分推导公开评分：违反三类评分来源隔离和 renderer 不可见边界。
- 自动修正文案、推进审批或导出：属于后续 Issue，且会破坏用户显式控制。

## 结果

检查在 0 Schema、0 外部请求、0 费用下获得可定位、可重复、可失效的摘要。代价是只支持有限、
无歧义的评分格式；未能安全判断的表达保守进入 `REVIEW_REQUIRED`，不会伪装为 PASS。
