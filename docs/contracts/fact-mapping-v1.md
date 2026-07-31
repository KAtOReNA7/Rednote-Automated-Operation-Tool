# Fact Mapping V1 合同

状态：冻结
适用范围：M3 Issue 026

## 候选与映射

`ClaimCandidateSetV1` 只消费 DraftLineageRef、BriefEvidenceRef 与绑定 canonical subject 所能
到达的本地 current AtomicClaim。集合按 subject、predicate、scope、稳定 ID 确定排序，有界
截断，并保留 redirect provenance、conflicted/stale 候选用于解释。它不创建 Claim、Evidence、
Source 或研究任务，不执行网络或搜索。

一个 FACT Statement 最终只能由一个 current AtomicClaim 满足。关系固定为：

`EXACT / SUPPORTED_PARAPHRASE / NARROWER_THAN_CLAIM / BROADER_THAN_CLAIM /
VALUE_CONFLICT / SCOPE_MISMATCH / SUBJECT_MISMATCH / PREDICATE_MISMATCH /
MULTIPLE_CANDIDATES / NO_CLAIM / STALE / NOT_APPLICABLE`。

只有 EXACT、经本地约束和人工确认的 SUPPORTED_PARAPHRASE，以及未引入新值/scope 的
NARROWER_THAN_CLAIM 可进入满足判定。其他关系不能 PASS。映射保存 Statement/Claim/
FactEvaluation revision、relation、provenance、有限 reason、input/semantic hash 和时间；不复制
Claim、Evidence 或 Source 正文。

## 类型化 compatibility

整数不使用浮点；十进制使用规范字符串；百分比、金额保留单位/币种；日期保留 YEAR/MONTH/DAY
精度；identifier 精确规范化；entity ref 先解析 canonical identity；enum/boolean 匹配 registry。
NaN、Infinity、scientific notation 和不可解析值被拒绝。

Statement 新增 Claim 未覆盖的数字、单位、排名、比较级或更精确日期时失败。奖项的获奖、入围、
提名、候选、榜首 predicate 不互换，主体、年份、届次、类别和 scope 必须兼容。

## 证据回溯

满足映射必须展开：

`DraftTextLocator → DraftStatement → AtomicClaim → FactEvaluation → Evidence →
EvidenceLocator → SourceRevision → Source`

KEY_FACT 只接受 current `VERIFIED` FactEvaluation：一个 official primary，或两个已确认独立
lineage group 的 secondary。BrowserClip/context-only、dependent、unknown independence、
unavailable/retracted/stale revision 与 unresolved material conflict 均不能满足。supports、
contradicts、qualifies 必须同时可见；中文摘要只标记为非证据摘要。

## 人工与模型边界

无模型时可完成分段、分类、选择候选、查看链、确认、撤销、拆分、undo 和 reopen。人工变更先
preview，再用 expected revision、preview hash 与窗口绑定短期单次 token 确认；历史 append-only。

可选 `FactMappingAssistV1` 只提议 locator、classification、allowlisted Claim ID、relation 与有限
reason code。输出 exact schema，并在本地重验切片/hash/allowlist/value/scope/FactPolicy。模型
最多一次，不创建事实、不修改 Draft、不搜索、不返回内部推理；after-send 不确定为 AMBIGUOUS，
不自动 retry、repair、fallback 或换模型。
