# R10D Windows 分发、安装、升级与卸载实施/验收

**任务状态：已合并并通过主线验证。** PR #29 的最终 HEAD 为 `f9311084de603e0f3f4626b6bf55d0ea88962358`，普通 merge commit 为 `d71b7d8b1063823d04043a5e9991c9ac696e40ce`；精确 PR HEAD 与合并后 `main` 的 Windows required CI 均已成功。R10D 已收口，但这不是正式发布声明；R10E 只建立 Draft Release Candidate 并等待 Windows 10/11 人工验收。

## 范围与固定边界

- 每用户、离线、未签名的 Windows 内部 beta；用户主动运行安装器完成手动升级。
- 不含自动更新、后台下载、签名、tag、GitHub Release、真实用户数据、真实凭据或业务网络。
- 唯一新增直接构建期依赖为 `electron-builder@26.15.3`（MIT，npm latest，Node >=14）。

## D01—D18 验收回填

| 项目                             | 状态         | 证据                                                             |
| -------------------------------- | ------------ | ---------------------------------------------------------------- |
| D01 单一版本与稳定应用身份       | PASS（本地） | `0.1.0-beta.1`、固定 appId 与 x64 manifest。                     |
| D02 NSIS 每用户离线安装          | PASS（本地） | 固定 NSIS one-click/per-user 配置。                              |
| D03 未签名内部 beta              | PASS（本地） | 无证书表、无 signing 配置且 elevation helper 关闭。              |
| D04 零自动更新/后台下载          | PASS（本地） | 显式 `--publish never`；raw `latest.yml` 不进入交付 bundle。     |
| D05 release manifest 与 checksum | PASS（本地） | canonical bundle 只含 installer、manifest、SHA256SUMS 与说明。   |
| D06 可重复 exact-head 构建       | PASS（语义） | 规范 payload 与 NSIS 脚本一致；不宣称 NSIS 外层字节稳定。        |
| D07 干净安装                     | PASS（CI）   | PR/main 的隔离 Windows L02 安装成功。                            |
| D08 数据根与凭据语义稳定         | PASS（CI）   | L03、L06、L09 使用隔离合成数据根并验证保留。                     |
| D09 手动兼容升级                 | PASS（CI）   | L06 beta.0→beta.1 手动升级成功。                                 |
| D10 显式备份兼容                 | PASS（既有） | R10B 受控备份与恢复已通过 PR #26 进入 `main`。                   |
| D11 降级和未知安装阻断           | PASS（CI）   | L07 降级阻断且 beta.1 payload 保持。                             |
| D12 运行中升级/卸载阻断          | PASS（CI）   | L04 两条运行中阻断均得到确定性非零退出。                         |
| D13 失败回退                     | PASS（CI）   | L05 损坏安装器安全失败并保留 beta.0 与数据。                     |
| D14 卸载默认保留数据             | PASS（CI）   | L08 卸载后合成数据、备份和诊断标记保留。                         |
| D15 保留数据后的重装             | PASS（CI）   | L09 重装并读取保留数据。                                         |
| D16 生命周期零网络与零费用       | PASS（CI）   | L01—L10 报告外部连接为 0，无真实模型或费用。                     |
| D17 精确 HEAD CI artifact        | PASS（CI）   | run 32565194439 artifact 9474092899，未过期。                    |
| D18 文档与阶段事实               | PASS         | PR #29 已普通合并，main run 32566317756 / job 97015340441 成功。 |

L01—L10 已由精确 PR HEAD 与合并后 `main` 的 Windows required CI 验证；D13 仍只声明损坏安装器的失败回退，不扩大为任意事故回滚保证。

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
