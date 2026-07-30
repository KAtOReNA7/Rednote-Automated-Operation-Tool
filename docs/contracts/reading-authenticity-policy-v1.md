# Reading Authenticity Policy V1

状态：Issue 021 冻结合同。实现常量为 `reading-authenticity-policy-v1`，状态合同为
`reading-state-v1`。

## 目的与边界

本合同只记录用户对 Work 的显式阅读确认，并据此计算有限的个人体验与评分权限。购买、持有、
ISBN、出版关系、BrowserClip、搜索记录、Dossier、模型输出、文件存在或职业身份都不能证明用户
读过作品。系统不得自动创建、提升或改写阅读状态。

V1 以一个本地 `profile + Work` 为唯一 current truth；可选的 Expression/Edition 只作为有真实
外键的阅读上下文。不存在任意 polymorphic ID、电子书正文导入、阅读进度抓取或云账户读取入口。

## Reading State 与 Memory Confidence

| Reading State                 | 用户含义                             | 合法 Memory Confidence |
| ----------------------------- | ------------------------------------ | ---------------------- |
| `R1_READ_CLEAR`               | 读过且记忆明确                       | `CLEAR`                |
| `R2_READ_FUZZY`               | 读过但记忆模糊，只使用逐条重确认观点 | `PARTIAL`、`FADED`     |
| `R3_READ_UNCONFIRMED_DETAILS` | 记得读过但不能确认细节               | `FADED`、`UNKNOWN`     |
| `S1_RESEARCH_ONLY`            | 未读或不能确认，仅做公开资料研究     | `NOT_APPLICABLE`       |
| `S2_RESEARCH_INSUFFICIENT`    | 资料不足或冲突                       | `NOT_APPLICABLE`       |
| `UNCLASSIFIED`                | 尚未由用户分类                       | `UNKNOWN`              |

非法枚举、非法组合、额外字段、超限内容和不安全 identity 全部 fail closed。旧状态只做保守迁移：
可证明且有用户确认的旧 `READ_CLEAR` 才映射 R1；旧 `READ_FUZZY`、`READ_UNVERIFIED` 分别映射
R2、R3；`NOT_READ`、`UNKNOWN` 或不可证明值映射 `UNCLASSIFIED`，绝不自动映射 R1/S1。

## 显式状态变更

每次单本或批量变更必须依次具备：

1. 用户在 renderer 明确选择状态与 confidence；
2. main process 校验 exact-object、profile、Work/Expression/Edition 外键、大小与 expected
   revision；
3. 返回逐项 before/after、稳定 preview hash、短期单次 token 和过期时间；
4. token 绑定 sender、window、preview hash 与 action kind；
5. 用户再次明确确认；
6. SQLite 短事务追加 immutable revision、切换 current pointer、写 append-only audit；
7. 并发 stale 时拒绝覆盖。

Undo 不删除历史，而是追加 `USER_UNDO` revision，恢复前一 revision 的有限字段。批量最多 50 个
明确选中的 Work，默认空选择；每个 Work 独立校验 revision，并逐项报告成功或失败。

## R2 Experience Assertion

R2 的每条 `ExperienceAssertionConfirmation` 绑定 profile、Work、当前 reading revision、有限
assertion kind 与 scope。支持：

- `READING_IMPRESSION`
- `PLOT_OR_STRUCTURE_MEMORY`
- `CHARACTER_MEMORY`
- `TRICK_OR_REASONING_MEMORY`
- `PERSONAL_PREFERENCE`
- `PERSONAL_SCORE`

scope 只允许 `EXACT_STATEMENT` 或 `EXACT_STRUCTURED_OPINION`。陈述是用户显式输入的有界原意，
不是模型生成事实。Reading revision 改变后旧 assertion 自动 stale；撤销通过 append-only
`REVOKED` revision 立即失效。R3/S1/S2/UNCLASSIFIED 不能创建供公开第一人称使用的 assertion。

## 评分来源

三类分数使用整数 basis points（0—10000）和不同表：

- `PERSONAL_SCORE`：只允许 R1，或拥有 current `PERSONAL_SCORE` assertion 的 R2；
- `RESEARCH_ANALYSIS_SCORE`：只允许 current、非 stale、`READY_FOR_CONTENT_BRIEF` Dossier，
  对外固定标签“资料分析评分”；
- `SYSTEM_PREDICTION_INTERNAL`：只用于内部排序，不能进入 renderer 公共 DTO、公开预览、导出或
  发布包。

UNKNOWN 使用 `NULL`，不伪造成 0。三类分数不得复制、自动转换或混存。个人评分不能证明书目事实；
模型置信度也不是评分。

## 持久化与审计

v14 在原 `reading_states` current truth 上追加 revision、assertion、三类 score、spoiler
preference、permission snapshot/dependency/invalidation 与 authenticity audit。历史 revision、
score、snapshot、dependency、invalidation 和 audit 均 append-only；根 pointer 由 trigger 校验。
所有表采用 STRICT、真实外键、CHECK、UNIQUE、明确 delete policy 与 lookup index。

数据库不保存真实密钥、原始模型响应、电子书正文、完整阅读笔记、任意绝对路径或浏览器/平台账户
数据。Issue 021 不写 `content_briefs`、`drafts`、`approvals`、`post_packages` 或
`publications`。

## 永久不参与政策的字段

`aiDisclosure` 保持默认 `false`，AI 标识、版权信息与 publication relationship 都不参与阅读
真实性、表达权限、评分权限、剧透政策、审批、排期或导出决策。
