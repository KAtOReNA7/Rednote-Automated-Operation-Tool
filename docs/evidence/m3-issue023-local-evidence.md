# M3 Issue 023 本地验收证据

## 结论与边界

- 动态开工基线为本地 `main` 的 `7ff02b5d9dcb4143eae879d7407650e0bf76a0cc`；开工时本地合法
  领先 `origin/main` 五个提交。本轮未执行 pull、rebase、reset 或 push。
- 执行指令唯一归档于
  `docs/instructions/m3/M3-Issue023-versioned-experiment-management-Codex-instruction.txt`。
- 本轮只实现版本化单变量实验设计、确定性 assignment、精确失效和实验管理 UI；未进入
  Issue 024。
- fixture 全部为合成数据，数据库均为仓库卷临时 SQLite。真实密钥读取、业务网络、真实 API/
  模型调用和费用均为 0。

## 合成金标

金标使用一个 Experiment、两个 immutable DesignVersion、每版两个 arm、一个 primary metric、
两个 guardrail 和一个 ReplicationStructure。第一版以八个 current/eligible Topic 覆盖八个不同
canonical Work：

| 项目       | 结果                                                     |
| ---------- | -------------------------------------------------------- |
| 单变量     | `CONTENT_STRUCTURE`，精确一个 control 与一个 treatment   |
| 主指标     | `SAVE_RATE / DEFINED_NOT_AVAILABLE`                      |
| Work 复现  | 8 个不同 Work，超过最低 3 个                             |
| 热度分层   | HOT/WARM/COLD/UNKNOWN 各 2                               |
| arm 分配   | control 4、treatment 4                                   |
| assignment | `READY_TO_LOCK`，保存后可 `LOCKED`                       |
| 真实结果   | `NOT_EXECUTED_NO_EFFECT_CONCLUSION`                      |
| 第二版本   | locked 后 clone 为新的 `DRAFT`，历史与旧 assignment 保留 |

非法多变量 fixture 同时声明 `CONTENT_STRUCTURE` 和 `TITLE_PATTERN`，被
`EXPERIMENT_POLICY_BLOCKED` 拒绝。只有两个 canonical Work 的 fixture 明确返回
`INSUFFICIENT_REPLICATION`；目标数超过样本数时返回逐 arm shortfall，不复制 Topic。
500 Topic 上限输入与反向乱序输入得到完全相同 assignment。

## 失效、no-op 与锁定

- 相同 assignment input hash 重放不新增 plan，revision 不变。
- 相关 Topic/Work、FIRST_30 plan、Dossier、Expression Permission、热度快照和 experiment
  policy 变化均追加精确 invalidation。
- 无关 Work 变化不产生 experiment invalidation。
- stale 后 current design/assignment pointer、assignment hash 和锁定语义不变；系统不自动重排、
  解锁或切换版本。
- `LOCKED` 只冻结设计，不创建执行、结果、Brief、Draft、质量或发布对象。

## Migration 与数据保留

- 在运行时发现的 v15 之后只追加 migration v16
  `versioned_experiment_management`；v1—v15 未修改。
- migration 规范扩展同一 `experiments` identity，并增加 design、arm、controlled condition、
  metric、guardrail、structure、sample、popularity、assignment、dependency、invalidation、
  transition、audit 和 policy 表。
- 旧 experiment 保守迁移为 `legacy-experiment-v0 / DRAFT`，不伪装为 VALIDATED。
- 新库、v15 升级、迁移前备份、事务回滚、STRICT/FK/CHECK/unique、append-only、quick_check 与
  foreign_key_check 由专项和既有 DB 测试覆盖；Issues 018—022 合成数据完整保留。

## 内容与统计边界

受保护的 `content_briefs`、`drafts`、`assets`、`quality_checks`、`approvals`、`post_packages`
和 `publications` 在金标中保持 0 行。没有生成标题、正文、图片或 Content Brief，也没有录入
真实 numerator、denominator、baseline，未计算 effect、显著性、p 值、power、uplift 或 winner。

## 最终本地门禁

最终门禁在最后一次代码/测试修正后，从一次最新 `npm ci` 开始按 Windows CI 顺序执行。全部命令
成功退出，无失败、skip、todo、lint warning、漏洞、意外业务网络请求或残留 listener：

| 门禁                                                                         | 结果                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `npm ci`                                                                     | PASS；安装 258 个包，审计 278 个包，0 漏洞           |
| `npm run format-check` / `lint` / `typecheck`                                | PASS                                                 |
| `test:constraints` / `db` / `queue` / `storage` / `desktop`                  | PASS；49 / 35 / 131 / 75 / 92 项                     |
| `test:settings` / `local-api` / `providers` / `portability` / `capabilities` | PASS；215 / 132 / 188 / 4 / 48 项                    |
| `test:model-accounting` / `search` / `fetch` / `clipper`                     | PASS；215 / 49 / 55 / 28 项                          |
| `test:clipper-real`                                                          | PASS；隔离 Chrome 与 Edge、本机 loopback、完成后清理 |
| `test:bibliography` / `evidence` / `dossier` / `authenticity` / `topics`     | PASS；179 / 207 / 185 / 220 / 214 项                 |
| `test:experiments`                                                           | PASS；13 个测试文件、55 项                           |
| `test:electron-smoke`                                                        | PASS；0 外部连接，启用/禁用模式端口均释放            |
| `npm run test`                                                               | PASS；167 个测试文件、1,424 项                       |
| `npm run build` / `package:desktop` / `package:clipper`                      | PASS                                                 |
| `test:packaged-smoke`                                                        | PASS；fuses 已验证、0 外部连接、端口均释放           |
| `audit:dependencies`                                                         | PASS；0 漏洞                                         |

应用内浏览器连接器在建立会话前因本机内核资源路径初始化错误
`failed to write kernel assets: 系统找不到指定的路径。 (os error 3)` 未形成可计为 PASS 的人工交互
复核；该限制与仓库代码无关，也未替代 renderer 行为测试、Electron source smoke 或 packaged
smoke。未触发或声称远端托管 CI。
