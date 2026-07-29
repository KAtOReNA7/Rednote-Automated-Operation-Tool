# Dossier Coverage 与 Readiness V1 合同

## 确定性表示

`dossier-coverage-policy-v1` 使用 0—10000 的整数 basis points，不使用浮点猜测、模型评分、
文章质量、市场热度、AI 标识或版权信息。相同规范化输入不论遍历顺序都产生相同 input hash、
coverage、gap、reason 和 readiness。

只有当前、非 stale、FactPolicy 版本匹配且状态为 `VERIFIED` 的事实贡献 coverage。同一
semantic key 的重复 Claim 合并引用但只计分一次。`FACT_BLOCKED`、stale、insufficient、
supporting-only、context-only 和来源独立性未知均不贡献 verified coverage。

## V1 规则表

| Section                  | 权重 | Work                     | Expression               | Edition                      | Readiness required |
| ------------------------ | ---: | ------------------------ | ------------------------ | ---------------------------- | :----------------: |
| IDENTITY                 | 2500 | title（必需）            | title、language（必需）  | title（必需）                |         是         |
| BIBLIOGRAPHY             | 1500 | page count（可选）       | format（可选）           | isbn（必需）、format（可选） |         是         |
| CREATORS                 | 1500 | author（必需）           | translator（可选）       | translator（可选）           |         是         |
| PUBLICATION_HISTORY      | 2500 | publication date（必需） | publication date（必需） | date、publisher（必需）      |         是         |
| AWARDS                   |  750 | award（可选）            | award（可选）            | award（可选）                |         否         |
| SERIES_AND_RELATIONSHIPS |  750 | series（可选）           | series（可选）           | series（可选）               |         否         |
| SYNOPSIS_AND_THEMES      |  250 | V1 无自动计分 key        | V1 无自动计分 key        | V1 无自动计分 key            |         否         |
| RECEPTION_AND_DISCUSSION |  250 | V1 无自动计分 key        | V1 无自动计分 key        | V1 无自动计分 key            |         否         |
| OPEN_CONFLICTS           |    0 | 只承载冲突               | 只承载冲突               | 只承载冲突                   |         是         |
| RESEARCH_GAPS            |    0 | 只承载缺口               | 只承载缺口               | 只承载缺口                   |         是         |

overall 是各 section basis points 按整数权重的确定性加权结果。required/optional 分母只来自有限
规则表；某 section 没有信息不会自动满分。publication relationship 可以作为可追溯事实展示，
但不是 coverage key，也不参与 readiness。

冻结 Work gold fixture：title、author、publication date 三项 verified，page count、award、series
缺失时，`required=10000`、`optional=0`、`overall=6500`、可选 gap 为 3，readiness 为
`READY_FOR_CONTENT_BRIEF`。

## Readiness

状态固定为：

- `NOT_BUILT`
- `BUILD_REQUIRED`
- `INSUFFICIENT_COVERAGE`
- `FACT_BLOCKED`
- `STALE`
- `READY_FOR_CONTENT_BRIEF`

只有 current 版本、Fact/Coverage policy 均为当前版本、required coverage 为 10000、没有
blocking gap、未解决 conflict 或 stale dependency 时才是 `READY_FOR_CONTENT_BRIEF`。判断顺序
fail closed：未构建 → 需重建/政策过期 → conflict/blocking gap → stale → required coverage
不足 → ready。

Readiness 只是供未来内容流程消费的只读事实门，不会自动创建 Topic、Brief、Draft、Approval、
PostPackage、Publication、排期或导出。
