# M2 Issue 016 实施计划：受控公开页面抓取

状态：实现完成。本文在编码前创建，现已回填真实代码与测试证据；最终门禁结果和本地提交
SHA 以本轮验收报告为准。

## 1. 动态基线与停止边界

- 仓库根与任务基线由 Git 动态发现；开始时分支为 `main`，工作树仅包含本轮指令副本。
- Issue 015 已提供 SearchProvider V1、migration v8、SearchCandidate、SearchRun、持久限速和
  `SEARCH_EXECUTE_V1`；候选四项冻结状态不修改。
- 现有 `SOURCE_SNAPSHOT` 内容寻址仓库负责保存受控的净化 HTML 与纯文本。
- 只实现 Issue 016；不进入 BrowserClip、书目发现、Source/Claim/Evidence 或其他后续业务。
- 全部网络测试仅使用 Scripted transport 或 `127.0.0.1` loopback；产品策略拒绝 loopback。
- 不使用真实密钥、真实站点、模型、搜索服务或付费 API。

## 2. 架构与依赖

- 新增 Electron 无关的 `packages/fetch`，承载 V1 合同、URL/DNS/SSRF、robots、HTTP、
  MIME/charset、HTML 净化、正文抽取、隐私最小化与执行服务。
- `packages/fetch` 只通过有限 port 获取 candidate、持久化状态、发布受控文件和执行网络请求。
- 追加 migration v9 与 Fetch 仓储；历史 migration 和 Issue 015 candidate schema 不修改。
- `packages/workflows` 只注册 `FETCH_PUBLIC_PAGE_V1` handler，不增加自动入队来源。
- desktop main 只组合严格产品状态；renderer 只接收有限状态和 policy DTO，不接收执行入口。

## 3. 安全与确定性

- FetchRequest 不接受 raw URL、header、Cookie、credential、proxy、method 或脚本。
- candidate ID、URL hash、profile、policy 与 plan 全量绑定，过期或变化在发送前拒绝。
- 每个 host/redirect 重新执行 DNS/SSRF 校验，连接固定到验证地址并核对 remote peer。
- 页面 GET 使用固定诚实 User-Agent；不发送认证/导航 header，不读取或保存 Set-Cookie。
- robots fail closed；跨 host redirect、HTTPS 降级、访问控制和 challenge 均停止且不重试。
- 原始响应、完整 DOM、header、Cookie、robots 原文和无关个人信息不持久化。
- 输出始终为 `FETCHED_NOT_EVIDENCE / UNVERIFIED / NOT_A_FACT`。

## 4. 解析、存储与恢复

- 使用 `parse5` 的纯解析 API：不执行脚本、不加载资源、不创建浏览上下文，适合确定性离线树处理。
- sanitizer 采用极小标签 allowlist并删除所有导航、资源、事件、样式和 active-content 属性。
- extractor 只选择明确 main/article 正文，确定性保留结构文本，不摘要、不翻译、不判断事实。
- privacy minimizer 只执行版本化 contact block 替换并记录计数；正文不明或 UGC 主导则不保存。
- 净化 HTML 与文本二次校验后，通过 `SOURCE_SNAPSHOT` 内容寻址发布。
- executionId 重放不重复请求或文件；只恢复可证明 pre-send，after-send 不明保持 `AMBIGUOUS`。

## 5. 数据、UI 与验证

- migration v9 新增 profile、origin rate、robots cache、run、redirect hop 和 document 六类 STRICT 表。
- `FETCH_PUBLIC_PAGE_V1` payload/result 只保存有限 identity、status、count 和 stable error。
- 设置页只显示 readiness 与有限 policy；任务中心只显示安全摘要，不显示正文、完整 URL 或内部路径。
- 新增 `npm run test:fetch` 并纳入全量测试和 Windows CI。
- 最终从最新 `npm ci` 开始执行全部适用门禁，修复后重新从该起点运行。

## 6. 交付停止点

- 回填 100 项验收证据、README、AGENTS、ADR、合同和 egress 矩阵。
- 完成 diff、敏感值、网络、临时文件、进程和 listener 审计。
- 创建唯一一个本地提交 `feat(fetch): add controlled public page extraction`。
- 不 push、不创建 PR、不合并、不进入 Issue 017。
