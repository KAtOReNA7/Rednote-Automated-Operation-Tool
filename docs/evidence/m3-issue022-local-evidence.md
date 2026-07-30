# M3 Issue 022 本地验收证据

## 结论与边界

- 动态开工基线：本地 `main` 的
  `6fcbb427b12834a0b4a2cf8994682fa353c797d3`；`origin/main` 保持
  `143222107dcb3c65d873b075b90e50b515f77ed6`。
- 本轮只实施 Topic Pool 与 First-30 配额；未执行 pull、rebase、reset 或 push，未进入
  Issue 023。
- 执行指令唯一归档于
  `docs/instructions/m3/M3-Issue022-topic-pool-first-30-quota-Codex-instruction.txt`。
- 测试只使用合成 fixture、临时 SQLite、Scripted Mock、隔离浏览器配置与本机 loopback。
  真实密钥读取、业务网络、真实模型/API 调用和费用均为 0。
- Experiment、Content Brief、Draft、标题、正文、图片与质量流程均未实现，受保护表在金标中保持
  0 行。

## 合成金标结果

完整组合 fixture 使用 18 个 ready Work，纯本地确定性生成 135 个候选：

| Topic Content Type                |  候选数 | `FIRST_30_V1` 入选数 |
| --------------------------------- | ------: | -------------------: |
| `NON_SPOILER_SINGLE_BOOK_VERDICT` |      10 |                   10 |
| `FULL_TRICK_LOGIC_ANALYSIS`       |       8 |                    8 |
| `CROSS_WORK_COMPARISON`           |      73 |                    6 |
| `WEB_VS_PUBLISHED_MYSTERY`        |      41 |                    3 |
| `MYSTERY_AND_CULTURAL_PHENOMENON` |       3 |                    3 |
| **合计**                          | **135** |               **30** |

COMPLETE 计划精确为 10/8/6/3/3，30 个 topic ID 与 30 个 semantic fingerprint 均不重复，
全部 snapshot eligibility 为 `ELIGIBLE`。完整剧透候选保留
`COVER_TITLE_AND_BODY_OPENING` 警告位置和用户确认要求。

INCOMPLETE 金标只提供 1 个单书不剧透候选、1 个同 fingerprint 重复项和 20 个完整诡计候选。
结果只选择 9 项，shortfall 精确为 9/0/6/3/3；没有跨类补位、重复 fingerprint 或放宽资格。

eligibility policy 金标对九态均有显式断言：

| eligibility 状态              | 显式金标断言数 |
| ----------------------------- | -------------: |
| `ELIGIBLE`                    |              6 |
| `DOSSIER_NOT_READY`           |              1 |
| `AUTHENTICITY_BLOCKED`        |              2 |
| `FACT_BLOCKED`                |              2 |
| `STALE`                       |              3 |
| `INSUFFICIENT_COMPARISON_SET` |              1 |
| `SPOILER_POLICY_INCOMPLETE`   |              1 |
| `DUPLICATE`                   |              1 |
| `ARCHIVED`                    |              1 |

状态机金标覆盖 `PROPOSED`、`LOCKED`、`HELD`、`ARCHIVED` 四态，以及
lock/hold/resume/archive/restore/undo。过量锁定返回 `OVER_LOCKED`；不合格 LOCKED 不会绕过
eligibility。repository/runtime 金标还覆盖 expected revision、单次确认 token、append-only
历史、跨实例竞争、stale、no-op、失败、取消和重启恢复。

## Ranking、去重与计划证据

- 五项 ranking 的已知金标整数分别为 Evidence Sufficiency 9200、Content Fit 9500、
  Differentiation 10000、Estimated Cost 10000、Approval Workload 9300；加权总分为 9530。
- cost/workload 未知时保持 `UNKNOWN` 与 `null`，只计算 3 个已知分量，不把未知伪装为 0 或最佳。
- 输入、依赖、Dossier 和比较主体乱序后结果不变；求解顺序固定为合格 LOCKED、总分、稳定
  tie-break。
- semantic fingerprint 固定消费 content type、canonical subjects、comparison dimension、
  spoiler level、analysis mode 与规范化 angle intent。轻微措辞和比较主体乱序去重，不同真实
  angle 保留。
- pool 变化只把 current plan 标记 stale，不自动重排；显式重建保留 previous/superseded
  版本，相同 snapshot/hash 为 deterministic no-op。

## Migration 与数据保留

- 仅追加 migration v15 `topic_pool_and_first_30_quota`，没有修改 v1—v14。
- v15 扩展同一 `topics` identity，并增加 candidate version、subject、score、transition、
  generation、quota plan、dependency、invalidation 与 audit 结构。
- 新库、v14 升级、迁移前备份、事务回滚、STRICT/FK/CHECK/unique/delete policy、关键索引、
  `quick_check` 与 `foreign_key_check` 全部通过。
- Catalog、Evidence、Dossier 与 Reading Authenticity 合成数据在升级后完整保留。

## 最终本地门禁

最终证据链从一次新的 `npm ci` 开始，严格按 `.github/workflows/ci.yml` 顺序执行：

| 命令                            | 结果                                  |
| ------------------------------- | ------------------------------------- |
| `npm ci`                        | 257 packages；0 vulnerabilities       |
| `npm run format-check`          | PASS                                  |
| `npm run lint`                  | PASS，0 warnings                      |
| `npm run typecheck`             | PASS                                  |
| `npm run test:constraints`      | 4 files / 49 tests PASS               |
| `npm run test:db`               | 6 files / 35 tests PASS               |
| `npm run test:queue`            | 9 files / 131 tests PASS              |
| `npm run test:storage`          | 6 files / 75 tests PASS               |
| `npm run test:desktop`          | 6 files / 90 tests PASS               |
| `npm run test:settings`         | 9 files / 207 tests PASS              |
| `npm run test:local-api`        | 12 files / 132 tests PASS             |
| `npm run test:providers`        | 13 files / 188 tests PASS             |
| `npm run test:portability`      | 1 file / 4 tests PASS                 |
| `npm run test:capabilities`     | 10 files / 48 tests PASS              |
| `npm run test:model-accounting` | 9 files / 205 tests PASS              |
| `npm run test:search`           | 8 files / 49 tests PASS               |
| `npm run test:fetch`            | 9 files / 55 tests PASS               |
| `npm run test:clipper`          | 9 files / 28 tests PASS               |
| `npm run test:bibliography`     | 7 files / 171 tests PASS              |
| `npm run test:evidence`         | 9 files / 199 tests PASS              |
| `npm run test:dossier`          | 10 files / 177 tests PASS             |
| `npm run test:authenticity`     | 10 files / 212 tests PASS             |
| `npm run test:topics`           | 14 files / 206 tests PASS             |
| `npm run test:electron-smoke`   | PASS；externalConnections 0；端口释放 |
| `npm run test`                  | 154 files / 1359 tests PASS           |
| `npm run build`                 | PASS                                  |
| `npm run package:desktop`       | PASS；Electron fuses verified         |
| `npm run package:clipper`       | PASS；Chrome/Edge unpacked packages   |
| `npm run test:packaged-smoke`   | PASS；externalConnections 0；端口释放 |
| `npm run audit:dependencies`    | PASS；0 vulnerabilities               |

额外运行 `npm run test:clipper-real`：首轮 Chrome 前台快捷键触发超时；未修改测试或断言，
隔离清理后重跑，Chrome 与 Edge loopback smoke 均通过并完成清理。

应用内浏览器的非 CI 交互式页面检查因连接器初始化本机临时资源失败而未形成有效浏览器会话；
没有把该工具故障伪装成 UI 验证成功。Topic renderer 行为测试、Electron source smoke 与
packaged smoke 均已通过，因此该非 CI 工具限制不改变 Issue 022 的门禁结论。未触发或声称远端
托管 CI。
