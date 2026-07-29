# Entity Resolution V1 合同

## 1. 规则与输出

`ruleVersion=entity-resolution-v1`。实现不调用模型；每次比较都保存有限 feature vector、
输入 Observation、规则版本和以下 outcome：

- `EXACT_LINK`
- `PROBABLE_REVIEW`
- `DISTINCT`
- `CONFLICT`
- `INSUFFICIENT`

只有同类型强标识符与兼容上下文同时成立才可 `EXACT_LINK`。仅标题、仅作者、别名、译名、
出版社、系列、封面或跨层级相似一律不能自动合并。ISBN 只能定位 Edition。

## 2. 保守匹配

- 合法 ISBN-13 或相同 scoped platform/publisher ID 可形成 Edition 强候选。
- 强标识符一致但标题、语言、载体或层级不兼容时为 `CONFLICT`。
- 标题与贡献者相似只形成 `PROBABLE_REVIEW`。
- 缺少强标识符且无法找到候选时保持 `INSUFFICIENT`，不得为了填满书库强制创建 Work。
- gold fixture 的自动误合并必须为 `0`；不能为了提高 recall 放宽强标识符规则。

## 3. 人工决策

Issue 018 的桌面决策面支持 Work merge/split preview 和已有 merge/split 的 undo preview；
Expression、Edition、Agent 通过受影响 membership、relation 与 lineage 展示并随 Work 决策原子迁移，
不暴露未经实现的独立层级操作。Preview 返回：

- survivor、alias 和被影响实体；
- Work、Expression、Edition、Observation、关系和下游引用计数；
- expected revision、preview hash、过期时间；
- window-bound、短期、单次确认 token。

Confirm 必须重新校验 sender/window、token、preview hash、expected revision 和当前受影响集合，
并在单个 SQLite 事务中完成。并发漂移返回稳定冲突，不做部分写入。

## 4. 可逆 lineage

- 旧实体 ID 通过 redirect 解析到 survivor，实体行与 provenance 不硬删除。
- merge 保存移动的子实体、Observation link、关系和下游引用快照。
- split 保存新实体与被移动 membership。
- undo 追加一个新 decision，恢复原 membership/redirect；历史 decision 与 audit 仍 append-only。
- `resolution_decisions` 与 `catalog_audit_events` 禁止 UPDATE/DELETE。

旧 ID、别名、Observation 和人工 decision 都可追溯；撤销后恢复原关联，不能静默丢失
reading state、topic、research dossier 或其他下游引用。

## 5. 安全边界

确认 token 只存在于 Electron main 内存，不进入 SQLite、renderer、日志或错误详情。renderer
只接收有限 DTO，不接收 SQL、内部 lease、绝对路径、原始响应、全文、secret 或未净化 HTML。
错误 DTO 只含稳定 code、是否可重试和有限上下文。
