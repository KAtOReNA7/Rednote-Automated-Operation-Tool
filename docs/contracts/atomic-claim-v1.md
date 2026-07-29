# Atomic Claim V1 合同

## 主体、谓词、值与 scope

AtomicClaim 必须包含一个受控主体、一个 Predicate Registry 键、一个类型化值和一个规范化 scope。
主体只允许：

- `WORK`
- `EXPRESSION`
- `EDITION`
- `AGENT`
- `PUBLICATION_RELATIONSHIP`

主体必须先写入带真实外键的 `fact_subjects` 注册表，不能使用未校验的多态字符串。Predicate
Registry 固定 predicate/version、value schema version、是否允许多值、日期比较和实质冲突规则。
值类型至少包括 `TEXT`、`INTEGER`、`DECIMAL_TEXT`、`DATE_WITH_PRECISION`、`IDENTIFIER`、
`ENUM`、`ENTITY_REF` 和 `BOOLEAN`；精确小数只保存规范十进制字符串，不使用 SQLite REAL。

scope 是仅含 `language / territory / format / validFrom / validTo` 的 exact-object JSON；经确定性
canonical JSON 和 SHA-256 形成身份。日期值显式携带 `YEAR / MONTH / DAY` 精度。同主体、同谓词、
同规范 scope 才进入冲突比较。别名和 redirect 先解析到 canonical entity identity。

## 原子性与来源

一个 Claim 只表达一个可验证断言，并记录 `keyFact`、claimant SourceRevision、semantic
fingerprint、状态、revision 与 `MANUAL / MODEL_CANDIDATE` provenance。模型输出只能保存为
`CANDIDATE`，不能凭模型记忆创建 Evidence 或提升 FactEvaluation。手工创建 Claim、Evidence 和
中文摘要不要求任何模型配置；相同 claim ID 与语义指纹重放幂等。

## Evidence

Evidence 必须引用一个精确 SourceRevision locator，并标记 `SUPPORTS`、`CONTRADICTS` 或
`QUALIFIES`。记录还包含 source content hash、原文语言、verification status、revision 和时间；
Evidence 不可更新或删除。摘要、用户备注、Search snippet、Clip context 和模型输出不能替代
Evidence。
