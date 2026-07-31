# M3 Issue 026 外发与敏感数据矩阵

状态：已验证
适用范围：FACT_MAPPING V1

## 结论

Issue 026 的纯本地路径不产生外部请求。可选模型辅助只能在用户查看 readiness、预览并显式确认
后，经既有 `ModelExecutionService` 发出至多一次结构化请求；本轮验收只使用 Scripted Mock，
真实密钥读取、业务网络、真实模型/API 调用和费用均为 0。

| 数据或动作                | 本地手工 |      Scripted Mock 辅助 |              renderer 可见 |                          持久化 | 约束                               |
| ------------------------- | -------: | ----------------------: | -------------------------: | ------------------------------: | ---------------------------------- |
| Draft artifact 有界文本   | 本地内存 |          作为不可信输入 |        当前 Draft 有界片段 |        仅 identity/hash/locator | 不进入 job、日志、audit 或错误 DTO |
| Claim 类型化摘要          | 本地读取 |        allowlist 内候选 |      有限 value/scope 摘要 |    仅稳定 ID/revision/hash 依赖 | 不创建或修改 Claim                 |
| Evidence excerpt          | 本地读取 |            不发送正文链 |       最多 600 code points | 映射只保存 Evidence ID/revision | 中文摘要明确不是证据               |
| SourceRevision            | 本地读取 | 只发送 content identity | 标题、站点、等级、revision |         只保存 ID/revision/hash | 不显示 URL、路径或 Source 全文     |
| 模型请求                  |        0 |                  0 或 1 | 只显示 readiness/计数/状态 |       既有 model run/accounting | 无工具、搜索、图片或 fallback      |
| 密钥/Authorization/header |        0 |                       0 |                          0 |                               0 | renderer/preload/job/日志均禁止    |
| Search/Fetch/Browser Clip |        0 |                       0 |                     无入口 |                               0 | 缺事实只进入阻塞/复核              |
| Draft/研究事实写入        |        0 |                       0 |                 无编辑入口 |                               0 | 只读消费 immutable/current 版本    |
| 图片、审批、导出、发布    |        0 |                       0 |                     无入口 |                               0 | 属于后续 Issue，未实现             |

## 失败与恢复

- pre-send 取消或可证明未发送的失败保持 0 次外部请求，可安全恢复；
- after-send timeout、连接丢失或崩溃保守标记 `AMBIGUOUS`，不自动 retry、repair、fallback
  或换模型；
- 模型候选必须通过 exact schema、artifact/locator/hash、Claim allowlist、类型化 compatibility
  和 FactPolicy 本地重验，并始终等待人工确认；
- 失败、取消或不确定执行不发布 partial current check version，也不覆盖既有 current 结果。

## 验证证据

- `tests/fact-mapping-workflow.test.ts`
- `tests/fact-mapping-contracts.test.ts`
- `tests/fact-mapping-runtime-ipc.test.ts`
- `tests/fact-mapping-governance.test.ts`
- `npm run test:fact-mapping`
