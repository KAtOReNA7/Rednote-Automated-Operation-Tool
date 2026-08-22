# R10E Release Candidate 实施与验收映射

**状态：实现候选；等待精确 PR HEAD CI、Draft Release 回读及 Windows 10/11 人工验收。**

## 固定身份与停止点

- 应用版本：`0.1.0-beta.1`（不修改根版本）。
- Draft Release tag：`v0.1.0-beta.1`。
- 标题：`Rednote V2 0.1.0-beta.1 Release Candidate`。
- Release 必须保持 Draft + prerelease，target 为最终 R10E PR HEAD；不创建真实 tag ref，不发布正式 Release。
- R10E PR 保持 Draft、OPEN、未合并。Windows 10/11 人工结果都保持 `NOT_RUN`。

## 实施计划

1. 复制而不修改 R10D beta.1 四文件 canonical bundle，并隔离标注 beta.0 TEST-ONLY fixture。
2. 由 CI 从最终 HEAD/tree、锁文件和明确 runner 元数据生成 provenance，建立包内外两层 SHA-256。
3. 将离线指南与双平台同构 UAT 模板纳入候选闭集，添加真实 Chrome/Edge Release smoke。
4. 精确 HEAD CI 全绿后回读 artifact，再创建并回读固定身份的 Draft prerelease Release。

## 制品与隐私合同

- 外层包只含 `candidate/`、`upgrade-fixture/TEST-ONLY-beta.0/`、用户指南、UAT、provenance 和包内 checksum。
- `candidate/` 与 R10D 四文件逐字节一致；R10E 不在构建后修改 installer、manifest、checksum 或安装说明。
- 外层 ZIP 哈希只写入独立 `.sha256`，避免自引用；包内 `SHA256SUMS.txt` 覆盖自身之外全部普通文件。
- provenance 只读取 source commit/tree、锁定工具链、runner OS/arch 和 workflow run ID/attempt；不枚举环境。
- 路径、闭集、symlink/junction、绝对路径及 CI 工作区/用户名片段均 fail closed。

## A01—A18 验收映射

最终 exact-head CI、artifact、Draft Release 与 UAT 状态写入 PR body；本文件不预填未来 PASS。

| 项目              | 当前状态                 | 实现/证据入口                                                                                        |
| ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| A01 R10D 基线     | PASS                     | PR #29；PR HEAD `f931108…`；merge `d71b7d8…`；PR/main Windows CI 及 artifact 9474092899 已动态核验。 |
| A02 四文件保真    | IMPLEMENTED              | `assembleReleaseCandidate` 先验证内层 manifest/checksum，再逐文件复制；外层验证再次校验。            |
| A03 候选闭集      | IMPLEMENTED              | `validateReleaseCandidate` 对 12 个批准文件做 exact set、排序和 link/path 拒绝。                     |
| A04 来源证明      | IMPLEMENTED / PENDING_CI | `createCiProvenance` 绑定最终 commit/tree、版本、lockfile、工具链、runner 与 workflow。              |
| A05 双层校验      | IMPLEMENTED              | 包内逐文件 checksum + 独立 ZIP checksum；tamper/漏项/增项行为测试。                                  |
| A06 路径与隐私    | IMPLEMENTED              | 文本绝对路径拒绝；候选字节扫描受控工作区、用户目录和用户名片段。                                     |
| A07 fixture 隔离  | IMPLEMENTED              | 独立 `TEST-ONLY-beta.0` 目录与四个 TEST-ONLY 文件名。                                                |
| A08 离线交付      | IMPLEMENTED              | GitHub 仅人工下载；无自动更新、后台下载或云端运行依赖。                                              |
| A09 安装指南      | IMPLEMENTED              | `docs/user-guide/windows-beta-user-guide.md` 第 1—4 节。                                             |
| A10 升级/卸载指南 | IMPLEMENTED              | 用户指南第 6—8 节；R10D L01—L10 仍是托管行为门禁。                                                   |
| A11 备份恢复指南  | IMPLEMENTED              | 用户指南第 9 节，保留同版本/明确兼容与 fail-closed 合同。                                            |
| A12 诊断指南      | IMPLEMENTED              | 用户指南第 10 节，手动预览、确认、脱敏两文件 ZIP、绝不自动上传。                                     |
| A13 合成工作流    | IMPLEMENTED              | 用户指南第 5 节；不配置真实 Provider，不操作真实平台。                                               |
| A14 回滚指南      | IMPLEMENTED              | 用户指南第 11—13 节，不承诺就地降级、未知恢复或物理删除。                                            |
| A15 双平台清单    | IMPLEMENTED / NOT_RUN    | `docs/reviews/R10E-windows-10-11-user-acceptance.md` 两套独立同构记录。                              |
| A16 Release 门禁  | IMPLEMENTED / PENDING_CI | 单一 Windows required job：现有门禁、真实 Clipper smoke、R10D 构建/fixture/L01—L10 与 RC 生成。      |
| A17 Draft Release | PENDING_CI_AND_RELEASE   | CI 绿色后创建固定 tag/title/target 的 Draft + prerelease，并回读五项原始资产。                       |
| A18 治理事实      | IMPLEMENTED              | README 与文档索引写明 R10D 已合并、R10E 待 Win10/11 人工验收。                                       |

## 人工验收边界

Windows Server CI 只验证构建、安装生命周期与制品合同，不能替代 Windows 10/11 人工体验。
任一平台失败即保持 R10E 未完成；只有用户提交两个独立 PASS，后续最终命令才能决定合并和正式发布。
