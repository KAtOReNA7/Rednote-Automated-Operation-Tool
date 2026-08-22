# 历史 Issue 执行指令与当前 R10A 归档

这些文件是已完成工作的原始授权与审计证据，不是待办任务。除非用户明确要求修正文档事实，
不得重写其内容，也不得因为文件中提及后续 Issue 而自动开始开发。

## M1

- [Issue 006：Electron + React 桌面壳](./m1/M1-Issue006-Electron-React-desktop-shell-Codex-instruction.txt)
- [Issue 007：SQLite Schema 与迁移](./m1/M1-Issue007-SQLite-schema-migrations-Codex-instruction.md)
- [Issue 008：本地文件仓库](./m1/M1-Issue008-local-file-repository-Codex-instruction.txt)
- [Issue 009：持久化本地任务队列](./m1/M1-Issue009-persistent-local-job-queue-Codex-instruction.txt)
- [Issue 010：设置向导与本地密钥引用](./m1/M1-Issue010-settings-wizard-local-credential-reference-Codex-instruction.txt)
- [Issue 011：本地 Loopback API 与插件认证](./m1/M1-Issue011-local-loopback-API-plugin-authentication-Codex-instruction.txt)

## M2

- [Issue 012：供应商无关模型接口](./m2/M2-Issue012-provider-neutral-model-interfaces-Codex-instruction.txt)
- [Issue 013：供应商能力探测](./m2/M2-Issue013-portable-provider-capability-probing-Codex-instruction.txt)
- [Issue 014：模型运行记录、缓存与成本账本](./m2/Issue014-Codex-instruction.txt)
- [Issue 015：通用 SearchProvider](./m2/Issue015-short-Codex-instruction.txt)
- [Issue 016：定向公开页面抓取](./m2/M2-Issue016-controlled-public-page-fetch-Codex-instruction.txt)
- [Issue 017：Chrome / Edge 浏览器收藏插件](./m2/M2-Issue017-Chrome-Edge-browser-clipper-Codex-instruction.txt)
- [Issue 017：真实浏览器 smoke 恢复指令](./m2/M2-Issue017-recovery-CDP-real-browser-smoke-Codex-instruction.txt)
- [Issue 018：书目发现、实体消歧与仓库治理](./m2/M2-Issue018-bibliographic-discovery-entity-resolution-Codex-instruction.txt)
- [Issue 019：来源、原子事实与冲突处理](./m2/M2-Issue019-source-atomic-facts-conflict-handling-Codex-instruction.txt)
- [Issue 020：版本化研究档案、覆盖度与增量重建](./m2/M2-Issue020-versioned-research-dossier-Codex-instruction.txt)
- [Issue 021：阅读真实性、表达权限与 M2 收口](./m2/M2-Issue021-reading-authenticity-policy-Codex-instruction.txt)

M2（Issue 012—021）已完成。

## M3

- [Issue 022：Topic Pool、可解释排序与首批 30 篇配额](./m3/M3-Issue022-topic-pool-first-30-quota-Codex-instruction.txt)
- [Issue 023：版本化实验设计与确定性分配](./m3/M3-Issue023-versioned-experiment-management-Codex-instruction.txt)
- [Issue 024：结构化 Content Brief、字段锁定与受控生成](./m3/M3-Issue024-structured-content-brief-generator-Codex-instruction.txt)
- [Issue 025：版本化文案生成与局部重写](./m3/M3-Issue025-versioned-copy-generation-Codex-instruction.txt)
- [Issue 026：正文事实声明映射、证据回溯与事实质量检查](./m3/M3-Issue026-factual-claim-mapping-Codex-instruction.txt)

M3 Issue 022—026 与后续历史材料均为审计记录；旧 Issue 027 的表述不是当前实施状态，且不得自动
开始。R10A 与 R10B1A—R10B1C 已完成并进入 `main`；R10B 完整受控备份与恢复已通过 PR #26 合并到 `main`。R10C 提供受控本地
脱敏诊断；R10D Windows 安装/升级/卸载候选正在 PR #29 接受精确 Windows 生命周期门禁，只有 PR 与合并后 `main` CI 均通过才视为进入主线；R10E Release Candidate 尚未开始。范围见
[`../product/v2-r10-release-readiness-scope.md`](../product/v2-r10-release-readiness-scope.md)。

## V2

- [R10A：发布准备范围合同](./v2/V2-R10A-release-scope-contract-Codex-instruction.txt)
- [R10B：受控备份与恢复实施与验收映射](./v2/R10B-controlled-backup-restore-implementation.md)
- [R10C：受控本地诊断实施与验收映射](./v2/R10C-local-diagnostics-implementation.md)
- [R10D：Windows 分发、安装、升级与卸载实施/验收](./v2/R10D-windows-distribution-implementation.md)

## Governance

- [Issue 026 后只读项目健康审计](./governance/Project-health-audit-after-Issue026-Codex-instruction.txt)
- [M3 项目控制恢复 Phase 1](./governance/M3-project-control-recovery-phase1-Codex-instruction.txt)

这些文件授权的是审计或治理任务，不是产品 Issue。Phase 1 完成后仍不得自动进入 Issue 027。
