# ADR 0017：阅读真实性与表达权限分离

状态：接受
日期：2026-07-30
范围：M2 Issue 021

## 背景

现有 Catalog 能确认作品 identity，Evidence/Dossier 能确认公开事实，但两者都不能证明本地用户亲自
读过作品。把“研究就绪”当作“读过”，或让模型用资料补写个人体验，会产生不可审计的虚假第一人称。
旧 `reading_states` 又只有有限 current 字段，不能支持历史、并发确认、R2 逐条观点与精确失效。

## 决策

1. 保留并扩展同一 `reading_states` current truth，不建立第二套当前状态。
2. 用户状态采用 R1/R2/R3/S1/S2/UNCLASSIFIED 与独立 Memory Confidence 矩阵。
3. 每次改变均由用户 preview/confirm，使用 expected revision 和 sender/window/hash 绑定的一次性
   token；历史与 audit append-only。
4. R2 的第一人称能力由 current reading revision 下的逐条 assertion 授权，不给通用“我读过”
   开关。
5. Authenticity 与 Dossier readiness 保持正交，纯 evaluator 输出版本化 permission snapshot。
6. personal、research-analysis、internal prediction 使用三类记录；内部预测不出 main process。
7. Spoiler policy 允许 FULL_TRICK，但将 warning/confirmation 作为独立条件，不提升真实性。
8. Snapshot 保存 state/assertion/Dossier/policy/Catalog/profile 依赖，变化后只对相关 Work fail
   closed。

## 被否决方案

- 从购买、持有、文件、ISBN、Clip、搜索或 Dossier 自动推断阅读状态：间接证据不能证明体验。
- 用一个布尔 `hasRead`：无法表达记忆可信度、资料模式和 R2 逐条确认。
- 把 Dossier readiness 合并进 Reading State：会让事实研究冒充个人经历。
- 把三类评分放进同一字段：来源无法审计，内部预测可能泄漏成公开评价。
- 修改旧 revision 或直接回退 current pointer：破坏历史、并发语义和撤销审计。
- 在 renderer 直接访问数据库：越过不可信 renderer 与 IPC 边界。

## 结果

优点：

- 每项公开表达权限都有可解释、可重放的本地证据；
- stale/revoked assertion 与事实冲突立即 fail closed；
- UI 能并列展示“我是否读过”和“资料是否就绪”；
- 不需要网络、模型、密钥或费用。

代价：

- v14 增加多个 STRICT 表、trigger 与索引；
- 用户必须显式分类和二次确认；
- policy 升级需要新 migration/版本并失效旧 snapshot。

Issue 021 不创建内容。M3 若消费 permission snapshot，仍须显式选择内容模式并执行自身事实、质量、
审批和人工发布门禁。
