# M3 Issue 028 验收证据

基线：`dbc373e16cfd610838ef7ac1e77a6d6e3321f66a`。本文件只记录 Issue 028 确定性剧透子集；
不包含正文、警告全文、凭据、绝对路径或测试数据库。

Phase 0 动态确认本地 `main`、tracking branch 与 `origin/main` 均为该基线，分叉为 0/0；当前基线
对应的 GitHub Actions run `30688937130`、Windows job `91340099924` 以及 normal、capacity、
Electron、build、package、packaged smoke、dependency audit 和清理步骤均为成功。

## 验收映射

| ID        | 行为证据                                                                 | 当前证据状态 |
| --------- | ------------------------------------------------------------------------ | ------------ |
| I028-AC01 | policy 拒绝非 READY/结构无效输入；repository 只查询 current head         | PASS         |
| I028-AC02 | policy 表驱动验证 lineage、input/lock hash、plan 与 readiness 冲突       | PASS         |
| I028-AC03 | NO placement/flags/四 warning surface                                    | PASS         |
| I028-AC04 | LIGHT opening、FULL 降级冲突及错误 surface                               | PASS         |
| I028-AC05 | FULL 确认、四 warning surface 与当前标题 marker                          | PASS         |
| I028-AC06 | 含合成凶手、结局、核心诡计的 FULL 正文仍为 PASS                          | PASS         |
| I028-AC07 | NO/LIGHT 候选只输出 code-point locator/hash，状态为 REVIEW_REQUIRED      | PASS         |
| I028-AC08 | 笼统警告与 scan/finding truncation 不会静默 PASS                         | PASS         |
| I028-AC09 | Copy 工作台卡片明示确定性子集和诚实边界，无审批/导出/发布入口            | PASS         |
| I028-AC10 | runtime/SQLite 仅传递和保存有界 allowlist 元数据                         | PASS         |
| I028-AC11 | 重复确认幂等；碰撞逐字段回读失败；旧摘要不更新不删除                     | PASS         |
| I028-AC12 | current pointer、artifact 与 Draft/Brief invalidation 使旧摘要 STALE     | PASS         |
| I028-AC13 | preview 零写入；confirm 绑定 sender/window/revision/hash、单次消费并重算 | PASS         |
| I028-AC14 | exact-object IPC、固定 preload/main registry、renderer Node 隔离         | PASS         |
| I028-AC15 | 0 package/Schema/model/network/cost；全部数据为本地合成 fixture          | PASS         |
| I028-AC16 | AI/版权额外元数据不改变 input hash/status；FULL 始终允许                 | PASS         |

## 实际验证

- 开发专项：policy 9/9、renderer 1/1、repository/runtime/IPC 集成 4/4；受影响 IPC 与仓库文档
  精确集合 208/208。
- Issue 风险 normal 仅选择 20 个静态非 capacity 文件。首次结果为 327/328；唯一失败是完成状态
  已更新的 README/Roadmap 与尚未更新的 AGENTS 不一致。该失败归类为
  `PRODUCT_OR_TEST_FAILURE`，修复状态事实后只重跑精确的文档、AGENTS 与 spoiler 集成文件，
  24/24 通过。最终未解决失败、skip、todo、only 与 warning 均为 0。
- `npm run format-check`、`npm run lint`、最终 `npm run typecheck` 与 `npm run build` 均成功。
- `npm run test:electron-smoke` 成功；外部业务连接为 0，disabled/enabled 两种模式端口均释放，
  listener 与子进程按 smoke 合同退出。enabled 模式仅访问本机 capability fixture。
- capacity、desktop/clipper package、packaged smoke、真实浏览器 smoke、`npm ci` 与 dependency
  audit 为 N/A：本 Issue 未改变依赖、lockfile、打包、浏览器或容量风险面。

## 差异与预算

- 生产源码新增 1,232 LOC、删除 1 LOC；测试新增 789 LOC、删除 1 LOC。
- 变更文件 24；新 IPC 恰好 2；新 package、dependency、表、trigger、migration 均为 0。
- 指令归档为 1 份；未发现真实密钥字面量、业务网络客户端、测试 `skip/todo/only` 或未授权范围。
- fixture、临时数据库、确认令牌与本机 loopback 均为合成或运行时随机值；模型调用和费用为 0。
