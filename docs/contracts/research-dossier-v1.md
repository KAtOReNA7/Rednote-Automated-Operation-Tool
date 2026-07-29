# Research Dossier V1 合同

## 定位

Research Dossier 是对 Issue 019 已验证事实的只读、确定性投影。它不创建或修改 Claim、
Evidence、FactEvaluation、Conflict，也不向内容生产表反写结果。V1 的事实选择、覆盖率、缺口和
readiness 全部在本地完成；外部请求数和模型请求数固定为 0。

## 聚合与版本

`ResearchDossier` 通过真实 `fact_subjects(subject_type, subject_id)` 外键绑定且只绑定一个
`WORK`、`EXPRESSION` 或 `EDITION`。同一 subject 只有一个聚合根和 current pointer。

`ResearchDossierVersion` 是 append-only 快照，保存：

- dossier、version number、previous version 和 build run identity；
- schema、FactPolicy、CoveragePolicy 版本；
- 输入依赖的规范化 SHA-256；
- `INITIAL / INCREMENTAL / FULL_REBUILD` build mode；
- readiness、有限 reason/warnings、revision、created/published 时间。

发布在短事务内使用 expected dossier revision 和 expected current version；只有新版本及其全部
Section、Entry、Gap、Dependency、Coverage 写入成功后才切换 current pointer。失败、取消或输入
变化保留原 current。相同 input hash 是 `NO_OP`，不创建空洞版本。

## 有限章节与条目

章节 registry 固定为：

1. `IDENTITY`
2. `BIBLIOGRAPHY`
3. `CREATORS`
4. `PUBLICATION_HISTORY`
5. `AWARDS`
6. `SERIES_AND_RELATIONSHIPS`
7. `SYNOPSIS_AND_THEMES`
8. `RECEPTION_AND_DISCUSSION`
9. `OPEN_CONFLICTS`
10. `RESEARCH_GAPS`

条目类型固定为：

- `CONSENSUS`：当前、非 stale 且 FactEvaluation 为 `VERIFIED`；
- `DISPUTED`：未解决 material conflict 或 `FACT_BLOCKED`；
- `GAP`：政策要求但没有足够证据。

`INSUFFICIENT`、`SUPPORTED_NOT_VERIFIED`、`STALE_REVIEW_REQUIRED` 和 context-only 输入不能进入
共识。条目保存 stable semantic key、有限 display/structured value、事实状态和单独的 Claim、
FactEvaluation、Evidence、SourceRevision、Conflict/Gap 引用；不保存整页正文、完整 snapshot、
原始 HTML 或 raw model response。

## 缺口

Gap reason code 仅允许：

- `NO_CLAIM`
- `INSUFFICIENT_EVIDENCE`
- `SOURCE_INDEPENDENCE_UNKNOWN`
- `FACT_CONFLICTED`
- `EVIDENCE_STALE`
- `SOURCE_UNAVAILABLE`
- `SECTION_NOT_RESEARCHED`
- `POLICY_VERSION_STALE`

缺失信息保持 UNKNOWN 语义，不转换为零、空值、否定结论或模型补全。`NOT_APPLICABLE` 只能由
有限政策规则或带 audit reference 的人工确认产生。

## 依赖、失效与重建

每个版本保存 Claim revision、FactEvaluation identity/hash、Evidence revision、SourceRevision
及分类 revision、Conflict revision、FactPolicy、CoveragePolicy 和 subject/catalog revision。

Source、Evidence、Claim、Evaluation、Conflict、分类/独立性或 Work/Expression/Edition
关系变化只将引用对应依赖的 current dossier 标为 `REBUILD_REQUIRED`。失效事件有唯一 identity，
不会自动入队。重建必须经过绑定 sender/window 的短期单次 preview token 和明确确认。

`DOSSIER_BUILD_V1` payload 只含 dossier、subject、plan、execution、expected revision 与 hash
身份，不含正文、excerpt、summary、路径、secret、raw response 或内部 lease。队列使用至少一次
交付，executionId 重放幂等，同一 dossier 至多一个 active run。

## IPC 与展示

preload 只公开分页 list/detail、preview/confirm/cancel 和有限 version diff DTO。所有请求执行
exact-object、长度、枚举、revision、sender/origin/window 与 confirmation 校验。renderer 只显示
有限值与引用 identity，不接收 Node、SQLite、托管路径、凭据或完整 Evidence 文本。
