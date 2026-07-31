# M3 Issue 027 前验证可靠性盘点

## 结论与边界

- 动态起点：干净 `main`、HEAD `3d0fb4c`、领先远端 3 个提交；结论：`VALIDATION_RELIABILITY_FEASIBLE`。
- 只修改治理、测试配置/runner、Windows CI 与治理测试；产品与 Issue 027 均不修改。
- 普通入口排除容量清单；容量入口只串行运行同一清单，交集为 0；领域专项不进入固定 CI。

## 容量、性能、长路径与大规模文件

下表文件原本均被全量自动发现；“墙钟”仅表示受 Vitest timeout 约束，不改变任何性能阈值。

| 文件                                 | 静态理由                                | 墙钟 | 当前专项入口        | 隔离决定 |
| ------------------------------------ | --------------------------------------- | ---- | ------------------- | -------- |
| `bibliography-capacity.test.ts`      | 10,000 Work 与更大子记录                | 60s  | `test:bibliography` | 容量     |
| `briefs-capacity.test.ts`            | 冻结集合/字节上限                       | 默认 | `test:briefs`       | 容量     |
| `dossier-capacity.test.ts`           | 10,000 dossier 与 query plan            | 45s  | `test:dossier`      | 容量     |
| `evidence-capacity.test.ts`          | 10,000 Claim 与 query plan              | 30s  | `test:evidence`     | 容量     |
| `experiments-capacity.test.ts`       | 500 Topic、220 Experiment 与 query plan | 45s  | `test:experiments`  | 容量     |
| `fact-mapping-capacity.test.ts`      | 1,000 Draft；曾在全量中触发默认 5s      | 默认 | `test:fact-mapping` | 容量     |
| `topics-capacity.test.ts`            | 10,000 Topic 与 query plan              | 45s  | `test:topics`       | 容量     |
| `queue-performance-platform.test.ts` | 1,000 Job、query plan 与平台行为        | 默认 | `test:queue`        | 容量     |
| `queue-worker.test.ts`               | 真实墙钟等待、关闭和租约生命周期        | 默认 | `test:queue`        | 容量     |
| `search-db.test.ts`                  | 实际长 Windows 路径与 SQLite query plan | 默认 | `test:search`       | 容量     |
| `storage-logging.test.ts`            | 100 字段、100 次并发 append 与上限      | 15s  | `test:storage`      | 容量     |
| `storage-repository.test.ts`         | 32 MiB 流式文件与 128 chunks            | 默认 | `test:storage`      | 容量     |
| `storage-root-paths.test.ts`         | 实际 Windows 长路径与并发初始化         | 默认 | `test:storage`      | 容量     |

`db-persistence-windows.test.ts`、`windows-paths.test.ts` 与 `portability.test.ts` 不构造长路径或大规模
数据，留在普通集合；其他迁移、恢复、安全测试不依赖大规模 cardinality 或性能阈值，也留在普通集合。

## 实施与验收结果

1. `PASS`：diff 仅含治理、runner/配置、CI 与治理测试，产品及 Issue 027 未修改。
2. `PASS`：`AGENTS.md` 唯一定义三类失败与进展式处置；future Issue 模板只引用该定义。
3. `PASS`：observable runner 在启动前创建 stdout/stderr、JSON、UTC 起止与真实 exit code 证据。
4. `PASS`：200 个测试文件静态分为普通 187、容量 13，交集为 0；Fact Mapping 只在容量清单。
5. `PASS`：13 个容量文件的断言、规模与 timeout byte-for-byte 未修改。
6. `PASS（组合证据）`：normal 唯一运行定位 11 项失败；修正后失败治理集 65/65、capacity 92/92 通过，未盲目重跑 normal。
7. `PASS`：Windows CI 只各调度一次非重叠 normal/capacity，不加入领域专项重复链。
8. `PASS`：无产品、Schema、IPC、dependency、业务网络或费用变化；提交后停止，不进入 Issue 027。
