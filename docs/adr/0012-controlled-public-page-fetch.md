# ADR 0012：受控公开页面抓取

- 状态：已接受
- 适用范围：M2 Issue 016

## 决策

新增 Electron 无关的 `packages/fetch`。抓取输入只能绑定一个已持久化的
`SearchCandidate`，不得接收裸 URL。计划同时冻结候选 ID、规范 URL 哈希、profile
revision、策略版本和上限；任何漂移都在发送前失败。

产品传输使用 Node `http`/`https`、系统 DNS 与逐请求地址固定。DNS 全集、连接后的 remote
address、每个重定向目标和 TLS 主机名都必须通过 fail-closed 校验。请求固定为 GET，不读取
代理环境变量，不发送认证、Cookie、Referer 或 Origin，也不自动重试。测试只能显式注入
Scripted transport 或 loopback 放宽。

HTML 使用 `parse5@8.0.1`。它是惰性的标准 HTML parser，只把字节解析成树，不创建浏览器、
脚本执行、网络加载、DOM 事件或资源上下文。净化器重建极小 allowlist 树并删除全部属性；
抽取器只读取 `main`/`article`，正文边界不明时失败，不以完整 body 兜底。

## 数据边界

原始响应、完整 DOM、header、Cookie、robots 原文和被删除的联系方式均不持久化。成功时只把
再次校验后的离线 HTML 和纯文本写入现有 `SOURCE_SNAPSHOT` 内容寻址仓库。数据库只保存
ManagedRelativePath、哈希、有限策略元数据和运行 provenance。

`FetchedDocument` 永久保持 `FETCHED_NOT_EVIDENCE / UNVERIFIED / NOT_A_FACT`。抓取不改变
Issue 015 候选的四项状态，不创建 Source、Claim、Book 或 Clip。

## 恢复与副作用

每个 execution 只允许一个页面 attempt。相同 execution/request 返回既有终态；不同 request
冲突关闭。崩溃后只有可证明尚未发送的运行可恢复，任何已发送但结果不明的运行保持
`AMBIGUOUS`，不得自动重抓。文件先做不可变内容寻址发布，再以短事务关联数据库；事务失败的
文件作为可检测 orphan 保留。
