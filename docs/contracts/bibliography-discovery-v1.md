# Bibliography Discovery V1 合同

## 1. 边界与版本

- Observation：`bibliographic-observation-v1`
- normalization：`bibliography-normalization-v1`
- portfolio：`discovery-portfolio-profile-v1`
- plan：`discovery-plan-v1`
- run：`discovery-run-v1`
- queue job：`BIBLIOGRAPHY_DISCOVERY_V1`

Discovery 只消费已经持久化的 SearchCandidate、FetchDocument、BrowserClip Candidate 或
显式合成 fixture 身份，不接受裸 URL、任意文件、SQL、正文、请求头或凭据。外部请求数恒为
`0`，也不会创建 Search/Fetch Job。

## 2. BibliographicObservationV1

Observation 是不可变、未验证的发现输入，不是 Work / Expression / Edition，也不是
Source、Claim 或 Evidence。exact-object 合同包含：

- `observationId`、`originKind`、`originRecordId`、`originRevision`、`observedAt`；
- 原始与规范化分离的标题、原题、贡献者、机构、系列、载体和标识符 hint；
- language/script hint、work type、出版日期/年份；
- source candidate/document/clip 的有限 ID；
- field-level provenance、算法版本、输入 Observation ID；
- `truthStatus=UNVERIFIED`、`factStatus=NOT_A_FACT`；
- `normalizationVersion=bibliography-normalization-v1` 与有限 warning。

单个 Observation 规范 JSON 不超过 128 KiB；字符串、数组、深度和 provenance 数量均有限。
不得复制页面正文、完整 snippet、用户备注、截图、URL query、绝对路径、token 或 raw response。
`originKind + originRecordId + originRevision` 唯一；同一身份重放返回既有 Observation，新 revision
追加新记录，不能改写历史。

## 3. 三级实体

- Work：沿用 `books.id`，表示抽象作品；ISBN、译名、载体和再版不会改变 Work。
- Expression：表示原文、特定译文、修订或改编文本；不同译者或实质文本必须可分开。
- Edition：只指向一个 Expression，表示具体出版社/品牌、日期、载体、版次、装帧、分册、
  ISBN 或平台版本。

历史 `book_editions` 通过 migration 为每个既有 Work 建立一个
`LEGACY_UNSPECIFIED` Expression，再把 Edition 原 ID 原样迁移。迁移后 Edition 不再保留
`book_id`；Work 只能经 `expression_id` 解析，避免双真相来源。

## 4. Agent 与关系

Agent 分为 `PERSON` 与 `ORGANIZATION`。作者、合著者、译者、编者、改编者、出版社、imprint、
发行方、平台和代理机构使用同一规范 Agent 与独立 alias。

关系作用域和角色是有限枚举：

- Work：`AUTHOR / COAUTHOR / ORIGINAL_CREATOR`
- Expression：`TRANSLATOR / ADAPTER / EDITOR`
- Edition：`PUBLISHER / IMPRINT / DISTRIBUTOR / PLATFORM`
- Publication relationship：
  `RIGHTS_PARTY / LICENSOR / LICENSEE / AGENCY`

Publication relationship 仅允许
`OBSERVED_UNVERIFIED / USER_CONFIRMED / EVIDENCE_PENDING`。方向、范围、语言、地区、载体和
有效期均可为 `NULL/UNKNOWN`，不得猜测。它不是版权风险或法律结论，永不参与门禁、评分、
审批、优先级、排期或导出。

## 5. 标识符与规范化

规范化保留原值，使用确定性的 Unicode NFKC、空白折叠、宽窄字符、大小写和标点处理。人名顺序、
笔名、罗马字和机构品牌只产生 alias，不能据此自动断言同一实体。

- ISBN-10/ISBN-13 去格式后必须校验 check digit；合法 ISBN-10 规范转换为 ISBN-13。
- ISBN 只允许关联 Edition。
- 平台和出版社编号必须分别带 `PLATFORM:<scope>`、`PUBLISHER:<scope>` namespace。
- 无效 ISBN 只保留原始 hint 与稳定错误，不进入 canonical identifier。
- 同一强标识符出现不兼容上下文时创建 `CONFLICT` case，不覆盖实体。

## 6. DiscoveryPlan 与 Coverage

计划目的为 `PILOT_CONTENT / MARKET_MAP / CUSTOM`。Profile 和 Plan 必须声明：

- required/optional strata、每层目标、优先级、允许来源和 gap 策略；
- Observation、候选比较、数据库写入、时长、本地并发和批次上限；
- 可消费的持久化 origin 范围；
- normalization/entity-resolution 版本；
- preview hash、过期时间、expected revision 与用户确认；
- 外部请求数固定为 `0`。

默认 Profile 可表达日本、欧美、中文出版、中文网络悬疑，原创/翻译，纸书/电子/网络连载，
有强标识符/无 ISBN，新书/存量/时间未知。`热门/冷门` 不从排名或主观印象推断。

Run 状态：

`DRAFT → PREVIEWED → CONFIRMED → RUNNING → AWAITING_REVIEW →
COMPLETED | COMPLETED_WITH_GAPS | CANCELLED | FAILED | INTERRUPTED`

Coverage 按 stratum 记录计划、Observation、Work/Expression/Edition、短缺、未解析、复核、
冲突、拒绝、无效标识符、自动关联、人工决策、provenance 完整度和去重前后基数。fixture 与
synthetic 必须醒目标记，不能显示为真实行业书库。

## 7. Queue 与恢复

Job payload 只保存 `runId`、`planId`、`planHash`、`executionId` 和版本身份；result 只保存 run
状态、计数和稳定错误。处理使用有界批次和持久 checkpoint，每批 heartbeat，并响应暂停/取消。
相同 executionId 重放不重复 Observation、实体、关系或 decision。恢复只能从已提交 checkpoint
继续，不持有跨批次事务。
