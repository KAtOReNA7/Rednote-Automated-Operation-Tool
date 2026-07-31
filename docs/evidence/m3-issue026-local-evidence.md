# M3 Issue 026 本地验收证据

状态：本地验收完成，正式门禁全部通过，等待随本轮唯一提交交付。

## 动态基线

- 仓库根由 `git rev-parse --show-toplevel` 动态发现为当前工作区。
- 开工分支：`main`。
- 开工 HEAD、本地 `origin/main` 与只读远端 `main`：
  `5959e5b157ac91a6e8773834b48df3367f0fad9c`。
- 开工工作树干净；Issue 025 的 `test:copy` 基线为 219 项通过。
- Issue 026 指令已保持字节不变，唯一归档到 `docs/instructions/m3/`。
- 未执行 pull、rebase、reset、merge、push、PR 或分支切换。

## 实现证据

- `packages/quality` 提供 Draft artifact、Unicode locator、原子 Statement、分类、protected
  signal、候选 allowlist、typed compatibility、fact policy、rollup、人工修改和受控辅助输出校验。
- migration v19 追加 FACT_MAPPING check/version/statement/link/evidence trace/dependency/decision/run
  结构；历史 migration 未修改。
- SQLite repository 提供只读候选构建、不可变版本、人工复核、Claim—FactEvaluation—Evidence—
  SourceRevision 回溯、精确失效、质量汇总与有界查询。
- `FACT_MAPPING_CHECK_V1` 工作流只允许本地确定性执行或一次既有
  `ModelExecutionService` 结构化请求；没有 tool、search、retry、repair、fallback 或换模型。
- Electron main/preload/IPC/shared DTO 与事实映射工作台已接入，renderer 保持无特权。

## 验证结果

正式门禁从一次最新 `npm ci` 开始，使用仓库所在卷内的受控临时目录和 npm cache，按 Windows
CI 的实际顺序执行。结果如下：

| 门禁                                                        | 结果                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm ci`                                                    | 261 个依赖包安装；284 个包审计；0 漏洞                                       |
| `format-check` / `lint` / `typecheck`                       | 全部通过；0 warning                                                          |
| `test:constraints`                                          | 4 文件，49/49                                                                |
| `test:db` / `test:queue`                                    | 35/35；131/131                                                               |
| `test:storage` / `test:desktop` / `test:settings`           | 75/75；92/92；247/247                                                        |
| `test:local-api`                                            | 132/132                                                                      |
| `test:providers` / `test:portability` / `test:capabilities` | 188/188；4/4；48/48                                                          |
| `test:model-accounting`                                     | 247/247                                                                      |
| `test:search` / `test:fetch` / `test:clipper`               | 49/49；55/55；28/28                                                          |
| `test:bibliography` / `test:evidence` / `test:dossier`      | 211/211；239/239；217/217                                                    |
| `test:authenticity`                                         | 252/252                                                                      |
| `test:topics` / `test:experiments`                          | 246/246；55/55                                                               |
| `test:briefs` / `test:copy`                                 | 250/250；233/233                                                             |
| `test:fact-mapping`                                         | 12 文件，253/253                                                             |
| `test:electron-smoke`                                       | source smoke 通过；外部连接 0；listener/端口均释放                           |
| `npm test`                                                  | 198 文件，1,634/1,634；0 failed/skip/todo                                    |
| `npm run build`                                             | TypeScript project references、Clipper、renderer、preload、main 全部构建成功 |
| `package:desktop` / `package:clipper`                       | Windows 目录与 Chrome/Edge unpacked 包成功生成                               |
| `test:packaged-smoke`                                       | fuses=true；外部连接 0；listener/端口均释放                                  |
| `audit:dependencies`                                        | 0 漏洞                                                                       |

v19 由运行时发现为 `factual_claim_mapping`，规范化 migration checksum 为
`d3d4ba93416c94bb38385e11151dec8c95fd9b66415f22d62b60d2d58a036b16`。专项迁移测试验证：

- 新库的 FACT_MAPPING 表全部为 STRICT，外键检查为空，`quick_check=ok`；
- v1—v18 升级前创建可独立打开的备份，Issue 025 current Draft 保留；
- 最后一条语句故障时 v19 的表与 schema 版本完整回滚；
- 历史 migration 未修改，换行规范化身份仍由既有门禁冻结。

Issue 026 指令归档文件 SHA-256 为
`a22fe886272c02ce708683d905dc5cfa97d5a6fe725dbe6c1c73608e1571754c`，Desktop 原位置已不存在。
60 项验收的逐项独立证据见 [`../m3-issue026-acceptance-map.md`](../m3-issue026-acceptance-map.md)。

## 外部副作用与停止边界

- 测试只使用合成 fixture、临时 SQLite、Scripted Mock 与本机 loopback。
- 未读取真实密钥，业务网络请求、真实模型/API 调用与费用均为 0。
- 未触发托管 CI；本地通过不能推断托管 CI 状态。
- 未实现 Issue 027—030、图片、审批、导出或发布。
- 交付提交将在本文件完成审计后创建；提交 SHA 只在提交后的只读核验和最终报告中记录。
