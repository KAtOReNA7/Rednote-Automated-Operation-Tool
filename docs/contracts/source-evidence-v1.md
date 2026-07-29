# Source Evidence V1 合同

## Source 与 revision

`SourceV1` 是用户明确接纳的资料身份；`SourceRevisionV1` 是不可变内容版本，二者都使用
exact-object runtime validator。允许的来源原点只有：

- `FETCH_DOCUMENT`：已持久化的受控 FetchDocument；
- `BROWSER_CLIP`：用户主动收藏的公开页面有限样本；
- `SYNTHETIC_FIXTURE`：测试专用合成资料。

SearchCandidate、搜索摘要、模型记忆和未持久化页面不能成为 Source 或 Evidence。Source 包含
current revision identity、canonical URL hash、有限 display host、标题、站点、语言、当前分类、
独立性、published/retrieved time、状态、revision、provenance、有限 warnings 和时间戳。每个
revision 绑定原点记录及其 revision、内容哈希、提取文本哈希、受控相对路径、语言、可用状态和
创建时间。正文不进入 SQLite、WAL、日志、IPC 或队列。

## 分类与独立性

权威等级为 `OFFICIAL_PRIMARY`、`INDEPENDENT_SECONDARY`、`DISCUSSION_CONTEXT` 或
`UNKNOWN`。使用资格为 `KEY_FACT_ELIGIBLE`、`SUPPORTING_ONLY`、`CONTEXT_ONLY` 或
`NOT_CLASSIFIED`。独立性为 `CONFIRMED_INDEPENDENT`、`DEPENDENT` 或 `UNKNOWN`。
BrowserClip 强制为 `DISCUSSION_CONTEXT / CONTEXT_ONLY`，且不能被改为关键事实来源。正式来源
分类必须记录 `USER`；只有醒目标识的合成 fixture 可记录 `SYNTHETIC_FIXTURE`。

同一稿件的转载、镜像、同一发布链或明确派生资料共享 lineage group，不能重复计数。只有明确记录
且没有依赖 lineage 的不同 group 才能作为两个独立二级来源。

## EvidenceLocator

V1 locator 只允许纯文本 `CHAR_RANGE`：

- 以 Unicode code point 的闭开区间定位；
- 绑定 source ID、source revision、提取文本哈希和 locator 版本；
- 保存有界精确摘录及其 SHA-256；
- 创建时对该 revision 的受控提取文本重新定位并验证哈希；
- revision、文本哈希、区间或摘录任一不匹配即 fail closed。

中文摘要与原文摘录并列保存，但摘要固定为非证据。模型摘要还必须返回绑定的 excerpt hash 和
locator hash；不匹配、额外字段、错误 schema、幻觉引用或过期 capability 均拒绝。

## 状态变化

新 revision、`UNAVAILABLE`、`RETRACTED` 或 `SUPERSEDED` 会使依赖旧 revision 的 evaluation 进入
`STALE_REVIEW_REQUIRED` 并要求本地重算。revision 和 Evidence 均 append-only。
