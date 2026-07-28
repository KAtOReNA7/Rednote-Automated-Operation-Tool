# Issue 017 字段级出站矩阵

决策：`LOCAL_ONLY` 只进入当前设备受控存储；`LOOPBACK_ONLY` 只经 `127.0.0.1` 进入桌面；
`NEVER_COLLECT` 不读取、不保存、不传输。Issue 017 没有公网出站。

| ID    | 数据或行为                | 决策          | 说明                              |
| ----- | ------------------------- | ------------- | --------------------------------- |
| E-001 | endpoint                  | LOCAL_ONLY    | 仅扩展受信存储                    |
| E-002 | bearer token              | LOCAL_ONLY    | 仅扩展受信存储与 Authorization 头 |
| E-003 | pairing code              | LOOPBACK_ONLY | 短期内存配对                      |
| E-004 | client label              | LOOPBACK_ONLY | 用户手工输入                      |
| E-005 | extension origin          | LOOPBACK_ONLY | CORS、显式绑定头与幂等绑定        |
| E-006 | capture id                | LOOPBACK_ONLY | 客户端 UUID                       |
| E-007 | contract version          | LOOPBACK_ONLY | 固定版本                          |
| E-008 | extension version         | LOOPBACK_ONLY | 构建标识                          |
| E-009 | browser family            | LOOPBACK_ONLY | Chrome/Edge/Chromium              |
| E-010 | captured at               | LOOPBACK_ONLY | UTC 时间                          |
| E-011 | page URL                  | LOOPBACK_ONLY | 公开 HTTP(S) URL                  |
| E-012 | normalized URL            | LOCAL_ONLY    | 桌面本地计算                      |
| E-013 | URL hash                  | LOCAL_ONLY    | 桌面本地计算                      |
| E-014 | page title                | LOOPBACK_ONLY | 当前页标题                        |
| E-015 | selected text             | LOOPBACK_ONLY | 用户主动选择                      |
| E-016 | selected text hash        | LOCAL_ONLY    | 桌面本地计算                      |
| E-017 | platform                  | LOOPBACK_ONLY | 用户手工枚举                      |
| E-018 | account name              | LOOPBACK_ONLY | 用户手工输入                      |
| E-019 | published at              | LOOPBACK_ONLY | 用户手工输入                      |
| E-020 | likes                     | LOOPBACK_ONLY | 用户手工输入                      |
| E-021 | favorites                 | LOOPBACK_ONLY | 用户手工输入                      |
| E-022 | comments                  | LOOPBACK_ONLY | 用户手工输入                      |
| E-023 | shares                    | LOOPBACK_ONLY | 用户手工输入                      |
| E-024 | views                     | LOOPBACK_ONLY | 用户手工输入                      |
| E-025 | tags                      | LOOPBACK_ONLY | 固定枚举                          |
| E-026 | user note                 | LOOPBACK_ONLY | 用户手工输入                      |
| E-027 | public-page confirmation  | LOOPBACK_ONLY | 必须显式确认                      |
| E-028 | screenshot opt-in         | LOCAL_ONLY    | 默认关闭                          |
| E-029 | visible viewport PNG      | LOOPBACK_ONLY | 显式勾选后                        |
| E-030 | screenshot MIME           | LOCAL_ONLY    | 服务端校验                        |
| E-031 | screenshot magic bytes    | LOCAL_ONLY    | 服务端校验                        |
| E-032 | screenshot width          | LOCAL_ONLY    | 服务端解码                        |
| E-033 | screenshot height         | LOCAL_ONLY    | 服务端解码                        |
| E-034 | screenshot byte count     | LOCAL_ONLY    | 服务端解码                        |
| E-035 | screenshot hash           | LOCAL_ONLY    | 服务端计算                        |
| E-036 | managed screenshot path   | LOCAL_ONLY    | 不进入 renderer DTO               |
| E-037 | clip id                   | LOCAL_ONLY    | 桌面生成                          |
| E-038 | candidate id              | LOCAL_ONLY    | 桌面生成                          |
| E-039 | receipt status            | LOOPBACK_ONLY | 返回同一扩展                      |
| E-040 | receipt timestamps        | LOOPBACK_ONLY | 返回同一扩展                      |
| E-041 | payload hash              | LOCAL_ONLY    | 幂等校验                          |
| E-042 | rate minute count         | LOCAL_ONLY    | 持久限额                          |
| E-043 | rate day count            | LOCAL_ONLY    | 持久限额                          |
| E-044 | screenshot day bytes      | LOCAL_ONLY    | 持久限额                          |
| E-045 | active request flag       | LOCAL_ONLY    | 并发保护                          |
| E-046 | candidate canonical URL   | LOCAL_ONLY    | 被动本地候选                      |
| E-047 | candidate display host    | LOCAL_ONLY    | renderer 展示                     |
| E-048 | candidate title           | LOCAL_ONLY    | renderer 展示                     |
| E-049 | candidate preview text    | NEVER_COLLECT | 固定为空                          |
| E-050 | candidate evidence status | LOCAL_ONLY    | 固定 LEAD_ONLY                    |
| E-051 | candidate fetch state     | LOCAL_ONLY    | 固定 NOT_FETCHED                  |
| E-052 | candidate truth status    | LOCAL_ONLY    | 固定 UNVERIFIED                   |
| E-053 | candidate fact status     | LOCAL_ONLY    | 固定 NOT_A_FACT                   |
| E-054 | search external count     | LOCAL_ONLY    | 固定 0                            |
| E-055 | search cost state         | LOCAL_ONLY    | 固定 NOT_INCURRED                 |
| E-056 | full page HTML            | NEVER_COLLECT | 无接口读取                        |
| E-057 | DOM outerHTML             | NEVER_COLLECT | 无接口读取                        |
| E-058 | DOM innerHTML             | NEVER_COLLECT | 无接口读取                        |
| E-059 | form values               | NEVER_COLLECT | 无接口读取                        |
| E-060 | password fields           | NEVER_COLLECT | 无接口读取                        |
| E-061 | cookies                   | NEVER_COLLECT | 无权限                            |
| E-062 | page localStorage         | NEVER_COLLECT | 无读取                            |
| E-063 | page sessionStorage       | NEVER_COLLECT | 无读取                            |
| E-064 | IndexedDB                 | NEVER_COLLECT | 无读取                            |
| E-065 | cache storage             | NEVER_COLLECT | 无读取                            |
| E-066 | browsing history          | NEVER_COLLECT | 无权限                            |
| E-067 | bookmarks                 | NEVER_COLLECT | 无权限                            |
| E-068 | downloads                 | NEVER_COLLECT | 无权限                            |
| E-069 | clipboard                 | NEVER_COLLECT | 无权限                            |
| E-070 | geolocation               | NEVER_COLLECT | 无权限                            |
| E-071 | microphone                | NEVER_COLLECT | 无权限                            |
| E-072 | camera                    | NEVER_COLLECT | 无权限                            |
| E-073 | incognito pages           | NEVER_COLLECT | manifest 禁止                     |
| E-074 | background tab content    | NEVER_COLLECT | activeTab 限制                    |
| E-075 | subframe content          | NEVER_COLLECT | allFrames=false                   |
| E-076 | page network responses    | NEVER_COLLECT | 无 webRequest                     |
| E-077 | request headers           | NEVER_COLLECT | 无 webRequest                     |
| E-078 | response headers          | NEVER_COLLECT | 无 webRequest                     |
| E-079 | login credentials         | NEVER_COLLECT | 合同拒绝                          |
| E-080 | URL username/password     | NEVER_COLLECT | URL 校验拒绝                      |
| E-081 | credential-like query     | NEVER_COLLECT | URL 校验拒绝                      |
| E-082 | URL fragment              | NEVER_COLLECT | URL 校验拒绝                      |
| E-083 | filesystem URL            | NEVER_COLLECT | 协议拒绝                          |
| E-084 | chrome internal URL       | NEVER_COLLECT | 协议拒绝                          |
| E-085 | edge internal URL         | NEVER_COLLECT | 协议拒绝                          |
| E-086 | extension page content    | NEVER_COLLECT | 协议拒绝                          |
| E-087 | private platform API      | NEVER_COLLECT | 无实现                            |
| E-088 | auto login                | NEVER_COLLECT | 禁止范围                          |
| E-089 | auto publish              | NEVER_COLLECT | 禁止范围                          |
| E-090 | auto comment              | NEVER_COLLECT | 禁止范围                          |
| E-091 | auto private message      | NEVER_COLLECT | 禁止范围                          |
| E-092 | captcha handling          | NEVER_COLLECT | 禁止范围                          |
| E-093 | risk-control bypass       | NEVER_COLLECT | 禁止范围                          |
| E-094 | model prompt              | NEVER_COLLECT | 不接模型                          |
| E-095 | model response            | NEVER_COLLECT | 不接模型                          |
| E-096 | search API request        | NEVER_COLLECT | 不接搜索                          |
| E-097 | image API request         | NEVER_COLLECT | 截图为浏览器本地能力              |
| E-098 | cloud database write      | NEVER_COLLECT | 仅本机 SQLite                     |
| E-099 | remote queue job          | NEVER_COLLECT | 不入队                            |
| E-100 | telemetry                 | NEVER_COLLECT | 无遥测                            |
