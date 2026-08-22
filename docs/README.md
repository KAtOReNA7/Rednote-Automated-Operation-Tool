# 文档中心

仓库根目录只保留贡献入口和构建工具必须从根目录发现的配置。项目文档按用途分层：

- [`product/`](./product/README.md)：产品 PRD、开发路线图与当前发布准备范围合同；
- [`governance/`](./governance/README.md)：总开发指令与仓库治理记录；
- [`instructions/`](./instructions/README.md)：已完成 Issue 的原始执行指令；
- [`adr/`](./adr/)：已接受的架构决策；
- [`contracts/`](./contracts/)：稳定、版本化的接口与数据合同；
- [`evidence/`](./evidence/)：可公开提交的脱敏机器证据。

Issue 的实施计划、验收映射和外发矩阵暂时保留既有文件名与路径，避免破坏历史审计链接。
新增文档应优先进入上述分类目录，除非它必须沿用既有验收命名约定。

M2（Issue 012—021）已完成，收口说明见 [`m2-closeout.md`](./m2-closeout.md)。M3 已完成
Issue 022 的 Topic Pool 与 First-30 配额、Issue 023 的版本化单变量实验与确定性分配、
Issue 024 的结构化 Content Brief、字段锁定与受控生成、Issue 025 的版本化文案、局部重写
与结构门，以及 Issue 026 的 Statement—Claim 映射、证据回溯和 FACT_MAPPING 工作台；本地证据见
[`evidence/m3-issue022-local-evidence.md`](./evidence/m3-issue022-local-evidence.md) 和
[`evidence/m3-issue023-local-evidence.md`](./evidence/m3-issue023-local-evidence.md)、
[`evidence/m3-issue024-local-evidence.md`](./evidence/m3-issue024-local-evidence.md)、
[`evidence/m3-issue025-local-evidence.md`](./evidence/m3-issue025-local-evidence.md) 和
[`evidence/m3-issue026-local-evidence.md`](./evidence/m3-issue026-local-evidence.md)。上述 M3/Issue 027
材料为历史审计记录，不是当前实施状态。当前活跃工作为 R10 发布准备：R10D 已通过 PR #29 与主线
Windows CI，R10E 正在准备 Draft Release Candidate 并等待 Windows 10/11 独立人工验收。范围见
[`product/v2-r10-release-readiness-scope.md`](./product/v2-r10-release-readiness-scope.md)，用户入口见
[`user-guide/windows-beta-user-guide.md`](./user-guide/windows-beta-user-guide.md) 与
[`reviews/R10E-windows-10-11-user-acceptance.md`](./reviews/R10E-windows-10-11-user-acceptance.md)。
