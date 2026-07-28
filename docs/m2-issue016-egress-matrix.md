# M2 Issue 016 Egress 矩阵

| 路径                     | 产品默认                            | 测试方式                 | 可发送内容                             | 明确禁止                                    |
| ------------------------ | ----------------------------------- | ------------------------ | -------------------------------------- | ------------------------------------------- |
| 启动 / 设置页 / 任务中心 | 0 请求                              | renderer 单元测试        | 无                                     | URL、DNS、正文、密钥                        |
| robots                   | 仅显式队列执行                      | Scripted 或注入 loopback | 固定 GET `/robots.txt`、固定 UA/Accept | Cookie/Auth/自定义 header/代理              |
| 单页 Fetch               | 仅已绑定候选且 profile 启用         | Scripted 或注入 loopback | 固定 GET、同 host 有限 redirect        | 任意 URL、遍历、资源、JS、登录、retry       |
| DNS / 连接               | 系统 DNS、公网全集校验、socket 固定 | 注入 resolver/peer       | hostname                               | 非公网目标、代理、自定义 DNS                |
| SQLite / 文件            | 本机 ProjectDataRoot                | 临时中文空格路径         | 有限元数据、净化 HTML、纯文本          | raw body/header/Cookie/完整 DOM/robots 原文 |
| 模型 / 搜索 /平台        | 0 请求                              | mock/fixture             | 无                                     | 模型、搜索执行、小红书 API                  |

产品组合不传入 `allowNonPublicForTests`。CI 不访问真实网站；source 与 packaged Electron smoke
继续以外部连接 0 为通过条件。
