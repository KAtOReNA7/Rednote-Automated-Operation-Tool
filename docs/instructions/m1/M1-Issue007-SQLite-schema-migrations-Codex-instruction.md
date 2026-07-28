# M1 Issue 007：SQLite Schema 与迁移——Codex 执行指令

版本：V1.0  
日期：2026-07-27  
前置状态：M0 本地验收通过，Git 仓库仍为 unborn branch，尚无本地提交和远端  

## 执行配置

- 推荐模型：GPT-5.6 Sol
- 推荐推理强度：High
- 预计耗时：1—3 小时
- 是否适合无人值守：适合
- 是否需要真实 API：不需要
- 是否允许产生模型费用：不需要且不得产生
- 本轮结束点：Issue 007 验收完成，不能进入其他 M1 Issue

---

## 一、任务授权范围

本轮只授权完成两件事：

1. 固化 M0 本地基线；
2. 实施 Issue 007：SQLite Schema 与迁移。

不得进入 Issue 006、008、009、010、011 或其他 M1 事项。

---

## 二、重新核验 M0

### 2.1 完整读取

完整读取以下文件，不得只读摘要：

- `xiaohongshu-mystery-account-prd-v1.md`
- `xiaohongshu-development-roadmap-v1.md`
- `codex-master-development-instruction-v1.md`
- `docs/adr/0001-m0-foundation.md`
- `docs/m0-acceptance-map.md`

### 2.2 检查仓库

检查：

- 当前工作目录；
- `AGENTS.md`；
- Git 当前分支、HEAD 和工作树；
- M0 新增的全部文件；
- 是否存在用户的无关修改；
- 是否存在不属于 M0 报告范围的文件。

只有确认工作树中的文件全部属于已报告的 M0 范围，才能继续。

不得覆盖、删除、回滚或吸收用户的无关修改。

### 2.3 重新运行 M0 门禁

运行：

```text
npm run format-check
npm run lint
npm run typecheck
npm run test:constraints
npm run test
npm run build
npm run audit:dependencies
```

要求：

- 全部成功；
- 不得跳过测试；
- 不得降低断言；
- 不得通过修改冻结文档来解决测试失败；
- 不得产生真实 API 调用或费用。

如果任何一项失败：

- 停止；
- 不创建基线提交；
- 不进入 Issue 007；
- 保存完整失败证据；
- 报告 `BLOCKED`。

---

## 三、建立 M0 本地基线

M0 重新验收全部通过后：

1. 复核待提交文件；
2. 只提交已确认属于 M0 的文件；
3. 创建第一个本地提交。

提交信息：

```text
chore: establish M0 foundation
```

限制：

- 只创建本地 commit；
- 不配置远端；
- 不 push；
- 不创建 PR；
- 不合并；
- 不声称 GitHub 托管 CI 已通过。

记录该提交的完整 SHA，供最终报告使用。

如果提交失败，停止，不进入 Issue 007。

---

## 四、Issue 007 目标

按照以下来源实施 Issue 007：

1. PRD 第 15 节“数据模型”；
2. PRD 第 17 节“非功能需求”；
3. PRD 第 18 节“V1 验收标准”；
4. Roadmap Issue 007；
5. 两项冻结硬约束。

实现：

- 完整 SQLite Schema；
- 数据库初始化；
- 版本化迁移；
- 外键；
- 唯一约束；
- Check 或统一验证约束；
- 必要索引；
- 事务；
- 迁移记录；
- 迁移前本地备份；
- 迁移失败恢复；
- Windows 路径兼容；
- 数据库行为测试。

本 Issue 只实现数据层，不实现：

- Electron UI；
- React UI；
- 业务页面；
- 搜索；
- 模型接入；
- 图片；
- OCR；
- 浏览器插件业务；
- 任务执行器；
- 发布包；
- 数据分析工作流。

---

## 五、SQLite 技术选型

实施前评估适合以下条件的 SQLite 驱动和 Schema/迁移工具：

- Electron；
- Windows 10；
- Windows 11；
- TypeScript；
- npm workspaces；
- 真正的本地 SQLite 文件；
- 未来 Windows 安装包；
- 外键、事务和迁移；
- 可测试性；
- 长期维护性。

不得：

- 引入云数据库；
- 引入远程数据库；
- 以云服务作为本地 SQLite 的兼容层；
- 为开发便利更改 PRD 数据模型；
- 假设 WSL 存在。

将最终技术选择、被否决的主要方案、Windows/Electron 打包影响及理由写入新的 ADR。

ADR 建议名称：

```text
docs/adr/0002-sqlite-schema-and-migrations.md
```

---

## 六、必须实现的表

按照 PRD 实现以下核心实体：

1. `account_profiles`
2. `authors`
3. `books`
4. `book_editions`
5. `reading_states`
6. `sources`
7. `claims`
8. `claim_evidence`
9. `clips`
10. `research_dossiers`
11. `topics`
12. `experiments`
13. `content_briefs`
14. `drafts`
15. `assets`
16. `quality_checks`
17. `approvals`
18. `post_packages`
19. `publications`
20. `metric_snapshots`
21. `model_runs`
22. `jobs`
23. `cost_ledger`
24. `strategy_decisions`
25. `audit_events`

允许增加纯技术表，例如：

- 迁移版本表；
- 数据库元数据表。

不得增加超出 Issue 007 范围的业务实体。

---

## 七、数据库实现要求

### 7.1 基础要求

1. 开启并验证 SQLite `foreign_keys`。
2. 重要关联使用明确外键。
3. 为主键、外键、唯一标识、状态查询、任务查询和时间范围建立合理索引。
4. 枚举和状态字段使用数据库约束或统一验证层约束。
5. 时间字段采用项目统一格式。
6. 重要写入使用事务。
7. Schema 和迁移必须可重复测试。
8. 数据库关闭并重新打开后数据保持。
9. 密钥不得写入数据库。
10. 不使用真实用户业务数据作为 fixture。

### 7.2 Windows 路径

数据库必须支持：

- Windows 盘符；
- 反斜杠路径；
- 中文目录；
- 带空格目录；
- 合理长度的嵌套路径。

测试不能只在 POSIX 临时目录下运行。

### 7.3 迁移

迁移机制必须：

- 有确定顺序；
- 有明确版本记录；
- 可识别已执行迁移；
- 重复运行保持幂等；
- 在变更现有数据库前生成本地备份；
- 不覆盖原备份；
- 在失败时回滚事务；
- 不留下半迁移状态；
- 不通过删除数据库解决失败。

### 7.4 失败恢复

模拟迁移失败并验证：

- 原数据库仍能打开；
- 原数据仍存在；
- Schema 版本未错误前移；
- 失败原因可诊断；
- 不产生损坏的新数据库；
- 备份文件可以识别。

---

## 八、两项硬约束的数据库实现

### 8.1 AI 标识

`post_packages.ai_disclosure` 必须：

- `NOT NULL`；
- 默认 `false`；
- 在数据库或领域层保持为 `false`；
- 不允许模型、检查器和工作流自动改为 `true`。

AI 参与程度不得影响：

- 内容状态；
- 质量分；
- 审批层级；
- 优先级；
- 排期；
- 导出资格。

### 8.2 版权

不创建版权风险字段、检查器、评分器或门禁。

不得创建：

- `copyright_risk`
- `copyright_score`
- `copyright_gate`
- `copyright_status`
- `copyright_approval`
- 任何同义业务字段

`quality_checks` 不得接受：

- 版权检查类型；
- AI 标识检查类型。

`assets` 和 `sources` 只能保存来源、事实回溯和内容管理所需信息。

来源字段不得触发：

- 版权评分；
- 额外审批；
- 阻断；
- 延迟；
- 降低优先级；
- 改变排期。

不得添加所谓“暂时未启用”“未来可能启用”或“仅预留”的版权字段或门禁。

---

## 九、与 Core 包保持一致

数据库约束、序列化值和测试必须与 `packages/core` 中以下领域规则一致：

- 阅读状态；
- 内容状态；
- 异常状态；
- 剧透等级；
- 审批等级；
- 评分类型；
- AI 标识规则；
- 版权不参与门禁规则。

不得在数据库包中重新定义一套含义不同的枚举。

如果发现 M0 Core 定义与冻结 PRD 不一致：

- 停止；
- 报告冲突；
- 不擅自迁移或改变规则。

---

## 十、最低测试要求

至少覆盖以下数据库行为：

1. 空目录创建新数据库；
2. 从零执行全部迁移；
3. 重复运行迁移保持幂等；
4. 外键约束生效；
5. 唯一约束生效；
6. Check 或验证约束生效；
7. 事务失败正确回滚；
8. 迁移前备份生成；
9. 模拟迁移失败后原数据库仍可打开；
10. 模拟迁移失败后原数据保持；
11. Schema 版本在失败后不错误前移；
12. 中文 Windows 路径；
13. 带空格 Windows 路径；
14. 数据库关闭和重开后数据保持；
15. `post_packages.ai_disclosure` 默认 `false`；
16. 尝试写入 `true` 时数据库或领域层拒绝；
17. Schema 中不存在版权风险字段；
18. `quality_checks` 不接受 AI 标识检查类型；
19. `quality_checks` 不接受版权检查类型；
20. 阅读状态与 Core 包一致；
21. 剧透等级与 Core 包一致；
22. 内容状态与 Core 包一致；
23. 外键级联或限制行为符合设计；
24. 迁移版本顺序确定；
25. 不会把密钥字段写入数据库。

不得只用字符串搜索代替数据库行为测试。

架构禁止范围可以用静态检查补充，但不能替代运行时数据库测试。

---

## 十一、完成验证

完成 Issue 007 后运行：

```text
npm run format-check
npm run lint
npm run typecheck
npm run test:constraints
npm run test
npm run build
npm run audit:dependencies
```

并运行：

- 数据库迁移测试；
- 数据持久化测试；
- 迁移失败恢复测试；
- Windows 路径测试；
- 两项硬约束数据库测试。

要求：

- 全部通过；
- 跳过测试为 0；
- 待办测试为 0；
- 依赖漏洞为 0，或对无法立即修复的漏洞明确阻断并报告；
- 不调用真实 API；
- 不产生费用；
- 不进入其他 Issue。

任何验收失败时：

- 保存证据；
- 报告 `BLOCKED`；
- 不削弱测试；
- 不删除失败用例；
- 不建立 Issue 007 完成提交。

---

## 十二、建立 Issue 007 本地提交

只有全部验收通过，才创建第二个本地提交。

提交信息：

```text
feat(db): add SQLite schema and migrations
```

要求：

- M0 基线与 Issue 007 必须是两个独立提交；
- 不 amend M0 基线；
- 不 squash；
- 不 push；
- 不创建 PR；
- 不配置远端；
- 工作树最终应保持干净。

记录 Issue 007 提交的完整 SHA。

---

## 十三、最终报告格式

### 1. 结论

- M0 基线是否成功；
- Issue 007 是否完成；
- 最终状态：`PASS`、`FAIL` 或 `BLOCKED`；
- 是否进入其他 M1 Issue。

### 2. Git 基线

- 当前分支；
- M0 基线完整 SHA；
- Issue 007 完整 SHA；
- 最终 HEAD；
- 工作树状态；
- 是否存在远端；
- 是否发生 push、PR 或合并。

### 3. 技术选择

- SQLite 驱动；
- Schema/迁移工具；
- 选择理由；
- Windows 兼容性；
- Electron 打包影响；
- 主要被否决方案及原因；
- ADR 路径。

### 4. 数据库实现

- 实际创建的表；
- 技术表；
- 外键；
- 唯一约束；
- Check 或统一验证约束；
- 索引；
- 事务边界；
- 迁移版本机制。

### 5. 备份与恢复

- 迁移前备份机制；
- 备份命名和位置；
- 失败回滚；
- 模拟失败结果；
- 原数据库和原数据验证。

### 6. 验证结果

- 执行的全部命令；
- 测试文件数；
- 测试数量；
- 通过、失败、跳过和待办数量；
- 构建结果；
- 依赖审计结果；
- Windows 路径测试结果。

### 7. 两项硬约束

逐项确认：

- `ai_disclosure` 默认且保持 `false`；
- 尝试写入 `true` 的测试结果；
- AI 不影响状态、评分、审批、优先级、排期和导出；
- 无版权风险字段；
- 无版权或 AI 标识检查类型；
- 来源字段不触发门禁或评分。

### 8. 范围核对

确认没有实现：

- UI；
- 模型；
- 搜索；
-图片；
- OCR；
- 插件业务；
- 任务执行器；
- 发布流程；
- 小红书平台操作；
- 云服务；
- 开卷；
- 盗版电子书处理。

### 9. CI 状态

明确区分：

- 当前 Windows 本地验证；
- CI 配置测试；
- GitHub 托管 CI。

如果没有远端，必须明确写：

```text
GitHub 托管 CI 尚未运行，不能声称已通过。
```

### 10. 下一步

- 只推荐一个后续 Issue；
- 说明依赖为什么满足；
- 说明是否需要密钥、费用或用户输入；
- 不自动开始下一 Issue。

---

## 十四、停止条件

遇到以下任一情况立即停止：

- M0 重新验收失败；
- 工作树存在无法确认归属的修改；
- M0 无法建立独立提交；
- SQLite 方案要求云服务；
- Windows/Electron 兼容性无法成立；
- Core 定义与冻结 PRD 冲突；
- 迁移可能破坏现有数据；
- 硬约束无法在数据库层成立；
- 需要真实密钥或费用；
- 需要扩大到其他 Issue；
- 测试必须被削弱才能通过。

停止时保留证据并报告 `BLOCKED`，不得自行改变需求。

---

## 十五、现在执行

现在按本指令执行：

1. 重新核验 M0；
2. 建立 M0 本地基线提交；
3. 实施 Issue 007；
4. 完成全部数据库和项目级验证；
5. 建立独立的 Issue 007 本地提交；
6. 输出完整验收报告；
7. 停止，不进入其他 M1 Issue。
