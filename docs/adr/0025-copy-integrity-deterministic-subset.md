# ADR 0025：Copy Integrity Deterministic Subset V1

- 状态：已验收
- 范围：M3 Issue 029A
- 基线：任务开始时本地、tracking 与实际远端 main 均为
  `46cb80f6101622eda7c11027b279c780f488fe1e`

## 1. 用户结果与诚实能力

本 Issue 只对精确 current DraftVersion、检查器版本与未截断 eligible corpus 执行有限确定性规则，
定位 exact duplicate、受支持的 surface 异常和 authoritative lineage 断裂。PASS 不代表全文无
矛盾、无语义同质化、标题与正文语义完全一致、整体质量通过或可审批、导出、发布。

INTERNAL_CONSISTENCY 固定显示 NOT_RUN / 语义阶段未实施。事实冲突继续由 Issue 026 Fact
Mapping 独占。STRUCTURED_OUTPUT 只引用 Issue 025 exact-current structural truth。

## 2. 决策

1. 实现一个 composite evaluator、一个 SQLite repository、现有 DesktopCopyRuntime 内的一组
   preview/confirm 方法、两个 IPC 和一个 Copy 工作台区块。
2. 只持久化 DUPLICATION 与 TITLE_BODY_CONSISTENCY 两类 bounded summary；复用既有
   quality_checks，不修改 Schema、migration 或 trigger。
3. 文本规范化冻结为 NFC、LF、水平空白折叠、行边界空白移除与尾首空白移除；规则和 corpus
   selection 均版本化。
4. historical eligibility 只读取 ACTIVE draft root 下、同 profile、结构有效且状态为
   READY_FOR_QUALITY_PIPELINE 的不可变版本；按 created_at、draft_id、version_number、id
   稳定排序，以 LIMIT(cap+1) 读取。超限明确 REVIEW_REQUIRED。
5. 当前稿内同类 artifact 的有意义 exact duplicate 与跨不同 draft root 的完整 public-artifact
   集合 exact duplicate 可 BLOCKED。近似 overlap、lineage 缺失/不相交和词法疑点只
   REVIEW_REQUIRED；任何阈值都没有内容副作用。
6. publications 当前不能绑定发布时 exact DraftVersion；0 条记录为 0 baseline，存在记录时
   一律 PUBLISHED_BASELINE_UNAVAILABLE / REVIEW_REQUIRED，不连接 current head。
7. preview 只读；confirm 使用既有短期单次 confirmation broker，并在写事务前重新 prepare。
   两条 summary 内容寻址、INSERT OR IGNORE、逐字段 read-back；冲突 fail closed。
8. details、DTO 与 UI 只含 allowlist identity、hash、code-point locator、reason、计数、规则版本
   和 truncation，不复制正文、历史 payload、路径、SQL、secret 或网络数据。

否决方案：完整语义一致性、模型/人工 workflow、发布 lineage migration、每个 check type 一条
平行竖切、第三个 IPC、独立页面、万能质量运行器，以及重写 Issues 025—028。它们分别属于未来
029B、其他数据任务或 Issue 030，并未获本轮授权。

## 3. 实施计划与预算

1. 冻结 evaluator 合同、reason/status、hash 输入与 bounds。
2. repository 装配 exact Draft/Brief/head、historical corpus、publication/structure truth，并
   实现 append-only/freshness。
3. 在 DesktopCopyRuntime 内接入 broker，贯通两个 exact-object IPC、preload 与 composite DTO。
4. 在现有 Copy 工作台增加一个诚实区块。
5. 以三个新测试文件覆盖 policy+repository、runtime+IPC、renderer；随后执行一次静态风险集合。
6. 更新本 ADR 的验收证据与 README/AGENTS/Roadmap 状态，创建唯一一个本地提交后停止。

实际预算：生产源码新增 1195 LOC；测试新增 699 LOC；变更 22 文件（第 21 个为状态治理，
第 22 个为不可替代的 IPC 合同样本）；IPC 恰好 2。Schema、migration、trigger、package、
dependency、route、queue、worker、model、业务 network 与 cost 均新增 0。达到 100% 阈值后只做
既有验收的根因修复与等价压缩，未增加可选能力，未超过硬上限。

## 4. 风险导向验收映射

下表在实施前建立，状态不得预填 PASS；完成后只用实际行为证据回填。

| ID       | 行为验收                                                             | 状态 | 行为证据                                             |
| -------- | -------------------------------------------------------------------- | ---- | ---------------------------------------------------- |
| I029A-01 | exact Draft/Brief/head/artifacts/corpus policy 形成确定性 input hash | PASS | policy/repository：时间无关 hash 与输入变化测试      |
| I029A-02 | 当前稿内 exact duplicate 可定位且不回传完整正文                      | PASS | policy：当前稿 exact、locator/hash 与正文泄漏断言    |
| I029A-03 | 不同 root 完整 exact duplicate 可解释；同 root 继承无自动阻断        | PASS | policy：cross-root BLOCK 与 same-root 继承表驱动用例 |
| I029A-04 | bounded overlap 只 REVIEW，阈值无内容副作用                          | PASS | policy：Unicode overlap 候选仅 REVIEW                |
| I029A-05 | corpus 稳定排序、cap+1、truncated 不得 PASS                          | PASS | policy/repository：65 项 cap+1 与 REVIEW             |
| I029A-06 | publication=0；无 exact published version 时 REVIEW 且不冒充 head    | PASS | policy/repository：0 baseline 与 unavailable lineage |
| I029A-07 | title/body lineage/surface 返回 bounded locator；语义不确定只 REVIEW | PASS | policy：authoritative lineage BLOCK、词法疑点 REVIEW |
| I029A-08 | INTERNAL_CONSISTENCY 始终 NOT_RUN；Fact Mapping/观点边界不变         | PASS | policy、runtime 与 renderer read-model 断言          |
| I029A-09 | STRUCTURED_OUTPUT 只消费 Issue 025 current truth，不写第二份摘要     | PASS | repository 两类写入断言与 renderer 状态断言          |
| I029A-10 | preview 零写入、零网络、零模型、零费用                               | PASS | repository/runtime 只读预览与 externalRequestCount=0 |
| I029A-11 | confirm 重算，head/history/publication/policy 变化拒绝旧 token       | PASS | repository/runtime stale recomputation 用例          |
| I029A-12 | token sender/window/version/hash/TTL/单次绑定，非法 DTO fail closed  | PASS | runtime+IPC sender/window/expiry/exact-object 用例   |
| I029A-13 | 两类 summary 内容寻址、insert-only、重复/并发幂等、碰撞拒绝          | PASS | repository 原子双写、read-back、碰撞回滚用例         |
| I029A-14 | read model 区分五态，旧 input 只能 STALE、缺失只能 NOT_RUN           | PASS | repository freshness 与 runtime composite DTO 用例   |
| I029A-15 | 一个工作台区块、两个 IPC，无 route/万能运行器/伪 ready               | PASS | renderer 1 区块、runtime+IPC 恰好 2 channel          |
| I029A-16 | AI/版权不变量、无平台自动动作、真实密钥/API/费用为 0                 | PASS | hard-constraints、forbidden-scope 与 source smoke    |

## 5. 验证记录

- 远端基线只读核验：GitHub Actions run `30693138176` / job `91351361382` 在上述基线 SHA 为
  success；这是变更前证据。本轮未 push，因此没有声称变更后托管 CI。
- 静态 Issue 风险 normal 使用指令冻结的 18 文件清单：首次 265/267 通过；两项明确失败经根因
  修复后只精确复验受影响文件，最终 267/267 均通过，无 skip/todo/only。
- 变更文件 Prettier、ESLint（0 warning）、`npm run typecheck`、`npm run build` 均 exit 0。
- Electron source smoke exit 0：disabled/enabled 两种本地 API 模式、受控 PID/TCP/listener、
  端口释放与进程退出清理均通过，externalConnections=0。
- 按指令不运行 `npm ci`、全仓 normal、capacity、独立 package、packaged smoke、真实浏览器
  smoke 或 dependency audit；本任务未改变依赖/lockfile，也未改变 Clipper、Local API 或发布包。
- 测试只使用合成 fixture、临时 SQLite、Scripted Mock 与 loopback；未读取真实密钥，真实 API、
  模型调用、业务网络、平台自动动作与费用均为 0。AI 标识与版权风险均未进入本检查。
