# Expression Permission V1

状态：Issue 021 冻结合同。snapshot 版本为 `expression-permission-v1`，evaluator 为纯确定性
`AuthenticityPolicyV1`。

## 输入

Evaluator 只接受 exact-object：

- profile、Work 与 current reading-state revision；
- Reading State 与 Memory Confidence；
- current reading revision 下逐条确认的 assertion 集合；
- current Dossier version、readiness、coverage policy version 与 stale 标记（可空）；
- spoiler selection；
- authenticity、score、spoiler policy version。

购买/持有、Clip、搜索、模型、AI 标识、版权或 publication relationship 都不是输入。输入不完整、
非法或 stale 时 fail closed。

## 输出

`ExpressionPermissionSnapshotV1` 保存：

- personal experience 与 specific first-person permission；
- public research analysis permission；
- personal score 与 research-analysis score permission；
- `PERSONAL_EXPERIENCE` / `PUBLIC_RESEARCH_ANALYSIS` 两种未来 content-brief mode 的前置状态；
- overall content-brief readiness；
- spoiler requirement；
- blocking/warning reason codes；
- 有界依赖、dependency hash、evaluatedAt 与 stale 状态。

权限状态只允许 `ALLOWED`、`ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY`、`RESEARCH_ONLY`、
`BLOCKED`、`STALE_REVIEW_REQUIRED`。

## 冻结权限矩阵

| State        | 具体第一人称              | 个人评分                                | READY Dossier 时资料分析/资料评分 | 未来 content-brief 前置                 |
| ------------ | ------------------------- | --------------------------------------- | --------------------------------- | --------------------------------------- |
| R1           | `ALLOWED`                 | `ALLOWED`                               | `RESEARCH_ONLY`                   | 仍需 Dossier/FactPolicy 与 spoiler 条件 |
| R2           | 仅 current 逐条 assertion | 还需 current `PERSONAL_SCORE` assertion | `RESEARCH_ONLY`                   | 仅限被确认原意或资料模式                |
| R3           | `BLOCKED`                 | `BLOCKED`                               | `RESEARCH_ONLY`                   | 仅资料模式                              |
| S1           | `BLOCKED`                 | `BLOCKED`                               | `RESEARCH_ONLY`                   | 仅资料模式                              |
| S2           | `BLOCKED`                 | `BLOCKED`                               | `BLOCKED`                         | `BLOCKED`                               |
| UNCLASSIFIED | `BLOCKED`                 | `BLOCKED`                               | `BLOCKED`                         | 先由用户分类                            |

R1 与 Dossier ready 是正交维度：R1 不绕过事实冲突，Dossier ready 不证明用户读过。未来内容工作
必须显式选择模式并同时满足对应权限；本合同只提供 guard，不创建 brief 或任何内容。

公开资料模式固定要求“公开资料整理”标签；研究评分固定要求“资料分析评分”标签，不能使用“我给”
或“我读完认为”等个人阅读措辞。

## 依赖与失效

Snapshot 保存以下确定性依赖：

- Reading State revision；
- current Experience Assertion revision 集合；
- Dossier current version 与 readiness；
- Authenticity、Score、Spoiler policy version；
- spoiler preference revision；
- Catalog Work revision；
- profile ownership/update identity。

State/undo、assertion confirm/revoke/stale、Dossier current/readiness、Catalog merge/split/undo、
profile ownership 或 policy version 改变时，只失效相关 snapshot。依赖 lookup 使用组合索引，事件
identity 保证幂等；无关 Work 不全库失效。失效只追加记录并让读取返回
`STALE_REVIEW_REQUIRED`，不改写阅读状态、不重新确认 assertion、不创建任务或内容。

相同规范化输入得到相同 dependency hash 与权限结果；`evaluatedAt` 只是审计时间，不参与权限判定。
