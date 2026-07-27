# M1 Issue 010 验收映射

状态：实现完成，160/160 项已有代码、测试或门禁证据。

|   # | 验收行为                                                      | 实际证据                      |
| --: | ------------------------------------------------------------- | ----------------------------- |
| 001 | 起点 HEAD 精确匹配                                            | Git 起点核验、最终报告        |
| 002 | M0、007、009、006、008 祖先顺序正确                           | Git ancestry 核验             |
| 003 | 工作树起点干净                                                | 移入本指令前 `git status`     |
| 004 | v1 迁移 SHA-256 不变                                          | settings schema test          |
| 005 | v2 迁移 SHA-256 不变                                          | settings schema test          |
| 006 | v3 迁移 SHA-256 不变                                          | settings schema test          |
| 007 | test:constraints 保持通过                                     | 最终门禁                      |
| 008 | test:db 保持通过                                              | 最终门禁                      |
| 009 | test:queue 保持通过                                           | 最终门禁                      |
| 010 | test:desktop 保持通过                                         | 最终门禁                      |
| 011 | test:storage 保持通过                                         | 最终门禁                      |
| 012 | Electron smoke 保持通过                                       | source smoke                  |
| 013 | packaged EXE smoke 保持通过                                   | packaged smoke                |
| 014 | 全量既有 350 项测试不减少                                     | 全量测试计数                  |
| 015 | 依赖审计保持 0 漏洞                                           | npm audit                     |
| 016 | v4 版本连续且名称稳定                                         | settings schema test          |
| 017 | v1—v3 内容和校验和保持                                        | settings schema test          |
| 018 | v4 重复运行幂等                                               | settings schema test          |
| 019 | app_settings singleton 约束有效                               | settings schema test          |
| 020 | app_settings 不保存 data root 绝对路径                        | schema introspection          |
| 021 | Schema 无 secret/api_key_value/password_value/ciphertext 字段 | schema introspection          |
| 022 | credential_reference 只接受固定引用                           | SQLite CHECK test             |
| 023 | Base URL DB 约束拒绝 user info/query/fragment                 | SQLite CHECK test             |
| 024 | model ID 字段限制有效                                         | SQLite CHECK test             |
| 025 | 预算使用整数美分                                              | schema + validation test      |
| 026 | 默认预警 8000                                                 | schema/repository test        |
| 027 | 默认硬上限 10000                                              | schema/repository test        |
| 028 | warning < hard <= 10000                                       | schema + service test         |
| 029 | revision 单调增加                                             | repository concurrency test   |
| 030 | 时间字段为项目 UTC 格式                                       | schema/repository test        |
| 031 | account ownership 固定 PERSONAL                               | transaction test              |
| 032 | occupation disclosure 默认 DEFERRED                           | repository test               |
| 033 | tone/content scope JSON 结构校验                              | validation + DB test          |
| 034 | 旧库升级保留业务行、索引、外键和 STRICT                       | migration upgrade test        |
| 035 | v4 失败回滚且迁移前备份可独立打开                             | migration recovery test       |
| 036 | locator 不存在进入首次向导                                    | locator/service/UI test       |
| 037 | locator 使用固定位置和版本格式                                | locator test                  |
| 038 | locator 只保存一个受控绝对数据根                              | locator payload test          |
| 039 | locator 保存 projectInstanceId                                | locator roundtrip test        |
| 040 | locator 原子写入                                              | failure-injection test        |
| 041 | locator revision 防并发覆盖                                   | locator conflict test         |
| 042 | 损坏 locator 进入恢复状态                                     | locator/service test          |
| 043 | 高版本 locator 被拒绝                                         | locator test                  |
| 044 | 数据根缺失不自动重建                                          | locator test                  |
| 045 | marker instance 不匹配时拒绝                                  | locator test                  |
| 046 | 目录选择只在 main process                                     | architecture test             |
| 047 | 原生 dialog 只用 openDirectory                                | picker contract test          |
| 048 | Windows dialog 使用 dontAddToRecent                           | picker contract test          |
| 049 | 取消 dialog 不产生状态变化                                    | picker/service test           |
| 050 | selection token 有 TTL                                        | token test                    |
| 051 | selection token 单次使用                                      | token test                    |
| 052 | token 绑定 sender/window                                      | token test                    |
| 053 | renderer 不能传任意绝对路径                                   | IPC/architecture test         |
| 054 | 新空根可初始化                                                | locator/root test             |
| 055 | 已有合法根可打开                                              | locator/root test             |
| 056 | 非空无标记根被拒绝                                            | root regression               |
| 057 | 根切换前明确确认                                              | service/UI test               |
| 058 | 根切换不复制、移动或删除旧根                                  | failure-injection test        |
| 059 | 新根完整可用后才更新 locator                                  | two-phase test                |
| 060 | locator 更新失败时旧根仍 active                               | two-phase failure test        |
| 061 | safeStorage 只在 main process                                 | architecture test             |
| 062 | safeStorage 调用在 app ready 后                               | runtime wiring/smoke          |
| 063 | 使用 isAsyncEncryptionAvailable                               | adapter test + smoke          |
| 064 | 使用 encryptStringAsync                                       | adapter test + smoke          |
| 065 | 使用 decryptStringAsync                                       | adapter test + smoke          |
| 066 | 不调用 setUsePlainTextEncryption                              | architecture test             |
| 067 | Windows 实际 safeStorage roundtrip                            | Electron smoke                |
| 068 | safeStorage 不可用时拒绝保存                                  | adapter test                  |
| 069 | 不自动降级明文                                                | adapter test                  |
| 070 | 固定 CONTENT_AI_API_KEY 槽位                                  | contract test                 |
| 071 | 任意槽位名称被拒绝                                            | adapter test                  |
| 072 | 写入后 status CONFIGURED                                      | adapter/service test          |
| 073 | 未配置 status NOT_CONFIGURED                                  | adapter/service test          |
| 074 | 替换后只保留新有效引用                                        | adapter test                  |
| 075 | 替换失败保留旧凭据                                            | failure-injection test        |
| 076 | clear 需要明确确认                                            | service/IPC/UI test           |
| 077 | clear 后 NOT_CONFIGURED                                       | adapter/service test          |
| 078 | ciphertext 损坏返回 CORRUPT                                   | adapter test                  |
| 079 | decrypt 失败返回 REAUTH_REQUIRED                              | adapter test                  |
| 080 | shouldReEncrypt 被处理                                        | adapter test                  |
| 081 | re-encrypt 失败不破坏旧 blob                                  | failure-injection test        |
| 082 | UI/API 不返回密钥                                             | DTO/UI test                   |
| 083 | 不返回 prefix/last4/length/hash/fingerprint                   | DTO/egress test               |
| 084 | 凭据不写 process.env                                          | egress test                   |
| 085 | 凭据不进入 JobQueue                                           | egress test                   |
| 086 | 凭据不进入 audit                                              | egress test                   |
| 087 | 凭据不进入 DB/WAL/SHM                                         | egress test                   |
| 088 | 凭据不进入日志、导出、备份、诊断                              | egress test                   |
| 089 | 凭据不进入 package、Git、snapshot                             | egress/package test           |
| 090 | 加密 blob 无可搜索明文                                        | adapter/smoke test            |
| 091 | 合法 HTTPS Base URL 可保存                                    | validation/service test       |
| 092 | loopback HTTP 可保存                                          | validation/service test       |
| 093 | 非 loopback HTTP 被拒绝                                       | validation test               |
| 094 | URL username/password 被拒绝                                  | validation + DB test          |
| 095 | URL query/fragment 被拒绝                                     | validation + DB test          |
| 096 | URL 控制字符和超长被拒绝                                      | validation test               |
| 097 | Base URL 规范化确定                                           | table-driven test             |
| 098 | 保存 Base URL 不发网络请求                                    | fetch spy/service test        |
| 099 | provider protocol 固定 OPENAI_COMPATIBLE                      | schema/DTO test               |
| 100 | 模型 ID 可配置且不硬编码                                      | service/architecture test     |
| 101 | 可选模型可以为空                                              | service test                  |
| 102 | 模型控制字符和超长被拒绝                                      | validation test               |
| 103 | 不根据模型名推断能力                                          | service test                  |
| 104 | 能力状态保持“尚未探测”                                        | DTO/UI test                   |
| 105 | 不创建 model_runs/cost_ledger                                 | DB count test                 |
| 106 | 默认预算显示 80/100 美元                                      | repository/UI test            |
| 107 | 更低合法预算可保存                                            | service test                  |
| 108 | 硬上限大于 100 美元拒绝                                       | validation + DB test          |
| 109 | warning >= hard 被拒绝                                        | validation + DB test          |
| 110 | NaN/Infinity/科学计数/浮点误差拒绝                            | budget parser test            |
| 111 | ownership 不能改出 PERSONAL                                   | service/DB test               |
| 112 | occupation 默认 DEFERRED                                      | repository/UI test            |
| 113 | 默认口吻符合冻结文案                                          | default profile test          |
| 114 | 内容范围排除偶像/音乐/演唱会/泛娱乐/粉圈                      | default scope test            |
| 115 | 无 AI 标识、版权、自动发布设置                                | UI/architecture test          |
| 116 | preload 一能力一固定方法/channel                              | contract test                 |
| 117 | 不暴露 raw ipcRenderer/send/invoke/on                         | architecture test             |
| 118 | senderFrame origin 验证保持                                   | IPC test                      |
| 119 | 非法 origin 被拒绝                                            | IPC test                      |
| 120 | 每个输入执行 schema/字段/大小校验                             | IPC table tests               |
| 121 | 多余字段被拒绝                                                | IPC test                      |
| 122 | updateNonSecretSettings 拒绝 secret-like 字段                 | IPC test                      |
| 123 | selectDataRoot 不接受路径参数                                 | IPC test                      |
| 124 | confirmDataRootSelection 只接受 token                         | IPC test                      |
| 125 | setCredential 返回 status 而非 value                          | IPC test                      |
| 126 | clearCredential 使用固定确认                                  | IPC test                      |
| 127 | 错误不泄露 stack/path/SQL/ciphertext/secret                   | error DTO test                |
| 128 | renderer 不导入 Node/fs/db/storage/safeStorage                | architecture test             |
| 129 | renderer 无 raw 绝对路径写能力                                | architecture/IPC test         |
| 130 | BrowserWindow/CSP/navigation/fuses 不放宽                     | desktop regression            |
| 131 | 首次向导六步骤可达                                            | renderer test                 |
| 132 | 设置页重开并加载持久值                                        | renderer integration test     |
| 133 | 密钥 input=password 且不预填                                  | renderer test                 |
| 134 | 无显示、复制、导出密钥按钮                                    | renderer test                 |
| 135 | 保存/取消/卸载清空密钥 DOM/state                              | renderer test                 |
| 136 | loading/empty/error/conflict/unavailable 可见                 | renderer test                 |
| 137 | 键盘导航和可见 focus                                          | renderer test                 |
| 138 | 未保存离开有提示                                              | renderer test                 |
| 139 | 保存后从持久层重新读取                                        | bridge call test              |
| 140 | UI 不显示虚构连接/能力成功                                    | renderer test                 |
| 141 | 基础诊断预览可生成                                            | diagnostics test              |
| 142 | 预览有稳定 hash                                               | diagnostics test              |
| 143 | 设置变化后旧预览导出拒绝                                      | diagnostics test              |
| 144 | 诊断只写 exports/diagnostics                                  | storage test                  |
| 145 | 诊断不接受任意输出路径                                        | API/architecture test         |
| 146 | 诊断不生成 ZIP                                                | diagnostics/architecture test |
| 147 | 诊断不含密钥/ciphertext/credential id                         | egress test                   |
| 148 | 诊断不含 data root/userData 路径和用户名                      | egress test                   |
| 149 | 诊断不含完整 URL/env/header/body/DB/jobs payload              | egress test                   |
| 150 | 诊断只含 configured/health/version 等有限字段                 | snapshot-free exact test      |
| 151 | 源码 Electron settings smoke 通过                             | source smoke                  |
| 152 | packaged EXE settings smoke 通过                              | packaged smoke                |
| 153 | smoke userData/ProjectDataRoot 临时隔离                       | smoke report/test             |
| 154 | smoke 只用运行时随机不可用测试值                              | smoke implementation          |
| 155 | runtime 外部网络请求 0                                        | source/package smoke          |
| 156 | packaged 进程树 TCP 监听/连接 0                               | packaged smoke                |
| 157 | 无云服务、真实 API、密钥配置或费用                            | architecture + runtime test   |
| 158 | ai_disclosure=false；版权不参与门禁/评分/审批/排期            | constraints regression        |
| 159 | 无平台动作、开卷或盗版电子书处理                              | forbidden-scope test          |
| 160 | 停止在 Issue 010，不进入 Issue 011                            | Git diff 与最终报告           |

## 规定门禁

完成后从 `npm ci` 开始，依次运行：

1. `npm run format-check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test:constraints`
5. `npm run test:db`
6. `npm run test:queue`
7. `npm run test:storage`
8. `npm run test:desktop`
9. `npm run test:settings`
10. `npm run test`
11. `npm run test:electron-smoke`
12. `npm run build`
13. `npm run package:desktop`
14. `npm run test:packaged-smoke`
15. `npm run audit:dependencies`

GitHub 托管 CI 只有在远端实际运行后才能报告结果；本地仅验证 Windows workflow 结构和全部同等命令。

## 本地验收结果

- 固定起点：`a8ba00dc1dd6658984a6803f12fc93733a886bde`
- migration v1 SHA-256：`8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907`
- migration v2 SHA-256：`ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce`
- migration v3 SHA-256：`11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed`
- migration v4 SHA-256：`c84c82c50f2170c20154c754d0604319082c6683737624a9c14d3a508315471c`
- `test:settings`：9 个文件，97/97
- `test:constraints`：17/17
- `test:db`：26/26
- `test:queue`：131/131
- `test:storage`：75/75
- `test:desktop`：87/87
- 全量测试：39 个文件，447/447
- source Electron smoke：通过，真实 safeStorage roundtrip、30 项 egress 计数、外部请求 0
- packaged EXE smoke：通过，fuses 正确、30 项 egress 计数、外部请求 0、TCP 监听/连接 0
- 依赖审计：0 vulnerabilities
- GitHub 托管 CI 尚未运行，不能声称已通过。
