# M1 Issue 008 验收映射

状态：最终映射。130 项均保留独立编号，并由下列自动化或可复核证据覆盖。

## A. 起点与历史

|   # | 验收                           | 自动化/可复核证据                                                 |
| --: | ------------------------------ | ----------------------------------------------------------------- |
|   1 | 起点 HEAD 精确匹配             | Git 起点记录；最终报告                                            |
|   2 | M0、007、009、006 祖先顺序正确 | Git `merge-base --is-ancestor` 起点记录                           |
|   3 | 工作树起点干净                 | Git 起点记录                                                      |
|   4 | 版本 1 SHA-256 不变            | `tests/storage-db-paths.test.ts`；`tests/db-migrations.test.ts`   |
|   5 | 版本 2 SHA-256 不变            | `tests/storage-db-paths.test.ts`；`tests/queue-migration.test.ts` |
|   6 | Issue 006 ADR 不变             | `tests/storage-architecture.test.ts`；Git diff                    |
|   7 | Issue 006 的 105 项映射保持    | `tests/desktop-architecture.test.ts`；既有验收映射                |
|   8 | constraints 保持通过           | `npm run test:constraints`                                        |
|   9 | db 保持通过                    | `npm run test:db`                                                 |
|  10 | queue 保持通过                 | `npm run test:queue`                                              |
|  11 | desktop 保持通过               | `npm run test:desktop`                                            |
|  12 | Electron smoke 保持通过        | `npm run test:electron-smoke`                                     |
|  13 | packaged smoke 保持通过        | `npm run test:packaged-smoke`                                     |
|  14 | 依赖审计 0 漏洞                | `npm run audit:dependencies`                                      |

## B. 根目录与布局

|   # | 验收                           | 自动化/可复核证据                                    |
| --: | ------------------------------ | ---------------------------------------------------- |
|  15 | 根目录显式传入                 | `tests/storage-root-paths.test.ts`                   |
|  16 | 两个显式根独立运行             | `tests/storage-root-paths.test.ts`                   |
|  17 | 拒绝 Windows 盘符根            | `tests/storage-root-paths.test.ts`                   |
|  18 | 拒绝 POSIX 文件系统根          | `tests/storage-root-paths.test.ts`                   |
|  19 | 不存在根可初始化               | `tests/storage-root-paths.test.ts`                   |
|  20 | 空目录可初始化                 | `tests/storage-root-paths.test.ts`                   |
|  21 | 合法根可重复打开               | `tests/storage-root-paths.test.ts`                   |
|  22 | 根标记格式固定                 | `tests/storage-root-paths.test.ts`                   |
|  23 | 根标记不含路径/敏感信息        | `tests/storage-root-paths.test.ts`                   |
|  24 | 高版本标记被拒绝               | `tests/storage-root-paths.test.ts`                   |
|  25 | 错误 format 被拒绝             | `tests/storage-root-paths.test.ts`                   |
|  26 | 非空无标记目录被拒绝           | `tests/storage-root-paths.test.ts`                   |
|  27 | 固定目录完整建立               | `tests/storage-root-paths.test.ts`                   |
|  28 | 缺失普通目录可补齐             | `tests/storage-root-paths.test.ts`                   |
|  29 | 目录被普通文件占用时拒绝       | `tests/storage-root-paths.test.ts`                   |
|  30 | 目录被链接/junction 占用时拒绝 | `tests/storage-root-paths.test.ts`                   |
|  31 | 并发初始化 instance id 稳定    | `tests/storage-root-paths.test.ts`                   |
|  32 | 中断后可补齐且不删除已有文件   | `tests/storage-root-paths.test.ts`                   |
|  33 | 不产生云目录/持久临时目录      | `tests/storage-root-paths.test.ts`                   |
|  34 | smoke 不污染生产根             | `tests/storage-architecture.test.ts`；Electron smoke |

## C. 文件名与 ManagedRelativePath

|   # | 验收                      | 自动化/可复核证据                  |
| --: | ------------------------- | ---------------------------------- |
|  35 | 中文文件名保留            | `tests/storage-root-paths.test.ts` |
|  36 | 空格确定性处理            | `tests/storage-root-paths.test.ts` |
|  37 | Windows 保留字符净化      | `tests/storage-root-paths.test.ts` |
|  38 | 控制字符/NUL 处理         | `tests/storage-root-paths.test.ts` |
|  39 | 尾随空格移除              | `tests/storage-root-paths.test.ts` |
|  40 | 尾随句点移除              | `tests/storage-root-paths.test.ts` |
|  41 | CON/PRN/AUX/NUL 处理      | `tests/storage-root-paths.test.ts` |
|  42 | COM1—9/LPT1—9 处理        | `tests/storage-root-paths.test.ts` |
|  43 | 上标数字设备名处理        | `tests/storage-root-paths.test.ts` |
|  44 | 保留名加扩展仍处理        | `tests/storage-root-paths.test.ts` |
|  45 | `.`/`..` 被拒绝           | `tests/storage-root-paths.test.ts` |
|  46 | 空净化结果有回退名        | `tests/storage-root-paths.test.ts` |
|  47 | 超长段确定性截断          | `tests/storage-root-paths.test.ts` |
|  48 | 截断不破坏 surrogate pair | `tests/storage-root-paths.test.ts` |
|  49 | 扩展名独立处理            | `tests/storage-root-paths.test.ts` |
|  50 | 大小写碰撞由内容哈希消歧  | `tests/storage-repository.test.ts` |
|  51 | Unicode 等价名不覆盖      | `tests/storage-repository.test.ts` |
|  52 | 拒绝 POSIX 绝对路径       | `tests/storage-root-paths.test.ts` |
|  53 | 拒绝 Windows 绝对路径     | `tests/storage-root-paths.test.ts` |
|  54 | 拒绝盘符相对路径          | `tests/storage-root-paths.test.ts` |
|  55 | 拒绝 UNC                  | `tests/storage-root-paths.test.ts` |
|  56 | 拒绝设备命名空间          | `tests/storage-root-paths.test.ts` |
|  57 | 拒绝 file URL             | `tests/storage-root-paths.test.ts` |
|  58 | 拒绝混合分隔符穿越        | `tests/storage-root-paths.test.ts` |
|  59 | 拒绝多层 `..`             | `tests/storage-root-paths.test.ts` |
|  60 | 持久化只用 `/`            | `tests/storage-root-paths.test.ts` |
|  61 | native 路径仍在根内       | `tests/storage-root-paths.test.ts` |
|  62 | 前缀陷阱不能绕过          | `tests/storage-root-paths.test.ts` |
|  63 | 符号链接祖先不能绕过      | `tests/storage-root-paths.test.ts` |
|  64 | descriptor 不含绝对路径   | `tests/storage-repository.test.ts` |

## D. 写入、内容寻址与并发

|   # | 验收                       | 自动化/可复核证据                    |
| --: | -------------------------- | ------------------------------------ |
|  65 | putBuffer                  | `tests/storage-repository.test.ts`   |
|  66 | putStream                  | `tests/storage-repository.test.ts`   |
|  67 | ingestExternalFile         | `tests/storage-repository.test.ts`   |
|  68 | 原文件不变                 | `tests/storage-repository.test.ts`   |
|  69 | 目录源被拒绝               | `tests/storage-repository.test.ts`   |
|  70 | 链接/junction 源被拒绝     | `tests/storage-repository.test.ts`   |
|  71 | 非普通文件被拒绝           | `tests/storage-repository.test.ts`   |
|  72 | SHA-256 独立一致           | `tests/storage-repository.test.ts`   |
|  73 | 实际字节数正确             | `tests/storage-repository.test.ts`   |
|  74 | 同内容幂等                 | `tests/storage-concurrency.test.ts`  |
|  75 | 同名异内容不覆盖           | `tests/storage-concurrency.test.ts`  |
|  76 | 20 路同内容只留一个目标    | `tests/storage-concurrency.test.ts`  |
|  77 | 并发不同内容均保留         | `tests/storage-concurrency.test.ts`  |
|  78 | 临时文件位于受控目标边界   | `tests/storage-concurrency.test.ts`  |
|  79 | 临时文件独占创建           | `tests/storage-concurrency.test.ts`  |
|  80 | publish 前 sync            | `tests/storage-concurrency.test.ts`  |
|  81 | 成功后无本次临时文件       | `tests/storage-concurrency.test.ts`  |
|  82 | 中途失败无最终文件         | `tests/storage-repository.test.ts`   |
|  83 | publish 失败保留旧目标     | `tests/storage-concurrency.test.ts`  |
|  84 | Windows 有限重试           | `tests/storage-concurrency.test.ts`  |
|  85 | Abort 后无最终文件         | `tests/storage-repository.test.ts`   |
|  86 | 超限流式中止               | `tests/storage-repository.test.ts`   |
|  87 | 源复制中变化被检测         | `tests/storage-repository.test.ts`   |
|  88 | 32 MiB 不走整文件 readFile | `tests/storage-repository.test.ts`   |
|  89 | read stream 内容正确       | `tests/storage-repository.test.ts`   |
|  90 | stat metadata 有限         | `tests/storage-repository.test.ts`   |
|  91 | verify 正常通过            | `tests/storage-repository.test.ts`   |
|  92 | verify 检出损坏            | `tests/storage-repository.test.ts`   |
|  93 | verify 区分缺失            | `tests/storage-repository.test.ts`   |
|  94 | 无生产递归删除 API         | `tests/storage-architecture.test.ts` |

## E. 类别与日志

|   # | 验收                        | 自动化/可复核证据                    |
| --: | --------------------------- | ------------------------------------ |
|  95 | SOURCE_SNAPSHOT 目录        | `tests/storage-repository.test.ts`   |
|  96 | CLIP_SCREENSHOT 目录        | `tests/storage-repository.test.ts`   |
|  97 | PHOTO_ORIGINAL 目录         | `tests/storage-repository.test.ts`   |
|  98 | PHOTO_PROCESSED 目录        | `tests/storage-repository.test.ts`   |
|  99 | GENERATED_IMAGE 目录        | `tests/storage-repository.test.ts`   |
| 100 | IMPORT 目录                 | `tests/storage-repository.test.ts`   |
| 101 | EXPORT 仅基础原语           | `tests/storage-architecture.test.ts` |
| 102 | BACKUP 仅基础原语           | `tests/storage-architecture.test.ts` |
| 103 | LOG 目录                    | `tests/storage-logging.test.ts`      |
| 104 | JSONL 可解析                | `tests/storage-logging.test.ts`      |
| 105 | 凭据字段脱敏                | `tests/storage-logging.test.ts`      |
| 106 | 凭据值不落明文              | `tests/storage-logging.test.ts`      |
| 107 | 大小/深度/字段限制          | `tests/storage-logging.test.ts`      |
| 108 | 并发日志无破损行            | `tests/storage-logging.test.ts`      |
| 109 | 日志无绝对路径/payload/正文 | `tests/storage-logging.test.ts`      |

## F. SQLite 路径与迁移

|   # | 验收                        | 自动化/可复核证据                                |
| --: | --------------------------- | ------------------------------------------------ |
| 110 | 枚举全部路径字段            | `tests/storage-db-paths.test.ts`；ADR            |
| 111 | 迁移连续且名称稳定          | `tests/storage-db-paths.test.ts`                 |
| 112 | 历史迁移不变                | `tests/storage-db-paths.test.ts`                 |
| 113 | 新迁移重复运行幂等          | `tests/storage-db-paths.test.ts`                 |
| 114 | 合法相对路径可保存          | `tests/storage-db-paths.test.ts`                 |
| 115 | 数据库拒绝绝对路径          | `tests/storage-db-paths.test.ts`                 |
| 116 | 拒绝反斜杠/盘符/冒号        | `tests/storage-db-paths.test.ts`                 |
| 117 | 拒绝点段/空段/穿越          | `tests/storage-db-paths.test.ts`                 |
| 118 | 固定字段拒绝错误顶层        | `tests/storage-db-paths.test.ts`                 |
| 119 | NULL 语义保持               | `tests/storage-db-paths.test.ts`                 |
| 120 | 已有路径与业务行保留        | `tests/storage-db-paths.test.ts`                 |
| 121 | FK/索引/STRICT/删除策略保留 | `tests/storage-db-paths.test.ts`                 |
| 122 | 新迁移失败回滚              | `tests/storage-db-paths.test.ts`                 |
| 123 | 迁移前备份可独立打开        | `tests/storage-db-paths.test.ts`                 |
| 124 | database/backups 集成正确   | `tests/storage-db-paths.test.ts`；Electron smoke |
| 125 | 数据库不指向临时文件        | `tests/storage-db-paths.test.ts`                 |
| 126 | DB 失败不误删共享内容       | `tests/storage-db-paths.test.ts`                 |

## G. Electron、Windows 与冻结约束

|   # | 验收                         | 自动化/可复核证据                                  |
| --: | ---------------------------- | -------------------------------------------------- |
| 127 | 中文/空格/多层目录           | `tests/storage-root-paths.test.ts`                 |
| 128 | 超过传统 MAX_PATH 的真实行为 | `tests/storage-root-paths.test.ts`；Electron smoke |
| 129 | 源码 Electron storage smoke  | `npm run test:electron-smoke`                      |
| 130 | packaged EXE storage smoke   | `npm run test:packaged-smoke`                      |

## 附加冻结约束

| 约束                                 | 自动化/可复核证据                                                          |
| ------------------------------------ | -------------------------------------------------------------------------- |
| renderer 无 `node:fs`                | `tests/storage-architecture.test.ts`；`tests/desktop-architecture.test.ts` |
| preload 无任意文件 API               | `tests/storage-architecture.test.ts`；`tests/desktop-contracts.test.ts`    |
| BrowserWindow 与 fuses 不放宽        | `tests/desktop-security.test.ts`；packaged smoke                           |
| runtime 外部请求和 TCP 为 0          | Electron/packaged smoke                                                    |
| 不改注册表/组策略/权限               | `tests/storage-architecture.test.ts`                                       |
| 32 MiB 流式/backpressure             | `tests/storage-repository.test.ts`                                         |
| `ai_disclosure` 固定 false           | `tests/hard-constraints.test.ts`；`tests/db-hard-constraints.test.ts`      |
| AI 不参与门禁/评分/审批/排期/导出    | `tests/storage-architecture.test.ts`；既有约束测试                         |
| 版权不参与门禁或状态                 | `tests/storage-architecture.test.ts`；既有约束测试                         |
| 无小红书平台动作                     | `tests/storage-architecture.test.ts`                                       |
| 无云服务/远程队列/真实 API/密钥/费用 | `tests/storage-architecture.test.ts`                                       |
| 无开卷或盗版电子书处理               | `tests/storage-architecture.test.ts`                                       |
| 007/009/006 核心未重写               | Git diff；全量既有测试                                                     |
