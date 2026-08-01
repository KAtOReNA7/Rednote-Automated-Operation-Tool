# ADR 0026：Minimal Quality Readiness Aggregator V1

- 状态：本地验收通过，等待精确远端 SHA 的托管 CI
- 范围：M3 Issue 030 缩减范围收口
- 基线：任务开始时本地、tracking 与实际远端 `main` 均为
  `61962153d4c4a3d64aeb6da109cc4b208711ea20`

## 1. 用户结果与诚实能力

本 Issue 只声明：

> 已读取当前 DraftVersion 的已保存、exact-current 质量结果，并即时派生质量就绪建议和人工下一步。

聚合结果不是新的权威业务状态，不自动运行、重试或确认任何检查，不修改 Draft，也不创建审批、
发布包、导出或发布。`FAST_CANDIDATE / FOCUSED_CANDIDATE` 只是未来审批候选建议，不是正式
审批层级。语义内部一致性属于未实施的 029B；当前明确显示 `NOT_RUN + DEFERRED_029B`，只路由
到重点人工复核，不能记为 PASS。

## 2. 决策

1. 聚合输入固定为 `STRUCTURED_OUTPUT / FACT_MAPPING / READING_AUTHENTICITY / SPOILER /
DUPLICATION / TITLE_BODY_CONSISTENCY / INTERNAL_CONSISTENCY` 七项 allowlist。
2. 子状态统一为 `PASS / BLOCKED / REVIEW_REQUIRED / STALE / NOT_RUN`。Fact Mapping 的
   `FACT_BLOCKED / AWAITING_REVIEW / UNCHECKED` 分别规范化为
   `BLOCKED / REVIEW_REQUIRED / NOT_RUN`。
3. 聚合状态依次为 `STALE_OR_INCOMPLETE / BLOCKED_BY_QUALITY /
REQUIRES_DETAILED_REVIEW / READY_FOR_FAST_APPROVAL`；缺失或 stale 优先，且保留已知 blocker
   和 review 的次级计数与明细。
4. 当前产品始终把 `INTERNAL_CONSISTENCY=NOT_RUN + DEFERRED_029B` 视为 focused review；只有
   纯 policy 合成 fixture 可以提供 future `INTERNAL_CONSISTENCY=PASS` 证明 fast 分支。
5. `FULL_TRICK_ANALYSIS` 即使 Spoiler saved PASS，仍要求 focused review。
6. main process 使用一个 SQLite `BEGIN` 一致读快照，读取当前 Copy detail、五类已实现检查的
   saved exact-current status，并在提交只读事务前二次核对 current version/revision。子来源读取
   失败只返回有限 `UNAVAILABLE / NOT_RUN / SOURCE_UNAVAILABLE` 行。
7. Reading、Spoiler 和 Copy Integrity 只调用 repository 的纯读取 prepare/freshness 逻辑并消费
   `savedStatus`，不调用 desktop preview runtime、confirm、confirmation broker 或 token registry，
   也不向 renderer 提升临时 `evaluationStatus`。
8. 聚合结果不落库，不保存 snapshot、hash 或 cache；每次现有 `copy:get` 即时派生。新增 IPC、
   preload method、route、Schema、migration、trigger、queue、worker、model、network 和 cost 均为 0。
9. renderer DTO 只含 schema version、Draft 显示 identity/revision/status、四态建议、七项有限
   status/capability/reason/summary/nextAction、计数和 false 能力标记；不含正文、input hash、digest、
   raw payload、路径、token、SQL 或内部错误。
10. AI 标识、AI 参与程度、版权风险、版权判断、成本、预算、平台账号状态与隐藏优先级均不属于
    输入，不能改变结果。

否决方案：不复用旧 core 二态 `applyQualityChecks`；不持久化 aggregate readiness；不新增万能检查
运行器；不实现 029B；不写 approvals/post_packages/publications；不进入视觉、导出、发布或 M4。

## 3. 数据流与错误边界

```text
Copy Workbench refresh
  -> existing copy:get
  -> DesktopCopyRuntime.get
  -> SqliteQualityAggregateReadModel (one read snapshot)
       -> current Copy DraftVersion + structural truth
       -> Fact Mapping saved exact-current status
       -> Reading Authenticity saved exact-current status
       -> Spoiler saved exact-current status
       -> Duplication + Title/Body saved exact-current statuses
       -> INTERNAL_CONSISTENCY = NOT_RUN / DEFERRED_029B
  -> pure evaluateQualityReadiness
  -> renderer-safe qualityReadiness DTO
```

未知枚举、当前身份不一致、非 029B 的 capability 缺失和读取失败均 fail closed，不默认 PASS。
renderer 断开不会留下 token、lease、timer、listener 或待恢复写入。聚合读取不启动队列、模型、
provider、Search、Fetch、图片、文件写入或业务网络。

## 4. 实施计划与预算

实施前冻结的顺序：

1. 纯 policy reducer 与 renderer-safe 类型；
2. 单事务 SQLite read model；
3. 现有 `copy:get` 与 Copy Workbench 只读卡片；
4. policy、read-model/runtime、renderer 三个测试文件；
5. 本 ADR、README、AGENTS、Roadmap 和指令唯一归档；
6. 附件限定的本地门禁、唯一提交、普通 push 与精确 SHA Windows CI。

硬预算：生产源码新增不超过 650 LOC，测试新增不超过 500 LOC，变更文件不超过 16；其余新增项
（IPC、preload method、route、package、dependency、table、trigger、migration、queue、worker、
model、network、cost）全部为 0。实际值：生产源码新增 509 LOC，测试新增 496 LOC，变更恰好
16 文件；其余受限项全部为 0。达到测试预算 80% 后只保留既有验收的根因修复和等价测试去重，
没有新增可选文案、抽象或指标。

## 5. 风险导向验收映射

下表在编码前按正式指令冻结；状态不预填 PASS，完成后只以实际行为证据回填。

| ID      | 行为验收                                                                     | 状态 | 证据                                                     |
| ------- | ---------------------------------------------------------------------------- | ---- | -------------------------------------------------------- |
| I030-01 | 绑定 current DraftVersion/revision；变化或 invalidation 后旧结果不参与 ready | PASS | read-model/runtime：新 DraftVersion 的四项旧摘要均 STALE |
| I030-02 | 七类来源各自显示状态、原因和下一动作                                         | PASS | policy、runtime、renderer：固定顺序七行与 UI 明细        |
| I030-03 | 已具备能力的 stale/not-run/unchecked 永不进入 ready/review-pass              | PASS | policy 表驱动 + DB 中 FACT_MAPPING 未运行路径            |
| I030-04 | incomplete、blocker、review 优先级稳定并保留次级原因                         | PASS | policy 表驱动：stale 优先且 blocker 计数保留             |
| I030-05 | 029B deferred 只进入 detailed review，不记 PASS、不阻断读取                  | PASS | policy/read-model/renderer：FOCUSED + NOT_RUN/DEFERRED   |
| I030-06 | 合成七项 current PASS 证明 fast；产品不伪造 internal PASS                    | PASS | policy：唯一合成 fast fixture；DB 始终 deferred          |
| I030-07 | 完整剧透在 Spoiler PASS 时仍为 focused candidate                             | PASS | policy：full-spoiler review signal 用例                  |
| I030-08 | 聚合前后业务表、jobs/token/审批/发布表不变；模型/网络为 0                    | PASS | read-model 全表 snapshot + source smoke external=0       |
| I030-09 | 只用 `copy:get`；新增 IPC/preload 为 0；DTO 无敏感内部字段                   | PASS | runtime channel/DTO key/正文泄漏断言与架构测试           |
| I030-10 | UI 显示诚实四态和七项明细，无审批/导出/发布/绕过入口                         | PASS | renderer：唯一总览区、七行、仅刷新按钮                   |
| I030-11 | AI/版权不影响聚合；文档记录 029B deferred、minimal 030 与 M4 边界            | PASS | policy 元数据不变量、hard constraints、文档治理测试      |

## 6. 验证记录

- Phase 0：本地、tracking、实际远端均为上述基线 SHA，ahead/behind `0/0`、工作树干净；该 SHA
  GitHub Actions run `30696583832`、Windows job `91360411442` 为 success，normal、capacity、
  source/packaged Electron smoke、build、desktop/clipper package、audit 和 cleanup 均成功。
- 三个新测试首次运行 3/3 文件、11/11 用例通过。预算等价去重后只精确复验 read-model 文件，
  2/2 通过。
- 静态 Issue 风险 normal 首次 61/62 通过；唯一失败是 repository documentation 仍硬编码旧的
  “028 complete / 029 next”。精确修复治理断言并按两次新定位调整合法 Markdown 换行后，该文件
  6/6 通过；未盲目重跑其余 17 个已经通过的文件。
- 变更文件 Prettier 通过；ESLint 首次只发现一个测试内联类型导入，精确修复后该文件 0 warning，
  其余变更文件此前均通过。`npm run typecheck` 与 `npm run build` 均 exit 0。
- Electron source smoke 复用已构建 desktop，disabled/enabled 两种本地 API 模式均 exit 0；受控
  PID 全部退出、端口释放、外部业务连接 0、disabled listeners 0、enabled loopback listener 1。
- 按正式指令本地不运行 `npm ci`、全仓 normal、独立 capacity、package、packaged smoke、
  Clipper/真实浏览器 smoke 或 dependency audit；这些信号由 push 后精确 SHA 的 Windows CI 验证。
- 测试只使用合成 fixture 与临时 SQLite；未读取真实密钥，模型/API/业务网络/平台动作/费用为 0。
- 最终托管 CI 必须在唯一提交普通 push 后读取精确新 SHA；提交内不预先声称未发生的远端结果。

## 7. M3 缩减范围收口与下一步

只有本地适用门禁和精确新 SHA 的 required Windows CI 均通过后，M3 才按缩减范围收口：Issues
022—028 complete；Issue 029A complete；原 Issue 029 partial、029B deferred；minimal Issue 030
complete；M4 未开始。不能声称原 Roadmap 的完整语义 029/030 自动化已经交付。

收口后的唯一下一步是另行授权一次受控本地内容试运行：合法本地内容、手工 Draft、真实 API/
模型/费用/平台动作均为 0；保存各项检查、查看聚合卡、验证 Draft 修改后旧结果 stale，并记录
detailed review 的实际耗时和 029B 缺口。到 fast/focused candidate 即停止，不创建审批或发布包。
