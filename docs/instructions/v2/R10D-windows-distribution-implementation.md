# R10D Windows 分发、安装、升级与卸载实施/验收

**任务状态：实施中。** 本文仅在取得实际代码、测试或托管 CI 证据后回填；当前不是发布声明。

## 范围与固定边界

- 每用户、离线、未签名的 Windows 内部 beta；用户主动运行安装器完成手动升级。
- 不含自动更新、后台下载、签名、tag、GitHub Release、真实用户数据、真实凭据或业务网络。
- 唯一新增直接构建期依赖为 `electron-builder@26.15.3`（MIT，npm latest，Node >=14）。

## D01—D18 验收回填

| 项目                             | 状态         | 证据                                                           |
| -------------------------------- | ------------ | -------------------------------------------------------------- |
| D01 单一版本与稳定应用身份       | PASS（本地） | `0.1.0-beta.1`、固定 appId 与 x64 manifest。                   |
| D02 NSIS 每用户离线安装          | PASS（本地） | 固定 NSIS one-click/per-user 配置。                            |
| D03 未签名内部 beta              | PASS（本地） | 无证书表、无 signing 配置且 elevation helper 关闭。            |
| D04 零自动更新/后台下载          | PASS（本地） | 显式 `--publish never`；raw `latest.yml` 不进入交付 bundle。   |
| D05 release manifest 与 checksum | PASS（本地） | canonical bundle 只含 installer、manifest、SHA256SUMS 与说明。 |
| D06 可重复 exact-head 构建       | PASS（语义） | 规范 payload 与 NSIS 脚本一致；不宣称 NSIS 外层字节稳定。      |
| D07 干净安装                     | PENDING      | 仅 GitHub-hosted Windows CI 可验证。                           |
| D08 数据根与凭据语义稳定         | PENDING      | 待隔离 smoke 证据。                                            |
| D09 手动兼容升级                 | PENDING      | 仅 GitHub-hosted Windows CI 可验证。                           |
| D10 显式备份兼容                 | PENDING      | 待实现与测试。                                                 |
| D11 降级和未知安装阻断           | PENDING      | 仅 GitHub-hosted Windows CI 可验证。                           |
| D12 运行中升级/卸载阻断          | PENDING      | 仅 GitHub-hosted Windows CI 可验证。                           |
| D13 失败回退                     | PENDING      | 仅 GitHub-hosted Windows CI 可验证。                           |
| D14 卸载默认保留数据             | PENDING      | 仅 GitHub-hosted Windows CI 可验证。                           |
| D15 保留数据后的重装             | PENDING      | 仅 GitHub-hosted Windows CI 可验证。                           |
| D16 生命周期零网络与零费用       | PENDING      | 待 CI smoke 证据。                                             |
| D17 精确 HEAD CI artifact        | PENDING      | 待 CI workflow 证据。                                          |
| D18 文档与阶段事实               | PENDING      | 待实现与治理测试。                                             |

## 实施计划

1. 统一版本、应用身份和稳定 build metadata；为预打包目录生成闭合 manifest/checksum。
2. 在既有预打包流程上配置 NSIS 每用户安装器，并加入仅 CI 可执行的生命周期 harness。
3. 收紧 R10B 恢复兼容性，覆盖旧 `0.0.0` 的显式兼容和其余 fail-closed 行为。
4. 补齐直接测试、CI artifact 与准确的安装说明，完成本地门禁后由 Windows CI 验证真实生命周期。

## NSIS 外层差异定位（本地诊断）

同一 immutable prepackaged payload 的受控样本 A/B 分别为 `97,390,055` bytes / SHA-256
`2276869565cd908256e70790ea8eb736ecdbb768ac160e254234019cc1bce99a`，以及 `97,390,051`
bytes / SHA-256 `b35030dfaad1c7805c319be948743a1a57451f1ea2ff2d1245541be07ea80740`。

两者 PE prefix、签名表和 overlay 起点相同；嵌入 7z payload、解包后的 80 个规范文件、
release manifest、`app.asar`、主 EXE，以及将临时 `0-messages.nsh` include 路径归一化后的
NSIS 脚本均相同。差异只在 NSIS 生成期临时路径影响的外层 stub/tail 元数据；未签名 NSIS EXE
的 byte-for-byte reproducibility 不作声明。每个实际交付的 canonical EXE 仍须独立记录完整
SHA-256，完整生命周期由 GitHub-hosted Windows CI 裁决。
