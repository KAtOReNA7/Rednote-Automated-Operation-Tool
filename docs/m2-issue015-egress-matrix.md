# M2 Issue 015 Search / Network / Content Egress 矩阵

结论：生产搜索外发目标为 **0**；测试只允许显式绑定本机 loopback 的 fixture endpoint，且不会
连接结果 URL。`tests/search-egress.test.ts` 以 70 个文档化测试目标验证生产 HTTP 在 send 前拒绝。

| 编号范围 | 类别                                      | 数量 | 预期                                |
| -------- | ----------------------------------------- | ---: | ----------------------------------- |
| 01–20    | 公网/保留地址 HTTP Search API 目标        |   20 | `SEARCH_INVALID_REQUEST / NOT_SENT` |
| 21–40    | 带不同 path/query 的非 loopback HTTP 目标 |   20 | `SEARCH_INVALID_REQUEST / NOT_SENT` |
| 41–55    | 任意 result/content 类目标                |   15 | 不创建连接                          |
| 56–65    | crawler/RSS/sitemap/attachment 类目标     |   10 | 无实现、无连接                      |
| 66–70    | plugin/page-fetch/evidence 类目标         |    5 | 无 route、无连接                    |

补充边界：

- 生产 transport 只接受 HTTPS；本仓库没有生产 Search API codec、endpoint 或 credential slot。
- HTTP 仅由 `LoopbackSearchApiCodec` 在测试中允许 `127.0.0.1`。
- redirect 默认 0；codec 明确声明时最多一个 same-origin，拒绝 cross-origin 和 downgrade。
- request/response header、connect/header/body/total timeout、raw/decompressed bytes 均有上限。
- invalid MIME/JSON/schema、部分 socket、before/after-send timeout、429/5xx 均 fail closed，不触发
  retry、fallback、翻页或并行 Provider。
- 模型 narrative、绝对路径和实际 credential 回显不会进入候选、数据库、Job result、IPC 或日志；
  HTML/script/formula 形态的上游标题或 snippet 只作为有界、不执行、未验证的候选元数据保存，
  不能成为事实或证据。
- 候选 URL 永不由 Search transport 连接；Issue 016 前 fetch 次数固定为 0。
