# ADR 0016：版本化研究档案与确定性就绪门

- 状态：Accepted
- 日期：2026-07-29
- Issue：020

## 背景

Issue 019 已提供不可变 SourceRevision、原子 Claim、精确 Evidence、FactEvaluation 与可逆冲突，
但旧 `research_dossiers` 仍是未验证 JSON 摘要，不能证明共识来源、表达研究缺口、精确失效或为
未来内容流程提供稳定输入。

## 决策

1. 将既有表安全迁移为 subject-bound 聚合根，以 Work/Expression/Edition 真实组合外键约束；
   旧 JSON 只作为不可变 legacy payload 保留，不能晋升为共识。
2. 每次发布创建 append-only Version、十类 Section、三类 Entry、Gap、Coverage 与精确
   Dependency；current pointer 在 expected-revision 短事务最后切换。
3. 共识只消费当前、非 stale 的 VERIFIED FactEvaluation；冲突进入 DISPUTED，证据不足进入
   有限 reason code 的 GAP。
4. Coverage 使用版本化整数 basis points 和冻结规则表；Readiness fail closed，模型、AI 标识、
   版权和 publication relationship 都不能改变结果。
5. dependency graph 关联 Claim、Evaluation、Evidence、SourceRevision、Conflict、政策与
   subject catalog revision。数据库触发器和仓库方法只标记相关 current dossier，不自动重建。
6. 用户必须先 preview，再用 sender/window 绑定的短期单次 token 明确确认。队列 payload 仅含
   ID、revision 和 hash，executionId 幂等，同一 dossier 只有一个 active build。
7. 纯本地确定性构建在未配置模型时完整可用。本 Issue 不实现可选模型摘要，避免扩大外发与审批
   范围。
8. Research UI 复用 Issue 019 冲突处理，不复制状态机；只读取分页、有限、无正文的 DTO。

## 被否决方案

- 直接扩写旧 summary/consensus JSON：无法逐条追溯或精确失效。
- 原地更新一个档案版本：破坏审计、diff、失败恢复和 stale publish 防护。
- 以模型补齐 gap 或评估 coverage：会把 UNKNOWN 伪装为事实，且结果不可重复。
- 任意 polymorphic subject ID：不能证明实体存在，merge/split 后也无法安全失效。
- 来源变化后自动全库重建：会产生隐式工作、副作用和 O(n²) 扫描。
- 在 Issue 020 新建冲突解决器或内容生产入口：重复既有真相并越过停止边界。

## 结果

v13 保留历史 v1—v12 与旧档案数据，同时建立可追溯、可比较、可增量重建的研究输入。失败、
取消、no-op 或构建中输入变化不会替换 current version；真实网络、模型调用和费用保持为 0。
下一项只有在收到明确任务后才是 Issue 021 阅读状态和真实性规则。
