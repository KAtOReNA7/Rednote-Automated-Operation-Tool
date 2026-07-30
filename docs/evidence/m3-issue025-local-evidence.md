# M3 Issue 025 本地验收证据

状态：PASS。最终全量门禁已通过；本文件随 Issue 025 唯一本地提交固化，提交身份由 Git 与交付
报告记录，避免提交自引用。

## 基线与范围

- 动态开工基线：本地 `main`、本地 `origin/main` 与只读远端 `main` 均为
  `e23f9b9df46be5e14a8d6e06c20b63a14ba6668e`。
- 指令唯一归档于
  `docs/instructions/m3/M3-Issue025-versioned-copy-generation-Codex-instruction.txt`；移动前后
  SHA-256 均为
  `1DE1E439D27E144F03398FF33F0297AD505D18D2611DCE6C6CE2769B7A911B0A`。
- 本轮只实现版本化文案、手工 scaffold、完整生成、局部重写、结构验证、v18 migration 和文案
  工作台；Issue 026—030 保持未实现。
- 开发期未执行 pull、rebase、reset 或 push。

## 已完成的增量证据

- 五类 Copy Profile、账号文风、lineage、真实性/评分/公开标签、四类 spoiler warning、锁和
  structure validation 均由 strict domain contract 与合成金标覆盖。
- Draft identity/current head、append-only version、normalized titles/blocks/tags/comment/warnings、
  field states、dependencies、plan/run、invalidation、transition 和 audit 由 migration v18 与
  repository 覆盖。
- 手工 scaffold 在无模型配置时可用；完整生成和 rewrite 只经 ModelExecutionService/JobQueue，
  每次最多一个 Scripted Mock 请求。
- rewrite scope 外字段与全部锁定字段逐值保持；edit/lock/unlock/reorder/undo/diff 都追加版本。
- 结构有效结果只进入 `READY_FOR_QUALITY_PIPELINE`；受保护的质量、审批、图片、包和发布表保持
  零写入。
- 最终 Issue 025 专项测试：10 files、219 tests，全部 PASS。

## 合成数据计数

- 五类 profile 各 1 个完整金标 Draft，共 5 个；结构状态为
  `READY_FOR_QUALITY_PIPELINE=5`，其余 Draft 状态为 0。金标共 5 个 DraftVersion、28 个 Block、
  55 个 LineageRef、128 个 FieldState（其中 85 个 lock）与 10 个 Dependency。
- 权限金标分别覆盖 R1、R2、S1 各 1 例；评分来源覆盖 `PERSONAL_SCORE` 与
  `RESEARCH_ANALYSIS_SCORE` 各 1 例；FULL spoiler 1 例并同时具有封面、标题、正文开头与
  置顶评论四类实际警告文本。
- rewrite 金标覆盖选中标题、标题变体、标签集合、置顶评论、单个剧透警告、单正文 Block
  共 6 类，并另有连续 Block range/非法 scope/lock 负例。
- 受控执行各覆盖 Scripted Mock 成功、pre-send 未配置失败、cache-hit no-op、取消、safe
  restart pause 与 after-send ambiguous；executionId 重放不重复副作用。

## Migration 与数据保留

- 运行时下一条 migration 为 v18 `versioned_copy_generation`；v1—v17 未修改。
- 旧 Draft 保留 identity，保守迁移为 `LEGACY / STRUCTURE_INVALID`；缺少 current BriefVersion
  的 v17 兼容数据先建立 legacy BriefVersion，不假定为 ready。
- 新库和 v17 升级的 STRICT、FK、append-only、quick_check 与 foreign_key_check 已通过新增
  migration 测试及完整 DB/备份/回滚门禁。
- v18 规范化 migration checksum 为
  `270759ab882de21c02c2b14fdce08883794452ad09b82ca1e64ba24a828aad3d`；只作为本次验收结果，
  不写入跨机器开工门禁。

## 网络、密钥与费用

fixture 只使用合成数据、临时 SQLite、运行时 token、Scripted Mock 与本机 loopback。真实密钥
读取、业务网络、真实模型/搜索/图片调用、外部请求和真实费用均为 0。

## 最终门禁

最终从新的 `npm ci` 起，按当前 Windows CI 顺序及本轮风险追加项执行：

- `npm ci`：260 packages，0 vulnerabilities；
- `format-check / lint / typecheck`：PASS，0 warning；
- constraints 49、DB 35、queue 131、storage 75、desktop 92、settings 233、local API 132、
  providers 188、portability 4：全部 PASS；
- capabilities 48、model-accounting 233、search 49、fetch 55、clipper 28：全部 PASS；
- bibliography 197、evidence 225、dossier 203、authenticity 238：全部 PASS；
- topics 232、experiments 55、briefs 236、copy 219：全部 PASS；
- `npm run test`：187 files、1553 tests，全部 PASS，0 skip/todo；
- `npm run build`、`package:desktop`、`package:clipper`、`audit:dependencies`：PASS，依赖漏洞 0；
- source 与 packaged Electron smoke：fuses 有效，external connections 0，禁用/启用本地 API
  两种模式均退出且释放端口；
- Chrome 与 Edge 真实隔离侧载 smoke：PASS，只访问本机合成 fixture/loopback，隔离 profile
  已清理。

未触发 GitHub 托管 CI，因此不把托管 CI 写成 PASS。
