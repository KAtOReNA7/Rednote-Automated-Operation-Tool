# M2 收口：模型、搜索、书库与研究

状态：M2（Issue 012—021）已完成本地实现与验收。下一步是 **M3 Issue 022**；未收到明确任务时
不得开始。

## 已完成能力

| Issue | 能力                                                                  |
| ----- | --------------------------------------------------------------------- |
| 012   | 供应商无关文本、结构化、视觉、图片合同与 Scripted Mock                |
| 013   | 用户显式、有限、可审计的 Provider capability probing                  |
| 014   | 模型执行幂等、缓存、usage、整数成本/预算与保守恢复                    |
| 015   | SearchProvider、候选归一化、持久限速与 SearchRun                      |
| 016   | 单候选受控 Fetch、SSRF/DNS/robots/大小限制与净化快照                  |
| 017   | 用户点击式 Chrome/Edge 当前公开页面样本收藏                           |
| 018   | Work/Expression/Edition 书目、分层发现、保守消歧与可逆决策            |
| 019   | Versioned Source、AtomicClaim、EvidenceLocator、FactPolicy 与冲突处理 |
| 020   | Versioned Dossier、coverage/readiness、精确失效与显式重建             |
| 021   | 六态阅读真实性、R2 逐条观点、表达/评分权限、spoiler policy 与书库 UI  |

M2 建立的是本地研究基础设施。`READY_FOR_CONTENT_BRIEF` 只表示事实覆盖与冲突策略满足未来 brief
的前置条件，不表示已经生成选题、标题、正文、评分文案、图片或发布包。Reading Authenticity
permission 也只是未来调用前的 guard。

## 仍未实现

M3 及以后才会处理内容生产、质量审核、人工审批、导出、排期、发布登记和数据复盘。当前没有：

- Issue 022 的 topic/content brief 生成；
- 标题、正文、封面、标签或实际剧透警告文案生成；
- 质量编排、审批层级、排期或发布包；
- 小红书自动登录、发布、评论、私信、验证码或风控处理；
- 自动经营数据回收或策略改写。

所有真实 API/模型调用仍需后续独立授权、安全凭据流程和明确费用边界。默认开发与测试只使用合成
fixture、临时 SQLite、Scripted Mock 与本机 loopback；不读取真实密钥、不访问真实业务服务、
不产生费用。

## 未改变的永久边界

- Windows 本地优先、单用户、云服务不是必需依赖；
- `aiDisclosure=false`，AI 标识不参与门禁、评分、审批、排期或导出；
- 版权风险不进入字段、检查、门禁、评分、审批、排期或导出；
- 不使用开卷、盗版电子书、磨铁内部数据或小红书非公开 API；
- 最终平台发布必须由用户手动完成。

下一步只记录为 **M3 Issue 022**，不代表已获授权或已开始开发。
