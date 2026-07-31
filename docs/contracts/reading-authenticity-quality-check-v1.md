# Reading Authenticity Quality Check V1 合同

状态：冻结
适用范围：M3 Issue 027

## 输入与结果

检查器只读取 current immutable `DraftVersion` 的标题、正文块、标签和置顶评论，以及其冻结 Brief
快照所引用的 current 阅读状态、逐条观点、表达权限、公开评分记录和 Dossier。它不修改 Draft，
不推进审批、导出或发布。

公开读模型固定为：

`PASS / BLOCKED / REVIEW_REQUIRED / STALE / NOT_RUN`

- `PASS`：本项未发现无法支持的具体亲历、评分来源冲突或内部预测分公开文本。
- `BLOCKED`：存在明确违反阅读状态或公开评分来源规则的文本。
- `REVIEW_REQUIRED`：表达歧义、评分格式无法安全归属或 finding 被截断。
- `STALE`：只存在其他 input identity 的旧摘要。
- `NOT_RUN`：当前 Draft 尚无本项摘要。

finding 只保存 artifact identity、Unicode code-point offset、文本与片段 hash、reason 和 disposition；
不保存正文副本、assertion 原文、内部预测、路径或数据库实现细节。

## 确定性规则

- 具体第一人称亲历只有 `R1` 且 current permission 为 `ALLOWED` 时通过。
- `R2` 普通观点只接受 current `EXACT_STRUCTURED_OPINION`、Draft lineage 与片段 hash 精确一致；
  “读完、重读、读过”等泛化亲历阻断。
- `R3 / S1 / S2 / UNCLASSIFIED` 的具体亲历与个人评分阻断；普通“我认为”不能自动当作亲历，
  无法安全确定时进入复核。
- 没有公开评分文本时不因 score plan 单独制造 finding。
- 个人评分要求 `R1`、current `USER_UI` active record、精确 `valueSourceId` 与公开值一致。
- 资料分析评分要求 current public research score、current ready Dossier、精确值，并显示
  “资料分析评分”。只解析带明确分母或已冻结有限 scale 的格式。
- `scorePlan=NONE` 与明确评分冲突；多值无法归属时复核。内部预测数据永不查询、输入或返回。
- AI 标识和版权风险不属于检查输入、规则、状态或门禁。

## 持久化与 IPC

本项复用 `quality_checks` 的 `READING_AUTHENTICITY` 类型，不新增 Schema。摘要 identity 由 check type、
DraftVersion、checker version 与 input hash 确定，使用 `INSERT OR IGNORE` 只追加；相同输入幂等。
input hash 覆盖公开 artifacts、Brief/permission/score plan、current reading revision、实际引用的 current
assertion/公开评分、current Dossier 与相关 policy version。

仅允许两个 IPC：

1. `quality:reading-authenticity:preview`：输入 draft identity 与 expected revision；同步只读，返回有界
   read model、0 外部请求、费用不适用和短期一次性 token。
2. `quality:reading-authenticity:confirm`：绑定 sender、window、preview hash、input hash、TTL 与 expected
   revision；重算 current input 后只追加摘要，拒绝 stale、重放和额外字段。

renderer 不接收正文副本、内部预测、绝对路径、token digest 或 `details_json`。
