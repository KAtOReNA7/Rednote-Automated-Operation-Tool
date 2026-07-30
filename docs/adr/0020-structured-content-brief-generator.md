# ADR 0020：结构化 Content Brief、字段锁定与受控生成

状态：已接受
日期：2026-07-30
范围：M3 Issue 024

## 背景

Issue 019—023 已提供可追溯事实、版本化 Dossier、真实性权限、Topic 与版本化 Experiment。
写作前需要一个可审计的结构层，把这些 current 依赖转成目标读者、核心判断、反方、Evidence、
评分与剧透计划，同时保留未知、用户锁定和来源边界。旧 schema 已有 `content_briefs` 根表，
不能建立第二套身份，也不能在 Issue 024 越界生成 Draft 或正文。

## 决策

1. 规范扩展现有 `content_briefs` 为稳定根，追加 immutable version、normalized child、
   dependency、readiness、transition、audit、generation plan/run 与 policy registry；旧行
   保守迁移为 `legacy-content-brief-v0 / DRAFT_INCOMPLETE`。
2. 五类 Brief Profile 与 Topic content type 一一对应，用有限 registry 冻结主体、结构槽位、
   比较和剧透要求。结构只描述段落功能，不保存未来文案。
3. 事实性字段必须映射 current、VERIFIED、locator-valid 的 Dossier/Evidence 链；context 和
   supporting-only 不得升级，模型只能引用输入 allowlist。
4. Expression Permission、R1/R2 状态、个人分、资料分析分和剧透计划作为 system-locked
   快照；内部预测不进入 Brief schema、DTO、renderer 或模型边界。
5. 每个字段保存 provenance 与 lock。模型候选只更新 allowlist 中的 editable 字段，所有用户/
   系统锁定值必须逐值保持。
6. readiness 是纯确定性门禁；blocked/stale 版本可保存但不能宣称可进入未来 Draft 生成。
7. structured generation 只通过 ModelExecutionService 和本地 JobQueue，单请求、executionId
   幂等、同 Brief 单 active。pre-send 为零费用；after-send 不确定状态保守标记 ambiguous。
8. 所有 renderer 写入均经 preview、CAS 与 sender/window 绑定的一次性确认；IPC/DTO 有界，
   renderer 不接收 Node、SQLite、路径、凭据、完整档案或 raw response。

## 被否决方案

- 新建第二个 Brief 根：会形成双重真相并破坏既有引用。
- 资料缺口由模板或模型补齐：会把未知伪装为事实或个人体验。
- 把内部预测当公开评分：违反评分来源隔离，也会污染 renderer 与内容判断。
- 只在 prompt 中要求模型遵守锁：不能提供行为级不可覆盖保证。
- 直接从 renderer 调 Provider：绕过 Electron、能力、预算、凭据和审计边界。
- after-send 失败自动重试或切换模型：至少一次队列下会重复外部副作用。
- 在 Brief 中保存完整 Dossier/Source：扩大敏感面、破坏追溯身份且使 payload 无界。
- 同时生成标题、正文、标签或图片：越过 Issue 025 及后续任务范围。

## 后果

- 本机可在零模型配置下建立、编辑、锁定、比较和审计 Brief scaffold。
- 可选 structured generation 具备严格候选、能力/预算预览、JobQueue 恢复和保守费用语义；
  本 Issue 的验收只用 Scripted Mock，不发出业务网络请求。
- schema 追加多张 STRICT 表和索引，换取历史、精确失效、锁定与恢复证据。
- Issue 024 完成后仍没有标题、正文、标签、图片或质量流程；下一项仅规划 Issue 025。
