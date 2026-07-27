# ADR-0001：M0 单仓库与不可变领域边界

- 状态：接受
- 日期：2026-07-27
- 范围：Issue 001—005

## 背景

V1 最终是 Windows 10/11 本地桌面系统，但首轮只能建立仓库、领域规则、不可变约束和
持续集成。此阶段不得提前实现 UI、SQLite、供应商、搜索、图片或业务工作流。

## 决策

1. 使用 npm workspaces 管理 `apps/*` 与 `packages/*`，TypeScript project references 负责
   独立包构建。
2. `packages/core` 是 M0 唯一包含领域行为的包，不依赖 UI、数据库或供应商。
3. 内容状态机采用显式允许列表。非法跳转抛出领域错误，异常状态只能沿定义的恢复路径
   返回。
4. 发布包构造器不接受 `aiDisclosure` 输入，并把返回类型收窄为字面量 `false`；质量检查
   更新同样重新写入 `false`。
5. AI 参与信息和素材来源只是决策输入的元数据。决策输出不会用它们改变状态、评分、
   审批层级、排期或导出资格。
6. 质量检查类型采用封闭枚举，只包含 PRD 明确保留的事实、逻辑、真实性、剧透、重复、
   标题正文、图像技术和结构检查。
7. 架构测试扫描生产路径、生产源码和依赖清单，阻止平台托管动作、访问控制绕过、开卷或
   盗版电子书入口，以及云数据库、云对象存储和远程队列依赖。
8. `windows-latest` 是 CI 的必过作业。约束测试既被显式执行，也包含在完整测试套件中。

## 状态机

标准路径：

```text
IDEA
→ RESEARCHING
→ RESEARCH_READY
→ DRAFTING
→ REVIEW_REQUIRED
→ APPROVAL_READY
→ APPROVED
→ EXPORT_READY
→ EXPORTED
→ MANUALLY_PUBLISHED
→ MEASURED
```

恢复路径：

```text
FACT_BLOCKED      → RESEARCHING
GENERATION_FAILED → DRAFTING
VISUAL_FAILED     → REVIEW_REQUIRED
USER_REJECTED     → DRAFTING
任意非归档状态     → ARCHIVED
```

AI 标识和版权都不是状态，也不会产生异常状态。

## 影响

- M1 可以把存储和界面接到稳定的纯领域 API 上，而不需要复制规则。
- 新质量检查或依赖如果越过禁止范围，会在本地测试和 Windows CI 中失败。
- M0 不提供可启动的桌面应用，也不保存任何业务数据；这些明确留给后续 Issue。
