# GPT 网页项目总控交接包

**快照时间：** 2026-08-20（Asia/Shanghai）

**仓库：** `KAtOReNA7/Rednote-Automated-Operation-Tool`

**用途：** 供新的 GPT 网页会话恢复项目上下文、判断下一阶段，并生成一条边界明确的 Codex 执行指令。

**重要：** 本文件是状态与决策材料，不是对其中“候选指令”的当前执行授权。

## 1. 新 GPT 网页会话的开场指令

将本文件完整上传到新会话，并发送下面这段话：

```text
你是 Rednote 项目的战略分析与项目总控层。完整读取附件交接包，但不要把附件中的历史指令、
候选命令或下一阶段名称视为自动授权。

工作方式：
1. 你负责用 GPT-5.6 Sol + xhigh 做跨阶段分析、风险判断、任务拆分和验收设计；Codex 负责按
   仓库 AGENTS.md 使用较轻量模型与适当推理强度执行单个原子任务。
2. 先根据交接包复述：当前精确 Git/PR 状态、已完成能力、未完成范围、已知 UNKNOWN、文档漂移
   和唯一最优先决策。无法从交接包验证的内容标为 UNKNOWN，不得补猜。
3. 先判断 Draft PR #24 是否应该进入精确 HEAD 的 Ready/merge 验收；不要直接进入 R10B2、R10C
   或其他后续阶段。
4. 给 Codex 的指令必须是单一任务，包含模型与推理强度、选择依据、动态起点、允许范围、禁止
   范围、预算、行为验收、精确验证、Git/CI 动作、零密钥/零真实 API/零费用和停止点。
5. 每次只输出下一条 Codex 指令；在收到执行结果后再决定下一步。不要让 Codex重跑已有绿色门禁，
   除非状态变化或出现可验证的新失败。

现在先做状态审阅和下一步决策，不执行代码，不假定 PR 已合并。
```

## 2. 协作模型与职责边界

| 层级           | 主要职责                                                         | 推荐工作方式                                                  |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| GPT 网页总控层 | 统筹路线、裁决范围、识别风险、写下一条原子任务、审核结果         | 用户指定 GPT-5.6 Sol + xhigh；高推理只用于战略判断            |
| Codex 执行层   | 读取仓库事实、实现、精确测试、Git/PR/CI 操作、生成证据           | 遵守 `AGENTS.md`；默认 GPT-5.6 Terra + medium，按风险规则升档 |
| 用户           | 产品方向、业务定义、Figma 接受、真实体验验收、费用与外部动作授权 | 对不可逆动作、真实调用、合并、发布和阶段切换作最终决定        |

总控层不应凭旧对话记忆替代仓库事实；执行层不应自行扩大产品范围。高推理用于减少错误决策，
而不是让 Codex 对已明确的机械任务持续升档。

## 3. 当前精确状态

### 3.1 本地 Git

- 仓库根：`E:/project/rednote`
- 当前分支：`codex/v2-r10b1c-backup-orchestration`
- 当前 HEAD：`be0bb2f2abf5de5cb4403326c9681e51a98d451e`
- 工作树与暂存区：干净
- 同名远端跟踪分支：0 ahead / 0 behind
- 当前分支相对 `origin/main`：领先 2 个提交，未落后
- 本地 `main`：停在 `72a0211`，比 `origin/main` 落后 7 个提交；它不是当前远端事实来源
- `origin/main`：`5f9a924ef72b2d6152034b471903a6c74a059820`
- 仅存在根级 `AGENTS.md`，没有更深作用域的 `AGENTS.md`

不要为了“整理状态”自行 pull、rebase、reset、切分支或改写历史。任何后续 Git 动作都应由新任务
明确授权。

### 3.2 远端主线与 PR

| 项目                     | 状态                     | 精确事实                                                                         |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| PR #22 / R10B1A          | MERGED                   | source identity、manifest 与路径合同已进入 `main`                                |
| PR #23 / R10B1B          | MERGED                   | SQLite snapshot 与 managed inventory 已进入 `main`；merge 后 `main` 为 `5f9a924` |
| PR #24 / R10B1C          | OPEN / Draft / MERGEABLE | head `be0bb2f...`，base `main`，无 review、无未决 review thread                  |
| PR #21 / 早期 R10B1 总包 | OPEN / Draft             | head `0e87fa8...`；此前任务明确要求保持原状，不能顺手关闭或合并                  |
| PR #13—#15               | OPEN / Draft             | R07 历史开发 PR；不是当前工作入口，处置需要单独授权                              |

PR #24 地址：<https://github.com/KAtOReNA7/Rednote-Automated-Operation-Tool/pull/24>

### 3.3 PR #24 精确 CI

两条 required Windows CI 都绑定同一个精确 HEAD `be0bb2f...`，状态为 completed / success：

- Push CI：<https://github.com/KAtOReNA7/Rednote-Automated-Operation-Tool/actions/runs/32354779040>
- PR CI：<https://github.com/KAtOReNA7/Rednote-Automated-Operation-Tool/actions/runs/32354783507>

不得把本地绿色推断为 CI 绿色；上面两条是已经从 GitHub 动态读取的托管结果。

## 4. 项目定位与不可突破的产品边界

Rednote V2 是 Windows 10/11 本地优先、单用户、面向推理小说小红书内容运营的桌面工作台。
Electron main/preload 承担可信边界，React renderer 不直接接触 Node、SQLite、文件系统或凭据。
SQLite 与受控本地文件是运行基础，云端服务不是必需依赖。

长期不变量：

- 最终发布、评论和私信由用户在官方平台手动完成；不做自动登录、验证码、风控绕过或非公开 API。
- `aiDisclosure=false` 固定，AI 标识不参与门禁、评分、审批、排期、成本或导出决策。
- 版权风险不进入产品字段和自动决策。
- 真实密钥只由 main-process 的安全凭据边界处理，不进入 Git、SQLite、日志、诊断、fixture 或 IPC。
- 默认测试只用合成 fixture、临时 SQLite、Scripted Mock 和本机 loopback；真实模型/API 与费用为 0。
- 新 UI、布局或交互模型必须先有 Figma 设计、成熟产品参照和用户明确接受；纯技术修复可不新增设计。
- migration 只能连续追加，已发布 migration 不改写；失败必须回滚并保护用户数据。

## 5. 已完成能力地图

### 5.1 原始 M0—M3 基础

- **M0：** 仓库、架构、合规与不可变约束建立。
- **M1 Issue 006—011：** Electron/React 桌面壳、SQLite migration、本地文件仓库、持久任务队列、
  设置与凭据引用、本机 loopback API。
- **M2 Issue 012—021：** provider-neutral 模型合同、能力探测、模型记账与缓存、Search/Fetch、
  浏览器收藏、书目发现与实体消歧、原子事实与冲突、版本化研究档案、阅读真实性政策；M2 已收口。
- **M3 Issue 022—028：** Topic Pool 与首批 30 篇配额、实验管理、Content Brief、版本化文案、
  事实映射、阅读真实性评分、剧透检查。
- **M3 Issue 029A：** 确定性 Copy Integrity 子集已完成；029B 语义/人工工作流仍 deferred。
- **Minimal Issue 030：** 只读质量聚合器已完成；这不代表完整 Issue 029 或正式审批流程完成。

原路线图曾写“下一步为零模型受控本地内容试运行”，但之后用户已明确启动并推进独立的 V2 R01—R10
产品路线。当前执行优先级以用户后续明确指令、R10 范围合同和 `AGENTS.md` 为准；不得因旧路线图
自动回到 029B、M4 或内容试运行。

### 5.2 V2 用户产品路线

| 阶段   | 已交付结果                                                | 远端状态                               |
| ------ | --------------------------------------------------------- | -------------------------------------- |
| R01    | Electron V2 原型切片                                      | 已合并                                 |
| R02    | 人设与周计划持久化                                        | 已合并                                 |
| R03    | 人设驱动的周计划                                          | 已合并                                 |
| R04    | 本地内容包、批量批准与导出                                | 已合并                                 |
| R05    | 评论/私信本地导入与回复建议                               | 已合并                                 |
| R06    | 本地指标复盘与确定性建议                                  | 已合并                                 |
| R07    | 受控 Provider、显式协议协商、能力探测与预览/确认          | 已验收并合并                           |
| R08    | N1—N7 工作流与视觉收口、默认 V2 入口、Provider 降级可靠性 | 已验收并合并                           |
| R09    | 既有 Catalog 的只读书库及周计划验收修复                   | 已验收并合并                           |
| R10A   | 冻结发布准备范围                                          | 已合并                                 |
| R10B1A | 备份 manifest、source identity 与路径合同                 | 已合并                                 |
| R10B1B | SQLite snapshot 与受管文件 inventory                      | 已合并                                 |
| R10B1C | 受控备份编排与只读验证                                    | Draft PR #24，CI 绿色，待用户审阅/合并 |

## 6. 当前 R10 范围与完成度

R10 是发布准备，不是新增内容运营能力。批准顺序固定为：

1. **R10A：** 文档与范围合同——已完成。
2. **R10B：** 受控备份与恢复——进行中；备份核心推进到 B1C，完整恢复尚未完成。
3. **R10C：** 本地预览、手动导出的脱敏诊断包——未开始。
4. **R10D：** Windows 每用户离线安装、手动升级与卸载——未开始。
5. **R10E：** Windows 10/11 Release Candidate、用户指南和 Draft GitHub Release——未开始。

首版明确不做自动更新；内部 beta 可未签名，公开分发前的签名需另行决策。R10B/R10C 的新 UX
必须先完成 Figma 设计与用户接受。当前目录式体验包不是正式安装器或正式 Release。

## 7. PR #24 实现与证据

### 7.1 提交和文件

PR #24 包含两个提交：

1. `37a30c9` — `feat(v2): add controlled backup orchestration`
2. `be0bb2f` — `fix(v2): harden controlled backup orchestration`

变更文件：

- `packages/storage/src/backup-contracts.ts`
- `packages/storage/src/backup-snapshot.ts`
- `packages/storage/src/index.ts`
- `tests/r10b1b-sqlite-inventory.test.ts`
- `tests/r10b1c-backup-orchestration.test.ts`

GitHub 原始统计为 1426 additions / 3 deletions / 5 files。按文件分类：生产文件原始新增 1002 行、
删除 1 行；测试文件原始新增 424 行、删除 2 行，测试净新增 422 行。PR 正文所写“测试 additions
422”实际采用净变化口径；后续预算审阅应明确口径，不要混用 GitHub additions 与净 LOC。

### 7.2 已实现行为

- 异步、有界的复制、hash 与目录遍历，允许事件循环观察取消。
- 对 SQLite snapshot、managed inventory、manifest 和 payload 的只读验证。
- 创建身份 ledger 与 fail-closed 清理，避免清理掉非本操作创建的目标。
- 有界 verifier 读取和遍历，拒绝不受控大小与数量。
- 如实返回 durability 结果，不把无法证明的磁盘持久化伪装为成功。
- 用户选择 backup root，应用生成并校验 UUID/备份目录名；结果不暴露绝对路径。
- R10B1B active-lease fixture 被缩小，不靠提高 timeout 掩盖耗时。

### 7.3 已执行验证记录

上一轮 Codex 收口记录：

- R10B1C 与 DB/Storage 相邻集合：12 files / 195 tests passed。
- Capacity 集合：13 files / 92 tests passed。
- Normal 全量：218 files / 1858 tests passed。
- Prettier、ESLint 0 warning、TypeScript、build、`git diff --check` 均通过。
- 首次全量的唯一异常来自 Git 子进程缺少仓库 `safe.directory`；用进程内临时 Git 配置修复环境后
  通过，没有改全局 Git，也没有修改产品去迎合环境。
- 两条精确 HEAD Windows CI 均成功，见第 3.3 节。

### 7.4 明确保留的 UNKNOWN

- 没有签名的 whole-backup authenticity root。
- 平台 file-ID 精度和极小时窗的 unlink/TOCTOU 无法完全证明。
- 物理断电级持久性未被自动化测试证明。

这些 UNKNOWN 已在 PR 正文披露，不能在下一条指令中改写成 PASS，也不应在没有新需求时扩张成
新的签名、平台专用或电源故障系统。

## 8. 已发现的事实漂移与治理债务

1. 根 README 仍写“R10 功能尚未开始”和“完整备份与恢复尚未实施”。前一句已被 R10B1A—B1C
   的实际进度推翻；后一句只能理解为“完整端到端恢复尚未完成”。
2. `docs/instructions/README.md` 仍把 R10A 描述为当前活跃工作，并称 R10 功能未开始。
3. 本地 `main` 落后远端 7 个提交，但当前开发分支及其远端完全同步；不要把本地 `main` 的旧文档
   当作远端状态。
4. PR #21、#13—#15 仍为 Draft。它们可能是保留的历史开发现场，但当前没有关闭或归档授权。

建议在 PR #24 决策后安排一个独立、docs-only 的事实同步任务；不要把文档修正塞进精确 HEAD 已绿色
的 PR #24，也不要顺手处理历史 Draft PR。

## 9. 新总控会话需要裁决的事项

按优先级排序：

### P0：PR #24 是否接受并合并

当前证据支持进入一次只读 pre-merge 复核：PR 为 Draft、mergeable、精确 HEAD CI 双绿、无 review。
若复核未发现状态漂移，可生成“转 Ready + 普通 merge commit + exact head guard”的单一 Codex 指令。
若认为第 7.4 节 UNKNOWN 或 LOC 口径构成阻塞，应明确指出哪个批准合同被违反；不能笼统要求重做。

### P1：活跃文档事实同步

PR #24 合并后，以远端 `main` 为基线单独修正 README 和 instruction index，准确表达“备份核心已进入
main，但恢复、诊断、安装与 RC 尚未完成”。该任务不应修改产品代码。

### P2：R10B 后续拆分

只有 PR #24 完成用户决策后，才讨论 R10B2/恢复预检、兼容性、保护既有数据与失败回滚。任何新
恢复 UI 必须先完成 Figma 与用户接受；没有设计定位时不得直接编码。

### P3：历史 Draft PR 治理

PR #21、#13—#15 的关闭、保留或标记 superseded 是独立仓库治理决定。除非用户明确授权，不得在
产品任务中顺手关闭、评论、合并或删分支。

## 10. 用户历次 Codex 指令的共性结构

历史指令虽然分为 Issue、hotfix、resume、CI closeout、体验包和 merge gate，但稳定结构如下：

1. **模型治理头：** 模型、推理强度、选择依据、唯一升级条件。
2. **单一任务与目标状态：** 明确用户可观察结果和完成后的状态名。
3. **精确起点：** 仓库根、当前分支、HEAD、base、PR、ahead/behind、工作树；不一致即停止。
4. **权威材料：** 完整读取根级/作用域 `AGENTS.md` 与任务附件；Issue 指令按要求唯一归档。
5. **允许范围：** 可改文件、可新增合同、是否允许 migration/IPC/UI/依赖。
6. **禁止范围：** 不进入下一 Issue，不修改用户文件，不触碰真实数据/凭据/业务网络，不产生费用。
7. **硬预算：** 生产/测试 LOC、文件数、表、trigger、IPC、提交数；注明相对哪个 base 和统计口径。
8. **行为合同：** 按领域逐项写成功、失败、边界、安全、取消、恢复和精确失效语义。
9. **验收地图：** 10—20 项代表性行为证据，组合使用表驱动测试，不以源码字符串代替行为。
10. **验证序列：** 聚焦测试→相邻测试→适用全量/容量→format/lint/typecheck/build/diff；禁止盲跑。
11. **外部副作用证明：** 真实密钥、用户数据、模型、业务 API、平台动作和费用保持为 0。
12. **Git/PR/CI：** 单一提交、普通 push、Draft/Ready/merge 方法、exact head guard、精确 CI 链接。
13. **最终报告：** 根因、修改、预算、测试、Git、CI、UNKNOWN、零副作用。
14. **停止点：** 完成后立即停止，不自动合并、不删分支、不进入下一阶段，除非本任务明确授权。

增量 resume/unblock 指令还有四个特征：保留当前未提交现场、不重新开始审计/开发、先定位唯一失败
谓词、只有新证据或对应修改后才能重跑；修复范围通常进一步收窄。

## 11. 可复用的 Codex 原子任务模板

```text
模型：gpt-5.6-terra
推理强度：medium
选择依据：<一句话说明本任务风险与不确定性；局部明确任务保持 medium>。
升级条件：<无；或唯一、可验证的触发条件>。

任务：<唯一任务名>
目标状态：<完成后唯一状态>

一、动态起点
- 自动识别仓库根，完整读取根级及作用域内 AGENTS.md。
- 只读核对当前分支、HEAD、工作树、tracking、base、远端 PR 与精确 CI。
- 预期：<branch / HEAD / PR / base>。
- 若出现未知 tracked/staged 修改、HEAD 漂移或 PR 状态不符，停止报告；不得 stash、reset、rebase、
  覆盖或自行切换分支。

二、允许范围
- 用户结果：<可观察结果>。
- 允许修改：<精确文件/包/合同>。
- 允许的 Git/GitHub 动作：<无 / commit / push / Ready / merge / package>。

三、明确禁止
- 不实现：<下一阶段、邻近功能、自动化平台动作>。
- 不新增：<依赖、Schema、migration、IPC、route、worker 等>。
- 不读取真实密钥或真实用户数据，不调用真实模型/业务 API，不产生费用。

四、硬预算
- 相对基线：<base SHA 或 merge base>。
- 生产 LOC ≤ <N>；测试 LOC ≤ <N>；文件 ≤ <N>；其他预算 <N>。
- 统一使用 <GitHub raw additions / net LOC> 口径；预计超限时修改前停止。

五、行为与验收
- <A01 正常行为与证据>
- <A02 失败与清理>
- <A03 边界与资源上限>
- <A04 安全与数据保护>
- <A05 并发/取消/恢复（若适用）>
- 无法稳定证明的场景标为 UNKNOWN，不得 skip 后宣称 PASS。

六、验证
- 只运行受影响的聚焦与相邻测试；按 AGENTS.md 判定是否需要全量、容量、build 或 smoke。
- 每次失败必须先分类并获得新定位或对应修改，禁止无修改重复测试。
- 运行适用的 format、lint 0 warning、typecheck、build、git diff --check。

七、Git、PR 与 CI
- 创建 <数量> 个提交：<message>。
- <是否普通 push、是否保持 Draft、是否 exact head guard merge>。
- 只报告实际触发并读取的精确 HEAD CI；禁止 force push、amend、squash 或删分支。

八、最终报告与停止
- 报告起点/最终 HEAD、文件与预算、行为证据、验证、CI、工作树和零副作用。
- 明列 UNKNOWN 与未进入范围。
- 达到 <目标状态> 后立即停止，不进入 <下一阶段>。
```

## 12. 候选的第一条 Codex 指令方向

这不是当前授权，只是新总控会话完成审阅后可选择生成的方向：

- 只读确认 PR #24 仍为 OPEN / Draft / mergeable，head 仍为 `be0bb2f...`，base 仍为 `main`。
- 确认两条 Windows required CI 仍绑定该精确 HEAD 且 success，无新增 review 或未解决线程。
- 若全部一致，将 PR 转为 Ready，再次核验状态，使用普通 merge commit 和 exact head guard 合并。
- 不修改任何文件，不重跑本地测试，不 force/squash/rebase，不删分支，不触碰 PR #21 或历史 Draft。
- 合并后证明 merge commit 双亲、远端 `main` 包含精确 head、本地工作树未变，然后停止。
- 若任一状态漂移，停止并报告，不自行修复或进入 R10B2。

若新总控认为仍需代码审查，应先下发“只读 pre-merge review”而不是泛化重测或重新实现。

## 13. 本交接包的证据边界

- 本轮只读取本地 Git/代码文档和 GitHub 元数据，生成本文件。
- 本轮没有修改产品代码、README、Schema、migration、依赖或测试。
- 本轮没有 commit、push、Ready、merge、分支切换或删除。
- 本轮没有读取真实项目凭据、真实用户数据或 Provider 配置，没有调用模型/业务 API，没有费用。
- PR/CI 状态是 2026-08-20 的动态快照；新会话在下发任何写操作前必须重新只读核对。
