# M2 Issue 018 本地验收证据

## 基线与范围

- 动态仓库根：由 `git rev-parse --show-toplevel` 发现。
- 开工分支和基线：`main@143222107dcb3c65d873b075b90e50b515f77ed6`。
- 同步结果：本地与 `origin/main` ahead/behind 为 `0/0`，没有需要应用的快进提交。
- Issue 指令仅保留为
  `docs/instructions/m2/M2-Issue018-bibliographic-discovery-entity-resolution-Codex-instruction.txt`。
- 本轮只实现 Issue 018；未实现 Issue 019。

## 关键结果

- migration v11：`bibliographic_catalog_and_entity_resolution`。
- 规范化 SHA-256：
  `ad0e67dab752e41e1903df13b88665c99194fb527d5f5efb01c96b4d855c3750`。
- v10→v11：保留旧 Work、Author、Edition 和下游 reading state ID；迁移前备份可独立打开。
- gold fixture：2 Work / 2 Expression / 2 Edition；自动误合并为 0。
- 缺失标题：即使有有效强标识符也只进入人工复核，不生成占位实体事实。
- 容量 fixture：10,000 Work、20,000 Expression、20,000 Edition、20,000 Observation；
  关键列表查询使用 `idx_books_catalog_title` 并稳定分页。
- publication relationship：只表示方向性、待核验/用户确认关系；写入前后所有产品门禁计数不变。
- 固定“50 本/条”生产阈值已从 PRD/Roadmap 中撤销，改为可配置、可解释的 DiscoveryPlan 分层覆盖；
  与书目无关的时间、发布量和周度配置未被改写。

## 门禁

从最新 `npm ci` 开始按 Windows CI 顺序执行：

- format、lint、typecheck、constraints、DB、queue、storage、desktop、settings、local API；
- providers、portability、capabilities、model accounting、search、fetch、clipper、bibliography；
- source Electron smoke、全量测试、build、desktop/clipper package、packaged smoke、dependency audit。

结果：

- 全量：115 个测试文件、1106 项测试通过，0 failed、0 skipped、0 todo。
- Issue 018 专项：7 个测试文件、130 项测试通过。
- source 与 packaged smoke：`externalConnections: 0`，端口释放，packaged fuses 验证通过。
- `npm audit --audit-level=high`：0 vulnerabilities。
- 未读取真实密钥，未调用真实模型、搜索、网页、图片或业务 API，未产生费用。
