# Issue 017 CDP 真实浏览器恢复验收

状态：28/28 已验证。本文是原 110 项验收映射之外的恢复证据，不替代原映射。

|   # | 恢复验收点                        | 实际证据                                                                    |
| --: | --------------------------------- | --------------------------------------------------------------------------- |
|   1 | 保留现有 Issue 017 成果           | `git diff` 仅在原工作树上增量修复；未 reset/stash/checkout                  |
|   2 | 中断前无残留                      | 启动前进程核验；验收器对旧 `.rednote-temp/clipper-real-smoke` 做受控清理    |
|   3 | 动态发现 Chrome                   | `executableCandidates()` 从 PATH、ProgramFiles、LOCALAPPDATA 动态发现       |
|   4 | 动态发现 Edge                     | 同一发现函数按 Edge 相对安装段动态发现                                      |
|   5 | 独立 user-data-dir                | 每款浏览器使用随机 `runRoot/browser-profile`                                |
|   6 | 动态 CDP endpoint                 | `--remote-debugging-port=0` + `DevToolsActivePort`                          |
|   7 | 无固定盘符/安装路径/调试端口      | `clipper-real-smoke-harness.test.ts` 静态回归                               |
|   8 | 不使用默认 profile                | `--user-data-dir` 指向仓库受控随机临时目录                                  |
|   9 | 无 wildcard CDP origin            | 启动参数及静态测试均禁止 `remote-allow-origins=*`                           |
|  10 | CDP 精确 URL + nonce              | 两款浏览器均以 `Runtime.evaluate` 同时核对 href、随机 nonce、readyState     |
|  11 | Windows 工具不判断 URL            | PowerShell 只按 PID 触发工具栏/快捷键手势                                   |
|  12 | 精确 Service Worker target        | target type 与 `chrome-extension://<id>/service-worker.js` 同时匹配         |
|  13 | extension origin 精确绑定         | 配对 201、显式 origin 绑定头与 Local API 客户端一致                         |
|  14 | 真实 action 手势                  | Chrome 使用系统 UIA 工具栏 action；Edge 使用 Win32 `SendInput` 的有效快捷键 |
|  15 | 无新增 manifest permission        | 权限仍仅 `activeTab`、`scripting`、`storage`                                |
|  16 | 不以 all_urls/tabs 替代           | fixture hostname 不匹配 127.0.0.1 host permission；真实 grant 后才可读/截图 |
|  17 | popup 由 CDP target 确认          | 独立 popup target + `DOM.enable` + DOM/Input 交互                           |
|  18 | harness 不读取长期 token          | 不调用 `Extensions.getStorageItems`，token 只由扩展内部使用                 |
|  19 | CDP 日志无敏感正文                | 证据仅保存 method、path、脱敏 authority 和布尔断言                          |
|  20 | Chrome 全流程通过                 | `Chrome/150.0.7871.126`，见脱敏 real-browser smoke JSON                     |
|  21 | Edge 全流程通过                   | `Edg/150.0.4078.99`，见脱敏 real-browser smoke JSON                         |
|  22 | Clip/receipt/screenshot/Candidate | 两款均验证 2 Clip、2 receipt、截图元数据/安全读取及冻结 Candidate           |
|  23 | 离线提示                          | 停止 Local API 后两款均出现可操作的桌面离线提示                             |
|  24 | 插件业务请求仅 loopback           | CDP Network 对所有 HTTP(S) 请求强制断言配置的动态 127.0.0.1 authority       |
|  25 | profile/进程清理                  | 两款均 `Browser.close`、进程退出、fixture/API/DB 关闭、runRoot 删除         |
|  26 | 原 110 项仍成立                   | `m2-issue017-acceptance-map.md` 已回填 110/110                              |
|  27 | 从最新 npm ci 的完整门禁          | 最终门禁记录在本轮验收报告；任何失败均从 npm ci 重跑                        |
|  28 | 唯一 Issue 017 本地提交           | 本轮只执行一次 `git commit`；提交后核验 HEAD、parent 与工作树               |

脱敏机器证据：`docs/evidence/m2-issue017-real-browser-smoke.json`。
