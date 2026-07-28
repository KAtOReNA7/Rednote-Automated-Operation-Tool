# HTML Sanitization V1

输入只来自已通过 MIME、压缩、字节和 charset 校验的内存响应。parser 使用 `parse5`，不执行
JavaScript、不加载资源，也不创建 BrowserWindow、renderer、webview 或 JSDOM 网络环境。

## 保留

只保留正文需要的 `main`、`article`、`h1`—`h6`、`p`、`blockquote`、`ul`、`ol`、`li`、
`table` 族、`time`、`strong`、`em`、`b`、`i`、`code`、`pre` 和 `br`。输出元素不保留任何
属性。

## 删除与拒绝

脚本、样式、表单、iframe、object、embed、SVG/MathML、媒体、picture/source、template、
meta/base 及其危险子树被删除。导航、页头页尾、侧栏、推荐、广告、评论、登录、分享、
Cookie banner 按有限结构提示排除。

正文只从明确的 `main`/`article` 抽取；不存在明确正文时返回 `FETCH_EXTRACTION_EMPTY`，UGC
或边界不明确时返回 `FETCH_PRIVACY_REVIEW_REQUIRED`。明显邮箱、联系电话和联系地址替换为
固定占位符，仅记录分类计数。

净化 HTML 与纯文本在哈希和落盘前分别进行第二次校验。HTML 必须没有属性、active tag、
远程 URL、脚本/data/blob 协议或 NUL；文本必须达到最小正文长度、没有 NUL/challenge 且不
超限。序列化固定为 UTF-8，抽取不会摘要、翻译、改写或判断事实。
