# M2 Issue 018 实施计划：书目发现、三级模型与可逆实体解析

状态：已完成；验收证据在实现与提交前门禁完成后回填。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现；开工分支为 `main`。
- 本地与 `origin/main` 同步且 ahead/behind 为 `0/0`，无需执行快进。
- 工作树开工时干净；Issue 018 指令已完整读取并只移动到
  `docs/instructions/m2/`。
- 当前 migration 尾部为 v10；`books`、`authors`、`book_editions` 和全部下游引用存在。
- SearchCandidate 固定 `LEAD_ONLY / NOT_FETCHED / UNVERIFIED / NOT_A_FACT`；
  FetchDocument 固定 `FETCHED_NOT_EVIDENCE / UNVERIFIED / NOT_A_FACT`；
  BrowserClip Candidate 为被动本地候选。
- `sources`、`claims`、`claim_evidence` 和 `research_dossiers` 属于后续事实研究范围，本轮不写入。

## 目标

1. 定义有界、版本化、不可变的 BibliographicObservation。
2. 将既有 `books` 安全升级为 Work，并加入 Expression，使 Edition 只指向 Expression。
3. 建立 Agent、alias、标识符、分层关系和待核验 publication relationship。
4. 实现 ISBN/scoped ID、Unicode 与多语种确定性规范化。
5. 实现保守规则解析、人工 merge/split/undo、旧 ID redirect 与 append-only audit。
6. 实现 DiscoveryPortfolio/Profile/Plan/Run、coverage/gap 和持久队列 checkpoint。
7. 激活桌面书库页面和窄 IPC。
8. 用 gold fixture 证明自动误合并为 0；用 10,000 Work 合成数据验证容量与索引。
9. 定向修订 PRD/Roadmap 的固定 50 本口径，并更新 README、文档索引和 CI。

## 实施顺序

1. 冻结合同、ADR、计划和验收映射。
2. 定向修订 PRD/Roadmap。
3. 新增 `packages/catalog`：合同、规范化、ISBN、解析、计划和服务。
4. 追加 migration v11 和 `SqliteCatalogRepository`。
5. 新增 Discovery queue handler、checkpoint、恢复、暂停和取消。
6. 新增 main-only 确认 broker、catalog runtime、IPC/preload 和 Library UI。
7. 新增专项、容量、迁移、架构、egress 与 UI 测试。
8. 更新 README、文档索引、CI 和 acceptance evidence。
9. 从最新 `npm ci` 开始完整执行适用门禁。
10. 审计后创建唯一一个本地提交并停止。

## 数据与安全策略

- 不读取真实密钥、正式用户书库或真实业务数据。
- 不调用真实模型、搜索、网页、图片或业务 API，不产生费用。
- 测试只用运行时合成 fixture、临时 SQLite 和本机无网络执行。
- Queue payload/result、IPC 和错误 DTO 均有界且不含正文、路径、URL query、secret 或内部 lease。
- publication relationship 不进入任何 gate/score/approval/priority/schedule/export 代码路径。

## 停止点

完成 Issue 018 的全部门禁和唯一一个本地提交后立即停止。不 push，不创建 PR，不进入 Issue 019。
