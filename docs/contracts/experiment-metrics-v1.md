# Experiment Metrics V1 合同

状态：M3 Issue 023 已实现。本文只冻结未来指标定义和 guardrail，不保存真实观测或计算结果。

## 1. Registry 与唯一主指标

`MetricRegistryV1` 当前有限 identity 为：

- `SAVE_RATE`
- `COMMENT_RATE`
- `FOLLOW_CONVERSION_RATE`
- `ENGAGEMENT_RATE`
- `PROFILE_VISIT_RATE`
- `APPROVAL_WORK_UNITS`
- `FACT_BLOCK_RATE`

每个设计精确一个 primary metric；hypothesis 的 primary outcome 与方向必须一致。registry version
随设计保存，变更会精确使依赖设计 stale。

## 2. MetricSpec

每个定义保存 metric identity、registry version、numerator 描述、可空 denominator 描述、unit、
未来 observation window、missing-value policy、zero-denominator policy、direction 和
availability。

- `*_RATE` 必须使用 `RATE` unit 且 denominator 非空。
- 非 rate metric 不得伪装分母，也不能使用 `RATE` unit。
- missing policy 只有 `EXCLUDE_FROM_DENOMINATOR / KEEP_AS_MISSING / FAIL_CLOSED`。
- zero-denominator policy 只有 `RETURN_UNAVAILABLE / FAIL_CLOSED`，无效分母不能计算 rate。
- numerator/denominator 是未来口径描述，不是值；缺失与数值 0 严格不同。

availability 只有：

- `DEFINED_NOT_AVAILABLE`
- `AVAILABLE_FOR_FUTURE_COLLECTION`
- `UNSUPPORTED`

`AVAILABLE_FOR_FUTURE_COLLECTION` 仅说明未来接口定义可用，不表示已有任何观测。

## 3. Guardrail

每个设计可有 0—8 个 guardrail。guardrail metric 不得与 primary metric 或其他 guardrail 重复，
必须保存方向和未来违反条件。它只登记未来判断规则；Issue 023 没有执行链，因此不会自动阻断
Topic、Brief 或发布。

## 4. 冻结的无结果边界

Issue 023 不保存真实 numerator、denominator、baseline、effect size、confidence interval、
p 值、power、uplift 或 winner，不计算效果或显著性。DTO 固定返回
`NOT_EXECUTED_NO_EFFECT_CONCLUSION`；UI 固定显示“实验尚未执行，无效果结论”。

测试只使用合成定义和临时 SQLite。实现不调用平台、模型、搜索、图片或业务 API，不读取真实
密钥，费用为 0。
